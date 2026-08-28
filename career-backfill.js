// =================================================================
// CAREER HISTORY BACKFILL (archive editions API-Tennis is missing)
// -----------------------------------------------------------------
// API-Tennis's get_fixtures feed only returns fixtures back to ~2021, so a
// player's per-tournament career record (built in bsp-pipeline.js's
// fetchPlayerCareerHistory) is truncated — e.g. Djokovic's Wimbledon shows
// 2021+ only, missing his 2005-2020 runs and titles (and, it turns out, most of
// 2021 as well). This module backfills the
// missing archive editions from the open TML-Database (Tennismylife) ATP match
// archive, which uses the same schema Jeff Sackmann's tennis_atp pioneered and
// covers 1968-present. Canonical Sackmann repo (JeffSackmann/tennis_atp) is the
// origin of this format; TML is used here because it mirrors the same columns
// and is reliably reachable.
//
// It merges TML editions into each profile's existing
// tournamentHistory, letting existing API editions win on any overlapping year,
// then recomputes won/lost/titles/bestResult/bestYears/firstYear/lastYear from
// the combined edition set using the same rules as the API builder. Nothing is
// fabricated: only completed matches with a real winner and round are counted,
// and a player is only backfilled when reconciled to a TML identity with high
// confidence (last name + first initial, disambiguated so e.g. Alexander Zverev
// is never conflated with Mischa Zverev).
//
// Source: Tennismylife/TML-Database (CC BY-NC-SA, same schema as Sackmann).
// =================================================================
const fs = require('fs');
const path = require('path');
const { canonicalTournament } = require('./tournament-identity');

const TML_BASE = 'https://raw.githubusercontent.com/Tennismylife/TML-Database/master/';
const TML_CACHE_DIR = path.join(__dirname, 'tml-cache');
// TML fills any edition API-Tennis is MISSING. Because mergePlayer lets the API
// edition win on ANY year an event already has (per-event, per-year), raising
// this cap can only backfill genuine holes — it never double-counts or
// overwrites good API data. The old fixed 2020 cap assumed "API covers 2021+",
// but API-Tennis's get_fixtures feed actually omits almost all of 2021 (verified
// 2026-08-04: every top player's 2021 Masters editions were absent — e.g.
// Zverev's 2021 Madrid title, Tsitsipas's 2021 Monte Carlo title, ~4-5 wins per
// player per spring Masters), leaving a whole season unrecoverable. Cap at the
// current year so 2021+ holes get filled too. No current ATP player debuted
// before 2000, so that is a safe download floor.
const BACKFILL_FLOOR_YEAR = 2000;
const BACKFILL_UP_TO_YEAR = new Date().getFullYear();

// Round depth + labels — must match bsp-pipeline.js so merged editions rank and
// label identically to the API-built ones.
const ROUND_RANK = { F: 7, SF: 6, QF: 5, R16: 4, R32: 3, R64: 2, R128: 1, R256: 0 };
const ROUND_FULL = {
  F: 'Final', SF: 'Semi-final', QF: 'Quarter-final',
  R16: 'Round of 16', R32: 'Round of 32', R64: 'Round of 64',
  R128: 'Round of 128', R256: 'Round of 256',
};
const rank = (r) => (ROUND_RANK[r] != null ? ROUND_RANK[r] : -1);

// TML tournament names that differ from the API's canonical name for the same
// event, so editions merge into the existing history entry instead of forming a
// duplicate row. Keyed by lowercased TML name -> API display name.
const TOURNAMENT_ALIASES = {
  'roland garros': 'French Open',
};

function normalizeTournamentName(name) {
  return String(name || '').replace(/^(ATP|WTA|ITF|Challenger)\s+/i, '').trim();
}

