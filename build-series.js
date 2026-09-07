#!/usr/bin/env node
/**
 * build-series.js — TEN-168 Series page data layer.
 *
 * Current streaks for players scheduled TODAY / TOMORROW: consecutive wins or
 * losses (a) against a playing style, (b) on a surface, (c) straight across all
 * competitions, or (d) a derived first-set pattern line. Losing streaks are kept
 * too — they trade the other way. Shares the Trading Report's foundations
 * verbatim so a later merge is wiring, not a rewrite:
 *   - match source : fetchRecentSinglesFixtures (bsp-pipeline.js) — the SAME 5yr
 *                    get_fixtures window recent-form already pays for.
 *   - tier split   : tierOf() on event_type_type ("Atp Singles" => tour,
 *                    "Challenger Men Singles" => chal). Tiers are NEVER blended
 *                    into one streak; the row shows its tier.
 *   - score engine : trading-sequence-metrics.setsFromScores() for the first-set
 *                    line (#4).
 *   - surface map  : tournament-surfaces.json by tournament_key.
 *   - taxonomy     : playing-styles.json (Tour), name-joined to opponent names.
 *
 * FOUNDER RULES — TEN-168 gate, answered 2026-09-07 (quoted, not recalled):
 *   minLen  = 3                    (minimum streak length to display)
 *   maxAge  = 45 days on the streak's MOST-RECENT match, EXEMPT when that match
 *             was a Grand Slam ("45 days for all events but no age cap on Grand
 *             Slams").
 *   minPool = conditional types (style / surface / pattern) pool >= 8;
 *             all-competitions has NO extra floor (the run is its own pool).
 *   retire  = SKIP — a Retired / Walk Over result does not count and does not
 *             break a streak: it is excluded from the sequence entirely.
 *   #1 vs-style scope = TOUR ONLY. Challenger is unavailable for this type
 *             (its taxonomy is a 2018-2024 archive that misses the live field).
 *
 * NON-NEGOTIABLES (founder): every streak carries (1) the POOL it was drawn from
 * and (2) the DATE + age of its most-recent match. A streak missing either is
 * not emitted. Missing data is an omission, never a zero.
 *
 * SCOPE: ATP + Challenger men's singles only. Read-only — writes ONLY series.json.
 * Touches none of the four core JSON files, the Trading Report, the ten141 cron,
 * the Live gate, or the entry-lists workstream.
 */
'use strict';

const fs = require('fs');
const path = require('path');
try { require('dotenv').config({ quiet: true }); } catch (_) { /* optional */ }

const { fetchRecentSinglesFixtures } = require('./bsp-pipeline.js');
const { setsFromScores } = require('./trading-sequence-metrics.js');

const ROOT = process.env.SERIES_ROOT || __dirname;
const SURFACES_FILE = path.join(ROOT, 'tournament-surfaces.json');
const PROFILES_FILE = path.join(ROOT, 'player-profiles.json');
const STYLES_FILE = path.join(ROOT, 'playing-styles.json');
const OUT_FILE = process.env.SERIES_OUT || path.join(ROOT, 'series.json');

const API_TENNIS_KEY = process.env.API_TENNIS_KEY;
const API_TENNIS_BASE = 'https://api.api-tennis.com/tennis/';

// ── founder-ruled thresholds (do not read these from memory — they are the
//    2026-09-07 gate answers, encoded here as the single source of truth) ──────
//
// ENGINE EMIT FLOOR vs VIEW FLOOR (founder 2026-09-07, v2 ruling):
//   "ALWAYS-ON LENGTH FLOOR: 5 ... Keep the min-length buttons on the page and
//    let them go below the floor. The floor sets the default view, not a ceiling."
// So the engine EMITS everything from length 3 up (MIN_LEN), and the front-end's
// min-length button defaults to the VIEW FLOOR of 5 (vs-style exempt at 3) but can
// be dropped below it. Emitting at 3 is what lets the buttons reveal shorter runs.
const MIN_LEN = 3;                 // engine emit floor (lowest a page button reaches)
const VIEW_FLOOR_DEFAULT = 5;      // default front-end floor for every type ...
const VIEW_FLOOR_STYLE = 3;        // ... except vs-style, which the founder set at 3
const MAX_AGE_DAYS = 45;
// Intra-streak max gap (TEN-168 fix #2, founder ruling 2026-09-07: option g75 =
// 75 days). MAX_AGE_DAYS only checks the streak's MOST-RECENT match; it cannot see
// a layoff buried inside the run. A gap longer than this between two consecutive
// matches of a run splits it into separate periods (an injury/off-season break is
// not momentum), so the run is CUT at that gap and only the recent portion counts.
// 75d (over the founder's 60d instinct) so the ~7-9 week ATP off-season does not by
// itself split otherwise-continuous runs.
const MAX_GAP_DAYS = 75;
const MIN_POOL_CONDITIONAL = 8;    // style / surface / pattern / all new line+pattern types
// all-competitions: no extra pool floor (the run is its own pool).

// ── LINE SETS (founder 2026-09-07 "approved as proposed"; never blend best-of) ──
// bo3 total-games lines were approved verbatim. The bo5 total set and the
// first-set-total line were "finalise the exact numbers on a best-of-split
// distribution once you approve" — so they are computed FRESH from this run's own
// history (see picklines dump) and pinned here, never quoted from memory.
const TOTAL_LINES_BO3 = [21.5, 22.5, 23.5];
// bo5 total set — pinned from the 2026-09-07 best-of-split distribution (n=400,
// US-Open-era slate history): median 37, coin flip ≈ 36.5. This triple mirrors the
// bo3 spacing (over-rates 50.8% / 42.8% / 35.5%, vs bo3's 50% / 43% / 38%).
const TOTAL_LINES_BO5 = [36.5, 38.5, 40.5];
// Game-handicap lines (founder: "±1.5 / 3.5 / 5.5"), computed per best-of so a bo3
// margin and a bo5 margin are never blended into one run.
const HANDICAP_LINES = [1.5, 3.5, 5.5];
// First-set total line — the first set is structurally identical across best-of
// (6 games, tiebreak at 6-6), so this ONE line is format-invariant and is NOT
// best-of split. Pinned from the first-set distribution near the coin flip.
const FIRST_SET_LINE = 9.5;

