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
  const gh = { runs: [], jobs: {}, dispatches: [] };  // a fake GitHub REST API
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
      const wr = req.url.match(/^\/repos\/[^/]+\/[^/]+\/actions\/workflows\/pipeline\.yml\/runs\?/);
      if (req.method === 'GET' && wr) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ workflow_runs: gh.runs })); }
      const jr = req.url.match(/^\/repos\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/jobs/);
      if (req.method === 'GET' && jr) { gh.jobCalls = (gh.jobCalls || 0) + 1; res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ jobs: gh.jobs[jr[1]] || [] })); }
      const dr = req.url.match(/^\/repos\/([^/]+\/[^/]+)\/actions\/workflows\/pipeline-watchdog\.yml\/dispatches$/);
      if (req.method === 'POST' && dr) { gh.dispatches.push({ repo: dr[1], auth: req.headers.authorization, body: JSON.parse(body) }); res.writeHead(204); return res.end(); }
      res.writeHead(404); res.end('{}');
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({
    base: `http://127.0.0.1:${srv.address().port}`, runs, comments, gh,
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
// `defaults: true` uses the shipped 40 / 10; otherwise the older cases inject a 30-min cap.
// pipelineRuns / alert are fakes returning the real adapters' shapes.
async function rig(mod, board, shared, { cap = 30, noCap = false, defaults = false } = {}) {
  const dir = shared ? path.dirname(shared.file) : fs.mkdtempSync(path.join(os.tmpdir(), 'ten261-'));
  const clock = shared ? shared.clock : { t: T0 };
  const receipts = path.join(dir, 'receipts');
  for (const s of Object.values(SHA)) writeReceipt(receipts, s);
  const live = { code: 1, calls: [] };
  const pipe = { ok: true, runs: [], detail: 'GitHub runs HTTP 503', calls: 0 };
  const alerts = [];
  const alertCfg = { ok: true };
  const opts = {
    file: path.join(dir, 'lane.json'),
    now: () => clock.t,
    liveness: mod.paperclipLiveness({ apiBase: board.base, apiKey: 'k' }),
    notify: mod.paperclipNotify({ apiBase: board.base, apiKey: 'k', agentId: 'agent-x' }),
    suiteReceipt: mod.fileSuiteReceipts ? mod.fileSuiteReceipts({ dir: receipts }) : undefined,
    rebaseCheck: REBASED,
    checkLive: async (sha) => { live.calls.push(sha); return { code: live.code, output: `check-live-build exit ${live.code}` }; },
    clobberCheck: () => ({ ok: true, output: 'clear' }), // the old tool's takeover check
    pipelineRuns: async () => { pipe.calls++; return pipe.ok ? { ok: true, runs: pipe.runs } : { ok: false, detail: pipe.detail }; },
    alert: async (a) => { alerts.push(a); return alertCfg.ok ? { ok: true } : { ok: false, error: 'dispatch HTTP 500' }; },
  };
  if (!noCap && !defaults) opts.maxHoldMin = cap;
  const lane = mod.createLane(opts);
  return { lane, clock, live, pipe, alerts, alertCfg, opts, file: path.join(dir, 'lane.json') };
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
  commit(work, 'matches.json', '{}\n', 'seed data');
  sh(work, 'push', '-q', 'origin', 'main');
  sh(root, 'clone', '-q', origin, bot);
  // The bot commits as a real data bot (the allowlist keys on the author email).
  sh(bot, 'config', 'user.name', 'bsp-odds-bot'); sh(bot, 'config', 'user.email', 'bsp-odds-bot@users.noreply.github.com');
  let n = 0;
  const onOrigin = (file, msg, email) => {
    sh(bot, 'pull', '-q', '--rebase', 'origin', 'main');
    if (email) sh(bot, 'config', 'user.email', email);
    commit(bot, file, `${msg} ${++n}\n`, msg);
    if (email) sh(bot, 'config', 'user.email', 'bsp-odds-bot@users.noreply.github.com');
    sh(bot, 'push', '-q', 'origin', 'HEAD:main');
  };
  return { root, origin, work, bot, dataBot: () => onOrigin('matches.json', 'data refresh [skip ci]'),
    codePush: (f = 'other.txt') => onOrigin(f, 'TEN-999: a code change\n\nIts body mentions [skip ci]; it is still code.'),
    skipCiByHuman: () => onOrigin('odds-fixture-map.json', 'TEN-998: a change titled [skip ci] by a human', 'dev@example.com'),
    // An AGENT committing code under a data-bot identity with [skip ci] (TEN-232 did).
    botCodeSkipCi: () => onOrigin('lib.js', 'TEN-997: agent code under the bot identity [skip ci]', 'bsp-bot@users.noreply.github.com'),
    botDataSkipCi: () => onOrigin('odds-card-state.json', 'chore(odds): publish odds_card_state projection [skip ci]', 'bsp-bot@users.noreply.github.com') };
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
        && !!notice && /release --ticket TEN-253/.test(notice.body)
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
  // were ahead: C (since 0:30) and D (since 0:42) are ahead of B (since 1). Every
  // waiter polls at least every 15 min, or it drops out of the queue.
  async waiterPast30Reports(mod) {
    const board = await startBoard();
    try {
      const { lane, clock } = await rig(mod, board);
      for (const r of ['run-A', 'run-B', 'run-C', 'run-D']) board.runs[r] = 'running';
      await lane.claim(A, RDY(SHA.A));
      const who = { B: [B, SHA.B], C: [C, SHA.C], D: [D, SHA.D] };
      const rep = () => board.comments.filter((c) => c.issueId === 'issue-260' && /has waited/.test(c.body));
      // [minute, claimant, expected exit, expected report count after a B poll]
      const steps = [[0.5, 'C', 3], [0.7, 'D', 3], [1, 'B', 3, 0], [10, 'C', 3], [10, 'D', 3], [15, 'B', 3, 0],
        [20, 'C', 3], [20, 'D', 3], [29, 'B', 3, 0], [30, 'C', 0], [30.5, 'D', 3], [32, 'B', 3, 1], [40, 'B', 3, 1],
        [45, 'D', 3], [50, 'B', 3, 1], [55, 'D', 3], [60, 'D', 0], [63, 'B', 3, 2]];
      for (const [m, k, code, want] of steps) {
        clock.t = at(m);
        const r = await lane.claim(who[k][0], RDY(who[k][1]));
        if (r.code !== code) return false;
        if (want !== undefined && rep().length !== want) return false;
      }
      const body = rep()[0].body;
      return /TEN-262/.test(body) && /run-C/.test(body) && /taken 2026-09-23T08:30:00/.test(body) && /alive/.test(body)
        && /has waited 31 min \(position 2\)/.test(body);
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },

  // Two claimants race for a dead owner's lane: exactly one gets it, one notice.
  // And the store lock itself: two slow read-modify-writes both land.
  async concurrentClaimsSerialise(mod) {
    const dir0 = fs.mkdtempSync(path.join(os.tmpdir(), 'ten261-mx-'));
    const f0 = path.join(dir0, 'lane.json');
    const { withLock, readState } = mod._internals;
    const bump = () => withLock(f0, async (save) => { const s = readState(f0); const n = (s.n || 0) + 1; await new Promise((r) => setTimeout(r, 80)); s.n = n; save(s); });
    await Promise.all([bump(), bump()]);
    if (JSON.parse(fs.readFileSync(f0, 'utf8')).n !== 2) return false;
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
  // must not remove the lock the new holder now owns. (Nothing inside the lock
  // touches the network any more, so the slow holder is simulated directly.)
  async staleLockBreakCannotDoubleTake(mod) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten261-lock-'));
    const file = path.join(dir, 'lane.json');
    const lock = `${file}.lock`;
    const { withLock, readState } = mod._internals;
    let bEnteredResolve; const bEntered = new Promise((r) => { bEnteredResolve = r; });
    const pb = withLock(file, async (save) => {
      bEnteredResolve();
      await new Promise((r) => setTimeout(r, 300));          // B is slow…
      const s = readState(file); s.claim = { runId: 'run-B' }; save(s);
    }).then((r) => ({ r }), (e) => ({ e }));
    await bEntered;
    const old = new Date(Date.now() - 10 * MIN);
    fs.utimesSync(lock, old, old);                              // …so its lock looks abandoned
    const pc = withLock(file, async (save) => {
      const s = readState(file); s.claim = { runId: 'run-C' }; save(s);
      await new Promise((r) => setTimeout(r, 400));           // C holds the lock while B resumes
    }).then((r) => ({ r }), (e) => ({ e }));
    const rb = await pb;
    const cLockSurvived = fs.existsSync(lock);
    await pc;
    const holder = JSON.parse(fs.readFileSync(file, 'utf8')).claim.runId;
    return !!rb.e && /lost the store lock/.test(rb.e.message) && cLockSurvived && holder === 'run-C';
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

  // Every waiter that has not claimed for WAITER_STALE_MIN leaves the queue —
  // a session waiter, and a LIVE Paperclip waiter too: a claimant that stopped
  // claiming is no longer a live claimant.
  async staleWaitersDropped(mod) {
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
      // A LIVE Paperclip waiter that stops claiming drops out as well.
      clock.t = at(17); await lane.claim(A, RDY(SHA.A));
      clock.t = at(18); await lane.claim(B, RDY(SHA.B));
      clock.t = at(19); await lane.claim(C, RDY(SHA.C));
      clock.t = at(20); await lane.release(A);
      clock.t = at(30); const c30 = await lane.claim(C, RDY(SHA.C));      // B silent 12 min: still ahead
      clock.t = at(33.5); const c33 = await lane.claim(C, RDY(SHA.C));    // B silent 15.5 min, board says alive: dropped
      const h = state(file).history;
      return early.code === 3 && early.ahead[0].runId === 'session:TEN-270' && late.code === 0
        && h.some((x) => x.event === 'waiter-dropped-stale' && x.runId === 'session:TEN-270')
        && c30.code === 3 && c30.ahead[0].runId === 'run-B'
        && c33.code === 0 && h.some((x) => x.event === 'waiter-dropped-stale' && x.runId === 'run-B');
    } finally { board.close(); }
  },

  // A waiter that is re-preparing (its claims return 7: not ready) is still
  // claiming: it keeps its place, and each not-ready claim reports and logs its
  // position. It is not dropped as silent.
  async notReadyWaiterKeepsPlace(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, file } = await rig(mod, board);
      for (const r of ['run-A', 'run-B', 'run-C']) board.runs[r] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(1); await lane.claim(B, RDY(SHA.B));
      clock.t = at(2); await lane.claim(C, RDY(SHA.C));
      const unready = sha40('7'); // no receipt: not ready
      clock.t = at(12); const n1 = await lane.claim(B, RDY(unready));
      clock.t = at(24); const n2 = await lane.claim(B, RDY(unready));
      clock.t = at(25); await lane.release(A);
      clock.t = at(26); const c = await lane.claim(C, RDY(SHA.C));
      clock.t = at(27); const b = await lane.claim(B, RDY(SHA.B));
      return n1.code === 7 && n1.position === 1 && n1.waitedMin === 11 && n2.code === 7 && n2.position === 1
        && state(file).history.some((h) => h.event === 'waiting-not-ready' && h.runId === 'run-B' && h.position === 1 && h.waitedMin === 23)
        && c.code === 3 && c.ahead[0].runId === 'run-B' && b.code === 0;
    } finally { board.close(); }
  },

  // A waiter whose commit was batched in by the holder leaves the waiter queue:
  // it has nothing left to push, and must not block the head.
  async batchedWaiterLeavesQueue(mod) {
    const board = await startBoard();
    try {
      const { lane, clock } = await rig(mod, board);
      for (const r of ['run-A', 'run-B', 'run-C']) board.runs[r] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(1); await lane.claim(B, RDY(SHA.B)); await lane.ready(B, RDY(SHA.B));
      clock.t = at(2); await lane.claim(C, RDY(SHA.C));
      await lane.recordBatch(A, { landed: [{ ticket: B.ticket, runId: 'run-B', sha: SHA.B, landedAs: SHA.D }] });
      clock.t = at(3); await lane.release(A);
      clock.t = at(4); const c = await lane.claim(C, RDY(SHA.C));
      return !lane.peek().waiters['run-B'] && c.code === 0;
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

  // The founder's numbers, one constant each (2026-09-25 02:05Z).
  async capRuleConstants(mod) {
    return mod.MAX_HOLD_MIN === 40 && mod.PIPELINE_QUEUED_MAX_MIN === 10 && mod.WAITER_STALE_MIN === 15;
  },
});

// ── founder cap ruling 2026-09-25 02:05Z ──────────────────────────────────────
// "Cap: 40 minutes from claim to live-confirm. Auto-extend while the owner's
// pipeline run is actively running (in progress, not queued). A healthy deploy is
// never cut off. Release immediately if: the owner run is dead; its pipeline run
// has sat queued for more than 10 minutes; 40 minutes pass with no run in
// progress. A forced release posts a message naming the reason, in the same
// channel as the freshness alarm." These run with the SHIPPED 40 / 10.
const run = (id, status, createdMin, startedMin, { conclusion = null, completedMin = null } = {}) => ({ id, status, conclusion,
  createdAt: new Date(at(createdMin)).toISOString(), startedAt: startedMin == null ? null : new Date(at(startedMin)).toISOString(),
  completedAt: completedMin == null ? null : new Date(at(completedMin)).toISOString(), url: `https://github.com/x/actions/runs/${id}` });
Object.assign(CASES, {
  // A healthy deploy: pushed at 5, its pipeline run in progress since 6 — still
  // held at minute 45 (past 40). A run that started BEFORE the push is not the
  // owner's and extends nothing.
  async capRule_healthyDeployKeptAt45(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, pipe, file } = await rig(mod, board, undefined, { defaults: true });
      for (const r of ['run-A', 'run-B']) board.runs[r] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(5); await lane.recordPush(A, { readBack: SHA.A, pushedHead: SHA.A });
      pipe.runs = [run(11, 'in_progress', 4, 6)];
      clock.t = at(45);
      const r = await lane.renew(A);
      const b = await lane.claim(B, RDY(SHA.B));
      const kept = state(file).claim && state(file).claim.runId === 'run-A';
      // A fresh claim whose only in-progress run started BEFORE its push: not its run.
      const x = await rig(mod, board, undefined, { defaults: true });
      await x.lane.claim(A, RDY(SHA.A));
      x.clock.t = at(5); await x.lane.recordPush(A, { readBack: SHA.A, pushedHead: SHA.A });
      x.pipe.runs = [run(10, 'in_progress', 3, 4)];
      x.clock.t = at(45); const r2 = await x.lane.renew(A);
      return r.code === 0 && r.pipeline.state === 'owner-run-in-progress' && b.code === 3 && kept
        && r2.code === 1 && r2.reason === 'cap-40min-no-run';
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },

  // The owner's run sits queued: at 9.9 min still held; past 10 min released,
  // reason pipeline-queued-10min — long before the 40-min cap.
  async capRule_queuedPast10Releases(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, pipe, file } = await rig(mod, board, undefined, { defaults: true });
      for (const r of ['run-A', 'run-B']) board.runs[r] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(1); await lane.recordPush(A, { readBack: SHA.A, pushedHead: SHA.A });
      pipe.runs = [run(12, 'queued', 1.5)];
      clock.t = at(11.4); const r = await lane.renew(A);
      clock.t = at(12.6); const b = await lane.claim(B, RDY(SHA.B));
      const h = state(file).history.find((x) => x.event === 'cap-released' && x.runId === 'run-A');
      return r.code === 0 && b.code === 0 && b.forcedRelease.reason === 'pipeline-queued-10min'
        && !!h && h.reason === 'pipeline-queued-10min' && /queued 11\.1 min/.test(h.evidence);
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },

  // 40 minutes with no pipeline run in progress: released, reason cap-40min-no-run.
  async capRule_fortyMinutesNoRun(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, file } = await rig(mod, board, undefined, { defaults: true });
      board.runs['run-A'] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(39.99); const r1 = await lane.renew(A);
      clock.t = at(40); const r2 = await lane.renew(A);
      const h = state(file).history.find((x) => x.event === 'cap-released');
      return r1.code === 0 && r2.code === 1 && r2.reason === 'cap-40min-no-run' && !!h && h.reason === 'cap-40min-no-run' && h.requeued === true;
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },

  // A dead owner is released immediately — by any of claim/status/renew/confirm-live,
  // here a plain `status` at minute 1.
  async capRule_deadOwnerReleasedImmediately(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, file, alerts } = await rig(mod, board, undefined, { defaults: true });
      board.runs['run-A'] = 'running';
      await lane.claim(A, RDY(SHA.A));
      board.runs['run-A'] = 'cancelled';
      clock.t = at(1); const st = await lane.status();
      const h = state(file).history.find((x) => x.event === 'released-dead-owner');
      return st.action === 'free' && !!h && h.reason === 'owner-dead' && /cancelled/.test(h.evidence)
        && alerts.length === 1 && alerts[0].reason === 'owner-dead';
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },

  // A forced release reaches the freshness alarm's channel with the reason text;
  // a failed dispatch is logged and never keeps the lane held.
  async capRule_forcedReleaseAlerts(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, file, alerts, alertCfg } = await rig(mod, board, undefined, { defaults: true });
      board.runs['run-A'] = 'running'; board.runs['run-B'] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(40); await lane.status();
      const first = alerts[0];
      alertCfg.ok = false;
      clock.t = at(41); await lane.release(A); await lane.claim(B, RDY(SHA.B));
      clock.t = at(81); const st = await lane.status();
      const h = state(file).history.filter((x) => x.event === 'forced-release-delivery');
      return !!first && first.reason === 'cap-40min-no-run' && /cap-40min-no-run/.test(first.message)
        && /TEN-253/.test(first.message) && /run-A/.test(first.message)
        && alerts.length === 2 && alerts[1].reason === 'cap-40min-no-run' && st.action === 'free'
        && h.length === 2 && h[0].alert === 'dispatched' && /^failed: dispatch HTTP 500/.test(h[1].alert);
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },

  // GitHub unreachable = unknown: it NEVER extends. Pushed, run state unknown →
  // held at 39.99, released at 40 like any run-less hold, and the log says why.
  async capRule_githubUnreachableNeverExtends(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, pipe, file } = await rig(mod, board, undefined, { defaults: true });
      board.runs['run-A'] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(2); await lane.recordPush(A, { readBack: SHA.A, pushedHead: SHA.A });
      pipe.ok = false;
      clock.t = at(39.99); const r1 = await lane.renew(A);
      clock.t = at(40); const r2 = await lane.renew(A);
      const h = state(file).history.find((x) => x.event === 'cap-released');
      return r1.code === 0 && r1.pipeline.state === 'unknown' && r2.code === 1 && r2.reason === 'cap-40min-no-run'
        && !!h && /unknown never extends/.test(h.evidence);
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },

  // confirm-live checks the sha: only the claimed sha, or the read-back sha
  // deploy-batch recorded for this holder.
  async confirmLiveChecksTheSha(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, live } = await rig(mod, board);
      board.runs['run-A'] = 'running';
      await lane.claim(A, RDY(SHA.A));
      live.code = 0;
      clock.t = at(2); const wrong = await lane.confirmLive(A, { sha: SHA.B });
      const notChecked = live.calls.length === 0;
      await lane.recordPush(A, { readBack: SHA.C, pushedHead: SHA.C });
      clock.t = at(3); const ok = await lane.confirmLive(A, { sha: SHA.C });
      return wrong.code === 1 && wrong.action === 'wrong-sha' && notChecked && ok.code === 0 && ok.action === 'released-live-confirmed';
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },

  // A claim written by the old TEN-261 tool (no version marker, a lease
  // expiresAt) at cutover: shown as a legacy lease, never as a hold cap; its
  // expiry is honoured ONCE (an old tool renewing it later does not move it),
  // then it is freed.
  async legacyClaimHonouredOnce(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, file } = await rig(mod, board);
      const L = { ticket: 'TEN-250', issueId: 'issue-250', runId: 'run-L', kind: 'paperclip' };
      for (const r of ['run-L', 'run-B']) board.runs[r] = 'running';
      fs.writeFileSync(file, JSON.stringify({ version: 1, waiters: {}, history: [], claim: { ...L, takenAt: new Date(T0).toISOString(),
        renewedAt: new Date(T0).toISOString(), expiresAt: new Date(at(45)).toISOString(), expiredReportedAt: null } }));
      clock.t = at(10);
      const st = await lane.status();
      const b10 = await lane.claim(B, RDY(SHA.B));
      const cur = state(file);
      cur.claim.expiresAt = new Date(at(90)).toISOString(); // an old tool renews it
      fs.writeFileSync(file, JSON.stringify(cur));
      clock.t = at(44.9); const b44 = await lane.claim(B, RDY(SHA.B));
      clock.t = at(45); const b45 = await lane.claim(B, RDY(SHA.B));
      return st.action === 'held' && st.legacy === true && /legacy TEN-261 lease/.test(st.holder) && !/cap at/.test(st.holder)
        && b10.code === 3 && /honoured once until 2026-09-23T08:45/.test(b10.holder) && !/cap at/.test(b10.holder)
        && b44.code === 3 && b45.code === 0 && b45.forcedRelease.reason === 'legacy-lease-expired';
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },
});

