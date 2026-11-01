// tools/polymarket-volume.mjs — the Polymarket per-match totals for the Market Signal panel and the 🔵 drop alerts.
// Fixtures are the shape Polymarket's Gamma API answered on 1 Nov 2026 (atp-tirante-bellucc-2026-11-01, $1,851 traded;
// atp-halys-fery-2026-11-02). Checks: the match-winner market is read and set / "Completed Match" markets are not; the
// name keys equal the SQL scope's; a card joins only one-to-one (two Polymarket matches that fit, or two cards, = none);
// a start 3 days off, another initial, or a doubles card never joins; the event key comes from the card id.
// MUTANTS: a surname-only join takes the wrong brother; dropping the one-to-one rule joins an ambiguous card.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { sk, inits, same, polyMatches, joinBoard, eventKeyOf, cardStartMs } from './polymarket-volume.mjs';
const { berlinWallMs } = createRequire(import.meta.url)('../berlin-time.js');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  PASS ', name); };

const ev = (slug, title, a, b, extra = {}) => ({ slug, title, volume: extra.volume ?? 1000, liquidity: 5000, closed: false, markets: [
  { question: 'Set 1 Winner: ' + title.split(': ').pop(), outcomes: JSON.stringify([a, b]), volumeNum: 1 },
  { question: title.replace(': ', ': Completed Match: '), outcomes: '["Yes", "No"]', volumeNum: 2 },
  { question: title, outcomes: JSON.stringify([a, b]), volumeNum: extra.ml ?? 900, liquidityNum: extra.liq ?? 3000, gameStartTime: extra.gst },
] });
const E = [
  ev('atp-tirante-bellucc-2026-11-01', 'Rolex Paris Masters, Qualification: Thiago Agustin Tirante vs Mattia Bellucci', 'Thiago Agustin Tirante', 'Mattia Bellucci', { volume: 1851.213744, ml: 1700.5, liq: 22090.2256 }),
  ev('atp-halys-fery-2026-11-02', 'Rolex Paris Masters: Quentin Halys vs Arthur Fery', 'Quentin Halys', 'Arthur Fery', { volume: 135.562078, gst: '2026-11-02 10:00:00+00' }),
  ev('atp-zverev-cerundo-2026-11-02', 'Rolex Paris Masters: Alexander Zverev vs Francisco Cerundolo', 'Alexander Zverev', 'Francisco Cerundolo'),
  ev('atp-twin-a-2026-11-02', 'Rolex Paris Masters: Mark Twin vs Ned Pair', 'Mark Twin', 'Ned Pair'),
  ev('atp-twin-b-2026-11-02', 'Rolex Paris Masters: Mark Twin vs Ned Pair', 'Mark Twin', 'Ned Pair'),
  { slug: 'will-novak-djokovic-retire', title: 'Will Novak Djokovic announce his retirement?', markets: [] },
];
const card = (id, p1, p2, date, time) => ({ id, p1, p2, date, time });
const board = [
  card('past-12166001', 'T. A. Tirante', 'M. Bellucci', '2026-11-01', '11:00'),
  card('upcoming-12176002', 'A. Fery', 'Q. Halys', '2026-11-02', '11:00'),
  card('upcoming-12176003', 'M. Zverev', 'F. Cerundolo', '2026-11-02', '13:00'),       // the brother: never Alexander
  card('upcoming-12176004', 'M. Twin', 'N. Pair', '2026-11-02', '12:00'),             // two Polymarket matches fit
  card('upcoming-12176005', 'Q. Halys', 'A. Fery', '2026-11-05', '11:00'),            // 3 days off
];
const startOf = (m) => cardStartMs(m, berlinWallMs);

ok('name keys = the SQL scope (sk / initials / same)', () => {
  assert.equal(sk('Damm Jr, Martin'), 'damm'); assert.equal(sk('P. Carreno-Busta'), 'busta'); assert.equal(sk('J. Lehečka'), 'lehecka');
  assert.deepEqual(inits('Adolfo Daniel Vallejo').sort(), ['a', 'd']);
  assert.equal(same('Adolfo Daniel Vallejo', 'D. Vallejo'), true);
  assert.equal(same('Alexander Zverev', 'M. Zverev'), false);
});
const P = polyMatches(E);
ok('one Polymarket match per ATP event, read from the match-winner market (not set / Completed Match / futures)', () => {
  assert.equal(P.length, 5);
  const t = P.find((p) => p.slug === 'atp-tirante-bellucc-2026-11-01');
  assert.deepEqual([t.a, t.b, t.volume, t.volumeMl], ['Thiago Agustin Tirante', 'Mattia Bellucci', 1851.213744, 1700.5]);
  assert.equal(new Date(P.find((p) => p.slug === 'atp-halys-fery-2026-11-02').startMs).toISOString(), '2026-11-02T10:00:00.000Z');
});
const J = joinBoard(board, P, startOf);
ok('Tirante v Bellucci joins its card (event key from the card id), with Polymarket\'s total', () => {
  assert.deepEqual(J.byEvent['12166001'], { slug: 'atp-tirante-bellucc-2026-11-01', volume: 1851.213744, volumeMl: 1700.5, liquidity: 22090.2256 },
    'liquidity = the match-winner market\'s book ($22,090), never the event\'s all-markets $5,000');
});
ok('players in the other order still join', () => assert.equal(J.byEvent['12176002'].slug, 'atp-halys-fery-2026-11-02'));
ok('another initial (M. Zverev v Alexander Zverev) never joins', () => assert.equal(J.byEvent['12176003'], undefined));
ok('two Polymarket matches fit one card → none, counted ambiguous', () => { assert.equal(J.byEvent['12176004'], undefined); assert.equal(J.ambiguous >= 1, true); });
ok('a card 3 days off the Polymarket start → no join', () => assert.equal(J.byEvent['12176005'], undefined));
ok('event key: prefixed and bare ids', () => { assert.equal(eventKeyOf({ id: 'upcoming-123' }), '123'); assert.equal(eventKeyOf({ id: 'abc' }), 'abc'); });
ok('two cards fit one Polymarket match → none', () => {
  const two = [card('upcoming-1', 'Q. Halys', 'A. Fery', '2026-11-02', '11:00'), card('upcoming-2', 'Quentin Halys', 'Arthur Fery', '2026-11-02', '12:00')];
  assert.deepEqual(joinBoard(two, P, startOf).byEvent, {});
});
// MUTANTS — each must change an answer the tests above pin
ok('MUTANT surname-only join takes the wrong Zverev', () => {
  const loose = (b, p) => ({ ...joinBoard(b.map((m) => ({ ...m, p1: m.p1.replace(/^.*\s/, ''), p2: m.p2.replace(/^.*\s/, '') })), p, startOf) });
  assert.equal(!!loose(board, P).byEvent['12176003'], true, 'without initials the brother would join');
});
ok('MUTANT without one-to-one the ambiguous card joins', () => {
  const firstOnly = joinBoard(board, P.filter((p) => p.slug !== 'atp-twin-b-2026-11-02'), startOf);
  assert.equal(!!firstOnly.byEvent['12176004'], true, 'with one candidate it joins, so the ambiguity rule is what holds it');
});
console.log(`test-polymarket-volume: ${n} passed`);
