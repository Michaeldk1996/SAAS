// Builds a staging copy of the two files the Career-record drill-down needs
// (patched player-profiles.json + the career-history shards) for a handful of
// players, using the real builders against live fixtures. The verify server
// serves these and proxies everything else to the live site, so the browser
// runs worktree code against real data without a full pipeline run.
//
// Usage: node ten8-career-stage.js <outDir> <playerKey ...>
const fs = require('fs');
const path = require('path');
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const pipeline = require('./bsp-pipeline.js');

const CURRENT_YEAR = new Date().getFullYear();
const outDir = process.argv[2];
const keys = process.argv.slice(3);

(async () => {
  const doc = JSON.parse(fs.readFileSync('player-profiles.json', 'utf8'));
  const surfaceMap = new Map(Object.entries(JSON.parse(fs.readFileSync('tournament-surfaces.json', 'utf8')).surfaces || {}));

  const staged = {};
  for (const key of keys) {
    const p = doc.players[key];
    if (!p) { console.log(`  ${key}: not in player-profiles.json, skipped`); continue; }
    const fixtures = await pipeline.fetchRecentSinglesFixtures(key);
    const url = `https://api.api-tennis.com/tennis/?method=get_players&APIkey=${process.env.API_TENNIS_KEY}&player_key=${key}`;
    const stats = ((await (await fetch(url)).json()).result || [])[0];
    if (!fixtures.length || !stats) { console.log(`  ${key}: no live data, skipped`); continue; }
    p.careerByYear = pipeline.buildAllTierYearly(fixtures, key, stats, CURRENT_YEAR, surfaceMap);
    p.careerMatches = pipeline.playerMatchHistory(fixtures, key, CURRENT_YEAR, surfaceMap);
    staged[key] = p;
    console.log(`  staged ${p.name} (${p.careerMatches.length} window rows)`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  process.chdir(outDir);
  await pipeline.writeCareerHistoryShards(staged, { log: (m) => console.log(m) });
  // careerByYear now carries the per-year `rows`/`atpOnly` stamps and
  // careerMatches has been stripped — write the profile doc as the site sees it.
  fs.writeFileSync(path.join(outDir, 'player-profiles.json'), JSON.stringify(doc));
  console.log(`Staged ${Object.keys(staged).length} player(s) into ${outDir}`);
})();