// ── review of c003eb8f ────────────────────────────────────────────────────────
Object.assign(CASES, {
  // 1a · confirm-live checks the SITE first: live → released-live-confirmed,
  //      even when the hold rules would force a release at that moment (here:
  //      GitHub unreachable at minute 47, past 40). No false alarm.
  async confirmLiveChecksTheSiteFirst(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, pipe, live, alerts, file } = await rig(mod, board, undefined, { defaults: true });
      board.runs['run-A'] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(20); await lane.recordPush(A, { readBack: SHA.A, pushedHead: SHA.A });
      pipe.runs = [run(1, 'in_progress', 20.5, 21)];
      clock.t = at(45); const held = await lane.renew(A);
      pipe.ok = false; live.code = 0;
      clock.t = at(51); const r = await lane.confirmLive(A, { sha: SHA.A }); // last known state 6 min old: the hold rules would release
      const h = state(file).history;
      return held.code === 0 && r.code === 0 && r.action === 'released-live-confirmed' && alerts.length === 0
        && !h.some((x) => x.event === 'cap-released') && h.some((x) => x.event === 'released-live-confirmed');
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },

  // 1b · read-back grace: after the owner's run completes SUCCESSFULLY the hold
  //      stays READBACK_GRACE_MIN (12); a failed owner run gets none.
  async readBackGraceAfterASuccessfulRun(mod) {
    const board = await startBoard();
    try {
      const ok = await rig(mod, board, undefined, { defaults: true });
      board.runs['run-A'] = 'running';
      await ok.lane.claim(A, RDY(SHA.A));
      ok.clock.t = at(5); await ok.lane.recordPush(A, { readBack: SHA.A, pushedHead: SHA.A });
      ok.pipe.runs = [run(1, 'completed', 5.5, 6, { conclusion: 'success', completedMin: 38 })];
      ok.clock.t = at(49.9); const g1 = await ok.lane.renew(A);
      ok.clock.t = at(50); const g2 = await ok.lane.renew(A);
      const bad = await rig(mod, board, undefined, { defaults: true });
      await bad.lane.claim(A, RDY(SHA.A));
      bad.clock.t = at(5); await bad.lane.recordPush(A, { readBack: SHA.A, pushedHead: SHA.A });
      bad.pipe.runs = [run(1, 'completed', 5.5, 6, { conclusion: 'failure', completedMin: 38 })];
      bad.clock.t = at(40); const f1 = await bad.lane.renew(A);
      return g1.code === 0 && g1.pipeline.state === 'read-back-grace' && g2.code === 1 && g2.reason === 'cap-40min-no-run'
        && f1.code === 1 && f1.reason === 'cap-40min-no-run';
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },

  // 2 · only the FIRST run after the push is the owner's; it is recorded on the
  //     claim, and a later tick in progress at 60 extends nothing.
  async laterTickDoesNotExtend(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, pipe, file } = await rig(mod, board, undefined, { defaults: true });
      board.runs['run-A'] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(5); await lane.recordPush(A, { readBack: SHA.A, pushedHead: SHA.A });
      pipe.runs = [run(1, 'in_progress', 5.5, 6)];
      clock.t = at(10); await lane.renew(A);
      const recorded = !!state(file).claim.ownerRun && state(file).claim.ownerRun.id === 1;
      pipe.runs = [run(2, 'in_progress', 55, 56), run(1, 'completed', 5.5, 6, { conclusion: 'success', completedMin: 20 })];
      clock.t = at(60); const r = await lane.renew(A);
      return recorded && r.code === 1 && r.reason === 'cap-40min-no-run';
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },

  // 3 · a forced-out holder whose push is out is NOT re-queued (it has nothing to
  //     wait for), and its notice says so; an unpushed one is.
  async pushedHolderIsNotRequeued(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, file } = await rig(mod, board, undefined, { defaults: true });
      board.runs['run-A'] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(5); await lane.recordPush(A, { readBack: SHA.A, pushedHead: SHA.A });
      clock.t = at(40); await lane.status();
      const st = state(file);
      const notice = board.comments.find((c) => c.issueId === 'issue-253' && /CAP-RELEASED/.test(c.body));
      return st.claim === null && !st.waiters['run-A'] && st.history.some((h) => h.event === 'cap-released' && h.requeued === false)
        && !!notice && /NOT re-queued/.test(notice.body) && notice.body.includes(`check-live-build.sh ${SHA.A}`);
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },

  // 4 · [pending the founder] healthy queueing: the owner's run pending behind a
  //     tick that started BEFORE the push is "moving" — no release, and it counts
  //     as in progress for the 40-min clause; its 10-min clock starts only when
  //     nothing is in progress. With the flag off, the literal rule releases.
  async healthyQueueingIsNotStuck(mod) {
    const board = await startBoard();
    try {
      board.runs['run-A'] = 'running';
      const setup = async (lane, rigx) => {
        await lane.claim(A, RDY(SHA.A));
        rigx.clock.t = at(1); await lane.recordPush(A, { readBack: SHA.A, pushedHead: SHA.A });
      };
      // the owner's run (2) pending behind tick 1, which started before the push
      const on = await rig(mod, board, undefined, { defaults: true });
      await setup(on.lane, on);
      on.pipe.runs = [run(2, 'queued', 2), run(1, 'in_progress', -2, -1)];
      on.clock.t = at(13); const h13 = await on.lane.renew(A);            // queued 11 min, but tick 1 is moving
      on.pipe.runs = [run(2, 'queued', 2), run(1, 'completed', -2, -1, { conclusion: 'success', completedMin: 20.5 })];
      on.clock.t = at(30); const h30 = await on.lane.renew(A);            // clock from 20.5: 9.5 min
      on.clock.t = at(31); const r31 = await on.lane.renew(A);            // 10.5 min with nothing ahead
      // "counts as in progress for the 40-min clause": tick 1 still running at 41
      const on2 = await rig(mod, board, undefined, { defaults: true });
      await setup(on2.lane, on2);
      on2.pipe.runs = [run(2, 'queued', 2), run(1, 'in_progress', -2, -1)];
      on2.clock.t = at(41); const h41 = await on2.lane.renew(A);
      // the ruling's literal text (flag off): 11 min queued → released
      const off = await rig(mod, board, undefined, { defaults: true });
      const lit = mod.createLane({ ...off.opts, healthyQueue: false });
      await setup(lit, off);
      off.pipe.runs = [run(2, 'queued', 2), run(1, 'in_progress', -2, -1)];
      off.clock.t = at(13); const l13 = await lit.renew(A);
      return h13.code === 0 && h13.pipeline.state === 'queued-behind-a-running-tick' && h30.code === 0
        && r31.code === 1 && r31.reason === 'pipeline-queued-10min' && h41.code === 0
        && l13.code === 1 && l13.reason === 'pipeline-queued-10min';
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },

  // 5 · a commit is data only if its SUBJECT carries [skip ci] AND a data-bot wrote
  //     it. A human's commit titled "[skip ci]" is code: not rebased. REAL git.
  async skipCiByANonBotIsCode(mod) {
    const board = await startBoard();
    const g = gitFixture();
    try {
      const receipts = path.join(g.root, 'receipts');
      const lane = mod.createLane({ file: path.join(g.root, 'lane.json'), now: () => T0,
        liveness: mod.paperclipLiveness({ apiBase: board.base, apiKey: 'k' }),
        notify: mod.paperclipNotify({ apiBase: board.base, apiKey: 'k', agentId: 'agent-x' }),
        suiteReceipt: mod.fileSuiteReceipts({ dir: receipts }), rebaseCheck: mod.gitRebaseCheck({ cwd: g.work }) });
      board.runs['run-A'] = 'running';
      const s1 = commit(g.work, 'app.txt', 'v2\n', 'TEN-253: the change');
      writeReceipt(receipts, s1, 0);
      g.dataBot();
      const withData = mod.gitRebaseCheck({ cwd: g.work })(s1);
      g.skipCiByHuman();
      const r = await lane.claim(A, RDY(s1));
      return withData.ok === true && r.code === 7 && /rebased: 1 code commit.*TEN-998/.test(r.missing.join(' '));
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },

  // 6 · lock time: nothing inside the store lock touches the network. With the
  //     board answering every call after 300 ms, a forced release (liveness,
  //     pipeline runs, notice, alarm) never holds the lock for 150 ms.
  async noNetworkInsideTheLock(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, file } = await rig(mod, board, undefined, { defaults: true });
      board.runs['run-A'] = 'running';
      await lane.claim(A, RDY(SHA.A));
      board.setDelay(300);
      clock.t = at(40);
      const lock = `${file}.lock`;
      let longest = 0; let since = null; let done = false;
      const watch = (async () => { while (!done) { const t = Date.now(); if (fs.existsSync(lock)) { since ??= t; longest = Math.max(longest, t - since); } else since = null; await new Promise((r) => setImmediate(r)); } })();
      const r = await lane.status();
      done = true; await watch;
      board.setDelay(0);
      return r.action === 'free' && board.comments.some((c) => /CAP-RELEASED/.test(c.body)) && longest < 150;
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },
});

