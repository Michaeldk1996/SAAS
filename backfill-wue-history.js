#!/usr/bin/env node
// =============================================================================
// TEN-66 — Winners / Unforced-Errors HISTORICAL BACKFILL (roster-wide, api-tennis)
// -----------------------------------------------------------------------------
// WHY: the archetype classifier's W/UE axis is fed by Match Charting (~6 matches
//   /player, sparse + old). api-tennis tour+challenger box scores carry the same
//   whole-match Winners / Unforced-Errors at ~4x the sample and self-update. This
//   script builds a DURABLE, committed per-player W/UE store so we never re-probe.
//
// STRATEGY — date-range sweep (NOT per-player):
//   One windowed get_fixtures returns EVERY finished singles match in that window
//   WITH inline match statistics, so a single call harvests the whole roster at
//   once. We walk 7-DAY windows from the stats floor (2024-03-06, Indian Wells '24
//   — no box-score statistics of ANY kind exist before that day on this feed)
//   forward to today, for both ATP Singles (265) and Challenger Men Singles (281).
//   Full backfill ~= 127 windows x 2 event types ~= 254 reads; incremental re-runs
//   only fetch windows without a settled cache file.
//
// INCREMENTAL / DO-NOT-RE-PULL-SETTLED:
//   Each (eventType, windowStart) response is cached under apitennis-wue-cache/.
//   A window whose stop date is older than SETTLE_DAYS is treated as permanently
//   settled and is never re-fetched. The trailing (still-completing) windows are
//   re-pulled when their cache is older than TTL_HOURS. So a daily re-run costs
//   only the 1-2 live windows, and the cursor advances forward automatically.
//
// LITERAL-0 FILTER (hard rule): a literal "0" for Winners or Unforced Errors ==
//   MISSING data, not a real zero (known feed junk). A player-match is counted
//   toward the W/UE aggregate ONLY if winners>0 AND unforced>0 AND totalPoints>0.
//   Player-matches with stats present but W or UE literal-0/absent are tallied as
//   excludedZero (reported, never averaged in).
//
// DENOMINATOR: Points/"Total Points Won".stat_total == service + return points ==
//   all points that player contested. winnersRate / unforcedRate are per-100-pts
//   over that denominator, which is the SAME convention the Match-Charting corpus
//   (extract-archetype-stat-inputs.js) uses (serve_pts + return_pts), so the two
//   sources are directly comparable for the label-flip gate re-run.
//
// OUTPUT: player-wue-history.json — { _meta, players: { playerKey: {...} } }
//
// Usage:  node backfill-wue-history.js            # incremental (default)
//         node backfill-wue-history.js --full     # ignore cache freshness, re-scan
//         node backfill-wue-history.js --from=2025-01-01   # override start cursor
// =============================================================================
const fs = require('fs');
const path = require('path');

const REPO = __dirname;
const ENV = fs.readFileSync(path.join(REPO, '.env'), 'utf8');
const API_KEY = (ENV.match(/API_TENNIS_KEY=(\S+)/) || [])[1];
if (!API_KEY) { console.error('API_TENNIS_KEY missing in .env'); process.exit(1); }
const BASE = 'https://api.api-tennis.com/tennis/';

const STATS_FLOOR = '2024-03-06';           // no box-score stats exist before this day
const SETTLE_DAYS = 4;                        // windows older than this never change
const TTL_HOURS = 12;                         // re-pull live windows older than this
const EVENT_TYPES = [
  { key: '265', tier: 'ATP' },
  { key: '281', tier: 'Challenger' },
];
const CACHE = path.join(REPO, 'apitennis-wue-cache');
const OUT = path.join(REPO, 'player-wue-history.json');

const args = process.argv.slice(2);
const FULL = args.includes('--full');
const fromArg = (args.find(a => a.startsWith('--from=')) || '').split('=')[1];
const START = fromArg || STATS_FLOOR;

// ---- date helpers (UTC, no wall-clock dependence beyond "today") ----
const MS_DAY = 86400000;
const toISO = d => d.toISOString().slice(0, 10);
const parse = s => new Date(s + 'T00:00:00Z');
const addDays = (s, n) => toISO(new Date(parse(s).getTime() + n * MS_DAY));
const TODAY = toISO(new Date());

// ---- metered fetch with retry ----
let READS = 0;
async function fetchJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 45000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      const j = await r.json();
      return j;
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise(res => setTimeout(res, 1500 * (i + 1)));
    }
  }
}

// ---- stat extraction ----
function pick(rows, type, name) {
  const nl = name.toLowerCase();
  return rows.find(s => s.stat_type === type && String(s.stat_name).toLowerCase() === nl);
}
const numOrNull = v => { const x = Number(v); return Number.isFinite(x) ? x : null; };

