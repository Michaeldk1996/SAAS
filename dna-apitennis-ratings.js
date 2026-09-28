#!/usr/bin/env node
// =============================================================================
// TEN-103 — DNA ratings PURELY from api-tennis box scores (NO Sackmann/TML)
// TEN-319 — rebuilt daily by .github/workflows/dna-ratings.yml off the DEPLOYED
//           roster, with true percentiles (founder D6, 2026-09-28)
// -----------------------------------------------------------------------------
// Founder ruling: everything comes from api-tennis only. api-tennis match
// statistics exist only from 2024-03-06 onward, and that is ACCEPTED — the
// "baseline/career" scope is simply "since 2024" (sinceBase; the UI labels it
// "Since Mar 2024"); the primary radar scope is the trailing 52 weeks (last52).
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
//  computed here. It is CURRENT only (D6): one rating per surface, no scope.)
//
// INPUTS — nothing is read from an absolute path or from the committed July
// `player-profiles.json` fossil (TEN-319):
//   roster   the DEPLOYED player-profiles.json via tools/deployed-store.js. Fails
//            closed: if only the committed copy is reachable the build aborts.
//   surfaces the DEPLOYED tournament-surfaces.json (the committed copy lags the
//            pipeline's in-run refresh, so current tournaments would read null).
//   boxes    api-tennis get_fixtures tier pages, event_type_key 265, in 7-day
//            windows from 2024-03-06 to today (~135 calls; a month page is ~75 s
//            and 17 MB, a week ~5 s and 2 MB). Slimmed copies are cached under
//            .dna-boxscores/ (gitignored); CI starts empty and fetches every week.
//            Any window that still fails after a retry aborts the build.
//   elo      elo-ratings.json (committed back weekly by elo.yml, so current).
//   key      API_TENNIS_KEY (env), else an API_TENNIS_KEY line in <repo>/.env.
//
// SCOPE / SURFACE / FLOOR conventions mirror surface-ratings.js:
//   scopes  : last52 (<=364d before player's most-recent match) + sinceBase (all)
//   surfaces: Hard / Clay / Grass / All (indoor->Hard, carpet dropped — already folded
//             in tournament-surfaces.json's normalizeSurface)
//   include : > 10 matches (INCLUDE_MIN_MATCHES = 11) on All/sinceBase
//
// PERCENTILES (founder D6, 2026-09-28 — replaces the p2–p98 linear rescale):
//   `pct` is a true percentile rank, 100 × (below + ½·equal) / n, of the player's
//   rating within the STATED population for that axis × scope × surface: rated
//   players with >= POP_MIN_MATCHES matches in that scope × surface (the same
//   >= 10 floor the radar draws at) and a non-null rating. The sorted population
//   values, n and a one-line population statement are emitted in
//   _meta.percentiles / _meta.eloPercentiles so the page can rank a value the
//   file does not hold (the live Elo, the tour mean) by the same rule.
//
// TOUR LEVEL: ATP main-tour singles only (event_type 265), matching the tour-level
//   serve/return convention of the Sackmann generator and the founder's ATP-scale
//   check figures. Challenger (281) box scores are NOT folded in.
// =============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = __dirname;
const OUT = process.env.DNA_OUT || path.join(ROOT, 'dna-apitennis-ratings.json');
const BOX_DIR = process.env.DNA_BOX_DIR || path.join(ROOT, '.dna-boxscores');
const ELO_PATH = path.join(ROOT, 'elo-ratings.json');   // Tennis Abstract surface Elo (5th axis)
const API_BASE = 'https://api.api-tennis.com/tennis/';

const STATS_FLOOR = '2024-03-06';
const LAST52_DAYS = 364;
const INCLUDE_MIN_MATCHES = 11;         // > 10 matches, All/sinceBase (matches surface-ratings.js)
const POP_MIN_MATCHES = 10;             // percentile population floor = the radar's draw floor
const ROSTER_MIN = 300;                 // a deployed roster below this is a broken fetch, not a roster
const SURFACE_MAP_MIN = 5000;           // ditto for the tournament -> surface map (~10k entries)
const WINDOW_DAYS = 7;
const REFETCH_DAYS = 35;                // cached windows ending within this many days are re-fetched
const FETCH_CONCURRENCY = 6;
const SURFACES = ['Hard', 'Clay', 'Grass'];
const CAP = { clay: 'Clay', hard: 'Hard', grass: 'Grass' };

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

