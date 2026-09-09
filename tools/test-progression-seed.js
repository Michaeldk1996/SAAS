'use strict';
// TEN-174 regression guard — Player-progression default seed.
//
// The bug: the default roster ranked players by `maxWonIdx` (deepest round WON),
// but win-detection parsed each round's winner-oriented `resultDisplay` "a - b" and
// counted a>b as a win. resultDisplay does NOT say which player won, so an eliminated
// player's LOSING scoreline (e.g. "3 - 0", the winner's sets) was counted as their
// own win. Result: 62 eliminated players (US Open 2026 live) were credited a phantom
// win at their elimination round, and losers ranked ABOVE the players who beat them
// (founder: "Why is Tsitsipas there? He lost.").
//
// The fix (bsp-consult-dashboard.html, buildTourxModel): derive the deepest round WON
// from the player-oriented `eliminated` flag + the draw structure — a player wins
// every round they advance past; their deepest PLAYED round is a win only if they
// were NOT eliminated there.
//
// This test (a) unit-tests that reference rule, (b) SOURCE-GUARDS the HTML block so
// reintroducing resultDisplay-based win-detection fails, and (c) asserts the ranking
// invariant on a fixture that mirrors the reported scenario.
//
// Run: node tools/test-progression-seed.js

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(name, cond, got) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, got !== undefined ? '| got: ' + JSON.stringify(got) : ''); }
}

// ---- Reference implementation: MUST match the inline logic in buildTourxModel. ----
// playedIdxsAsc: ascending round indices the player has a match at. eliminated: bool.
function deepestRoundWonIdx(playedIdxsAsc, eliminated) {
  if (!playedIdxsAsc.length) return -1;
  const deepestPlayedIdx = playedIdxsAsc[playedIdxsAsc.length - 1];
  return eliminated
    ? (playedIdxsAsc.length >= 2 ? playedIdxsAsc[playedIdxsAsc.length - 2] : -1)
    : deepestPlayedIdx;
}

console.log('=== deepestRoundWonIdx (structure + eliminated flag) ===');
// Tsitsipas: played R1..R4 (idx 1..4), lost R4 -> deepest WIN is R3 (idx 3).
ok('eliminated at deepest played -> second deepest is the win', deepestRoundWonIdx([1, 2, 3, 4], true) === 3, deepestRoundWonIdx([1, 2, 3, 4], true));
// Shelton: alive, played R1..R4, won R4 -> deepest WIN is R4 (idx 4).
ok('still-alive -> deepest played counts as a win', deepestRoundWonIdx([1, 2, 3, 4], false) === 4, deepestRoundWonIdx([1, 2, 3, 4], false));
// Djokovic: lost his opener (only R1) -> won nothing.
ok('eliminated in opener -> no win (-1)', deepestRoundWonIdx([1], true) === -1, deepestRoundWonIdx([1], true));
// Champion: alive through the final.
ok('champion (alive, played final) -> final counts', deepestRoundWonIdx([1, 2, 3, 4, 5, 6, 7], false) === 7);
// Runner-up: lost the final.
ok('runner-up (eliminated at final) -> semifinal is the win', deepestRoundWonIdx([1, 2, 3, 4, 5, 6, 7], true) === 6);
ok('no matches -> -1', deepestRoundWonIdx([], true) === -1);
// A loss can NEVER out-rank the winner it fed: loser's win-idx < winner's played-idx.
// Tsitsipas(elim,R4) win-idx 3  <  Shelton(alive,R4) win-idx 4.
ok('loser ranks strictly below the player who beat them',
   deepestRoundWonIdx([1, 2, 3, 4], true) < deepestRoundWonIdx([1, 2, 3, 4], false));

// ---- Source guard: the HTML block must not parse the scoreline for win-detection. ----
console.log('=== source guard: bsp-consult-dashboard.html buildTourxModel ===');
const html = fs.readFileSync(path.join(__dirname, '..', 'bsp-consult-dashboard.html'), 'utf8');
// Isolate the maxWonIdx computation: from its declaration to where playedIdx is set.
const decl = html.indexOf('let maxWonIdx = -1;');
ok('maxWonIdx computation present', decl >= 0);
const block = decl >= 0 ? html.slice(decl, html.indexOf('const wonLast', decl)) : '';
ok('win-detection uses the player-oriented `eliminated` flag', /p\.eliminated/.test(block), block.slice(0, 80));
ok('win-detection does NOT parse resultDisplay (winner-oriented scoreline)', !/resultDisplay/.test(block));
ok('win-detection does NOT re-introduce "a > b" scoreline compare', !/parts\[0\]\s*>\s*parts\[1\]/.test(block));

