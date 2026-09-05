#!/usr/bin/env node
/**
 * build-trading-splits.js — TEN-151 Trading Report data layer (Route B, FUSED)
 *
 * Emits ONE shard per player: trading-splits/{player_key}.json + a gating
 * index trading-splits-index.json. Lazy-loaded like pbp/ form/ odds/ —
 * nothing on the page-load path reads these until the Trading Report board
 * loads.
 *
 * SOURCE (Route B, founder ruling 2026-09-05): the api-tennis fixtures the
 * pipeline ALREADY fetches via fetchRecentSinglesFixtures (bsp-pipeline.js) —
 * one 5-year get_fixtures window per player, `statistics[]` inline, the same
 * bytes recent-form already pays for. Nothing on local disk is an input; every
 * number is reproducible from code + API. apitennis-wue-cache and
 * backfill-wue-history.js are NOT read here — one source, not two.
 *
 * ROSTER: the tracked ATP players in player-profiles.json (`players`, keyed by
 * canonical api-tennis player_key). Committed, so the run is reproducible.
 *
 * Per player, per TIER (tour = "Atp Singles" / chal = "Challenger Men Singles"),
 * per SURFACE (all/hard/clay/grass): matches count, and SPW RPW BPS BPW SH each
 * stored as [numerator, denominator] summed over a rolling 24-month window. The
 * UI does the division + rounding. A metric missing from a match contributes
 * NOTHING to that metric's fraction — it is never zero-filled. A match on an
 * unmapped surface is counted in "all" only.
 *
 * MATCH-ROW SEMANTICS mirror bsp-pipeline.js aggregateStatsFromFixtures (the
 * canonical reader), so the Trading Report cannot diverge from the rest of the
 * app on the same fixtures:
 *   - completed matches only: event_status in Finished / Retired / Walk Over;
 *   - stat_period === 'match' (the feed re-emits every stat under set1/set2/…);
 *   - this player's rows only (player_key match);
 *   - first (stat_type|stat_name) block wins — the feed trails a fragment block
 *     after the real one (verified live on Burruchaga);
 *   - impossible rows are DROPPED, not summed: won<0, total<0, or won>total
 *     (verified live: Rehberg "Break Points Saved 2/0", Geneva 2026-05-17).
 *
 * ATP only. No WTA. No ITF, exhibitions or doubles.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
try { require('dotenv').config({ quiet: true }); } catch (_) { /* dotenv optional */ }
const { fetchRecentSinglesFixtures } = require('./bsp-pipeline.js');

const ROOT = process.env.TS_ROOT || __dirname;
const PROFILES_FILE = process.env.TS_PROFILES || path.join(ROOT, 'player-profiles.json');
const SURFACES_FILE = process.env.TS_SURFACES || path.join(ROOT, 'tournament-surfaces.json');
const OUT_DIR = process.env.TS_OUT || path.join(ROOT, 'trading-splits');
const INDEX_FILE = process.env.TS_INDEX || path.join(ROOT, 'trading-splits-index.json');
const PACE_MS = Number(process.env.TS_PACE_MS || 150);
// Test/cap knob only. Unset in CI => whole roster.
const MAX_PLAYERS = process.env.TS_MAX_PLAYERS ? Number(process.env.TS_MAX_PLAYERS) : Infinity;
// Optional explicit roster (comma-separated player_keys) for a targeted proof run.
const ONLY_KEYS = process.env.TS_ONLY_KEYS ? process.env.TS_ONLY_KEYS.split(',').map(s => s.trim()) : null;

// Rolling 24-month window. Override with TS_NOW=YYYY-MM-DD for reproducible runs.
const NOW = process.env.TS_NOW ? new Date(process.env.TS_NOW + 'T00:00:00Z') : new Date();
const cutoff = new Date(Date.UTC(NOW.getUTCFullYear() - 2, NOW.getUTCMonth(), NOW.getUTCDate()));
const CUTOFF_STR = cutoff.toISOString().slice(0, 10);
const NOW_STR = NOW.toISOString().slice(0, 10);
// api-tennis carries no box scores before this; a pre-floor match has no
// `statistics` and is excluded anyway. Belt-and-suspenders (24mo cutoff already
// sits after it today).
const PBP_FLOOR = '2024-03-06';

// Founder ruling 2026-09-05 (grass threshold). Low-sample surface columns stay
// VISIBLE and muted with their fractions; the slate shows the notice when more
// than SLATE_MUTE_PCT of its players fall under LOW_SAMPLE_MATCH_MIN for the
// selected surface. Published in the index so the UI reads one source of truth.
const LOW_SAMPLE_MATCH_MIN = 10;
const SLATE_MUTE_PCT = 40;
const LOW_SAMPLE_NOTICE = 'Low sample across this slate — the {surface} filter leaves most players under 10 matches. Percentages stay visible and muted, with their fractions.';

