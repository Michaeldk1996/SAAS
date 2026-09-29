#!/usr/bin/env node
// TEN-328 — re-source the DNA file's Under-pressure axis from surface-ratings.json
// WITHOUT re-fetching box scores (no api-tennis calls). It runs the builder's own
// sourceUnderPressure() + assignPercentiles() over the committed
// dna-apitennis-ratings.json, so the result is what the next dna-ratings.yml run
// would write for that axis. Use it after surface-ratings.json changes out of
// schedule (a manual surface-ratings.yml dispatch), or to land a builder change to
// this axis without waiting for the 06:40 / 18:40 UTC rebuild.
//
//   node tools/dna-up-from-surface-ratings.js [--dna <file>] [--sr <file>] [--out <file>]
'use strict';
const fs = require('fs');
const path = require('path');
const dna = require('../dna-apitennis-ratings.js');

const ROOT = path.join(__dirname, '..');
function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const DNA_FILE = arg('--dna', path.join(ROOT, 'dna-apitennis-ratings.json'));
const SR_FILE = arg('--sr', path.join(ROOT, 'surface-ratings.json'));
const OUT = arg('--out', DNA_FILE);

const file = JSON.parse(fs.readFileSync(DNA_FILE, 'utf8'));
const rated = file.players || [];
if (!rated.length) throw new Error(`${DNA_FILE} has no players`);
const sr = dna.loadSurfaceRatings(SR_FILE);
const joined = dna.sourceUnderPressure(rated, sr);
const { percentiles, eloPercentiles } = dna.assignPercentiles(rated);
const meta = file._meta || {};
meta.lockedFormulas = Object.assign({}, meta.lockedFormulas, {
  underPressure: 'copied from surface-ratings.json (TEN-328: one builder, floors, 3-of-4 -> mean*4 estimated:true, Challenger fold-in x0.9); last52 <- last52, sinceBase <- career',
});
meta.underPressureSource = dna.underPressureMeta(sr, joined, rated);
meta.percentiles = percentiles;
meta.eloPercentiles = eloPercentiles;
file._meta = meta;
fs.writeFileSync(OUT, JSON.stringify(file, null, 1));
console.log(`WROTE ${path.relative(ROOT, OUT)} — Under pressure from surface-ratings.json ` +
  `(${sr.generatedAt}): ${joined} of ${rated.length} rated players joined`);
