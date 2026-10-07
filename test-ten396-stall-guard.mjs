// TEN-396 — pipeline stall guard. Drives the REAL tools/pipeline-stall-guard.mjs as
// a child process (async spawn — a spawnSync child deadlocks against an in-process
// fake server) against a fake GitHub REST API + fake Telegram, and asserts what it
// DID: cancels, dispatches, comments, Telegram sends. The founder's ruling, case by
// case: 59 min → nothing; 61 min → one alert, never repeated; 121 min → cancel +
// one re-run + comment; executing runs/jobs/steps → never cancelled.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ALERT_AFTER_MIN, CANCEL_AFTER_MIN, decide, waitingMinutes, readMarkers, marker,
} from './tools/pipeline-stall-guard.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(ROOT, 'tools', 'pipeline-stall-guard.mjs');
const REPO = 'o/r';
const LOG_REPO = 'o/ops';   // the private log repo
const MIN = 60000;
const ago = (m) => new Date(Date.now() - m * MIN).toISOString();

// A waiting run whose only job reached the environment gate `m` minutes ago.
function waitingRun(id, m, { jobStatus = 'waiting', steps = [], runStatus = 'waiting' } = {}) {
  return {
    run: { id, run_number: id % 10000, status: runStatus, created_at: ago(m + 7), run_started_at: ago(m + 7),
      html_url: `https://github.com/${REPO}/actions/runs/${id}` },
    jobs: [{ id: id * 10, status: jobStatus, started_at: ago(m), created_at: ago(m), steps }],
  };
}

// ── fake GitHub + Telegram ───────────────────────────────────────────────────
function fakeWorld({ runs = [], issues = [], comments = {}, stickyCancel = false, commentsStatus = 200, commentPostStatus = 201, ignoreStatusFilter = false, logStatus = 0, tokenExpiry = null } = {}) {
  const w = { runs: new Map(runs.map((r) => [String(r.run.id), r])), issues, comments, cancels: [], dispatches: [],
    posted: [], telegrams: [], created: [], publicIssueCalls: [], logAuth: new Set(), stickyCancel, commentsStatus, commentPostStatus, ignoreStatusFilter };
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const p = u.pathname;
      const isLog = p.startsWith(`/repos/${LOG_REPO}/`);
      const send = (s, j) => {
        const h = { 'Content-Type': 'application/json' };
        if (isLog && tokenExpiry) h['github-authentication-token-expiration'] = tokenExpiry;
        res.writeHead(s, h); res.end(j == null ? '' : JSON.stringify(j));
      };
      let m;
      if (req.method === 'POST' && (m = /^\/botTOKEN\/sendMessage$/.exec(p))) { w.telegrams.push(JSON.parse(body)); return send(200, { ok: true }); }
      if (p.startsWith(`/repos/${REPO}/issues`)) { w.publicIssueCalls.push(`${req.method} ${p}`); return send(403, {}); }
      if (isLog) {
        w.logAuth.add(req.headers.authorization);
        if (logStatus) return send(logStatus, { message: 'Resource not accessible' });
      }
      const pre = isLog ? `/repos/${LOG_REPO}` : `/repos/${REPO}`;
      if (!p.startsWith(pre)) return send(404, {});
      const q = p.slice(pre.length);
      if (!isLog && q.startsWith('/issues')) return send(404, {});
      if (isLog && q.startsWith('/actions')) return send(404, {});
      if (req.method === 'GET' && q === '/actions/workflows/pipeline.yml/runs') {
        const st = u.searchParams.get('status');
        const list = [...w.runs.values()].map((r) => r.run).filter((r) => w.ignoreStatusFilter || !st || r.status === st || r.conclusion === st)
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
        return send(200, { total_count: list.length, workflow_runs: list });
      }
      if (req.method === 'GET' && (m = /^\/actions\/runs\/(\d+)\/jobs$/.exec(q))) return send(200, { jobs: w.runs.get(m[1]).jobs });
      if (req.method === 'GET' && (m = /^\/actions\/runs\/(\d+)$/.exec(q))) return send(200, w.runs.get(m[1]).run);
      if (req.method === 'POST' && (m = /^\/actions\/runs\/(\d+)\/cancel$/.exec(q))) {
        w.cancels.push(m[1]);
        const r = w.runs.get(m[1]);
        if (!w.stickyCancel) { r.run.status = 'completed'; r.run.conclusion = 'cancelled'; r.jobs.forEach((j) => { j.status = 'completed'; }); }
        return send(202, {});
      }
      if (req.method === 'POST' && q === '/actions/workflows/pipeline.yml/dispatches') { w.dispatches.push(JSON.parse(body)); return send(204); }
      if (req.method === 'GET' && q === '/issues') return send(200, w.issues);
      if (req.method === 'POST' && q === '/issues') {
        const i = { number: 100 + w.issues.length, title: JSON.parse(body).title };
        w.issues.push(i); w.created.push(i); return send(201, i);
      }
      if ((m = /^\/issues\/(\d+)\/comments$/.exec(q))) {
        const n = m[1];
        if (req.method === 'GET') {
          if (w.commentsStatus !== 200) return send(w.commentsStatus, { message: 'boom' });
          return send(200, w.comments[n] || []);
        }
        if (w.commentPostStatus !== 201) return send(w.commentPostStatus, { message: 'boom' });
        const c = { id: Date.now(), created_at: new Date().toISOString(), body: JSON.parse(body).body };
        (w.comments[n] = w.comments[n] || []).push(c); w.posted.push({ issue: n, ...c });
        return send(201, c);
      }
      return send(404, { path: q });
    });
  });
  return { w, srv };
}

