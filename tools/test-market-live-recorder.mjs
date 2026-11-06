// tools/market-live-recorder.mjs — the per-minute Kalshi / Polymarket reads (founder 2026-11-06).
// Checks, on the venues' real answer shapes (Shelton v Paul, 6 Nov 2026): the targets are exactly the pipeline's
// one-to-one joins; Kalshi liquidity = kalshi-volume.mjs's bookDollars over both books (the figure kalshi.json carries),
// one unreadable book = no figure (never half); per-player bid / ask / mid, an out-of-range price dashed; Polymarket
// = the match-winner market's liquidityNum, the second player's bid / ask mirrored from the first's, a closed market
// not sent; a finished Kalshi match (not in the open list) is not read; one venue failing never stops the other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetsFrom, kalshiEvents, kalshiRow, polyRow, readMinute, kalshiFlow, polyFlow, FLOW_MAX_PAGES } from './market-live-recorder.mjs';

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
test('stops (never starts): Polymarket live stops both venues; 3 h past the scheduled start stops; Kalshi pages followed', async () => {
  const NOW = '2026-11-06T18:00:00Z';
  const mk2 = (t, who, occ) => ({ ...mk(t, who, 0.4, 0.41), occurrence_datetime: occ });
  const live = { ...GEV(), live: true };
  let pages = 0;
  const get = (polyEv, occ) => async (u) => {
    if (u.includes('/markets?series_ticker')) {
      pages++;
      return u.includes('cursor=c2') ? { markets: [mk2('SHE', 'Ben Shelton', occ), mk2('PAU', 'Tommy Paul', occ)], cursor: '' } : { markets: [], cursor: 'c2' };
    }
    if (u.includes('/orderbook')) return BOOK([['0.5', '2']], []);
    if (u.includes('gamma-api')) return [polyEv];
    throw new Error('unexpected ' + u);
  };
  const t = targetsFrom(KAL, POLY);
  let r = await readMinute(t, get(live, '2026-11-06T17:00:00Z'), () => NOW);
  assert.deepEqual(r.rows, [], 'Polymarket says live: neither venue written');
  pages = 0;
  r = await readMinute(t, get(GEV(), '2026-11-06T14:30:00Z'), () => NOW);
  assert.deepEqual(r.rows.map((x) => x.venue), ['polymarket'], 'Kalshi 3.5 h past its scheduled start: stopped');
  assert.equal(r.note.stopped, 1);
  assert.equal(pages, 2, 'the Kalshi cursor is followed (the match is on page 2)');
  r = await readMinute(t, get(GEV(), '2026-11-06T16:00:00Z'), () => NOW);
  assert.deepEqual(r.rows.map((x) => x.venue).sort(), ['kalshi', 'polymarket'], '2 h past: a late start keeps being read');
  const late = GEV(); late.markets[1].gameStartTime = '2026-11-06 14:00:00+00';
  r = await readMinute(t, get(late, '2026-11-06T16:00:00Z'), () => NOW);
  assert.deepEqual(r.rows.map((x) => x.venue), ['kalshi'], 'Polymarket 4 h past its own scheduled start: stopped');
});

test('traded money: Kalshi by taker side, Polymarket by BUY / SELL; a history past the page cap is no sum', async () => {
  const pair = kalshiEvents([mk('SHE', 'Ben Shelton', 0.45, 0.46), mk('PAU', 'Tommy Paul', 0.54, 0.55)]).get('KXATPMATCH-26NOV06SHEPAU');
  const kt = { 'PAU': [{ count_fp: '10', taker_side: 'yes', yes_price_dollars: '0.54', no_price_dollars: '0.46' }, { count_fp: '4', taker_side: 'no', yes_price_dollars: '0.55', no_price_dollars: '0.45' }],
    'SHE': [{ count_fp: '2', taker_side: 'yes', yes_price_dollars: '0.45', no_price_dollars: '0.55' }, { count_fp: '9', taker_side: 'maybe' }] };
  const kget = async (u) => ({ trades: kt[u.match(/ticker=[A-Z0-9-]+-([A-Z]+)&/)[1]], cursor: '' });
  const k = await kalshiFlow(pair, kget, 'T');
  assert.deepEqual(k, { byName: { 'Tommy Paul': 5.4, 'Ben Shelton': 1.8 + 0.9 }, trades: 3, at: 'T' }, 'taker no on Paul = money on Shelton; an unknown side is skipped');
  const endless = async () => ({ trades: [{ count_fp: '1', taker_side: 'yes', yes_price_dollars: '0.5', no_price_dollars: '0.5' }], cursor: 'more' });
  assert.equal(await kalshiFlow(pair, endless, 'T'), null, 'never a partial total');
  const mkt = GEV().markets[1]; mkt.conditionId = '0xC';
  let calls = 0;
  const pget = async (u) => { calls++; assert.match(u, /data-api\.polymarket\.com\/v2\/trades\?condition=0xC/);
    return u.includes('cursor=') ? { data: [{ outcome: 'Tommy Paul', side: 'SELL', size: 10, price: 0.5 }], pagination: { has_more: false } }
      : { data: [{ outcome: 'Ben Shelton', side: 'BUY', size: 100, price: 0.45 }, { outcome: 'Nobody', side: 'BUY', size: 1, price: 1 }], pagination: { has_more: true, next_cursor: 'n2' } }; };
  assert.deepEqual(await polyFlow(mkt, pget, 'T'), { byName: { 'Ben Shelton': 50, 'Tommy Paul': 0 }, trades: 2, at: 'T' }, 'SELL Paul = money on Shelton; pages followed');
  assert.equal(calls, 2);
  assert.equal(await polyFlow(mkt, async () => ({ data: [], pagination: { has_more: true, next_cursor: 'x' } }), 'T'), null);
  assert.equal(FLOW_MAX_PAGES, 20);
});
test('one minute with opts.flow attaches the sums; without it, none', async () => {
  const get = async (u) => {
    if (u.includes('/markets?series_ticker')) return { markets: [mk('SHE', 'Ben Shelton', 0.45, 0.46), mk('PAU', 'Tommy Paul', 0.54, 0.55)] };
    if (u.includes('/orderbook')) return BOOK([['0.5', '2']], []);
    if (u.includes('/markets/trades')) return { trades: [], cursor: '' };
    if (u.includes('gamma-api')) { const e = GEV(); e.markets[1].conditionId = '0xC'; return [e]; }
    if (u.includes('data-api')) return { data: [], pagination: { has_more: false } };
    throw new Error('unexpected ' + u);
  };
  const t = targetsFrom(KAL, POLY);
  const a = await readMinute(t, get, () => 'T', { flow: true });
  assert.deepEqual(a.rows.map((r) => r.flow && r.flow.trades), [0, 0]);
  const b = await readMinute(t, get, () => 'T');
  assert.ok(b.rows.every((r) => !('flow' in r)));
});
