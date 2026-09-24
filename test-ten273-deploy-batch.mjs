// TEN-273 item 3 — one build for several ready commits; and the suite receipt.
//
// FOUNDER, 2026-09-25: "When more than one agent has a ready commit, combine
// them into one push and one pipeline run. Run the suite and clobber check on
// the combined tree first. If anything conflicts, fall back to one-by-one."
//
// Every case runs tools/deploy-batch.mjs against a REAL temp git repo with a
// bare origin (real cherry-picks, real pushes, a real data bot committing
// `[skip ci]` to origin), the REAL tools/clobber-check.sh, the REAL lane store
// and the REAL Paperclip adapters over HTTP to a fake board. The one substitute
// is the suite (the real one clones GitHub and runs npm test for ~6 min): its
// fake returns the real shape { ok, exit, log, output }. tools/ci-suite.sh is
// then tested for real against a temp origin, with a trivial npm test.
//
// Each case is paired with mutants of the real source that must make it fail.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BATCH_SRC = path.join(HERE, 'tools', 'deploy-batch.mjs');
const LANE_SRC = path.join(HERE, 'tools', 'deploy-lane.mjs');
const SUITE_SRC = path.join(HERE, 'tools', 'ci-suite.sh');
const MIN = 60 * 1000;
const T0 = Date.parse('2026-09-25T08:00:00Z');

const laneMod = await import(pathToFileURL(LANE_SRC).href);
const real = await import(pathToFileURL(BATCH_SRC).href);

// ── fake board ───────────────────────────────────────────────────────────────
function startBoard() {
  const runs = {};
  const comments = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const m = req.url.match(/^\/api\/heartbeat-runs\/([^/?]+)$/);
      if (req.method === 'GET' && m) {
        if (!runs[m[1]]) { res.writeHead(404); return res.end('{}'); }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ id: m[1], status: runs[m[1]] }));
      }
      const c = req.url.match(/^\/api\/issues\/([^/]+)\/comments$/);
      if (req.method === 'POST' && c) {
        const id = `c${comments.length + 1}`;
        comments.push({ id, issueId: c[1], ...JSON.parse(body) });
        res.writeHead(201, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ id }));
      }
      res.writeHead(404); res.end('{}');
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({
    base: `http://127.0.0.1:${srv.address().port}`, runs, comments, close: () => { srv.closeAllConnections(); srv.close(); },
  })));
}

