// tools/market-live-backfill.mjs — the rebuild rules (founder 2026-11-12, "Yes, backfill"), on fixed venue answers.
// Nothing after the start is ever read; a price point older than the lookback is not used; the traded-money rules are the
// recorder's. Controls: each rule broken on purpose must change the answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kalshiPoint, polyPoint, kalshiFlowOf, polyFlowOf, rebuild, LOOKBACK_S } from './market-live-backfill.mjs';

const LB = 1794425536;   // 2026-11-11T19:32:16Z (Kecmanovic v Rune, our live sighting's lower bound)
const C = (end, bid, ask) => ({ end_period_ts: end, yes_bid: { close_dollars: String(bid) }, yes_ask: { close_dollars: String(ask) } });

test('kalshiPoint: the last candle ending at or before the start, its bid / ask close → mid; never a later candle', () => {
  const p = kalshiPoint([C(LB - 76, 0.69, 0.70), C(LB - 16, 0.70, 0.71), C(LB + 44, 0.80, 0.81)], LB);
  assert.deepEqual(p, { bid: 0.70, ask: 0.71, mid: 0.705, t: LB - 16 });
});
test('kalshiPoint: a candle without a two-sided book is skipped; nothing in the lookback → null', () => {
  assert.equal(kalshiPoint([C(LB - 16, 0, 0.71)], LB), null);
  assert.deepEqual(kalshiPoint([C(LB - 76, 0.69, 0.70), C(LB - 16, 0, 0.71)], LB).t, LB - 76);
  assert.equal(kalshiPoint([C(LB - LOOKBACK_S - 1, 0.5, 0.51)], LB), null, 'older than the lookback is never used');
});
test('polyPoint: the last price at or before the start', () => {
  assert.deepEqual(polyPoint([{ t: LB - 117, p: 0.295 }, { t: LB - 42, p: 0.285 }, { t: LB + 3, p: 0.4 }], LB), { p: 0.285, t: LB - 42 });
  assert.equal(polyPoint([{ t: LB + 3, p: 0.4 }], LB), null);
});
test('kalshiFlowOf: the recorder\'s rule, trades after the start left out', () => {
  const pair = [{ ticker: 'K-KEC', yes_sub_title: 'Miomir Kecmanovic' }, { ticker: 'K-RUN', yes_sub_title: 'Holger Rune' }];
  const at = new Date(LB * 1000).toISOString();
  const f = kalshiFlowOf(pair, {
    'K-RUN': [{ created_time: '2026-11-11T19:32:14Z', taker_side: 'yes', count_fp: '100', yes_price_dollars: '0.71', no_price_dollars: '0.29' },
              { created_time: '2026-11-11T19:31:00Z', taker_side: 'no', count_fp: '10', yes_price_dollars: '0.70', no_price_dollars: '0.30' },
              { created_time: '2026-11-11T19:40:00Z', taker_side: 'yes', count_fp: '999', yes_price_dollars: '0.90', no_price_dollars: '0.10' }],
    'K-KEC': [] }, at);
  assert.deepEqual(f, { byName: { 'Miomir Kecmanovic': 3, 'Holger Rune': 71 }, trades: 2, at });
});
test('polyFlowOf: BUY X = money on X, SELL X = money on the other; after the start left out', () => {
  const at = new Date(LB * 1000).toISOString();
  const f = polyFlowOf(['Miomir Kecmanovic', 'Holger Rune'], [
    { outcome: 'Holger Rune', side: 'BUY', size: 100, price: 0.7, timestamp: LB - 5 },
    { outcome: 'Holger Rune', side: 'SELL', size: 10, price: 0.7, timestamp: LB - 5 },
    { outcome: 'Holger Rune', side: 'BUY', size: 500, price: 0.99, timestamp: LB + 600 }], at);
  assert.deepEqual(f, { byName: { 'Miomir Kecmanovic': 7, 'Holger Rune': 70 }, trades: 2, at });
});
test('rebuild (Kalshi, fixed answers): prices from before the start, read_at = the older point, never a URL past the start', async () => {
  const urls = [];
  const get = async (u) => {
    urls.push(u);
    if (u.includes('/markets?event_ticker=')) return { markets: [{ ticker: 'K-RUN', yes_sub_title: 'Holger Rune' }, { ticker: 'K-KEC', yes_sub_title: 'Miomir Kecmanovic' }] };
    if (u.includes('/candlesticks')) return { candlesticks: u.includes('K-KEC') ? [C(LB - 16, 0.29, 0.30)] : [C(LB - 76, 0.70, 0.71)] };
    return { trades: [], cursor: '' };
  };
  const b = await rebuild({ venue: 'kalshi', ref: 'EV', started_at: '2026-11-11T19:32:16Z' }, get);
  assert.deepEqual(b.outcomes.map((o) => [o.name, o.mid]), [['Miomir Kecmanovic', 0.295], ['Holger Rune', 0.705]]);
  assert.equal(b.read_at, new Date((LB - 76) * 1000).toISOString());
  for (const u of urls.filter((x) => /end_ts=|max_ts=/.test(x))) assert.match(u, new RegExp(`(end_ts|max_ts)=${LB}(&|$)`));
});
test('CONTROL: a lookback rule removed would take a stale price', () => {
  const stale = [C(LB - LOOKBACK_S - 600, 0.5, 0.51)];
  assert.equal(kalshiPoint(stale, LB), null);
  assert.notEqual(kalshiPoint(stale, LB - LOOKBACK_S), null, 'the same candle inside the window is used');
});
