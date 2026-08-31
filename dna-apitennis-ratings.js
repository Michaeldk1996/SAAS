#!/usr/bin/env node
// =============================================================================
// TEN-103 — DNA ratings PURELY from api-tennis cached box scores (NO Sackmann/TML)
// -----------------------------------------------------------------------------
// Founder ruling: everything comes from api-tennis only. api-tennis match
// statistics exist only from 2024-03-06 onward, and that is ACCEPTED — the
// "baseline/career" scope is simply "since 2024" (sinceBase); the primary radar
// scope is the trailing 52 weeks (last52), fully inside coverage.
//
// Four LOCKED DNA ratings (TEN-103 founder ruling 2026-08-29), straight unweighted
// sums over the scope window, computed from api-tennis per-match statistics rows:
//   SERVE          = %1stIn + %1stWon + %2ndWon + hold%(svc games won)
//                    + acesPerMatch − DFPerMatch   (aces/DF RAW per-match counts)
//   RETURN         = %1stReturnWon + %2ndReturnWon + %returnGamesWon + %BPconverted
//   UNDER PRESSURE = %BPsaved + %BPconverted + %tiebreaksWon + %decidingSetsWon
//                    (4-sum; if only 3 present emit mean(present)*4, estimated:true;
//                     <3 present -> null)
//   DOMINANCE RATIO= returnPtsWon% / (100 − servicePtsWon%)
//
// (Surface Elo is the LOCKED 5th axis but already exists in elo-ratings.json — NOT
//  computed here.)
//
// INPUTS (all read by ABSOLUTE path from the main checkout; this worktree has none):
//   MAIN/apitennis-wue-cache/265-YYYY-MM-DD.json  ATP main-tour singles box scores
//   MAIN/tournament-surfaces.json                 tournament_key -> clay|hard|grass|null
//   MAIN/player-profiles.json                     roster (428 keys = api-tennis player_key)
//
// SCOPE / SURFACE / FLOOR conventions mirror surface-ratings.js:
//   scopes  : last52 (<=364d before player's most-recent cached match) + sinceBase (all)
//   surfaces: Hard / Clay / Grass / All (indoor->Hard, carpet dropped — already folded
//             in tournament-surfaces.json's normalizeSurface)
//   include : > 10 matches (INCLUDE_MIN_MATCHES = 11) on All/sinceBase
//
// TOUR LEVEL: ATP main-tour singles only (event_type 265), matching the tour-level
//   serve/return convention of the Sackmann generator and the founder's ATP-scale
//   check figures. Challenger (281) box scores exist in cache but are NOT folded in.
// =============================================================================
const fs = require('fs');
const path = require('path');

const MAIN = '/Users/Michael/bsp-consult-project';
const CACHE = path.join(MAIN, 'apitennis-wue-cache');
const SURF_MAP_PATH = path.join(MAIN, 'tournament-surfaces.json');
const ROSTER_PATH = path.join(MAIN, 'player-profiles.json');
const ELO_PATH = path.join(MAIN, 'elo-ratings.json');   // Tennis Abstract surface Elo (5th axis)
const OUT = path.join(__dirname, 'dna-apitennis-ratings.json');

const STATS_FLOOR = '2024-03-06';
const LAST52_DAYS = 364;
const INCLUDE_MIN_MATCHES = 11;         // > 10 matches, All/sinceBase (matches surface-ratings.js)
const SURFACES = ['Hard', 'Clay', 'Grass'];
const CAP = { clay: 'Clay', hard: 'Hard', grass: 'Grass' };

const t0 = Date.now();

// ---- surface lookup (tournament_key -> 'Hard'|'Clay'|'Grass'|null) -----------
const surfRaw = JSON.parse(fs.readFileSync(SURF_MAP_PATH, 'utf8')).surfaces;
const surfaceOf = tk => CAP[surfRaw[String(tk)]] || null;   // null => carpet/unknown -> dropped from per-surface