// The five exact metrics -> the verbatim api-tennis (stat_type, stat_name),
// matched case-insensitively on the name (the feed changed its casing at the
// 2025/2026 boundary and a 24-month window spans both). Quoted from live
// get_fixtures this session (player 2382): Service Points Won and Return Points
// Won are stat_type "Points"; Break Points Saved is "Service"; Break Points
// Converted is "Return"; Service Games Won is "Games" (won=games held /
// total=service games — this is why service HOLD is EXACT from api-tennis).
const METRICS = {
  spw: { type: 'Points',  name: 'service points won' },
  rpw: { type: 'Points',  name: 'return points won' },
  bps: { type: 'Service', name: 'break points saved' },
  bpw: { type: 'Return',  name: 'break points converted' },
  sh:  { type: 'Games',   name: 'service games won' },
};
const METRIC_KEYS = Object.keys(METRICS);
const SURFACES = ['hard', 'clay', 'grass'];
const FINAL_STATUSES = ['Finished', 'Retired', 'Walk Over'];

// Tier is derived from event_type_type (get_fixtures carries no event_type_key).
// "Atp Singles" == the old 265 harvest; "Challenger Men Singles" == 281. ITF,
// exhibitions and doubles are excluded (ATP-only scope).
function tierOf(f) {
  const t = String(f.event_type_type || '');
  if (t === 'Atp Singles') return 'tour';
  if (t === 'Challenger Men Singles') return 'chal';
  return null;
}

function atomicWrite(file, str) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, str);
  fs.renameSync(tmp, file);
}

function loadSurfaceMap() {
  const j = JSON.parse(fs.readFileSync(SURFACES_FILE, 'utf8'));
  return j.surfaces || {};
}

function loadRoster() {
  const j = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
  const players = j.players || {};
  const list = Array.isArray(players) ? players : Object.values(players);
  const keys = list.map(p => p && (p.key != null ? String(p.key) : null)).filter(Boolean);
  // de-dupe, stable order
  return [...new Set(keys)].sort((a, b) => Number(a) - Number(b));
}

function newSurfBucket() {
  const b = { m: 0 };
  for (const k of METRIC_KEYS) b[k] = [0, 0];
  return b;
}
function newTierBucket() {
  const t = { all: newSurfBucket() };
  for (const s of SURFACES) t[s] = newSurfBucket();
  return t;
}
function addMatch(bucket, statByMetric) {
  bucket.m += 1;
  for (const k of METRIC_KEYS) {
    const v = statByMetric[k];
    if (v) { bucket[k][0] += v[0]; bucket[k][1] += v[1]; }
  }
}

// Pull this player's five metrics out of one fixture, applying the canonical
// match-row semantics. Returns null if the fixture yields no usable metric row
// for the player (=> not a sample match).
function metricsForPlayer(fx, playerKey) {
  const stats = Array.isArray(fx.statistics) ? fx.statistics : [];
  if (!stats.length) return null;
  const out = {};
  for (const s of stats) {
    if (s.stat_period !== 'match') continue;              // match-level rows only
    if (String(s.player_key) !== String(playerKey)) continue;
    const nm = String(s.stat_name || '').toLowerCase();
    const ty = String(s.stat_type || '');
    const mk = METRIC_KEYS.find(k => METRICS[k].name === nm && METRICS[k].type === ty);
    if (!mk) continue;
    if (mk in out) continue;                              // first block wins (fragment trails)
    const w = Number(s.stat_won), t = Number(s.stat_total);
    if (!Number.isFinite(w) || !Number.isFinite(t)) continue;
    if (w < 0 || t < 0 || w > t) continue;                // drop impossible rows
    out[mk] = [w, t];
  }
  return Object.keys(out).length ? out : null;
}