async function withWorld(opts, fn) {
  const { w, srv } = fakeWorld(opts);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const pass = (extraEnv = {}) => new Promise((resolve) => {
    const env = { PATH: process.env.PATH, GH_TOKEN: 'x', GITHUB_REPOSITORY: REPO, GITHUB_API_URL: base, LOG_TOKEN: 'PAT', STALL_GUARD_LOG_REPO: LOG_REPO,
      TELEGRAM_API_URL: base, TELEGRAM_BOT_TOKEN: 'TOKEN', TELEGRAM_CHAT_ID: '42', ...extraEnv };
    const ch = spawn(process.execPath, [SCRIPT], { env });
    let out = '';
    ch.stdout.on('data', (d) => { out += d; });
    ch.stderr.on('data', (d) => { out += d; });
    ch.on('close', (code) => resolve({ code, out }));
  });
  try { await fn(w, pass); } finally { srv.closeAllConnections(); await new Promise((r) => srv.close(r)); }
}

// ── pure rules ───────────────────────────────────────────────────────────────
test('the ruling is two constants: alert > 60 min, cancel > 120 min', () => {
  assert.equal(ALERT_AFTER_MIN, 60);
  assert.equal(CANCEL_AFTER_MIN, 120);
});

test('waiting age = the LATEST waiting job start (lower bound), never the run creation', () => {
  const { run, jobs } = waitingRun(1, 30);
  const mins = waitingMinutes(run, jobs, Date.now());
  assert.ok(mins > 29.9 && mins < 30.5, `got ${mins}`);   // run was created 37 min ago
});

test('no markers parsed from foreign text; markers parsed per kind', () => {
  const s = readMarkers([{ body: 'hello' }, { body: `${marker('alerted', 7)}\n${marker('redispatched', 7)}` }]);
  assert.ok(s.alerted.has('7') && s.redispatched.has('7') && !s.cancelled.has('7'));
});

test('decide: a waiting run with a step in progress is executing → none', () => {
  const { run, jobs } = waitingRun(2, 500, { steps: [{ status: 'in_progress' }] });
  assert.equal(decide({ run, jobs, now: Date.now(), markers: readMarkers([]) }).action, 'none');
});

