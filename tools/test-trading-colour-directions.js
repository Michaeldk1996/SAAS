// TEN-151 — Trading Report colour-engine ruling harness.
// Encodes two founder rulings so they cannot silently regress:
//   1) gate confirmation:TEN-151:direction-list:v1 (accepted 2026-09-07) — the
//      only HIGH=BAD colour inversions are oph, babb, bbk, bfsg; every other
//      column reads HIGH=GOOD (player-strength framing).
//   2) ask:TEN-151:colour-rulings:v1 (answered 2026-09-07) — the extra columns
//      that were not in the confirmed 12 stay HIGH=GOOD (spw/rpw/bps/bpw and the
//      won-set/won-match outcomes wfs/ws2/ws1w2/ws1wm), and RANK_MIN_POP = 8.
// Run: node tools/test-trading-colour-directions.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ── DIRECTION lives inside the trading-report.js browser IIFE (not exported),
//    so parse the literal out of the source rather than executing it.
const src = fs.readFileSync(path.join(__dirname, '..', 'trading-report.js'), 'utf8');
const m = src.match(/var DIRECTION = \{([\s\S]*?)\};/);
assert(m, 'DIRECTION object not found in trading-report.js');
const DIRECTION = {};
for (const pair of m[1].matchAll(/([a-z0-9]+)\s*:\s*(-?1)\b/gi)) {
  DIRECTION[pair[1]] = Number(pair[2]);
}
assert(Object.keys(DIRECTION).length >= 20, 'DIRECTION parsed too few keys: ' + Object.keys(DIRECTION).length);

// Ruling 1 — the four (and only four) confirmed inversions read HIGH=BAD.
const INVERSIONS = ['oph', 'babb', 'bbk', 'bfsg'];
for (const k of INVERSIONS) {
  assert.strictEqual(DIRECTION[k], -1, `expected ${k} to be a HIGH=BAD inversion (-1)`);
}
// No column outside that set may be an inversion.
for (const [k, v] of Object.entries(DIRECTION)) {
  if (!INVERSIONS.includes(k)) {
    assert.strictEqual(v, 1, `unexpected inversion: ${k} = ${v} (only oph/babb/bbk/bfsg may be -1)`);
  }
}

// Ruling 2 — the extra columns the founder confirmed stay HIGH=GOOD.
const EXTRA_HIGH_GOOD = ['spw', 'rpw', 'bps', 'bpw', 'wfs', 'ws2', 'ws1w2', 'ws1wm'];
for (const k of EXTRA_HIGH_GOOD) {
  assert.strictEqual(DIRECTION[k], 1, `expected ${k} to stay HIGH=GOOD (+1) per colour-rulings:v1`);
}

// Ruling 2 — RANK_MIN_POP stays at 8 (min ranked players before a cut publishes).
// Parsed from source (not require()d) to keep this harness dependency-free.
const buildSrc = fs.readFileSync(path.join(__dirname, '..', 'build-trading-splits.js'), 'utf8');
const rm = buildSrc.match(/const\s+RANK_MIN_POP\s*=\s*(\d+)\s*;/);
assert(rm, 'RANK_MIN_POP declaration not found in build-trading-splits.js');
const RANK_MIN_POP = Number(rm[1]);
assert.strictEqual(RANK_MIN_POP, 8, `expected RANK_MIN_POP === 8, got ${RANK_MIN_POP}`);

console.log('PASS  trading-colour-directions:',
  `${INVERSIONS.length} inversions locked,`,
  `${EXTRA_HIGH_GOOD.length} extra HIGH=GOOD locked,`,
  `RANK_MIN_POP=${RANK_MIN_POP}`);
