// =================================================================
// Current-season api-tennis supplement for classify-styles.js
// -----------------------------------------------------------------
// WHY: the tour classifier's only serve-stat source is the TML mirror, which
//   lags the live season (its 2026 file holds ~130 matches total). So current
//   breakouts (Jodar, Budkov Kjaer) have ~0 TML rows, fail the MIN_MATCHES /
//   MIN_SVPT floor, and get no playing style — even after 40+ real ATP matches.
//   Our own api-tennis feed carries their current-season matches WITH the full
//   per-match serve/return stat catalog. This module fetches, per candidate
//   player, that player's current-season ATP-singles fixtures (statistics are
//   inline — one request each) and returns per-match { me, op, won, surface }
//   serve blocks in the SAME shape classify-styles.js's accum() consumes, so the
//   supplemented player is scored by the identical 6-axis math. Players already
//   qualified by TML are never supplemented (no double counting, no regression).
//
// Stat mapping (verified live 2026-08-06 off a real Jodar fixture) — match
//   stat_name case-INSENSITIVELY (the feed lowercased names at the 2025/26
//   boundary) and stat_type exactly:
//     svpt     = Points  / Service Points Won        .stat_total
//     firstIn  = Service / 1st serve points won      .stat_total  (1st serves in)
//     firstWon = Service / 1st serve points won      .stat_won
//     secondWon= Service / 2nd serve points won      .stat_won
//     ace      = Service / Aces                       .stat_value
//     df       = Service / Double Faults              .stat_value
//     svGms    = Games   / Service games won          .stat_total
//     bpFaced  = Service / Break Points Saved         .stat_total
//     bpSaved  = Service / Break Points Saved         .stat_won
// =================================================================
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.api-tennis.com/tennis/';

// One player, one season, statistics inline — mirrors bsp-pipeline.js
// fetchPlayerFixturesForYear. Returns [] on success-with-no-result, null on error.
// dateStart (optional, TEN-107): style callers omit it and get `${year}-01-01`
//   — byte-identical behaviour. The hold/break harvester passes a rolling
//   24-month date_start so the api-tennis get_fixtures quirks (event_type_key,
//   inline stats/pbp) stay defined in exactly ONE place.
async function fetchPlayerFixturesForYear(apiKey, playerKey, year, dateStop, dateStart) {
  const start = dateStart || `${year}-01-01`;
  const url = `${API_BASE}?method=get_fixtures&APIkey=${apiKey}&date_start=${start}&date_stop=${dateStop}&player_key=${playerKey}&event_type_key=265`;
  let res;
  try { res = await fetch(url); } catch (e) { return null; }
  if (!res || !res.ok) return null;
  let data;
  try { data = await res.json(); } catch (e) { return null; }
  if (!data || !data.success) return [];
  return Array.isArray(data.result) ? data.result : [];
}

// case-insensitive stat_name; stat_type exact; .find() takes the FIRST match, which
// also discards the feed's occasional trailing duplicate match-period fragment block.
function pickStat(rows, type, name) {
  const nl = name.toLowerCase();
  return rows.find(s => s.stat_type === type && String(s.stat_name).toLowerCase() === nl);
}
function num(v) { const x = parseInt(v, 10); return Number.isFinite(x) ? x : null; }

// Build one player's serve block for a single fixture from its match-period stat rows.
// Returns null if the essential counters (service points + 1st-serve points) are absent.
function serveBlock(matchRows, playerKey) {
  const rows = matchRows.filter(s => String(s.player_key) === String(playerKey));
  if (!rows.length) return null;
  const svptRow = pickStat(rows, 'Points', 'Service Points Won');
  const firstRow = pickStat(rows, 'Service', '1st serve points won');
  const secondRow = pickStat(rows, 'Service', '2nd serve points won');
  const bpsRow = pickStat(rows, 'Service', 'Break Points Saved');
  const gamesRow = pickStat(rows, 'Games', 'Service games won');
  const aceRow = pickStat(rows, 'Service', 'Aces');
  const dfRow = pickStat(rows, 'Service', 'Double Faults');
  const svpt = svptRow ? num(svptRow.stat_total) : null;
  const firstIn = firstRow ? num(firstRow.stat_total) : null;
  if (svpt == null || firstIn == null || svpt <= 0) return null;
  if (firstIn > svpt) return null;                                   // corrupt row
  const b = {
    svpt, firstIn,
    firstWon: firstRow ? (num(firstRow.stat_won) || 0) : 0,
    secondWon: secondRow ? (num(secondRow.stat_won) || 0) : 0,
    ace: aceRow ? (num(aceRow.stat_value) || 0) : 0,
    df: dfRow ? (num(dfRow.stat_value) || 0) : 0,
    svGms: gamesRow ? (num(gamesRow.stat_total) || 0) : 0,
    bpFaced: bpsRow ? (num(bpsRow.stat_total) || 0) : 0,
    bpSaved: bpsRow ? (num(bpsRow.stat_won) || 0) : 0,
  };
  if (b.firstWon > b.firstIn) b.firstWon = b.firstIn;               // clamp corrupt ratios
  if (b.bpSaved > b.bpFaced) b.bpSaved = b.bpFaced;
  return b;
}