// ── the real script against the fake API ─────────────────────────────────────
test('59 min waiting → nothing: no Telegram, no comment, no cancel', async () => {
  await withWorld({ runs: [waitingRun(5901, 59)] }, async (w, pass) => {
    const r = await pass();
    assert.equal(r.code, 0, r.out);
    assert.deepEqual([w.telegrams.length, w.posted.length, w.cancels.length, w.dispatches.length], [0, 0, 0, 0]);
  });
});

test('61 min waiting → one alert (Telegram + comment with marker); the second pass does NOT re-alert', async () => {
  await withWorld({ runs: [waitingRun(6101, 61)] }, async (w, pass) => {
    const r1 = await pass();
    assert.equal(r1.code, 0, r1.out);
    assert.equal(w.telegrams.length, 1);
    assert.equal(w.telegrams[0].chat_id, '42');
    assert.match(w.telegrams[0].text, /run 6101 · waiting>60 · /);
    assert.equal(w.posted.length, 1);
    assert.ok(w.posted[0].body.includes(marker('alerted', 6101)));
    assert.equal(w.created.length, 1, 'the log issue is created on first need');
    const r2 = await pass();
    assert.equal(r2.code, 0, r2.out);
    assert.equal(w.telegrams.length, 1, 'alerted twice');
    assert.equal(w.posted.length, 1);
    assert.equal(w.created.length, 1, 'a second log issue was created');
    assert.deepEqual([w.cancels.length, w.dispatches.length], [0, 0]);
  });
});

test('121 min waiting → cancel + exactly one re-run on main + comment + Telegram; a later pass does nothing more', async () => {
  await withWorld({ runs: [waitingRun(12101, 121)], issues: [{ number: 9, title: 'Pipeline stall guard log (TEN-396)' }] }, async (w, pass) => {
    const r1 = await pass();
    assert.equal(r1.code, 0, r1.out);
    assert.deepEqual(w.cancels, ['12101']);
    assert.deepEqual(w.dispatches, [{ ref: 'main' }]);
    assert.equal(w.posted.length, 1);
    assert.equal(w.posted[0].issue, '9');
    for (const k of ['alerted', 'cancelled', 'redispatched']) assert.ok(w.posted[0].body.includes(marker(k, 12101)), k);
    assert.equal(w.telegrams.length, 1);
    assert.match(w.telegrams[0].text, /run 12101 · cancelled \+ re-dispatched · /);
    await pass();
    assert.equal(w.cancels.length, 1);
    assert.equal(w.dispatches.length, 1);
    assert.equal(w.posted.length, 1);
  });
});

test('re-run only once: a run still waiting after the cancel gets the cancel re-sent but NO second dispatch', async () => {
  await withWorld({ runs: [waitingRun(12102, 125)], stickyCancel: true }, async (w, pass) => {
    await pass();
    const r2 = await pass();
    const r3 = await pass();
    assert.equal(w.dispatches.length, 1, 'dispatched more than once for one stall');
    assert.equal(w.cancels.length, 3);
    assert.equal(r2.code, 1, 'a cancel that does not take must turn the pass red');
    assert.equal(r3.code, 1);
    assert.equal(w.posted.length, 1);
  });
});

test('an in_progress run is never cancelled, even if the API hands it over as a candidate', async () => {
  const r = waitingRun(7001, 300, { runStatus: 'in_progress', jobStatus: 'in_progress' });
  // The run-level status alone must protect it, even if a job reads `waiting`.
  const r2 = waitingRun(7006, 300, { runStatus: 'in_progress' });
  await withWorld({ runs: [r, r2], ignoreStatusFilter: true }, async (w, pass) => {
    const res = await pass();
    assert.equal(res.code, 0, res.out);
    assert.deepEqual([w.cancels.length, w.dispatches.length, w.telegrams.length], [0, 0, 0]);
  });
});

