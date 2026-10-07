#!/usr/bin/env node
'use strict';
// =============================================================================
// Task 12 — Career Splits + Last 52 Weeks Splits, from Jeff Sackmann's ATP
// match-results data.
//
// The canonical source (github.com/JeffSackmann/tennis_atp) is unreachable from
// this environment (egress allowlist), so we pull the SAME underlying data from
// Sackmann's own site, tennisabstract.com, which IS reachable: each player's
// player-classic.cgi page embeds a `var matchmx` array of every tour match with
// surface, level, round, score, best-of, and — critically for this task —
// opponent HAND (R/L) and opponent RANK at match time. Feasibility confirmed:
// both fields are present, so vs Righties / vs Lefties / vs Top 10 are real.
//
// Output (TEN-391 — one file per player, founder 2026-10-07):
//   career-splits/<profileKey>.json  one player object, keyed by the
//     player-profiles.json profile key: a `career` and a `last52` block, each a
//     map of the split categories to { M, W, L, winPct, setW, setL, setPct, … },
//     plus taId / fullName / rank / matchesParsed / last52Count / cutoff52 / q7.
//     Byte-for-byte the object the old single career-splits.json carried under
//     players[key]. The browser fetches ONE of these when a profile (or the H2H
//     page) shows that player; nothing fetches career splits up front.
//   career-splits-tour.json  the build's metadata (fetchedAt, rules, columns,
//     coverage + why each profiled player has no file) and `pooled`: the slim
//     per-player rows ({rank, career/last52 {M,W,winPct}}) that the only
//     TOUR-WIDE readers need (the legacy profile's tier medians and its Key
//     insights engine tour averages). Loaded only by those readers.
// Zero-match categories are dropped so the dashboard can hide empty rows.
// NOTHING is approximated — a split absent from the data is simply absent.
//
// Coverage (TEN-391): EVERY profiled player — the roster is the DEPLOYED
// player-profiles.json (the committed copy is a fossil of an older, smaller
// board). The old rank <= 250 cap is gone. A profile resolves to a Tennis
// Abstract player through TA's current ranking list (initial + surname), and
// failing that through TA's full men's player list using the deployed
// player-index.json full name; each fetched page is identity-checked (ATP id
// where we hold one, age vs date of birth) so a namesake is never joined.
//
// Usage: node tools/build-career-splits.js [rankMax] [maxPlayers]
//   Both default to no cap. Pass numbers only to smoke-test deliberately.
//   Re-runnable; pages cached in /tmp/ta-cache and refetched once older than
//   SPLITS_CACHE_TTL_HOURS (default 20).
//   Env: SPLITS_CACHE_DIR, SPLITS_CACHE_TTL_HOURS, SPLITS_TODAY (pin fetchedAt),
//   SPLITS_PROFILES_FILE / SPLITS_INDEX_FILE (pin the roster to a local file).
//   Rebuilt daily by tools/refresh-career-splits.sh (launchd, residential IP),
//   which commits the result; pipeline.yml copies it to the live site.
// =============================================================================

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const PROFILES = path.join(ROOT, 'player-profiles.json');
const SITE = 'https://michaeldk1996.github.io/SAAS/';
const ALIASES = path.join(ROOT, 'player-atp-aliases.json');
// TEN-391: one file per player + the small tour file (see the header).
const SPLITS_DIR = path.join(ROOT, 'career-splits');
const TOUR_OUT = path.join(ROOT, 'career-splits-tour.json');
// TEN-162 — per-player match lists behind each split row (drawer drill-down).
// One lazy shard per player, index-gated on the client, exactly mirroring the
// career-history/{key}.json + career-history-index.json convention. Built from
// the SAME tour-level match set as the aggregates in career-splits/, so a
// drawer's row count reconciles cell-for-cell with the split's M. Emitted only
// alongside a successful build; the pipeline copies both to the site.
const SHARD_DIR = path.join(ROOT, 'splits-matches');
const SHARD_INDEX = path.join(ROOT, 'splits-matches-index.json');
// Compact per-match record for a shard: display fields (date, tournament,
// opponent, score, result) plus the exact predicate inputs the frontend needs
// to reproduce every shown split category (surface, level, best-of, round,
// opponent hand/rank). Short keys keep the payload near the measured ~138 B/row.
function shardMatch(m) {
  return {
    d: m.date, t: m.tournament || null, o: m.oppName || null, oc: m.oppCountry || null,
    rd: m.round, sc: m.score || '', wl: m.wl,
    sf: m.surface, lv: m.level, bo: m.bestof, orank: m.oppRank, oh: m.oppHand,
  };
}
const CACHE = process.env.SPLITS_CACHE_DIR || '/tmp/ta-cache';
// TEN-391 (founder, 2026-10-07): NO rank cap. Every profiled player is built;
// a player with no tour-level data simply gets no file. Pass a number only to
// cap deliberately, e.g. when smoke-testing against a cold cache.
const RANK_MAX = parseInt(process.argv[2], 10) || Infinity;
const MAX_PLAYERS = parseInt(process.argv[3], 10) || Infinity;
// tennisabstract rate-limits bursts (HTTP 429), so we pace: low concurrency, a
// base delay per request, and exponential backoff on 429. Cached pages skip the
// network entirely, so re-runs only pay for players not yet fetched.
const CONCURRENCY = 2;
const BASE_DELAY_MS = 600;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// A cached page older than this is refetched. Without expiry a re-run reads
// yesterday's HTML back and reproduces the stale file exactly, which looks like
// a successful refresh while changing nothing.
const CACHE_TTL_MS = (parseFloat(process.env.SPLITS_CACHE_TTL_HOURS) || 20) * 3600 * 1000;
// Run date, as YYYYMMDD. Only stamps `fetchedAt` and backstops a player with no
// matches — the real last-52 window is anchored per player (see cutoff52).
// SPLITS_TODAY pins it for a reproducible build.
function todayStamp() {
  const pin = (process.env.SPLITS_TODAY || '').trim();
  if (/^\d{8}$/.test(pin)) return pin;
  const dt = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}`;
}
const TODAY = todayStamp();
function daysAgoStamp(stamp, cutoff) { return stamp >= cutoff; }
// `days` before a YYYYMMDD stamp, as YYYYMMDD.
function minusDays(stamp, days) {
  const y = +stamp.slice(0, 4), m = +stamp.slice(4, 6), d = +stamp.slice(6, 8);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  const p = n => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}`;
}
// 364 days before a YYYYMMDD stamp, as YYYYMMDD.
function minus364(stamp) { return minusDays(stamp, 364); }

