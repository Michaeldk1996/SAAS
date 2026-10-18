#!/usr/bin/env node
// Founder ruling 2026-10-18 (pipeline-down alert): after TWO consecutive failed pipeline.yml runs, one Telegram message
// naming the failing step in plain words. The 17 Oct outage (18:20Z → 00:24Z) failed 20 runs in a row on one step and the
// only message was the stall guard's "site stale" at 19:06Z, which says the site is old but not why.
//
// Runs in pipeline.yml's `fail-alert` job (needs the build job, only on its failure). Per run:
//   - reads this run's jobs: the failing step(s), by name (the step name with its "(fail-closed …)" note dropped);
//   - reads the previous COMPLETED runs of pipeline.yml on main (cancelled and skipped runs are not runs that failed);
//   - alerts only when the previous run failed too AND the one before it did not — once per streak, at its second
//     failure (a streak of 20 sends one message, not 19). The stall guard's stale-site alert keeps covering a long one.
// Never fails the job for an unsent alert: it is an ::error:: in the log and the step summary instead.
// Env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID; GITHUB_API_URL / TELEGRAM_API_URL
// point the test at fake servers (tools/test-pipeline-fail-alert.mjs).
import { appendFileSync } from 'node:fs';
import { sendTelegram } from './price-alert-send.mjs';

export const plainStep = (name) => String(name || '').replace(/\s*\((?:fail-closed|best-effort|loud|post-deploy)[^)]*\)\s*/gi, ' ').replace(/\s+/g, ' ').trim();
const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);

async function gh(env, path) {
  const base = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const r = await fetch(`${base}/repos/${env.GITHUB_REPOSITORY}${path}`, { headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(20000) });
  if (r.status !== 200) throw new Error(`GitHub ${path.split('?')[0]}: HTTP ${r.status}`);
  return r.json();
}
const failingSteps = (jobs) => jobs.flatMap(j => (j.steps || []).filter(s => FAILED.has(s.conclusion)).map(s => plainStep(s.name)))
  .concat(jobs.filter(j => FAILED.has(j.conclusion) && !(j.steps || []).some(s => FAILED.has(s.conclusion))).map(j => `job ${j.name}`));

// returns { alert: bool, text, why }
export async function decide(env) {
  const runId = String(env.GITHUB_RUN_ID);
  const me = await gh(env, `/actions/runs/${runId}`);
  const myJobs = (await gh(env, `/actions/runs/${runId}/jobs?filter=latest&per_page=100`)).jobs || [];
  const list = (await gh(env, `/actions/workflows/pipeline.yml/runs?branch=main&status=completed&per_page=30`)).workflow_runs || [];
  const before = list.filter(r => String(r.id) !== runId && Date.parse(r.created_at) < Date.parse(me.created_at)
    && r.conclusion !== 'cancelled' && r.conclusion !== 'skipped').sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const prev = before[0], prev2 = before[1];
  if (!prev || !FAILED.has(prev.conclusion)) return { alert: false, why: 'the previous run did not fail: the first failure of a streak sends nothing' };
  if (prev2 && FAILED.has(prev2.conclusion)) return { alert: false, why: 'the streak already alerted at its second failure' };
  const prevJobs = (await gh(env, `/actions/runs/${prev.id}/jobs?filter=latest&per_page=100`)).jobs || [];
  const mine = failingSteps(myJobs.filter(j => !/fail-alert/i.test(j.name))), theirs = failingSteps(prevJobs);
  const same = mine.length && mine.join('|') === theirs.join('|');
  const text = [`Stennisfy data pipeline failed twice in a row (runs ${prev.run_number} and ${me.run_number}).`,
    same ? `Failing step: ${mine.join('; ')}.` : `Failing step this run: ${mine.join('; ') || 'not named by GitHub'}. Last run: ${theirs.join('; ') || 'not named by GitHub'}.`,
    'The site keeps the last good data until a run passes.', me.html_url || ''].filter(Boolean).join('\n');
  return { alert: true, text };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const d = await decide(process.env);
    if (!d.alert) { console.log(`fail-alert: no message (${d.why})`); process.exit(0); }
    const r = await sendTelegram(d.text, process.env);
    if (r.ok) console.log(`fail-alert: Telegram sent (${r.why})`);
    else { console.log(`::error title=Pipeline-down alert not sent::Telegram ${r.why}`); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Pipeline-down alert NOT sent (${r.why})\n\n${d.text}\n`); }
    console.log(d.text);
  } catch (e) {
    console.log(`::error title=Pipeline-down alert::could not read the runs (${e.message}) — no message sent`);
  }
  process.exit(0);
}
