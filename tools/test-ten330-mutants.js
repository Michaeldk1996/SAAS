// TEN-330 — every check in test-ten330-form.mjs must FAIL when the behaviour it locks is reverted. Each mutant is
// applied to a copy of bsp-consult-dashboard.html and the suite is run against it (TEN330_HTML); a mutant that leaves
// the suite green is a vacuous test and fails this runner. Anchors must occur exactly once in the page.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
  ['N2: a walkover becomes a form row again', "  }).filter(r => (r.ago == null || r.ago >= 0) && !(ownEk && String(r.ek) === ownEk)   // never the analysed match itself\n    && !r.wo);",
    "  }).filter(r => (r.ago == null || r.ago >= 0) && !(ownEk && String(r.ek) === ownEk));"],
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
  ['rows: the old 7-column Form Match Row', "  return `<div class=\"seg fh-frow\" data-fh-mid=\"${fhEsc(r.mid)}\" onclick=\"fhOpenSheet('${fhEsc(r.mid)}')\" style=\"display:grid; grid-template-columns:${MA_ROW_COLS};",
    "  return `<div class=\"seg fh-frow\" data-fh-mid=\"${fhEsc(r.mid)}\" onclick=\"fhOpenSheet('${fhEsc(r.mid)}')\" style=\"display:grid; grid-template-columns:22px 40px minmax(0,1fr) 30px 38px 42px 42px;"],
  ['hot lines: the Short chip back on', "    hot: { ok: hotOk, table, sc, ctx, hdr, short: false,", "    hot: { ok: hotOk, table, sc, ctx, hdr, short: hotOk,"],
  ['career-history: keyless rows never priced', " || (r.oppKey == null && clNoKey ? fhCloseFor(clNoKey, r.date, r.opp, r.won, null, r.ek) : null);", ";"],
  ['rows: the opponent Elo leaves the name (D-12)', "fhFullName(r.opp, r.oppKey) + ' · ' + fhEloText(r.oppElo))}", "fhFullName(r.opp, r.oppKey))}"],
  ['TEN-325: no settlement note on the pill', "P.srcNote ? 'closing odds: ' + P.srcNote : '', retNote].filter(Boolean)", "P.srcNote ? 'closing odds: ' + P.srcNote : ''].filter(Boolean)"],
  ['TEN-325: no settlement note on Flat 1u', "  metrics.flat.ret = true;", "  metrics.flat.ret = false;"],
  ['hot lines: header loses the role', "${fhEsc(H.hdr.win)}${dot}${fhEsc(H.hdr.surf)}${dot}${fhEsc(H.hdr.role)}", "${fhEsc(H.hdr.win)}${dot}${fhEsc(H.hdr.surf)}"],
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
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