// Convert one player's raw fixtures into accum-ready per-match records.
// Keeps only decided, finished singles with BOTH players' serve blocks present
// (mirrors TML rows, where serve+return are always paired).
function buildFixtures(fixtures, playerKey, surfaceMap, year) {
  const out = [];
  const pk = String(playerKey);
  for (const f of fixtures) {
    if (!/finished/i.test(f.event_status || '')) continue;
    if (f.event_type_type && !/single/i.test(f.event_type_type)) continue;
    if (f.event_winner !== 'First Player' && f.event_winner !== 'Second Player') continue;
    if (String(f.event_date || '').slice(0, 4) !== String(year)) continue;
    if (!Array.isArray(f.statistics) || !f.statistics.length) continue;
    const matchRows = f.statistics.filter(s => s.stat_period === 'match');
    if (!matchRows.length) continue;
    const p1 = String(f.first_player_key), p2 = String(f.second_player_key);
    if (pk !== p1 && pk !== p2) continue;
    const isFirst = pk === p1;
    const oppKey = isFirst ? p2 : p1;
    const me = serveBlock(matchRows, pk);
    const op = serveBlock(matchRows, oppKey);
    if (!me || !op) continue;                                        // need both, like a TML row
    const won = (f.event_winner === 'First Player' && isFirst) || (f.event_winner === 'Second Player' && !isFirst);
    let surface = 'other';
    const sm = surfaceMap.get(String(f.tournament_key));
    if (sm === 'clay' || sm === 'hard' || sm === 'grass') surface = sm;
    out.push({ me, op, won, surface, oppKey, tourneyKey: String(f.tournament_key || '') + ':' + year });
  }
  return out;
}

// Main entry. candidates: [{ playerKey, name, rank }]. Returns per-player built fixtures.
// Caches raw fixtures per player+year (TTL hours) so intra-day re-runs are free.
async function supplement(candidates, opts) {
  const { apiKey, year, dateStop, surfaceMap, cacheDir, log = () => {}, ttlHours = 20 } = opts;
  const result = [];
  let fetched = 0, cacheHit = 0, errored = 0;
  for (const c of candidates) {
    const cacheFile = cacheDir ? path.join(cacheDir, `${c.playerKey}-${year}.json`) : null;
    let fixtures = null;
    if (cacheFile && fs.existsSync(cacheFile)) {
      const ageH = (Date.now() - fs.statSync(cacheFile).mtimeMs) / 3.6e6;
      if (ageH < ttlHours) { try { fixtures = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); cacheHit++; } catch (e) { fixtures = null; } }
    }
    if (fixtures == null) {
      fixtures = await fetchPlayerFixturesForYear(apiKey, c.playerKey, year, dateStop);
      if (fixtures == null) { errored++; log(`  supplement: api error for ${c.name} (${c.playerKey}); skipping`); continue; }
      fetched++;
      if (cacheFile) { try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(fixtures)); } catch (e) {} }
    }
    result.push({ playerKey: c.playerKey, name: c.name, rank: c.rank, fixtures: buildFixtures(fixtures, c.playerKey, surfaceMap, year) });
  }
  log(`supplement: ${candidates.length} candidates -> ${fetched} fetched, ${cacheHit} cached, ${errored} errored`);
  return result;
}

module.exports = { supplement, buildFixtures, serveBlock, fetchPlayerFixturesForYear };
