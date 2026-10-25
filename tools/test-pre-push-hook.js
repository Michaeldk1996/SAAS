// Pre-push gate for main (founder ruling 2026-10-21, after 1a935c1b9 reached main with npm test red; 2026-10-22: the hook
// enforces the deploy lane — one suite record, the lane's ci-suite.sh receipt — and the files decide the data exemption).
// Real git, throwaway repositories: a bare "origin", a clone with the repository's own hook + clobber check installed
// through core.hooksPath, a lane file + receipts dir of its own, and real `git push` calls. Control: no hook → all go through.
// Run: node tools/test-pre-push-hook.js
'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os'); const { execFileSync, spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const check = (l, c, d) => { if (c) { pass++; console.log(`  ok   ${l}`); } else { fail++; console.log(`  FAIL ${l}${d ? `\n       ${String(d).slice(0, 600)}` : ''}`); } };
console.log('Pre-push gate for main — real git, throwaway repositories');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'prepush-'));
const LANE = path.join(TMP, 'deploy-lane.json'), RECEIPTS = path.join(TMP, 'suite-receipts');
fs.mkdirSync(RECEIPTS);
const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_NOSYSTEM: '1', HOME: TMP,
  DEPLOY_LANE_FILE: LANE, SUITE_RECEIPTS_DIR: RECEIPTS });
