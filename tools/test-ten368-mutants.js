// TEN-368 — every check in tools/test-ten368-event-hold.js must FAIL when the behaviour it locks is reverted. Each mutant
// is applied to a copy of build-event-hold.js (TEN368_BUILDER) and the test is run against it; a mutant that leaves it
// green is a vacuous test and fails this runner. Anchors must occur exactly once.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const FILE = 'build-event-hold.js';
const MUTANTS = [
  ['one side only', '      x.held += a.won + b.won;\n      x.games += a.total + b.total;', '      x.held += a.won;\n      x.games += a.total;'],
  ['a half box score counted', '      if (!a || !b) continue;', '      if (!a && !b) continue;'],
  ['every tier', "      if (!e || e.t !== 'atp' || e.tk == null || !e.tn) continue;", '      if (!e || e.tk == null || !e.tn) continue;'],
  ['a match listed twice counted twice', '      if (seen.has(ek)) continue;\n', ''],
  ['window cut to recent seasons (Q9: all editions)', "      if (!e || e.t !== 'atp' || e.tk == null || !e.tn) continue;",
    "      if (!e || e.t !== 'atp' || e.tk == null || !e.tn || String(e.d || '') < '2025') continue;"],
  ['an ambiguous name joined', '  clash.forEach(lk => { delete byName[lk]; });', ''],
];
const TEST = path.join(__dirname, 'test-ten368-event-hold.js');
const run = env => spawnSync(process.execPath, [TEST], { env: Object.assign({}, process.env, env || {}), encoding: 'utf8' });
if (run().status !== 0) { console.error('✖ the test is red on the unmutated builder — mutants are meaningless'); process.exit(1); }
console.log('✔ control: the unmutated builder passes');
const src = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten368-mut-'));
for (const [name, from, to] of MUTANTS) {
  if (src.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, FILE);
  fs.writeFileSync(file, src.replace(from, to));
  if (run({ TEN368_BUILDER: file }).status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
