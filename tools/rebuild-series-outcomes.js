#!/usr/bin/env node
// TEN-427 step 14 (Series outcomes, founder card 011f0d2d, 11 Oct): REBUILD the outcomes ledger FROM SCRATCH under the
// as-of-start rule — "Rebuild series-outcomes.json from scratch. Don't patch it from today." It writes the committed SEED
// series-outcomes.rebuild.json (never series-outcomes.json, which only the pipeline commit-back writes): build-series.js
// loadLedger discards an old-rule series-outcomes.json and loads this seed instead.
//
// What it does: every ATP / Challenger singles fixture that FINISHED between --from and --to (api-tennis get_fixtures,
// one date-range call per 7 days), both players, is judged by the generator's own judgeAtStart (build-series.js) on
// that player's real history (fetchRecentSinglesFixtures, one call per distinct player) — exactly what each pipeline
// run does for the finished matches on its slate. Nothing is carried over from the existing ledger. Written atomically
// (tmp + rename). The pipeline's next build-series run loads this seed (series-outcomes.json has no as-of-start marker
// yet), merges its own rows and writes series-outcomes.json with the marker (pipeline.yml commits that back).
//
// Calls: 1 get_tournaments when tournament-surfaces.json is over 30 days old + (weeks not in --cache) + (distinct
// players not in --cache). Refuses to write on a surface map over 30 days old or missing any finished fixture's
// tournament, on a week with no fixtures, or on any history failure. --count prints the plan and stops before any player
// call; a plan over --max-calls (default 600) aborts unless --yes.
//
//   API_TENNIS_KEY=… node tools/rebuild-series-outcomes.js --from 2026-09-07 --to 2026-10-10 --count
//   API_TENNIS_KEY=… node tools/rebuild-series-outcomes.js --from 2026-09-07 --to 2026-10-10 --cache DIR [--yes]
//   … --players 123,456 --out /tmp/x.json   (a sample: only those players' rows, never the committed file)
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i < 0 ? dflt : (process.argv[i + 1] || ''); };
const flag = name => process.argv.includes('--' + name);
const FROM = arg('from'), TO = arg('to');
const SEED = path.join(ROOT, 'series-outcomes.rebuild.json');
const OUT = path.resolve(arg('out', SEED));
const CACHE = arg('cache', null) && path.resolve(arg('cache'));
const MAX_CALLS = Number(arg('max-calls', 600));
const ONLY = arg('players', null) ? new Set(arg('players').split(',').map(s => s.trim()).filter(Boolean)) : null;
const CONCURRENCY = 8;

if (!/^\d{4}-\d{2}-\d{2}$/.test(FROM || '') || !/^\d{4}-\d{2}-\d{2}$/.test(TO || '') || FROM > TO) {
  console.error('usage: --from YYYY-MM-DD --to YYYY-MM-DD [--count] [--cache DIR] [--players k,k --out FILE] [--max-calls N] [--yes]');
  process.exit(2);
}
if (!process.env.API_TENNIS_KEY) { console.error('API_TENNIS_KEY not set'); process.exit(2); }
if (ONLY && (OUT === SEED || OUT === path.join(ROOT, 'series-outcomes.json'))) { console.error('a --players sample must not overwrite the seed / ledger: pass --out'); process.exit(2); }

const E = require(path.join(ROOT, 'build-series.js'));
const { fetchRecentSinglesFixtures, loadTournamentSurfaceMap } = require(path.join(ROOT, 'bsp-pipeline.js'));
const DAY = 86400000;
const MAP_MAX_AGE_MS = 30 * DAY;
const ymd = ms => new Date(ms).toISOString().slice(0, 10);

// Cache files are written tmp + rename, so a killed run never leaves half a file that a re-run would trust.
function writeAtomic(file, text) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); }
// A cached file that does not parse is a miss (deleted and fetched again), never a crash with no file named.
function readCached(file) {
  if (!file || !fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    console.error(`cache file ${file} does not parse (${e.message}): refetching`);
    fs.unlinkSync(file);
    return null;
  }
}

