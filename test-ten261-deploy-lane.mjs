// TEN-261 — the deploy lane expires. Four founder cases, each simulated end to
// end and each paired with a mutant of tools/deploy-lane.mjs that must make it
// fail. A case that still passes with the mechanism cut out is not testing it.
//
// Nothing here reads the source for its assertions. The store is a real file,
// liveness and notices go through the REAL Paperclip adapters over real HTTP
// to a fake board server, and the CLI is spawned for real. The only
// substitutes are the clock and the clobber check (which needs a live origin),
// and the clobber fake returns the real one's shape: { ok, output }.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'tools', 'deploy-lane.mjs');
const MIN = 60 * 1000;
const T0 = Date.parse('2026-09-23T08:00:00Z');

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

async function rig(mod, board, shared) {
  const dir = shared ? path.dirname(shared.file) : fs.mkdtempSync(path.join(os.tmpdir(), 'ten261-'));
  const clock = shared ? shared.clock : { t: T0 };
  const clobberCalls = [];
  let clobberOk = true;
  const lane = mod.createLane({
    file: path.join(dir, 'lane.json'),
    now: () => clock.t,
    liveness: mod.paperclipLiveness({ apiBase: board.base, apiKey: 'k' }),
    notify: mod.paperclipNotify({ apiBase: board.base, apiKey: 'k', agentId: 'agent-x' }),
    clobberCheck: (a) => { clobberCalls.push(a); return { ok: clobberOk, output: clobberOk ? 'clear' : 'MOVED: x.html' }; },
  });
  return { lane, clock, clobberCalls, setClobber: (v) => { clobberOk = v; }, file: path.join(dir, 'lane.json') };
}

const A = { ticket: 'TEN-253', issueId: 'issue-253', runId: 'run-A', kind: 'paperclip' };
const B = { ticket: 'TEN-260', issueId: 'issue-260', runId: 'run-B', kind: 'paperclip' };
const LAND = { base: 'abc123', files: ['bsp-consult-dashboard.html'] };

