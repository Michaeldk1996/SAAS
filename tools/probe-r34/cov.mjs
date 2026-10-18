// probe r34 — coverage: 2026 ATP main draw by month and source (the master), Challenger from 17 Sep (the archive export)
import { readFileSync } from 'node:fs';
const S = process.argv[2], KEY = process.env.API_TENNIS_KEY;
const D = JSON.parse(readFileSync(S + '/database-yield.json', 'utf8'));
const BOOK = { 0: 'Tennis-Data Pinnacle', 1: 'Bet365 (Tennis-Data)', 2: 'Pinnacle (approx.) api-tennis', 3: 'Pinnacle close (from Pinnacle history)', 4: 'Pinnacle close (captured)', 5: 'Pinnacle (approx.) start-10' };
const byM = {};
for (const r of [].concat(D.rows || [], D.retRows || [], D.tieRows || [])) { const d = String(r[0]); if (!d.startsWith('2026')) continue;
  const m = d.slice(0, 4) + '-' + d.slice(4, 6), b = BOOK[r[8]] || String(r[8]); const o = byM[m] = byM[m] || {}; o[b] = (o[b] || 0) + 1; }
// denominators from api-tennis (UTC), finished / retired singles, walkovers out
const dayShift = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const TEAM = /davis cup|laver cup|united cup|atp cup|hopman/i;
const ex = JSON.parse(readFileSync(S + '/pinnacle-closes.json', 'utf8')).rows || [];
const closes = new Map(ex.map(r => [String(r.eventKey), r]));
const den = {}, ch = {};
const wk = d => { const t = new Date(d + 'T00:00:00Z'); return new Date(t - ((t.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10); };
const today = new Date().toISOString().slice(0, 10);
for (let d = '2026-01-01'; d < today; d = dayShift(d, 1)) {
  const r = await fetch(`https://api.api-tennis.com/tennis/?method=get_fixtures&date_start=${d}&date_stop=${d}&timezone=UTC&APIkey=${KEY}`).then(x => x.json()).catch(() => null);
  for (const f of (r && r.result) || []) {
    if (!['Finished', 'Retired'].includes(f.event_status)) continue;
    const q = f.event_qualification === 'True';
    if (f.event_type_type === 'Atp Singles' && !q && !TEAM.test(f.tournament_name || '')) { const m = d.slice(0, 7); den[m] = (den[m] || 0) + 1; }
    if (f.event_type_type === 'Challenger Men Singles' && d >= '2026-09-17') { const w = wk(d), L = q ? 'qualifying' : 'main draw';
      const o = ch[w] = ch[w] || {}; const c = o[L] = o[L] || { finished: 0, history: 0, captured: 0 }; c.finished++;
      const cl = closes.get(String(f.event_key)); if (cl) c[cl.label === 'captured' ? 'captured' : 'history']++; }
  }
}
for (const m of Object.keys({ ...byM, ...den }).sort()) console.log('### atp ' + m + ' ' + JSON.stringify({ finished: den[m] || 0, priced: byM[m] || {} }));
for (const w of Object.keys(ch).sort()) console.log('### chal ' + w + ' ' + JSON.stringify(ch[w]));
