// Break/Hold historical-pbp harvester  (TEN-107)
// =============================================================================
// FOUNDER GO 2026-09-02 (roster split approved). This module owns the hold/break
// data supply and is DELIBERATELY DECOUPLED from the archetype style supplement:
//
//   * Own roster      : player-profiles.json, numeric key, rank <= RANK_MAX(400),
//                       NO "already TML-qualified" exclusion. The style
//                       supplement only fills current-season breakouts TML lags
//                       on; hold/break needs the marquee vets (Monfils, Alcaraz,
//                       Sinner, Djokovic) too, so it uses its own roster.
//   * Own window      : rolling WINDOW_MONTHS(24) — date_start = today - 24mo —
//                       via the supplement fetcher's optional dateStart param.
//   * Own cache dir   : apitennis-holdbreak-cache/{key}.json (one file/player =
//                       that player's raw 24M ATP-singles fixtures, stats + pbp
//                       inline). build-holdbreak.js globs *.json here, dedups by
//                       event_key across players, and applies the 24M clip
//                       itself, so a single ranged file per player is correct.
//
// The separate cache dir is the SAFETY LINE: classify-styles.js reads only
// apitennis-styles-cache/, so nothing here can perturb archetype classification
// or board-archetypes.json. Verify that invariant after any change.
//
// Cost: one ranged get_fixtures call per roster player (pbp inline, NOT
// matches x calls). ~roster-size calls, no extra api-tennis spend (Ultra plan).
//
// CLI:
//   node harvest-holdbreak.js                 # full roster backfill
//   node harvest-holdbreak.js --dry-run       # print roster + predicted calls, fetch nothing
//   node harvest-holdbreak.js --only 2845,9217 # restrict to given player keys (smoke test)
//   node harvest-holdbreak.js --limit 5        # first N roster players
//   node harvest-holdbreak.js --force          # ignore the intra-day cache TTL
// =============================================================================

const fs = require('fs');
const path = require('path');
const { fetchPlayerFixturesForYear } = require('./styles-apitennis-supplement.js');

const PROFILES   = path.join(__dirname, 'player-profiles.json');
const CACHE_DIR   = path.join(__dirname, 'apitennis-holdbreak-cache');
const STYLE_CACHE = path.join(__dirname, 'apitennis-styles-cache');   // read-only: dry-run split only
const RANK_MAX      = parseInt(process.env.HB_RANK_MAX || '400', 10);
const WINDOW_MONTHS = parseInt(process.env.HB_WINDOW_MONTHS || '24', 10);
const TTL_HOURS     = parseInt(process.env.HB_TTL_HOURS || '20', 10);

const isNumericKey = k => /^[0-9]+$/.test(String(k));

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] || '') : null;
}
const HAS = name => process.argv.includes(name);

function rollingStart(dateStopISO, months) {
  const d = new Date(dateStopISO + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

// Roster: numeric key, rank <= RANK_MAX. NO TML-qualified exclusion (by design).
function loadRoster() {
  const pp = JSON.parse(fs.readFileSync(PROFILES, 'utf8'));
  const players = pp.players || {};
  const seen = new Set();
  const out = [];
  for (const [k, p] of Object.entries(players)) {
    const key = String((p && p.key) != null ? p.key : k);
    const rank = p && p.rank;
    if (!isNumericKey(key)) continue;
    if (rank == null || !(Number(rank) > 0) || Number(rank) > RANK_MAX) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ playerKey: key, name: (p && p.name) || key, rank: Number(rank) });
  }
  out.sort((a, b) => a.rank - b.rank);
  return out;
}

// Read-only characterisation of the predicted call split (dry run only).
function styleCachedKeys() {
  if (!fs.existsSync(STYLE_CACHE)) return new Set();
  return new Set(
    fs.readdirSync(STYLE_CACHE)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(/-\d{4}\.json$/, '').replace(/\.json$/, ''))
  );
}

async function main() {
  const DRY   = HAS('--dry-run');
  const FORCE = HAS('--force');
  const only  = arg('--only');
  const limit = arg('--limit');
  const apiKey = process.env.API_TENNIS_KEY;

  const dateStop  = new Date().toISOString().slice(0, 10);
  const dateStart = rollingStart(dateStop, WINDOW_MONTHS);
  const year      = dateStop.slice(0, 4);

  let roster = loadRoster();
  if (only)  { const set = new Set(only.split(',').map(s => s.trim())); roster = roster.filter(r => set.has(r.playerKey)); }
  if (limit) { roster = roster.slice(0, parseInt(limit, 10) || roster.length); }

  const cached = styleCachedKeys();
  const widen = roster.filter(r => cached.has(r.playerKey)).length;
  const fresh = roster.length - widen;
  console.log(`harvest-holdbreak: roster=${roster.length} rank<=${RANK_MAX} window=${dateStart}..${dateStop} (${WINDOW_MONTHS}M)`);
  console.log(`harvest-holdbreak: predictedCalls=${roster.length}  (widen 8->24M=${widen}, new/never-harvested=${fresh})`);
  if (DRY) return;

  if (!apiKey) { console.error('harvest-holdbreak: API_TENNIS_KEY missing — cannot backfill'); process.exit(1); }
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  let fetched = 0, cacheHit = 0, errored = 0, empty = 0, written = 0;
  const t0 = Date.now();
  for (const r of roster) {
    const cacheFile = path.join(CACHE_DIR, `${r.playerKey}.json`);
    if (!FORCE && fs.existsSync(cacheFile)) {
      const ageH = (Date.now() - fs.statSync(cacheFile).mtimeMs) / 3.6e6;
      if (ageH < TTL_HOURS) { cacheHit++; continue; }
    }
    const fixtures = await fetchPlayerFixturesForYear(apiKey, r.playerKey, year, dateStop, dateStart);
    if (fixtures == null) { errored++; console.error(`  api error: ${r.name} (${r.playerKey})`); continue; }
    fetched++;
    if (!fixtures.length) empty++;
    try { fs.writeFileSync(cacheFile, JSON.stringify(fixtures)); written++; }
    catch (e) { console.error(`  write fail ${r.playerKey}: ${e.message}`); }
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(`harvest-holdbreak: fetched=${fetched} written=${written} cacheHit=${cacheHit} errored=${errored} empty=${empty} in ${secs}s`);
}

main().catch(e => { console.error('harvest-holdbreak fatal:', e); process.exit(1); });
