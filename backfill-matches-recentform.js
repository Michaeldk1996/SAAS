/**
 * Non-destructive matches.json recentForm backfill.
 * -----------------------------------------------------------------
 * The per-match p1/p2RecentForm(+Matches) fields in matches.json are
 * built by the pipeline from the H2H endpoint's `pXRecentResults`,
 * which only returns tour-level (ATP) results. Players who play mostly
 * Challenger/ITF events therefore come through with recentForm=null and
 * an empty match list, so the Match Analysis modal's Form tab and
 * Recent Results show nothing for them — even though their PROFILE
 * already carries the correct widened all-tier recent form (patched by
 * backfill-recentform.js).
 *
 * This script fills ONLY those empty match sides from the player's own
 * profile.recentForm (real, all-tier data — no fabrication), capped to
 * the 10 most recent matches to match the tour-level sides already in
 * the file. Profile form rows carry no box-score matchStats, which the
 * modal already handles gracefully ("Stats not available for this
 * match"), so nothing is invented.
 *
 * Safety:
 *   - Only touches sides where recentForm is null OR the match list is
 *     empty. Populated (stats-rich) sides are left exactly as-is.
 *   - No API calls; reads only local JSON. Every other field untouched.
 *
 *   node backfill-matches-recentform.js
 */
const fs = require('fs');
const path = require('path');

const MATCHES_PATH = path.join(__dirname, 'matches.json');
const PROFILES_PATH = path.join(__dirname, 'player-profiles.json');
const CAP = 10; // most-recent matches per side, matching the pipeline's tour-level cap

function pctOf(matches) {
  if (!matches.length) return null;
  const wins = matches.filter(m => m.won).length;
  return Math.round((wins / matches.length) * 1000) / 10;
}

function isEmptySide(form, list) {
  return form == null || !Array.isArray(list) || list.length === 0;
}

(() => {
  const matches = JSON.parse(fs.readFileSync(MATCHES_PATH, 'utf8'));
  const profilesFile = JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8'));
  const profiles = profilesFile.players || profilesFile;

  let filled = 0, skippedNoProfile = 0, alreadyOk = 0;
  const report = [];

  for (const m of matches) {
    for (const side of ['p1', 'p2']) {
      const formKey = `${side}RecentForm`;
      const listKey = `${side}RecentFormMatches`;
      const keyKey = `${side}Key`;
      if (!isEmptySide(m[formKey], m[listKey])) { alreadyOk++; continue; }

      const prof = profiles[String(m[keyKey])];
      const profMatches = prof && prof.recentForm && Array.isArray(prof.recentForm.matches)
        ? prof.recentForm.matches
        : [];
      if (!profMatches.length) {
        skippedNoProfile++;
        report.push(`  - ${m[side]} (key ${m[keyKey]}): no profile recentForm — left empty (honest gap)`);
        continue;
      }

      const slice = profMatches.slice(0, CAP);
      m[listKey] = slice;
      m[formKey] = pctOf(slice);
      filled++;
      report.push(`  + ${m[side]} (key ${m[keyKey]}): filled ${slice.length} matches, ${m[formKey]}% form`);
    }
  }

  fs.writeFileSync(MATCHES_PATH, JSON.stringify(matches, null, 2));
  console.log(`matches.json backfill complete.`);
  console.log(`  sides filled from profile: ${filled}`);
  console.log(`  sides already populated:   ${alreadyOk}`);
  console.log(`  sides with no profile data: ${skippedNoProfile}`);
  console.log('\nDetail:');
  console.log(report.join('\n'));
})();