const PACE_MS = Number(process.env.SERIES_PACE_MS || 150);
const MAX_PLAYERS = process.env.SERIES_MAX_PLAYERS ? Number(process.env.SERIES_MAX_PLAYERS) : Infinity;

// Reproducible "now" for backtests: SERIES_NOW=YYYY-MM-DD. Default = real today.
const NOW = process.env.SERIES_NOW ? new Date(process.env.SERIES_NOW + 'T00:00:00Z') : new Date();
const DAY_MS = 86400000;
function ymd(d) { return d.toISOString().slice(0, 10); }
const TODAY_STR = ymd(NOW);
const TOMORROW_STR = ymd(new Date(NOW.getTime() + DAY_MS));
// Slate fetch window: today .. today+2 (a 2-day tag window, +1 day of slack for
// the account-timezone offset the feed applies to event_date). Only rows tagged
// today/tomorrow are kept.
const SLATE_START = TODAY_STR;
const SLATE_STOP = ymd(new Date(NOW.getTime() + 2 * DAY_MS));

const FINAL_STATUSES = ['Finished', 'Retired', 'Walk Over'];
const SURFACES = ['hard', 'clay', 'grass'];

// Grand Slam detection for the age-cap exemption. The four Slams, by the feed's
// tournament_name. Slam events are Tour-tier only.
const SLAM_RE = /\b(australian open|french open|roland[\s-]?garros|wimbledon|us open)\b/i;
function isSlam(fx) { return SLAM_RE.test(String(fx.tournament_name || '')); }

// Best-of of an UPCOMING fixture (no scores yet, so it can't be read from sets —
// it is a property of the event). In the current men's game best-of-five is the
// Grand Slam MAIN DRAW only; every other tour event, all Challengers, and Slam
// QUALIFYING (event_qualification === "True", which is bo3) are best-of-three.
// This is what the FORMAT-RELEVANCE gate (founder 2026-09-07) compares a games-line
// streak's own best-of against: a bo3 total never renders on a bo5 match.
function upcomingBestOf(fx) {
  if (tierOf(fx) === 'tour' && isSlam(fx) && String(fx.event_qualification) !== 'True') return 5;
  return 3;
}

// Tier from event_type_type (get_fixtures carries no event_type_key).
function tierOf(fx) {
  const t = String(fx.event_type_type || '');
  if (t === 'Atp Singles') return 'tour';
  if (t === 'Challenger Men Singles') return 'chal';
  return null;
}

function sideOf(fx, playerKey) {
  const pk = String(playerKey);
  if (String(fx.first_player_key) === pk) return 'first';
  if (String(fx.second_player_key) === pk) return 'second';
  return null;
}
// Did `me` win? null if the feed carries no clean winner (=> not countable).
function matchWinner(fx, me) {
  const w = fx.event_winner;
  if (w === 'First Player') return me === 'first';
  if (w === 'Second Player') return me === 'second';
  return null;
}

function loadJson(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }

function loadSurfaceMap() {
  const j = loadJson(SURFACES_FILE);
  return j.surfaces || {};
}

// name -> archetype label, Tour taxonomy only (vs-style is Tour-only per ruling).
// Names are in "C. Alcaraz" (initial. surname) format on BOTH sides — the feed's
// event_first/second_player and the taxonomy's `name` — so a normalized exact
// join is honest. No fuzzy guessing: an unmatched opponent is simply unclassified
// and is skipped from vs-style sequences (never counted, never breaks a run).
function normName(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function loadStyleMap() {
  const j = loadJson(STYLES_FILE);
  const list = Array.isArray(j.players) ? j.players : [];
  const m = new Map();
  for (const p of list) {
    if (!p || !p.name || !p.archetype_label) continue;
    m.set(normName(p.name), String(p.archetype_label));
  }
  return m;
}

// Identity map (name/rank/country) keyed by player_key, from the committed
// player-profiles.json — the same join the Trading Report uses. Only the row
// fields; the 44MB profile bodies never reach the client.
function loadMeta() {
  const j = loadJson(PROFILES_FILE);
  const players = j.players || {};
  const list = Array.isArray(players) ? players : Object.values(players);
  const meta = {};
  for (const p of list) {
    if (!p || p.key == null) continue;
    meta[String(p.key)] = {
      name: p.name != null ? String(p.name) : null,
      rank: (typeof p.rank === 'number') ? p.rank
        : (p.rank != null && Number.isFinite(Number(p.rank)) ? Number(p.rank) : null),
      country: p.country != null ? String(p.country) : null,
    };
  }
  return meta;
}

async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j && j.success === 0) throw new Error(`api error: ${JSON.stringify(j.result || j).slice(0, 120)}`);
  return Array.isArray(j.result) ? j.result : [];
}

// ── slate: every ATP + Challenger singles fixture today/tomorrow. One get_fixtures
//    date-range call, NO event_type_key filter (that would drop Challenger). ─────
async function fetchSlate() {
  const url = `${API_TENNIS_BASE}?method=get_fixtures&APIkey=${API_TENNIS_KEY}&date_start=${SLATE_START}&date_stop=${SLATE_STOP}`;
  const rows = await apiGet(url);
  const out = [];
  for (const fx of rows) {
    const tier = tierOf(fx);
    if (!tier) continue;                         // ATP/Challenger singles only
    const d = String(fx.event_date || '');
    const day = d === TODAY_STR ? 'today' : d === TOMORROW_STR ? 'tomorrow' : null;
    if (!day) continue;
    out.push({ fx, tier, day });
  }
  return out;
}

