// Founder brief 2026-10-24 (bet105-line-prices, Part 1 item 2) — tools/line-summary-fail-alert.mjs against a fake GitHub
// API and a fake Telegram. Each check names the mutation that turns it red.
//   1. a CANCELLED run (the 60-minute kill) sends a message naming the cancelled step   mutant: drop 'cancelled' from NOT_OK
//   2. a failed run sends a message naming the failed step                                mutant: alert only on cancelled
//   3. a successful run sends nothing                                                    mutant: alert on everything
//   4. the end-to-end CLI posts exactly one Telegram message for a cancelled run         mutant: never call sendTelegram
//   5. the wiring: the workflow listens to workflow_run `completed` of the workflow whose `name:` is exactly the one in
//      ten225-line-summary.yml (a wrong name never fires — silently), and its job condition lets cancelled through
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { decide } from './line-summary-fail-alert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m + '\n        ' + d); } };
let RUNS = {}, JOBS = {}, SENT = [];
const srv = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let m, body = null;
  if (req.method === 'POST' && /\/sendMessage$/.test(u.pathname)) {
    let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { SENT.push(JSON.parse(b)); res.writeHead(200); res.end('{"ok":true}'); });
    return;
  }
  if ((m = /\/actions\/runs\/(\d+)\/jobs$/.exec(u.pathname))) body = { jobs: JOBS[m[1]] || [] };
  else if ((m = /\/actions\/runs\/(\d+)$/.exec(u.pathname))) body = RUNS[m[1]];
  res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify(body || {}));
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
const env = { GITHUB_API_URL: base, TELEGRAM_API_URL: base, GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 't', TELEGRAM_BOT_TOKEN: 'b', TELEGRAM_CHAT_ID: 'c' };
const run = (id, n, concl) => ({ id, run_number: n, status: 'completed', conclusion: concl, run_started_at: '2026-10-23T11:51:00Z',
  updated_at: '2026-10-23T12:51:35Z', html_url: `https://x/${id}` });
const jobs = (stepConcl) => [{ name: 'load', conclusion: stepConcl, steps: [{ name: 'Checkout', conclusion: 'success' },
  { name: 'Load the summary', conclusion: stepConcl }, { name: 'Read back — coverage by month, source and family', conclusion: 'skipped' }] }];

RUNS = { 1: run(1, 31, 'cancelled'), 2: run(2, 32, 'failure'), 3: run(3, 33, 'success') };
JOBS = { 1: jobs('cancelled'), 2: jobs('failure'), 3: jobs('success') };
let d = await decide(Object.assign({ RUN_ID: '1' }, env));
ok(d.alert && /CANCELLED \(run 31, after 61 min\)/.test(d.text) && /Step: Load the summary \(cancelled\)\./.test(d.text) && /60-minute job limit/.test(d.text),
  '1. a cancelled run (the 60-minute kill) → one message naming the step', JSON.stringify(d));
d = await decide(Object.assign({ RUN_ID: '2' }, env));
ok(d.alert && /FAILURE \(run 32/.test(d.text) && /Load the summary \(failure\)/.test(d.text), '2. a failed run → one message naming the step', JSON.stringify(d));
d = await decide(Object.assign({ RUN_ID: '3' }, env));
ok(!d.alert && /concluded success/.test(d.why), '3. a successful run → nothing', JSON.stringify(d));

SENT = [];
const cli = await new Promise(res => {   // async: the fake servers live on this event loop
  const p = spawn(process.execPath, [join(ROOT, 'tools', 'line-summary-fail-alert.mjs')], { env: Object.assign({}, process.env, env, { RUN_ID: '1' }) });
  let stdout = ''; p.stdout.on('data', c => { stdout += c; }); p.on('close', status => res({ status, stdout }));
});
ok(cli.status === 0 && SENT.length === 1 && SENT[0].chat_id === 'c' && /CANCELLED/.test(SENT[0].text),
  '4. end to end: the CLI posts exactly one Telegram message for a cancelled run', `${cli.status} ${SENT.length} ${cli.stdout}`);

const wf = readFileSync(join(ROOT, '.github/workflows/line-summary-fail-alert.yml'), 'utf8');
// both loads (founder brief 2026-10-28 added the hourly same-day load): every name must be EXACT — a wrong one never fires
const nameOf = f => /^name:\s*(.+)$/m.exec(readFileSync(join(ROOT, '.github/workflows', f), 'utf8'))[1].trim().replace(/^['"]|['"]$/g, '');
const watched = ['ten225-line-summary.yml', 'ten225-line-summary-live.yml'].map(nameOf);
const lm = /workflows:\s*\[([^\]]*)\]/.exec(wf);
const listens = lm ? [...lm[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : [];
ok(watched.every(w => listens.includes(w)) && listens.length === watched.length && /types:\s*\[\s*completed\s*\]/.test(wf),
  `5. wiring: workflow_run completed of ${watched.map(w => `"${w}"`).join(' and ')} (exact names; a wrong name never fires)`, listens.join(' | '));
ok(/github\.event\.workflow_run\.conclusion != 'success'/.test(wf) && !/conclusion != 'cancelled'/.test(wf) && /node tools\/line-summary-fail-alert\.mjs/.test(wf),
  '   the job condition lets cancelled through and runs the tested script');
ok(/workflow_dispatch:/.test(wf) && /ALERT_TEST: \$\{\{ github\.event_name == 'workflow_dispatch' && '1' \|\| '' \}\}/.test(wf),
  '6. the manual replay path always marks its message TEST');
SENT = [];
const cli2 = await new Promise(res => {
  const p = spawn(process.execPath, [join(ROOT, 'tools', 'line-summary-fail-alert.mjs')], { env: Object.assign({}, process.env, env, { RUN_ID: '1', ALERT_TEST: '1' }) });
  p.on('close', status => res({ status }));
});
ok(cli2.status === 0 && SENT.length === 1 && /^TEST — no action needed\./.test(SENT[0].text) && /CANCELLED/.test(SENT[0].text),
  '6. a replay posts ONE message whose first line says TEST', SENT.map(x => x.text.slice(0, 60)).join(' | '));
srv.close();
console.log(`PASS ${pass}   FAIL ${fail}`);
process.exit(fail ? 1 : 0);
