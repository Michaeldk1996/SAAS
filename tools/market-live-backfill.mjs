#!/usr/bin/env node
// Backfill of the Kalshi / Polymarket rows the freeze emptied (founder 2026-11-12: "Yes, backfill").
//
// Before 2026-11-12 the freeze in public.market_live_push kept only the newest read and dropped it when it was taken after
// our live sighting's lower bound, so most finished matches lost their pre-start prices and traded money. The venues keep
// both, so this rebuilds, for every frozen row with no prices and no traded money (started_at set, outcomes and flow null),
// the same figures the recorder stores, from the venue's own history AT OR BEFORE started_at (the lower bound):
//   Kalshi      per player market: the last one-minute candlestick ending at or before the start (yes bid / ask close →
//               the recorder's mid); traded money = every trade created at or before the start, the recorder's rule
//               (taker yes on A = money on A at the yes price, taker no on A = money on the other at the no price).
//   Polymarket  per outcome token: the last /prices-history point at or before the start (the midpoint the recorder reads
//               as outcomePrices); bid / ask are not in the history → null. Traded money = every trade at or before the
//               start (BUY X = money on X, SELL X = money on the other, size × price).
// Resting liquidity at the start is not in either venue's history: it stays null (the page shows no resting line).
// A price point older than LOOKBACK_S before the start is not used (null): never a stale price labelled pre-start.
// read_at = the price point's own time (Polymarket: the older of the two outcomes'). Nothing after the start is read.
//
// Modes:
//   --check   rebuild the rows the recorder froze INTACT and compare with what it stored (no write) — the method's proof.
//   --plan    rebuild the emptied rows and print them (no write).
//   --write   rebuild the emptied rows and write them through public.market_live_backfill (service role).
// Env: SUPABASE_URL, and SUPABASE_SECRET_KEY for --write (reads use SUPABASE_PUBLISHABLE_KEY when given, else the secret).
import { KALSHI, SERIES } from './kalshi-volume.mjs';

const GAMMA = 'https://gamma-api.polymarket.com', CLOB = 'https://clob.polymarket.com', DATA = 'https://data-api.polymarket.com';
export const LOOKBACK_S = 30 * 60;
export const MAX_PAGES = 40;
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r4 = (x) => (x == null ? null : Math.round(x * 1e4) / 1e4);
const usd2 = (x) => Math.round(x * 100) / 100;
const in01 = (x) => x != null && x > 0 && x < 1;
const iso = (s) => new Date(s * 1000).toISOString();

async function getJson(url) {
  for (let i = 0; i < 4; i++) {
    let r;
    try { r = await fetch(url, { signal: AbortSignal.timeout(30e3), headers: { 'User-Agent': 'stennisfy-market-live-backfill' } }); }
    catch (e) { if (i === 3) throw e; await new Promise((ok) => setTimeout(ok, 2000 * (i + 1))); continue; }
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 2000 * (i + 1))); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return r.json();
  }
  throw new Error(`HTTP 429 ${url}`);
}

// The last candle ending at or before lb, inside the lookback, with a valid bid and ask → {bid, ask, mid, t}
export function kalshiPoint(candles, lb) {
  const ok = (candles || []).filter((c) => c && c.end_period_ts <= lb && c.end_period_ts >= lb - LOOKBACK_S)
    .sort((a, b) => a.end_period_ts - b.end_period_ts);
  for (let i = ok.length - 1; i >= 0; i--) {
    const bid = num(ok[i].yes_bid && ok[i].yes_bid.close_dollars), ask = num(ok[i].yes_ask && ok[i].yes_ask.close_dollars);
    if (in01(bid) && in01(ask)) return { bid, ask, mid: r4((bid + ask) / 2), t: ok[i].end_period_ts };
  }
  return null;
}
// The last price point at or before lb, inside the lookback → {p, t}
export function polyPoint(history, lb) {
  const ok = (history || []).filter((h) => h && h.t <= lb && h.t >= lb - LOOKBACK_S && in01(num(h.p))).sort((a, b) => a.t - b.t);
  return ok.length ? { p: r4(num(ok[ok.length - 1].p)), t: ok[ok.length - 1].t } : null;
}
// Kalshi traded money per player at or before lb (the recorder's rule), from the two markets' trade pages
export function kalshiFlowOf(pair, tradesByTicker, lbIso) {
  const byName = {}; let trades = 0; const lb = Date.parse(lbIso);
  for (const m of pair) {
    const other = pair.find((x) => x !== m).yes_sub_title;
    for (const x of tradesByTicker[m.ticker] || []) {
      if (!(Date.parse(x.created_time) <= lb)) continue;
      const c = num(x.count_fp != null ? x.count_fp : x.count), yes = x.taker_side === 'yes';
      const px = num(yes ? x.yes_price_dollars : x.no_price_dollars);
      if (c == null || px == null || (x.taker_side !== 'yes' && x.taker_side !== 'no')) continue;
      const n = yes ? m.yes_sub_title : other;
      byName[n] = (byName[n] || 0) + c * px; trades++;
    }
  }
  for (const n of pair.map((m) => m.yes_sub_title)) byName[n] = usd2(byName[n] || 0);
  return { byName, trades, at: lbIso };
}
// Polymarket traded money per outcome at or before lb (the recorder's rule)
export function polyFlowOf(names, trades, lbIso) {
  const byName = { [names[0]]: 0, [names[1]]: 0 }; let n = 0; const lb = Date.parse(lbIso) / 1000;
  for (const x of trades) {
    if (!(num(x.timestamp) <= lb)) continue;
    const o = x.outcome, side = String(x.side || '').toUpperCase(), sz = num(x.size), px = num(x.price);
    if (!(o in byName) || (side !== 'BUY' && side !== 'SELL') || sz == null || px == null) continue;
    byName[side === 'BUY' ? o : names.find((y) => y !== o)] += sz * px; n++;
  }
  for (const k of names) byName[k] = usd2(byName[k]);
  return { byName, trades: n, at: lbIso };
}

