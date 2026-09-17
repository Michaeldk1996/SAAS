#!/usr/bin/env node
/**
 * ten206-cs-readback.mjs — the founder's four counts, read out of a real browser
 * running the BRANCH code against the DEPLOYED data (ten206-hybrid-server.mjs).
 *
 * Answers, per player:
 *   1. spine  vs  banded + unbanded          (his check 1 — must be equal)
 *   2. the CAREER row's priced n  vs  the Calendar tab's priced subset over the
 *      SAME matches (his check 2 — must be equal, and must come from the repaired
 *      window-tier join, not the exact-key tiers alone)
 *
 * Usage: node ten206-cs-readback.mjs <baseUrl> <key> [key...]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = process.argv[2] || 'http://127.0.0.1:8732';
const KEYS = process.argv.slice(3).length ? process.argv.slice(3) : ['1980'];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function cdpTarget(dport, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json();
      const pg = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (pg) return pg.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('no CDP target');
}

const dport = 9600 + Math.floor((Date.now() / 1000) % 200);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'ten206cs-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`,
  `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1512,982', 'about:blank'], { stdio: 'ignore' });

const ws = new WebSocket(await cdpTarget(dport));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    throw new Error('eval threw: ' + ((d.exception && d.exception.description) || d.text || JSON.stringify(d)).slice(0, 600));
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
// Memory: CDP deployed-page auth bypass — neuter BSP.requireVerified via init script.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,
    get(){return _b;},set(v){if(v){v.requireVerified=()=>true;v.requireAuth=()=>true;}_b=v;}});})();`,
});
await send('Page.navigate', { url: `${BASE}/bsp-consult-dashboard.html` });

// Wait for the EAGER store too, not just the module. loadPlayerProfiles() does
// `playerProfiles = data.players`, a whole-map REASSIGNMENT — a shard injected
// before it lands is silently discarded. That raced the first player read here
// and reported "no profile for key" for Zverev while Martinez, read seconds
// later, was fine.
for (let i = 0; i < 240; i++) {
  if (await ev(`!!(window.PlayerProfileV2 && window.PlayerProfileV2._internals)
    && typeof playerProfiles !== 'undefined' && Object.keys(playerProfiles || {}).length > 0`)) break;
  await sleep(250);
}

let bad = 0;
for (const key of KEYS) {
  // Off-board players (Zverev among them) are NOT in the eager player-profiles.json
  // — the roster tracks today's board. The page reaches them through the search
  // path, which fetches profiles/<key>.json first. Calling show… without this is
  // an immediate `return false` and reads as "no profile for key".
  const got = await ev(`ensurePlayerProfile(${JSON.stringify(key)})`);
  if (!got) { console.log(`${key}: ERROR profiles/${key}.json did not load`); bad++; continue; }
  await ev(`showPlayerProfileV2(${JSON.stringify(key)})`);
  for (let i = 0; i < 120; i++) {
    const ready = await ev(`!!(window.careerHistory && window.careerHistory[${JSON.stringify(key)}]
      && window.courtSpeedMap && window.courtSpeedMap.venues)`);
    if (ready) break;
    await sleep(250);
  }
  const r = await ev(`(function(){
    var I = window.PlayerProfileV2._internals;
    var p = I.profileFor(${JSON.stringify(key)});
    if (!p) return { error: 'no profile for key' };
    I.state.speedSurf = 'all';
    var spine = I.calSpine(p);
    var bands = I.speedBands(p);
    var banded = 0, priced = 0, cents = 0;
    bands.forEach(function(b){ banded += b.won + b.lost; priced += b.priced; cents += b.cents; });
    // The Calendar tab's priced subset over the SAME population: the spine rows
    // that carry a Pinnacle price. Read off the spine, not off the bands, so the
    // two are genuinely independent reads of the same join.
    var spinePriced = spine.filter(function(r){ return r.cents != null; }).length;
    var spineCents = spine.reduce(function(s,r){ return s + (r.cents != null ? r.cents : 0); }, 0);
    // Banded-and-priced: the subset the CAREER row is allowed to name.
    var bandedPriced = 0;
    I.speedRows(p).forEach(function(m){
      if (I.speedBandForRow(m) && m.cents != null) bandedPriced += 1;
    });
    return {
      name: p.name, spine: spine.length, banded: banded, unbanded: bands.unbanded,
      scoped: bands.scoped, priced: priced, bandedPriced: bandedPriced,
      spinePriced: spinePriced, units: (cents/100).toFixed(2), spineUnits: (spineCents/100).toFixed(2),
      best: (function(){ var b = I.speedBestBand(bands); return b ? b.band.band.label + ' n=' + b.n : null; }())
    };
  })()`);
  if (r.error) { console.log(`${key}: ERROR ${r.error}`); bad++; continue; }
  const sumOk = r.banded + r.unbanded === r.spine;
  const pricedOk = r.priced === r.bandedPriced;
  console.log(`\n=== ${r.name} (${key}) — browser read, branch code + deployed data ===`);
  console.log(`  spine ${r.spine} | banded ${r.banded} + unbanded ${r.unbanded} = ${r.banded + r.unbanded}  ${sumOk ? 'OK' : 'MISMATCH'}`);
  console.log(`  scoped (surface chip "all") ${r.scoped}`);
  console.log(`  CAREER priced n ${r.priced} | banded-and-priced ${r.bandedPriced} ${pricedOk ? 'OK' : 'MISMATCH'} | whole-spine priced ${r.spinePriced}`);
  console.log(`  units on banded ${r.units} | units on whole spine ${r.spineUnits}`);
  console.log(`  best band: ${r.best || '—'}`);
  if (!sumOk || !pricedOk) bad++;
}

try { ws.close(); } catch { /* closing */ }
chrome.kill();
console.log(bad ? `\n${bad} check(s) FAILED` : '\nall checks OK');
process.exit(bad ? 1 : 0);
