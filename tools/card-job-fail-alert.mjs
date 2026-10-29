#!/usr/bin/env node
// card-job-lock (2026-10-28): alert the ops Telegram when the card job, ten232-kibl-archive.yml, does not succeed —
// cancelled and timed-out runs too. It died at "Apply the schema" on every run from 27 Oct 13:31Z and the only signal
// was a stale odds-card-state.json; its circuit breaker's own unschedule failed (HTTP 544) without anyone told.
//
// One Telegram per failure streak (founder 2026-10-29, replacing the once-per-UTC-day reminder): a non-success run
// alerts only when it is the FIRST after a success, so a fail → pass → fail on one day sends twice and a streak that
// runs past midnight sends nothing more. Everything else is logged, not sent. Never fails the job for an unsent
// alert: it is an ::error:: in the log and the step summary instead.
// Env: GH_TOKEN, GITHUB_REPOSITORY, RUN_ID (the triggering run), TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ALERT_TEST;
// GITHUB_API_URL / TELEGRAM_API_URL point the test at fake servers (tools/test-card-job-fail-alert.mjs).
import { appendFileSync } from 'node:fs';
import { sendTelegram } from './price-alert-send.mjs';
import { plainStep } from './pipeline-fail-alert.mjs';
import { NOT_OK } from './live-flip-fail-alert.mjs';

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
  const list = (await gh(env, `/actions/workflows/${run.workflow_id}/runs?status=completed&branch=${encodeURIComponent(run.head_branch || '')}&per_page=100`)).workflow_runs || [];
  const before = list.filter(r => r.id !== run.id && Date.parse(r.created_at) < Date.parse(run.created_at))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  let streak = 1;
  for (const r of before) { if (NOT_OK.has(r.conclusion)) streak++; else break; }
  const prev = before[0];
  const first = !prev || !NOT_OK.has(prev.conclusion);
  if (!first && !env.ALERT_TEST)
    return { alert: false, why: `run ${runId} ${run.conclusion}: ${streak} in a row, this streak was alerted at its first failure` };
  const jobs = (await gh(env, `/actions/runs/${runId}/jobs?filter=latest&per_page=100`)).jobs || [];
  const steps = jobs.flatMap(j => (j.steps || []).filter(s => NOT_OK.has(s.conclusion)).map(s => `${plainStep(s.name)} (${s.conclusion})`));
  const text = [`Stennisfy card job (Kibl archive / odds-card-state) ${run.conclusion.toUpperCase()} (run ${run.run_number}, ${run.event}).`,
    steps.length ? `Step: ${steps.join('; ')}.` : 'GitHub names no failing step (the job itself stopped).',
    first ? 'First failure after a passing run.' : `Still failing: ${streak} runs in a row.`,
    "While it fails, the site's match cards keep their last published odds and no Close is cut.",
    run.html_url || ''].filter(Boolean).join('\n');
  return { alert: true, text };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const d = await decide(process.env);
    if (!d.alert) { console.log(`card-job alert: no message (${d.why})`); process.exit(0); }
    if (process.env.ALERT_TEST) d.text = 'TEST — no action needed. A replay of the alert for an earlier run, proving the ops chat receives it.\n' + d.text;
    const r = await sendTelegram(d.text, process.env);
    if (r.ok) console.log(`card-job alert: Telegram sent (${r.why})`);
    else { console.log(`::error title=Card-job alert not sent::Telegram ${r.why}`); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Card-job alert NOT sent (${r.why})\n\n${d.text}\n`); }
    console.log(d.text);
  } catch (e) {
    console.log(`::error title=Card-job alert::could not read the run (${e.message}) — no message sent`);
  }
}
