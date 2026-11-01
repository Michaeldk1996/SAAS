#!/usr/bin/env node
// Task C (founder 2026-11-01): the instant job-failure alert's decisions, and its watch list. Each check names its mutant.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { outcome, decide, started } from './job-fail-alert.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const R = (o) => ({ id: 1, name: 'BSP score + odds refresh', status: 'completed', conclusion: 'failure', head_branch: 'main', created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:03:00Z', html_url: 'u', ...o });
const JOB_RAN = [{ started_at: 'x', steps: [{ status: 'completed' }] }], JOB_QUEUED = [{ started_at: null, steps: [] }];

ok(decide(R(), 'bad', 'ok').action === 'send' && /FAILED/.test(decide(R(), 'bad', 'ok').text), 'a failure after a success alerts (FAILED)');
ok(decide(R(), 'bad', null).action === 'send', 'a failure with no earlier decisive run alerts');
ok(decide(R(), 'bad', 'bad').action === 'skip', 'a failure inside a reported streak is not re-sent (one per streak)');
ok(outcome(R({ conclusion: 'cancelled' }), JOB_QUEUED, null) === null && decide(R({ conclusion: 'cancelled' }), null, 'ok').action === 'skip',
  'a run cancelled while queued (superseded by a newer tick) is skipped — MUTANT: alerting it would message every 10 min');
ok(outcome(R({ conclusion: 'cancelled' }), JOB_RAN, null) === 'bad' && /CANCELLED/.test(decide(R({ conclusion: 'cancelled' }), 'bad', 'ok').text), 'a run cancelled mid-run alerts (CANCELLED)');
ok(outcome(R({ conclusion: 'timed_out' }), null, null) === 'bad' && /TIMED OUT/.test(decide(R({ conclusion: 'timed_out' }), 'bad', 'ok').text), 'a timed-out run alerts');
const P = (o) => R({ name: 'BSP data pipeline', conclusion: 'success', ...o });
ok(outcome(P(), null, [{ name: 'other' }]) === 'nothing' && /published NOTHING/.test(decide(P(), 'nothing', 'ok').text), 'a data run that uploaded no site-data published nothing: alert');
ok(outcome(P(), null, [{ name: 'site-data' }]) === 'ok', 'a data run that uploaded site-data is a success');
ok(outcome(R({ name: 'Alert dry run', conclusion: 'success' }), null, []) === 'nothing', 'the alert dry run is watched like the data pipeline (no site-data = nothing)');
ok(outcome(R({ conclusion: 'success' }), null, null) === 'ok' && decide(R({ conclusion: 'success' }), 'ok', 'bad').action === 'send'
  && /RECOVERED/.test(decide(R({ conclusion: 'success' }), 'ok', 'bad').text), 'a success after a reported streak sends RECOVERED');
ok(decide(R({ conclusion: 'success' }), 'ok', 'ok').action === 'skip', 'a success after a success sends nothing');
ok(decide(R({ head_branch: 'probe/x' }), 'bad', 'ok').action === 'skip', 'a branch run never alerts (probes)');
ok(started(JOB_RAN) && !started(JOB_QUEUED) && !started([]), 'started(): a job with a completed step started; a queued one did not');
// the watch list = every scheduled workflow + publish + the pg_cron-dispatched ones + the dry run
const wfDir = path.join(ROOT, '.github', 'workflows');
const watched = fs.readFileSync(path.join(wfDir, 'job-fail-alert.yml'), 'utf8').match(/^      - '([^']+)'$/gm).map((l) => l.replace(/^      - '|'$/g, ''));
const missing = [];
for (const f of fs.readdirSync(wfDir).filter((x) => x.endsWith('.yml'))) {
  const s = fs.readFileSync(path.join(wfDir, f), 'utf8');
  if (!/^  schedule:/m.test(s)) continue;
  const n = (s.match(/^name:\s*(.+)$/m) || [])[1];
  if (!watched.includes(String(n).trim())) missing.push(f);
}
ok(missing.length === 0, `every scheduled workflow is on the watch list (missing: ${missing.join(', ') || 'none'})`);
ok(['Publish site', 'BSP oddspapi post-match archive', 'TEN-232 kibl archive', 'Alert dry run'].every((n) => watched.includes(n)), 'publish, the pg_cron-dispatched jobs and the dry run are watched');
ok(/TELEGRAM_CHAT_ID: \$\{\{ secrets\.TELEGRAM_PIPELINE_CHAT_ID \|\| secrets\.TELEGRAM_CHAT_ID \}\}/.test(fs.readFileSync(path.join(wfDir, 'job-fail-alert.yml'), 'utf8')), 'it sends to the pipeline-alerts chat only (never Data Alerts)');
console.log(`\ntest-job-fail-alert: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
