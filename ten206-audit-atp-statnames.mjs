#!/usr/bin/env node
// Census of DISTINCT stat_name strings per year (ATP, match period) — guards against a
// name-variant reading as "field absent". Same windows as ten206-atp-statdepth.mjs.
import fs from 'fs';
const KEY = fs.readFileSync('/Users/Michael/bsp-consult-project/.env', 'utf8').match(/API_TENNIS_KEY=(\S+)/)[1];
const BASE = 'https://api.api-tennis.com/tennis/';
let requests = 0;
async function call(p) { requests++; const r = await fetch(`${BASE}?method=get_fixtures&APIkey=${KEY}&${p}`); const j = await r.json(); return Array.isArray(j.result) ? j.result : []; }

const WINDOWS = [['-05-05', '-05-14'], ['-09-05', '-09-14']];
const out = {};
for (let y = 2022; y <= 2026; y++) {
  const names = new Map();
  let finished = 0;
  for (const [a, b] of WINDOWS) {
    for (const m of await call(`date_start=${y}${a}&date_stop=${y}${b}&event_type_key=265`)) {
      if (String(m.event_status || '').toLowerCase() !== 'finished') continue;
      finished++;
      const seen = new Set();
      for (const s of (m.statistics || [])) {
        if ((s.stat_period || 'match') !== 'match') continue;
        if (!seen.has(s.stat_name)) { seen.add(s.stat_name); names.set(s.stat_name, (names.get(s.stat_name) || 0) + 1); }
      }
    }
  }
  out[y] = { finished, names: Object.fromEntries([...names].sort((x, z) => z[1] - x[1])) };
  console.log(`\n=== ${y}  finished=${finished} ===`);
  for (const [n, c] of [...names].sort((x, z) => z[1] - x[1])) console.log(`  ${String(c).padStart(4)}/${finished}  ${JSON.stringify(n)}`);
}
fs.writeFileSync('/Users/Michael/bsp-wt-ten206audit/ten206-atp-statnames.json', JSON.stringify({ requests, out }, null, 2));
console.log(`\nrequests used: ${requests}`);
