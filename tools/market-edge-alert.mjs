#!/usr/bin/env node
// Founder decision 19 Oct (TEN-449): the market-edge "not rebuilt" check is ALERT ONLY — it never blocks the site or
// turns a data run red — and it sends ONE Telegram per streak, not one every 10-minute run.
//
// Runs as pipeline.yml's "Alert — market-edge not rebuilt" step (id me_alert), only when this run's check found
// market-edge not rebuilt (steps.me_check.outputs.stale == 'true'). Two marker steps, read back through the Actions API
// as a step that RAN (not skipped) in a previous run:
//   - REBUILT_STEP: runs only when the check EVALUATED (evaluated=true) and found market-edge rebuilt (stale=false). A
//     broken check writes no outputs, so it never looks like "rebuilt".
//   - MARKER_STEP ("streak already alerted"): runs when this step wrote `sent=true` (Telegram answered 2xx) OR
//     `alerted=true` (an earlier run of the streak already delivered — the marker is CARRIED FORWARD, so every quiet run
//     of an alerted streak carries it too, and a streak of any length is found one jobs read back).
//   "Alert step ran, no marker" therefore means only: the send failed (or GitHub was unreadable, or a cancel hit the
//   step) — never marked, so the next stale run tries again.
// De-dup mirrors tools/pipeline-fail-alert.mjs: it reads the previous COMPLETED pipeline.yml runs on main, newest first:
//   - a CANCELLED run is skipped without a jobs read. This workflow's group never cancels a run in progress by itself
//     (cancel-in-progress: false), so a cancelled run was almost always cancelled while queued; a manual cancel of a
//     running run that had reached the check is skipped too, which only means looking one run further back;
//   - MARKER ran → the streak already alerted → no message, write alerted=true (carry forward);
//   - REBUILT ran → market-edge was rebuilt there → this run starts a streak → send;
//   - anything else (check not reached, broken check, failed send) → look further back;
//   - nothing decisive within reach (RUN_LIST entries, at most JOBS_CALLS jobs reads) → send (loud, not silent).
// Never fails the step: an unsent or undecidable alert is an ::error:: in the log and the step summary, and exit 0.
// Time budget: the whole script is capped at BUDGET_MS (60 s): GitHub reads share the first 2/3, Telegram gets what is
// left minus a margin, and a hard timer ends the step — so it can never push the 30-min build job into its timeout, and
// a 2xx is never lost to that timer.
// Env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ME_REASON, GITHUB_OUTPUT;
// GITHUB_API_URL / TELEGRAM_API_URL / ME_ALERT_BUDGET_MS point the test at fake servers (tools/test-ten263-pipeline.js).
import { appendFileSync } from 'node:fs';
import { sendTelegram } from './price-alert-send.mjs';

export const CHECK_STEP = 'Market-edge rebuilt check (alert only, never blocks)';
export const REBUILT_STEP = 'Market-edge rebuilt (streak reset marker)';
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

// returns { alert: bool, carried?: bool, text?, why }
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
    if (r.conclusion === 'cancelled') continue;          // see the header: skipped without a jobs read
    if (calls >= JOBS_CALLS) break;
    calls++;
    const steps = ((await gh(env, `/actions/runs/${r.id}/jobs?filter=latest&per_page=100`, deadline)).jobs || []).flatMap(j => j.steps || []);
    if (RAN(steps.find(s => s.name === MARKER_STEP))) return { alert: false, carried: true, why: `run ${r.run_number} carries the streak's delivered alert` };
    if (RAN(steps.find(s => s.name === REBUILT_STEP))) return { alert: true, text, why: `run ${r.run_number} rebuilt market-edge: this run starts a new streak` };
    // check not reached, a broken check, or a failed send: not decisive, look further back
  }
  return { alert: true, text, why: `no delivered alert or rebuilt run within reach (${calls} run(s) read)` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const BUDGET_MS = Number(process.env.ME_ALERT_BUDGET_MS) || 60000;
  const MARGIN_MS = Math.min(3000, Math.round(BUDGET_MS / 10));
  const t0 = Date.now();
  const note = (line, summary) => {
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY && summary) { try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary); } catch (_) { /* the log line is the channel */ } }
  };
  const output = (line) => {
    if (!process.env.GITHUB_OUTPUT) { note(`::error title=Market-edge alert::no GITHUB_OUTPUT — could not record "${line}"; the next run may send again`, ''); return; }
    try { appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`); } catch (e) { note(`::error title=Market-edge alert::could not record "${line}" (${e.message}); the next run may send again`, ''); }
  };
  // hard cap: whatever hangs, the step ends inside the budget, loudly, with exit 0
  setTimeout(() => { note(`::error title=Market-edge alert not sent::time budget (${BUDGET_MS} ms) spent — no message sent`, '### Market-edge alert NOT sent (time budget spent)\n'); process.exit(0); }, BUDGET_MS).unref();
  try {
    const d = await decide(process.env, t0 + Math.round(BUDGET_MS * 2 / 3));
    if (!d.alert) {
      console.log(`market-edge alert: no message (${d.why})`);
      if (d.carried) output('alerted=true');
    } else {
      const left = BUDGET_MS - (Date.now() - t0) - MARGIN_MS;
      const r = left > 0 ? await sendTelegram(d.text, process.env, { timeoutMs: left }) : { ok: false, why: 'no time left in the budget' };
      if (r.ok) { output('sent=true'); console.log(`market-edge alert: Telegram sent (${r.why}; ${d.why})`); }
      else note(`::error title=Market-edge alert not sent::Telegram ${r.why} — the next run retries`, `### Market-edge alert NOT sent (${r.why})\n\n${d.text}\n`);
      console.log(d.text);
    }
  } catch (e) {
    note(`::error title=Market-edge alert not sent::could not read the runs (${e.message}) — no message sent`, `### Market-edge alert NOT sent (could not read the runs: ${e.message})\n`);
  }
  process.exit(0);
}
