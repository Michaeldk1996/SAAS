// card-job-lock (2026-10-28) — tools/card-job-fail-alert.mjs against a fake GitHub API and a
// fake Telegram. Each check names the mutation that turns it red.
//   1. a CANCELLED run after a pass alerts, naming the step               mutant: drop 'cancelled' from NOT_OK
//   2. a failed run after a pass alerts ("first failure")                 mutant: alert only on cancelled
//   3. a successful run sends nothing                                     mutant: alert on everything
//   4. a second failure in the SAME streak sends nothing                  mutant: alert on every failure
//   5. a streak running past midnight sends nothing more (no daily reminder) mutant: the once-per-UTC-day reminder back
//   5b. fail → pass → fail on ONE day sends twice (one per streak)          mutant: dedup by UTC day
//   6. the end-to-end CLI posts exactly one message; a replay says TEST   mutant: never call sendTelegram / unmarked replay
//   7. the wiring: workflow_run `completed` of the exact `name:` of ten232-kibl-archive.yml; cancelled let through
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { decide } from './card-job-fail-alert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m + '\n        ' + d); } };
let RUNS = {}, SENT = [];
const run = (id, n, concl, at) => ({ id, run_number: n, status: 'completed', conclusion: concl, created_at: at, workflow_id: 77,
  head_branch: 'main', event: 'schedule', html_url: `https://x/${id}` });
const steps = (c) => [{ name: 'flip', conclusion: c, steps: [{ name: 'Checkout', conclusion: 'success' },
  { name: 'Apply the schema', conclusion: c }, { name: 'Poller liveness', conclusion: 'skipped' }] }];
const srv = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let m, body = null;
  if (req.method === 'POST' && /\/sendMessage$/.test(u.pathname)) {
    let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { SENT.push(JSON.parse(b)); res.writeHead(200); res.end('{"ok":true}'); });
    return;
  }
  if ((m = /\/actions\/workflows\/77\/runs$/.exec(u.pathname))) body = { workflow_runs: Object.values(RUNS) };
  else if ((m = /\/actions\/runs\/(\d+)\/jobs$/.exec(u.pathname))) body = { jobs: steps(RUNS[m[1]] && RUNS[m[1]].conclusion) };
  else if ((m = /\/actions\/runs\/(\d+)$/.exec(u.pathname))) body = RUNS[m[1]];
  res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify(body || {}));
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
const env = { GITHUB_API_URL: base, TELEGRAM_API_URL: base, GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 't', TELEGRAM_BOT_TOKEN: 'b', TELEGRAM_CHAT_ID: 'c' };
const at = (h, d = 26) => `2026-10-${d}T${String(h).padStart(2, '0')}:35:00Z`;

RUNS = { 1: run(1, 10, 'success', at(8)), 2: run(2, 11, 'cancelled', at(9)) };
let d = await decide({ ...env, RUN_ID: '2' });
ok(d.alert && /CANCELLED \(run 11, schedule\)/.test(d.text) && /Step: Apply the schema \(cancelled\)\./.test(d.text) && /First failure/.test(d.text),
  '1. a cancelled run after a pass → one message naming the step', JSON.stringify(d));
RUNS = { 1: run(1, 10, 'success', at(8)), 2: run(2, 11, 'failure', at(9)) };
d = await decide({ ...env, RUN_ID: '2' });
ok(d.alert && /FAILURE \(run 11, schedule\)/.test(d.text) && /First failure after a passing run/.test(d.text), '2. a failed run after a pass → message', JSON.stringify(d));
RUNS = { 1: run(1, 10, 'failure', at(8)), 2: run(2, 11, 'success', at(9)) };
d = await decide({ ...env, RUN_ID: '2' });
ok(!d.alert && /concluded success/.test(d.why), '3. a successful run → nothing', JSON.stringify(d));
RUNS = { 1: run(1, 10, 'success', at(7)), 2: run(2, 11, 'failure', at(8)), 3: run(3, 12, 'failure', at(9)) };
d = await decide({ ...env, RUN_ID: '3' });
ok(!d.alert && /2 in a row, this streak was alerted at its first failure/.test(d.why), '4. a second failure in the same streak → nothing', JSON.stringify(d));
RUNS = { 1: run(1, 10, 'success', at(20, 24)), 2: run(2, 11, 'failure', at(22, 25)), 3: run(3, 12, 'timed_out', at(23, 25)), 4: run(4, 13, 'failure', at(0)) };
d = await decide({ ...env, RUN_ID: '4' });
ok(!d.alert && /3 in a row/.test(d.why), '5. a streak running into a new UTC day → nothing more (no daily reminder)', JSON.stringify(d));
RUNS = { 1: run(1, 10, 'success', at(6)), 2: run(2, 11, 'failure', at(7)), 3: run(3, 12, 'success', at(10)), 4: run(4, 13, 'failure', at(14)) };
const sent5b = [];
for (const id of ['2', '4']) { d = await decide({ ...env, RUN_ID: id }); if (d.alert) sent5b.push(id); }
ok(sent5b.join() === '2,4' && /First failure after a passing run/.test(d.text), '5b. fail → pass → fail on one UTC day → two messages, one per streak', sent5b.join());

const cli = (extra) => new Promise(res => {   // async: the fake servers live on this event loop
  const p = spawn(process.execPath, [join(ROOT, 'tools', 'card-job-fail-alert.mjs')], { env: { ...process.env, ...env, ...extra } });
  let out = ''; p.stdout.on('data', c => { out += c; }); p.on('close', status => res({ status, out }));
});
RUNS = { 1: run(1, 10, 'success', at(8)), 2: run(2, 11, 'cancelled', at(9)), 3: run(3, 12, 'failure', at(10)) };
SENT = [];
let c = await cli({ RUN_ID: '2' });
ok(c.status === 0 && SENT.length === 1 && /CANCELLED/.test(SENT[0].text) && !/^TEST/.test(SENT[0].text), '6. the CLI posts exactly one message for a cancelled run', `${c.status} ${SENT.length} ${c.out}`);
SENT = [];
c = await cli({ RUN_ID: '3', ALERT_TEST: '1' });   // same-day streak, but a replay always sends, marked TEST
ok(c.status === 0 && SENT.length === 1 && /^TEST — no action needed\./.test(SENT[0].text), '6. a replay posts ONE message whose first line says TEST', SENT.map(x => x.text.slice(0, 60)).join(' | '));

const wf = readFileSync(join(ROOT, '.github/workflows/card-job-fail-alert.yml'), 'utf8');
const watched = /^name:\s*(.+)$/m.exec(readFileSync(join(ROOT, '.github/workflows/ten232-kibl-archive.yml'), 'utf8'))[1].trim().replace(/^['"]|['"]$/g, '');
const listens = /workflows:\s*\[\s*'([^']+)'\s*\]/.exec(wf);
ok(listens && listens[1] === watched && /types:\s*\[\s*completed\s*\]/.test(wf), `7. wiring: workflow_run completed of "${watched}" (exact name)`, listens && listens[1]);
ok(/github\.event\.workflow_run\.conclusion != 'success'/.test(wf) && !/conclusion != 'cancelled'/.test(wf) && /node tools\/card-job-fail-alert\.mjs/.test(wf)
  && /ALERT_TEST: \$\{\{ github\.event_name == 'workflow_dispatch' && '1' \|\| '' \}\}/.test(wf), '7. cancelled is let through; the replay path marks TEST');
srv.close();
console.log(`PASS ${pass}   FAIL ${fail}`);
process.exit(fail ? 1 : 0);