// ---- Source guard: "Include eliminated" must actually surface eliminated players. ----
// Founder ruling 2026-09-08 (interaction a5a9819d): "on all rounds + include eliminated,
// you should see their data until the round they were, simple." Without a larger cap
// the toggle is a no-op on a live event (survivors sort deepest and fill all 4 slots),
// which was the reopened complaint. Guard: the expanded cap exists AND the pool logic
// partitions alive/knocked-out so the deepest eliminated are guaranteed a slot.
console.log('=== source guard: Include-eliminated reveal (TEN-170 postscript) ===');
// [2026-09-09] The cap became UNCAPPED (TOURX_PP_CAP_INCL = null): a fixed 8 truncated
// the field at a position, not a boundary. These guards now lock the uncapped contract —
// the combined list must reach the grid whole — in place of the old numeric-slice guard.
ok('TOURX_PP_CAP_INCL constant defined', /TOURX_PP_CAP_INCL\s*=\s*(null|\d+)/.test(html));
ok('Include-eliminated is uncapped (TOURX_PP_CAP_INCL = null)',
   /const\s+TOURX_PP_CAP_INCL\s*=\s*null\b/.test(html));
ok('Include-eliminated renders the whole combined list (no unconditional slice)',
   /const\s+combined\s*=\s*alive\.concat\(knockedOut\);/.test(html)
   && /TOURX_PP_CAP_INCL\s*==\s*null\s*\?\s*combined\s*:/.test(html));
ok('Include-eliminated no longer truncates the alive group to TOURX_PP_CAP',
   /const\s+alive\s*=\s*progressable\.filter\(isAlive\);/.test(html));
ok('Include-eliminated guarantees knocked-out players a slot (alive/knockedOut partition)',
   /const\s+knockedOut\s*=\s*progressable\.filter\(p\s*=>\s*!isAlive\(p\)\)/.test(html));

// ---- Invariant on a fixture mirroring the reported US Open 2026 scenario. ----
console.log('=== ranking invariant (fixture) ===');
const ORDER = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'];
const idxOf = lbl => ORDER.indexOf(lbl);
// Minimal fixture: two alive R4 winners, two eliminated R4 losers, one R1 loser.
const players = [
  { name: 'Alcaraz',    eliminated: false, rounds: ['R1', 'R2', 'R3', 'R4'] },
  { name: 'Shelton',    eliminated: false, rounds: ['R1', 'R2', 'R3', 'R4'] },
  { name: 'Tsitsipas',  eliminated: true,  rounds: ['R1', 'R2', 'R3', 'R4'] }, // lost R4 to Shelton
  { name: 'Etcheverry', eliminated: true,  rounds: ['R1', 'R2', 'R3', 'R4'] }, // lost R4
  { name: 'Djokovic',   eliminated: true,  rounds: ['R1'] },                    // lost R1
];
const seeded = players
  .map(p => ({ name: p.name, eliminated: p.eliminated, maxWonIdx: deepestRoundWonIdx(p.rounds.map(idxOf).sort((a, b) => a - b), p.eliminated) }))
  .sort((a, b) => b.maxWonIdx - a.maxWonIdx);
const top4 = seeded.slice(0, 4).map(p => p.name);
ok('default top-4 are the still-alive/deepest winners, not eliminated losers',
   top4.filter(n => ['Alcaraz', 'Shelton'].includes(n)).length === 2 && !top4.slice(0, 2).some(n => ['Tsitsipas', 'Etcheverry'].includes(n)),
   top4);
const ts = seeded.find(p => p.name === 'Tsitsipas');
const sh = seeded.find(p => p.name === 'Shelton');
ok('Tsitsipas (lost R4) ranks below Shelton (won R4)', ts.maxWonIdx < sh.maxWonIdx, { ts: ts.maxWonIdx, sh: sh.maxWonIdx });
ok('no eliminated player is credited a win at their elimination round',
   seeded.filter(p => p.eliminated).every(p => {
     const pl = players.find(x => x.name === p.name);
     const deepestPlayed = Math.max(...pl.rounds.map(idxOf));
     return p.maxWonIdx < deepestPlayed;
   }));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
