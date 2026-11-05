#!/usr/bin/env node
// tools/test-gated-code.mjs — architecture program stage 5 (2026-11-05): the data pipeline builds with gated code only,
// and the code gate runs the data gates on the deployed store. Real git repositories and the shipped scripts.
//   1 · tools/gated-code.mjs: which code a data build uses (head / overlay / keep), the overlay touches the working
//       tree only, data is never held back, a workflow change is never split. Control: without the overlay the
//       breaking code is what the build would run.
//   2 · tools/data-dry-run.sh: no store = SKIPPED out loud (exit 0, never a pass claim); a red gate = exit 1 naming it;
//       an unreachable archive = SKIPPED, not red; every gate green = exit 0.
//   3 · the wiring: gate.yml's result needs the dry-run; pipeline.yml applies the gated code after Node setup, before
//       npm ci, with no `|| true` that could hide a crash as a pass.
import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { decide, plan, apply } = await import(path.join(ROOT, 'tools', 'gated-code.mjs'));
let pass = 0; const fails = [];
async function check(name, fn) { try { await fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { fails.push(name); console.log(`  FAIL ${name}\n       ${e.message}`); } }
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env, encoding: 'utf8' }).trim();
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `gated-${p}-`));
function commit(repo, files, msg) {
  for (const [f, body] of Object.entries(files)) {
    const p = path.join(repo, f);
    if (body === null) { git(repo, 'rm', '-q', f); continue; }
    fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); git(repo, 'add', f);
  }
  git(repo, 'commit', '-q', '-m', msg); return git(repo, 'rev-parse', 'HEAD');
}
function repo() {
  const r = tmp('repo'); git(r, 'init', '-q', '-b', 'main');
  const gated = commit(r, { 'build.js': 'good\n', 'matches.json': '{"v":1}\n', '.github/workflows/pipeline.yml': 'v1\n', 'tools/x.mjs': 'a\n' }, 'gated');
  return { r, gated };
}
const runsFor = (sha) => [{ id: 7, head_sha: sha, conclusion: 'success' }];
async function inRepo(r, fn) { const cwd = process.cwd(); process.chdir(r); try { return await fn(); } finally { process.chdir(cwd); } }

