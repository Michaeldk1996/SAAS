#!/usr/bin/env node
/*
 * fetch-apitennis-fixtures.js — cache the CURRENT-SEASON finished ATP singles
 * fixtures so build-matchup-matrix.js can supplement the TML career pool.
 * ---------------------------------------------------------------------------
 * WHY: TEN-88 option B. The community TML mirror stops publishing the current
 *   season past mid-January, so every player's "career meetings vs this style"
 *   list drops ~99% of the live season (the Fery-vs-Cobolli "no meetings" gap).
 *   api-tennis carries the whole season with clean event_key + winner + status.
 *   This is the fetch half: it writes a flat cache the offline builder reads, so
 *   the matrix build stays reproducible from disk (no key needed at build time).
 *
 * SOURCE OF TRUTH: TML remains authoritative for everything it covers. This
 *   cache is a SUPPLEMENT; the builder dedupes it against TML on resolved-roster
 *   identity + date (the two sources overlap ~2 weeks in January).
 *
 * STATUS: `Finished` and `Retired` are real completed matches and are kept.
 *   `Walk Over` is NOT a played match and is dropped by the builder (it is still
 *   cached, with its status, so the exclusion is auditable rather than silent).
 *
 * SAFETY: like the styles regression guard, an api outage must never overwrite a
 *   good cache with a thin one. If the fresh pull is below a floor, or shrinks an
 *   existing cache by >20%, the old cache is kept and the process exits non-zero.
 *
 * USAGE
 *   API_TENNIS_KEY=... node tools/fetch-apitennis-fixtures.js
 *   node tools/fetch-apitennis-fixtures.js --season 2026 --out tml-cache/apitennis-2026.json
 */
'use strict';
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.api-tennis.com/tennis/';
const KEY = process.env.API_TENNIS_KEY;
const ROOT = path.join(__dirname, '..');

function argVal(flag, def) { const i = process.argv.indexOf(flag); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def; }

const SEASON = argVal('--season', '2026');
const OUT = path.join(ROOT, argVal('--out', `tml-cache/apitennis-${SEASON}.json`));
const MIN_ROWS = parseInt(argVal('--min-rows', '500'), 10);   // outage floor

// Pull the whole season up to "today" in ~31-day windows (api caps the span per
// call). We do NOT fetch beyond today — future fixtures carry no winner.
function ymd(d) { return d.toISOString().slice(0, 10); }
function windows(season) {
  const start = new Date(`${season}-01-01T00:00:00Z`);
  const today = new Date();
  const end = today < new Date(`${Number(season) + 1}-01-01T00:00:00Z`) ? today : new Date(`${season}-12-31T00:00:00Z`);
  const out = [];
  let cur = start;
  while (cur <= end) {
    const stop = new Date(Math.min(cur.getTime() + 30 * 86400000, end.getTime()));
    out.push([ymd(cur), ymd(stop)]);
    cur = new Date(stop.getTime() + 86400000);
  }
  return out;
}

async function fetchWindow(startStr, stopStr) {
  const url = `${API_BASE}?method=get_fixtures&APIkey=${KEY}&date_start=${startStr}&date_stop=${stopStr}&event_type_key=265`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${startStr}..${stopStr}`);
  const j = await r.json();
  return Array.isArray(j.result) ? j.result : [];
}

// Reduce an api fixture to the flat, source-agnostic row the builder ingests.
// winner: '1' | '2' | null; sets: [[firstGames, secondGames], ...] (player order,
// NOT winner order — the builder flips to the subject's perspective just like TML).
function toRow(f) {
  const st = String(f.event_winner || '');
  const winner = st === 'First Player' ? '1' : st === 'Second Player' ? '2' : null;
  const sets = Array.isArray(f.scores)
    ? f.scores
        .filter(s => s && s.score_first != null && s.score_second != null)
        .map(s => [String(s.score_first), String(s.score_second)])
    : [];
  return {
    event_key: f.event_key,
    date: f.event_date || null,
    p1: f.event_first_player || null,
    p2: f.event_second_player || null,
    winner,
    status: f.event_status || null,        // Finished | Retired | Walk Over
    tournament: f.tournament_name || null,
    tournament_key: f.tournament_key != null ? String(f.tournament_key) : null,  // surface join key (tournament-surfaces.json)
    round: f.tournament_round || null,
    sets,
  };
}

async function main() {
  if (!KEY) { console.error('ERROR: API_TENNIS_KEY not set'); process.exit(2); }
  const seen = new Set();
  const rows = [];
  for (const [a, b] of windows(SEASON)) {
    let batch;
    try { batch = await fetchWindow(a, b); }
    catch (e) { console.error(`  window ${a}..${b}: ${e.message}`); throw e; }
    let kept = 0;
    for (const f of batch) {
      if (!f || f.event_key == null) continue;
      if (seen.has(f.event_key)) continue;         // api can repeat a fixture across overlapping windows
      seen.add(f.event_key);
      const row = toRow(f);
      // Only completed matches carry a winner we can pool. Keep Walk Over rows too
      // (status preserved) so the builder's exclusion is auditable, but a fixture
      // with no winner AND no status is a scheduling placeholder — drop it.
      if (!row.winner && !row.status) continue;
      rows.push(row);
      kept++;
    }
    console.error(`  ${a}..${b}: ${batch.length} fixtures, ${kept} kept (running ${rows.length})`);
  }

  // Outage guard: never clobber a good cache with a thin one.
  let prevCount = 0;
  if (fs.existsSync(OUT)) {
    try { prevCount = (JSON.parse(fs.readFileSync(OUT, 'utf8')).fixtures || []).length; } catch {}
  }
  if (rows.length < MIN_ROWS || (prevCount && rows.length < prevCount * 0.8)) {
    console.error(`REFUSING to write: fresh=${rows.length} rows < floor ${MIN_ROWS} or <80% of existing ${prevCount}. Keeping old cache.`);
    process.exit(1);
  }

  const finished = rows.filter(r => r.status === 'Finished').length;
  const retired = rows.filter(r => r.status === 'Retired').length;
  const walkover = rows.filter(r => r.status === 'Walk Over').length;
  const out = {
    generatedAt: new Date().toISOString(),
    season: SEASON,
    source: 'api-tennis get_fixtures (event_type_key=265, ATP singles), whole season to date',
    counts: { total: rows.length, finished, retired, walkover },
    fixtures: rows,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.error(`\nWrote ${OUT} — ${rows.length} rows (finished ${finished}, retired ${retired}, walkover ${walkover}).`);
}

main().catch(e => { console.error(e); process.exit(1); });
