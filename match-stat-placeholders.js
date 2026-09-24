'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// TEN-263 follow-up (founder ruling 2026-09-24): "Missing stored as 0 — fix it at
// the source." Winners / Unforced errors the feed did not track are stored as
// NULL, never 0. A real 0 the feed tracked stays 0.
//
// WHAT THE FEED ACTUALLY SENDS (measured 2026-09-24, api-tennis get_fixtures
// match_key=12156826, Winston-Salem 2026-08-26, 138 points played):
//
//   {"stat_type":"Points","stat_name":"Winners","stat_value":"0","stat_won":null,"stat_total":null}
//   {"stat_type":"Points","stat_name":"Unforced errors","stat_value":"0",...}
//   {"stat_type":"Points","stat_name":"Net points won","stat_value":"0%","stat_won":0,"stat_total":0}
//
// for BOTH players. The feed does not omit an untracked W/UE row — it sends a
// literal "0". So `parseInt(stat_value) || 0` was only half the defect: even a
// strict parse reads "0" as a real zero. A tracked match cannot end with zero
// winners AND zero unforced errors for BOTH players over dozens of points (every
// point ends in a winner, an unforced error or a forced error), so that exact
// shape is the feed's placeholder for "not tracked here", and it is read as
// "not sent".
//
// THE RULE (one place, used by every writer and every store guard):
//   Within ONE stat_period (match / set1 / set2 ...), if the Winners and Unforced
//   errors rows cover BOTH players and every one of them reads 0, the period's
//   W/UE is untracked: each of those rows gets stat_value = null.
//   Exception: when the period's Total Points Won denominator is known and below
//   PLACEHOLDER_MIN_POINTS, all-zero W/UE is physically possible (a retirement
//   after a handful of points), so the zeros are kept as sent.
//   A W/UE row whose stat_value is not an integer at all is also "not sent" (null).
//   One player at 0 beside real numbers for the other is a tracked sheet: kept.
//
// Net points won needs no rewrite here: its untracked placeholder is 0/0, and
// every writer already turns a zero denominator into null (extractStatPairFromRows
// `stat_total > 0 ? … : null`, raw only when total > 0).
//
// Consumed by: bsp-pipeline.js (every get_fixtures response, and the stored
// historical-match-stats cache on load), build-point-by-point.js (per-match fetch
// + the persistent point-by-point cache → setstats/ shards), and
// tools/match-stats-store.js (hydrate / freeze / sideDepths, so the store guards
// read a placeholder 0 as "not held", the same as the null that replaces it).
// ─────────────────────────────────────────────────────────────────────────────

const PLACEHOLDER_MIN_POINTS = 10;
const WUE_NAME = /^(winners|unforced errors)$/;
// Sheet keys as the pipeline writes them (MATCH_STAT_DEFS names).
const SHEET_WUE_KEYS = ['Points:Winners', 'Points:Unforced errors'];
const SHEET_TPW_KEY = 'Points:Total Points Won';

function isWueRow(s) {
  return !!s && s.stat_type === 'Points' && WUE_NAME.test(String(s.stat_name || '').trim().toLowerCase());
}

// Strict count parse: an integer string or number, else null. "0" -> 0,
// "" / null / "n/a" -> null. Never `|| 0`.
function parseCount(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v !== 'string' || !/^\s*-?\d+\s*$/.test(v)) return null;
  return parseInt(v, 10);
}

function tpwTotalOf(rows) {
  let best = null;
  for (const s of rows) {
    if (!s || s.stat_type !== 'Points' || !/^total points won$/i.test(String(s.stat_name || '').trim())) continue;
    const t = Number(s.stat_total);
    if (s.stat_total != null && Number.isFinite(t) && (best == null || t > best)) best = t;
  }
  return best;
}

