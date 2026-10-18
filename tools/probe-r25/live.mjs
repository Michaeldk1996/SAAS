// probe r25 — read back ee74aa2 on the deployed site
const B = 'https://michaeldk1996.github.io/SAAS/';
const get = async p => { const r = await fetch(B + p + '?t=' + Date.now()); return { s: r.status, j: r.status === 200 ? await r.json().catch(() => null) : null }; };
const bi = await get('build-info.json'); console.log('### build-info ' + JSON.stringify(bi.j && { commit: bi.j.commit, builtAt: bi.j.builtAt, data: bi.j.data }));
const q = await get('price-quarantine.json'); console.log('### price-quarantine.json HTTP ' + q.s + ' entries ' + (q.j && (q.j.entries || []).length));
const db = await get('database-yield.json'), nm = await get('database-yield-players.json');
const m = db.j.meta || {}; console.log('### meta.started ' + JSON.stringify(m.started));
const names = nm.j.names || []; const hit = (rows, ns) => rows.map((r, i) => [r, ns[i]]).filter(([r, n]) => String(r[0]).startsWith('20190908') || /20190908/.test(JSON.stringify(r)));
const rowsHit = (db.j.rows || []).map((r, i) => ({ r, n: names[i] })).filter(x => /Nadal/.test(JSON.stringify(x.n)) && /Medvedev/.test(JSON.stringify(x.n)) && /2019-?09-?0[78]/.test(JSON.stringify(x.r)));
console.log('### rows Nadal v Medvedev 2019-09 ' + JSON.stringify(rowsHit));
const retHit = (db.j.retRows || []).map((r, i) => ({ r, n: (nm.j.retNames || [])[i] })).filter(x => /Nadal/.test(JSON.stringify(x.n)) && /Medvedev/.test(JSON.stringify(x.n)));
console.log('### retRows Nadal v Medvedev ' + JSON.stringify(retHit));
console.log('### rows total ' + (db.j.rows || []).length + ' sample row ' + JSON.stringify((db.j.rows || [])[0]) + ' sample name ' + JSON.stringify(names[0]));
