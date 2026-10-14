#!/usr/bin/env node
// TEN-437 · builds tools/fixtures/ten437/h2h-golden-pairs.json — the golden-pair CI gate's input (test-ten437-h2h.mjs).
//
// Each pair = ATP's OFFICIAL head-to-head (the `Record` fields of atptour.com's H2H endpoint
// /en/-/www/h2h/{codeA}/{codeB}, read on CHECKED_ON) + the career-history rows the site's ONE join reads for that pair,
// copied from the LIVE shards (https://michaeldk1996.github.io/SAAS/career-history/{key}.json — gitignored stores, so
// the gate carries its own copy) + the live roster's namesake count for the two names (player-profiles.json).
// The gate then runs the production H2HCore.joinMeetings on those rows and fails on any pair that differs from ATP.
//
// Rows kept per side: every row naming the other player (surname + initial) and every row sharing an eventKey with the
// other side's rows — exactly what joinMeetings can touch for this pair, archive rows (no eventKey) included.
//
// Run (operator machine, network): node tools/ten437-golden-build.mjs [--check]
//   --check  rebuild in memory and report pairs whose live data now disagrees with ATP; writes nothing.
// Re-checking ATP itself is manual: update `atp` and CHECKED_ON per pair from the endpoint (WebFetch reaches it; curl
// gets 403 from datacenter IPs) — never from memory.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const H2HCore = createRequire(import.meta.url)(path.join(ROOT, 'h2h-core.js'));
const SITE = 'https://michaeldk1996.github.io/SAAS';
const OUT = path.join(ROOT, 'tools/fixtures/ten437/h2h-golden-pairs.json');
const CHECKED_ON = '2026-10-14';

