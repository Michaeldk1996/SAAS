#!/usr/bin/env node
// TEN-437 · pipeline reconciliation for the head-to-head record (founder 2026-10-14: "each run, log total H2H meetings
// across the fixture pairs; if it drops versus the previous run, the step fails loudly. No `|| true`.")
//
// Reads the career-history shards and the roster THIS run built (<site>/career-history/, <site>/player-profiles.json),
// runs the production join (h2h-core.js) over every golden pair (tools/fixtures/ten437/h2h-golden-pairs.json), and:
//   1. logs each pair's record and the total meetings;
//   2. FAILS if the total is below the previous run's (<SITE>/h2h-reconcile.json, the file the last published run wrote);
//   3. FAILS if any exact golden pair has fewer meetings than ATP's count on its check date — meetings never disappear,
//      so this floor needs no previous run and no network: an unreachable previous file can never switch the guard off;
//   4. writes <site>/h2h-reconcile.json for the next run.
// The drop check compares runs built from the SAME golden fixture (its sha-256 travels in the file): rebuilding the
// fixture (tools/ten437-golden-build.mjs — a reviewed code change) resets the baseline, so a deliberate correction that
// lowers the total can ship; nothing else can lower it.
// A missing previous file (first run, or the site unreachable) is said in the log; checks 1, 3 and 4 still run.
//
// Run: node tools/h2h-reconcile.mjs --site _site [--previous <url-or-file>]
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const H2HCore = createRequire(import.meta.url)(path.join(ROOT, 'h2h-core.js'));
const GOLDEN = path.join(ROOT, 'tools/fixtures/ten437/h2h-golden-pairs.json');
const PREVIOUS_URL = 'https://michaeldk1996.github.io/SAAS/h2h-reconcile.json';

// Pure: the verdict over one run. `shard(key)` → rows (or null when the store has no file for him); `names` → roster.
export function goldenHash(golden) { return crypto.createHash('sha256').update(JSON.stringify(golden.pairs.map(p => [p.a.key, p.b.key, p.atp, !!p.knownGap]))).digest('hex').slice(0, 16); }
export function reconcile({ golden, shard, names, previous, shardId }) {
  const nk = H2HCore.nameCounts(names);
  // TEN-437 D3: each side's TML/ATP id as the screens read it — the run's own shard `id`, else the fixture's (a player
  // with no shard, e.g. a retired opponent)
  const side = s => Object.assign({}, s, { id: (shardId && shardId(s.key)) || s.id || null });
  const pairs = golden.pairs.map(p => {
    const chA = shard(p.a.key) || [], chB = shard(p.b.key) || [];
    const r = H2HCore.record(H2HCore.joinMeetings(side(p.a), side(p.b), chA, chB, nk, []));
    return { a: p.a.short, b: p.b.short, rec: `${r.a}-${r.b}`, n: r.n, atp: p.atp.n, knownGap: !!p.knownGap };
  });
  const total = pairs.reduce((s, x) => s + x.n, 0);
  const errors = [];
  pairs.filter(x => !x.knownGap && x.n < x.atp).forEach(x => errors.push(`${x.a} – ${x.b}: ${x.n} meetings, below ATP's ${x.atp} on ${golden.checkedOn}`));
  const hash = goldenHash(golden);
  const sameFixture = !!previous && previous.golden === hash;
  const prevTotal = sameFixture && Number.isFinite(previous.total) ? previous.total : null;
  if (prevTotal != null && total < prevTotal) errors.push(`total H2H meetings across ${pairs.length} golden pairs fell from ${prevTotal} (previous run) to ${total}`);
  return { ok: !errors.length, total, prevTotal, pairs, errors, hash, fixtureChanged: !!previous && !sameFixture };
}

async function readPrevious(src) {
  try {
    if (/^https?:/.test(src)) { const r = await fetch(src, { cache: 'no-store' }); if (!r.ok) return { why: `HTTP ${r.status}` }; return { json: await r.json() }; }
    return { json: JSON.parse(fs.readFileSync(src, 'utf8')) };
  } catch (e) { return { why: e.message }; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
  const site = arg('--site') || '_site';
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const dir = path.join(site, 'career-history');
  if (!fs.existsSync(dir)) { console.error(`::error::TEN-437 H2H reconcile: ${dir} is missing — the store this run built cannot be read`); process.exit(1); }
  const read = key => { const f = path.join(dir, `${key}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
  const shard = key => { const d = read(key); return d ? (d.matches || []) : null; };
  const shardId = key => { const d = read(key); return (d && d.id) || null; };
  const profiles = JSON.parse(fs.readFileSync(path.join(site, 'player-profiles.json'), 'utf8')).players || {};
  const names = Object.values(profiles).map(p => p && p.name).filter(Boolean);
  if (!names.length) { console.error('::error::TEN-437 H2H reconcile: the built player-profiles.json names no player — no roster to judge namesakes'); process.exit(1); }
  const prev = await readPrevious(arg('--previous') || PREVIOUS_URL);
  const v = reconcile({ golden, shard, names, previous: prev.json, shardId });
  v.pairs.forEach(x => console.log(`  ${x.a} – ${x.b}: ${x.rec} over ${x.n}${x.knownGap ? ' (known gap)' : ''} · ATP ${x.atp}`));
  console.log(`TEN-437: ${v.total} H2H meetings across ${v.pairs.length} golden pairs (previous run: ${v.prevTotal == null ? 'none to compare — ' + (v.fixtureChanged ? 'the golden fixture changed since, baseline reset' : prev.why || 'no total in the file') : v.prevTotal}).`);
  fs.writeFileSync(path.join(site, 'h2h-reconcile.json'), JSON.stringify({ v: 1, builtAt: new Date().toISOString(), total: v.total, golden: v.hash,
    goldenCheckedOn: golden.checkedOn, pairs: v.pairs }) + '\n');
  if (!v.ok) { v.errors.forEach(e => console.error(`::error::TEN-437 H2H reconcile: ${e}`)); process.exit(1); }
}
