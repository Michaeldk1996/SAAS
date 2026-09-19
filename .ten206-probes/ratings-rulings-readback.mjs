import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.argv[2] || 'http://127.0.0.1:8776').replace(/\/$/, '');
const KEYS = process.argv.slice(3).length ? process.argv.slice(3) : ['1980', '379'];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const FAV_LABELS = ['1.01 – 1.20', '1.21 – 1.40', '1.41 – 1.64', '1.65 – 1.99'];
const DOG_LABELS = ['2.00 – 2.49', '2.50 – 3.49', '3.50 – 5.99', '6.00 +'];

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

const dport = 9400 + Math.floor((Date.now() / 997) % 200);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'mktprobe-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`,
  `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

const ws = new WebSocket(await cdpTarget(dport));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
const jsErrors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    jsErrors.push(((d.exception && d.exception.description) || d.text || '').slice(0, 180));
  }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    throw new Error('eval threw: ' + ((d.exception && d.exception.description) || d.text || '').slice(0, 400));
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}

const checks = [];
const ok = (name, pass, detail) => { checks.push({ name, pass, detail }); };

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,
    get(){return _b;},set(v){if(v){v.requireVerified=()=>true;v.requireAuth=()=>true;}_b=v;}});})();`,
});
await send('Page.navigate', { url: `${BASE}/bsp-consult-dashboard.html` });
for (let i = 0; i < 300; i++) {
  if (await ev(`typeof playerProfiles !== 'undefined' && Object.keys(playerProfiles||{}).length > 0`)) break;
  await sleep(250);
}
console.log(`BASE=${BASE}  keys=${KEYS.join(',')}`);


async function unhide(){ await ev(`(function(){var e=document.querySelector('[data-pp2="scrim"]');
  for(var p=e;p&&p!==document.documentElement;p=p.parentElement){ if(getComputedStyle(p).display==='none')p.style.display='block'; }
  void document.body.offsetHeight;})()`); await sleep(200); }
await ev(`ensurePlayerProfile("1980")`);
await ev(`(typeof showPlayerProfileV2==='function'?showPlayerProfileV2:showPlayerProfile)("1980")`);
await sleep(1100);
await ev(`(function(){var bs=Array.prototype.slice.call(document.querySelectorAll('[data-pp2="box"]'));
  var b=bs.filter(function(e){return /Career record/i.test(e.textContent||'');})[0]; if(b)b.click();})()`);
await sleep(800); await unhide();
await ev(`(function(){var b=document.querySelector('[data-pp2="career-tab"][data-v="ratings"]'); if(b)b.click();})()`);
await sleep(800); await unhide();
const r = await ev(`(function(){
  var sc=document.querySelector('[data-pp2="scrim"]'); if(!sc) return {e:'no scrim'};
  var t=(sc.textContent||'').replace(/\\s+/g,' ');
  function tile(label){
    var all=Array.prototype.slice.call(sc.querySelectorAll('div'));
    var n=all.filter(function(d){return (d.textContent||'').trim()===label;})[0];
    if(!n) return null;
    var box=n.parentElement;
    return (box.textContent||'').replace(/\\s+/g,' ').trim();
  }
  var m=t.match(/tour figures are the average of the (\\d+) players we rate, not the ATP field/);
  var f=t.match(/Every "tour" figure on this panel[^.]*\\./);
  return {
    aces: tile('Aces per match'), dfs: tile('Double faults per match'),
    pct : tile('First serve in'),
    noteN: m?m[1]:null, note: m?m[0]:null,
    foot: f?f[0]:null,
    anyAtpFieldClaim: /percentile vs the ATP field/.test(t)
  };
})()`);
console.log('ACE TILE   : '+r.aces);
console.log('DF TILE    : '+r.dfs);
console.log('CONTROL %  : '+r.pct);
console.log('');
console.log('NOTE       : '+r.note);
console.log('N printed  : '+r.noteN);
console.log('FOOTNOTE   : '+(r.foot||'(none)'));
console.log('stale "percentile vs the ATP field" claim present: '+r.anyAtpFieldClaim);
console.log('JS errors  : '+jsErrors.length);
process.exit(0);