function deaccent(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// "N. Djokovic" or "Novak Djokovic" -> "djokovic|n" (last name + first initial).
// This is the reconciliation key between API profile names (initial form) and
// TML names (full form). Returns null if a key can't be formed.
function nameKey(name) {
  const s = deaccent(name).toLowerCase().replace(/[.]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const parts = s.split(' ');
  if (parts.length < 2) return null;
  const initial = parts[0].charAt(0);
  const last = parts.slice(1).join(' ').trim();
  if (!initial || !last) return null;
  return `${last}|${initial}`;
}

// Full TML name -> API-style "F. Lastname" display, so backfilled opponents read
// the same as API-built ones ("Y. Wu").
function toInitialLast(full) {
  const s = String(full || '').trim();
  if (!s) return '';
  const parts = s.split(/\s+/);
  if (parts.length < 2) return s;
  return `${parts[0].charAt(0)}. ${parts.slice(1).join(' ')}`;
}

// TML score is the match winner's game score ("6-3 7-5 6-3", may end RET/W/O).
// Returns [winnerSets, loserSets] or null when nothing countable (walkover).
function setCounts(score) {
  if (!score) return null;
  let w = 0, l = 0;
  for (const tok of String(score).trim().split(/\s+/)) {
    const m = tok.match(/^(\d+)-(\d+)/);
    if (!m) continue;
    const a = +m[1], b = +m[2];
    if (a > b) w++; else if (b > a) l++;
  }
  return (w === 0 && l === 0) ? null : [w, l];
}

// Render as the API's edition score format: "opponentSets - playerSets".
function scoreDisplay(score, playerWon) {
  const sc = setCounts(score);
  if (!sc) return '';
  const [ws, ls] = sc;
  const playerSets = playerWon ? ws : ls;
  const oppSets = playerWon ? ls : ws;
  return `${oppSets} - ${playerSets}`;
}

async function ensureTmlCsv(year) {
  const file = path.join(TML_CACHE_DIR, `${year}.csv`);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  const res = await fetch(`${TML_BASE}${year}.csv`, { headers: { 'User-Agent': 'bsp-consult' } });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text || text.length < 50) return null;
  if (!fs.existsSync(TML_CACHE_DIR)) fs.mkdirSync(TML_CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

// TML CSVs have no quoted fields, so a plain split is safe. Maps each row to an
// object keyed by the header names.
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return [];
  const header = lines[0].split(',');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const row = {};
    for (let c = 0; c < header.length; c++) row[header[c]] = cells[c];
    rows.push(row);
  }
  return rows;
}

// Downloads the pre-2021 year files and indexes every match by TML player id.
//   byId:     Map(tmlId -> [ { tourney, year, round, oppName, score, won } ])
//   identity: Map(tmlId -> { key: nameKey, names: Map(name->count), iocs: Set })
function tmlSurface(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('clay')) return 'clay';
  if (s.includes('grass')) return 'grass';
  if (s.includes('hard')) return 'hard';
  return null; // carpet/unknown — excluded from the surface-scoped drill-down
}
function tmlDate(raw) {
  const d = String(raw || '').trim();
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null;
}
function flipSets(s) {
  return (typeof s === 'string' && s.includes('-')) ? s.split('-').map((x) => x.trim()).reverse().join(' - ') : s;
}
async function buildTmlIndex(log) {
  const byId = new Map();
  const identity = new Map();
  let filesLoaded = 0, rowCount = 0;

  for (let y = BACKFILL_FLOOR_YEAR; y <= BACKFILL_UP_TO_YEAR; y++) {
    let file;
    try { file = await ensureTmlCsv(y); } catch (e) { file = null; }
    if (!file) continue;
    filesLoaded++;
    const rows = parseCsv(fs.readFileSync(file, 'utf8'));
    for (const r of rows) {
      const tourney = normalizeTournamentName(r.tourney_name);
      const year = parseInt(String(r.tourney_date || '').slice(0, 4), 10);
      const round = String(r.round || '').trim().toUpperCase();
      if (!tourney || !year || !round) continue;
      if (year > BACKFILL_UP_TO_YEAR) continue;
      const wId = r.winner_id, lId = r.loser_id;
      if (!wId || !lId) continue;
      rowCount++;

      // surface/date/display-name carried for the Overview year-table drill-down.
      const meta = { surface: tmlSurface(r.surface), date: tmlDate(r.tourney_date), tournamentName: r.tourney_name };
      // TEN-89 Part 2: the raw TML score marks retirements ("... RET"); setCounts
      // drops the token, so capture it here for the over-3.5 exclusion downstream.
      const ret = /\bRET\b|Retired/i.test(String(r.score || ''));
      // Winner's row entry.
      pushMatch(byId, wId, { tourney, ...meta, year, round, oppName: toInitialLast(r.loser_name), score: scoreDisplay(r.score, true), won: true, ret });
      trackIdentity(identity, wId, r.winner_name, r.winner_ioc, year);
      // Loser's row entry.
      pushMatch(byId, lId, { tourney, ...meta, year, round, oppName: toInitialLast(r.winner_name), score: scoreDisplay(r.score, false), won: false, ret });
      trackIdentity(identity, lId, r.loser_name, r.loser_ioc, year);
    }
  }
  if (log) log(`  TML index: ${filesLoaded} year files, ${rowCount} matches, ${byId.size} players.`);
  return { byId, identity };
}