console.log('\n1 · gated-code.mjs\n');
await check('HEAD is the newest gated commit → build HEAD', async () => {
  const { r, gated } = repo();
  const p = await inRepo(r, () => plan({ runs: runsFor(gated) }));
  assert.strictEqual(p.action, 'head'); assert.strictEqual(p.gated, gated);
});
await check('only data commits since the gated commit → build HEAD (data is never held back)', async () => {
  const { r, gated } = repo();
  commit(r, { 'matches.json': '{"v":2}\n' }, 'data [skip ci]');
  const p = await inRepo(r, () => plan({ runs: runsFor(gated) }));
  assert.strictEqual(p.action, 'head', p.why);
});
await check('an ungated code commit → overlay: the working tree runs the gated code, HEAD\'s data stays, the index is untouched', async () => {
  const { r, gated } = repo();
  commit(r, { 'build.js': 'BREAKS THE ARCHIVE GATE\n', 'tools/new.mjs': 'new\n' }, 'code (gate red)');
  const head = commit(r, { 'matches.json': '{"v":3}\n' }, 'data [skip ci]');
  const p = await inRepo(r, async () => { const q = await plan({ runs: runsFor(gated) }); apply(q); return q; });
  assert.strictEqual(p.action, 'overlay', p.why);
  assert.deepStrictEqual(p.paths.sort(), ['build.js', 'tools/new.mjs']);
  assert.strictEqual(fs.readFileSync(path.join(r, 'build.js'), 'utf8'), 'good\n', 'the build ran the ungated code');
  assert.ok(!fs.existsSync(path.join(r, 'tools/new.mjs')), 'a file the gated commit lacks is still in the tree');
  assert.strictEqual(fs.readFileSync(path.join(r, 'matches.json'), 'utf8'), '{"v":3}\n', 'the newest data was held back');
  assert.strictEqual(git(r, 'rev-parse', 'HEAD'), head);
  assert.strictEqual(git(r, 'diff', '--cached', '--name-only'), '', 'the overlay staged a code file — a commit-back could commit it');
  // a commit-back of a data file commits that file only
  fs.writeFileSync(path.join(r, 'matches.json'), '{"v":4}\n'); git(r, 'add', '--', 'matches.json'); git(r, 'commit', '-q', '-m', 'commit-back');
  assert.deepStrictEqual(git(r, 'show', '--name-only', '--format=', 'HEAD').split('\n'), ['matches.json']);
  assert.strictEqual(git(r, 'show', 'HEAD:build.js'), 'BREAKS THE ARCHIVE GATE', 'main lost the newer code');
});
await check('CONTROL: without the overlay the data build would run the ungated (breaking) code', async () => {
  const { r, gated } = repo();
  commit(r, { 'build.js': 'BREAKS THE ARCHIVE GATE\n' }, 'code (gate red)');
  await inRepo(r, () => plan({ runs: runsFor(gated) }));   // plan only, no apply
  assert.strictEqual(fs.readFileSync(path.join(r, 'build.js'), 'utf8'), 'BREAKS THE ARCHIVE GATE\n');
});
await check('a .github/workflows/ change since the gated commit → keep HEAD (no split build), with the reason', async () => {
  const { r, gated } = repo();
  commit(r, { '.github/workflows/pipeline.yml': 'v2\n', 'build.js': 'new\n' }, 'wf');
  const p = await inRepo(r, async () => { const q = await plan({ runs: runsFor(gated) }); apply(q); return q; });
  assert.strictEqual(p.action, 'keep'); assert.match(p.why, /split build/);
  assert.strictEqual(fs.readFileSync(path.join(r, 'build.js'), 'utf8'), 'new\n');
});
await check('no gated commit / a GitHub read error → keep HEAD, never fail', async () => {
  const { r } = repo();
  commit(r, { 'build.js': 'x\n' }, 'code');
  const none = await inRepo(r, () => plan({ runs: [] }));
  assert.strictEqual(none.action, 'keep'); assert.match(none.why, /no commit/);
  const saved = { ...process.env }; process.env.GITHUB_TOKEN = 'x'; process.env.GITHUB_REPOSITORY = 'nobody/none';
  const realFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('network down'); };
  try { const p = await inRepo(r, () => plan()); assert.strictEqual(p.action, 'keep'); assert.match(p.why, /could not read/); }
  finally { globalThis.fetch = realFetch; Object.assign(process.env, saved); }
});
await check('a failed or unrelated gate run never counts as gated', async () => {
  const { r, gated } = repo();
  const head = commit(r, { 'build.js': 'y\n' }, 'code');
  const p = await inRepo(r, () => plan({ runs: [{ id: 1, head_sha: head, conclusion: 'failure' }, { id: 2, head_sha: gated, conclusion: 'success' }] }));
  assert.strictEqual(p.gated, gated); assert.strictEqual(p.action, 'overlay');
});
await check('decide: a gated commit that is not an ancestor of HEAD → keep', () => {
  assert.strictEqual(decide({ head: 'b', gated: 'a', isAncestor: false, changed: [] }).action, 'keep');
});

