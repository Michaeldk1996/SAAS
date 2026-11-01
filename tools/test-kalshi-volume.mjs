// tools/kalshi-volume.mjs — Kalshi's per-match totals for the cards and the 🟣 alerts. Fixtures = the shape Kalshi's
// public API answered on 1 Nov 2026 (KXATPMATCH-26NOV01VALSON: Vallejo 0.41 ask / 816 contracts, volume 5,590.03).
// Checks: two markets make one match (players from yes_sub_title, contracts summed); an event with one market is not a
// match; the whole book = Σ price × contracts over both sides' bids, a broken level makes it unreadable (null, never a
// partial sum); the board join is the Polymarket one (one-to-one, initials, start window). MUTANT: summing only the
// yes side changes the figure the test pins.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { kalshiMatches, bookDollars } from './kalshi-volume.mjs';
import { joinBoard, cardStartMs } from './polymarket-volume.mjs';
const { berlinWallMs } = createRequire(import.meta.url)('../berlin-time.js');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  PASS ', name); };

const mk = (ticker, ev, who, vol, extra = {}) => ({ ticker, event_ticker: ev, yes_sub_title: who, volume_fp: vol, status: 'active',
  occurrence_datetime: '2026-11-01T12:00:00Z', yes_ask_dollars: '0.4100', yes_ask_size_fp: '816.00', ...extra });
const M = [
  mk('KXATPMATCH-26NOV01VALSON-VAL', 'KXATPMATCH-26NOV01VALSON', 'Adolfo Daniel Vallejo', '5590.03'),
  mk('KXATPMATCH-26NOV01VALSON-SON', 'KXATPMATCH-26NOV01VALSON', 'Lorenzo Sonego', '4100.00'),
  mk('KXATPMATCH-26NOV01ZVEZVE-ZVE', 'KXATPMATCH-26NOV01ZVEZVE', 'Alexander Zverev', '10'),     // one market only
];
const K = kalshiMatches(M);
ok('two markets = one match: both players, contracts summed', () => {
  assert.equal(K.length, 1);
  assert.deepEqual([K[0].slug, K[0].a, K[0].b, K[0].volume, K[0].open], ['KXATPMATCH-26NOV01VALSON', 'Lorenzo Sonego', 'Adolfo Daniel Vallejo', 9690.03, true]);
  assert.equal(new Date(K[0].startMs).toISOString(), '2026-11-01T12:00:00.000Z');
});
ok('a missing volume on either market → no traded figure (never a partial sum)', () => {
  assert.equal(kalshiMatches([M[0], { ...M[1], volume_fp: '' }])[0].volume, null);
});
const OB = { orderbook_fp: { yes_dollars: [['0.4000', '1825.11'], ['0.0100', '42631.00']], no_dollars: [['0.5900', '816.00'], ['0.0100', '43202.30']] } };
ok('whole book = Σ price × contracts over both sides', () => assert.equal(bookDollars(OB), Math.round((0.4 * 1825.11 + 0.01 * 42631 + 0.59 * 816 + 0.01 * 43202.3) * 100) / 100));
ok('an unreadable level → null, never a partial sum; no book → null', () => {
  assert.equal(bookDollars({ orderbook_fp: { yes_dollars: [['x', '1']], no_dollars: [] } }), null);
  assert.equal(bookDollars({}), null);
});
ok('MUTANT: the yes side alone gives another figure', () => assert.notEqual(bookDollars({ orderbook_fp: { yes_dollars: OB.orderbook_fp.yes_dollars, no_dollars: [] } }), bookDollars(OB)));
ok('the board join (Polymarket rule): D. Vallejo v L. Sonego joins; another initial does not', () => {
  const board = [{ id: 'upcoming-12170001', p1: 'D. Vallejo', p2: 'L. Sonego', date: '2026-11-01', time: '13:00' },
                 { id: 'upcoming-12170002', p1: 'M. Vallejo', p2: 'L. Sonego', date: '2026-11-01', time: '13:00' }];
  const j = joinBoard(board, K.map((m) => ({ ...m, volumeMl: m.volume })), (m) => cardStartMs(m, berlinWallMs)).byEvent;
  assert.equal(j['12170001'].slug, 'KXATPMATCH-26NOV01VALSON');
  assert.equal(j['12170002'], undefined);
});
console.log(`test-kalshi-volume: ${n} passed`);