// ---- Layer #7 (quality-adjusted form) recency-era buckets -------------------
// The h2h-model's quality-form layer needs each player's win rate vs top-50
// opponents (career-wide AND per surface) with a recency split, but splits()
// above collapses every match date into one aggregate. So we emit a compact
// per-player `q7` block: for each subset (overall / vs-top-50 / top-50-on-each-
// surface) three [M,W] counts, bucketed by how old the match is relative to the
// build date (TODAY): 0 = last 2yr, 1 = 2-4yr, 2 = 4+yr. The recency WEIGHTS and
// sample-size dampening live in h2h-model/config.js so they stay tunable without
// a rebuild — only the era BOUNDARIES are baked here, and they drift under a day
// since this file rebuilds daily. Uses opponent rank AT MATCH TIME (matchmx
// cell 12), which is sharper than the model's current-rank proxy.
const Q7_ERA2 = minusDays(TODAY, 730);   // 2-year boundary
const Q7_ERA4 = minusDays(TODAY, 1461);  // 4-year boundary
function q7era(dateStamp) {
  return dateStamp >= Q7_ERA2 ? 0 : (dateStamp >= Q7_ERA4 ? 1 : 2);
}
// [M0,W0, M1,W1, M2,W2] over the matches passing `pred`.
function q7bucket(matches, pred) {
  const b = [0, 0, 0, 0, 0, 0];
  for (const m of matches) {
    if (!pred(m)) continue;
    const i = q7era(m.date) * 2;
    b[i]++;                        // M
    if (m.wl === 'W') b[i + 1]++;  // W
  }
  return b;
}
function q7splits(matches) {
  const top50 = m => m.oppRank != null && m.oppRank <= 50;
  const q = {
    overall: q7bucket(matches, () => true),
    top50: q7bucket(matches, top50),
    surf50: {},
  };
  for (const s of ['Hard', 'Clay', 'Grass']) {
    const b = q7bucket(matches, m => m.surface === s && top50(m));
    if (b[0] + b[2] + b[4] > 0) q.surf50[s] = b; // drop empty surfaces (self-hide)
  }
  return q;
}
// Tennis Abstract anchors "Last 52 Weeks" to the player's OWN most recent match,
// not to today. Verified by solving for the cutoff that reproduces TA's rendered
// table: Rune (last played Oct 2025) only matches with an Oct 2024 cutoff, while
// Alcaraz needs Apr 2025 — no single global date fits both. So for a player who
// is out injured this shows his last 52 active weeks rather than a near-empty
// window, which is also the more useful read of recent form.
function cutoff52(matches) {
  let last = '';
  for (const m of matches) if (m.date > last) last = m.date;
  return last ? minus364(last) : minus364(TODAY);
}

function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function taId(fullName) {
  // "Carlos Alcaraz" -> "CarlosAlcaraz"; "Alex de Minaur" -> "AlexdeMinaur"
  return stripAccents(fullName).replace(/[^A-Za-z]/g, '');
}
function normKey(s) {
  return stripAccents(String(s || '')).toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 25000, headers: { 'User-Agent': 'Mozilla/5.0 bsp-splits' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); return get(res.headers.location).then(resolve, reject);
      }
      let data = ''; res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// ---- parse one matchmx into normalized match objects ------------------------
// matchmx is a JSON array literal, so we brace-match it and JSON.parse it.
// Scanning row-by-row with /\[[^\[\]]*\]/ looks equivalent but is NOT: a super
// tiebreak score ("6-7 [10-7]") contains its own brackets, so that regex tears
// the row in half and silently drops a real match from every total.
// One player's serve counters for a match, read from `cells` starting at `base`.
// Returns null unless the block is complete and internally consistent — a match
// with no stats recorded carries empty strings here, and a serve column built
// over those would report a real 0% instead of "not measured".
function serveCounters(cells, base) {
  const n = k => {
    const v = cells[base + k];
    if (v === '' || v == null) return null;
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? x : null;
  };
  const o = {
    aces: n(0), dfs: n(1), pts: n(2), firstIn: n(3), firstWon: n(4),
    secondWon: n(5), svGames: n(6), bpSaved: n(7), bpFaced: n(8),
  };
  if (Object.values(o).some(v => v === null)) return null;
  // A serve block with no points played is a placeholder, not a real 0.
  if (!o.pts || !o.svGames) return null;
  if (o.firstIn > o.pts || o.firstWon > o.firstIn) return null;
  if (o.bpSaved > o.bpFaced) return null;
  return o;
}

function parseMatches(html) {
  const i = html.indexOf('var matchmx');
  if (i < 0) return [];
  const s = html.indexOf('[', i);
  let depth = 0, end = -1;
  for (let k = s; k < html.length; k++) {
    const c = html[k];
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (!depth) { end = k + 1; break; } }
  }
  if (end < 0) return [];
  let rows;
  try { rows = JSON.parse(html.slice(s, end)); } catch (e) { return []; }
  const out = [];
  for (const cells of rows) {
    if (!Array.isArray(cells) || cells.length < 16) continue;
    const date = cells[0], tournament = cells[1], surface = cells[2], level = cells[3], wl = cells[4],
      round = cells[8], score = cells[9], bestofRaw = cells[10], oppName = cells[11],
      oppRank = cells[12], oppHand = cells[15], oppCountry = cells[18];
    if (wl !== 'W' && wl !== 'L') continue;
    out.push({
      date, tournament, surface, level, wl, round, score,
      // Display-only fields for the TEN-162 splits drawer (the per-match list
      // behind each split row). matchmx cell 1 = tournament name, 11 = opponent
      // name, 18 = opponent country (IOC code). Not used by any aggregate.
      oppName: (typeof oppName === 'string' && oppName.trim()) ? oppName.trim() : null,
      oppCountry: (typeof oppCountry === 'string' && /^[A-Za-z]{2,3}$/.test(oppCountry.trim())) ? oppCountry.trim().toUpperCase() : null,
      // Cells 21-38 are the per-match serve counters for both players, in
      // Sackmann's atp_matches order. Older matches carry none — serve() returns
      // null for those and they are excluded from MS and every serve column,
      // rather than being averaged in as zeros.
      srv: serveCounters(cells, 21),
      opp: serveCounters(cells, 30),
      // Strictly the source's own best-of field. Inferring 5 from a Grand Slam
      // over-counts: a walkover carries no best-of, which is why TA shows one
      // more Grand Slam match than Best of 5.
      bestof: bestofRaw === '5' ? 5 : bestofRaw === '3' ? 3 : null,
      oppRank: /^\d+$/.test(oppRank) ? +oppRank : null,
      oppHand: (oppHand === 'R' || oppHand === 'L') ? oppHand : null,
    });
  }
  return out;
}

// A set counts only once it is complete: 6+ with a 2-game margin, or 7-5 / 7-6.
function completedSet(a, b) {
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi >= 6 && hi - lo >= 2) || (hi === 7 && lo >= 5);
}