// [A short name, A key, A ATP code, B short name, B key, B ATP code, ATP wins A, ATP wins B, what the pair proves]
const PAIRS = [
  // the 18 pairs of the Phase 1 scale table
  ['C. Alcaraz', 2382, 'a0e2', 'J. Sinner', 2072, 's0ag', 10, 7, 'retirement counted (Cincinnati 2025 F)'],
  ['N. Djokovic', 1905, 'd643', 'R. Nadal', 2170, 'n409', 31, 29, 'one-sided: Nadal has no history file'],
  ['N. Djokovic', 1905, 'd643', 'R. Federer', 7357, 'f324', 27, 23, 'one-sided; the 2014 ATP Finals final walkover is listed by ATP, not counted'],
  ['A. Zverev', 1980, 'z355', 'D. Medvedev', 1093, 'mm58', 8, 14, 'ATP Cup 2021 counted'],
  ['J. Sinner', 2072, 's0ag', 'D. Medvedev', 1093, 'mm58', 10, 7, ''],
  ['A. Rublev', 2847, 're44', 'S. Tsitsipas', 1906, 'te51', 6, 6, 'Next Gen Finals 2018 counted, a Challenger not'],
  ['T. Fritz', 2832, 'fb98', 'F. Tiafoe', 2846, 'td51', 7, 2, ''],
  ['D. Medvedev', 1093, 'mm58', 'S. Tsitsipas', 1906, 'te51', 10, 5, 'the TEN-437 report: 7 pre-2022 archive meetings; Shanghai 2019 dated 07.10 (archive) and 12.10 (feed)'],
  ['C. Alcaraz', 2382, 'a0e2', 'D. Medvedev', 1093, 'mm58', 6, 3, ''],
  ['F. Tiafoe', 2846, 'td51', 'M. Kecmanovic', 2848, 'ki95', 5, 0, 'Challenger (Newport Beach 2018) listed by ATP, not counted'],
  ['A. Zverev', 1980, 'z355', 'S. Wawrinka', 2168, 'w367', 5, 0, 'Davis Cup qualifier 2023 counted'],
  ['A. Zverev', 1980, 'z355', 'D. Schwartzman', 67, 'sm37', 4, 2, ''],
  ['A. Mannarino', 438, 'me82', 'J. Thompson', 207, 'tc61', 7, 4, ''],
  ['G. Dimitrov', 2384, 'd875', 'S. Wawrinka', 2168, 'w367', 6, 7, ''],
  ['A. Rublev', 2847, 're44', 'J. Lehecka', 2959, 'l0bv', 3, 2, ''],
  ['K. Khachanov', 435, 'ke29', 'Y. Nishioka', 1972, 'n732', 4, 1, 'Olympics 2021 counted'],
  ['G. Dimitrov', 2384, 'd875', 'K. Khachanov', 435, 'ke29', 5, 1, ''],
  ['S. Baez', 1101, 'b0bi', 'T. Fritz', 2832, 'fb98', 1, 5, 'United Cup 2026 counted'],
  // TEN-437 report B — the population's edge cases, read off ATP's own H2H data
  ['J. Mensik', 902, 'm0ni', 'A. Michelsen', 10884, 'm0qi', 1, 0, 'Laver Cup counted'],
  ['D. Medvedev', 1093, 'mm58', 'B. Shelton', 2973, 's0s1', 0, 1, 'Laver Cup counted'],
  ['F. Cerundolo', 1104, 'c0au', 'A. Davidovich Fokina', 2842, 'dh50', 1, 0, 'Laver Cup counted'],
  ['R. Federer', 7357, 'f324', 'N. Kyrgios', 2984, 'ke17', 6, 1, 'walkover (Indian Wells 2017) not counted; Laver Cup 2017-19 counted'],
  ['V. Vacherot', 1852, 'va25', 'T. Kokkinakis', 426, 'kd46', 0, 0, 'walkover only'],
  ['J. Sinner', 2072, 's0ag', 'J. Thompson', 207, 'tc61', 0, 0, 'walkover only'],
  ['C. Ruud', 430, 'rh16', 'R. Pacheco Mendez', 8762, 'p0j1', 0, 0, 'walkover only'],
  ['R. Hijikata', 3317, 'h0bh', 'F. Marozsan', 10148, 'm0ci', 0, 0, 'walkover only'],
  ['G. Diallo', 9909, 'd0f6', 'N. Basavareddy', 15270, 'b0nn', 0, 0, 'walkover only'],
  ['A. Fils', 1759, 'f0f1', 'M. Ymer', 1976, 'y268', 1, 0, 'default counted (Lyon 2023)'],
  ['N. Djokovic', 1905, 'd643', 'P. Carreno-Busta', 434, 'cd85', 4, 2, 'default (US Open 2020) and Olympics counted'],
  ['A. Bublik', 1895, 'bk92', 'A. Rublev', 2847, 're44', 3, 5, 'default counted; tour qualifying (Moscow 2016 Q1) not'],
  ['L. Tien', 10520, 't0ha', 'N. Budkov Kjaer', 55163, 'b0u4', 1, 0, 'Next Gen Finals counted'],
  ['L. Tien', 10520, 't0ha', 'N. Basavareddy', 15270, 'b0nn', 3, 0, 'Next Gen counted; 2 Challengers not'],
  ['M. Berrettini', 2844, 'bk40', 'R. Collignon', 825, 'c0jp', 1, 0, 'Davis Cup Finals counted'],
  ['R. Collignon', 825, 'c0jp', 'C. Moutet', 2674, 'mw02', 1, 0, 'Davis Cup Finals counted'],
  ['Z. Bergs', 1064, 'bu13', 'J. Rodionov', 416, 'r09x', 1, 1, 'Davis Cup qualifier counted; Q1 and 4 Challengers not'],
  ['T. Machac', 2981, 'm0fh', 'Z. Zhang', 590, 'z371', 2, 0, 'Olympics counted, a Challenger not; namesake "Z. Zhang"'],
  ['P. Carreno-Busta', 434, 'cd85', 'A. Tabilo', 2982, 'te30', 2, 1, 'ATP Cup counted, a Challenger not'],
  ['Z. Bergs', 1064, 'bu13', 'J. Mensik', 902, 'm0ni', 1, 0, 'United Cup counted'],
  ['B. Harris', 1186, 'hd68', 'S. Mochizuki', 1880, 'm0hu', 1, 0, 'United Cup counted'],
  ['A. Kovacevic', 2978, 'k0az', 'C. Ugo Carabelli', 401, 'u182', 2, 0, 'retirement counted (Stockholm 2025)'],
  ['K. Khachanov', 435, 'ke29', 'A. Rublev', 2847, 're44', 3, 2, 'Challenger and ITF not counted'],
  ['R. Collignon', 825, 'c0jp', 'V. Vacherot', 1852, 'va25', 1, 0, 'Challenger and ITF not counted'],
  ['D. Medvedev', 1093, 'mm58', 'A. Rublev', 2847, 're44', 8, 2, 'a Challenger not counted'],
  ['A. Kovacevic', 2978, 'k0az', 'S. Mochizuki', 1880, 'm0hu', 0, 0, 'Slam qualifying (AO 2024 Q3) and a Challenger qualifying only'],
  ['A. Kovacevic', 2978, 'k0az', 'Z. Bergs', 1064, 'bu13', 0, 0, 'tour qualifying (Miami 2024 Q2) only'],
  ['V. Vacherot', 1852, 'va25', 'J. Rodionov', 416, 'r09x', 0, 0, 'tour qualifying (Madrid 2024 Q1) and Challengers only'],
  ['Z. Bergs', 1064, 'bu13', 'R. Collignon', 825, 'c0jp', 0, 1, ''],
  ['J. Sinner', 2072, 's0ag', 'N. Djokovic', 1905, 'd643', 7, 5, 'Davis Cup counted; no exhibition (Six Kings Slam) in ATP\'s list'],
  ['R. Federer', 7357, 'f324', 'A. Zverev', 1980, 'z355', 3, 4, 'one-sided; no Hopman Cup in ATP\'s list'],
];