async function main() {
  // The surface map the pipeline itself uses: the committed tournament-surfaces.json is refreshed by
  // loadTournamentSurfaceMap when it is over 30 days old, and CI never commits the refresh back, so reading the
  // committed file directly judges Surface runs on a stale map (new tournaments have no surface). Same function,
  // same file (it resolves against the cwd, as in CI), then build-series reads what it wrote.
  process.chdir(ROOT);
  const mapFile = path.join(ROOT, 'tournament-surfaces.json');
  const mapBefore = fs.existsSync(mapFile) ? fs.statSync(mapFile).mtimeMs : 0;
  await loadTournamentSurfaceMap();
  const mapCalls = fs.existsSync(mapFile) && fs.statSync(mapFile).mtimeMs !== mapBefore ? 1 : 0;
  const mapJson = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  const mapAge = Date.now() - Date.parse(mapJson.fetchedAt);
  if (!(mapAge <= MAP_MAX_AGE_MS)) { console.error(`tournament-surfaces.json fetchedAt ${mapJson.fetchedAt} is over 30 days old — nothing written`); process.exit(1); }
  const surfaceMap = mapJson.surfaces || {};
  const styleMap = E.loadStyleMap();
  let meta = {};
  try { meta = E.loadMeta(); } catch (_) { /* names fall back to the feed's */ }

  // 1 · the slates: every finished ATP / Challenger singles fixture in the range
  const weeks = [];
  for (let a = Date.parse(FROM + 'T00:00:00Z'); a <= Date.parse(TO + 'T00:00:00Z'); a += 7 * DAY) {
    weeks.push([ymd(a), ymd(Math.min(a + 6 * DAY, Date.parse(TO + 'T00:00:00Z')))]);
  }
  const finished = [], seen = new Set();
  if (CACHE) fs.mkdirSync(CACHE, { recursive: true });
  let slateFetched = 0;
  for (const [a, b] of weeks) {
    const sf = CACHE ? path.join(CACHE, `slate-${a}-${b}.json`) : null;
    let rows = readCached(sf);
    if (!Array.isArray(rows) || !rows.length) {
      // A week with no `result` (or no ATP / Challenger singles in it) would silently drop that week's rows:
      // refuse, and never cache the empty answer.
      const res = await fetch(`https://api.api-tennis.com/tennis/?method=get_fixtures&APIkey=${process.env.API_TENNIS_KEY}&date_start=${a}&date_stop=${b}`);
      slateFetched++;
      const j = res.ok ? await res.json() : null;
      rows = j && Array.isArray(j.result) ? j.result.filter(fx => E.tierOf(fx)) : [];
      if (!rows.length) { console.error(`get_fixtures ${a}..${b} returned no ATP / Challenger fixtures (HTTP ${res.status}, success ${j && j.success}) — nothing written`); process.exit(1); }
      if (sf) writeAtomic(sf, JSON.stringify(rows));
    }
    for (const fx of rows) {
      const tier = E.tierOf(fx);
      const d = String(fx.event_date || '');
      if (!tier || d < FROM || d > TO || seen.has(String(fx.event_key))) continue;
      if (!(E.FINAL_STATUSES.includes(fx.event_status) || fx.event_winner != null)) continue;
      seen.add(String(fx.event_key));
      finished.push({ fx, tier });
    }
  }
  // Every finished fixture's tournament must be in the map (a key the map has never seen = a map older than the
  // tournament); a key present with a null surface is the feed's own "no surface" and is fine.
  const unmapped = [...new Set(finished.map(({ fx }) => String(fx.tournament_key)).filter(k => !Object.prototype.hasOwnProperty.call(surfaceMap, k)))];
  if (unmapped.length) { console.error(`${unmapped.length} tournament key(s) missing from tournament-surfaces.json (fetchedAt ${mapJson.fetchedAt}): ${unmapped.slice(0, 20).join(',')} — nothing written`); process.exit(1); }
  const jobs = [];                       // { pk, tier, fx, side }
  for (const { fx, tier } of finished) {
    for (const side of ['first', 'second']) {
      const pk = String(side === 'first' ? fx.first_player_key : fx.second_player_key);
      if (!pk || pk === 'null' || pk === 'undefined') continue;
      if (ONLY && !ONLY.has(pk)) continue;
      jobs.push({ pk, tier, fx, side });
    }
  }
  const players = [...new Set(jobs.map(j => j.pk))];
  const cached = pk => CACHE && fs.existsSync(path.join(CACHE, pk + '.json'));
  const toFetch = players.filter(pk => !cached(pk));
  const plan = { from: FROM, to: TO, surfaceMapFetchedAt: mapJson.fetchedAt, surfaceMapCalls: mapCalls, slateCalls: weeks.length,
    slateCallsMadeNow: slateFetched, finishedFixtures: finished.length, playerMatches: jobs.length, players: players.length,
    playerCalls: toFetch.length, totalCalls: mapCalls + slateFetched + toFetch.length };
  console.error(JSON.stringify(plan));
  if (flag('count')) return;
  if (plan.totalCalls > MAX_CALLS && !flag('yes')) { console.error(`plan is ${plan.totalCalls} calls > --max-calls ${MAX_CALLS}: stopping (pass --yes to run it)`); process.exit(3); }

  // 2 · each player's real history (one call per player; a cache dir keeps a re-run from paying twice), and
  // 3 · judge every finished match of his on the runs as they stood at its start — the generator's own judgeAtStart.
  // A player's history is judged as soon as it loads and then dropped: ~850 full histories (point-by-point included)
  // do not fit in the heap together.
  const jobsOf = new Map();
  for (const j of jobs) { const l = jobsOf.get(j.pk) || []; l.push(j); jobsOf.set(j.pk, l); }
  const records = {};
  let next = 0, failed = [], playerFetched = 0;
  function judgePlayer(pk, fxs) {
    for (const { tier, fx, side } of jobsOf.get(pk)) {
      const ctx = E.slateCtx(fx, side, null, surfaceMap, styleMap);
      const pr = E.recordFor(fx, pk, tier, surfaceMap, styleMap, tier === 'tour');
      Object.assign(records, E.judgeAtStart(fxs, pk, tier, ctx, pr, surfaceMap, styleMap, (meta[pk] && meta[pk].name) || null));
    }
  }
  async function worker() {
    while (next < players.length) {
      const pk = players[next++];
      const f = CACHE ? path.join(CACHE, pk + '.json') : null;
      const hit = readCached(f);
      if (Array.isArray(hit) && hit.length) { judgePlayer(pk, hit); continue; }
      try {
        const fxs = await fetchRecentSinglesFixtures(pk);
        playerFetched++;
        if (!Array.isArray(fxs) || !fxs.length) { failed.push(pk); continue; }
        if (f) writeAtomic(f, JSON.stringify(fxs));
        judgePlayer(pk, fxs);
      } catch (e) { failed.push(pk); }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // A player whose history did not load would silently lose his rows: the rebuild is refused instead.
  if (failed.length) { console.error(`history failed for ${failed.length} player(s): ${failed.slice(0, 20).join(',')} — nothing written; re-run (the cache keeps what loaded)`); process.exit(1); }
  const sorted = {};
  for (const k of Object.keys(records).sort((a, b) => String(records[a].date).localeCompare(String(records[b].date)) || a.localeCompare(b))) sorted[k] = records[k];
  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ rule: E.LEDGER_RULE, records: sorted }, null, 0));
  fs.renameSync(tmp, OUT);
  const tally = {};
  for (const r of Object.values(sorted)) {
    const t = tally[r.family] || (tally[r.family] = { runs: 0, held: 0, broken: 0, notEvaluable: 0 });
    t.runs++; if (r.held === true) t.held++; else if (r.held === false) t.broken++; else t.notEvaluable++;
  }
  console.error(JSON.stringify({ written: path.relative(process.cwd(), OUT), records: Object.keys(sorted).length,
    callsMade: { surfaceMap: mapCalls, slates: slateFetched, histories: playerFetched }, byFamily: tally }));
}

main().catch(e => { console.error('rebuild-series-outcomes:', e.stack || e.message); process.exit(1); });
