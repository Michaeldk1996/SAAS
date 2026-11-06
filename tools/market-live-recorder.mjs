#!/usr/bin/env node
// Per-minute prediction-market reads for the Market Signal drawer (founder 2026-11-06: "Build this" — Kalshi and
// Polymarket every minute instead of every pipeline run, frozen at the REAL start).
//
// Which matches: exactly the cards the pipeline already joined, one-to-one, to a Kalshi event (kalshi.json `event`) or a
// Polymarket event (polymarket.json `slug`) — read from the published site every 10 minutes, so this recorder never
// joins a name itself. What, every POLL_S seconds (public endpoints, no key):
//   Kalshi      GET /markets?series_ticker=KXATPMATCH&status=open (one call, every open match) and, per joined open match,
//               both players' /orderbook (2 calls). liquidity = Σ price × contracts over every resting bid, both sides,
//               both markets — kalshi-volume.mjs `bookDollars`, the figure kalshi.json carries. Per player: yes bid / ask.
//   Polymarket  GET gamma /events?series_id=10365&closed=false (one call). liquidity = the match-winner market's
//               liquidityNum — polymarket-volume.mjs's figure. Per player: outcomePrices (the midpoint) and the best
//               bid / ask (the second player's are the first's mirrored: one book).
// Write: public.market_live_push (supabase/migrations/20261106090000_market_live.sql, service role), which refuses any
// match our live poller has flagged live — so the card keeps the last read before our own live sighting.
// Usage: node tools/market-live-recorder.mjs --minutes 350 [--once]. Env: SUPABASE_URL, SUPABASE_SECRET_KEY.
import { bookDollars, KALSHI, SERIES } from './kalshi-volume.mjs';
import { ATP_SERIES, fetchPublished } from './polymarket-volume.mjs';

const GAMMA = 'https://gamma-api.polymarket.com';
export const POLL_S = 60;
export const TARGETS_EVERY_MS = 10 * 60e3;
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r4 = (x) => (x == null ? null : Math.round(x * 1e4) / 1e4);
const mid = (b, a) => (b != null && a != null ? r4((b + a) / 2) : null);

// {eventKey: {kalshi?: eventTicker, poly?: slug}} from the two published files
export function targetsFrom(kal, poly) {
  const out = {};
  for (const [ek, r] of Object.entries((kal && kal.byEvent) || {})) if (r && r.event) (out[ek] ||= {}).kalshi = String(r.event);
  for (const [ek, r] of Object.entries((poly && poly.byEvent) || {})) if (r && r.slug) (out[ek] ||= {}).poly = String(r.slug);
  return out;
}

