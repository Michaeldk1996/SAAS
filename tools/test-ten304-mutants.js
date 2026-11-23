#!/usr/bin/env node
'use strict';
// TEN-304 Wave B · every Weather-tab rule test must FAIL on its named mutation of the real page source.
// Each mutant rewrites one anchor in a copy of bsp-consult-dashboard.html (TEN304_HTML), match-analysis-v2.js (target
// 'v2', TEN304_V2 — the 2026-11-23 renderer maWeatherV2) or build-weather.js ('bw' / 'bwt'), and runs the suite against it.
// A mutant is CAUGHT only when a test that PASSES on the shipped code fails on the mutant (a test that is red on the
// shipped code — a renderer gap — can never catch one). A mutant that survives is a vacuous test.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
// A 4th field 'bw' mutates build-weather.js instead (the test reads it through TEN304_BW).
const BW = fs.readFileSync(path.join(ROOT, 'build-weather.js'), 'utf8');
const V2 = fs.readFileSync(path.join(ROOT, 'match-analysis-v2.js'), 'utf8');
const MUTANTS = [
  ['null value reads as calm (no UNAVAILABLE)', "if (v == null) return 'u';", "if (v == null) return 'n';"],
  ['Q21: heat flag back to the value wording', "heat: { a: 'Heat — high', r: 'Heat — high' }, rain:", "heat: 'Feels like {v}°', rain:"],
  ['stale cut-off ignored', '!(ageH <= CF.staleHours.unavailable)', 'false'],
  ['badge in the viewer zone', 'const mp = wxLocalParts(startMs, zone);', "const mp = wxLocalParts(startMs, (typeof newsTz === 'function' && newsTz()) || 'UTC');"],
  ['playing window dropped', 'h >= CF.window.fromHour && h <= CF.window.toHour', 'true'],
  ['cut-offs hard-coded', 'const t = WX_CONFIG.thresholds[kind];', "const t = ({ gusts: { watch: 25, concern: 35 }, feels: { watch: 30, concern: 35 }, rain: { watch: 30, concern: 60 } })[kind];"],
  ['header without the start time', "return [ev, roundText, t].filter(Boolean).join(' · ');", "return [ev, roundText].filter(Boolean).join(' · ');"],
  ['missing time guessed as noon', 'const mp = wxLocalParts(startMs, zone);', "const mp = wxLocalParts(Number.isFinite(startMs) ? startMs : Date.parse(m.date + 'T12:00:00Z'), zone);"],
  ['test-only param accepts anything', "get('wxForce') === 'unavailable'", "get('wxForce') != null"],
  ['an UNAVAILABLE factor can lead', "function wxRank(s){ return s === 'r' ? 2 : s === 'a' ? 1 : 0; }", "function wxRank(s){ return s === 'r' || s === 'u' ? 2 : s === 'a' ? 1 : 0; }"],
  ['stale: last-update time dashed', "when: Number.isFinite(fetchedMs) ? wxStamp(fetchedMs, zone) : '—'", "when: '—'"],
  ['day card takes the window BEST value', 'const mx = a => a ? rnd(Math.max.apply(null, a)) : null;', 'const mx = a => a ? rnd(Math.min.apply(null, a)) : null;'],
  ['header time in UTC, not the viewer zone', "{ hour:'2-digit', minute:'2-digit', hour12:false, timeZone:newsTz() };", "{ hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'UTC' };"],
  ['shared tooltip delay 250 → 0 (TEN-303 initAOddsTips)', '_aoTipTimer = setTimeout(() => { if (_aoTipFor === el) aOddsTipShow(el); }, 250);', '_aoTipTimer = setTimeout(() => { if (_aoTipFor === el) aOddsTipShow(el); }, 0);'],
  ['shared tooltip ignores keyboard focus', "document.addEventListener('focusin', on); document.addEventListener('focusout', off);", "document.addEventListener('focusout', off);"],
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
  ['partial verdict loses its Missing: list', "missing: ['wind', 'heat', 'rain'].filter(id => sevOf(id) === 'u')", "missing: ['wind', 'heat', 'rain'].filter(id => true)", 'gap'],
  ['venue zone ignores the index tz (no file → viewer zone)', '(file && file.tz) || (entry && entry.tz) || null', '(file && file.tz) || null'],
  ['every match counted first on court (no note)', 'return !same.length || startMs <= Math.min.apply(null, same);', 'return true;'],
  ['no match counted first on court (note everywhere)', 'return !same.length || startMs <= Math.min.apply(null, same);', 'return false;'],
  // ESC brief 2026-10-21: the tooltip's Esc is a layer in esc-nav.js (one handler); the mutants target that layer.
  ['Escape no longer closes the shared tooltip', "close: () => aOddsTipHide(), always: () => { if (_aoTipFor) aOddsTipHide(); } });", "close: () => {}, always: () => {} });"],
  ['TEN-335: the tooltip ranked below the pop-up (the pop-up closes first)', "id: 'ao-tip', z: 100,", "id: 'ao-tip', z: 70,"],
  ['TEN-335: the tooltip never takes the press (one Esc closes tooltip and pop-up)', "return !!(_aoTipFor && t && t.style.display === 'block' && t.getClientRects().length); }", "return false; }"],
  ['TEN-335: a pending tooltip swallows the Esc', "return !!(_aoTipFor && t && t.style.display === 'block' && t.getClientRects().length); }", "return !!(_aoTipFor && t && t.getClientRects().length); }"],
  ['TEN-335: a tooltip in a closed modal swallows the Esc', "return !!(_aoTipFor && t && t.style.display === 'block' && t.getClientRects().length); }", "return !!(_aoTipFor && t && t.style.display === 'block'); }"],
  ['Download report prints "Loading forecast…"', 'if (wxEl && _aWxMatch && !(_aWx.ready && _aWx.m === _aWxMatch))', 'if (false)'],
  ['archive: a post-start fetch is archived', ' || !(fAt < m.startMs)) continue;', ') continue;', 'bwt'],
  ['archive: an older fetch replaces a newer one', 'const newer = old => !old || fAt > Date.parse(old.fetchedAt);', 'const newer = old => true;', 'bwt'],
  ['archive: a day archived after its window opened', '!(fAt < Math.min(...win.map(r => r.ms))) || ', '', 'bwt'],
  ['archive: the live copy is not carried', 'await readLiveArchive(SITE + v.archive, fetchImpl, log, retryDelayMs));', 'null);', 'bwt'],
  ['archive: a venue off the board loses its archive', 'const off = Object.keys(coords || {}).filter(', 'const off = [].filter(', 'bwt'],
  ['archive: a failed live read is not retried', 'for (let i = 0; i < 3; i++) {\n    try { const a = await getJson(url', 'for (let i = 2; i < 3; i++) {\n    try { const a = await getJson(url', 'bwt'],
  ['archive: a revised start keeps the old hour', '(moved && fAt >= Date.parse(old.fetchedAt))', 'false', 'bwt'],
  ['unavailable started match still says "forecast, not observed"', "(archived && !unavail ? ' · ' + CP.pastValues : '')", "(archived ? ' · ' + CP.pastValues : '')"],
  // the 2026-11-23 renderer (maWeatherV2): tokens, the R4 grey severity ladder, the neutral MATCH tag (the TEN-376 WX_C
  // mutants are gone with WX_C's use: the rebuilt tab does not read it)
  ['indoor early return removed', 'if (vm.indoor) return wrap(', 'if (false) return wrap(', 'v2'],
  ['CONCERN back to a red severity colour (founder R4: no severity colour)', "r: ['Concern', 'var(--ma2-text)']", "r: ['Concern', 'var(--ma2-red)']", 'v2'],
  ['WATCH on amber (amber is Model + Trading Report only, TEN-376 U3)', "a: ['Watch', 'var(--ma2-soft)']", "a: ['Watch', 'var(--amber)']", 'v2'],
  ['a literal colour in the Weather renderer', "n: ['No concern', 'var(--ma2-grey)']", "n: ['No concern', '#8B96B5']", 'v2'],
  ['Q1: the MATCH tag on the blue', "(d.isMatch ? 'var(--ma2-text)' : 'var(--ma2-quiet)') + '; min-height:15px", "(d.isMatch ? 'var(--ma2-blue)' : 'var(--ma2-quiet)') + '; min-height:15px", 'v2'],
  ['factor box hairline 0.5px', "border-radius:' + (o.small ? 11 : 12) + 'px; background:' + (lead ? 'var(--ma2-lifted)' : 'var(--ma2-inner)') + '; border:1px solid", "border-radius:' + (o.small ? 11 : 12) + 'px; background:' + (lead ? 'var(--ma2-lifted)' : 'var(--ma2-inner)') + '; border:0.5px solid", 'v2'],
  ['the lead factor is not lifted', 'wxBox(f, lead && f.id === lead.id)', 'wxBox(f, false)', 'v2'],
  ['the unavailable note dropped', 'const unav = vm.unavail ?', 'const unav = false ?', 'v2'],
  ['venue-time note printed with no venue zone', '(vm.venueZone ? CP.venueTimeNote : CP.viewerTimeNote)', 'CP.venueTimeNote', 'v2'],
  ['opened archived day loses "forecast, not observed"', "(d.past || vm.archived ? ' · forecast, not observed' : '')", "''", 'v2'],
  ['"may start later" note dropped from the render', '+ (vm.mayStartLater ?', '+ (false ?', 'v2'],
  ['match-day tag ignores the TBC badge', 'const tag = d.isMatch ? (vm.badge', "const tag = d.isMatch ? ('MATCH · 12:00'", 'v2'],
  ['court speed shown on an unavailable forecast', 'fig: vm.unavail ? DASH : sp', 'fig: sp', 'v2'],
  ['02:00Z placeholder read as a real start', "if (!(m && m.startTs != null && isFinite(Date.parse(m.startTs))) && isFinite(ms) && ((ms % 86400000) + 86400000) % 86400000 === 7200000) return NaN;", ''],
  ['build archives the placeholder hour', "return Number.isFinite(ms) && ((ms % 86400000) + 86400000) % 86400000 !== 7200000 ? ms : NaN;", 'return Number.isFinite(ms) ? ms : NaN;', 'bw'],
  ['archive: the committed copy is ignored', 'const prevArch = mergeArchives(readCommittedArchive(path.join(outDir, v.archive)), ', 'const prevArch = mergeArchives(null, ', 'bwt'],
  ['archive: the older of two copies wins', '(Date.parse(y.fetchedAt) > Date.parse(x.fetchedAt) ? y : x)', '(Date.parse(y.fetchedAt) > Date.parse(x.fetchedAt) ? x : y)', 'bwt'],
  // TEN-337 (re-verify against the TEN-312 design file)
  ["review item 3: \"usual\" back on a calm court pace", "    : shift === 'base' ? wxFmt(P.atBase, { speed: speedTxt, label: spdLabel ? ' (' + spdLabel + ')' : '' })", "    : shift === 'base' ? 'Conditions should leave the court playing close to its usual ' + speedTxt"],
  ['pace copy apostrophe curly, not the file\'s ASCII', "Today's {cause} should make it play", 'Today\u2019s {cause} should make it play'],
  ["review 2: pace base label dropped", "shift === 'base' ? P.base : P[shift]", "shift === 'base' ? '' : P[shift]"],
  ["review 2: pace base sentence dropped", "shift === 'base' ? wxFmt(P.atBase", "shift === 'base' ? '' && wxFmt(P.atBase"],
  ['review item 1: the THRESHOLDS chip back on the tab', "' + inner + '</div>';\n    const hq", "' + '<span class=\"wx-tbd\">THRESHOLDS TBD — MICHAEL</span>' + inner + '</div>';\n    const hq", 'v2'],
  ["review 2: calm layout prints no pace label", "stat: P.sevL ? P.sevL.charAt(0) + P.sevL.slice(1).toLowerCase() : ''", "stat: ''", 'v2'],
  ["review 2: LOW CONFIDENCE wraps", 'min-height:15px; white-space:nowrap;', 'min-height:15px;', 'v2'],
  ["review 2: LOW CONFIDENCE spills (no day-card floor)", 'minmax(116px, 1fr)', 'minmax(60px, 1fr)', 'v2'],
  ["review 2: match day keeps the window max", "  if (!unavail && hi >= 0) {\n    const md = days.find", "  if (false) {\n    const md = days.find"],
];
// per-test verdicts (TAP): a mutant is caught only by a test that is green on the shipped code
const SUITE = path.join(ROOT, 'test-ten304-weather-tab.mjs');
const verdicts = env => { const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', SUITE], { env, encoding: 'utf8' });
  const v = {}; for (const m of (r.stdout || '').matchAll(/^(not )?ok \d+ - (.*)$/gm)) v[m[2]] = !m[1]; return v; };
