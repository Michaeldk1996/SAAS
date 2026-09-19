import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('./tools/match-stats-store.js');
const FAILED=[]; const check=(n,c,d='')=>{console.log(`  ${c?'ok  ':'FAIL'} ${n}${d?'   '+d:''}`); if(!c)FAILED.push(n);};
const sheet = (n) => ({ matchStats: { p1: Array(n).fill({x:1}), p2: Array(n).fill({x:1}) } });

console.log('match-stats hydrate — UNION the deployed store (TEN-240 root cause)');
const root = fs.mkdtempSync(path.join(os.tmpdir(),'mss-'));
// floor + cache both MISS a key that is live — the exact churn shape
fs.writeFileSync(path.join(root, M.FLOOR), JSON.stringify({ A: sheet(3) }));
fs.writeFileSync(path.join(root, M.PLAIN), JSON.stringify({ B: sheet(3) }));
const LIVE = { A: sheet(3), B: sheet(3), CHURNED: sheet(4) };
const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok:true, json: async () => LIVE });

const before = M.hydrate(root);
const mid = JSON.parse(fs.readFileSync(path.join(root, M.PLAIN),'utf8'));
check('CONTROL: plain hydrate (floor UNION cache) LOSES the live-only key — this '
    + 'is the defect, reproduced', before===1 && !('CHURNED' in mid), Object.keys(mid).join(','));

const rc = await M.hydrateWithLive(root);
const after = JSON.parse(fs.readFileSync(path.join(root, M.PLAIN),'utf8'));
check('hydrateWithLive recovers the churned key', rc===1 && 'CHURNED' in after, Object.keys(after).sort().join(','));
check('...and keeps everything the old path already had', ['A','B'].every(k=>k in after));

// union is upgrade-only: a DEEPER local sheet must not be shallowed by a thinner live one
fs.writeFileSync(path.join(root, M.FLOOR), JSON.stringify({ A: sheet(9) }));
fs.writeFileSync(path.join(root, M.PLAIN), JSON.stringify({ A: sheet(9) }));
globalThis.fetch = async () => ({ ok:true, json: async () => ({ A: sheet(2) }) });
await M.hydrateWithLive(root);
const deep = JSON.parse(fs.readFileSync(path.join(root, M.PLAIN),'utf8'));
check('a THINNER live sheet cannot shallow a deeper local one — union is upgrade-only',
      deep.A.matchStats.p1.length===9, String(deep.A.matchStats.p1.length));

// fail-open
fs.writeFileSync(path.join(root, M.FLOOR), JSON.stringify({ A: sheet(3) }));
fs.writeFileSync(path.join(root, M.PLAIN), JSON.stringify({ A: sheet(3) }));
globalThis.fetch = async () => { throw new Error('network down'); };
const rc2 = await M.hydrateWithLive(root);
const kept = JSON.parse(fs.readFileSync(path.join(root, M.PLAIN),'utf8'));
check('an unreachable live store FAILS OPEN — hydrate still succeeds and keeps the '
    + 'floor+cache result, so a network blip cannot redden a deploy',
      rc2===1 && 'A' in kept);
globalThis.fetch = realFetch;
console.log('');
if (FAILED.length){ console.log(`${FAILED.length} FAILED: ${JSON.stringify(FAILED)}`); process.exit(1);} 
console.log('all checks passed');
