// Founder ruling 2026-10-18 (pipeline-down alert) — tools/pipeline-fail-alert.mjs against a fake GitHub API and a fake
// Telegram: ONE message at the second consecutive failure, naming the failing step in plain words; nothing at the first
// failure, nothing at the third (the streak already alerted), nothing after a cancelled run counts as a pass; the wiring.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, plainStep } from './pipeline-fail-alert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m + '\n        ' + d); } };
const STEP = 'One price per match on every surface (fail-closed pre-publish gate)';
let RUNS = [], JOBS = {};
const srv = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let m, body = null;
  if ((m = /\/actions\/runs\/(\d+)\/jobs$/.exec(u.pathname))) body = { jobs: JOBS[m[1]] || [] };
  else if ((m = /\/actions\/runs\/(\d+)$/.exec(u.pathname))) body = RUNS.find(r => String(r.id) === m[1]);
  else if (/\/actions\/workflows\/pipeline\.yml\/runs$/.test(u.pathname)) body = { workflow_runs: RUNS.filter(r => r.status === 'completed') };
  res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify(body || {}));
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const env = { GITHUB_API_URL: `http://127.0.0.1:${srv.address().port}`, GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 't' };
const run = (id, n, concl, min, status = 'completed') => ({ id, run_number: n, status, conclusion: concl, created_at: new Date(Date.UTC(2026, 9, 17, 18, min)).toISOString(), html_url: `https://x/${id}` });
const jobs = (stepName, concl = 'failure') => [{ name: 'build-and-deploy', conclusion: concl, steps: [{ name: 'Checkout', conclusion: 'success' }, { name: stepName, conclusion: concl }] }];

ok(plainStep(STEP) === 'One price per match on every surface', 'the step name in plain words (its "(fail-closed …)" note dropped)', plainStep(STEP));

// the current run (101) is failing (in progress); the one before it (100) failed; 99 passed → alert
RUNS = [run(99, 8132, 'success', 0), run(100, 8134, 'failure', 20), run(101, 8135, null, 30, 'in_progress')];
JOBS = { 100: jobs(STEP), 101: jobs(STEP) };
let d = await decide(Object.assign({ GITHUB_RUN_ID: '101' }, env));
ok(d.alert && /failed twice in a row \(runs 8134 and 8135\)/.test(d.text) && /Failing step: One price per match on every surface\./.test(d.text) && !/fail-closed/.test(d.text),
  'second failure in a row → ONE message naming the step in plain words', JSON.stringify(d));
// different steps → both named
JOBS[100] = jobs('Build market-edge shards (best-effort)');
d = await decide(Object.assign({ GITHUB_RUN_ID: '101' }, env));
ok(d.alert && /Failing step this run: One price per match on every surface\. Last run: Build market-edge shards\./.test(d.text), 'two different failing steps → both named', d.text);
// first failure → nothing
RUNS = [run(99, 8132, 'success', 0), run(101, 8135, null, 30, 'in_progress')];
d = await decide(Object.assign({ GITHUB_RUN_ID: '101' }, env));
ok(!d.alert, 'the first failure of a streak sends nothing', JSON.stringify(d));
// third failure → nothing (the streak alerted at its second)
RUNS = [run(98, 8131, 'failure', 0), run(99, 8132, 'failure', 10), run(101, 8135, null, 30, 'in_progress')];
JOBS = { 99: jobs(STEP), 101: jobs(STEP) };
d = await decide(Object.assign({ GITHUB_RUN_ID: '101' }, env));
ok(!d.alert, 'the third failure in a row sends nothing (one message per streak)', JSON.stringify(d));
// a cancelled run between two failures is not a pass: still the second failure
RUNS = [run(97, 8130, 'success', 0), run(98, 8131, 'failure', 5), run(99, 8132, 'cancelled', 10), run(101, 8135, null, 30, 'in_progress')];
JOBS = { 98: jobs(STEP), 101: jobs(STEP) };
d = await decide(Object.assign({ GITHUB_RUN_ID: '101' }, env));
ok(d.alert && /runs 8131 and 8135/.test(d.text), 'a cancelled run in between is not a pass: the second failure still alerts', JSON.stringify(d));
srv.close();

// wiring
const y = readFileSync(join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');
const job = y.slice(y.indexOf('\n  fail-alert:'));
ok(/needs: build-and-deploy/.test(job) && /if: failure\(\)/.test(job) && /node tools\/pipeline-fail-alert\.mjs/.test(job) && /TELEGRAM_BOT_TOKEN/.test(job), 'pipeline.yml: its own job, after the build job, only on failure, with the Telegram secrets', job.slice(0, 400));
ok(/actions: read/.test(y.slice(0, y.indexOf('\njobs:'))), 'the workflow may read its runs (actions: read)');
const src = readFileSync(join(ROOT, 'tools/pipeline-fail-alert.mjs'), 'utf8');
ok(!/process\.exit\(1\)/.test(src), 'an unsent or unreadable alert never fails the job (an ::error:: instead)');
console.log(`\ntest-pipeline-fail-alert: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
