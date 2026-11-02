#!/usr/bin/env node
// Instant job-failure alert (founder 2026-11-01, Task C: "I hear about any failure the same day" — an instant Telegram to the
// pipeline-alerts chat, not Data Alerts, when a data run publishes nothing or any scheduled job fails or is cancelled).
// Run by .github/workflows/job-fail-alert.yml on every completed run of the watched workflows (workflow_run).
//
// One message per failure streak per workflow, then one RECOVERED line when it next succeeds (never a message per tick):
//   failure / timed_out / startup_failure / action_required -> alert, unless the previous decisive run of that workflow
//                                                             failed too (the streak was already reported)
//   cancelled                                               -> alert like a failure only if a job of the run STARTED; a run
//                                                             cancelled while queued (a newer tick superseded it, the
//                                                             concurrency groups' normal work) is skipped and counted
//   success, data pipeline ('BSP data pipeline')            -> a run that uploaded no data artifact (PUBLISHERS) published
//                                                             nothing: alert (its own streak)
//   success after a reported streak                         -> RECOVERED line
// Main-branch runs only (a probe branch never alerts). Pure decisions (`decide`) are exported for the tests.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DATA_PIPELINE = 'BSP data pipeline';
// the runs that must upload a data artifact, and its name: the data pipeline's `site-data`, and the alert dry run's
// `alert-dry-data` (Task C's deliberately broken real run). The dry run never uploads `site-data`: publish.yml takes the
// newest artifact of that name from ANY workflow (tools/publish-resolve.mjs pickData), so a dry run would publish itself.
export const PUBLISHERS = new Map([[DATA_PIPELINE, 'site-data'], ['Alert dry run', 'alert-dry-data']]);
const BAD = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);

// a run whose jobs never started (cancelled while queued) is not a decisive outcome
export const started = (jobs) => (jobs || []).some((j) => j && j.started_at && (j.steps || []).some((s) => s.status === 'completed' || s.status === 'in_progress'));

// a run's outcome: 'bad' | 'ok' | 'nothing' (a data run that published nothing) | null (not decisive: superseded / in progress)
export function outcome(run, jobs, artifacts) {
  if (!run || run.status !== 'completed') return null;
  if (run.conclusion === 'cancelled') return started(jobs) ? 'bad' : null;
  if (BAD.has(run.conclusion)) return 'bad';
  if (run.conclusion === 'success') {
    if (PUBLISHERS.has(run.name) && artifacts && !artifacts.some((a) => a.name === PUBLISHERS.get(run.name))) return 'nothing';
    return 'ok';
  }
  return null;   // skipped / neutral / stale
}

// `prev` = the outcome of the newest earlier decisive run of the same workflow (null when none is known)
export function decide(run, cur, prev) {
  if (!run || run.head_branch !== 'main') return { action: 'skip', why: 'not main' };
  if (cur === null) return { action: 'skip', why: run.conclusion === 'cancelled' ? 'cancelled before any job started (superseded)' : 'not a decisive outcome' };
  const when = String(run.updated_at || run.created_at || '').replace(/:\d\d(\.\d+)?Z$/, 'Z');
  const where = `run ${run.id} · ${when}`;
  if (cur === 'ok') return prev === 'bad' || prev === 'nothing'
    ? { action: 'send', text: `✅ RECOVERED · ${run.name} succeeded again · ${where}` }
    : { action: 'skip', why: 'success' };
  if (prev === cur) return { action: 'skip', why: 'the same streak was already reported' };
  if (cur === 'nothing') return { action: 'send', text: `🔴 ${run.name} published NOTHING (no site data uploaded) · ${where} · the site keeps the last good data · ${run.html_url}` };
  const what = run.conclusion === 'cancelled' ? 'was CANCELLED mid-run' : run.conclusion === 'timed_out' ? 'TIMED OUT' : 'FAILED';
  return { action: 'send', text: `🔴 ${run.name} ${what} · ${where} · ${run.html_url}` };
}

async function gh(path) {
  const r = await fetch(`https://api.github.com${path}`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GitHub ${path}: HTTP ${r.status}`);
  return r.json();
}

async function main() {
  const ev = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const run = ev.workflow_run, repo = process.env.GITHUB_REPOSITORY;
  const info = async (r) => {
    const jobs = r.conclusion === 'cancelled' ? (await gh(`/repos/${repo}/actions/runs/${r.id}/jobs?per_page=50`)).jobs : null;
    const arts = PUBLISHERS.has(r.name) && r.conclusion === 'success' ? (await gh(`/repos/${repo}/actions/runs/${r.id}/artifacts?per_page=50`)).artifacts : null;
    return outcome(r, jobs, arts);
  };
  const cur = await info(run);
  let prev = null;
  if (cur !== null && run.head_branch === 'main') {
    const list = (await gh(`/repos/${repo}/actions/workflows/${run.workflow_id}/runs?branch=main&status=completed&per_page=30`)).workflow_runs || [];
    for (const r of list.filter((x) => x.id !== run.id && Date.parse(x.created_at) < Date.parse(run.created_at))) {
      const o = await info(r);
      if (o !== null) { prev = o; break; }
    }
  }
  const d = decide(run, cur, prev);
  console.log(JSON.stringify({ workflow: run.name, run: run.id, conclusion: run.conclusion, outcome: cur, previous: prev, ...d }));
  if (d.action !== 'send') return 0;
  const tok = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!tok || !chat) { console.log(`::error::job alert NOT sent (no Telegram secret): ${d.text}`); return 1; }
  const r = await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: `Stennisfy: ${d.text}`, disable_web_page_preview: true }) });
  console.log(`Telegram: HTTP ${r.status}`);
  if (!r.ok) { console.log(`::error::job alert Telegram failed (HTTP ${r.status}): ${d.text}`); return 1; }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().then((c) => process.exit(c), (e) => { console.log(`::error::job-fail-alert: ${e.message}`); process.exit(1); });
