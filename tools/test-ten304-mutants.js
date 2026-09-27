#!/usr/bin/env node
'use strict';
// TEN-304 Wave B · every Weather-tab rule test must FAIL on its named mutation of the real page source.
// Each mutant rewrites one anchor in a copy of bsp-consult-dashboard.html and runs
// test-ten304-weather-tab.mjs against it (TEN304_HTML). A mutant that survives is a vacuous test.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
// A 4th field 'bw' mutates build-weather.js instead (the test reads it through TEN304_BW).
const BW = fs.readFileSync(path.join(ROOT, 'build-weather.js'), 'utf8');
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
  ['an UNAVAILABLE factor can lead', "function wxRank(s){ return s === 'r' ? 2 : s === 'a' ? 1 : 0; }", "function wxRank(s){ return s === 'r' || s === 'u' ? 2 : s === 'a' ? 1 : 0; }"],
  ['stale: last-update time dashed', "when: Number.isFinite(fetchedMs) ? wxStamp(fetchedMs, zone) : '—'", "when: '—'"],
  ['day card takes the window BEST value', 'const mx = a => a ? rnd(Math.max.apply(null, a)) : null;', 'const mx = a => a ? rnd(Math.min.apply(null, a)) : null;'],
  ['header time in UTC, not the viewer zone', "{ hour:'2-digit', minute:'2-digit', hour12:false, timeZone:newsTz() };", "{ hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'UTC' };"],
  ['shared tooltip delay 250 → 0 (TEN-303 initAOddsTips)', '_aoTipTimer = setTimeout(() => { if (_aoTipFor === el) aOddsTipShow(el); }, 250);', '_aoTipTimer = setTimeout(() => { if (_aoTipFor === el) aOddsTipShow(el); }, 0);'],
  ['shared tooltip ignores keyboard focus', "document.addEventListener('focusin', on); document.addEventListener('focusout', off);", "document.addEventListener('focusout', off);"],
  ['Weather day card loses its shared tooltip', "tip = ' tabindex=\"0\"' + tipAttr(aOddsTipHtml(d.dow + ' ' + d.label, L));", "tip = '';"],
  ['DST: fixed-offset hourly labels kept as instants', 'new Date(t - off * 1000)', 'new Date(t)', 'bw'],
  ['DST: hours bucketed in UTC, not the venue zone', 'const p = wxLocalParts(ms, file.tz); return p ?', "const p = wxLocalParts(ms, 'UTC'); return p ?"],
  ['session cache never refetches a cached file', "  const age = nowMs - Date.parse(d.fetchedAt || '');\n  return !(age", "  const age = nowMs - Date.parse(d.fetchedAt || '');\n  return false && !(age"],
  ['matches reload does not re-read the index', '  _wxIndexStale = true;\n', '\n'],
  ['Download report prints before the Weather load', 'return Promise.race([Promise.resolve(wx), new Promise(r => setTimeout(r, 8000))])', 'return Promise.resolve()'],
  ['pace: UNAVAILABLE rain read as calm', "sevOf('rain') !== 'n' ? null : on('heat')", "false ? null : on('heat')"],
  ['old match day outside the file renders a dashed week', ' || uncovered;', ';'],
  ['indoor flag ignored', 'if (entry && entry.indoor === true) return { indoor: true };', ''],
];
let caught = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten304-mut-'));
for (const [name, from, to, target] of MUTANTS) {
  const base = target === 'bw' ? BW : SRC;
  if (base.split(from).length !== 2) { console.log(`  FAIL  anchor not unique/absent: ${name}`); process.exitCode = 1; continue; }
  const file = path.join(dir, target === 'bw' ? 'build-weather.js' : 'm.html');
  fs.writeFileSync(file, base.replace(from, to));
  const env = Object.assign({}, process.env, target === 'bw' ? { TEN304_BW: file } : { TEN304_HTML: file });
  const r = spawnSync(process.execPath, ['--test', path.join(ROOT, 'test-ten304-weather-tab.mjs')], { env, encoding: 'utf8' });
  if (r.status !== 0) { caught++; console.log(`  PASS  caught: ${name}`); }
  else { console.log(`  FAIL  SURVIVED: ${name}`); process.exitCode = 1; }
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${caught}/${MUTANTS.length} mutants caught`);
