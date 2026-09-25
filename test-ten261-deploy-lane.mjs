// TEN-261 → TEN-273 — the deploy lane: first come, first served; held only
// while deploying; a total-hold cap whose number the founder has not set yet.
//
// Founder ruling TEN-273 (2026-09-25 00:55Z) SUPERSEDES the TEN-261 lease and
// the earlier TEN-273 draft where they conflict:
//   - a free lane goes to the longest-waiting LIVE claimant (no re-claim race);
//     dead claimants drop out; every claim records position and minutes waited;
//   - the lane covers deploying only: `confirm-live` releases it the moment the
//     live build contains the sha;
//   - a total-hold cap (MAX_HOLD_MIN, from takenAt) that renew/claim can never
//     extend. Its number is PENDING (null = not wired); these tests inject 30.
// A claim still needs a READY commit (green suite receipt, rebased, reviewed).
//
// Each case is simulated end to end and paired with a mutant of
// tools/deploy-lane.mjs that must make it fail. The five FOUNDER cases (named
// "founder 00:55Z (…)") are written against the API both the old and the new
// tool share, so they can be run against origin/main's TEN-261 tool too:
//   TEN273_LANE_SRC=/path/to/old/deploy-lane.mjs node --test --test-name-pattern='real lane: founder' test-ten261-deploy-lane.mjs
// and must FAIL there.
//
// Nothing here reads the source for its assertions. The store is a real file,
// liveness and notices go through the REAL Paperclip adapters over real HTTP
// to a fake board server, suite receipts are real files read by the real
// adapter, the readiness case runs the real git rebase check against a real
// temp repo with a bare origin, and the CLI is spawned for real. The
// substitutes are the clock, the live-build check (whose fake returns the real
// one's shape {code, output}) and, outside the readiness case, the rebase check.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.env.TEN273_LANE_SRC || path.join(HERE, 'tools', 'deploy-lane.mjs');
const MIN = 60 * 1000;
const T0 = Date.parse('2026-09-23T08:00:00Z');
const at = (m) => T0 + Math.round(m * MIN);

// ── fake board: run statuses + a comment sink ────────────────────────────────
function startBoard() {
  const runs = {};
  const comments = [];
  let failRuns = false;
  let delayMs = 0;
  let failComments = false;
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const m = req.url.match(/^\/api\/heartbeat-runs\/([^/?]+)$/);
      if (req.method === 'GET' && m) {
        if (failRuns) { res.writeHead(500); return res.end('{}'); }
        const st = runs[m[1]];
        if (!st) { res.writeHead(404); return res.end('{}'); }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ id: m[1], status: st, lastOutputAt: null, finishedAt: null }));
      }
      const c = req.url.match(/^\/api\/issues\/([^/]+)\/comments$/);
      if (req.method === 'POST' && c) {
        if (failComments) { res.writeHead(503); return res.end('{}'); }
        const id = `c${comments.length + 1}`;
        comments.push({ id, issueId: c[1], ...JSON.parse(body) });
        res.writeHead(201, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ id }));
      }
      res.writeHead(404); res.end('{}');
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({
    base: `http://127.0.0.1:${srv.address().port}`, runs, comments,
    setFailRuns: (v) => { failRuns = v; }, setDelay: (v) => { delayMs = v; }, setFailComments: (v) => { failComments = v; }, close: () => { srv.closeAllConnections(); srv.close(); },
  })));
}