function pushMatch(byId, id, m) {
  let arr = byId.get(id);
  if (!arr) { arr = []; byId.set(id, arr); }
  arr.push(m);
}

function trackIdentity(identity, id, name, ioc, year) {
  let idn = identity.get(id);
  if (!idn) { idn = { key: nameKey(name), names: new Map(), iocs: new Set(), maxYear: 0, minYear: 9999 }; identity.set(id, idn); }
  idn.names.set(name, (idn.names.get(name) || 0) + 1);
  if (ioc) idn.iocs.add(String(ioc).toUpperCase());
  const y = Number(year);
  if (Number.isFinite(y) && y > 0) {
    if (y > idn.maxYear) idn.maxYear = y;
    if (y < idn.minYear) idn.minYear = y;
  }
}

// API `country` is a full English name; TML carries 3-letter IOC codes. This maps
// one to the other so a surname+initial collision can be narrowed by nationality.
// Best-effort secondary filter only — the active-era tiebreak resolves the cases
// (Ruud father/son, etc.) where nationality is shared.
const COUNTRY_TO_IOC = {
  'argentina': 'ARG', 'australia': 'AUS', 'austria': 'AUT', 'belgium': 'BEL',
  'benin': 'BEN', 'bolivia': 'BOL', 'bosnia and herzegovina': 'BIH', 'brazil': 'BRA',
  'bulgaria': 'BUL', 'canada': 'CAN', 'chile': 'CHI', 'china': 'CHN', 'colombia': 'COL',
  'croatia': 'CRO', 'cyprus': 'CYP', 'czech republic': 'CZE', 'czechia': 'CZE',
  'denmark': 'DEN', 'ecuador': 'ECU', 'estonia': 'EST', 'finland': 'FIN', 'france': 'FRA',
  'georgia': 'GEO', 'germany': 'GER', 'greece': 'GRE', 'hong kong': 'HKG', 'hungary': 'HUN',
  'india': 'IND', 'israel': 'ISR', 'italy': 'ITA', 'japan': 'JPN', 'jordan': 'JOR',
  'kazakhstan': 'KAZ', 'lebanon': 'LBN', 'lithuania': 'LTU', 'luxembourg': 'LUX',
  'mexico': 'MEX', 'moldova': 'MDA', 'monaco': 'MON', 'morocco': 'MAR', 'netherlands': 'NED',
  'new zealand': 'NZL', 'north macedonia': 'MKD', 'norway': 'NOR', 'pakistan': 'PAK',
  'paraguay': 'PAR', 'peru': 'PER', 'poland': 'POL', 'portugal': 'POR', 'qatar': 'QAT',
  'romania': 'ROU', 'serbia': 'SRB', 'slovakia': 'SVK', 'slovenia': 'SLO',
  'south africa': 'RSA', 'south korea': 'KOR', 'spain': 'ESP', 'sweden': 'SWE',
  'switzerland': 'SUI', 'taiwan': 'TPE', 'chinese taipei': 'TPE', 'tunisia': 'TUN',
  'turkey': 'TUR', 'turkiye': 'TUR', 'usa': 'USA', 'united states': 'USA', 'ukraine': 'UKR',
  'united arab emirates': 'UAE', 'united kingdom': 'GBR', 'great britain': 'GBR',
  'uzbekistan': 'UZB', 'venezuela': 'VEN', 'russia': 'RUS', 'belarus': 'BLR',
  'latvia': 'LAT', 'dominican republic': 'DOM', 'egypt': 'EGY', 'thailand': 'THA',
};

