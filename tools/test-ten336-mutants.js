// TEN-336 — every check in test-ten336-market-edge.mjs must FAIL when the behaviour it locks is reverted. Each mutant is
// applied to a copy of bsp-consult-dashboard.html and the suite is run against it (TEN310_HTML, read by
// tools/ten310-harness.mjs); a mutant that leaves the suite green is a vacuous test and fails this runner. Anchors must
// occur exactly once in the page.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
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
  ['geometry: band column head on the soft rule', "gap:0 8px; align-items:end; padding:0 8px 7px; border-bottom:${ME_C.hw} solid ${ME_C.headLine};", "gap:0 8px; align-items:end; padding:0 8px 7px; border-bottom:${ME_C.hw} solid ${ME_C.rowLine};"],
  ['band: the open band loses its wash', "background:${isToday || on ? ME_C.wash : 'transparent'};", "background:${isToday ? ME_C.wash : 'transparent'};"],
  ['pill: tooltip dropped', "  return maTipHtml(pill, body, { popStyle:", "  return pill; maTipHtml(pill, body, { popStyle:"],
  ['helper: a titleless group draws its header', "    + (g.title == null ? '' : `<div class=\"ma-rows-group\"", "    + (false ? '' : `<div class=\"ma-rows-group\""],
  ['helper: price column no longer right-aligned', "  price: { right: true, cell:", "  price: { cell:"],
  ['helper: table rows lose their hairline', "const line = o.rowLine === false ? '' : ` border-bottom:1px solid color-mix(in srgb, var(--text) 3%, transparent);`;", "const line = '';"],
  ['helper: the table head sticks', "const head = `<div class=\"ma-rows-head\" style=\"${grid} padding:", "const head = `<div class=\"ma-rows-head\" style=\"position:sticky; top:0; ${grid} padding:"],
  ['helper: the default rows change by a pixel', "grid-template-columns:${COLS}; gap:0 10px; align-items:center; padding:6px;", "grid-template-columns:${COLS}; gap:0 10px; align-items:center; padding:7px;"],
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
