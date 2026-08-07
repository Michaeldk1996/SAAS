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

// Under-pressure supplement (TEN-8). clutch-rating.js derives from TML (tour-only),
// so players below its floors — young / Challenger-heavy names like Merida, Buse,
// Draxl — carry no clutch row, and the model's Clutch layer stays silent for them.
// clutch-apitennis-supplement.js fills those from api-tennis per-match break-point
// statistics (ATP-first, component-specific Challenger discount, ITF excluded),
// written to clutch-supplement.json. Loaded ADDITIVELY — it only supplies a row
// where clutch-rating.json has none, never overriding a tour-derived rating — so
// clutch-rating.js can rebuild/clobber its own pool without touching these. Rows
// share the clutch shape (name + clutchIndex + component %) plus provisional:true /
// confidence:'med'. Absent file => no-op (pre-supplement behaviour). Mirrors the
// rank-at-time sidecar loader below.
let _clutchSuppl;
function clutchSupplement() {
  if (_clutchSuppl === undefined) {
    try {
      _clutchSuppl = playersOf(load('clutch-supplement.json')) || null;
    } catch (e) {
      _clutchSuppl = null; // sidecar absent -> tour-only clutch, as before
    }
  }
  return _clutchSuppl;
}

// Per-surface under-pressure sidecar (TEN-8). clutch-surface.js splits the same
// four ATP components by Hard/Clay/Grass for the tour pool. Loaded ADDITIVELY:
// it only attaches a `bySurface` block onto a clutch row that already exists —
// the Clutch layer prefers the match-surface index when its floor clears and
// falls back to the career index otherwise, never overriding it. Sidecar absent
// => career-only clutch, exactly as before.
let _clutchSurface;
function clutchSurface() {
  if (_clutchSurface === undefined) {
    try {
      _clutchSurface = playersOf(load('clutch-surface.json')) || null;
    } catch (e) {
      _clutchSurface = null;
    }
  }
  return _clutchSurface;
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
  // Abbreviated "I. Lastname" key for the clutch / playing-styles join. The feed
  // does NOT always hand us an abbreviated name: hashed-id fixtures carry the FULL
  // name (e.g. "Daniel Merida Aguilar", not "D. Merida Aguilar"), and career-splits
  // fullName can carry a middle name. Both broke the exact-match join, so style +
  // clutch silently dropped to null on those fixtures ("no style matchup"). Build
  // every plausible abbreviated form and match on any of them (exact first, then
  // an accent/case/period-insensitive fallback). `abbr` (the primary key) is kept
  // as the raw feed name so the returned abbrName / display path is unchanged.
  const abbrCandidates = [];
  for (const cand of [abbrName, abbrFromFullName(abbrName), abbrFromFullName(fullName)]) {
    if (cand && !abbrCandidates.includes(cand)) abbrCandidates.push(cand);
  }
  const abbr = abbrName || abbrCandidates[0] || null;
  const normAbbr = (s) => stripAccents(String(s || '')).toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  const normCands = new Set(abbrCandidates.map(normAbbr).filter(Boolean));
  const matchByAbbr = (arr) => {
    if (!arr) return null;
    if (normCands.size) {
      for (const cand of abbrCandidates) { const hit = arr.find(x => x && x.name === cand); if (hit) return hit; }
      const nm = arr.find(x => x && normCands.has(normAbbr(x.name)));
      if (nm) return nm;
    }
    // Last resort: name-format-INDEPENDENT join on eloKey (last|firstInitial).
    // The abbreviated-candidate forms above cannot reach rows stored under a
    // FULL name ("Liam Draxl", the challenger supplement), a MIDDLE-INITIAL form
    // ("T. A. Tirante"), or when the fixture carries a MIDDLE name ("Thiago
    // Agustin Tirante") that poisons abbrFromFullName. eloKey collapses all of
    // these to last|firstInitial. Only fires when EXACTLY ONE row carries this
    // eloKey, so an ambiguous last|initial (e.g. two A. Zverev) never mis-joins.
    if (eloKey) {
      const hits = arr.filter(x => x && eloKeyFromFullName(x.name) === eloKey);
      if (hits.length === 1) return hits[0];
    }
    return null;
  };

  const elo = (eloKey && eloAll[eloKey]) || null;

  // Radar is only trustworthy when the source flags ok===true (enough charted
  // matches). style-radar rows for thinly-charted players carry ok:false and
  // near-random percentiles — we must NOT treat those as signal. We surface a
  // usable `radar` only when ok, plus the raw row for transparency.
  const radarRow = (eloKey && radarAll[eloKey]) || null;
  const radarOk = Boolean(radarRow && radarRow.ok === true && radarRow.radar);
  const radar = radarOk ? radarRow.radar : null;

  // Tour-derived pool first; only reach for the api-tennis supplement when it has
  // no row for this player. Match the supplement on numeric api-tennis key (it
  // carries playerKey — the strongest join), then fall back to the same name join.
  let clutch = matchByAbbr(clutchArr);
  if (!clutch) {
    const suppl = clutchSupplement();
    if (suppl) {
      clutch = (idStr && suppl.find(s => s && String(s.playerKey) === idStr))
        || matchByAbbr(suppl)
        || null;
    }
  }
  // Attach the per-surface index block additively — only onto an existing clutch
  // row, matched on the same abbreviated-name join. Career index stays authoritative;
  // the Clutch layer reads bySurface[surface] with a career fallback.
  if (clutch) {
    const surfArr = clutchSurface();
    const surfRow = surfArr ? matchByAbbr(surfArr) : null;
    if (surfRow && surfRow.bySurface) clutch = { ...clutch, bySurface: surfRow.bySurface };
  }
  const style = matchByAbbr(stylesArr);

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
  // Layer #8 (W/UE) archetype expectation table — per-archetype Winner/Unforced
  // ratios from the Match Charting Project (CC BY-NC-SA, R&D use only). Compared
  // against each player's aggregated profile.wue. Missing file => null (layer
  // self-hides). See CLAUDE.md licensing note.
  loadMcpBaseline: () => { try { return load('mcp-archetype-baseline.json'); } catch (e) { return null; } },
  loadMatchupMatrix: () => load('matchup-matrix.json'),
  // Tier-1 serve source: per-round serve numbers for the CURRENTLY active
  // tournament(s), already produced for the Progression tab / Tournament
  // Reports — reused here rather than adding a new fetch.
  loadProgression: () => { try { return load('tournament-progression.json'); } catch (e) { return { tournaments: {} }; } },
  // Tier-2 serve source: real per-match box scores keyed by api-tennis
  // eventKey (the same cache the Form tab uses); joined via recentForm eventKeys.
  loadHistoricalStats: () => { try { return load('historical-match-stats.json'); } catch (e) { return {}; } },
};
