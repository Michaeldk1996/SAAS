#!/usr/bin/env node
// tools/gated-code.mjs — which code the data pipeline builds with (architecture program stage 5, 2026-11-05).
//
// pipeline.yml builds the data with the newest commit on main whose Code gate passed (gate.yml: every `npm test`
// command + the data dry-run, tools/data-dry-run.sh), laid over the newest DATA on main. A code commit whose gate failed
// or is still running is never built into the data, so a change that would trip a data gate cannot freeze the site: the
// data keeps flowing on the last gated code (incidents 2, 4, 6, 10, 12, 17 in architecture-review-report.md).
//
//   node tools/gated-code.mjs plan     → JSON {head, gated, gateRunId, action, why, paths}; action is
//       'head'    — build HEAD as is (it IS the newest gated commit, or only data changed since it)
//       'overlay' — restore `paths` (every non-data path that differs) from `gated` into the working tree
//       'keep'    — build HEAD as is and say why (no gated commit found, a GitHub read failed, the gated commit is not
//                   an ancestor of HEAD, or .github/workflows/ differs: this job's steps come from the queued SHA's
//                   workflow file, so running them over older code would be a split build)
//   node tools/gated-code.mjs apply    → plan, then for 'overlay' write each path's gated bytes into the WORKING TREE
//       only (the index stays HEAD's, so no commit-back can ever commit a reverted code file); a path the gated commit
//       does not have is removed from the working tree.
// Never fails the run: any error is 'keep' with its reason (exit 0). Env: GITHUB_TOKEN, GITHUB_REPOSITORY.
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync, appendFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickCode, GATE_WORKFLOW } from './publish-resolve.mjs';
import { isDataPath } from './deploy-lane.mjs';

const DEPTH = 300;
const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 << 20, ...opts });

/** Pure: the action for a head, a gated sha and the paths that differ between them. */
export function decide({ head, gated, isAncestor, changed }) {
  if (!gated) return { action: 'keep', why: 'no commit in the last 300 on main has a passed Code gate' };
  if (gated === head) return { action: 'head', why: 'HEAD is the newest gated commit', paths: [] };
  if (!isAncestor) return { action: 'keep', why: `the gated commit ${gated} is not an ancestor of HEAD` };
  const code = changed.filter((p) => !isDataPath(p));
  if (!code.length) return { action: 'head', why: `only data changed since the gated commit ${gated}`, paths: [] };
  const wf = code.filter((p) => p.startsWith('.github/workflows/'));
  if (wf.length) return { action: 'keep', why: `.github/workflows/ differs from the gated commit ${gated} (${wf.join(' ')}): building HEAD avoids a split build; the next gated run takes over` };
  return { action: 'overlay', why: `${code.length} code path(s) newer than the gated commit ${gated} are not built until their gate passes`, paths: code };
}

async function gateRuns() {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/${GATE_WORKFLOW}/runs?branch=main&status=success&per_page=100`, {
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`GitHub API ${GATE_WORKFLOW} runs → ${res.status}`);
  return (await res.json()).workflow_runs || [];
}

export async function plan({ runs } = {}) {
  const head = git(['rev-parse', 'HEAD']).trim();
  try {
    const shas = git(['rev-list', '--first-parent', '-n', String(DEPTH), 'HEAD']).trim().split('\n');
    const picked = pickCode(shas, runs || await gateRuns());
    const gated = picked && picked.codeSha;
    let isAncestor = false, changed = [];
    if (gated && gated !== head) {
      try { git(['merge-base', '--is-ancestor', gated, head]); isAncestor = true; } catch { isAncestor = false; }
      if (isAncestor) changed = git(['diff', '--name-only', '--no-renames', gated, head]).split('\n').filter(Boolean);
    }
    return { head, gated: gated || null, gateRunId: picked ? picked.gateRunId : null, ...decide({ head, gated, isAncestor, changed }) };
  } catch (e) {
    return { head, gated: null, action: 'keep', why: `could not read the gated commit (${e.message})` };
  }
}

export function apply(p) {
  if (p.action !== 'overlay') return 0;
  for (const f of p.paths) {
    let bytes = null;
    try { bytes = execFileSync('git', ['show', `${p.gated}:${f}`], { maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { bytes = null; }
    if (bytes === null) rmSync(f, { force: true, recursive: true });
    else { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, bytes); }
  }
  return p.paths.length;
}

async function main() {
  const mode = process.argv[2] || 'plan';
  const p = await plan();
  if (mode === 'apply') {
    const n = apply(p);
    const line = p.action === 'overlay'
      ? `Data built with the gated code ${p.gated} (gate run ${p.gateRunId}) over HEAD's data: ${n} code path(s) held back — ${p.paths.slice(0, 12).join(' ')}${p.paths.length > 12 ? ' …' : ''}`
      : p.action === 'head' ? `Data built with HEAD ${p.head}: ${p.why}.` : `Data built with HEAD ${p.head} (not gated): ${p.why}.`;
    console.log(p.action === 'keep' ? `::warning title=Gated code::${line}` : line);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Code used for this data build\n${line}\n`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `code_sha=${p.action === 'overlay' ? p.gated : p.head}\naction=${p.action}\n`);
  }
  console.log(JSON.stringify(p));
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().then(() => process.exit(0), (e) => { console.log(`::warning title=Gated code::${e.message} — building HEAD as is`); process.exit(0); });
}
