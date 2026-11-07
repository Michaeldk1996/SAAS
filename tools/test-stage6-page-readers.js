#!/usr/bin/env node
// Stage 6 (2026-11-07) — the page's profile readers on the slim roster (profile-roster.json).
// Executes the shipped accessor block (ppSlim / ppHas) and checks that every name / rank / "has a profile?" reader
// goes through it, so a roster player reads the same before his full profile is loaded as the eager file gave.
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'bsp-consult-dashboard.html'), 'utf8');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ---- the accessor block, executed as shipped
const a = HTML.indexOf('let profileRoster = null;'), b = HTML.indexOf('function ppHas(key)');
ok(a > 0 && b > a, 'accessor block present');
const block = HTML.slice(a, HTML.indexOf('\n', b) + 1);
const api = new Function('playerProfiles', block + '\nreturn { ppSlim, ppHas, set: r => { profileRoster = r; } };');
const store = {};
const A = api(store);
ok(A.ppSlim('2382') === null && !A.ppHas('2382'), 'nothing loaded -> null');
A.set({ 2382: { key: 2382, name: 'C. Alcaraz', rank: '1' } });
ok(A.ppSlim(2382).name === 'C. Alcaraz' && A.ppHas('2382'), 'roster entry answers (numeric key too)');
store['2382'] = { key: 2382, name: 'C. Alcaraz', careerByYear: [1] };
ok(A.ppSlim('2382') === store['2382'], 'a loaded full profile wins over the roster entry');
store['555'] = { key: 555, name: 'X. Shard' };
ok(A.ppHas('555') && !A.ppHas('556') && !A.ppHas(null), 'a shard-loaded non-roster profile counts; unknown / null do not');

// ---- every name / has-profile reader asks ppSlim first (MUTANT: any one reverted to the eager map alone goes red)
const SITES = [
  ['newsPlayerName', /function newsPlayerName\(key, fallback\)\{\n  const p = \(typeof ppSlim === 'function' \? ppSlim\(key\)/],
  ['newsHasProfile', /function newsHasProfile\(key\)\{[\s\S]{0,80}typeof ppSlim === 'function' \? ppSlim\(key\)/],
  ['intelResolveNote', /typeof ppSlim === 'function' \? ppSlim\(n\.playerKey\)/],
  ['openPlayerProfileFromMatch', /function openPlayerProfileFromMatch\(key\)\{\n  if \(key == null \|\| !\(typeof ppSlim === 'function'/],
  ['profileLinkAttrs', /const clickable = playerKey != null && \(typeof ppSlim === 'function' \? ppSlim\(playerKey\)/],
  ['edgeHasProfile', /function edgeHasProfile\(key\)\{ return key != null && !!\(typeof ppSlim === 'function'/],
  ['fhOpenProfile', /function fhOpenProfile\(key\)\{ if \(key != null && \(typeof ppSlim === 'function'/],
  ['sfH2hSide', /function sfH2hSide\(key, name\)\{ const p = key != null \? \(typeof ppSlim === 'function'/],
  ['fhFullName', /function fhFullName\(name, key\)\{ const p = key != null && \(typeof ppSlim === 'function'/],
  ['Players card', /const hasProfile = p\.key != null && \(typeof ppSlim === 'function' \? ppSlim\(p\.key\)/],
  ['pp2HasProfile', /return !!\(\(typeof ppSlim === 'function' \? ppSlim\(k\)/],
];
for (const [name, re] of SITES) ok(re.test(HTML), `${name} reads the roster through ppSlim`);
ok((HTML.match(/typeof ppSlim === 'function' \? ppSlim\(/g) || []).length >= 17, '>= 17 sites on ppSlim');
const TR = fs.readFileSync(path.join(__dirname, '..', 'trading-report.js'), 'utf8');
ok(/typeof ppSlim === 'function' \? ppSlim\(key\)/.test(TR), 'Trading Report hasProfile reads ppSlim');

// ---- the roster loads at boot, with the eager loaders' repaints
ok(/loadPlayerIndex\(\); loadProfileRoster\(\);/.test(HTML), 'boot loads profile-roster.json');
ok(/fetch\('\.\/profile-roster\.json'/.test(HTML), 'roster fetch');

// ---- step 3: roster-wide loops read ppRosterMap() (roster + any loaded profile), memoised
{
  const c = HTML.indexOf('let profileRoster = null;'), d = HTML.indexOf('function ppRosterMap(){');
  ok(d > c, 'ppRosterMap present');
  const blk = HTML.slice(c, HTML.indexOf('\n}\n', d) + 3);
  const st = {};
  const R = new Function('playerProfiles', blk + '\nreturn { ppRosterMap, set: r => { profileRoster = r; } };')(st);
  ok(Object.keys(R.ppRosterMap()).length === 0, 'empty before anything loads');
  R.set({ 2382: { key: 2382, name: 'C. Alcaraz' }, 1980: { key: 1980, name: 'A. Zverev' } });
  const m1 = R.ppRosterMap();
  ok(Object.keys(m1).join() === '1980,2382' && R.ppRosterMap() === m1, 'roster keys, numeric order, memoised');
  st['2382'] = { key: 2382, name: 'C. Alcaraz', careerByYear: [1] }; st['555'] = { key: 555, name: 'X. Shard' };
  const m2 = R.ppRosterMap();
  ok(m2 !== m1 && m2['2382'] === st['2382'] && m2['555'] && Object.keys(m2).length === 3, 'a loaded shard folds in and wins');
}
const RM_SITES = [
  ['News tags', /const _ppR = \(typeof ppRosterMap === 'function' \? ppRosterMap\(\)[^\n]*\n  if \(_ppR\)\{\n    for \(const \[key, v\] of Object\.entries\(_ppR\)\)/],
  ['intel roster', /if \(!_ppR\) return \[\];\n  const list = \[\];/],
  ['namesake count', /const pp = \(typeof ppRosterMap === 'function' \? ppRosterMap\(\)[^\n]*;\n  if \(_sfNkSrc !== pp/],
  ['Players search', /for \(const p of Object\.values\(\(typeof ppRosterMap === 'function' \? ppRosterMap\(\) : playerProfiles\)\)\)/],
  ['search lastTournament', /: \(p\.lastTournament !== undefined \? p\.lastTournament : null\),/],
  ['H2H page roster', /function buildH2HData\(\) \{\n    const profiles = DV\('profileRosterMap'\)/],
  ['H2H page ready', /function dataReady\(\) \{ const pp = DV\('profileRosterMap'\)/],
  ['H2H page loads', /\['loadProfileRoster', 'loadSurfaceRatings'/],
  ['Lines name -> key', /var _ppR = \(typeof ppRosterMap === 'function' \? ppRosterMap\(\)/],
];
for (const [name, re] of RM_SITES) ok(re.test(HTML), `${name} reads ppRosterMap`);
ok(!/\['loadPlayerProfiles', 'loadSurfaceRatings'/.test(HTML), 'the H2H page no longer asks for the eager file');
ok(/typeof ppRosterMap === 'function' \? Object\.keys\(ppRosterMap\(\)\)\.length/.test(fs.readFileSync(path.join(__dirname, '..', 'drops-page.js'), 'utf8')), 'Drops counts the roster');

console.log(`test-stage6-page-readers: ${n} checks passed`);
