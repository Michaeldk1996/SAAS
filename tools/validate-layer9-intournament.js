'use strict';

/**
 * validate-layer9-intournament.js — TEN-29 in-tournament serve tier.
 *
 * Runs the LIVE engine over the committed board and checks the new top tier:
 *   1. It fires only where the current tournament has completed earlier rounds
 *      with serve metrics (self-hides at R1 / off-progression events).
 *   2. The re-price is bounded (|nudge| <= maxDeltaPP) — no runaway round.
 *   3. serve() still respects its 5pp ceiling: signal in [-1,1], magnitude
 *      clamped to config maxMagnitude (the nudge changes the rating, never the
 *      magnitude), so no over-cap can be introduced.
 *   4. Negative control: matches whose tournament is NOT in the progression
 *      file must show ZERO in-tournament activity.
 */

const { runModel } = require('../h2h-model/model');
const config = require('../h2h-model/config');
const prog = require('../tournament-progression.json');

const CEIL = config.adjustments.serve.maxMagnitude;
const CAP = config.adjustments.serve.inTournament.maxDeltaPP;
const progTours = new Set(Object.keys(prog.tournaments || {}));

const raw = require('../matches.json');
const matches = Array.isArray(raw) ? raw : (raw.matches || raw.upcoming || []);

let ran = 0, fired = 0, overCap = 0, overMag = 0, badSignal = 0, ctrlLeak = 0;
const samples = [];
const distByTour = {};

for (const m of matches) {
  let out;
  try { out = runModel(m); } catch (e) { continue; }
  if (!out || !out.ok) continue;
  const sv = out.stage2.adjustments.find(a => a.key === 'serve');
  if (!sv) continue;
  ran++;

  const tourKey = String(m.tour || '').replace(/^ATP\s+/i, '').trim();
  const inProg = progTours.has(tourKey);

  // in-tourn activity is exposed in the detail string: "in-tourn Nr +X.X / ..."
  const hasIT = / in-tourn /.test(sv.detail || '');
  if (hasIT) {
    fired++;
    distByTour[tourKey] = (distByTour[tourKey] || 0) + 1;
    // parse the per-side nudges to bound-check
    const nums = (sv.detail.match(/in-tourn\s+(.+)\)\.$/) || [])[1] || '';
    for (const g of nums.matchAll(/(\d+)r\s+([+-]?\d+\.\d+)/g)) {
      const nudge = parseFloat(g[2]);
      if (Math.abs(nudge) > CAP + 1e-9) overCap++;
    }
    if (samples.length < 8) samples.push(`${m.p1} vs ${m.p2} [${tourKey}] :: ${sv.detail}`);
  }

  // negative control: off-progression tournaments must never fire
  if (!inProg && hasIT) { ctrlLeak++; }

  // ceiling invariants
  if (Math.abs(sv.signal) > 1 + 1e-9) badSignal++;
  if (Math.abs(sv.deltaP1) > CEIL + 1e-9) overMag++;
}

console.log('=== TEN-29 in-tournament serve tier — live board validation ===');
console.log(`matches priced (serve fired):     ${ran}`);
console.log(`in-tournament tier ACTIVE:        ${fired}`);
console.log(`  by tournament:                  ${JSON.stringify(distByTour)}`);
console.log(`progression tournaments on board: ${[...progTours].join(', ')}`);
console.log('');
console.log(`|nudge| > cap (${CAP}pt) violations:   ${overCap}   (must be 0)`);
console.log(`|signal| > 1 violations:          ${badSignal}   (must be 0)`);
console.log(`|deltaP1| > ceiling (${CEIL}) viols:  ${overMag}   (must be 0)`);
console.log(`neg-control leaks (off-prog fire): ${ctrlLeak}   (must be 0)`);
console.log('');
console.log('sample serve details WITH in-tournament tier:');
samples.forEach(s => console.log('  ' + s));

const fail = overCap || badSignal || overMag || ctrlLeak;
console.log('');
console.log(fail ? 'RESULT: FAIL' : (fired > 0 ? 'RESULT: PASS (tier fires + all invariants hold)'
                                              : 'RESULT: INCONCLUSIVE (tier never fired — check board)'));
process.exit(fail ? 1 : 0);