// ---- inputs --------------------------------------------------------------------
function apiKey() {
  if (process.env.API_TENNIS_KEY) return process.env.API_TENNIS_KEY.trim();
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, 'utf8').match(/^API_TENNIS_KEY\s*=\s*["']?([^"'\r\n]+)/m);
    if (m) return m[1].trim();
  }
  throw new Error('API_TENNIS_KEY not set (env or <repo>/.env) — cannot fetch box scores');
}

const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
const dayMs = d => new Date(d + 'T00:00:00Z').getTime();

// Fixed 7-day windows anchored on STATS_FLOOR, so a window's file name is stable
// from run to run and a local cache can be reused; the last one is clipped to today.
function weekWindows(floor, today) {
  const out = [];
  for (let t = dayMs(floor); t <= dayMs(today); t += WINDOW_DAYS * 86400000) {
    const stop = Math.min(t + (WINDOW_DAYS - 1) * 86400000, dayMs(today));
    out.push({ start: isoDay(t), stop: isoDay(stop) });
  }
  return out;
}

// Only what the ratings read, so a cached week is ~10% of the raw page.
function slimFixture(f) {
  return {
    event_key: f.event_key, event_date: f.event_date, event_status: f.event_status,
    event_type_type: f.event_type_type, tournament_key: f.tournament_key,
    first_player_key: f.first_player_key, second_player_key: f.second_player_key,
    event_winner: f.event_winner, scores: f.scores,
    statistics: Array.isArray(f.statistics) ? f.statistics.filter(s => s.stat_period === 'match') : [],
  };
}

function curlJson(url) {
  return new Promise((resolve, reject) => {
    execFile('curl', ['-sS', '--fail', '--max-time', '180', url], { maxBuffer: 512 << 20 }, (err, stdout) => {
      if (err) return reject(new Error(`curl failed (${String(err.message).split('\n')[0].replace(/APIkey=[^&\s]+/g, 'APIkey=***')})`));
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(new Error('response is not JSON')); }
    });
  });
}

// One tier page. An empty week answers {"success":1} with no `result`; a billing or
// auth failure answers HTTP 200 with an `error` key (cod 1006 = unpaid) — that must
// fail the window, never read as "no matches this week".
async function fetchWindow(key, w) {
  const url = `${API_BASE}?method=get_fixtures&event_type_key=265&date_start=${w.start}&date_stop=${w.stop}&APIkey=${encodeURIComponent(key)}`;
  const d = await curlJson(url);
  if (d && d.error && String(d.error) !== '0') {
    const r0 = Array.isArray(d.result) && d.result[0] || {};
    throw new Error(`api-tennis error ${d.error} (cod ${r0.cod}: ${r0.msg})`);
  }
  if (!d || Number(d.success) !== 1) throw new Error('api-tennis answered without success:1');
  return Array.isArray(d.result) ? d.result : [];
}

async function loadBoxScores(key, today) {
  if (!fs.existsSync(BOX_DIR)) fs.mkdirSync(BOX_DIR, { recursive: true });
  const windows = weekWindows(STATS_FLOOR, today);
  const fresh = dayMs(today) - REFETCH_DAYS * 86400000;
  const fileOf = w => path.join(BOX_DIR, `265-${w.start}_${w.stop}.json`);
  const need = windows.filter(w => !fs.existsSync(fileOf(w)) || dayMs(w.stop) >= fresh);
  const failures = [];
  let next = 0;
  async function worker() {
    while (next < need.length) {
      const w = need[next++];
      let lastErr = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const rows = await fetchWindow(key, w);
          fs.writeFileSync(fileOf(w), JSON.stringify(rows.map(slimFixture)));
          lastErr = null;
          break;
        } catch (e) { lastErr = e; }
      }
      if (lastErr) failures.push(`${w.start}..${w.stop}: ${lastErr.message}`);
    }
  }
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
  if (failures.length) {
    throw new Error(`${failures.length} of ${windows.length} box-score windows failed — refusing to rate on a partial corpus:\n  ${failures.slice(0, 5).join('\n  ')}`);
  }
  const fixtures = [];
  for (const w of windows) fixtures.push(...JSON.parse(fs.readFileSync(fileOf(w), 'utf8')));
  return { fixtures, windows: windows.length, fetched: need.length, reused: windows.length - need.length };
}

