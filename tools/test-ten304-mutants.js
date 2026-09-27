#!/usr/bin/env node
'use strict';
// TEN-304 Wave B · every Weather-tab rule test must FAIL on its named mutation of the real page source.
// Each mutant rewrites one anchor in a copy of bsp-consult-dashboard.html and runs
// test-ten304-weather-tab.mjs against it (TEN304_HTML). A mutant that survives is a vacuous test.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
  ['null value reads as calm (no UNAVAILABLE)', "if (v == null) return 'u';", "if (v == null) return 'n';"],
  ['indoor early return removed', 'if (vm.indoor) {', 'if (false) {'],
  ['stale cut-off ignored', '!(ageH <= CF.staleHours.unavailable)', 'false'],
  ['badge in the viewer zone', 'const mp = wxLocalParts(startMs, zone);', "const mp = wxLocalParts(startMs, (typeof newsTz === 'function' && newsTz()) || 'UTC');"],
  ['playing window dropped', 'h >= CF.window.fromHour && h <= CF.window.toHour', 'true'],
  ['cut-offs hard-coded', 'const t = WX_CONFIG.thresholds[kind];', "const t = ({ gusts: { watch: 25, concern: 35 }, feels: { watch: 30, concern: 35 }, rain: { watch: 30, concern: 60 } })[kind];"],
  ['header without the start time', "return [m.tour, roundText, t].filter(Boolean).join(' · ');", "return [m.tour, roundText].filter(Boolean).join(' · ');"],
  ['missing time guessed as noon', 'const mp = wxLocalParts(startMs, zone);', "const mp = wxLocalParts(Number.isFinite(startMs) ? startMs : Date.parse(m.date + 'T12:00:00Z'), zone);"],
  ['test-only param accepts anything', "get('wxForce') === 'unavailable'", "get('wxForce') != null"],
];
let caught = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten304-mut-'));
for (const [name, from, to] of MUTANTS) {
  if (SRC.split(from).length !== 2) { console.log(`  FAIL  anchor not unique/absent: ${name}`); process.exitCode = 1; continue; }
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, SRC.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', path.join(ROOT, 'test-ten304-weather-tab.mjs')], { env: Object.assign({}, process.env, { TEN304_HTML: file }), encoding: 'utf8' });
  if (r.status !== 0) { caught++; console.log(`  PASS  caught: ${name}`); }
  else { console.log(`  FAIL  SURVIVED: ${name}`); process.exitCode = 1; }
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${caught}/${MUTANTS.length} mutants caught`);
