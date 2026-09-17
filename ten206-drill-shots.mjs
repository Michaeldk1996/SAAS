// TEN-206 §5.2 — screenshots for the founder's item 5b.
// Same CDP harness as ten206-drill-probe.mjs; captures the four states he named.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const BASE = process.argv[2], WHO = process.argv[3] || 'Djokovic', OUT = process.argv[4] || '/tmp';
const URL_ = BASE + '/bsp-consult-dashboard.html';
const PORT = 9378;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
   '--user-data-dir=/tmp/ten206-shots', '--window-size=1512,982', '--force-device-scale-factor=2', 'about:blank'],
  { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tws() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const t = (await r.json()).find((x) => x.type === 'page');
      if (t?.webSocketDebuggerUrl) return t.webSocketDebuggerUrl; } catch {}
    await sleep(500);
  }
  throw new Error('no target');
}
const ws = new WebSocket(await tws());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => { const i = ++id; return new Promise((res) => { pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); }); };
async function ev(e, a = true) {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: a, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  console.log('wrote', `${OUT}/${name}.png`);
}
await send('Page.enable'); await send('Runtime.enable');
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1512, height: 982, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', { source:
  `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,get(){return _b;},set(v){if(v){v.requireVerified=()=>true;v.requireAuth=()=>true;}_b=v;}});})();` });
await send('Page.navigate', { url: URL_ });
for (let i = 0; i < 150; i++) {
  const n = await ev(`(typeof playerProfiles!=='undefined'&&playerProfiles)?Object.keys(playerProfiles).length:0`, false);
  if (n > 50) break; await sleep(1000);
}
const key = await ev(`(function(){
  document.querySelectorAll('.tabpage').forEach(p=>p.classList.toggle('active',p.dataset.page==='players'));
  var k=Object.keys(playerProfiles).find(k=>new RegExp(${JSON.stringify(WHO)}).test(playerProfiles[k].name))||Object.keys(playerProfiles)[0];
  showPlayerProfile(k); return k; })()`);
for (let i = 0; i < 30; i++) { if (await ev(`!!(window.marketEdge&&window.marketEdge['${key}'])`, false)) break; await sleep(1000); }
console.log('player', key, await ev(`playerProfiles['${key}'].name`, false));
await ev(`document.querySelector('[data-pp2="box"][data-box="career"]').click()`);
await sleep(300);

const click = async (v, scrollTo) => {
  await ev(`(function(){var e=[...document.querySelectorAll('[data-pp2="career-cell"]')].filter(function(x){return x.getAttribute('data-v')===${JSON.stringify(v)};})[0];
    if(e){e.click();} return !!e;})()`);
  await sleep(250);
  if (scrollTo) {
    await ev(`(function(){var d=[...document.querySelectorAll('[data-pp2-drill-scroll]')][0];
      if(d) d.parentNode.scrollIntoView({block:'center'}); return 1;})()`);
    await sleep(200);
  }
};
const close = async (v) => { await click(v); };

// b1 — a year SURFACE drill (design shot 1 is "Hard · 2025")
const years = await ev(`[...new Set([...document.querySelectorAll('[data-pp2="career-cell"]')]
  .map(function(e){return e.getAttribute('data-v');}).filter(function(v){return /\\|hard$/.test(v)&&!/^career/.test(v);}))]`);
await click(years[1] || years[0], true); await shot('live-year-surface-drill'); await close(years[1] || years[0]);

// b2 — a year TOTAL drill
const totals = await ev(`[...new Set([...document.querySelectorAll('[data-pp2="career-cell"]')]
  .map(function(e){return e.getAttribute('data-v');}).filter(function(v){return /\\|$/.test(v)&&!/^career/.test(v);}))]`);
await click(totals[1] || totals[0], true); await shot('live-year-total-drill'); await close(totals[1] || totals[0]);

// b3 — "Hard · career" under the CAREER row, the design screenshot's own state
await click('career|hard', true); await shot('live-hard-career'); await close('career|hard');

// b4 — "All matches · career" scrolled to the bottom of the list
await click('career|', true);
await ev(`(async function(){var sc=document.querySelector('[data-pp2-drill-scroll]');
  var last=-1; for(var i=0;i<80;i++){sc.scrollTop=sc.scrollHeight; await new Promise(function(r){setTimeout(r,50);});
  var n=sc.querySelectorAll('[data-pp2-drill-grid] > *').length; if(n===last)break; last=n;} return last;})()`);
await sleep(300);
await ev(`(function(){var d=[...document.querySelectorAll('[data-pp2-drill-scroll]')][0]; if(d) d.parentNode.scrollIntoView({block:'center'}); return 1;})()`);
await sleep(200);
await shot('live-all-career-bottom');
console.log('bottom note:', await ev(`document.querySelector('[data-pp2-drill-note]').textContent`, false));
ws.close(); chrome.kill(); process.exit(0);
