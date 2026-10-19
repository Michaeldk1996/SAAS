#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// TEN-263 follow-up — founder ruling 2026-09-24 ("market-edge crash goes red"),
// REVISED by founder decision 19 Oct (TEN-449): the check is ALERT ONLY. It must
// never block the site or turn a data run red. pipeline.yml runs it after the
// built site has been handed to publish.yml (the `site-data` upload); when
// market-edge was not rebuilt by THIS run it writes the reason as a ::warning::
// and into the step summary, sets the step output `stale=true` (+ `reason`), and
// exits 0. The one-Telegram-per-streak alert is the next step
// (tools/market-edge-alert.mjs), gated on that output.
//
// Inputs (all recorded by the build step, which never fails either):
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
  const reason = String(v.reason).replace(/[\r\n]+/g, ' ');
  const output = (lines) => {
    if (!process.env.GITHUB_OUTPUT) return;
    try { fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n'); } catch (_) { /* the ::warning:: is the channel */ }
  };
  if (v.ok) { console.log(reason); output(['stale=false']); return 0; }
  console.log(`::warning title=Market-edge was not rebuilt this run::${reason}. The data still published; Market edge shows the previous build.`);
  output(['stale=true', `reason=${reason}`]);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
        '### ⚠️ Market-edge was not rebuilt this run (alert only)', '',
        `- ${reason}.`,
        '- The **data still published**; the Market edge block shows the previous build. This never turns the run red (founder, 19 Oct, TEN-449).',
        '- One Telegram per streak: the next step sends it unless the previous run already alerted.',
        '- See the *Build market-edge shards* step log above.', '',
      ].join('\n'));
    } catch (_) { /* the ::warning line above is the channel */ }
  }
  return 0;
}

// Alert only: whatever happens in here, the step exits 0 (founder, 19 Oct, TEN-449).
if (require.main === module) {
  try { main(); } catch (e) { console.log(`::error title=Market-edge check could not run::${e && e.message} (alert only, the run stays green)`); }
  process.exitCode = 0;
}

module.exports = { verdict };