// Real-shaped receipts, as tools/ci-suite.sh writes them.
const sha40 = (c) => c.repeat(40);
const SHA = { A: sha40('a'), A2: sha40('d'), B: sha40('b'), C: sha40('c'), D: sha40('e') };
function writeReceipt(dir, sha, exit = 0) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sha}.json`), JSON.stringify({ sha, tree: sha40('f'), exit, startedAt: '2026-09-23T07:50:00Z', finishedAt: '2026-09-23T07:56:00Z', log: '/tmp/x.log' }));
}
const REBASED = () => ({ ok: true, codeCommits: [], dataCommits: 2, detail: 'rebased (2 data-bot commit(s) ahead)' });

// The cap is injected (30) — its shipped value is pending a founder number.
// Parameters the old TEN-261 tool does not know are simply ignored by it.
async function rig(mod, board, shared, { cap = 30, noCap = false } = {}) {
  const dir = shared ? path.dirname(shared.file) : fs.mkdtempSync(path.join(os.tmpdir(), 'ten261-'));
  const clock = shared ? shared.clock : { t: T0 };
  const receipts = path.join(dir, 'receipts');
  for (const s of Object.values(SHA)) writeReceipt(receipts, s);
  const live = { code: 1, calls: [] };
  const opts = {
    file: path.join(dir, 'lane.json'),
    now: () => clock.t,
    liveness: mod.paperclipLiveness({ apiBase: board.base, apiKey: 'k' }),
    notify: mod.paperclipNotify({ apiBase: board.base, apiKey: 'k', agentId: 'agent-x' }),
    suiteReceipt: mod.fileSuiteReceipts ? mod.fileSuiteReceipts({ dir: receipts }) : undefined,
    rebaseCheck: REBASED,
    checkLive: async (sha) => { live.calls.push(sha); return { code: live.code, output: `check-live-build exit ${live.code}` }; },
    clobberCheck: () => ({ ok: true, output: 'clear' }), // the old tool's takeover check
  };
  if (!noCap) opts.maxHoldMin = cap;
  const lane = mod.createLane(opts);
  return { lane, clock, live, file: path.join(dir, 'lane.json') };
}
const state = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const A = { ticket: 'TEN-253', issueId: 'issue-253', runId: 'run-A', kind: 'paperclip' };
const B = { ticket: 'TEN-260', issueId: 'issue-260', runId: 'run-B', kind: 'paperclip' };
const C = { ticket: 'TEN-262', issueId: 'issue-262', runId: 'run-C', kind: 'paperclip' };
const D = { ticket: 'TEN-264', issueId: 'issue-264', runId: 'run-D', kind: 'paperclip' };
const RDY = (sha) => ({ sha, reviewed: true });
const history = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).history;

// ── real git fixture for the readiness case ──────────────────────────────────
function sh(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function commit(cwd, file, content, msg) {
  fs.writeFileSync(path.join(cwd, file), content);
  sh(cwd, 'add', file);
  sh(cwd, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', msg);
  return sh(cwd, 'rev-parse', 'HEAD');
}
function gitFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ten273-git-'));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const bot = path.join(root, 'bot');
  sh(root, 'init', '-q', '--bare', '-b', 'main', origin);
  sh(root, 'clone', '-q', origin, work);
  for (const d of [work]) { sh(d, 'config', 'user.name', 't'); sh(d, 'config', 'user.email', 't@t'); sh(d, 'symbolic-ref', 'HEAD', 'refs/heads/main'); }
  commit(work, 'app.txt', 'v1\n', 'seed');
  commit(work, 'data.json', '{}\n', 'seed data');
  sh(work, 'push', '-q', 'origin', 'main');
  sh(root, 'clone', '-q', origin, bot);
  sh(bot, 'config', 'user.name', 'bot'); sh(bot, 'config', 'user.email', 'b@b');
  let n = 0;
  const onOrigin = (file, msg) => { sh(bot, 'pull', '-q', '--rebase', 'origin', 'main'); commit(bot, file, `${msg} ${++n}\n`, msg); sh(bot, 'push', '-q', 'origin', 'HEAD:main'); };
  return { root, origin, work, bot, dataBot: () => onOrigin('data.json', 'data refresh [skip ci]'), codePush: (f = 'other.txt') => onOrigin(f, 'TEN-999: a code change\n\nIts body mentions [skip ci]; it is still code.') };
}

// ── the cases, each returning whether the rule held ──────────────────────────
const CASES = {
  // The cap (injected 30): released even while the owner is alive and renewing
  // (and re-claiming): held at 29:59, free at 30:00, holder re-queued at the BACK.
  async holdCapAutoReleases(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, file } = await rig(mod, board);
      board.runs['run-A'] = 'running'; board.runs['run-B'] = 'running';
      if ((await lane.claim(A, RDY(SHA.A))).code !== 0) return false;
      const cap = new Date(at(30)).toISOString();
      for (const m of [5, 10, 20, 29]) {
        clock.t = at(m);
        const r = await lane.renew(A);
        if (r.code !== 0 || r.claim.expiresAt !== cap) return false;
      }
      clock.t = at(20); const again = await lane.claim(A, RDY(SHA.A));
      if (again.code !== 0 || again.claim.expiresAt !== cap) return false;
      clock.t = at(30) - 1000;
      const b2959 = await lane.claim(B, RDY(SHA.B));
      const a2959 = await lane.renew(A);
      clock.t = at(30);
      const b30 = await lane.claim(B, RDY(SHA.B));
      const a30 = await lane.renew(A);
      const notice = board.comments.find((c) => c.issueId === 'issue-253' && /CAP-RELEASED/.test(c.body));
      const w = state(file).waiters['run-A'];
      return b2959.code === 3 && b2959.claim.runId === 'run-A' && a2959.code === 0
        && b30.code === 0 && b30.action === 'claimed' && b30.claim.runId === 'run-B' && b30.capReleased.runId === 'run-A'
        && a30.code === 1
        && !!w && w.since === new Date(at(30)).toISOString()
        && !!notice && /check-live-build\.sh/.test(notice.body)
        && history(file).some((h) => h.event === 'cap-released' && h.runId === 'run-A' && h.requeued === true);
    } finally { board.close(); }
  },

  // b · a dead owner is released on the next claim — at minute 1, not minute 30.
  async deadOwnerReleasedAtOnce(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, file } = await rig(mod, board);
      board.runs['run-A'] = 'running'; board.runs['run-B'] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(0.5); board.runs['run-A'] = 'cancelled'; // crashed mid-deploy
      clock.t = at(1);
      const r = await lane.claim(B, RDY(SHA.B));
      const notice = board.comments.find((c) => c.issueId === 'issue-253');
      const ev = history(file).find((h) => h.event === 'released-dead-owner');
      return r.code === 0 && r.action === 'released-dead-owner' && r.claim.runId === 'run-B'
        && r.claim.expiresAt === new Date(at(31)).toISOString()
        && !!notice && /released/.test(notice.body) && /run-A/.test(notice.body) && /cancelled/.test(notice.body)
        && notice.authorAgentId === 'agent-x'
        && !!ev && ev.runId === 'run-A' && /cancelled/.test(ev.evidence || '');
    } finally { board.close(); }
  },

  // c · unknown liveness is NOT dead: an unreachable board or a session owner is
  //     held until the 30-min cap, and freed exactly at it.
  async unknownIsNotDead(mod) {
    const board = await startBoard();
    try {
      const { lane, clock } = await rig(mod, board);
      board.runs['run-A'] = 'running'; board.runs['run-B'] = 'running';
      await lane.claim(A, RDY(SHA.A));
      board.setFailRuns(true);
      const codes = [];
      for (const m of [1, 15, 29.99]) { clock.t = at(m); codes.push((await lane.claim(B, RDY(SHA.B))).code); }
      clock.t = at(30); codes.push((await lane.claim(B, RDY(SHA.B))).code);
      board.setFailRuns(false);
      // A session claim (no Paperclip run id) can never be confirmed dead.
      const S = { ticket: 'TEN-270', issueId: null, runId: 'session:TEN-270', kind: 'session' };
      await lane.release(B); await lane.release(A); // A was re-queued at the cap: it leaves
      clock.t = at(31); const s0 = await lane.claim(S, RDY(SHA.C));
      clock.t = at(32); const s1 = await lane.claim(D, RDY(SHA.D));
      clock.t = at(61); const s30 = await lane.claim(D, RDY(SHA.D));
      return JSON.stringify(codes) === '[3,3,3,0]' && s0.code === 0 && s1.code === 3 && s1.owner.state === 'unknown' && s30.code === 0;
    } finally { board.close(); }
  },

  // d · not ready → exit 7, one missing condition at a time; all four met → granted,
  //     with data-bot commits ahead allowed. REAL receipts, REAL git rebase check.
  async notReadyIsRefused(mod) {
    const board = await startBoard();
    const g = gitFixture();
    try {
      const receipts = path.join(g.root, 'receipts');
      const clock = { t: T0 };
      const file = path.join(g.root, 'lane.json');
      const lane = mod.createLane({ file, now: () => clock.t,
        liveness: mod.paperclipLiveness({ apiBase: board.base, apiKey: 'k' }),
        notify: mod.paperclipNotify({ apiBase: board.base, apiKey: 'k', agentId: 'agent-x' }),
        suiteReceipt: mod.fileSuiteReceipts({ dir: receipts }), rebaseCheck: mod.gitRebaseCheck({ cwd: g.work }) });
      board.runs['run-A'] = 'running';
      const s1 = commit(g.work, 'app.txt', 'v2\n', 'TEN-253: the change');
      const one = (r, re) => r.code === 7 && r.missing.length === 1 && re.test(r.missing[0]);
      const noReceipt = await lane.claim(A, RDY(s1));
      writeReceipt(receipts, s1, 1);
      const redReceipt = await lane.claim(A, RDY(s1));
      writeReceipt(receipts, s1, 0);
      const unreviewed = await lane.claim(A, { sha: s1 });
      g.codePush();
      const behind = await lane.claim(A, RDY(s1));
      const queuedBehind = await lane.ready(A, RDY(s1));
      const untouched = !fs.existsSync(file);
      // Rebase onto the code commit; data bots then commit on top of origin.
      sh(g.work, 'pull', '-q', '--rebase', 'origin', 'main');
      const s2 = sh(g.work, 'rev-parse', 'HEAD');
      writeReceipt(receipts, s2, 0);
      g.dataBot(); g.dataBot();
      const ok = await lane.claim(A, RDY(s2));
      return one(noReceipt, /^suite: no receipt/) && one(redReceipt, /^suite: .*not green \(exit 1/) && one(unreviewed, /^review/)
        && one(behind, /^rebased: 1 code commit.*TEN-999/) && one(queuedBehind, /^rebased/) && untouched
        && ok.code === 0 && ok.claim.sha === s2 && ok.claim.reviewed === true;
    } catch (e) { if (process.env.DEBUG_TEN273) console.error("CASE THREW:", e.message); return false; } finally { board.close(); }
  },

  // e · the retired codes 4 and 5 come back from no path.
  async noPathReturnsFourOrFive(mod) {
    const board = await startBoard();
    try {
      const allowed = new Set([0, 1, 2, 3, 6, 7]);
      if (!Object.values(mod.EXIT).every((v) => allowed.has(v))) return false;
      const { lane, clock } = await rig(mod, board);
      const seen = [];
      const c = async (p) => { const r = await p; seen.push(r.code); return r; };
      board.runs['run-A'] = 'running'; board.runs['run-B'] = 'running'; board.runs['run-C'] = 'running';
      await c(lane.claim(A, RDY(SHA.A)));
      await c(lane.claim(A, RDY(SHA.A)));
      await c(lane.claim(B, RDY(SHA.B)));            // alive owner
      await c(lane.claim(B, { sha: SHA.B }));        // not ready
      await c(lane.ready(C, RDY(SHA.C)));
      await c(lane.renew(B)); await c(lane.release(B)); await c(lane.status(B));
      board.setFailRuns(true); clock.t = at(5);
      await c(lane.claim(B, RDY(SHA.B)));            // unknown owner
      board.setFailRuns(false); board.runs['run-A'] = 'cancelled';
      await c(lane.claim({ ...A, runId: 'run-A2' }, RDY(SHA.A2)));  // dead, same ticket
      clock.t = at(35);
      await c(lane.claim(B, RDY(SHA.B)));            // auto-release
      clock.t = at(70);
      await c(lane.renew(B)); await c(lane.release(B)); await c(lane.status());
      return seen.length === 14 && seen.every((x) => x !== 4 && x !== 5 && allowed.has(x));
    } finally { board.close(); }
  },

  // A notice that cannot be posted never keeps the lane held (cap or dead owner).
  async noticeFailureNeverKeepsTheLane(mod) {
    const board = await startBoard();
    try {
      const { lane, clock } = await rig(mod, board);
      board.runs['run-A'] = 'running'; board.runs['run-B'] = 'running'; board.runs['run-C'] = 'running';
      await lane.claim(A, RDY(SHA.A));
      board.setFailComments(true);
      clock.t = at(30);
      const capped = await lane.claim(B, RDY(SHA.B));
      board.runs['run-B'] = 'failed'; board.runs['run-A'] = 'succeeded'; // A (re-queued at the cap) has finished
      clock.t = at(31);
      const dead = await lane.claim(C, RDY(SHA.C));
      return capped.code === 0 && capped.claim.runId === 'run-B' && dead.code === 0 && dead.claim.runId === 'run-C' && dead.notice.ok === false;
    } finally { board.close(); }
  },

  // A waiter past 30 minutes reports who holds the lane, since when, whether it
  // is alive, and its position. Under FCFS + the cap, a long wait means others
  // were ahead: C (since 0:30) and D (since 0:42) are ahead of B (since 1).
  async waiterPast30Reports(mod) {
    const board = await startBoard();
    try {
      const { lane, clock } = await rig(mod, board);
      for (const r of ['run-A', 'run-B', 'run-C', 'run-D']) board.runs[r] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(0.5); if ((await lane.claim(C, RDY(SHA.C))).code !== 3) return false;
      clock.t = at(0.7); if ((await lane.claim(D, RDY(SHA.D))).code !== 3) return false;
      const rep = () => board.comments.filter((c) => c.issueId === 'issue-260' && /has waited/.test(c.body));
      const steps = [[1, 0], [15, 0], [29, 0], [30, 'C'], [32, 1], [40, 1], [60, 'D'], [63, 2]];
      for (const [m, want] of steps) {
        clock.t = at(m);
        if (want === 'C') { if ((await lane.claim(C, RDY(SHA.C))).code !== 0) return false; continue; }
        if (want === 'D') { if ((await lane.claim(D, RDY(SHA.D))).code !== 0) return false; continue; }
        const r = await lane.claim(B, RDY(SHA.B));
        if (r.code !== 3 || rep().length !== want) return false;
      }
      const body = rep()[0].body;
      return /TEN-262/.test(body) && /run-C/.test(body) && /taken 2026-09-23T08:30:00/.test(body) && /alive/.test(body)
        && /has waited 31 min \(position 2\)/.test(body);
    } finally { board.close(); }
  },

  // Two claimants race for a dead owner's lane: exactly one gets it, one notice.
  async concurrentClaimsSerialise(mod) {
    const board = await startBoard();
    try {
      const b = await rig(mod, board);
      const c = await rig(mod, board, b);
      board.runs['run-A'] = 'running'; board.runs['run-B'] = 'running'; board.runs['run-C'] = 'running';
      await b.lane.claim(A, RDY(SHA.A));
      board.runs['run-A'] = 'cancelled';
      b.clock.t = at(1);
      board.setDelay(150); // both read the store before either could write, unless the lock serialises them
      const [rb, rc] = await Promise.all([b.lane.claim(B, RDY(SHA.B)), c.lane.claim(C, RDY(SHA.C))]);
      board.setDelay(0);
      const winners = [rb, rc].filter((r) => r.code === 0);
      const holder = JSON.parse(fs.readFileSync(b.file, 'utf8')).claim.runId;
      return winners.length === 1 && [rb, rc].some((r) => r.code === 3)
        && holder === winners[0].claim.runId
        && board.comments.filter((x) => x.issueId === 'issue-253').length === 1;
    } finally { board.close(); }
  },

  // A holder whose lock is broken as stale (it was too slow) must not write, and
  // must not remove the lock the new holder now owns.
  async staleLockBreakCannotDoubleTake(mod) {
    const board = await startBoard();
    try {
      const b = await rig(mod, board);
      const c = await rig(mod, board, b);
      board.runs['run-A'] = 'running'; board.runs['run-B'] = 'running'; board.runs['run-C'] = 'running';
      await b.lane.claim(A, RDY(SHA.A));
      board.runs['run-A'] = 'cancelled';
      b.clock.t = at(1);
      board.setDelay(400);
      const lock = `${b.file}.lock`;
      const pb = b.lane.claim(B, RDY(SHA.B)).then((r) => ({ r }), (e) => ({ e }));
      await new Promise((r) => setTimeout(r, 100));
      const old = new Date(Date.now() - 10 * MIN);
      fs.utimesSync(lock, old, old); // B's lock now looks abandoned
      const pc = c.lane.claim(C, RDY(SHA.C)).then((r) => ({ r }), (e) => ({ e }));
      const rb = await pb; // B resumes while C holds the lock
      const cLockSurvived = fs.existsSync(lock);
      const rc = await pc;
      board.setDelay(0);
      const holder = JSON.parse(fs.readFileSync(b.file, 'utf8')).claim.runId;
      return !!rb.e && /lost the store lock/.test(rb.e.message) && cLockSurvived
        && rc.r && rc.r.code === 0 && holder === 'run-C';
    } finally { board.close(); }
  },

  // Same ticket, new run: no silent inheritance (founder ruling TEN-261, kept by
  // TEN-273). The new run cannot renew/release the old claim; old run alive →
  // it waits; old run dead → released, and the new run claims FRESH: its own
  // run id, its own 30 min, a RE-CLAIMED notice.
  async sameTicketNoSilentInheritance(mod) {
    const board = await startBoard();
    try {
      const { lane, clock } = await rig(mod, board);
      const A2 = { ...A, runId: 'run-A2' };
      board.runs['run-A'] = 'running'; board.runs['run-A2'] = 'running'; board.runs['run-C'] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(5);
      const silentRenew = await lane.renew(A2);
      const silentRelease = await lane.release(A2);
      const whileAlive = await lane.claim(A2, RDY(SHA.A2));
      board.runs['run-A'] = 'cancelled';
      clock.t = at(10);
      const r = await lane.claim(A2, RDY(SHA.A2));
      const notice = board.comments.find((x) => x.issueId === 'issue-253' && /RE-CLAIMED/.test(x.body));
      const oldRenew = await lane.renew(A);
      clock.t = at(40) - 1000; const c3959 = await lane.claim(C, RDY(SHA.C));
      clock.t = at(40); const c40 = await lane.claim(C, RDY(SHA.C));
      return silentRenew.code === 1 && silentRelease.code === 1 && whileAlive.code === 3
        && r.code === 0 && r.action === 're-claimed' && r.claim.runId === 'run-A2' && r.claim.reclaimedFrom === 'run-A'
        && r.claim.sha === SHA.A2 && r.claim.expiresAt === new Date(at(40)).toISOString()
        && !!notice && /run-A2/.test(notice.body) && /run-A\b/.test(notice.body)
        && oldRenew.code === 1 && c3959.code === 3 && c40.code === 0;
    } finally { board.close(); }
  },

  // `ready` queues; `claim` lists OTHER runs' queued entries as batch candidates;
  // `status` shows the queue and the caller's landedAs.
  async claimListsTheBatch(mod) {
    const board = await startBoard();
    try {
      const { lane, clock } = await rig(mod, board);
      for (const r of ['run-A', 'run-B', 'run-C']) board.runs[r] = 'running';
      await lane.ready(B, RDY(SHA.A));
      clock.t = at(1); await lane.ready(B, RDY(SHA.B)); // replaces B's earlier entry
      clock.t = at(2); await lane.ready(C, RDY(SHA.C));
      clock.t = at(3); await lane.ready(A, RDY(SHA.A));
      const r = await lane.claim(A, RDY(SHA.A));
      await lane.recordBatch(A, { landed: [{ ticket: B.ticket, runId: 'run-B', sha: SHA.B, landedAs: SHA.D }] });
      const st = await lane.status(B);
      return r.code === 0 && r.batch.length === 2 && r.batch[0].runId === 'run-B' && r.batch[0].sha === SHA.B && r.batch[1].runId === 'run-C'
        && st.landed && st.landed.landedAs === SHA.D && st.queue.every((e) => e.runId !== 'run-B');
    } finally { board.close(); }
  },
};

Object.assign(CASES, {
  // Queue hygiene · an entry is dropped READY_TTL_MIN after it was queued.
  async readyEntriesExpire(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, file } = await rig(mod, board);
      for (const r of ['run-A', 'run-B']) board.runs[r] = 'running';
      await lane.ready(B, RDY(SHA.B));
      clock.t = at(59.99);
      const early = await lane.claim(A, RDY(SHA.A));
      await lane.release(A);
      clock.t = at(60);
      const late = await lane.claim(A, RDY(SHA.A));
      return early.batch.length === 1 && late.batch.length === 0 && lane.peek().queue.length === 0
        && history(file).some((h) => h.event === 'ready-expired' && h.runId === 'run-B');
    } finally { board.close(); }
  },

  // `unready` withdraws the caller's entry; `release` withdraws it too.
  async unreadyAndReleaseWithdraw(mod) {
    const board = await startBoard();
    try {
      const { lane } = await rig(mod, board);
      for (const r of ['run-A', 'run-B']) board.runs[r] = 'running';
      await lane.ready(B, RDY(SHA.B));
      const w1 = await lane.unready(B);
      const w2 = await lane.unready(B);
      await lane.ready(A, RDY(SHA.A));
      await lane.claim(A, RDY(SHA.A));
      await lane.release(A);
      return w1.code === 0 && w2.code === 1 && lane.peek().queue.length === 0;
    } finally { board.close(); }
  },

  // At batch time, an entry whose owner run has ended is dropped (notice,
  // history), never handed to the batch; unknown liveness is kept.
  async deadOwnerEntryDropped(mod) {
    const board = await startBoard();
    try {
      const { lane, file } = await rig(mod, board);
      for (const r of ['run-A', 'run-B', 'run-C']) board.runs[r] = 'running';
      await lane.ready(B, RDY(SHA.B));
      await lane.ready(C, RDY(SHA.C));
      await lane.ready(D, RDY(SHA.D)); // run-D is unknown to the board: liveness unknown
      await lane.claim(A, RDY(SHA.A));
      board.runs['run-B'] = 'failed';
      const cands = await lane.batchCandidates(A);
      return JSON.stringify(cands.map((e) => e.runId)) === '["run-C","run-D"]'
        && lane.peek().queue.every((e) => e.runId !== 'run-B')
        && board.comments.some((c) => c.issueId === 'issue-260' && /NOT landed/.test(c.body))
        && history(file).some((h) => h.event === 'ready-dropped-dead-owner' && h.runId === 'run-B' && /failed/.test(h.evidence));
    } finally { board.close(); }
  },

  // A landed entry leaves the queue only if run AND sha match: a newer commit the
  // same run queued during the batch stays.
  async recordBatchMatchesRunAndSha(mod) {
    const board = await startBoard();
    try {
      const { lane } = await rig(mod, board);
      await lane.ready(B, RDY(SHA.B));
      await lane.ready(B, RDY(SHA.D)); // re-queued during A's batch
      await lane.recordBatch(A, { landed: [{ ticket: B.ticket, runId: 'run-B', sha: SHA.B, landedAs: SHA.C }] });
      const q = lane.peek().queue;
      await lane.recordBatch(A, { landed: [{ ticket: B.ticket, runId: 'run-B', sha: SHA.D, landedAs: SHA.C }] });
      return q.length === 1 && q[0].sha === SHA.D && lane.peek().queue.length === 0;
    } finally { board.close(); }
  },
});

Object.assign(CASES, {
  // The holder re-claims with a NEW ready sha: the claim takes it (so deploy-batch
  // accepts it) without extending the hold; a not-ready new sha → 7, claim unchanged.
  async reclaimWithNewShaUpdatesTheClaim(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, file } = await rig(mod, board);
      board.runs['run-A'] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(10);
      const r = await lane.claim(A, RDY(SHA.A2));
      const bad = await lane.claim(A, RDY(sha40('9')));
      const c = lane.peek().claim;
      return r.code === 0 && r.claim.sha === SHA.A2 && r.claim.expiresAt === new Date(at(30)).toISOString()
        && bad.code === 7 && c.sha === SHA.A2 && c.expiresAt === new Date(at(30)).toISOString()
        && history(file).some((h) => h.event === 'claim-sha-updated' && h.from === SHA.A && h.to === SHA.A2);
    } finally { board.close(); }
  },

  // After the cap auto-released A, A's release still exits 1 — but its queue entry goes.
  async releaseAfterCapWithdrawsEntry(mod) {
    const board = await startBoard();
    try {
      const { lane, clock } = await rig(mod, board);
      for (const r of ['run-A', 'run-B']) board.runs[r] = 'running';
      await lane.ready(A, RDY(SHA.A));
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(30);
      await lane.claim(B, RDY(SHA.B));
      const r = await lane.release(A);
      return r.code === 1 && lane.peek().queue.every((e) => e.runId !== 'run-A') && lane.peek().claim.runId === 'run-B';
    } finally { board.close(); }
  },

  // batchCandidates holds the store lock: an overall deadline caps its liveness
  // calls; entries not reached are kept in the queue but not batched this round.
  async batchLivenessDeadline(mod) {
    const board = await startBoard();
    try {
      if (!(mod.BATCH_LIVENESS_BUDGET_MS > 0 && mod.BATCH_LIVENESS_BUDGET_MS <= 60000)) return false;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten273-budget-'));
      const receipts = path.join(dir, 'receipts');
      for (const x of Object.values(SHA)) writeReceipt(receipts, x);
      const lane = mod.createLane({ file: path.join(dir, 'lane.json'), now: () => T0,
        liveness: mod.paperclipLiveness({ apiBase: board.base, apiKey: 'k' }),
        notify: mod.paperclipNotify({ apiBase: board.base, apiKey: 'k', agentId: 'agent-x' }),
        suiteReceipt: mod.fileSuiteReceipts({ dir: receipts }), rebaseCheck: REBASED, livenessBudgetMs: 250 });
      const E = { ticket: 'TEN-265', issueId: 'issue-265', runId: 'run-E', kind: 'paperclip' };
      for (const r of ['run-A', 'run-B', 'run-C', 'run-D', 'run-E']) board.runs[r] = 'running';
      await lane.ready(B, RDY(SHA.B)); await lane.ready(C, RDY(SHA.C)); await lane.ready(D, RDY(SHA.D)); await lane.ready(E, RDY(SHA.A2));
      await lane.claim(A, RDY(SHA.A));
      board.setDelay(150);
      const t = Date.now();
      const cands = await lane.batchCandidates(A);
      const took = Date.now() - t;
      board.setDelay(0);
      return cands.length >= 1 && cands.length <= 2 && lane.peek().queue.length === 4 && took < 1000;
    } finally { board.close(); }
  },
});

// ── founder ruling 2026-09-25 00:55Z ─────────────────────────────────────────
// Written against the API the old (origin/main, TEN-261) tool shares, so each
// can be run against it and must FAIL there. See the header.
Object.assign(CASES, {
  // (a) first come, first served: B waits from 1, C from 5, and A2 (a new run of
  //     A's ticket) arrives the instant the lane frees. C and A2 poll FIRST; B
  //     still gets the lane. (The live case: TEN-273 waiting from 23:41Z, TEN-270
  //     took the lane at 00:07Z.)
  async founderA_earlierWaiterWins(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, file } = await rig(mod, board);
      const A2 = { ...A, runId: 'run-A2' };
      for (const r of ['run-A', 'run-A2', 'run-B', 'run-C']) board.runs[r] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(1); const b1 = await lane.claim(B, RDY(SHA.B));
      clock.t = at(5); const c5 = await lane.claim(C, RDY(SHA.C));
      clock.t = at(10); await lane.release(A);
      clock.t = at(10.01); const cFirst = await lane.claim(C, RDY(SHA.C));
      clock.t = at(10.02); const a2 = await lane.claim(A2, RDY(SHA.A2));
      clock.t = at(10.03); const bWins = await lane.claim(B, RDY(SHA.B));
      const ev = state(file).history.find((h) => h.event === 'waiting' && h.runId === 'run-C' && h.position === 2 && h.waitedMin === 5);
      return b1.code === 3 && c5.code === 3
        && cFirst.code === 3 && cFirst.position === 2 && cFirst.waitedMin === 5 && cFirst.ahead[0].runId === 'run-B'
        && a2.code === 3 && a2.position === 3
        && bWins.code === 0 && bWins.claim.runId === 'run-B' && bWins.position === 1 && bWins.waitedMin === 9
        && !!ev && ev.waitedMin === 5
        && state(file).history.some((h) => h.event === 'claimed' && h.runId === 'run-B' && h.position === 1 && h.waitedMin === 9);
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },

  // (b) the lane covers deploying only: confirm-live releases it once the live
  //     build contains the sha; while it doesn't (exit 1) or can't tell (exit 2)
  //     the lane stays held.
  async founderB_noLaneAfterLiveConfirmed(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, live, file } = await rig(mod, board);
      for (const r of ['run-A', 'run-B']) board.runs[r] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(3); live.code = 1; const notYet = await lane.confirmLive(A, { sha: SHA.A });
      clock.t = at(4); live.code = 2; const unsure = await lane.confirmLive(A, { sha: SHA.A });
      const heldBetween = state(file).claim && state(file).claim.runId === 'run-A';
      clock.t = at(5); live.code = 0; const done = await lane.confirmLive(A, { sha: SHA.A });
      const after = state(file);
      clock.t = at(6); const b = await lane.claim(B, RDY(SHA.B));
      return notYet.code === 3 && unsure.code === 3 && heldBetween
        && done.code === 0 && done.action === 'released-live-confirmed' && after.claim === null
        && after.history.some((h) => h.event === 'released-live-confirmed' && h.sha === SHA.A)
        && JSON.stringify(live.calls) === JSON.stringify([SHA.A, SHA.A, SHA.A])
        && b.code === 0;
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },

  // (c) renewal past the cap is refused (cap injected: 30 min from takenAt),
  //     however often the owner renewed before it; the holder goes to the back
  //     of the queue with a fresh wait-start and an alert on its ticket.
  async founderC_renewalPastCapRefused(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, file } = await rig(mod, board);
      board.runs['run-A'] = 'running';
      await lane.claim(A, RDY(SHA.A));
      const early = [];
      for (const m of [10, 20, 29.9]) { clock.t = at(m); early.push((await lane.renew(A)).code); }
      clock.t = at(30); const r30 = await lane.renew(A);
      clock.t = at(31); const r31 = await lane.renew(A);
      const st = state(file);
      return JSON.stringify(early) === '[0,0,0]' && r30.code === 1 && r31.code === 1 && st.claim === null
        && !!st.waiters['run-A'] && st.waiters['run-A'].since === new Date(at(30)).toISOString()
        && st.history.some((h) => h.event === 'cap-released' && h.runId === 'run-A')
        && board.comments.some((c) => c.issueId === 'issue-253' && /CAP-RELEASED/.test(c.body));
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },

  // (d) a dead claimant drops out of the queue: B (ahead) dies while waiting; when
  //     the lane frees, C gets it and B is gone from the queue, with evidence.
  async founderD_deadClaimantRemoved(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, file } = await rig(mod, board);
      for (const r of ['run-A', 'run-B', 'run-C']) board.runs[r] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(1); await lane.claim(B, RDY(SHA.B));
      clock.t = at(2); await lane.claim(C, RDY(SHA.C));
      board.runs['run-B'] = 'cancelled';
      clock.t = at(10); await lane.release(A);
      clock.t = at(10.5); const c = await lane.claim(C, RDY(SHA.C));
      const st = state(file);
      return c.code === 0 && c.claim.runId === 'run-C' && !st.waiters['run-B']
        && st.history.some((h) => h.event === 'waiter-dropped-dead' && h.runId === 'run-B' && /cancelled/.test(h.evidence));
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },

  // Session waiters (never confirmable alive) leave after WAITER_STALE_MIN
  // without a claim; a live Paperclip waiter keeps its place however long.
  async staleSessionWaiterDropped(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, file } = await rig(mod, board);
      const S = { ticket: 'TEN-270', issueId: null, runId: 'session:TEN-270', kind: 'session' };
      for (const r of ['run-A', 'run-B', 'run-C']) board.runs[r] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(1); await lane.claim(S, RDY(SHA.D));
      clock.t = at(2); await lane.claim(C, RDY(SHA.C));
      clock.t = at(5); await lane.release(A);
      clock.t = at(15.9); const early = await lane.claim(C, RDY(SHA.C));   // S silent 14.9 min: still ahead
      clock.t = at(16.1); const late = await lane.claim(C, RDY(SHA.C));    // 15.1 min: dropped, C's turn
      await lane.release(C);
      // A live Paperclip waiter silent for 40 min keeps its place.
      clock.t = at(17); await lane.claim(A, RDY(SHA.A));
      clock.t = at(18); await lane.claim(B, RDY(SHA.B));
      clock.t = at(19); await lane.claim(C, RDY(SHA.C));
      clock.t = at(20); await lane.release(A);
      clock.t = at(58); const c58 = await lane.claim(C, RDY(SHA.C));
      return early.code === 3 && early.ahead[0].runId === 'session:TEN-270' && late.code === 0
        && state(file).history.some((h) => h.event === 'waiter-dropped-stale' && h.runId === 'session:TEN-270')
        && c58.code === 3 && c58.ahead[0].runId === 'run-B';
    } finally { board.close(); }
  },

  // Same ticket, new run, while the ticket was WAITING (not holding): the new run
  // inherits the ticket's wait-start only if the old run is dead AND it claims
  // within WAITER_STALE_MIN of the old run's last claim. Otherwise the back.
  // Why this is fair: the ticket's work never stopped waiting — Paperclip only
  // cycled its run — and the dead-run proof plus the window keep two live runs
  // of one ticket from holding two places, or a long-gone ticket from jumping in.
  async sameTicketWaiterInheritance(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, file } = await rig(mod, board);
      const B2 = { ...B, runId: 'run-B2' };
      const B3 = { ...B, runId: 'run-B3' };
      for (const r of ['run-A', 'run-B', 'run-B2', 'run-B3', 'run-C']) board.runs[r] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(1); await lane.claim(B, RDY(SHA.B));
      clock.t = at(3); await lane.claim(C, RDY(SHA.C));
      // old run alive → B3 joins at the back
      clock.t = at(4); const alive = await lane.claim(B3, RDY(SHA.D));
      await lane.release(B3);
      board.runs['run-B'] = 'cancelled';
      clock.t = at(6); const inh = await lane.claim(B2, RDY(SHA.D));
      clock.t = at(8); await lane.release(A);
      clock.t = at(8.1); const c = await lane.claim(C, RDY(SHA.C));
      clock.t = at(8.2); const b2 = await lane.claim(B2, RDY(SHA.D));
      // outside the window: a dead run's place is not inherited
      await lane.release(B2);
      const B5 = { ...B, runId: 'run-B5' }; board.runs['run-B5'] = 'running';
      clock.t = at(9); await lane.claim(C, RDY(SHA.C));        // C (waiting since 3) takes the lane
      clock.t = at(10); await lane.claim(B3, RDY(SHA.D));      // B3 waits from 10, then its run ends
      board.runs['run-B3'] = 'cancelled';
      clock.t = at(26); const late = await lane.claim(B5, RDY(SHA.D)); // 16 min after B3's last claim
      return alive.code === 3 && alive.position === 3
        && inh.code === 3 && inh.position === 1 && inh.since === new Date(at(1)).toISOString() && inh.inheritedFrom === 'run-B'
        && c.code === 3 && b2.code === 0
        && state(file).history.some((h) => h.event === 'waiter-inherited' && h.from === 'run-B' && h.runId === 'run-B2')
        && late.code === 3 && late.inheritedFrom === undefined && late.since === new Date(at(26)).toISOString();
    } finally { board.close(); }
  },

  // The shipped cap is NOT wired (founder number pending): with no injected
  // value, a live holder keeps the lane however long; renew never fails on time.
  async capNotWiredByDefault(mod) {
    const board = await startBoard();
    try {
      if (mod.MAX_HOLD_MIN !== null) return false;
      const { lane, clock, file } = await rig(mod, board, undefined, { noCap: true });
      for (const r of ['run-A', 'run-B']) board.runs[r] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(500);
      const r = await lane.renew(A);
      const b = await lane.claim(B, RDY(SHA.B));
      return r.code === 0 && r.minutesLeft === null && b.code === 3 && state(file).claim.expiresAt === null;
    } finally { board.close(); }
  },
});

// Each mutant cuts one mechanism out of the real source. Every anchor must
// occur exactly once, or the mutant silently mutates nothing.
const MUTANTS = [
  ['a renewal extends the hold (the TEN-261 lease)', 'holdCapAutoReleases',
    "c.renewedAt = iso(now());\n      save(s);", "c.renewedAt = iso(now()); c.takenAt = iso(now());\n      save(s);"],
  ['a repeat claim extends the hold', 'holdCapAutoReleases',
    "c.renewedAt = iso(t);\n        const from = c.sha;", "c.renewedAt = iso(t); c.takenAt = iso(t); c.expiresAt = iso(t + capMs);\n        const from = c.sha;"],
  ['no auto-release at the cap', 'holdCapAutoReleases',
    'if (!c || capMs == null || now() < Date.parse(c.takenAt) + capMs) return null;', 'if (true) return null;'],
  ['the cap is off by one (released after 30:00, not at it)', 'holdCapAutoReleases',
    'if (!c || capMs == null || now() < Date.parse(c.takenAt) + capMs) return null;', 'if (!c || capMs == null || now() <= Date.parse(c.takenAt) + capMs) return null;'],
  ['the injected cap is read as one minute longer', 'holdCapAutoReleases',
    'const capMs = maxHoldMin == null ? null : maxHoldMin * MIN;', 'const capMs = maxHoldMin == null ? null : (maxHoldMin + 1) * MIN;'],
  ['the capped holder is not re-queued', 'holdCapAutoReleases', "addWaiter(s, c, iso(now()), { requeuedAfterCap: true });", ''],
  ['a dead owner is kept until the cap', 'deadOwnerReleasedAtOnce', "if (live.state === 'dead') {", 'if (false) {'],
  ['a dead owner gets no notice', 'deadOwnerReleasedAtOnce',
    "const notice = await notify({ to: 'owner', issueId: c.issueId,\n            body: `## Deploy lane released — owner run ended", "const notice = { ok: true, id: 'x' } || await notify({ to: 'owner', issueId: c.issueId,\n            body: `## Deploy lane released — owner run ended"],
  ['the release records no evidence', 'deadOwnerReleasedAtOnce', 'evidence: live.detail, by: me.runId', 'by: me.runId'],
  ['unknown liveness is treated as dead', 'unknownIsNotDead', "if (live.state === 'dead') {", "if (live.state !== 'alive') {"],
  ['claim skips the readiness gate', 'notReadyIsRefused',
    "if (!ready.ok) return { code: EXIT.NOT_READY, action: 'not-ready', missing: ready.missing };", ''],
  ['a missing receipt is accepted', 'notReadyIsRefused',
    'if (!receipt) missing.push(', 'if (false) missing.push('],
  ['a red receipt is accepted', 'notReadyIsRefused',
    'receipt.sha !== sha || receipt.exit !== 0', 'receipt.sha !== sha'],
  ['a missing code commit is ignored', 'notReadyIsRefused',
    "const code = commits.filter((c) => !c.subject.includes('[skip ci]'));", 'const code = [];'],
  ['data-bot commits count as not rebased', 'notReadyIsRefused',
    "const code = commits.filter((c) => !c.subject.includes('[skip ci]'));", 'const code = commits;'],
  ['[skip ci] in the BODY counts as a data-bot commit', 'notReadyIsRefused',
    "const code = commits.filter((c) => !c.subject.includes('[skip ci]'));", "const code = commits.filter((c) => !c.body.includes('[skip ci]'));"],
  ['review is not required', 'notReadyIsRefused', 'if (!reviewed) missing.push(', 'if (false) missing.push('],
  ['exit 4 is back in the table', 'noPathReturnsFourOrFive',
    'export const EXIT = { HOLD: 0,', 'export const EXIT = { EXPIRED_OWNER_ALIVE: 4, HOLD: 0,'],
  ['an unknown owner returns the retired exit 4', 'noPathReturnsFourOrFive',
    "out = { code: EXIT.WAIT, action: c ? 'wait' : 'wait-turn'", "out = { code: live && live.state === 'unknown' ? 4 : EXIT.WAIT, action: c ? 'wait' : 'wait-turn'"],
  ['a failed cap notice keeps the lane held', 'noticeFailureNeverKeepsTheLane',
    "    s.claim = null;\n    addWaiter(s, c, iso(now()), { requeuedAfterCap: true });", "    if (!notice.ok) return null;\n    s.claim = null;\n    addWaiter(s, c, iso(now()), { requeuedAfterCap: true });"],
  ['a failed dead-owner notice keeps the lane held', 'noticeFailureNeverKeepsTheLane',
    "          s.claim = null;\n          freed = { claim: c, evidence: live.detail, notice };",
    "          if (!notice.ok) { save(s); return { code: EXIT.WAIT, action: 'wait', claim: c }; }\n          s.claim = null;\n          freed = { claim: c, evidence: live.detail, notice };"],
  ['a waiter never reports', 'waiterPast30Reports', 'if (!(waited > WAIT_REPORT_MIN * MIN &&', 'if (!(false &&'],
  ['the report repeats every call instead of every 30 min', 'waiterPast30Reports',
    '(!w.reportedAt || t - Date.parse(w.reportedAt) >= WAIT_REPORT_MIN * MIN)', 'true'],
  ['no mutual exclusion on the store', 'concurrentClaimsSerialise',
    'const lock = `${file}.lock`;', 'const lock = `${file}.lock.${Math.random()}`;'],
  ['a holder writes without checking it still owns the lock', 'staleLockBreakCannotDoubleTake',
    "if (!owns()) throw new Error('deploy-lane: lost the store lock; nothing written');", ''],
  ['a holder removes whatever lock is there on the way out', 'staleLockBreakCannotDoubleTake',
    '} finally { if (owns()) fs.rmSync(lock', '} finally { if (true) fs.rmSync(lock'],
  ['a new run of the same ticket renews the old claim', 'sameTicketNoSilentInheritance',
    "if (!c || c.runId !== me.runId) return { code: EXIT.REFUSED, action: capped && capped.claim.runId === me.runId ? 'cap-released' : 'not-owner', claim: c };\n      c.renewedAt",
    "if (!c || c.ticket !== me.ticket) return { code: EXIT.REFUSED, action: 'not-owner', claim: c };\n      c.renewedAt"],
  ['a re-claim keeps the old run id', 'sameTicketNoSilentInheritance',
    "s.claim.reclaimedFrom = freed.claim.runId;", "s.claim.runId = freed.claim.runId; s.claim.reclaimedFrom = freed.claim.runId;"],
  ['a re-claim keeps the old expiry', 'sameTicketNoSilentInheritance',
    "s.claim.reclaimedFrom = freed.claim.runId;", "s.claim.takenAt = freed.claim.takenAt; s.claim.expiresAt = freed.claim.expiresAt; s.claim.reclaimedFrom = freed.claim.runId;"],
  ['a same-ticket new run takes the lane while the old run is alive', 'sameTicketNoSilentInheritance',
    "live = await liveness(c);\n        if (live.state === 'dead') {", "live = await liveness(c);\n        if (live.state === 'dead' || c.ticket === me.ticket) {"],
  ['a re-claim with a new ready sha keeps the old sha', 'reclaimWithNewShaUpdatesTheClaim',
    'if (ready.sha !== from) {', 'if (false) {'],
  ['a re-claim with a new sha extends the hold', 'reclaimWithNewShaUpdatesTheClaim',
    "log(s, { event: 'claim-sha-updated'", "c.expiresAt = iso(t + MAX_HOLD_MIN * MIN); log(s, { event: 'claim-sha-updated'"],
  ['release by a non-holder leaves its entry queued', 'releaseAfterCapWithdrawsEntry',
    's.queue = s.queue.filter((e) => e.runId !== me.runId);\n      if (s.queue.length !== queued)', 'if (s.queue.length !== queued)'],
  ['batchCandidates has no overall deadline', 'batchLivenessDeadline',
    'if (Date.now() >= deadline) { keep.push(e); unchecked.add(e); continue; }', ''],
  ['entries past the deadline are batched anyway', 'batchLivenessDeadline',
    '.filter((e) => !unchecked.has(e))', ''],
  ['the liveness budget is 10 min', 'batchLivenessDeadline',
    'export const BATCH_LIVENESS_BUDGET_MS = 60000;', 'export const BATCH_LIVENESS_BUDGET_MS = 600000;'],
  ['claim lists no batch candidates', 'claimListsTheBatch',
    'const batchFor = (s, me) => s.queue.filter((e) => e.runId !== me.runId);', 'const batchFor = () => [];'],
  ['queued entries never expire', 'readyEntriesExpire',
    'if (t - Date.parse(e.readyAt) >= READY_TTL_MIN * MIN)', 'if (false)'],
  ['the ready TTL is 61 min', 'readyEntriesExpire', 'export const READY_TTL_MIN = 60;', 'export const READY_TTL_MIN = 61;'],
  ['unready withdraws nothing', 'unreadyAndReleaseWithdraw',
    "s.queue = s.queue.filter((e) => e.runId !== me.runId);\n      if (s.queue.length === before)", "if (s.queue.length === before)"],
  ['release leaves the caller\'s entry queued', 'unreadyAndReleaseWithdraw',
    "s.queue = s.queue.filter((e) => e.runId !== me.runId);\n      if (s.queue.length !== queued)", 'if (s.queue.length !== queued)'],
  ['a dead owner\'s entry is handed to the batch', 'deadOwnerEntryDropped',
    "if (live.state !== 'dead') { keep.push(e); continue; }", 'if (true) { keep.push(e); continue; }'],
  ['an unknown owner\'s entry is dropped as dead', 'deadOwnerEntryDropped',
    "if (live.state !== 'dead') { keep.push(e); continue; }", "if (live.state === 'alive') { keep.push(e); continue; }"],
  ['a landed entry is removed by run id only', 'recordBatchMatchesRunAndSha',
    's.queue = s.queue.filter((e) => !(e.runId === l.runId && e.sha === l.sha));', 's.queue = s.queue.filter((e) => e.runId !== l.runId);'],
  ['ready appends instead of replacing the run\'s entry', 'claimListsTheBatch',
    's.queue = s.queue.filter((e) => e.runId !== me.runId);\n      s.queue.push(entry);', 's.queue.push(entry);'],
  // founder 00:55Z
  ['(a) a free lane goes to whoever polls first', 'founderA_earlierWaiterWins',
    'if (!c && before.length === 0) {', 'if (!c) {'],
  ['(a) the queue is ordered newest first', 'founderA_earlierWaiterWins',
    '(Date.parse(a.since) - Date.parse(b.since))', '(Date.parse(b.since) - Date.parse(a.since))'],
  ['(a) the wait is not logged with position and minutes', 'founderA_earlierWaiterWins',
    "log(s, { event: 'waiting', ticket: me.ticket, runId: me.runId, position, waitedMin: waited,", "log(s, { event: 'waiting', ticket: me.ticket, runId: me.runId,"],
  ['(b) confirm-live does not release on exit 0', 'founderB_noLaneAfterLiveConfirmed',
    "      s.claim = null;\n      delete s.waiters[me.runId];\n      log(s, { event: 'released-live-confirmed'", "      delete s.waiters[me.runId];\n      log(s, { event: 'released-live-confirmed'"],
  ['(b) confirm-live releases on exit 1 (not live yet)', 'founderB_noLaneAfterLiveConfirmed',
    'if (r.code !== 0) {\n      return { code: EXIT.WAIT, action: \'still-holding\'', 'if (r.code === 2) {\n      return { code: EXIT.WAIT, action: \'still-holding\''],
  ['(c) renew extends the hold', 'founderC_renewalPastCapRefused',
    "c.renewedAt = iso(now());\n      save(s);", "c.renewedAt = iso(now()); c.takenAt = iso(now());\n      save(s);"],
  ['(c) the cap is measured from the last renewal', 'founderC_renewalPastCapRefused',
    'now() < Date.parse(c.takenAt) + capMs) return null;', 'now() < Date.parse(c.renewedAt) + capMs) return null;'],
  ['(c) no alert on the holder\'s ticket at the cap', 'founderC_renewalPastCapRefused',
    "const notice = await notify({ to: 'owner', issueId: c.issueId,\n      body: `## Deploy lane CAP-RELEASED", "const notice = { ok: false, error: 'x' } || await notify({ to: 'owner', issueId: c.issueId,\n      body: `## Deploy lane CAP-RELEASED"],
  ['(d) dead waiters keep their place', 'founderD_deadClaimantRemoved',
    "if (live.state === 'dead' || (stale && live.state !== 'alive')) {", "if (stale && live.state !== 'alive') {"],
  ['session waiters never go stale', 'staleSessionWaiterDropped',
    "if (live.state === 'dead' || (stale && live.state !== 'alive')) {", "if (live.state === 'dead') {"],
  ['a live Paperclip waiter goes stale too', 'staleSessionWaiterDropped',
    "if (live.state === 'dead' || (stale && live.state !== 'alive')) {", "if (live.state === 'dead' || stale) {"],
  ['the waiter stale window is 60 min', 'staleSessionWaiterDropped', 'export const WAITER_STALE_MIN = 15;', 'export const WAITER_STALE_MIN = 60;'],
  ['a new run inherits even while the old run is alive', 'sameTicketWaiterInheritance',
    "      if (live.state !== 'dead') continue;\n      delete s.waiters[old.runId];", "      delete s.waiters[old.runId];"],
  ['a new run never inherits', 'sameTicketWaiterInheritance',
    'const w = addWaiter(s, me, old.since,', 'const w = addWaiter(s, me, iso(t),'],
  ['inheritance ignores the stale window', 'sameTicketWaiterInheritance',
    "      if (t - Date.parse(old.lastSeen || old.since) > WAITER_STALE_MIN * MIN) continue;\n      const live", "      const live"],
  ['a cap is wired before the founder gave a number', 'capNotWiredByDefault', 'export const MAX_HOLD_MIN = null;', 'export const MAX_HOLD_MIN = 30;'],
];