// A pair our data cannot match yet, with the reason — reported to the founder, not hidden. The gate pins each one to the
// value recorded here, so it turns red the moment the data changes either way (fixed: move it into the exact set; worse:
// a regression). Every other pair must equal ATP exactly.
const KNOWN_GAPS = {
  'A. Fils|M. Ymer': 'a default ATP counts (Lyon 2023 R16, M. Ymer defaulted): api-tennis status "Awarded" — '
    + 'playerMatchHistory (bsp-pipeline.js) keeps Finished / Retired / Walk Over only, so the row never reaches career-history',
  'A. Bublik|A. Rublev': 'a default ATP counts (Dubai 2024 SF, Rublev defaulted): api-tennis status "Awarded" — '
    + 'playerMatchHistory (bsp-pipeline.js) keeps Finished / Retired / Walk Over only, so the row never reaches career-history',
};

async function getJson(url) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`); return r.json(); }
const shardCache = new Map();
async function shard(key, index) {
  const k = String(key);
  if (!shardCache.has(k)) shardCache.set(k, index[k] ? getJson(`${SITE}/career-history/${k}.json`).then(d => d.matches) : Promise.resolve([]));
  return shardCache.get(k);
}
const pick = (o, ks) => { const r = {}; ks.forEach(k => { if (o[k] !== undefined) r[k] = o[k]; }); return r; };
const ROW_FIELDS = ['date', 'tournament', 'round', 'surface', 'level', 'opponent', 'won', 'result', 'eventKey', 'src', 'sets', 'retired', 'walkover', 'qualifying', 'holeFill'];

const roster = (await getJson(`${SITE}/player-profiles.json`)).players;
const nk = H2HCore.nameCounts(Object.values(roster).map(p => p && p.name).filter(Boolean));
const index = (await getJson(`${SITE}/career-history-index.json`)).players;

const pairs = [], off = [];
for (const [sa, ka, ca, sb, kb, cb, wa, wb, note] of PAIRS) {
  const [rowsA, rowsB] = [await shard(ka, index), await shard(kb, index)];
  const nkA = H2HCore.nameKey(sa), nkB = H2HCore.nameKey(sb);
  const ekB = new Set(rowsB.filter(y => y && y.eventKey != null && H2HCore.nameKey(y.opponent) === nkA).map(y => String(y.eventKey)));
  const ekA = new Set(rowsA.filter(x => x && x.eventKey != null && H2HCore.nameKey(x.opponent) === nkB).map(x => String(x.eventKey)));
  const chA = rowsA.filter(x => x && (H2HCore.nameKey(x.opponent) === nkB || (x.eventKey != null && ekB.has(String(x.eventKey))))).map(x => pick(x, ROW_FIELDS));
  const chB = rowsB.filter(y => y && (H2HCore.nameKey(y.opponent) === nkA || (y.eventKey != null && ekA.has(String(y.eventKey))))).map(y => pick(y, ROW_FIELDS));
  const p = { a: { short: sa, full: (roster[String(ka)] && roster[String(ka)].name) || sa, key: String(ka), atpCode: ca },
    b: { short: sb, full: (roster[String(kb)] && roster[String(kb)].name) || sb, key: String(kb), atpCode: cb },
    atp: { a: wa, b: wb, n: wa + wb }, checkedOn: CHECKED_ON, source: `https://www.atptour.com/en/-/www/h2h/${ca}/${cb}`, note,
    nk: { [nkA]: nk[nkA] || 0, [nkB]: nk[nkB] || 0 }, chA, chB };
  const rec = H2HCore.record(H2HCore.joinMeetings(p.a, p.b, chA, chB, p.nk, []));
  const gap = KNOWN_GAPS[sa + '|' + sb];
  if (gap) p.knownGap = { reason: gap, ours: rec };
  if (rec.a !== wa || rec.b !== wb) off.push(`${sa} – ${sb}: ours ${rec.a}–${rec.b} / ${rec.n}, ATP ${wa}–${wb} / ${wa + wb}${gap ? ' — KNOWN GAP: ' + gap : ' (' + (note || 'no note') + ')'}`);
  else if (gap) off.push(`${sa} – ${sb}: listed as a known gap but now agrees with ATP — remove it from KNOWN_GAPS`);
  pairs.push(p);
}
console.log(`${pairs.length} pairs, ${pairs.length - off.length} agree with ATP on the live shards.`);
off.forEach(l => console.log('  ✖ ' + l));
if (!process.argv.includes('--check')) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ v: 1, ticket: 'TEN-437', builtFrom: SITE, checkedOn: CHECKED_ON,
    rule: "ATP's official H2H record: the Record fields of atptour.com's H2H endpoint", pairs }, null, 1) + '\n');
  console.log('wrote', path.relative(ROOT, OUT));
}
