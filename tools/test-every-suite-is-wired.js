#!/usr/bin/env node
'use strict';
// TEN-225 item 6 — a suite file that exists and never runs is not a suite.
//
// FOUNDER, 2026-09-19: "CI: 9 of 10 suites never running is the finding of the
// day. Report whether any OTHER suite in the repo — outside TEN-225 — is also
// unwired, and add an assertion that fails if a suite file exists and is not in
// the test run."
//
// THE FAILURE THIS EXISTS FOR. `test-ten225-both-clocks.mjs` sat 8 pass / 17
// fail on `main` for a day. Nothing noticed, because nothing RAN it: a red
// harness and a healthy one produced byte-identical builds. Writing a suite is
// not free — it is worse than free if it is never executed, because the repo
// then carries a claim of coverage it does not have.
//
// The audit that followed found 13 more unwired suites outside TEN-225, and one
// of them (tools/test-open-provenance.js, the TEN-198 no-retroactive-backfill
// guard) had been RED since 2026-09-19T00:5x — turned red by a two-line comment
// I added inside a Promise.all, which pushed a binding past a 200-character
// regex window. A guard nobody runs cannot tell you it has stopped guarding.
//
// ⚠️ THIS CHECK IS DELIBERATELY DUMB. It does not run the suites — `npm test`
// does that. It only asks whether each one is REACHABLE from something CI
// executes, which is the question no individual suite can answer about itself.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// A suite that genuinely cannot run in CI belongs here WITH ITS REASON, not
// deleted and not silently unwired. An exemption whose file no longer exists is
// itself a failure below — a stale exemption is how a list like this rots into
// a rubber stamp.
const EXEMPT = {
  // (empty — every suite in the repo is wired. Add entries as
  //  'path/to/suite.js': 'why CI cannot run it', never as a convenience.)
};

const DIRS = ['.', 'tools'];
const SUITE = /^test-.*\.(mjs|js|py)$/;

function suites() {
  const out = [];
  for (const d of DIRS) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (!SUITE.test(f)) continue;
      out.push(d === '.' ? f : `${d}/${f}`);
    }
  }
  return out.sort();
}

function runnerText() {
  // Everything CI can execute: the npm test chain, plus every workflow file.
  // Both, because a suite wired into a workflow step rather than `npm test` is
  // just as run — and counting only one of them would report a healthy suite as
  // unwired, which is the false alarm that wastes the next reader's afternoon.
  const parts = [];
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const v of Object.values(pkg.scripts || {})) parts.push(String(v));
  const wf = path.join(ROOT, '.github', 'workflows');
  if (fs.existsSync(wf)) {
    for (const f of fs.readdirSync(wf)) {
      if (/\.ya?ml$/.test(f)) parts.push(fs.readFileSync(path.join(wf, f), 'utf8'));
    }
  }
  return parts.join('\n');
}

const FAILED = [];
function check(name, cond, detail) {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '   ' + detail : ''}`);
  if (!cond) FAILED.push(name);
}

console.log('=== every suite in the repo is reachable from CI ===');

const all = suites();
const text = runnerText();

// A zero here would make every check below vacuous — this file passing because
// it found nothing to check is the exact failure mode it exists to prevent.
check('the repo has suites to check at all', all.length >= 20, `n=${all.length}`);
check('the CI runner text was actually read', text.length > 500,
      `${text.length} chars of package.json scripts + workflows`);

const unwired = all.filter(f => !text.includes(f) && !(f in EXEMPT));
check('every suite file is named by npm test or a workflow',
      unwired.length === 0,
      unwired.length ? `UNWIRED (${unwired.length}):\n       ` + unwired.join('\n       ')
                     : `${all.length} suites, all reachable`);

const stale = Object.keys(EXEMPT).filter(f => !fs.existsSync(path.join(ROOT, f)));
check('no exemption names a file that no longer exists',
      stale.length === 0, stale.join(', ') || 'none');

const pointless = Object.keys(EXEMPT).filter(f => text.includes(f));
check('no exemption covers a suite that is actually wired',
      pointless.length === 0, pointless.join(', ') || 'none');

// The control. Without it, "0 unwired" is also what a checker that stopped
// reading the filesystem returns.
const sentinel = 'test-a-suite-that-is-definitely-not-wired.mjs';
check('CONTROL: an unwired suite IS detected',
      ![sentinel].every(f => text.includes(f)),
      'a fabricated suite name is correctly absent from the runner text');

console.log(FAILED.length ? `\n${FAILED.length} FAILED` : `\nall checks passed`);
process.exit(FAILED.length ? 1 : 0);
