// =================================================================
// CAREER HISTORY BACKFILL (pre-2021)
// -----------------------------------------------------------------
// API-Tennis's get_fixtures feed only returns fixtures back to ~2021, so a
// player's per-tournament career record (built in bsp-pipeline.js's
// fetchPlayerCareerHistory) is truncated — e.g. Djokovic's Wimbledon shows
// 2021+ only, missing his 2005-2020 runs and titles. This module backfills the
// missing pre-2021 editions from the open TML-Database (Tennismylife) ATP match
// archive, which uses the same schema Jeff Sackmann's tennis_atp pioneered and
// covers 1968-present. Canonical Sackmann repo (JeffSackmann/tennis_atp) is the
// origin of this format; TML is used here because it mirrors the same columns
// and is reliably reachable.
//
// It merges TML editions (years <= 2020 only) into each profile's existing
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

const TML_BASE = 'https://raw.githubusercontent.com/Tennismylife/TML-Database/master/';
const TML_CACHE_DIR = path.join(__dirname, 'tml-cache');
// API-Tennis reliably covers 2021+, so TML only supplies <=2020. No current ATP
// player debuted before 2000, so that is a safe download floor.
const BACKFILL_FLOOR_YEAR = 2000;
const BACKFILL_UP_TO_YEAR = 2020;

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

      // Winner's row entry.
      pushMatch(byId, wId, { tourney, year, round, oppName: toInitialLast(r.loser_name), score: scoreDisplay(r.score, true), won: true });
      trackIdentity(identity, wId, r.winner_name, r.winner_ioc);
      // Loser's row entry.
      pushMatch(byId, lId, { tourney, year, round, oppName: toInitialLast(r.winner_name), score: scoreDisplay(r.score, false), won: false });
      trackIdentity(identity, lId, r.loser_name, r.loser_ioc);
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

function trackIdentity(identity, id, name, ioc) {
  let idn = identity.get(id);
  if (!idn) { idn = { key: nameKey(name), names: new Map(), iocs: new Set() }; identity.set(id, idn); }
  idn.names.set(name, (idn.names.get(name) || 0) + 1);
  if (ioc) idn.iocs.add(String(ioc).toUpperCase());
}

// Maps API profile key -> TML player id by (last name + first initial). On a key
// collision (e.g. two players share a surname+initial) the match is dropped
// unless a country hint disambiguates — never guessed.
function reconcile(profiles, identity, countryToIoc, log) {
  // Group TML ids by nameKey.
  const byNameKey = new Map();
  for (const [id, idn] of identity) {
    if (!idn.key) continue;
    let arr = byNameKey.get(idn.key);
    if (!arr) { arr = []; byNameKey.set(idn.key, arr); }
    arr.push(id);
  }

  const apiToTml = new Map();
  let matched = 0, collided = 0, unmatched = 0;
  for (const [apiKey, p] of Object.entries(profiles)) {
    const k = nameKey(p.name);
    if (!k) { unmatched++; continue; }
    const cands = byNameKey.get(k);
    if (!cands || !cands.length) { unmatched++; continue; }
    if (cands.length === 1) { apiToTml.set(apiKey, cands[0]); matched++; continue; }
    // Collision — try country/IOC.
    const ioc = countryToIoc[String(p.country || '').toLowerCase()];
    const narrowed = ioc ? cands.filter((id) => identity.get(id).iocs.has(ioc)) : [];
    if (narrowed.length === 1) { apiToTml.set(apiKey, narrowed[0]); matched++; }
    else collided++;
  }
  if (log) log(`  Reconciled ${matched} players to TML (collisions ${collided}, unmatched ${unmatched}).`);
  return apiToTml;
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
      matches: ms.map((m) => ({ res: m.res, round: m.round, opp: m.opp, oppKey: m.oppKey, score: m.score })),
    };
  });
  return { name, won, lost, firstYear, lastYear, titles, bestResult, bestYears, editions };
}

// Merges one player's pre-2021 TML matches into their existing history array.
// Existing (API) editions win on any shared year; TML only fills missing years.
function mergePlayer(history, tmlMatches) {
  const hist = Array.isArray(history) ? history.map((t) => ({ ...t, editions: (t.editions || []).map((e) => ({ ...e })) })) : [];

  // Group this player's TML matches by canonical (aliased) tournament name.
  const tmlByTournament = new Map();
  for (const m of tmlMatches) {
    if (m.year > BACKFILL_UP_TO_YEAR) continue;
    const display = TOURNAMENT_ALIASES[m.tourney.toLowerCase()] || m.tourney;
    let g = tmlByTournament.get(display.toLowerCase());
    if (!g) { g = { display, byYear: {} }; tmlByTournament.set(display.toLowerCase(), g); }
    (g.byYear[m.year] = g.byYear[m.year] || []).push({ res: m.won ? 'W' : 'L', round: m.round, opp: m.oppName, oppKey: '', score: m.score });
  }

  let addedEditions = 0;
  for (const [lcName, g] of tmlByTournament) {
    const existingIdx = hist.findIndex((t) => (t.name || '').toLowerCase() === lcName);
    const byYear = {};
    if (existingIdx >= 0) {
      for (const ed of hist[existingIdx].editions) byYear[ed.year] = ed.matches.slice();
    }
    for (const [yStr, ms] of Object.entries(g.byYear)) {
      const y = Number(yStr);
      if (byYear[y]) continue; // existing/API year wins
      byYear[y] = ms;
      addedEditions++;
    }
    const display = existingIdx >= 0 ? hist[existingIdx].name : g.display;
    const rebuilt = finalizeTournament(display, byYear);
    if (existingIdx >= 0) hist[existingIdx] = rebuilt; else hist.push(rebuilt);
  }

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
        const disp = (TOURNAMENT_ALIASES[m.tourney.toLowerCase()] || m.tourney).toLowerCase();
        let arr = byTour.get(disp); if (!arr) { arr = []; byTour.set(disp, arr); }
        arr.push(m);
      }
      cache.set(tmlId, byTour);
    }
    return byTour.get(tourLc) || [];
  }

  let patched = 0, addedEditions = 0;
  for (const m of (matches || [])) {
    const base = normalizeTournamentName(m.tour);
    const tourLc = (TOURNAMENT_ALIASES[base.toLowerCase()] || base).toLowerCase();
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
  // exported for testing
  _internal: { buildTmlIndex, reconcile, mergePlayer, finalizeTournament, buildEmbeddedHistory, nameKey, scoreDisplay, swapScore, setCounts, toInitialLast },
};
