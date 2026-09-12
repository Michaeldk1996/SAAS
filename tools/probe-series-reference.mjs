#!/usr/bin/env node
/**
 * probe-series-reference.mjs — TEN-194, founder comment 2ae614ed item 5 + its
 * Report-before-changing question: "Is `career longest` computable per streak type, or
 * only for match outcomes?"
 *
 * This MEASURES the answer rather than asserting it. For every streak on the live
 * board it re-walks that player's whole in-tier history and enumerates EVERY run of
 * the streak's own condition — not just the current tail — so it can report, per
 * streak type:
 *
 *   longest      the longest run of this condition in the history window
 *   occurrences  how many distinct runs reached the CURRENT run's length ("Nth time at N+")
 *
 * Method: the condition is not re-implemented. build-series.js already exports
 * conditionHeld(streak, record) — the founder-ruled definition of "did this streak's
 * own condition hold in this match", used today to write CONTINUED/BROKEN into the
 * outcomes ledger. Feeding it every historical record gives the exact same domain and
 * the exact same state test that detection uses, so a reference can't drift from the
 * run it references.
 *
 * SELF-CHECK: the LAST run this enumeration produces must equal the streak the engine
 * emitted — same length, same member dates. Any streak where it doesn't is reported as
 * a mismatch, because then the reference would be describing a different run.
 *
 *   node tools/probe-series-reference.mjs [--max N] [--out file.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);
process.chdir(REPO);
require('dotenv').config({ quiet: true });

const eng = require(path.join(REPO, 'build-series.js'));
const { fetchRecentSinglesFixtures } = require(path.join(REPO, 'bsp-pipeline.js'));
const { conditionHeld, orderedRecords, loadSurfaceMap, loadStyleMap, MAX_GAP_DAYS } = eng;

const argv = process.argv.slice(2);
const MAX = argv.includes('--max') ? +argv[argv.indexOf('--max') + 1] : Infinity;
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null;
const DAY_MS = 86400000;

// Split a member list (oldest→newest) on any layoff longer than the engine's gap cut,
// so a historical run is judged by the same rule the current one is.
function splitOnGaps(members) {
  const out = [];
  let cur = [];
  for (const m of members) {
    if (cur.length) {
      const g = Math.floor((new Date(m.date + 'T00:00:00Z') - new Date(cur[cur.length - 1].date + 'T00:00:00Z')) / DAY_MS);
      if (g > MAX_GAP_DAYS) { out.push(cur); cur = []; }
    }
    cur.push(m);
  }
  if (cur.length) out.push(cur);
  return out;
}

// Every run of `st`'s condition across `recs`, oldest→newest, gap-cut applied.
function allRuns(st, recs) {
  const domain = [];
  for (const r of recs) {
    const h = conditionHeld(st, r);
    if (h === null) continue;              // not evaluable for this condition → excluded
    domain.push({ r, held: h });
  }
  const runs = [];
  let cur = [];
  for (const d of domain) {
    if (d.held) cur.push(d.r);
    else { if (cur.length) runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  const split = [];
  for (const run of runs) for (const seg of splitOnGaps(run)) split.push(seg);
  return { runs: split, domain: domain.length };
}

async function main() {
  const doc = await (await fetch('https://michaeldk1996.github.io/SAAS/series.json', { cache: 'no-store' })).json();
  const surfaceMap = loadSurfaceMap();
  const styleMap = loadStyleMap();
  console.log(`board: ${doc.players.length} players, ${doc.players.reduce((n, p) => n + p.streaks.length, 0)} streaks, generatedAt ${doc.generatedAt}`);
  console.log(`history window: fetchRecentSinglesFixtures = get_fixtures ${new Date().getFullYear() - 5}-01-01 .. today (5 calendar years), tier-scoped\n`);

  const rows = [];
  let checked = 0, selfOk = 0, selfBad = [];
  const players = doc.players.slice(0, MAX);
  for (const p of players) {
    let fixtures;
    try { fixtures = await fetchRecentSinglesFixtures(p.key); }
    catch (e) { console.error(`  ${p.name}: history fetch failed — ${e.message}`); continue; }
    if (!Array.isArray(fixtures) || !fixtures.length) { console.error(`  ${p.name}: empty history`); continue; }
    const recs = orderedRecords(fixtures, p.key, p.tier, surfaceMap, styleMap, p.tier === 'tour');
    const span = recs.length ? `${recs[0].date}..${recs[recs.length - 1].date}` : '—';
    for (const st of p.streaks) {
      const { runs, domain } = allRuns(st, recs);
      const last = runs.length ? runs[runs.length - 1] : null;
      const longest = runs.reduce((m, r) => Math.max(m, r.length), 0) || null;
      const occurrences = runs.filter((r) => r.length >= st.count).length;
      // self-check: the enumeration's final run must BE the emitted streak
      checked++;
      const same = last && last.length === st.count &&
        last.map((r) => r.date).join(',') === st.matches.map((m) => m.date).join(',');
      if (same) selfOk++;
      else selfBad.push({ player: p.name, type: st.type, subtype: st.subtype, emitted: st.count, enumerated: last ? last.length : 0 });
      rows.push({
        player: p.name, tier: p.tier, type: st.type, family: st.family, subtype: st.subtype,
        count: st.count, pool: st.pool, historySpan: span, historyMatches: recs.length,
        domain, runs: runs.length, longest, occurrences, selfCheck: !!same,
      });
    }
    process.stderr.write(`  ${p.name} (${p.tier}) — ${recs.length} in-tier matches ${span}, ${p.streaks.length} streaks\n`);
  }

  // ── report per streak TYPE: is a reference available? ──────────────────────────
  const byType = {};
  for (const r of rows) {
    const t = r.family || r.type;
    const b = byType[t] || (byType[t] = { n: 0, withLongest: 0, withOcc: 0, both: 0, longestGtCount: 0 });
    b.n++;
    if (r.longest != null) b.withLongest++;
    if (r.occurrences != null) b.withOcc++;
    if (r.longest != null && r.occurrences != null) b.both++;
    if (r.longest != null && r.longest > r.count) b.longestGtCount++;
  }
  console.log('\nREFERENCE AVAILABILITY BY FAMILY  (both = a full "longest N · Kth time at C+" sub-line)');
  console.log('family      streaks  longest  occurrences  both  longest>current');
  for (const t of Object.keys(byType).sort()) {
    const b = byType[t];
    console.log(`${t.padEnd(11)} ${String(b.n).padStart(7)} ${String(b.withLongest).padStart(8)} ${String(b.withOcc).padStart(12)} ${String(b.both).padStart(5)} ${String(b.longestGtCount).padStart(16)}`);
  }
  const tot = rows.length;
  const both = rows.filter((r) => r.longest != null && r.occurrences != null).length;
  console.log(`\nTOTAL ${both}/${tot} streaks can carry BOTH components; ${tot - both} would render the sub-line as a dash.`);
  console.log(`SELF-CHECK ${selfOk}/${checked} enumerated final runs equal the emitted streak exactly.`);
  if (selfBad.length) { console.log('MISMATCHES:'); for (const b of selfBad.slice(0, 20)) console.log('  ' + JSON.stringify(b)); }

  console.log('\nSAMPLE (longest 12 by run length):');
  rows.slice().sort((a, b) => b.count - a.count).slice(0, 12).forEach((r) => {
    console.log(`  ${(r.player || '').padEnd(20)} ${(r.subtype || r.type).padEnd(30)} now ${String(r.count).padStart(2)}  longest ${String(r.longest).padStart(2)}  ${r.occurrences}${['th','st','nd','rd'][(r.occurrences % 10 < 4 && Math.floor(r.occurrences / 10) !== 1) ? r.occurrences % 10 : 0]} time at ${r.count}+   (history ${r.historyMatches} matches ${r.historySpan})`);
  });

  if (OUT) { fs.writeFileSync(OUT, JSON.stringify({ generatedAt: doc.generatedAt, byType, rows }, null, 1)); console.log(`\nwrote ${OUT}`); }
}

main().catch((e) => { console.error('FATAL', e.stack || e.message); process.exit(1); });
