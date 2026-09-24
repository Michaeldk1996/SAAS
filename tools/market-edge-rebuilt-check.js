#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// TEN-263 follow-up — founder ruling 2026-09-24: "Market-edge crash goes red, as
// a post-deploy step." The site still deploys (the committed market-edge floor
// ships); then the LAST step of pipeline.yml runs this and fails the run, with
// the reason, when market-edge was not rebuilt by THIS run.
//
// Inputs (all recorded before the deploy, never failing it):
//   MARKET_EDGE_BUILD_START  UTC second the build step began (job env)
//   MARKET_EDGE_BUILD_RC     build-market-edge.js exit status (job env)
//   argv[2]                  the SHIPPED index (_site/market-edge-index.json)
//
// Not rebuilt =
//   - the build step never ran (no start recorded), or
//   - the builder exited non-zero, or
//   - the shipped index's builtAt is absent, unparseable, or older than the
//     build step's start (the committed floor shipped).
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');

function verdict({ start, rc, index }) {
  const started = Date.parse(start || '');
  if (!Number.isFinite(started)) {
    return { ok: false, reason: 'the market-edge build step did not run in this job (MARKET_EDGE_BUILD_START not set)' };
  }
  const floor = index
    ? `builtAt ${JSON.stringify(index.builtAt || null)}, commit ${JSON.stringify(index.builtFromCommit || null)}`
    : 'no readable index';
  if (rc == null || rc === '' || !/^\d+$/.test(String(rc))) {
    return { ok: false, reason: `the market-edge build step recorded no exit status (MARKET_EDGE_BUILD_RC=${JSON.stringify(rc == null ? null : rc)}); shipped index: ${floor}` };
  }
  if (Number(rc) !== 0) {
    return { ok: false, reason: `build-market-edge.js exited ${rc} in this run; the committed market-edge floor shipped instead (${floor})` };
  }
  if (!index) return { ok: false, reason: 'the shipped market-edge-index.json is missing or unreadable' };
  const builtAt = Date.parse(index.builtAt || '');
  // builtAt carries milliseconds and the start is whole seconds, so a build in the
  // same second as the step start compares >= and passes.
  if (!Number.isFinite(builtAt) || builtAt < started) {
    return { ok: false, reason: `the shipped market-edge index was not built by this run: ${floor}, but this run's build step started ${start}` };
  }
  return { ok: true, reason: `market-edge rebuilt this run: builtAt ${index.builtAt}, commit ${index.builtFromCommit || 'unknown'}` };
}

function main() {
  const file = process.argv[2] || '_site/market-edge-index.json';
  let index = null;
  try { index = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { index = null; }
  const v = verdict({ start: process.env.MARKET_EDGE_BUILD_START, rc: process.env.MARKET_EDGE_BUILD_RC, index });
  if (v.ok) { console.log(v.reason); return 0; }
  console.log(`::error title=Market-edge was not rebuilt this run::${v.reason}. The site deployed normally; Market edge is showing the previous build.`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
        '### Market-edge was not rebuilt this run', '',
        `- ${v.reason}.`,
        '- The **site deployed normally**; the Market edge block shows the previous build.',
        '- See the *Build market-edge shards* step log above.', '',
      ].join('\n'));
    } catch (_) { /* the ::error line above is the channel that must not fail */ }
  }
  return 1;
}

if (require.main === module) process.exitCode = main();

module.exports = { verdict };
