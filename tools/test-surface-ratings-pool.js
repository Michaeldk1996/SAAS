#!/usr/bin/env node
'use strict';
// surface-ratings.js pool (founder 2026-11-18): every player with a served profile, named as
// his profile names him, ranked by the live index — never the committed July
// player-profiles.json. Each check has a mutant that must turn it red.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const SRC = path.join(__dirname, '..', 'surface-ratings.js');
const SHIPPED = fs.readFileSync(SRC, 'utf8');
function load(src) { const m = new Module(SRC, module); m.filename = SRC; m.paths = Module._nodeModulePaths(path.dirname(SRC)); m._compile(src, SRC); return m.exports; }

const idx = [
  { key: 52682, name: 'Felix Balshaw', rank: 180, hasProfile: true },
  { key: 2072, name: 'Jannik Sinner', rank: 2, hasProfile: true },
  { key: 9, name: 'No Profile', rank: 300, hasProfile: false },
  { key: 7, name: 'Shard Missing', rank: 301, hasProfile: true },
];
const shards = new Map([
  ['52682', JSON.stringify({ key: 52682, profile: { name: 'F. Balshaw', rank: 999 } })],
  ['2072', JSON.stringify({ key: 2072, profile: { name: 'J. Sinner', rank: 1 } })],
  ['9', JSON.stringify({ key: 9, profile: { name: 'N. Profile' } })],
]);
function check(m) {
  const pool = m.buildPool(idx, shards);
  assert.deepStrictEqual(pool.map(p => [p.key, p.name, p.rank]), [['52682', 'F. Balshaw', 180], ['2072', 'J. Sinner', 2]]);
  assert.deepStrictEqual(pool[0].surname, ['balshaw']);
  assert.ok(!/require\('\.\/player-profiles\.json'\)\.players/.test(SHIPPED), 'the July committed file no longer feeds the pool');
}
let fails = 0;
try { check(load(SHIPPED)); console.log('  ok    pool = served profiles, profile name, live rank'); } catch (e) { fails++; console.error('  FAIL ', e.message); }
for (const [label, from, to] of [
  ['hasProfile ignored', '    if (!p || !p.hasProfile) continue;', '    if (!p) continue;'],
  ['rank from the profile shard', 'rank: parseInt(p.rank, 10)', 'rank: parseInt((JSON.parse(text).profile || {}).rank, 10)'],
  ['index name, not profile name', "const nm = (JSON.parse(text).profile || {}).name;", 'const nm = p.name;'],
]) {
  assert.ok(SHIPPED.includes(from), 'mutant anchor missing: ' + label);
  let red = false; try { check(load(SHIPPED.replace(from, to))); } catch (e) { red = true; }
  if (red) console.log('  ok    mutant caught: ' + label); else { fails++; console.error('  FAIL  mutant survived: ' + label); }
}
console.log(fails ? `${fails} failed` : 'surface-ratings pool: all checks pass');
process.exit(fails ? 1 : 0);