// ---- roster (denominator) ----------------------------------------------------
const roster = JSON.parse(fs.readFileSync(ROSTER_PATH, 'utf8')).players;
const rosterKeys = new Set(Object.keys(roster).map(String));
const nameOf = k => (roster[String(k)] && roster[String(k)].name) || null;

// ---- stat-row helpers --------------------------------------------------------
function pick(rows, type, name) {
  const nl = name.toLowerCase();
  return rows.find(s => s.stat_type === type && String(s.stat_name).toLowerCase() === nl);
}
const num = v => { const x = Number(v); return Number.isFinite(x) ? x : null; };

// Parse one player's match-period stat block into the raw numerator/denominator atoms.
function statBlock(matchRows, playerKey) {
  const r = matchRows.filter(s => String(s.player_key) === String(playerKey));
  if (!r.length) return null;
  const g = (ty, nm) => pick(r, ty, nm);
  const firstSPW = g('Service', '1st Serve Points Won');   // won=1stWon, total=1stIn
  const secondSPW = g('Service', '2nd Serve Points Won');  // won=2ndWon, total=2ndPts
  const svcPW = g('Points', 'Service Points Won');         // won, total = svpt
  const retPW = g('Points', 'Return Points Won');          // won, total = ret pts
  const svcGW = g('Games', 'Service Games Won');           // won, total = svc games (hold)
  const retGW = g('Games', 'Return Games Won');            // won, total = ret games (breakPct)
  const ret1 = g('Return', '1st Return Points Won');
  const ret2 = g('Return', '2nd Return Points Won');
  const bpConv = g('Return', 'Break Points Converted');    // won, total
  const bpSaved = g('Service', 'Break Points Saved');      // won, total
  const aces = g('Service', 'Aces');
  const dfs = g('Service', 'Double Faults');
  // Serve stats present iff we have a service-points denominator.
  const svTot = svcPW ? num(svcPW.stat_total) : null;
  if (svTot == null || svTot <= 0) return { serveOk: false };
  return {
    serveOk: true,
    firstInTot: firstSPW ? num(firstSPW.stat_total) : null,   // # first serves in
    firstWon:   firstSPW ? num(firstSPW.stat_won)   : null,
    secondWon:  secondSPW ? num(secondSPW.stat_won) : null,
    secondTot:  secondSPW ? num(secondSPW.stat_total) : null,
    svcPWon: svcPW ? num(svcPW.stat_won) : null, svpt: svTot,
    svGmWon: svcGW ? num(svcGW.stat_won) : null, svGmTot: svcGW ? num(svcGW.stat_total) : null,
    aces: aces ? num(aces.stat_value) : null, dfs: dfs ? num(dfs.stat_value) : null,
    // return
    retPWon: retPW ? num(retPW.stat_won) : null, retPTot: retPW ? num(retPW.stat_total) : null,
    ret1Won: ret1 ? num(ret1.stat_won) : null, ret1Tot: ret1 ? num(ret1.stat_total) : null,
    ret2Won: ret2 ? num(ret2.stat_won) : null, ret2Tot: ret2 ? num(ret2.stat_total) : null,
    retGmWon: retGW ? num(retGW.stat_won) : null, retGmTot: retGW ? num(retGW.stat_total) : null,
    bpConvWon: bpConv ? num(bpConv.stat_won) : null, bpConvTot: bpConv ? num(bpConv.stat_total) : null,
    bpSavedWon: bpSaved ? num(bpSaved.stat_won) : null, bpSavedTot: bpSaved ? num(bpSaved.stat_total) : null,
  };
}

