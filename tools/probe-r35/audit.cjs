// probe r35: Tennis-Data short names that map to more than one player, and rows a key gets before its career began
const fs = require('fs'), path = require('path');
const { keyFromArchiveName, ourCandidateKeys, archiveOverride, readCsv } = require('../../build-odds-performance.js');
const LIVE = process.argv[2];
const J = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };
const day = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : null; };
const iso = d => new Date(d * 864e5).toISOString().slice(0, 10);
const fk = k => `${k.surname}|${k.initials}`;
// identities
const ID = new Map(); // id -> {names:Set, lo, hi, own:bool, keys:Set}
const idOf = id => { if (!ID.has(id)) ID.set(id, { id, names: new Set(), lo: Infinity, hi: -Infinity, own: false, ownLo: Infinity }); return ID.get(id); };
const see = (id, name, d, own) => { const e = idOf(id); if (name) e.names.add(name); if (d != null) { e.lo = Math.min(e.lo, d); e.hi = Math.max(e.hi, d); if (own) e.ownLo = Math.min(e.ownLo, d); } if (own) e.own = true; };
const chDir = path.join(LIVE, 'career-history');
const tml2key = new Map();
const files = fs.readdirSync(chDir).filter(f => /^\d+\.json$/.test(f));
for (const f of files) { const k = f.replace('.json', ''); const d = J(path.join(chDir, f)); if (!d) continue; if (d.id != null) tml2key.set(String(d.id), k); }
for (const f of files) {
  const k = f.replace('.json', ''); const d = J(path.join(chDir, f)); if (!d) continue;
  see(k, d.name, null, true);
  for (const r of d.matches || []) {
    const dd = day(r.date); see(k, null, dd, true);
    if (r.oppKey) see(String(r.oppKey), r.opponent, dd, false);
    else if (r.oppId != null) { const kk = tml2key.get(String(r.oppId)) || ('tml:' + r.oppId); see(kk, r.opponent, dd, false); }
  }
}
const prof = (J(path.join(LIVE, 'player-profiles.json')) || {}).players || {};
Object.entries(prof).forEach(([k, p]) => see(String(k), p && p.name, null, false));
// name index
const bySur = new Map();
ID.forEach(e => e.names.forEach(n => ourCandidateKeys(n).forEach(ck => { if (!ck.surname) return; if (!bySur.has(ck.surname)) bySur.set(ck.surname, new Map()); bySur.get(ck.surname).set(e.id, ck); })));
const candsOf = name => { const k = keyFromArchiveName(name); if (!k) return []; const m = bySur.get(k.surname); if (!m) return [];
  const out = []; m.forEach((ck, id) => { const a = ck.initials, b = k.initials; if (a && b && (a.startsWith(b) || b.startsWith(a))) out.push(id); }); return out; };
// Market edge resolver as built (roster = profiles + market-edge shard names)
const roster = {}; Object.entries(prof).forEach(([k, p]) => { if (p && p.name) roster[k] = p.name; });
const meDir = path.join(LIVE, 'market-edge');
if (fs.existsSync(meDir)) for (const f of fs.readdirSync(meDir)) { const m = /^(\d+)\.json$/.exec(f); if (!m || roster[m[1]]) continue; const s = J(path.join(meDir, f)); if (s && s.name) roster[m[1]] = s.name; }
const byFull = new Map(), bySurR = new Map(), byKey = new Map();
Object.entries(roster).forEach(([key, name]) => { const c = ourCandidateKeys(name); if (!c.length) return; const e = { key, name, k: c[0] }; byFull.set(fk(c[0]), e); byKey.set(key, e);
  c.forEach(ck => { if (!bySurR.has(ck.surname)) bySurR.set(ck.surname, []); bySurR.get(ck.surname).push({ key, name, k: ck }); }); });
const resolve = n => { const ov = archiveOverride(n); if (ov) return ov.block ? null : (byKey.get(String(ov.key)) || null); const k = keyFromArchiveName(n); if (!k) return null;
  const ex = byFull.get(fk(k)); if (ex) return ex; const c = (bySurR.get(k.surname) || []).filter(x => x.k.initials && k.initials && (x.k.initials.startsWith(k.initials) || k.initials.startsWith(x.k.initials))); return c.length === 1 ? c[0] : null; };
