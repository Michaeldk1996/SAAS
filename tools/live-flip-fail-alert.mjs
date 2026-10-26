#!/usr/bin/env node
// Live-flip recorder (founder brief 2026-10-26, item 2): alert the ops Telegram when ten225-live-flip.yml does not
// succeed — CANCELLED RUNS TOO. It failed on every run from 19 Sep to 26 Oct and nothing told anyone; its read-back is
// also the only hourly look at whether start recording is alive (live_flip_log stopped on 24 Oct, unseen).
//
// Runs from live-flip-fail-alert.yml on `workflow_run: completed`, which GitHub fires for every conclusion. The workflow
// is hourly, so a message per failed run would be 24 a day: a non-success run alerts when it is the FIRST after a
// success, or the first of its UTC day (a daily reminder naming the streak). Everything else is logged, not sent.
// Never fails the job for an unsent alert: it is an ::error:: in the log and the step summary instead.
// Env: GH_TOKEN, GITHUB_REPOSITORY, RUN_ID (the triggering run), TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ALERT_TEST;
// GITHUB_API_URL / TELEGRAM_API_URL point the test at fake servers (tools/test-live-flip-fail-alert.mjs).
import { appendFileSync } from 'node:fs';
import { sendTelegram } from './price-alert-send.mjs';
import { plainStep } from './pipeline-fail-alert.mjs';

export const NOT_OK = new Set(['failure', 'timed_out', 'startup_failure', 'cancelled', 'action_required', 'stale']);

async function gh(env, path) {
  const base = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const r = await fetch(`${base}/repos/${env.GITHUB_REPOSITORY}${path}`, { headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(20000) });
  if (r.status !== 200) throw new Error(`GitHub ${path.split('?')[0]}: HTTP ${r.status}`);
  return r.json();
}

// returns { alert: bool, text, why }
export async function decide(env) {
  const runId = String(env.RUN_ID || '');
  if (!/^\d+$/.test(runId)) throw new Error('RUN_ID is not a run id');
  const run = await gh(env, `/actions/runs/${runId}`);
  if (run.status !== 'completed') return { alert: false, why: `run ${runId} is ${run.status}, not completed` };
  if (!NOT_OK.has(run.conclusion)) return { alert: false, why: `run ${runId} concluded ${run.conclusion}` };
  // the earlier completed runs on the same branch: how long the streak is, and whether today has already been told
  const list = (await gh(env, `/actions/workflows/${run.workflow_id}/runs?status=completed&branch=${encodeURIComponent(run.head_branch || '')}&per_page=100`)).workflow_runs || [];
  const before = list.filter(r => r.id !== run.id && Date.parse(r.created_at) < Date.parse(run.created_at))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  let streak = 1;
  for (const r of before) { if (NOT_OK.has(r.conclusion)) streak++; else break; }
  const prev = before[0];
  const day = (r) => String(r.created_at || '').slice(0, 10);
  const first = !prev || !NOT_OK.has(prev.conclusion);
  if (!first && day(prev) === day(run) && !env.ALERT_TEST)
    return { alert: false, why: `run ${runId} ${run.conclusion}: ${streak} in a row, already alerted on ${day(run)} (UTC)` };
  const jobs = (await gh(env, `/actions/runs/${runId}/jobs?filter=latest&per_page=100`)).jobs || [];
  const steps = jobs.flatMap(j => (j.steps || []).filter(s => NOT_OK.has(s.conclusion)).map(s => `${plainStep(s.name)} (${s.conclusion})`));
  const text = [`Stennisfy live-flip recorder check ${run.conclusion.toUpperCase()} (run ${run.run_number}).`,
    steps.length ? `Step: ${steps.join('; ')}.` : 'GitHub names no failing step (the job itself stopped).',
    first ? 'First failure after a passing run.' : `Still failing: ${streak} runs in a row (daily reminder).`,
    'This hourly check reads back live_flip_log, where match start times are recorded; while it fails, nothing confirms starts are being recorded.',
    run.html_url || ''].filter(Boolean).join('\n');
  return { alert: true, text };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const d = await decide(process.env);
    if (!d.alert) { console.log(`live-flip alert: no message (${d.why})`); process.exit(0); }
    // A manual replay (ALERT_TEST, the workflow's dispatch path) says so on its first line — never mistaken for a live failure.
    if (process.env.ALERT_TEST) d.text = 'TEST — no action needed. A replay of the alert for an earlier run, proving the ops chat receives it.\n' + d.text;
    const r = await sendTelegram(d.text, process.env);
    if (r.ok) console.log(`live-flip alert: Telegram sent (${r.why})`);
    else { console.log(`::error title=Live-flip alert not sent::Telegram ${r.why}`); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Live-flip alert NOT sent (${r.why})\n\n${d.text}\n`); }
    console.log(d.text);
  } catch (e) {
    console.log(`::error title=Live-flip alert::could not read the run (${e.message}) — no message sent`);
  }
}
