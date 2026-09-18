// tools/test-perset-scores.js — TEN-206 item 1 (per-set scores).
//
// career-history carried a set COUNT ("2 - 1") and nothing else: the per-set
// games were parsed and thrown away one line before the row was written, on both
// halves of the store. Recovering them costs no API call — the api-tennis
// fixture already carries `scores`, and the TML CSV already carries the
// scoreline — but the recovery is only worth anything if it is oriented to the
// subject player, and an orientation bug is invisible on inspection: a flipped
// row still looks like a plausible scoreline.
//
// So the load-bearing assertion here is the RECONCILIATION one: the set tally
// re-derived from the per-set games must equal the set count the row already
// published. That is what catches a flip applied to the wrong side.
//
// Run: node tools/test-perset-scores.js
const assert = require('assert');
const { _internal } = require('../career-backfill.js');
const { parseSetScores, flipSetScores, scoreDisplay } = _internal;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log(`  PASS  ${name}`); }
  catch (e) { fail++; console.log(`  FAIL  ${name} :: ${e.message}`); }
}

console.log('TEN-206 item 1 · per-set scores survive into career-history');

console.log('\n── the scoreline is parsed, not counted ──');

t('a straight-sets win keeps its games', () => {
  assert.deepStrictEqual(parseSetScores('6-3 7-5 6-3'),
    [{ p: 6, o: 3 }, { p: 7, o: 5 }, { p: 6, o: 3 }]);
});

t('tiebreak points are carried as the source prints them — one number, the loser of the breaker', () => {
  assert.deepStrictEqual(parseSetScores('6-4 7-6(4) 6-3'),
    [{ p: 6, o: 4 }, { p: 7, o: 6, tbLo: 4 }, { p: 6, o: 3 }]);
});

t('the breaker WINNER\'s points are never invented — only tbLo exists', () => {
  const s = parseSetScores('7-6(4)')[0];
  assert.strictEqual(s.tbLo, 4);
  assert.ok(!('pTb' in s) && !('oTb' in s),
    'expanding "(4)" into a 7-4 pair would put a number on the page the source never recorded');
});

t('a RET token is skipped, the games played before it are kept', () => {
  assert.deepStrictEqual(parseSetScores('6-4 4-1 RET'), [{ p: 6, o: 4 }, { p: 4, o: 1 }]);
});

t('a walkover yields null, never an empty list', () => {
  assert.strictEqual(parseSetScores('W/O'), null);
  assert.strictEqual(parseSetScores(''), null);
  assert.strictEqual(parseSetScores(null), null);
});

t('a 0-0 pseudo-set is dropped, matching the api-tennis path', () => {
  assert.deepStrictEqual(parseSetScores('6-4 0-0'), [{ p: 6, o: 4 }]);
});

console.log('\n── orientation: the loser\'s row is the winner\'s row, flipped ──');

t('flip swaps the games', () => {
  assert.deepStrictEqual(flipSetScores([{ p: 6, o: 3 }, { p: 7, o: 5 }]),
    [{ p: 3, o: 6 }, { p: 5, o: 7 }]);
});

t('tbLo crosses over unchanged — it names the same side from either end', () => {
  assert.deepStrictEqual(flipSetScores([{ p: 7, o: 6, tbLo: 4 }]), [{ p: 6, o: 7, tbLo: 4 }]);
});

t('flipping twice is the identity', () => {
  const orig = parseSetScores('6-4 6-7(5) 7-6(2)');
  assert.deepStrictEqual(flipSetScores(flipSetScores(orig)), orig);
});

t('THE LOAD-BEARING CHECK: the tally re-derived from the games equals the published set count, on BOTH sides', () => {
  const lines = ['6-3 7-5 6-3', '4-6 7-6(3) 6-2', '6-7(3) 7-6(10) 7-5', '6-4 4-1 RET', '7-5 6-7(4) 6-4 3-6 6-2'];
  for (const line of lines) {
    for (const playerWon of [true, false]) {
      const sets = playerWon ? parseSetScores(line) : flipSetScores(parseSetScores(line));
      let p = 0, o = 0;
      for (const s of sets) { if (s.p > s.o) p++; else if (s.o > s.p) o++; }
      // scoreDisplay renders "oppSets - playerSets".
      assert.strictEqual(`${o} - ${p}`, scoreDisplay(line, playerWon),
        `"${line}" (playerWon=${playerWon}) re-derives ${o} - ${p}`);
    }
  }
});

t('NEGATIVE CONTROL: skipping the flip breaks that check, so it is not vacuous', () => {
  const line = '6-3 7-5 6-3';
  const unflipped = parseSetScores(line);           // the loser's row, left in the winner's orientation
  let p = 0, o = 0;
  for (const s of unflipped) { if (s.p > s.o) p++; else if (s.o > s.p) o++; }
  assert.notStrictEqual(`${o} - ${p}`, scoreDisplay(line, false),
    'an unflipped loser row must NOT reconcile — if it does, the check proves nothing');
});

console.log('\n── the renderer prints both encodings ──');

// setText is the renderer's per-set formatter. Restated here rather than
// imported: player-profile-v2.js is a browser IIFE with no CommonJS export, and
// the contract under test is the two-encoding fallback, which is small enough to
// mirror exactly. Kept byte-aligned with player-profile-v2.js's setText.
function setText(s) {
  var base = s.p + '-' + s.o;
  if (s.pTb == null || s.oTb == null) {
    if (s.tbLo == null) return base;
    var lt = Number(s.tbLo);
    return isFinite(lt) ? base + '(' + lt + ')' : base;
  }
  var lo = Math.min(Number(s.pTb), Number(s.oTb));
  if (!isFinite(lo)) return base;
  return base + '(' + lo + ')';
}

t('an api-tennis set (pTb/oTb pair) renders the loser\'s points', () => {
  assert.strictEqual(setText({ p: 7, o: 6, pTb: 7, oTb: 4 }), '7-6(4)');
  assert.strictEqual(setText({ p: 6, o: 7, pTb: 3, oTb: 7 }), '6-7(3)');
});

t('an archive set (tbLo) renders identically — same string, different source', () => {
  assert.strictEqual(setText({ p: 7, o: 6, tbLo: 4 }), '7-6(4)');
  assert.strictEqual(setText({ p: 6, o: 7, tbLo: 3 }), '6-7(3)');
});

t('a set with no breaker points prints the games alone, never a guessed "(0)"', () => {
  assert.strictEqual(setText({ p: 7, o: 6 }), '7-6');
});

console.log(`\n================================================================`);
console.log(`PASS ${pass}   FAIL ${fail}`);
if (fail) process.exit(1);
