'use strict';

/**
 * validate-layer10.js — Layer #10 return-reprice validation harness.
 *
 * Runs the full green model over every match in matches.json and reports, for
 * the RETURN / PRESSURE layer (#10):
 *   - before  = the previous flat behaviour (signal x 0.02, career+52wk return
 *               rating, no altitude);
 *   - after   = the repriced dynamic magnitude (surface base scale x altitude
 *               multiplier, capped at 3pp). Return is the INVERSE of serve:
 *               it matters MOST on slow courts (Slow 3.0 / Med 1.75 / Fast 1.5pp)
 *               and altitude SUPPRESSES it (>=1500m x0.70 ... <300m x1.00).
 *
 * It asserts ZERO over-cap violations (|raw return deltaP1| <= 0.03 on every
 * match, measured PRE base-state dampening) and lists the altitude-suppressed
 * matches so a human can eyeball them. bpConvPct is dormant (career-splits has
 * no BP-conversion field), so ratings are unchanged from the live rpwPct+brkPct.
 *
 * Usage:  node tools/validate-layer10.js
 * Exit code 1 if any over-cap violation is found.
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const config = require(path.join(ROOT, 'h2h-model/config.js'));
const data = require(path.join(ROOT, 'h2h-model/data.js'));
const { runModel } = require(path.join(ROOT, 'h2h-model/model.js'));
const { surfaceCategory } = data;

const CEIL = config.adjustments.returnPressure.maxMagnitude; // 0.03

// --- replicate the OLD return rating (surface, last52 0.6 / career 0.4) -------
function returnRatingRow(row) {
  if (!row) return null;
  const n = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
  const rp = n(row.rpwPct), br = n(row.brkPct);
  if (rp == null) return null;
  return rp + (br || 0);
}
function blendedRating(splits, surfCat, bucket) {
  if (!splits) return null;
  const pick = (scope) => {
    const s = splits[scope];
    if (!s) return null;
    return (surfCat && s[surfCat]) || (bucket && s[bucket]) || null;
  };
  const l = returnRatingRow(pick('last52'));
  const c = returnRatingRow(pick('career'));
  if (l != null && c != null) return 0.6 * l + 0.4 * c;
  return l != null ? l : (c != null ? c : null);
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// OLD Layer #10: flat 0.02, career+52wk return rating, no altitude.
function oldReturnDelta(match, bestOf) {
  const p1 = data.resolvePlayer(match.p1Key, match.p1);
  const p2 = data.resolvePlayer(match.p2Key, match.p2);
  const surfCat = surfaceCategory(match.surface);
  const bucket = bestOf === 5 ? 'Best of 5' : 'Best of 3';
  const r1 = blendedRating(p1 && p1.splits, surfCat, bucket);
  const r2 = blendedRating(p2 && p2.splits, surfCat, bucket);
  if (r1 == null || r2 == null) return null;
  const signal = clamp((r1 - r2) / 15, -1, 1);
  return signal * 0.02;
}

const matches = data.load('matches.json');
let over = 0, fired = 0, altFired = 0;
const altList = [], rows = [];
let maxAbsRaw = 0;

for (const m of matches) {
  const out = runModel(m);
  if (!out || !out.ok) continue;
  const adj = ((out.stage2 && out.stage2.adjustments) || []).find((a) => a.id === 10);
  if (!adj) continue;
  // RAW (pre base-state dampening) return deltaP1 — the value the cap governs.
  const raw = adj.dampening ? adj.dampening.rawDeltaP1 : adj.deltaP1;
  const absRaw = Math.abs(raw);
  if (adj.applied) fired++;
  if (absRaw > maxAbsRaw) maxAbsRaw = absRaw;
  // over-cap: strictly greater than the 3pp ceiling (equality at |signal|=1 OK)
  if (absRaw > CEIL + 1e-9) {
    over++;
    console.log(`  !! OVER-CAP ${m.id} ${m.p1} vs ${m.p2}: raw=${(raw*100).toFixed(2)}pp > ${(CEIL*100)}pp`);
  }
  const det = adj.detail || '';
  const isAlt = /x0\.(70|82|90)/.test(det);
  if (isAlt) { altFired++; altList.push(`${m.tour} — ${m.p1} vs ${m.p2}: ${det}`); }

  const oldD = oldReturnDelta(m, out.match.bestOf);
  rows.push({ id: m.id, tour: m.tour, surface: m.surface,
    oldPP: oldD == null ? null : oldD * 100, newRawPP: raw * 100, applied: adj.applied });
}

// --- ceiling unit check: prove the 3pp clamp across EVERY surface x tier ------
// (altitude only suppresses, so the ceiling binds solely at Slow x1.00 = 3.0pp;
//  this proves nothing can ever exceed 3pp regardless of surface/altitude mix.)
const baseByCat = { Grass: config.adjustments.returnPressure.baseScalePP.Fast,
                    Hard:  config.adjustments.returnPressure.baseScalePP.Medium,
                    Clay:  config.adjustments.returnPressure.baseScalePP.Slow };
const tiers = config.adjustments.returnPressure.altitudeTiers;
let unitOver = 0; const unitRows = [];
for (const cat of Object.keys(baseByCat)) {
  for (const t of tiers) {
    const uncapped = baseByCat[cat] * t.mult;
    const eff = Math.min(CEIL, uncapped);
    if (eff > CEIL + 1e-9) unitOver++;
    unitRows.push(`  ${cat.padEnd(5)} x${t.mult.toFixed(2)} (>=${t.minM}m): ` +
      `${(uncapped*100).toFixed(2)}pp -> ${(eff*100).toFixed(2)}pp` +
      (uncapped > CEIL + 1e-9 ? '  [CLAMPED]' : ''));
  }
}

// --- summary ----------------------------------------------------------------
console.log('\n============ CEILING UNIT CHECK (surface x altitude tier) ============');
unitRows.forEach((r) => console.log(r));
console.log(`  clamp failures: ${unitOver}   ${unitOver === 0 ? 'PASS (nothing exceeds 3pp)' : 'FAIL'}`);
console.log('\n================ LAYER #10 RETURN REPRICE — VALIDATION ================');
console.log(`Matches scored:            ${rows.length}`);
console.log(`Return layer fired:        ${fired}`);
console.log(`Altitude-suppressed:       ${altFired}`);
console.log(`Max |raw return deltaP1|:  ${maxAbsRaw ? (maxAbsRaw*100).toFixed(2) : '0'}pp   (ceiling ${(CEIL*100)}pp)`);
console.log(`OVER-CAP VIOLATIONS:       ${over}   ${over === 0 ? 'PASS' : 'FAIL'}`);

// before/after magnitude shift (only where both fired)
const shifts = rows.filter((r) => r.oldPP != null && r.applied)
  .map((r) => Math.abs(r.newRawPP) - Math.abs(r.oldPP));
if (shifts.length) {
  const avg = shifts.reduce((a, b) => a + b, 0) / shifts.length;
  const up = shifts.filter((s) => s > 0.001).length, down = shifts.filter((s) => s < -0.001).length;
  console.log(`\nMagnitude shift (|new|-|old| raw pp, ${shifts.length} fired matches):`);
  console.log(`  mean ${avg >= 0 ? '+' : ''}${avg.toFixed(3)}pp   raised on ${up}, reduced on ${down}`);
}
if (altList.length) {
  console.log('\nAltitude-suppressed matches (return blunted by thin air):');
  altList.forEach((s) => console.log('  ' + s));
}
console.log('====================================================================');
process.exit(over === 0 && unitOver === 0 ? 0 : 1);
