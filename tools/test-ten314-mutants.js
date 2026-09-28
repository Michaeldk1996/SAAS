// TEN-314 — every check in test-ten314-modal-frame.mjs must FAIL when the behaviour it locks is reverted. Each
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
  ['D7: the print handler back on the item', '<span class="asidenav-download">', '<span class="asidenav-download" onclick="printAnalysisReport()">'],
  ['D7: a print call anywhere', 'function closeAnalysisModal(){', 'function aPrint(){ window.print(); }\nfunction closeAnalysisModal(){'],
  ['D5: the board chain (api-tennis / Wikimedia) in the modal', "src = atpPhotoFor(key);\n  return src", "src = photoCandidatesFor(key, null)[0];\n  return src"],
  ['lazy: every tab built at modal open', "  aShowTab(first);\n", "  aShowTab(first); Object.keys(A_TAB_BUILD).forEach(t => { _aBuilt.add(t); A_TAB_BUILD[t](m); });\n"],
  ['lazy: Key factors pre-loads the DNA file', 'Promise.all([ensureFormRows(m), ensureOddsMovement(m), loadStyleRadar(), ensurePsMatrix()])', 'Promise.all([ensureFormRows(m), ensureOddsMovement(m), loadStyleRadar(), ensurePsMatrix(), ensureMatchDna()])'],
  ['lazy: a revisit rebuilds', '  if (!_aBuilt.has(tab)) { _aBuilt.add(tab); A_TAB_BUILD[tab](_aM); }', '  if (true) { _aBuilt.add(tab); A_TAB_BUILD[tab](_aM); }'],
  ['lazy: the built set survives a new match', '  _aM = m; _aBuilt.clear();', '  _aM = m;'],
  ['frame: a LATER rule turns the height back into a max (review: first-rule reads missed it)', '  .modal-analysis{ background:#0A0D14;', '  .modal-analysis{ height:auto; max-height:88vh; background:#0A0D14;'],
  ['lazy: a late shard of the previous match repaints the new one', 'function aBuilt(m, tab){ return _aM === m && _aBuilt.has(tab); }', 'function aBuilt(m, tab){ return _aBuilt.has(tab); }'],
  ['revisit: Weather / Market edge hooks only on the first open', "  else if (A_TAB_REVISIT[tab]) A_TAB_REVISIT[tab]();\n", ''],
  ['direct tab: the completed-card path builds Key factors first', "  openAnalysisModal(id, 'matchstats');\n}", "  openAnalysisModal(id);\n  aGoTab('matchstats');\n}"],
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
  const r = spawnSync(process.execPath, ['--test', path.join(ROOT, 'test-ten314-modal-frame.mjs')], { env: Object.assign({}, process.env, { TEN314_HTML: file }), encoding: 'utf8' });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