// Pull one player's whole-match W/UE block from a fixture's match-period rows.
// Returns null if the player's rows are absent. { winners, unforced, totPts, sec2Won, sec2Tot }
function wueBlock(matchRows, playerKey) {
  const rows = matchRows.filter(s => String(s.player_key) === String(playerKey));
  if (!rows.length) return null;
  const wr = pick(rows, 'Points', 'Winners');
  const ur = pick(rows, 'Points', 'Unforced Errors');
  const tp = pick(rows, 'Points', 'Total Points Won');
  const s2 = pick(rows, 'Service', '2nd Serve Points Won');
  return {
    winners: wr ? numOrNull(wr.stat_value) : null,
    unforced: ur ? numOrNull(ur.stat_value) : null,
    totPts: tp ? numOrNull(tp.stat_total) : null,
    sec2Won: s2 ? numOrNull(s2.stat_won) : null,
    sec2Tot: s2 ? numOrNull(s2.stat_total) : null,
  };
}

// ---- aggregation ----
// agg[playerKey] = { name, w, ue, tp, s2w, s2t, nWue, nSeen, excludedZero,
//                    tier:{ATP:{w,ue,tp,n}, Challenger:{...}}, tourn:{name:n} }
const agg = {};
function ensure(pk, name) {
  if (!agg[pk]) agg[pk] = {
    name, w: 0, ue: 0, tp: 0, s2w: 0, s2t: 0, nWue: 0, nSeen: 0, excludedZero: 0,
    tier: {}, tourn: {},
  };
  const e = agg[pk];
  if (name && (!e.name || e.name.length < name.length)) e.name = name; // prefer fuller name
  return e;
}

// Guard against double-counting a player-match if windows ever overlap at a boundary.
const seenPM = new Set();

function ingestFixture(f, tier) {
  if (!/finished/i.test(f.event_status || '')) return;
  if (f.event_type_type && !/single/i.test(f.event_type_type)) return;
  if (!Array.isArray(f.statistics) || !f.statistics.length) return;
  const matchRows = f.statistics.filter(s => s.stat_period === 'match');
  if (!matchRows.length) return;
  const p1 = String(f.first_player_key), p2 = String(f.second_player_key);
  const n1 = f.event_first_player, n2 = f.event_second_player;
  const tname = f.tournament_name || 'Unknown';
  const ekey = String(f.event_key || `${p1}:${p2}:${f.event_date}`);
  for (const [pk, name] of [[p1, n1], [p2, n2]]) {
    if (!pk || pk === 'null') continue;
    const pmId = `${ekey}:${pk}`;
    if (seenPM.has(pmId)) continue;
    seenPM.add(pmId);
    const b = wueBlock(matchRows, pk);
    if (!b) continue;
    const e = ensure(pk, name);
    e.nSeen++;
    // 2nd-serve captured whenever present (serve axis is ~100% covered across tiers)
    if (b.sec2Won != null && b.sec2Tot != null && b.sec2Tot > 0) { e.s2w += b.sec2Won; e.s2t += b.sec2Tot; }
    // literal-0 filter: W and UE must both be present-and-nonzero, with a real denominator
    const usable = b.winners > 0 && b.unforced > 0 && b.totPts > 0;
    if (!usable) {
      // stats present for this player but W/UE junk -> excluded (only if the row actually had a W or UE cell)
      if (b.winners != null || b.unforced != null) e.excludedZero++;
      continue;
    }
    e.w += b.winners; e.ue += b.unforced; e.tp += b.totPts; e.nWue++;
    if (!e.tier[tier]) e.tier[tier] = { w: 0, ue: 0, tp: 0, n: 0 };
    const t = e.tier[tier]; t.w += b.winners; t.ue += b.unforced; t.tp += b.totPts; t.n++;
    e.tourn[tname] = (e.tourn[tname] || 0) + 1;
  }
}