// Parse scores[] -> tiebreak + deciding-set outcome from the target player's view.
// Finished (non-retired) matches only. Returns {tbPlayed, tbWon, decPlayed, decWon}.
function scoreOutcome(scores, isFirst, eventWinner) {
  const out = { tbPlayed: 0, tbWon: 0, decPlayed: 0, decWon: 0 };
  if (!Array.isArray(scores) || !scores.length) return out;
  let setsFirst = 0, setsSecond = 0;
  for (const s of scores) {
    const a = num(s.score_first), b = num(s.score_second);
    if (a == null || b == null) continue;
    if (a === 0 && b === 0) continue;                 // 0-0 = padding/unplayed set row
    if (a > b) setsFirst++; else if (b > a) setsSecond++;
    // Tiebreak sets are encoded with the tiebreak minipoints in the decimal, e.g.
    // "7.7-6.5" = 7-6 in games. Floor to the game count to detect a 7-6 / 6-7 set.
    const fa = Math.floor(a), fb = Math.floor(b);
    const isTb = (fa === 7 && fb === 6) || (fa === 6 && fb === 7);
    if (isTb) {
      out.tbPlayed++;
      const firstWonTb = a > b;
      if (firstWonTb === isFirst) out.tbWon++;
    }
  }
  const winnerSets = Math.max(setsFirst, setsSecond), loserSets = Math.min(setsFirst, setsSecond);
  const isDeciding = (winnerSets === 2 && loserSets === 1) || (winnerSets === 3 && loserSets === 2);
  if (isDeciding && (eventWinner === 'First Player' || eventWinner === 'Second Player')) {
    out.decPlayed = 1;
    const targetWonMatch = (eventWinner === 'First Player') === isFirst;
    if (targetWonMatch) out.decWon = 1;   // match winner won the deciding set
  }
  return out;
}

// ---- per-player accumulators -------------------------------------------------
function newAgg() {
  return {
    matches: 0, svMatches: 0,
    firstInTot: 0, firstWon: 0, secondWon: 0, secondTot: 0,
    svcPWon: 0, svpt: 0, svGmWon: 0, svGmTot: 0, aces: 0, dfs: 0,
    retPWon: 0, retPTot: 0, ret1Won: 0, ret1Tot: 0, ret2Won: 0, ret2Tot: 0,
    retGmWon: 0, retGmTot: 0, bpConvWon: 0, bpConvTot: 0, bpSavedWon: 0, bpSavedTot: 0,
    tbPlayed: 0, tbWon: 0, decPlayed: 0, decWon: 0,
  };
}
function add(agg, b, sc) {
  agg.matches++;
  agg.svMatches++;
  if (b.firstInTot != null) agg.firstInTot += b.firstInTot;
  if (b.firstWon != null) agg.firstWon += b.firstWon;
  if (b.secondWon != null) agg.secondWon += b.secondWon;
  if (b.secondTot != null) agg.secondTot += b.secondTot;
  if (b.svcPWon != null) agg.svcPWon += b.svcPWon;
  agg.svpt += b.svpt;
  if (b.svGmWon != null) agg.svGmWon += b.svGmWon;
  if (b.svGmTot != null) agg.svGmTot += b.svGmTot;
  if (b.aces != null) agg.aces += b.aces;
  if (b.dfs != null) agg.dfs += b.dfs;
  if (b.retPWon != null) agg.retPWon += b.retPWon;
  if (b.retPTot != null) agg.retPTot += b.retPTot;
  if (b.ret1Won != null) agg.ret1Won += b.ret1Won;
  if (b.ret1Tot != null) agg.ret1Tot += b.ret1Tot;
  if (b.ret2Won != null) agg.ret2Won += b.ret2Won;
  if (b.ret2Tot != null) agg.ret2Tot += b.ret2Tot;
  if (b.retGmWon != null) agg.retGmWon += b.retGmWon;
  if (b.retGmTot != null) agg.retGmTot += b.retGmTot;
  if (b.bpConvWon != null) agg.bpConvWon += b.bpConvWon;
  if (b.bpConvTot != null) agg.bpConvTot += b.bpConvTot;
  if (b.bpSavedWon != null) agg.bpSavedWon += b.bpSavedWon;
  if (b.bpSavedTot != null) agg.bpSavedTot += b.bpSavedTot;
  agg.tbPlayed += sc.tbPlayed; agg.tbWon += sc.tbWon;
  agg.decPlayed += sc.decPlayed; agg.decWon += sc.decWon;
}

const R1 = v => v == null ? null : +v.toFixed(1);
const R2 = v => v == null ? null : +v.toFixed(2);

