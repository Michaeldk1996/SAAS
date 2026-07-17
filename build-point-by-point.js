// Match sidecar generator (Task 4): point logs, and the per-set box scores that
// back the set filters.
//
// Produces `point-by-point.json` — a lazy-loaded companion the dashboard fetches
// ONLY when the user opens a match's "Point by point" view, so it never touches
// the initial page load. Covers FINISHED matches only (a completed match's
// point log is immutable, so it is fetched once and cached forever).
//
// Also produces `setstats/{eventKey}.json` + `setstats-index.json`: the per-set
// box score behind the Form tab's set filter. It lives here rather than in the
// main pipeline because api-tennis returns the per-set `statistics` rows in the
// SAME fixture as the point log — so this generator already holds the data, and
// keeping it costs no extra API call. Same lazy shard shape as the point log,
// for the same reason (see SETSTATS_DIR).
//
// Data source: api-tennis get_fixtures?match_key=<eventKey> returns a
// `pointbypoint` array of game entries; each game carries the running score and
// a `points` list. We compact that to p1/p2 terms keyed by the api-tennis event
// key (e.g. "12145200") — the stable half of the dashboard's match id.
//
// Keyed by event key, NOT by the dashboard's `m.id`: that id carries a
// day-bucket prefix, and the same match is "upcoming-12145200" while it sits in
// the fixtures window and "past-12145200" once it rolls out. A prefixed key goes
// stale the moment a match changes bucket, and the dashboard's lookup then
// silently misses a point log that was fetched successfully. The event key never
// changes.
//
// Decoupled from the main pipeline on purpose: if this fails, the site still
// deploys (the workflow runs it best-effort). It reuses a persistent cache so
// each run only fetches point logs it has never seen.

const fs = require('fs');
try { require('dotenv').config({ quiet: true }); } catch (_) { /* dotenv optional */ }
// Importing the pipeline is side-effect free — it only self-runs under
// `require.main === module`.
const { buildSetStatsFromFixture } = require('./bsp-pipeline.js');

const API_TENNIS_KEY = process.env.API_TENNIS_KEY;
const API_TENNIS_BASE = 'https://api.api-tennis.com/tennis/';

const MATCHES_PATH = 'matches.json';
const OUT_PATH = 'point-by-point.json';
const CACHE_PATH = 'point-by-point-cache.json';
const SHARD_DIR = 'pbp';
const INDEX_PATH = 'pbp-index.json';
// Per-set box scores ride the same shard-plus-index shape as the point log, and
// for the same reason: ~3.5 KB of set stats per match across ~730 recent-form
// rows would add ~2.5 MB to matches.json (3.4 MB today) on every page load, to
// serve a filter that is only read after a row is expanded.
const SETSTATS_DIR = 'setstats';
const SETSTATS_INDEX_PATH = 'setstats-index.json';
const PACE_MS = 150;

// Ceiling on NEW point logs fetched per run. The Form tab's recent-form rows
// reference ~600 distinct matches that have never been fetched, and doing them
// all in one run would add ~90s of paced calls to a job that runs every 15 min.
// The cache is permanent and restored between runs, so the backfill converges
// over a few runs instead of arriving in one spike. Rows whose log has not been
// reached yet simply have no Point-by-point tab (never a fabricated one).
const MAX_FETCHES_PER_RUN = Number(process.env.PBP_MAX_FETCHES || 250);

// api-tennis labels the two players "First Player" / "Second Player", which map
// to the dashboard's p1 / p2 respectively.
function side(label) {
  if (label === 'First Player') return 'p1';
  if (label === 'Second Player') return 'p2';
  return null;
}

// Compact one raw pointbypoint array into { sets:[{ set, games:[...] }] }.
function compactPbp(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const setsMap = new Map();
  for (const g of raw) {
    const setLabel = g.set_number || 'Set 1';
    const setNo = parseInt(String(setLabel).replace(/[^0-9]/g, ''), 10) || 1;
    if (!setsMap.has(setNo)) setsMap.set(setNo, []);
    const points = Array.isArray(g.points) ? g.points.map(p => {
      const o = { n: Number(p.number_point) || null, s: p.score || '' };
      if (p.break_point) o.bp = true;
      if (p.set_point) o.sp = true;
      if (p.match_point) o.mp = true;
      return o;
    }) : [];
    setsMap.get(setNo).push({
      g: Number(g.number_game) || null,
      server: side(g.player_served),
      winner: side(g.serve_winner),
      score: g.score || '',
      points,
    });
  }
  const sets = [...setsMap.keys()].sort((a, b) => a - b)
    .map(setNo => ({ set: setNo, games: setsMap.get(setNo) }));
  return { sets };
}

