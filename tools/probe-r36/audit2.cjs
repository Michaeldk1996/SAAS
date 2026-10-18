const fs = require('fs'), path = require('path');
const { keyFromArchiveName, ourCandidateKeys, readCsv } = require('../../build-odds-performance.js');
const LIVE = process.argv[2];
const J = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };
const day = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : null; };
const chDir = path.join(LIVE, 'career-history');
const files = fs.readdirSync(chDir).filter(f => /^\d+\.json$/.test(f));
const shards = {}; let withId = 0;
for (const f of files) { const d = J(path.join(chDir, f)); if (d) { shards[f.replace('.json', '')] = d; if (d.id != null) withId++; } }
console.log('shards', files.length, 'with id', withId, 'shard keys:', Object.keys(shards[files[0].replace('.json','')]).join(','));
const prof = (J(path.join(LIVE, 'player-profiles.json')) || {}).players || {};
for (const k of ['1056', '101792', '1307', '389', '1735', '34000', '1249', '2838', '26614', '39913', '61071', '1872', '590', '5563']) {
  const p = prof[k]; const s = shards[k];
  const cby = p && p.careerByYear ? Object.keys(p.careerByYear).sort() : (p && Array.isArray(p.careerByYear) ? p.careerByYear.map(r => r.year) : null);
  const obs = []; Object.entries(shards).forEach(([kk, d]) => (d.matches || []).forEach(r => { if (String(r.oppKey) === k) obs.push(r.date); }));
  obs.sort();
  console.log(k, p ? p.name : '-', '| profile yrs', cby ? (Array.isArray(cby) ? cby.join(',') : '') : '-', '| own', s ? `${s.matches.length} ${(s.matches.map(r => r.date).sort()[0])} id=${s.id}` : '-', '| as opp', obs.length, obs[0], obs[obs.length - 1]);
}
// every TD row naming Martin A., with the opponent's career row (identity)
const arch = path.join(__dirname, '..', '..', 'odds-archive');
const keyOfName = new Map(); Object.entries(prof).forEach(([k, p]) => p && p.name && keyOfName.set(p.name, k));
function oppRow(oppTd, d, target) {
  const k = keyFromArchiveName(oppTd); if (!k) return null;
  const hits = [];
  Object.entries(shards).forEach(([kk, s]) => { const nm = s.name || (prof[kk] && prof[kk].name); if (!nm) return; const c = ourCandidateKeys(nm); if (!c.some(x => x.surname === k.surname && x.initials && k.initials && (x.initials.startsWith(k.initials) || k.initials.startsWith(x.initials)))) return;
    (s.matches || []).forEach(r => { const dd = day(r.date) - d; if (dd >= -16 && dd <= 3 && /martin/i.test(r.opponent || '')) hits.push(`${kk}:${r.date}:${r.opponent}:oppKey=${r.oppKey || ''}:oppId=${r.oppId || ''}`); }); });
  return hits;
}
for (const f of fs.readdirSync(arch).filter(f => /^20(1[3-9]|2\d)\.csv$/.test(f)).sort()) for (const r of readCsv(path.join(arch, f))) {
  if (r.winner !== 'Martin A.' && r.loser !== 'Martin A.') continue;
  const opp = r.winner === 'Martin A.' ? r.loser : r.winner;
  console.log('MARTIN', r.date, r.tournament, opp, '->', (oppRow(opp, day(r.date)) || []).join(' ; '));
}
