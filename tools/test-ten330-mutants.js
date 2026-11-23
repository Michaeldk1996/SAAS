// TEN-330 — every check in test-ten330-form.mjs must FAIL when the behaviour it locks is reverted. Each mutant is
// applied to a copy of bsp-consult-dashboard.html and the suite is run against it (TEN330_HTML); a mutant that leaves
// the suite green is a vacuous test and fails this runner. Anchors must occur exactly once in the page.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
  ['Q27: a name links with no profile behind it', "  const has = key != null && (typeof ppSlim === 'function' ? ppSlim(key) : (typeof playerProfiles !== 'undefined' && playerProfiles && playerProfiles[String(key)]));", "  const has = key != null;"],
  ["N2: a walkover becomes a form row again", "    && !r.wo   // N2 (TEN-312)", "    && true   // N2 (TEN-312)"],
  ['ruling A: a retirement left unpriced', '    if (c){ r.price = c.price; r.oppPrice = c.oppPrice; r.book = c.book; r.src = c.src; r.srcLabel = c.srcLabel; }\n    const d = fhDayNum(r.date); r.ago',
    '    if (c && !r.ret){ r.price = c.price; r.oppPrice = c.oppPrice; r.book = c.book; r.src = c.src; r.srcLabel = c.srcLabel; }\n    const d = fhDayNum(r.date); r.ago'],
  ['rows: " ret." dropped', "  return r.sets.map(x => x[0] + '-' + x[1]).join(', ') + (r.ret ? ' ret.' : '');", "  return r.sets.map(x => x[0] + '-' + x[1]).join(', ');"],
  ['rows: set scores double-space joined', "  return r.sets.map(x => x[0] + '-' + x[1]).join(', ') + (r.ret ? ' ret.' : '');", "  return r.sets.map(x => x[0] + '-' + x[1]).join('  ') + (r.ret ? ' ret.' : '');"],
  ['N1: Form opens on All', "      form: { surf: fhSurfName(m.surface) || 'all',", "      form: { surf: 'all',"],
  ['career-history: no cap', "  return (walkovers ? rows : rows.slice(0, FH_FORM_ROW_CAP)).map(", "  return rows.map("],
  ['career-history: a walkover row counted into the Form rows (2026-10-22)', "filter(([x]) => x && x.date && !!x.walkover === !!walkovers)", "filter(([x]) => x && x.date)"],
  ['career-history: never read', "  const rowsOf = i => ((m._fhFormRows || [])[i]) || (i ? m.p2RecentFormMatches : m.p1RecentFormMatches) || [];",
    "  const rowsOf = i => (i ? m.p2RecentFormMatches : m.p1RecentFormMatches) || [];"],
  ['rows: group header loses "surface · W–L"', "      entries.push({ isHead: true, tourn: r.tourn, meta: (r.surface || FH_DASHC) + ' · ' + tw + '–' + (tm.length - tw) });",
    "      entries.push({ isHead: true, tourn: r.tourn, meta: '' });"],
  ['hot lines: the Short chip back on', "    hot: { ok: hotOk, table, sc, ctx, hdr, short: false,", "    hot: { ok: hotOk, table, sc, ctx, hdr, short: hotOk,"],
  ['career-history: keyless rows never priced', "    const c = r.oppKey == null && clNoKey ? fhCloseFor(clNoKey, r.date, r.opp, r.won, null, r.ek) : fhCloseFor(", "    const c = false ? null : fhCloseFor("],
  ['career-history: the keyless join only as a fallback (order broken)', "    const c = r.oppKey == null && clNoKey ? fhCloseFor(clNoKey, r.date, r.opp, r.won, null, r.ek) : fhCloseFor(clRows, r.date, r.opp, r.won, r.oppKey, r.ek);", "    const c = fhCloseFor(clRows, r.date, r.opp, r.won, r.oppKey, r.ek) || (r.oppKey == null && clNoKey ? fhCloseFor(clNoKey, r.date, r.opp, r.won, null, r.ek) : null);"],
  ['TEN-325: no settlement note on Flat 1u', "  metrics.flat.ret = true;", "  metrics.flat.ret = false;"],
  ["review 2: Laver Cup back in Form", "&& !FH_FORM_NOT_ATP_RECORD.test(", "&& !/^$/.test("],
  ['DoD 8: a Form-local row renderer back in the dashboard', "\nfunction fhFormPlayer(m, idx, st){", "\nfunction fhFormRowHtml(r){ return ''; }\nfunction fhFormPlayer(m, idx, st){"],
];
// Match analysis rebuild (2026-11-23): the Form renderers live in match-analysis-v2.js; these mutants are applied to a copy
// of it (TEN330_MA2). Each bites the rebuilt renderer.
const ma2 = fs.readFileSync(path.join(ROOT, 'match-analysis-v2.js'), 'utf8');
const MA2_MUTANTS = [
  ['bars: no closing price under the bar', "height:11px;\">' + (n > 12 ? '' : px) + '</span></div>'", "height:11px;\">' + '</span></div>'"],
  ['bars: an unpriced bar prints nothing', "const px = r.price != null ? fhOdd(r.price) : DASH, elo", "const px = r.price != null ? fhOdd(r.price) : '', elo"],
  ['DoD 8: a bar no longer opens the sheet', "'<div class=\"ma2-fbar\" onclick=\"fhOpenSheet(\\'' + esc(r.mid) + '\\')\"", "'<div class=\"ma2-fbar\" onclick=\"\""],
  ['DoD 8: a row no longer opens the sheet', "' data-fh-mid=\"' + esc(r.mid) + '\" onclick=\"fhOpenSheet(\\'' + esc(r.mid) + '\\')\" title=\"Open the match stats\"'", "' data-fh-mid=\"' + esc(r.mid) + '\" title=\"Open the match stats\"'"],
  ['rows: an Elo slot in the Form row (TEN-380 Q5)', "overflow-wrap:anywhere; min-width:0;\">' + esc(fhOppFmt(r.opp)) + '</span>'", "overflow-wrap:anywhere; min-width:0;\">' + esc(fhOppFmt(r.opp)) + ' <span class=\"ma-row-elo\">Elo</span></span>'"],
  ['rows: the column back to "Set scores"', "hd + 'Score</span><span style=", "hd + 'Set scores</span><span style="],
  ['rows: the Score cell cut whole, no break between sets', "'<span style=\"white-space:nowrap;\">' + esc(x) + (i < a.length - 1 ? ',' : '') + '</span>'", "esc(x) + (i < a.length - 1 ? ',' : '')"],
  ['divider: a blue rule', "padding:8px 18px;\"><span style=\"flex:1; height:1px; background:' + W(6) + ';\"></span>", "padding:8px 18px;\"><span style=\"flex:1; height:1px; background:var(--ma2-blue);\"></span>"],
  ['hot lines: a % printed on n 3–4', "pct = g === 'nopct' ? DASH : Math.round(", "pct = false ? DASH : Math.round("],
  ['hot lines: the rate off the gate (no grey tier)', "g === 'small' ? ' title=\"small sample\"' : '') + ' style=\"' + MONO + ' font-size:15px; font-weight:700; color:' + (g === 'full' ? 'var(--ma2-text)' : 'var(--ma2-grey)')", "g === 'small' ? ' title=\"small sample\"' : '') + ' style=\"' + MONO + ' font-size:15px; font-weight:700; color:' + ('var(--ma2-text)')"],
  ['hot lines: dots in the player colour again', "onclick=\"fhOpenSheet(\\'' + esc(r.mid) + '\\')\" style=\"width:' + (e ? 10 : 6) + 'px; height:' + (e ? 10 : 6) + 'px; border-radius:50%; background:' + (!e ? W(8) : c ? 'var(--ma2-blue)' : 'transparent') + '; border:1.5px solid ' + (!e ? 'transparent' : 'var(--ma2-blue)')", "onclick=\"fhOpenSheet(\\'' + esc(r.mid) + '\\')\" style=\"width:' + (e ? 10 : 6) + 'px; height:' + (e ? 10 : 6) + 'px; border-radius:50%; background:' + (!e ? W(8) : c ? 'var(--ma2-blue)' : 'transparent') + '; border:1.5px solid ' + (!e ? 'transparent' : (P.idx ? 'var(--ma2-text)' : 'var(--ma2-blue)'))"],
  ['hot lines: Most covered dropped', "const topK = sc.scored.length ? sc.scored[0].k : -1, all", "const topK = -1, all"],
  ['hot lines: header loses the role', "esc(H.hdr.win + ' · ' + H.hdr.surf + ' · ' + H.hdr.role)", "esc(H.hdr.win + ' · ' + H.hdr.surf)"],
  ['form: Last N off its own track', "tr([5, 10, 15, 20].map(k => [k, 'Last ' + k]), S.n, 'n')", "[5, 10, 15, 20].map(k => 'Last ' + k).join(' ')"],
  ['TEN-325: no settlement note on the Against the market hover', "P.mktOk && typeof fhRetNote === 'function' ? fhRetNote() : ''].filter(Boolean)", "''].filter(Boolean)"],
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
for (const [name, from, to] of MA2_MUTANTS) {
  if (ma2.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'ma2.js');
  fs.writeFileSync(file, ma2.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, { TEN330_MA2: file }), encoding: 'utf8' });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
