// TEN-330 — every check in test-ten330-form.mjs must FAIL when the behaviour it locks is reverted. Each mutant is
// applied to a copy of bsp-consult-dashboard.html and the suite is run against it (TEN330_HTML); a mutant that leaves
// the suite green is a vacuous test and fails this runner. Anchors must occur exactly once in the page.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
  ['Q27: a name links with no profile behind it', "  const has = key != null && typeof playerProfiles !== 'undefined' && playerProfiles && playerProfiles[String(key)];", "  const has = key != null;"],
  ["N2: a walkover becomes a form row again", "    && !r.wo   // N2 (TEN-312)", "    && true   // N2 (TEN-312)"],
  ['ruling A: a retirement left unpriced', '    if (c){ r.price = c.price; r.oppPrice = c.oppPrice; r.book = c.book; r.src = c.src; }\n    const d = fhDayNum(r.date); r.ago',
    '    if (c && !r.ret){ r.price = c.price; r.oppPrice = c.oppPrice; r.book = c.book; r.src = c.src; }\n    const d = fhDayNum(r.date); r.ago'],
  ['rows: " ret." dropped', "  return r.sets.map(x => x[0] + '-' + x[1]).join(', ') + (r.ret ? ' ret.' : '');", "  return r.sets.map(x => x[0] + '-' + x[1]).join(', ');"],
  ['rows: set scores double-space joined', "  return r.sets.map(x => x[0] + '-' + x[1]).join(', ') + (r.ret ? ' ret.' : '');", "  return r.sets.map(x => x[0] + '-' + x[1]).join('  ') + (r.ret ? ' ret.' : '');"],
  ['bars: no closing price under the bar', "${r.price != null ? fhOdd(r.price) : FH_DASHC}</span></div>", "</span></div>"],
  ['bars: an unpriced bar prints nothing', "${r.price != null ? fhOdd(r.price) : FH_DASHC}</span></div>", "${r.price != null ? fhOdd(r.price) : ''}</span></div>"],
  ['N1: Form opens on All', "      form: { surf: fhSurfName(m.surface) || 'all',", "      form: { surf: 'all',"],
  ['career-history: no cap', "  return (Array.isArray(ch) ? ch : []).filter(x => x && x.date).slice(0, FH_FORM_ROW_CAP).map(", "  return (Array.isArray(ch) ? ch : []).filter(x => x && x.date).map("],
  ['career-history: never read', "  const rowsOf = i => ((m._fhFormRows || [])[i]) || (i ? m.p2RecentFormMatches : m.p1RecentFormMatches) || [];",
    "  const rowsOf = i => (i ? m.p2RecentFormMatches : m.p1RecentFormMatches) || [];"],
  ['rows: group header loses "surface · W–L"', "      entries.push({ isHead: true, tourn: r.tourn, meta: (r.surface || FH_DASHC) + ' · ' + tw + '–' + (tm.length - tw) });",
    "      entries.push({ isHead: true, tourn: r.tourn, meta: '' });"],
  ['rows: the shared helper loses the Form inset parameter', "{ headPad: '10px 14px 8px', groupPad: '11px 14px 5px', inset: 8,", "{"],
  ['DoD 8: a Form-local row renderer again', "function fhFormListHtml(P){", "function fhFormRowHtml(r){ return ''; }\nfunction fhFormListHtml(P){"],
  ['DoD 8: bars back on a Form-local tooltip', "return maTipHtml(bar, tip, { tag: 'div', cls: 'fh-bar',", "return maTipHtml(bar, tip, { tag: 'div', cls: 'fh-bar fh-elotip',"],
  ['hot lines: the Short chip back on', "    hot: { ok: hotOk, table, sc, ctx, hdr, short: false,", "    hot: { ok: hotOk, table, sc, ctx, hdr, short: hotOk,"],
  ['career-history: keyless rows never priced', "    const c = r.oppKey == null && clNoKey ? fhCloseFor(clNoKey, r.date, r.opp, r.won, null, r.ek) : fhCloseFor(", "    const c = false ? null : fhCloseFor("],
  ['career-history: the keyless join only as a fallback (order broken)', "    const c = r.oppKey == null && clNoKey ? fhCloseFor(clNoKey, r.date, r.opp, r.won, null, r.ek) : fhCloseFor(clRows, r.date, r.opp, r.won, r.oppKey, r.ek);", "    const c = fhCloseFor(clRows, r.date, r.opp, r.won, r.oppKey, r.ek) || (r.oppKey == null && clNoKey ? fhCloseFor(clNoKey, r.date, r.opp, r.won, null, r.ek) : null);"],
  ['rows: an Elo slot back in the Form row (TEN-380 Q5)', "${esc(r.opp)}</span>${tagSlot(r)}</span>`", "${esc(r.opp)}</span>${tagSlot(r)} <span class=\"ma-row-elo\" data-elo=\"\">—</span></span>`"],
  // TEN-380 (README §5): the Score column, the README grid, the --card head on a --line rule, the --edge-10 divider
  ['rows: the column back to "Set scores"', "const labels = o.labels || ['Date', '', 'Opponent', 'Rd', 'Sets', 'Score', 'H', 'A'];", "const labels = o.labels || ['Date', '', 'Opponent', 'Rd', 'Sets', 'Set scores', 'H', 'A'];"],
  ['rows: back on the file\'s grid', "const MA_ROW_COLS = '40px 10px minmax(96px,1fr) 28px 34px minmax(86px,1fr) 38px 38px';", "const MA_ROW_COLS = '48px 12px minmax(0,1.1fr) 36px 40px minmax(0,1.3fr) 46px 46px';"],
  ['rows: the Score cell back to --text-soft', "<span class=\"ma-row-score\"${t(r.scoresTitle)} style=\"${mono} font-size:11px; color:var(--text-label);", "<span class=\"ma-row-score\"${t(r.scoresTitle)} style=\"${mono} font-size:11px; color:var(--text-soft);"],
  ['rows: the head back on the page tone', "background:${o.bg || 'var(--card)'}; padding:${o.headPad || '6px 6px 7px'};", "background:${o.bg || 'var(--page)'}; padding:${o.headPad || '6px 6px 7px'};"],
  ['divider: the blue rules back', "const rule = 'var(--edge-10)';   // README §5: the divider's rules", "const rule = 'var(--open-card)';"],
  // TEN-380 hot lines (README §5): Rate on the D2 gate, --hot-dot dots, Most covered = --inner, no edge
  ['hot lines: a % printed on n 3–4', "if (maGate(n).mode === 'nopct') return `<span class=\"fh-hl-rate\" data-ma-gate=\"nopct\"", "if (false) return `<span class=\"fh-hl-rate\" data-ma-gate=\"nopct\""],
  ['hot lines: the Rate off the gate (no grey tier)', "return `<span class=\"fh-hl-rate\" style=\"display:flex; min-width:0;\">${maRateHtml(c, n, { note: 'title', color: 'var(--text)', style: mono })}</span>`;", "return `<span class=\"fh-hl-rate\" style=\"display:flex; min-width:0;\"><span class=\"ma-rate\" data-ma-gate=\"full\" style=\"color:var(--text);${mono}\">${Math.round(c / n * 100)}%</span></span>`;"],
  ['hot lines: dots in the player colour again', "const dotC = 'var(--hot-dot)', offDot", "const dotC = opts.color || 'var(--fh-pa)', offDot"],
  ['hot lines: Most covered back on --selected', "background:${isTop ? 'var(--inner)' : 'transparent'}; cursor:default;", "background:${isTop ? 'var(--selected)' : 'transparent'}; cursor:default;"],
  ['form: the four filters wrap onto two lines', "<div class=\"fh-filters\" style=\"display:flex; align-items:center; gap:10px; flex-wrap:nowrap; overflow-x:auto;", "<div class=\"fh-filters\" style=\"display:flex; align-items:center; gap:10px; flex-wrap:wrap; overflow-x:auto;"],
  ['form: Last N back off its track', "  const valsHtml = fhSegTrack(vals);", "  const valsHtml = vals.map(it => it.label).join('');"],
  ['TEN-325: no settlement note on the pill', "P.srcNote ? 'closing odds: ' + P.srcNote : '', retNote].filter(Boolean)", "P.srcNote ? 'closing odds: ' + P.srcNote : ''].filter(Boolean)"],
  ['TEN-325: no settlement note on Flat 1u', "  metrics.flat.ret = true;", "  metrics.flat.ret = false;"],
  ['hot lines: header loses the role', "${fhEsc(H.hdr.win)}${dot}${fhEsc(H.hdr.surf)}${dot}${fhEsc(H.hdr.role)}", "${fhEsc(H.hdr.win)}${dot}${fhEsc(H.hdr.surf)}"],
  ["review 2: Laver Cup back in Form", "&& !FH_FORM_NOT_ATP_RECORD.test(", "&& !/^$/.test("],
  ['TEN-383: legacy profile tile back on every match', '  const last10 = formRows.slice(0, 10);', '  const last10 = recentMatches.slice(0, 10);'],
  ['TEN-383: legacy profile list back on every match', "  const formMatches = formSurf === 'All' ? formRows : formRows.filter(", "  const formMatches = formSurf === 'All' ? recentMatches : recentMatches.filter("],
];
const SUITES = ['test-ten330-form.mjs'];
// Control: the unmutated page must pass, or every "caught" below means nothing.
{ const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('✖ the suite is red on the unmutated page — mutants are meaningless'); process.exit(1); }
  console.log('✔ control: the unmutated page passes'); }
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten330-mut-'));
for (const [name, from, to] of MUTANTS) {
  if (html.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, html.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, { TEN330_HTML: file }), encoding: 'utf8' });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
