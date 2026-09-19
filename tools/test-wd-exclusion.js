#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// FOUNDER RULING 2026-09-19 — a WD is a walkover GIVEN: not a win, not a loss,
// EXCLUDED from the denominator entirely, exactly like the existing walkover
// rule.
//
// WHY THIS TEST EXISTS AT THE UNIT LEVEL
// ──────────────────────────────────────
// The ruling was already implemented in three of the four places that count a
// tournament record:
//
//   bsp-pipeline.js  fetchPlayerCareerHistory   `else if (!walkoverGiven) t.lost++`
//   bsp-pipeline.js  deriveSlamBoxes            `if W … else if L …`
//   player-profile-v2.js  tournEditionRows      `if W … else if L …`
//
// and NOT in the fourth — `finalizeTournament`, whose own doc comment claims it
// "mirror[s] fetchPlayerCareerHistory's aggregate rules exactly" while carrying
// a binary `else lost++`. Because `mergePlayer` rebuilds EVERY row through it
// and runs after the pipeline, it overwrote the compliant header with a wrong
// one on every player.
//
// So the store-level count is a lagging indicator: it cannot go green until a
// pipeline run republishes the shards. This test locks the CODE, deterministically
// and immediately, so the rule cannot regress while the data catches up.
//
// Measured on the deployed store before the fix: 13,071 tournament rows, 105
// carrying a WD, and 105 of 105 counted it as a loss — zero compliant.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const { _internal } = require('../career-backfill.js');
const { finalizeTournament } = _internal;

let pass = 0;
const fails = [];
function check(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fails.push(name); console.error(`  FAIL ${name}\n       ${e.message}`); }
}

// A single edition: 5 wins, 1 real loss, 1 walkover GIVEN.
// Under the ruling the record is 5–1 over 6 matches, NOT 5–2 over 7.
const withWd = {
  2024: [
    { res: 'W', round: 'R64', opp: 'A', score: '6-3 6-4' },
    { res: 'W', round: 'R32', opp: 'B', score: '6-2 6-2' },
    { res: 'W', round: 'R16', opp: 'C', score: '7-5 6-4' },
    { res: 'W', round: 'QF',  opp: 'D', score: '6-4 6-4' },
    { res: 'W', round: 'SF',  opp: 'E', score: '6-1 6-3' },
    { res: 'L', round: 'F',   opp: 'F', score: '4-6 3-6' },
    { res: 'WD', round: 'R64', opp: 'G', score: '' },
  ],
};

check('a WD is excluded from the denominator entirely (not a loss)', () => {
  const t = finalizeTournament('Test Open', withWd);
  assert.strictEqual(t.won, 5, `wins moved: ${t.won}`);
  assert.strictEqual(t.lost, 1,
    `a WD was counted as a loss: record reads ${t.won}–${t.lost}, ruling requires 5–1`);
  assert.strictEqual(t.won + t.lost, 6,
    `denominator is ${t.won + t.lost}; the WD must not be in it`);
});

check('a WD is not counted as a win either', () => {
  const t = finalizeTournament('Test Open', withWd);
  assert.strictEqual(t.won, 5, `the WD leaked into the win column: ${t.won}`);
});

// The row whose ONLY appearance is a walkover given. Under the ruling this is a
// genuine n=0 — which the renderer already dashes rather than printing 0%.
// Measured: 2 such rows exist today (R. Albot / Rotterdam, D. Kuzmanov / Gijon).
check('a row whose only match is a WD reconciles to n=0, not 0–1', () => {
  const t = finalizeTournament('Walkover Only', {
    2020: [{ res: 'WD', round: 'R32', opp: 'X', score: '' }],
  });
  assert.strictEqual(t.won, 0, `won should be 0, got ${t.won}`);
  assert.strictEqual(t.lost, 0,
    `the lone WD was counted as a loss: ${t.won}–${t.lost}, ruling requires 0–0`);
});

// CONTROL — a real loss must still count. Without this, "exclude the WD" could
// be satisfied by a mutant that stops counting losses altogether and every
// assertion above would still pass.
check('CONTROL: a real loss is still a loss', () => {
  const t = finalizeTournament('Test Open', {
    2024: [
      { res: 'W', round: 'SF', opp: 'A', score: '6-3 6-4' },
      { res: 'L', round: 'F',  opp: 'B', score: '4-6 3-6' },
    ],
  });
  assert.strictEqual(t.won, 1, `wins: ${t.won}`);
  assert.strictEqual(t.lost, 1,
    `a real loss stopped counting — the exclusion is too wide: ${t.won}–${t.lost}`);
});

// CONTROL — the WD must not change anything ELSE about the row. The same
// function also derives titles and bestResult from the deepest round, and the
// WD above sits at R64, so a careless filter that dropped the match before the
// deepest-round scan would still pass the record assertions.
check('CONTROL: titles and best result are unaffected by the WD', () => {
  const won = finalizeTournament('Test Open', {
    2024: [
      { res: 'W', round: 'SF', opp: 'A', score: '6-3 6-4' },
      { res: 'W', round: 'F',  opp: 'B', score: '6-4 6-4' },
      { res: 'WD', round: 'R64', opp: 'C', score: '' },
    ],
  });
  assert.strictEqual(won.titles, 1, `titles: ${won.titles}`);
  assert.strictEqual(won.bestResult, 'Won', `bestResult: ${won.bestResult}`);
});

console.log(`\nWD exclusion: ${pass} pass, ${fails.length} fail`);
if (fails.length) { console.error('FAILED: ' + fails.join(' · ')); process.exit(1); }