const BASE = verdicts(process.env);
const green = Object.keys(BASE).filter(k => BASE[k]), red = Object.keys(BASE).filter(k => !BASE[k]);
if (!green.length) { console.log('  FAIL  baseline: no test passes on the shipped code'); process.exit(1); }
if (red.length) console.log(`  note  ${red.length} test(s) red on the shipped code (renderer gaps), excluded as catchers:\n${red.map(t => '        - ' + t).join('\n')}`);
const bwtBase = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'test-ten304-build-weather.js')], { encoding: 'utf8' }).status;
if (bwtBase !== 0) { console.log('  FAIL  baseline: tools/test-ten304-build-weather.js is red on the shipped code'); process.exitCode = 1; }
let caught = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten304-mut-'));
for (const [name, from, to, target] of MUTANTS) {
  // 'gap' = a dashboard mutant whose only catcher is a test red on the shipped code (a renderer gap): it survives until the
  // renderer is fixed, and the run fails saying so
  const isBw = target === 'bw' || target === 'bwt', isV2 = target === 'v2';
  const base = isBw ? BW : isV2 ? V2 : SRC;
  if (base.split(from).length !== 2) { console.log(`  FAIL  anchor not unique/absent: ${name}`); process.exitCode = 1; continue; }
  const file = path.join(dir, isBw ? 'build-weather.js' : isV2 ? 'match-analysis-v2.js' : 'm.html');
  fs.writeFileSync(file, base.replace(from, to));
  const env = Object.assign({}, process.env, isBw ? { TEN304_BW: file } : isV2 ? { TEN304_V2: file } : { TEN304_HTML: file });
  let hit;
  // 'bwt' = a build-weather.js rule whose test is tools/test-ten304-build-weather.js
  if (target === 'bwt') hit = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'test-ten304-build-weather.js')], { env, encoding: 'utf8' }).status !== 0;
  else { const v = verdicts(env); hit = green.some(t => v[t] !== true); }
  if (hit) { caught++; console.log(`  PASS  caught: ${name}`); }
  else { console.log(`  FAIL  SURVIVED${target === 'gap' ? ' (its catcher is red on the shipped code: renderer gap)' : ''}: ${name}`); process.exitCode = 1; }
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${caught}/${MUTANTS.length} mutants caught`);