// Human-readable per-set score line, player POV, tiebreak-aware. Reads fx.scores
// directly (NOT setsFromScores, which truncates the tiebreak decimal that trading
// metrics don't need — we do). api-tennis encodes a tiebreak set as "7.7"/"6.5":
// the integer part is games (7 and 6), the STRING fractional part is the tiebreak
// points (7 and 5). Parse the fractional part from the string, not via Number, so a
// two-digit tiebreak like "6.10" reads 10 (a Number-based .10*10 would give 1). We
// render the set "7-6(5)" — the parenthetical is the loser's tiebreak points, the
// standard scoreboard convention. A plain set is "6-4". Blank/unplayed sets are
// skipped; when no set carries games the line is null (a dash, never a guess).
function scoreLineFor(fx, me) {
  const arr = Array.isArray(fx.scores) ? fx.scores : [];
  const cells = arr
    .filter(s => Number.isFinite(Number(s.score_set)) && Number(s.score_set) >= 1)
    .sort((a, b) => Number(a.score_set) - Number(b.score_set))
    .map(s => {
      const fs = String(s.score_first).trim(), ss = String(s.score_second).trim();
      const ai = Math.trunc(Number(fs)), bi = Math.trunc(Number(ss));
      if (!Number.isFinite(ai) || !Number.isFinite(bi)) return null;
      if (ai + bi === 0) return null;                       // blank/unplayed set
      const mineG = me === 'first' ? ai : bi;
      const theirsG = me === 'first' ? bi : ai;
      // tiebreak points live in the string fractional part; present on both sides
      // for a tiebreak set, absent for a plain set.
      const tb = str => { const d = str.split('.')[1]; return d != null && d !== '' ? parseInt(d, 10) : null; };
      const tbF = tb(fs), tbS = tb(ss);
      let cell = mineG + '-' + theirsG;
      if (Number.isFinite(tbF) && Number.isFinite(tbS)) cell += '(' + Math.min(tbF, tbS) + ')';
      return cell;
    })
    .filter(Boolean);
  return cells.length ? cells.join(' ') : null;
}

// One completed, countable, in-tier match reduced to a streak record. Returns
// null when the match is not countable (wrong tier, not Finished, no winner, or
// a Retired/Walk Over that must be SKIPPED per the ruling).
function recordFor(fx, playerKey, tier, surfaceMap, styleMap, includeStyle) {
  if (tierOf(fx) !== tier) return null;
  if (fx.event_status !== 'Finished') return null;   // Retired/Walk Over => skip
  const me = sideOf(fx, playerKey);
  if (!me) return null;
  const won = matchWinner(fx, me);
  if (won == null) return null;                      // no clean winner => skip
  const d = String(fx.event_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  if (d > TODAY_STR) return null;                    // never leak future fixtures

  const surf = surfaceMap[String(fx.tournament_key)] || null;
  const surface = SURFACES.includes(surf) ? surf : null;

  // ── score-derived match facts (all from scores[], tiebreak-aware) ────────────
  // First-set outcome. null when set 1 is undecided/blank (short formats,
  // walkovers) — then any set-1 line is undefined for this match and it is
  // excluded from that line's pool (a dash, never a guess).
  const sets = setsFromScores(fx, me);
  const s1 = sets[1];
  const lostSet1 = (s1 && s1.decided) ? !s1.won : null;
  const set1Total = (s1 && s1.decided) ? (s1.mine + s1.theirs) : null;
  const s2 = sets[2];
  const wonSet2 = (s2 && s2.decided) ? s2.won : null;

  // Walk the decided sets to recover best-of, straight/distance, and clean games.
  const setNums = Object.keys(sets).map(Number).sort((a, b) => a - b);
  let setsWonMe = 0, setsWonOpp = 0, gamesMe = 0, gamesOpp = 0;
  let decidedCount = 0, anyPlayedUndecided = false, superTb = false;
  for (const n of setNums) {
    const s = sets[n];
    if (s.played && !s.decided) anyPlayedUndecided = true;
    if (!s.decided) continue;
    decidedCount++;
    // A set where a side reached >=10 games is a match/super-tiebreak, not real
    // games — its "games" are not countable. Founder: super-tiebreak deciders dash
    // rather than being guessed.
    if (s.mine >= 10 || s.theirs >= 10) superTb = true;
    if (s.won) setsWonMe++; else setsWonOpp++;
    gamesMe += s.mine; gamesOpp += s.theirs;
  }
  // best-of from the winner's set count (only completed matches reach here, so the
  // winner has hit the format target): 2 sets => bo3, 3 sets => bo5.
  const winnerSets = won ? setsWonMe : setsWonOpp;
  const totalDecided = setsWonMe + setsWonOpp;
  let bestOf = null;
  if (winnerSets === 2 && totalDecided <= 3) bestOf = 3;
  else if (winnerSets === 3 && totalDecided <= 5) bestOf = 5;

  // Clean games (for total-games & handicap): need a known best-of, no super-tb,
  // no played-but-undecided set, and a decided-set count valid for the format.
  const validCount = bestOf === 3 ? (decidedCount === 2 || decidedCount === 3)
    : bestOf === 5 ? (decidedCount >= 3 && decidedCount <= 5)
    : false;
  const cleanGames = bestOf != null && !superTb && !anyPlayedUndecided && validCount;
  const totalGames = cleanGames ? (gamesMe + gamesOpp) : null;
  const gameMargin = cleanGames ? (gamesMe - gamesOpp) : null;   // + = won by, − = lost by

  // Set-pattern facts (need a known best-of and no mid-match undecided set).
  const setShapeOk = bestOf != null && !anyPlayedUndecided;
  const loserSets = won ? setsWonOpp : setsWonMe;
  const straightResult = setShapeOk ? (loserSets === 0) : null;    // decisive (0-drop)
  const wentDistance = setShapeOk ? (decidedCount === bestOf) : null;
  const wonASet = setShapeOk ? (setsWonMe >= 1) : null;

  // Games score line for the detail panel (founder 2026-09-07: "the set scores as
  // played, e.g. 6-4 3-6 7-5, with tiebreak scores where they occurred"). Per-set
  // games from the player's POV — NOT event_final_result, which is only the set
  // tally ("3 - 2"). See scoreLineFor(): api-tennis encodes a tiebreak set as
  // "7.7"/"6.5" (integer = games, string decimal = tiebreak points) and we render
  // it "7-6(5)". Played sets in order; the whole line dashes (null) when scores[]
  // carries no games — never a guess.
  const scoreLine = scoreLineFor(fx, me);

  // Opponent name (always — the clickable detail panel needs it) and archetype
  // (Tour only; unmatched => null / unclassified).
  const oppName = me === 'first' ? fx.event_second_player : fx.event_first_player;
  let oppArch = null;
  if (includeStyle) {
    oppArch = styleMap.get(normName(oppName)) || null;
  }

  return {
    date: d,
    eventKey: String(fx.event_key || ''),
    won,
    surface,
    opponent: String(oppName || ''),
    score: scoreLine,   // per-set games line (player POV), dash when unavailable
    lostSet1,
    set1Total,
    wonSet2,
    bestOf,
    totalGames,
    gameMargin,
    straightResult,
    wentDistance,
    wonASet,
    oppArch,
    isSlam: isSlam(fx),
    tournament: String(fx.tournament_name || ''),
  };
}

// Countable records for one player in one tier, ordered oldest -> newest, event
// deduped. Retirements/walkovers already excluded by recordFor (skip, no break).
function orderedRecords(fixtures, playerKey, tier, surfaceMap, styleMap, includeStyle) {
  const seen = new Set();
  const recs = [];
  for (const fx of fixtures) {
    const r = recordFor(fx, playerKey, tier, surfaceMap, styleMap, includeStyle);
    if (!r) continue;
    if (r.eventKey && seen.has(r.eventKey)) continue;
    if (r.eventKey) seen.add(r.eventKey);
    recs.push(r);
  }
  recs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (Number(a.eventKey) - Number(b.eventKey))));
  return recs;
}