// TEN-383: the board card's Recent form % is the pipeline's recentFormPct. Each pipeline mutant is written beside
// bsp-pipeline.js (its relative requires must resolve) and only counts as caught when the TEN-383 test is what fails.
const pipe = fs.readFileSync(path.join(ROOT, 'bsp-pipeline.js'), 'utf8');
const PIPE_MUTANTS = [
  ['TEN-383: Laver Cup back in the card\'s Recent form %', ".filter(m => !FORM_NOT_ATP_RECORD.test(String(m.tournament || '')))", ''],
  ['TEN-383: Davis Cup and United Cup out of the card\'s Recent form %', "new RegExp('laver cup|' + FORM_EVENTS_NOT_COUNTED.source, 'i')", "new RegExp('laver cup|davis cup|united cup|' + FORM_EVENTS_NOT_COUNTED.source, 'i')"],
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
  ['TEN-383: the profile header filtered (Current run is a record)', '    var rows = formMatches(p);   // 2026-11-16: the record\'s TE-only rows too (formMatches)\n    // One filtered set', '    var rows = formMatches(p).filter(inForm);\n    // One filtered set'],
  ['TEN-383: the profile list drifts (Davis Cup out)', 'var FORM_NOT_ATP_RECORD = /laver cup|', 'var FORM_NOT_ATP_RECORD = /laver cup|davis cup|'],
  // TEN-384: the ledger's provenance footnote (its own window count) is gone; the ledger now draws and counts
  // ctx.ledgerFiltered (the form rows) — the mutant hands it every record row instead.
  ['TEN-383: the ledger window counts Laver Cup again', '    var rows = ctx.ledgerFiltered;', '    var rows = ledgerFiltered(ctx.ledgerRows);'],
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
const total = MUTANTS.length + MA2_MUTANTS.length + PIPE_MUTANTS.length + PP2_MUTANTS.length;
console.log(`mutants: ${total - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
