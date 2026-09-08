'use strict';
/**
 * build-points-at-risk.js — TEN-173 production generator.
 *
 * Emits `points-at-risk.json`: for every ATP-singles player who appears in the
 * trailing-52-week window, the sum of ranking points currently ON their ranking
 * (= points-at-risk, since each event's points drop on its 52-week anniversary),
 * resolved edition-by-edition through the verified resolver (points-resolver.js)
 * behind the fail-closed round-integrity + tier gates (round-integrity-qa.js).
 *
 * Artifact shape (keyed by player_key string):
 *   {
 *     _meta: { asOf, windowWeeks, windowStart, generatedFrom, tierMapVersion,
 *              pointsTableVersion, playerCount },
 *     players: {
 *       "<player_key>": {
 *         points: <int>,            // resolvable points-at-risk (a FLOOR: dashes excluded)
 *         coverage: "complete"|"partial"|"gap",
 *         resolvedCount, gapCount, benignDashCount,
 *         perEvent: [ { event, season, round, points, flags } ],   // resolved, desc by points
 *         dashed:   [ { event, season, reason, gap } ]             // for provenance
 *       }, ...
 *     }
 *   }
 *
 * A player with NO resolvable in-window main-tour event is OMITTED entirely
 * (the tile then shows a dash — never a 0). points is a FLOOR: it excludes
 * Challengers (out of main-tour scope), team/finals events (dash by rule), and
 * any edition failing the fail-closed gate. `coverage:"gap"` flags a real data
 * gap; benign dashes (rule/in-progress) do not degrade coverage.
 *
 * Usage:
 *   node build-points-at-risk.js \
 *     --tier <atp-tier-map-v1.json> --table <atp-points-table-v1.json> \
 *     --window <harvested-window.json>|--harvest --asof YYYY-MM-DD --out <path>
 *
 * Touches NONE of the TEN-172 do-not-touch files. Standalone artifact.
 */
const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const { resolveEdition, MS_PER_WEEK } = require('./points-resolver.js');
const { validateEdition, isPlayed } = require('./round-integrity-qa.js');
const { classifyRound, ROUND_RANK } = require('./round-classify.js');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const HERE = __dirname;
const AS_OF = arg('asof', '2026-09-08');
const TIER_PATH = arg('tier', path.join(HERE, 'atp-tier-map-v1.json'));
const TABLE_PATH = arg('table', path.join(HERE, 'atp-points-table-v1.json'));
const OUT = arg('out', path.join(HERE, 'points-at-risk.json'));
const WINDOW_START_MS = new Date(AS_OF + 'T00:00:00Z').getTime() - 52 * MS_PER_WEEK;
const GS = new Set(['Australian Open', 'French Open', 'Roland Garros', 'Wimbledon', 'US Open']);

// ---- window fixtures -------------------------------------------------------
let windowPath = arg('window', null);
if (!windowPath || arg('harvest', false) === true) {
  windowPath = path.join(require('os').tmpdir(), 'par_window_' + AS_OF + '.json');
  const start = new Date(WINDOW_START_MS).toISOString().slice(0, 10);
  console.error(`harvesting window ${start}..${AS_OF} -> ${windowPath}`);
  cp.execSync(`node ${path.join(HERE, 'harvest-window.mjs')} ${windowPath} ${AS_OF} ${start}`, { stdio: 'inherit', cwd: process.cwd() });
}
const windowFx = JSON.parse(fs.readFileSync(windowPath, 'utf8')).result;
const tierMap = JSON.parse(fs.readFileSync(TIER_PATH, 'utf8'));
const pointsTable = JSON.parse(fs.readFileSync(TABLE_PATH, 'utf8'));

// key -> tier-map event (join by tournament_keys)
const keyToEvent = new Map();
for (const [name, e] of Object.entries(tierMap.events)) {
  for (const k of e.tournament_keys || []) keyToEvent.set(k, { name, ...e });
}

// group window fixtures by edition (tournament_key + season)
const editions = new Map();
const players = new Map(); // player_key -> display name (last seen)
for (const f of windowFx) {
  const ev = keyToEvent.get(f.tournament_key);
  const isGS = ev ? ev.tier === 'GrandSlam' : GS.has(f.tournament_name || '');
  const ekey = f.tournament_key + '|' + f.tournament_season;
  if (!editions.has(ekey)) editions.set(ekey, { tournament_key: f.tournament_key, season: f.tournament_season, name: f.tournament_name, ev, fx: [] });
  editions.get(ekey).fx.push({ ...f, isGrandSlam: isGS });
  if (f.first_player_key != null) players.set(String(f.first_player_key), f.event_first_player || players.get(String(f.first_player_key)));
  if (f.second_player_key != null) players.set(String(f.second_player_key), f.event_second_player || players.get(String(f.second_player_key)));
}

