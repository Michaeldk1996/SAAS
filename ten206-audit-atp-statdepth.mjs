#!/usr/bin/env node
// TEN-206 audit, pass 2 — year-by-year ATP populate depth with CASE-INSENSITIVE stat_name
// matching. Pass 1 used exact strings and read 2024/2025 as 0% because api-tennis changed
// the casing ("Unforced Errors" -> "Unforced errors"). Also records whether stat_won /
// stat_total (the counts a sample gate needs) arrive alongside the rate.
import fs from 'fs';
const KEY = fs.readFileSync('/Users/Michael/bsp-consult-project/.env', 'utf8').match(/API_TENNIS_KEY=(\S+)/)[1];
const BASE = 'https://api.api-tennis.com/tennis/';
let requests = 0;
async function call(p) { requests++; const r = await fetch(`${BASE}?method=get_fixtures&APIkey=${KEY}&${p}`); const j = await r.json(); return Array.isArray(j.result) ? j.result : []; }

const norm = s => String(s || '').toLowerCase().trim();
const FIELDS = {
  winners: 'winners',
  unforced: 'unforced errors',
  net: 'net points won',
  speed1: 'average 1st serve speed',
  speed2: 'average 2nd serve speed',
  distance: 'distance covered (metres)',
};
const WINDOWS = [['-05-05', '-05-14'], ['-09-05', '-09-14']];

const rows = [];
for (let y = 2021; y <= 2026; y++) {
  let finished = 0, withStats = 0;
  const pop = {}, counts = {};
  for (const k of Object.keys(FIELDS)) { pop[k] = 0; counts[k] = 0; }
  for (const [a, b] of WINDOWS) {
    for (const m of await call(`date_start=${y}${a}&date_stop=${y}${b}&event_type_key=265`)) {
      if (norm(m.event_status) !== 'finished') continue;
      finished++;
      const st = (m.statistics || []).filter(s => (s.stat_period || 'match') === 'match');
      if (st.length) withStats++;
      for (const [k, want] of Object.entries(FIELDS)) {
        const hit = st.filter(s => norm(s.stat_name) === want);
        if (!hit.length) continue;
        if (hit.some(s => s.stat_value !== null && s.stat_value !== '' && s.stat_value !== undefined)) pop[k]++;
        if (hit.some(s => s.stat_won !== null && s.stat_won !== undefined && s.stat_total !== null && s.stat_total !== undefined)) counts[k]++;
      }
    }
  }
  rows.push({ year: y, finished, withStats, pop, counts });
  const p = n => finished ? (100 * n / finished).toFixed(1).padStart(5) + '%' : '    —';
  console.log(`${y} n=${String(finished).padStart(3)} stats=${p(withStats)} | ` +
    Object.keys(FIELDS).map(k => `${k}=${p(pop[k])}(cnt${p(counts[k])})`).join(' '));
}
fs.writeFileSync('/Users/Michael/bsp-wt-ten206audit/ten206-atp-statdepth2.json', JSON.stringify({ requests, WINDOWS, rows }, null, 2));
console.log(`\nrequests used: ${requests}`);
