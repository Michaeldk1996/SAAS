const fs = require('fs'), path = require('path'), cp = require('child_process');
const LIVE = path.resolve(process.argv[2]);
const ROOT = path.resolve(__dirname, '..', '..');
cp.execSync(`cp -r ${ROOT}/odds-archive ${LIVE}/odds-archive`);
const { buildIdentityGate } = require('../../td-identity.js');
const mc = require('../../build-match-closes.js');
const src = fs.readFileSync(path.join(ROOT, 'build-match-closes.js'), 'utf8');
const mp = path.join(ROOT, '.nogate-mc.js');
fs.writeFileSync(mp, src.replace('return k && gate && date && !gate.allow(k, name, date) ? null : k;', 'return k;'));
const A = path.join(LIVE, 'mcA'), B = path.join(LIVE, 'mcB'); fs.mkdirSync(A); fs.mkdirSync(B);
require(mp).build(LIVE, B, path.join(B, 'index.json'));
mc.build(LIVE, A, path.join(A, 'index.json'));
const ia = JSON.parse(fs.readFileSync(path.join(A, 'index.json'))), ib = JSON.parse(fs.readFileSync(path.join(B, 'index.json')));
const prof = (JSON.parse(fs.readFileSync(path.join(LIVE, 'player-profiles.json'))).players) || {};
const g = ia.identityGate;
console.log('gate checked', g.checked, 'beforeCareer', g.beforeCareer, 'otherActive', g.otherActive);
let tb = 0, ta = 0; const diffs = [];
for (const k of new Set([...Object.keys(ia.players), ...Object.keys(ib.players)])) {
  const a = (ia.players[k] || [0])[0], b = (ib.players[k] || [0])[0]; tb += b; ta += a;
  if (a !== b) {
    const rb = fs.existsSync(path.join(B, k + '.json')) ? JSON.parse(fs.readFileSync(path.join(B, k + '.json'))).rows : [];
    const ra = fs.existsSync(path.join(A, k + '.json')) ? JSON.parse(fs.readFileSync(path.join(A, k + '.json'))).rows : [];
    const sa = new Set(ra.map(r => r.join('|')));
    const gone = rb.filter(r => !sa.has(r.join('|')));
    const yrs = {}; gone.forEach(r => { yrs[r[0].slice(0, 4)] = (yrs[r[0].slice(0, 4)] || 0) + 1; });
    diffs.push([k, (prof[k] && prof[k].name) || '?', b, a, JSON.stringify(yrs), JSON.stringify(g.byKey[k] || {}), gone.slice(0, 3).map(r => r[0] + ' v ' + r[1]).join('; ')]);
  }
}
console.log('closes-shard Tennis-Data rows: before', tb, 'after', ta, 'players changed', diffs.length);
diffs.sort((x, y) => (y[2] - y[3]) - (x[2] - x[3])).forEach(d => console.log(d.join(' | ')));
const gg = buildIdentityGate(LIVE, null);
console.log('merged same-person keys:', JSON.stringify(gg.merged));
console.log('1056 kept:', JSON.stringify(JSON.parse(fs.readFileSync(path.join(A, '1056.json'))).rows.map(r => r[0] + ' v ' + r[1])));
const sh = k => JSON.parse(fs.readFileSync(path.join(LIVE, 'career-history', k + '.json')));
const a = sh('101792').matches.map(r => r.date).sort(); console.log('101792 own', a[0], '..', a[a.length - 1], a.length);
const m = sh('1056').matches.filter(r => r.date < '2023').map(r => `${r.date} ${r.tournament} ${r.level || ''} v ${r.opponent}`).sort(); console.log('1056 own rows before 2023:', m.length); m.forEach(x => console.log('  ', x));
