#!/usr/bin/env node
'use strict';
// BUILD ITEM 3 · the eight point-by-point Situational rows.
//
// These checks drive foldMatch() with a HAND-BUILT match whose every row value
// was worked out on paper first and is asserted exactly — if the walk is wrong,
// the numbers disagree with the paper.
//
// The fixture uses the feed's REAL labels. The first run of this builder against
// the live cache folded 0 matches out of ~3,300 while still bucketing 668
// players, because api-tennis writes set_number as "Set 1" and the parser read
// it as a bare integer: NaN, so every game was skipped. A fixture written to the
// doc comment rather than to the data would have stayed green through that.
//
// THE FIXTURE (A = First Player, B = Second Player), written as (server, winner):
//
//   SET 1   1.(A,A) 2.(B,A) 3.(A,A) 4.(B,B) 5.(A,A) 6.(B,B) 7.(A,A) 8.(B,B) 9.(A,A)
//           A wins it 6-3. A breaks in game 2 and B never breaks back.
//   SET 2   1.(B,B) 2.(A,B) 3.(B,B) 4.(A,A) 5.(B,B) 6.(A,A) 7.(B,B) 8.(A,A) 9.(B,B)
//           B wins it 6-3. B breaks in game 2 and A never breaks back.
//
// Worked out by hand from those two sets:
//   A  brokenFirstSvc 0-1   firstBreak 1-0   brokenBack 0-1   breakBack 0-1
//      lostS1FirstBreakS2 0-0   holdWinSet 1-0   holdStaySet 0-0   breakOppServing 0-1
//   B  brokenFirstSvc 1-0   firstBreak 0-1   brokenBack 0-1   breakBack 0-1
//      lostS1FirstBreakS2 1-0   holdWinSet 1-0   holdStaySet 0-0   breakOppServing 0-1

const assert = require('assert');
const B = require('../build-situational.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
}

const A_ = 'First Player', B_ = 'Second Player';

function games(set, pairs) {
  return pairs.map(([server, winner], i) => ({
    set_number: 'Set ' + set, number_game: String(i + 1),
    player_served: server, serve_winner: winner,
    serve_lost: server === winner ? (server === A_ ? B_ : A_) : server,
    points: [],
  }));
}

const SET1 = games(1, [[A_, A_], [B_, A_], [A_, A_], [B_, B_], [A_, A_], [B_, B_], [A_, A_], [B_, B_], [A_, A_]]);
const SET2 = games(2, [[B_, B_], [A_, B_], [B_, B_], [A_, A_], [B_, B_], [A_, A_], [B_, B_], [A_, A_], [B_, B_]]);
const MATCH = SET1.concat(SET2);

// A wins set 1 6-3, B wins set 2 6-3 — the same result the game sequence spells
// out, passed the way the feed passes it.
const SCORES = [
  { score_set: '1', score_first: '6', score_second: '3' },
  { score_set: '2', score_first: '3', score_second: '6' },
];

function fold(pbp, scores) {
  const rows = { [A_]: B.emptyRows(), [B_]: B.emptyRows() };
  const used = B.foldMatch(pbp, rows, scores === undefined ? SCORES : scores);
  return { rows, used };
}

const EXPECT = {
  [A_]: {
    brokenFirstSvc: [0, 1], firstBreak: [1, 0], brokenBack: [0, 1], breakBack: [0, 1],
    lostS1FirstBreakS2: [0, 0], holdWinSet: [1, 0], holdStaySet: [0, 0], breakOppServing: [0, 1],
  },
  [B_]: {
    brokenFirstSvc: [1, 0], firstBreak: [0, 1], brokenBack: [0, 1], breakBack: [0, 1],
    lostS1FirstBreakS2: [1, 0], holdWinSet: [1, 0], holdStaySet: [0, 0], breakOppServing: [0, 1],
  },
};

console.log('\nsituational pbp fold (build item 3)\n');

check('every row matches the hand-computed fixture, exactly', () => {
  const { rows, used } = fold(MATCH);
  assert.strictEqual(used, true, 'the fixture produced no usable game');
  const got = [], want = [];
  for (const side of [A_, B_]) {
    for (const id of B.ROW_IDS) {
      got.push(`${side[0]}.${id} ${rows[side][id].w}-${rows[side][id].l}`);
      want.push(`${side[0]}.${id} ${EXPECT[side][id][0]}-${EXPECT[side][id][1]}`);
    }
  }
  assert.deepStrictEqual(got, want);
});