async function buildPlayer(key, surfaceMap) {
  let fixtures;
  try {
    fixtures = await fetchRecentSinglesFixtures(key);       // ~5yr window, stats inline
  } catch (e) {
    return { key, error: e.message };
  }
  if (!Array.isArray(fixtures) || !fixtures.length) return { key, empty: true };

  const tiers = { tour: newTierBucket(), chal: newTierBucket() };
  const seenEvents = new Set();
  let sampleMatches = 0, usOpen = 0;

  for (const fx of fixtures) {
    const tier = tierOf(fx);
    if (!tier) continue;                                    // ATP singles tiers only
    if (!FINAL_STATUSES.includes(fx.event_status)) continue;
    const d = String(fx.event_date || '');
    // rolling 24mo, floored, and upper-bounded at NOW so a past-dated TS_NOW
    // backtest stays reproducible (fetchRecentSinglesFixtures always stops at
    // real-today, so without this a back-run would leak future fixtures).
    if (!d || d < CUTOFF_STR || d < PBP_FLOOR || d > NOW_STR) continue;
    const ek = String(fx.event_key || '');
    if (ek && seenEvents.has(ek)) continue;
    if (ek) seenEvents.add(ek);

    const metricStats = metricsForPlayer(fx, key);
    if (!metricStats) continue;                             // no box score for this player

    const surf = surfaceMap[String(fx.tournament_key)] || null;
    const surfKey = SURFACES.includes(surf) ? surf : null;
    const tb = tiers[tier];
    addMatch(tb.all, metricStats);
    if (surfKey) addMatch(tb[surfKey], metricStats);
    sampleMatches++;
    if (/US Open/i.test(fx.tournament_name || '')) usOpen++;
  }

  return { key, tiers, sampleMatches, usOpen };
}

function pruneTier(tb) {
  if (tb.all.m === 0) return null;
  const out = { all: tb.all };
  for (const s of SURFACES) if (tb[s].m > 0) out[s] = tb[s];
  return out;
}

async function main() {
  if (!process.env.API_TENNIS_KEY) {
    console.error('trading-splits: API_TENNIS_KEY not set — cannot fetch fixtures. Aborting (no partial write).');
    process.exit(0);
  }
  const surfaceMap = loadSurfaceMap();
  let roster = ONLY_KEYS || loadRoster();
  if (Number.isFinite(MAX_PLAYERS)) roster = roster.slice(0, MAX_PLAYERS);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const index = [];
  let totalBytes = 0, totalGz = 0, calls = 0, failed = 0, empty = 0;
  const shardSizes = [];

  for (const key of roster) {
    calls++;
    const r = await buildPlayer(key, surfaceMap);
    await new Promise(res => setTimeout(res, PACE_MS));
    if (r.error) { failed++; console.error(`trading-splits: fixture window failed for ${key}: ${r.error}`); continue; }
    if (r.empty) { empty++; continue; }

    const tour = pruneTier(r.tiers.tour);
    const chal = pruneTier(r.tiers.chal);
    if (!tour && !chal) { empty++; continue; }

    const shard = { key, window: { from: CUTOFF_STR, to: NOW_STR, floor: PBP_FLOOR }, tiers: {} };
    if (tour) shard.tiers.tour = tour;
    if (chal) shard.tiers.chal = chal;
    const str = JSON.stringify(shard);
    atomicWrite(path.join(OUT_DIR, key + '.json'), str);
    index.push(key);
    const gz = zlib.gzipSync(str).length;
    totalBytes += Buffer.byteLength(str); totalGz += gz;
    shardSizes.push(gz);
  }

  index.sort((a, b) => Number(a) - Number(b));
  const indexDoc = {
    generated: { window: { from: CUTOFF_STR, to: NOW_STR, floor: PBP_FLOOR }, source: 'api-tennis get_fixtures via fetchRecentSinglesFixtures', tiers: { tour: 'Atp Singles', chal: 'Challenger Men Singles' } },
    lowSample: { matchMin: LOW_SAMPLE_MATCH_MIN, slateMutePct: SLATE_MUTE_PCT, notice: LOW_SAMPLE_NOTICE },
    players: index,
  };
  atomicWrite(INDEX_FILE, JSON.stringify(indexDoc));

  shardSizes.sort((a, b) => a - b);
  const pct = p => shardSizes.length ? shardSizes[Math.min(shardSizes.length - 1, Math.floor(p * shardSizes.length))] : 0;
  const indexGz = zlib.gzipSync(JSON.stringify(indexDoc)).length;

  console.log(JSON.stringify({
    window: { from: CUTOFF_STR, to: NOW_STR, floor: PBP_FLOOR },
    roster: roster.length,
    apiCalls: calls, failed, emptyOrNoSample: empty,
    players: index.length,
    corpus: { rawBytes: totalBytes, gzBytes: totalGz, gzKB: +(totalGz / 1024).toFixed(1) },
    index: { rawBytes: Buffer.byteLength(JSON.stringify(indexDoc)), gzBytes: indexGz, gzKB: +(indexGz / 1024).toFixed(2) },
    perShardGz: { min: pct(0), p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: shardSizes[shardSizes.length - 1] || 0 },
  }, null, 2));
}

main().catch(e => { console.error('trading-splits: unexpected error —', e.message); process.exit(1); });
