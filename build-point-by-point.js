// Point-by-point sidecar generator (Task 4).
//
// Produces `point-by-point.json` — a lazy-loaded companion the dashboard fetches
// ONLY when the user opens a match's "Point by point" view, so it never touches
// the initial page load. Covers FINISHED matches only (a completed match's
// point log is immutable, so it is fetched once and cached forever).
//
// Data source: api-tennis get_fixtures?match_key=<eventKey> returns a
// `pointbypoint` array of game entries; each game carries the running score and
// a `points` list. We compact that to p1/p2 terms keyed by the dashboard's
// match id (e.g. "past-12145200"), matching how the dashboard keys matches.
//
// Decoupled from the main pipeline on purpose: if this fails, the site still
// deploys (the workflow runs it best-effort). It reuses a persistent cache so
// each run only fetches point logs it has never seen.

const fs = require('fs');
try { require('dotenv').config({ quiet: true }); } catch (_) { /* dotenv optional */ }

const API_TENNIS_KEY = process.env.API_TENNIS_KEY;
const API_TENNIS_BASE = 'https://api.api-tennis.com/tennis/';

const MATCHES_PATH = 'matches.json';
const OUT_PATH = 'point-by-point.json';
const CACHE_PATH = 'point-by-point-cache.json';
const PACE_MS = 150;

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

async function fetchPbp(eventKey) {
  const url = `${API_TENNIS_BASE}?method=get_fixtures&APIkey=${API_TENNIS_KEY}&match_key=${eventKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${eventKey}`);
  const data = await res.json();
  const result = Array.isArray(data.result) ? data.result : [];
  if (!result.length) return null;
  return result[0].pointbypoint || null;
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

    let compact = provisional ? null : cache[ek];  // immutable once captured
    if (!compact) {
      try {
        const raw = await fetchPbp(ek);
        compact = compactPbp(raw);
        if (!provisional) cache[ek] = compact || { sets: [] };  // cache the negative too, avoid refetching
        fetched++;
        await new Promise(r => setTimeout(r, PACE_MS));
      } catch (e) {
        console.error(`point-by-point: fetch failed for ${m.id} (${ek}): ${e.message}`);
        skipped++;
        continue;
      }
    } else {
      reused++;
    }

    if (compact && compact.sets && compact.sets.length) {
      out[m.id] = { p1: m.p1, p2: m.p2, ...compact };
    }
  }

  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
  fs.writeFileSync(OUT_PATH, JSON.stringify(out));
  const kb = (fs.statSync(OUT_PATH).size / 1024).toFixed(0);
  console.log(`point-by-point: ${Object.keys(out).length} matches with point logs (${fetched} fetched, ${reused} cached, ${skipped} skipped) -> ${OUT_PATH} (${kb} KB)`);
}

main().catch(e => { console.error('point-by-point: unexpected error —', e.message); process.exit(0); });
