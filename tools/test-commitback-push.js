#!/usr/bin/env node
'use strict';
// TEN-267 — the post-deploy commit-back must survive a concurrent matches.json push.
//
// Run 4440 deployed, then went red at "Commit admin log": the --autostash re-apply
// of the pipeline's UNCOMMITTED rebuilt matches.json conflicted with a bsp-odds-bot
// tick that had committed matches.json in between. tools/commitback-push.sh now takes
// main's side for any file this job does not commit.
//
// Every check drives the real script against real git: a bare remote, a "runner"
// clone holding the pipeline's dirty tree, and a "bot" clone pushing in between.
// Script output is captured, never echoed, so its ::error:: lines cannot annotate a
// green run (see tools/test-no-ci-annotation-noise.js).

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(__dirname, 'commitback-push.sh');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ten267-'));
const ENV = Object.assign({}, process.env, {
  HOME: TMP, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(TMP, 'gitconfig'),
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
});
fs.writeFileSync(ENV.GIT_CONFIG_GLOBAL, '[init]\n\tdefaultBranch = main\n[advice]\n\tdetachedHead = false\n');

function sh(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, env: ENV, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function git(cwd, ...args) {
  const r = sh(cwd, 'git', args);
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} -> ${r.code}\n${r.out}`);
  return r.out.trim();
}
const lines = (tag) => Array.from({ length: 30 }, (_, i) => `{"m":${i},"odds":"${tag}"}`).join('\n') + '\n';
const write = (dir, f, s) => fs.writeFileSync(path.join(dir, f), s);
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');

// origin with matches.json + two ledgers; runner = the pipeline checkout after the
// deploy (dirty build output + dirty ledgers); bot = the odds-now loop.
let n = 0;
function fixture() {
  const d = path.join(TMP, `f${n++}`);
  fs.mkdirSync(d);
  git(TMP, 'init', '-q', '--bare', path.join(d, 'origin.git'));
  git(d, 'clone', '-q', 'origin.git', 'seed');
  const seed = path.join(d, 'seed');
  write(seed, 'matches.json', lines('base'));
  write(seed, 'admin-log.json', '[1]\n');
  write(seed, 'series-outcomes.json', '[1]\n');
  git(seed, 'add', '.'); git(seed, 'commit', '-q', '-m', 'seed'); git(seed, 'push', '-q', 'origin', 'HEAD:main');
  git(d, 'clone', '-q', 'origin.git', 'runner');
  git(d, 'clone', '-q', 'origin.git', 'bot');
  const runner = path.join(d, 'runner'), bot = path.join(d, 'bot');
  write(runner, 'matches.json', lines('pipeline-rebuild'));   // deployed, never committed
  write(runner, 'admin-log.json', '[1,2]\n');                  // this step's ledger
  write(runner, 'series-outcomes.json', '[1,2]\n');            // the NEXT step's ledger
  return { d, runner, bot, origin: path.join(d, 'origin.git') };
}
function botPush(bot, file, content) {
  git(bot, 'pull', '-q', '--rebase', 'origin', 'main');
  write(bot, file, content); git(bot, 'add', file); git(bot, 'commit', '-q', '-m', `tick ${file}`); git(bot, 'push', '-q', 'origin', 'HEAD:main');
}
const runScript = (cwd, script, ...files) => sh(cwd, 'bash', [script || SCRIPT, 'chore(admin): append [skip ci]', ...files]);
const unmerged = (cwd) => git(cwd, 'diff', '--name-only', '--diff-filter=U');
const originFile = (f, file) => git(f.d, '--git-dir=origin.git', 'show', `main:${file}`) + '\n';

// ── Control: the fixture reproduces run 4440 with the pre-fix loop ───────────────
// The loop pipeline.yml ran before this fix, verbatim in substance. If this stops
// failing, the fixture no longer reproduces the conflict and the checks below prove
// nothing.
const OLD_LOOP = `set -e
git add admin-log.json
git commit -q -m "chore(admin): append [skip ci]"
for attempt in 1 2 3; do
  if git push -q origin HEAD:main; then exit 0; fi
  git pull -q --rebase --autostash origin main || true
  UNMERGED="$(git diff --name-only --diff-filter=U)"
  if [ -n "$UNMERGED" ]; then echo "::error::unmerged: $UNMERGED"; exit 1; fi
done
exit 1`;
check('control: the pre-fix loop fails on a concurrent matches.json tick (run 4440)', () => {
  const f = fixture();
  botPush(f.bot, 'matches.json', lines('odds-bot-tick'));
  const r = sh(f.runner, 'bash', ['-c', OLD_LOOP]);
  assert.strictEqual(r.code, 1, r.out);
  assert.strictEqual(unmerged(f.runner), 'matches.json');
});

// ── The fix ──────────────────────────────────────────────────────────────────────
let fixed;
check('the conflict case now passes and pushes the ledger on top of the tick', () => {
  const f = fixed = fixture();
  botPush(f.bot, 'matches.json', lines('odds-bot-tick'));
  const r = runScript(f.runner, null, 'admin-log.json');
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(originFile(f, 'admin-log.json'), '[1,2]\n');
  assert.strictEqual(originFile(f, 'matches.json'), lines('odds-bot-tick'), 'the bot tick must survive');
  assert.strictEqual(git(f.d, '--git-dir=origin.git', 'log', '-1', '--format=%s', 'main~1'), 'tick matches.json');
});
check('the tree is left clean for the next step: nothing unmerged, nothing staged', () => {
  assert.strictEqual(unmerged(fixed.runner), '');
  assert.strictEqual(sh(fixed.runner, 'git', ['diff', '--cached', '--quiet']).code, 0,
    'a staged path here would be swept into the next step\'s commit');
  assert.strictEqual(read(fixed.runner, 'matches.json'), lines('odds-bot-tick'), 'took main\'s side');
});
check('the next step\'s dirty ledger survives, and that step pushes through another tick', () => {
  assert.strictEqual(read(fixed.runner, 'series-outcomes.json'), '[1,2]\n');
  botPush(fixed.bot, 'matches.json', lines('odds-bot-tick-2'));
  const r = runScript(fixed.runner, null, 'series-outcomes.json');
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(originFile(fixed, 'series-outcomes.json'), '[1,2]\n');
  assert.strictEqual(originFile(fixed, 'matches.json'), lines('odds-bot-tick-2'));
});
check('a race with no conflict still pushes (autostash re-applies cleanly)', () => {
  const f = fixture();
  botPush(f.bot, 'odds-open-monitor.json', '{}\n');
  const r = runScript(f.runner, null, 'admin-log.json');
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(read(f.runner, 'matches.json'), lines('pipeline-rebuild'));
});
check('an OWNED file coming back unmerged is refused (exit 2), never auto-resolved', () => {
  const f = fixture();
  botPush(f.bot, 'series-outcomes.json', '[1,9]\n');
  const r = runScript(f.runner, null, 'admin-log.json');
  assert.strictEqual(r.code, 2, r.out);
  assert.match(r.out, /commit-back-owned file came back unmerged: series-outcomes\.json/);
});

// ── Stale base: this run's own ledger conflicts (founder 2026-10-19, run 39191032806) ──
// The run built the queued SHA (split-build guard), and the run before it had appended to the same ledger
// since. The rebase of our own commit conflicts; COMMITBACK_REMERGE folds this run's rows into main's copy.
const UNION = `node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync("admin-log.json","utf8"));const b=JSON.parse(fs.readFileSync(process.env.COMMITBACK_OURS+"/admin-log.json","utf8"));fs.writeFileSync("admin-log.json",JSON.stringify([...new Set([...a,...b])])+"\\n")'`;
const runRemerge = (cwd, remerge, ...files) => {
  const r = spawnSync('bash', [SCRIPT, 'chore(admin): append [skip ci]', ...files],
    { cwd, env: Object.assign({}, ENV, remerge ? { COMMITBACK_REMERGE: remerge } : {}), encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
check('control: a stale-base conflict on our OWN ledger still exits 2 without COMMITBACK_REMERGE', () => {
  const f = fixture();
  botPush(f.bot, 'admin-log.json', '[1,9]\n');                  // the previous run's commit-back
  const r = runRemerge(f.runner, null, 'admin-log.json');
  assert.strictEqual(r.code, 2, r.out);
  assert.match(r.out, /itself conflicted/);
  assert.strictEqual(originFile(f, 'admin-log.json'), '[1,9]\n', 'nothing pushed');
});
let rem;
check('stale base + COMMITBACK_REMERGE: both runs\' rows land, on top of main', () => {
  const f = rem = fixture();
  botPush(f.bot, 'admin-log.json', '[1,9]\n');
  botPush(f.bot, 'matches.json', lines('odds-bot-tick'));
  const r = runRemerge(f.runner, UNION, 'admin-log.json');
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /Pushed after re-merge/);
  assert.deepStrictEqual(JSON.parse(originFile(f, 'admin-log.json')), [1, 9, 2]);
  assert.strictEqual(originFile(f, 'matches.json'), lines('odds-bot-tick'), 'the bot tick survives');
  assert.strictEqual(git(f.d, '--git-dir=origin.git', 'log', '-1', '--format=%s', 'main'), 'chore(admin): append [skip ci]');
  assert.deepStrictEqual(git(f.d, '--git-dir=origin.git', 'show', '--name-only', '--format=', 'main').split('\n'), ['admin-log.json'],
    'the re-merged commit carries the ledger only');
});
check('after a re-merge: HEAD = main, nothing staged, the build output and the next ledger untouched', () => {
  assert.strictEqual(git(rem.runner, 'rev-parse', 'HEAD'), git(rem.d, '--git-dir=origin.git', 'rev-parse', 'main'));
  assert.strictEqual(sh(rem.runner, 'git', ['diff', '--cached', '--quiet']).code, 0);
  assert.strictEqual(read(rem.runner, 'matches.json'), lines('pipeline-rebuild'), 'deployed build output not touched');
  assert.strictEqual(read(rem.runner, 'series-outcomes.json'), '[1,2]\n');
  const r = runScript(rem.runner, null, 'series-outcomes.json');   // the next step still pushes
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(originFile(rem, 'series-outcomes.json'), '[1,2]\n');
});
check('a failing re-merge command pushes nothing (exit 2)', () => {
  const f = fixture();
  botPush(f.bot, 'admin-log.json', '[1,9]\n');
  const r = runRemerge(f.runner, 'exit 3', 'admin-log.json');
  assert.strictEqual(r.code, 2, r.out);
  assert.strictEqual(originFile(f, 'admin-log.json'), '[1,9]\n');
});
check('the REAL build-admin-log.js as the re-merge: the earlier run\'s row and this run\'s row both survive', () => {
  const f = fixture();
  const row = (k) => ({ key: k, p1: 'A', p2: 'B', status: 'upcoming', firstSeen: 't', lastSeen: 't' });
  const ledger = (keys) => JSON.stringify({ schema: 1, updated: 't', runs: [], flags: Object.fromEntries(keys.map(k => [k, row(k)])) }, null, 1) + '\n';
  botPush(f.bot, 'admin-log.json', ledger(['111']));                     // the previous run logged 111
  fs.copyFileSync(path.join(ROOT, 'build-admin-log.js'), path.join(f.runner, 'build-admin-log.js'));
  write(f.runner, 'model-output.json', JSON.stringify({ matches: { 'upcoming-222': { ok: true, match: { p1: 'C', p2: 'D' }, stage3: { fair: { p1: { prob: 0.5 } } } } } }));
  write(f.runner, 'matches.json', JSON.stringify([{ id: 'upcoming-222', p1: 'C', p2: 'D' }]));
  write(f.runner, 'admin-log.json', '[1]\n');
  assert.strictEqual(sh(f.runner, 'node', ['build-admin-log.js']).code, 0);   // this run, on its stale base
  const r = runRemerge(f.runner, 'node build-admin-log.js', 'admin-log.json');
  assert.strictEqual(r.code, 0, r.out);
  const out = JSON.parse(originFile(f, 'admin-log.json'));
  assert.deepStrictEqual(Object.keys(out.flags).sort(), ['111', '222']);
  assert.strictEqual(out.runs.length, 1, 'this run is logged once');
});
check('merge-ledger-records.js: this run\'s records folded in by key; another rule marker refused', () => {
  const d = fs.mkdtempSync(path.join(TMP, 'mlr-'));
  const M = path.join(ROOT, 'tools', 'merge-ledger-records.js');
  write(d, 'main.json', JSON.stringify({ rule: 'as-of-start', records: { a: { held: true }, b: { held: false } } }));
  write(d, 'ours.json', JSON.stringify({ rule: 'as-of-start', records: { b: { held: true }, c: { held: null } } }));
  assert.strictEqual(sh(d, 'node', [M, 'main.json', 'ours.json']).code, 0);
  assert.deepStrictEqual(JSON.parse(read(d, 'main.json')), { rule: 'as-of-start', records: { a: { held: true }, b: { held: true }, c: { held: null } } });
  write(d, 'old.json', JSON.stringify({ records: { a: {} } }));
  assert.strictEqual(sh(d, 'node', [M, 'old.json', 'ours.json']).code, 2, 'a ledger without the marker is never merged');
  assert.deepStrictEqual(JSON.parse(read(d, 'old.json')), { records: { a: {} } }, 'and is left as it was');
});
check('pipeline.yml: the admin-log and series-outcomes commit-backs set COMMITBACK_REMERGE', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');
  const step = (name) => y.slice(y.indexOf(`- name: ${name}`), y.indexOf('tools/commitback-push.sh', y.indexOf(`- name: ${name}`)));
  assert.match(step('Commit admin log (only if changed)'), /COMMITBACK_REMERGE: node build-admin-log\.js\n/);
  assert.match(step('Commit series outcomes ledger (only if changed)'),
    /COMMITBACK_REMERGE: node tools\/merge-ledger-records\.js series-outcomes\.json "\$COMMITBACK_OURS\/series-outcomes\.json"\n/);
});
check('mutation: without the re-merge branch the stale-base case fails again (the checks above are not vacuous)', () => {
  const mutated = path.join(TMP, 'mutated-remerge.sh');
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const hook = '    if [ -n "${COMMITBACK_REMERGE:-}" ]; then';
  assert.ok(src.includes(hook));
  fs.writeFileSync(mutated, src.replace(hook, '    if false; then'));
  const f = fixture();
  botPush(f.bot, 'admin-log.json', '[1,9]\n');
  const r = spawnSync('bash', [mutated, 'chore(admin): append [skip ci]', 'admin-log.json'],
    { cwd: f.runner, env: Object.assign({}, ENV, { COMMITBACK_REMERGE: UNION }), encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
});

// ── Mutating control: the index reset is load-bearing ────────────────────────────
check('mutation: without `git reset -q` the next commit would sweep the build output', () => {
  const mutated = path.join(TMP, 'mutated.sh');
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(src.includes('\n  git reset -q\n'));
  fs.writeFileSync(mutated, src.replace('\n  git reset -q\n', '\n'));
  const f = fixture();
  botPush(f.bot, 'matches.json', lines('odds-bot-tick'));
  const r = runScript(f.runner, mutated, 'admin-log.json');
  // The mutant may pass or fail outright; either way the tree it leaves must differ.
  const staged = sh(f.runner, 'git', ['diff', '--cached', '--name-only']).out.trim();
  assert.ok(r.code !== 0 || staged !== '', `mutant left a clean index (code ${r.code}) - the check is vacuous`);
});

// ── Wiring: every commit-back step in pipeline.yml goes through the script ───────
check('pipeline.yml: all seven commit-back steps call tools/commitback-push.sh, none rebase inline', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');
  // admin log, series outcomes, profile caches, match-stat floor, weather archive (TEN-304),
  // tiebreak floor (TEN-318), captured Pinnacle closes (TEN-316)
  assert.strictEqual((y.match(/^ +tools\/commitback-push\.sh \"/gm) || []).length, 7);   // TEN-316 added the captured-Pinnacle commit-back
  assert.ok(!/git pull --rebase/.test(y), 'an inline rebase loop is back');
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\ntest-commitback-push: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