// Canonical surname signature: first-name initial + hyphen-folded, order-insensitive
// surname token SET. Only the FIRST whitespace token is the given name (its first
// char is the initial); every later token is a surname token, with hyphens folded
// to spaces so API's single-token "Carreno-Busta" == TML's "Carreno Busta". The
// first token is left intact (never hyphen-split), so a compound GIVEN name like
// "Jan-Lennard Struff" keeps surname {struff} rather than corrupting to
// {lennard,struff} — the regression the naive fold would cause.
function surnameSig(name) {
  const s = deaccent(name).toLowerCase().replace(/[.]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const parts = s.split(' ');
  if (parts.length < 2) return null;
  const initial = parts[0].charAt(0);
  const toks = parts.slice(1).join(' ').replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  if (!initial || !toks.length) return null;
  const set = new Set(toks);
  return { initial, set, canon: `${initial}|${[...set].sort().join(' ')}` };
}

function isSubset(a, b) { for (const t of a) if (!b.has(t)) return false; return true; }

// Legacy (surname|initial, raw) matcher — retained only so the before/after audit
// can measure exactly what the upgrade changes. Not used by the pipeline.
function reconcileLegacy(profiles, identity, countryToIoc, log) {
  const byNameKey = new Map();
  for (const [id, idn] of identity) {
    if (!idn.key) continue;
    let arr = byNameKey.get(idn.key);
    if (!arr) { arr = []; byNameKey.set(idn.key, arr); }
    arr.push(id);
  }
  const c2i = countryToIoc || {};
  const apiToTml = new Map();
  for (const [apiKey, p] of Object.entries(profiles)) {
    const k = nameKey(p.name);
    if (!k) continue;
    const cands = byNameKey.get(k);
    if (!cands || !cands.length) continue;
    if (cands.length === 1) { apiToTml.set(apiKey, cands[0]); continue; }
    const ioc = c2i[String(p.country || '').toLowerCase()];
    const narrowed = ioc ? cands.filter((id) => identity.get(id).iocs.has(ioc)) : [];
    if (narrowed.length === 1) apiToTml.set(apiKey, narrowed[0]);
  }
  return apiToTml;
}

// Maps API profile key -> TML player id. Three tiers, each strictly safer than the
// last: (1) exact canonical surname-set match; (2) API-truncation subset match
// (apiSet ⊂ tmlSet, same initial — the direction is fixed because API drops
// trailing surname parts, never the reverse, which is what mis-joined
// "Silva" ⊂ "Reis Da Silva"); (3) collisions resolved by IOC then active-era
// (our API players are current, so the latest-extending TML identity wins) with a
// >=4yr separation guard so two genuinely co-active people are never merged. A
// still-ambiguous case is dropped, never guessed.
function reconcile(profiles, identity, countryToIoc, log) {
  const c2i = (countryToIoc && Object.keys(countryToIoc).length) ? countryToIoc : COUNTRY_TO_IOC;
  const idSig = new Map();     // tmlId -> { initial, set, canon, maxYear, iocs }
  const byCanon = new Map();   // canon -> [tmlId]
  for (const [id, idn] of identity) {
    let best = null, bestN = -1;
    for (const [nm, n] of idn.names) if (n > bestN) { best = nm; bestN = n; }
    const sig = surnameSig(best);
    if (!sig) continue;
    idSig.set(id, { ...sig, maxYear: idn.maxYear || 0, iocs: idn.iocs });
    let arr = byCanon.get(sig.canon); if (!arr) { arr = []; byCanon.set(sig.canon, arr); }
    arr.push(id);
  }

  function disambiguate(p, cands) {
    if (cands.length === 1) return cands[0];
    let pool = cands;
    const ioc = c2i[String(p.country || '').toLowerCase()];
    if (ioc) {
      const narrowed = cands.filter((id) => idSig.get(id).iocs.has(ioc));
      if (narrowed.length === 1) return narrowed[0];
      if (narrowed.length) pool = narrowed;
      // Country is known but NO candidate carries it: the API player is almost
      // certainly a third person absent from TML (e.g. Venezuelan "A. Hernandez"
      // vs Mexico's Alex Hernandez). Refuse rather than let the era tiebreak
      // graft someone else's matches on. Never applies to a unique-canon match
      // (returned above), so it cannot regress an existing match.
      else return null;
    }
    let top = null, second = null;
    for (const id of pool) {
      const my = idSig.get(id).maxYear;
      if (top === null || my > idSig.get(top).maxYear) { second = top; top = id; }
      else if (second === null || my > idSig.get(second).maxYear) second = id;
    }
    if (top !== null && (second === null || idSig.get(top).maxYear - idSig.get(second).maxYear >= 4)) return top;
    return null;
  }

  const apiToTml = new Map();
  let matched = 0, viaSubset = 0, viaDisambig = 0, collided = 0, unmatched = 0;
  for (const [apiKey, p] of Object.entries(profiles)) {
    const sig = surnameSig(p.name);
    if (!sig) { unmatched++; continue; }
    let cands = byCanon.get(sig.canon);
    let usedSubset = false;
    if (!cands || !cands.length) {
      const sub = [];
      for (const [id, r] of idSig) {
        if (r.initial !== sig.initial) continue;
        if (r.set.size <= sig.set.size) continue;      // TML must be strictly longer
        if (isSubset(sig.set, r.set)) sub.push(id);
      }
      if (sub.length) { cands = sub; usedSubset = true; }
    }
    if (!cands || !cands.length) { unmatched++; continue; }
    const wasMulti = cands.length > 1;
    const pick = disambiguate(p, cands);
    if (pick === null || pick === undefined) { collided++; continue; }
    apiToTml.set(apiKey, pick);
    matched++;
    if (usedSubset) viaSubset++; else if (wasMulti) viaDisambig++;
  }
  if (log) log(`  Reconciled ${matched} players to TML (+${viaSubset} subset, +${viaDisambig} disambiguated; collisions ${collided}, unmatched ${unmatched}).`);
  return apiToTml;
}

// Per-player ATP match list from the Sackmann archive for [minYear, maxYear],
// shaped for the Overview year-table drill-down (surface, date, opponent, score).
// Reuses the same TML index + reconciliation as the tournament-history backfill.
// Returns { apiKey: [ {year, surface, level:'atp', date, tournament, round,
// opponent, result, won} ] } — only players reconciled to a TML identity.
async function buildArchiveHistories(profiles, minYear, maxYear, opts = {}) {
  const log = opts.log || (() => {});
  const countryToIoc = opts.countryToIoc || {};
  const index = await buildTmlIndex(log);
  const apiToTml = reconcile(profiles, index.identity, countryToIoc, log);
  const out = {};
  for (const [apiKey, tmlId] of apiToTml) {
    const ms = index.byId.get(tmlId) || [];
    const list = [];
    for (const m of ms) {
      if (m.year < minYear || m.year > maxYear) continue;
      if (!m.surface) continue; // drill-down is surface-scoped
      list.push({
        year: String(m.year), surface: m.surface, level: 'atp', date: m.date,
        tournament: m.tournamentName || m.tourney, round: m.round,
        // scoreDisplay renders opponentSets - playerSets; the live drill-down uses
        // playerSets - oppSets, so flip to keep both consistent.
        opponent: m.oppName, result: flipSets(m.score), won: m.won,
      });
    }
    if (list.length) {
      list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      out[apiKey] = list;
    }
  }
  if (log) log(`  Archive drill-down: ${Object.keys(out).length} players with ${minYear}-${maxYear} matches.`);
  return out;
}

// Recompute a tournament record from a {year -> matches[]} map, mirroring
// fetchPlayerCareerHistory's aggregate rules exactly.
function finalizeTournament(name, byYear) {
  const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);
  let titles = 0, bestScore = -1, bestResult = '', bestYears = [];
  let won = 0, lost = 0, firstYear = Infinity, lastYear = -Infinity;
  const editions = years.map((y) => {
    const ms = byYear[y].slice().sort((a, b) => rank(a.round) - rank(b.round));
    for (const m of ms) { if (m.res === 'W') won++; else lost++; }
    if (y < firstYear) firstYear = y;
    if (y > lastYear) lastYear = y;
    const deepest = ms.reduce((best, m) => (rank(m.round) > rank(best.round) ? m : best), ms[0]);
    const finishWon = deepest.res === 'W' && deepest.round === 'F';
    if (finishWon) titles++;
    const finish = finishWon ? 'Won' : (ROUND_FULL[deepest.round] || deepest.round);
    const finishScore = finishWon ? 8 : rank(deepest.round);
    if (finishScore > bestScore) { bestScore = finishScore; bestResult = finish; bestYears = [y]; }
    else if (finishScore === bestScore) { bestYears.push(y); }
    return {
      year: y, finish, finishWon,
      matches: ms.map((m) => ({ res: m.res, round: m.round, opp: m.opp, oppKey: m.oppKey, score: m.score, ...(m.ret ? { ret: true } : {}), ...(m.walkover ? { walkover: true } : {}) })),
    };
  });
  return { name, won, lost, firstYear, lastYear, titles, bestResult, bestYears, editions };
}

