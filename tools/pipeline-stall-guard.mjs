#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// TEN-396 — pipeline stall guard. Founder ruling (TEN-384 comment, 7 Oct 12:37Z):
//   "Alert when a pipeline run has sat in the waiting state for more than 1 hour.
//    After 2 hours, auto-cancel it, re-run once and post a comment. Never cancel a
//    run that is actually executing."
//
// The incident: pipeline.yml run 37518167732 (6 Oct 19:20Z) sat in GitHub status
// `waiting` on the `github-pages` environment for ~16.5 h. It held the single
// `bsp-pipeline` concurrency group, so all 106 later ticks ended `cancelled` while
// pending and the site froze. Cancelling it freed the group.
//
// What this does, per pass (driven by .github/workflows/pipeline-stall-guard.yml):
//   1. list pipeline.yml runs in status `waiting` (only that status: `queued` /
//      `pending` runs sit behind the group and start by themselves once the waiting
//      run is gone; `in_progress` is executing and is never a candidate);
//   2. for each, read its jobs. A run with any job `in_progress` (or any step
//      `in_progress`) is EXECUTING and is never touched. A run with no job in
//      `waiting` is not measurable and is left alone (logged);
//   3. waiting since = the latest started_at of its `waiting` jobs (GitHub stamps it
//      when the job reaches the environment gate — 19:27:28Z in the incident, the
//      second the previous run freed the group), never earlier than run_started_at.
//      Taking the LATEST makes the age a lower bound, so the guard can be late but
//      never early;
//   4. waiting > ALERT_AFTER_MIN (60)  → one alert (Telegram + log-issue comment);
//      waiting > CANCEL_AFTER_MIN (120) → re-check the run is still `waiting` and
//      not executing, cancel it, dispatch ONE fresh pipeline.yml run on main, post
//      a comment, alert.
//
// Dedupe state lives in the comments of one GitHub issue (the "post a comment"
// destination): each comment carries hidden markers
//   <!-- pipeline-stall-guard:alerted:<runId> -->, :cancelled:, :redispatched:
// so the log the founder reads IS the state. No commit to main per tick, no cache
// eviction, survives runner loss. If the issue cannot be read the pass takes NO
// action and exits red — an unreadable state never turns into a second re-run.
//
// Env: GH_TOKEN (actions:write + issues:write), GITHUB_REPOSITORY,
//      TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (founder chat; TEN-280/294/347),
//      STALL_GUARD_ISSUE (optional issue number; else found/created by title),
//      GITHUB_API_URL / TELEGRAM_API_URL (overridable — the test points them at a
//      fake server), STALL_GUARD_DRY_RUN=1 (log decisions, write nothing).
// Test: test-ten396-stall-guard.mjs (spawns THIS file against a fake GitHub API).
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ALERT_AFTER_MIN = 60;
export const CANCEL_AFTER_MIN = 120;
export const PIPELINE_WORKFLOW = 'pipeline.yml';
export const LOG_ISSUE_TITLE = 'Pipeline stall guard log (TEN-396)';
const MARK = 'pipeline-stall-guard';
const MIN = 60000;

export const marker = (kind, runId) => `<!-- ${MARK}:${kind}:${runId} -->`;

// Markers already posted, from the log issue's comment bodies.
export function readMarkers(comments) {
  // redispatchedAt: when each re-run was recorded (comment created_at) — the
  // episode rule compares these with the last successful pipeline run.
  const seen = { alerted: new Set(), cancelled: new Set(), redispatched: new Set(), redispatchedAt: [] };
  const re = new RegExp(`<!-- ${MARK}:(alerted|cancelled|redispatched):(\\d+) -->`, 'g');
  for (const c of comments || []) {
    let m;
    while ((m = re.exec(String(c.body || '')))) {
      seen[m[1]].add(m[2]);
      if (m[1] === 'redispatched') seen.redispatchedAt.push(Date.parse(c.created_at));
    }
  }
  return seen;
}

