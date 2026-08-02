// Reproducible 1400px render of a PLAYER PROFILE from the worktree (or a commit).
// Zero installs: Node 24 global WebSocket + a spawned headless Chrome via CDP.
// Drives the real app: loads player-profiles.json, then showPlayerProfile(key),
// polls until the profile actually paints (no fixed-sleep-and-assume), screenshots.
//   node scripts/render-profile.mjs <worktree> <out.png> <commit|WORKING> <playerKey>
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const WT = process.argv[2];
const OUT = process.argv[3];
const COMMIT = process.argv[4] || 'WORKING';
const KEY = process.argv[5] || '2382';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const src = COMMIT === 'WORKING'
  ? fs.readFileSync(path.join(WT, 'bsp-consult-dashboard.html'), 'utf8')
  : spawnSync('git', ['-C', WT, 'show', `${COMMIT}:bsp-consult-dashboard.html`], {maxBuffer: 1<<30}).stdout.toString('utf8');
const stub = `<script>window.BSP={ready:Promise.resolve(),_u:{uid:"preview",name:"Alex Morgan",displayName:"Alex Morgan",email:"alex.morgan@stennisfy.local",emailVerified:true},currentUser:function(){return this._u;},requireVerified:function(){return Promise.resolve(this._u);},requireAuth:function(){return Promise.resolve(this._u);},onAuthChange:function(cb){try{cb(this._u);}catch(e){}return function(){};},signOut:function(){return Promise.resolve();}};</script>`;
const marker = '<script src="./auth.js"></script>';
if (!src.includes(marker)) throw new Error('auth.js marker not found');
const html = src.replace(marker, marker + '\n' + stub);
const previewName = '_render-profile.html';
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
const profile = fs.mkdtempSync('/tmp/ch-profile-');
const dport = 9400 + Math.floor(port % 500);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`, '--remote-allow-origins=*', `--user-data-dir=${profile}`,
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

await c.send('Page.navigate', {url: `${base}/${previewName}#/players`});

// wait for player-profiles.json to populate the roster. The app loads it on an
// idle callback that never fires headless, so invoke the loader explicitly —
// inside the poll so it retries once the script has finished defining it.
let loaded=0;
for(let i=0;i<120;i++){
  loaded = await evaluate(`(typeof playerProfiles!=='undefined'&&playerProfiles?Object.keys(playerProfiles).length:0)`).catch(()=>0);
  if(loaded>0) break;
  await evaluate(`(typeof loadPlayerProfiles==='function') ? loadPlayerProfiles() : null`).catch(()=>{});
  await sleep(250);
}
if(!loaded) throw new Error('playerProfiles never loaded');

// drive the real navigation: activate the Players page, then open the profile
const name = await evaluate(`(function(){try{
  var btn=document.querySelector('#mainNav button[data-tab="players"]'); if(btn) btn.click();
  if(!playerProfiles['${KEY}']) return null; showPlayerProfile('${KEY}'); return playerProfiles['${KEY}'].name;
}catch(e){return 'ERR:'+e.message;}})()`);

// poll until the profile content actually paints
let painted=false;
for(let i=0;i<80;i++){ painted = await evaluate(`(function(){var v=document.getElementById('playerProfileView'); return !!(v&&v.style.display!=='none'&&v.querySelector('.pp-shell'));})()`).catch(()=>false); if(painted) break; await sleep(200); }
await sleep(700); // let radar SVG / bars settle

const probe = await evaluate(`(function(){
  var v=document.getElementById('playerProfileView'); if(!v) return {painted:false};
  var q=s=>v.querySelector(s);
  var h1=v.querySelector('h1');
  var av=v.querySelector('.pp-shell')?v.querySelectorAll('div')[0]:null;
  var text=v.textContent.replace(/\\s+/g,' ');
  return {
    painted:true, name:h1?h1.textContent:null,
    hasShell:!!q('.pp-shell'), hasRail:!!q('.pp-rail'),
    hasFormCard:!!q('#ppRecentFormCard'), hasCareerCard:!!q('#ppCareerRecordCard'),
    hasMarketPanel:!!q('#ppMarketPanel'),
    formTitle:(function(){var e=q('#ppRecentFormCard'); if(!e)return null; var d=e.querySelector('div'); return d?d.textContent.trim():null;})(),
    careerTitle:(function(){var e=q('#ppCareerRecordCard'); if(!e)return null; var d=e.querySelector('div'); return d?d.textContent.trim():null;})(),
    hasBackLink:/Back to Players/.test(text),
    careerRows:v.querySelectorAll('[id^="ppYrDrill-"]').length,
    styleLine:(function(){return true;})()
  };
})()`);
console.log('DROVE', name);
console.log('PROBE', JSON.stringify(probe,null,2));

const dims = await evaluate(`({w:1400,h:Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)})`);
await c.send('Emulation.setDeviceMetricsOverride', {width:1400, height:dims.h, deviceScaleFactor:1, mobile:false});
await sleep(300);
const shot = await c.send('Page.captureScreenshot', {format:'png', captureBeyondViewport:true, clip:{x:0,y:0,width:1400,height:dims.h,scale:1}});
fs.writeFileSync(OUT, Buffer.from(shot.result.data,'base64'));
console.log('SHOT', OUT, 'height', dims.h);

// hero-region clip (top of the profile card) for close inspection of the header
try {
  const hy = await evaluate(`(function(){var v=document.getElementById('playerProfileView');var h=v&&v.querySelector('h1');if(!h)return null;var card=h.closest('div[style*="border-radius:18px"]')||v;var r=card.getBoundingClientRect();return {y:r.y+window.scrollY};})()`);
  const top = hy ? Math.max(0, hy.y - 4) : 0;
  const hshot = await c.send('Page.captureScreenshot', {format:'png', captureBeyondViewport:true, clip:{x:0,y:top,width:1400,height:200,scale:1}});
  fs.writeFileSync(OUT.replace(/\.png$/,'-hero.png'), Buffer.from(hshot.result.data,'base64'));
  console.log('HEROSHOT', OUT.replace(/\.png$/,'-hero.png'));
} catch(e){ console.log('heroshot err', e.message); }

chrome.kill(); server.close();
process.exit(0);
