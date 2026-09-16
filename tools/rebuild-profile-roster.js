#!/usr/bin/env node
/**
 * TEN-206 Q2 — one-off full roster rebuild of player-profiles-cache.json.
 *
 * Founder ruling (2026-09-16, Q2):
 *   a) Rebuild the complete roster (~490) from source at PROFILE_SCHEMA_VERSION 14.
 *      Report API request cost and runtime BEFORE running it.
 *   b) From then on the cache is ONLY a skip-rebuild optimisation: an entry is
 *      reused if and only if schema version matches AND it is within TTL.
 *   c) Never publish a profile missing careerByYear. The roster gate asserts
 *      ZERO shells, not <10%.
 *
 * This script does NOT publish and does NOT touch player-profiles.json. It only
 * refreshes the cache that the pipeline then reads. Publishing stays the
 * pipeline's job, behind the gate in tools/test-roster-gate.js.
 *
 * It drives the pipeline's OWN buildOneProfile + fetchPlayerCareerHistory, so a
 * rebuilt entry is exactly what the pipeline would have produced — no second
 * implementation to drift from the schema version.
 *
 * Usage:
 *   node tools/rebuild-profile-roster.js --measure --limit 6   # cost probe, writes nothing
 *   node tools/rebuild-profile-roster.js --limit 50            # partial, resumable
 *   node tools/rebuild-profile-roster.js                       # full roster
 *
 * Resumable by construction: every completed player is written back to the cache
 * (checkpointed every --checkpoint players), and a re-run skips anything already
 * at the current schema version and within TTL. A crash costs at most one
 * checkpoint interval, never the whole run.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
process.chdir(REPO);

// ---------------------------------------------------------------- arg parsing
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const MEASURE = flag('measure');
const LIMIT = parseInt(opt('limit', '0'), 10) || Infinity;
const CHECKPOINT = parseInt(opt('checkpoint', '10'), 10);
const PACE_MS = parseInt(opt('pace', '0'), 10);

// ------------------------------------------------- request counter (measured)
// Wrap global fetch BEFORE requiring the pipeline so every api-tennis call the
// builder makes is counted, including ones inside helpers we never name here.
// This is how the "N requests per player" figure is measured rather than
// inferred by reading the source — helpers memoize, so a static count lies.
const reqs = { total: 0, byMethod: {}, bytes: 0, failures: 0 };
const _fetch = global.fetch;
global.fetch = async function countingFetch(url, init) {
  const u = String(url);
  if (u.includes('api.api-tennis.com')) {
    reqs.total++;
    const m = (u.match(/[?&]method=([^&]+)/) || [])[1] || 'other';
    reqs.byMethod[m] = (reqs.byMethod[m] || 0) + 1;
  }
  const res = await _fetch(url, init);
  if (!res.ok) reqs.failures++;
  return res;
};

const P = require('../bsp-pipeline.js');
const {
  buildOneProfile, fetchPlayerCareerHistory, loadTournamentSurfaceMap,
  historyCacheFresh, PROFILE_SCHEMA_VERSION, OPPONENT_PROFILE_MAX_AGE_MS,
  PLAYER_PROFILE_CACHE_PATH, TOURNAMENT_HISTORY_CACHE_PATH,
  TOURNAMENT_HISTORY_SCHEMA_VERSION,
} = P;

const readJson = (p, dflt) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return dflt; }
};

// ------------------------------------------------------------------ the roster
/**
 * The roster is the union of everyone we already know about and everyone on the
 * current board. Deliberately a UNION and not "today's board": the published
 * roster tracking board size is the 137-vs-428 defect this rebuild exists to fix.
 * Names come from the cache (its stored profile) or the board.
 */
function buildRoster(cachedPlayers, matches) {
  const roster = new Map(); // key -> { name, source }
  for (const [key, entry] of Object.entries(cachedPlayers)) {
    const name = (entry && entry.profile && (entry.profile.name || entry.profile.playerName)) || null;
    roster.set(String(key), { name, source: 'cache' });
  }
  for (const m of matches) {
    if (m.p1Key && m.p1) roster.set(String(m.p1Key), { name: m.p1, source: 'board' });
    if (m.p2Key && m.p2) roster.set(String(m.p2Key), { name: m.p2, source: 'board' });
  }
  return roster;
}

/** Founder ruling (b): schema version AND TTL, both, or rebuild. */
function isReusable(entry, now) {
  return !!(entry && entry.builtAt
    && entry.v === PROFILE_SCHEMA_VERSION
    && (now - new Date(entry.builtAt).getTime() < OPPONENT_PROFILE_MAX_AGE_MS));
}

