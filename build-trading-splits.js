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
// The 11 situational splits beyond Key Stats (set-outcome + game-sequence),
// computed from the SAME fixture's scores[]/pointbypoint (inline, zero extra
// API cost). Pure module so the generator and validation share one code path.
const { sequenceMetrics, SEQ_KEYS } = require('./trading-sequence-metrics.js');

const ROOT = process.env.TS_ROOT || __dirname;
const PROFILES_FILE = process.env.TS_PROFILES || path.join(ROOT, 'player-profiles.json');
const SURFACES_FILE = process.env.TS_SURFACES || path.join(ROOT, 'tournament-surfaces.json');
const OUT_DIR = process.env.TS_OUT || path.join(ROOT, 'trading-splits');
const INDEX_FILE = process.env.TS_INDEX || path.join(ROOT, 'trading-splits-index.json');
// Build-side divergence report (not shipped to the client — a build artifact the
// founder reviews). MATCHES ruling 2026-09-05: log any player whose broad match
// count diverges from the behind-the-splits count.
const DIVERGENCE_FILE = process.env.TS_DIVERGENCE || path.join(ROOT, 'trading-splits-divergence.json');
const PACE_MS = Number(process.env.TS_PACE_MS || 150);
// Test/cap knob only. Unset in CI => whole roster.
const MAX_PLAYERS = process.env.TS_MAX_PLAYERS ? Number(process.env.TS_MAX_PLAYERS) : Infinity;
// Optional explicit roster (comma-separated player_keys) for a targeted proof run.
const ONLY_KEYS = process.env.TS_ONLY_KEYS ? process.env.TS_ONLY_KEYS.split(',').map(s => s.trim()) : null;

// Rolling 24-month window. Override with TS_NOW=YYYY-MM-DD for reproducible runs.
const NOW = process.env.TS_NOW ? new Date(process.env.TS_NOW + 'T00:00:00Z') : new Date();
const cutoff = new Date(Date.UTC(NOW.getUTCFullYear() - 2, NOW.getUTCMonth(), NOW.getUTCDate()));
const CUTOFF_STR = cutoff.toISOString().slice(0, 10);
// Inner 12-month window (founder ruling 2026-09-06). Computed as its OWN window
// — a match lands in the 12mo buckets only if its date is >= CUTOFF12_STR, with
// its own numerator/denominator. NEVER derived from the 24mo figure (a 12mo
// number scaled/halved out of a 24mo one is fabricated). 24mo shard shape is
// unchanged; the 12mo view rides alongside as tiers12/window12.
const cutoff12 = new Date(Date.UTC(NOW.getUTCFullYear() - 1, NOW.getUTCMonth(), NOW.getUTCDate()));
const CUTOFF12_STR = cutoff12.toISOString().slice(0, 10);
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
// SELF metrics are read off THIS player's rows. OPH (opponent hold) is the SAME
// (Games / service games won) row read off the OPPONENT on the same fixture —
// opponent identified by first_player_key / second_player_key (verified live in
// bsp-pipeline.js). Founder A-ruling 2026-09-05 (Wu/Alcaraz proof: the opponent's
// service-games-held row IS the OPH figure). oph rides along as a sixth summed
// [num, den] bucket keyed off the opponent, never zero-filled.
const SELF_KEYS = Object.keys(METRICS);
const OPP_HOLD = { type: 'Games', name: 'service games won' };
// Stat metrics (from statistics[]) + the 11 situational metrics (from
// scores[]/pointbypoint). All stored identically as summed [num, den] buckets;
// the UI divides. A situation that never arises in a match contributes [0,0]
// (absent) — never zero-filled.
const METRIC_KEYS = [...SELF_KEYS, 'oph', ...SEQ_KEYS];
const SURFACES = ['hard', 'clay', 'grass'];
// Strict numerator/denominator shape for the stat_value fallback (B-ruling
// 2026-09-05). ONLY "int/int" is accepted; a percentage ("40%"), a bare int, an
// empty string or any other shape is a parse failure — the match is excluded
// from that metric AND from that metric's count. A null must never become a 0.
const STRICT_FRAC = /^\s*(\d+)\s*\/\s*(\d+)\s*$/;
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