async function kalshiRebuild(ref, lbIso, get) {
  const lb = Math.floor(Date.parse(lbIso) / 1000);
  const ms = ((await get(`${KALSHI}/markets?event_ticker=${encodeURIComponent(ref)}`)).markets || []).filter((m) => m && m.ticker && m.yes_sub_title);
  if (ms.length !== 2) return { why: `${ms.length} markets on the event` };
  ms.sort((x, y) => (x.ticker < y.ticker ? -1 : 1));
  const pts = [], tradesBy = {};
  for (const m of ms) {
    const c = await get(`${KALSHI}/series/${SERIES}/markets/${m.ticker}/candlesticks?start_ts=${lb - LOOKBACK_S}&end_ts=${lb}&period_interval=1`);
    pts.push(kalshiPoint(c.candlesticks, lb));
    const all = []; let cursor = '', done = false;
    for (let i = 0; i < MAX_PAGES; i++) {
      const pg = await get(`${KALSHI}/markets/trades?ticker=${m.ticker}&max_ts=${lb}&limit=1000${cursor ? '&cursor=' + cursor : ''}`);
      all.push(...((pg && pg.trades) || []));
      cursor = (pg && pg.cursor) || '';
      if (!cursor) { done = true; break; }
    }
    if (!done) return { why: 'trade history longer than the page cap' };
    tradesBy[m.ticker] = all;
  }
  const outcomes = ms.map((m, i) => ({ name: m.yes_sub_title, bid: pts[i] ? pts[i].bid : null, ask: pts[i] ? pts[i].ask : null, mid: pts[i] ? pts[i].mid : null }));
  const t = pts.every(Boolean) ? Math.min(pts[0].t, pts[1].t) : null;
  return { outcomes: t ? outcomes : null, read_at: t ? iso(t) : null, flow: kalshiFlowOf(ms, tradesBy, lbIso) };
}

