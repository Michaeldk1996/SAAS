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

for (const KEY of KEYS) {
  await ev(`document.querySelector('#mainNav button[data-tab="players"]').click()`);
  await sleep(300);
  await ev(`(async()=>{ if (typeof ensurePlayerProfile==='function') await ensurePlayerProfile(${JSON.stringify(KEY)}); showPlayerProfileV2(${JSON.stringify(KEY)}); })()`);
  for (let i=0;i<80;i++){ if(await ev(`document.querySelectorAll('.pp2-box').length===8`)) break; await sleep(250); }
  console.log(await ev(`(function(){
    var hdr = [].slice.call(document.querySelectorAll('div')).filter(function(d){ var c=getComputedStyle(d);
      return c.borderBottomStyle==='solid'&&parseFloat(c.borderBottomWidth)>0&&
        /rgba\\(255, 255, 255, 0\\.0[6-9]/.test(c.borderBottomColor)&&d.getBoundingClientRect().width>500;})[0];
    var lines=[];
    (function walk(el,d){ if(d>5) return;
      [].slice.call(el.children).forEach(function(k){
        var c=getComputedStyle(k), r=k.getBoundingClientRect();
        lines.push('  '.repeat(d)+k.tagName.toLowerCase()+' ['+Math.round(r.w||r.width)+'x'+Math.round(r.height)+'] '+
          'fs='+c.fontSize+' fw='+c.fontWeight+' ls='+c.letterSpacing+' lh='+c.lineHeight+' col='+c.color+
          ' | '+JSON.stringify((k.textContent||'').slice(0,46)));
        walk(k,d+1); });
    })(hdr,0);
    var rib = (document.querySelector('.pp2-chip')||{}).parentElement;
    rib = rib && rib.parentElement;
    if (rib) { lines.push('--- RIBBON col1 ---');
      var c1 = rib.children[0];
      (function walk(el,d){ if(d>3) return; [].slice.call(el.children).forEach(function(k){
        var c=getComputedStyle(k);
        lines.push('  '.repeat(d)+k.tagName.toLowerCase()+' fs='+c.fontSize+' lh='+c.lineHeight+' col='+c.color+' | '+JSON.stringify((k.textContent||'').slice(0,30)));
        walk(k,d+1); });})(c1,0); }
    return lines.join('\\n');
  })()`));
}
ws.close(); chrome.kill(); process.exit(0);
