#!/usr/bin/env node
/**
 * build-trading-splits.js — TEN-151 Trading Report data layer
 *
 * Emits ONE shard per player: trading-splits/{player_key}.json + a gating
 * index trading-splits-index.json. Lazy-loaded like pbp/ form/ odds/ — nothing
 * on the page-load path reads these until the Trading Report board Loads.
 *
 * Per player, per TIER (tour=265 / chal=281), per SURFACE (all/hard/clay/grass):
 *   matches count, and SPW RPW BPS BPW SH each stored as [numerator, denominator]
 *   summed over a rolling 24-month window. The UI does the division + rounding.
 *   Missing metric in a match => that match contributes nothing to that metric's
 *   fraction; it is NEVER zero-filled. Missing surface => counted in "all" only.
 *
 * SOURCE (all five metrics, incl. SH, exact won/total, keyed by canonical
 * api-tennis player_key, per-fixture event_date): apitennis-wue-cache/{265,281}-*.json
 * statistics[] rows (stat_period === "match"). Floor 2024-03-06 (no box scores before).
 *
 * ATP only (265 tour + 281 challenger, both ATP men's singles). No WTA.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = process.env.TS_ROOT || __dirname;
const CACHE_DIR = process.env.TS_CACHE || path.join(ROOT, 'apitennis-wue-cache');
const SURFACES_FILE = process.env.TS_SURFACES || path.join(ROOT, 'tournament-surfaces.json');
const OUT_DIR = process.env.TS_OUT || path.join(ROOT, 'trading-splits');
const INDEX_FILE = process.env.TS_INDEX || path.join(ROOT, 'trading-splits-index.json');

// Rolling 24-month window. Override with TS_NOW=YYYY-MM-DD for reproducible runs.
const NOW = process.env.TS_NOW ? new Date(process.env.TS_NOW + 'T00:00:00Z') : new Date();
const cutoff = new Date(Date.UTC(NOW.getUTCFullYear() - 2, NOW.getUTCMonth(), NOW.getUTCDate()));
const CUTOFF_STR = cutoff.toISOString().slice(0, 10);
const PBP_FLOOR = '2024-03-06'; // api-tennis box scores do not exist before this

// The five exact metrics -> the verbatim api-tennis stat_name (matched case-insensitively).
const METRICS = {
  spw: 'service points won',
  rpw: 'return points won',
  bps: 'break points saved',
  bpw: 'break points converted',
  sh:  'service games won',
};
const METRIC_KEYS = Object.keys(METRICS);
const SURFACES = ['hard', 'clay', 'grass'];

function atomicWrite(file, str) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, str);
  fs.renameSync(tmp, file);
}

function loadSurfaceMap() {
  const j = JSON.parse(fs.readFileSync(SURFACES_FILE, 'utf8'));
  return j.surfaces || {};
}

function newSurfBucket() {
  // matches count + [num, den] per metric
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

function main() {
  const surfaceMap = loadSurfaceMap();
  const files = fs.readdirSync(CACHE_DIR).filter(f => /^(265|281)-\d{4}-\d{2}-\d{2}\.json$/.test(f));

  const players = new Map();     // player_key(string) -> { tour:tierBucket, chal:tierBucket }
  const seenEvents = new Set();  // dedupe across overlapping weekly windows
  let fixturesInWindow = 0, fixturesWithStats = 0;

  for (const file of files) {
    const tier = file.startsWith('265-') ? 'tour' : 'chal';
    let list;
    try { list = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), 'utf8')); }
    catch { continue; }
    if (!Array.isArray(list)) list = list.result || [];

    for (const fx of list) {
      const d = fx.event_date;
      if (!d || d < CUTOFF_STR || d < PBP_FLOOR) continue;      // rolling 24mo, floored
      const ek = String(fx.event_key || '');
      if (ek && seenEvents.has(ek)) continue;
      if (ek) seenEvents.add(ek);
      fixturesInWindow++;

      const stats = Array.isArray(fx.statistics) ? fx.statistics : [];
      if (!stats.length) continue;                              // no box score -> not a sample match
      fixturesWithStats++;

      const surf = surfaceMap[String(fx.tournament_key)] || null; // "hard"|"clay"|"grass"|null
      const surfKey = SURFACES.includes(surf) ? surf : null;

      // collect this fixture's match-period stats per player_key
      const byPlayer = new Map(); // pk -> { spw:[w,t], ... }
      for (const s of stats) {
        if ((s.stat_period || '').toLowerCase() !== 'match') continue;
        const nm = (s.stat_name || '').toLowerCase();
        const mk = METRIC_KEYS.find(k => METRICS[k] === nm);
        if (!mk) continue;
        const w = Number(s.stat_won), t = Number(s.stat_total);
        if (!Number.isFinite(w) || !Number.isFinite(t)) continue;
        const pk = String(s.player_key);
        if (!byPlayer.has(pk)) byPlayer.set(pk, {});
        byPlayer.get(pk)[mk] = [w, t];
      }

      for (const [pk, metricStats] of byPlayer) {
        if (!players.has(pk)) players.set(pk, { tour: newTierBucket(), chal: newTierBucket() });
        const tb = players.get(pk)[tier];
        addMatch(tb.all, metricStats);
        if (surfKey) addMatch(tb[surfKey], metricStats);
      }
    }
  }

  // Emit shards (drop tiers/surfaces with zero matches to stay compact) + index.
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const index = [];
  let totalBytes = 0, totalGz = 0;
  const shardSizes = [];

  function pruneTier(tb) {
    if (tb.all.m === 0) return null;
    const out = { all: tb.all };
    for (const s of SURFACES) if (tb[s].m > 0) out[s] = tb[s];
    return out;
  }

  for (const [pk, tiers] of players) {
    const tour = pruneTier(tiers.tour);
    const chal = pruneTier(tiers.chal);
    if (!tour && !chal) continue;
    const shard = { key: pk, window: { from: CUTOFF_STR, to: NOW.toISOString().slice(0, 10), floor: PBP_FLOOR }, tiers: {} };
    if (tour) shard.tiers.tour = tour;
    if (chal) shard.tiers.chal = chal;
    const str = JSON.stringify(shard);
    atomicWrite(path.join(OUT_DIR, pk + '.json'), str);
    index.push(pk);
    const gz = zlib.gzipSync(str).length;
    totalBytes += Buffer.byteLength(str); totalGz += gz;
    shardSizes.push(gz);
  }

  index.sort();
  atomicWrite(INDEX_FILE, JSON.stringify(index));

  shardSizes.sort((a, b) => a - b);
  const pct = p => shardSizes.length ? shardSizes[Math.min(shardSizes.length - 1, Math.floor(p * shardSizes.length))] : 0;
  const indexGz = zlib.gzipSync(JSON.stringify(index)).length;

  console.log(JSON.stringify({
    window: { from: CUTOFF_STR, to: NOW.toISOString().slice(0, 10), floor: PBP_FLOOR },
    files: files.length,
    fixturesInWindow, fixturesWithStats,
    players: index.length,
    corpus: { rawBytes: totalBytes, gzBytes: totalGz, gzKB: +(totalGz / 1024).toFixed(1) },
    index: { rawBytes: Buffer.byteLength(JSON.stringify(index)), gzBytes: indexGz, gzKB: +(indexGz / 1024).toFixed(2) },
    perShardGz: { min: pct(0), p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: shardSizes[shardSizes.length - 1] || 0 },
  }, null, 2));
}

main();