async function polyRebuild(ref, lbIso, get) {
  const lb = Math.floor(Date.parse(lbIso) / 1000);
  const e = (await get(`${GAMMA}/events?slug=${encodeURIComponent(ref)}`))[0];
  if (!e) return { why: 'event not found' };
  const mk = (e.markets || []).find((m) => String(m.question || '') === String(e.title || ''));
  let names, toks; try { names = JSON.parse(mk.outcomes); toks = JSON.parse(mk.clobTokenIds); } catch { return { why: 'no match-winner market' }; }
  if (names.length !== 2 || toks.length !== 2 || !mk.conditionId) return { why: 'no two-outcome market' };
  const pts = [];
  for (const tk of toks) pts.push(polyPoint((await get(`${CLOB}/prices-history?market=${tk}&startTs=${lb - LOOKBACK_S}&endTs=${lb}&fidelity=1`)).history, lb));
  const trades = []; let cursor = '', done = false;
  for (let i = 0; i < MAX_PAGES; i++) {
    const pg = await get(`${DATA}/v2/trades?condition=${mk.conditionId}&limit=500${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
    if (!pg || !Array.isArray(pg.data)) return { why: 'trade history unreadable' };
    trades.push(...pg.data);
    cursor = pg.pagination && pg.pagination.has_more ? pg.pagination.next_cursor : '';
    if (!cursor) { done = true; break; }
  }
  if (!done) return { why: 'trade history longer than the page cap' };
  const t = pts.every(Boolean) ? Math.min(pts[0].t, pts[1].t) : null;
  const outcomes = names.map((n, i) => ({ name: n, bid: null, ask: null, mid: pts[i] ? pts[i].p : null }));
  return { outcomes: t ? outcomes : null, read_at: t ? iso(t) : null, flow: polyFlowOf(names, trades, lbIso) };
}

export async function rebuild(row, get = getJson) {
  const lbIso = new Date(Date.parse(row.started_at)).toISOString();
  return row.venue === 'kalshi' ? kalshiRebuild(row.ref, lbIso, get) : polyRebuild(row.ref, lbIso, get);
}

async function main() {
  const mode = ['--check', '--plan', '--write'].find((m) => process.argv.includes(m));
  if (!mode) { console.error('usage: --check | --plan | --write'); process.exit(2); }
  const U = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const RK = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const hdr = (k) => ({ apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' });
  const sel = 'event_key,venue,ref,liquidity,outcomes,flow,read_at,started_at';
  const filt = mode === '--check' ? 'started_at=not.is.null&outcomes=not.is.null&flow=not.is.null' : 'started_at=not.is.null&outcomes=is.null&flow=is.null';
  const rows = await (await fetch(`${U}/rest/v1/market_live_current?select=${sel}&${filt}&order=started_at`, { headers: hdr(RK) })).json();
  if (!Array.isArray(rows)) { console.error('read failed', rows); process.exit(1); }
  console.log(`${rows.length} ${mode === '--check' ? 'intact' : 'emptied'} frozen rows`);
  const out = []; let worst = 0, flowWorst = 0;
  for (const r of rows) {
    let b; try { b = await rebuild(r); } catch (e) { b = { why: String(e.message || e).slice(0, 120) }; }
    const tag = `${r.event_key} ${r.venue.padEnd(10)} start ${r.started_at.slice(0, 16)}`;
    if (b.why) { console.log(`${tag}  SKIP ${b.why}`); continue; }
    const tot = (f) => f ? Object.values(f.byName).reduce((a, x) => a + Number(x), 0) : null;
    if (mode === '--check') {
      const m1 = (o) => (o || []).map((x) => x.mid);
      const sm = m1(r.outcomes), bm = m1(b.outcomes);
      const dm = sm.length === 2 && bm.length === 2 && bm.every((x) => x != null) ? Math.max(Math.abs(sm[0] - bm[0]), Math.abs(sm[1] - bm[1])) : null;
      // same cut as the stored sum (its own stamp), so the two count the same trades
      let same = null; try { same = await rebuild({ ...r, started_at: r.flow.at }); } catch { same = null; }
      const st = tot(r.flow), bt = same && same.flow ? usd2(tot(same.flow)) : null, df = st && bt != null ? (bt - st) / st : null;
      if (dm != null) worst = Math.max(worst, dm); if (df != null) flowWorst = Math.max(flowWorst, Math.abs(df));
      console.log(`${tag}  mid stored ${sm.join('/')} rebuilt ${bm.join('/')} (Δ ${dm == null ? '—' : dm.toFixed(4)})  traded stored $${st} rebuilt $${bt} (both cut at ${(r.flow.at || '').slice(11, 16)}; ${r.flow.trades} vs ${same && same.flow ? same.flow.trades : '—'} trades)  read ${r.read_at.slice(11, 16)} vs ${b.read_at ? b.read_at.slice(11, 16) : '—'}`);
    } else {
      console.log(`${tag}  mids ${b.outcomes ? b.outcomes.map((x) => x.mid).join('/') : '— (no price point in the 30 min before the start)'}  read ${b.read_at || '—'}  traded $${tot(b.flow)} · ${b.flow.trades} trades`);
      out.push({ event_key: r.event_key, venue: r.venue, outcomes: b.outcomes, read_at: b.read_at, flow: b.flow });
    }
  }
  if (mode === '--check') console.log(`largest mid difference ${worst.toFixed(4)}; largest traded-money difference ${(100 * flowWorst).toFixed(1)}% (both cut at the stored sum's own stamp)`);
  if (mode === '--write') {
    const K = process.env.SUPABASE_SECRET_KEY;
    const r = await fetch(`${U}/rest/v1/rpc/market_live_backfill`, { method: 'POST', headers: hdr(K), body: JSON.stringify({ p_rows: out }) });
    const t = await r.text(); console.log(`write: HTTP ${r.status} ${t.slice(0, 300)}`);
    if (!r.ok) process.exit(1);
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