// ---- window sweep ----
async function run() {
  fs.mkdirSync(CACHE, { recursive: true });
  const windows = [];
  for (let s = START; s <= TODAY; s = addDays(s, 7)) {
    const stop = addDays(s, 6);
    windows.push({ start: s, stop: stop > TODAY ? TODAY : stop });
  }
  let fetched = 0, cached = 0, empty = 0;
  for (const et of EVENT_TYPES) {
    for (const w of windows) {
      const cf = path.join(CACHE, `${et.key}-${w.start}.json`);
      const settled = parse(w.stop).getTime() < parse(TODAY).getTime() - SETTLE_DAYS * MS_DAY;
      let result = null;
      if (fs.existsSync(cf) && !FULL) {
        const ageH = (Date.now() - fs.statSync(cf).mtimeMs) / 3.6e6;
        if (settled || ageH < TTL_HOURS) {
          try { result = JSON.parse(fs.readFileSync(cf, 'utf8')); cached++; } catch (_) { result = null; }
        }
      }
      if (result == null) {
        const url = `${BASE}?method=get_fixtures&APIkey=${API_KEY}&date_start=${w.start}&date_stop=${w.stop}&event_type_key=${et.key}`;
        let j;
        try { j = await fetchJSON(url); READS++; }
        catch (e) { console.error(`  ${et.tier} ${w.start}: FETCH_ERR ${e.message}`); continue; }
        if (j && j.success === 0) { console.error(`  ${et.tier} ${w.start}: api-fail`); continue; }
        result = Array.isArray(j.result) ? j.result : [];
        try { fs.writeFileSync(cf, JSON.stringify(result)); } catch (_) {}
        fetched++;
      }
      if (!result.length) empty++;
      for (const f of result) ingestFixture(f, et.tier);
    }
  }

  // ---- finalize dataset ----
  const players = {};
  for (const [pk, e] of Object.entries(agg)) {
    if (e.nWue === 0 && e.excludedZero === 0 && e.s2t === 0) continue; // nothing usable at all
    const tierOut = {};
    for (const [t, v] of Object.entries(e.tier)) {
      tierOut[t] = {
        matches: v.n,
        winnersRate: v.tp ? +(100 * v.w / v.tp).toFixed(2) : null,
        unforcedRate: v.tp ? +(100 * v.ue / v.tp).toFixed(2) : null,
        ratio: v.ue ? +(v.w / v.ue).toFixed(3) : null,
      };
    }
    players[pk] = {
      playerKey: pk,
      name: e.name,
      winnersRate: e.tp ? +(100 * e.w / e.tp).toFixed(2) : null,   // per-100-points
      unforcedRate: e.tp ? +(100 * e.ue / e.tp).toFixed(2) : null, // per-100-points
      ratio: e.ue ? +(e.w / e.ue).toFixed(3) : null,               // W / UE
      matches: e.nWue,                                             // usable W/UE matches
      secondServeWonPct: e.s2t ? +(100 * e.s2w / e.s2t).toFixed(2) : null,
      excludedZeroMatches: e.excludedZero,                         // literal-0 W or UE, dropped
      matchesSeen: e.nSeen,                                        // finished singles seen w/ stats
      tierBreakdown: tierOut,
      tournamentBreakdown: e.tourn,
      _totals: { winners: e.w, unforced: e.ue, totalPoints: e.tp },
      source: `api-tennis box scores (event_type 265+281), ${STATS_FLOOR}..${TODAY}`,
    };
  }
  const ordered = Object.values(players).sort((a, b) => b.matches - a.matches);
  const out = {
    _meta: {
      task: 'TEN-66',
      purpose: 'Durable roster-wide Winners/Unforced-Errors store from api-tennis box scores; feeds the archetype W/UE axis (Attacking-Baseliner winner-volume flag + Solid-Baseliner clean-error gate) at ~4x the Match-Charting sample.',
      statsFloor: STATS_FLOOR,
      through: TODAY,
      eventTypes: EVENT_TYPES.map(e => `${e.key} (${e.tier})`),
      window: '7-day non-overlapping',
      denominator: 'Points/"Total Points Won".stat_total (service+return points), same convention as the Match-Charting corpus',
      literalZeroRule: 'A literal 0 for Winners or Unforced Errors is MISSING, not a real zero; such player-matches are excluded and tallied in excludedZeroMatches.',
      scale: 'winnersRate/unforcedRate are per-100-points; ratio = winners/unforced',
      incremental: `Cached per (eventType,windowStart) under apitennis-wue-cache/. Windows older than ${SETTLE_DAYS}d are settled and never re-pulled; live windows re-pull after ${TTL_HOURS}h. Re-run advances the cursor to today automatically.`,
      reproduce: 'node backfill-wue-history.js  (incremental) | --full to re-scan | --from=YYYY-MM-DD to move the start cursor',
      counts: {
        playersStored: ordered.length,
        playersWithUsableWue: ordered.filter(p => p.matches > 0).length,
        players_ge10_matches: ordered.filter(p => p.matches >= 10).length,
        readsThisRun: READS,
      },
    },
    players: Object.fromEntries(ordered.map(p => [p.playerKey, p])),
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`\nWROTE ${OUT}`);
  console.log(`windows: fetched=${fetched} cached=${cached} empty=${empty} | api reads this run=${READS}`);
  console.log(JSON.stringify(out._meta.counts, null, 1));
}
run().catch(e => { console.error(e); process.exit(1); });