// player-perspective set W/L from a winner-first score string.
// A walkover has no score at all: it counts as a match and a win, but no sets.
// A match ending RET/DEF was abandoned mid-set — Tennis Abstract drops that
// trailing incomplete set rather than awarding it to either player.
function setRecord(m) {
  const sc = (m.score || '').trim();
  if (!sc || !/\d-\d/.test(sc)) return { w: 0, l: 0 };
  let toks = sc.split(/\s+/).filter(t => /^\d+-\d+(\(\d+\))?$/.test(t));
  if (/RET|DEF/i.test(sc) && toks.length) {
    const last = toks[toks.length - 1].match(/^(\d+)-(\d+)/);
    if (last && !completedSet(+last[1], +last[2])) toks.pop();
  }
  let winnerSets = 0, loserSets = 0;
  for (const tok of toks) {
    const mm = tok.replace(/\(.*?\)/g, '').match(/^(\d+)-(\d+)$/);
    if (!mm) continue;
    const a = +mm[1], b = +mm[2];
    if (a > b) winnerSets++; else if (b > a) loserSets++;
  }
  // score is written winner-first; flip to the player's perspective
  return m.wl === 'W' ? { w: winnerSets, l: loserSets } : { w: loserSets, l: winnerSets };
}

// The scored sets of a match, winner-oriented, after dropping the trailing
// incomplete set of a RET/DEF. Shared by the set, game and tiebreak columns so
// all three agree on what actually counts as played.
function scoredSets(m) {
  const sc = (m.score || '').trim();
  if (!sc || !/\d-\d/.test(sc)) return [];
  const toks = sc.split(/\s+/).filter(t => /^\d+-\d+(\(\d+\))?$/.test(t));
  if (/RET|DEF/i.test(sc) && toks.length) {
    const last = toks[toks.length - 1].match(/^(\d+)-(\d+)/);
    if (last && !completedSet(+last[1], +last[2])) toks.pop();
  }
  return toks.map(t => {
    const mm = t.match(/^(\d+)-(\d+)(?:\((\d+)\))?$/);
    return { a: +mm[1], b: +mm[2], tb: mm[3] !== undefined };
  });
}

// Games won/lost from the player's perspective. Unlike sets, every game of an
// abandoned set is still a game that was played, but TA drops the whole
// incomplete set, so scoredSets is the shared source of truth.
function gameRecord(m) {
  let w = 0, l = 0;
  for (const s of scoredSets(m)) { w += s.a; l += s.b; }
  return m.wl === 'W' ? { w, l } : { w: l, l: w };
}

// ─── TEN-244 · a match played on a different GAMES scale (founder 2026-09-21) ──
// The NextGen Finals play best-of-five SHORT sets — first to four games with a
// tiebreak at 3-3. Measured on the published store: across 522 NextGen sets the
// winning side reached exactly 4 games in 520 of them and 6 games in NONE.
//
// The ruling is deliberately NARROW. A NextGen match IS a match: it counts in M,
// in W/L, in the surface row, in H2H and in the SET columns, because a set won
// is a set won. What does not carry is the GAMES scale — so `gameW`, `gameL` and
// `gamePct` (and anything derived from game counts) are computed over a smaller
// population, and the row states that population rather than implying M.
//
// MATCHED ON NAME HERE, and that is a real difference from the pipeline. This
// file's source is Tennis Abstract's matchmx, which carries no tournament id at
// all — so unlike career-history (api-tennis `tournament_key` 2793 / TML
// `tourney_id` suffix 7696) there is no key to match on. The two variants
// actually present, measured 2026-09-21 over 233 player files and 731 distinct
// tournament names: `NextGen Finals` (151 rows) and `Next Gen Finals` (57).
// `Next Gen ATP Finals` is carried too because TML uses it and TA may adopt it.
//
// The pattern is ANCHORED for one specific reason: the 2005-2008 Adelaide ATP
// 250 was sponsored as "Next Generation Hardcourts" and was best-of-THREE. A
// substring match on "next gen" swallows it. That event is not in matchmx today
// (verified: 0 rows), so this is a guard against a future ingest, not a
// present-day fix — and there is a control for it in the suite.
// READS BOTH FIELD NAMES ON PURPOSE. `splits()` is fed parseMatches() output,
// whose key is `tournament`; the published drawer shard (shardMatch) renames it
// to `t`. A matcher that knew only about `t` would compile, pass a shard-shaped
// unit test, and silently never fire in the build — which is exactly the
// parser-test-standing-in-for-a-wiring-test defect this ticket already paid for
// once. There is a control for each shape in the suite.
const ALT_FORMAT_NEXTGEN = /^next\s?gen(?:\s+atp)?\s+finals$/i;
function altFormatOf(m) {
  if (!m) return null;
  const name = m.tournament != null ? m.tournament : m.t;
  return ALT_FORMAT_NEXTGEN.test(String(name || '').trim()) ? 'nextgen' : null;
}

// Tiebreaks won/lost. A tiebreak set is won by whoever won the set, so the
// tiebreak follows the set's winner.
function tbRecord(m) {
  let w = 0, l = 0;
  for (const s of scoredSets(m)) {
    if (!s.tb) continue;
    if (s.a > s.b) w++; else if (s.b > s.a) l++;
  }
  return m.wl === 'W' ? { w, l } : { w: l, l: w };
}

// Tour level: Grand Slams, Masters, ATP tour ("A"), Tour Finals, Davis Cup.
// Challengers and ITF futures are NOT tour level and must be excluded, or every
// row inflates. F and D count toward the surface rows but get no level row of
// their own, which is why the three level rows do not re-add to the total.
const TOUR_LEVELS = new Set(['G', 'M', 'A', 'F', 'D']);
// Real qualifying is Q1/Q2/Q3 only. Matching /^Q/ would also swallow QF.
const QUALIFYING = /^Q[123]$/;
function isTourLevel(m) {
  return TOUR_LEVELS.has(m.level) && !QUALIFYING.test(m.round);
}

const CATEGORIES = [
  ['Hard', m => m.surface === 'Hard'],
  ['Clay', m => m.surface === 'Clay'],
  ['Grass', m => m.surface === 'Grass'],
  // Carpet died out around 2009, so only long-career players (Djokovic) have a
  // Carpet row at all. Zero-match categories are dropped, so it self-hides.
  ['Carpet', m => m.surface === 'Carpet'],
  ['Grand Slams', m => m.level === 'G'],
  ['Masters', m => m.level === 'M'],
  ['Other Tours', m => m.level === 'A'],
  ['Best of 5', m => m.bestof === 5],
  ['Best of 3', m => m.bestof === 3],
  ['Finals', m => m.round === 'F'],
  ['Semi-finals', m => m.round === 'SF'],
  ['Quarter-finals', m => m.round === 'QF'],
  // Early rounds. Sackmann codes: R16=1/8-final, R32=1/16, R64=1/32, R128=1/64.
  // Zero-match rows are dropped, so short-career players simply won't have the
  // deeper (R128/R64) rows. RR (round-robin, Tour Finals) is deliberately not a
  // bucket — it has no knockout stage to compare against.
  ['Round of 16', m => m.round === 'R16'],
  ['Round of 32', m => m.round === 'R32'],
  ['Round of 64', m => m.round === 'R64'],
  ['Round of 128', m => m.round === 'R128'],
  ['vs. Righties', m => m.oppHand === 'R'],
  ['vs. Lefties', m => m.oppHand === 'L'],
  ['vs. Top 10', m => m.oppRank != null && m.oppRank <= 10],
];

