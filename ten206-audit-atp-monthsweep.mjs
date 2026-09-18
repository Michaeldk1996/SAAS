#!/usr/bin/env node
// TEN-206 audit — FULL-SEASON (not sampled) ATP coverage for Winners / Unforced errors /
// Net points won, by month, 2024-01 -> today. One get_fixtures page per month; statistics
// ride inline, so the page count IS the backfill request cost. Case-insensitive names.
import fs from 'fs';
const KEY = fs.readFileSync('/Users/Michael/bsp-consult-project/.env', 'utf8').match(/API_TENNIS_KEY=(\S+)/)[1];
const BASE = 'https://api.api-tennis.com/tennis/';
let requests = 0;
async function call(p) { requests++; const r = await fetch(`${BASE}?method=get_fixtures&APIkey=${KEY}&${p}`); const j = await r.json(); return Array.isArray(j.result) ? j.result : []; }
const norm = s => String(s || '').toLowerCase().trim();
const F = { winners: 'winners', unforced: 'unforced errors', net: 'net points won', speed1: 'average 1st serve speed', distance: 'distance covered (metres)' };

const TODAY = '2026-09-18';
const months = [];
for (let y = 2024; y <= 2026; y++) for (let m = 1; m <= 12; m++) {
  const s = `${y}-${String(m).padStart(2, '0')}-01`;
  if (s > TODAY) break;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  months.push([s, last > TODAY ? TODAY : last]);
}

const per = {};            // year -> tallies
const missingEvents = {};  // year -> event name -> finished-without-winners
const sampleValues = {};
for (const [a, b] of months) {
  const y = a.slice(0, 4);
  per[y] ||= { finished: 0, stats: 0, winners: 0, unforced: 0, net: 0, netCounts: 0, speed1: 0, distance: 0, pages: 0 };
  missingEvents[y] ||= {};
  per[y].pages++;
  const res = await call(`date_start=${a}&date_stop=${b}&event_type_key=265`);
  let mf = 0;
  for (const m of res) {
    if (norm(m.event_status) !== 'finished') continue;
    per[y].finished++; mf++;
    const st = (m.statistics || []).filter(s => (s.stat_period || 'match') === 'match');
    if (st.length) per[y].stats++;
    const get = want => st.filter(s => norm(s.stat_name) === want);
    const hasVal = h => h.some(s => s.stat_value !== null && s.stat_value !== '' && s.stat_value !== undefined);
    const w = get(F.winners);
    if (hasVal(w)) { per[y].winners++; sampleValues.winners ||= w[0]; }
    else missingEvents[y][m.tournament_name || '?'] = (missingEvents[y][m.tournament_name || '?'] || 0) + 1;
    const u = get(F.unforced); if (hasVal(u)) { per[y].unforced++; sampleValues.unforced ||= u[0]; }
    const n = get(F.net);
    if (hasVal(n)) { per[y].net++; sampleValues.net ||= n[0]; if (n.some(s => s.stat_won != null && s.stat_total != null)) per[y].netCounts++; }
    if (hasVal(get(F.speed1))) per[y].speed1++;
    if (hasVal(get(F.distance))) per[y].distance++;
  }
  console.log(`  ${a}..${b}  fixtures=${String(res.length).padStart(4)} finished=${String(mf).padStart(4)}`);
}

console.log('\nyear  pages finished  stats  Winners   UE   NetPts (w/counts)  Spd1  Dist');
for (const [y, t] of Object.entries(per)) {
  const p = n => t.finished ? (100 * n / t.finished).toFixed(1).padStart(5) + '%' : '    —';
  console.log(`${y}  ${String(t.pages).padStart(5)} ${String(t.finished).padStart(8)} ${p(t.stats)} ${p(t.winners)} ${p(t.unforced)} ${p(t.net)} ${p(t.netCounts)} ${p(t.speed1)} ${p(t.distance)}`);
}
console.log('\nTop events finished-without-Winners:');
for (const [y, ev] of Object.entries(missingEvents)) {
  const top = Object.entries(ev).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`  ${y}: ` + (top.length ? top.map(([n, c]) => `${n}(${c})`).join(', ') : 'none'));
}
console.log('\nsample rows:', JSON.stringify(sampleValues));
fs.writeFileSync('/Users/Michael/bsp-wt-ten206audit/ten206-atp-monthsweep.json', JSON.stringify({ requests, per, missingEvents, sampleValues }, null, 2));
console.log(`\nrequests used: ${requests}`);