// Lightweight identity map for the UI (name / rank / country) keyed by the same
// player_key as the shards. Built from the committed player-profiles.json — no
// extra API call. The live board carries no rank/country, so the Trading Report
// row joins here; a player absent from this map renders with the as-fed live
// name and dashed rank/country (never a guessed join). Only the fields the row
// needs are copied — the 44 MB profiles never reach the client.
function loadMeta() {
  const j = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
  const players = j.players || {};
  const list = Array.isArray(players) ? players : Object.values(players);
  const meta = {};
  for (const p of list) {
    if (!p || p.key == null) continue;
    meta[String(p.key)] = {
      name: p.name != null ? String(p.name) : null,
      rank: (typeof p.rank === 'number') ? p.rank : (p.rank != null && Number.isFinite(Number(p.rank)) ? Number(p.rank) : null),
      country: p.country != null ? String(p.country) : null,
    };
  }
  return meta;
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

// Resolve one stat row to a [won, total] pair. Numeric path first: when both
// stat_won and stat_total are present, use them. When either is null/absent the
// numeric coercion would silently mint a 0 (Number(null)===0) — the bug — so we
// DO NOT coerce; we fall back to a STRICT "int/int" parse of stat_value, and if
// that shape is absent the row is dropped (excluded from the metric and its
// count), never zero-filled. Returns { v } on success or { drop } with a reason.
function resolveRow(s) {
  const wRaw = s.stat_won, tRaw = s.stat_total;
  if (wRaw != null && tRaw != null) {
    const w = Number(wRaw), t = Number(tRaw);
    if (!Number.isFinite(w) || !Number.isFinite(t)) return { drop: 'nonfinite' };
    if (w < 0 || t < 0 || w > t) return { drop: 'impossible' };
    return { v: [w, t] };
  }
  // Fallback (B-ruling): won/total null -> strict X/Y parse of stat_value only.
  const m = STRICT_FRAC.exec(s.stat_value == null ? '' : String(s.stat_value));
  if (!m) return { drop: 'parsefail' };                   // e.g. "40%", "", a bare int
  const w = Number(m[1]), t = Number(m[2]);
  if (w < 0 || t < 0 || w > t) return { drop: 'impossible' };
  return { v: [w, t], recovered: true };
}

// Pull this player's five SELF metrics plus OPH (opponent hold) out of one
// fixture, applying the canonical match-row semantics. `tally` (optional)
// accumulates fallback outcomes for reporting. Returns null if the fixture
// yields no usable metric row (=> not a sample match).
function metricsForPlayer(fx, playerKey, tally) {
  const stats = Array.isArray(fx.statistics) ? fx.statistics : [];
  if (!stats.length) return null;
  const pk = String(playerKey);
  const oppKey = String(fx.first_player_key) === pk ? String(fx.second_player_key)
               : String(fx.second_player_key) === pk ? String(fx.first_player_key)
               : null;
  const out = {};
  for (const s of stats) {
    if (s.stat_period !== 'match') continue;              // match-level rows only
    const rowKey = String(s.player_key);
    const nm = String(s.stat_name || '').toLowerCase();
    const ty = String(s.stat_type || '');
    let slot = null;
    if (rowKey === pk) {
      const mk = SELF_KEYS.find(k => METRICS[k].name === nm && METRICS[k].type === ty);
      if (mk && !(mk in out)) slot = mk;                  // first block wins (fragment trails)
    } else if (oppKey && rowKey === oppKey) {
      if (ty === OPP_HOLD.type && nm === OPP_HOLD.name && !('oph' in out)) slot = 'oph';
    }
    if (!slot) continue;
    const r = resolveRow(s);
    if (r.v) {
      out[slot] = r.v;
      if (tally && r.recovered) tally.recovered++;
    } else if (tally && r.drop === 'parsefail') {
      tally.parsefail++;                                  // null won/total, no X/Y in stat_value
    }
    // 'impossible'/'nonfinite' rows are dropped as before (not counted, not summed).
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
  // Parallel 12mo buckets — same match rows, accumulated ONLY when the match
  // falls inside the inner window, each with its own num/den (not a slice of the
  // 24mo sums).
  const tiers12 = { tour: newTierBucket(), chal: newTierBucket() };
  const seenEvents = new Set();
  let sampleMatches = 0, usOpen = 0;
  // Divergence tripwire (founder ruling 2026-09-05, MATCHES). The MATCHES column
  // ships the behind-the-splits count (tiers[tier].all.m — matches carrying >=1
  // tracked stat), pinned so the displayed n equals the data behind the numbers.
  // windowByTier is the BROAD count: every in-window ATP-singles completed match
  // for the player in that tier, whether or not it carried a box score. When the
  // two diverge (a match exists but has no usable stat row), that is REPORTED
  // with both counts — never silently reconciled at read time.
  const windowByTier = { tour: 0, chal: 0 };
  const windowByTier12 = { tour: 0, chal: 0 };
  const tally = { parsefail: 0, recovered: 0, matchesWithParsefail: 0, matchesWithRecovery: 0 };

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
    // Inner-window membership: this 24mo match also belongs to the 12mo window
    // when its own date is at/after the 12mo cutoff. Its num/den go into tiers12
    // independently — no derivation from the 24mo sums.
    const in12 = d >= CUTOFF12_STR;
    // Broad count: this match is a valid in-window ATP-singles completed match
    // for the player, counted BEFORE the box-score test below.
    windowByTier[tier] += 1;
    if (in12) windowByTier12[tier] += 1;

    const before = { pf: tally.parsefail, rc: tally.recovered };
    const metricStats = metricsForPlayer(fx, key, tally);
    // Count a match as failing the strict parse even if it yields no usable row
    // at all (all its metric rows parsefailed) — that is still a match excluded.
    if (tally.parsefail > before.pf) tally.matchesWithParsefail++;
    if (metricStats && tally.recovered > before.rc) tally.matchesWithRecovery++;
    if (!metricStats) continue;                             // no box score for this player

    // Situational splits from the SAME fixture (scores[] + pointbypoint). Merged
    // into the sample match's bucket so the Trading Report keeps ONE match
    // population and ONE coverage count (bucket.m); each situational cell still
    // carries its own fraction. A match lacking pbp contributes no sequence
    // metrics — never a zero-filled rate.
    const seq = sequenceMetrics(fx, key);
    for (const k of SEQ_KEYS) if (seq[k]) metricStats[k] = seq[k];

    const surf = surfaceMap[String(fx.tournament_key)] || null;
    const surfKey = SURFACES.includes(surf) ? surf : null;
    const tb = tiers[tier];
    addMatch(tb.all, metricStats);
    if (surfKey) addMatch(tb[surfKey], metricStats);
    if (in12) {
      const tb12 = tiers12[tier];
      addMatch(tb12.all, metricStats);
      if (surfKey) addMatch(tb12[surfKey], metricStats);
    }
    sampleMatches++;
    if (/US Open/i.test(fx.tournament_name || '')) usOpen++;
  }

  return { key, tiers, tiers12, sampleMatches, usOpen, tally, windowByTier, windowByTier12 };
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
  const fb = { parsefailRows: 0, matchesWithParsefail: 0, recoveredRows: 0, matchesWithRecovery: 0 };
  const shardSizes = [];
  // MATCHES divergence log (founder ruling 2026-09-05): one record per (player,
  // tier) where the broad in-window match count != the behind-the-splits count.
  // Reported with BOTH counts and the player key — never silently reconciled.
  const divergences = [];

  for (const key of roster) {
    calls++;
    const r = await buildPlayer(key, surfaceMap);
    await new Promise(res => setTimeout(res, PACE_MS));
    if (r.tally) {
      fb.parsefailRows += r.tally.parsefail;
      fb.matchesWithParsefail += r.tally.matchesWithParsefail;
      fb.recoveredRows += r.tally.recovered;
      fb.matchesWithRecovery += r.tally.matchesWithRecovery;
    }
    if (r.error) { failed++; console.error(`trading-splits: fixture window failed for ${key}: ${r.error}`); continue; }
    if (r.empty) { empty++; continue; }

    // Divergence tripwire: for each ATP-singles tier, compare the broad in-window
    // match count against the behind-the-splits count (matches carrying >=1
    // tracked stat). A gap means the feed held matches with no usable box score;
    // report the player key and BOTH counts rather than picking one silently.
    for (const tier of ['tour', 'chal']) {
      const broad = (r.windowByTier && r.windowByTier[tier]) || 0;
      const withStats = r.tiers[tier].all.m;
      if (broad !== withStats) {
        divergences.push({ key, tier, broad, behindSplits: withStats, missing: broad - withStats });
      }
    }

    const tour = pruneTier(r.tiers.tour);
    const chal = pruneTier(r.tiers.chal);
    if (!tour && !chal) { empty++; continue; }

    // 12mo sub-tree (independent num/den; a tier with zero 12mo matches is simply
    // omitted, never zero-filled). 12mo ⊂ 24mo, so we only reach here when 24mo
    // has data; the inner window may still be empty for a given tier.
    const tour12 = pruneTier(r.tiers12.tour);
    const chal12 = pruneTier(r.tiers12.chal);

    const shard = {
      key,
      window: { from: CUTOFF_STR, to: NOW_STR, floor: PBP_FLOOR },
      window12: { from: CUTOFF12_STR, to: NOW_STR, floor: PBP_FLOOR },
      tiers: {},
      tiers12: {},
    };
    if (tour) shard.tiers.tour = tour;
    if (chal) shard.tiers.chal = chal;
    if (tour12) shard.tiers12.tour = tour12;
    if (chal12) shard.tiers12.chal = chal12;
    const str = JSON.stringify(shard);
    atomicWrite(path.join(OUT_DIR, key + '.json'), str);
    index.push(key);
    const gz = zlib.gzipSync(str).length;
    totalBytes += Buffer.byteLength(str); totalGz += gz;
    shardSizes.push(gz);
  }

  // Zero-shard guard (founder ruling 2026-09-05): we only reach here with
  // API_TENNIS_KEY present (the early abort above handles the absent-key case),
  // so an EMPTY produced roster is a real failure — a clean exit with empty
  // output that would otherwise green the pipeline and ship an empty board.
  // Simple empty-vs-not-empty, no threshold. Fail loudly; never publish an
  // empty index. (Isolated at the workflow layer so this never blocks the core
  // board's deploy.)
  if (!index.length) {
    console.error('trading-splits: API_TENNIS_KEY present but the produced roster is empty — failing (no zero-shard publish).');
    process.exit(1);
  }

  index.sort((a, b) => Number(a) - Number(b));
  const indexDoc = {
    generated: { window: { from: CUTOFF_STR, to: NOW_STR, floor: PBP_FLOOR }, window12: { from: CUTOFF12_STR, to: NOW_STR, floor: PBP_FLOOR }, source: 'api-tennis get_fixtures via fetchRecentSinglesFixtures', tiers: { tour: 'Atp Singles', chal: 'Challenger Men Singles' } },
    lowSample: { matchMin: LOW_SAMPLE_MATCH_MIN, slateMutePct: SLATE_MUTE_PCT, notice: LOW_SAMPLE_NOTICE },
    meta: loadMeta(),
    players: index,
  };
  atomicWrite(INDEX_FILE, JSON.stringify(indexDoc));

  // Persist the MATCHES divergence report (both counts + player key per record).
  divergences.sort((a, b) => (b.missing - a.missing) || (Number(a.key) - Number(b.key)));
  const divergenceDoc = {
    generated: { window: { from: CUTOFF_STR, to: NOW_STR, floor: PBP_FLOOR } },
    definition: 'broad = in-window ATP-singles completed matches for the player in the tier; behindSplits = matches carrying >=1 tracked stat (the shipped MATCHES column). A record exists only where the two differ.',
    playersWithDivergence: new Set(divergences.map(d => d.key)).size,
    records: divergences,
  };
  atomicWrite(DIVERGENCE_FILE, JSON.stringify(divergenceDoc, null, 2));

  shardSizes.sort((a, b) => a - b);
  const pct = p => shardSizes.length ? shardSizes[Math.min(shardSizes.length - 1, Math.floor(p * shardSizes.length))] : 0;
  const indexGz = zlib.gzipSync(JSON.stringify(indexDoc)).length;

  console.log(JSON.stringify({
    window: { from: CUTOFF_STR, to: NOW_STR, floor: PBP_FLOOR },
    roster: roster.length,
    apiCalls: calls, failed, emptyOrNoSample: empty,
    // B-ruling instrumentation: strict stat_value fallback outcomes over the build.
    // parsefail = a null won/total row whose stat_value was NOT strict "int/int"
    // (excluded from metric + its count, never zero-filled). If parsefailRows /
    // matchesWithParsefail is anything but near-zero, STOP and report.
    fallback: fb,
    // MATCHES divergence summary: players/records where broad != behindSplits.
    divergence: { players: new Set(divergences.map(d => d.key)).size, records: divergences.length, file: path.basename(DIVERGENCE_FILE) },
    players: index.length,
    corpus: { rawBytes: totalBytes, gzBytes: totalGz, gzKB: +(totalGz / 1024).toFixed(1) },
    index: { rawBytes: Buffer.byteLength(JSON.stringify(indexDoc)), gzBytes: indexGz, gzKB: +(indexGz / 1024).toFixed(2) },
    perShardGz: { min: pct(0), p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: shardSizes[shardSizes.length - 1] || 0 },
  }, null, 2));
}

main().catch(e => { console.error('trading-splits: unexpected error —', e.message); process.exit(1); });
