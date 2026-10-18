// probe r40: items 1 + 2 on the live data — the last site-data built before 7374f71 vs the first after
const fs = require('fs'), path = require('path');
const [A, B] = process.argv.slice(2).map(d => path.resolve(d));
const J = (d, f) => { try { return JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); } catch (e) { return null; } };
for (const [nm, d] of [['before', A], ['after', B]]) { const bi = J(d, 'build-info.json'); console.log(nm, 'data', JSON.stringify(bi && bi.data || bi && { commit: bi.commit })); }
const ya = J(A, 'database-yield.json'), yb = J(B, 'database-yield.json');
console.log('started before', JSON.stringify(ya.meta.started && ya.meta.started.byVerdict || ya.meta.started));
console.log('started after ', JSON.stringify(yb.meta.started && yb.meta.started.byVerdict || yb.meta.started));
for (const k of ['rows', 'retRows', 'tieRows']) console.log(k, (ya[k] || []).length, '->', (yb[k] || []).length, 'identical:', JSON.stringify(ya[k]) === JSON.stringify(yb[k]));
const na = J(A, 'database-yield-players.json'), nb = J(B, 'database-yield-players.json');
console.log('names identical:', JSON.stringify(na && na.names) === JSON.stringify(nb && nb.names), 'retNames identical:', JSON.stringify(na && na.retNames) === JSON.stringify(nb && nb.retNames));
const xa = J(A, 'database-yield-x.json'), xb = J(B, 'database-yield-x.json');
console.log('era shard identical:', JSON.stringify(xa) === JSON.stringify(xb), (xa && xa.xRows.length), '->', (xb && xb.xRows.length));
for (const k of ['1056', '389', '1307', '1735', '590']) {
  const ca = J(A, `match-closes/${k}.json`), cb = J(B, `match-closes/${k}.json`), ma = J(A, `market-edge/${k}.json`), mb = J(B, `market-edge/${k}.json`);
  const yrs = r => { const c = {}; (r || []).forEach(x => { const y = String(x[0] || x.date).slice(0, 4); c[y] = (c[y] || 0) + 1; }); return JSON.stringify(c); };
  console.log(k, 'closes rows', ca && ca.rows.length, '->', cb && cb.rows.length, '| market-edge', ma && ma.matches.length, '->', mb && mb.matches.length, '| ME years after', yrs(mb && mb.matches), '| closes years after', yrs(cb && cb.rows));
}
const ia = J(B, 'match-closes-index.json'); console.log('closes gate', JSON.stringify(ia && ia.identityGate && { checked: ia.identityGate.checked, beforeCareer: ia.identityGate.beforeCareer, otherActive: ia.identityGate.otherActive }));
const mi = J(B, 'market-edge-index.json'); console.log('market-edge gate', JSON.stringify(mi && mi.identityGate && mi.identityGate.stats && { checked: mi.identityGate.stats.checked, beforeCareer: mi.identityGate.stats.beforeCareer, otherActive: mi.identityGate.stats.otherActive, byKey: mi.identityGate.stats.byKey }));
// every market-edge shard: count and price changes
let ch = 0, same = 0, priceMoved = 0, gone = 0;
for (const f of fs.readdirSync(path.join(B, 'market-edge'))) { if (!/^\d+\.json$/.test(f)) continue;
  const a = J(A, 'market-edge/' + f), b = J(B, 'market-edge/' + f); if (!a || !b) continue;
  const key = m => `${m.date}|${m.opp}|${m.won}`; const am = new Map(a.matches.map(m => [key(m), m]));
  if (a.matches.length !== b.matches.length) ch++; else same++;
  for (const m of b.matches) { const o = am.get(key(m)); if (o && (o.price !== m.price || o.oppPrice !== m.oppPrice)) priceMoved++; }
  gone += a.matches.length - b.matches.length; }
console.log('market-edge shards: changed count', ch, 'same', same, 'rows removed (net)', gone, 'prices moved on a kept row', priceMoved);
