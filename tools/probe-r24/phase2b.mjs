// probe r24 — phase 2: (a) how many captured Bet365 rows (match-closes cap, no event key) can be repaired to join by key;
// (b) weekly capture coverage per level since 14 Sep (api-tennis finished singles fixtures v closes in the archive export)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const S = process.argv[2], KEY = process.env.API_TENNIS_KEY;
const isItf = t => /(^|\s)M(15|25)\b|\bITF\b/.test(String(t || ''));
const cls = x => { const q = !!x.qualifying || /qualif/i.test(String(x.round || ''));
  if (x.level === 'atp') return q ? 'ATP qualifying' : 'ATP main draw';
  if (isItf(x.tournament)) return q ? 'ITF qualifying' : 'ITF';
  return q ? 'Challenger qualifying' : 'Challenger main draw'; };
const dayShift = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
// (a)
const R = { rows: 0, repaired: 0, ambiguous: 0, noCareerRow: 0, noOppKey: 0, noShard: 0, byLevel: {}, matches: new Set(), matchesRepaired: new Set() };
for (const f of readdirSync(join(S, 'match-closes'))) {
  if (!/^\d+\.json$/.test(f)) continue;
  const cl = JSON.parse(readFileSync(join(S, 'match-closes', f), 'utf8'));
  const chp = join(S, 'career-history', f), ch = existsSync(chp) ? JSON.parse(readFileSync(chp, 'utf8')).matches || [] : null;
  for (const c of cl.cap || []) {
    if (c[4] == null || c[5] == null || c[6] != null) continue;      // a Bet365 capture with no event key
    R.rows++;
    const mid = [f.replace('.json', ''), String(c[1])].sort().join('|') + '|' + c[0]; R.matches.add(mid);
    if (c[1] == null) { R.noOppKey++; continue; }
    if (!ch) { R.noShard++; continue; }
    const hits = ch.filter(x => !x.walkover && String(x.oppKey) === String(c[1]) && [-1, 0, 1].some(n => String(x.date).slice(0, 10) === dayShift(String(c[0]).slice(0, 10), n)) && x.eventKey != null);
    if (hits.length === 1) { R.repaired++; R.matchesRepaired.add(mid); const L = cls(hits[0]); R.byLevel[L] = (R.byLevel[L] || 0) + 1; }
    else if (hits.length > 1) R.ambiguous++; else R.noCareerRow++;
  }
}
console.log('### bet365 repair ' + JSON.stringify(Object.assign({}, R, { matches: R.matches.size, matchesRepaired: R.matchesRepaired.size })));
// (b)
const ex = JSON.parse(readFileSync(join(S, 'pinnacle-closes.json'), 'utf8')).rows || [];
const closes = new Map(ex.map(r => [String(r.eventKey), r]));
const wk = d => { const t = new Date(d + 'T00:00:00Z'); const day = (t.getUTCDay() + 6) % 7; return new Date(t - day * 864e5).toISOString().slice(0, 10); };
const W = {};
const lvl = f => { const t = f.event_type_type || '', q = f.event_qualification === 'True';
  if (t === 'Atp Singles') return q ? 'ATP qualifying' : 'ATP main draw';
  if (t === 'Challenger Men Singles') return q ? 'Challenger qualifying' : 'Challenger main draw'; return null; };
const today = new Date().toISOString().slice(0, 10);
for (let d = '2026-09-14'; d < today; d = dayShift(d, 1)) {
  const r = await fetch(`https://api.api-tennis.com/tennis/?method=get_fixtures&date_start=${d}&date_stop=${d}&timezone=UTC&APIkey=${KEY}`).then(x => x.json()).catch(() => null);
  for (const f of (r && r.result) || []) {
    const L = lvl(f); if (!L || !['Finished', 'Retired'].includes(f.event_status)) continue;
    const w = W[wk(d)] = W[wk(d)] || {}; const c = w[L] = w[L] || { finished: 0, pinnacle: 0, captured: 0, history: 0 };
    c.finished++; const cl = closes.get(String(f.event_key)); if (cl) { c.pinnacle++; if (cl.label === 'captured') c.captured++; else c.history++; }
  }
}
for (const [w, v] of Object.entries(W).sort()) console.log('### week ' + w + ' ' + JSON.stringify(v));
const qf = ex.filter(r => r.apiTennis && 'event_qualification' in r.apiTennis).length;
console.log('### export rows with event_qualification ' + qf + ' of ' + ex.length);
