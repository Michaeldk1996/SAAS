#!/usr/bin/env node
'use strict';
// TEN-323 — box-score store coverage, per tier and year, with denominators.
//
// Same population as TEN-312 phase0-b §1.3 so the numbers compare: distinct keyed
// matches (eventKey) in the career-history/{key}.json shards of every roster player,
// deduped on eventKey, dated 2021-01-01..--through. Tier: level "atp" = ATP; level
// "chitf" = ITF when the tournament is ^M\d+ or contains "ITF", left out when it is a
// Slam, Challenger otherwise.
//
// Store sets are read from a published site directory (the Pages artifact, or a local
// _site): matchstats-index.json ∪ historical-match-stats.json (a populated
// matchStats), setstats-index.json, pbp-index.json. --archive adds the tier-page
// archive as build-point-by-point.js would emit it, so "after" is the store the next
// pipeline run publishes. W/UE per event is read from the archive's own box scores.
//
//   node tools/ten323-coverage-report.js --site=<dir> [--archive=boxscore-archive]
//        [--through=YYYY-MM-DD] [--json=out.json]

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const arg = (n, d) => { const h = process.argv.find(a => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const SITE = arg('site');
const ARCHIVE = arg('archive');
const THROUGH = arg('through', new Date().toISOString().slice(0, 10));
if (!SITE) { console.error('--site=<published site dir> is required'); process.exit(1); }

const SLAM = /wimbledon|australian open|french open|roland garros|us open/i;
function tierOf(r) {
  if (r.level === 'atp') return 'ATP';
  if (r.level !== 'chitf') return null;
  const t = String(r.tournament || '');
  if (/^M\d+/.test(t) || /ITF/.test(t)) return 'ITF';
  if (SLAM.test(t)) return null;
  return 'Challenger';
}

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const populated = ms => !!(ms && (Object.keys(ms.p1 || {}).length || Object.keys(ms.p2 || {}).length));
const hasWue = ms => !!ms && ['p1', 'p2'].every(s => ms[s] && ms[s]['Points:Winners'] != null && ms[s]['Points:Unforced errors'] != null);

// Population
const pop = new Map();   // ek -> { tier, year }
const chDir = path.join(SITE, 'career-history');
let players = 0;
for (const f of fs.readdirSync(chDir).filter(f => /^\d+\.json$/.test(f))) {
  players++;
  for (const r of (readJson(path.join(chDir, f)).matches || [])) {
    if (!r || r.eventKey == null || !r.date || r.date < '2021-01-01' || r.date > THROUGH) continue;
    const tier = tierOf(r);
    if (!tier) continue;
    const ek = String(r.eventKey);
    if (!pop.has(ek)) pop.set(ek, { tier, year: r.date.slice(0, 4) });
  }
}

// Stores, before
const box = new Set(readJson(path.join(SITE, 'matchstats-index.json')).map(String));
const hmsPath = path.join(SITE, 'historical-match-stats.json');
if (fs.existsSync(hmsPath)) for (const [ek, v] of Object.entries(readJson(hmsPath))) if (populated(v && v.matchStats)) box.add(String(ek));
const set = new Set(readJson(path.join(SITE, 'setstats-index.json')).map(String));
const pbp = new Set(readJson(path.join(SITE, 'pbp-index.json')).map(String));
const before = { box: new Set(box), set: new Set(set), pbp: new Set(pbp) };

// Archive -> after (same emit rules as build-point-by-point.js emitEntry)
const events = new Map();   // tier|year|event -> { box, wue }
let archived = 0;
if (ARCHIVE) {
  for (const f of fs.readdirSync(ARCHIVE).filter(f => /^\d+-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(f)).sort()) {
    const week = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(ARCHIVE, f))).toString('utf8'));
    for (const [ek, e] of Object.entries(week)) {
      archived++;
      const orientable = e.p1Key != null && e.p2Key != null;
      if (orientable && populated(e.matchStats)) box.add(ek);
      if (orientable && e.stats && Object.keys(e.stats).length) set.add(ek);
      if (e.sets && e.sets.length && e.p1) pbp.add(ek);
      if (populated(e.matchStats)) {
        const k = `${e.t === 'atp' ? 'ATP' : 'Challenger'}|${String(e.d).slice(0, 4)}|${e.tn}`;
        const ev = events.get(k) || { box: 0, wue: 0 };
        ev.box++; if (hasWue(e.matchStats)) ev.wue++;
        events.set(k, ev);
      }
    }
  }
}

// Tables
const rows = [];
for (const tier of ['ATP', 'Challenger', 'ITF']) for (const year of ['2021', '2022', '2023', '2024', '2025', '2026']) {
  const keys = [...pop].filter(([, v]) => v.tier === tier && v.year === year).map(([k]) => k);
  if (!keys.length) continue;
  const n = s => keys.filter(k => s.has(k)).length;
  rows.push({ tier, year, N: keys.length, boxBefore: n(before.box), boxAfter: n(box), setBefore: n(before.set), setAfter: n(set), pbpBefore: n(before.pbp), pbpAfter: n(pbp) });
}
const wue = [];
const byTY = new Map();
for (const [k, ev] of events) {
  const [tier, year] = k.split('|');
  const g = byTY.get(`${tier}|${year}`) || { tier, year, events: 0, all: 0, some: 0, none: 0, matches: 0, wueMatches: 0 };
  g.events++; g.matches += ev.box; g.wueMatches += ev.wue;
  if (ev.wue === ev.box) g.all++; else if (ev.wue) g.some++; else g.none++;
  byTY.set(`${tier}|${year}`, g);
}
for (const g of byTY.values()) wue.push(g);
wue.sort((a, b) => (a.tier + a.year).localeCompare(b.tier + b.year));

const pct = (a, b) => b ? `${(100 * a / b).toFixed(1)}%` : '–';
console.log(`population: ${pop.size} keyed matches from ${players} career-history shards, 2021-01-01..${THROUGH}; archive entries read: ${archived}`);
console.log('\ntier        year      N   box before -> after          per-set before -> after      pbp before -> after');
for (const r of rows) {
  console.log(`${r.tier.padEnd(11)} ${r.year} ${String(r.N).padStart(6)}   ${String(r.boxBefore).padStart(5)} -> ${String(r.boxAfter).padStart(5)} (${pct(r.boxAfter, r.N).padStart(6)})   ${String(r.setBefore).padStart(5)} -> ${String(r.setAfter).padStart(5)} (${pct(r.setAfter, r.N).padStart(6)})   ${String(r.pbpBefore).padStart(5)} -> ${String(r.pbpAfter).padStart(5)} (${pct(r.pbpAfter, r.N).padStart(6)})`);
}
if (wue.length) {
  console.log('\nW/UE per event (archive box scores; W and UE both non-null on BOTH sides)');
  console.log('tier        year  events  all  some  none   matches with W/UE');
  for (const g of wue) console.log(`${g.tier.padEnd(11)} ${g.year}  ${String(g.events).padStart(6)} ${String(g.all).padStart(4)} ${String(g.some).padStart(5)} ${String(g.none).padStart(5)}   ${g.wueMatches}/${g.matches} (${pct(g.wueMatches, g.matches)})`);
}
const out = arg('json');
if (out) fs.writeFileSync(out, JSON.stringify({ through: THROUGH, population: pop.size, players, archived, rows, wue, events: Object.fromEntries(events) }, null, 1));
