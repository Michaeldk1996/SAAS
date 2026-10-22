// tools/prune-agent-space.sh (founder 2026-10-22): the daily space report is REPORT-ONLY; --apply removes only what is
// idle, unopened and — for a worktree — clean and fully pushed. Real git in throwaway dirs, ages made with touch.
// Run: node tools/test-prune-agent-space.js
'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os'); const { execFileSync, spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'tools', 'prune-agent-space.sh');
let pass = 0, fail = 0;
const check = (l, c, d) => { if (c) { pass++; console.log(`  ok   ${l}`); } else { fail++; console.log(`  FAIL ${l}${d ? `\n       ${String(d).slice(0, 600)}` : ''}`); } };
console.log('prune-agent-space.sh — report only by default; --apply removes only the safe');

const T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prune-test-')));   // resolved, as git reports worktrees
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_NOSYSTEM: '1', HOME: T };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const old = (p) => execFileSync('find', [p, '-exec', 'touch', '-h', '-t', '202601010000', '{}', '+']);
const mk = (p, f = 'x') => { fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, f), 'x'); return p; };
try {
  const origin = path.join(T, 'origin.git'), repo = path.join(T, 'repo');
  git(T, 'init', '-q', '--bare', '-b', 'main', origin); git(T, 'clone', '-q', origin, repo);
  git(repo, 'checkout', '-q', '-b', 'main'); fs.writeFileSync(path.join(repo, 'a.txt'), 'a'); git(repo, 'add', '.'); git(repo, 'commit', '-q', '-m', 'a'); git(repo, 'push', '-q', 'origin', 'main');
  const W = (n, ref, ...flags) => { const w = path.join(T, n); git(repo, 'worktree', 'add', '-q', ...flags, w, ref); return w; };
  const clean = W('wt-clean', 'main', '--detach');
  const dirty = W('wt-dirty', 'main', '--detach'); fs.writeFileSync(path.join(dirty, 'a.txt'), 'changed');
  const unpushed = W('wt-unpushed', 'main', '-b', 'local-only'); fs.writeFileSync(path.join(unpushed, 'b.txt'), 'b'); git(unpushed, 'add', '.'); git(unpushed, 'commit', '-q', '-m', 'local');
  const recent = W('wt-recent', 'main', '--detach');
  for (const w of [clean, dirty, unpushed]) old(w);
  const sten = path.join(T, 'sten');
  const ciOld = mk(path.join(sten, 'ci-tmp-ten1')), tenOld = mk(path.join(sten, 'ten999-x')), ciNew = mk(path.join(sten, 'ci-tmp-ten2')), keep = mk(path.join(sten, 'te-cache'));
  old(ciOld); old(tenOld); old(keep);
  const tmpd = path.join(T, 'tmp');
  const tOld = mk(path.join(tmpd, 'ten273-batch-aaaaaa')), tNew = mk(path.join(tmpd, 'ten261-mut-bbbbbb')), other = mk(path.join(tmpd, 'unrelated-cccccc'));
  old(tOld); old(other);
  const run = (...a) => spawnSync('bash', [SCRIPT, ...a], { encoding: 'utf8', env: { ...env, PRUNE_REPO: repo, PRUNE_STENNISFY: sten, PRUNE_TMPDIR: tmpd, REPORT_DIR: path.join(T, 'reports') } });
  const rows = (out) => { const f = out.match(/\((\/[^)]+\.tsv)\)/)[1]; return Object.fromEntries(fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => { const [s, p] = l.split('\t'); return [p, s]; })); };

  const r = run();
  const R = rows(r.stdout);
  check('report mode exits 0 and says REPORT ONLY', r.status === 0 && /REPORT ONLY — nothing deleted/.test(r.stdout), r.stdout + r.stderr);
  check('report mode deletes NOTHING', [clean, dirty, unpushed, recent, ciOld, tenOld, tOld].every((p) => fs.existsSync(p)));
  check('a clean, pushed, idle worktree is marked safe', R[clean] === 'safe', JSON.stringify(R));
  check('a worktree with uncommitted changes is LISTED, never safe', R[dirty] === 'LIST-uncommitted', R[dirty]);
  check('a worktree with commits missing from origin is LISTED, never safe', R[unpushed] === 'LIST-unpushed', R[unpushed]);
  check('a worktree changed within 7 days is kept', R[recent] === 'keep', R[recent]);
  check('idle ~/.stennisfy ci-tmp-* and ten* folders are safe; a recent one is kept; te-cache is never considered', R[ciOld] === 'safe' && R[tenOld] === 'safe' && R[ciNew] === 'keep' && !(keep in R), JSON.stringify(R));
  check('an idle TMPDIR test folder is safe; a recent one is kept; unrelated TMPDIR content is never considered', R[tOld] === 'safe' && R[tNew] === 'keep' && !(other in R), JSON.stringify(R));
  check('the main checkout is never considered', !(repo in R));

  const a = run('--apply');
  check('--apply removes exactly the safe items', a.status === 0 && !fs.existsSync(clean) && !fs.existsSync(ciOld) && !fs.existsSync(tenOld) && !fs.existsSync(tOld), a.stdout + a.stderr);
  check('--apply keeps the listed and the recent (dirty, unpushed, recent worktrees; recent folders; te-cache; unrelated TMPDIR)',
    [dirty, unpushed, recent, ciNew, keep, tNew, other].every((p) => fs.existsSync(p)));
  check('a removed worktree is gone from git too (worktree remove + prune), its branch-less HEAD on origin', !git(repo, 'worktree', 'list').includes('wt-clean'));

  const inst = fs.readFileSync(path.join(ROOT, 'tools', 'install-prune-agent.sh'), 'utf8');
  check('the daily LaunchAgent runs the script with NO --apply (report only) at 06:30', /<string>\$DEST<\/string><\/array>/.test(inst) && !/--apply<\/string>/.test(inst) && /<key>Hour<\/key><integer>6<\/integer><key>Minute<\/key><integer>30<\/integer>/.test(inst));
} finally { fs.rmSync(T, { recursive: true, force: true }); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
