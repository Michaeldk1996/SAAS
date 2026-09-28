// TEN-314 — every check in test-ten314-modal-frame.mjs, test-ten314-sheet.mjs, test-ten314-gate.mjs and test-ten314-components.mjs must FAIL when the behaviour it locks is reverted. Each
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
  ['frame: the scrim dropped', '  #analysisModal{ background:var(--ma-scrim); }\n', ''],
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
  ['frame: a LATER rule turns the height back into a max (review: first-rule reads missed it)', '  .modal-analysis{ background:var(--ma-page);', '  .modal-analysis{ height:auto; max-height:88vh; background:var(--ma-page);'],
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
  ['esc: the sheet listener in the bubble phase', "if (ev.key === 'Escape' && _fh && _fh.sheet){ ev.stopPropagation(); fhCloseSheet(); } }, true);", "if (ev.key === 'Escape' && _fh && _fh.sheet){ ev.stopPropagation(); fhCloseSheet(); } });"],
  ['esc: the sheet lets Esc through to the pop-up', "if (ev.key === 'Escape' && _fh && _fh.sheet){ ev.stopPropagation(); fhCloseSheet(); }", "if (ev.key === 'Escape' && _fh && _fh.sheet){ fhCloseSheet(); }"],
  ['close: a Market edge pop-up survives closing the modal', " const mp = document.getElementById('mePop'); if (mp) mp.innerHTML = ''; }", " }"],
  ['report: H2H meetings not awaited', "    return fhEnsureH2hData(m).then(() => { if (aBuilt(m, 'h2h')) aPaint('aSectionH2H', buildH2HSection(m)); });", "    fhEnsureH2hData(m).then(() => { if (aBuilt(m, 'h2h')) aPaint('aSectionH2H', buildH2HSection(m)); });"],
  ['report: Form priced archives not awaited', "    return Promise.all([ensureFormRows(m), fhEnsureFormData(m)])", "    return Promise.all([ensureFormRows(m)])"],
  ['footer: the line put back', '      <div class="abody">', '      <div class="abody"><div class="aanalysisfooter">All stats are updated live.</div>'],
  ['bundle: mkPr in the deployed page', 'function closeAnalysisModal(){', 'function mkPr(){}\nfunction closeAnalysisModal(){'],
  ['bundle: SAMPLE_NEWS in the deployed page', 'function closeAnalysisModal(){', 'const SAMPLE_NEWS = [];\nfunction closeAnalysisModal(){'],
  // ---- test-ten314-gate.mjs (D2: one sample gate) ----
  ['gate: the nopct tier ends at 3', "  if (n < 5) return { mode: 'nopct' };", "  if (n < 3) return { mode: 'nopct' };"],
  ['gate: maGate keeps its own ladder', "function maGate(n){ return tourxSampleGate(n); }", "function maGate(n){ return n ? (n < 5 ? { mode: 'nopct' } : { mode: 'full' }) : { mode: 'none' }; }"],
  ['gate: the small tier not greyed', "  const col = R.mode === 'none' || small ? MA_GREY : o.color;", "  const col = R.mode === 'none' ? MA_GREY : o.color;"],
  ['gate: the small-sample note dropped', "  const note = small && o.note !== false && o.note !== 'title' ? maSmallNote() : '';", "  const note = '';"],
  ['gate: n = 0 renders 0%', "  if (g.mode === 'none') return { mode: 'none', txt: o.dash != null ? o.dash : '—' };", "  if (g.mode === 'none') return { mode: 'none', txt: '0%' };"],
  ['chip: H2H back to n === 2 only', "  const smallChip = maSmallChip(n);", "  const smallChip = n === 2 ? maSmallChip(n) : '';"],
  ['chip: no chip for n 1–4', "  if (m !== 'small' && m !== 'nopct') return '';", "  if (m !== 'small') return '';"],
  ['Key factors: Last N ungated', "<b>${maRateHtml(w10, last10.length, { nopct: `${w10}–${last10.length - w10}` })}</b>", "<b>${Math.round(w10 / last10.length * 100)}%</b>"],
  ['Market edge: band Won ungated', "${maRateHtml(b.w, n, { text: mePct0(b.won), nopct: '—', note: 'title' })}", "${mePct0(b.won)}"],
  ['Market edge: win bar drawn at any n', "const bar = maGateBar(b.w, n, ME_C.text), winW", "const bar = { w: n ? b.w / n * 100 : 0, color: ME_C.text, mode: 'full' }, winW"],
  ['Market edge: pop-up rate box loses its note', "big, R.mode === 'small'); };", "big, false); };"],
  ['Tournament: win rate "0%" at n = 0', "  const winPct = maRateHtml(history.totalWon, total, { color: recColor, note: false, cls: 'pct' });", "  const winPct = `<span class=\"pct\">${total > 0 ? Math.round(history.totalWon / total * 100) : 0}%</span>`;"],
  ['Tournament: bar drawn at any n', "  const winBar = maGateBar(history.totalWon, total, trackBar);", "  const winBar = { w: total ? history.totalWon / total * 100 : 0, color: trackBar };"],
  ['Overview: season rate ungated', "    const pct = maRateHtml(rec.won, n, { cls: 'rpct', note: 'title' });", "    const pct = `<span class=\"rpct\">${Math.round(rec.won / n * 100)}%</span>`;"],
  ['Playing style: header rate ungated', "  const pct = maRateHtml(w, n, { nopct: '' });\n  // Publish", "  const pct = Math.round((w / n) * 100) + '%';\n  // Publish"],
  ['Playing style: personal record keeps its own ladder', "  const gate = maGate(n).mode;\n  if (gate === 'none'){", "  const gate = n === 0 ? 'none' : n < 3 ? 'nopct' : n < 10 ? 'small' : 'full';\n  if (gate === 'none'){"],
  // ---- test-ten314-components.mjs (shared components) ----
  ['seg: sheet item radius 8', "item: 'padding:5px 12px; border-radius:7px; font-size:11px;' },", "item: 'padding:5px 12px; border-radius:8px; font-size:11px;' },"],
  ['seg: Market edge track padding 3', "  me: { track: 'gap:3px; padding:2px; border-radius:8px;',", "  me: { track: 'gap:3px; padding:3px; border-radius:8px;',"],
  ['seg: pbp tabs drawn in the scope geometry', "})), 'pbp') : '')", "}))) : '')"],
  ['seg: the selected tile dropped', "background:${on ? 'var(--seg-active)' : 'transparent'}; border:0.33px solid ${on ? 'var(--seg-active-line)'", "background:transparent; border:0.33px solid ${on ? 'var(--seg-active-line)'"],
  ['seg: the 140ms transition dropped', "  .ma-seg-item{ transition:background .14s ease, color .14s ease, border-color .14s ease; }\n", ''],
  ['seg: Market edge keeps its own markup', "function meSegHtml(items){ return maSeg('me', items); }", "function meSegHtml(items){ return items.map(t => t.label).join(''); }"],
  ['pop: radius 12', "border-radius:14px; padding:20px 22px 14px; display:flex; flex-direction:column; gap:16px;\">`", "border-radius:12px; padding:20px 22px 14px; display:flex; flex-direction:column; gap:16px;\">`"],
  ['pop: z-index 50', "z-index:${o.z || 85};", "z-index:${o.z || 50};"],
  ['pop: every inner click closes', "onclick=\"if(event.target===this){${o.onClose}}\"", "onclick=\"${o.onClose}\""],
  ['pop: Market edge keeps its own frame', "  return maPopFrame({ cls: 'me-pop', xCls: 'me-x',", "  return '<div class=\"me-pop-overlay\">' + inner + '</div>' || maPopFrame({ cls: 'me-pop', xCls: 'me-x',"],
  ['esc: closes the first frame, not the topmost', "const top = all && all.length ? all[all.length - 1] : null;", "const top = all && all.length ? all[0] : null;"],
  ['esc: the listener never registered', "document.addEventListener('keydown', maPopEscKey);\n", ''],
  ['motion: sigIn 300ms', ".ma-sigin{ animation:sigIn .2s cubic-bezier(.2,.7,.3,1); }", ".ma-sigin{ animation:sigIn .3s cubic-bezier(.2,.7,.3,1); }"],
  ['motion: the frame without sigIn', "<div class=\"ma-pop ma-sigin${c ? ' ' + c : ''}\"", "<div class=\"ma-pop${c ? ' ' + c : ''}\""],
  ['motion: a re-render replays the entrance', "  if (popKey && popKey === E._popKey) maPopNoReplay(host);\n", ''],
  ['rows: README grid instead of the file\'s', "const MA_ROW_COLS = '48px 12px minmax(0,1.1fr) 36px 40px minmax(0,1.3fr) 46px 46px';", "const MA_ROW_COLS = '52px 14px minmax(0,1fr) 44px 56px minmax(0,1.2fr) 56px 56px';"],
  ['rows: header not sticky', "<div class=\"ma-rows-head\" style=\"position:sticky; top:0;", "<div class=\"ma-rows-head\" style=\"position:relative; top:0;"],
  ['rows: a row loses its sheet opener', "<div class=\"seg ma-row\"${r.click || ''}", "<div class=\"seg ma-row\""],
  ['tip: 200ms opacity', "transition:opacity .12s ease; pointer-events:none;\n    background:var(--ma-raised, var(--popup));", "transition:opacity .2s ease; pointer-events:none;\n    background:var(--ma-raised, var(--popup));"],
  ['tip: the helper drops the class pair', "<span class=\"elotip-pop\" role=\"tooltip\"", "<span class=\"tip-pop\" role=\"tooltip\""],
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
const SUITES = ['test-ten314-modal-frame.mjs', 'test-ten314-sheet.mjs', 'test-ten314-gate.mjs', 'test-ten314-components.mjs'];
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten314-mut-'));
for (const [name, from, to] of MUTANTS) {
  const m = apply(html, name, from, to);
  if (m == null) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, m);
  const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, { TEN314_HTML: file }), encoding: 'utf8' });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
