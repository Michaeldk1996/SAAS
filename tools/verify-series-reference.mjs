#!/usr/bin/env node
/**
 * verify-series-reference.mjs — TEN-194 item 5, real-data verification.
 *
 * Two jobs, both against REAL data rather than fixtures:
 *
 *  1. INDEPENDENT RECOMPUTE. For every streak on the deployed board, enumerate the
 *     runs of its condition a second time — a separate implementation from the one
 *     that now ships inside build-series.js:streakReference() — and assert the two
 *     agree on `longest` and `occurrences`. Anything that disagrees is printed, not
 *     summarised away.
 *
 *  2. A DOCTORED ARTIFACT for the browser probe. The deployed series.json predates
 *     item 5 and carries no `reference`, so the CDP probe would only ever see the
 *     dash path. This writes an artifact with the engine's own references attached
 *     and rules.referenceWindow set, exactly as the next pipeline run will produce,
 *     so the shipped renderer can be measured on the shape it will actually meet.
 *
 * SURFACE MAP: taken from the DEPLOYED tournament-surfaces.json, never the committed
 * copy — TEN-195: the committed copy lags the pipeline's in-run refresh and resolves
 * current tournaments to surface=null, which fabricates a confident mismatch.
 *
 *   node tools/verify-series-reference.mjs [--max N] [--out artifact.json]
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
const { conditionHeld, orderedRecords, streakReference, loadStyleMap, MAX_GAP_DAYS, HISTORY_WINDOW_YEARS } = eng;

const argv = process.argv.slice(2);
const MAX = argv.includes('--max') ? +argv[argv.indexOf('--max') + 1] : Infinity;
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null;
const BASE = 'https://michaeldk1996.github.io/SAAS/';
const DAY = 86400000;

const get = async (f) => (await fetch(BASE + f, { cache: 'no-store' })).json();

// ── the independent recompute ────────────────────────────────────────────────
// Deliberately a different shape from streakReference(): it materialises the domain
// first, then segments on (held, gap) in one pass over index pairs, rather than
// building runs and re-splitting them. Same rules, different code path. conditionHeld
// is shared on purpose — it is the founder-ruled definition of the condition, and a
// second copy of THAT would be measuring my transcription, not the engine.
function recomputeReference(st, recs) {
  const dom = [];
  for (const r of recs) {
    const h = conditionHeld(st, r);
    if (h !== null) dom.push({ date: r.date, held: h });
  }
  const lens = [];
  let n = 0, prev = null;
  for (const d of dom) {
    const gap = prev ? Math.round((Date.parse(d.date + 'T00:00:00Z') - Date.parse(prev + 'T00:00:00Z')) / DAY) : 0;
    if (!d.held) { if (n) lens.push(n); n = 0; prev = d.date; continue; }
    if (n && gap > MAX_GAP_DAYS) { lens.push(n); n = 0; }
    n++; prev = d.date;
  }
  if (n) lens.push(n);
  if (!lens.length) return null;
  return {
    longest: Math.max(...lens),
    occurrences: lens.filter((L) => L >= st.count).length,
    tailLen: lens[lens.length - 1],
  };
}

const doc = await get('series.json');
// surfaceMap is a PLAIN OBJECT indexed by tournament_key (recordFor does
// surfaceMap[key], not .get) — a Map here silently resolves every surface to null and
// produces a confidently wrong "no runs found". Taken from the deployed copy, TEN-195.
const surfaceMap = (await get('tournament-surfaces.json')).surfaces || {};
// styleMap is the engine's own loader: a Map keyed by normName(name) -> archetype_label.
// Rebuilding it by hand mis-keys it and silently voids every vs-style streak. Safe to
// read locally: the deployed playing-styles.json is byte-identical to the committed one
// (verified this run) because the pipeline copies it rather than refreshing it.
const styleMap = loadStyleMap();

const nStreaks = doc.players.reduce((n, p) => n + p.streaks.length, 0);
console.log(`board ${doc.generatedAt} — ${doc.players.length} players, ${nStreaks} streaks`);
console.log(`surface map: deployed, ${Object.keys(surfaceMap).length} entries (committed copy has ${
  Object.keys(JSON.parse(fs.readFileSync(path.join(REPO, 'tournament-surfaces.json'), 'utf8')).surfaces || {}).length} — TEN-195)`);
console.log(`history window: ${HISTORY_WINDOW_YEARS} calendar years, tier-scoped\n`);

let agree = 0, disagree = [], engNull = 0, bothNull = 0, lone = 0;
const players = doc.players.slice(0, MAX);
for (const p of players) {
  let fixtures = [];
  try { fixtures = await fetchRecentSinglesFixtures(p.key); } catch (e) { console.error(`  ${p.name}: ${e.message}`); continue; }
  if (!fixtures.length) { console.error(`  ${p.name}: empty history`); continue; }
  const recs = orderedRecords(fixtures, p.key, p.tier, surfaceMap, styleMap, p.tier === 'tour');
  for (const st of p.streaks) {
    const a = streakReference(st, recs);        // the SHIPPED engine function
    const b = recomputeReference(st, recs);     // the independent recompute
    st.reference = a;                           // for the doctored artifact
    if (!a && !b) { bothNull++; continue; }
    if (!a) { engNull++; disagree.push({ p: p.name, st: st.subtype || st.type, why: 'engine null, recompute ' + JSON.stringify(b) }); continue; }
    // The recompute has no self-check, so compare it on the tail too: its last run must
    // be the emitted streak, which is what licenses the whole comparison.
    if (b.tailLen !== st.count) { disagree.push({ p: p.name, st: st.subtype || st.type, why: `tail ${b.tailLen} != emitted ${st.count}` }); continue; }
    if (a.longest !== b.longest || a.occurrences !== b.occurrences) {
      disagree.push({ p: p.name, st: st.subtype || st.type, why: `engine ${a.longest}/${a.occurrences} vs recompute ${b.longest}/${b.occurrences}` });
      continue;
    }
    agree++;
    if (a.occurrences === 1) lone++;
  }
  process.stderr.write(`  ${p.name} (${p.tier}) — ${recs.length} in-tier matches, ${p.streaks.length} streaks\n`);
}

console.log(`\nAGREE        ${agree}/${agree + disagree.length + engNull}`);
console.log(`both null    ${bothNull}  (no run of the condition anywhere in the window)`);
console.log(`lone runs    ${lone}  (occurrences === 1 → ruling reference-lone (a) prints "1st time at N+")`);
if (disagree.length) {
  console.log('\nDISAGREEMENTS:');
  disagree.forEach((d) => console.log(`  ${d.p} · ${d.st} — ${d.why}`));
}

if (OUT) {
  const y = new Date(doc.generatedAt).getFullYear() - HISTORY_WINDOW_YEARS;
  doc.rules = doc.rules || {};
  doc.rules.referenceWindow = { sinceYear: y, years: HISTORY_WINDOW_YEARS, scope: 'in-tier' };
  doc.rules.handicapDisplayLine = 3.5;
  fs.writeFileSync(OUT, JSON.stringify(doc));
  console.log(`\nwrote ${OUT} — sinceYear ${y}, ${nStreaks} streaks, ${agree} with a reference`);
}
process.exit(disagree.length ? 1 : 0);
