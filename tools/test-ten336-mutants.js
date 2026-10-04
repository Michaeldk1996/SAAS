// TEN-336 — every check in test-ten336-market-edge.mjs must FAIL when the behaviour it locks is reverted. Each mutant is
// applied to a copy of bsp-consult-dashboard.html and the suite is run against it (TEN310_HTML, read by
// tools/ten310-harness.mjs); a mutant that leaves the suite green is a vacuous test and fails this runner. Anchors must
// occur exactly once in the page.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
  // TEN-380 (the locked reference)
  ['TEN-380: the band fill back on --text', "const bar = maGateBar(b.w, n, meLeadFill(b.won, ob ? ob.won : null)), edge", "const bar = maGateBar(b.w, n, ME_C.text), edge"],
  ['Q3: no leader / trailer split on the band bars', "const bar = maGateBar(b.w, n, meLeadFill(b.won, ob ? ob.won : null)), edge", "const bar = maGateBar(b.w, n, ME_C.wbar), edge"],
  ['Q3: the trailer drawn solid', "function meLeadFill(own, other){ return own == null || other == null || own >= other - 1e-9 ? ME_C.wbar : ME_C.wbar2; }", "function meLeadFill(own, other){ return ME_C.wbar; }"],
  ['Q3: the cover bars without the split', "+ meBarHtml(maGateBar(c, n, meLeadFill(n && n >= core.ME_THIN_FLOOR ? c / n : null, meCovRate(O, li, bi))), aR.mode", "+ meBarHtml(maGateBar(c, n, ME_C.wbar), aR.mode"],
  ['Q2: today\'s band back on the --selected wash', "  wash: 'var(--wash-5)',", "  wash: 'var(--selected)',"],
  ['Q2: today\'s band ring back', "  ring: 'transparent',", "  ring: 'var(--open-card)',"],
  ['TEN-380: the Needs tick back on the label grey', "  needTick: 'var(--viz-tick)',", "  needTick: 'var(--text-label)',"],
  ['TEN-380: Edge read as Won alone', "edge = b.won == null || b.needs == null ? null : (b.won - b.needs) * 100;\n        return", "edge = b.won == null || b.needs == null ? null : b.won * 100;\n        return"],
  ['TEN-380: the profit lead line back to 2.6px --text', "const col = [[ME_C.wbar, '2.4'], [ME_C.wbar2, '2']];", "const col = [[ME_C.text, '2.6'], [ME_C.wbar2, '2']];"],
  ['TEN-380: the highlighted In band cells back on --inner', "  hiBg: 'var(--wash-4)', hiBd: 'transparent',", "  hiBg: 'var(--inner)', hiBd: 'var(--edge-10)',"],
  ['TEN-380: the In band head off --link', "text-align:right; color:${ME_C.link};\">In band</span>", "text-align:right; color:${ME_C.blue};\">In band</span>"],
  ['TEN-380: the cover card counts the Match winner rows', "const rs = all.filter(r => core.bandOf(r.price) === bi), n = rs.length", "const rs = (M.bands[bi] ? M.bands[bi].rows : []).filter(r => r.sets && r.sets.length), n = rs.length"],
  ['TEN-380: the cover rows lose the all-matches tick', "aR.mode === 'full' || aR.mode === 'small' ? aC / all.length * 100 : null)", "null)"],
  ['TEN-380: an empty cover band clickable', "const today = bi === L.tb, click = n > 0 && M.bands[bi] && M.bands[bi].n > 0;", "const today = bi === L.tb, click = true;"],
  ['TEN-380: the cover card after the lines card', "meCoverCard(E, MM) + meLinesCard(E, MM)", "meLinesCard(E, MM) + meCoverCard(E, MM)"],
  ['TEN-380: the band pop-up Edge sub-line dropped', "edge == null ? ME_C.m1 : meUC(edge, 1), 'won − needs', { gate: [b.w, b.n] })", "edge == null ? ME_C.m1 : meUC(edge, 1), '', { gate: [b.w, b.n] })"],
  ['TEN-380: Vs all printed on All matches', "const vs = sc === 'band' && rate != null && allPct != null ? rate - allPct : null;", "const vs = rate != null && allPct != null ? rate - allPct : null;"],
  ['TEN-380: the pop-up sheet edge back on --line', "  popLine: 'var(--edge-10)',", "  popLine: 'var(--line)',"],
  ['DoD 8: a tab-local row renderer again', "function meRowOf(r, E, name, key, extra){", "function meRowsHtml(){ return ''; }\nfunction meRowOf(r, E, name, key, extra){"],
  ['DoD 8: the price loses the shared tooltip', "price: fhOdd(r.price), priceTip: fhSrcTitle(r),", "price: fhOdd(r.price), priceTip: null,"],
  ['DoD 8: a row stops opening the sheet', "click: ` onclick=\"meOpenRow('${r.mid}')\"` }", "click: '' }"],
  ['D3: opens on Derived lines again', "_me = { m, S: { meView: 'winner', meScope: 'career',", "_me = { m, S: { meView: 'lines', meScope: 'career',"],
  ['palette: player A back on a modal role token', "  text: 'var(--text)',              // player A", "  text: 'var(--ma-t1)',              // player A"],
  ['palette: a raw colour back in ME_C', "  m1: 'var(--text-soft)',", "  m1: '#8B96B5',"],
  ['palette: TODAY accent text back on blue', "  'blue': 'var(--text)',", "  'blue': 'var(--link)',"],
  ['geometry: a 0.33px hairline back', "  hw: '1px',\n  // chart (DF L1858", "  hw: 'var(--ma-hw,0.33px)',\n  // chart (DF L1858"],
  ['geometry: card back on the file\'s 1.25px border', "const ME_CARD = `background:${ME_C.card}; border:1px solid ${ME_C.cardLine};", "const ME_CARD = `background:${ME_C.card}; border:1.25px solid ${ME_C.cardLine};"],
  ['geometry: the pane padding back (M12)', "return `<div class=\"me-pane\" style=\"font-family:", "return `<div class=\"me-pane\" style=\"padding:6px 4px 2px; font-family:"],
  // TEN-380: the row rule is --line too (decisions §1), so the mutant moves the head onto the panel edge instead
  ['geometry: band column head off the --line rule', "gap:0 8px; align-items:end; padding:0 8px 7px; border-bottom:${ME_C.hw} solid ${ME_C.headLine};", "gap:0 8px; align-items:end; padding:0 8px 7px; border-bottom:${ME_C.hw} solid ${ME_C.panelLine};"],
  ['band: the open band loses its wash', "background:${isToday || on ? ME_C.wash : 'transparent'};", "background:${isToday ? ME_C.wash : 'transparent'};"],
  ['pill: tooltip dropped', "  return maTipHtml(pill, body, { popStyle:", "  return pill; maTipHtml(pill, body, { popStyle:"],
  ['helper: a titleless group draws its header', "    + (g.title == null ? '' : `<div class=\"ma-rows-group\"", "    + (false ? '' : `<div class=\"ma-rows-group\""],
  ['helper: price column no longer right-aligned', "  price: { right: true, cell:", "  price: { cell:"],
  ['helper: table rows lose their hairline', "const line = o.rowLine === false ? '' : ` border-bottom:1px solid color-mix(in srgb, var(--text) 3%, transparent);`;", "const line = '';"],
  ['helper: the table head sticks', "const head = `<div class=\"ma-rows-head\" style=\"${grid} padding:", "const head = `<div class=\"ma-rows-head\" style=\"position:sticky; top:0; ${grid} padding:"],
  ['helper: the default rows change by a pixel', "grid-template-columns:${COLS}; gap:${GAP}; align-items:center; padding:6px;", "grid-template-columns:${COLS}; gap:${GAP}; align-items:center; padding:7px;"],
  ['data: the Slam-name retirement guess survives a best-of-3', "    r.ret = !r.wo && (!!x.retired || unfinished || (r.pS != null && (r.won ? r.pS : r.oS) < (r.bo === 5 ? 3 : 2)));",
    "    if (!r.wo && !r.ret && r.pS != null && (r.won ? r.pS : r.oS) < (r.bo === 5 ? 3 : 2)) r.ret = true;"],
  ['data: the deciding-set flag keeps the Slam-name guess', "    r.decider = r.complete && r.pS != null && (r.pS + r.oS) === r.bo;   // fhFinishRow's rule, under the recorded format\n", ""],
  ['data: a walkover reads as retired', "    r.ret = !r.wo && (!!x.retired || unfinished ||", "    r.ret = (!!x.retired || unfinished ||"],
  ['DoD 8: a native title back on the opponent', "won: r.won, opp: r.opp, event: r.tourn,", "won: r.won, opp: r.opp, oppTitle: r.opp, event: r.tourn,"],
  ['frame: the pop-up foot back on the 12a --label', "<span class=\"ma-pop-foot\" style=\"font-size:11px; color:var(--text-label);\">", "<span class=\"ma-pop-foot\" style=\"font-size:11px; color:var(--label);\">"],
];
const SUITES = ['test-ten336-market-edge.mjs'];
// Control: the unmutated page must pass, or every "caught" below means nothing.
{ const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('✖ the suite is red on the unmutated page — mutants are meaningless'); process.exit(1); }
  console.log('✔ control: the unmutated page passes'); }
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten336-mut-'));
for (const [name, from, to] of MUTANTS) {
  if (html.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, html.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, { TEN310_HTML: file }), encoding: 'utf8' });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