async function main() {
  if (!process.env.API_TENNIS_KEY) {
    console.error('API_TENNIS_KEY is not set — cannot rebuild from source.');
    process.exit(2);
  }

  const cacheFile = readJson(PLAYER_PROFILE_CACHE_PATH, { players: {} });
  const cachedPlayers = cacheFile.players || {};
  const historyFile = readJson(TOURNAMENT_HISTORY_CACHE_PATH, { players: {} });
  const historyCache = historyFile.players || {};

  const board = readJson('matches.json', { matches: [] });
  const matches = Array.isArray(board) ? board : (board.matches || []);

  const roster = buildRoster(cachedPlayers, matches);
  const now = Date.now();

  const todo = [];
  let reusable = 0;
  for (const [key, meta] of roster) {
    if (isReusable(cachedPlayers[key], now)) { reusable++; continue; }
    todo.push([key, meta]);
  }

  console.log(`Roster: ${roster.size} players `
    + `(${[...roster.values()].filter(v => v.source === 'cache').length} from cache, `
    + `${[...roster.values()].filter(v => v.source === 'board').length} from today's board)`);
  console.log(`At schema v${PROFILE_SCHEMA_VERSION} and within TTL: ${reusable} — rebuild needed: ${todo.length}`);

  // The pipeline passes loadTournamentSurfaceMap() (clay/hard/grass), NOT
  // loadTournamentCourtMap() (indoor/outdoor). Handing the builder the court map
  // makes seasonRowFromFixtures index tally['indoor'] and throw — measured, and
  // the reason this line names the surface map explicitly.
  const surfaceMap = await loadTournamentSurfaceMap();
  console.log(`Surface map: ${surfaceMap.size} tournaments.`);

  const work = todo.slice(0, LIMIT === Infinity ? todo.length : LIMIT);
  if (MEASURE) console.log(`\n--measure: building ${work.length} player(s), writing NOTHING.\n`);

  const t0 = Date.now();
  const perPlayer = [];
  let built = 0, nullProfiles = 0, noCareer = 0;

  for (const [key, meta] of work) {
    const rBefore = reqs.total;
    const pStart = Date.now();
    let profile = null;
    try {
      ({ profile } = await buildOneProfile(key, meta.name || String(key), surfaceMap));
    } catch (e) {
      console.log(`  ! ${key} ${meta.name || ''} — buildOneProfile threw: ${e.message}`);
      if (process.env.STACK) console.log(e.stack);
    }

    // Career history: the same call the pipeline makes, so the rebuilt entry is
    // complete rather than a profile whose tournamentHistory lands a run later.
    let history;
    if (profile) {
      const cachedH = historyCache[key];
      if (historyCacheFresh(cachedH, Date.now(), false)) {
        history = cachedH.history;
      } else {
        history = await fetchPlayerCareerHistory(key);
        if (history) {
          historyCache[key] = {
            builtAt: new Date().toISOString(),
            v: TOURNAMENT_HISTORY_SCHEMA_VERSION, history,
          };
        } else if (cachedH && cachedH.history) {
          // TEN-169: never overwrite a good history with a transient null.
          history = cachedH.history;
        }
      }
      if (history) profile.tournamentHistory = history;
    }

    const dt = Date.now() - pStart;
    const used = reqs.total - rBefore;
    perPlayer.push({ key, name: meta.name, ms: dt, reqs: used, ok: !!profile });
    if (!profile) nullProfiles++;
    else {
      built++;
      if (!profile.careerByYear) noCareer++;
    }

    if (!MEASURE) {
      cachedPlayers[key] = {
        builtAt: new Date().toISOString(), v: PROFILE_SCHEMA_VERSION, profile: profile || null,
      };
      if (built % CHECKPOINT === 0) {
        fs.writeFileSync(PLAYER_PROFILE_CACHE_PATH,
          JSON.stringify({ fetchedAt: new Date().toISOString(), players: cachedPlayers }));
        fs.writeFileSync(TOURNAMENT_HISTORY_CACHE_PATH,
          JSON.stringify({ fetchedAt: new Date().toISOString(), players: historyCache }));
      }
    }

    const pct = Math.round((perPlayer.length / work.length) * 100);
    console.log(`  [${perPlayer.length}/${work.length} ${pct}%] ${meta.name || key} — `
      + `${profile ? 'ok' : 'NO PROFILE'} · ${used} req · ${(dt / 1000).toFixed(1)}s`
      + `${profile && !profile.careerByYear ? ' · NO careerByYear' : ''}`);

    if (PACE_MS) await new Promise(r => setTimeout(r, PACE_MS));
  }

  if (!MEASURE && work.length) {
    fs.writeFileSync(PLAYER_PROFILE_CACHE_PATH,
      JSON.stringify({ fetchedAt: new Date().toISOString(), players: cachedPlayers }));
    fs.writeFileSync(TOURNAMENT_HISTORY_CACHE_PATH,
      JSON.stringify({ fetchedAt: new Date().toISOString(), players: historyCache }));
  }

  // -------------------------------------------------------------- the report
  const elapsed = (Date.now() - t0) / 1000;
  const msList = perPlayer.map(p => p.ms).sort((a, b) => a - b);
  const reqList = perPlayer.map(p => p.reqs).sort((a, b) => a - b);
  const pct = (arr, f) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * f))] : 0);

  console.log('\n================ MEASURED ================');
  console.log(`players built      : ${built} ok, ${nullProfiles} returned no profile`);
  console.log(`missing careerByYear: ${noCareer}`);
  console.log(`api-tennis requests: ${reqs.total} total, ${reqs.failures} non-2xx`);
  console.log(`  by method        : ${JSON.stringify(reqs.byMethod)}`);
  console.log(`per player         : median ${pct(reqList, 0.5)} req · `
    + `p95 ${pct(reqList, 0.95)} req · mean ${(reqs.total / Math.max(1, perPlayer.length)).toFixed(2)} req`);
  console.log(`latency per player : median ${(pct(msList, 0.5) / 1000).toFixed(1)}s · `
    + `p95 ${(pct(msList, 0.95) / 1000).toFixed(1)}s · max ${(pct(msList, 1) / 1000).toFixed(1)}s`);
  console.log(`wall clock         : ${elapsed.toFixed(1)}s for ${perPlayer.length} player(s)`);
  if (perPlayer.length) {
    const projected = (elapsed / perPlayer.length) * todo.length;
    console.log(`\nEXTRAPOLATED to the full ${todo.length}-player rebuild:`);
    console.log(`  requests : ~${Math.round((reqs.total / perPlayer.length) * todo.length).toLocaleString()}`);
    console.log(`  runtime  : ~${(projected / 60).toFixed(1)} min (serial, no pacing)`);
  }
  console.log('=========================================');
}

main().catch(e => { console.error(e); process.exit(1); });