// Is any part of this run executing? A run is executing if its own status says so
// or any job/step is in_progress. Unknown job shapes count as executing (safe side).
export function isExecuting(run, jobs) {
  if (run.status === 'in_progress') return true;
  for (const j of jobs || []) {
    if (j.status === 'in_progress') return true;
    if ((j.steps || []).some((s) => s.status === 'in_progress')) return true;
  }
  return false;
}

// Minutes the run has been waiting, or null when it cannot be measured.
export function waitingMinutes(run, jobs, now) {
  const waiting = (jobs || []).filter((j) => j.status === 'waiting');
  if (!waiting.length) return null;
  let since = Date.parse(run.run_started_at || run.created_at);
  for (const j of waiting) {
    const t = Date.parse(j.started_at || j.created_at);
    if (!Number.isFinite(t)) return null;
    if (!Number.isFinite(since) || t > since) since = t;
  }
  if (!Number.isFinite(since)) return null;
  return (now - since) / MIN;
}

// "Re-run once" is per stall EPISODE, not per run id: the re-run gets a new id and
// can stall too. An episode ends when a pipeline run completes successfully, so a
// re-run is allowed only if no re-run was recorded after the last success (or the
// last success is unknown → treat the episode as open: never a second re-run on
// a guess). A recorded re-run with an unparseable time also counts as open.
export function rerunAllowed(markers, lastSuccessAt) {
  if (!Number.isFinite(lastSuccessAt)) return markers.redispatchedAt.length === 0;
  return !markers.redispatchedAt.some((t) => !Number.isFinite(t) || t > lastSuccessAt);
}

// Pure decision for one run. Returns { action, mins, reason }.
//   action: 'none' | 'alert' | 'cancel' | 'recancel'
export function decide({ run, jobs, now, markers }) {
  const id = String(run.id);
  if (run.status !== 'waiting') return { action: 'none', reason: `status ${run.status}` };
  if (isExecuting(run, jobs)) return { action: 'none', reason: 'a job is executing — never cancelled' };
  const mins = waitingMinutes(run, jobs, now);
  if (mins == null) return { action: 'none', reason: 'no job in waiting — age not measurable' };
  if (mins > CANCEL_AFTER_MIN) {
    if (markers.cancelled.has(id)) return { action: 'recancel', mins, reason: 'already cancelled once, still waiting' };
    return { action: 'cancel', mins, reason: `waiting ${mins.toFixed(1)} min > ${CANCEL_AFTER_MIN}` };
  }
  if (mins > ALERT_AFTER_MIN) {
    if (markers.alerted.has(id)) return { action: 'none', mins, reason: 'already alerted' };
    return { action: 'alert', mins, reason: `waiting ${mins.toFixed(1)} min > ${ALERT_AFTER_MIN}` };
  }
  return { action: 'none', mins, reason: `waiting ${mins.toFixed(1)} min ≤ ${ALERT_AFTER_MIN}` };
}

// ── I/O ──────────────────────────────────────────────────────────────────────

function client(env) {
  const base = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const repo = env.GITHUB_REPOSITORY || 'michaeldk1996/SAAS';
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (!token) throw new Error('GH_TOKEN is not set');
  return async function gh(method, path, body) {
    const url = `${base}/repos/${repo}${path}`;
    const r = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    return { status: r.status, json };
  };
}

async function telegram(env, text) {
  const tok = env.TELEGRAM_BOT_TOKEN, chat = env.TELEGRAM_CHAT_ID;
  if (!tok || !chat) return { ok: false, why: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set' };
  const base = (env.TELEGRAM_API_URL || 'https://api.telegram.org').replace(/\/$/, '');
  try {
    const r = await fetch(`${base}/bot${tok}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(20000),
    });
    return { ok: r.status >= 200 && r.status < 300, why: `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, why: e.name };   // never echo the URL: it carries the bot token
  }
}

async function allComments(gh, issue) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const r = await gh('GET', `/issues/${issue}/comments?per_page=100&page=${page}`);
    if (r.status !== 200 || !Array.isArray(r.json)) throw new Error(`reading issue #${issue} comments: HTTP ${r.status}`);
    out.push(...r.json);
    if (r.json.length < 100) return out;
  }
  return out;
}