// ── the four founder cases, each returning whether the rule held ─────────────
const CASES = {
  // 1 · an owner that renews keeps the lane — past the point its first lease ran out.
  async renewingOwnerKeepsLane(mod) {
    const board = await startBoard();
    try {
      const { lane, clock } = await rig(mod, board);
      board.runs['run-A'] = 'running'; board.runs['run-B'] = 'running';
      if ((await lane.claim(A)).code !== 0) return false;
      for (let m = 14; m <= 56; m += 14) {
        clock.t = T0 + m * MIN;
        if ((await lane.renew(A)).code !== 0) return false;
      }
      clock.t = T0 + 60 * MIN; // 60 min after taking: 15 past the first lease
      const b = await lane.claim(B, LAND);
      // Last renewal at 56 min → lease ends at exactly 101 min: held at 100, expired at 101.
      clock.t = T0 + 100 * MIN;
      const b100 = await lane.claim(B, LAND);
      clock.t = T0 + 101 * MIN;
      const b101 = await lane.claim(B, LAND);
      return b.code === 3 && b.action === 'wait' && b.claim.runId === 'run-A'
        && b100.code === 3 && b101.code === 4
        && board.comments.every((c) => c.issueId !== 'issue-253');
    } finally { board.close(); }
  },

  // 2 · a crashed owner's claim expires; a waiter takes it, with a notice on the owner's ticket.
  async crashedOwnerIsTakenWithNotice(mod) {
    const board = await startBoard();
    try {
      const { lane, clock, clobberCalls } = await rig(mod, board);
      board.runs['run-A'] = 'running'; board.runs['run-B'] = 'running';
      await lane.claim(A);
      clock.t = T0 + 10 * MIN; board.runs['run-A'] = 'cancelled'; // crashed mid-deploy
      clock.t = T0 + 20 * MIN;
      const early = await lane.claim(B, LAND); // lease still running: wait, even though A is dead
      if (early.code !== 3) return false;
      clock.t = T0 + 46 * MIN;
      const r = await lane.claim(B, LAND);
      const notice = board.comments.find((c) => c.issueId === 'issue-253');
      return r.code === 0 && r.action === 'taken-over' && r.claim.runId === 'run-B'
        && !!notice && /released as stale/.test(notice.body) && /run-A/.test(notice.body) && /cancelled/.test(notice.body)
        && notice.authorAgentId === 'agent-x'
        && clobberCalls.length === 1 && clobberCalls[0].base === 'abc123';
    } finally { board.close(); }
  },

  // 3 · an expired claim whose owner is still alive is NOT taken; the founder gets a report.
  async expiredLiveOwnerNotTaken(mod) {
    const board = await startBoard();
    try {
      const { lane, clock } = await rig(mod, board);
      board.runs['run-A'] = 'running'; board.runs['run-B'] = 'running';
      await lane.claim(A); // A forgets to renew but is still running
      clock.t = T0 + 46 * MIN;
      const r = await lane.claim(B, LAND);
      clock.t = T0 + 50 * MIN;
      const again = await lane.claim(B, LAND);
      const reports = board.comments.filter((c) => c.issueId === 'issue-260' && /NOT taking it/.test(c.body));
      return r.code === 4 && r.claim.runId === 'run-A' && again.code === 4 && again.claim.runId === 'run-A'
        && reports.length === 1 && /run-A/.test(reports[0].body) && /alive/.test(reports[0].body)
        && board.comments.every((c) => c.issueId !== 'issue-253');
    } finally { board.close(); }
  },

  // 4 · a waiter past 30 minutes reports who holds the lane, since when, and whether it is alive.
  async waiterPast30Reports(mod) {
    const board = await startBoard();
    try {
      const { lane, clock } = await rig(mod, board);
      board.runs['run-A'] = 'running'; board.runs['run-B'] = 'running';
      await lane.claim(A);
      const rep = () => board.comments.filter((c) => c.issueId === 'issue-260' && /has waited/.test(c.body));
      const steps = [[1, 0], [15, 0], [29, 0], [32, 1], [40, 1], [63, 2]];
      for (const [m, want] of steps) {
        clock.t = T0 + m * MIN;
        await lane.renew(A);
        const r = await lane.claim(B, LAND);
        if (r.code !== 3 || rep().length !== want) return false;
      }
      const body = rep()[0].body;
      return /TEN-253/.test(body) && /run-A/.test(body) && /taken 2026-09-23T08:00:00/.test(body) && /alive/.test(body);
    } finally { board.close(); }
  },

  // 5 · two waiters race for the same dead, expired claim: exactly one takes it, one notice.
  async concurrentTakeoversSerialise(mod) {
    const board = await startBoard();
    try {
      const b = await rig(mod, board);
      const c = await rig(mod, board, b);
      const C = { ticket: 'TEN-262', issueId: 'issue-262', runId: 'run-C', kind: 'paperclip' };
      board.runs['run-A'] = 'running'; board.runs['run-B'] = 'running'; board.runs['run-C'] = 'running';
      await b.lane.claim(A);
      board.runs['run-A'] = 'cancelled';
      b.clock.t = T0 + 46 * MIN;
      board.setDelay(150); // both read the store before either could write, unless the lock serialises them
      const [rb, rc] = await Promise.all([b.lane.claim(B, LAND), c.lane.claim(C, LAND)]);
      board.setDelay(0);
      const winners = [rb, rc].filter((r) => r.code === 0);
      const holder = JSON.parse(fs.readFileSync(b.file, 'utf8')).claim.runId;
      return winners.length === 1 && [rb, rc].some((r) => r.code === 3)
        && holder === winners[0].claim.runId
        && board.comments.filter((x) => x.issueId === 'issue-253').length === 1;
    } finally { board.close(); }
  },

  // 6 · a holder whose lock is broken as stale (it was too slow) must not write, and must
  //     not remove the lock the new holder now owns.
  async staleLockBreakCannotDoubleTake(mod) {
    const board = await startBoard();
    try {
      const b = await rig(mod, board);
      const c = await rig(mod, board, b);
      const C = { ticket: 'TEN-262', issueId: 'issue-262', runId: 'run-C', kind: 'paperclip' };
      board.runs['run-A'] = 'running'; board.runs['run-B'] = 'running'; board.runs['run-C'] = 'running';
      await b.lane.claim(A);
      board.runs['run-A'] = 'cancelled';
      b.clock.t = T0 + 46 * MIN;
      board.setDelay(400);
      const lock = `${b.file}.lock`;
      const pb = b.lane.claim(B, LAND).then((r) => ({ r }), (e) => ({ e }));
      await new Promise((r) => setTimeout(r, 100));
      const old = new Date(Date.now() - 10 * MIN);
      fs.utimesSync(lock, old, old); // B's lock now looks abandoned
      const pc = c.lane.claim(C, LAND).then((r) => ({ r }), (e) => ({ e }));
      const rb = await pb; // B resumes while C holds the lock
      const cLockSurvived = fs.existsSync(lock);
      const rc = await pc;
      board.setDelay(0);
      const holder = JSON.parse(fs.readFileSync(b.file, 'utf8')).claim.runId;
      return !!rb.e && /lost the store lock/.test(rb.e.message) && cLockSurvived
        && rc.r && rc.r.code === 0 && holder === 'run-C';
    } finally { board.close(); }
  },

  // 7 · same ticket, new run: only a FORMAL re-claim (founder ruling) — new run id
  //     recorded, lease reset, notice on the ticket. Never renews the old claim silently.
  async sameTicketFormalReclaim(mod) {
    const board = await startBoard();
    try {
      const { lane, clock } = await rig(mod, board);
      const A2 = { ...A, runId: 'run-A2' };
      board.runs['run-A'] = 'running'; board.runs['run-A2'] = 'running';
      await lane.claim(A);
      board.runs['run-A'] = 'cancelled';
      clock.t = T0 + 30 * MIN;
      const silentRenew = await lane.renew(A2);     // may not ride the old claim
      const silentRelease = await lane.release(A2);
      clock.t = T0 + 31 * MIN;
      board.setFailComments(true);                   // no notice → no re-claim
      const noNotice = await lane.claim(A2);
      board.setFailComments(false);
      const r = await lane.claim(A2);
      const notice = board.comments.find((x) => x.issueId === 'issue-253' && /RE-CLAIMED/.test(x.body));
      // Lease reset: held at 31+44 by A2, expired at 31+45.
      const C = { ticket: 'TEN-262', issueId: 'issue-262', runId: 'run-C', kind: 'paperclip' };
      board.runs['run-C'] = 'running';
      clock.t = T0 + 75 * MIN; const c75 = await lane.claim(C, LAND);
      clock.t = T0 + 76 * MIN; const c76 = await lane.claim(C, LAND);
      return silentRenew.code === 1 && silentRelease.code === 1
        && noNotice.code === 5 && noNotice.claim.runId === 'run-A'
        && r.code === 0 && r.action === 're-claimed' && r.claim.runId === 'run-A2' && r.claim.reclaimedFrom === 'run-A'
        && !!notice && /run-A2/.test(notice.body) && /run-A\b/.test(notice.body)
        && c75.code === 3 && c76.code === 4;
    } finally { board.close(); }
  },
};

