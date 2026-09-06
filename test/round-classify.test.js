'use strict';
/**
 * Regression harness for the "authoritative fields beat heuristics" round-label
 * ruling (founder ruling TEN-157 / TEN-161; CLAUDE.md rulings ledger).
 * Encodes the ruling as the four cases the ledger enumerates, plus edge guards
 * that lock the ruling's boundaries — including that the TEN-89 Slam-qualifying
 * leak detection it grew out of is NOT regressed.
 *
 * Zero dependencies: Node's built-in test runner + assert. Run: `npm test`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyRound,
  isSlamSetCountQualifier,
  roundShort,
} = require('../round-classify');

// --- The four seed cases from the ruling (CLAUDE.md line: "…encodes the ruling
//     as cases…"). These are the acceptance criteria for TEN-160/TEN-157. ---

test('seed 1 — in-play 2-1 snapshot of a main-draw R64 is NOT Q', () => {
  // The exact TEN-157 bug: a US Open second-round win (R64 = 1/32-finals,
  // event_qualification 'False') cached mid-match while the score still lagged
  // at a transient "2 - 1". The 1/N-finals label is authoritative main draw, so
  // the set-count net must not fire, however few sets the snapshot shows.
  const r = classifyRound({
    tournamentRound: '1/32-finals',
    qualification: 'False',
    isGrandSlam: true,
    finalScore: '2 - 1',
    status: 'Finished', // feed had declared a winner while the score lagged
  });
  assert.equal(r.qualifying, false);
  assert.equal(r.code, 'R64');
});

test('seed 2 — settled 3-1 main-draw match resolves to R64', () => {
  const r = classifyRound({
    tournamentRound: '1/32-finals',
    qualification: 'False',
    isGrandSlam: true,
    finalScore: '3 - 1',
    status: 'Finished',
  });
  assert.equal(r.qualifying, false);
  assert.equal(r.code, 'R64');
});

test('seed 3 — a genuine qualifying row (event_qualification === "True") is Q', () => {
  const r = classifyRound({
    tournamentRound: 'Final',       // qualifying bracket's own word label
    qualification: 'True',          // authoritative qualifying signal
    isGrandSlam: true,
    finalScore: '2 - 0',
    status: 'Finished',
  });
  assert.equal(r.qualifying, true);
  assert.equal(r.code, 'Q');
});

test('seed 4 — a Slam retirement at 2 sets stays main draw', () => {
  // A main-draw match that stopped early can legitimately show <3 winner sets;
  // the retirement guard keeps it main draw rather than the net stamping it Q.
  // Deliberately a WORD-form round (not a 1/N-finals label), so the ONLY thing
  // preventing a 'Q' here is the retirement guard — this case exercises exactly
  // the guard it is named for (a fraction label would short-circuit earlier).
  const r = classifyRound({
    tournamentRound: 'Round of 16',
    qualification: 'False',
    isGrandSlam: true,
    finalScore: '2 - 0',
    status: 'Retired',
  });
  assert.equal(r.qualifying, false);
  assert.equal(r.code, 'R16');
});

// --- Edge guards: lock the ruling's boundaries so a future "fix" can't quietly
//     re-open one hole while closing another. ---

test('guard — TEN-89 still works: a word-labelled Slam qualifying leak IS caught', () => {
  // The set-count net's reason for existing. A leaked Slam qualifying row wears
  // a main-draw WORD label ("Semi-finals"), event_qualification is null, and the
  // best-of-three winner took 2 sets. No 1/N-finals label ⇒ the net fires ⇒ Q.
  // A naive "treat every word round as authoritative main draw" change would
  // break this — the test fails loudly if someone tries it.
  const r = classifyRound({
    tournamentRound: 'Semi-finals',
    qualification: null,
    isGrandSlam: true,
    finalScore: '2 - 0',
    status: 'Finished',
  });
  assert.equal(r.qualifying, true);
  assert.equal(r.code, 'Q');
});

test('guard — the set-count net never overrides a 1/N-finals label, even at 2-0', () => {
  const r = classifyRound({
    tournamentRound: '1/8-finals', // R16, certified main draw
    qualification: 'False',
    isGrandSlam: true,
    finalScore: '2 - 0',
    status: 'Finished',
  });
  assert.equal(r.qualifying, false);
  assert.equal(r.code, 'R16');
});

test('guard — the Slam net is Slam-only: a best-of-3 ATP 250 straight-sets win is not Q', () => {
  // Non-Slam main draws are best-of-three, so <3 winner sets is normal there.
  // The net must not fire off-Slam or every ATP 250 R32 win becomes qualifying.
  const r = classifyRound({
    tournamentRound: '1/8-finals', // R16 (1/8-finals = round of 16)
    qualification: 'False',
    isGrandSlam: false,
    finalScore: '2 - 0',
    status: 'Finished',
  });
  assert.equal(r.qualifying, false);
  assert.equal(r.code, 'R16');
});

test('guard — a walkover at a Slam stays main draw (mirrors the retirement guard)', () => {
  const r = classifyRound({
    tournamentRound: 'Quarter-finals',
    qualification: 'False',
    isGrandSlam: true,
    finalScore: '2 - 0',
    status: 'Walk Over',
  });
  assert.equal(r.qualifying, false);
  assert.equal(r.code, 'QF');
});

test('guard — event_qualification "True" wins even over a 1/N-finals label', () => {
  // The flag is the top of the hierarchy: if the feed says qualifying, it is,
  // whatever the round string looks like.
  const r = classifyRound({
    tournamentRound: '1/32-finals',
    qualification: 'True',
    isGrandSlam: true,
    finalScore: '3 - 1',
    status: 'Finished',
  });
  assert.equal(r.qualifying, true);
  assert.equal(r.code, 'Q');
});

// --- Unit coverage for the extracted helpers the pipeline now shares. ---

test('roundShort maps fraction and word forms to codes', () => {
  assert.equal(roundShort('1/32-finals'), 'R64');
  assert.equal(roundShort('1/16-finals'), 'R32');
  assert.equal(roundShort('1/8-finals'), 'R16');
  assert.equal(roundShort('1/4-finals'), 'QF');
  assert.equal(roundShort('1/2-finals'), 'SF');
  assert.equal(roundShort('Final'), 'F');
  assert.equal(roundShort('Round of 64'), 'R64');
  assert.equal(roundShort('Quarter-finals'), 'QF');
});

test('isSlamSetCountQualifier is the pure tertiary net', () => {
  const base = { isGrandSlam: true, tournamentRound: 'Semi-finals', finalScore: '2 - 0', status: 'Finished' };
  assert.equal(isSlamSetCountQualifier(base), true);
  assert.equal(isSlamSetCountQualifier({ ...base, tournamentRound: '1/32-finals' }), false); // fraction guard
  assert.equal(isSlamSetCountQualifier({ ...base, status: 'Retired' }), false);              // ret guard
  assert.equal(isSlamSetCountQualifier({ ...base, isGrandSlam: false }), false);             // Slam-only
  assert.equal(isSlamSetCountQualifier({ ...base, finalScore: '3 - 1' }), false);            // 3 sets
  assert.equal(isSlamSetCountQualifier({ ...base, finalScore: '' }), false);                 // unparseable
});