// ---- LOCKED rating math (verbatim intent from surface-ratings.js computeRatings) --
function computeRatings(a) {
  // SERVE
  let serve = null;
  if (a.svpt > 0 && a.firstInTot > 0 && a.svGmTot > 0) {
    const firstInPct = a.firstInTot / a.svpt * 100;
    const firstWonPct = a.firstWon / a.firstInTot * 100;
    const secondWonPct = a.secondTot > 0 ? a.secondWon / a.secondTot * 100 : 0;
    const holdPct = a.svGmWon / a.svGmTot * 100;
    const acesPerMatch = a.svMatches > 0 ? a.aces / a.svMatches : 0;
    const dfPerMatch = a.svMatches > 0 ? a.dfs / a.svMatches : 0;
    serve = {
      firstInPct: R1(firstInPct), firstWonPct: R1(firstWonPct), secondWonPct: R1(secondWonPct),
      holdPct: R1(holdPct), acesPerMatch: R1(acesPerMatch), dfPerMatch: R1(dfPerMatch),
      rating: R1(firstInPct + firstWonPct + secondWonPct + holdPct + acesPerMatch - dfPerMatch),
    };
  }
  // RETURN
  let ret = null;
  if (a.ret1Tot > 0 && a.ret2Tot > 0 && a.retGmTot > 0 && a.bpConvTot > 0) {
    const ret1WonPct = a.ret1Won / a.ret1Tot * 100;
    const ret2WonPct = a.ret2Won / a.ret2Tot * 100;
    const retGmWonPct = a.retGmWon / a.retGmTot * 100;   // = return games won % (breakPct)
    const bpConvPct = a.bpConvWon / a.bpConvTot * 100;
    ret = {
      ret1stWonPct: R1(ret1WonPct), ret2ndWonPct: R1(ret2WonPct),
      returnGamesWonPct: R1(retGmWonPct), bpConvPct: R1(bpConvPct),
      rating: R1(ret1WonPct + ret2WonPct + retGmWonPct + bpConvPct),
    };
  }
  // UNDER PRESSURE (4-sum; 3-of-4 -> mean*4 estimate; <3 -> null)
  const bpSavedPct = a.bpSavedTot > 0 ? a.bpSavedWon / a.bpSavedTot * 100 : null;
  const bpConvPct = a.bpConvTot > 0 ? a.bpConvWon / a.bpConvTot * 100 : null;
  const tbWinPct = a.tbPlayed > 0 ? a.tbWon / a.tbPlayed * 100 : null;
  const decWinPct = a.decPlayed > 0 ? a.decWon / a.decPlayed * 100 : null;
  const parts = [bpSavedPct, bpConvPct, tbWinPct, decWinPct];
  const present = parts.filter(v => v != null);
  const haveUp = present.length;
  const up = {
    bpSavedPct: R1(bpSavedPct), bpConvPct: R1(bpConvPct),
    tbWinPct: R1(tbWinPct), decWinPct: R1(decWinPct),
    rating: haveUp >= 4 ? R1(bpSavedPct + bpConvPct + tbWinPct + decWinPct)
          : haveUp === 3 ? R1(present.reduce((x, c) => x + c, 0) / haveUp * 4)
          : null,
    estimated: haveUp === 3,
    components: haveUp,
  };
  // DOMINANCE RATIO
  let dom = null;
  if (a.svpt > 0 && a.retPTot > 0) {
    const svcPWonPct = a.svcPWon / a.svpt * 100;
    const retPWonPct = a.retPWon / a.retPTot * 100;
    const denom = 100 - svcPWonPct;
    dom = {
      servicePtsWonPct: R1(svcPWonPct), returnPtsWonPct: R1(retPWonPct),
      rating: denom > 0 ? R2(retPWonPct / denom) : null,
    };
  }
  return {
    serve, return: ret, underPressure: up, dominanceRatio: dom,
    sample: { matches: a.matches, svpt: a.svpt, bpFaced: a.bpSavedTot, bpChances: a.bpConvTot, tbPlayed: a.tbPlayed, decPlayed: a.decPlayed },
  };
}

