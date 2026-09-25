#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// TEN-273 cap ruling (founder, 2026-09-25 02:05Z): "A forced release posts a
// message naming the reason, in the same channel as the freshness alarm."
//
// That channel is the pipeline-watchdog.yml run going RED. tools/deploy-lane.mjs
// dispatches it with input `lane_alert`; the workflow's FIRST step prints
// ::error:: with the message and fails the job. The watchdog's own alarms must
// still run after it (every other step carries `if: always()`), and the message
// must never run as shell.
//
// Like tools/test-ten263-pipeline.js, this reads the REAL workflow text and
// EXECUTES the real step block with bash. Each check is also run against a
// mutated copy of the workflow, which must fail it — a check that passes with
// the mechanism cut out is not testing it.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const WORKFLOW = path.join(__dirname, '..', '.github', 'workflows', 'pipeline-watchdog.yml');
const YML = fs.readFileSync(WORKFLOW, 'utf8');
const STEP = 'Alarm — deploy lane forced release';

let pass = 0; const fails = [];
function check(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fails.push(name); console.log(`  FAIL ${name}\n       ${e.message}`); }
}

// The steps of the `watch` job, each as its text block.
function steps(yml) {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => /^ {4}steps:\s*$/.test(l));
  assert.ok(start >= 0, 'no `steps:` in the watch job');
  const out = [];
  let cur = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^ {0,5}\S/.test(l) && l.trim()) break;          // left the steps list
    if (/^ {6}- /.test(l)) { cur = { lines: [l] }; out.push(cur); continue; }
    if (cur) cur.lines.push(l);
  }
  for (const s of out) {
    const n = /^ {6}- name: (.*)$/.exec(s.lines[0]) || s.lines.map((l) => /^ {8}name: (.*)$/.exec(l)).find(Boolean);
    const u = /^ {6}- uses: (.*)$/.exec(s.lines[0]);
    s.name = n ? n[1].trim() : (u ? `uses ${u[1].trim()}` : s.lines[0].trim());
    const ifl = s.lines.find((l) => /^ {8}if: /.test(l));
    s.if = ifl ? ifl.replace(/^ {8}if: /, '').trim() : null;
    const k = s.lines.findIndex((l) => /^ {8}run: /.test(l));
    if (k >= 0) {
      const m = /^ {8}run: (.*)$/.exec(s.lines[k]);
      if (m[1] !== '|') s.run = m[1];
      else {
        const body = s.lines.slice(k + 1).filter((l, i, a) => !(i === a.length - 1 && !l.trim()));
        s.run = body.map((l) => l.slice(10)).join('\n').replace(/\s+$/, '') + '\n';
      }
    }
    s.env = {};
    const e = s.lines.findIndex((l) => /^ {8}env:\s*$/.test(l));
    if (e >= 0) for (let j = e + 1; j < s.lines.length && /^ {10}\S/.test(s.lines[j]); j++) {
      const [key, ...rest] = s.lines[j].trim().split(':');
      s.env[key] = rest.join(':').trim();
    }
  }
  return out;
}

// Runs the step's real run block as the runner would: bash -e, the message
// arriving through the environment exactly as the step's env maps it.
function execStep(step, message, cwd) {
  assert.ok(step.run, 'the alert step has no run block');
  assert.strictEqual(step.env.LANE_ALERT, '${{ inputs.lane_alert }}', 'the message must reach the script through env, not interpolation');
  const script = path.join(cwd, 'step.sh');
  fs.writeFileSync(script, step.run);
  return spawnSync('bash', ['-e', script], { cwd, encoding: 'utf8', env: { ...process.env, LANE_ALERT: message } });
}