// Merges one player's pre-2021 TML matches into their existing history array.
// Existing (API) editions win on any shared year; TML only fills missing years.
function mergePlayer(history, tmlMatches) {
  // Group on canonical tournament identity, not display name, so an API "Toronto"
  // row and a TML "Canada Masters" row land in the same record. Existing (API)
  // editions win on any shared year; TML only fills missing <=2020 years. This
  // also consolidates any already-fragmented API rows (e.g. a stale cache that
  // still holds separate Montreal/Toronto rows) into one identity.
  const groups = new Map(); // id -> { display, byYear:{year->matches[]}, apiYears:Set }
  function group(id, display, fromApi) {
    let g = groups.get(id);
    if (!g) { g = { display, byYear: {}, apiYears: new Set() }; groups.set(id, g); }
    if (fromApi) g.display = display; // prefer the API label for the row
    return g;
  }

  // Existing (API) editions first.
  for (const t of (Array.isArray(history) ? history : [])) {
    const { id, display } = canonicalTournament(t.name);
    const g = group(id, display, true);
    for (const ed of (t.editions || [])) {
      const y = Number(ed.year);
      g.apiYears.add(y);
      if (!(y in g.byYear)) g.byYear[y] = (ed.matches || []).slice();
    }
  }

  // TML matches, grouped by canonical id then year.
  const tml = new Map(); // id -> { display, byYear:{year->matches[]} }
  for (const m of tmlMatches) {
    if (m.year > BACKFILL_UP_TO_YEAR) continue;
    const { id, display } = canonicalTournament(m.tourney);
    let e = tml.get(id);
    if (!e) { e = { display, byYear: {} }; tml.set(id, e); }
    // TEN-89 Bug B: scoreDisplay() renders "oppSets - playerSets", but the
    // profile-editions renderer prints the stored score verbatim next to a
    // res-derived "def./lost to", so it needs player-first "playerSets - oppSets"
    // (exactly what the API builder stores). The two OTHER scoreDisplay consumers
    // (buildArchiveHistories via flipSets, embedded matches via swapScore) already
    // compensate; this profile-editions path did not, so every pre-2021 edition
    // printed its score reversed. Flip it here, at the single uncompensated site.
    (e.byYear[m.year] = e.byYear[m.year] || []).push({ res: m.won ? 'W' : 'L', round: m.round, opp: m.oppName, oppKey: '', score: flipSets(m.score), ...(m.ret ? { ret: true } : {}) });
  }

  let addedEditions = 0;
  for (const [id, e] of tml) {
    const g = group(id, e.display, false);
    for (const [yStr, ms] of Object.entries(e.byYear)) {
      const y = Number(yStr);
      if (g.apiYears.has(y) || (y in g.byYear)) continue; // existing/API year wins
      g.byYear[y] = ms;
      addedEditions++;
    }
  }

  const hist = [];
  for (const g of groups.values()) hist.push(finalizeTournament(g.display, g.byYear));
  hist.sort((a, b) => (b.won + b.lost) - (a.won + a.lost));
  return { history: hist, addedEditions };
}

