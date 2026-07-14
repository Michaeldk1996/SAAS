/**
 * Non-destructive recentForm backfill.
 * -----------------------------------------------------------------
 * Recomputes each profile's `recentForm` using the widened, all-tier
 * (ATP + Challenger + ITF) singles fetch now used by the pipeline, so
 * lower-ranked players who play mostly Challenger/ITF events stop
 * showing 0 recent matches. Patches ONLY the `recentForm` field into
 * both player-profiles.json and the profile cache. Every other field,
 * and every other data file, is left exactly as-is.
 *
 * Safety:
 *   - On a fetch failure or an empty/worse result, the existing
 *     recentForm is kept (never overwritten with nothing).
 *   - Nothing else in the profile is touched.
 *   - Run from the project dir so dotenv finds .env for API_TENNIS_KEY.
 *
 *   node backfill-recentform.js
 */
const fs = require('fs');
const path = require('path');
const { fetchRecentSinglesFixtures, recentFormFromFixtures } = require('./bsp-pipeline.js');

const PROFILES_PATH = path.join(__dirname, 'player-profiles.json');
const CACHE_PATH = path.join(__dirname, 'player-profiles-cache.json');
const SURFACES_PATH = path.join(__dirname, 'tournament-surfaces.json');
const CONCURRENCY = 6;

function loadSurfaceMap() {
  if (!fs.existsSync(SURFACES_PATH)) return new Map();
  const cache = JSON.parse(fs.readFileSync(SURFACES_PATH, 'utf8'));
  return new Map(Object.entries(cache.surfaces || {}));
}

async function runPool(items, worker, concurrency) {
  let i = 0;
  let done = 0;
  const total = items.length;
  async function next() {
    while (i < total) {
      const idx = i++;
      await worker(items[idx], idx);
      done++;
      if (done % 25 === 0 || done === total) {
        console.log(`  ...${done}/${total} profiles processed`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, next));
}

(async () => {
  const surfaceMap = loadSurfaceMap();
  console.log(`Loaded surface map (${surfaceMap.size} tournaments).`);

  const profilesFile = JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8'));
  const profiles = profilesFile.players;
  const keys = Object.keys(profiles);
  console.log(`Backfilling recentForm for ${keys.length} profiles (widened all-tier singles fetch)...`);

  const newForm = {}; // key -> recentForm (only where improved/valid)
  let improved = 0, kept = 0, failed = 0;

  await runPool(keys, async (key) => {
    const prof = profiles[key];
    try {
      const fixtures = await fetchRecentSinglesFixtures(key);
      const form = recentFormFromFixtures(fixtures, key, surfaceMap);
      const oldN = (prof.recentForm && prof.recentForm.matches) ? prof.recentForm.matches.length : 0;
      const newN = (form && form.matches) ? form.matches.length : 0;
      // Non-destructive: only replace when the widened fetch yields at
      // least as many matches as we already had (never regress coverage).
      if (newN > 0 && newN >= oldN) {
        newForm[key] = form;
        if (newN > oldN) improved++; else kept++;
      } else {
        kept++;
      }
    } catch (err) {
      failed++;
    }
  }, CONCURRENCY);

  // Apply to profiles.json
  for (const key of Object.keys(newForm)) {
    profiles[key].recentForm = newForm[key];
  }
  fs.writeFileSync(PROFILES_PATH, JSON.stringify(profilesFile, null, 2));
  console.log(`\nplayer-profiles.json patched: ${Object.keys(newForm).length} recentForm updated (${improved} improved, ${kept} kept old, ${failed} fetch-failed).`);

  // Apply to cache so a future partial pipeline run doesn't revert opponents.
  if (fs.existsSync(CACHE_PATH)) {
    const cacheFile = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    const cachePlayers = cacheFile.players || {};
    let cachePatched = 0;
    for (const key of Object.keys(newForm)) {
      const entry = cachePlayers[key];
      if (entry && entry.profile) {
        entry.profile.recentForm = newForm[key];
        cachePatched++;
      }
    }
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cacheFile, null, 2));
    console.log(`player-profiles-cache.json patched: ${cachePatched} cached profiles updated.`);
  }

  // Coverage report
  const buckets = { '0-4': 0, '5-9': 0, '10+': 0 };
  for (const key of keys) {
    const n = (profiles[key].recentForm && profiles[key].recentForm.matches) ? profiles[key].recentForm.matches.length : 0;
    if (n < 5) buckets['0-4']++; else if (n < 10) buckets['5-9']++; else buckets['10+']++;
  }
  console.log('Post-backfill recentForm coverage:', JSON.stringify(buckets));
})();