// Each mutant cuts one mechanism out of the real source. Every anchor must
// occur exactly once, or the mutant silently mutates nothing.
const MUTANTS = [
  ['renewal does not extend the lease', 'renewingOwnerKeepsLane',
    "c.renewedAt = iso(t); c.expiresAt = iso(t + LEASE_MIN * MIN); c.expiredReportedAt = null;\n      save(s);", 'save(s);'],
  ['renewals stack onto the old expiry', 'renewingOwnerKeepsLane',
    "c.renewedAt = iso(t); c.expiresAt = iso(t + LEASE_MIN * MIN); c.expiredReportedAt = null;\n      save(s);",
    "c.renewedAt = iso(t); c.expiresAt = iso(Date.parse(c.expiresAt) + LEASE_MIN * MIN); c.expiredReportedAt = null;\n      save(s);"],
  ['a renewal grants 90 min', 'renewingOwnerKeepsLane',
    "c.renewedAt = iso(t); c.expiresAt = iso(t + LEASE_MIN * MIN); c.expiredReportedAt = null;\n      save(s);",
    "c.renewedAt = iso(t); c.expiresAt = iso(t + 2 * LEASE_MIN * MIN); c.expiredReportedAt = null;\n      save(s);"],
  ['a holder writes without checking it still owns the lock', 'staleLockBreakCannotDoubleTake',
    "if (!owns()) throw new Error('deploy-lane: lost the store lock; nothing written');", ''],
  ['a holder removes whatever lock is there on the way out', 'staleLockBreakCannotDoubleTake',
    '} finally { if (owns()) fs.rmSync(lock', '} finally { if (true) fs.rmSync(lock'],
  ['a same-ticket re-claim posts no notice (silent inheritance)', 'sameTicketFormalReclaim',
    "const notice = await notify({ to: 'owner', issueId: c.issueId,\n            body: `## Deploy lane RE-CLAIMED",
    "const notice = { ok: true } || await notify({ to: 'owner', issueId: c.issueId,\n            body: `## Deploy lane RE-CLAIMED"],
  ['a same-ticket re-claim goes ahead when its notice failed', 'sameTicketFormalReclaim',
    "if (!notice.ok) {\n            out = await waiting(s, me, c, { code: EXIT.TAKEOVER_REFUSED, action: 're-claim-notice-failed'",
    "if (false) {\n            out = await waiting(s, me, c, { code: EXIT.TAKEOVER_REFUSED, action: 're-claim-notice-failed'"],
  ['a same-ticket re-claim keeps the old lease', 'sameTicketFormalReclaim',
    "s.claim = newClaim(me); s.claim.reclaimedFrom = c.runId;",
    "s.claim = { ...newClaim(me), expiresAt: c.expiresAt }; s.claim.reclaimedFrom = c.runId;"],
  ['a same-ticket re-claim keeps the old run id', 'sameTicketFormalReclaim',
    "s.claim = newClaim(me); s.claim.reclaimedFrom = c.runId;",
    "s.claim = { ...newClaim(me), runId: c.runId }; s.claim.reclaimedFrom = c.runId;"],
  ['no mutual exclusion on the store', 'concurrentTakeoversSerialise',
    'const lock = `${file}.lock`;', 'const lock = `${file}.lock.${Math.random()}`;'],
  ['claims never expire (the old lane)', 'crashedOwnerIsTakenWithNotice',
    'const expired = t >= Date.parse(c.expiresAt);', 'const expired = false;'],
  ['takeover skips the owner notice', 'crashedOwnerIsTakenWithNotice',
    "const notice = await notify({ to: 'owner', issueId: c.issueId,\n              body: `## Deploy lane released as stale",
    "const notice = { ok: true } || await notify({ to: 'owner', issueId: c.issueId,\n              body: `## Deploy lane released as stale"],
  ['takeover skips the clobber check', 'crashedOwnerIsTakenWithNotice',
    'clobberCheck({ base, files })', '({ ok: true, output: "" })'],
  ['takeover skips the liveness check', 'expiredLiveOwnerNotTaken',
    "} else if (live.state !== 'dead') {", '} else if (false) {'],
  ['a waiter never reports', 'waiterPast30Reports',
    'if (waited > WAIT_REPORT_MIN * MIN &&', 'if (false &&'],
  ['the report repeats every call instead of every 30 min', 'waiterPast30Reports',
    '(!w.reportedAt || t - Date.parse(w.reportedAt) >= WAIT_REPORT_MIN * MIN)', 'true'],
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

// ── edges the four cases lean on ─────────────────────────────────────────────
test('takeover refused when the clobber check fails, and when no base/files are given', async () => {
  const board = await startBoard();
  try {
    const { lane, clock, setClobber } = await rig(real, board);
    board.runs['run-A'] = 'running'; board.runs['run-B'] = 'running';
    await lane.claim(A);
    board.runs['run-A'] = 'failed';
    clock.t = T0 + 50 * MIN;
    setClobber(false);
    const r1 = await lane.claim(B, LAND);
    assert.equal(r1.code, 5); assert.equal(r1.claim.runId, 'run-A');
    setClobber(true);
    const r2 = await lane.claim(B);
    assert.equal(r2.code, 5); assert.equal(r2.claim.runId, 'run-A');
    assert.equal(board.comments.filter((c) => c.issueId === 'issue-253').length, 0, 'no notice before a refused takeover');
  } finally { board.close(); }
});

test('an unreachable board is not proof of death: expired claim is not taken', async () => {
  const board = await startBoard();
  try {
    const { lane, clock } = await rig(real, board);
    board.runs['run-A'] = 'running';
    await lane.claim(A);
    board.setFailRuns(true);
    clock.t = T0 + 50 * MIN;
    const r = await lane.claim(B, LAND);
    assert.equal(r.code, 4); assert.equal(r.claim.runId, 'run-A');
  } finally { board.close(); }
});

test('a crashed run cannot renew; only the owner run can renew or release', async () => {
  const board = await startBoard();
  try {
    const { lane, clock } = await rig(real, board);
    board.runs['run-A'] = 'running'; board.runs['run-B'] = 'running';
    await lane.claim(A);
    assert.equal((await lane.renew(B)).code, 1);
    assert.equal((await lane.release(B)).code, 1);
    board.runs['run-A'] = 'cancelled';
    clock.t = T0 + 10 * MIN;
    const r = await lane.renew(A);
    assert.equal(r.code, 1); assert.equal(r.action, 'run-not-active');
    assert.equal((await lane.status()).claim.expiresAt, new Date(T0 + 45 * MIN).toISOString(), 'lease not extended');
  } finally { board.close(); }
});

test('same-ticket re-claim: a live old run makes the new run wait; an ended one lets it re-claim', async () => {
  const board = await startBoard();
  try {
    const { lane, clock } = await rig(real, board);
    const A2 = { ...A, runId: 'run-A2' };
    board.runs['run-A'] = 'running'; board.runs['run-A2'] = 'running';
    await lane.claim(A);
    clock.t = T0 + 5 * MIN;
    assert.equal((await lane.claim(A2)).code, 3, 'old run alive: wait');
    board.runs['run-A'] = 'cancelled';
    const r = await lane.claim(A2);
    assert.equal(r.code, 0); assert.equal(r.action, 're-claimed'); assert.equal(r.claim.runId, 'run-A2');
  } finally { board.close(); }
});

test('an EXPIRED claim is not inherited by the same ticket: it needs the clobber check and a notice like anyone else', async () => {
  const board = await startBoard();
  try {
    const { lane, clock, clobberCalls } = await rig(real, board);
    const A2 = { ...A, runId: 'run-A2' };
    board.runs['run-A'] = 'running'; board.runs['run-A2'] = 'running';
    await lane.claim(A);
    board.runs['run-A'] = 'cancelled';
    clock.t = T0 + 46 * MIN;
    assert.equal((await lane.claim(A2)).code, 5, 'no --base/--files: refused');
    const r = await lane.claim(A2, LAND);
    assert.equal(r.code, 0); assert.equal(r.action, 'taken-over');
    assert.equal(clobberCalls.length, 1);
    assert.equal(board.comments.filter((c) => c.issueId === 'issue-253' && /released as stale/.test(c.body)).length, 1);
  } finally { board.close(); }
});

test('a live owner that renews late and lapses AGAIN is reported again', async () => {
  const board = await startBoard();
  try {
    const { lane, clock } = await rig(real, board);
    board.runs['run-A'] = 'running'; board.runs['run-B'] = 'running';
    await lane.claim(A);
    const reports = () => board.comments.filter((c) => c.issueId === 'issue-260' && /NOT taking it/.test(c.body)).length;
    clock.t = T0 + 46 * MIN; assert.equal((await lane.claim(B, LAND)).code, 4); assert.equal(reports(), 1);
    clock.t = T0 + 47 * MIN; assert.equal((await lane.renew(A)).code, 0);
    clock.t = T0 + 93 * MIN; assert.equal((await lane.claim(B, LAND)).code, 4); assert.equal(reports(), 2);
  } finally { board.close(); }
});

test('release frees the lane for the next claimant', async () => {
  const board = await startBoard();
  try {
    const { lane } = await rig(real, board);
    board.runs['run-A'] = 'running'; board.runs['run-B'] = 'running';
    await lane.claim(A);
    assert.equal((await lane.release(A)).code, 0);
    const r = await lane.claim(B);
    assert.equal(r.code, 0); assert.equal(r.action, 'claimed');
  } finally { board.close(); }
});

// ── the CLI, spawned for real against the fake board ─────────────────────────
test('CLI: claim / wait / renew / release with exit codes, through the real wiring', async () => {
  const board = await startBoard();
  try {
    board.runs['run-A'] = 'running'; board.runs['run-B'] = 'running';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten261-cli-'));
    // ASYNC spawn: the fake board lives in THIS process, so a spawnSync would
    // block the loop that has to answer the child's HTTP calls — a deadlock.
    const run = (args, runId, issue) => new Promise((resolve) => {
      const ch = spawn(process.execPath, [SRC, ...args], { env: { ...process.env, DEPLOY_LANE_FILE: path.join(dir, 'lane.json'), PAPERCLIP_API_URL: `${board.base}/api`,
        PAPERCLIP_API_KEY: 'k', PAPERCLIP_RUN_ID: runId, PAPERCLIP_TASK_ID: issue, PAPERCLIP_AGENT_ID: 'agent-x' } });
      let stdout = '';
      ch.stdout.on('data', (d) => { stdout += d; });
      ch.on('close', (status) => resolve({ status, stdout }));
    });
    assert.equal((await run(['claim', '--ticket', 'TEN-253'], 'run-A', 'issue-253')).status, 0);
    const w = await run(['claim', '--ticket', 'TEN-260'], 'run-B', 'issue-260');
    assert.equal(w.status, 3); assert.equal(JSON.parse(w.stdout).claim.runId, 'run-A');
    assert.equal((await run(['renew', '--ticket', 'TEN-253'], 'run-A', 'issue-253')).status, 0);
    assert.equal((await run(['release', '--ticket', 'TEN-260'], 'run-B', 'issue-260')).status, 1);
    assert.equal((await run(['release', '--ticket', 'TEN-253'], 'run-A', 'issue-253')).status, 0);
    assert.equal((await run(['claim', '--ticket', 'TEN-260'], 'run-B', 'issue-260')).status, 0);
    assert.equal((await run(['claim'], 'run-B', 'issue-260')).status, 2);
    assert.equal((await run(['claim', '--ticket', '--base', 'x'], 'run-B', 'issue-260')).status, 2, 'a flag is not a ticket');
    fs.writeFileSync(path.join(dir, 'lane.json'), '{ not json');
    assert.equal((await run(['claim', '--ticket', 'TEN-260'], 'run-B', 'issue-260')).status, 6, 'unreadable store: error, never a hold');
  } finally { board.close(); }
});