// ---- ingest cache ------------------------------------------------------------
// contribs[playerKey] = [ {date, surface, block, score} ... ]  (ATP 265 only)
const contribs = new Map();
let filesRead = 0, filesBad = 0, fixturesSeen = 0, ingested = 0, noSurface = 0;
const seenPM = new Set();

for (const file of fs.readdirSync(CACHE)) {
  if (!file.startsWith('265-')) continue;   // ATP main-tour singles only
  let arr;
  try { arr = JSON.parse(fs.readFileSync(path.join(CACHE, file), 'utf8')); filesRead++; }
  catch (e) { filesBad++; continue; }
  for (const f of arr) {
    fixturesSeen++;
    if (!/finished/i.test(f.event_status || '')) continue;         // full stats only
    if (f.event_type_type && !/single/i.test(f.event_type_type)) continue;
    if (!Array.isArray(f.statistics) || !f.statistics.length) continue;
    const matchRows = f.statistics.filter(s => s.stat_period === 'match');
    if (!matchRows.length) continue;
    const date = f.event_date;
    const surface = surfaceOf(f.tournament_key);
    const p1 = String(f.first_player_key), p2 = String(f.second_player_key);
    const ekey = String(f.event_key || `${p1}:${p2}:${date}`);
    for (const [pk, isFirst] of [[p1, true], [p2, false]]) {
      if (!pk || pk === 'null') continue;
      const pmId = `${ekey}:${pk}`;
      if (seenPM.has(pmId)) continue;
      seenPM.add(pmId);
      const block = statBlock(matchRows, pk);
      if (!block || !block.serveOk) continue;
      const score = scoreOutcome(f.scores, isFirst, f.event_winner);
      if (!contribs.has(pk)) contribs.set(pk, []);
      contribs.get(pk).push({ date, surface, block, score });
      ingested++;
      if (!surface) noSurface++;
    }
  }
}

// ---- aggregate per player into scopes x surfaces -----------------------------
const players = [];
for (const [pk, list] of contribs) {
  // last52 anchored to the player's most-recent cached match date
  let latest = '';
  for (const c of list) if (c.date > latest) latest = c.date;
  const cutoffMs = latest ? new Date(latest + 'T00:00:00Z').getTime() - LAST52_DAYS * 86400000 : null;

  const scopes = { last52: {}, sinceBase: {} };
  for (const s of [...SURFACES, 'All']) { scopes.last52[s] = newAgg(); scopes.sinceBase[s] = newAgg(); }

  for (const c of list) {
    const inL52 = cutoffMs != null && new Date(c.date + 'T00:00:00Z').getTime() >= cutoffMs;
    add(scopes.sinceBase.All, c.block, c.score);
    if (c.surface) add(scopes.sinceBase[c.surface], c.block, c.score);
    if (inL52) {
      add(scopes.last52.All, c.block, c.score);
      if (c.surface) add(scopes.last52[c.surface], c.block, c.score);
    }
  }

  const surfaces = {};
  for (const s of [...SURFACES, 'All']) {
    surfaces[s] = { last52: computeRatings(scopes.last52[s]), sinceBase: computeRatings(scopes.sinceBase[s]) };
  }
  players.push({
    playerKey: pk,
    name: nameOf(pk),
    inRoster: rosterKeys.has(pk),
    matchesAll: { last52: scopes.last52.All.matches, sinceBase: scopes.sinceBase.All.matches },
    latestMatch: latest,
    surfaces,
  });
}

// keep only roster players with > 10 sinceBase-All matches (inclusion gate)
const rated = players.filter(p => p.inRoster && p.matchesAll.sinceBase >= INCLUDE_MIN_MATCHES);
rated.sort((a, b) => b.matchesAll.sinceBase - a.matchesAll.sinceBase);