// ---------------------------------------------------------------------------
// MATCHES.JSON EMBEDDED HISTORY BACKFILL
// ---------------------------------------------------------------------------
// The dashboard's Today's Matches page renders match.p1TournamentHistory /
// match.p2TournamentHistory — a SEPARATE per-match structure the pipeline builds
// via fetchPlayerTournamentMatches (API-only, so also pre-2021 truncated, e.g.
// Zverev showing 14-4 at Wimbledon). It uses a different shape than the profile
// editions: API round labels ("1/8-finals"), self-first scores ("playerSets -
// oppSets"), roundReached labels, and long-match stats. This backfill fills the
// missing <=2020 editions into that shape so every dashboard surface agrees.

// TML round code -> API-Tennis round label (as produced by roundLabel() in
// bsp-pipeline.js). In a 128 draw R128 is the "1/64-finals", R16 the
// "1/8-finals", etc.
const TML_TO_API_ROUND = {
  F: 'Final', SF: 'Semi-finals', QF: 'Quarter-finals',
  R16: '1/8-finals', R32: '1/16-finals', R64: '1/32-finals',
  R128: '1/64-finals', R256: '1/128-finals', RR: 'Round Robin', BR: 'Bronze medal match',
};

// Profile editions store "oppSets - playerSets"; the matches embedded shape uses
// self-first "playerSets - oppSets". Swap the two halves.
function swapScore(s) {
  const p = String(s || '').split(' - ');
  return p.length === 2 ? `${p[1]} - ${p[0]}` : (s || '');
}