function splits(matches) {
  const rows = {};
  for (const [label, pred] of CATEGORIES) {
    const sub = matches.filter(pred);
    if (!sub.length) continue; // zero-match categories dropped (dashboard hides)
    let W = 0, setW = 0, setL = 0, gameW = 0, gameL = 0, tbW = 0, tbL = 0;
    // The games columns have their OWN population: M minus the matches played on
    // a different games scale. Tracked rather than assumed, so the row can state
    // it (gameM) instead of leaving a reader to divide by M and be wrong.
    let gameM = 0, gameX = 0;
    // Serve totals accumulate ONLY over matches that carry stats, so the
    // denominator of every serve column is MS, not M.
    let MS = 0;
    const t = {
      aces: 0, dfs: 0, pts: 0, firstIn: 0, firstWon: 0, secondWon: 0,
      svGames: 0, bpSaved: 0, bpFaced: 0,
      opts: 0, ofirstIn: 0, ofirstWon: 0, osecondWon: 0, osvGames: 0, obpSaved: 0, obpFaced: 0,
    };
    for (const m of sub) {
      if (m.wl === 'W') W++;
      // SETS are retained for an alternate-format match: a set won is a set won,
      // and the count of them is on the same ladder as everything else.
      const sr = setRecord(m); setW += sr.w; setL += sr.l;
      // GAMES and TIEBREAKS both leave. Games because the scale differs; and
      // tiebreaks because — founder ruling 2026-09-21, reversing the retention I
      // flagged — a NextGen tiebreak triggers at 3-3 rather than 6-6, so it is a
      // differently-REACHED event and does not compare to the rest of the
      // archive. A tiebreak at 3-3 is a coin-flip reached after six games; one at
      // 6-6 is reached after twelve. Pooling them would make "tiebreaks won" mean
      // two things in one column.
      //
      // Both column groups therefore rest on the SAME population, `gameM`, and
      // `gameX` is the count that left. That is why there is no separate `tbM`:
      // a second field would always equal the first, and two names for one
      // population is how they drift apart.
      if (altFormatOf(m)) { gameX++; }
      else {
        gameM++;
        const gr = gameRecord(m); gameW += gr.w; gameL += gr.l;
        const tr = tbRecord(m);   tbW   += tr.w; tbL   += tr.l;
      }
      // Both blocks are required: RPW and DR are computed off the opponent's
      // serve, so a match with only one side recorded cannot be counted.
      if (!m.srv || !m.opp) continue;
      MS++;
      t.aces += m.srv.aces; t.dfs += m.srv.dfs; t.pts += m.srv.pts;
      t.firstIn += m.srv.firstIn; t.firstWon += m.srv.firstWon;
      t.secondWon += m.srv.secondWon; t.svGames += m.srv.svGames;
      t.bpSaved += m.srv.bpSaved; t.bpFaced += m.srv.bpFaced;
      t.opts += m.opp.pts; t.ofirstIn += m.opp.firstIn; t.ofirstWon += m.opp.firstWon;
      t.osecondWon += m.opp.secondWon; t.osvGames += m.opp.svGames;
      t.obpSaved += m.opp.bpSaved; t.obpFaced += m.opp.bpFaced;
    }
    const M = sub.length, L = M - W;
    const setTot = setW + setL, gameTot = gameW + gameL, tbTot = tbW + tbL;
    const pct = (num, den) => den ? Math.round(num / den * 1000) / 10 : null;

    // Tennis Abstract publishes these formulas in makeSplitStatRow() on the same
    // page as the data — they are lifted from there, not derived, so the columns
    // agree with TA's own tables cell for cell.
    const secondPts = t.pts - t.firstIn;                 // 2nd serve points = every point where the 1st missed
    const svWon = t.firstWon + t.secondWon;
    const oSvWon = t.ofirstWon + t.osecondWon;
    const spw = t.pts ? svWon / t.pts : null;            // serve points won
    const rpw = t.opts ? 1 - oSvWon / t.opts : null;     // return points won = the rest of the opponent's serve
    const r1 = v => v == null ? null : Math.round(v * 1000) / 10;
    const serve = !MS ? null : {
      MS,
      // Hold% = service games minus the ones broken. Break% is the mirror,
      // computed off the opponent's service games.
      hldPct: pct(t.svGames - (t.bpFaced - t.bpSaved), t.svGames),
      brkPct: pct(t.obpFaced - t.obpSaved, t.osvGames),
      aPct: r1(t.pts ? t.aces / t.pts : null),
      dfPct: r1(t.pts ? t.dfs / t.pts : null),
      // TEN-327: the house Serve rating's aces − double faults terms are PER MATCH (the season
      // form of the per-match counts), over the same MS matches the percentages come from.
      acesPM: MS ? Math.round(t.aces / MS * 100) / 100 : null,
      dfPM: MS ? Math.round(t.dfs / MS * 100) / 100 : null,
      firstInPct: r1(t.pts ? t.firstIn / t.pts : null),
      firstWonPct: r1(t.firstIn ? t.firstWon / t.firstIn : null),
      secondWonPct: r1(secondPts > 0 ? t.secondWon / secondPts : null),
      spwPct: r1(spw),
      rpwPct: r1(rpw),
      // Return-points-won split into its two halves (the return-side mirror of
      // firstWonPct/secondWonPct), off the OPPONENT's serve counters: the returner
      // won every opponent 1st/2nd serve point the server didn't. Fed to the Layer
      // #10 in-tournament return tier as its 1st/2nd-return-points-won baselines.
      ret1WonPct: r1(t.ofirstIn ? (t.ofirstIn - t.ofirstWon) / t.ofirstIn : null),                                  // returner won vs opp 1st serve
      ret2WonPct: r1((t.opts - t.ofirstIn) > 0 ? ((t.opts - t.ofirstIn) - t.osecondWon) / (t.opts - t.ofirstIn) : null), // returner won vs opp 2nd serve
      // Break points converted = opponent's break points faced that he did NOT save.
      // Mirror of brkPct's numerator, but over BP CHANCES (obpFaced) rather than
      // return games. The season baseline for the tier's BP-conversion component.
      bpConvPct: pct(t.obpFaced - t.obpSaved, t.obpFaced),                                                          // break points converted
      tpwPct: r1((t.pts + t.opts) ? (svWon + (t.opts - oSvWon)) / (t.pts + t.opts) : null),
      // Dominance Ratio: return points won per serve point lost. Above 1.0 means
      // he does more damage on return than he concedes on serve.
      dr: (rpw != null && spw != null && spw < 1) ? Math.round(rpw / (1 - spw) * 100) / 100 : null,
    };
    rows[label] = {
      M, W, L,
      winPct: pct(W, M),
      setW, setL, setPct: pct(setW, setTot),
      // `gameM` is the population the games AND tiebreak columns were computed
      // over. It equals M on every row that holds no alternate-format match, and
      // `gameX` is emitted ONLY when it doesn't — so a reader who sees gameX
      // knows those columns and the match columns describe different sets of
      // matches, and a reader who doesn't see it knows they describe the same
      // one. pct() already returns null on a zero denominator, so a row whose
      // ONLY matches were alternate-format renders as a dash, never a 0.0%.
      gameW, gameL, gamePct: pct(gameW, gameTot), gameM,
      ...(gameX ? { gameX } : {}),
      tbW, tbL, tbPct: pct(tbW, tbTot),
      ...(serve || { MS: 0 }),
    };
  }
  return rows;
}

