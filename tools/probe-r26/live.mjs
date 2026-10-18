// probe r26 — read back 14b52fc on the deployed site
const B = 'https://michaeldk1996.github.io/SAAS/';
const bi = await fetch(B + 'build-info.json?t=' + Date.now()).then(r => r.json());
console.log('### build-info ' + JSON.stringify({ commit: bi.commit, builtAt: bi.builtAt, data: bi.data }));
const r = await fetch(B + 'captured-closes-pinnacle.json?t=' + Date.now());
console.log('### captured-closes-pinnacle.json HTTP ' + r.status);
if (r.status === 200) { const j = await r.json(); const rows = j.rows || j.closes || (Array.isArray(j) ? j : []);
  const w = rows.filter(x => 'round' in x || 'qualifying' in x); console.log('### rows ' + rows.length + ' with round/qualifying ' + w.length + ' sample ' + JSON.stringify(w.slice(-2))); }
