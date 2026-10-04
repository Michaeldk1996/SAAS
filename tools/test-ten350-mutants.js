// TEN-350 — every check in test-ten350-elo-slot.mjs must FAIL when the behaviour it locks is reverted. Each mutant is
// applied to a copy of bsp-consult-dashboard.html and the suite is run against it (TEN350_HTML); a mutant that leaves
// the suite green is a vacuous test and fails this runner. Anchors must occur exactly once in the page.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
  ['wiring: the tooltip reads the current Elo (the newest snapshot, not the match date)', 'if (a != null && a < d) snap = x; }', 'if (a != null) snap = x; }'],
  ['wiring: the tooltip Elo loses its reason on hover', 'class="fh-tip-elo" title="${fhEsc(fhEloText(r.oppElo))}" style=', 'class="fh-tip-elo" style='],
  ['wiring: a missing Elo prints blank instead of a dash', "Elo ${r.oppElo && r.oppElo.v != null ? r.oppElo.v : FH_DASHC}</span>", "Elo ${r.oppElo && r.oppElo.v != null ? r.oppElo.v : ''}</span>"],
  ['TEN-380 Q5: an Elo slot back in the match row', "${esc(r.opp)}</span>${tagSlot(r)}</span>`", "${esc(r.opp)}</span>${tagSlot(r)} <span class=\"ma-row-elo\" data-elo=\"\">—</span></span>`"],
  ['layout: the README §5 Opponent track loses its 78 px floor and its share (a long name broken mid-word)', "const MA_ROW_COLS = '40px 10px minmax(96px,1.4fr) 28px 34px minmax(64px,1fr) 38px 38px';", "const MA_ROW_COLS = '40px 10px minmax(0,0.4fr) 28px 34px minmax(86px,1.3fr) 38px 38px';"],
  ['layout: names never wrap (a long name runs into the Rd column)', "<span${r.oppAttrs || ''}${t(r.oppTitle)}>${esc(r.opp)}</span>${tagSlot(r)}", "<span${r.oppAttrs || ''}${t(r.oppTitle)} style=\"white-space:nowrap;\">${esc(r.opp)}</span>${tagSlot(r)}"],
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
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
