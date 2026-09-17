#!/usr/bin/env node
/**
 * build-player-index.js — the searchable ATP roster, decoupled from the profile payload.
 *
 * WHY THIS EXISTS
 * The player search box filters `player-profiles.json`, so it can only find a
 * player whose FULL profile was published. That roster is derived from today's
 * board (seeds) plus the opponents discovered in their recent form, so on a
 * 4-match day it collapses to a few dozen names and "Alexander Zverev" returns
 * "No player found". Search coverage and payload weight were welded together.
 *
 * This splits them. The index carries only what the dropdown renders — key,
 * name, rank, country — for EVERY ranked ATP player. Measured 2026-09-17:
 * 2,342 players, 70.6 KB raw, 33.6 KB gzipped over the wire. The profile
 * payload stays whatever size it is; finding a player no longer depends on it.
 *
 * COST: zero extra API calls when folded into bsp-pipeline.js. That pipeline
 * already calls get_standings once per run (loadAtpStandings, TEN-133) to join
 * live ranks — it reads `place`, keeps it, and throws `player` and `country`
 * away. This file is those discarded columns. Standalone here so it can be
 * staged and measured without touching the pipeline; the intended home is one
 * call inside runPipeline().
 *
 * FAIL-CLOSED, same contract as loadAtpStandings(): a short return would
 * silently shrink the searchable roster, which is exactly the failure mode this
 * file is fixing, so anything under MIN_STANDINGS_ROWS throws and writes
 * nothing — the previous index stays live.
 *
 * `hasProfile` is NOT set here. The consumer stamps it by intersecting with the
 * published profile keys, so the dropdown can tell "we have no such player"
 * apart from "we know him, his profile isn't built yet" — two different truths
 * that both render as "No player found" today.
 *
 * Usage: node build-player-index.js   (reads API_TENNIS_KEY from .env)
 */
'use strict';

const fs = require('fs');

const API_TENNIS_BASE = 'https://api.api-tennis.com/tennis/';
const OUT_PATH = 'player-index.json';
// Same floor as bsp-pipeline.js loadAtpStandings(): the live list is ~2,300
// rows, and a partial return in the 500-1,500 range would pass a naive
// truthiness check while dropping hundreds of players out of search.
const MIN_STANDINGS_ROWS = 1800;

function apiKey() {
  if (process.env.API_TENNIS_KEY) return process.env.API_TENNIS_KEY;
  // Match the pipeline's convention: plain KEY=value .env, no dotenv dependency.
  const env = fs.readFileSync('.env', 'utf8');
  const line = env.split('\n').find(l => l.startsWith('API_TENNIS_KEY='));
  if (!line) throw new Error('API_TENNIS_KEY not in env or .env');
  return line.slice('API_TENNIS_KEY='.length).trim();
}

async function buildPlayerIndex() {
  const url = `${API_TENNIS_BASE}?method=get_standings&APIkey=${apiKey()}&event_type=ATP`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`get_standings HTTP ${res.status} — failing closed, index not rewritten.`);
  const data = await res.json();
  const rows = Array.isArray(data.result) ? data.result : [];

  const byKey = new Map();
  for (const r of rows) {
    if (!r || r.player_key == null || !r.player) continue;
    // Dash (null), never 0 — Number("") === 0 would mint a phantom rank 0 and
    // sort unranked players to the top of the dropdown.
    const place = Number(r.place);
    byKey.set(String(r.player_key), {
      key: String(r.player_key),
      name: String(r.player),
      rank: (Number.isFinite(place) && place >= 1) ? place : null,
      country: r.country || null,
    });
  }

  // get_standings is the CURRENT ranking list, so it is not a superset of who
  // we can show: a retired or unranked player keeps his profile but loses his
  // row. Measured 2026-09-17: 2 of the 31 published profiles had no standings
  // row. Union them in (rank null -> dash) so nobody who HAS a profile is
  // unsearchable. Optional input — absent file just means standings only.
  let fromProfiles = 0;
  try {
    const pp = JSON.parse(fs.readFileSync('player-profiles.json', 'utf8'));
    for (const [key, p] of Object.entries(pp.players || {})) {
      if (byKey.has(String(key)) || !p || !p.name) continue;
      byKey.set(String(key), { key: String(key), name: String(p.name), rank: null, country: p.country || null });
      fromProfiles++;
    }
  } catch (e) { /* no local profiles file — standings only */ }
  if (fromProfiles) console.log(`Unioned ${fromProfiles} profiled player(s) with no current standings row.`);

  // Floor applies to the STANDINGS contribution, not the union — otherwise a
  // large stale profiles file could mask a truncated standings fetch.
  if (byKey.size - fromProfiles < MIN_STANDINGS_ROWS) {
    throw new Error(`get_standings returned ${byKey.size - fromProfiles} players (< ${MIN_STANDINGS_ROWS}) — failing closed: `
      + `${OUT_PATH} left untouched so search keeps the last good roster.`);
  }

  const players = [...byKey.values()].sort((a, b) => {
    const ra = a.rank == null ? Infinity : a.rank;
    const rb = b.rank == null ? Infinity : b.rank;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });

  return { fetchedAt: new Date().toISOString(), source: 'api-tennis get_standings (ATP)', players };
}

async function main() {
  const index = await buildPlayerIndex();
  // Compact — this ships to the browser on every page load.
  fs.writeFileSync(OUT_PATH, JSON.stringify(index));
  const ranked = index.players.filter(p => p.rank != null).length;
  console.log(`Wrote ${OUT_PATH}: ${index.players.length} players (${ranked} ranked), `
    + `${fs.statSync(OUT_PATH).size} bytes raw.`);
}

if (require.main === module) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { buildPlayerIndex };