// Tail win/loss run of a sub-sequence (already filtered + ordered). Returns the
// consecutive same-outcome run ending at the most-recent match.
function tailRun(seq) {
  if (!seq.length) return null;
  const last = seq[seq.length - 1];
  let count = 0;
  for (let i = seq.length - 1; i >= 0; i--) {
    if (seq[i].won === last.won) count++; else break;
  }
  // members = the run's own matches, oldest -> newest (drives the clickable detail).
  return { direction: last.won ? 'win' : 'loss', count, last, members: seq.slice(seq.length - count) };
}

// General state-run helper for the pattern/line types. stateFn(rec) returns a
// state string, or null to EXCLUDE the match from this pattern entirely (skipped
// like a retirement: it neither counts nor breaks the run, and is not in the pool).
// Returns the tail run of the most-recent state — but ONLY when that state is one
// the type wants to emit (emitStates). A run whose last match sits in a
// non-tradeable state (e.g. a competitive result under 'straight sets', or a games
// total inside a handicap band) is simply not a current streak.
function tailStateRun(seq, stateFn, emitStates) {
  const dom = [];
  for (const r of seq) { const s = stateFn(r); if (s != null) dom.push({ r, s }); }
  if (!dom.length) return null;
  const target = dom[dom.length - 1].s;
  if (emitStates && !emitStates.has(target)) return null;
  let count = 0;
  for (let i = dom.length - 1; i >= 0; i--) { if (dom[i].s === target) count++; else break; }
  return { state: target, count, pool: dom.length, last: dom[dom.length - 1].r, members: dom.slice(dom.length - count).map(x => x.r) };
}

function ageDaysOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return Math.floor((NOW.getTime() - d.getTime()) / DAY_MS);
}

// Apply the recency rule: age <= 45d, OR the most-recent match was a Grand Slam.
function recencyOk(last) {
  const age = ageDaysOf(last.date);
  return { ok: age <= MAX_AGE_DAYS || last.isSlam, age, slamExempt: last.isSlam && age > MAX_AGE_DAYS };
}

// Intra-streak gap cut (TEN-168 fix #2). members are oldest -> newest. Walk back
// from the most-recent match and cut at the first gap that exceeds MAX_GAP_DAYS:
// everything before that layoff belongs to a separate period and is dropped, so
// only the run since the last such gap survives. Returns the recent slice plus,
// when a cut happened, the offending gap and the pre-cut length (for transparency).
function cutOnGap(members) {
  if (!members || members.length < 2) return { members: members || [], cut: false, gapDays: null, fullLen: (members || []).length };
  let cutIdx = 0, gapDays = null;
  for (let i = members.length - 1; i >= 1; i--) {
    const g = Math.floor((new Date(members[i].date + 'T00:00:00Z') - new Date(members[i - 1].date + 'T00:00:00Z')) / DAY_MS);
    if (g > MAX_GAP_DAYS) { cutIdx = i; gapDays = g; break; }
  }
  return { members: members.slice(cutIdx), cut: cutIdx > 0, gapDays, fullLen: members.length };
}