test('a run in waiting whose job is executing is never cancelled', async () => {
  await withWorld({ runs: [waitingRun(7002, 300, { jobStatus: 'in_progress' })] }, async (w, pass) => {
    const res = await pass();
    assert.equal(res.code, 0, res.out);
    assert.deepEqual([w.cancels.length, w.dispatches.length], [0, 0]);
  });
});

test('a waiting job with a step in progress is never cancelled', async () => {
  await withWorld({ runs: [waitingRun(7003, 300, { steps: [{ name: 'x', status: 'in_progress' }] })] }, async (w, pass) => {
    await pass();
    assert.deepEqual([w.cancels.length, w.dispatches.length], [0, 0]);
  });
});

test('unreadable dedupe state → no action on the run, a red pass and one "needs a human" alert', async () => {
  await withWorld({ runs: [waitingRun(7004, 300)], issues: [{ number: 9, title: 'Pipeline stall guard log (TEN-396)' }], commentsStatus: 500 }, async (w, pass) => {
    const res = await pass();
    assert.equal(res.code, 1);
    assert.deepEqual([w.cancels.length, w.dispatches.length, w.posted.length], [0, 0, 0]);
    assert.equal(w.telegrams.length, 1);
    assert.match(w.telegrams[0].text, /can't reach its private log — needs a human/);
  });
});

test('Telegram not configured → the comment still lands and the pass is red', async () => {
  await withWorld({ runs: [waitingRun(7005, 90)] }, async (w, pass) => {
    const res = await pass({ TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' });
    assert.equal(res.code, 1);
    assert.equal(w.posted.length, 1);
    assert.match(w.posted[0].body, /^run 7005 · waiting>60 · /);
  });
});

// ── the workflow wiring ──────────────────────────────────────────────────────
test('workflow: rides workflow_run on the two pg_cron-dispatched workflows by their exact names, own group, right permissions', () => {
  const wf = (f) => fs.readFileSync(path.join(ROOT, '.github', 'workflows', f), 'utf8');
  const g = wf('pipeline-stall-guard.yml');
  const name = (f) => /^name:\s*(.+)$/m.exec(wf(f))[1].trim();
  assert.match(g, /^\s+workflow_run:\s*$/m);
  for (const f of ['pipeline.yml', 'oddspapi-postmatch.yml']) assert.ok(g.includes(`'${name(f)}'`), `${f} is renamed — the guard's trigger no longer matches it`);
  assert.match(g, /types: \[completed\]/);
  assert.match(g, /group: bsp-pipeline-stall-guard\n\s+cancel-in-progress: false/);
  assert.match(g, /actions: write/);
  assert.doesNotMatch(g, /issues: write/, 'the public repo needs no issue write: the log is private');
  assert.match(g, /LOG_TOKEN: \$\{\{ secrets\.WORKFLOW_PAT \}\}/);
  assert.match(g, /STALL_GUARD_LOG_REPO: \$\{\{ vars\.STALL_GUARD_LOG_REPO \|\| 'Michaeldk1996\/stennisfy-ops' \}\}/);
  assert.match(g, /run: node tools\/pipeline-stall-guard\.mjs/);
  assert.match(wf('oddspapi-postmatch.yml'), /workflow_dispatch/);
});

// A successful pipeline run (ends a stall episode) that completed `m` minutes ago.
const successRun = (id, m) => ({ run: { id, status: 'completed', conclusion: 'success', created_at: ago(m + 15), updated_at: ago(m) }, jobs: [] });

test('re-run once per EPISODE: the re-run (new run id) stalls too → cancelled, NO second dispatch, loud "needs a human"; a success ends the episode', async () => {
  // Last success 300 min ago: the stall episode started after it.
  await withWorld({ runs: [successRun(1, 300), waitingRun(13001, 125)] }, async (w, pass) => {
    await pass();
    assert.deepEqual([w.cancels.length, w.dispatches.length], [1, 1]);
    // The guard's re-run (new id) also stalls past 120 min; no success in between.
    const again = waitingRun(13002, 125); w.runs.set('13002', again);
    const r2 = await pass();
    assert.equal(r2.code, 1, 'a second stall in one episode must turn the pass red');
    assert.deepEqual(w.cancels, ['13001', '13002']);
    assert.equal(w.dispatches.length, 1, 're-dispatched a second time in one episode');
    assert.match(w.telegrams.at(-1).text, /needs a human/);
    assert.match(w.posted.at(-1).body, /^run 13002 · cancelled, needs a human · /);
    assert.ok(!w.posted.at(-1).body.includes(marker('redispatched', 13002)));
    // A later pass with nothing waiting does nothing more.
    await pass();
    assert.equal(w.dispatches.length, 1);
    // A successful run completes (episode over); a NEW stall gets its one re-run again.
    w.runs.set('2', successRun(2, 0));
    await new Promise((r) => setTimeout(r, 20));
    w.runs.set('13003', waitingRun(13003, 130));
    const r4 = await pass();
    assert.equal(r4.code, 0, r4.out);
    assert.equal(w.dispatches.length, 2, 'a new episode after a success must get its one re-run');
  });
});

test('no recorded success at all → only the first re-run is allowed (episode treated as open)', async () => {
  await withWorld({ runs: [waitingRun(13101, 125)] }, async (w, pass) => {
    await pass();
    w.runs.set('13102', waitingRun(13102, 125));
    await pass();
    assert.equal(w.dispatches.length, 1);
  });
});

test('log comment cannot be written → NO dispatch (cancel still sent), pass red, Telegram says needs a human; repeated passes never dispatch', async () => {
  await withWorld({ runs: [waitingRun(13201, 125)], stickyCancel: true, commentPostStatus: 500 }, async (w, pass) => {
    const r1 = await pass();
    const r2 = await pass();
    assert.equal(r1.code, 1);
    assert.equal(r2.code, 1);
    assert.equal(w.dispatches.length, 0, 'dispatched without recorded state');
    assert.deepEqual(w.cancels, ['13201', '13201']);
    assert.match(w.telegrams.at(-1).text, /run 13201 · cancelled, needs a human · /);
  });
});

// ── founder ruling on the log: private repo, minimal text ────────────────────
const STRICT_BODY = /^run \d+ · (waiting>60|cancelled \+ re-dispatched|cancelled, needs a human|needs a human) · \d{4}-\d\d-\d\dT\d\d:\d\dZ(\n\n<!-- pipeline-stall-guard:(alerted|cancelled|redispatched):\d+ -->(\n<!-- pipeline-stall-guard:(alerted|cancelled|redispatched):\d+ -->)*)?$/;
const STRICT_TG = /^Stennisfy pipeline: run \d+ · (waiting>60|cancelled \+ re-dispatched|cancelled, needs a human|needs a human) · \d{4}-\d\d-\d\dT\d\d:\d\dZ$/;

test('every comment and every Telegram is minimal: run id · state · UTC timestamp (+ hidden markers), and all go to the PRIVATE log with LOG_TOKEN', async () => {
  await withWorld({ runs: [successRun(1, 400), waitingRun(14001, 61), waitingRun(14002, 125)] }, async (w, pass) => {
    await pass();
    w.runs.set('14003', waitingRun(14003, 125));   // second stall in the episode → needs a human
    await pass();
    assert.ok(w.posted.length >= 3, `only ${w.posted.length} comments`);
    for (const c of w.posted) assert.match(c.body, STRICT_BODY);
    assert.ok(w.telegrams.length >= 3);
    for (const t of w.telegrams) assert.match(t.text, STRICT_TG);
    assert.deepEqual(w.publicIssueCalls, [], 'touched issues on the public repo');
    assert.deepEqual([...w.logAuth], ['Bearer PAT'], 'log calls must use LOG_TOKEN, never GH_TOKEN');
  });
});

for (const [label, status] of [['403', 403], ['404', 404]]) {
  test(`log repo ${label} → no cancel, no dispatch, pass red, Telegram "can't reach its private log — needs a human", nothing on the public repo`, async () => {
    await withWorld({ runs: [waitingRun(15001, 125)], logStatus: status }, async (w, pass) => {
      const r = await pass();
      assert.equal(r.code, 1);
      assert.deepEqual([w.cancels.length, w.dispatches.length, w.posted.length], [0, 0, 0]);
      assert.equal(w.telegrams.length, 1);
      assert.match(w.telegrams[0].text, /^Stennisfy pipeline: stall guard can't reach its private log — needs a human · \d{4}-\d\d-\d\dT\d\d:\d\dZ$/);
      assert.deepEqual(w.publicIssueCalls, []);
    });
  });
}

test('no LOG_TOKEN at all → treated as unreachable: no action, red, alert', async () => {
  await withWorld({ runs: [waitingRun(15002, 125)] }, async (w, pass) => {
    const r = await pass({ LOG_TOKEN: '' });
    assert.equal(r.code, 1);
    assert.deepEqual([w.cancels.length, w.dispatches.length], [0, 0]);
    assert.match(w.telegrams[0].text, /can't reach its private log/);
  });
});

test('the log repo can never be the public repo', async () => {
  await withWorld({ runs: [waitingRun(15003, 125)] }, async (w, pass) => {
    const r = await pass({ STALL_GUARD_LOG_REPO: REPO });
    assert.equal(r.code, 1);
    assert.deepEqual([w.cancels.length, w.dispatches.length, w.publicIssueCalls.length], [0, 0, 0]);
  });
});

test('quiet pass (nothing waiting, not a health pass) does not touch the log', async () => {
  await withWorld({ logStatus: 403 }, async (w, pass) => {
    const r = await pass();
    assert.equal(r.code, 0, r.out);
    assert.equal(w.logAuth.size, 0);
    assert.equal(w.telegrams.length, 0);
  });
});

test('health pass with nothing waiting still checks the log: 403 → red + alert', async () => {
  await withWorld({ logStatus: 403 }, async (w, pass) => {
    const r = await pass({ STALL_GUARD_HEALTH: '1' });
    assert.equal(r.code, 1);
    assert.match(w.telegrams[0].text, /can't reach its private log/);
  });
});

test('token expiry < 7 days → one renew warning per UTC day; ≥ 7 days → none', async () => {
  const soon = new Date(Date.now() + 3 * 86400000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  await withWorld({ tokenExpiry: soon }, async (w, pass) => {
    const r1 = await pass({ STALL_GUARD_HEALTH: '1' });
    await pass({ STALL_GUARD_HEALTH: '1' });
    assert.equal(r1.code, 1);
    assert.equal(w.telegrams.length, 1, 'warned more than once in a day');
    assert.match(w.telegrams[0].text, /WORKFLOW_PAT expires/);
    assert.match(w.posted[0].body, /^token · expires \S+ · \S+\n\n<!-- pipeline-stall-guard:tokenwarn:\d{8} -->$/);
  });
  const later = new Date(Date.now() + 9 * 86400000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  await withWorld({ tokenExpiry: later }, async (w, pass) => {
    const r = await pass({ STALL_GUARD_HEALTH: '1' });
    assert.equal(r.code, 0, r.out);
    assert.equal(w.telegrams.length, 0);
  });
});

test('dry run reads the log, prints scopes/expiry, writes nothing anywhere', async () => {
  await withWorld({ runs: [waitingRun(16001, 125)], tokenExpiry: '2026-10-25 02:15:28 UTC' }, async (w, pass) => {
    const r = await pass({ STALL_GUARD_DRY_RUN: '1' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /LOG_TOKEN expires: 2026-10-25 02:15:28 UTC/);
    assert.deepEqual([w.cancels.length, w.dispatches.length, w.posted.length, w.created.length, w.telegrams.length], [0, 0, 0, 0, 0]);
  });
});