// ---- ingest ----------------------------------------------------------------------
// contribs[playerKey] = [ {date, surface, block, score} ... ]  (ATP 265 only)
function ingest(fixtures, surfaceOf) {
  const contribs = new Map();
  let fixturesSeen = 0, ingested = 0, noSurface = 0;
  const seenPM = new Set();
  for (const f of fixtures) {
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
  return { contribs, stats: { fixturesSeen, playerMatchesIngested: ingested, playerMatchesWithoutSurface: noSurface, distinctPlayersInCorpus: contribs.size } };
}

// ---- aggregate per player into scopes x surfaces -------------------------------
function ratePlayers(contribs, roster) {
  const players = [];
  for (const [pk, list] of contribs) {
    if (!roster[pk]) continue;
    // last52 anchored to the player's most-recent match date (surface-ratings.js convention)
    let latest = '';
    for (const c of list) if (c.date > latest) latest = c.date;
    const cutoffMs = latest ? dayMs(latest) - LAST52_DAYS * 86400000 : null;

    const scopes = { last52: {}, sinceBase: {} };
    for (const s of [...SURFACES, 'All']) { scopes.last52[s] = newAgg(); scopes.sinceBase[s] = newAgg(); }

    for (const c of list) {
      const inL52 = cutoffMs != null && dayMs(c.date) >= cutoffMs;
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
      name: roster[pk].name || null,
      inRoster: true,
      matchesAll: { last52: scopes.last52.All.matches, sinceBase: scopes.sinceBase.All.matches },
      latestMatch: latest,
      last52From: cutoffMs != null ? isoDay(cutoffMs) : null,
      surfaces,
    });
  }
  // keep only roster players with > 10 sinceBase-All matches (inclusion gate)
  const rated = players.filter(p => p.matchesAll.sinceBase >= INCLUDE_MIN_MATCHES);
  rated.sort((a, b) => b.matchesAll.sinceBase - a.matchesAll.sinceBase || (a.playerKey < b.playerKey ? -1 : 1));
  return rated;
}

// ===========================================================================
// 5th AXIS — Surface Elo (Tennis Abstract, elo-ratings.json). NOT computed here;
// attached per rated player, resolved by surname|firstInitial (the exact join the
// dashboard's edgeEloKey/ppEloForSurface use). Strict per-surface: a missing
// surface slot leaves that surface's Elo axis null rather than degrading to All
// (honesty — a grass Elo we don't hold is not the all-surface number).
// ===========================================================================
function eloKeyOf(name) {
  const p = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['’]/g, '').replace(/[.\-]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (p.length < 2) return null;
  return p[p.length - 1] + '|' + p[0][0];
}
const ELO_SLOT = { Hard: 'hard', Clay: 'clay', Grass: 'grass', All: 'all' };
function attachElo(rated, eloMap) {
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
  return eloResolved;
}

// ===========================================================================
// PERCENTILES (founder D6, 2026-09-28). The ratings live on 5 different scales
// (Serve ~260-305, Return ~120-170, Under Pressure ~200-275, Dominance ~0.8-1.6,
// Elo ~1400-2300), so the radar plots a percentile rank, not the raw value:
//   pctRank(v) = 100 × (#population below v + ½ × #population equal to v) / n
// The population for an axis × scope × surface is every rated player with at least
// POP_MIN_MATCHES matches in that scope × surface and a non-null rating. A player
// under the floor still gets a pct against that population (the page does not draw
// him — its floor is the same 10). Elo is current only (D6): one population per
// surface, shared by both scopes.
// ===========================================================================
function pctRank(sorted, v) {
  if (v == null || !sorted || !sorted.length) return null;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
  const below = lo;
  hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= v) lo = mid + 1; else hi = mid; }
  const equal = lo - below;
  return +(100 * (below + equal / 2) / sorted.length).toFixed(1);
}