async function findOrCreateIssue(gh, env, log) {
  if (env.STALL_GUARD_ISSUE) return Number(env.STALL_GUARD_ISSUE);
  for (let page = 1; page <= 10; page++) {
    const r = await gh('GET', `/issues?state=all&per_page=100&page=${page}`);
    if (r.status !== 200 || !Array.isArray(r.json)) throw new Error(`listing issues: HTTP ${r.status}`);
    const hit = r.json.find((i) => !i.pull_request && i.title === LOG_ISSUE_TITLE);
    if (hit) return hit.number;
    if (r.json.length < 100) break;
  }
  if (env.STALL_GUARD_DRY_RUN === '1') { log('dry run: log issue does not exist and would be created'); return null; }
  const c = await gh('POST', '/issues', {
    title: LOG_ISSUE_TITLE,
    body: 'Written by `.github/workflows/pipeline-stall-guard.yml` (TEN-396). One comment per stalled '
      + '`pipeline.yml` run: alert after 60 min in `waiting`, cancel + one re-run after 120 min. The hidden '
      + 'markers in these comments are the guard\'s dedupe state — do not edit or delete them.',
  });
  if (c.status !== 201) throw new Error(`creating the log issue: HTTP ${c.status}`);
  return c.json.number;
}

const fmt = (iso) => String(iso || '?').replace('T', ' ').replace(/:\d\dZ$/, 'Z');

