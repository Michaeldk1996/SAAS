#!/usr/bin/env node
// Is a Tennis Explorer scheduled import due? (founder 2026-11-16, "fix both")
//
// te-import-scheduled.yml's own `cron: '41 */3 * * *'` is fired by GitHub only every 4–9 h (measured 7–16 Nov: 25 scheduled
// runs in 10 days, gaps up to 9 h 24 min), so a finished batch waited up to a working day. The data pipeline (`BSP data
// pipeline`) completes every 10–15 min off an external ping, so the import now ALSO rides each pipeline completion
// (workflow_run). This script decides whether that ride runs the import: due when no run of this workflow whose import job
// actually ran (not skipped) STARTED in the last DUE_MIN minutes. A schedule or a manual dispatch is always due.
// Unreadable GitHub = due (the import is insert-only and idempotent: an extra run adds nothing; a missed one delays data).
//
// Run (in the workflow): node tools/te-import-due.mjs  → prints due=true|false to $GITHUB_OUTPUT (and stdout)
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_RUN_ID; TE_DUE_API (tests: a fake API base).
import fs from 'node:fs';

export const DUE_MIN = 170;            // every 3 h, with 10 min of slack for the pipeline's own cadence
export const WORKFLOW_FILE = 'te-import-scheduled.yml';
export const IMPORT_JOB = 'import';

// runs: [{ id, run_started_at, jobs: [{ name, conclusion, status }] }] (newest first); now: ms
export function isDue({ event, runs, now, selfId }) {
  if (event !== 'workflow_run') return { due: true, why: `event ${event}` };
  if (!Array.isArray(runs)) return { due: true, why: 'GitHub unreadable — due (an extra import adds nothing)' };
  const cut = now - DUE_MIN * 60e3;
  for (const r of runs) {
    if (String(r.id) === String(selfId)) continue;
    const t = Date.parse(r.run_started_at || r.created_at || '');
    if (!(t >= cut)) continue;
    const imp = (r.jobs || []).find((j) => j.name === IMPORT_JOB);
    if (imp && imp.conclusion !== 'skipped' && imp.status !== 'queued') {
      return { due: false, why: `run ${r.id} ran the import ${Math.round((now - t) / 60e3)} min ago` };
    }
  }
  return { due: true, why: `no import in the last ${DUE_MIN} min` };
}

async function readRuns(api, repo, token) {
  const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  const get = async (u) => { const r = await fetch(u, { headers: h }); if (!r.ok) throw new Error(`HTTP ${r.status} ${u}`); return r.json(); };
  const list = await get(`${api}/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=20`);
  const runs = [];
  for (const r of list.workflow_runs || []) {
    const jobs = await get(`${api}/repos/${repo}/actions/runs/${r.id}/jobs?per_page=10`);
    runs.push({ id: r.id, run_started_at: r.run_started_at, created_at: r.created_at, jobs: jobs.jobs || [] });
  }
  return runs;
}

async function main() {
  const event = process.env.GITHUB_EVENT_NAME || 'workflow_dispatch';
  let runs = null;
  if (event === 'workflow_run') {
    try { runs = await readRuns(process.env.TE_DUE_API || 'https://api.github.com', process.env.GITHUB_REPOSITORY, process.env.GITHUB_TOKEN); }
    catch (e) { console.log(`::warning::te-import-due: ${e.message} — treating the import as due`); }
  }
  const v = isDue({ event, runs, now: Date.now(), selfId: process.env.GITHUB_RUN_ID });
  console.log(`due=${v.due} (${v.why})`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `due=${v.due}\n`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