// Rewrites a fixture's `statistics` rows IN PLACE so an untracked W/UE row
// carries stat_value null. Returns the number of rows nulled. Idempotent.
function sanitizeStatisticsRows(statistics) {
  if (!Array.isArray(statistics) || statistics.length === 0) return 0;
  let nulled = 0;
  const byPeriod = new Map();
  for (const s of statistics) {
    if (!s) continue;
    const p = String(s.stat_period || '');
    if (!byPeriod.has(p)) byPeriod.set(p, []);
    byPeriod.get(p).push(s);
  }
  for (const rows of byPeriod.values()) {
    const wue = rows.filter(isWueRow);
    if (!wue.length) continue;
    // A value that is not a count was never sent.
    for (const s of wue) {
      if (s.stat_value != null && parseCount(s.stat_value) == null) { s.stat_value = null; nulled++; }
    }
    const sent = wue.filter(s => parseCount(s.stat_value) != null);
    if (!sent.length) continue;
    const players = new Set(sent.map(s => String(s.player_key)));
    if (players.size < 2) continue;                       // one side only: cannot tell
    if (!sent.every(s => parseCount(s.stat_value) === 0)) continue;
    const tpw = tpwTotalOf(rows);
    if (tpw != null && tpw < PLACEHOLDER_MIN_POINTS) continue;   // a real all-zero is possible
    for (const s of sent) { s.stat_value = null; nulled++; }
  }
  return nulled;
}

function sanitizeFixture(f) {
  if (f && Array.isArray(f.statistics)) sanitizeStatisticsRows(f.statistics);
  return f;
}

function sanitizeFixtures(list) {
  if (Array.isArray(list)) for (const f of list) sanitizeFixture(f);
  return list;
}

// ── Derived sheets: { p1: {'Points:Winners': n, ...}, p2: {...} } ──────────────
// Stored sheets (historical-match-stats.json + its committed floor, the
// point-by-point cache behind setstats/) were written before this rule, with the
// placeholder 0s baked in. Same rule, applied to the stored shape.
function isPlaceholderWuePair(pair) {
  if (!pair || typeof pair !== 'object') return false;
  const sides = ['p1', 'p2'].map(k => pair[k]);
  if (!sides.every(s => s && typeof s === 'object')) return false;
  for (const s of sides) {
    for (const k of SHEET_WUE_KEYS) if (s[k] !== 0) return false;
  }
  for (const s of sides) {
    const raw = s.raw && s.raw[SHEET_TPW_KEY];
    const t = raw && Number(raw.total);
    if (raw && Number.isFinite(t) && t < PLACEHOLDER_MIN_POINTS) return false;
  }
  return true;
}

// Sets the placeholder W/UE to null IN PLACE. Returns 1 if the pair changed.
function nullPlaceholderWueInPair(pair) {
  if (!isPlaceholderWuePair(pair)) return 0;
  for (const side of ['p1', 'p2']) for (const k of SHEET_WUE_KEYS) pair[side][k] = null;
  return 1;
}

// historical-match-stats shape: { [eventKey]: { matchStats: pair|null, ... } }
function sanitizeMatchStatsStore(store) {
  let n = 0;
  if (!store || typeof store !== 'object') return n;
  for (const k of Object.keys(store)) {
    const e = store[k];
    if (e && e.matchStats) n += nullPlaceholderWueInPair(e.matchStats);
  }
  return n;
}

// point-by-point cache shape: { [eventKey]: { stats: { '1': pair, ... }|null, matchStats: pair|null } }
function sanitizePbpCache(cache) {
  let n = 0;
  if (!cache || typeof cache !== 'object') return n;
  for (const k of Object.keys(cache)) {
    const e = cache[k];
    if (!e) continue;
    if (e.matchStats) n += nullPlaceholderWueInPair(e.matchStats);
    if (e.stats && typeof e.stats === 'object') {
      for (const setNo of Object.keys(e.stats)) n += nullPlaceholderWueInPair(e.stats[setNo]);
    }
  }
  return n;
}

module.exports = {
  PLACEHOLDER_MIN_POINTS, SHEET_WUE_KEYS,
  isWueRow, parseCount, sanitizeStatisticsRows, sanitizeFixture, sanitizeFixtures,
  isPlaceholderWuePair, nullPlaceholderWueInPair, sanitizeMatchStatsStore, sanitizePbpCache,
};
