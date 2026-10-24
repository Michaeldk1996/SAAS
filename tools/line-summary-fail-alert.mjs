#!/usr/bin/env node
// Founder brief 2026-10-24 (bet105-line-prices, Part 1 item 2): alert on ten225-line-summary.yml failures — CANCELLED
// RUNS TOO. That job hit its 60-minute limit on 21 of 30 runs (6–23 Oct); a timeout reads "cancelled", the existing
// pipeline alert skips cancelled runs, and nothing else watched this workflow, so 19 days went by unseen.
//
// Runs from line-summary-fail-alert.yml on `workflow_run: completed` for ten225-line-summary.yml, which GitHub fires for
// every conclusion. The line summary loads once a day, so EVERY run that does not succeed is one message (no streak
// rule: one missed run is one missed day). The message names the run, its conclusion and the step(s) that did not pass.
// Never fails the job for an unsent alert: it is an ::error:: in the log and the step summary instead.
// Env: GH_TOKEN, GITHUB_REPOSITORY, RUN_ID (the triggering run), TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID;
// GITHUB_API_URL / TELEGRAM_API_URL point the test at fake servers (tools/test-line-summary-fail-alert.mjs).
import { appendFileSync } from 'node:fs';
import { sendTelegram } from './price-alert-send.mjs';
import { plainStep } from './pipeline-fail-alert.mjs';

const NOT_OK = new Set(['failure', 'timed_out', 'startup_failure', 'cancelled', 'action_required', 'stale']);

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
  const jobs = (await gh(env, `/actions/runs/${runId}/jobs?filter=latest&per_page=100`)).jobs || [];
  const steps = jobs.flatMap(j => (j.steps || []).filter(s => NOT_OK.has(s.conclusion)).map(s => `${plainStep(s.name)} (${s.conclusion})`));
  const mins = run.run_started_at && run.updated_at ? Math.round((Date.parse(run.updated_at) - Date.parse(run.run_started_at)) / 60000) : null;
  const text = [`Stennisfy line-summary load ${run.conclusion.toUpperCase()} (run ${run.run_number}${mins != null ? `, after ${mins} min` : ''}).`,
    steps.length ? `Step: ${steps.join('; ')}.` : 'GitHub names no failing step (the job itself stopped).',
    run.conclusion === 'cancelled' ? 'A cancelled run usually means the 60-minute job limit: the summary did not finish loading.' : '',
    'oddspapi_line_summary keeps the last good load until a run passes.', run.html_url || ''].filter(Boolean).join('\n');
  return { alert: true, text };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const d = await decide(process.env);
    if (!d.alert) { console.log(`line-summary alert: no message (${d.why})`); process.exit(0); }
    const r = await sendTelegram(d.text, process.env);
    if (r.ok) console.log(`line-summary alert: Telegram sent (${r.why})`);
    else { console.log(`::error title=Line-summary alert not sent::Telegram ${r.why}`); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Line-summary alert NOT sent (${r.why})\n\n${d.text}\n`); }
    console.log(d.text);
  } catch (e) {
    console.log(`::error title=Line-summary alert::could not read the run (${e.message}) — no message sent`);
  }
}