const RATE_AXES = ['serve', 'return', 'underPressure', 'dominanceRatio'];
const SCOPE_TEXT = { last52: 'last 52 weeks', sinceBase: 'since Mar 2024' };
function assignPercentiles(rated) {
  const percentiles = {};                  // percentiles[scope][surface][axis] = {population,n,values}
  for (const scope of ['last52', 'sinceBase']) {
    percentiles[scope] = {};
    for (const s of [...SURFACES, 'All']) {
      percentiles[scope][s] = {};
      for (const ax of RATE_AXES) {
        const vals = [];
        for (const p of rated) {
          const node = p.surfaces[s][scope];
          const r = node[ax];
          if (r && r.rating != null && node.sample.matches >= POP_MIN_MATCHES) vals.push(r.rating);
        }
        vals.sort((a, b) => a - b);
        percentiles[scope][s][ax] = {
          population: `rated ATP main-tour players with >= ${POP_MIN_MATCHES} matches (${s === 'All' ? 'all surfaces' : s}, ${SCOPE_TEXT[scope]})`,
          n: vals.length,
          values: vals,
        };
        for (const p of rated) { const r = p.surfaces[s][scope][ax]; if (r && r.rating != null) r.pct = pctRank(vals, r.rating); }
      }
    }
  }
  const eloPercentiles = {};                // eloPercentiles[surface] = {population,n,values}
  for (const s of [...SURFACES, 'All']) {
    const vals = [];
    for (const p of rated) { const e = p.surfaces[s].elo; if (e && e.rating != null) vals.push(e.rating); }
    vals.sort((a, b) => a - b);
    eloPercentiles[s] = {
      population: `rated ATP main-tour players with a current Tennis Abstract ${s === 'All' ? 'overall' : s} Elo`,
      n: vals.length,
      values: vals,
    };
    for (const p of rated) { const e = p.surfaces[s].elo; if (e && e.rating != null) e.pct = pctRank(vals, e.rating); }
  }
  return { percentiles, eloPercentiles };
}

