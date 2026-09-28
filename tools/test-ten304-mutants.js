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
  // founder rulings, 27 Sep 06:54Z
  ['started match reads the CURRENT forecast file', 'const archived = wxStarted(m, nowMs);', 'const archived = false;'],
  ['archived match loses "forecast, not observed"', "(archived && !unavail ? ' · ' + CP.pastValues : '')", "''"],
  ['partial verdict loses its Missing: list', "missing: ['wind', 'heat', 'rain'].filter(id => sevOf(id) === 'u')", "missing: ['wind', 'heat', 'rain'].filter(id => true)"],
  ['venue zone ignores the index tz (no file → viewer zone)', '(file && file.tz) || (entry && entry.tz) || null', '(file && file.tz) || null'],
  ['every match counted first on court (no note)', 'return !same.length || startMs <= Math.min.apply(null, same);', 'return true;'],
  ['no match counted first on court (note everywhere)', 'return !same.length || startMs <= Math.min.apply(null, same);', 'return false;'],
  ['Escape no longer closes the shared tooltip', "document.addEventListener('keydown', e => { if (e.key === 'Escape' && _aoTipFor) aOddsTipHide(); });", ''],
  ['Download report prints "Loading forecast…"', 'if (wxEl && _aWxMatch && !(_aWx.ready && _aWx.m === _aWxMatch))', 'if (false)'],
  ['archive: a post-start fetch is archived', ' || !(fAt < m.startMs)) continue;', ') continue;', 'bwt'],
  ['archive: an older fetch replaces a newer one', 'const newer = old => !old || fAt > Date.parse(old.fetchedAt);', 'const newer = old => true;', 'bwt'],
  ['archive: a day archived after its window opened', '!(fAt < Math.min(...win.map(r => r.ms))) || ', '', 'bwt'],
  ['archive: the live copy is not carried', 'await readLiveArchive(SITE + v.archive, fetchImpl, log, retryDelayMs));', 'null);', 'bwt'],
  ['archive: a venue off the board loses its archive', 'const off = Object.keys(coords || {}).filter(', 'const off = [].filter(', 'bwt'],
  ['archive: a failed live read is not retried', 'for (let i = 0; i < 3; i++) {\n    try { const a = await getJson(url', 'for (let i = 2; i < 3; i++) {\n    try { const a = await getJson(url', 'bwt'],
  ['archive: a revised start keeps the old hour', '(moved && fAt >= Date.parse(old.fetchedAt))', 'false', 'bwt'],
  ['unavailable started match still says "forecast, not observed"', "(archived && !unavail ? ' · ' + CP.pastValues : '')", "(archived ? ' · ' + CP.pastValues : '')"],
  ['WX_C text on the 12a name, not its role token (TEN-314 D1)', "  text: 'var(--ma-t1)',              // primary", "  text: 'var(--text)',              // primary"],
  ['WX_C text back to the spec literal', "  text: 'var(--ma-t1)',              // primary", "  text: '#E7E9EE',              // primary"],
  ['WX_C CONCERN back to the Weather red literal (U10)', "  red: 'var(--ma-neg)',", "  red: '#E0616F',"],
  ['WX_C amber leaks onto a non-severity colour', "  tagBd: 'var(--ma-hair-hover)',", "  tagBd: 'var(--ma-amber)',"],
  ['MATCH badge fill on the link token', "background:' + C.matchFill + '; border-radius:4px;", "background:' + C.match + '; border-radius:4px;"],
  ['WX_C hairline mapped through 12a again', "  hw: '1.25px',", "  hw: '0.33px',"],
  ['02:00Z placeholder read as a real start', "if (!(m && m.startTs != null && isFinite(Date.parse(m.startTs))) && isFinite(ms) && ((ms % 86400000) + 86400000) % 86400000 === 7200000) return NaN;", ''],
  ['build archives the placeholder hour', "return Number.isFinite(ms) && ((ms % 86400000) + 86400000) % 86400000 !== 7200000 ? ms : NaN;", 'return Number.isFinite(ms) ? ms : NaN;', 'bw'],
  ['archive: the committed copy is ignored', 'const prevArch = mergeArchives(readCommittedArchive(path.join(outDir, v.archive)), ', 'const prevArch = mergeArchives(null, ', 'bwt'],
  ['archive: the older of two copies wins', '(Date.parse(y.fetchedAt) > Date.parse(x.fetchedAt) ? y : x)', '(Date.parse(y.fetchedAt) > Date.parse(x.fetchedAt) ? x : y)', 'bwt'],
  ['archived day tooltip shows the match row fetch time', '[TP.fetched, wxStamp(d.fetchedMs, vm.zone)]', '[TP.fetched, wxStamp(vm.fetchedMs, vm.zone)]'],
];
let caught = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten304-mut-'));
for (const [name, from, to, target] of MUTANTS) {
  const isBw = target === 'bw' || target === 'bwt';
  const base = isBw ? BW : SRC;
  if (base.split(from).length !== 2) { console.log(`  FAIL  anchor not unique/absent: ${name}`); process.exitCode = 1; continue; }
  const file = path.join(dir, isBw ? 'build-weather.js' : 'm.html');
  fs.writeFileSync(file, base.replace(from, to));
  const env = Object.assign({}, process.env, isBw ? { TEN304_BW: file } : { TEN304_HTML: file });
  // 'bwt' = a build-weather.js rule whose test is tools/test-ten304-build-weather.js
  const args = target === 'bwt' ? [path.join(ROOT, 'tools', 'test-ten304-build-weather.js')] : ['--test', path.join(ROOT, 'test-ten304-weather-tab.mjs')];
  const r = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
  if (r.status !== 0) { caught++; console.log(`  PASS  caught: ${name}`); }
  else { console.log(`  FAIL  SURVIVED: ${name}`); process.exitCode = 1; }
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${caught}/${MUTANTS.length} mutants caught`);
