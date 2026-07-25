'use strict';

/**
 * validate-layer13.js — Layer #13 Bo5 format-split validation harness.
 *
 * Two passes:
 *   (A) LIVE board — asserts the layer fires on ZERO Bo3 matches (founder spec:
 *       "Bo3 outputs zero"). The current board is all clay/hard Bo3, so the
 *       correct result is 0 firings.
 *   (B) SYNTHETIC Bo5 — because no Grand-Slam match is on the board, we force
 *       bestOf=5 on real player pairs drawn from career-splits to exercise the
 *       dampening tiers (<10 hidden / 10-19 x0.40 / 20-29 x0.70 / 30+ full),
 *       the both-good/both-bad cancellation, and the ZERO over-cap assertion
 *       (|deltaP1| <= maxMagnitude 2.5pp). formatSplit is not dampened and not in
 *       the live-signal cap set, so deltaP1 is the raw layer value.
 *
 * Usage:  node tools/validate-layer13.js
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const config = require(path.join(ROOT, 'h2h-model/config.js'));
const data = require(path.join(ROOT, 'h2h-model/data.js'));
const { runModel } = require(path.join(ROOT, 'h2h-model/model.js'));
const adjustments = require(path.join(ROOT, 'h2h-model/adjustments.js'));

const CEIL = config.adjustments.formatSplit.maxMagnitude; // 0.025

// ---- Pass A: live board must fire zero (all Bo3) ----
const matches = data.load('matches.json');
let boardFired = 0, boardScored = 0;
for (const m of matches) {
  const out = runModel(m);
  if (!out.ok) continue;
  boardScored++;
  const adj = out.stage2.adjustments.find((a) => a.id === 13);
  if (adj && adj.applied) { boardFired++; console.log(`  unexpected Bo5 firing on board: ${m.id} ${m.p1} vs ${m.p2}`); }
}

// ---- Pass B: synthetic Bo5 over real player pairs ----
// Build ctx directly against the layer function so we can force bestOf=5 without
// a Grand-Slam board record. Pull players that actually carry a Bo5 bucket.
const C = data.load('career-splits.json');
const players = C.players || C;
const withBo5 = [];
for (const k in players) {
  const p = players[k];
  if (p && p.career && p.career['Best of 5'] && (p.career['Best of 5'].M || 0) >= 1) withBo5.push(k);
}

function ctxFor(k1, k2) {
  return {
    p1: { splits: players[k1], fullName: players[k1].fullName },
    p2: { splits: players[k2], fullName: players[k2].fullName },
    surface: 'hard', bestOf: 5, match: { date: '2026-01-20', tour: 'Australian Open' },
  };
}

let synScored = 0, synFired = 0, synOverCap = 0, maxAbs = 0;
const tierHits = { hidden: 0, '0.40': 0, '0.70': 0, '1.00': 0 };
const samples = [];
// deterministic pairing: consecutive players in the list (no RNG)
for (let i = 0; i + 1 < withBo5.length; i += 2) {
  const r = adjustments.runAll(ctxFor(withBo5[i], withBo5[i + 1])).find((a) => a.id === 13);
  synScored++;
  if (r && r.formatSplit) {
    for (const side of ['p1', 'p2']) {
      const l = r.formatSplit[side];
      if (!l) { tierHits.hidden++; continue; }
      tierHits[l.damp.toFixed(2)] = (tierHits[l.damp.toFixed(2)] || 0) + 1;
    }
  }
  if (!r || !r.applied) continue;
  synFired++;
  const abs = Math.abs(r.deltaP1);
  if (abs > maxAbs) maxAbs = abs;
  if (abs > CEIL + 1e-9) { synOverCap++; console.log(`  !! OVER-CAP ${r.detail}`); }
  if (samples.length < 8) samples.push(`  ${players[withBo5[i]].fullName} vs ${players[withBo5[i + 1]].fullName}: ${(r.deltaP1 * 100).toFixed(2)}pp | ${r.detail}`);
}

console.log('\n================ LAYER #13 BO5 FORMAT SPLIT — VALIDATION ================');
console.log('PASS A (live board — must be 0):');
console.log(`  Board matches scored:    ${boardScored}`);
console.log(`  Bo5 layer fired on board:${boardFired}   ${boardFired === 0 ? 'PASS (all Bo3 -> zero)' : 'FAIL'}`);
console.log('\nPASS B (synthetic Bo5 over real pairs):');
console.log(`  Pairs scored:            ${synScored}`);
console.log(`  Layer fired:             ${synFired}`);
console.log(`  Dampening-tier hits:     hidden(<10) ${tierHits.hidden}, x0.40 ${tierHits['0.40'] || 0}, x0.70 ${tierHits['0.70'] || 0}, x1.00 ${tierHits['1.00'] || 0}`);
console.log(`  Max |deltaP1|:           ${(maxAbs * 100).toFixed(2)}pp   (ceiling ${(CEIL * 100)}pp)`);
console.log(`  OVER-CAP VIOLATIONS:     ${synOverCap}   ${synOverCap === 0 ? 'PASS' : 'FAIL'}`);
console.log('\n  Sample synthetic firings:');
samples.forEach((s) => console.log(s));

process.exit(boardFired === 0 && synOverCap === 0 ? 0 : 1);