// ── review of d096a3c3 ────────────────────────────────────────────────────────
const isoAt = (m) => new Date(at(m)).toISOString();
Object.assign(CASES, {
  // B1 · the reproduced timeline, through the REAL GitHub adapter (fake API):
  //      push 20; run 101 created 22, cancelled while queued at 32 (no jobs; live
  //      GitHub still sets run_started_at = created_at); run 102 in progress since
  //      34. At 41 the hold is kept — 102 is the owner's run, 101 never was.
  async cancelledQueuedRunIsNotTheOwner(mod) {
    const board = await startBoard();
    try {
      const x = await rig(mod, board, undefined, { defaults: true });
      const lane = mod.createLane({ ...x.opts, pipelineRuns: mod.githubPipelineRuns({ repo: 'o/r', token: 't', apiBase: board.base }) });
      board.runs['run-A'] = 'running'; board.runs['run-B'] = 'running';
      await lane.claim(A, RDY(SHA.A));
      x.clock.t = at(20); await lane.recordPush(A, { readBack: SHA.A, pushedHead: SHA.A });
      board.gh.runs = [
        { id: 102, status: 'in_progress', conclusion: null, created_at: isoAt(33), run_started_at: isoAt(33), updated_at: isoAt(34), html_url: 'u102' },
        { id: 101, status: 'completed', conclusion: 'cancelled', created_at: isoAt(22), run_started_at: isoAt(22), updated_at: isoAt(32), html_url: 'u101' },
      ];
      board.gh.jobs['102'] = [{ started_at: isoAt(34) }];
      x.clock.t = at(41); const r = await lane.renew(A);
      const b = await lane.claim(B, RDY(SHA.B));
      const c = lane.peek().claim;
      return r.code === 0 && r.pipeline.state === 'owner-run-in-progress' && b.code === 3 && !!c && c.ownerRun && c.ownerRun.id === 102;
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },

  // B2 · an agent's CODE commit under a data-bot identity with [skip ci] in the
  //      title is code: every file must be a data path. A real data-bot commit
  //      by the same identity is data. REAL git.
  async botIdentityCodeIsCode(mod) {
    const g = gitFixture();
    try {
      const s1 = commit(g.work, 'app.txt', 'v2\n', 'TEN-253: the change');
      g.botDataSkipCi();
      const data = mod.gitRebaseCheck({ cwd: g.work })(s1);
      g.botCodeSkipCi();
      const code = mod.gitRebaseCheck({ cwd: g.work })(s1);
      return data.ok === true && code.ok === false && code.codeCommits.length === 1 && /TEN-997/.test(code.codeCommits[0].subject)
        && !mod.isDataPath('lib.js') && !mod.isDataPath('package.json') && !mod.isDataPath('.github/workflows/x.yml')
        && mod.isDataPath('odds-card-state.json') && mod.isDataPath('style-meetings/a.json');
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; }
  },

  // M1 · one failed GitHub read at 41, with the owner's run seen in progress at
  //      38, keeps the hold (last known ≤ 5 min old); a failure with the last
  //      known state older than 5 min is unknown → the plain cap.
  async oneGithubFailureReusesTheLastKnownState(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, pipe } = await rig(mod, board, undefined, { defaults: true });
      board.runs['run-A'] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(30); await lane.recordPush(A, { readBack: SHA.A, pushedHead: SHA.A });
      pipe.runs = [run(1, 'in_progress', 30.5, 31)];
      clock.t = at(38); const r38 = await lane.renew(A);
      pipe.ok = false;
      clock.t = at(41); const r41 = await lane.renew(A);
      clock.t = at(44); const r44 = await lane.renew(A);
      return r38.code === 0 && r41.code === 0 && r41.pipeline.state === 'owner-run-in-progress' && !!r41.pipeline.lastKnownAt
        && r44.code === 1 && r44.reason === 'cap-40min-no-run';
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },

  // L3 · after the push, a NEW sha does not ride the same hold: refused until
  //      confirm-live releases the lane, then the new sha re-queues at the back.
  async newShaAfterThePushReQueues(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, live } = await rig(mod, board);
      for (const r of ['run-A', 'run-B']) board.runs[r] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(5); await lane.recordPush(A, { readBack: SHA.A, pushedHead: SHA.A });
      clock.t = at(6); const refused = await lane.claim(A, RDY(SHA.A2));
      const kept = lane.peek().claim.sha === SHA.A;
      clock.t = at(7); await lane.claim(B, RDY(SHA.B));
      live.code = 0;
      clock.t = at(8); await lane.confirmLive(A, { sha: SHA.A });
      clock.t = at(9); const again = await lane.claim(A, RDY(SHA.A2));
      return refused.code === 1 && refused.action === 'pushed-confirm-first' && kept && again.code === 3 && again.position === 2;
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },
});