async function loadMutant(find, replace) {
  const src = fs.readFileSync(SRC, 'utf8');
  const n = src.split(find).length - 1;
  assert.equal(n, 1, `mutant anchor must occur exactly once, found ${n}: ${find}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten261-mut-'));
  const f = path.join(dir, 'deploy-lane.mjs');
  fs.writeFileSync(f, src.replace(find, replace));
  return import(pathToFileURL(f).href);
}

const real = await import(pathToFileURL(SRC).href);

for (const [name, fn] of Object.entries(CASES)) {
  test(`real lane: ${name}`, async () => { assert.equal(await fn(real), true); });
}

for (const [label, caseName, find, replace] of MUTANTS) {
  test(`mutant bites — ${label} → ${caseName} fails`, async () => {
    const mod = await loadMutant(find, replace);
    assert.equal(await CASES[caseName](mod), false);
  });
}

// ── edges ────────────────────────────────────────────────────────────────────
test('status and release also apply the cap; renew reports minutes left and never extends', async () => {
  const board = await startBoard();
  try {
    const { lane, clock, file } = await rig(real, board);
    board.runs['run-A'] = 'running';
    await lane.claim(A, RDY(SHA.A));
    clock.t = at(12);
    const r = await lane.renew(A);
    assert.equal(r.code, 0); assert.equal(r.minutesLeft, 18); assert.equal(r.claim.expiresAt, new Date(at(30)).toISOString());
    clock.t = at(30);
    const st = await lane.status();
    assert.equal(st.action, 'free');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).claim, null, 'status cleared the capped claim in the store');
    assert.equal((await lane.release(A)).code, 1);
  } finally { board.close(); }
});

test('release frees the lane for the next claimant', async () => {
  const board = await startBoard();
  try {
    const { lane } = await rig(real, board);
    board.runs['run-A'] = 'running'; board.runs['run-B'] = 'running';
    await lane.claim(A, RDY(SHA.A));
    assert.equal((await lane.release(A)).code, 0);
    const r = await lane.claim(B, RDY(SHA.B));
    assert.equal(r.code, 0); assert.equal(r.action, 'claimed');
  } finally { board.close(); }
});

test('a receipt for another sha does not count (receipts are keyed by the exact full sha)', async () => {
  const board = await startBoard();
  try {
    const { lane } = await rig(real, board);
    const r = await lane.claim(A, RDY(sha40('9')));
    assert.equal(r.code, 7); assert.match(r.missing.join('\n'), /no receipt/);
    assert.equal((await lane.claim(A, RDY('aaaa'))).code, 7, 'a short sha is not a receipt key');
  } finally { board.close(); }
});

// ── the CLI, spawned for real against the fake board and a real git repo ─────
test('CLI: claim / ready / wait / renew / release / status with exit codes, through the real wiring', async () => {
  const board = await startBoard();
  const g = gitFixture();
  try {
    board.runs['run-A'] = 'running'; board.runs['run-B'] = 'running'; board.runs['run-C'] = 'running';
    const receipts = path.join(g.root, 'receipts');
    const base = sh(g.work, 'rev-parse', 'HEAD');
    const shaA = commit(g.work, 'a.txt', 'a\n', 'TEN-253: a');
    sh(g.work, 'reset', '-q', '--hard', base);
    const shaB = commit(g.work, 'b.txt', 'b\n', 'TEN-260: b');
    for (const s of [shaA, shaB]) writeReceipt(receipts, s);
    g.dataBot();
    // ASYNC spawn: the fake board lives in THIS process, so a spawnSync would
    // block the loop that has to answer the child's HTTP calls — a deadlock.
    const run = (args, runId, issue) => new Promise((resolve) => {
      const ch = spawn(process.execPath, [SRC, ...args], { cwd: g.work, env: { ...process.env, DEPLOY_LANE_FILE: path.join(g.root, 'lane.json'), SUITE_RECEIPTS_DIR: receipts,
        PAPERCLIP_API_URL: `${board.base}/api`, PAPERCLIP_API_KEY: 'k', PAPERCLIP_RUN_ID: runId, PAPERCLIP_TASK_ID: issue, PAPERCLIP_AGENT_ID: 'agent-x' } });
      let stdout = '';
      ch.stdout.on('data', (d) => { stdout += d; });
      ch.on('close', (status) => resolve({ status, stdout }));
    });
    assert.equal((await run(['claim', '--ticket', 'TEN-253', '--sha', shaA], 'run-A', 'issue-253')).status, 7, 'no --reviewed: not ready');
    const a = await run(['claim', '--ticket', 'TEN-253', '--sha', shaA.slice(0, 10), '--reviewed'], 'run-A', 'issue-253');
    assert.equal(a.status, 0, 'a short sha resolves to its full-sha receipt');
    assert.equal(JSON.parse(a.stdout).claim.sha, shaA);
    const w = await run(['claim', '--ticket', 'TEN-260', '--sha', shaB, '--reviewed'], 'run-B', 'issue-260');
    assert.equal(w.status, 3); assert.equal(JSON.parse(w.stdout).claim.runId, 'run-A');
    assert.equal((await run(['ready', '--ticket', 'TEN-260', '--sha', shaB, '--reviewed'], 'run-B', 'issue-260')).status, 0);
    const st = await run(['status', '--ticket', 'TEN-260'], 'run-B', 'issue-260');
    assert.equal(st.status, 0); assert.equal(JSON.parse(st.stdout).queue[0].sha, shaB);
    assert.equal((await run(['unready', '--ticket', 'TEN-260'], 'run-B', 'issue-260')).status, 0);
    assert.equal((await run(['unready', '--ticket', 'TEN-260'], 'run-B', 'issue-260')).status, 1, 'nothing left to withdraw');
    assert.equal((await run(['renew', '--ticket', 'TEN-253'], 'run-A', 'issue-253')).status, 0);
    assert.equal((await run(['release', '--ticket', 'TEN-260'], 'run-B', 'issue-260')).status, 1);
    assert.equal((await run(['release', '--ticket', 'TEN-253'], 'run-A', 'issue-253')).status, 0);
    assert.equal((await run(['claim', '--ticket', 'TEN-260', '--sha', shaB, '--reviewed'], 'run-B', 'issue-260')).status, 0);
    g.codePush();
    assert.equal((await run(['claim', '--ticket', 'TEN-262', '--sha', shaA, '--reviewed'], 'run-C', 'issue-262')).status, 7, 'a code commit ahead: not rebased');
    assert.equal((await run(['claim', '--ticket', 'TEN-260', '--reviewed'], 'run-B', 'issue-260')).status, 2, 'claim needs --sha');
    assert.equal((await run(['confirm-live', '--ticket', 'TEN-260'], 'run-B', 'issue-260')).status, 2, 'confirm-live needs --sha');
    const notHolder = await run(['confirm-live', '--ticket', 'TEN-262', '--sha', shaA], 'run-C', 'issue-262');
    assert.equal(notHolder.status, 1, 'confirm-live by a non-holder is refused before any live check');
    assert.equal((await run(['claim'], 'run-B', 'issue-260')).status, 2);
    assert.equal((await run(['claim', '--ticket', '--sha', 'x'], 'run-B', 'issue-260')).status, 2, 'a flag is not a ticket');
    assert.equal((await run(['claim', '--ticket', 'TEN-260', '--base', 'x'], 'run-B', 'issue-260')).status, 2, 'the retired --base is refused');
    fs.writeFileSync(path.join(g.root, 'lane.json'), '{ not json');
    assert.equal((await run(['release', '--ticket', 'TEN-260'], 'run-B', 'issue-260')).status, 6, 'unreadable store: error, never a hold');
  } finally { board.close(); }
});