function mkStreak(base, run, pool, poolFloor, minLen) {
  // Cut the run at any internal layoff > MAX_GAP_DAYS BEFORE the length gate, so a
  // run that only survives in a short recent tail is judged on that tail, not on the
  // full pre-layoff length. The pool (the denominator) is the eligible universe and
  // is NOT re-cut — "5 of 210" stays honest.
  const gc = cutOnGap(run.members || []);
  const members = gc.members;
  const count = members.length;
  const last = count ? members[count - 1] : run.last;
  if (count < (minLen != null ? minLen : MIN_LEN)) return null;
  if (poolFloor != null && pool < poolFloor) return null;
  const rec = recencyOk(last);
  if (!rec.ok) return null;
  // The run's own matches (oldest -> newest), for the clickable detail panel: the
  // actual games the streak is made of — date, opponent, tournament, surface, and
  // the score line that satisfied the condition.
  const matches = members.map(r => ({
    date: r.date,
    opponent: r.opponent || null,
    tournament: r.tournament || null,
    surface: r.surface || null,
    score: r.score || null,
    won: r.won,
  }));
  return Object.assign({
    count,
    pool,
    lastDate: last.date,
    ageDays: rec.age,
    slamExempt: rec.slamExempt,
    lastTournament: last.tournament,
    // present only when a layoff split the run; carries the offending gap and the
    // pre-cut length so the front-end can show the run was trimmed, not fabricated.
    gapCut: gc.cut ? { atGapDays: gc.gapDays, fullRunLength: gc.fullLen } : null,
    matches,
  }, base);
}

// ── config-driven streak types: new types slot in here without restructuring ──
// Each returns an array of streak objects for the given ordered records + tier.
const STREAK_TYPES = [
  {
    id: 'all',
    build(recs) {
      const run = tailRun(recs);
      if (!run) return [];
      // all-competitions: no extra pool floor. The pool is the FULL in-tier
      // countable history (recs.length), NOT the run length — a run's own length as
      // its pool is 100% by construction and tells a member nothing (founder
      // 2026-09-07). Reporting the true denominator ("5 of 210") is the honest fix;
      // suppressing the line would read as missing data.
      const s = mkStreak({ type: 'all', family: 'all', subtype: null, direction: run.direction }, run, recs.length, null);
      return s ? [s] : [];
    },
  },
  {
    id: 'surface',
    build(recs) {
      // Emits from MIN_LEN (3) up; the surface VIEW FLOOR of 5 is applied by the
      // front-end so the min-length buttons can reveal shorter surface runs.
      const out = [];
      for (const surf of SURFACES) {
        const seq = recs.filter(r => r.surface === surf);
        const run = tailRun(seq);
        if (!run) continue;
        const s = mkStreak({ type: 'surface', family: 'surface', subtype: surf, direction: run.direction }, run, seq.length, MIN_POOL_CONDITIONAL);
        if (s) out.push(s);
      }
      return out;
    },
  },
  {
    id: 'style',
    tourOnly: true,                              // Challenger unavailable (ruling)
    build(recs) {
      const out = [];
      const archs = new Set(recs.map(r => r.oppArch).filter(Boolean));
      for (const arch of archs) {
        const seq = recs.filter(r => r.oppArch === arch);
        const run = tailRun(seq);
        if (!run) continue;
        const s = mkStreak({ type: 'style', family: 'style', subtype: arch, direction: run.direction }, run, seq.length, MIN_POOL_CONDITIONAL);
        if (s) out.push(s);
      }
      return out;
    },
  },
  {
    id: 'pattern',
    build(recs) {
      // First-set OUTCOME (won/lost the opening set). EXACT, score-only. Pool =
      // matches with a decided set 1. This is the "existing always-on" set-outcome
      // line — kept its own family so it isn't collapsed into the new set-patterns.
      const run = tailStateRun(
        recs, r => r.lostSet1 == null ? null : (r.lostSet1 ? 'lost1' : 'won1'), FIRSTSET_STATES);
      if (!run) return [];
      const lost = run.state === 'lost1';
      const subtype = lost ? 'lost-first-set' : 'won-first-set';
      const direction = lost ? 'loss' : 'win';   // slow starter vs fast starter
      const s = mkStreak({ type: 'pattern', family: 'firstset', subtype, direction }, run, run.pool, MIN_POOL_CONDITIONAL);
      return s ? [s] : [];
    },
  },

  // ── v2 betting-line & score-pattern types (founder 2026-09-07: "build the lot").
  //    All match-agnostic (always relevant). Best-of is NEVER blended: total-games
  //    and handicap runs are computed per best-of; the set-shape patterns encode
  //    best-of in their own boolean, so a bo3 and a bo5 never share a run. ─────────
  {
    id: 'total',
    build(recs) {
      const out = [];
      for (const bo of [3, 5]) {
        const lines = bo === 3 ? TOTAL_LINES_BO3 : TOTAL_LINES_BO5;
        const boRecs = recs.filter(r => r.bestOf === bo && r.totalGames != null);
        for (const L of lines) {
          const run = tailStateRun(boRecs, r => (r.totalGames > L ? 'over' : 'under'), OVER_UNDER);
          if (!run) continue;
          const over = run.state === 'over';
          const s = mkStreak({
            type: 'total', family: 'total',
            subtype: (over ? 'over-' : 'under-') + L + '-bo' + bo,
            direction: over ? 'win' : 'loss', line: L, bestOf: bo, over,
          }, run, run.pool, MIN_POOL_CONDITIONAL);
          if (s) out.push(s);
        }
      }
      return out;
    },
  },
  {
    id: 'handicap',
    build(recs) {
      const out = [];
      for (const bo of [3, 5]) {
        const boRecs = recs.filter(r => r.bestOf === bo && r.gameMargin != null);
        for (const h of HANDICAP_LINES) {
          // covered −h: won by more than h games. lost +h: beaten by more than h.
          // The band in between is 'mid' (breaks a run, not tradeable at this line).
          const run = tailStateRun(boRecs,
            r => (r.gameMargin > h ? 'coverMinus' : (r.gameMargin < -h ? 'failPlus' : 'mid')),
            HANDICAP_STATES);
          if (!run) continue;
          const cover = run.state === 'coverMinus';
          const s = mkStreak({
            type: 'handicap', family: 'handicap',
            subtype: (cover ? 'cover-minus-' : 'lost-plus-') + h + '-bo' + bo,
            direction: cover ? 'win' : 'loss', line: h, bestOf: bo, cover,
          }, run, run.pool, MIN_POOL_CONDITIONAL);
          if (s) out.push(s);
        }
      }
      return out;
    },
  },
  {
    id: 'setpat',
    build(recs) {
      const out = [];
      const push = (run, baseFn) => {
        if (!run) return;
        const s = mkStreak(Object.assign({ family: 'setpat' }, baseFn(run)), run, run.pool, MIN_POOL_CONDITIONAL);
        if (s) out.push(s);
      };
      // won / lost the 2nd set
      push(
        tailStateRun(recs, r => (r.wonSet2 == null ? null : (r.wonSet2 ? 'won2' : 'lost2')), WON2_STATES),
        run => run.state === 'won2'
          ? { type: 'setpat', subtype: 'won-2nd-set', direction: 'win' }
          : { type: 'setpat', subtype: 'lost-2nd-set', direction: 'loss' });
      // straight-sets win (0-drop) vs straight-sets loss (blown out). A competitive
      // (non-straight) decisive result breaks either run.
      push(
        tailStateRun(recs, r => {
          if (r.straightResult == null) return null;
          if (!r.straightResult) return 'competitive';
          return r.won ? 'straightWin' : 'straightLoss';
        }, STRAIGHT_STATES),
        run => run.state === 'straightWin'
          ? { type: 'setpat', subtype: 'straight-sets-win', direction: 'win' }
          : { type: 'setpat', subtype: 'straight-sets-loss', direction: 'loss' });
      // went the distance (reached the deciding set). Only the affirmative side is a
      // signal — this is literally "went the distance". The negative ("decided
      // early") conflates a dominant win with a dominant loss into one run, so it is
      // not emitted (a 'short' match still breaks a distance run). Direction is
      // 'win' only as a display polarity — the card reads as a volatility/totals
      // angle, not a result.
      push(
        tailStateRun(recs, r => (r.wentDistance == null ? null : (r.wentDistance ? 'dist' : 'short')), DIST_STATES),
        () => ({ type: 'setpat', subtype: 'went-the-distance', direction: 'win' }));
      // "won a set" — ONLY the negative side is a signal: consecutive matches
      // winning ZERO sets (a losing spiral). The affirmative side ("won ≥1 set") is
      // trivially satisfied by any match win and would dominate the collapsed
      // set-patterns card without informing — reported to the founder as his to
      // re-enable, not shipped as a dead/dominating type.
      push(
        tailStateRun(recs, r => (r.wonASet == null ? null : (r.wonASet ? 'wonSet' : 'noSet')), NOSET_STATES),
        () => ({ type: 'setpat', subtype: 'no-set-won', direction: 'loss' }));
      // first-set total over / under (format-invariant single line)
      push(
        tailStateRun(recs.filter(r => r.set1Total != null),
          r => (r.set1Total > FIRST_SET_LINE ? 'over' : 'under'), OVER_UNDER),
        run => run.state === 'over'
          ? { type: 'setpat', subtype: 'first-set-over-' + FIRST_SET_LINE, direction: 'win', line: FIRST_SET_LINE, firstSet: true, over: true }
          : { type: 'setpat', subtype: 'first-set-under-' + FIRST_SET_LINE, direction: 'loss', line: FIRST_SET_LINE, firstSet: true, over: false });
      return out;
    },
  },
];

