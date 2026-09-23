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
check('pipeline.yml: all four commit-back steps call tools/commitback-push.sh, none rebase inline', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');
  assert.strictEqual((y.match(/^ +tools\/commitback-push\.sh \"/gm) || []).length, 4);
  assert.ok(!/git pull --rebase/.test(y), 'an inline rebase loop is back');
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\ntest-commitback-push: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
