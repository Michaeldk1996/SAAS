// Today's Matches search (founder 2026-10-12) — every check in test-matches-search.mjs must FAIL when the behaviour it
// locks is reverted. Each mutant is applied to a copy of bsp-consult-dashboard.html (MXSEARCH_HTML) and the suite run
// against it; a mutant that leaves the suite green is a vacuous test and fails this runner. Anchors occur exactly once.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
  ['the Upcoming / Completed split kept under a search (TEN-95)', "const effView = crossDate ? 'both'", "const effView = false ? 'both'"],
  ['the split dropped for every list, not only a search', "const effView = crossDate ? 'both'", "const effView = true ? 'both'"],
  ['one fixed group order in both views', "const doneFirst = state.view === 'completed';", "const doneFirst = false;"],
  ['completed listed oldest first', "return fa ? tb - ta : ta - tb;", "return ta - tb;"],
  ['a match with no start sorted first', "if (ta == null || tb == null) return ta == null ? (tb == null ? 0 : 1) : -1;", "if (ta == null || tb == null) return ta == null ? (tb == null ? 0 : -1) : 1;"],
];
const SUITE = path.join(ROOT, 'test-matches-search.mjs');
const run = env => spawnSync(process.execPath, ['--test', SUITE], { env: Object.assign({}, process.env, env), encoding: 'utf8', timeout: 60000 });
if (run({}).status !== 0) { console.error('✖ the suite is red on the unmutated page — mutants are meaningless'); process.exit(1); }
console.log('✔ control: the unmutated page passes');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mxsearch-mut-'));
let survived = 0;
try {
  for (const [name, from, to] of MUTANTS) {
    if (SRC.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
    const f = path.join(dir, 'page.html');
    fs.writeFileSync(f, SRC.replace(from, to));
    if (run({ MXSEARCH_HTML: f }).status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
  }
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
