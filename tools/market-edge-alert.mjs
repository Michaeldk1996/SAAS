#!/usr/bin/env node
// Founder decision 19 Oct (TEN-449): the market-edge "not rebuilt" check is ALERT ONLY — it never blocks the site or
// turns a data run red — and it sends ONE Telegram per streak, not one every 10-minute run.
//
// Runs as pipeline.yml's "Alert — market-edge not rebuilt" step, only when this run's check found market-edge not
// rebuilt (steps.me_check.outputs.stale == 'true'). De-dup mirrors tools/pipeline-fail-alert.mjs: it reads the previous
// COMPLETED pipeline.yml runs on main through the Actions API, newest first, and looks at THEIR steps:
//   - a run whose check step did not run (skipped, cancelled while queued, failed before the site-data upload, or a run
//     from before this step existed) did not evaluate the condition: look further back (at most LOOKBACK runs);
//   - the first run that DID evaluate it decides: its alert step ran (not skipped) → it was not rebuilt there too, the
//     streak already alerted → no message; its alert step was skipped → it was rebuilt there → this run starts a new
//     streak → one message;
//   - no run in reach evaluated it → one message (fail loud, not silent).
// So the marker is the alert step's own run/skip state in GitHub's record — no state file, nothing committed.
// Never fails the step: an unsent or undecidable alert is a ::warning:: in the log and the step summary, and exit 0.
// Env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ME_REASON;
// GITHUB_API_URL / TELEGRAM_API_URL point the test at fake servers (tools/test-ten263-pipeline.js).
import { appendFileSync } from 'node:fs';
import { sendTelegram } from './price-alert-send.mjs';

export const CHECK_STEP = 'Market-edge rebuilt check (alert only, never blocks)';
export const ALERT_STEP = 'Alert — market-edge not rebuilt (Telegram, once per streak)';
export const LOOKBACK = 10;
const RAN = (s) => s && s.conclusion && s.conclusion !== 'skipped';

async function gh(env, path) {
  const base = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const r = await fetch(`${base}/repos/${env.GITHUB_REPOSITORY}${path}`, { headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(20000) });
  if (r.status !== 200) throw new Error(`GitHub ${path.split('?')[0]}: HTTP ${r.status}`);
  return r.json();
}

// returns { alert: bool, text?, why }
export async function decide(env) {
  const runId = String(env.GITHUB_RUN_ID);
  const me = await gh(env, `/actions/runs/${runId}`);
  const list = (await gh(env, `/actions/workflows/pipeline.yml/runs?branch=main&status=completed&per_page=30`)).workflow_runs || [];
  const before = list.filter(r => String(r.id) !== runId && Date.parse(r.created_at) < Date.parse(me.created_at))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, LOOKBACK);
  const reason = String(env.ME_REASON || 'reason not recorded').replace(/[\r\n]+/g, ' ').slice(0, 600);
  const text = [`Stennisfy: Market edge was not rebuilt in data run ${me.run_number}: ${reason}.`,
    'The site keeps updating; the Market edge tab shows the previous build. Alert only — the run stays green.',
    'One message per streak: the next comes only after a run rebuilds it and it breaks again.', me.html_url || ''].filter(Boolean).join('\n');
  for (const r of before) {
    const steps = ((await gh(env, `/actions/runs/${r.id}/jobs?filter=latest&per_page=100`)).jobs || []).flatMap(j => j.steps || []);
    if (!RAN(steps.find(s => s.name === CHECK_STEP))) continue;
    if (RAN(steps.find(s => s.name === ALERT_STEP))) return { alert: false, why: `run ${r.run_number} already found market-edge not rebuilt: the streak already alerted` };
    return { alert: true, text, why: `run ${r.run_number} rebuilt market-edge: this run starts a new streak` };
  }
  return { alert: true, text, why: `none of the last ${before.length} completed run(s) evaluated the check` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const note = (line, summary) => {
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) { try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary); } catch (_) { /* the log line is the channel */ } }
  };
  try {
    const d = await decide(process.env);
    if (!d.alert) console.log(`market-edge alert: no message (${d.why})`);
    else {
      const r = await sendTelegram(d.text, process.env);
      if (r.ok) console.log(`market-edge alert: Telegram sent (${r.why}; ${d.why})`);
      else note(`::warning title=Market-edge alert not sent::Telegram ${r.why}`, `### Market-edge alert NOT sent (${r.why})\n\n${d.text}\n`);
      console.log(d.text);
    }
  } catch (e) {
    note(`::warning title=Market-edge alert::could not read the runs (${e.message}) — no message sent`, `### Market-edge alert NOT sent (could not read the runs: ${e.message})\n`);
  }
  process.exit(0);
}
