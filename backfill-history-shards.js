// Backfill per-match stats + point-by-point shards for the matches behind the
// Overview / Career-record drill-down.
//
// WHY THIS COSTS (almost) NOTHING
// The Form tab's shards are built by build-point-by-point.js, which fetches one
// match at a time (`get_fixtures&match_key=`). Costing this backfill that way
// said ~9,000 calls and hours of running, which is what nearly got it rejected.
// It is wrong. The pipeline ALREADY pulls each tracked player's entire 5-year
// fixture window in ONE call (fetchRecentSinglesFixtures), and that response
// carries `statistics` and `pointbypoint` INLINE on every fixture — the same
// bytes build-point-by-point.js pays per match. playerMatchHistory() reads those
// objects and keeps nine text fields; the box score and the point log are
// dropped on the floor. So the whole job is ONE call per tracked player (~48),
// not one per match, and the data is already paid for.
//
// The 7-day "maximum date range" cap does NOT apply here: it constrains only the
// player-less bulk odds query. A player-keyed window is unbounded — verified
// live across 2024-03 -> 2026-07 in a single call.
//
// SCOPE: the players with a career-history shard — every profiled player, whose
// drill-down rows the dashboard can render. That set rotates, so this converges
// continuously rather than being a one-shot import.
//
// Only the FIXTURE rows count as work. A shard also carries pre-2021 archive
// rows, which have no eventKey and no fixture behind them — API-Tennis's feed is
// effectively empty that far back, which is why they come from the TML archive
// in the first place. Counting them as pending would peg every archive-heavy
// player at maximum pending forever, aim the cap at matches no call can resolve,
// and stop this job from ever winding down.
//
// SAFETY: separate, best-effort process (never blocks the deploy), and it only
// ever WRITES THE CACHE. Shard/index emission stays in build-point-by-point.js,
// which runs after this and needs no fetch for anything found here — so filling
// the cache strictly REDUCES that job's per-match fetching. It cannot starve
// today's matches, which is the failure mode a shared budget caused before.

const fs = require('fs');
try { require('dotenv').config({ quiet: true }); } catch (_) { /* dotenv optional */ }
const { fetchRecentSinglesFixtures } = require('./bsp-pipeline.js');
const { buildCacheEntry, parseFixture } = require('./build-point-by-point.js');

const HISTORIES_DIR = 'career-history';
const CACHE_PATH = 'point-by-point-cache.json';
const PACE_MS = 200;

// One call per player, so the cap is in players. The pool is now every profiled
// player (~480, up from the 48 on today's board), so the cap matters more than
// it did: this runs on a 15-minute cron and must never be the reason a deploy
// times out. At 16/run the widened pool converges over a few hours of crons
// rather than in one burst. It self-terminates — a player whose rows are
// all cached costs NO call at all (see `pending` below) — so once the backfill
// has converged, a steady-state run makes zero requests and this cap is inert.
const MAX_PLAYERS_PER_RUN = Number(process.env.HISTORY_BACKFILL_MAX_PLAYERS || 16);

// A finished match's point log and box score never change, so they are cached
// forever. Anything still in play is left alone: caching a partial log would
// freeze it at the suspension and keep serving those points after the match
// ended (the trap build-point-by-point.js documents for interrupted matches).
const FINAL_STATUSES = ['Finished', 'Retired', 'Walk Over'];

function isSingles(f) {
  return /singles/i.test(f.event_type_type || '') && !/doubles/i.test(f.event_type_type || '');
}

function writeAtomic(path, contents) {
  const tmp = `${path}.tmp`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, path);
}

// Merge into an existing entry rather than overwrite it. An entry may already
// exist from the window pass (with the dashboard's own names) or from an older
// run that predates the set box score. Never trade real data for absent data:
// a fixture that comes back without a point log must not blank a log we hold.
function mergeEntry(existing, built) {
  if (!existing) return built;
  const out = { ...existing };
  if ((!out.sets || !out.sets.length) && built.sets && built.sets.length) out.sets = built.sets;
  if (!out.p1 && built.p1) { out.p1 = built.p1; out.p2 = built.p2; }
  if (out.p1Key == null && built.p1Key != null) { out.p1Key = built.p1Key; out.p2Key = built.p2Key; }
  // `stats` present-but-null means "asked, feed had none" — don't ask again.
  if (!('stats' in out) || (out.stats == null && built.stats)) out.stats = built.stats;
  // Same rule for the whole-match box score, and the same reason it can't just
  // overwrite: a window fixture that comes back without statistics must not
  // blank a box score an earlier per-match fetch already resolved.
  if (!('matchStats' in out) || (out.matchStats == null && built.matchStats)) out.matchStats = built.matchStats;
  return out;
}

