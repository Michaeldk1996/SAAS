// Stage 6 (2026-11-08) — the Player Profile's three roster-wide pools, computed by the pipeline.
//
// player-profile-v2.js pools three figures over EVERY profile in the store: the tour "from a set down" rate
// (tourFromASetDown), the Situational table's set-based tour rows (sitTour) and the proven draw sizes (drawIndex). All
// three read each player's recentForm only. Once the page stopped loading player-profiles.json up front, only the
// opened players were in memory, so the pools would shrink. This runs the module's OWN functions over the whole store
// (one definition, no copy of the arithmetic) and the result rides in profile-roster.json as `pools`; the page reads it
// (window.profileRosterPools) before falling back to the players it holds.
'use strict';
const fs = require('fs');
const path = require('path');

function profilePools(store, opts) {
  const src = fs.readFileSync((opts && opts.src) || path.join(__dirname, 'player-profile-v2.js'), 'utf8');
  const W = { FEATURE_PP2: true, playerProfiles: { players: (store && store.players) || {} } };
  const prev = global.window;
  global.window = W;
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', src)(W);
  } finally {
    if (prev === undefined) delete global.window; else global.window = prev;
  }
  const I = W.PlayerProfileV2 && W.PlayerProfileV2._internals;
  if (!I || typeof I.tourFromASetDown !== 'function' || typeof I.sitTour !== 'function' || typeof I.drawIndex !== 'function') {
    throw new Error('profile-pools: player-profile-v2.js did not export the pool functions');
  }
  const sit = I.sitTour();            // no situational-splits store here: the set rows only, as pooled from recentForm
  return {
    setDown: I.tourFromASetDown(),
    sitSet: { rows: sit.rows, players: sit.players },
    draw: I.drawIndex(),
  };
}

module.exports = { profilePools };
