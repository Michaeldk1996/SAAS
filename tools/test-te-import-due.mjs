#!/usr/bin/env node
// te-import-scheduled.yml rides every data-pipeline completion and imports only when due (founder 2026-11-16, "fix both").
// Cases (tools/te-import-due.mjs isDue + the workflow's wiring), each with a mutant that must turn it red:
//   1. a schedule or a manual dispatch is always due
//   2. a pipeline ride with an import started 90 min ago is NOT due; one 171 min ago IS due
//   3. a run whose import job was skipped (an earlier not-due ride) does not count as an import
//   4. GitHub unreadable → due (an extra insert-only import adds nothing)
//   5. this run itself never counts
//   6. the workflow: workflow_run on 'BSP data pipeline', the cron kept, the import job needs the due job and is gated on
//      it, and the archive lock sits on the import JOB, not the workflow (a not-due ride never queues in it)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, 'te-import-due.mjs'), 'utf8');
const WF = fs.readFileSync(path.join(HERE, '..', '.github', 'workflows', 'te-import-scheduled.yml'), 'utf8');
const NOW = Date.parse('2026-11-17T01:00:00Z');
const ago = (min) => new Date(NOW - min * 60e3).toISOString();
const ran = (id, min) => ({ id, run_started_at: ago(min), jobs: [{ name: 'due', conclusion: 'success' }, { name: 'import', conclusion: 'success', status: 'completed' }] });
const skipped = (id, min) => ({ id, run_started_at: ago(min), jobs: [{ name: 'due', conclusion: 'success' }, { name: 'import', conclusion: 'skipped', status: 'completed' }] });

const CHECKS = {
  '1. a schedule or a manual dispatch is always due': (M) =>
    M.isDue({ event: 'schedule', runs: [ran(1, 5)], now: NOW }).due && M.isDue({ event: 'workflow_dispatch', runs: [ran(1, 5)], now: NOW }).due,
  '2. a ride is not due 90 min after an import, due 171 min after': (M) =>
    !M.isDue({ event: 'workflow_run', runs: [ran(1, 90)], now: NOW }).due && M.isDue({ event: 'workflow_run', runs: [ran(1, 171)], now: NOW }).due,
  '3. a skipped import (an earlier not-due ride) is not an import': (M) =>
    M.isDue({ event: 'workflow_run', runs: [skipped(2, 10), skipped(3, 25), ran(4, 200)], now: NOW }).due,
  '4. GitHub unreadable → due': (M) => M.isDue({ event: 'workflow_run', runs: null, now: NOW }).due,
  '5. this run itself never counts': (M) => M.isDue({ event: 'workflow_run', runs: [ran(9, 0)], now: NOW, selfId: 9 }).due,
};
const WF_CHECK = (wf) => /workflow_run:\n\s+workflows: \['BSP data pipeline'\]\n\s+types: \[completed\]/.test(wf)
  && /cron: '41 \*\/3 \* \* \*'/.test(wf)
  && /\n  import:\n    needs: due\n    if: needs\.due\.outputs\.due == 'true'/.test(wf)
  && /\n  import:[\s\S]*?\n    concurrency:\n      group: historical-archive/.test(wf)
  && !/\nconcurrency:/.test(wf)
  && /node tools\/te-import-due\.mjs/.test(wf) && /actions: read/.test(wf);

const MUTANTS = [
  ['a ride is always due', (s) => s.replace("if (event !== 'workflow_run') return", "if (true) return"), null],
  ['a skipped import counts as an import', (s) => s.replace("imp && imp.conclusion !== 'skipped' && imp.status !== 'queued'", "imp"), null],
  ['GitHub unreadable → not due', (s) => s.replace("return { due: true, why: 'GitHub unreadable", "return { due: false, why: 'GitHub unreadable"), null],
  ['this run counts itself', (s) => s.replace("if (String(r.id) === String(selfId)) continue;", ''), null],
  ['the window is too short (30 min)', (s) => s.replace('export const DUE_MIN = 170;', 'export const DUE_MIN = 30;'), null],
  ['the archive lock back on the workflow', null, (w) => w.replace('jobs:\n  due:', 'concurrency:\n  group: historical-archive\n  cancel-in-progress: false\njobs:\n  due:')],
  ['the pipeline trigger removed', null, (w) => w.replace("  workflow_run:\n    workflows: ['BSP data pipeline']\n    types: [completed]\n", '')],
  ['the import not gated on due', null, (w) => w.replace("    if: needs.due.outputs.due == 'true'\n", '')],
];

async function load(src) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'te-due-')), 'te-import-due.mjs');
  fs.writeFileSync(f, src);
  return import(pathToFileURL(f).href);
}
const runAll = (M, wf) => {
  const fails = Object.entries(CHECKS).filter(([, fn]) => { try { return !fn(M); } catch { return true; } }).map(([n]) => n);
  if (!WF_CHECK(wf)) fails.push('6. workflow wiring');
  return fails;
};

let failed = 0;
const base = runAll(await load(SRC), WF);
for (const n of [...Object.keys(CHECKS), '6. workflow wiring']) {
  const bad = base.includes(n); if (bad) failed++;
  console.log((bad ? '  FAIL ' : '  ok   ') + n);
}
for (const [name, ms, mw] of MUTANTS) {
  const s2 = ms ? ms(SRC) : SRC, w2 = mw ? mw(WF) : WF;
  if (s2 === SRC && w2 === WF) { failed++; console.log('  FAIL mutant did not apply: ' + name); continue; }
  const red = runAll(await load(s2), w2).length > 0;
  if (!red) failed++;
  console.log((red ? '  ok   mutant caught: ' : '  FAIL mutant survived: ') + name);
}
console.log(`\ntest-te-import-due: ${Object.keys(CHECKS).length + 1} checks, ${MUTANTS.length} mutants, ${failed} failed`);
process.exit(failed ? 1 : 0);
