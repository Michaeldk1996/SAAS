// Generic 1400px full-height render of ANY dashboard page from the CURRENT worktree.
// Zero installs: Node global WebSocket + spawned headless Chrome via CDP.
// Usage: node scripts/render-page.mjs <worktree> <out.png> "<navLabelRegex>" [hashRoute]
//   navLabelRegex : matched against #mainNav button text to switch page (e.g. "News")
//   hashRoute     : optional initial hash (e.g. "/news"); nav click still applied
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const WT = process.argv[2];
const OUT = process.argv[3];
const NAV = new RegExp(process.argv[4] || 'Matches');
const HASH = process.argv[5] || '';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const src = fs.readFileSync(path.join(WT, 'bsp-consult-dashboard.html'), 'utf8');
const stub = `<script>window.BSP={ready:Promise.resolve(),_u:{uid:"preview",name:"Alex Morgan",displayName:"Alex Morgan",email:"alex.morgan@stennisfy.local",emailVerified:true},currentUser:function(){return this._u;},requireVerified:function(){return Promise.resolve(this._u);},requireAuth:function(){return Promise.resolve(this._u);},onAuthChange:function(cb){try{cb(this._u);}catch(e){}return function(){};},signOut:function(){return Promise.resolve();}};</script>`;
const marker = '<script src="./auth.js"></script>';
if (!src.includes(marker)) throw new Error('auth.js marker not found');
const html = src.replace(marker, marker + '\n' + stub);
const previewName = '_render-page.html';
fs.writeFileSync(path.join(WT, previewName), html);

const types = {'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.woff':'font/woff'};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/' + previewName;
  const fp = path.join(WT, p);
  if (!fp.startsWith(WT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, {'content-type': types[path.extname(fp)] || 'application/octet-stream'});
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = fs.mkdtempSync('/tmp/ch-render-');
const dport = 9400 + Math.floor(port % 500);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'], {stdio:'ignore'});

async function cdpTarget() {
  for (let i=0;i<60;i++){ try { const l = await (await fetch(`http://127.0.0.1:${dport}/json`)).json(); const pg=l.find(t=>t.type==='page'); if(pg?.webSocketDebuggerUrl) return pg.webSocketDebuggerUrl; } catch {} await sleep(200); }
  throw new Error('no CDP target');
}
function client(ws){ const s=new WebSocket(ws); let id=0; const pend=new Map();
  const ready=new Promise((res,rej)=>{s.onopen=()=>res();s.onerror=rej;});
  s.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
  const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,res);s.send(JSON.stringify({id:mid,method,params}));});
  return {ready,send}; }

const c = client(await cdpTarget());
await c.ready;
await c.send('Page.enable'); await c.send('Runtime.enable');
await c.send('Emulation.setDeviceMetricsOverride', {width:1400, height:1000, deviceScaleFactor:1, mobile:false});
const evaluate = async (expr) => { const r = await c.send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true}); if(r.result?.exceptionDetails) throw new Error('eval threw '+JSON.stringify(r.result.exceptionDetails)); return r.result?.result?.value; };

await c.send('Page.navigate', {url: `${base}/${previewName}${HASH?('#'+HASH):''}`});
await sleep(1500);
// click the nav button matching NAV label
const clicked = await evaluate(`(function(){var b=[...document.querySelectorAll('#mainNav button, nav button, .sf-nav button, a')].find(function(x){return ${NAV.toString()}.test(x.textContent||'');}); if(b){b.click(); return b.textContent.trim();} return null;})()`);
console.log('NAV clicked:', clicked);
await sleep(1800); // let the page render + async data load

const title = await evaluate(`(function(){var q=document.querySelector('.mx-h1,.page-title,h1,h2'); return q?q.textContent.trim().slice(0,80):null;})()`);
console.log('TITLE:', title);

const dims = await evaluate(`({w:1400,h:Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)})`);
await c.send('Emulation.setDeviceMetricsOverride', {width:1400, height:dims.h, deviceScaleFactor:1, mobile:false});
await sleep(400);
const shot = await c.send('Page.captureScreenshot', {format:'png', captureBeyondViewport:true, clip:{x:0,y:0,width:1400,height:dims.h,scale:1}});
fs.writeFileSync(OUT, Buffer.from(shot.result.data,'base64'));
console.log('SHOT', OUT, 'height', dims.h);

chrome.kill(); server.close();
process.exit(0);
