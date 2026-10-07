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
function fakeWorld({ runs = [], issues = [], comments = {}, stickyCancel = false, commentsStatus = 200, ignoreStatusFilter = false } = {}) {
  const w = { runs: new Map(runs.map((r) => [String(r.run.id), r])), issues, comments, cancels: [], dispatches: [],
    posted: [], telegrams: [], created: [], stickyCancel, commentsStatus, ignoreStatusFilter };
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const send = (s, j) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(j == null ? '' : JSON.stringify(j)); };
      const p = u.pathname;
      const pre = `/repos/${REPO}`;
      let m;
      if (req.method === 'POST' && (m = /^\/botTOKEN\/sendMessage$/.exec(p))) { w.telegrams.push(JSON.parse(body)); return send(200, { ok: true }); }
      if (!p.startsWith(pre)) return send(404, {});
      const q = p.slice(pre.length);
      if (req.method === 'GET' && q === '/actions/workflows/pipeline.yml/runs') {
        const st = u.searchParams.get('status');
        const list = [...w.runs.values()].map((r) => r.run).filter((r) => w.ignoreStatusFilter || !st || r.status === st);
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
        const c = { id: Date.now(), body: JSON.parse(body).body };
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
    const env = { PATH: process.env.PATH, GH_TOKEN: 'x', GITHUB_REPOSITORY: REPO, GITHUB_API_URL: base,
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
    assert.match(w.telegrams[0].text, /6101.*waiting/);
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
    assert.match(w.telegrams[0].text, /Cancelled/);
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
    assert.match(res.out, /executing/);
    assert.deepEqual([w.cancels.length, w.dispatches.length], [0, 0]);
  });
});

test('a waiting job with a step in progress is never cancelled', async () => {
  await withWorld({ runs: [waitingRun(7003, 300, { steps: [{ name: 'x', status: 'in_progress' }] })] }, async (w, pass) => {
    await pass();
    assert.deepEqual([w.cancels.length, w.dispatches.length], [0, 0]);
  });
});

test('unreadable dedupe state → no action at all and a red pass', async () => {
  await withWorld({ runs: [waitingRun(7004, 300)], issues: [{ number: 9, title: 'Pipeline stall guard log (TEN-396)' }], commentsStatus: 500 }, async (w, pass) => {
    const res = await pass();
    assert.equal(res.code, 1);
    assert.deepEqual([w.cancels.length, w.dispatches.length, w.telegrams.length, w.posted.length], [0, 0, 0, 0]);
  });
});

test('Telegram not configured → the comment still lands, says NOT sent, and the pass is red', async () => {
  await withWorld({ runs: [waitingRun(7005, 90)] }, async (w, pass) => {
    const res = await pass({ TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' });
    assert.equal(res.code, 1);
    assert.equal(w.posted.length, 1);
    assert.match(w.posted[0].body, /NOT sent/);
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
  assert.match(g, /issues: write/);
  assert.match(g, /run: node tools\/pipeline-stall-guard\.mjs/);
  assert.match(wf('oddspapi-postmatch.yml'), /workflow_dispatch/);
});
