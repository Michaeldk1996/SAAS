// TEN-350 — every check in test-ten350-elo-slot.mjs must FAIL when the behaviour it locks is reverted. Each mutant is
// applied to a copy of bsp-consult-dashboard.html and the suite is run against it (TEN350_HTML); a mutant that leaves
// the suite green is a vacuous test and fails this runner. Anchors must occur exactly once in the page.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
  ['wiring: the tooltip reads the current Elo (the newest snapshot, not the match date)', 'if (a != null && a < d) snap = x; }', 'if (a != null) snap = x; }'],
];
// Match analysis rebuild (2026-11-23): the rows and the bar tooltip are drawn by match-analysis-v2.js; these mutants are
// applied to a copy of it (TEN350_MA2).
const ma2 = fs.readFileSync(path.join(ROOT, 'match-analysis-v2.js'), 'utf8');
const MA2_MUTANTS = [
  ['wiring: the tooltip Elo loses its reason on hover', "<span class=\"fh-tip-elo\" title=\"' + esc(fhEloText(r.oppElo)) + '\" style=", "<span class=\"fh-tip-elo\" style="],
  ['wiring: a missing Elo prints blank instead of a dash', ": 'Elo ' + DASH;", ": 'Elo ';"],
  ['TEN-380 Q5: an Elo slot back in the Form row', "overflow-wrap:anywhere; min-width:0;\">' + esc(fhOppFmt(r.opp)) + '</span>'", "overflow-wrap:anywhere; min-width:0;\">' + esc(fhOppFmt(r.opp)) + '</span><span class=\"ma-row-elo\" data-elo=\"\">—</span>'"],
  ['TEN-380 Q5: an Elo slot back in the H2H meeting row', "+ esc(r.tourn) + '</span><span class=\"h2hide\" style=\"font-size:11.5px; color:var(--ma2-grey); white-space:nowrap;\">' + esc([surf", "+ esc(r.tourn) + '</span><span class=\"ma-row-elo\" data-elo=\"\">—</span><span class=\"h2hide\" style=\"font-size:11.5px; color:var(--ma2-grey); white-space:nowrap;\">' + esc([surf"],
  ['layout: the Form Opponent track loses its floor and its share (a long name broken mid-word)', "const FL_COLS = 'grid-template-columns:44px 8px minmax(78px,1.1fr)", "const FL_COLS = 'grid-template-columns:44px 8px minmax(0,0.2fr)"],
  ['layout: Form names never wrap (a long name runs into the Rd column)', "<span title=\"' + esc(fhFullName(r.opp, r.oppKey)) + '\" style=\"font-size:12.5px; font-weight:600; color:var(--ma2-text); overflow-wrap:anywhere;", "<span title=\"' + esc(fhFullName(r.opp, r.oppKey)) + '\" style=\"font-size:12.5px; font-weight:600; color:var(--ma2-text); white-space:nowrap;"],
  ['layout: H2H event names never wrap', "font-weight:600; color:var(--ma2-text); overflow-wrap:anywhere;\" title=\"' + esc(r.tourn + ' ' + String(r.date)", "font-weight:600; color:var(--ma2-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:40px; display:inline-block;\" title=\"' + esc(r.tourn + ' ' + String(r.date)"],
];
const SUITES = ['test-ten350-elo-slot.mjs'];
// Control: the unmutated page must pass, or every "caught" below means nothing.
{ const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('✖ the suite is red on the unmutated page — mutants are meaningless\n' + r.stdout.slice(-3000)); process.exit(1); }
  console.log('✔ control: the unmutated page passes'); }
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten350-mut-'));
for (const [name, from, to] of MUTANTS) {
  if (html.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, html.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, { TEN350_HTML: file }), encoding: 'utf8' });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
for (const [name, from, to] of MA2_MUTANTS) {
  if (ma2.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'ma2.js');
  fs.writeFileSync(file, ma2.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, { TEN350_MA2: file }), encoding: 'utf8' });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length + MA2_MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
