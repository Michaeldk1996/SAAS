// Reproducible 1400px render of Matches page in the COMPLETED state.
// Zero installs: Node 24 global WebSocket + a spawned headless Chrome via CDP.
// Drives the Upcoming/Completed segmented control into "Completed" and waits for a
// completed card (.mc-won / .mc-sets) to actually paint before capturing — no fixed sleep.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const WT = process.argv[2];
const OUT = process.argv[3];
const COMMIT = process.argv[4] || 'WORKING';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const src = COMMIT === 'WORKING'
  ? fs.readFileSync(path.join(WT, 'bsp-consult-dashboard.html'), 'utf8')
  : spawnSync('git', ['-C', WT, 'show', `${COMMIT}:bsp-consult-dashboard.html`], {maxBuffer: 1<<30}).stdout.toString('utf8');
const stub = `<script>window.BSP={ready:Promise.resolve(),_u:{uid:"preview",name:"Alex Morgan",displayName:"Alex Morgan",email:"alex.morgan@stennisfy.local",emailVerified:true},currentUser:function(){return this._u;},requireVerified:function(){return Promise.resolve(this._u);},requireAuth:function(){return Promise.resolve(this._u);},onAuthChange:function(cb){try{cb(this._u);}catch(e){}return function(){};},signOut:function(){return Promise.resolve();}};</script>`;
const marker = '<script src="./auth.js"></script>';
if (!src.includes(marker)) throw new Error('auth.js marker not found');
const html = src.replace(marker, marker + '\n' + stub);
const previewName = '_render-completed.html';
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
const profile = fs.mkdtempSync('/tmp/ch-completed-');
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

await c.send('Page.navigate', {url: `${base}/${previewName}#/matches`});
// wait for ANY match card first (upcoming default)
for(let i=0;i<80;i++){ const n = await evaluate(`document.querySelectorAll('.match-card').length`).catch(()=>0); if(n>0) break; await sleep(200); }

// Drive the real controls: pick the day bucket that actually carries completed
// matches (07-28 = yesterday), then flip the segmented control to Completed.
// Both use the page's own click handlers, so this exercises the shipped code path.
const drove = await evaluate(`(function(){
  var out={};
  var dayBtn=[...document.querySelectorAll('#dayTabs button[data-day]')].find(b=>b.getAttribute('data-day')==='yesterday');
  if(dayBtn){ dayBtn.click(); out.day='yesterday'; }
  var vBtn=[...document.querySelectorAll('#viewSeg button[data-view]')].find(b=>b.getAttribute('data-view')==='completed');
  if(vBtn){ vBtn.click(); out.view='completed'; }
  return out;
})()`);
console.log('DROVE', JSON.stringify(drove));

// Wait for a COMPLETED card to actually paint — probe for the winner badge / set cluster, not a fixed sleep.
let completedCards=0;
for(let i=0;i<80;i++){
  completedCards = await evaluate(`document.querySelectorAll('.match-card .mc-sets, .match-card .mc-won').length`).catch(()=>0);
  if(completedCards>0) break; await sleep(150);
}
await sleep(400); // settle winner bars / journey glyphs

const probe = await evaluate(`(function(){
  const q=s=>document.querySelector(s);
  const activeSeg=[...document.querySelectorAll('[data-view]')].find(b=>b.classList.contains('active'));
  const first=q('.match-card');
  const won=q('.match-card .mc-won');
  const sets=q('.match-card .mc-sets');
  const favTag=q('.match-card .mc-fav-tag');
  const oddsWrap=q('.match-card .mc-oddswrap');
  const formBar=q('.match-card .mc-form');
  const colHead=q('.match-card .mc-colhead-inline');
  const msig=q('.match-card .mx-msigchip');
  const promo=q('.mc-promo');
  const wonName=won?won.closest('.mc-row').querySelector('.mc-name').textContent:null;
  const wonColor=won?getComputedStyle(won.closest('.mc-row').querySelector('.mc-name')).color:null;
  const setsTotal=sets?[...document.querySelectorAll('.match-card .mc-sets__total')].slice(0,2).map(e=>e.textContent):null;
  const setsFont=sets?getComputedStyle(sets.querySelector('.mc-sets__total')).fontFamily:null;
  return {
    activeView: activeSeg? activeSeg.getAttribute('data-view'):null,
    totalCards: document.querySelectorAll('.match-card').length,
    completedCards: document.querySelectorAll('.match-card .mc-sets, .match-card .mc-won').length,
    hasWonBadge: !!won, wonName, wonColor,
    setsTotal, setsFont,
    hasFavTag_shouldBeNull: !!favTag,
    hasOddsWrap_shouldBeNull: !!oddsWrap,
    hasFormBar_shouldBeNull: !!formBar,
    hasColHead_shouldBeNull: !!colHead,
    msigText: msig? msig.textContent.trim():null,
    hasPromo_shouldBeNull: !!promo,
  };
})()`);
console.log('PROBE', JSON.stringify(probe, null, 2));

const dims = await evaluate(`({w:1400,h:Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)})`);
await c.send('Emulation.setDeviceMetricsOverride', {width:1400, height:dims.h, deviceScaleFactor:1, mobile:false});
await sleep(300);
const shot = await c.send('Page.captureScreenshot', {format:'png', captureBeyondViewport:true, clip:{x:0,y:0,width:1400,height:dims.h,scale:1}});
fs.writeFileSync(OUT, Buffer.from(shot.result.data,'base64'));
console.log('SHOT', OUT, 'height', dims.h);

// close-up of the first completed card + its expanded Market Signal
const box = await evaluate(`(function(){var c=document.querySelector('.match-card'); if(!c) return null; var r=c.getBoundingClientRect(); return {x:r.x,y:r.y+window.scrollY,w:r.width,h:r.height};})()`);
if(box){ const shot2=await c.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:Math.max(0,box.x-8),y:Math.max(0,box.y-8),width:Math.min(1400,box.w+16),height:box.h+16,scale:1}});
  fs.writeFileSync(OUT.replace(/\.png$/,'-card.png'), Buffer.from(shot2.result.data,'base64')); console.log('CARDSHOT', OUT.replace(/\.png$/,'-card.png')); }

await evaluate(`(function(){var c=document.querySelector('.match-card .mx-msigchip'); if(c) c.click();})()`);
await sleep(500);
const sigBox = await evaluate(`(function(){var c=document.querySelector('.match-card.sig-open'); if(!c) return null; var r=c.getBoundingClientRect(); return {x:r.x,y:r.y+window.scrollY,w:r.width,h:r.height};})()`);
if(sigBox){ const shot3=await c.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:Math.max(0,sigBox.x-8),y:Math.max(0,sigBox.y-8),width:Math.min(1400,sigBox.w+16),height:sigBox.h+16,scale:1}});
  fs.writeFileSync(OUT.replace(/\.png$/,'-sigopen.png'), Buffer.from(shot3.result.data,'base64')); console.log('SIGSHOT', OUT.replace(/\.png$/,'-sigopen.png')); }

chrome.kill(); server.close();
process.exit(0);