// ── the checks, each a function of the workflow text ─────────────────────────
const CHECKS = {
  'workflow_dispatch declares a string input lane_alert, default empty'(yml) {
    const m = /workflow_dispatch:\s*\n\s+inputs:\s*\n\s+lane_alert:\s*\n((?:\s{8}.*\n)+)/.exec(yml);
    assert.ok(m, 'no workflow_dispatch input lane_alert');
    assert.match(m[1], /type: string/);
    assert.match(m[1], /default: ''/);
  },
  'the lane alert is the FIRST step, gated on a non-empty lane_alert'(yml) {
    const st = steps(yml);
    assert.strictEqual(st[0].name, STEP, `first step is "${st[0].name}"`);
    assert.match(st[0].if || '', /inputs\.lane_alert != ''/);
  },
  'every other step still runs after it (if: always())'(yml) {
    const others = steps(yml).slice(1);
    assert.ok(others.length >= 4, `only ${others.length} other steps parsed`);
    const missing = others.filter((s) => s.if !== 'always()').map((s) => s.name);
    assert.deepStrictEqual(missing, [], `steps that would be skipped after the alert fails: ${missing.join(', ')}`);
  },
  'executed: the step prints ::error:: with the reason text and fails the job'(yml) {
    const st = steps(yml)[0];
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ten273-alert-'));
    const msg = 'deploy lane forced release (cap-40min-no-run): TEN-253 run run-A — 40 min since the claim and no owner pipeline run in progress.';
    const r = execStep(st, msg, d);
    assert.strictEqual(r.status, 1, `exit ${r.status}`);
    assert.ok(r.stdout.includes(`::error::deploy lane forced release — ${msg}`), `stdout: ${r.stdout}`);
  },
  'executed: the message cannot run as shell'(yml) {
    const st = steps(yml)[0];
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ten273-alert-'));
    const r = execStep(st, 'x $(touch pwned-a) `touch pwned-b` ; touch pwned-c', d);
    assert.strictEqual(r.status, 1);
    for (const f of ['pwned-a', 'pwned-b', 'pwned-c']) assert.ok(!fs.existsSync(path.join(d, f)), `${f} was created`);
    assert.ok(r.stdout.includes('$(touch pwned-a)'), 'the text is printed verbatim');
  },
  'an alert run has its own concurrency group (a scheduled run cannot cancel it)'(yml) {
    const m = /^concurrency:\s*\n\s+group:\s*(.+)$/m.exec(yml);
    assert.ok(m, 'no concurrency group');
    assert.match(m[1], /inputs\.lane_alert != ''/);
    assert.match(m[1], /github\.run_id/);
    assert.match(m[1], /'bsp-pipeline-watchdog'/);
  },
};

// Mutants of the REAL workflow text: each must fail the named check.
const MUTANTS = [
  ['the alert step does not fail the job', 'executed: the step prints ::error:: with the reason text and fails the job',
    "          printf '::error::deploy lane forced release — %s\\n' \"$LANE_ALERT\"\n          exit 1\n",
    "          printf '::error::deploy lane forced release — %s\\n' \"$LANE_ALERT\"\n"],
  ['the reason text is dropped from the error', 'executed: the step prints ::error:: with the reason text and fails the job',
    "printf '::error::deploy lane forced release — %s\\n' \"$LANE_ALERT\"", "printf '::error::deploy lane forced release\\n'"],
  ['the message is interpolated into the script', 'executed: the message cannot run as shell',
    "printf '::error::deploy lane forced release — %s\\n' \"$LANE_ALERT\"", "eval \"echo ::error::deploy lane forced release — $LANE_ALERT\""],
  ['the wedge alarm loses if: always()', 'every other step still runs after it (if: always())',
    '        id: wedge\n        if: always()\n', '        id: wedge\n'],
  ['checkout loses if: always()', 'every other step still runs after it (if: always())',
    '      - uses: actions/checkout@v4\n        if: always()\n', '      - uses: actions/checkout@v4\n'],
  ['the alert step is not first', 'the lane alert is the FIRST step, gated on a non-empty lane_alert',
    '    steps:\n', '    steps:\n      - uses: actions/setup-node@v4\n        if: always()\n\n'],
  ['no lane_alert input', 'workflow_dispatch declares a string input lane_alert, default empty',
    '    inputs:\n      lane_alert:\n', '    inputs:\n      other:\n'],
  ['alert runs share the watchdog group', 'an alert run has its own concurrency group (a scheduled run cannot cancel it)',
    "  group: ${{ github.event_name == 'workflow_dispatch' && inputs.lane_alert != '' && format('bsp-lane-alert-{0}', github.run_id) || 'bsp-pipeline-watchdog' }}",
    '  group: bsp-pipeline-watchdog'],
];

console.log('\nTEN-273 · deploy-lane forced release → pipeline-watchdog.yml alarm\n');
for (const [name, fn] of Object.entries(CHECKS)) check(name, () => fn(YML));
for (const [label, target, find, replace] of MUTANTS) {
  check(`mutant bites — ${label}`, () => {
    const n = YML.split(find).length - 1;
    assert.strictEqual(n, 1, `mutant anchor must occur exactly once, found ${n}`);
    let failed = false;
    try { CHECKS[target](YML.replace(find, replace)); } catch { failed = true; }
    assert.ok(failed, `"${target}" still passes with the mechanism cut out`);
  });
}
console.log(`\nlane alert: ${pass} pass, ${fails.length} fail`);
if (fails.length) process.exit(1);