// ===========================================================================
// 5th AXIS — Surface Elo (Tennis Abstract, elo-ratings.json). NOT computed here;
// attached per rated player, resolved by surname|firstInitial (the exact join the
// dashboard's edgeEloKey/ppEloForSurface use). Strict per-surface: a missing
// surface slot leaves that surface's Elo axis null rather than degrading to All
// (honesty — a grass Elo we don't hold is not the all-surface number).
// ===========================================================================
const eloRaw = (() => { try { return JSON.parse(fs.readFileSync(ELO_PATH, 'utf8')); } catch (e) { return {}; } })();
const eloMap = eloRaw.elo || {};
function eloKeyOf(name) {
  const p = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['’]/g, '').replace(/[.\-]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (p.length < 2) return null;
  return p[p.length - 1] + '|' + p[0][0];
}
const ELO_SLOT = { Hard: 'hard', Clay: 'clay', Grass: 'grass', All: 'all' };
let eloResolved = 0;
for (const p of rated) {
  const rec = eloMap[eloKeyOf(p.name)] || null;
  if (rec) eloResolved++;
  for (const s of [...SURFACES, 'All']) {
    const slot = rec ? rec[ELO_SLOT[s]] : null;
    p.surfaces[s].elo = (slot && slot.rating != null)
      ? { rating: slot.rating, rank: (slot.rank != null ? slot.rank : null), pct: null }
      : null;
  }
}

// ===========================================================================
// RADAR PERCENTILES — the ratings live on 4 different scales (Serve ~260-303,
// Return ~120-169, Under Pressure ~228-271, Dominance ~1.0-1.55, Elo ~1400-2350),
// so the radar can't chart raw values. For each axis x scope x surface pool
// (rated players with a non-null rating), scale the raw rating linearly between
// the pool's p2 and p98 values into 0-100 (`pct`), clamped so tail outliers don't
// peg a spoke. p2/p98 band edges are emitted to _meta.bands for provenance. Elo is
// scope-independent (one band per surface, shared by both scopes).
// ===========================================================================
function quantile(sorted, q) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q, base = Math.floor(pos), rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}
function pctFromBand(v, p2, p98) {
  if (v == null || p2 == null || p98 == null || p98 <= p2) return v == null ? null : 50;
  return +Math.max(0, Math.min(100, (v - p2) / (p98 - p2) * 100)).toFixed(1);
}
const RATE_AXES = ['serve', 'return', 'underPressure', 'dominanceRatio'];
const bands = {};                          // bands[scope][surface][axis] = {p2,p98,n}
for (const scope of ['last52', 'sinceBase']) {
  bands[scope] = {};
  for (const s of [...SURFACES, 'All']) {
    bands[scope][s] = {};
    for (const ax of RATE_AXES) {
      const vals = [];
      for (const p of rated) { const r = p.surfaces[s][scope][ax]; if (r && r.rating != null) vals.push(r.rating); }
      vals.sort((a, b) => a - b);
      const p2 = quantile(vals, 0.02), p98 = quantile(vals, 0.98);
      bands[scope][s][ax] = { p2: p2 != null ? +p2.toFixed(2) : null, p98: p98 != null ? +p98.toFixed(2) : null, n: vals.length };
      for (const p of rated) { const r = p.surfaces[s][scope][ax]; if (r && r.rating != null) r.pct = pctFromBand(r.rating, p2, p98); }
    }
  }
}
const eloBands = {};                        // eloBands[surface] = {p2,p98,n}
for (const s of [...SURFACES, 'All']) {
  const vals = [];
  for (const p of rated) { const e = p.surfaces[s].elo; if (e && e.rating != null) vals.push(e.rating); }
  vals.sort((a, b) => a - b);
  const p2 = quantile(vals, 0.02), p98 = quantile(vals, 0.98);
  eloBands[s] = { p2: p2 != null ? +p2.toFixed(1) : null, p98: p98 != null ? +p98.toFixed(1) : null, n: vals.length };
  for (const p of rated) { const e = p.surfaces[s].elo; if (e && e.rating != null) e.pct = pctFromBand(e.rating, p2, p98); }
}