console.log('\n2 · data-dry-run.sh (stub gates, the shipped script)\n');
function dryRun({ site = true, red = '', archive = 'ok', creds = true } = {}) {
  const d = tmp('dry');
  fs.mkdirSync(path.join(d, 'tools'));
  fs.copyFileSync(path.join(ROOT, 'tools', 'data-dry-run.sh'), path.join(d, 'tools', 'data-dry-run.sh'));
  const stub = (name, file) => `#!/usr/bin/env node\nconst a=process.argv.slice(2).join(' ');\nif ((process.env.RED||'').split(',').includes(${JSON.stringify(name)})) { console.error('red'); process.exit(1); }\n${file ? `require('fs').writeFileSync(${JSON.stringify(file)}, '{}');` : ''}\n`;
  // python stubs: the subcommand (argv[1]) is the gate's name; `export` fails when the archive is down
  const py = "import sys,os\nn=sys.argv[1]\nif n=='export' and os.environ.get('ARCHIVE')=='down': sys.exit(2)\nif n in (os.environ.get('RED') or '').split(','): sys.exit(1)\nopen(sys.argv[-1],'w').write('h\\n')\n";
  fs.writeFileSync(path.join(d, 'tools', 'pinarch.py'), py);
  fs.writeFileSync(path.join(d, 'tools', 'tdarch.py'), py);
  fs.writeFileSync(path.join(d, 'tools', 'started-evidence.js'), stub('started-evidence'));
  fs.writeFileSync(path.join(d, 'build-database-yield.js'), stub('database', 'database-yield.json'));
  fs.writeFileSync(path.join(d, 'tools', 'archive-gate.mjs'), stub('archive-gate'));
  fs.writeFileSync(path.join(d, 'build-odds-performance.js'), stub('odds-performance'));
  fs.writeFileSync(path.join(d, 'tools', 'test-series-rows.js'), stub('series'));
  fs.writeFileSync(path.join(d, 'tools', 'test-pp2-reconcile.js'), stub('reconcile'));
  fs.writeFileSync(path.join(d, 'tools', 'h2h-reconcile.mjs'), stub('h2h'));
  const s = path.join(d, '.site');
  if (site) { fs.mkdirSync(path.join(s, 'career-history'), { recursive: true }); fs.writeFileSync(path.join(s, 'build-info.json'), '{"runNumber":1}'); }
  const sum = path.join(d, 'summary.md');
  const e = { ...process.env, RED: red, ARCHIVE: archive, GITHUB_STEP_SUMMARY: sum };
  if (creds) { e.SUPABASE_URL = 'https://x'; e.SUPABASE_SECRET_KEY = 'k'; } else { delete e.SUPABASE_URL; delete e.SUPABASE_SECRET_KEY; }
  const r = spawnSync('bash', ['tools/data-dry-run.sh', '.site'], { cwd: d, env: e, encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr, summary: fs.existsSync(sum) ? fs.readFileSync(sum, 'utf8') : '' };
}
await check('no deployed store → SKIPPED out loud, exit 0, no "green" claim', () => {
  const r = dryRun({ site: false });
  assert.strictEqual(r.status, 0, r.out); assert.match(r.summary, /SKIPPED/); assert.ok(!/green/.test(r.summary), r.summary);
});
await check('every gate green → exit 0, each named green', () => {
  const r = dryRun();
  assert.strictEqual(r.status, 0, r.out);
  for (const g of ['archive gate', 'Database build', 'reconcile suite', 'H2H golden-pair', 'Series row-integrity', 'market performance']) assert.match(r.summary, new RegExp(`green: ${g}`), g);
});
await check('the archive gate red on this code → exit 1, named, the other gates still run', () => {
  const r = dryRun({ red: 'archive-gate' });
  assert.strictEqual(r.status, 1, r.out); assert.match(r.summary, /RED: archive gate/); assert.match(r.summary, /green: reconcile suite/);
});
await check('the reconcile suite red → exit 1', () => {
  const r = dryRun({ red: 'reconcile' });
  assert.strictEqual(r.status, 1, r.out); assert.match(r.summary, /RED: reconcile suite/);
});
await check('the archive unreachable → the archive part SKIPPED (not a verdict), the store gates still run, exit 0', () => {
  const r = dryRun({ archive: 'down' });
  assert.strictEqual(r.status, 0, r.out); assert.match(r.summary, /SKIPPED: the Pinnacle archive export failed/);
  assert.ok(!/archive gate/.test(r.summary)); assert.match(r.summary, /green: reconcile suite/);
});
await check('no archive credentials → archive part SKIPPED out loud', () => {
  const r = dryRun({ creds: false });
  assert.strictEqual(r.status, 0, r.out); assert.match(r.summary, /SKIPPED: no archive credentials/);
});

console.log('\n3 · wiring\n');
const gate = fs.readFileSync(path.join(ROOT, '.github/workflows/gate.yml'), 'utf8');
const pipe = fs.readFileSync(path.join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');
await check('gate.yml: the result job needs the data dry-run and fails without it', () => {
  assert.match(gate, /needs: \[shard, data-dry-run\]/);
  assert.match(gate, /needs\['data-dry-run'\]\.result \}\}" = "success" \] \|\| \{[^}]*exit 1; \}/);
  assert.match(gate, /run: bash tools\/data-dry-run\.sh \.deployed-site/);
  assert.ok(!/data-dry-run[\s\S]{0,400}continue-on-error/.test(gate), 'the dry-run must not be continue-on-error');
});
await check('pipeline.yml: the gated code is applied after Node setup and before npm ci', () => {
  const a = pipe.indexOf('node tools/gated-code.mjs apply'), node = pipe.indexOf('uses: actions/setup-node'), ci = pipe.indexOf('run: npm ci');
  assert.ok(a > 0 && node > 0 && ci > 0, 'step missing'); assert.ok(node < a && a < ci, `order node ${node} apply ${a} npm ci ${ci}`);
  assert.ok(pipe.indexOf('Re-point this run at the current tip of main') < a, 'must follow the re-point to the tip');
});

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
