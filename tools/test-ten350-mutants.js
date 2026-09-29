// TEN-350 — every check in test-ten350-elo-slot.mjs must FAIL when the behaviour it locks is reverted. Each mutant is
// applied to a copy of bsp-consult-dashboard.html and the suite is run against it (TEN350_HTML); a mutant that leaves
// the suite green is a vacuous test and fails this runner. Anchors must occur exactly once in the page.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
  ['wiring: the slot reads the current Elo (the newest snapshot, not the match date)', 'if (a != null && a < d) snap = x; }', 'if (a != null) snap = x; }'],
  ['wiring: the dash loses its reason on hover', 'data-elo="${esc(r.elo.v == null ? \'\' : r.elo.v)}"${t(r.elo.title)} style=', 'data-elo="${esc(r.elo.v == null ? \'\' : r.elo.v)}" style='],
  ['wiring: a missing Elo prints blank instead of a dash', "txt: e && e.v != null ? String(e.v) : FH_DASHC,", "txt: e && e.v != null ? String(e.v) : '',"],
  ['wiring: Form rows lose the slot', "elo: fhEloSlot(r.oppElo),\n    wrapCls:", "\n    wrapCls:"],
  ['wiring: H2H rows lose the slot', "elo: fhEloSlot(r.oppElo),\n    cls: 'fh-h2row',", "\n    cls: 'fh-h2row',"],
  ['wiring: the hover-only interim back on the Form name', "oppTitle: fhFullName(r.opp, r.oppKey), oppAttrs: ' class=\"fh-opp\"', elo: fhEloSlot(r.oppElo),\n    wrapCls:",
    "oppTitle: fhFullName(r.opp, r.oppKey) + ' · ' + fhEloText(r.oppElo), oppAttrs: ' class=\"fh-opp\"', elo: fhEloSlot(r.oppElo),\n    wrapCls:"],
  ['layout: Form back on the file\'s 8-track grid (a long name is broken mid-word in the ~59 px Opponent track)', "fullNames: true, scoresBelow: true,", ""],
  ['layout: names never wrap (a long name runs into the Rd column)', "<span${r.oppAttrs || ''}${t(r.oppTitle)}>${esc(r.opp)}</span>${eloSlot(r)}", "<span${r.oppAttrs || ''}${t(r.oppTitle)} style=\"white-space:nowrap;\">${esc(r.opp)}</span>${eloSlot(r)}"],
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