// per-edition derived draw + QA gate + in-progress flag
const playerEditions = new Map();
for (const [ekey, ed] of editions) {
  let main = 0;
  for (const f of ed.fx) {
    if (!isPlayed(f) || !String(f.tournament_round || '').trim()) continue;
    const c = classifyRound({ tournamentRound: f.tournament_round, qualification: f.event_qualification, isGrandSlam: f.isGrandSlam, tournamentName: f.tournament_name, finalScore: f.event_final_result, status: f.event_status });
    if (!c.qualifying && ROUND_RANK[c.code] != null) main++;
  }
  ed.derivedDraw = main > 0 ? main + 1 : null;
  const LIVE = ed.fx.some((f) => { const s = String(f.event_status || '').trim(); return s && !['Finished', 'Retired', 'Walk Over', 'Cancelled'].includes(s); });
  const maxDate = ed.fx.reduce((m, f) => (f.event_date && f.event_date > m ? f.event_date : m), '');
  const hasFinal = ed.fx.some((f) => isPlayed(f) && /Final/.test(f.tournament_round || '') && !/Semi/.test(f.tournament_round || ''));
  const recent = maxDate && (new Date(AS_OF) - new Date(maxDate)) / 86400000 <= 10;
  ed.inProgress = LIVE || (!hasFinal && recent);
  for (const f of ed.fx) {
    for (const pk of [f.first_player_key, f.second_player_key]) {
      if (pk == null) continue;
      if (!playerEditions.has(String(pk))) playerEditions.set(String(pk), new Set());
      playerEditions.get(String(pk)).add(ekey);
    }
  }
}

// ---- resolve every player in the window -----------------------------------
const outPlayers = {};
const cov = { complete: 0, partial: 0, gap: 0 };
for (const [pk, eks] of playerEditions) {
  let sum = 0; const resolved = []; const dashed = [];
  for (const ekey of eks) {
    const ed = editions.get(ekey);
    const tierInfo = ed.ev
      ? { tier: ed.ev.tier, confirmed: ed.ev.confirmed, confirmed_seasons: ed.ev.confirmed_seasons, season: ed.season, draw_size: ed.derivedDraw || ed.ev.draw_size_most_recent }
      : { tier: null, confirmed: false };
    const r = resolveEdition({ editionFixtures: ed.fx, playerKey: pk, tierInfo, pointsTable });
    if (r.awardMs != null && r.awardMs < WINDOW_START_MS) continue;         // already rolled off
    if (r.reason === 'player has no fixtures at this edition') continue;
    if (r.dash) {
      const benign = r.flags.includes('non-round-event') || ed.inProgress;
      dashed.push({ event: ed.name, season: ed.season, reason: r.reason, flags: r.flags, gap: !benign });
    } else {
      sum += r.points;
      resolved.push({ event: ed.name, season: ed.season, round: r.key, points: r.points, flags: r.flags });
    }
  }
  if (!resolved.length && !dashed.some((d) => d.gap)) continue; // no in-window main-tour footprint -> omit (tile dashes)
  const gaps = dashed.filter((d) => d.gap);
  const coverage = gaps.length === 0 ? (resolved.length ? 'complete' : 'gap') : (resolved.length ? 'partial' : 'gap');
  cov[coverage]++;
  resolved.sort((a, b) => b.points - a.points);
  outPlayers[pk] = {
    player: players.get(pk) || null,
    points: sum,
    coverage,
    resolvedCount: resolved.length,
    gapCount: gaps.length,
    benignDashCount: dashed.length - gaps.length,
    perEvent: resolved,
    // keep only real data-gap dashes for provenance; benign (rule/in-progress)
    // dashes are summarised by benignDashCount and would bloat the artifact.
    dashed: gaps,
  };
}

const out = {
  _meta: {
    asOf: AS_OF,
    windowWeeks: 52,
    windowStart: new Date(WINDOW_START_MS).toISOString().slice(0, 10),
    generatedFrom: path.basename(windowPath),
    tierMapVersion: (tierMap._meta && tierMap._meta.version) || null,
    pointsTableVersion: (pointsTable._meta && pointsTable._meta.version) || null,
    playerCount: Object.keys(outPlayers).length,
    coverageCounts: cov,
    note: 'points = resolvable points-at-risk FLOOR (excludes Challengers, team/finals dash-by-rule events, and fail-closed editions). Missing player => dash, never 0.',
  },
  players: outPlayers,
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.error(`WROTE ${OUT}  players=${out._meta.playerCount}  coverage=${JSON.stringify(cov)}`);
