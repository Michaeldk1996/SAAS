// 2026-11-23 rebuild: mutants marked 'v2' apply to match-analysis-v2.js (TEN314_V2); 'html@N' = the Nth copy of an anchor.
// TEN-314 — every check in test-ten314-modal-frame.mjs, test-ten314-sheet.mjs, test-ten314-gate.mjs, test-ten314-components.mjs and test-ten314-tokens.mjs must FAIL when the behaviour it locks is reverted. Each
// mutant is applied to a copy of bsp-consult-dashboard.html and the suite is run against it (TEN314_HTML); a
// mutant that leaves the suite green is a vacuous test and fails this runner.
// TEN-376: the modal's own token file (match-analysis-tokens.css) is gone; 'css' mutants now apply to tokens.css.
// TEN314_MUT_BASE: run the mutants on another copy of the page (e.g. a candidate fix) instead of the working tree's.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const BASE = process.env.TEN314_MUT_BASE || path.join(ROOT, 'bsp-consult-dashboard.html');
const html = fs.readFileSync(BASE, 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'tokens.css'), 'utf8');
// 2026-11-23 rebuild: the tab renderers live in match-analysis-v2.js; 'v2' mutants apply there (TEN314_V2).
const V2 = path.join(ROOT, 'match-analysis-v2.js'), v2 = fs.readFileSync(V2, 'utf8');
// Checks that lock a still-valid rule the rebuilt renderer breaks (renderer gaps, reported): red on the unmutated page.
// They are allowed red at baseline and judge no mutant; every OTHER check must be green at baseline.
const KNOWN_GAPS = [];   // G8 (Esc on an opened box) and G9 (band box note) fixed in ma-v2 49127571f
const MUTANTS = [
  ['frame: README max-width 1200', 'font-family:var(--mx-font-ui); max-width:1500px;', 'font-family:var(--mx-font-ui); max-width:1200px;'],
  ['frame: height a max, not fixed', 'max-width:1500px; width:100%; height:calc(88vh / var(--sf-z, 1));', 'max-width:1500px; width:100%; max-height:calc(88vh / var(--sf-z, 1));'],
  ['frame: radius 12', 'border-width:1px; border-style:solid; border-radius:20px;', 'border-width:1px; border-style:solid; border-radius:12px;'],
  // TEN-376: the dead-CSS pass removed the overridden blur from this rule; the live blur is the scrim rule's (own mutant below)
  ['frame: overlay z 100', '#analysisModal{ z-index:80; padding:32px; -webkit-backdrop-filter:blur(3px); }', '#analysisModal{ z-index:100; padding:32px; -webkit-backdrop-filter:blur(3px); }'],
  ['frame: overlay no blur', '#analysisModal{ background:var(--backdrop); backdrop-filter:blur(3px); }', '#analysisModal{ background:var(--backdrop); backdrop-filter:none; }'],
  ['frame: nav 196', 'display:grid; grid-template-columns:238px 1fr;', 'display:grid; grid-template-columns:196px 1fr;'],
  ['frame: header flex, not the 1fr auto 1fr grid', '.modal-analysis .ahead2{ display:grid; grid-template-columns:1fr auto 1fr;', '.modal-analysis .ahead2{ display:grid; grid-template-columns:1fr 1fr;'],
  ['frame: the scrim dropped', '  #analysisModal{ background:var(--backdrop); backdrop-filter:blur(3px); }\n', ''],
  ['menu: two tabs swapped', '(News|Playing style)', '(News|Playing style)'],
  ['menu: the old stroke-2 icon on Form', '<path d="M3 16l5-5 3 3 6-7" stroke="currentColor" stroke-width="1.7"', '<path d="M3 16l5-5 3 3 6-7" stroke="currentColor" stroke-width="2"'],
  // founder 2026-11-23: the Download report item is removed from the side list (design README L21)
  ['report: the Download item put back in the side list', '<div class="asidenav" id="aTabs">', '<div class="asidenav" id="aTabs"><span class="asidenav-download" onclick="printAnalysisReport()"></span>'],
  // (D7 2026-11-23: printAnalysisReport is no longer reachable from the box — its print mutant is dropped with the check)
  ['report: unopened tabs are not built first', "    if (t === 'marketedge' || _aBuilt.has(t)) return;", "    return;"],
  ['report: prints without building the unopened tabs', "  const built = typeof aBuildForReport === 'function' ? aBuildForReport() : null;", "  const built = null;"],
  ['report: does not wait for the tab loads', "  const wx = Promise.all([typeof openWeatherTab === 'function' ? openWeatherTab() : null, built]);", "  const wx = Promise.all([typeof openWeatherTab === 'function' ? openWeatherTab() : null]);"],
  ['report: the Odds load no longer awaited', "    return ensureOddsMovement(m).then(() => { if (_aOdds.m === m && aBuilt(m, 'odds')) renderOddsSection(); });", "    ensureOddsMovement(m).then(() => { if (_aOdds.m === m && aBuilt(m, 'odds')) renderOddsSection(); });"],
  ['report: a throwing builder stops the print', "    loads.push(new Promise(r => r(A_TAB_BUILD[t](_aM))).catch(", "    loads.push(Promise.resolve(A_TAB_BUILD[t](_aM)).catch("],
  ['report: Market edge built into the report', "    if (t === 'marketedge' || _aBuilt.has(t)) return;", "    if (_aBuilt.has(t)) return;"],
  ['D5: a retired source behind the one resolver in the modal', "src = playerPhotoUrl(key);\n  return src", "src = playerPhotoUrl(key) || photoOverrideFor(key);\n  return src"],
  ['lazy: every tab built at modal open', "  aShowTab(first);\n", "  aShowTab(first); Object.keys(A_TAB_BUILD).forEach(t => { _aBuilt.add(t); A_TAB_BUILD[t](m); });\n"],
  ['lazy: Key factors pre-loads the Overview season rows (no box shows them)', 'kfEnsureNews(m), kfEnsureMarketEdge(m)]', 'kfEnsureNews(m), kfEnsureMarketEdge(m), ensureOverviewProfiles(m)]'],
  ['lazy: a revisit rebuilds', '  if (!_aBuilt.has(tab)) { _aBuilt.add(tab); A_TAB_BUILD[tab](_aM); }', '  if (true) { _aBuilt.add(tab); A_TAB_BUILD[tab](_aM); }'],
  ['lazy: the built set survives a new match', '  _aM = m; _aBuilt.clear();', '  _aM = m;'],
  ['frame: a LATER rule turns the height back into a max (review: first-rule reads missed it)', '  .modal-analysis{ background:var(--card);', '  .modal-analysis{ height:auto; max-height:calc(88vh / var(--sf-z, 1)); background:var(--page);'],
  ['lazy: a late shard of the previous match repaints the new one', 'function aBuilt(m, tab){ return _aM === m && _aBuilt.has(tab); }', 'function aBuilt(m, tab){ return _aBuilt.has(tab); }'],
  ['revisit: Weather / Market edge hooks only on the first open', "  else if (A_TAB_REVISIT[tab]) A_TAB_REVISIT[tab]();\n", ''],
  ['direct tab: the completed-card path builds Odds first', "  openAnalysisModal(id, mxLandingTab(matchById(id)));\n}", "  openAnalysisModal(id);\n  aGoTab(mxLandingTab(matchById(id)));\n}"],
  ['sheet: a Key stats row dropped', "    row('Winners / unforced errors', M.wue[0], M.wue[1], 'ratio'),\n", ''],
  ['sheet: W / total points over own points won', "  const tp = [tpw.a, tpw.b].map(c => c.total).find(t => t > 0) || null;", "  const tp = tpw.a.won || null;"],
  ['sheet: no stats back to the message-only state', "  const M = fhSheetModel(joined || null);\n  const head = fhSheetSectionHead;", "  if (!joined) return `<div>${fhEsc(emptyMsg)}</div>`;\n  const M = fhSheetModel(joined || null);\n  const head = fhSheetSectionHead;"],
  ['sheet: the not-available note dropped', "  const note = !joined ? maSheetNaNote()", "  const note = !joined ? ''"],
  ['sheet: opens on Match, not Key stats', "\n    scope: 'key', nSets:", "\n    scope: 'match', nSets:"],
  ['sheet: tabs lose their slot', "onclick: `fhSheetScope('key','${sl}')` }];", "onclick: `fhSheetScope('key')` }];"],
  ['sheet: initials in rings (D5 undone)', "  const av = (name, key) => `<span class=\"fh-av\">${aAvatarHtml(name, key)}</span>`;", "  const av = (name, key) => `<span class=\"fh-av\">${fhEsc(fhIni(name))}</span>`;"],
  ['sheet: inline copy keeps the set chips', "  const chips = o.inline || o.noChips ? '' : (r.sets || [])", "  const chips = o.noChips ? '' : (r.sets || [])"],
  ['sheet: Match Stats tab back to the old stat sheet', "  if (hasPointLog) return maMsSheetHtml(m);\n", ''],
  ['sheet: Match Stats inline never filled', "buildMatchStatsSection(mv)); maMsSheetInit(mv);\n    // ruling 5", "buildMatchStatsSection(mv));\n    // ruling 5"],   // the carry-over view (2026-10-23)
  // TEN-336: the Market edge pop-up rows are maMatchRowsHtml rows; meRowOf hands each its opener
  // 2026-11-23 rebuild: the rows are drawn in match-analysis-v2.js
  ['sheet: Market edge rows gated on stats on file again', " onclick=\"meOpenRow(\\'' + r.mid + '\\')\" style=", "' + (r.ek ? ' onclick=\"meOpenRow(\\'' + r.mid + '\\')\"' : '') + ' style=", 'v2'],
  ['sheet: Overview pop-up rows do not open', " onclick=\"ovOpenRow(\\'' + r.mid + '\\')\"", "", 'v2'],
  // TEN-332: the Tournament rows are registered sheet rows now (trRowData); their gate mutants live in test-ten332-mutants.js
  ['sheet: Tournament rows do not open', "(r.wo ? '' : ' onclick=\"fhOpenSheet(\\'' + esc(r.mid) + '\\')\" title=\"Open the match statistics\"')", "(r.wo ? '' : ' onclick=\"void(\\'' + esc(r.mid) + '\\')\" title=\"Open the match statistics\"')", 'v2'],
  ['sheet: an unplaced row opens nothing', "    let r;\n    if (i >= 0) r = meRowFromCareer(", "    let r;\n    if (i < 0) return;\n    if (i >= 0) r = meRowFromCareer("],
  ['sheet: exact name keys on the date join', "  return lo.length >= 4 && hi.endsWith(lo);\n}\nlet _maRowReq", "  return false;\n}\nlet _maRowReq"],
  ['sheet: one of two same-date candidates accepted', "      if (hits.length === 1) i = hits[0];", "      if (hits.length) i = hits[0];"],
  ['sheet: a late fetch opens into a closed modal', "    if (_aM !== m || req !== _maRowReq || !document.getElementById('analysisModal').classList.contains('open')) return;", "    if (_aM !== m) return;"],
  ['report: Match Stats prints Key stats only', "  if (typeof _maMsSheet !== 'undefined' && _maMsSheet){ _maMsSheet.scope = 'match'; fhSheetRender('tab'); }\n", ''],
  // ESC brief 2026-10-21: the sheet's Esc is a layer in the one handler (esc-nav.js); its rank decides who goes first.
  ['esc: the sheet ranked below the pop-up frame', "{ id: 'fh-sheet', z: 80,", "{ id: 'fh-sheet', z: 77,"],
  ['esc: the pop-up ranked below the modal (one Esc takes the modal from under it)', "{ id: 'ma-pop', z: 78,", "{ id: 'ma-pop', z: 73,"],
  ['esc: the pop-up frame registers no Esc layer', "(globalThis.sfEscLayers = globalThis.sfEscLayers || []).push({ id: 'ma-pop',", "void ({ id: 'ma-pop',"],
  ['close: a Market edge pop-up survives closing the modal', " const mp = document.getElementById('mePop'); if (mp) mp.innerHTML = '';", ""],
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
  ['chip: H2H record mark back to n === 2 only', "const small = F.length && maGate(F.length).mode !== 'full' ?", "const small = F.length === 2 ?", 'v2'],
  ['chip: H2H record mark dropped for n 1–4', "const small = F.length && maGate(F.length).mode !== 'full' ?", "const small = maGate(F.length).mode === 'small' ?", 'v2'],
  ['chip: no chip for n 1–4', "  if (m !== 'small' && m !== 'nopct') return '';", "  if (m !== 'small') return '';"],
  ['Market edge: band Won ungated', "RATE(b.w, n, { text: b.won == null ? null : Math.round(b.won * 100) + '%', nopct: DASH, note: 'title' })", "(b.won == null ? DASH : Math.round(b.won * 100) + '%')", 'v2'],
  ['Market edge: win bar drawn at any n', "const bar = maGateBar(b.w, n, 'var(--ma2-text)')", "const bar = { w: n ? b.w / n * 100 : 0, color: 'var(--ma2-text)', mode: 'full' }", 'v2'],
  // (the band box's own small-sample note is a reported renderer gap: its check is red at baseline, so no mutant)
  ['Overview: season rate ungated', "const pct = n && g !== 'nopct' ? api.rateText(c.won, c.lost) : DASH, w = n && g !== 'nopct'", "const pct = n ? Math.round(c.won / n * 100) + '%' : '0%', w = n && g !== 'nopct'", 'v2'],
  // (TEN-340: the two Playing style gate mutants moved to tools/test-ten340-mutants.js with the rebuilt tab.)
  // ---- test-ten314-components.mjs (shared components) ----
  ['seg: sheet item radius 8', "item: 'padding:5px 12px; border-radius:7px; font-size:11px;', tb:", "item: 'padding:5px 12px; border-radius:8px; font-size:11px;', tb:"],
  ['seg: Market edge track padding 3', "  me: { track: 'gap:3px; padding:2px; border-radius:8px;',", "  me: { track: 'gap:3px; padding:3px; border-radius:8px;',"],
  ['seg: pbp tabs drawn in the scope geometry', "` })), 'pbp') + order\n", "` }))) + order\n"],
  ['seg: the selected tile dropped', "background:${on ? `${G.sb}` : 'transparent'};", "background:transparent;"],
  ['seg: the 140ms transition dropped', "  .ma-seg-item{ transition:background .14s ease, color .14s ease, border-color .14s ease; }\n", ''],
  ['seg: Market edge keeps its own markup', "const scopeTrack = S => track(", "const scopeTrack = S => (x => x)(", 'v2'],
  ['track: the picked item loses its lift', "background:' + (t.on ? 'var(--ma2-lifted)' : 'transparent') + '; ' + (o.inset", "background:transparent; ' + (o.inset", 'v2'],
  ['popShell: every inner click closes', "onclick=\"if(event.target===this){' + o.onClose + '}\"", "onclick=\"' + o.onClose + '\"", 'v2'],
  ['popShell: the box covers the sidebar', "inset:0 0 0 var(--sf-side, 0px); z-index:90; background:var(--ma2-scrim-2)", "inset:0; z-index:90; background:var(--ma2-scrim-2)", 'v2'],
  ['popShell: loses ma-pop-overlay (the Esc layer cannot see the box)', "class=\"ma2-pop-ov ma-pop-overlay\"", "class=\"ma2-pop-ov\"", 'v2'],
  ['popShell: Close loses ma-pop-x (Esc cannot close the box)', "class=\"seg ma2-btn ma-pop-x\"", "class=\"seg ma2-btn\"", 'v2'],
  ['band box: the small-sample note dropped', "(maRate(b.w, b.n, {}).mode === 'small' ?", "(false ?", 'v2'],
  ['band box: the small-sample note at every n', "(maRate(b.w, b.n, {}).mode === 'small' ?", "(b.n ?", 'v2'],
  ['band box: the tiles keep their colour at 5–9', "return { t: R.txt, c: R.mode === 'full' ? col : meGrey }; };", "return { t: R.txt, c: col }; };", 'v2'],
  ['popShell: a tab draws its own overlay', "  function maOvPopV2(M) {", "  const OWN_POP = '<div class=\"ma2-pop-ov\">';\n  function maOvPopV2(M) {", 'v2'],
  ['pop: radius 12', "box: 'border-radius:14px; padding:20px 22px 14px; display:flex; flex-direction:column; gap:16px;',", "box: 'border-radius:12px; padding:20px 22px 14px; display:flex; flex-direction:column; gap:16px;',"],
  ['pop: z-index 50', "scrim: 'var(--backdrop)', z: 85,", "scrim: 'var(--backdrop)', z: 50,"],
  ['pop: every inner click closes', "onclick=\"if(event.target===this){${o.onClose}}\"", "onclick=\"${o.onClose}\""],
  ['pop: Market edge keeps its own frame', "  return maPopFrame({ cls: 'me-pop', xCls: 'me-x',", "  return '<div class=\"me-pop-overlay\">' + inner + '</div>' || maPopFrame({ cls: 'me-pop', xCls: 'me-x',"],
  ['esc: closes the first frame, not the topmost', "const top = all && all.length ? all[all.length - 1] : null;", "const top = all && all.length ? all[0] : null;"],
  ['motion: sigIn 300ms', ".ma-sigin{ animation:sigIn .2s cubic-bezier(.2,.7,.3,1); }", ".ma-sigin{ animation:sigIn .3s cubic-bezier(.2,.7,.3,1); }"],
  ['motion: the frame without sigIn', "<div class=\"ma-pop${enter ? ' ma-sigin' : ''}${c ? ' ' + c : ''}\"", "<div class=\"ma-pop${c ? ' ' + c : ''}\""],
  ['motion: a re-render replays the entrance', "  if (popKey && popKey === E._popKey) maPopNoReplay(host);\n", ''],
  ['rows: the file\'s old grid instead of README §5\'s (TEN-380)', "const MA_ROW_COLS = '40px 10px minmax(96px,1fr) 28px 34px minmax(86px,1fr) 38px 38px';", "const MA_ROW_COLS = '48px 12px minmax(0,1.1fr) 36px 40px minmax(0,1.3fr) 46px 46px';"],
  ['rows: the head back on the page tone (TEN-380)', "background:${o.bg || 'var(--card)'}; padding:${o.headPad || '6px 6px 7px'};", "background:${o.bg || 'var(--page)'}; padding:${o.headPad || '6px 6px 7px'};"],
  ['rows: header not sticky', "<div class=\"ma-rows-head\" style=\"position:sticky; top:0;", "<div class=\"ma-rows-head\" style=\"position:relative; top:0;"],
  ['rows: a row loses its sheet opener', "<div class=\"seg ma-row${r.cls ? ' ' + r.cls : ''}\"${r.attrs || ''}${r.click || ''} style=\"display:grid; grid-template-columns:${COLS};", "<div class=\"seg ma-row${r.cls ? ' ' + r.cls : ''}\"${r.attrs || ''} style=\"display:grid; grid-template-columns:${COLS};"],
  ['tip: 200ms opacity', "transition:opacity .12s ease; pointer-events:none;\n    background:var(--card);", "transition:opacity .2s ease; pointer-events:none;\n    background:var(--card);"],
  ['tip: the helper drops the class pair', "<span class=\"elotip-pop\" role=\"tooltip\"", "<span class=\"tip-pop\" role=\"tooltip\""],
  ['rows: no line-height of its own (inherits the host 21px)', '<div class="ma-rows" style="display:flex; flex-direction:column; line-height:normal;">', '<div class="ma-rows" style="display:flex; flex-direction:column;">'],
  // (TEN-376: the per-shade --ma-s-* tokens are gone by design; the token-file locks are foundation ones now)
  ['tokens: Day re-tones a text token (only surfaces change)', '  --tile-hover:  #1B1F2B;', '  --tile-hover:  #1B1F2B;\n  --text:        #EEEEEE;', 'css'],
  ['tokens: --text-soft drifts from foundation.md', '  --text-soft:   #DDE0EA;', '  --text-soft:   #DDE0EB;', 'css'],
  ['seg: a token typo in MA_SEG (sheet track)', "tb: 'var(--card)', tl: 'var(--edge-6)', sb: 'var(--inner)', sl: 'var(--edge-10)' },   // DF L1689", "tb: 'var(--crad)', tl: 'var(--edge-6)', sb: 'var(--inner)', sl: 'var(--edge-10)' },   // DF L1689"],
  // the sheet head exists twice: fhSheetHeadHtml (profile, Head to Head page) @0 and fhSheetHeadMa2 (Match analysis) @1
  ['sheet: the year back on a Form sheet', "e.noYear ? fhDDMM(r.date) :", "e.noYear ? fhDDMM(r.date) + '.26' :", 'html@0'],
  ['sheet: the year dropped for every other list', ": fhDDMM(r.date) + (yy ? '.' + yy : '');", ": fhDDMM(r.date);", 'html@0'],
  ['sheet: the Match Stats tab copy back to DD.MM.YY', "!r.date ? null : o.inline ? longDate(r.date) :", "!r.date ? null :", 'html@0'],
  ['sheet (ma2): the year back on a Form sheet', "e.noYear ? fhDDMM(r.date) :", "e.noYear ? fhDDMM(r.date) + '.26' :", 'html@1'],
  ['sheet (ma2): the year dropped for every other list', ": fhDDMM(r.date) + (yy ? '.' + yy : '');", ": fhDDMM(r.date);", 'html@1'],
  ['sheet (ma2): the Match Stats tab copy back to DD.MM.YY', "!r.date ? null : o.inline ? longDate(r.date) :", "!r.date ? null :", 'html@1'],
  ['seg: the me selected border folded into its fill', "sb: 'var(--inner)', sl: 'var(--edge-10)' },      // DF L1804", "sb: 'var(--inner)', sl: 'var(--inner)' },      // DF L1804"],
  ['tip: the tooltip surface off its foundation role (a floating layer = --card)', "    background:var(--card); border:1px solid var(--edge-10); border-radius:8px; padding:8px 11px;", "    background:var(--inner); border:1px solid var(--edge-10); border-radius:8px; padding:8px 11px;"],
  ['pop: the box border back to 1.25px', "border:1px solid ${o.line", "border:1.25px solid ${o.line"],
  ['rows: the Form geometry options ignored', "padding:${o.headPad || '6px 6px 7px'}", "padding:6px 6px 7px"],
  ['sheet: the caption strip loses its border', "background:var(--inner); border:1px solid transparent; border-radius:8px; padding:8px 0;", "background:var(--inner); border-radius:8px; padding:8px 0;"],
  ['sheet: the caption band back on a visible edge', "background:var(--inner); border:1px solid transparent; border-radius:8px; padding:8px 0;", "background:var(--inner); border:1px solid var(--line); border-radius:8px; padding:8px 0;"],
  ['tip: the pop back to a mono font (the design pop takes the UI font)', "    font-family:'Hanken Grotesk',sans-serif; font-size:11px; color:var(--text-soft", "    font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--text-soft"],
  ['tip: a plain-text body loses its README mono span', "${/^\\s*</.test(body) ? body :", "${true ? body :"],
  ['tooltip: the positioned mode styles its own box again', "t.id = 'aoddsTip'; t.className = 'elotip-pop ma-tip-float';", "t.id = 'aoddsTip'; t.style.cssText = 'background:#000; border:1px solid #fff;'; t.className = 'elotip-pop ma-tip-float';"],
  ['tooltip: the positioned mode invisible', "transform:none; opacity:1; visibility:visible; white-space:normal;", "transform:none; white-space:normal;"],
  ['tooltip: plain text loses the mono wrap', "t.innerHTML = /^\\s*</.test(body) ? body :", "t.innerHTML = true ? body :"],
  ['tooltip: News never arms the listener', "    if (typeof initAOddsTips === 'function') initAOddsTips();   // the modal's one tooltip component (the group count's population note)\n", ""],
  ['hairline: a bare 0.33px back in a modal builder', 'border:1px solid var(--line); border-radius:10px; padding:16px 20px;', 'border:0.33px solid var(--line); border-radius:10px; padding:16px 20px;'],
  ['hairline: a 1.25px border back in a modal builder', 'border:1px solid var(--line); border-radius:10px; padding:16px 20px;', 'border:1.25px solid var(--line); border-radius:10px; padding:16px 20px;'],
  ['hairline: a bare 0.33px back in a modal CSS rule', ':is(.modal-analysis,.pp-formsurface) .pbp-tag.sp{ color:var(--text); background:var(--inner); border:1px solid var(--edge-6); }', ':is(.modal-analysis,.pp-formsurface) .pbp-tag.sp{ color:var(--text); background:var(--inner); border:0.33px solid var(--edge-6); }'],
  ['hairline: a bare 0.33px back in .aform-tabs (review gap)', '.aform-tabs{ display:flex; gap:4px; background:var(--mc-track); border:1px solid var(--edge-6);', '.aform-tabs{ display:flex; gap:4px; background:var(--mc-track); border:0.33px solid var(--edge-6);'],
  // ---- test-ten314-tokens.mjs (TEN-376: tokens.css is the modal's one colour file; theme.js the one theme) ----
  ['tokens: a literal back in a modal builder', "const MA_GREY = 'var(--text-label)';", "const MA_GREY = '#A3AABE';"],
  ['tokens: a literal in a modal CSS rule', '  .modal-analysis .apname.b{ color:var(--text); }', '  .modal-analysis .apname.b{ color:#DDE0EA; }'],
  ['tokens: a var() tokens.css does not set (the retired periwinkle)', '  .modal-analysis .apname{ color:var(--text); }', '  .modal-analysis .apname{ color:var(--periwinkle); }'],
  ['theme: maSetTheme stops delegating to theme.js', "function maSetTheme(mode){ return window.sfTheme ? window.sfTheme.set(mode) : 'night'; }", "function maSetTheme(mode){ return 'night'; }"],
  ['theme: the modal back on its own attribute', '<div class="modal-overlay ma-theme" id="analysisModal">', '<div class="modal-overlay ma-theme" id="analysisModal" data-ma-theme="night">'],
  ['theme: openAnalysisModal no longer applies the theme', '  maApplyTheme();', '  void 0;'],
  ['ships: tokens.css not linked', '<link rel="stylesheet" href="./tokens.css">\n', ''],
  ["review 2: dash rows keep their track", "const noTrack = s.kind === 'ratio' || (!(aW > 0) && !(bW > 0));", "const noTrack = s.kind === 'ratio';", 'html@0'],
  ["review 2: a 0 | 0 count keeps its track", "(!(aW > 0) && !(bW > 0));", "(aW == null && bW == null);", 'html@0'],
  ["review 2 (ma2): dash rows keep their track", "const noTrack = s.kind === 'ratio' || (!(aW > 0) && !(bW > 0));", "const noTrack = s.kind === 'ratio';", 'html@1'],
  ["review 2 (ma2): a 0 | 0 count keeps its track", "(!(aW > 0) && !(bW > 0));", "(aW == null && bW == null);", 'html@1'],
  ["review item 5 (ma2): the ratio row keeps its track", "const noTrack = s.kind === 'ratio' || (!(aW > 0) && !(bW > 0));", "const noTrack = (!(aW > 0) && !(bW > 0));", 'html@1'],
];
// "two tabs swapped" is a structural mutant: swap the News and Playing style menu rows.
function apply(src, name, from, to, nth) {
  if (name === 'menu: two tabs swapped') {
    const a = src.indexOf('<div class="asidenav-item" data-atab="news">'), b = src.indexOf('<div class="asidenav-item" data-atab="style">');
    const endA = src.indexOf('</div>', a) + 6, endB = src.indexOf('</div>', b) + 6;
    if (a < 0 || b < 0) return null;
    return src.slice(0, a) + src.slice(b, endB) + src.slice(endA, b) + src.slice(a, endA) + src.slice(endB);
  }
  if (nth != null) {   // 'html@N': the Nth (0-based) of exactly two or more copies
    let at = -1; for (let k = 0; k <= nth; k++) { at = src.indexOf(from, at + 1); if (at < 0) return null; }
    return src.slice(0, at) + to + src.slice(at + from.length);
  }
  if (src.split(from).length !== 2) return null;
  return src.replace(from, to);
}
const SUITES = ['test-ten314-modal-frame.mjs', 'test-ten314-sheet.mjs', 'test-ten314-gate.mjs', 'test-ten314-components.mjs', 'test-ten314-tokens.mjs'];
const run = env => spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, env), encoding: 'utf8' });
const failing = r => new Set([...(r.stdout || '').matchAll(/^\s*not ok \d+ - (.*)$/gm)].map(m => m[1].trim()));
// A mutant is only meaningful against a baseline that is green except the listed renderer gaps.
const base = run({ TEN314_HTML: BASE });
const baseFail = failing(base), unexpected = [...baseFail].filter(n => !KNOWN_GAPS.includes(n) && !/\.mjs$/.test(n));
if (unexpected.length || [...baseFail].some(n => /\.mjs$/.test(n) && !SUITES.some(f => n.endsWith(f)) )) {
  console.error('✖ baseline red: the suites fail on the unmutated page, so no mutant can be judged. Fix the suite first.');
  console.error(unexpected.join('\n'));
  process.exit(1);
}
KNOWN_GAPS.forEach(g => console.log((baseFail.has(g) ? '• renderer gap (red, reported): ' : '• gap now closed — drop it from KNOWN_GAPS: ') + g));
const caughtBy = r => [...failing(r)].some(n => !baseFail.has(n) && !/\.mjs$/.test(n)) || (r.status !== 0 && !failing(r).size);
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten314-mut-'));
for (const [name, from, to, tgt] of MUTANTS) {
  const [target, nthS] = String(tgt || 'html').split('@'), nth = nthS == null ? null : +nthS;
  // target 'css' = tokens.css (TEN314_CSS), 'v2' = match-analysis-v2.js (TEN314_V2), else the page (TEN314_HTML).
  const m = apply(target === 'css' ? css : target === 'v2' ? v2 : html, name, from, to, nth);
  if (m == null) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, target === 'css' ? 'm.css' : target === 'v2' ? 'm.js' : 'm.html');
  fs.writeFileSync(file, m);
  const env = target === 'css' ? { TEN314_CSS: file, TEN314_HTML: BASE } : target === 'v2' ? { TEN314_V2: file, TEN314_HTML: BASE } : { TEN314_HTML: file };
  if (!caughtBy(run(env))) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
