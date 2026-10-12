#!/usr/bin/env node
// tools/publish-resolve.mjs — what publish.yml publishes: the newest GATED code on main + the newest DATA the pipeline built.
//
// Founder 2026-10-12 ("do not mix the data with it and wait so long"): code and data deploy on their own clocks.
//   - CODE = the newest commit on main's first-parent line whose Code gate (gate.yml: every `npm test` command, sharded
//     across machines) PASSED. A commit whose gate failed, or is still running, is never published; the site keeps the
//     last gated code. Data-bot commits ([skip ci]) start no gate, so the newest gated commit is the newest CODE commit.
//   - DATA = the newest `site-data` artifact any pipeline.yml run uploaded. The pipeline uploads it only after the
//     site is assembled and every data check (site completeness, the reconcile suite on the built store) passed.
// Both are read when the publish run STARTS, never when it was triggered, so a publish that waited behind another
// always takes the newest of both: a skipped or superseded publish loses nothing.
//
// Usage: node tools/publish-resolve.mjs            (env GITHUB_TOKEN, GITHUB_REPOSITORY; a checkout with origin/main)
// Prints JSON {codeSha, gateRunId, dataRunId, dataArtifactId, dataCreatedAt, dataHeadSha} and writes the same keys to
// $GITHUB_OUTPUT. Exit 2 = nothing publishable yet (no gated commit or no data artifact): the live site is left as is.
import { execFileSync } from 'node:child_process';
import { appendFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const GATE_WORKFLOW = 'gate.yml';
export const DATA_ARTIFACT = 'site-data';
const MAIN_DEPTH = 300;

/** The newest sha of `mainShas` (newest first) that is in the gated set, with its run id. */
export function pickCode(mainShas, gateRuns) {
  const bySha = new Map();
  for (const r of gateRuns) if (r.conclusion === 'success' && !bySha.has(r.head_sha)) bySha.set(r.head_sha, r.id);
  for (const sha of mainShas) if (bySha.has(sha)) return { codeSha: sha, gateRunId: bySha.get(sha) };
  return null;
}

/** The newest unexpired data artifact (artifacts as the API lists them). */
export function pickData(artifacts) {
  const ok = artifacts.filter((a) => a.name === DATA_ARTIFACT && !a.expired && a.workflow_run && a.workflow_run.id)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const a = ok[0];
  return a ? { dataRunId: a.workflow_run.id, dataArtifactId: a.id, dataCreatedAt: a.created_at, dataHeadSha: a.workflow_run.head_sha || null } : null;
}

async function api(path) {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`GitHub API ${path} → ${res.status}`);
  return res.json();
}

async function main() {
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required');
  const mainShas = execFileSync('git', ['rev-list', '--first-parent', '-n', String(MAIN_DEPTH), 'origin/main'], { encoding: 'utf8' }).trim().split('\n');
  const gate = await api(`/actions/workflows/${GATE_WORKFLOW}/runs?branch=main&status=success&per_page=100`);
  const code = pickCode(mainShas, gate.workflow_runs || []);
  const arts = await api(`/actions/artifacts?name=${DATA_ARTIFACT}&per_page=20`);
  const data = pickData(arts.artifacts || []);
  const out = { ...(code || {}), ...(data || {}) };
  console.log(JSON.stringify(out, null, 2));
  if (process.env.GITHUB_OUTPUT) for (const [k, v] of Object.entries(out)) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  if (!code) { console.log(`::warning title=publish::No commit in the last ${MAIN_DEPTH} on main has a passed Code gate yet. Nothing is published; the live site is unchanged.`); return 2; }
  if (!data) { console.log(`::warning title=publish::No ${DATA_ARTIFACT} artifact from the pipeline. Nothing is published; the live site is unchanged.`); return 2; }
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().then((rc) => process.exit(rc), (e) => { console.error(`::error title=publish::${e.message}`); process.exit(1); });
}
