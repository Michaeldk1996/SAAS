'use strict';
// Mutants for the best-of-5 set conversion (founder 2026-11-26): each edit to h2h-model/model.js must turn a check red.
const assert = require('assert'), fs = require('fs'), path = require('path'), Module = require('module');
const ROOT = path.join(__dirname, '..'), FILE = path.join(ROOT, 'h2h-model/model.js');
const SRC = fs.readFileSync(FILE, 'utf8');
function load(src) { const m = new Module(FILE, null); m.filename = FILE; m.paths = Module._nodeModulePaths(path.dirname(FILE)); m._compile(src, FILE); return m.exports; }
const P = (JSON.parse(fs.readFileSync(path.join(ROOT, 'player-profiles.json'), 'utf8')).players) || {};
const ks = ['1980', '2382', '2072', '1905'].filter(k => P[k]);
if (ks.length < 2) { console.log('SKIP: pinned players missing from player-profiles.json'); process.exit(0); }
const mm = { id: 'pair-x', p1Key: ks[0], p2Key: ks[1], p1: P[ks[0]].name, p2: P[ks[1]].name, surface: 'Hard', date: '2026-11-26', tour: '' };
const near = (a, b) => Math.abs(a - b) < 5e-4;
function checks(M) {
  assert.ok(near(M.bo5FromBo3(0.85), 0.9023) && near(M.bo5FromBo3(0.765), 0.8167));
  assert.strictEqual(M.inferBestOf({ tour: 'US Open', qualifying: true }), 3);
  assert.strictEqual(M.inferBestOf({ tour: 'Wimbledon', tournamentRound: '1/64-finals' }), 5);
  const r3 = M.runModel(mm, { pairOnly: true, bestOf: 3 }), r5 = M.runModel(mm, { pairOnly: true, bestOf: 5 });
  const fc = r5.stage2.formatConversion;
  assert.ok(fc.applied);
  assert.ok(near(r5.stage2.adjustedP1, M.bo5FromBo3(fc.bo3.adjustedP1)) && r5.stage2.adjustedP1 !== fc.bo3.adjustedP1);
  assert.ok(near(r5.stage1.baseP1, M.bo5FromBo3(r3.stage1.baseP1)));
  assert.ok(near(r5.stage3.fair.p1.prob, M.bo5FromBo3(M.calibrate(fc.bo3.adjustedP1, require(path.join(ROOT, 'h2h-model/config')).calibration).p1)));
  const pin = { p1: 1.5, p2: 2.8 }, v = (1 / pin.p1) / (1 / pin.p1 + 1 / pin.p2), w = require(path.join(ROOT, 'h2h-model/config')).baseState.state2;
  const rm = M.runModel(Object.assign({}, mm, { tour: 'US Open', pinnacleOpen: pin }), {});
  assert.ok(near(rm.stage2.formatConversion.bo3.baseP1, w.blendedElo * rm.stage1.components.elo5050.p1 + w.surfaceElo * rm.stage1.components.eloSurface.p1 + w.market * M.bo3FromBo5(v)));
}
checks(load(SRC)); console.log('  ✓ the shipped model passes');
const MUTANTS = [
  ['conversion never on', 'const conv = bestOf === 5 &&', 'const conv = false &&'],
  ['p5 formula wrong (Bo3 formula)', 'const bo5OfSet = s => s * s * s * (10 - 15 * s + 6 * s * s);', 'const bo5OfSet = s => s * s * (3 - 2 * s);'],
  ['market anchor not turned into Bo3', '(conv ? bo3FromBo5(anchor.market) : anchor.market)', 'anchor.market'],
  ['convert before calibration', 'const cal = calibrate(adjustedP1, config.calibration);', 'const cal = calibrate(toFormat(adjustedP1), config.calibration);'],
  ['qualifying read as best of 5', 'return isGS && !qual ? 5 : 3;', 'return isGS ? 5 : 3;'],
  ['stage 2 shows the Bo3 figure', 'adjustedP1: round4(toFormat(adjustedP1)),\n', 'adjustedP1: round4(adjustedP1),\n'],
  ['base shown in Bo3 terms', 'baseP1: round4(toFormat(baseP1)),', 'baseP1: round4(baseP1),'],
];
let caught = 0;
for (const [name, a, b] of MUTANTS) {
  assert.ok(SRC.includes(a), 'anchor missing: ' + name);
  let red = false;
  try { checks(load(SRC.replace(a, b))); } catch (e) { red = true; }
  if (red) { caught++; console.log('  ✓ mutant caught: ' + name); } else console.log('  ✗ mutant SURVIVED: ' + name);
}
console.log(`format conversion mutants: ${caught} of ${MUTANTS.length} caught`);
process.exit(caught === MUTANTS.length ? 0 : 1);