// ---- main ----------------------------------------------------------------------
async function main() {
  const t0 = Date.now();
  const store = require('./tools/deployed-store.js');
  const today = process.env.DNA_TODAY || new Date().toISOString().slice(0, 10);

  // Roster — deployed or nothing. A fresh fetch every run (maxAgeMs 0), so a day-old
  // cache in a local .deployed-cache/ cannot stand in for today's roster.
  const pp = store.playerProfiles({ maxAgeMs: 0 });
  const roster = pp.players || {};
  const rosterSize = Object.keys(roster).length;
  if (pp.source !== 'deployed') throw new Error(`roster source is '${pp.source}' (${JSON.stringify(pp.drift)}) — refusing to rate the committed July fossil`);
  if (rosterSize < ROSTER_MIN) throw new Error(`deployed roster has ${rosterSize} players (< ${ROSTER_MIN}) — refusing to publish a shrunken board`);

  // Surface map — deployed copy (the committed one lags the pipeline's refresh).
  const sm = store.fetchJson('tournament-surfaces.json', { maxAgeMs: 0 });
  const surfRaw = (sm && sm.surfaces) || null;
  if (!surfRaw || Object.keys(surfRaw).length < SURFACE_MAP_MIN) {
    throw new Error(`deployed tournament-surfaces.json unreachable or short (${surfRaw ? Object.keys(surfRaw).length : 0} entries)`);
  }
  const surfaceOf = tk => CAP[surfRaw[String(tk)]] || null;   // null => carpet/unknown -> dropped from per-surface

  const box = await loadBoxScores(apiKey(), today);
  const { contribs, stats } = ingest(box.fixtures, surfaceOf);
  const rated = ratePlayers(contribs, roster);

  const eloRaw = (() => { try { return JSON.parse(fs.readFileSync(ELO_PATH, 'utf8')); } catch (e) { return {}; } })();
  const eloResolved = attachElo(rated, eloRaw.elo || {});
  const { percentiles, eloPercentiles } = assignPercentiles(rated);

  const out = {
    _meta: {
      task: 'TEN-103 — api-tennis-native DNA ratings; TEN-319 — daily rebuild off the deployed roster, true percentiles',
      generatedAt: new Date().toISOString(),
      source: `api-tennis box scores, ATP main-tour singles (event_type 265), ${STATS_FLOOR}..${today} — NO Sackmann/TML`,
      scopes: { last52: `matches within ${LAST52_DAYS}d of player's most-recent match (last52From..latestMatch)`, sinceBase: `all data since ${STATS_FLOOR} (shown as "Since Mar 2024")` },
      surfaces: 'Hard/Clay/Grass/All; indoor->Hard, carpet->dropped (via tournament-surfaces.json normalizeSurface)',
      inclusion: `deployed-roster player with > 10 (>=${INCLUDE_MIN_MATCHES}) sinceBase-All matches`,
      lockedFormulas: {
        serve: '%1stIn + %1stWon + %2ndWon + hold% + acesPerMatch − DFPerMatch (aces/DF raw per-match)',
        return: '%1stReturnWon + %2ndReturnWon + %returnGamesWon + %BPconverted',
        underPressure: '%BPsaved + %BPconverted + %tiebreaksWon + %decidingSetsWon (4-sum; 3-of-4 -> mean*4 estimated:true; <3 -> null)',
        dominanceRatio: 'returnPtsWon% / (100 − servicePtsWon%)',
      },
      roster: { source: pp.source, fetchedAt: pp.fetchedAt || null, players: rosterSize },
      rosterSize,
      ratedPlayers: rated.length,
      eloResolved,
      radarAxes: ['serve', 'return', 'underPressure', 'dominanceRatio', 'elo (Surface Elo, current only)'],
      pctMethod: `true percentile rank: 100 × (below + ½·equal) / n within the (axis × scope × surface) population — rated players with >= ${POP_MIN_MATCHES} matches in that scope × surface; Elo: rated players with that surface's current Elo`,
      popMinMatches: POP_MIN_MATCHES,
      percentiles,      // percentiles[scope][surface][rateAxis] = {population, n, values (ascending)}
      eloPercentiles,   // eloPercentiles[surface] = {population, n, values}  (Surface Elo is current only)
      ingest: Object.assign({ windows: box.windows, windowsFetched: box.fetched, windowsReused: box.reused }, stats),
      wallClockMs: Date.now() - t0,
    },
    players: rated,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));

  // ---- coverage report ---------------------------------------------------------
  const cnt = (scope, surf, axis, min) => rated.filter(p => {
    const node = p.surfaces[surf][scope];
    return node.sample.matches >= min && node[axis] && node[axis].rating != null;
  }).length;
  console.log(`\nWROTE ${path.relative(ROOT, OUT)} — roster ${rosterSize} (deployed ${pp.fetchedAt}), rated ${rated.length}, Elo ${eloResolved}`);
  console.log(JSON.stringify(out._meta.ingest));
  for (const scope of ['last52', 'sinceBase']) {
    console.log(`-- ${scope}: population n (>=${POP_MIN_MATCHES} matches) --`);
    for (const s of [...SURFACES, 'All']) {
      console.log(`   ${s.padEnd(6)} ` + RATE_AXES.map(a => `${a}=${cnt(scope, s, a, POP_MIN_MATCHES)}`).join('  '));
    }
  }
}

module.exports = {
  pctRank, assignPercentiles, weekWindows, slimFixture, ingest, ratePlayers,
  statBlock, scoreOutcome, computeRatings, POP_MIN_MATCHES, INCLUDE_MIN_MATCHES,
};

if (require.main === module) {
  main().catch((e) => { console.error(`dna-apitennis-ratings: ${e.message}`); process.exit(1); });
}
