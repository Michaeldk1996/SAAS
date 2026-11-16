// TEN-402 r4, builder N (founder post-live fixes, comment 276cbc50) — every check in test-ten402-r4n.mjs must FAIL when
// its rule is reverted or bent. Each mutant is applied to a copy of bsp-consult-dashboard.html (TEN402_HTML) and the
// suite runs against it; a mutant that leaves it green is a vacuous test and fails this runner. Anchors occur exactly once.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
// The rebuilt page (design_handoff_head_to_head, founder 2026-11-16): the anchors are the shipped template's inline styles;
// the CSS mutants apply to h2h-page.css (TEN402_CSS).
const CSS_SRC = fs.readFileSync(path.join(ROOT, 'h2h-page.css'), 'utf8');
const MUTANTS = [
  ["fix 1: the picker scrolls away (not sticky)", "<div class=\"x-stick\" style=\"position:sticky; top:0; z-index:30; padding:10px 40px 14px; background:linear-gradient(var(--h2h-page) 78%, var(--h2h-page-0));\">", "<div class=\"x-stick\" style=\"position:relative; top:0; z-index:30; padding:10px 40px 14px; background:linear-gradient(var(--h2h-page) 78%, var(--h2h-page-0));\">"],
  ["fix 1: the picker sticks below the top (a gap cards show through)", "<div class=\"x-stick\" style=\"position:sticky; top:0; z-index:30; padding:10px 40px 14px; background:linear-gradient(var(--h2h-page) 78%, var(--h2h-page-0));\">", "<div class=\"x-stick\" style=\"position:sticky; top:30px; z-index:30; padding:10px 40px 14px; background:linear-gradient(var(--h2h-page) 78%, var(--h2h-page-0));\">"],
  ["fix 1: the band transparent", "<div class=\"x-stick\" style=\"position:sticky; top:0; z-index:30; padding:10px 40px 14px; background:linear-gradient(var(--h2h-page) 78%, var(--h2h-page-0));\">", "<div class=\"x-stick\" style=\"position:sticky; top:0; z-index:30; padding:10px 40px 14px; background:transparent;\">"],
  ["fix 1: the band under the sections", "<div class=\"x-stick\" style=\"position:sticky; top:0; z-index:30; padding:10px 40px 14px; background:linear-gradient(var(--h2h-page) 78%, var(--h2h-page-0));\">", "<div class=\"x-stick\" style=\"position:sticky; top:0; z-index:1; padding:10px 40px 14px; background:linear-gradient(var(--h2h-page) 78%, var(--h2h-page-0));\">"],
  ["fix 1: no band above the card", "<div class=\"x-stick\" style=\"position:sticky; top:0; z-index:30; padding:10px 40px 14px; background:linear-gradient(var(--h2h-page) 78%, var(--h2h-page-0));\">", "<div class=\"x-stick\" style=\"position:sticky; top:0; z-index:30; padding:0 40px 14px; background:linear-gradient(var(--h2h-page) 78%, var(--h2h-page-0));\">"],
  ["fix 2: the career-match score on one ellipsised line", "color:var(--h2h-soft); white-space:normal;\">${E(scores)}</span>", "color:var(--h2h-soft); white-space:nowrap; text-overflow:ellipsis; overflow:hidden;\">${E(scores)}</span>"],
  ["fix 2: the meetings-box score clipped", "color:${X_G}; white-space:normal;\">${E(sc2)}</span>", "color:${X_G}; white-space:normal; overflow:hidden;\">${E(sc2)}</span>"],
  ["fix 2: the Tournament score cut", "white-space:normal;\">${E(d.scores || '—')}</span>", "white-space:nowrap;\">${E(d.scores || '—')}</span>"],
  ["fix 3: the meetings box back to \"0 - 2\"", "const sets = r.pS == null || r.ret ? '—' : r.pS + '–' + r.oS,", "const sets = r.pS == null || r.ret ? '—' : r.pS + ' - ' + r.oS,"],
  ["fix 3: the meetings box hyphen without spaces (\"0-2\")", "const sets = r.pS == null || r.ret ? '—' : r.pS + '–' + r.oS,", "const sets = r.pS == null || r.ret ? '—' : r.pS + '-' + r.oS,"],
  ["fix 3: a meetings-box retirement shows its sets", "const sets = r.pS == null || r.ret ? '—' : r.pS + '–' + r.oS,", "const sets = r.pS == null ? '—' : r.pS + '–' + r.oS,"],
  ["fix 3: the career-match ledger back on ps2Meeting's \"1 - 3\"", "const sets = m.ret ? '—' : m.pS + m.oS ? m.pS + '–' + m.oS : m.sets;", "const sets = m.ret ? '—' : m.sets;"],
  ["fix 3: a career-match retirement shows its sets", "const sets = m.ret ? '—' : m.pS + m.oS ? m.pS + '–' + m.oS : m.sets;", "const sets = m.pS + m.oS ? m.pS + '–' + m.oS : m.sets;"],
  ["fix 3: the Tournament rows back to \"3 - 1\"", "    sets: r.wo || r.pS == null ? FH_DASHC : r.pS + '–' + r.oS, setsColor: r.wo || r.pS == null ? FH_DASH : null,\n    scores: fhH2hSetScores(r), scoresTitle: r.sets ? fhH2hSetScores(r) : 'No set scores on record for this match',", "    sets: r.wo || r.pS == null ? FH_DASHC : r.pS + ' - ' + r.oS, setsColor: r.wo || r.pS == null ? FH_DASH : null,\n    scores: fhH2hSetScores(r), scoresTitle: r.sets ? fhH2hSetScores(r) : 'No set scores on record for this match',"],
  ["fix 3: the Tournament rows spaced en dash (\"3 – 1\")", "    sets: r.wo || r.pS == null ? FH_DASHC : r.pS + '–' + r.oS, setsColor: r.wo || r.pS == null ? FH_DASH : null,\n    scores: fhH2hSetScores(r), scoresTitle: r.sets ? fhH2hSetScores(r) : 'No set scores on record for this match',", "    sets: r.wo || r.pS == null ? FH_DASHC : r.pS + ' – ' + r.oS, setsColor: r.wo || r.pS == null ? FH_DASH : null,\n    scores: fhH2hSetScores(r), scoresTitle: r.sets ? fhH2hSetScores(r) : 'No set scores on record for this match',"],
  ["fix 3: a walkover gets \"0–0\"", "    sets: r.wo || r.pS == null ? FH_DASHC : r.pS + '–' + r.oS, setsColor: r.wo || r.pS == null ? FH_DASH : null,\n    scores: fhH2hSetScores(r), scoresTitle: r.sets ? fhH2hSetScores(r) : 'No set scores on record for this match',", "    sets: r.pS == null ? FH_DASHC : r.pS + '–' + r.oS, setsColor: r.wo || r.pS == null ? FH_DASH : null,\n    scores: fhH2hSetScores(r), scoresTitle: r.sets ? fhH2hSetScores(r) : 'No set scores on record for this match',"],
  // ---- fix 5 (Entry list empty state) retired 2026-11-15 with its test (founder ruling 1; tools/test-tt-entry.mjs)
];
const CSS_MUTANTS = [
  ["fix 1 (CSS): the stylesheet's band not sticky", "#h2hRoot .x-stick { position: sticky; top: 0; z-index: 30; padding: 10px 40px 14px;\n  background: linear-gradient(var(--h2h-page) 78%, color-mix(in srgb, var(--h2h-page) 0%, transparent)); }", "#h2hRoot .x-stick { position: relative; top: 0; z-index: 30; padding: 10px 40px 14px;\n  background: linear-gradient(var(--h2h-page) 78%, color-mix(in srgb, var(--h2h-page) 0%, transparent)); }"],
  ["fix 1 (CSS): the page behind the band another tone", ".tabpage[data-page=\"h2h\"] { background: var(--h2h-page); }", ".tabpage[data-page=\"h2h\"] { background: var(--h2h-card); }"],
];
const SUITES = ['test-ten402-r4n.mjs'];
const run = env => spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, env), encoding: 'utf8' });
// Control: the unmutated file must pass, or every "caught" below means nothing.
if (run({}).status !== 0) { console.error('✖ the suite is red on the unmutated file — mutants are meaningless'); process.exit(1); }
console.log('✔ control: the unmutated file passes');
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten402r4n-mut-'));
for (const [name, from, to] of MUTANTS) {
  if (src.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, src.replace(from, to));
  if (run({ TEN402_HTML: file }).status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
for (const [name, from, to] of CSS_MUTANTS) {
  if (CSS_SRC.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.css');
  fs.writeFileSync(file, CSS_SRC.replace(from, to));
  if (run({ TEN402_CSS: file }).status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length + CSS_MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
