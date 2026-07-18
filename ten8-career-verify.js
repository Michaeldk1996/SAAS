// =================================================================
// CAREER-RECORD RECONCILIATION VERIFIER
// -----------------------------------------------------------------
// The Career-record table used to count one population of matches and drill
// open a different one, so the number you clicked and the list you got
// disagreed in both directions. The fix re-sources the counts from the same
// fixtures the rows come from; this asserts that, on live data, per player and
// per year+surface cell:
//
//   buildAllTierYearly(fixtures)[year][surface]  ==  rows in that year+surface
//
// for every year inside the fixture window. Pre-window years are reported, not
// asserted: their rows come from the ATP tour-level archive against an all-tier
// provider count, a real difference the UI states in words.
//
// Usage: node ten8-career-verify.js [playerKey ...]
// =================================================================
const fs = require('fs');
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const pipeline = require('./bsp-pipeline.js');
const { buildArchiveHistories } = require('./career-backfill');

const CURRENT_YEAR = new Date().getFullYear();
const WINDOW_FROM = CURRENT_YEAR - 5;

async function surfaceMapFromCache() {
  const raw = JSON.parse(fs.readFileSync('tournament-surfaces.json', 'utf8'));
  return new Map(Object.entries(raw.surfaces || {}));
}

async function fetchPlayerStats(key) {
  const url = `https://api.api-tennis.com/tennis/?method=get_players&APIkey=${process.env.API_TENNIS_KEY}&player_key=${key}`;
  const d = await (await fetch(url)).json();
  return (d.result && d.result[0]) || null;
}

const cell = r => (r && (r.won != null || r.lost != null)) ? (r.won || 0) + (r.lost || 0) : 0;

(async () => {
  const profiles = JSON.parse(fs.readFileSync('player-profiles.json', 'utf8')).players;
  const keys = process.argv.slice(2).length
    ? process.argv.slice(2)
    : Object.keys(profiles).slice(0, 6);

  const surfaceMap = await surfaceMapFromCache();
  const archive = await buildArchiveHistories(profiles, 2000, CURRENT_YEAR - 6, { log: () => {} });

  let cells = 0, mismatches = 0, playersChecked = 0, archiveYears = 0, archiveRows = 0;

  for (const key of keys) {
    const p = profiles[key];
    if (!p) { console.log(`  ${key}: no profile, skipped`); continue; }
    const [fixtures, stats] = await Promise.all([
      pipeline.fetchRecentSinglesFixtures(key),
      fetchPlayerStats(key),
    ]);
    if (!fixtures.length || !stats) { console.log(`  ${p.name}: no live data, skipped`); continue; }
    playersChecked++;

    const years = pipeline.buildAllTierYearly(fixtures, key, stats, CURRENT_YEAR, surfaceMap);
    const rows = pipeline.playerMatchHistory(fixtures, key, CURRENT_YEAR, surfaceMap);

    const bad = [];
    for (const yr of years) {
      const y = String(yr.year);
      if (parseInt(y, 10) < WINDOW_FROM) {
        const arch = (archive[key] || []).filter(r => String(r.year) === y);
        if (arch.length) { archiveYears++; archiveRows += arch.length; }
        continue;
      }
      for (const surf of ['total', 'clay', 'hard', 'grass']) {
        const expected = cell(yr[surf]);
        const actual = rows.filter(r => String(r.year) === y
          && (surf === 'total' || String(r.surface || '') === surf)).length;
        cells++;
        if (expected !== actual) { bad.push(`${y} ${surf}: count ${expected} vs ${actual} rows`); mismatches++; }
      }
    }
    const archCount = (archive[key] || []).length;
    console.log(`  ${(p.name || key).padEnd(24)} ${rows.length} window rows, ${archCount} archive rows` +
      (bad.length ? `  MISMATCH -> ${bad.join('; ')}` : '  reconciled'));
  }

  console.log(`\n${playersChecked} player(s), ${cells} year+surface cells checked in the ${WINDOW_FROM}+ window.`);
  console.log(`Pre-${WINDOW_FROM} archive: ${archiveRows} rows across ${archiveYears} player-years (tour-level, reported not asserted).`);
  if (mismatches) { console.log(`FAIL: ${mismatches} cell(s) where the table and the list disagree.`); process.exit(1); }
  console.log('PASS: every in-window cell counts exactly the matches it lists.');
})();