async function main() {
  if (!process.env.API_TENNIS_KEY) {
    console.error('history-backfill: API_TENNIS_KEY not set — skipping (site deploy unaffected).');
    return;
  }
  if (!fs.existsSync(HISTORIES_DIR)) {
    console.error(`history-backfill: ${HISTORIES_DIR}/ missing — skipping (pipeline writes it earlier in the run).`);
    return;
  }

  const histories = {};
  for (const file of fs.readdirSync(HISTORIES_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const shard = JSON.parse(fs.readFileSync(`${HISTORIES_DIR}/${file}`, 'utf8'));
      histories[file.replace(/\.json$/, '')] = (shard.matches || []).filter(r => r && r.src !== 'archive');
    } catch (e) { /* a half-written shard is skipped, not fatal */ }
  }
  const cache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) : {};

  // An entry is only "done" once it has been asked for BOTH box scores —
  // present-even-when-null is the marker build-point-by-point.js uses for the
  // same reason. matchStats joined the entry after the cache was already
  // populated, so requiring it here is what re-opens the ~48 player windows once
  // to fill it and then closes them again. It is safe to widen HERE and nowhere
  // else: this path costs one call per PLAYER regardless of how many of their
  // matches are missing it, whereas the per-match loop would pay per match.
  const resolved = ek => cache[ek] && ('stats' in cache[ek]) && ('matchStats' in cache[ek]);

  // Rank players by how many of their drill-down rows are still unbacked. A
  // player with nothing pending is skipped WITHOUT a call, so this both aims the
  // cap at the biggest gaps and lets the job wind down to nothing once covered.
  // Rows only became countable here because playerMatchHistory now keeps
  // eventKey; a row without one is counted pending, which degrades to "call and
  // find out" rather than silently reporting full coverage.
  const ranked = Object.entries(histories)
    .map(([key, rows]) => {
      const list = Array.isArray(rows) ? rows : (rows && rows.matches) || [];
      const pending = list.filter(r => r && (r.eventKey == null || !resolved(String(r.eventKey)))).length;
      return { key, pending, total: list.length };
    })
    .filter(p => p.pending > 0)
    .sort((a, b) => b.pending - a.pending);

  if (!ranked.length) {
    console.log(`history-backfill: all ${Object.keys(histories).length} tracked players fully backed by the cache — no calls made.`);
    return;
  }

  const batch = ranked.slice(0, MAX_PLAYERS_PER_RUN);
  console.log(`history-backfill: ${ranked.length} player(s) with unbacked rows; doing ${batch.length} this run (${MAX_PLAYERS_PER_RUN}/run cap).`);

  let calls = 0, added = 0, filled = 0, skipped = 0, failed = 0;
  for (const p of batch) {
    let fixtures;
    try {
      calls++;
      fixtures = await fetchRecentSinglesFixtures(p.key);   // ~5-year window, stats + pbp inline
      await new Promise(r => setTimeout(r, PACE_MS));
    } catch (e) {
      failed++;
      console.error(`history-backfill: fixture window failed for player ${p.key}: ${e.message}`);
      continue;   // leave the cache untouched so the next run retries
    }

    for (const f of fixtures) {
      if (!isSingles(f)) continue;
      if (!FINAL_STATUSES.includes(f.event_status)) continue;
      const ek = f.event_key == null ? null : String(f.event_key);
      if (!ek) continue;
      if (resolved(ek)) { skipped++; continue; }
      const had = !!cache[ek];
      // Parsed with the same reader the per-match path uses: these are the same
      // fixture objects, so they must not be interpreted two different ways.
      const built = buildCacheEntry(parseFixture(f));
      cache[ek] = mergeEntry(cache[ek], built);
      if (had) filled++; else added++;
    }
  }

  writeAtomic(CACHE_PATH, JSON.stringify(cache));

  const stillPending = ranked.length - batch.length;
  console.log(`history-backfill: ${calls} call(s) -> ${added} new cache entries, ${filled} existing entries completed, ${skipped} already done${failed ? `, ${failed} failed` : ''}.`);
  console.log(`history-backfill: cache now ${Object.keys(cache).length} matches (shards are written by build-point-by-point.js, which runs next and needs no fetch for these).`);
  // Say partial coverage out loud rather than letting a capped run read as complete.
  if (stillPending) console.log(`history-backfill: ${stillPending} player(s) deferred to later runs (cap ${MAX_PLAYERS_PER_RUN}/run; cache is persistent).`);
}

main().catch(e => { console.error('history-backfill: unexpected error —', e.message); process.exit(0); });
