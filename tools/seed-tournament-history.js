#!/usr/bin/env node
'use strict';
// tools/seed-tournament-history.js — put the DEPLOYED tournament-history/ shards into the checkout
// before the build, exactly as the in-place pre-deploy gate used to.
//
// TEN-351: until 2026-09-30 `npm test` ran IN the build checkout, and tools/test-pp2-reconcile.js
// hydrated tournament-history/ there from the deployed store. The build (bsp-pipeline.js
// writeTournamentHistoryShards) then overwrote the shards it rebuilt and never deleted the rest, and
// "Assemble site" copies the whole directory — so every deployed shard the build did not rewrite was
// republished. The gate now runs in its own worktrees (tools/gate-run.mjs), so this step keeps that
// side effect explicitly and the published tournament-history/ is unchanged. Whether a shard the
// build no longer writes should stay published is a founder call, not a speed-up.
//
// Same reads and the same fail-closed rule as the gate's hydrate: an unreadable deployed profile store
// or a short hydrate exits 1, and that would have failed the gate before.
const DEPLOYED = require('./deployed-store.js');

const STORE = DEPLOYED.playerProfiles();
if (STORE.source !== 'deployed') {
  console.error(`::error title=tournament-history seed::could not read the deployed player-profiles.json (${STORE.drift && STORE.drift.why})`);
  process.exit(1);
}
const TH = DEPLOYED.hydrateTournamentHistory(STORE.players);
if (TH.error || TH.attached < TH.indexed || !TH.indexed) {
  console.error(`::error title=tournament-history seed::${TH.error || `attached ${TH.attached} of ${TH.indexed} indexed players`}`);
  process.exit(1);
}
console.log(`tournament-history/: ${TH.attached}/${TH.indexed} deployed shards seeded (${TH.fetched} fetched) before the build.`);
