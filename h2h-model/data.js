'use strict';

/**
 * data.js — Cached JSON loaders + the cross-file player resolver.
 *
 * The pipeline stores the same player under different keys in different files:
 *   - matches.json / career-splits.json / player-profiles.json : numeric
 *     api-tennis id (e.g. "1083")
 *   - elo-ratings.json / style-radar.json : "lastname|initial" (e.g. "kopriva|v")
 *   - clutch-rating.json / playing-styles.json : abbreviated name ("V. Kopriva")
 *
 * resolvePlayer() takes the numeric key + abbreviated name from a match record
 * and joins every source into one bundle. Missing sources return null (never
 * fabricated) so downstream adjustments can gracefully no-op.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ---- cached loader --------------------------------------------------------
const _cache = {};
function load(file) {
  if (!(file in _cache)) {
    const full = path.join(ROOT, file);
    _cache[file] = JSON.parse(fs.readFileSync(full, 'utf8'));
  }
  return _cache[file];
}

// ---- key derivation -------------------------------------------------------
function stripAccents(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Derive the "lastname|initial" ELO/radar key from a full name.
 * "Vit Kopriva" -> "kopriva|v"
 */
function eloKeyFromFullName(fullName) {
  if (!fullName) return null;
  let s = stripAccents(fullName).toLowerCase()
    .replace(/'/g, '').replace(/\./g, ' ').replace(/-/g, ' ');
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  const firstInitial = parts[0][0];
  return `${last}|${firstInitial}`;
}

/**
 * Derive the abbreviated "I. Lastname" name from a full name (clutch / styles).
 * "Vit Kopriva" -> "V. Kopriva"
 */
function abbrFromFullName(fullName) {
  if (!fullName) return null;
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const initial = parts[0][0];
  const rest = parts.slice(1).join(' ');
  return `${initial}. ${rest}`;
}

// ---- normalised accessors for the "wrapped" files -------------------------
function playersOf(fileObj) {
  if (Array.isArray(fileObj)) return fileObj;
  return fileObj.players || fileObj.styles || fileObj;
}

// ---- resolver -------------------------------------------------------------
/**
 * @param {string|number} numericKey  api-tennis id (matches p1Key/p2Key)
 * @param {string} abbrName           abbreviated name from the match record (m.p1 / m.p2)
 * @returns {object} unified player bundle
 */
function resolvePlayer(numericKey, abbrName) {
  const idStr = numericKey != null ? String(numericKey) : null;

  const eloAll = load('elo-ratings.json').elo || {};
  const splitsAll = load('career-splits.json').players || {};
  const clutchArr = playersOf(load('clutch-rating.json'));
  const radarAll = load('style-radar.json').players || {};
  const stylesArr = playersOf(load('playing-styles.json'));
  const profilesAll = playersOf(load('player-profiles.json'));

  const splits = (idStr && splitsAll[idStr]) || null;
  const profile = (idStr && profilesAll[idStr]) || null;

  // best available full name (career-splits is cleanest, then profile)
  const fullName = (splits && splits.fullName) || (profile && profile.name) || null;

  const eloKey = eloKeyFromFullName(fullName);
  const abbr = abbrName || abbrFromFullName(fullName);

  const elo = (eloKey && eloAll[eloKey]) || null;

  // Radar is only trustworthy when the source flags ok===true (enough charted
  // matches). style-radar rows for thinly-charted players carry ok:false and
  // near-random percentiles — we must NOT treat those as signal. We surface a
  // usable `radar` only when ok, plus the raw row for transparency.
  const radarRow = (eloKey && radarAll[eloKey]) || null;
  const radarOk = Boolean(radarRow && radarRow.ok === true && radarRow.radar);
  const radar = radarOk ? radarRow.radar : null;

  const clutch = abbr
    ? (clutchArr.find(c => c && c.name === abbr) || null)
    : null;
  const style = abbr
    ? (stylesArr.find(s => s && s.name === abbr) || null)
    : null;

  return {
    numericKey: idStr,
    fullName,
    abbrName: abbr,
    eloKey,
    // raw joined sources (null when a source has no row for this player)
    elo,        // { all:{rating,rank}, hard, clay, grass }
    splits,     // { career:{...cats}, last52:{...cats}, ... }
    profile,    // { kpis, dna, surfaces, recentForm, ... }
    clutch,     // { clutchIndex, bpSavedPct, ... }
    radar,      // { serve, return, ... } ONLY when reliable (ok===true), else null
    radarOk,    // whether the radar row passed the source reliability flag
    radarN: radarRow && radarRow.n != null ? radarRow.n : null,
    style,      // { primary, archetype_label, archetype_scores }
  };
}

// surface name -> elo sub-key
function eloSurfaceKey(surface) {
  const s = String(surface || '').toLowerCase();
  if (s.includes('clay')) return 'clay';
  if (s.includes('grass')) return 'grass';
  if (s.includes('hard')) return 'hard';
  return null; // carpet / unknown -> fall back to overall
}

// surface name -> Title case category used in splits/profiles ("Clay")
function surfaceCategory(surface) {
  const s = String(surface || '').toLowerCase();
  if (s.includes('clay')) return 'Clay';
  if (s.includes('grass')) return 'Grass';
  if (s.includes('hard')) return 'Hard';
  return null;
}

// Rank-at-time sidecar (Step 2a). Built by build-rank-at-time.js from tml-cache;
// a standalone file, never inlined and never served to the browser. Missing file
// => rankOf() transparently falls back to current rank (pre-2a behaviour).
// Max age (days) an observation may predate the match and still count as
// "match-day": ranks are published weekly, so anything inside ~13 months covers
// a player who missed a stretch without letting a years-stale rank leak through.
const RANK_AT_TIME_MAX_AGE_DAYS = 400;
let _rankAtTime; // { key: [[yyyymmdd, rank], ...] } | null
function rankAtTimeIndex() {
  if (_rankAtTime === undefined) {
    try {
      _rankAtTime = load('rank-at-time.json').players || null;
    } catch (e) {
      _rankAtTime = null; // sidecar absent -> current-rank fallback only
    }
  }
  return _rankAtTime;
}
// Convert a Date / ms / 'YYYY-MM-DD' / YYYYMMDD into a comparable YYYYMMDD int.
function toYmd(date) {
  if (date == null) return null;
  if (typeof date === 'number' && date >= 19000000 && date <= 99991231) return date; // already YYYYMMDD
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}
function ymdToDayNum(ymd) {
  const s = String(ymd);
  return Math.floor(Date.UTC(+s.slice(0, 4), (+s.slice(4, 6) || 1) - 1, +s.slice(6, 8) || 1) / 86400000);
}
/**
 * The match-day rank of `abbrName` as of `matchDate`, from the rank-at-time
 * sidecar. Returns the most recent observation on-or-before the match date that
 * is within RANK_AT_TIME_MAX_AGE_DAYS, or null when the sidecar has no usable
 * observation for that player/date (caller then falls back to current rank).
 */
function rankAtTime(abbrName, matchDate) {
  const idx = rankAtTimeIndex();
  if (!idx) return null;
  const targetYmd = toYmd(matchDate);
  if (targetYmd == null) return null;
  const eloKey = eloKeyFromFullName(abbrName);
  if (!eloKey) return null;
  const obs = idx[eloKey];
  if (!obs || !obs.length) return null;
  // binary search: greatest obs date <= targetYmd
  let lo = 0, hi = obs.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (obs[mid][0] <= targetYmd) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  if (best < 0) return null; // player's first observation postdates the match
  const [obsYmd, rank] = obs[best];
  if (ymdToDayNum(targetYmd) - ymdToDayNum(obsYmd) > RANK_AT_TIME_MAX_AGE_DAYS) return null;
  return rank;
}

/**
 * Resolve an opponent's rank used by the quality-adjusted-form adjustment.
 *   0. PREFERRED (when `matchDate` given): the opponent's MATCH-DAY rank from
 *      the rank-at-time sidecar. A player ranked #8 today may have been #180
 *      when the recent-form match was played — current rank mislabels the win.
 *   1. numeric api-tennis key -> player-profiles.json current rank (only
 *      ~current-slate players are cached there).
 *   2. FALLBACK: opponent name -> "lastname|initial" -> elo-ratings.json
 *      `.all.rank`. elo-ratings covers far more players, resolving the tail.
 * Returns null only when no source knows the player (never fabricated).
 * `matchDate` is optional & backward-compatible: omit it and the pre-2a
 * current-rank behaviour is unchanged.
 */
function rankOf(numericKey, abbrName, matchDate) {
  // tier 0: rank-at-time sidecar (only when a date is supplied)
  if (matchDate != null) {
    const rat = rankAtTime(abbrName, matchDate);
    if (rat != null) return rat;
  }
  // tier 1: numeric key -> profile rank
  if (numericKey != null) {
    const profiles = playersOf(load('player-profiles.json'));
    const p = profiles[String(numericKey)];
    const r = p && p.rank;
    if (typeof r === 'number' && isFinite(r)) return r;
  }
  // tier 2: name -> elo key -> elo overall rank
  const eloKey = eloKeyFromFullName(abbrName);
  if (eloKey) {
    const eloAll = load('elo-ratings.json').elo || {};
    const row = eloAll[eloKey];
    const er = row && row.all && row.all.rank;
    if (typeof er === 'number' && isFinite(er)) return er;
  }
  return null;
}

/**
 * Load Michael's manual inputs (optional). Currently used for W/UE ratios that
 * the api-tennis feed does not yet surface reliably. Missing file => {}.
 * Schema (h2h-model/manual-inputs.json):
 *   { "wue": { "<numericKey>": { "winners": <n>, "unforced": <n>, "surface": "clay", "note": "..." } } }
 */
function loadManualInputs() {
  try {
    return load('h2h-model/manual-inputs.json');
  } catch (e) {
    return {};
  }
}

module.exports = {
  load,
  resolvePlayer,
  eloKeyFromFullName,
  abbrFromFullName,
  eloSurfaceKey,
  surfaceCategory,
  rankOf,
  loadManualInputs,
  loadMatchupMatrix: () => load('matchup-matrix.json'),
  // Tier-1 serve source: per-round serve numbers for the CURRENTLY active
  // tournament(s), already produced for the Progression tab / Tournament
  // Reports — reused here rather than adding a new fetch.
  loadProgression: () => { try { return load('tournament-progression.json'); } catch (e) { return { tournaments: {} }; } },
  // Tier-2 serve source: real per-match box scores keyed by api-tennis
  // eventKey (the same cache the Form tab uses); joined via recentForm eventKeys.
  loadHistoricalStats: () => { try { return load('historical-match-stats.json'); } catch (e) { return {}; } },
};