// ── review of 1198c07c ────────────────────────────────────────────────────────
Object.assign(CASES, {
  // Saved GitHub state only ever HOLDS the lane. Push 20, the owner's run queued
  // since 21 with nothing running, a good read at 30, one 502 at 32: the queued
  // rule must not fire on the saved state (it would say 11 min) — held; the
  // plain 40-min cap still applies (released at 40 on the unknown path).
  async savedStateNeverForcesARelease(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, pipe, alerts } = await rig(mod, board, undefined, { defaults: true });
      board.runs['run-A'] = 'running';
      await lane.claim(A, RDY(SHA.A));
      clock.t = at(20); await lane.recordPush(A, { readBack: SHA.A, pushedHead: SHA.A });
      pipe.runs = [run(1, 'queued', 21)];
      clock.t = at(30); const r30 = await lane.renew(A);
      pipe.ok = false;
      clock.t = at(32); const r32 = await lane.renew(A);
      clock.t = at(40); const r40 = await lane.renew(A);
      return r30.code === 0 && r32.code === 0 && alerts.length === 1 && r40.code === 1 && r40.reason === 'cap-40min-no-run';
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { board.close(); }
  },

  // The data paths are exactly what the data bots `git add` — not any root .json.
  // Hand-curated files the code reads are not data, even from a bot identity;
  // splits-matches/ (refresh-career-splits.sh) and the atp-entry bot are.
  async dataPathsAreWhatTheBotsWrite(mod) {
    const d = (subject, authorEmail, files) => mod.isDataCommit({ subject, authorEmail, files });
    const S = 'chore: refresh [skip ci]';
    return d(S, 'bot@bspconsult.local', ['career-splits.json', 'splits-matches-index.json', 'splits-matches/12345.json'])
      && d(S, 'bsp-atp-entry-bot@users.noreply.github.com', ['atp-entry-harvest-state.json', 'atp-entry-harvest-queue.json'])
      && d(S, 'bsp-radar-bot@users.noreply.github.com', ['radar-calibration.json', 'style-radar.json'])
      && d(S, 'bsp-odds-bot@users.noreply.github.com', ['matches.json', 'underway-audit.jsonl', 'alert-state.json'])
      && !d(S, 'bsp-bot@users.noreply.github.com', ['court-speed-map.json'])
      && !d(S, 'bsp-odds-bot@users.noreply.github.com', ['matches.json', 'tournament-surfaces.json'])
      && !d(S, 'bot@bspconsult.local', ['player-atp-aliases.json'])
      && !d(S, 'bsp-bot@users.noreply.github.com', ['ten232-kibl-probe.json'])
      && !d(S, 'bsp-bot@users.noreply.github.com', ['tsconfig.json'])
      && !d(S, 'bsp-bot@users.noreply.github.com', ['bet365-history/x.js'])
      && !d(S, 'bsp-bot@users.noreply.github.com', ['bet365-history/NOTES.md']);
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
    'if (elapsed >= capMs) {', 'if (false) {'],
  ['the cap is off by one (released after 30:00, not at it)', 'holdCapAutoReleases',
    'if (elapsed >= capMs) {', 'if (elapsed > capMs) {'],
  ['the injected cap is read as one minute longer', 'holdCapAutoReleases',
    'const capMs = maxHoldMin == null ? null : maxHoldMin * MIN;', 'const capMs = maxHoldMin == null ? null : (maxHoldMin + 1) * MIN;'],
  ['the capped holder is not re-queued', 'holdCapAutoReleases', "if (requeue) addWaiter(s, c, iso(now()), { requeuedAfterCap: true, requeueReason: reason });", ''],
  ['a dead owner is kept until the cap', 'deadOwnerReleasedAtOnce', "if (live && live.state === 'dead') return { forced: forced(s, c, 'owner-dead', live.detail, fx), live };", ''],
  ['a dead owner gets no notice', 'deadOwnerReleasedAtOnce',
    "const notice = await notify({ to: 'owner', issueId: c.issueId, body });", "const notice = dead ? { ok: true, id: 'x' } : await notify({ to: 'owner', issueId: c.issueId, body });"],
  ['the release records no evidence', 'deadOwnerReleasedAtOnce', 'reason, ticket: c.ticket, runId: c.runId, evidence: detail,', 'reason, ticket: c.ticket, runId: c.runId,'],
  ['unknown liveness is treated as dead', 'unknownIsNotDead', "if (live && live.state === 'dead') return { forced: forced(s, c, 'owner-dead'", "if (live && live.state !== 'alive') return { forced: forced(s, c, 'owner-dead'"],
  ['claim skips the readiness gate', 'notReadyIsRefused',
    "if (!ready.ok) {\n      // A waiter that is re-preparing", "if (false) {\n      // A waiter that is re-preparing"],
  ['a missing receipt is accepted', 'notReadyIsRefused',
    'if (!receipt) missing.push(', 'if (false) missing.push('],
  ['a red receipt is accepted', 'notReadyIsRefused',
    'receipt.sha !== sha || receipt.exit !== 0', 'receipt.sha !== sha'],
  ['a missing code commit is ignored', 'notReadyIsRefused',
    'const code = commits.filter((c) => !isDataCommit(c));', 'const code = [];'],
  ['data-bot commits count as not rebased', 'notReadyIsRefused',
    'const code = commits.filter((c) => !isDataCommit(c));', 'const code = commits;'],
  ['review is not required', 'notReadyIsRefused', 'if (!reviewed) missing.push(', 'if (false) missing.push('],
  ['exit 4 is back in the table', 'noPathReturnsFourOrFive',
    'export const EXIT = { HOLD: 0,', 'export const EXIT = { EXPIRED_OWNER_ALIVE: 4, HOLD: 0,'],
  ['an unknown owner returns the retired exit 4', 'noPathReturnsFourOrFive',
    "out = { code: EXIT.WAIT, action: c ? 'wait' : 'wait-turn'", "out = { code: live && live.state === 'unknown' ? 4 : EXIT.WAIT, action: c ? 'wait' : 'wait-turn'"],
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
    "if (!c || c.runId !== me.runId) {\n        save(s);\n        const mine = freed", "if (!c || c.ticket !== me.ticket) {\n        save(s);\n        const mine = freed"],
  ['a re-claim keeps the old run id', 'sameTicketNoSilentInheritance',
    "s.claim.reclaimedFrom = freed.claim.runId;", "s.claim.runId = freed.claim.runId; s.claim.reclaimedFrom = freed.claim.runId;"],
  ['a re-claim keeps the old expiry', 'sameTicketNoSilentInheritance',
    "s.claim.reclaimedFrom = freed.claim.runId;", "s.claim.takenAt = freed.claim.takenAt; s.claim.expiresAt = freed.claim.expiresAt; s.claim.reclaimedFrom = freed.claim.runId;"],
  ['a same-ticket new run takes the lane while the old run is alive', 'sameTicketNoSilentInheritance',
    'if (!c && before.length === 0) {', 'if ((!c || c.ticket === me.ticket) && before.length === 0) {'],
  ['a re-claim with a new ready sha keeps the old sha', 'reclaimWithNewShaUpdatesTheClaim',
    'if (ready.sha !== from) {', 'if (false) {'],
  ['a re-claim with a new sha extends the hold', 'reclaimWithNewShaUpdatesTheClaim',
    "log(s, { event: 'claim-sha-updated'", "c.expiresAt = iso(t + MAX_HOLD_MIN * MIN); log(s, { event: 'claim-sha-updated'"],
  ['release by a non-holder leaves its entry queued', 'releaseAfterCapWithdrawsEntry',
    's.queue = s.queue.filter((e) => e.runId !== me.runId);\n      if (s.queue.length !== queued)', 'if (s.queue.length !== queued)'],
  ['batchCandidates has no overall deadline', 'batchLivenessDeadline',
    '      if (Date.now() >= deadline) break;\n      liveOf.set(', '      liveOf.set('],
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
    "        s.claim = null;\n        delete s.waiters[me.runId];\n        log(s, { event: 'released-live-confirmed'", "        delete s.waiters[me.runId];\n        log(s, { event: 'released-live-confirmed'"],
  ['(b) confirm-live releases on exit 1 (not live yet)', 'founderB_noLaneAfterLiveConfirmed',
    'if (r.code === 0) {\n      return locked(', 'if (r.code !== 2) {\n      return locked('],
  ['(c) renew extends the hold', 'founderC_renewalPastCapRefused',
    "c.renewedAt = iso(now());\n      save(s);", "c.renewedAt = iso(now()); c.takenAt = iso(now());\n      save(s);"],
  ['(c) the cap is measured from the last renewal', 'founderC_renewalPastCapRefused',
    'const elapsed = t - Date.parse(c.takenAt);', 'const elapsed = t - Date.parse(c.renewedAt);'],
  ['(c) no alert on the holder\'s ticket at the cap', 'founderC_renewalPastCapRefused',
    "const notice = await notify({ to: 'owner', issueId: c.issueId, body });", "const notice = !dead ? { ok: false, error: 'x' } : await notify({ to: 'owner', issueId: c.issueId, body });"],
  ['(d) dead waiters keep their place', 'founderD_deadClaimantRemoved',
    "if (live && live.state === 'dead') {\n        delete s.waiters[w.runId];", "if (false) {\n        delete s.waiters[w.runId];"],
  ['silent waiters never go stale', 'staleWaitersDropped', 'if (stale) {\n        delete s.waiters[w.runId];', 'if (false) {\n        delete s.waiters[w.runId];'],
  ['a live Paperclip waiter never goes stale (the pre-review rule)', 'staleWaitersDropped',
    'if (stale) {\n        delete s.waiters[w.runId];', "if (stale && w.kind !== 'paperclip') {\n        delete s.waiters[w.runId];"],
  ['the waiter stale window is 60 min', 'staleWaitersDropped', 'export const WAITER_STALE_MIN = 15;', 'export const WAITER_STALE_MIN = 60;'],
  ['a new run inherits even while the old run is alive', 'sameTicketWaiterInheritance',
    "      if (!live || live.state !== 'dead') continue;\n      delete s.waiters[old.runId];", "      delete s.waiters[old.runId];"],
  ['a new run never inherits', 'sameTicketWaiterInheritance',
    'const w = addWaiter(s, me, old.since,', 'const w = addWaiter(s, me, iso(t),'],
  ['inheritance ignores the stale window', 'sameTicketWaiterInheritance',
    "      if (t - Date.parse(old.lastSeen || old.since) > WAITER_STALE_MIN * MIN) continue;\n      const live", "      const live"],
  ['the cap is 45 min, not the founder\'s 40', 'capRuleConstants', 'export const MAX_HOLD_MIN = 40;', 'export const MAX_HOLD_MIN = 45;'],
  // review fixes
  ['a not-ready claim does not refresh the waiter (it goes stale while re-preparing)', 'notReadyWaiterKeepsPlace',
    '        w.lastSeen = iso(now());\n        const before = ahead(s, me, pre);', '        const before = ahead(s, me, pre);'],
  ['a not-ready claim does not log its position', 'notReadyWaiterKeepsPlace',
    "log(s, { event: 'waiting-not-ready', ticket: me.ticket, runId: me.runId, position, waitedMin: waited,", "log(s, { event: 'waiting-not-ready', ticket: me.ticket, runId: me.runId,"],
  ['a batched-in waiter stays in the waiter queue', 'batchedWaiterLeavesQueue',
    "if (s.waiters[l.runId]) { delete s.waiters[l.runId];", "if (false) { delete s.waiters[l.runId];"],
  ['confirm-live accepts any sha', 'confirmLiveChecksTheSha', 'if (sha !== c.sha && sha !== c.readBack) {', 'if (false) {'],
  ['confirm-live ignores the recorded read-back sha', 'confirmLiveChecksTheSha', 'if (sha !== c.sha && sha !== c.readBack) {', 'if (sha !== c.sha) {'],
  ['a legacy claim is read as a new one (cap text, new cap)', 'legacyClaimHonouredOnce',
    'const isLegacy = (c) => !!c && c.version !== 2 && !!c.expiresAt;', 'const isLegacy = () => false;'],
  ['a legacy expiry follows the old tool\'s renewals', 'legacyClaimHonouredOnce',
    'if (!c.legacyExpiresAt) c.legacyExpiresAt = c.expiresAt;', 'c.legacyExpiresAt = c.expiresAt;'],
  // cap ruling 02:05Z
  ['an in-progress pipeline run does not extend the hold', 'capRule_healthyDeployKeptAt45',
    "if (owner && owner.status === 'in_progress') return held(", "if (false) return held("],
  ['any in-progress run extends, even one that started before the push', 'capRule_healthyDeployKeptAt45',
    'else owner = runs.filter((r) => r.startedAt && Date.parse(r.startedAt) >= pushedAt)', 'else owner = runs.filter((r) => r.startedAt)'],
  ['a queued pipeline run never releases', 'capRule_queuedPast10Releases',
    'if (min > pipelineQueuedMaxMin) {', 'if (false) {'],
  ['the queued limit is 20 min', 'capRule_queuedPast10Releases', 'export const PIPELINE_QUEUED_MAX_MIN = 10;', 'export const PIPELINE_QUEUED_MAX_MIN = 20;'],
  ['the plain cap is 41 min', 'capRule_fortyMinutesNoRun', 'export const MAX_HOLD_MIN = 40;', 'export const MAX_HOLD_MIN = 41;'],
  ['the plain cap never fires', 'capRule_fortyMinutesNoRun', 'if (elapsed >= capMs) {', 'if (false) {'],
  ['a dead owner waits for the cap (status does not enforce)', 'capRule_deadOwnerReleasedImmediately',
    "if (live && live.state === 'dead') return { forced: forced(s, c, 'owner-dead', live.detail, fx), live };", ''],
  ['a forced release dispatches no alert', 'capRule_forcedReleaseAlerts',
    'try { al = await alert({ reason, message }); }', "try { al = { ok: false, error: 'not dispatched' }; }"],
  ['the alert does not name the reason', 'capRule_forcedReleaseAlerts',
    'const message = `deploy lane forced release (${reason}):', 'const message = `deploy lane forced release:'],
  ['GitHub unreachable extends the hold', 'capRule_githubUnreachableNeverExtends',
    "if (owner && owner.status === 'in_progress') return held('owner-run-in-progress', { run: owner.url || owner.id });",
    "if ((owner && owner.status === 'in_progress') || (pr && !pr.ok)) return held('owner-run-in-progress', { run: owner ? (owner.url || owner.id) : 'unknown' });"],
  // review of c003eb8f
  ['(1a) the hold rules run before the site is checked', 'confirmLiveChecksTheSiteFirst',
    '    const r = await checkLive(sha);\n    if (r.code === 0) {',
    '    const pre0 = await renew(me);\n    if (pre0.code !== 0) return { code: EXIT.REFUSED, action: pre0.action, reason: pre0.reason };\n    const r = await checkLive(sha);\n    if (r.code === 0) {'],
  ['(1b) no read-back grace', 'readBackGraceAfterASuccessfulRun',
    "if (or && or.status === 'completed' && or.conclusion === 'success' && or.completedAt && t < Date.parse(or.completedAt) + graceMs) {", 'if (false) {'],
  ['(1b) a failed owner run gets the grace too', 'readBackGraceAfterASuccessfulRun',
    "or.status === 'completed' && or.conclusion === 'success' && or.completedAt", "or.status === 'completed' && or.completedAt"],
  ['(1b) the grace is 20 min', 'readBackGraceAfterASuccessfulRun', 'export const READBACK_GRACE_MIN = 12;', 'export const READBACK_GRACE_MIN = 20;'],
  ['(2) any in-progress run after the push extends (every later tick)', 'laterTickDoesNotExtend',
    'if (c.ownerRun) owner = runs.find((r) => r.id === c.ownerRun.id) || null;\n    else owner = ',
    "owner = runs.find((r) => r.status === 'in_progress' && r.startedAt && Date.parse(r.startedAt) >= pushedAt) || "],
  ['(2) the owner run is not recorded on the claim', 'laterTickDoesNotExtend', 'if (owner) c.ownerRun = {', 'if (false) c.ownerRun = {'],
  ['(3) a pushed holder is re-queued (a phantom waiter)', 'pushedHolderIsNotRequeued', 'const requeue = !dead && !pushed;', 'const requeue = !dead;'],
  ['(4) a pending run behind a running tick is not "moving"', 'healthyQueueingIsNotStuck',
    "if (healthyQueue && moving) return held(", "if (false) return held("],
  ['(4) the queued clock never pauses', 'healthyQueueingIsNotStuck',
    'if (healthyQueue) {\n          for (const r of runs) {', 'if (false) {\n          for (const r of runs) {'],
  ['(4) the flag ships off (the literal rule)', 'healthyQueueingIsNotStuck',
    'export const HEALTHY_QUEUE_PAUSES_CLOCK = true;', 'export const HEALTHY_QUEUE_PAUSES_CLOCK = false;'],
  ['(5) any [skip ci] subject is data, whoever wrote it', 'skipCiByANonBotIsCode',
    "subject.includes('[skip ci]') && DATA_BOT_AUTHORS.has(authorEmail.toLowerCase()) &&", "subject.includes('[skip ci]') &&"],
  ['(6) notices and alerts are sent inside the lock', 'noNetworkInsideTheLock',
    '    const out = await withLock(file, (save) => fn(save, fx));',
    '    const out = await withLock(file, async (save) => { const o = await fn(save, fx); for (const f of fx.splice(0)) await f(); return o; });'],
  ['(6) liveness and pipeline runs are fetched inside the lock', 'noNetworkInsideTheLock',
    '  async function status(me) {\n    const pre = await prefetch(me);\n    return locked(async (save, fx) => {\n      const s = readState(file);',
    '  async function status(me) {\n    return locked(async (save, fx) => {\n      const pre = await prefetch(me);\n      const s = readState(file);'],
  // review of d096a3c3
  ['(B1) a run with no started job falls back to its created time', 'cancelledQueuedRunIsNotTheOwner',
    'x.startedAt = starts[0] || null;', 'x.startedAt = starts[0] || x.createdAt;'],
  ['(B2) a data-bot author alone makes a commit data (files not checked)', 'botIdentityCodeIsCode',
    ' && files.length > 0 && files.every(isDataPath);', ';'],
  ['(B2) every path counts as a data path', 'botIdentityCodeIsCode',
    'export function isDataPath(f) {', 'export function isDataPath(f) { return true;'],
  ['(M1) a failed GitHub read never reuses the last known state', 'oneGithubFailureReusesTheLastKnownState',
    'else if (pr && c.lastKnownPipeline && t - Date.parse(c.lastKnownPipeline.at) <= staleOkMs) {', 'else if (false) {'],
  ['(M1) the last known state is trusted for 30 min', 'oneGithubFailureReusesTheLastKnownState',
    'export const PIPELINE_STALE_OK_MIN = 5;', 'export const PIPELINE_STALE_OK_MIN = 30;'],
  ['(L3) a new sha after the push rides the same hold', 'newShaAfterThePushReQueues',
    'if (ready.sha !== from && c.pushedAt) {', 'if (false) {'],
  // review of 1198c07c
  ['saved GitHub state can trigger the queued rule (a release on stale data)', 'savedStateNeverForcesARelease',
    'if (!or && known && !lastKnown && pushedAt != null) {', 'if (!or && known && pushedAt != null) {'],
  ['any root .json is data (the old rule)', 'dataPathsAreWhatTheBotsWrite',
    '  if (DATA_FILES.has(f)) return true;', "  if (DATA_FILES.has(f) || (!f.includes('/') && /\\.json$/i.test(f))) return true;"],
  ['splits-matches/ is not a data directory', 'dataPathsAreWhatTheBotsWrite',
    "export const DATA_DIRS = ['style-meetings/', 'bet365-history/', 'splits-matches/'];", "export const DATA_DIRS = ['style-meetings/', 'bet365-history/'];"],
  ['the atp-entry bot is not a data bot', 'dataPathsAreWhatTheBotsWrite',
    "  'bsp-atp-entry-bot@users.noreply.github.com',", ''],
  ['code files in a data directory pass', 'dataPathsAreWhatTheBotsWrite',
    "return DATA_DIRS.some((d) => f.startsWith(d)) && /\\.json(\\.gz)?$/i.test(f);", 'return DATA_DIRS.some((d) => f.startsWith(d));'],
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

