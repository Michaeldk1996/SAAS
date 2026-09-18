#!/usr/bin/env node
'use strict';
// TEN-206 — historical-match-stats.json tier sweep (window pages, not per-match).
//
// WHY THIS EXISTS. The pipeline fills historical-match-stats.json one call per
// match (`get_fixtures&match_key=<eventKey>`), capped at FORM_STATS_MAX_FETCHES
// per run. That is the right shape for the steady state — a handful of new rows
// a day — and the wrong shape for a backfill: 798 missing Challenger entries at
// one call each is 798 requests. The SAME rows come back for free on the tier's
// month page (`get_fixtures&date_start&date_stop&event_type_key`), which carries
// the full `statistics` array inline. 798 matches → 25 requests.
//
// The founder approved ~33 requests for the Challenger sweep (2026-09-18). That
// budget is enforced here, not remembered: --max-requests is a hard stop.
//
// MERGE RULE — upgrade-only, never downgrade. An entry is replaced ONLY when the
// freshly-extracted box score carries strictly more populated stat fields than
// the cached one. This matters because the month page and the per-match page are
// not always the same depth, and because a re-run must never be able to make
// coverage go backwards. A cached `{matchStats:null}` (a genuine provider miss)
// is upgradable — the null was recorded when only the per-match page had been
// asked, and the tier page is a different question.
//
// It reuses buildMatchStatsFromFixture() from bsp-pipeline.js rather than
// re-implementing the extraction: the stat_name case-folding fix
// (tools/test-statname-casing.js) lives in there, and a second copy of the
// parser is exactly how that bug got in.
//
// Usage:
//   node tools/backfill-match-stats-sweep.js --tier=281 --from=2026-03 --to=2026-09 \
//        [--max-requests=33] [--dry-run] [--report=path.json]

const fs = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });

const { buildMatchStatsFromFixture } = require(path.join(__dirname, '..', 'bsp-pipeline.js'));

const API_TENNIS_BASE = 'https://api.api-tennis.com/tennis/';
const CACHE_PATH = path.join(__dirname, '..', 'historical-match-stats.json');

function arg(name, fallback) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const FLAG = name => process.argv.includes(`--${name}`);

// Months are the sweep unit: a Challenger month page is ~1,100 fixtures / ~35 MB,
// which the feed serves in ~75s. A quarter page triples both and starts timing
// out — measured, not assumed.
function monthWindows(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ey, em] = to.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    out.push({
      start: `${y}-${String(m).padStart(2, '0')}-01`,
      stop: `${y}-${String(m).padStart(2, '0')}-${last}`,
    });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

// The merge currency lives in the store, not here — tools/match-stats-store.js
// freeze() enforces the same "coverage may not go backwards" rule at commit time
// and the two must agree by construction, not by both being careful.
const { depth, strictlyDeeper } = require(path.join(__dirname, 'match-stats-store.js'));

async function main() {
  const KEY = process.env.API_TENNIS_KEY;
  if (!KEY) { console.error('sweep: API_TENNIS_KEY not set.'); process.exit(1); }

  const tier = arg('tier', '281');
  const from = arg('from');
  const to = arg('to');
  const maxRequests = Number(arg('max-requests', '33'));
  const dryRun = FLAG('dry-run');
  if (!from || !to) { console.error('sweep: --from=YYYY-MM and --to=YYYY-MM are required.'); process.exit(1); }

  const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  const before = Object.fromEntries(Object.entries(cache).map(([k, v]) => [k, depth(v && v.matchStats)]));

  const windows = monthWindows(from, to);
  if (windows.length > maxRequests) {
    console.error(`sweep: ${windows.length} windows exceeds the --max-requests=${maxRequests} budget. Narrow the range or raise the budget explicitly.`);
    process.exit(1);
  }

  const log = { tier, from, to, requests: 0, windows: [], upgraded: [], skippedNotInCache: 0 };

  for (const w of windows) {
    if (log.requests >= maxRequests) { console.log(`sweep: request budget ${maxRequests} reached — stopping.`); break; }
    const url = `${API_TENNIS_BASE}?method=get_fixtures&APIkey=${KEY}&date_start=${w.start}&date_stop=${w.stop}&event_type_key=${tier}`;
    let data;
    try {
      const res = await fetch(url);
      log.requests++;
      // A rate-limited or errored window must NOT read as an empty month. Without
      // these two checks api-tennis's {success:0} shape and a non-200 both fall
      // through to `fixtures = []` and print `fixtures=0 upgraded=0` — identical
      // output to a genuinely empty tier page, while still burning budget. The
      // "ITF publishes no box score" conclusion rests on telling those apart.
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      if (!data || data.success !== 1) throw new Error(`feed returned success=${data && data.success}`);
    } catch (e) {
      log.windows.push({ ...w, error: e.message });
      console.error(`sweep: ${w.start}..${w.stop} FAILED — ${e.message} (budget spent, no data)`);
      continue;
    }
    const fixtures = Array.isArray(data.result) ? data.result : [];
    // Counted for EVERY fixture on the page, not just the ones we cache. Without
    // it "upgraded=0" is ambiguous between "the feed has no box score for this
    // tier" and "our cached copies were already as deep as the page" — and those
    // two want opposite follow-ups. With it the page is its own control: the
    // Challenger June page reads 1072/1113, the ITF August page reads 0/1797.
    const withStats = fixtures.filter(f => Array.isArray(f.statistics) && f.statistics.length > 0).length;
    let hit = 0, up = 0;
    for (const f of fixtures) {
      const ek = String(f.event_key);
      if (!(ek in cache)) { log.skippedNotInCache++; continue; }
      hit++;
      if (!f.first_player_key || !f.second_player_key) continue;
      const fresh = buildMatchStatsFromFixture(f, f.first_player_key, f.second_player_key);
      if (strictlyDeeper(cache[ek] && cache[ek].matchStats, fresh)) {
        if (!dryRun) {
          cache[ek] = { p1Key: f.first_player_key, p2Key: f.second_player_key, matchStats: fresh };
        }
        up++;
        log.upgraded.push({ eventKey: ek, tournament: f.tournament_name, date: f.event_date, from: before[ek], to: depth(fresh) });
      }
    }
    log.windows.push({ ...w, fixtures: fixtures.length, withStats, inCache: hit, upgraded: up });
    console.log(`sweep ${w.start}..${w.stop}  fixtures=${String(fixtures.length).padStart(5)}  with-stats=${String(withStats).padStart(5)}  in-cache=${String(hit).padStart(4)}  upgraded=${String(up).padStart(4)}`);
  }

  if (!dryRun) {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
    console.log(`sweep: wrote ${CACHE_PATH} (${Object.keys(cache).length} entries, ${log.upgraded.length} upgraded, ${log.requests} requests).`);
  } else {
    console.log(`sweep: DRY RUN — ${log.upgraded.length} entries would be upgraded across ${log.requests} requests.`);
  }

  const reportPath = arg('report');
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(log, null, 2));
}

main().catch(e => { console.error('sweep: unexpected error —', e); process.exit(1); });
