/**
 * tournament-progression.json rebuild (Total Points Won %).
 * -----------------------------------------------------------------
 * TEN-13 (Task 8) added `totalPointsWonPct` to PROGRESSION_METRIC_DEFS in
 * bsp-pipeline.js, but tournament-progression.json is only written by a full
 * pipeline run. The shipped file predates that field, so BOTH progression
 * surfaces that read it — the Match Analysis "Progression" tab and the
 * Tournaments -> Reports (TourX) view — render the Total Points Won metric
 * with no data behind it.
 *
 * This script rebuilds tournament-progression.json for the currently active
 * tournaments only, reusing the pipeline's own buildTournamentProgression()
 * so the output is byte-for-byte the shape a full pipeline run produces. The
 * next scheduled pipeline run will regenerate the same file the same way;
 * this just avoids waiting for it.
 *
 * Real data only: buildTournamentProgression reads the provider's own
 * stat_won/stat_total for 'Points'/'Total Points Won'. Nothing is derived
 * from a percentage and nothing is fabricated — a tournament the provider
 * has no stat sheet for stays absent, exactly as before.
 *
 * Cost: one get_fixtures call per active tournament (same as the pipeline).
 *
 *   node backfill-progression-tpw.js
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { buildTournamentProgression } = require('./bsp-pipeline');

const MATCHES_PATH = path.join(__dirname, 'matches.json');
const OUT_PATH = path.join(__dirname, 'tournament-progression.json');

(async () => {
  const matches = JSON.parse(fs.readFileSync(MATCHES_PATH, 'utf8'));
  // Same source of active tournaments the pipeline uses (matches[].tour).
  const activeTournamentNames = [...new Set(matches.map(m => m.tour).filter(Boolean))];
  console.log(`Rebuilding progression for ${activeTournamentNames.length} active tournament(s): ${activeTournamentNames.join(', ')}`);

  const tournaments = {};
  for (const tourName of activeTournamentNames) {
    const progression = await buildTournamentProgression(tourName);
    // Keyed by the bare name ("Wimbledon", not "ATP Wimbledon") — the key the
    // dashboard actually looks up. Mirrors the pipeline exactly.
    if (progression) tournaments[tourName.replace(/^ATP\s+/, '').trim()] = progression;
    console.log(`  ${progression ? '+' : '-'} ${tourName}${progression ? '' : ' (no finished rounds with stats)'}`);
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify({ fetchedAt: new Date().toISOString(), tournaments }, null, 2));

  // Report real coverage of the new metric so a silent all-null rebuild is obvious.
  let rounds = 0, withTpw = 0;
  for (const t of Object.values(tournaments)) {
    for (const p of t.players || []) {
      for (const r of p.rounds || []) {
        rounds++;
        if (r.metrics && r.metrics.totalPointsWonPct != null) withTpw++;
      }
    }
  }
  console.log(`\nWrote tournament-progression.json (${Object.keys(tournaments).length}/${activeTournamentNames.length} tournaments).`);
  console.log(`totalPointsWonPct coverage: ${withTpw}/${rounds} player-rounds` +
    (rounds ? ` (${(withTpw / rounds * 100).toFixed(1)}%)` : ''));
})().catch(err => { console.error('Rebuild failed:', err); process.exit(1); });