// emit-state sets for the pattern/line types (module-level, shared by the builders)
const OVER_UNDER = new Set(['over', 'under']);
const HANDICAP_STATES = new Set(['coverMinus', 'failPlus']);
const WON2_STATES = new Set(['won2', 'lost2']);
const STRAIGHT_STATES = new Set(['straightWin', 'straightLoss']);
const DIST_STATES = new Set(['dist']);   // only the affirmative "went the distance" side
const NOSET_STATES = new Set(['noSet']);
const FIRSTSET_STATES = new Set(['won1', 'lost1']);

// One card per player per FAMILY (founder 2026-09-07): a player shows at most one
// streak per family, their LONGEST current run in it (ties → the sturdier, bigger
// pool). Families: total games, handicap, set patterns, and the existing types
// (all-competitions, first-set outcome, surface, vs-style) each keep their own card.
function collapseByFamily(streaks) {
  const best = new Map();
  for (const st of streaks) {
    const fam = st.family || st.type;
    const cur = best.get(fam);
    if (!cur
      || st.count > cur.count
      || (st.count === cur.count && (st.pool || 0) > (cur.pool || 0))) {
      best.set(fam, st);
    }
  }
  return [...best.values()];
}

function streaksFor(recs, tier) {
  const out = [];
  for (const t of STREAK_TYPES) {
    if (t.tourOnly && tier !== 'tour') continue;
    for (const s of t.build(recs)) out.push(s);
  }
  return out;
}

// ── RELEVANCE (founder ruling 2026-09-07) ────────────────────────────────────
// A streak renders ONLY if its condition bears on the upcoming match. A backward-
// looking run that doesn't apply to what the player plays next is noise either way
// — it is dropped here, never shown with a caveat.
//   all / pattern(first-set outcome) : match-agnostic → always relevant.
//   setpat (won 1st/2nd set, straight sets, went the distance, no set won,
//           first-set games total) : FORMAT-AGNOSTIC set-shape events — the same
//           event either way, so they carry across best-of (founder 2026-09-07).
//   total / handicap : FORMAT-LOCKED. A games-line run is built on one best-of and
//           only bears on the upcoming match when that match is the SAME format.
//           A bo3 total never renders on a bo5 match (the Zverev US-Open case),
//           and vice-versa. Upcoming best-of comes from upcomingBestOf(fx).
//   surface : only if the upcoming match is on that surface.
//   style   : only if the upcoming opponent is classified as that EXACT archetype.
//             Opponent unclassified (oppArch null) → the streak does not render.
function isRelevant(st, ctx) {
  switch (st.type) {
    case 'all':
    case 'pattern':
    case 'setpat':
      return true;         // match-agnostic
    case 'total':
    case 'handicap':
      // FORMAT-LOCKED: only when the upcoming match's best-of matches the streak's.
      return !!(ctx && ctx.bestOf != null && st.bestOf != null && ctx.bestOf === st.bestOf);
    case 'surface': {
      const up = (ctx && SURFACES.includes(ctx.surface)) ? ctx.surface : null;
      return up != null && st.subtype === up;
    }
    case 'style':
      return !!(ctx && ctx.opponentArch != null && st.subtype === ctx.opponentArch);
    default:
      return false;
  }
}

