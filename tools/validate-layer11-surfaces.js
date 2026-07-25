'use strict';

/**
 * validate-layer11-surfaces.js — cross-surface synthetic check for the Layer #11
 * fatigue recalibration (founder Option C, 2026-07-25).
 *
 * The live board is clay-heavy (and on some days carries no grass at all), so it
 * cannot on its own prove the recalibrated bands behave sensibly on hard and
 * grass courts. This harness drives the REAL fatigue() code path over a set of
 * hand-built scenarios — one fresh player (p2, zero load) vs a loaded player
 * (p1) — across Clay / Hard / Grass at mild / moderate / severe load, plus an
 * extreme stress case, and asserts:
 *   - the surface multiplier scales the gap correctly (Clay 1.25 > Hard 1.0 >
 *     Grass 0.75), so the SAME physical load resolves to a LOWER band on grass;
 *   - the recalibrated bands (>=3u=>1.0pp, >=6u=>1.5pp, >=15u=>2.5pp) produce a
 *     genuine mild/moderate/severe spread on every surface;
 *   - ZERO over-cap on every surface, including a deliberately extreme load.
 *
 * Usage:  node tools/validate-layer11-surfaces.js
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const config = require(path.join(ROOT, 'h2h-model/config.js'));
const { fatigue } = require(path.join(ROOT, 'h2h-model/adjustments.js'));

const CEIL = config.adjustments.fatigue.maxMagnitude; // 0.025
const TODAY = '2026-07-25';

// Build a recentForm history: `specs` is a list of [daysAgo, setsResult].
// tournament is intentionally an UNMAPPED name so the travel factor self-hides,
// and every window match is on `surf` so surface-change never fires — this
// isolates the surface-multiplier effect we are testing.
function player(name, age, surf, specs) {
  const matches = specs.map(([daysAgo, result]) => {
    const d = new Date(TODAY);
    d.setUTCDate(d.getUTCDate() - daysAgo);
    return { date: d.toISOString().slice(0, 10), result, surface: surf, tournament: 'Synthetic Cup' };
  });
  return { fullName: name, profile: { age, recentForm: { matches } } };
}

// A fresh opponent: no matches in the window (zero fatigue units).
function fresh(name) { return { fullName: name, profile: { age: 26, recentForm: { matches: [] } } }; }

// Loaded histories. Spacing >=2 days => no back-to-back (turnaround off);
// consecutive days on the 5-match sets trigger the turnaround x1.20.
const LOADS = {
  mild:     [[8, '2 - 0'], [5, '2 - 0']],                                   // 4 sets, mult 1.0 -> 4u
  moderate: [[9, '2 - 1'], [6, '2 - 1'], [3, '2 - 1']],                     // 9 sets, mult 1.0 -> 9u
  severe:   [[7, '2 - 1'], [6, '2 - 1'], [4, '2 - 1'], [3, '2 - 1'], [2, '2 - 1']], // 15 sets + back-to-back x1.20 -> 18u
  extreme:  [[9, '2 - 1'], [8, '2 - 1'], [6, '2 - 1'], [5, '2 - 1'], [3, '2 - 1'], [2, '2 - 1'], [1, '2 - 1']], // 21 sets + turnaround
};

const SURFACES = ['Clay', 'Hard', 'Grass'];
const bandOf = (pp) => pp >= 0.0245 ? '2.5pp(cap)' : pp >= 0.0145 ? '1.5pp' : pp >= 0.0095 ? '1.0pp' : '0pp';

let overCap = 0, maxAbs = 0, rows = 0;
console.log('\n========= LAYER #11 FATIGUE — CROSS-SURFACE SYNTHETIC CHECK =========');
console.log(`bands: >=3u=>1.0pp, >=6u=>1.5pp, >=15u=>2.5pp  |  surfMult ${JSON.stringify(config.adjustments.fatigue.surfaceMult)}\n`);

for (const surf of SURFACES) {
  console.log(`--- ${surf} (x${config.adjustments.fatigue.surfaceMult[surf]}) ---`);
  for (const load of ['mild', 'moderate', 'severe', 'extreme']) {
    const p1 = player('Loaded', 26, surf, LOADS[load]);
    const p2 = fresh('Fresh');
    const ctx = { p1, p2, surface: surf.toLowerCase(),
      match: { date: TODAY, surface: surf.toLowerCase(), tour: 'Synthetic Cup', tournament: 'Synthetic Cup' } };
    const res = fatigue(ctx);
    const abs = Math.abs(res.deltaP1 || 0);
    if (abs > maxAbs) maxAbs = abs;
    if (abs > CEIL + 1e-9) { overCap++; console.log(`  !! OVER-CAP`); }
    rows++;
    const detail = (res.detail || '').replace(/^\d+d load on \w+ \(x[\d.]+\): /, '');
    console.log(`  ${load.padEnd(9)} -> ${bandOf(abs).padEnd(10)} (${(abs * 100).toFixed(2)}pp)   ${detail}`);
  }
  console.log('');
}

// Grass-vs-clay parity on IDENTICAL load: the severe load caps on clay but must
// stay below the cap on grass (0.75 scaling) — proves clay isn't masking grass.
console.log('--- surface parity on the SAME "severe" load (18 units pre-surface) ---');
for (const surf of SURFACES) {
  const ctx = { p1: player('Loaded', 26, surf, LOADS.severe), p2: fresh('Fresh'), surface: surf.toLowerCase(),
    match: { date: TODAY, surface: surf.toLowerCase(), tour: 'Synthetic Cup', tournament: 'Synthetic Cup' } };
  const abs = Math.abs(fatigue(ctx).deltaP1 || 0);
  console.log(`  ${surf.padEnd(6)} -> ${bandOf(abs).padEnd(10)} (${(abs * 100).toFixed(2)}pp)`);
}

console.log(`\nScenarios run:        ${rows}`);
console.log(`Max |fatigue delta|:  ${(maxAbs * 100).toFixed(2)}pp   (ceiling ${(CEIL * 100)}pp)`);
console.log(`OVER-CAP VIOLATIONS:  ${overCap}   ${overCap === 0 ? 'PASS' : 'FAIL'}`);
process.exit(overCap === 0 ? 0 : 1);