// ---- roster + name resolution (TEN-391) -------------------------------------
// The roster is every PROFILED player on the live site, and each profile key is
// resolved to a Tennis Abstract page id. Three sources, tried in order:
//   1 · TA's current ranking list (curr_rank_atp.js), initial + surname — the
//       pre-TEN-391 join, now without the rank cap;
//   2 · TA's full men's player list (mwplayerlist.js, every man TA holds,
//       retired or unranked included) matched on the deployed player-index.json
//       FULL name, word order free (api-tennis scrambles it: "Yunchaokete Bu" is
//       TA's "Bu Yunchaokete");
//   3 · the same list by initial + surname, in TA's own order.
// Every fetched page is identity-checked before it is accepted (identityCheck),
// so a namesake is never joined — the failure mode a looser join opens up.
async function loadCurrRank() {
  const { body } = await get('https://www.tennisabstract.com/jsplayers/curr_rank_atp.js');
  const m = body.match(/currRank\s*=\s*(\{[\s\S]*?\});/);
  return JSON.parse(m[1]); // { "Full Name": "rank" }
}
// TA's search list: "(M) Full Name" / "(W) Full Name". Men only, in TA's order.
async function loadMenList() {
  try {
    const { status, body } = await get('https://www.tennisabstract.com/mwplayerlist.js');
    const m = status === 200 && body.match(/playerlist\s*=\s*(\[[\s\S]*?\]);/);
    if (!m) return [];
    return JSON.parse(m[1]).filter(s => /^\(M\) /.test(s)).map(s => s.slice(4).trim()).filter(Boolean);
  } catch (e) { return []; }
}
async function getJsonFrom(url, localFile, label) {
  try {
    const { status, body } = await get(url);
    if (status === 200) return { data: JSON.parse(body), source: 'deployed' };
  } catch (e) { /* fall through to the local copy */ }
  if (localFile && fs.existsSync(localFile)) {
    console.warn(`WARNING: deployed ${label} unreachable — using the local copy ${path.basename(localFile)}.`);
    return { data: JSON.parse(fs.readFileSync(localFile, 'utf8')), source: 'local' };
  }
  return { data: null, source: 'none' };
}
// The profile roster = the DEPLOYED player-profiles.json (the committed copy is
// a fossil of a smaller, older board: 428 vs 479 profiles on 2026-10-07).
async function loadRoster() {
  const pin = (process.env.SPLITS_PROFILES_FILE || '').trim();
  if (pin) return { players: JSON.parse(fs.readFileSync(pin, 'utf8')).players || {}, source: pin };
  const r = await getJsonFrom(SITE + 'player-profiles.json', PROFILES, 'player-profiles.json');
  return { players: (r.data && r.data.players) || {}, source: r.source };
}
// The deployed searchable roster (api-tennis standings): key -> full name, and
// the keys that carry a profile (hasProfile — opened from search through
// profiles/<key>.json even when they are not in player-profiles.json).
async function loadIndex() {
  const pin = (process.env.SPLITS_INDEX_FILE || '').trim();
  const r = pin ? { data: JSON.parse(fs.readFileSync(pin, 'utf8')) }
    : await getJsonFrom(SITE + 'player-index.json', path.join(ROOT, 'player-index.json'), 'player-index.json');
  const names = {}, profiled = [];
  for (const p of ((r.data && r.data.players) || [])) {
    if (!p || p.key == null || !p.name) continue;
    names[String(p.key)] = p.name;
    if (p.hasProfile) profiled.push(String(p.key));
  }
  return { names, profiled };
}
// A searchable profile outside player-profiles.json: its own profiles/<key>.json
// carries the abbreviated name and the age the identity check needs. Falls back
// to the index's full name (no age) when the shard cannot be read.
async function loadProfileShards(keys, names) {
  const out = {};
  let i = 0;
  async function worker() {
    while (i < keys.length) {
      const k = keys[i++];
      let p = null;
      try {
        const { status, body } = await get(SITE + 'profiles/' + encodeURIComponent(k) + '.json');
        if (status === 200) { const d = JSON.parse(body); p = d && (d.profile || d); }
      } catch (e) { /* fall back to the index name */ }
      out[k] = { name: (p && p.name) || names[k], age: p && p.age != null ? p.age : null, searchOnly: true };
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

// Apostrophes are dropped, not spaced: TA's men's list writes "Christopher
// Oconnell" where the ranking list and our roster write "O'Connell".
function nameTokens(s) {
  return normKey(String(s || '').replace(/['\u2019]/g, '').replace(/\./g, ' ')).split(' ').filter(Boolean);
}
// The abbreviated given names a profile name leads with ("C. S. van Schalkwyk"
// -> c, s; "J.J. Wolf" -> j, j; "Kr. Arora" -> kr). A candidate's given names
// must start with them, in order, or he is a different man with the surname.
function leadingAbbrevs(raw) {
  const out = [];
  for (const part of String(raw || '').trim().split(/\s+/)) {
    if (!/\.$/.test(part)) break;
    part.split('.').filter(Boolean).forEach(a => out.push(normKey(a).replace(/ /g, '')));
  }
  return out.filter(Boolean);
}
function abbrevsFit(raw, full) {
  const ab = leadingAbbrevs(raw);
  if (!ab.length) return true;
  const t = nameTokens(full);
  return ab.length < t.length && ab.every((a, i) => t[i].startsWith(a));
}
// A name we can match on as a FULL name: no initials ("F. Fognini" is not one).
function looksFull(s) {
  const raw = String(s || '');
  const t = nameTokens(raw);
  return t.length >= 2 && !/\./.test(raw) && t.every(w => w.length > 1);
}
function tokenSet(s) { return nameTokens(s).slice().sort().join(' '); }
// Index a list of { full, rank, order } by initial|surname (first given name),
// by every given-name initial (the tour abbreviates some players by a middle
// name — Adolfo Daniel Vallejo plays as "D. Vallejo"), and by word set.
function nameIndex(list) {
  const idx = new Map(), altIdx = new Map(), anyIdx = new Map(), bySet = new Map(), byFull = new Map();
  const add = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const e of list) {
    const t = nameTokens(e.full);
    if (t.length < 2) continue;
    const surname = t[t.length - 1];
    add(idx, t[0][0] + '|' + surname, e);
    for (const given of t.slice(0, -1)) add(altIdx, given[0] + '|' + surname, e);
    // Double surnames: TA holds "Diego Dedura Palomero" where the tour (and
    // our roster) says "D. Dedura". Indexed by first initial + EVERY later word.
    for (const w of t.slice(1)) add(anyIdx, t[0][0] + '|' + w, e);
    add(bySet, tokenSet(e.full), e);
    byFull.set(nameTokens(e.full).join(' '), e);
  }
  return { idx, altIdx, anyIdx, bySet, byFull };
}

// Every TA page a profile may be, best first. `ambiguous` marks a list hit that
// shares its initial + surname with another man: it is accepted only when the
// identity check can positively confirm it.
function resolveCandidates(p, ixName, R, L) {
  const out = [], seen = new Set();
  const rankOf = full => { const e = R.byFull.get(nameTokens(full).join(' ')); return e ? e.rank : null; };
  const push = (full, rank, via, ambiguous) => {
    const id = taId(full);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ full, rank, via, id, ambiguous: !!ambiguous });
  };
  const t = nameTokens(p.name);
  if (t.length >= 2) {
    const lookup = t[0][0] + '|' + t[t.length - 1];
    let cands = R.idx.get(lookup);
    if (!cands || !cands.length) {
      // The middle-name index only when it names exactly one player. Two
      // same-surname candidates (A. Zverev / M. Zverev) would be a guess.
      const alt = R.altIdx.get(lookup) || [];
      const uniq = [...new Map(alt.map(c => [c.full, c])).values()];
      cands = uniq.length === 1 ? uniq : null;
    }
    if (cands && cands.length) {
      const hit = cands.slice().sort((a, b) => a.rank - b.rank)[0];
      push(hit.full, hit.rank, 'rank', false);
    }
  }
  if (looksFull(ixName)) {
    const hits = L.bySet.get(tokenSet(ixName)) || [];
    hits.forEach(c => push(c.full, rankOf(c.full), 'index-name', hits.length > 1));
  }
  if (t.length >= 2) {
    // The list by initial + surname, then by initial + any later word (double
    // surnames), each filtered to the given-name initials the profile carries.
    const lookup = t[0][0] + '|' + t[t.length - 1];
    for (const [ix, via] of [[L.idx, 'list'], [R.anyIdx, 'rank-word'], [L.anyIdx, 'list-word']]) {
      const hits = (ix.get(lookup) || []).filter(c => abbrevsFit(p.name, c.full));
      hits.slice(0, 3).forEach(c => push(c.full, c.rank != null ? c.rank : rankOf(c.full), via, hits.length > 1));
    }
  }
  return out;
}

// The page's own identity block (player-classic.cgi carries it as plain vars).
function pageMeta(html) {
  const v = name => { const m = html.match(new RegExp('var ' + name + "\\s*=\\s*'([^']*)'")); return m ? m[1] : null; };
  const n = name => { const m = html.match(new RegExp('var ' + name + '\\s*=\\s*(\\d+)')); return m ? +m[1] : null; };
  return { fullName: v('fullname'), atpId: v('atp_id'), dob: n('dob'), currentRank: n('currentrank') };
}
function ageAt(dob, stamp) {
  if (!dob || !/^\d{8}$/.test(String(dob)) || !/^\d{8}$/.test(String(stamp))) return null;
  const d = String(dob), s = String(stamp);
  let a = +s.slice(0, 4) - +d.slice(0, 4);
  if (s.slice(4) < d.slice(4)) a--;
  return a;
}
// A page is accepted for a profile only when what we hold confirms it or, at
// least, nothing contradicts it:
//   · the ATP id, where player-atp-aliases.json holds one for the key — a match
//     confirms. TA writes some ids as a slug ("martin-damm/d214"); the id is the
//     last part.
//   · the age: the profile's age vs the page's date of birth, one year either way
//     (the profile's age is stamped at its own build date). Ages above 50 are not
//     used: measured 2026-10-07, four profiles carry exactly 56 (nobody between 43
//     and 56) and the three of those with a TA page were born 2005-2009.
// An alias that DISAGREES is decided by the age: the alias table is hand-built for
// headshots and is not always right — M. Damm (1317, 23) is aliased to D214, his
// father's id; the page that matches his age is D0DT. Alias wrong AND age wrong
// (or no age) = rejected.
function normAtpId(id) { return String(id || '').split('/').pop().trim().toUpperCase(); }
function identityCheck(meta, prof, aliasId, today) {
  const age = ageAt(meta.dob, today);
  const pAge = prof && prof.age != null && prof.age !== '' && isFinite(+prof.age) && +prof.age <= 50 ? +prof.age : null;
  const ageOk = age != null && pAge != null ? Math.abs(age - pAge) <= 1 : null;
  if (aliasId && meta.atpId) {
    if (normAtpId(meta.atpId) === normAtpId(aliasId)) return { ok: true, by: 'atp-id' };
    return ageOk ? { ok: true, by: 'age', note: `ATP alias ${aliasId} disagrees with the page's ${meta.atpId}` }
      : { ok: false, why: `ATP id ${meta.atpId} is not ${aliasId}` + (ageOk === false ? `, age ${age} is not ${pAge}` : '') };
  }
  if (ageOk != null) return ageOk ? { ok: true, by: 'age' } : { ok: false, why: `age ${age} is not ${pAge}` };
  return { ok: true, by: 'none' };
}

// The slim row a TOUR-WIDE reader needs per player (career-splits-tour.json
// `pooled`): the legacy profile's tier medians read rank + M + winPct, its Key
// insights engine sums M and W. Same numbers as the player's own file.
function pooledRow(p) {
  const slim = block => {
    const o = {};
    for (const [cat, r] of Object.entries(block || {})) o[cat] = { M: r.M, W: r.W, winPct: r.winPct };
    return o;
  };
  return { rank: p.rank, career: slim(p.career), last52: slim(p.last52) };
}

// Write the per-player files: one file per built player, and every file of a
// player this build did not produce is removed — the old single file was
// replaced whole on every build, and a leftover file would serve a player the
// build no longer stands behind.
function writePlayerFiles(dir, players) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const keep = new Set();
  for (const [key, obj] of Object.entries(players)) {
    fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(obj));
    keep.add(`${key}.json`);
  }
  let removed = 0;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.json') && !keep.has(f)) { fs.unlinkSync(path.join(dir, f)); removed++; }
  }
  return { written: keep.size, removed };
}

