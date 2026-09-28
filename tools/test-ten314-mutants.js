// TEN-314 — every check in test-ten314-modal-frame.mjs and test-ten314-sheet.mjs must FAIL when the behaviour it locks is reverted. Each
// mutant is applied to a copy of bsp-consult-dashboard.html and the suite is run against it (TEN314_HTML); a
// mutant that leaves the suite green is a vacuous test and fails this runner.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
  ['frame: README max-width 1200', 'font-family:var(--mx-font-ui); max-width:1500px;', 'font-family:var(--mx-font-ui); max-width:1200px;'],
  ['frame: height a max, not fixed', 'max-width:1500px; width:100%; height:88vh;', 'max-width:1500px; width:100%; max-height:88vh;'],
  ['frame: radius 12', 'border-width:1px; border-style:solid; border-radius:20px;', 'border-width:1px; border-style:solid; border-radius:12px;'],
  ['frame: overlay z 100, no blur', '#analysisModal{ z-index:80; padding:32px; backdrop-filter:blur(3px);', '#analysisModal{ z-index:100; padding:32px; backdrop-filter:none;'],
  ['frame: nav 196', 'display:grid; grid-template-columns:238px 1fr;', 'display:grid; grid-template-columns:196px 1fr;'],
  ['frame: header flex, not the 1fr auto 1fr grid', '.modal-analysis .ahead2{ display:grid; grid-template-columns:1fr auto 1fr;', '.modal-analysis .ahead2{ display:grid; grid-template-columns:1fr 1fr;'],
  ['frame: the design scrim dropped', '  #analysisModal{ background:rgba(4,5,8,0.72); }\n', ''],
  ['menu: two tabs swapped', '(News|Playing style)', '(News|Playing style)'],
  ['menu: the old stroke-2 icon on Form', '<path d="M3 16l5-5 3 3 6-7" stroke="currentColor" stroke-width="1.7"', '<path d="M3 16l5-5 3 3 6-7" stroke="currentColor" stroke-width="2"'],
  ['report: the item loses its print handler', '<span class="asidenav-download" onclick="printAnalysisReport()">', '<span class="asidenav-download">'],
  ['report: printAnalysisReport no longer prints', '    window.print();\n  });\n}', '  });\n}'],
  ['report: unopened tabs are not built first', "    if (t === 'marketedge' || _aBuilt.has(t)) return;", "    return;"],
  ['report: prints without building the unopened tabs', "  const built = typeof aBuildForReport === 'function' ? aBuildForReport() : null;", "  const built = null;"],
  ['report: does not wait for the tab loads', "  const wx = Promise.all([typeof openWeatherTab === 'function' ? openWeatherTab() : null, built]);", "  const wx = Promise.all([typeof openWeatherTab === 'function' ? openWeatherTab() : null]);"],
  ['report: the Odds load no longer awaited', "    return ensureOddsMovement(m).then(() => { if (_aOdds.m === m && aBuilt(m, 'odds')) renderOddsSection(); });", "    ensureOddsMovement(m).then(() => { if (_aOdds.m === m && aBuilt(m, 'odds')) renderOddsSection(); });"],
  ['report: a throwing builder stops the print', "    loads.push(new Promise(r => r(A_TAB_BUILD[t](_aM))).catch(", "    loads.push(Promise.resolve(A_TAB_BUILD[t](_aM)).catch("],
  ['report: Market edge built into the report', "    if (t === 'marketedge' || _aBuilt.has(t)) return;", "    if (_aBuilt.has(t)) return;"],
  ['D5: the board chain (api-tennis / Wikimedia) in the modal', "src = atpPhotoFor(key);\n  return src", "src = photoCandidatesFor(key, null)[0];\n  return src"],
  ['lazy: every tab built at modal open', "  aShowTab(first);\n", "  aShowTab(first); Object.keys(A_TAB_BUILD).forEach(t => { _aBuilt.add(t); A_TAB_BUILD[t](m); });\n"],
  ['lazy: Key factors pre-loads the DNA file', 'Promise.all([ensureFormRows(m), ensureOddsMovement(m), loadStyleRadar(), ensurePsMatrix()])', 'Promise.all([ensureFormRows(m), ensureOddsMovement(m), loadStyleRadar(), ensurePsMatrix(), ensureMatchDna()])'],
  ['lazy: a revisit rebuilds', '  if (!_aBuilt.has(tab)) { _aBuilt.add(tab); A_TAB_BUILD[tab](_aM); }', '  if (true) { _aBuilt.add(tab); A_TAB_BUILD[tab](_aM); }'],
  ['lazy: the built set survives a new match', '  _aM = m; _aBuilt.clear();', '  _aM = m;'],
  ['frame: a LATER rule turns the height back into a max (review: first-rule reads missed it)', '  .modal-analysis{ background:#0A0D14;', '  .modal-analysis{ height:auto; max-height:88vh; background:#0A0D14;'],
  ['lazy: a late shard of the previous match repaints the new one', 'function aBuilt(m, tab){ return _aM === m && _aBuilt.has(tab); }', 'function aBuilt(m, tab){ return _aBuilt.has(tab); }'],
  ['revisit: Weather / Market edge hooks only on the first open', "  else if (A_TAB_REVISIT[tab]) A_TAB_REVISIT[tab]();\n", ''],
  ['direct tab: the completed-card path builds Key factors first', "  openAnalysisModal(id, 'matchstats');\n}", "  openAnalysisModal(id);\n  aGoTab('matchstats');\n}"],
  ['sheet: a Key stats row dropped', "    row('Winners / unforced errors', wue(win.a, ue.a), wue(win.b, ue.b), 'ratio'),\n", ''],
  ['sheet: W / total points over own points won', "  const tp = [tpw.a, tpw.b].map(c => c.total).find(t => t > 0) || null;", "  const tp = tpw.a.won || null;"],
  ['sheet: no stats back to the message-only state', "  const M = fhSheetModel(joined || null);\n  const head = fhSheetSectionHead;", "  if (!joined) return `<div>${fhEsc(emptyMsg)}</div>`;\n  const M = fhSheetModel(joined || null);\n  const head = fhSheetSectionHead;"],
  ['sheet: the not-available note dropped', "  const note = !joined ? maSheetNaNote()", "  const note = !joined ? ''"],
  ['sheet: opens on Match, not Key stats', "\n    scope: 'key', nSets:", "\n    scope: 'match', nSets:"],
  ['sheet: tabs lose their slot', "onclick: `fhSheetScope('key','${sl}')` }];", "onclick: `fhSheetScope('key')` }];"],
  ['sheet: initials in rings (D5 undone)', "  const av = (name, key) => `<span class=\"fh-av\">${aAvatarHtml(name, key)}</span>`;", "  const av = (name, key) => `<span class=\"fh-av\">${fhEsc(fhIni(name))}</span>`;"],
  ['sheet: inline copy keeps the set chips', "  const chips = o.inline ? '' : (r.sets || [])", "  const chips = (r.sets || [])"],
  ['sheet: Match Stats tab back to the old stat sheet', "  if (hasPointLog) return maMsSheetHtml(m);\n", ''],
  ['sheet: Match Stats inline never filled', "buildMatchStatsSection(m)); maMsSheetInit(m); },", "buildMatchStatsSection(m)); },"],
  ['sheet: Market edge rows gated on stats on file again', "<div class=\"seg me-row\" data-me-row=\"${r.mid}\" onclick=\"meOpenRow('${r.mid}')\"", "<div class=\"seg me-row\" data-me-row=\"${r.mid}\"${r.ek ? ` onclick=\"meOpenRow('${r.mid}')\"` : ''}"],
  ['sheet: Overview drill rows do not open', "    const click = maRowOnclick({ key: playerKey,", "    const click = '' && maRowOnclick({ key: playerKey,"],
  ['sheet: Tournament rows do not open', "  const click = maRowOnclick({ key: opts.playerKey,", "  const click = '' && maRowOnclick({ key: opts.playerKey,"],
  ['sheet: an unplaced row opens nothing', "    let r;\n    if (i >= 0) r = meRowFromCareer(", "    let r;\n    if (i < 0) return;\n    if (i >= 0) r = meRowFromCareer("],
  ['sheet: exact name keys on the date join', "  return lo.length >= 4 && hi.endsWith(lo);\n}\nlet _maRowReq", "  return false;\n}\nlet _maRowReq"],
  ['sheet: one of two same-date candidates accepted', "      if (hits.length === 1) i = hits[0];", "      if (hits.length) i = hits[0];"],
  ['sheet: a late fetch opens into a closed modal', "    if (_aM !== m || req !== _maRowReq || !document.getElementById('analysisModal').classList.contains('open')) return;", "    if (_aM !== m) return;"],
  ['report: Match Stats prints Key stats only', "  if (typeof _maMsSheet !== 'undefined' && _maMsSheet){ _maMsSheet.scope = 'match'; fhSheetRender('tab'); }\n", ''],
  ['footer: the line put back', '      <div class="abody">', '      <div class="abody"><div class="aanalysisfooter">All stats are updated live.</div>'],
  ['bundle: mkPr in the deployed page', 'function closeAnalysisModal(){', 'function mkPr(){}\nfunction closeAnalysisModal(){'],
  ['bundle: SAMPLE_NEWS in the deployed page', 'function closeAnalysisModal(){', 'const SAMPLE_NEWS = [];\nfunction closeAnalysisModal(){'],
];
// "two tabs swapped" is a structural mutant: swap the News and Playing style menu rows.
function apply(src, name, from, to) {
  if (name === 'menu: two tabs swapped') {
    const a = src.indexOf('<div class="asidenav-item" data-atab="news">'), b = src.indexOf('<div class="asidenav-item" data-atab="style">');
    const endA = src.indexOf('</div>', a) + 6, endB = src.indexOf('</div>', b) + 6;
    if (a < 0 || b < 0) return null;
    return src.slice(0, a) + src.slice(b, endB) + src.slice(endA, b) + src.slice(a, endA) + src.slice(endB);
  }
  if (src.split(from).length !== 2) return null;
  return src.replace(from, to);
}
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten314-mut-'));
for (const [name, from, to] of MUTANTS) {
  const m = apply(html, name, from, to);
  if (m == null) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, m);
  const r = spawnSync(process.execPath, ['--test', path.join(ROOT, 'test-ten314-modal-frame.mjs'), path.join(ROOT, 'test-ten314-sheet.mjs')], { env: Object.assign({}, process.env, { TEN314_HTML: file }), encoding: 'utf8' });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
