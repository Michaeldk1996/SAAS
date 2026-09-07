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
const MIN_LEN = 3;
const MAX_AGE_DAYS = 45;
const MIN_POOL_CONDITIONAL = 8;   // style / surface / pattern
// all-competitions: no extra pool floor.

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

  // First-set outcome from scores[] (score-only, tiebreak-aware). null when set 1
  // is undecided/blank (short formats, walkovers) — then the pattern line is
  // undefined for this match and it is excluded from that line's pool.
  const sets = setsFromScores(fx, me);
  const s1 = sets[1];
  const lostSet1 = (s1 && s1.decided) ? !s1.won : null;

  // Opponent archetype (Tour only). Unmatched => null (unclassified).
  let oppArch = null;
  if (includeStyle) {
    const oppName = me === 'first' ? fx.event_second_player : fx.event_first_player;
    oppArch = styleMap.get(normName(oppName)) || null;
  }

  return {
    date: d,
    eventKey: String(fx.event_key || ''),
    won,
    surface,
    lostSet1,
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
  return { direction: last.won ? 'win' : 'loss', count, last };
}

// Tail run of a boolean attribute (for the first-set pattern line).
function tailAttrRun(seq, attrFn) {
  if (!seq.length) return null;
  const lastVal = attrFn(seq[seq.length - 1]);
  let count = 0;
  for (let i = seq.length - 1; i >= 0; i--) {
    if (attrFn(seq[i]) === lastVal) count++; else break;
  }
  return { value: lastVal, count, last: seq[seq.length - 1] };
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

function mkStreak(base, run, pool, poolFloor) {
  const last = run.last;
  if (run.count < MIN_LEN) return null;
  if (poolFloor != null && pool < poolFloor) return null;
  const rec = recencyOk(last);
  if (!rec.ok) return null;
  return Object.assign({
    count: run.count,
    pool,
    lastDate: last.date,
    ageDays: rec.age,
    slamExempt: rec.slamExempt,
    lastTournament: last.tournament,
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
      // all-competitions: no extra pool floor; the run is its own pool.
      const s = mkStreak({ type: 'all', subtype: null, direction: run.direction }, run, run.count, null);
      return s ? [s] : [];
    },
  },
  {
    id: 'surface',
    build(recs) {
      const out = [];
      for (const surf of SURFACES) {
        const seq = recs.filter(r => r.surface === surf);
        const run = tailRun(seq);
        if (!run) continue;
        const s = mkStreak({ type: 'surface', subtype: surf, direction: run.direction }, run, seq.length, MIN_POOL_CONDITIONAL);
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
        const s = mkStreak({ type: 'style', subtype: arch, direction: run.direction }, run, seq.length, MIN_POOL_CONDITIONAL);
        if (s) out.push(s);
      }
      return out;
    },
  },
  {
    id: 'pattern',
    build(recs) {
      // First-set line (EXACT, score-only). Pool = matches with a decided set 1.
      // The games-total line is intentionally NOT built here: it needs a line
      // value, which is a threshold the founder has not set. It slots in as a new
      // config entry once he names the number.
      const seq = recs.filter(r => r.lostSet1 !== null);
      const run = tailAttrRun(seq, r => r.lostSet1);
      if (!run) return [];
      const subtype = run.value ? 'lost-first-set' : 'won-first-set';
      const direction = run.value ? 'loss' : 'win';   // slow starter vs fast starter
      const s = mkStreak({ type: 'pattern', subtype, direction }, run, seq.length, MIN_POOL_CONDITIONAL);
      return s ? [s] : [];
    },
  },
];

function streaksFor(recs, tier) {
  const out = [];
  for (const t of STREAK_TYPES) {
    if (t.tourOnly && tier !== 'tour') continue;
    for (const s of t.build(recs)) out.push(s);
  }
  return out;
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
        opponentName: String(oppName || ''),
        opponentKey: oppKey,
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
      const streaks = streaksFor(recs, tier);
      if (!streaks.length) continue;
      const ctx = scheduled.get(keyFor(pk, tier)).upcoming;
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
      minLen: MIN_LEN,
      maxAgeDays: MAX_AGE_DAYS,
      slamAgeExempt: true,
      minPoolConditional: MIN_POOL_CONDITIONAL,
      allCompetitionsPoolFloor: null,
      retirements: 'skip',
      styleScope: 'tour-only',
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
    playersWithStreak, totalStreaks,
    outBytes: fs.statSync(OUT_FILE).size,
    out: path.basename(OUT_FILE),
  }, null, 2));
}

main().catch(e => { console.error('build-series: unexpected error —', e.stack || e.message); process.exit(1); });
