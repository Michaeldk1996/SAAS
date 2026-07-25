'use strict';

/**
 * validate-layer11.js — Layer #11 fatigue validation harness.
 *
 * Runs the full green model over every match in matches.json and reports, for
 * the FATIGUE layer (#11):
 *   - fired count + the probability-point band each firing landed in
 *     (founder spec: <2u => 0, 2-4u => 1.0pp, 4-7u => 1.5pp, >=7u => 2.5pp);
 *   - which per-player load multipliers actually triggered on the live board
 *     (short-turnaround x1.40, surface-change x1.20, travel x1.25, age recovery);
 *   - travel-factor coverage: how many player-sides had BOTH their previous
 *     window tournament AND today's venue mapped in tournamentUtcOffset (the
 *     rest self-hide the travel factor — honest degradation, never a guess);
 *   - a ZERO over-cap assertion: |fatigue deltaP1| <= maxMagnitude (2.5pp) on
 *     every match. Fatigue is not dampened and not in the live-signal cap set,
 *     so deltaP1 is the raw layer value. Exit code 1 on any breach.
 *
 * Usage:  node tools/validate-layer11.js
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const config = require(path.join(ROOT, 'h2h-model/config.js'));
const data = require(path.join(ROOT, 'h2h-model/data.js'));
const { runModel } = require(path.join(ROOT, 'h2h-model/model.js'));

const CEIL = config.adjustments.fatigue.maxMagnitude; // 0.025

const matches = data.load('matches.json');
let scored = 0, fired = 0, overCap = 0, maxAbs = 0;
const bands = { '1.0pp': 0, '1.5pp': 0, '2.5pp': 0 };
const factorCount = { turnaround: 0, 'surf-switch': 0, travel: 0, age: 0 };
let sidesTotal = 0, travelKnownSides = 0;
const samples = [];

for (const m of matches) {
  const out = runModel(m);
  if (!out.ok) continue;
  scored++;
  const adj = out.stage2.adjustments.find((a) => a.id === 11);
  if (!adj) continue;

  // travel coverage + factor tally from the exposed per-player breakdown
  if (adj.fatigue) {
    for (const side of ['p1', 'p2']) {
      const l = adj.fatigue[side];
      if (!l) continue;
      if (l.count > 0) { sidesTotal++; if (l.travelKnown) travelKnownSides++; }
      for (const f of l.factors || []) {
        if (f.startsWith('turnaround')) factorCount.turnaround++;
        else if (f.startsWith('surf-switch')) factorCount['surf-switch']++;
        else if (f.startsWith('travel')) factorCount.travel++;
        else if (f.startsWith('age')) factorCount.age++;
      }
    }
  }

  if (!adj.applied) continue;
  fired++;
  const abs = Math.abs(adj.deltaP1);
  if (abs > maxAbs) maxAbs = abs;
  // strictly greater than ceiling is a violation (equality at the 2.5pp band is OK)
  if (abs > CEIL + 1e-9) {
    overCap++;
    console.log(`  !! OVER-CAP ${m.id} ${m.p1} vs ${m.p2}: ${(abs * 100).toFixed(2)}pp > ${(CEIL * 100)}pp`);
  }
  const ppKey = abs >= 0.0245 ? '2.5pp' : abs >= 0.0145 ? '1.5pp' : '1.0pp';
  if (bands[ppKey] != null) bands[ppKey]++;
  if (samples.length < 12) samples.push(`  ${m.tour} — ${m.p1} vs ${m.p2}: ${adj.detail}`);
}

console.log('\n================ LAYER #11 FATIGUE — VALIDATION ================');
console.log(`Matches scored:            ${scored}`);
console.log(`Fatigue layer fired:       ${fired}`);
console.log(`  band 1.0pp:              ${bands['1.0pp']}`);
console.log(`  band 1.5pp:              ${bands['1.5pp']}`);
console.log(`  band 2.5pp (cap):        ${bands['2.5pp']}`);
console.log(`Multiplier triggers:       turnaround ${factorCount.turnaround}, surf-switch ${factorCount['surf-switch']}, travel ${factorCount.travel}, age ${factorCount.age}`);
console.log(`Travel-factor coverage:    ${travelKnownSides}/${sidesTotal} player-sides had both venues mapped (${sidesTotal ? (100 * travelKnownSides / sidesTotal).toFixed(0) : 0}%)`);
console.log(`Max |fatigue deltaP1|:     ${(maxAbs * 100).toFixed(2)}pp   (ceiling ${(CEIL * 100)}pp)`);
console.log(`OVER-CAP VIOLATIONS:       ${overCap}   ${overCap === 0 ? 'PASS' : 'FAIL'}`);
console.log('\nSample firings:');
samples.forEach((s) => console.log(s));

process.exit(overCap === 0 ? 0 : 1);