// Total sets in an edition score "a - b" (for long-match stats). null if unparsable.
function totalSets(result) {
  const p = String(result || '').split('-').map((x) => parseInt(x.trim(), 10));
  return (p.length === 2 && !p.some(Number.isNaN)) ? p[0] + p[1] : null;
}

// Recompute history-level aggregates + withdrawal gap rows from the merged real
// editions — mirrors buildTournamentHistory() in bsp-pipeline.js exactly.
function finalizeEmbedded(realYears) {
  let longMatches = 0, scoredMatches = 0;
  for (const y of realYears) {
    for (const mm of y.matches) {
      const ts = totalSets(mm.result);
      if (ts != null) { scoredMatches++; if (ts > 3.5) longMatches++; }
    }
  }
  const years = realYears.slice();
  const present = new Set(years.map((y) => parseInt(y.year, 10)));
  const minY = Math.min(...present), maxY = Math.max(...present);
  for (let y = minY + 1; y < maxY; y++) {
    if (!present.has(y)) years.push({ year: String(y), matchCount: 0, won: 0, lost: 0, roundReached: 'Withdrawal', matches: [], withdrew: true });
  }
  years.sort((a, b) => parseInt(b.year, 10) - parseInt(a.year, 10));
  return {
    editionsPlayed: years.filter((y) => !y.withdrew).length,
    totalWon: years.reduce((s, y) => s + y.won, 0),
    totalLost: years.reduce((s, y) => s + y.lost, 0),
    longMatches,
    longMatchesPlayed: scoredMatches,
    longMatchPct: scoredMatches > 0 ? Math.round((longMatches / scoredMatches) * 100) : 0,
    years,
  };
}

// Merge one player's pre-2021 TML matches (already filtered to a single
// tournament) into their existing embedded history. Existing/API years always
// win; TML only adds missing <=2020 years. Backfilled matches carry no exact
// calendar day (TML records only the tournament date), so date is left blank
// ("—" in the UI) rather than inventing a per-match date.
function buildEmbeddedHistory(existing, tmlMs) {
  const realYears = [];
  const present = new Set();
  if (existing && Array.isArray(existing.years)) {
    for (const y of existing.years) {
      if (y.withdrew) continue; // regenerate gaps after merge
      realYears.push(y);
      present.add(parseInt(y.year, 10));
    }
  }
  const tmlByYear = {};
  for (const m of tmlMs) {
    if (m.year > BACKFILL_UP_TO_YEAR) continue;
    (tmlByYear[m.year] = tmlByYear[m.year] || []).push(m);
  }
  let added = 0;
  for (const [yStr, ms] of Object.entries(tmlByYear)) {
    const y = parseInt(yStr, 10);
    if (present.has(y)) continue; // existing/API year wins
    const sorted = ms.slice().sort((a, b) => rank(b.round) - rank(a.round));
    const emMatches = sorted.map((m) => ({
      date: '', opponent: m.oppName, round: TML_TO_API_ROUND[m.round] || m.round,
      won: !!m.won, result: swapScore(m.score),
    }));
    let won = 0, lost = 0;
    for (const mm of emMatches) { if (mm.won) won++; else lost++; }
    realYears.push({
      year: String(y), matchCount: emMatches.length, won, lost,
      roundReached: TML_TO_API_ROUND[sorted[0].round] || sorted[0].round, matches: emMatches,
    });
    present.add(y);
    added++;
  }
  if (added === 0) return { history: existing, added: 0 };
  return { history: finalizeEmbedded(realYears), added };
}