const SLACK = 30;
const active = (id, d) => { const e = ID.get(id); return e && d >= e.lo - SLACK && d <= e.hi + SLACK; };
const arch = path.join(__dirname, '..', '..', 'odds-archive');
const multi = new Map(); // name -> {ids, rows, ambiguousRows}
const before = new Map(); // key -> {name, rows, years:Set, ownLo}
let sides = 0, resolved = 0, beforeN = 0, ambN = 0, unknownWin = 0;
const ambByKey = new Map();
for (const f of fs.readdirSync(arch).filter(f => /^\d{4}\.csv$/.test(f)).sort()) for (const r of readCsv(path.join(arch, f))) {
  const d = day(r.date);
  for (const nm of [r.winner, r.loser]) {
    sides++;
    const cs = candsOf(nm);
    if (cs.length > 1) { if (!multi.has(nm)) multi.set(nm, { ids: cs, rows: 0, amb: 0, years: new Set() }); const m = multi.get(nm); m.rows++; m.years.add(r.date.slice(0, 4)); if (cs.filter(id => active(id, d)).length > 1) m.amb++; }
    const h = resolve(nm); if (!h) continue; resolved++;
    const e = ID.get(h.key);
    if (!e || !e.own || !isFinite(e.ownLo)) { unknownWin++; continue; }
    if (d < e.ownLo - SLACK) { beforeN++; if (!before.has(h.key)) before.set(h.key, { name: h.name, tdName: new Set(), rows: 0, years: new Set(), ownLo: iso(e.ownLo) }); const b = before.get(h.key); b.rows++; b.tdName.add(nm); b.years.add(r.date.slice(0, 4)); }
    else { const act = cs.filter(id => active(id, d)); if (act.length > 1) { ambN++; ambByKey.set(h.key, (ambByKey.get(h.key) || 0) + 1); } }
  }
}
console.log(JSON.stringify({ identities: ID.size, ownShards: files.length, sides, resolved, resolvedNoOwnWindow: unknownWin, beforeCareer: beforeN, ambiguousActiveAtDate: ambN }));
console.log('== keys getting Tennis-Data rows before their own career-history begins (−30 d):', before.size);
[...before.entries()].sort((a, b) => b[1].rows - a[1].rows).forEach(([k, b]) => console.log(k, b.name, '| td:', [...b.tdName].join('/'), '| rows', b.rows, '| years', [...b.years].sort().join(','), '| own from', b.ownLo));
console.log('== resolved rows with >1 identity active at the date, by key:');
[...ambByKey.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).forEach(([k, n]) => console.log(k, roster[k], n));
console.log('== Tennis-Data short names matching >1 identity:', multi.size);
[...multi.entries()].sort((a, b) => b[1].rows - a[1].rows).forEach(([nm, m]) => console.log(nm, '| rows', m.rows, '| ambiguous at date', m.amb, '| ids', m.ids.map(id => `${id}:${[...ID.get(id).names][0]}[${isFinite(ID.get(id).lo) ? iso(ID.get(id).lo).slice(0,4) + '-' + iso(ID.get(id).hi).slice(0,4) : '?'}]`).join(' ; ')));
// published market-edge rows before career
let meBefore = 0; const meBy = [];
if (fs.existsSync(meDir)) for (const f of fs.readdirSync(meDir)) { const m = /^(\d+)\.json$/.exec(f); if (!m) continue; const s = J(path.join(meDir, f)); const e = ID.get(m[1]); if (!s || !e || !isFinite(e.ownLo)) continue;
  const n = (s.matches || []).filter(x => day(x.date) < e.ownLo - SLACK).length; if (n) { meBefore += n; meBy.push([m[1], s.name, n, iso(e.ownLo)]); } }
console.log('== published market-edge rows before career:', meBefore); meBy.sort((a, b) => b[2] - a[2]).forEach(x => console.log(x.join(' | ')));
const k1 = ID.get('1056'); console.log('1056:', k1 && [...k1.names], k1 && iso(k1.ownLo), k1 && iso(k1.hi));