// Returns { raw, p1, p2, stats, p1Key, p2Key } — the point log plus api-tennis's
// OWN names for the two sides. The names matter: a point log labels each game's
// server/winner "First Player"/"Second Player", so a log is only meaningful next
// to the names those labels refer to. Window matches could borrow m.p1/m.p2 from
// the dashboard, but a recent-form row only knows "the profile player vs
// opponent" and NOT which of them api-tennis called first — so the log is stored
// with the names the API itself used, and rendered against those. No orientation
// guess.
//
// The same fixture also carries the per-set box score (`statistics` rows tagged
// stat_period "set1"/"set2"/…, alongside the "match" rows the main pipeline
// already reads). Keeping it here costs ZERO extra API calls, which is the whole
// reason the set filter lives in this generator rather than in the pipeline.
// Parsed with the pipeline's OWN parser rather than a copy: the feed has quietly
// changed stat naming before, and one parser means one place to fix it.
async function fetchFixture(eventKey) {
  const url = `${API_TENNIS_BASE}?method=get_fixtures&APIkey=${API_TENNIS_KEY}&match_key=${eventKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${eventKey}`);
  const data = await res.json();
  const result = Array.isArray(data.result) ? data.result : [];
  if (!result.length) return null;
  const r = result[0];
  const p1Key = r.first_player_key ?? null, p2Key = r.second_player_key ?? null;
  return {
    raw: r.pointbypoint || null,
    p1: r.event_first_player || null,
    p2: r.event_second_player || null,
    // Keys, not names: the dashboard orients a set box score by comparing the
    // row's player key to p1Key. Names would need fuzzy matching.
    p1Key, p2Key,
    stats: (p1Key != null && p2Key != null) ? buildSetStatsFromFixture(r, p1Key, p2Key) : null,
  };
}

// Temp file + rename: a reader (or a half-finished job) never sees a partial
// file, per the pipeline's atomic-write rule.
function writeAtomic(path, contents) {
  const tmp = `${path}.tmp`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, path);
}

function eventKeyOf(id) {
  const parts = String(id).split('-');
  const last = parts[parts.length - 1];
  return /^\d+$/.test(last) ? last : null;
}

