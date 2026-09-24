#!/usr/bin/env node
// tools/ten263-extract-captured-pinnacle.mjs — TEN-263 §2a, ONE-TIME extract.
//
// Captured Pinnacle closes for finished board matches: the oddspapi Pinnacle price series
// the board carried in matches.json (oddsMovement.books.Pinnacle) from 2026-07-12 until
// the feed dropped Pinnacle (last series 2026-09-02). It is a CLOSED historical set, so it
// is extracted once from git history and committed as captured-closes-pinnacle.json; the
// pipeline never regenerates it (CI checks out depth 100 and could not).
//
// "Went live" = the ACTUAL start (oddspapi trueStart, from .ten225-fixture-index.json.gz),
// never the scheduled time: 170 of these series hold ticks after the actual start. A
// match whose actual start cannot be found uniquely is dropped. Each side's close is its
// LAST tick at or before the actual start; both sides are required (one book, both sides).
// api-tennis bookNow.Pncl snapshots are NOT used: api-tennis has no actual start, so an
// in-play price cannot be ruled out there.
//
// Usage: node tools/ten263-extract-captured-pinnacle.mjs <repo-with-full-history> [out.json]
// (read-only on the repo: `git show <sha>:matches.json` only)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');
const { keyFromOurName } = require(path.join(root, 'build-odds-performance.js'));

const repo = process.argv[2];
const out = process.argv[3] || path.join(root, 'captured-closes-pinnacle.json');
if (!repo) { console.error('usage: ten263-extract-captured-pinnacle.mjs <repo> [out]'); process.exit(2); }
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { maxBuffer: 1 << 29 }).toString();

const commits = git('log', '--format=%H', '--since=2026-07-01', '--', 'matches.json').trim().split('\n').filter(Boolean).reverse();
const ev = {};
for (const h of commits) {
  let M; try { M = JSON.parse(git('show', `${h}:matches.json`)); } catch (e) { continue; }
  for (const m of (Array.isArray(M) ? M : M.matches || [])) {
    const ek = String(m.id || '').replace(/^[a-z]+-/, '');
    if (!/^\d+$/.test(ek)) continue;
    const pin = m.oddsMovement && m.oddsMovement.books && m.oddsMovement.books.Pinnacle;
    if (!pin) continue;
    const o = ev[ek] || (ev[ek] = { p1: m.p1, p2: m.p2, p1Key: m.p1Key, p2Key: m.p2Key, date: m.date, tour: m.tour, t1: new Map(), t2: new Map() });
    for (const [side, map] of [['p1', o.t1], ['p2', o.t2]]) for (const t of pin[side] || []) if (t && t[0] != null) map.set(String(t[0]), Number(t[1]));
  }
}
const fx = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, '.ten225-fixture-index.json.gz'))).toString()).fixtures;
const sur = (name) => (keyFromOurName(name) || {}).surname || null;          // our "J. Sinner"
const surComma = (name) => { const s = String(name || ''); return s.includes(',') ? (keyFromOurName('X. ' + s.split(',')[0].trim()) || {}).surname : null; };
const fxByDay = new Map();
for (const e of Object.values(fx)) {
  if (!e || !e.trueStart || !['ATP', 'Davis Cup'].includes(e.cat)) continue;
  const d = e.trueStart.slice(0, 10);
  (fxByDay.get(d) || fxByDay.set(d, []).get(d)).push(e);
}
const day = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const stats = { series: 0, noStart: 0, ambiguousStart: 0, oneSided: 0, stale: 0, kept: 0, hadPostStartTicks: 0 };
const rows = [];
for (const [ek, o] of Object.entries(ev)) {
  stats.series++;
  const want = new Set([sur(o.p1), sur(o.p2)]);
  const cands = [-1, 0, 1].flatMap(n => fxByDay.get(day(o.date, n)) || [])
    .filter(e => { const s = new Set([surComma(e.p1), surComma(e.p2)]); return [...want].every(x => x && s.has(x)); });
  if (!cands.length) { stats.noStart++; continue; }
  if (new Set(cands.map(e => e.trueStart)).size > 1) { stats.ambiguousStart++; continue; }
  const cut = Date.parse(cands[0].trueStart);
  const last = (map) => { let best = null; for (const [ts, p] of map) { const t = Date.parse(ts); if (t <= cut && (!best || t > best[0])) best = [t, p]; } return best; };
  if ([...o.t1.keys(), ...o.t2.keys()].some(ts => Date.parse(ts) > cut)) stats.hadPostStartTicks++;
  const a = last(o.t1), b = last(o.t2);
  if (!a || !b || !(a[1] >= 1.01) || !(b[1] >= 1.01)) { stats.oneSided++; continue; }
  if (cut - Math.min(a[0], b[0]) > 7 * 864e5) { stats.stale++; continue; }     // no tick in the last week before the off
  rows.push({ eventKey: Number(ek), date: o.date, p1Key: o.p1Key, p2Key: o.p2Key, p1Name: o.p1, p2Name: o.p2,
    p1: a[1], p2: b[1], at: new Date(Math.max(a[0], b[0])).toISOString(), trueStart: cands[0].trueStart });
  stats.kept++;
}
rows.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.eventKey - y.eventKey));
const doc = { generatedAt: new Date().toISOString(), source: 'matches.json git history, oddsMovement.books.Pinnacle (oddspapi)',
  rule: 'each side = last tick at or before oddspapi trueStart (actual start); both sides required; dropped when no unique actual start',
  commitsScanned: commits.length, stats, rows };
fs.writeFileSync(out + '.tmp', JSON.stringify(doc, null, 1)); fs.renameSync(out + '.tmp', out);
console.log(JSON.stringify({ commits: commits.length, ...stats }));