async function main() {
  if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true });
  const roster = await loadRoster();
  const index = await loadIndex();
  const indexNames = index.names;
  // TEN-391: every profile a reader can open — the board roster plus every
  // searchable profile (player-index hasProfile -> profiles/<key>.json).
  const extraKeys = (process.env.SPLITS_PROFILES_FILE ? [] : index.profiled).filter(k => !roster.players[k]);
  const extra = await loadProfileShards(extraKeys, indexNames);
  const profiles = Object.assign({}, roster.players, extra);
  const aliases = fs.existsSync(ALIASES) ? JSON.parse(fs.readFileSync(ALIASES, 'utf8')) : {};
  const currRank = await loadCurrRank();
  const menList = await loadMenList();
  const R = nameIndex(Object.entries(currRank).map(([full, rk]) => ({ full, rank: +rk })));
  const L = nameIndex(menList.map((full, order) => ({ full, order })));
  console.log(`Roster: ${Object.keys(roster.players).length} board profiles (${roster.source}) + ${extraKeys.length} search-only profiles; ${Object.keys(indexNames).length} index names; ` +
    `TA ranking list ${Object.keys(currRank).length}, TA men's list ${menList.length}.`);

  // Why a profiled player ends with no file. Reported in the tour file, so
  // "Splits not built for this player yet" is always traceable to a cause.
  const missing = {};
  const work = [];
  for (const [pkey, p] of Object.entries(profiles)) {
    const cands = resolveCandidates(p, indexNames[pkey], R, L);
    if (!cands.length) { missing[pkey] = 'no Tennis Abstract player matches the name'; continue; }
    const rank = cands[0].rank;
    if (rank != null ? rank > RANK_MAX : RANK_MAX !== Infinity) { missing[pkey] = 'outside the requested rank cap'; continue; }
    work.push({ pkey, name: p.name, prof: p, cands, rank });
  }
  work.sort((a, b) => (a.rank == null ? 1e9 : a.rank) - (b.rank == null ? 1e9 : b.rank));
  const targets = work.slice(0, MAX_PLAYERS);
  console.log(`Resolved ${work.length} of ${Object.keys(profiles).length} profiles to a Tennis Abstract name; ingesting ${targets.length}` +
    `${RANK_MAX === Infinity ? ' (no rank cap)' : ` (rank<=${RANK_MAX})`}.`);

  const players = {};
  // Per-player flat match list for the TEN-162 drawer shards, keyed by profile
  // key. Newest-first, matching how the drawer renders. Written after the
  // ingest succeeds so a failed build never publishes empty shards.
  const shardMatches = {};
  let ok = 0, miss = 0, empty = 0, rejected = 0, cached = 0, fetched = 0, staleFallback = 0;
  const viaCount = {};
  const aliasDisagreements = {};
  // Why fetches failed, tallied by reason. Without this a total failure just
  // reports "ingested 0" and gives no way to tell a TA block (403) from a
  // rate-limit (429) from a network fault — they need opposite fixes.
  const why = new Map();
  const note = r => why.set(r, (why.get(r) || 0) + 1);

  // One TA page, cache first (fresh within the TTL), else fetched with backoff
  // on 429, else the stale cached page. `pace` slows the retry pass down.
  async function fetchPage(id, pace) {
    const cacheFile = path.join(CACHE, id + '.html');
    let html = null;
    try {
      const st = fs.existsSync(cacheFile) ? fs.statSync(cacheFile) : null;
      const usable = st && st.size > 5000;
      if (usable && Date.now() - st.mtimeMs < CACHE_TTL_MS) {
        cached++;
        return { html: fs.readFileSync(cacheFile, 'utf8') };
      }
      const url = `https://www.tennisabstract.com/cgi-bin/player-classic.cgi?p=${id}`;
      for (let attempt = 0; attempt < 4 && !html; attempt++) {
        await sleep(pace * (BASE_DELAY_MS + attempt * 1200));
        let status, body;
        try { ({ status, body } = await get(url)); } catch (e) { note(`net:${e.code || e.message}`); continue; }
        if (status === 200 && body.includes('var matchmx')) { html = body; fs.writeFileSync(cacheFile, body); fetched++; }
        else if (status === 429) { note('429'); await sleep(pace * 2500 * (attempt + 1)); }
        else { note(status === 200 ? '200-no-matchmx' : `http:${status}`); return { html: null, final: true }; } // real 404 (name mismatch) — don't hammer
      }
      // TA throttles sustained fetching, so a refetch can fail for a player
      // we already have a page for. Serving that stale page keeps his splits
      // one day old; dropping him removes his table from the site entirely.
      // Stale beats missing.
      if (!html && usable) { staleFallback++; return { html: fs.readFileSync(cacheFile, 'utf8') }; }
    } catch (e) { /* network */ }
    return { html, final: false };
  }

  // Try a target's candidates in order; the first page that passes the identity
  // check decides. Returns 'ok' | 'retry' (a fetch failed: worth another pass)
  // | 'done' (settled without a file; the reason is in `missing`).
  async function ingest(t, pace) {
    let fetchFailed = false;
    const reasons = [];
    for (const c of t.cands) {
      const { html, final } = await fetchPage(c.id, pace);
      if (!html) { if (!final) fetchFailed = true; reasons.push(`${c.full}: ${final ? 'no Tennis Abstract page' : 'page fetch failed'}`); continue; }
      const meta = pageMeta(html);
      const idc = identityCheck(meta, t.prof, aliases[t.pkey], TODAY);
      if (!idc.ok) { rejected++; reasons.push(`${c.full}: identity mismatch (${idc.why})`); continue; }
      if (idc.by === 'none' && c.ambiguous) { reasons.push(`${c.full}: ambiguous name, nothing to confirm it`); continue; }
      if (idc.note) aliasDisagreements[t.pkey] = idc.note;
      const matches = parseMatches(html).filter(isTourLevel);
      if (!matches.length) {
        empty++;
        missing[t.pkey] = `${c.full}: no tour-level matches on Tennis Abstract (Challenger / ITF / qualifying only)`;
        return 'done';
      }
      const cut52 = cutoff52(matches);
      const last52 = matches.filter(m => daysAgoStamp(m.date, cut52));
      players[t.pkey] = {
        taId: c.id, fullName: c.full, rank: c.rank,
        matchesParsed: matches.length, last52Count: last52.length, cutoff52: cut52,
        career: splits(matches),
        last52: splits(last52),
        q7: q7splits(matches),
      };
      // Drawer shard source: the same tour-level matches, newest-first. The
      // client filters to the last-52 window with `d >= cutoff52`, mirroring
      // daysAgoStamp above, so both windows reconcile with the aggregates.
      shardMatches[t.pkey] = matches.slice()
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .map(shardMatch);
      delete missing[t.pkey];
      viaCount[c.via] = (viaCount[c.via] || 0) + 1;
      ok++;
      return 'ok';
    }
    missing[t.pkey] = reasons.join('; ') || 'no candidate page';
    return fetchFailed ? 'retry' : 'done';
  }

  const retry = [];
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const t = targets[cursor++];
      if (await ingest(t, 1) === 'retry') retry.push(t);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // A second, slower, one-at-a-time pass over the players whose page fetch
  // failed (TA's 429s). Hurkacz and Norrie were lost this way under the cap:
  // in range, never built, because one throttled burst used up their retries.
  if (retry.length) {
    console.log(`Retry pass: ${retry.length} player(s) whose page fetch failed.`);
    for (const t of retry) if (await ingest(t, 3) === 'retry') miss++;
  }

  // A run where every fetch failed (egress blocked, TA down) must not overwrite
  // good files with nothing.
  const whyStr = [...why.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} x${n}`).join(', ') || 'none';
  if (!ok) {
    console.error(`ERROR: ingested 0 of ${targets.length} players — leaving ${path.basename(SPLITS_DIR)}/ untouched.`);
    console.error(`Fetch failures: ${whyStr}`);
    process.exit(1);
  }
  if (why.size) console.log(`Fetch failures: ${whyStr}`);

  const pooled = {};
  for (const [k, p] of Object.entries(players)) pooled[k] = pooledRow(p);
  const tour = {
    fetchedAt: TODAY,
    source: 'Jeff Sackmann ATP match data via tennisabstract.com player-classic (matchmx)',
    layout: 'one file per player: career-splits/<profileKey>.json = that player\'s object (taId, fullName, rank, matchesParsed, last52Count, cutoff52, career, last52, q7). No file = genuinely not built (reason in coverage.missing). `pooled` = per-player {rank, career, last52} rows of {M, W, winPct} for tour-wide readers only.',
    window52Rule: 'per player: 364 days before that player\'s most recent tour match (matches tennisabstract)',
    q7Rule: 'q7: quality-form buckets for h2h-model layer #7. Each subset (overall / top50 / surf50.{Hard,Clay,Grass}) is [M0,W0,M1,W1,M2,W2] by recency era (0=<=2yr, 1=2-4yr, 2=4yr+) vs fetchedAt. Opponent rank is at-match-time (matchmx). Recency weights + sample dampening applied model-side.',
    categories: CATEGORIES.map(c => c[0]),
    columns: [
      'M', 'W', 'L', 'winPct', 'setW', 'setL', 'setPct', 'gameW', 'gameL', 'gamePct', 'gameM',
      'tbW', 'tbL', 'tbPct', 'MS', 'hldPct', 'brkPct', 'aPct', 'dfPct', 'firstInPct',
      'firstWonPct', 'secondWonPct', 'spwPct', 'rpwPct', 'ret1WonPct', 'ret2WonPct',
      'bpConvPct', 'tpwPct', 'dr',
    ],
    // Serve columns are measured over MS, not M: they exist only for matches
    // where the source recorded serve counters (~98% since 2025, ~74% career).
    // A row with MS=0 carries no serve keys at all and must render as dashes.
    statsRule: 'serve/return columns are averaged over MS (matches with recorded stats), never over M; absent = no stats recorded, not zero',
    // Founder ruling 2026-09-21, scoped deliberately narrowly: an alternate-format
    // match counts as a MATCH everywhere and leaves only the GAMES columns.
    gamesRule: 'gameW/gameL/gamePct AND tbW/tbL/tbPct are averaged over gameM, not M. gameM excludes matches played on a different games scale (NextGen Finals: best-of-five SHORT sets, first to four, tiebreak at 3-3 rather than 6-6 — so its tiebreaks are differently REACHED as well as its games). Such a match still counts in M/W/L, in the surface row and in the SET columns. A row where gameM < M also carries gameX (the excluded count); a percentage over an empty population is null, never 0.',
    coverage: {
      roster: Object.keys(profiles).length, boardProfiles: Object.keys(roster.players).length, searchOnlyProfiles: extraKeys.length,
      rosterSource: roster.source, aliasDisagreements,
      ingested: ok, noPage: miss, noMatches: empty, identityRejected: rejected, attempted: targets.length,
      fetched, fromCache: cached, staleFallback, resolvedVia: viaCount,
      missing,
    },
    pooled,
  };
  const w = writePlayerFiles(SPLITS_DIR, players);
  fs.writeFileSync(TOUR_OUT, JSON.stringify(tour));
  console.log(`career-splits/: ${w.written} player file(s) written, ${w.removed} obsolete removed; ` +
    `${ok} ingested / ${miss} fetch-failed / ${empty} no tour-level matches / ${rejected} identity-rejected page(s) ` +
    `(${fetched} fetched, ${cached} cached, ${staleFallback} served stale after failed refetch). ` +
    `${Object.keys(missing).length} of ${Object.keys(profiles).length} profiles have no file (reasons in ${path.basename(TOUR_OUT)} coverage.missing).`);

  // ---- TEN-162 drawer shards -------------------------------------------------
  // One lazy per-player shard + an index, written only after a successful build
  // (ok>0, guaranteed by the exit above). The client fetches a shard when a
  // profile's split row is clicked, then reproduces each category from these
  // rows. cutoff52 travels with the shard so the Last-52 window matches exactly.
  if (!fs.existsSync(SHARD_DIR)) fs.mkdirSync(SHARD_DIR, { recursive: true });
  const shardIndex = {};
  let shardRows = 0;
  for (const [pkey, p] of Object.entries(players)) {
    const ms = shardMatches[pkey] || [];
    fs.writeFileSync(path.join(SHARD_DIR, `${pkey}.json`), JSON.stringify({
      key: pkey, taId: p.taId, fullName: p.fullName, rank: p.rank,
      matchesParsed: p.matchesParsed, last52Count: p.last52Count, cutoff52: p.cutoff52,
      matches: ms,
    }));
    shardIndex[pkey] = p.matchesParsed;
    shardRows += ms.length;
  }
  fs.writeFileSync(SHARD_INDEX, JSON.stringify(shardIndex));
  console.log(`splits-matches: ${Object.keys(shardIndex).length} shard(s), ${shardRows} match rows total; index -> ${path.basename(SHARD_INDEX)}.`);
  // A build that fetched nothing is a replay of the cache, not a refresh.
  if (ok && !fetched) console.warn('WARNING: every page came from cache — no fresh data. Check SPLITS_CACHE_TTL_HOURS.');
}

// Exported so the suite can drive the REAL aggregator over fixtures rather than
// re-implementing it — a re-implementation is a second set of bugs that agrees
// with itself. `main()` is now guarded because requiring this file previously
// started a network fetch of every player page the moment it was imported.
module.exports = {
  splits, altFormatOf, gameRecord, setRecord, tbRecord, isTourLevel, CATEGORIES,
  // TEN-391: the roster join, the identity check, and the two writers.
  nameIndex, resolveCandidates, pageMeta, identityCheck, ageAt, pooledRow, writePlayerFiles,
};

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
