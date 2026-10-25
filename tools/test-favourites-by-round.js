// Round 2 item 2.2 — build-favourites-by-round.js. Every check drives the REAL builder on a fixture master in the
// database-yield-master.json shape, and names the mutation that turns it red.
// Run: node tools/test-favourites-by-round.js
'use strict';
const assert = require('assert');
const B = require('../build-favourites-by-round.js');

let pass = 0, fail = 0;
const check = (n, f) => { try { f(); pass++; console.log('  ok   ' + n); } catch (e) { fail++; console.log('  FAIL ' + n + ' :: ' + e.message); } };
const COLS = ['date', 'tournament', 'series', 'surface', 'court', 'round', 'bestof', 'winner', 'loser', 'comment', 'pw', 'pl', 'book', 'set', 'flags', 'wrank', 'lrank'];
// r(date, tournament, round, pw (winner's price), pl, opts)
const r = (date, t, round, pw, pl, o = {}) => [date, t, o.series || 'ATP250', o.surface || 'Hard', o.court || 'Indoor', round, o.bestof || '3', 'W', 'L',
  o.comment || 'Completed', pw, pl, o.book == null ? 0 : o.book, o.set || 'db', '', '', ''];
const master = rows => ({ meta: { cols: COLS }, rows });
const build = (rows, progression) => B.buildFavouritesByRound({ master: master(rows), csvRows: [], progression: progression || null, now: '2026-10-25T00:00:00Z' });
const lastRow = rs => rs[rs.length - 1];

// Mutation: favourite = the WINNER (or the longer price) → counts flip → red.
check('favourite = the shorter Pinnacle close; cumulative R1 → R1–QF rows carry matches / fav / dog', () => {
  const out = build([r('2025-10-14', 'Almaty Open', '1st Round', 1.5, 2.6), r('2025-10-14', 'Almaty Open', '1st Round', 2.4, 1.6),
    r('2025-10-16', 'Almaty Open', '2nd Round', 1.3, 3.5), r('2025-10-17', 'Almaty Open', 'Quarterfinals', 1.8, 2.0)]);
  const p = out.events.Almaty.past;
  assert.deepStrictEqual(p.rows.map(x => [x.label, x.n, x.fav, x.dog]), [['R1', 2, 1, 1], ['R1–R2', 3, 2, 1], ['R1–QF', 4, 3, 1]]);
  assert.deepStrictEqual(p.years, [2025]);
});
// Mutation: drop retirements (the old rows-only rule) → the ret row leaves n → red.
check('winner = matchWinner: a retirement counts on the official result (and is counted as such)', () => {
  const out = build([r('2025-10-14', 'Almaty Open', '1st Round', 3.0, 1.4, { comment: 'Retired', set: 'ret' })]);
  const x = lastRow(out.events.Almaty.past.rows);
  assert.deepStrictEqual([x.n, x.dog, x.retirements], [1, 1, 1]);
});
// Mutation: treat a snapshot as a close, or a tie as a favourite win → red.
check('a snapshot (Pinnacle approx.) is "no Pinnacle close"; an exact tie is a dash, counted; Bet365 close is used and marked B', () => {
  const out = build([r('2025-10-14', 'Almaty Open', '1st Round', 1.5, 2.6, { book: 5 }), r('2025-10-14', 'Almaty Open', '1st Round', 1.9, 1.9, { set: 'tie' }),
    r('2025-10-15', 'Almaty Open', '1st Round', 1.5, 2.6, { book: 1 })]);
  const x = lastRow(out.events.Almaty.past.rows);
  assert.deepStrictEqual([x.n, x.fav, x.noClose, x.ties, x.b365], [1, 1, 1, 1, 1]);
});
// Mutation: Brussels pooled by name alone (no ROW_SPLIT year rule) → Antwerp 2024 counts for Brussels → red.
check('lineage = same venue: Brussels = European Open October 2025+ only (never Antwerp ≤2024, never Hamburg July)', () => {
  const out = build([r('2024-10-15', 'European Open', '1st Round', 1.5, 2.6), r('2024-07-15', 'European Open', '1st Round', 1.5, 2.6, { surface: 'Clay' }),
    r('2025-10-15', 'European Open', '1st Round', 1.5, 2.6)]);
  assert.deepStrictEqual(out.events.Brussels.past.years, [2025]); assert.strictEqual(lastRow(out.events.Brussels.past.rows).n, 1);
});
// Mutation: map Lyon (France) to the clay 'Lyon Open' lineage → a past edition appears → red.
check('Lyon (France) is a new event: no past edition (null → dash), even with clay Lyon Open rows in the master', () => {
  const out = build([r('2024-05-20', 'Lyon Open', '1st Round', 1.5, 2.6, { surface: 'Clay', court: 'Outdoor' }), r('2026-10-20', 'Lyon (France)', '1st Round', 1.5, 2.6)]);
  assert.strictEqual(out.events['Lyon (France)'].past, null);
  assert.strictEqual(lastRow(out.events['Lyon (France)'].current.rows).n, 1);
});
// Mutation: baseline keeps Slams / best-of-five / the Finals, or ignores the court → red.
check('tour baseline = best-of-three, Slams and the Finals out, hard, split indoor / outdoor, 2016–2025', () => {
  const out = build([r('2020-03-10', 'X', '1st Round', 1.5, 2.6, { court: 'Outdoor' }), r('2020-03-10', 'Y', '1st Round', 1.5, 2.6),
    r('2020-01-20', 'Australian Open', '1st Round', 1.5, 2.6, { series: 'Grand Slam', bestof: '5', court: 'Outdoor' }),
    r('2020-11-20', 'Masters Cup', '1st Round', 1.5, 2.6, { series: 'Masters Cup' }), r('2015-03-10', 'Z', '1st Round', 1.5, 2.6)]);
  assert.strictEqual(lastRow(out.baseline.Indoor.rows).n, 1); assert.strictEqual(lastRow(out.baseline.Outdoor.rows).n, 1);
});
check('the floor travels in the output (15) and the current season reads the walkovers from progression', () => {
  const out = build([r('2026-10-20', 'Almaty Open', '1st Round', 1.5, 2.6)], { tournaments: { Almaty: { matches: [{ status: 'walkover' }, { status: 'finished' }] } } });
  assert.strictEqual(out.floor, 15); assert.strictEqual(out.events.Almaty.current.walkovers, 1);
});

console.log(`\nfavourites-by-round: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