// Kalshi open markets → {eventTicker: [market, market]} for events with exactly two active player markets
export function kalshiEvents(markets) {
  const by = new Map();
  for (const m of Array.isArray(markets) ? markets : []) {
    if (!m || !m.event_ticker || !m.ticker || !m.yes_sub_title || m.status !== 'active') continue;
    (by.get(m.event_ticker) || by.set(m.event_ticker, []).get(m.event_ticker)).push(m);
  }
  for (const [k, v] of by) { if (v.length !== 2) by.delete(k); else v.sort((x, y) => (x.ticker < y.ticker ? -1 : 1)); }
  return by;
}
// One Kalshi row. books = the two /orderbook answers, in the markets' order (a missing one → liquidity null).
export function kalshiRow(ek, ev, pair, books, readAt) {
  const liqs = (books || []).map(bookDollars);
  const liquidity = liqs.length === 2 && liqs.every((x) => x != null) ? Math.round((liqs[0] + liqs[1]) * 100) / 100 : null;
  const outcomes = pair.map((m) => {
    const bid = num(m.yes_bid_dollars), ask = num(m.yes_ask_dollars);
    const ok = (x) => x != null && x > 0 && x < 1;
    return { name: m.yes_sub_title, bid: ok(bid) ? bid : null, ask: ok(ask) ? ask : null, mid: ok(bid) && ok(ask) ? mid(bid, ask) : null };
  });
  return { event_key: ek, venue: 'kalshi', ref: ev, liquidity, outcomes, status: 'open', read_at: readAt };
}
// One Polymarket row from its Gamma event (the match-winner market: two outcomes, question = the event title)
export function polyRow(ek, e, readAt) {
  const mk = (e.markets || []).find((m) => {
    let o; try { o = JSON.parse(m.outcomes || '[]'); } catch { o = []; }
    return o.length === 2 && String(m.question || '') === String(e.title || '');
  });
  if (!mk) return null;
  let names, prices; try { names = JSON.parse(mk.outcomes); prices = JSON.parse(mk.outcomePrices || '[]'); } catch { return null; }
  const liq = num(mk.liquidityNum != null ? mk.liquidityNum : mk.liquidity);
  const bb = num(mk.bestBid), ba = num(mk.bestAsk);
  const in01 = (x) => x != null && x > 0 && x < 1;
  const p = prices.map(num);
  const outcomes = [
    { name: names[0], bid: in01(bb) ? bb : null, ask: in01(ba) ? ba : null, mid: in01(p[0]) ? r4(p[0]) : null },
    { name: names[1], bid: in01(ba) ? r4(1 - ba) : null, ask: in01(bb) ? r4(1 - bb) : null, mid: in01(p[1]) ? r4(p[1]) : null },
  ];
  const open = !e.closed && !mk.closed && mk.acceptingOrders !== false;
  return { event_key: ek, venue: 'polymarket', ref: e.slug, liquidity: liq != null && liq >= 0 ? liq : null, outcomes,
    status: open ? 'open' : 'closed', read_at: readAt };
}

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20e3), headers: { 'User-Agent': 'stennisfy-market-live' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url.replace(KALSHI, '').replace(GAMMA, '')}`);
  return r.json();
}

// One minute's reads → rows. Each venue fails on its own (that venue writes nothing this minute).
export async function readMinute(targets, get = getJson, now = () => new Date().toISOString()) {
  const rows = [], note = { targets: Object.keys(targets).length, kalshi: 0, poly: 0, errors: [] };
  const kTargets = Object.entries(targets).filter(([, t]) => t.kalshi);
  if (kTargets.length) {
    try {
      const page = await get(`${KALSHI}/markets?series_ticker=${SERIES}&status=open&limit=1000`);
      const evs = kalshiEvents(page.markets);
      for (const [ek, t] of kTargets) {
        const pair = evs.get(t.kalshi);
        if (!pair) continue;                                   // not open (finished / not listed): nothing to read
        const books = await Promise.all(pair.map((m) => get(`${KALSHI}/markets/${m.ticker}/orderbook`).catch(() => null)));
        rows.push(kalshiRow(ek, t.kalshi, pair, books, now())); note.kalshi++;
      }
    } catch (e) { note.errors.push('kalshi: ' + e.message); }
  }
  const pTargets = Object.entries(targets).filter(([, t]) => t.poly);
  if (pTargets.length) {
    try {
      const evs = [];
      for (let off = 0; off < 2000; off += 500) {
        const page = await get(`${GAMMA}/events?series_id=${ATP_SERIES}&closed=false&limit=500&offset=${off}`);
        if (!Array.isArray(page)) throw new Error('events: not a list');
        evs.push(...page); if (page.length < 500) break;
      }
      const bySlug = new Map(evs.map((e) => [e.slug, e]));
      for (const [ek, t] of pTargets) {
        const e = bySlug.get(t.poly);
        const row = e && polyRow(ek, e, now());
        if (row && row.status === 'open') { rows.push(row); note.poly++; }
      }
    } catch (e) { note.errors.push('polymarket: ' + e.message); }
  }
  return { rows, note };
}

async function push(rows, note) {
  const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: key } = process.env;
  const r = await fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/market_live_push', {
    method: 'POST', signal: AbortSignal.timeout(30e3),
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_rows: rows, p_note: note }),
  });
  if (!r.ok) throw new Error(`push HTTP ${r.status} ${String(await r.text().catch(() => '')).slice(0, 200)}`);
  return r.json();
}

async function main() {
  const args = process.argv.slice(2);
  const minutes = Math.min(350, Number(args[args.indexOf('--minutes') + 1]) || 350);
  const once = args.includes('--once');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) { console.log('::error::market-live: SUPABASE_URL / SUPABASE_SECRET_KEY missing'); process.exit(1); }
  const stopAt = Date.now() + minutes * 60e3;
  let targets = {}, targetsAt = 0, ticks = 0, pushFails = 0;
  while (Date.now() < stopAt) {
    const t0 = Date.now();
    if (t0 - targetsAt > TARGETS_EVERY_MS || !Object.keys(targets).length) {
      const [k, p] = await Promise.all([fetchPublished('kalshi.json'), fetchPublished('polymarket.json')]);
      if (k || p) { targets = targetsFrom(k, p); targetsAt = t0; }
    }
    const { rows, note } = await readMinute(targets);
    try {
      const res = await push(rows, note);
      ticks++;
      if (ticks % 10 === 1 || note.errors.length) console.log(`${new Date().toISOString()} targets ${note.targets} · kalshi ${note.kalshi} · polymarket ${note.poly} · written ${res.written} · frozen ${res.frozen}${note.errors.length ? ' · ' + note.errors.join('; ') : ''}`);
    } catch (e) { pushFails++; console.log(`::warning::market-live: ${e.message}`); }
    if (once) break;
    await new Promise((r) => setTimeout(r, Math.max(1000, POLL_S * 1000 - (Date.now() - t0))));
  }
  console.log(`market-live: ${ticks} minutes written, ${pushFails} push failures`);
  if (!ticks) process.exit(1);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