// ── the real GitHub adapters, over real HTTP to the fake API ──────────────────
test('githubPipelineRuns: runs newest first, an in-progress run carries its EARLIEST job start; failures are unknown, never a run', async () => {
  const board = await startBoard();
  try {
    board.gh.runs = [
      { id: 7, status: 'in_progress', created_at: '2026-09-25T02:00:00Z', run_started_at: '2026-09-25T02:01:00Z', html_url: 'u7' },
      { id: 6, status: 'queued', created_at: '2026-09-25T01:59:00Z', html_url: 'u6' },
      { id: 5, status: 'completed', conclusion: 'success', created_at: '2026-09-25T01:40:00Z', run_started_at: '2026-09-25T01:40:30Z', updated_at: '2026-09-25T01:52:00Z', html_url: 'u5' },
      { id: 4, status: 'completed', conclusion: 'failure', created_at: '2026-09-25T01:30:00Z', run_started_at: '2026-09-25T01:30:30Z', updated_at: '2026-09-25T01:35:00Z', html_url: 'u4' },
      { id: 3, status: 'completed', conclusion: 'success', created_at: '2026-09-25T01:20:00Z', run_started_at: '2026-09-25T01:20:30Z', updated_at: '2026-09-25T01:25:00Z', html_url: 'u3' },
    ];
    board.gh.jobs['7'] = [{ started_at: '2026-09-25T02:03:00Z' }, { started_at: '2026-09-25T02:01:30Z' }, { started_at: null }];
    const early = await real.githubPipelineRuns({ repo: 'o/r', token: 'tok', apiBase: board.base })({ since: '2026-09-25T01:00:00Z' });
    assert.equal(early.ok, true);
    assert.equal(board.gh.jobCalls, 3, 'jobs are fetched for at most 3 runs (the earliest started at/after since)');
    board.gh.jobCalls = 0;
    const r = await real.githubPipelineRuns({ repo: 'o/r', token: 'tok', apiBase: board.base })({ since: '2026-09-25T01:39:00Z' });
    assert.equal(r.ok, true);
    assert.equal(board.gh.jobCalls, 3, 'runs 4, 5, 7: created within 10 min before `since` or later, not queued');
    // Started = a job with a started_at. Run 5 has no jobs: NOT started, whatever its run_started_at says.
    assert.deepEqual(r.runs.slice(0, 3).map((x) => [x.id, x.status, x.startedAt, x.conclusion, x.completedAt]),
      [[7, 'in_progress', '2026-09-25T02:01:30Z', null, null], [6, 'queued', null, null, null], [5, 'completed', null, 'success', '2026-09-25T01:52:00Z']]);
    board.gh.jobCalls = 0;
    const own = await real.githubPipelineRuns({ repo: 'o/r', token: 'tok', apiBase: board.base })({ since: '2026-09-25T01:00:00Z', ownerRunId: 7 });
    assert.equal(board.gh.jobCalls, 1, 'a recorded owner run: only its jobs are read');
    assert.equal(own.runs.find((x) => x.id === 7).startedAt, '2026-09-25T02:01:30Z');
    const none = await real.githubPipelineRuns({ repo: 'o/r', token: () => null, apiBase: board.base })();
    assert.equal(none.ok, false); assert.match(none.detail, /no GitHub token/);
    const down = await real.githubPipelineRuns({ repo: 'o/r', token: 'tok', apiBase: 'http://127.0.0.1:9' })();
    assert.equal(down.ok, false);
  } finally { board.close(); }
});

test('githubAlert: dispatches pipeline-watchdog.yml on main with lane_alert = the message, bearer token in the header only', async () => {
  const board = await startBoard();
  try {
    const r = await real.githubAlert({ repo: 'o/r', token: 'tok', apiBase: board.base })({ reason: 'owner-dead', message: 'deploy lane forced release (owner-dead): TEN-1' });
    assert.equal(r.ok, true);
    assert.equal(board.gh.dispatches.length, 1);
    const d = board.gh.dispatches[0];
    assert.equal(d.repo, 'o/r'); assert.equal(d.auth, 'Bearer tok');
    assert.deepEqual(d.body, { ref: 'main', inputs: { lane_alert: 'deploy lane forced release (owner-dead): TEN-1' } });
    assert.ok(!JSON.stringify(d.body).includes('tok'));
    const down = await real.githubAlert({ repo: 'o/r', token: 'tok', apiBase: 'http://127.0.0.1:9' })({ reason: 'x', message: 'y' });
    assert.equal(down.ok, false);
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