// TEN-383: the board card's Recent form % is the pipeline's recentFormPct. Each pipeline mutant is written beside
// bsp-pipeline.js (its relative requires must resolve) and only counts as caught when the TEN-383 test is what fails.
const pipe = fs.readFileSync(path.join(ROOT, 'bsp-pipeline.js'), 'utf8');
const PIPE_MUTANTS = [
  ['TEN-383: Laver Cup back in the card\'s Recent form %', ".filter(m => !FORM_NOT_ATP_RECORD.test(String(m.tournament || '')))", ''],
  ['TEN-383: Davis Cup and United Cup out of the card\'s Recent form %', "new RegExp('laver cup|' + H2H_NOT_ATP_RECORD.source, 'i')", "new RegExp('laver cup|davis cup|united cup|' + H2H_NOT_ATP_RECORD.source, 'i')"],
];
const pfile = path.join(ROOT, '.ten330-mut-pipeline.js');
try {
  for (const [name, from, to] of PIPE_MUTANTS) {
    if (pipe.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
    fs.writeFileSync(pfile, pipe.replace(from, to));
    const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, { TEN330_PIPELINE: pfile }), encoding: 'utf8' });
    if (r.status === 0 || !/✖ TEN-383/.test(r.stdout)) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
  }
} finally { fs.rmSync(pfile, { force: true }); }
// TEN-383 "profile too": the Player Profile V2 renderer (player-profile-v2.js) reads the same list. Loaded with new
// Function (no relative requires), so the mutant can live in the temp dir; caught only when a TEN-383 test fails.
const pp2 = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
const PP2_MUTANTS = [
  ['TEN-383: Laver Cup back in the profile Recent form', '    var frows = lrows.filter(function (x) { return inForm(x.m); });', '    var frows = lrows;'],
  ['TEN-383: the profile header filtered (Current run is a record)', '    var rows = ledgerMatches(p);\n    // One filtered set', '    var rows = ledgerMatches(p).filter(inForm);\n    // One filtered set'],
  ['TEN-383: the profile list drifts (Davis Cup out)', 'var FORM_NOT_ATP_RECORD = /laver cup|', 'var FORM_NOT_ATP_RECORD = /laver cup|davis cup|'],
  ['TEN-383: the ledger window counts Laver Cup again', '    var all = ctx.ledgerRows.filter(function (x) { return inForm(x.m); });', '    var all = ctx.ledgerRows;'],
];
const ppDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten330-pp2-'));
try {
  for (const [name, from, to] of PP2_MUTANTS) {
    if (pp2.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
    const f = path.join(ppDir, 'pp2.js');
    fs.writeFileSync(f, pp2.replace(from, to));
    const r = spawnSync(process.execPath, ['--test', ...SUITES.map(x => path.join(ROOT, x))], { env: Object.assign({}, process.env, { TEN330_PP2: f }), encoding: 'utf8' });
    if (r.status === 0 || !/✖ TEN-383/.test(r.stdout)) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
  }
} finally { fs.rmSync(ppDir, { recursive: true, force: true }); }
const total = MUTANTS.length + PIPE_MUTANTS.length + PP2_MUTANTS.length;
console.log(`mutants: ${total - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