const out = {
  _meta: {
    task: 'TEN-103 — api-tennis-native DNA ratings',
    generatedAt: new Date().toISOString(),
    source: `api-tennis box scores, ATP main-tour singles (event_type 265), ${STATS_FLOOR}..now — NO Sackmann/TML`,
    scopes: { last52: `matches within ${LAST52_DAYS}d of player's most-recent cached match`, sinceBase: `all cached data (${STATS_FLOOR} -> now)` },
    surfaces: 'Hard/Clay/Grass/All; indoor->Hard, carpet->dropped (via tournament-surfaces.json normalizeSurface)',
    inclusion: `roster player with > 10 (>=${INCLUDE_MIN_MATCHES}) sinceBase-All matches`,
    lockedFormulas: {
      serve: '%1stIn + %1stWon + %2ndWon + hold% + acesPerMatch − DFPerMatch (aces/DF raw per-match)',
      return: '%1stReturnWon + %2ndReturnWon + %returnGamesWon + %BPconverted',
      underPressure: '%BPsaved + %BPconverted + %tiebreaksWon + %decidingSetsWon (4-sum; 3-of-4 -> mean*4 estimated:true; <3 -> null)',
      dominanceRatio: 'returnPtsWon% / (100 − servicePtsWon%)',
    },
    rosterSize: rosterKeys.size,
    ratedPlayers: rated.length,
    eloResolved,
    radarAxes: ['serve', 'return', 'underPressure', 'dominanceRatio', 'elo (Surface Elo)'],
    pctMethod: 'raw rating scaled linearly p2->0, p98->100 within (axis x scope x surface) rated-player pool, clamped 0-100',
    bands,            // bands[scope][surface][rateAxis] = {p2,p98,n}
    eloBands,         // eloBands[surface] = {p2,p98,n}  (Surface Elo is scope-independent)
    ingest: { filesRead, filesBad, fixturesSeen, playerMatchesIngested: ingested, playerMatchesWithoutSurface: noSurface, distinctPlayersInCache: contribs.size },
    wallClockMs: Date.now() - t0,
  },
  players: rated,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));

// ---- coverage report ---------------------------------------------------------
function cnt(scope, surf, axis, min) {
  return rated.filter(p => {
    const m = p.surfaces[surf][scope].sample.matches;
    if (m < min) return false;
    const r = p.surfaces[surf][scope][axis];
    return r && r.rating != null;
  }).length;
}
console.log(`\nWROTE ${OUT}`);
console.log(JSON.stringify(out._meta.ingest, null, 1));
console.log(`\n=== COVERAGE (All-surface) — players rated per axis/scope at >=10 and >=20 matches ===`);
const axes = [['serve', 'Serve'], ['return', 'Return'], ['underPressure', 'Under Pressure'], ['dominanceRatio', 'Dominance Ratio']];
for (const scope of ['last52', 'sinceBase']) {
  console.log(`-- scope=${scope} --`);
  for (const [a, label] of axes) {
    console.log(`   ${label.padEnd(16)} >=10: ${String(cnt(scope, 'All', a, 10)).padStart(3)}   >=20: ${String(cnt(scope, 'All', a, 20)).padStart(3)}`);
  }
}
console.log(`\n=== last52 per-surface >=10 (grass = binding constraint) ===`);
for (const surf of SURFACES) {
  const row = axes.map(([a, l]) => `${l}=${cnt('last52', surf, a, 10)}`).join('  ');
  console.log(`   ${surf.padEnd(6)} ${row}`);
}
// Under Pressure last52 All: all-4 vs 3-of-4
let up4 = 0, up3 = 0;
for (const p of rated) {
  const u = p.surfaces.All.last52.underPressure;
  if (p.surfaces.All.last52.sample.matches < 10) continue;
  if (u.rating == null) continue;
  if (u.components >= 4) up4++; else if (u.components === 3) up3++;
}
console.log(`\n=== Under Pressure last52 All (>=10 matches): all-4-present=${up4}  3-of-4-estimated=${up3} ===`);