async function main() {
  if (!API_TENNIS_KEY) {
    console.error('point-by-point: API_TENNIS_KEY not set — skipping (site deploy unaffected).');
    process.exit(0); // non-fatal
  }
  if (!fs.existsSync(MATCHES_PATH)) {
    console.error('point-by-point: matches.json missing — skipping.');
    process.exit(0);
  }

  const parsed = JSON.parse(fs.readFileSync(MATCHES_PATH, 'utf8'));
  const matches = Array.isArray(parsed) ? parsed : (parsed.matches || []);

  const cache = fs.existsSync(CACHE_PATH)
    ? JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))
    : {};

  const out = {};
  let fetched = 0, reused = 0, skipped = 0;

  // Resolve one event key to { p1, p2, sets }, from cache when possible.
  // `names` is the dashboard's own p1/p2 for a window match, used only to
  // backfill legacy cache entries (written before names were stored) without
  // spending a refetch. It is never used for a recent-form-only key, where the
  // dashboard cannot know which side api-tennis called first.
  async function resolve(ek, { provisional = false, names = null } = {}) {
    let entry = provisional ? null : cache[ek];
    if (entry && !entry.p1 && names) entry = cache[ek] = { ...names, ...entry };  // adopt known names
    if (entry && (entry.p1 || !entry.sets || !entry.sets.length)) return entry;   // named, or a cached negative
    if (entry && !entry.p1 && !names) entry = null;                               // unnamed log, form-only: refetch for names
    if (entry) return entry;
    if (fetched >= MAX_FETCHES_PER_RUN) return null;                              // budget spent — try again next run
    fetched++;   // counted BEFORE the call: a throwing API must still burn budget,
                 // or a run where every fetch fails would never reach the cap and
                 // would hammer ~600 requests every 15 minutes instead of 250.
    const got = await fetchFixture(ek);
    await new Promise(r => setTimeout(r, PACE_MS));
    const compact = got ? compactPbp(got.raw) : null;
    // The per-set box score rides along in the same fixture, so a match resolved
    // from here needs no backfill pass below.
    const stats = (got && got.stats) || null;
    const keys = { p1Key: (got && got.p1Key) ?? null, p2Key: (got && got.p2Key) ?? null };
    const built = compact
      ? { p1: (got && got.p1) || (names && names.p1) || null, p2: (got && got.p2) || (names && names.p2) || null, ...compact, ...keys, stats }
      : { sets: [], ...keys, stats };
    if (!provisional) cache[ek] = built;   // cache the negative too, avoid refetching
    return built;
  }

  for (const m of matches) {
    // An interrupted match has a real point log frozen at the suspension, so it
    // gets one too — but it is still growing, so it never touches the cache in
    // either direction. Caching a partial log would freeze it there for good:
    // once play resumed and the match finished, the cache hit would keep
    // serving the suspended-at points forever.
    const provisional = !m.finalScore && m.interrupted;
    if (!m.finalScore && !provisional) continue;
    const ek = eventKeyOf(m.id);
    if (!ek) { skipped++; continue; }

    let compact;
    const before = fetched;
    try {
      compact = await resolve(ek, { provisional, names: { p1: m.p1, p2: m.p2 } });
    } catch (e) {
      console.error(`point-by-point: fetch failed for ${m.id} (${ek}): ${e.message}`);
      skipped++;
      continue;
    }
    if (fetched === before) reused++;

    if (compact && compact.sets && compact.sets.length) {
      // The window sidecar keeps the dashboard's own p1/p2 (they align with the
      // API's first/second for these, and the modal renders against m.p1/m.p2).
      out[ek] = { p1: m.p1, p2: m.p2, sets: compact.sets };
    }
  }

  // Recent-form rows (Task 10-12): every match behind the Form tab's rows, which
  // reach far outside the fixtures window. Deduped — a match commonly appears in
  // both players' form lists, and across several cards.
  const formKeys = new Set();
  const formRowDate = new Map();   // event key -> match date, drives the backfill order below
  for (const m of matches) {
    for (const side of ['p1RecentFormMatches', 'p2RecentFormMatches']) {
      for (const f of (m[side] || [])) {
        if (f && f.eventKey != null) {
          const ek = String(f.eventKey);
          formKeys.add(ek);
          // The same match sits in both players' lists; the date is identical, so
          // first writer wins and a row without one simply sorts last.
          if (f.date && !formRowDate.has(ek)) formRowDate.set(ek, String(f.date));
        }
      }
    }
  }

  let formResolved = 0, formDeferred = 0;
  for (const ek of formKeys) {
    if (out[ek]) continue;                       // already covered by the window pass
    try {
      const entry = await resolve(ek);
      if (!entry) { formDeferred++; continue; }  // fetch budget spent this run
      if (entry.sets && entry.sets.length && entry.p1) formResolved++;
    } catch (e) {
      console.error(`point-by-point: form-row fetch failed for ${ek}: ${e.message}`);
      skipped++;
    }
  }

  // Set-stats backfill for matches cached before the set filter existed. This
  // cache is permanent, so those entries are never re-resolved above and would
  // otherwise never gain a `stats` key — the filter would only ever appear on
  // matches played from today on.
  //
  // Deliberately LAST and on its OWN budget. Folding it into resolve() above
  // made the backfill compete with new matches for the same 250 fetches, and
  // since the backfill has hundreds of candidates it won, starving matches that
  // finished today of their point log entirely. Old set stats are never worth
  // more than a new point log, so the backfill only ever spends its own budget.
  // 250/run adds ~2 min to a ~2 min job — the same total API cost either way,
  // just front-loaded so the filter reaches every row in a couple of runs
  // instead of half a day. Lower it if this job ever needs to be quick again.
  // Ordered by what a visitor can actually see, NOT by the cache's own key order.
  // Event keys are integer-like strings, and JS enumerates those in ASCENDING
  // NUMERIC order ahead of insertion order — so Object.keys(cache) came out
  // oldest-match-first, and a capped backfill spent its whole budget there and
  // reached the current board's form rows last. With ~600 pending, March/April
  // sat at 100% while June/July — months the Form tab actually lists — sat at
  // 0%. The filter looked broken on exactly the rows it was built for.
  // A form row on today's board comes first, newest first (that is the order
  // the rows are read in); everything else keeps its old relative order behind
  // them. Same total API cost and the same convergence — only the order moves.
  const MAX_BACKFILL_PER_RUN = Number(process.env.SETSTATS_MAX_BACKFILL || 250);
  const pending = Object.keys(cache)
    .filter(k => cache[k] && !('stats' in cache[k]))
    .sort((a, b) => {
      const aVis = formKeys.has(a), bVis = formKeys.has(b);
      if (aVis !== bVis) return aVis ? -1 : 1;       // visible rows first
      if (!aVis) return 0;                            // neither visible: keep cache order
      return (formRowDate.get(b) || '').localeCompare(formRowDate.get(a) || '');  // newest first
    });
  let backfilled = 0, backfillFailed = 0;
  for (const ek of pending.slice(0, MAX_BACKFILL_PER_RUN)) {
    backfilled++;
    try {
      const got = await fetchFixture(ek);
      await new Promise(r => setTimeout(r, PACE_MS));
      const e = cache[ek];
      // Written in place: the entry's point log and names are already correct and
      // must survive a fixture that comes back without one.
      e.stats = (got && got.stats) || null;   // key present even when null — asked once, never again
      if (got && got.p1Key != null) { e.p1Key = got.p1Key; e.p2Key = got.p2Key; }
      if (got && !e.p1 && got.p1) { e.p1 = got.p1; e.p2 = got.p2; }
    } catch (err) {
      // Leave the key absent so a transient failure retries next run.
      backfillFailed++;
      console.error(`set-stats: backfill failed for ${ek}: ${err.message}`);
    }
  }

  // One shard per match, so opening a single row fetches a single small file
  // instead of a multi-megabyte bundle. Written for every event key that has a
  // real, named log — window matches included.
  fs.mkdirSync(SHARD_DIR, { recursive: true });
  const index = [];
  for (const ek of Object.keys(cache)) {
    const e = cache[ek];
    if (!e || !e.sets || !e.sets.length || !e.p1) continue;   // no log, or unnamed legacy entry
    writeAtomic(`${SHARD_DIR}/${ek}.json`, JSON.stringify({ p1: e.p1, p2: e.p2, sets: e.sets }));
    index.push(ek);
  }
  // Which rows get a Point-by-point tab at all. The dashboard needs this BEFORE
  // it renders a row's tabs, and a 404 per logless row is not an answer it can
  // render against — so availability ships as data, not as a failed request.
  writeAtomic(INDEX_PATH, JSON.stringify(index));

  // Per-set box scores, same shard-and-index shape, separate files: a match can
  // have a point log with no set stats or set stats with no log (they are two
  // independent feeds), so one index cannot answer for both.
  fs.mkdirSync(SETSTATS_DIR, { recursive: true });
  const setIndex = [];
  for (const ek of Object.keys(cache)) {
    const e = cache[ek];
    if (!e || !e.stats || !Object.keys(e.stats).length) continue;
    if (e.p1Key == null || e.p2Key == null) continue;   // unorientable — a row could not tell which side is its own
    writeAtomic(`${SETSTATS_DIR}/${ek}.json`, JSON.stringify({ p1Key: e.p1Key, p2Key: e.p2Key, sets: e.stats }));
    setIndex.push(ek);
  }
  writeAtomic(SETSTATS_INDEX_PATH, JSON.stringify(setIndex));

  writeAtomic(CACHE_PATH, JSON.stringify(cache));
  writeAtomic(OUT_PATH, JSON.stringify(out));
  const kb = (fs.statSync(OUT_PATH).size / 1024).toFixed(0);
  console.log(`point-by-point: ${Object.keys(out).length} matches with point logs (${fetched} fetched, ${reused} cached, ${skipped} skipped) -> ${OUT_PATH} (${kb} KB)`);
  console.log(`point-by-point: ${index.length} shards -> ${SHARD_DIR}/ (${formResolved} recent-form rows resolved this run)`);
  console.log(`set-stats: ${setIndex.length} shards -> ${SETSTATS_DIR}/ (${backfilled} backfilled this run${backfillFailed ? `, ${backfillFailed} failed` : ''})`);
  // The backfill is capped per run, so early runs cover only part of the cache.
  // Report the remainder rather than letting a partial rollout read as complete.
  const awaitingStats = Object.keys(cache).filter(k => !('stats' in cache[k])).length;
  if (awaitingStats) {
    console.log(`set-stats: ${awaitingStats} cached matches still predate the set box score — they backfill on later runs (${MAX_BACKFILL_PER_RUN}/run cap).`);
  }
  if (formDeferred) {
    // Say it out loud rather than letting partial coverage read as complete.
    console.log(`point-by-point: ${formDeferred} recent-form matches deferred — hit the ${MAX_FETCHES_PER_RUN}-fetch/run cap; they resolve on later runs (cache is persistent).`);
  }
}

main().catch(e => { console.error('point-by-point: unexpected error —', e.message); process.exit(0); });