check('the walk does not depend on cache order (shuffled input, same counts)', () => {
  const base = fold(MATCH).rows;
  for (let seed = 1; seed <= 6; seed++) {
    const rot = MATCH.slice(seed).concat(MATCH.slice(0, seed));
    const shuffled = seed % 2 ? rot.slice().reverse() : rot;
    assert.deepStrictEqual(fold(shuffled).rows, base, `order ${seed} changed the counts`);
  }
});

// ── the set-situation predicates, stated as a truth table ──────────────────
check('holding wins the set at 5-3, 5-4 and 6-5 and nowhere else', () => {
  const yes = [[5, 3], [5, 4], [6, 5]];
  for (const [m, t] of yes) assert.ok(B.holdWinsSet(m, t), `${m}-${t} should win the set`);
  // 5-5 holding gives 6-5, 6-6 goes to a tiebreak, 4-3 is nowhere near it.
  for (const [m, t] of [[5, 5], [6, 6], [4, 3], [5, 2], [3, 5], [6, 4], [0, 0]]) {
    assert.ok(!B.holdWinsSet(m, t), `${m}-${t} should NOT win the set`);
  }
});

check('losing the game loses the set at 3-5, 4-5 and 5-6 and nowhere else', () => {
  for (const [m, t] of [[3, 5], [4, 5], [5, 6]]) {
    assert.ok(B.lossEndsSet(m, t), `${m}-${t} should be serving to stay in`);
  }
  for (const [m, t] of [[5, 5], [6, 6], [2, 5], [5, 3], [4, 6], [0, 0]]) {
    assert.ok(!B.lossEndsSet(m, t), `${m}-${t} should NOT be serving to stay in`);
  }
});

// ── a set that ENDS on an unanswered break must still settle ────────────────
// This is the bug the rollover exists for: settling only at the end of the match
// drops every set but the last out of the breakBack denominator.
check('a break left unanswered at the end of a NON-final set still counts as a loss', () => {
  const twoSets = games(1, [[A_, A_], [B_, A_], [A_, A_], [B_, B_], [A_, A_], [B_, B_], [A_, A_], [B_, B_], [A_, A_]])
    .concat(games(2, [[B_, B_], [A_, A_], [B_, B_], [A_, A_], [B_, B_], [A_, A_], [B_, B_], [A_, A_], [B_, B_], [A_, A_], [B_, B_], [A_, A_]]));
  const { rows } = fold(twoSets);
  // B was broken in set 1 and never broke back; set 2 has no break at all.
  assert.deepStrictEqual(
    { w: rows[B_].breakBack.w, l: rows[B_].breakBack.l }, { w: 0, l: 1 },
    'the set-1 break was not settled at the set rollover');
});

// The regression guard for that exact bug.
check('the feed\'s "Set N" label parses, and a tiebreak row is dropped', () => {
  const real = games(1, [[A_, A_], [B_, B_]]);
  assert.strictEqual(fold(real).used, true, '"Set 1" did not parse — every game would be skipped');
  const tb = [{ set_number: 'Set 1 TieBreak', number_game: '1', player_served: A_, serve_winner: A_, points: [] }];
  assert.strictEqual(fold(tb).used, false,
    'a tiebreak mini-serve row was counted as a service game');
});

check('a match with no usable game returns false and counts nothing', () => {
  const junk = [{ set_number: 'Set 9', number_game: '1', player_served: 'nobody', serve_winner: 'nobody' }];
  const { rows, used } = fold(junk);
  assert.strictEqual(used, false, 'an unusable match must not be counted');
  for (const side of [A_, B_]) {
    for (const id of B.ROW_IDS) {
      assert.strictEqual(rows[side][id].w + rows[side][id].l, 0, `${side} ${id} counted a junk game`);
    }
  }
});

console.log(`\nsituational fold: ${pass} pass, ${fail} fail`);
if (fail) { console.error(`FAILED: ${fail} check(s)`); process.exit(1); }