async function main() {
  if (!API_TENNIS_KEY) {
    console.error('build-series: API_TENNIS_KEY not set — cannot fetch the slate. Aborting (no partial write).');
    process.exit(0);
  }
  const surfaceMap = loadSurfaceMap();
  const styleMap = loadStyleMap();
  const meta = loadMeta();

  const slate = await fetchSlate();
  if (!slate.length) {
    console.error('build-series: slate is empty for today/tomorrow — nothing to compute. Writing empty players list.');
  }

  // (player_key, tier) -> upcoming context. A player may appear in more than one
  // slate match; keep the soonest not-yet-played one (fall back to soonest played).
  const scheduled = new Map();
  const keyFor = (pk, tier) => `${pk}|${tier}`;
  for (const { fx, tier, day } of slate) {
    for (const side of ['first', 'second']) {
      const pk = String(side === 'first' ? fx.first_player_key : fx.second_player_key);
      if (!pk || pk === 'null' || pk === 'undefined') continue;
      const selfName = side === 'first' ? fx.event_first_player : fx.event_second_player;
      const oppName = side === 'first' ? fx.event_second_player : fx.event_first_player;
      const oppKey = String(side === 'first' ? fx.second_player_key : fx.first_player_key);
      const played = FINAL_STATUSES.includes(fx.event_status) || fx.event_winner != null;
      const ctx = {
        day,
        playerName: String(selfName || ''),
        date: String(fx.event_date || ''),
        time: String(fx.event_time || ''),
        tournament: String(fx.tournament_name || ''),
        surface: surfaceMap[String(fx.tournament_key)] || null,
        // Best-of of the upcoming match — drives the FORMAT-RELEVANCE gate for the
        // games-line streaks (total / handicap). Slam main draw = 5, else 3.
        bestOf: upcomingBestOf(fx),
        opponentName: String(oppName || ''),
        opponentKey: oppKey,
        // Upcoming opponent's archetype (Tour taxonomy, name-joined). Drives the
        // vs-style relevance gate and lets the card show WHY a vs-style run applies
        // ("vs Darderi · Attacking Baseliner"). null when unclassified.
        opponentArch: styleMap.get(normName(oppName)) || null,
        eventKey: String(fx.event_key || ''),
        played,
        result: played ? String(fx.event_final_result || '') : '',
      };
      const k = keyFor(pk, tier);
      const prev = scheduled.get(k);
      // preference: not-played over played, then soonest date, then soonest time
      const rank = c => (c.played ? 1 : 0);
      const better = !prev
        || (rank(ctx) < rank(prev))
        || (rank(ctx) === rank(prev) && (ctx.date < prev.date || (ctx.date === prev.date && ctx.time < prev.time)));
      if (better) scheduled.set(k, { pk, tier, upcoming: ctx });
    }
  }

  // one fixture fetch per DISTINCT player (both tiers computed from it)
  const byPlayer = new Map();               // pk -> [tiers needed]
  for (const { pk, tier } of scheduled.values()) {
    if (!byPlayer.has(pk)) byPlayer.set(pk, new Set());
    byPlayer.get(pk).add(tier);
  }
  let players = [];
  let done = 0, failed = 0, playersWithStreak = 0, totalStreaks = 0;
  // reporting accumulators (founder 2026-09-07 "report after building"): per-type
  // and per-subtype card counts, plus the default-view count (view floor applied,
  // already-played hidden). The view floor is per-type: vs-style 3, everything
  // else 5 (VIEW_FLOOR_*), quoted here — never from memory.
  const famCount = {}, subCount = {}, dirCount = { win: 0, loss: 0 };
  let defaultViewCards = 0;
  const viewFloorFor = (st) => (st.type === 'style' ? VIEW_FLOOR_STYLE : VIEW_FLOOR_DEFAULT);
  // line-distribution dump (SERIES_DUMP_LINES=1): so the bo5 total set and the
  // first-set line are finalised on THIS run's own history, not from memory.
  const dumpLines = process.env.SERIES_DUMP_LINES === '1';
  const rawSub = {};   // pre-collapse per-subtype production (what each pattern finds)
  const dist = { bo3: [], bo5: [], firstSet: [] };
  const distinct = [...byPlayer.keys()];
  const limit = Number.isFinite(MAX_PLAYERS) ? distinct.slice(0, MAX_PLAYERS) : distinct;

  for (const pk of limit) {
    done++;
    let fixtures;
    try {
      fixtures = await fetchRecentSinglesFixtures(pk);
    } catch (e) {
      failed++;
      console.error(`build-series: fixture window failed for ${pk}: ${e.message}`);
      await new Promise(r => setTimeout(r, PACE_MS));
      continue;
    }
    await new Promise(r => setTimeout(r, PACE_MS));
    if (!Array.isArray(fixtures) || !fixtures.length) continue;

    for (const tier of byPlayer.get(pk)) {
      const includeStyle = tier === 'tour';
      const recs = orderedRecords(fixtures, pk, tier, surfaceMap, styleMap, includeStyle);
      if (!recs.length) continue;
      // distribution accumulation for line-finalisation (tour bo5 comes from Slams)
      if (dumpLines) {
        for (const r of recs) {
          if (r.totalGames != null && r.bestOf === 3) dist.bo3.push(r.totalGames);
          if (r.totalGames != null && r.bestOf === 5) dist.bo5.push(r.totalGames);
          if (r.set1Total != null) dist.firstSet.push(r.set1Total);
        }
      }
      const ctx = scheduled.get(keyFor(pk, tier)).upcoming;
      // Relevance gate, then one-card-per-family collapse (founder 2026-09-07):
      // keep only streaks whose condition bears on the upcoming match, then reduce
      // to the single longest current run per family so a player can't fill the
      // board with variations of the same idea.
      const relevant = streaksFor(recs, tier).filter(st => isRelevant(st, ctx));
      if (dumpLines) for (const st of relevant) { rawSub[st.subtype || st.type] = (rawSub[st.subtype || st.type] || 0) + 1; }
      const streaks = collapseByFamily(relevant);
      if (!streaks.length) continue;
      const m = meta[pk] || {};
      players.push({
        key: pk,
        tier,
        name: m.name || ctx.playerName || null,
        rank: (m.rank != null ? m.rank : null),
        country: m.country || null,
        totalMatches: recs.length,          // in-tier countable pool behind streaks
        upcoming: ctx,
        streaks: streaks.sort((a, b) => b.count - a.count),
      });
      playersWithStreak++;
      totalStreaks += streaks.length;
      // per-family / per-subtype counts + default-view count (view floor + not-played)
      for (const st of streaks) {
        const fam = st.family || st.type;
        famCount[fam] = (famCount[fam] || 0) + 1;
        subCount[st.subtype || st.type] = (subCount[st.subtype || st.type] || 0) + 1;
        dirCount[st.direction] = (dirCount[st.direction] || 0) + 1;
        if (!ctx.played && st.count >= viewFloorFor(st)) defaultViewCards++;
      }
    }
    if (done % 25 === 0) console.error(`build-series: ${done}/${limit.length} players scanned, ${totalStreaks} streaks so far`);
  }

  players.sort((a, b) => b.streaks[0].count - a.streaks[0].count);

  const doc = {
    generatedAt: new Date().toISOString(),
    now: TODAY_STR,
    source: 'api-tennis get_fixtures (slate) + fetchRecentSinglesFixtures (history)',
    scope: { tiers: { tour: 'Atp Singles', chal: 'Challenger Men Singles' }, styleTier: 'tour-only' },
    rules: {
      minLen: MIN_LEN,                        // engine emit floor
      viewFloorDefault: VIEW_FLOOR_DEFAULT,   // front-end default min-length (all types…)
      viewFloorStyle: VIEW_FLOOR_STYLE,       // …except vs-style
      surfaceMinLen: VIEW_FLOOR_DEFAULT,      // surface uses the default view floor now
      maxAgeDays: MAX_AGE_DAYS,
      slamAgeExempt: true,
      maxGapDays: MAX_GAP_DAYS,               // intra-streak layoff cut (fix #2)
      minPoolConditional: MIN_POOL_CONDITIONAL,
      allCompetitionsPoolFloor: null,
      allCompetitionsPool: 'full-in-tier-history',   // not the run length
      retirements: 'skip',
      styleScope: 'tour-only',
      neverBlendBestOf: true,
      lines: {
        totalBo3: TOTAL_LINES_BO3,
        totalBo5: TOTAL_LINES_BO5,
        handicap: HANDICAP_LINES,
        firstSet: FIRST_SET_LINE,
      },
      families: ['total', 'handicap', 'setpat', 'all', 'firstset', 'surface', 'style'],
      onePerFamily: true,
      relevance: 'match-scoped: surface renders only on the same surface; vs-style only when the upcoming opponent is that archetype; total/handicap are FORMAT-LOCKED to the upcoming match best-of; all / first-set / set-patterns always',
      formatLocked: ['total', 'handicap'],
      formatAgnostic: ['all', 'pattern', 'setpat'],
      matchScoped: ['surface', 'style'],
      upcomingBestOf: 'grand-slam main draw = 5, else 3 (challenger & slam-qualifying = 3)',
      carriesMatches: true,   // each streak lists its run matches for the detail panel
    },
    slate: { window: { from: SLATE_START, to: SLATE_STOP }, today: TODAY_STR, tomorrow: TOMORROW_STR },
    meta,
    players,
  };

  const tmp = OUT_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(doc));
  fs.renameSync(tmp, OUT_FILE);

  console.error(JSON.stringify({
    slateRows: slate.length,
    distinctPlayers: distinct.length,
    scanned: done, failed,
    playersWithStreak,
    totalStreaks,                    // all emitted (collapsed) cards, any length
    defaultViewCards,                // cards visible on the default board (floor + not-played)
    byFamily: famCount,
    byDirection: dirCount,
    bySubtype: subCount,
    outBytes: fs.statSync(OUT_FILE).size,
    out: path.basename(OUT_FILE),
  }, null, 2));

  if (dumpLines) {
    const pct = (arr, p) => { if (!arr.length) return null; const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p / 100 * a.length))]; };
    const overRate = (arr, L) => arr.length ? +(100 * arr.filter(v => v > L).length / arr.length).toFixed(1) : null;
    const summ = (arr, cands) => ({ n: arr.length, p10: pct(arr, 10), p25: pct(arr, 25), median: pct(arr, 50), p75: pct(arr, 75), p90: pct(arr, 90), overRates: cands.map(L => [L, overRate(arr, L)]) });
    console.error('RAW pre-collapse per-subtype production:', JSON.stringify(rawSub));
    console.error('LINE DISTRIBUTIONS (fresh, this run):');
    console.error('  bo3 total:', JSON.stringify(summ(dist.bo3, [20.5, 21.5, 22.5, 23.5, 24.5])));
    console.error('  bo5 total:', JSON.stringify(summ(dist.bo5, [32.5, 33.5, 34.5, 35.5, 36.5, 37.5, 38.5, 39.5, 40.5])));
    console.error('  first set:', JSON.stringify(summ(dist.firstSet, [8.5, 9.5, 10.5])));
  }
}

main().catch(e => { console.error('build-series: unexpected error —', e.stack || e.message); process.exit(1); });
