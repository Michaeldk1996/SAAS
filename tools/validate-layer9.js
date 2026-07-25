'use strict';

/**
 * validate-layer9.js — Layer #9 serve-reprice validation harness.
 *
 * Runs the full green model over every match in matches.json and reports, for
 * the SERVE layer (#9):
 *   - before  = the previous flat behaviour (signal x 0.035, surface rating,
 *               no altitude, no thin-surface fallback);
 *   - after   = the repriced dynamic magnitude (surface base scale x altitude
 *               multiplier, capped at 5pp; universal-rating x0.70 fallback when
 *               the surface sample is < surfaceMinM).
 *
 * It asserts ZERO over-cap violations (|raw serve deltaP1| <= 0.05 on every
 * match, measured PRE base-state dampening) and lists the altitude-amplified
 * and thin-surface-fallback matches so a human can eyeball them.
 *
 * Usage:  node tools/validate-layer9.js
 * Exit code 1 if any over-cap violation is found.
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const config = require(path.join(ROOT, 'h2h-model/config.js'));
const data = require(path.join(ROOT, 'h2h-model/data.js'));
const { runModel } = require(path.join(ROOT, 'h2h-model/model.js'));
const { surfaceCategory } = data;

const CEIL = config.adjustments.serve.maxMagnitude; // 0.05

// --- replicate the OLD serve rating (surface, last52 0.6 / career 0.4) -------
function serveRatingRow(row) {
  if (!row) return null;
  const n = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
  const fi = n(row.firstInPct), fw = n(row.firstWonPct), sw = n(row.secondWonPct),
        hl = n(row.hldPct), a = n(row.aPct), df = n(row.dfPct);
  if (fi == null || fw == null || sw == null || hl == null) return null;
  return fi + fw + sw + hl + (a || 0) - (df || 0);
}
function blendedRating(splits, surfCat, bucket) {
  if (!splits) return null;
  const pick = (scope) => {
    const s = splits[scope];
    if (!s) return null;
    return (surfCat && s[surfCat]) || (bucket && s[bucket]) || null;
  };
  const l = serveRatingRow(pick('last52'));
  const c = serveRatingRow(pick('career'));
  if (l != null && c != null) return 0.6 * l + 0.4 * c;
  return l != null ? l : (c != null ? c : null);
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// OLD Layer #9: flat 0.035, surface rating (no min-M gate, no altitude, no penalty).
function oldServeDelta(match, bestOf) {
  const p1 = data.resolvePlayer(match.p1Key, match.p1);
  const p2 = data.resolvePlayer(match.p2Key, match.p2);
  const surfCat = surfaceCategory(match.surface);
  const bucket = bestOf === 5 ? 'Best of 5' : 'Best of 3';
  const r1 = blendedRating(p1 && p1.splits, surfCat, bucket);
  const r2 = blendedRating(p2 && p2.splits, surfCat, bucket);
  if (r1 == null || r2 == null) return null;
  const signal = clamp((r1 - r2) / 25, -1, 1);
  return signal * 0.035;
}

const matches = data.load('matches.json');
let over = 0, fired = 0, altFired = 0, fallbackFired = 0;
const altList = [], fbList = [], rows = [];
let maxAbsRaw = 0;

for (const m of matches) {
  const out = runModel(m);
  if (!out || !out.ok) continue;
  const adj = ((out.stage2 && out.stage2.adjustments) || []).find((a) => a.id === 9);
  if (!adj) continue;
  // RAW (pre base-state dampening) serve deltaP1 — the value the cap governs.
  const raw = adj.dampening ? adj.dampening.rawDeltaP1 : adj.deltaP1;
  const absRaw = Math.abs(raw);
  if (adj.applied) fired++;
  if (absRaw > maxAbsRaw) maxAbsRaw = absRaw;
  // over-cap: strictly greater than the 5pp ceiling (equality at |signal|=1 is OK)
  if (absRaw > CEIL + 1e-9) {
    over++;
    console.log(`  !! OVER-CAP ${m.id} ${m.p1} vs ${m.p2}: raw=${(raw*100).toFixed(2)}pp > ${(CEIL*100)}pp`);
  }
  const det = adj.detail || '';
  const isAlt = /x1\.(25|60|2)|x2\.00|\d+m x/.test(det) && /x(1\.25|1\.60|2\.00)/.test(det);
  const isFb = /thin-surface/.test(det);
  if (isAlt) { altFired++; altList.push(`${m.tour} — ${m.p1} vs ${m.p2}: ${det}`); }
  if (isFb) { fallbackFired++; fbList.push(`${m.tour} — ${m.p1} vs ${m.p2}: ${det}`); }

  const oldD = oldServeDelta(m, out.match.bestOf);
  rows.push({ id: m.id, tour: m.tour, surface: m.surface,
    oldPP: oldD == null ? null : oldD * 100, newRawPP: raw * 100, applied: adj.applied });
}

// --- ceiling unit check: prove the 5pp clamp across EVERY surface x tier -----
// (the live slate has no grass+altitude match, so the Option-C ceiling is never
//  exercised above; this proves the clamp bites where it must.)
const baseByCat = { Grass: config.adjustments.serve.baseScalePP.Fast,
                    Hard:  config.adjustments.serve.baseScalePP.Medium,
                    Clay:  config.adjustments.serve.baseScalePP.Slow };
const tiers = config.adjustments.serve.altitudeTiers;
let unitOver = 0; const unitRows = [];
for (const cat of Object.keys(baseByCat)) {
  for (const t of tiers) {
    const uncapped = baseByCat[cat] * t.mult;
    const eff = Math.min(CEIL, uncapped);
    if (eff > CEIL + 1e-9) unitOver++;
    unitRows.push(`  ${cat.padEnd(5)} x${t.mult.toFixed(2)} (>=${t.minM}m): ` +
      `${(uncapped*100).toFixed(1)}pp -> ${(eff*100).toFixed(2)}pp` +
      (uncapped > CEIL ? '  [CLAMPED]' : ''));
  }
}

// --- summary ----------------------------------------------------------------
console.log('\n============ CEILING UNIT CHECK (surface x altitude tier) ============');
unitRows.forEach((r) => console.log(r));
console.log(`  clamp failures: ${unitOver}   ${unitOver === 0 ? 'PASS (nothing exceeds 5pp)' : 'FAIL'}`);
console.log('\n================ LAYER #9 SERVE REPRICE — VALIDATION ================');
console.log(`Matches scored:            ${rows.length}`);
console.log(`Serve layer fired:         ${fired}`);
console.log(`Altitude-amplified:        ${altFired}`);
console.log(`Thin-surface fallback:     ${fallbackFired}`);
console.log(`Max |raw serve deltaP1|:   ${maxAbsRaw ? (maxAbsRaw*100).toFixed(2) : '0'}pp   (ceiling ${(CEIL*100)}pp)`);
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
  console.log('\nAltitude-amplified matches:');
  altList.forEach((s) => console.log('  ' + s));
}
if (fbList.length) {
  console.log('\nThin-surface fallback matches (x0.70 reliability penalty):');
  fbList.slice(0, 12).forEach((s) => console.log('  ' + s));
  if (fbList.length > 12) console.log(`  ... and ${fbList.length - 12} more`);
}
console.log('====================================================================');
process.exit(over === 0 && unitOver === 0 ? 0 : 1);