// Public entry point. Patches match.p1TournamentHistory / p2TournamentHistory in
// place across a matches array. Reconciles each match side by its API player key
// (via profiles), so it only backfills players confidently mapped to a TML
// identity. Idempotent + network-tolerant like backfillProfilesHistory.
async function backfillMatchesTournamentHistory(matches, profiles, opts = {}) {
  const log = opts.log || (() => {});
  const countryToIoc = opts.countryToIoc || {};
  let index;
  try {
    index = await buildTmlIndex(log);
  } catch (e) {
    log(`  Matches backfill skipped — TML index failed: ${e.message}`);
    return { patched: 0, addedEditions: 0 };
  }
  if (!index.byId.size) { log('  Matches backfill skipped — no TML data available.'); return { patched: 0, addedEditions: 0 }; }

  const apiToTml = reconcile(profiles, index.identity, countryToIoc, log);

  // Lazily group each reconciled player's TML matches by canonical tournament.
  const cache = new Map(); // tmlId -> Map(tourLc -> matches[])
  function tmlForPlayerTour(tmlId, tourLc) {
    let byTour = cache.get(tmlId);
    if (!byTour) {
      byTour = new Map();
      for (const m of (index.byId.get(tmlId) || [])) {
        const disp = canonicalTournament(m.tourney).id;
        let arr = byTour.get(disp); if (!arr) { arr = []; byTour.set(disp, arr); }
        arr.push(m);
      }
      cache.set(tmlId, byTour);
    }
    return byTour.get(tourLc) || [];
  }

  let patched = 0, addedEditions = 0;
  for (const m of (matches || [])) {
    const tourLc = canonicalTournament(m.tour).id;
    for (const side of ['p1', 'p2']) {
      const tmlId = apiToTml.get(String(m[side + 'Key']));
      if (!tmlId) continue;
      const tmlMs = tmlForPlayerTour(tmlId, tourLc);
      if (!tmlMs.length) continue;
      const { history, added } = buildEmbeddedHistory(m[side + 'TournamentHistory'], tmlMs);
      if (added > 0) { m[side + 'TournamentHistory'] = history; patched++; addedEditions += added; }
    }
  }
  log(`  Matches backfill: patched ${patched} match-sides with ${addedEditions} pre-2021 editions.`);
  return { patched, addedEditions };
}

// Public entry point. Enriches profiles[key].tournamentHistory in place with
// pre-2021 editions. Safe to call every run: idempotent (TML supplies only
// <=2020, API-only years are never overwritten) and network-tolerant (a TML
// outage just skips the backfill). Returns a small summary.
async function backfillProfilesHistory(profiles, opts = {}) {
  const log = opts.log || (() => {});
  const countryToIoc = opts.countryToIoc || {};
  let index;
  try {
    index = await buildTmlIndex(log);
  } catch (e) {
    log(`  Backfill skipped — TML index failed: ${e.message}`);
    return { backfilled: 0, addedEditions: 0 };
  }
  if (!index.byId.size) { log('  Backfill skipped — no TML data available.'); return { backfilled: 0, addedEditions: 0 }; }

  const apiToTml = reconcile(profiles, index.identity, countryToIoc, log);

  let backfilled = 0, addedEditions = 0;
  for (const [apiKey, tmlId] of apiToTml) {
    const matches = index.byId.get(tmlId);
    if (!matches || !matches.length) continue;
    const { history, addedEditions: added } = mergePlayer(profiles[apiKey].tournamentHistory, matches);
    if (added > 0) {
      profiles[apiKey].tournamentHistory = history;
      backfilled++;
      addedEditions += added;
    }
  }
  log(`  Backfill: enriched ${backfilled} players with ${addedEditions} pre-2021 editions.`);
  return { backfilled, addedEditions };
}

module.exports = {
  backfillProfilesHistory,
  backfillMatchesTournamentHistory,
  buildArchiveHistories,
  // exported for testing
  _internal: { buildTmlIndex, reconcile, reconcileLegacy, surnameSig, mergePlayer, finalizeTournament, buildEmbeddedHistory, nameKey, scoreDisplay, swapScore, setCounts, toInitialLast },
};