// ── real git fixture ─────────────────────────────────────────────────────────
function sh(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function commit(cwd, file, content, msg) {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  fs.writeFileSync(path.join(cwd, file), content);
  sh(cwd, 'add', file);
  sh(cwd, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', msg);
  return sh(cwd, 'rev-parse', 'HEAD');
}
function receipt(dir, sha, exit = 0) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sha}.json`), JSON.stringify({ sha, tree: 'f'.repeat(40), exit, startedAt: '2026-09-25T07:50:00Z', finishedAt: '2026-09-25T07:56:00Z', log: '/tmp/x.log' }));
}

const A = { ticket: 'TEN-301', issueId: 'issue-A', runId: 'run-A', kind: 'paperclip' };
const B = { ticket: 'TEN-302', issueId: 'issue-B', runId: 'run-B', kind: 'paperclip' };
const C = { ticket: 'TEN-303', issueId: 'issue-C', runId: 'run-C', kind: 'paperclip' };
const Z = { ticket: 'TEN-304', issueId: 'issue-Z', runId: 'run-Z', kind: 'paperclip' };

// origin/main: seed + one data-bot commit. Holder A edits a.txt, B edits b.txt,
// C edits c.txt, Z edits b.txt the other way (conflicts with B). All branch off
// the seed, so each is "rebased" (only a [skip ci] commit ahead of it).
async function fixture({ entries = [B, C] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ten273-batch-'));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const bot = path.join(root, 'bot');
  sh(root, 'init', '-q', '--bare', '-b', 'main', origin);
  sh(origin, 'config', 'core.logAllRefUpdates', 'always'); // one reflog line per push
  sh(root, 'clone', '-q', origin, work);
  sh(work, 'config', 'user.name', 't'); sh(work, 'config', 'user.email', 't@t'); sh(work, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  for (const f of ['a.txt', 'b.txt', 'c.txt', 'data.json']) fs.writeFileSync(path.join(work, f), `${f} v1\n`);
  sh(work, 'add', '.'); sh(work, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'seed');
  sh(work, 'push', '-q', 'origin', 'main');
  const seed = sh(work, 'rev-parse', 'HEAD');
  sh(root, 'clone', '-q', origin, bot);
  sh(bot, 'config', 'user.name', 'bot'); sh(bot, 'config', 'user.email', 'b@b');
  let n = 0;
  const onOrigin = (file, msg) => { sh(bot, 'pull', '-q', '--rebase', 'origin', 'main'); commit(bot, file, `${msg} ${++n}\n`, msg); sh(bot, 'push', '-q', 'origin', 'HEAD:main'); };
  const dataBot = () => onOrigin('data.json', 'data refresh [skip ci]');
  const codePush = () => onOrigin('other.txt', 'TEN-999: an unlaned code push');
  const mk = (file, content, msg) => { sh(work, 'checkout', '-q', '--detach', seed); return commit(work, file, content, msg); };
  const shas = { A: mk('a.txt', 'a.txt holder\n', 'TEN-301: holder change'), B: mk('b.txt', 'b.txt from B\n', 'TEN-302: B change'),
    C: mk('c.txt', 'c.txt from C\n', 'TEN-303: C change'), Z: mk('b.txt', 'b.txt from Z\n', 'TEN-304: Z change') };
  sh(work, 'checkout', '-q', '--detach', seed);
  dataBot();
  const receipts = path.join(root, 'receipts');
  for (const s of Object.values(shas)) receipt(receipts, s);

  const board = await startBoard();
  for (const r of ['run-A', 'run-B', 'run-C', 'run-Z']) board.runs[r] = 'running';
  const clock = { t: T0 };
  const notify = laneMod.paperclipNotify({ apiBase: board.base, apiKey: 'k', agentId: 'agent-x' });
  const lane = laneMod.createLane({ file: path.join(root, 'lane.json'), now: () => clock.t,
    liveness: laneMod.paperclipLiveness({ apiBase: board.base, apiKey: 'k' }), notify,
    suiteReceipt: laneMod.fileSuiteReceipts({ dir: receipts }), rebaseCheck: laneMod.gitRebaseCheck({ cwd: work }) });
  const ids = { B: 'B', C: 'C', Z: 'Z' };
  for (const e of entries) {
    clock.t += MIN;
    const key = ids[e.runId.slice(4)];
    const r = await lane.ready(e, { sha: shas[key], reviewed: true });
    if (r.code !== 0) throw new Error(`ready ${e.ticket}: ${JSON.stringify(r)}`);
  }
  clock.t += MIN;
  const claim = await lane.claim(A, { sha: shas.A, reviewed: true });
  if (claim.code !== 0) throw new Error(`claim: ${JSON.stringify(claim)}`);

  const suiteCalls = [];
  let suiteHook = null;
  let suiteOk = true;
  const suite = async (sha) => { suiteCalls.push(sha); if (suiteHook) suiteHook(); return { ok: suiteOk, exit: suiteOk ? 0 : 1, log: `/tmp/ci-suite-${sha}.log`, output: `EXIT=${suiteOk ? 0 : 1}` }; };
  const tipOf = () => sh(origin, 'rev-parse', 'main');
  const pushes = () => sh(origin, 'reflog', 'show', 'main').split('\n').filter(Boolean).length;
  const subjects = (from) => sh(origin, 'log', '--reverse', '--format=%s', `${from}..main`).split('\n').filter(Boolean);
  return { root, origin, work, board, lane, clock, shas, claim, notify, suite, suiteCalls, dataBot, codePush,
    setSuiteOk: (v) => { suiteOk = v; }, setSuiteHook: (f) => { suiteHook = f; }, tipOf, pushes, subjects,
    close: () => board.close() };
}

async function batch(mod, f, me = A, sha = f.shas.A) {
  return mod.runBatch({ lane: f.lane, me, sha, repo: f.work, suite: f.suite, clobber: real.realClobberCheck({ cwd: f.work }), notify: f.notify });
}

// ── the cases ────────────────────────────────────────────────────────────────
const CASES = {
  // i · two ready entries + the holder → ONE push carrying all three; landedAs
  //     recorded; a notice on each entry's issue; the queue emptied.
  async combinesIntoOnePush(mod) {
    const f = await fixture();
    try {
      if (f.claim.batch.length !== 2) return false;
      const start = f.tipOf(); const pushes0 = f.pushes();
      const r = await batch(mod, f);
      const st = f.lane.peek();
      const tip = f.tipOf();
      const lB = st.landed['run-B']; const lC = st.landed['run-C'];
      const subjOf = (s) => sh(f.origin, 'log', '-1', '--format=%s', s);
      const isAnc = (s) => spawnSync('git', ['merge-base', '--is-ancestor', s, tip], { cwd: f.origin }).status === 0;
      const nB = f.board.comments.find((c) => c.issueId === 'issue-B'); const nC = f.board.comments.find((c) => c.issueId === 'issue-C');
      return r.code === 0 && r.mode === 'batch'
        && f.pushes() === pushes0 + 1
        && JSON.stringify(f.subjects(start)) === JSON.stringify(['TEN-301: holder change', 'TEN-302: B change', 'TEN-303: C change'])
        && f.suiteCalls.length === 1 && f.suiteCalls[0] === tip
        && !!lB && !!lC && isAnc(lB.landedAs) && isAnc(lC.landedAs) && subjOf(lB.landedAs) === 'TEN-302: B change' && subjOf(lC.landedAs) === 'TEN-303: C change'
        && st.queue.length === 0
        && !!nB && nB.body.includes(`landed in a batch by TEN-301 as ${lB.landedAs}`) && nB.body.includes(`tools/check-live-build.sh ${lB.landedAs}`)
        && !!nC && nC.body.includes(lC.landedAs)
        && r.holder.landedAs && subjOf(r.holder.landedAs) === 'TEN-301: holder change';
    } catch (e) { if (process.env.DEBUG_TEN273) console.error("CASE THREW:", e.message); return false; } finally { f.close(); }
  },

  // ii · an entry that conflicts is skipped and stays queued (marked conflict);
  //      the others land.
  async conflictingEntryIsSkipped(mod) {
    const f = await fixture({ entries: [B, Z, C] });
    try {
      const start = f.tipOf();
      const r = await batch(mod, f);
      const st = f.lane.peek();
      const z = st.queue.find((e) => e.runId === 'run-Z');
      return r.code === 0 && r.mode === 'batch'
        && JSON.stringify(f.subjects(start)) === JSON.stringify(['TEN-301: holder change', 'TEN-302: B change', 'TEN-303: C change'])
        && st.queue.length === 1 && !!z && z.status === 'conflict' && /CONFLICT|apply/.test(z.conflict) && z.sha === f.shas.Z
        && !!st.landed['run-B'] && !!st.landed['run-C'] && !st.landed['run-Z']
        && f.board.comments.every((c) => c.issueId !== 'issue-Z');
    } catch (e) { if (process.env.DEBUG_TEN273) console.error("CASE THREW:", e.message); return false; } finally { f.close(); }
  },

  // iii · a red suite on the combined tree → fall back: only the holder's own
  //       commit is pushed; the others stay queued, untouched; the reason printed.
  async redSuiteFallsBackToHolderOnly(mod) {
    const f = await fixture();
    try {
      f.setSuiteOk(false);
      const start = f.tipOf();
      const r = await batch(mod, f);
      const st = f.lane.peek();
      return r.code === 0 && r.mode === 'fallback' && /suite RED/.test(r.fallbackReason)
        && JSON.stringify(f.subjects(start)) === JSON.stringify(['TEN-301: holder change'])
        && st.queue.length === 2 && st.queue.every((e) => !e.status && !e.landedAs)
        && !st.landed['run-B'] && !st.landed['run-C'] && !!st.landed['run-A']
        && f.board.comments.every((c) => c.issueId !== 'issue-B' && c.issueId !== 'issue-C');
    } catch (e) { if (process.env.DEBUG_TEN273) console.error("CASE THREW:", e.message); return false; } finally { f.close(); }
  },

  // iv · only the lane holder may run it.
  async nonHolderIsRefused(mod) {
    const f = await fixture();
    try {
      const tip0 = f.tipOf();
      const r = await batch(mod, f, B, f.shas.B);
      return r.code === 1 && r.action === 'not-holder' && f.tipOf() === tip0 && f.suiteCalls.length === 0 && f.lane.peek().queue.length === 2;
    } catch (e) { if (process.env.DEBUG_TEN273) console.error("CASE THREW:", e.message); return false; } finally { f.close(); }
  },

  // v · a data bot lands while the suite runs → the push is rejected; the batch
  //     replays onto the new origin/main, re-runs the clobber check, retries once.
  async dataBotRejectionIsRetried(mod) {
    const f = await fixture();
    try {
      const start = f.tipOf();
      f.setSuiteHook(() => f.dataBot());
      const r = await batch(mod, f);
      const subj = f.subjects(start);
      return r.code === 0 && r.mode === 'batch' && r.pushAttempts === 2
        && subj.length === 4 && /\[skip ci\]/.test(subj[0]) && subj.slice(1).join('|') === 'TEN-301: holder change|TEN-302: B change|TEN-303: C change';
    } catch (e) { if (process.env.DEBUG_TEN273) console.error("CASE THREW:", e.message); return false; } finally { f.close(); }
  },

  // vi · a CODE commit lands during the batch → no push over it: fall back, and the
  //      holder's own commit is refused too (it is no longer rebased).
  async codeCommitAbortsTheBatch(mod) {
    const f = await fixture();
    try {
      f.setSuiteHook(() => f.codePush());
      const r = await batch(mod, f);
      const tip = f.tipOf();
      return r.code === 1 && r.mode === 'fallback' && /code commit landed/.test(r.fallbackReason) && /no longer rebased/.test(r.detail)
        && sh(f.origin, 'log', '-1', '--format=%s', tip) === 'TEN-999: an unlaned code push'
        && f.lane.peek().queue.length === 2;
    } catch (e) { if (process.env.DEBUG_TEN273) console.error("CASE THREW:", e.message); return false; } finally { f.close(); }
  },
};

const MUTANTS = [
  ['queued entries are never picked', 'combinesIntoOnePush',
    'const b = build(START, [holder, ...entries]);', 'const b = build(START, [holder]);'],
  ['landedAs is not recorded for the entries', 'combinesIntoOnePush',
    'const landed = b.included.map((g) => ({', 'const landed = b.included.filter((g) => g.holder).map((g) => ({'],
  ['no notice to the included entries', 'combinesIntoOnePush',
    'for (const g of b.included.filter((x) => !x.holder)) {', 'for (const g of []) {'],
  ['each commit pushed separately', 'combinesIntoOnePush',
    "      included.push({ ...g, commits, landedAs: W(['rev-parse', 'HEAD']).stdout });",
    "      W(['push', '-q', 'origin', 'HEAD:refs/heads/main']);\n      included.push({ ...g, commits, landedAs: W(['rev-parse', 'HEAD']).stdout });"],
  ['a conflicting entry sinks the whole batch', 'conflictingEntryIsSkipped',
    'skipped.push({ ...g, reason }); continue;', 'return { ok: false, reason };'],
  ['a conflict is not marked in the queue', 'conflictingEntryIsSkipped',
    'const conflicts = extra.conflicts || [];', 'const conflicts = [];'],
  ['a conflicting cherry-pick is not aborted', 'conflictingEntryIsSkipped',
    "W(['cherry-pick', '--abort']);\n        W(['reset', '-q', '--hard', before]);", ''],
  ['a red combined suite is ignored', 'redSuiteFallsBackToHolderOnly',
    'if (!su.ok) return await fallback(', 'if (false) return await fallback('],
  ['the fallback pushes the combined tree', 'redSuiteFallsBackToHolderOnly',
    'const b = build(tip, [holder]);', 'const b = build(tip, [holder, ...entries]);'],
  ['the fallback clears the others from the queue', 'redSuiteFallsBackToHolderOnly',
    "return finish(why ? 'fallback' : 'holder-only', p.b,", "p.b.included.push(...entries.map((e) => ({ ...e, landedAs: e.sha })));\n    return finish(why ? 'fallback' : 'holder-only', p.b,"],
  ['anyone may run the batch', 'nonHolderIsRefused',
    "if (held.code !== 0) return { code: 1, action: 'not-holder'", "if (false) return { code: 1, action: 'not-holder'"],
  ['no retry after a data-bot rejection', 'dataBotRejectionIsRetried', 'if (attempt >= 1) return', 'if (attempt >= 0) return'],
  ['a code commit that landed is pushed over', 'codeCommitAbortsTheBatch',
    'if (code.length) return { ok: false, reason: `a code commit', 'if (false) return { ok: false, reason: `a code commit'],
  ['the fallback skips the rebased check', 'codeCommitAbortsTheBatch',
    'const rb = rebaseCheck(sha);', 'const rb = { ok: true };'],
];

async function loadMutant(find, replace) {
  const src = fs.readFileSync(BATCH_SRC, 'utf8');
  const n = src.split(find).length - 1;
  assert.equal(n, 1, `mutant anchor must occur exactly once, found ${n}: ${find}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten273-mut-'));
  const f = path.join(dir, 'deploy-batch.mjs');
  // The mutant imports the REAL lane module.
  fs.writeFileSync(f, src.replace(find, replace).replace("from './deploy-lane.mjs'", `from '${pathToFileURL(LANE_SRC).href}'`));
  return import(pathToFileURL(f).href);
}

for (const [name, fn] of Object.entries(CASES)) {
  test(`real batch: ${name}`, async () => { assert.equal(await fn(real), true); });
}
for (const [label, caseName, find, replace] of MUTANTS) {
  test(`mutant bites — ${label} → ${caseName} fails`, async () => {
    const mod = await loadMutant(find, replace);
    assert.equal(await CASES[caseName](mod), false);
  });
}

test('holder alone (nothing queued): a normal land, no combined suite run', async () => {
  const f = await fixture({ entries: [] });
  try {
    const start = f.tipOf();
    const r = await batch(real, f);
    assert.equal(r.code, 0); assert.equal(r.mode, 'holder-only');
    assert.deepEqual(f.subjects(start), ['TEN-301: holder change']);
    assert.equal(f.suiteCalls.length, 0, 'the holder already has its own receipt');
  } finally { f.close(); }
});

// ── tools/ci-suite.sh, run for real against a temp origin ────────────────────
// The origin's main is RED (exit.txt = 1). The local repo carries two commits
// that are NOT on origin: green (exit.txt = 0) and red (exit.txt = 2). npm test
// records the directory it ran in, so a suite run in the wrong checkout shows.
function suiteFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ten273-suite-'));
  const origin = path.join(root, 'origin.git');
  const local = path.join(root, 'local');
  const marks = path.join(root, 'marks');
  const nm = path.join(root, 'nm');
  fs.mkdirSync(marks); fs.mkdirSync(nm);
  sh(root, 'init', '-q', '--bare', '-b', 'main', origin);
  sh(root, 'clone', '-q', origin, local);
  sh(local, 'config', 'user.name', 't'); sh(local, 'config', 'user.email', 't@t'); sh(local, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  fs.mkdirSync(path.join(local, 'kibl-stream'));
  fs.writeFileSync(path.join(local, 'kibl-stream', 'README.md'), 'x\n');
  fs.writeFileSync(path.join(local, 'package.json'), JSON.stringify({ name: 'x', private: true, scripts: {
    test: `node -e "const fs=require('fs');fs.writeFileSync(process.env.MARKS+'/'+Date.now()+Math.random(),process.cwd()+' nm='+fs.existsSync('node_modules'));process.exit(Number(fs.readFileSync('exit.txt','utf8')))"` } }));
  fs.writeFileSync(path.join(local, 'exit.txt'), '1');
  sh(local, 'add', '.'); sh(local, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'seed (red)');
  sh(local, 'push', '-q', 'origin', 'main');
  const green = commit(local, 'exit.txt', '0', 'green');
  const red = commit(local, 'exit.txt', '2', 'red');
  return { root, origin, local, marks, nm, green, red, receipts: path.join(root, 'receipts') };
}

function runSuite(script, f, sha, url) {
  const r = spawnSync('bash', [script, sha], { cwd: f.local, encoding: 'utf8', env: { ...process.env, CI_SUITE_CLONE_URL: url || pathToFileURL(f.origin).href,
    CI_SUITE_NODE_MODULES: f.nm, SUITE_RECEIPTS_DIR: f.receipts, MARKS: f.marks } });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

async function ciSuiteReceiptOnlyWhenGreen(script) {
  const f = suiteFixture();
  const localReal = fs.realpathSync(f.local);
  const g = runSuite(script, f, f.green.slice(0, 10));
  const rec = path.join(f.receipts, `${f.green}.json`);
  if (g.status !== 0 || !fs.existsSync(rec)) return false;
  const j = JSON.parse(fs.readFileSync(rec, 'utf8'));
  const okReceipt = j.sha === f.green && j.exit === 0 && j.tree === sh(f.local, 'rev-parse', `${f.green}^{tree}`) && j.startedAt && j.finishedAt && fs.existsSync(j.log);
  const r = runSuite(script, f, f.red);
  const bad = runSuite(script, f, f.green, 'file:///nonexistent/nowhere.git');
  const ran = fs.readdirSync(f.marks).map((m) => fs.readFileSync(path.join(f.marks, m), 'utf8'));
  return okReceipt && /EXIT=0/.test(g.out) && /log: \//.test(g.out)
    && r.status === 2 && !fs.existsSync(path.join(f.receipts, `${f.red}.json`)) && /EXIT=2/.test(r.out) && /log: \//.test(r.out)
    && bad.status === 2 && /EXIT=2/.test(bad.out)
    && ran.length === 2 && ran.every((x) => !x.startsWith(localReal) && / nm=true$/.test(x))
    && !fs.existsSync(path.join(f.local, 'node_modules')) && sh(f.local, 'status', '--porcelain') === '';
}

const SUITE_MUTANTS = [
  ['a receipt is written for a red suite', 'if [ "$EXIT" -eq 0 ]; then', 'if true; then'],
  ['the exit code is read off a pipe', 'npm test > "$LOG" 2>&1\nEXIT=$?', 'npm test 2>&1 | tee "$LOG" >/dev/null\nEXIT=$?'],
  ['the suite runs on origin/main, not the sha', 'git -C "$D" checkout -q --detach "$SHA" || fail "could not check out $SHA in the clone"\n[ "$(git -C "$D" rev-parse HEAD)" = "$SHA" ] || fail "clone HEAD is not $SHA"\n', ''],
  ['node_modules is not linked into the clone', 'ln -s "$NODE_MODULES" "$D/node_modules" || fail "could not link node_modules into the clone"', ':'],
];

test('real ci-suite.sh: receipt only when green, on exactly the sha, in the throwaway clone', async () => {
  assert.equal(await ciSuiteReceiptOnlyWhenGreen(SUITE_SRC), true);
});
for (const [label, find, replace] of SUITE_MUTANTS) {
  test(`mutant bites — ci-suite.sh: ${label}`, async () => {
    const src = fs.readFileSync(SUITE_SRC, 'utf8');
    assert.equal(src.split(find).length - 1, 1, `anchor must occur exactly once: ${find}`);
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ten273-suite-mut-')), 'ci-suite.sh');
    fs.writeFileSync(f, src.replace(find, replace));
    assert.equal(await ciSuiteReceiptOnlyWhenGreen(f), false);
  });
}

test('CLI: deploy-batch usage is exit 2; a caller that does not hold the lane gets exit 1 and nothing runs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten273-cli-'));
  const env = { ...process.env, DEPLOY_LANE_FILE: path.join(dir, 'lane.json'), SUITE_RECEIPTS_DIR: path.join(dir, 'r'), PAPERCLIP_API_URL: '', PAPERCLIP_RUN_ID: 'run-X' };
  assert.equal(spawnSync(process.execPath, [BATCH_SRC, '--ticket', 'TEN-1'], { cwd: dir, env, encoding: 'utf8' }).status, 2);
  const r = spawnSync(process.execPath, [BATCH_SRC, '--ticket', 'TEN-1', '--sha', 'HEAD'], { cwd: dir, env, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).action, 'not-holder');
});
