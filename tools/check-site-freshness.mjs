#!/usr/bin/env node
// TEN-273 item 4 — the site-freshness alarm.
//
// FOUNDER, 2026-09-25: "Red when the live build is more than 30 minutes behind
// main while a run is queued or missing. The message names the live commit, the
// waiting commit and the stuck run."
//
// WHAT "BEHIND" MEANS HERE. The live build is `build-info.json` `commit`. The
// WAITING commit is the OLDEST commit on main that the live build does not
// contain (GitHub compare live...main). Behind = now − that commit's committer
// date. A build-info that is merely old is alarm (b) in pipeline-watchdog.yml;
// this one asks whether main has work the site does not show.
//
// WHEN IT IS NOT RED although behind. A pipeline run that is in_progress and
// STARTED AFTER the waiting commit landed re-points to the tip before building
// (pipeline.yml step "Advanced <queued> -> <tip>"), so it will carry the commit:
// that is a deploy in flight, not a stuck one. "Started" is the JOB's started_at
// (jobs API): the run's run_started_at includes its pending time. Every other state is "queued or
// missing": a run queued behind the group or a runner, an in_progress run that
// started before the commit (it cannot carry it), or no run at all.
//
// Pure decision in assessFreshness(); the CLI only fetches. Tests:
// test-ten273-site-freshness.mjs.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FRESHNESS_MAX_BEHIND_MIN = 30;
const MIN = 60 * 1000;

const short = (sha) => String(sha || '').slice(0, 8);
const subject = (c) => String(c.message || '').split('\n')[0].slice(0, 90);

// live: build-info.json · compare: GitHub compare live...main response ·
// runs: pipeline.yml runs with status queued / in_progress / waiting / pending.
export function assessFreshness({ now, live, compare, runs = [] }) {
  if (!live || !/^[0-9a-f]{40}$/.test(String(live.commit || ''))) {
    return { red: true, reason: 'no-live-commit', message: 'deployed build-info.json carries no 40-char commit — cannot tell what is live.' };
  }
  const status = compare && compare.status;
  if (status === 'identical') {
    return { red: false, reason: 'current', behindMin: 0, message: `live ${short(live.commit)} is the tip of main.` };
  }
  if (status !== 'ahead') {
    return { red: true, reason: 'not-on-main', message: `live ${short(live.commit)} is not an ancestor of main (compare status: ${status || 'unknown'}).` };
  }
  const commits = (compare.commits || []).slice();
  if (!commits.length) {
    // compare says main is ahead but lists nothing: we cannot name the waiting commit.
    return { red: true, reason: 'no-waiting-commit', message: `main is ${compare.ahead_by} commit(s) ahead of live ${short(live.commit)} but the compare listed none.` };
  }
  // compare lists oldest first, capped at 250; the first is the oldest unshipped.
  const waiting = commits[0];
  const landed = Date.parse(waiting.commit && waiting.commit.committer && waiting.commit.committer.date);
  if (!Number.isFinite(landed)) {
    return { red: true, reason: 'no-waiting-date', message: `waiting commit ${short(waiting.sha)} carries no parseable committer date.` };
  }
  const behindMin = (now - landed) / MIN;
  const tip = commits[commits.length - 1];
  // A run's own run_started_at is set at CREATION on this repo (it includes the
  // time it sat pending behind the group), so it cannot say whether the run
  // re-pointed after the commit landed. The job's started_at can: the CLI reads
  // it from the jobs API. A run without one is not counted as carrying anything.
  const inFlight = runs.find((r) => r.status === 'in_progress' && Number.isFinite(Date.parse(r.jobStartedAt)) && Date.parse(r.jobStartedAt) >= landed);
  const queued = runs.filter((r) => r.status !== 'in_progress').sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const stale = runs.filter((r) => r.status === 'in_progress' && r !== inFlight);

  const liveTxt = `live ${short(live.commit)} (built ${live.builtAt || '—'})`;
  const waitTxt = `waiting ${short(waiting.sha)} "${subject(waiting.commit || {})}" (committed ${waiting.commit.committer.date}, ${behindMin.toFixed(1)} min ago; main is ${compare.ahead_by} ahead${commits.length === compare.ahead_by ? `, tip ${short(tip.sha)}` : ''})`;
  let runTxt;
  if (queued.length) runTxt = `stuck run #${queued[0].run_number} ${queued[0].status} since ${queued[0].created_at} ${queued[0].html_url}`;
  else if (stale.length) runTxt = `no run will carry it: run #${stale[0].run_number} in_progress since ${stale[0].jobStartedAt || stale[0].run_started_at} started before the commit landed, nothing queued`;
  else runTxt = 'stuck run: none — no pipeline run is queued or running';

  if (!(behindMin > FRESHNESS_MAX_BEHIND_MIN)) {
    return { red: false, reason: 'within-limit', behindMin, message: `${liveTxt}; ${waitTxt}; within ${FRESHNESS_MAX_BEHIND_MIN} min.` };
  }
  if (inFlight) {
    return { red: false, reason: 'deploy-in-flight', behindMin, message: `${liveTxt}; ${waitTxt}; run #${inFlight.run_number} in_progress, job started ${inFlight.jobStartedAt}, will carry it.` };
  }
  return { red: true, reason: queued.length ? 'run-queued' : 'run-missing', behindMin,
    message: `site is ${behindMin.toFixed(1)} min behind main (limit ${FRESHNESS_MAX_BEHIND_MIN}). ${liveTxt}; ${waitTxt}; ${runTxt}.` };
}

async function gh(url, token) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY || 'michaeldk1996/SAAS';
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const site = process.env.SITE_URL || 'https://michaeldk1996.github.io/SAAS';
  if (!token) { console.log('::error::check-site-freshness: no GH_TOKEN'); process.exit(1); }
  let out;
  try {
    const live = process.env.BUILD_INFO_FILE
      ? JSON.parse(fs.readFileSync(process.env.BUILD_INFO_FILE, 'utf8'))
      : await (await fetch(`${site}/build-info.json?cb=${Date.now()}`, { signal: AbortSignal.timeout(20000) })).json();
    const compare = await gh(`https://api.github.com/repos/${repo}/compare/${live.commit}...main?per_page=250`, token);
    const runs = [];
    for (const st of ['queued', 'in_progress', 'waiting', 'pending', 'requested']) {
      const j = await gh(`https://api.github.com/repos/${repo}/actions/workflows/pipeline.yml/runs?status=${st}&per_page=50`, token);
      runs.push(...(j.workflow_runs || []));
    }
    for (const r of runs.filter((x) => x.status === 'in_progress')) {
      const j = await gh(`https://api.github.com/repos/${repo}/actions/runs/${r.id}/jobs?per_page=50`, token);
      const starts = (j.jobs || []).map((x) => Date.parse(x.started_at)).filter(Number.isFinite);
      if (starts.length) r.jobStartedAt = new Date(Math.min(...starts)).toISOString();
    }
    out = assessFreshness({ now: Date.now(), live, compare, runs });
  } catch (e) {
    // Undetermined is not fresh. Say so rather than pass.
    console.log(`::error::site-freshness could not be determined: ${e.message}`);
    process.exit(1);
  }
  if (out.red) { console.log(`::error::${out.message}`); process.exit(1); }
  console.log(`site-freshness ok (${out.reason}): ${out.message}`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
