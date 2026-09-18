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


// ── ITEM 4 · sticky grain + a subject with ZERO matches at that grain ───────
async function unhide() {
  await ev(`(function(){
    var e = document.querySelector('[data-pp2="scrim"]');
    for (var p = e; p && p !== document.documentElement; p = p.parentElement) {
      if (getComputedStyle(p).display === 'none') p.style.display = 'block';
    }
    void document.body.offsetHeight;
  })()`);
  await sleep(200);
}
const SUBS = (process.env.LC_SUBJECTS || '561:Best of 5').split(',');
for (const spec of SUBS) {
  const [key, grain] = spec.split(':');
  await ev(`ensurePlayerProfile(${JSON.stringify(key)})`);
  await ev(`(typeof showPlayerProfileV2 === 'function' ? showPlayerProfileV2 : showPlayerProfile)(${JSON.stringify(key)})`);
  await sleep(900);
  await ev(`(function(){var bs=Array.prototype.slice.call(document.querySelectorAll('[data-pp2="box"]'));
    var b=bs.filter(function(e){return /Market edge/i.test(e.textContent||'');})[0]; if(b)b.click();})()`);
  await sleep(800); await unhide();
  await ev(`(function(){var b=Array.prototype.slice.call(document.querySelectorAll('[data-pp2="market-tab"]'))
    .filter(function(e){return /Derived lines/.test(e.textContent||'');})[0]; if(b)b.click();})()`);
  await sleep(700); await unhide();
  await ev(`(function(){var b=Array.prototype.slice.call(document.querySelectorAll('[data-pp2="lc-fmt"]'))
    .filter(function(e){return new RegExp(${JSON.stringify(grain)}).test(e.textContent||'');})[0]; if(b)b.click();})()`);
  await sleep(700); await unhide();
  const r = await ev(`(function(){
    var sc = document.querySelector('[data-pp2="scrim"]'); if(!sc) return {error:'no scrim'};
    var btns = Array.prototype.slice.call(sc.querySelectorAll('[data-pp2="lc-fmt"]')).map(function(b){
      var s = getComputedStyle(b);
      return { label:(b.textContent||'').trim(), weight:s.fontWeight, bg:s.backgroundColor, selected: s.fontWeight === '700' };
    });
    var grids = Array.prototype.slice.call(sc.querySelectorAll('div')).filter(function(d){
      var gt = getComputedStyle(d).gridTemplateColumns;
      return gt && gt.split(' ').length === 6 && /58px/.test(gt);
    });
    var t = (sc.textContent||'').replace(/\\s+/g,' ');
    var dashed = Array.prototype.slice.call(sc.querySelectorAll('div')).filter(function(d){
      return /dashed/.test(getComputedStyle(d).borderTopStyle||'') ||
             /dashed/.test((d.getAttribute('style')||''));
    }).map(function(d){ return (d.textContent||'').replace(/\\s+/g,' ').trim(); });
    return { grainButtons:btns, gridCount:grids.length,
      groupsPresent:['Games handicap','Set handicap','Total games','Match shape']
        .filter(function(g){ return t.indexOf(g) >= 0; }),
      emptyBlocks: dashed,
      zeroCount: (t.match(/\\b0\\b/g)||[]).length,
      afterCoverage: (t.split('Coverage by line')[1]||'').slice(0,420) };
  })()`);
  console.log(`\n=== key ${key} · grain requested "${grain}" ===`);
  console.log('  grain buttons : ' + JSON.stringify(r.grainButtons));
  console.log('  6-track grids : ' + r.gridCount);
  console.log('  groups present: ' + (r.groupsPresent.length ? r.groupsPresent.join(' · ') : '(none)'));
  console.log('  dashed-border blocks:');
  (r.emptyBlocks||[]).forEach(function(b){ if(b) console.log('    > ' + b.slice(0,300)); });
  console.log('  rendered after "Coverage by line":');
  console.log('    ' + (r.afterCoverage||'').trim().slice(0,400));
}
console.log(`\nJS errors: ${jsErrors.length}`);
process.exit(0);
