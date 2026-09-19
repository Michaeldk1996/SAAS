// 50% overlay capture for the TEN-206 pixel pass.
//
// The design capture is a FULL-WIDTH page; ours renders inside the dashboard
// shell. The founder ruled that difference out of scope ("that's the capture,
// not a defect"), so a raw overlay of the two files would be a picture of the
// sidebar and nothing else. Instead the browser is sized so OUR content column
// is the design's measured 1234 CSS (four 299.5px cards + three 12px gaps +
// 34px page padding either side), and both images are then cropped to their own
// content column before compositing. What the overlay then shows is geometry,
// which is what item 8 is about.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.argv[2] || 'http://127.0.0.1:8776').replace(/\/$/, '');
const KEY = process.argv[3] || '1980';
const OUT = process.argv[4] || '/tmp/ours-profile.png';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function cdpTarget(dport, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json();
      const pg = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (pg) return pg.webSocketDebuggerUrl;
    } catch { /* not up */ }
    await sleep(150);
  }
  throw new Error('no CDP target');
}
const dport = 9600 + Math.floor((Date.now() / 997) % 200);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'pxovl-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`,
  `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--force-device-scale-factor=2', '--window-size=1518,1400',
  'about:blank'], { stdio: 'ignore' });
const ws = new WebSocket(await cdpTarget(dport));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride',
  { width: 1518, height: 1400, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,
    get(){return _b;},set(v){if(v){v.requireVerified=()=>true;v.requireAuth=()=>true;}_b=v;}});})();`,
});
await send('Page.navigate', { url: `${BASE}/bsp-consult-dashboard.html` });
for (let i = 0; i < 300; i++) {
  if (await ev(`typeof playerProfiles !== 'undefined' && Object.keys(playerProfiles||{}).length > 0`)) break;
  await sleep(250);
}
await ev(`document.querySelector('#mainNav button[data-tab="players"]').click()`);
await sleep(300);
await ev(`(async()=>{ if(typeof ensurePlayerProfile==='function') await ensurePlayerProfile(${JSON.stringify(KEY)});
           showPlayerProfileV2(${JSON.stringify(KEY)}); })()`);
for (let i = 0; i < 80; i++) {
  if (await ev(`(function(){var b=[].slice.call(document.querySelectorAll('.pp2-box'));
    return b.length===8 && !b.some(function(x){return /not loaded|Loading/.test(x.textContent);});})()`)) break;
  await sleep(250);
}
// Refuse to shoot a degenerate box — the .tabpage trap made eight captures of
// the wrong page once, with every DOM read passing.
const geom = await ev(`(function(){
  var g = document.querySelector('.pp2-grid'); if(!g) return null;
  var b = document.querySelector('.pp2-box').getBoundingClientRect();
  var head = document.querySelector('.pp2-head');
  var ins = document.querySelector('[data-insight]');
  var root = head ? head.parentElement : g.parentElement;
  var rr = root.getBoundingClientRect();
  var hr = head ? head.getBoundingClientRect() : rr;
  var ir = ins ? ins.getBoundingClientRect() : g.getBoundingClientRect();
  return { cardW: +b.width.toFixed(2), x: +rr.x.toFixed(1), w: +rr.width.toFixed(1),
           top: +hr.y.toFixed(1), bottom: +(ir.y + ir.height).toFixed(1) };
})()`);
if (!geom || geom.cardW < 10) { console.log('REFUSING — degenerate geometry', geom); process.exit(1); }
console.log('ours:', JSON.stringify(geom), '(design card 299.5, column 1234)');
const shot = await send('Page.captureScreenshot', {
  format: 'png', captureBeyondViewport: true,
  clip: { x: geom.x, y: geom.top, width: geom.w,
          height: geom.bottom - geom.top + 40, scale: 1 },
});
fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
console.log('wrote', OUT);
ws.close(); chrome.kill(); process.exit(0);