export async function runGuard(env = process.env, log = console.log) {
  const gh = client(env);
  const dry = env.STALL_GUARD_DRY_RUN === '1';
  const now = Date.now();
  let red = false;

  const lr = await gh('GET', `/actions/workflows/${PIPELINE_WORKFLOW}/runs?status=waiting&per_page=50`);
  if (lr.status !== 200) throw new Error(`listing waiting runs: HTTP ${lr.status}`);
  const runs = (lr.json && lr.json.workflow_runs) || [];
  log(`${runs.length} ${PIPELINE_WORKFLOW} run(s) in status waiting`);
  if (!runs.length) return { red, actions: [] };

  // State BEFORE any decision; unreadable state → no action at all.
  const issue = await findOrCreateIssue(gh, env, log);
  const markers = readMarkers(issue == null ? [] : await allComments(gh, issue));

  const actions = [];
  for (const run of runs) {
    const jr = await gh('GET', `/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
    if (jr.status !== 200) { log(`::warning::run ${run.id}: jobs unreadable (HTTP ${jr.status}) — left alone`); continue; }
    const jobs = (jr.json && jr.json.jobs) || [];
    const d = decide({ run, jobs, now, markers });
    log(`run ${run.id} (#${run.run_number}, created ${run.created_at}): ${d.action} — ${d.reason}`);
    actions.push({ runId: run.id, ...d });
    if (d.action === 'none' || dry) continue;

    const url = run.html_url || `https://github.com/${env.GITHUB_REPOSITORY || 'michaeldk1996/SAAS'}/actions/runs/${run.id}`;
    const since = new Date(now - d.mins * MIN).toISOString();
    const head = `Pipeline run ${run.id} has sat in GitHub "waiting" for ${Math.round(d.mins)} min (since ${fmt(since)}). `
      + 'It holds the bsp-pipeline group, so no tick can deploy and the site is frozen.';

    if (d.action === 'alert') {
      const tg = await telegram(env, `Stennisfy: ${head} If it is still waiting at 120 min it will be cancelled and re-run automatically. ${url}`);
      if (!tg.ok) { red = true; log(`::error::Telegram alert not delivered (${tg.why})`); }
      const cr = await gh('POST', `/issues/${issue}/comments`, {
        body: `**Alert** — ${head}\n\nAuto-cancel + one re-run at ${CANCEL_AFTER_MIN} min. Telegram: ${tg.ok ? 'sent' : `NOT sent (${tg.why})`}. ${url}\n\n${marker('alerted', run.id)}`,
      });
      if (cr.status !== 201) { red = true; log(`::error::log comment not posted (HTTP ${cr.status})`); }
      continue;
    }

    // cancel / recancel: re-read the run and its jobs right before acting.
    const fresh = await gh('GET', `/actions/runs/${run.id}`);
    const fj = await gh('GET', `/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
    if (fresh.status !== 200 || fj.status !== 200) { red = true; log(`::error::run ${run.id}: re-read failed — not cancelled`); continue; }
    const recheck = decide({ run: fresh.json, jobs: (fj.json && fj.json.jobs) || [], now: Date.now(), markers });
    if (recheck.action !== d.action) { log(`run ${run.id}: changed before acting (${recheck.reason}) — not cancelled`); continue; }

    if (d.action === 'recancel') {
      // Cancelled once already and still waiting: cancel again, never a second re-run.
      const rx = await gh('POST', `/actions/runs/${run.id}/cancel`);
      red = true;
      log(`::error::run ${run.id} still waiting after an earlier cancel — cancel re-sent (HTTP ${rx.status}), no second re-run`);
      continue;
    }

    // Episode rule: has this stall already had its one re-run?
    const ls = await gh('GET', `/actions/workflows/${PIPELINE_WORKFLOW}/runs?status=success&per_page=1`);
    const lastOk = ls.status === 200 && ls.json && ls.json.workflow_runs && ls.json.workflow_runs[0];
    const lastSuccessAt = lastOk ? Date.parse(lastOk.updated_at) : NaN;
    const mayRerun = rerunAllowed(markers, lastSuccessAt);

    // State FIRST: the markers (incl. the re-run intent) are written before the
    // dispatch. If they cannot be written, no dispatch — otherwise a cancel that
    // does not take would re-dispatch every pass.
    const marks = [marker('alerted', run.id), marker('cancelled', run.id)];
    if (mayRerun) marks.push(marker('redispatched', run.id));
    const plan = mayRerun
      ? 'cancelling it and dispatching ONE fresh pipeline.yml run on main'
      : 'cancelling it with NO re-run: this stall episode was already re-run once since the last successful pipeline run and it stalled again — needs a human';
    const cr = await gh('POST', `/issues/${issue}/comments`, {
      body: `**Cancelling** — ${head}\n\nThe run is not executing (no job or step in progress). ${plan}. ${url}\n\n${marks.join('\n')}`,
    });
    const stateOk = cr.status === 201;
    if (!stateOk) { red = true; log(`::error::log comment not posted (HTTP ${cr.status}) — no re-run will be dispatched without recorded state`); }
    markers.cancelled.add(String(run.id));
    if (stateOk && mayRerun) { markers.redispatched.add(String(run.id)); markers.redispatchedAt.push(Date.now()); }

    const cx = await gh('POST', `/actions/runs/${run.id}/cancel`);
    if (cx.status !== 202) {
      red = true;
      log(`::error::cancel of run ${run.id} refused: HTTP ${cx.status}`);
      await telegram(env, `Stennisfy: ${head} The guard tried to cancel it and GitHub refused (HTTP ${cx.status}). A human must cancel it: ${url}`);
      continue;
    }

    let note;
    if (!stateOk) {
      note = 'cancelled, but NOT re-run: the guard could not record its state (log comment failed) — needs a human';
    } else if (!mayRerun) {
      red = true;
      note = 'cancelled, NOT re-run: it stalled again after the one re-run of this episode — needs a human';
      log(`::error::stalled twice in one episode — run ${run.id} cancelled, no second re-run`);
    } else {
      const dr = await gh('POST', `/actions/workflows/${PIPELINE_WORKFLOW}/dispatches`, { ref: 'main' });
      if (dr.status === 204) note = 'cancelled it automatically (founder ruling TEN-396) and dispatched one fresh pipeline.yml run on main';
      else { red = true; note = `cancelled it, but the re-run dispatch FAILED (HTTP ${dr.status}); the next */10 tick will start anyway`; }
    }
    const tg = await telegram(env, `Stennisfy: ${head} ${note}. ${url}`);
    if (!tg.ok) { red = true; log(`::error::Telegram notice not delivered (${tg.why})`); }
  }
  return { red, actions };
}

async function main() {
  try {
    const { red } = await runGuard();
    process.exit(red ? 1 : 0);
  } catch (e) {
    console.log(`::error::pipeline stall guard could not complete a pass, so it took no further action: ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
