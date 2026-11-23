// TEN-336 — every check in test-ten336-market-edge.mjs must FAIL when the behaviour it locks is reverted. Each mutant is
// applied to a copy of match-analysis-v2.js (TEN310_V2) or bsp-consult-dashboard.html (TEN310_HTML), both read by
// tools/ten310-harness.mjs, and the suite is run against it; a mutant that leaves the suite green is a vacuous test and
// fails this runner. Anchors must occur exactly the stated number of times (default once).
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
// Match analysis rebuild (2026-11-23): the tab renders from match-analysis-v2.js; a mutant names its file ('v2' → the copy is
// read through TEN310_V2, 'html' → the page through TEN310_HTML) and how often its anchor occurs (default once).
const v2 = fs.readFileSync(path.join(ROOT, 'match-analysis-v2.js'), 'utf8');
const MUTANTS = [
  // the rebuilt renderer (match-analysis-v2.js)
  ['DoD 8: a row stops opening the sheet', "onclick=\"meOpenRow(\\'' + r.mid + '\\')\" style=", "style=", 'v2'],
  ['DoD 8: the price loses its source hover', "'<span title=\"' + esc(fhSrcTitle(r)) + '\" style=\"' + MONO + ' font-size:12px; font-weight:700; text-align:right;", "'<span style=\"' + MONO + ' font-size:12px; font-weight:700; text-align:right;", 'v2', 2],
  ['palette: a raw colour back in the block', "const meGrey = 'var(--ma2-grey)'", "const meGrey = '#8B96B5'", 'v2'],
  ['palette: an undefined token', "const meGrey = 'var(--ma2-grey)'", "const meGrey = 'var(--ma2-gray)'", 'v2'],
  ['palette: the players\' series colours swapped', "const col = ['var(--ma2-blue)', 'var(--ma2-text)'];", "const col = ['var(--ma2-text)', 'var(--ma2-blue)'];", 'v2'],
  ['geometry: a 1.25px edge on the player box', "style=\"background:var(--ma2-inner); border:1px solid ' + G6 + '; border-radius:12px; padding-bottom:8px;", "style=\"background:var(--ma2-inner); border:1.25px solid ' + G6 + '; border-radius:12px; padding-bottom:8px;", 'v2'],
  ['band: today\'s band unmarked', "border-radius:8px; background:' + (today ? 'var(--ma2-lifted)' : 'transparent') + '; box-shadow:inset 0 0 0 1px ' + (today ? W(14) : 'transparent') + '; cursor:' + (click ? 'pointer' : 'default') + ';\">'\n        + '<span", "border-radius:8px; background:transparent; box-shadow:inset 0 0 0 1px transparent; cursor:' + (click ? 'pointer' : 'default') + ';\">'\n        + '<span", 'v2'],
  ['closing prices: the book split dropped from the help', "core.RET_SETTLE_NOTE + meBookSplit(MM);", "core.RET_SETTLE_NOTE;", 'v2'],
  ['band box: the help loses the retirement note', "'Every match with a closing price in this band, newest first. Flat 1% stake. Click a match for its stats. ' + core.RET_SETTLE_NOTE;", "'Every match with a closing price in this band, newest first. Flat 1% stake. Click a match for its stats. ';", 'v2'],
  ['closing prices: the latest-match date dropped', "'. Latest match: ' + (last ? fhLongDate(last) : DASH) + '.'", "'.'", 'v2'],
  ['profit chart: guides solid', "' + W(12) + '\" stroke-dasharray=\"2 6\"", "' + W(12) + '\"", 'v2'],
  ['profit chart: the break-even rule dropped', "+ '<line x1=\"0\" y1=\"' + C.zeroY.toFixed(1) + '\" x2=\"1000\"", "+ '<line x1=\"0\" y1=\"' + (C.zeroY + 1).toFixed(1) + '\" stroke-dasharray=\"2 6\" x2=\"1000\"", 'v2'],
  ['price sensitivity: the Bet365 share dropped', "(nB ? ' · ' + nB.toLocaleString('en-US') + ' of '", "(false ? ' · ' + nB.toLocaleString('en-US') + ' of '", 'v2'],
  ['price sensitivity: Today not the header price', "'Today', M.today == null ? DASH : M.today.toFixed(2), 20,", "'Today', DASH, 20,", 'v2'],
  ['price sensitivity: Edge read as Won alone', "const bar = maGateBar(b.w, n, 'var(--ma2-text)'), edge = b.won == null || b.needs == null ? null : (b.won - b.needs) * 100;", "const bar = maGateBar(b.w, n, 'var(--ma2-text)'), edge = b.won == null || b.needs == null ? null : b.won * 100;", 'v2'],
  ['price sensitivity: the tick off Needs', "meBar(bar.w, n && b.needs != null ? b.needs * 100 : null, bar.color)", "meBar(bar.w, null, bar.color)", 'v2'],
  ['profit chart: the legend counts the scope-less rows', "const nTxt = M.state === 'ready' ? M.priced.length.toLocaleString('en-US') + ' priced'", "const nTxt = M.state === 'ready' ? M.rows.length.toLocaleString('en-US') + ' priced'", 'v2'],
  ['derived lines: today\'s band label off the model', "'Today’s band', L && L.tb >= 0 ? core.BANDS[L.tb].label : DASH", "'Today’s band', L && L.tb >= 0 ? core.BANDS[0].label : DASH", 'v2'],
  ['derived lines: the cover card after the lines card', "meCoverCard(E, MM) + meLinesCard(E, MM)", "meLinesCard(E, MM) + meCoverCard(E, MM)", 'v2'],
  ['cover: counts the Match winner rows', "const rs = all.filter(r => core.bandOf(r.price) === bi), n = rs.length", "const rs = (M.bands[bi] ? M.bands[bi].rows : []), n = rs.length", 'v2'],
  ['cover: the all-matches tick dropped', "meBar(bar.w, allW, bar.color)", "meBar(bar.w, null, bar.color)", 'v2'],
  ['cover: an empty band clickable', "click = n > 0 && M.bands[bi] && M.bands[bi].n > 0, lc", "click = true, lc", 'v2'],
  ['band box: the Edge sub-line dropped', "tile('Edge', ed.t, 'Won − needs',", "tile('Edge', ed.t, '',", 'v2'],
  ['band box: Edge read as Won alone', "const edge = b.won == null || b.needs == null ? null : (b.won - b.needs) * 100;\n    const gate", "const edge = b.won == null || b.needs == null ? null : b.won * 100;\n    const gate", 'v2'],
  ['line box: Against all printed on All matches', "const vs = sc === 'band' && rate != null && allPct != null ? rate - allPct : null;", "const vs = rate != null && allPct != null ? rate - allPct : null;", 'v2'],
  ['identity: the section line dropped', "+ (idNote ? '<div class=\"me-id-hidden\"", "+ (false ? '<div class=\"me-id-hidden\"", 'v2'],
  ['identity: the band box sub-line dropped', "idh ? idh + ' ' + (idh === 1 ? 'row' : 'rows') + ' hidden: identity unverified' : ''", "''", 'v2'],
  // the page (data layer, default view, the shared helper)
  ['D3: opens on Derived lines again', "_me = { m, S: { meView: 'winner', meScope: 'career',", "_me = { m, S: { meView: 'lines', meScope: 'career',"],
  ['helper: a titleless group draws its header', "    + (g.title == null ? '' : `<div class=\"ma-rows-group\"", "    + (false ? '' : `<div class=\"ma-rows-group\""],
  ['helper: price column no longer right-aligned', "  price: { right: true, cell:", "  price: { cell:"],
  ['helper: table rows lose their hairline', "const line = o.rowLine === false ? '' : ` border-bottom:1px solid color-mix(in srgb, var(--text) 3%, transparent);`;", "const line = '';"],
  ['helper: the table head sticks', "const head = `<div class=\"ma-rows-head\" style=\"${grid} padding:", "const head = `<div class=\"ma-rows-head\" style=\"position:sticky; top:0; ${grid} padding:"],
  ['helper: the default rows change by a pixel', "grid-template-columns:${COLS}; gap:${GAP}; align-items:center; padding:6px;", "grid-template-columns:${COLS}; gap:${GAP}; align-items:center; padding:7px;"],
  ['data: the Slam-name retirement guess survives a best-of-3', "    r.ret = !r.wo && (!!x.retired || unfinished || (r.pS != null && (r.won ? r.pS : r.oS) < (r.bo === 5 ? 3 : 2)));",
    "    if (!r.wo && !r.ret && r.pS != null && (r.won ? r.pS : r.oS) < (r.bo === 5 ? 3 : 2)) r.ret = true;"],
  ['data: the deciding-set flag keeps the Slam-name guess', "    r.decider = r.complete && r.pS != null && (r.pS + r.oS) === r.bo;   // fhFinishRow's rule, under the recorded format\n", ""],
  ['data: a walkover reads as retired', "    r.ret = !r.wo && (!!x.retired || unfinished ||", "    r.ret = (!!x.retired || unfinished ||"],
];
const SUITES = ['test-ten336-market-edge.mjs'];
// A "RENDERER GAP" test locks a standing rule the rebuilt renderer does not meet yet (red in npm test until fixed); it is
// skipped here so the control and every mutant measure the tests that hold.
const RUN = ['--test', '--test-skip-pattern=RENDERER GAP', ...SUITES.map(f => path.join(ROOT, f))];
// Control: the unmutated page must pass, or every "caught" below means nothing.
{ const r = spawnSync(process.execPath, RUN, { encoding: 'utf8' });
  if (r.status !== 0) { console.error('✖ the suite is red on the unmutated page — mutants are meaningless'); process.exit(1); }
  console.log('✔ control: the unmutated page passes'); }
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten336-mut-'));
for (const [name, from, to, where = 'html', times = 1] of MUTANTS) {
  const src = where === 'v2' ? v2 : html;
  if (src.split(from).length !== times + 1) { console.error(`✖ anchor not found exactly ${times}×: ${name}`); survived++; continue; }
  const file = path.join(dir, where === 'v2' ? 'm.js' : 'm.html');
  fs.writeFileSync(file, src.split(from).join(to));
  const r = spawnSync(process.execPath, RUN, { env: Object.assign({}, process.env, where === 'v2' ? { TEN310_V2: file } : { TEN310_HTML: file }), encoding: 'utf8' });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