delete env.STENNISFY_LANE_PUSH;
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const pushWith = (extra) => (cwd, ...a) => { const r = spawnSync('git', ['push', ...a], { cwd, env: Object.assign({}, env, extra), encoding: 'utf8' }); return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') }; };
const push = pushWith({});                                     // a raw `git push`
const lanePush = pushWith({ STENNISFY_LANE_PUSH: 'TEN-1' });   // what tools/deploy-batch.mjs does for the holder TEN-1
const write = (cwd, f, t) => { fs.mkdirSync(path.dirname(path.join(cwd, f)), { recursive: true }); fs.writeFileSync(path.join(cwd, f), t); };
const commit = (cwd, msg, files, author) => { for (const [f, t] of Object.entries(files)) write(cwd, f, t); git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', msg, ...(author ? ['--author', `Bot <${author}>`] : [])); return git(cwd, 'rev-parse', 'HEAD'); };
const BOT = 'bot@bspconsult.local';   // a data-bot author (tools/deploy-lane.mjs DATA_BOT_AUTHORS: the Mac's refresh-*.sh jobs)
// a green (or red) ci-suite.sh receipt, as the lane writes it; the lane held by TEN-1 for `sha` (or expired / someone else's)
const receipt = (sha, exit = 0) => fs.writeFileSync(path.join(RECEIPTS, `${sha}.json`), JSON.stringify({ sha, tree: 'x', exit, startedAt: 'x', finishedAt: 'x', log: 'x' }));
const hold = (sha, { ticket = 'TEN-1', expired = false } = {}) => fs.writeFileSync(LANE, JSON.stringify({ version: 2, claim: { ticket, sha, reviewed: true,
  takenAt: new Date().toISOString(), expiresAt: new Date(Date.now() + (expired ? -60e3 : 30 * 60e3)).toISOString() }, waiters: {}, queue: [], landed: {}, history: [] }));
const record = (cwd, sha) => { receipt(sha); hold(sha); };

function setup(withHook) {
  const dir = fs.mkdtempSync(path.join(TMP, 'r-'));
  const origin = path.join(dir, 'origin.git'), work = path.join(dir, 'work');
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  git(dir, 'clone', '-q', origin, work);
  git(work, 'checkout', '-q', '-b', 'main');
  write(work, 'tools/clobber-check.sh', fs.readFileSync(path.join(ROOT, 'tools', 'clobber-check.sh'), 'utf8'));
  write(work, 'tools/git-hooks/pre-push', fs.readFileSync(path.join(ROOT, 'tools', 'git-hooks', 'pre-push'), 'utf8'));
  fs.chmodSync(path.join(work, 'tools/git-hooks/pre-push'), 0o755);
  write(work, 'tools/git-hooks/push-classify.mjs', fs.readFileSync(path.join(ROOT, 'tools', 'git-hooks', 'push-classify.mjs'), 'utf8'));
  write(work, 'tools/deploy-lane.mjs', fs.readFileSync(path.join(ROOT, 'tools', 'deploy-lane.mjs'), 'utf8'));
  commit(work, 'init', { 'app.js': 'v1\n', 'data.json': '{"n":1}\n' });
  git(work, 'push', '-q', '--no-verify', 'origin', 'main');
  if (withHook) git(work, 'config', 'core.hooksPath', 'tools/git-hooks');
  return { dir, origin, work };
}

try {
  // ── the gate ──
  const A = setup(true);
  let sha = commit(A.work, 'feat: code change', { 'app.js': 'v2\n' });
  fs.rmSync(LANE, { force: true });
  let r = lanePush(A.work, 'origin', 'main');
  check('nobody holds the lane → refused, saying to claim it', !r.ok && /REFUSED push to main/.test(r.out) && /nobody holds the deploy lane/.test(r.out), r.out);
  check('…and main on origin did not move', git(A.work, 'rev-parse', 'origin/main') !== sha);
  record(A.work, sha);
  r = push(A.work, 'origin', 'main');
  check('a RAW git push of code is refused even with the lane held and a green receipt (only deploy-batch pushes code)', !r.ok && /a raw push: code reaches main only through tools\/deploy-batch\.mjs/.test(r.out), r.out);
  r = pushWith({ STENNISFY_LANE_PUSH: 'TEN-2' })(A.work, 'origin', 'main');
  check('a batch for a ticket that does not hold the lane is refused', !r.ok && /the lane is held by TEN-1, not TEN-2/.test(r.out), r.out);
  hold(sha, { expired: true });
  r = lanePush(A.work, 'origin', 'main');
  check('an expired claim does not count → refused', !r.ok && /expired/.test(r.out), r.out);
  hold(sha); receipt(sha, 1);
  r = lanePush(A.work, 'origin', 'main');
  check('a RED receipt (exit 1) is no receipt → refused, with the command to run', !r.ok && /no green ci-suite receipt/.test(r.out) && /tools\/ci-suite\.sh/.test(r.out), r.out);
  receipt(sha);
  r = lanePush(A.work, 'origin', 'main');
  check('the lane holder\'s batch, a green receipt for that commit, the clobber check clear → pushed', r.ok && git(A.work, 'ls-remote', 'origin', 'refs/heads/main').startsWith(sha), r.out);

  // a tested commit rebased onto new data commits: same code, new id → accepted on the earlier pass
  const B = setup(true);
  const tested = commit(B.work, 'feat: code', { 'app.js': 'v3\n' });
  record(B.work, tested);
  const other = path.join(B.dir, 'other'); git(B.dir, 'clone', '-q', B.origin, other);
  commit(other, 'chore(odds): tick [skip ci]', { 'matches.json': '{"t":1}\n' }, 'bsp-odds-bot@users.noreply.github.com');
  git(other, 'push', '-q', '--no-verify', 'origin', 'main');
  git(B.work, 'fetch', '-q', 'origin'); git(B.work, 'rebase', '-q', 'origin/main');
  const rebased = git(B.work, 'rev-parse', 'HEAD');
  r = lanePush(B.work, 'origin', 'main');
  check('receipted, then replayed onto a data-bot commit (new id, same code) → accepted on the claimed commit\'s receipt', rebased !== tested && r.ok && /data-only difference/.test(r.out), r.out);
  commit(B.work, 'feat: more code', { 'lib/x.js': 'x\n' });
  r = lanePush(B.work, 'origin', 'main');
  check('code changed since the receipt → refused (a receipt covers its code, never later code)', !r.ok && /no green ci-suite receipt/.test(r.out), r.out);

  // the clobber check: someone else moved the same file on main since the base
  const C = setup(true);
  const mine = commit(C.work, 'feat: edit app', { 'app.js': 'mine\n' });
  const c2 = path.join(C.dir, 'c2'); git(C.dir, 'clone', '-q', C.origin, c2);
  commit(c2, 'feat: their edit to app', { 'app.js': 'theirs\n' });
  git(c2, 'push', '-q', '--no-verify', 'origin', 'main');
  record(C.work, mine);
  r = lanePush(C.work, 'origin', 'main', '--force');   // force: the case the clobber check exists for (a whole-file blob over their commit)
  check('lane + receipt but the clobber check is NOT clear (their commit moved app.js) → refused, naming the file', !r.ok && /CONFLICT\s+app\.js/.test(r.out) && /clobber check is not clear/.test(r.out), r.out);

  // exemptions and scope
  const D = setup(true);
  commit(D.work, 'chore(splits): daily refresh [skip ci]', { 'career-splits/1.json': '{}\n', 'style-meetings/a.json': '{}\n', 'splits-matches-index.json': '{}\n' }, BOT);
  r = push(D.work, 'origin', 'main');
  check('a data-bot push (the Mac\'s daily refresh jobs: bot author, marker, files on the lane\'s data list) needs no lane, no suite → pushed', r.ok && /data-bot push to main/.test(r.out), r.out);
  commit(D.work, 'chore(draws): official draw content changed [skip ci]', { 'draws.json': '{"d":1}\n' }, BOT);
  r = push(D.work, 'origin', 'main');
  check('founder 2026-10-22 (3a): the official-draws bot commit (draws.json) is a data-bot commit → exempt, pushed', r.ok && /data-bot push to main/.test(r.out), r.out);
  commit(D.work, 'chore: sneak code [skip ci]', { 'app.js': 'sneaky\n' }, BOT);
  r = push(D.work, 'origin', 'main');
  check('the marker does not exempt a commit that changes code → refused', !r.ok, r.out);
  git(D.work, 'reset', '-q', '--hard', 'origin/main');
  commit(D.work, 'chore: tooling json [skip ci]', { 'package.json': '{"scripts":{}}\n' }, BOT);
  r = push(D.work, 'origin', 'main');
  check('package.json is code, never data → refused even with the marker', !r.ok, r.out);
  git(D.work, 'reset', '-q', '--hard', 'origin/main');
  commit(D.work, 'chore: hand-curated config [skip ci]', { 'court-speed-map.json': '{}\n' }, BOT);
  r = push(D.work, 'origin', 'main');
  check('a .json the code reads but no bot writes (court-speed-map.json) is not data → refused even as a bot with the marker', !r.ok, r.out);
  git(D.work, 'reset', '-q', '--hard', 'origin/main');
  commit(D.work, 'chore: data by hand [skip ci]', { 'matches.json': '{"n":3}\n' });
  r = push(D.work, 'origin', 'main');
  check('data files + marker but NOT a data-bot author → not exempt; and its marker would skip the gate → refused', !r.ok, r.out);
  git(D.work, 'reset', '-q', '--hard', 'origin/main');
  commit(D.work, 'chore: data without the marker', { 'matches.json': '{"n":2}\n' }, BOT);
  r = push(D.work, 'origin', 'main');
  check('a data-only commit WITHOUT the marker is not exempt (it would run the Code gate) → refused', !r.ok, r.out);
  git(D.work, 'reset', '-q', '--hard', 'origin/main');

  // founder 2026-10-22: the FILES decide, never the marker — and a suite pass never lets code ride under a marker
  const F = setup(true);
  const body = commit(F.work, 'feat(land): a code change\n\nExempt: [skip ci] data-only pushes (prose in the body)', { 'app.js': 'v9\n' });
  record(F.work, body);
  r = lanePush(F.work, 'origin', 'main');
  check('a code commit whose BODY names [skip ci] (the a7fcdc55f shape) is refused even WITH the lane and a green receipt — GitHub would skip the gate', !r.ok && /carries a skip marker/.test(r.out) && /app\.js/.test(r.out), r.out);
  git(F.work, 'reset', '-q', '--hard', 'origin/main');
  for (const tok of ['[ci skip]', '[no ci]', '[skip actions]', '[actions skip]', 'skip-checks: true']) {
    const s = commit(F.work, `feat: code\n\n${tok}`, { 'app.js': `v-${tok}\n` });
    record(F.work, s);
    const rr = lanePush(F.work, 'origin', 'main');
    check(`every GitHub skip token is caught on a code commit: "${tok}" → refused`, !rr.ok && /carries a skip marker/.test(rr.out), rr.out);
    git(F.work, 'reset', '-q', '--hard', 'origin/main');
  }
  const code = commit(F.work, 'feat: real code', { 'app.js': 'v10\n' });
  const tip = commit(F.work, 'chore(odds): tick [skip ci]', { 'matches.json': '{"x":1}\n' }, 'bsp-odds-bot@users.noreply.github.com');
  record(F.work, tip); record(F.work, code);
  r = lanePush(F.work, 'origin', 'main');
  check('a data-bot commit as the TIP of a push that holds code → refused (GitHub decides from the tip: the whole push would skip the gate)', !r.ok && /last commit .* carries a skip marker while the push holds code/.test(r.out), r.out);
  git(F.work, 'reset', '-q', '--hard', 'origin/main');
  git(F.work, 'checkout', '-q', '-b', 'side'); commit(F.work, 'feat: code on a side branch', { 'lib/side.js': 's\n' });
  git(F.work, 'push', '-q', 'origin', 'side'); git(F.work, 'checkout', '-q', 'main');   // the side branch is already on origin: the merge is the ONLY new commit
  execFileSync('git', ['merge', '-q', '--no-ff', 'side', '-m', 'chore: merge [skip ci]'], { cwd: F.work, env: Object.assign({}, env, { GIT_AUTHOR_NAME: 'Bot', GIT_AUTHOR_EMAIL: BOT }), stdio: 'ignore' });
  r = push(F.work, 'origin', 'main');
  check('a MERGE carrying the marker, the only new commit (its branch already on origin), that brings code in is judged by its first-parent diff → not exempt, refused', !r.ok && /REFUSED/.test(r.out) && !/data-bot push/.test(r.out), r.out);
  git(F.work, 'reset', '-q', '--hard', 'origin/main');
  const ok2 = commit(F.work, 'feat: clean code commit', { 'app.js': 'v11\n' });
  record(F.work, ok2);
  r = lanePush(F.work, 'origin', 'main');
  check('control: the same code with a clean message, the lane and a green receipt → pushed', r.ok, r.out);
  git(D.work, 'checkout', '-q', '-b', 'feature');
  r = push(D.work, 'origin', 'feature');
  check('a push to any other branch is never checked → pushed', r.ok, r.out);
  git(D.work, 'checkout', '-q', 'main');
  r = push(D.work, 'origin', ':main');
  check('deleting main is refused', !r.ok && /deleting main/.test(r.out), r.out);
  r = push(D.work, '--no-verify', 'origin', 'main');
  check('--no-verify bypasses the hook (by design: the Code gate is the enforced backstop)', r.ok, r.out);

  // control: no hook installed → every refused case above goes through
  const E = setup(false);
  commit(E.work, 'feat: code change', { 'app.js': 'v2\n' });
  r = push(E.work, 'origin', 'main');
  check('control: without the hook the same raw, unreceipted code push goes through (the checks above are not vacuous)', r.ok, r.out);

  // ── the lane's data list (founder 2026-10-22, item 3a) ──
  {
    const { execFileSync: ef } = require('child_process');
    const lane = ef(process.execPath, ['--input-type=module', '-e', `import {isDataPath,isDataCommit} from ${JSON.stringify(require('url').pathToFileURL(path.join(ROOT, 'tools', 'deploy-lane.mjs')).href)};
      console.log(JSON.stringify([isDataPath('draws.json'), isDataCommit({ subject: 'chore(draws): official draw content changed [skip ci]', authorEmail: 'bot@bspconsult.local', files: ['draws.json'] }),
        isDataCommit({ subject: 'feat: draws by hand', authorEmail: 'x@y', files: ['draws.json'] }), isDataPath('draw-view.js')]))`], { encoding: 'utf8' });
    check('deploy-lane.mjs: draws.json is a data path; the draws bot commit is a data-bot commit; a human commit or draw-view.js is not', lane.trim() === '[true,true,false,false]', lane);
  }

  // ── wiring ──
  const inst = fs.readFileSync(path.join(ROOT, 'tools', 'install-git-hooks.sh'), 'utf8');
  // the installer itself, in a throwaway repo with a worktree on an OLDER commit that has no tools/git-hooks/
  const I = setup(false);
  write(I.work, 'tools/install-git-hooks.sh', inst);
  const old = git(I.work, 'rev-list', '--max-parents=0', 'HEAD');
  commit(I.work, 'tooling', { 'x.txt': 'x\n' });
  const wt = path.join(I.dir, 'oldwt'); git(I.work, 'worktree', 'add', '-q', '--detach', wt, old);
  execFileSync('bash', ['tools/install-git-hooks.sh'], { cwd: I.work, env, stdio: 'ignore' });
  const hp = git(I.work, 'config', '--get', 'core.hooksPath');
  check('the installer copies the hook into the shared git dir and sets an ABSOLUTE core.hooksPath', path.isAbsolute(hp) && fs.existsSync(path.join(hp, 'pre-push')) && git(wt, 'config', '--get', 'core.hooksPath') === hp, hp);
  commit(wt, 'feat: code from an old worktree', { 'app.js': 'old-wt\n' });
  r = lanePush(wt, 'origin', 'HEAD:main');
  check('…so a worktree on an older commit (no tools/git-hooks/ in its checkout) is gated too → refused', !r.ok && /REFUSED push to main/.test(r.out), r.out);
  check('the hook is executable in the repository; the separate land-check.sh is retired (one suite record: the lane\'s receipt)', (fs.statSync(path.join(ROOT, 'tools', 'git-hooks', 'pre-push')).mode & 0o111) && !fs.existsSync(path.join(ROOT, 'tools', 'land-check.sh')));
  const batch = fs.readFileSync(path.join(ROOT, 'tools', 'deploy-batch.mjs'), 'utf8');
  check('deploy-batch.mjs names its lane ticket to the hook around its push, and only there', /process\.env\.STENNISFY_LANE_PUSH = me\.ticket;[^\n]*\n\s*const pushedAt = [^\n]*\n\s*const p = W\(\['push', '-q', 'origin', `\$\{b\.head\}:refs\/heads\/main`\]\);\n\s*delete process\.env\.STENNISFY_LANE_PUSH;/.test(batch) && (batch.match(/STENNISFY_LANE_PUSH/g) || []).length === 2);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
