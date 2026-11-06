// tools/market-live-recorder.mjs — the per-minute Kalshi / Polymarket reads (founder 2026-11-06).
// Checks, on the venues' real answer shapes (Shelton v Paul, 6 Nov 2026): the targets are exactly the pipeline's
// one-to-one joins; Kalshi liquidity = kalshi-volume.mjs's bookDollars over both books (the figure kalshi.json carries),
// one unreadable book = no figure (never half); per-player bid / ask / mid, an out-of-range price dashed; Polymarket
// = the match-winner market's liquidityNum, the second player's bid / ask mirrored from the first's, a closed market
// not sent; a finished Kalshi match (not in the open list) is not read; one venue failing never stops the other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetsFrom, kalshiEvents, kalshiRow, polyRow, readMinute } from './market-live-recorder.mjs';

const KAL = { byEvent: { '12177788': { event: 'KXATPMATCH-26NOV06SHEPAU', liquidity: 243875 }, '1': { event: null } } };
const POLY = { byEvent: { '12177788': { slug: 'atp-shelton-paul-2026-11-06' }, '12177906': { slug: 'atp-ruud-borges-2026-11-06' } } };
const mk = (t, who, bid, ask, status = 'active') => ({ ticker: 'KXATPMATCH-26NOV06SHEPAU-' + t, event_ticker: 'KXATPMATCH-26NOV06SHEPAU',
  yes_sub_title: who, status, yes_bid_dollars: String(bid), yes_ask_dollars: String(ask) });
const BOOK = (yes, no) => ({ orderbook_fp: { yes_dollars: yes, no_dollars: no } });
const GEV = (closed = false, accepting = true) => ({ slug: 'atp-shelton-paul-2026-11-06', title: 'Ben Shelton vs Tommy Paul', closed,
  markets: [{ question: 'Set 1 Winner', outcomes: '["Ben Shelton","Tommy Paul"]' },
    { question: 'Ben Shelton vs Tommy Paul', outcomes: '["Ben Shelton","Tommy Paul"]', outcomePrices: '["0.455","0.545"]',
      bestBid: 0.45, bestAsk: 0.46, liquidityNum: 59559.63, acceptingOrders: accepting, closed }] });

test('targets = the pipeline joins only', () => {
  assert.deepEqual(targetsFrom(KAL, POLY), { '12177788': { kalshi: 'KXATPMATCH-26NOV06SHEPAU', poly: 'atp-shelton-paul-2026-11-06' },
    '12177906': { poly: 'atp-ruud-borges-2026-11-06' } });
  assert.deepEqual(targetsFrom(null, null), {});
});
test('Kalshi: both books summed, per-player prices, half a book = no figure', () => {
  const pair = kalshiEvents([mk('SHE', 'Ben Shelton', 0.45, 0.46), mk('PAU', 'Tommy Paul', 0.54, 0.55)]).get('KXATPMATCH-26NOV06SHEPAU');
  const r = kalshiRow('12177788', 'KXATPMATCH-26NOV06SHEPAU', pair, [BOOK([['0.45', '100']], [['0.54', '10']]), BOOK([['0.01', '1000']], [])], 'T');
  assert.equal(r.liquidity, 45 + 5.4 + 10);
  assert.deepEqual(r.outcomes[1], { name: 'Ben Shelton', bid: 0.45, ask: 0.46, mid: 0.455 });   // tickers sorted: PAU, SHE
  assert.equal(kalshiRow('1', 'E', pair, [BOOK([['0.4', '1']], []), null], 'T').liquidity, null);
  const bad = kalshiEvents([mk('SHE', 'A', 0, 1), mk('PAU', 'B', 0.5, 0.51)]).get('KXATPMATCH-26NOV06SHEPAU');
  assert.deepEqual(kalshiRow('1', 'E', bad, [], 'T').outcomes[1], { name: 'A', bid: null, ask: null, mid: null });
  assert.equal(kalshiEvents([mk('SHE', 'A', 0.4, 0.5), mk('PAU', 'B', 0.5, 0.6, 'closed')]).size, 0, 'a closed leg = no event');
});
test('Polymarket: the match-winner market, mirrored second player, closed not open', () => {
  const r = polyRow('12177788', GEV(), 'T');
  assert.equal(r.liquidity, 59559.63);
  assert.deepEqual(r.outcomes, [{ name: 'Ben Shelton', bid: 0.45, ask: 0.46, mid: 0.455 }, { name: 'Tommy Paul', bid: 0.54, ask: 0.55, mid: 0.545 }]);
  assert.equal(r.status, 'open');
  assert.equal(polyRow('1', GEV(true), 'T').status, 'closed');
  assert.equal(polyRow('1', GEV(false, false), 'T').status, 'closed', 'not accepting orders = not open');
  assert.equal(polyRow('1', { title: 'X vs Y', markets: [] }, 'T'), null);
});
test('one minute: a finished Kalshi match is not read; one venue failing never stops the other', async () => {
  const calls = [];
  const get = async (u) => {
    calls.push(u);
    if (u.includes('/markets?series_ticker')) return { markets: [mk('SHE', 'Ben Shelton', 0.45, 0.46), mk('PAU', 'Tommy Paul', 0.54, 0.55)] };
    if (u.includes('/orderbook')) return BOOK([['0.5', '2']], []);
    if (u.includes('gamma-api')) return [GEV()];
    throw new Error('unexpected ' + u);
  };
  const t = { ...targetsFrom(KAL, POLY), '777': { kalshi: 'KXATPMATCH-FINISHED' } };
  const { rows, note } = await readMinute(t, get, () => 'T');
  assert.deepEqual(rows.map((r) => r.event_key + '|' + r.venue), ['12177788|kalshi', '12177788|polymarket']);
  assert.equal(calls.filter((u) => u.includes('/orderbook')).length, 2, 'books only for open joined matches');
  assert.equal(calls.length, 4, 'one list per venue + two books per open Kalshi match');
  assert.deepEqual(note.errors, []);
  const failing = async (u) => { if (u.includes('kalshi')) throw new Error('HTTP 503'); return get(u); };
  const two = await readMinute(t, failing, () => 'T');
  assert.deepEqual(two.rows.map((r) => r.venue), ['polymarket']);
  assert.match(two.note.errors[0], /^kalshi: HTTP 503/);
});
