#!/usr/bin/env node
// Kalshi's per-match totals (founder 2026-11-01: "build what's possible for Kalshi, do the same as Polymarket"), from
// Kalshi's PUBLIC market-data API (no key):
//   * the ATP match-winner markets (series KXATPMATCH: one market per player, "X wins"), open + closed in the last 4 days;
//   * contracts traded = both markets' volume_fp (a contract pays $1);
//   * match-winner liquidity = the whole order book of both markets, in dollars: Σ price × contracts over every resting
//     bid on both sides (GET /markets/{ticker}/orderbook; Kalshi's book holds bids only, the ask is the other side's bid).
// For (1) kalshi.json — the Market Signal line on the Today's Matches cards, keyed by the card's event key, one-to-one
// join on both surnames + initials and a start within 36 h (tools/polymarket-volume.mjs `joinBoard`, the same rule);
// (2) kalshi_bot.book (tools/kalshi-drop-bot.sql) through public.kalshi_book_ingest, for the 🟣 KALSHI DROP alerts.
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY (the DB write; without them only the file). Args: board file, out file.
import fs from 'node:fs';
import { joinBoard, cardStartMs } from './polymarket-volume.mjs';

export const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
export const SERIES = 'KXATPMATCH';
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// markets → one match per event_ticker with exactly two markets (the two players)
export function kalshiMatches(markets) {
  const by = new Map();
  for (const m of Array.isArray(markets) ? markets : []) {
    if (!m || !m.event_ticker || !m.ticker || !m.yes_sub_title) continue;
    (by.get(m.event_ticker) || by.set(m.event_ticker, []).get(m.event_ticker)).push(m);
  }
  const out = [];
  for (const [ev, ms] of by) {
    if (ms.length !== 2) continue;
    ms.sort((x, y) => (x.ticker < y.ticker ? -1 : 1));
    const vols = ms.map((m) => num(m.volume_fp));
    out.push({ slug: ev, a: ms[0].yes_sub_title, b: ms[1].yes_sub_title, tickers: ms.map((m) => m.ticker),
      startMs: Date.parse(ms[0].occurrence_datetime || ms[0].expected_expiration_time || ''),
      volume: vols.every((v) => v != null) ? Math.round((vols[0] + vols[1]) * 100) / 100 : null, open: ms.every((m) => m.status === 'active') });
  }
  return out;
}
// Σ price × contracts over every resting bid on both sides of one market's book (dollars); null when unreadable
export function bookDollars(ob) {
  const b = ob && (ob.orderbook_fp || ob.orderbook);
  if (!b) return null;
  let s = 0;
  for (const side of ['yes_dollars', 'no_dollars']) {
    for (const lvl of Array.isArray(b[side]) ? b[side] : []) {
      const p = num(lvl && lvl[0]), q = num(lvl && lvl[1]);
      if (p == null || q == null) return null;
      s += p * q;
    }
  }
  return Math.round(s * 100) / 100;
}

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30e3), headers: { 'User-Agent': 'stennisfy-pipeline' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url.replace(KALSHI, '')}`);
  return r.json();
}
export async function fetchMarkets(get = getJson, now = Date.now()) {
  const all = [];
  for (const q of [`status=open`, `status=closed&min_close_ts=${Math.floor(now / 1000) - 4 * 86400}`,
                   `status=settled&min_close_ts=${Math.floor(now / 1000) - 4 * 86400}`]) {
    let cursor = '';
    for (let i = 0; i < 10; i++) {
      let page;
      try { page = await get(`${KALSHI}/markets?series_ticker=${SERIES}&limit=1000&${q}${cursor ? '&cursor=' + cursor : ''}`); }
      catch (e) { if (q === 'status=open') throw e; break; }      // the open list is required; closed / settled are extras
      all.push(...(page.markets || []));
      cursor = page.cursor || '';
      if (!cursor || !(page.markets || []).length) break;
    }
  }
  const seen = new Set();
  return all.filter((m) => m && m.ticker && !seen.has(m.ticker) && seen.add(m.ticker));
}

function writeAtomic(path, obj) { const t = path + '.tmp-' + process.pid; fs.writeFileSync(t, JSON.stringify(obj)); fs.renameSync(t, path); }

async function main() {
  const [boardPath = 'matches.json', outPath = 'kalshi.json'] = process.argv.slice(2);
  const { berlinWallMs } = await import(new URL('../berlin-time.js', import.meta.url)).then((m) => m.default || m);
  let board;
  try { const j = JSON.parse(fs.readFileSync(boardPath, 'utf8')); board = Array.isArray(j) ? j : (j.matches || []); }
  catch (e) { console.log(`::error::kalshi: cannot read ${boardPath} (${e.message}) — nothing written`); process.exit(1); }
  let markets;
  try { markets = await fetchMarkets(); }
  catch (e) { console.log(`::error::kalshi: public API failed (${e.message}) — nothing written; the cards and alerts show no Kalshi totals`); process.exit(1); }
  const matches = kalshiMatches(markets);
  // the whole book, open matches only (a closed market's book is empty); 4 at a time
  const open = matches.filter((m) => m.open);
  let failed = 0;
  for (let i = 0; i < open.length; i += 4) {
    await Promise.all(open.slice(i, i + 4).map(async (m) => {
      try {
        const bs = await Promise.all(m.tickers.map((t) => getJson(`${KALSHI}/markets/${t}/orderbook`).then(bookDollars)));
        m.liquidity = bs.every((x) => x != null) ? Math.round((bs[0] + bs[1]) * 100) / 100 : null;
      } catch { m.liquidity = null; failed++; }
    }));
  }
  const { byEvent: j, ambiguous } = joinBoard(board, matches.map((m) => ({ ...m, volumeMl: m.volume })), (m) => cardStartMs(m, berlinWallMs));
  const byEvent = {};
  for (const [ek, r] of Object.entries(j)) byEvent[ek] = { event: r.slug, contracts: r.volume, liquidity: r.liquidity ?? null };
  writeAtomic(outPath, { generatedAt: new Date().toISOString(), source: 'Kalshi public API, series ' + SERIES,
    counts: { kalshiMatches: matches.length, open: open.length, booksFailed: failed, boardCards: board.length, joined: Object.keys(byEvent).length, ambiguous }, byEvent });
  console.log(`kalshi: ${matches.length} Kalshi ATP matches (${open.length} open, ${failed} books unreadable); ${Object.keys(byEvent).length} of ${board.length} board cards joined, ${ambiguous} ambiguous`);

  const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: key } = process.env;
  if (!url || !key) { console.log('kalshi: no SUPABASE_URL / SUPABASE_SECRET_KEY — the alert totals were not written'); return; }
  const rows = open.map((m) => ({ event_ticker: m.slug, liquidity: m.liquidity ?? null, contracts: m.volume }));
  const r = await fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/kalshi_book_ingest', {
    method: 'POST', signal: AbortSignal.timeout(60e3),
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_rows: rows }),
  }).catch((e) => ({ ok: false, status: e.name, text: async () => '' }));
  if (!r.ok) {
    const why = String(await r.text().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ');
    console.log(`::error::kalshi: book ingest failed (HTTP ${r.status}) ${why} — the alerts show "—" for match-winner liquidity`); process.exit(1);
  }
  console.log(`kalshi: ${rows.length} match books written for the drop alerts`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
