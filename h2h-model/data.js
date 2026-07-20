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

/**
 * Resolve an opponent's CURRENT rank (proxy for match-day rank) used by the
 * quality-adjusted-form adjustment. Two-tier lookup:
 *   1. numeric api-tennis key -> player-profiles.json (only ~current-slate
 *      players are cached there, so this covers a minority of historical
 *      recent-form opponents).
 *   2. FALLBACK: opponent name -> "lastname|initial" -> elo-ratings.json
 *      `.all.rank`. elo-ratings covers far more players (~540 vs ~445), so this
 *      resolves the long tail of recent-form opponents the profiles miss.
 * Returns null only when neither source knows the player (never fabricated).
 */
function rankOf(numericKey, abbrName) {
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
