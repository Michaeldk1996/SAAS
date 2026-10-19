#!/usr/bin/env node
// Founder decision 19 Oct (TEN-449): the market-edge "not rebuilt" check is ALERT ONLY — it never blocks the site or
// turns a data run red — and it sends ONE Telegram per streak, not one every 10-minute run.
//
// Runs as pipeline.yml's "Alert — market-edge not rebuilt" step (id me_alert), only when this run's check found
// market-edge not rebuilt (steps.me_check.outputs.stale == 'true'). It sets the step output `sent=true` ONLY after
// Telegram answered 2xx, and the "Market-edge alert sent (streak marker)" step after it runs only on that output — so a
// failed send, missing secrets, an API failure or a cancel mid-step never marks a streak as alerted (TEN-449 review).
// De-dup mirrors tools/pipeline-fail-alert.mjs: it reads the previous COMPLETED pipeline.yml runs on main through the
// Actions API, newest first, and looks at THEIR steps:
//   - a CANCELLED run is skipped without a jobs call: this workflow's group never cancels a run in progress
//     (cancel-in-progress: false), so a cancelled run was cancelled while queued and never reached the check;
//   - a run whose check step did not run (failed before the site-data upload, or older than this step) is looked past;
//   - a run whose MARKER ran → that streak already alerted → no message;
//   - a run whose alert step ran without the marker → not rebuilt there either, but nothing was delivered → look further
//     back (same streak, still unalerted);
//   - a run whose check ran and alert step was skipped → market-edge was rebuilt there → this run starts a streak → send;
//   - nothing decisive within reach (RUN_LIST entries, at most JOBS_CALLS jobs reads) → send (loud, not silent).
// Never fails the step: an unsent or undecidable alert is an ::error:: in the log and the step summary, and exit 0.
// Time budget: the whole script is capped at BUDGET_MS (60 s; GitHub reads share the first 40 s, Telegram the rest), so
// it can never push the 30-min build job into its timeout.
// Env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ME_REASON, GITHUB_OUTPUT;
// GITHUB_API_URL / TELEGRAM_API_URL / ME_ALERT_BUDGET_MS point the test at fake servers (tools/test-ten263-pipeline.js).
import { appendFileSync } from 'node:fs';
import { sendTelegram } from './price-alert-send.mjs';

export const CHECK_STEP = 'Market-edge rebuilt check (alert only, never blocks)';
export const ALERT_STEP = 'Alert — market-edge not rebuilt (Telegram, once per streak)';
export const MARKER_STEP = 'Market-edge alert sent (streak marker)';
export const RUN_LIST = 50, JOBS_CALLS = 10;
const RAN = (s) => s && s.conclusion && s.conclusion !== 'skipped';

async function gh(env, path, deadline) {
  const left = deadline - Date.now();
  if (left <= 0) throw new Error('time budget spent reading GitHub');
  const base = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const r = await fetch(`${base}/repos/${env.GITHUB_REPOSITORY}${path}`, { headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(Math.min(20000, left)) });
  if (r.status !== 200) throw new Error(`GitHub ${path.split('?')[0]}: HTTP ${r.status}`);
  return r.json();
}

// returns { alert: bool, text?, why }
export async function decide(env, deadline = Date.now() + 40000) {
  const runId = String(env.GITHUB_RUN_ID);
  const me = await gh(env, `/actions/runs/${runId}`, deadline);
  const list = (await gh(env, `/actions/workflows/pipeline.yml/runs?branch=main&status=completed&per_page=${RUN_LIST}`, deadline)).workflow_runs || [];
  const before = list.filter(r => String(r.id) !== runId && Date.parse(r.created_at) < Date.parse(me.created_at))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const reason = String(env.ME_REASON || 'reason not recorded').replace(/[\r\n]+/g, ' ').slice(0, 600);
  const text = [`Stennisfy: Market edge was not rebuilt in data run ${me.run_number}: ${reason}.`,
    'The site keeps updating; the Market edge tab shows the previous build. Alert only — the run stays green.',
    'One message per streak: the next comes only after a run rebuilds it and it breaks again.', me.html_url || ''].filter(Boolean).join('\n');
  let calls = 0;
  for (const r of before) {
    if (r.conclusion === 'cancelled') continue;          // cancelled while queued: never reached the check, costs nothing
    if (calls >= JOBS_CALLS) break;
    calls++;
    const steps = ((await gh(env, `/actions/runs/${r.id}/jobs?filter=latest&per_page=100`, deadline)).jobs || []).flatMap(j => j.steps || []);
    if (!RAN(steps.find(s => s.name === CHECK_STEP))) continue;
    if (RAN(steps.find(s => s.name === MARKER_STEP))) return { alert: false, why: `run ${r.run_number} already delivered the alert for this streak` };
    if (RAN(steps.find(s => s.name === ALERT_STEP))) continue; // not rebuilt there either, but never delivered: keep looking
    return { alert: true, text, why: `run ${r.run_number} rebuilt market-edge: this run starts a new streak` };
  }
  return { alert: true, text, why: `no delivered alert or rebuilt run within reach (${calls} run(s) read)` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const BUDGET_MS = Number(process.env.ME_ALERT_BUDGET_MS) || 60000;
  const t0 = Date.now();
  const note = (line, summary) => {
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) { try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary); } catch (_) { /* the log line is the channel */ } }
  };
  // hard cap: whatever hangs, the step ends inside the budget, loudly, with exit 0
  setTimeout(() => { note(`::error title=Market-edge alert not sent::time budget (${BUDGET_MS} ms) spent — no message sent`, `### Market-edge alert NOT sent (time budget spent)\n`); process.exit(0); }, BUDGET_MS).unref();
  try {
    const d = await decide(process.env, t0 + Math.round(BUDGET_MS * 2 / 3));
    if (!d.alert) console.log(`market-edge alert: no message (${d.why})`);
    else {
      const r = await sendTelegram(d.text, process.env);
      if (r.ok) {
        console.log(`market-edge alert: Telegram sent (${r.why}; ${d.why})`);
        if (process.env.GITHUB_OUTPUT) { try { appendFileSync(process.env.GITHUB_OUTPUT, 'sent=true\n'); } catch (e) { note(`::error title=Market-edge alert::sent, but could not record it (${e.message}) — the next run may send again`, ''); } }
      } else note(`::error title=Market-edge alert not sent::Telegram ${r.why} — the next run retries`, `### Market-edge alert NOT sent (${r.why})\n\n${d.text}\n`);
      console.log(d.text);
    }
  } catch (e) {
    note(`::error title=Market-edge alert not sent::could not read the runs (${e.message}) — no message sent`, `### Market-edge alert NOT sent (could not read the runs: ${e.message})\n`);
  }
  process.exit(0);
}
