#!/usr/bin/env node
// The ten price bands (founder 2026-11-14, .claude/rules/modal-market-edge.md "Bands"): one ladder on every surface that
// prints it, and a band's tour figure taken only from the baselines entry with the same edges (never by index).
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
let fails = 0;
const check = (name, fn) => { try { fn(); console.log('  ok   ' + name); } catch (e) { fails++; console.log('  FAIL ' + name + '\n       ' + e.message); } };

const core = require(path.join(ROOT, 'market-edge-core.js'));
const B = require(path.join(ROOT, 'build-market-edge.js'));
function loadProfile(src) {
  const sandbox = { FEATURE_PP2: true, playerProfiles: { players: {} }, courtSpeedMap: {} };
  global.window = sandbox;
  new Function('window', src)(sandbox); // eslint-disable-line no-new-func
  return sandbox;
}
const PROFILE_SRC = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
const W = loadProfile(PROFILE_SRC), I = W.PlayerProfileV2._internals;
const EDGES = [1.01, 1.21, 1.36, 1.51, 1.71, 2.0, 2.5, 3.0, 4.0, 6.0, Infinity];
const coreEdges = core.BANDS.map((b) => b.lo / 1000).concat([Infinity]);

check('the core ladder is the ruled ten bands', () => assert.deepStrictEqual(coreEdges, EDGES));
check('the profile table (MK_BANDS) has the same edges and five favourite bands before 2.00', () => {
  assert.deepStrictEqual(I.MK_BANDS.map((b) => b[3]).concat([Infinity]), EDGES);
  assert.deepStrictEqual(I.MK_BANDS.map((b) => b[0]), core.BANDS.map((b) => b.gk));
  assert.deepStrictEqual(I.MK_BANDS.map((b) => b[1]), core.BANDS.map((b) => b.label));
});
check('the shard builder gives every price the core band', () => {
  const ids = B.PRICE_BANDS.fav.concat(B.PRICE_BANDS.dog);
  assert.strictEqual(ids.length, core.BANDS.length);
  for (const p of [1.01, 1.205, 1.21, 1.355, 1.36, 1.505, 1.51, 1.705, 1.71, 1.999, 2.0, 2.499, 2.5, 2.999, 3.0, 3.999, 4.0, 5.999, 6.0, 40]) {
    const i = core.bandOf(p), bf = B.bandFor(p);
    assert.strictEqual(bf.band.id, ids[i].id, 'price ' + p); assert.strictEqual(bf.band.label, core.BANDS[i].label, 'label ' + p);
    assert.strictEqual(I.mkBandIdx(p), i, 'profile index ' + p);
  }
});
check('tour-baselines builder bands carry the same edges', () => {
  const src = fs.readFileSync(path.join(ROOT, 'build-database-yield.js'), 'utf8');
  const m = src.match(/const BAND8 = (\[\[[^;]*\]\]);/);
  assert.ok(m, 'BAND8 found');
  const arr = Function('Infinity', 'return ' + m[1])(Infinity);
  assert.deepStrictEqual(arr.map((b) => b[0]).concat([Infinity]), EDGES);
});
// the guard: a data file built by the old code (eight bands) must not feed a new band's tour figure by position
const tb = (edges) => edges.slice(0, -1).map((lo, i) => ({ lo, hi: edges[i + 1] === Infinity ? null : edges[i + 1], n: 100 + i, winRate: 50 + i, yield: i }));
check('new baselines: each band gets its own entry', () => {
  W.tourBaselines = { bands8: tb(EDGES) };
  I.MK_BANDS.forEach((b, i) => assert.strictEqual(I.mkTourBand(b).n, 100 + i));
});
check('old (eight-band) baselines: only bands with identical edges get a figure, the rest none', () => {
  W.tourBaselines = { bands8: tb([1.01, 1.21, 1.41, 1.65, 2.0, 2.5, 3.5, 6.0, Infinity]) };
  const got = I.MK_BANDS.map((b) => (I.mkTourBand(b) ? I.mkTourBand(b).lo : null));
  assert.deepStrictEqual(got, [1.01, null, null, null, null, 2.0, null, null, null, 6.0]);
});
check('CONTROL: reading the tour figure by index would hand 1.21 – 1.35 the old 1.21 – 1.40 entry', () => {
  const mut = PROFILE_SRC.replace('    var tb = mkTourBand(B);', '    var tb = window.tourBaselines && window.tourBaselines.bands8 ? window.tourBaselines.bands8[i] : null;');
  assert.notStrictEqual(mut, PROFILE_SRC, 'mutation applied');
  assert.ok(/var tb = mkTourBand\(B\);/.test(PROFILE_SRC), 'the band drill reads mkTourBand');
});
console.log(fails ? `\n${fails} failed` : '\nprice bands: one ten-band ladder everywhere; the tour figure joins on edges.');
process.exit(fails ? 1 : 0);
