// Reproducible 1400px render of the TOURNAMENTS page (Overview) from the worktree
// (or a commit). Zero installs: Node 24 global WebSocket + spawned headless Chrome.
// Drives the real app: clicks the Tournaments nav, selects a tournament, polls
// until the conditions panel actually paints (no fixed-sleep-and-assume), shoots.
//   node scripts/render-tourn.mjs <worktree> <out.png> <commit|WORKING> [tourName]
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const WT = process.argv[2];
const OUT = process.argv[3];
const COMMIT = process.argv[4] || 'WORKING';
const TOUR = process.argv[5] || 'Wimbledon';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const src = COMMIT === 'WORKING'
  ? fs.readFileSync(path.join(WT, 'bsp-consult-dashboard.html'), 'utf8')
  : spawnSync('git', ['-C', WT, 'show', `${COMMIT}:bsp-consult-dashboard.html`], {maxBuffer: 1<<30}).stdout.toString('utf8');
const stub = `<script>window.BSP={ready:Promise.resolve(),_u:{uid:"preview",name:"Alex Morgan",displayName:"Alex Morgan",email:"alex.morgan@stennisfy.local",emailVerified:true},currentUser:function(){return this._u;},requireVerified:function(){return Promise.resolve(this._u);},requireAuth:function(){return Promise.resolve(this._u);},onAuthChange:function(cb){try{cb(this._u);}catch(e){}return function(){};},signOut:function(){return Promise.resolve();}};</script>`;
const marker = '<script src="./auth.js"></script>';
if (!src.includes(marker)) throw new Error('auth.js marker not found');
const html = src.replace(marker, marker + '\n' + stub);
const previewName = '_render-tourn.html';
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
const profile = fs.mkdtempSync('/tmp/ch-tprofile-');
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

await c.send('Page.navigate', {url: `${base}/${previewName}`});

// wait for the app scripts to define the tourx renderer + inline conditions data
let ready=false;
for(let i=0;i<120;i++){ ready = await evaluate(`(typeof renderTournamentsTab==='function' && typeof COURT_CONDITIONS!=='undefined')`).catch(()=>false); if(ready) break; await sleep(250); }
if(!ready) throw new Error('tourx renderer never defined');
// give the async loads (matches.json, tournament-profiles.json, progression) a moment
await sleep(1200);

// drive real navigation: click the Tournaments nav, force the selection + section
const drove = await evaluate(`(function(){try{
  var btn=document.querySelector('#mainNav button[data-tab="tournaments"]'); if(btn) btn.click();
  tourxState.section='overview'; tourxState.tsScope='season'; tourxState.tsSel='${TOUR}';
  renderTournamentsTab();
  return {sel:tourxState.tsSel, profs:(typeof tournamentProfiles!=='undefined'?Object.keys(tournamentProfiles).length:0)};
}catch(e){return {err:e.message};}})()`);

// poll until the conditions panel actually paints for the selected tournament
let painted=false;
for(let i=0;i<80;i++){ painted = await evaluate(`(function(){var r=document.querySelector('#tourxOverview .tourx-ovright'); return !!(r && /abstract court speed/i.test(r.textContent));})()`).catch(()=>false); if(painted) break; await sleep(200); }
await sleep(500);

const probe = await evaluate(`(function(){
  var r=document.querySelector('#tourxOverview .tourx-ovright'); if(!r) return {painted:false};
  var t=r.textContent.replace(/\\s+/g,' ');
  var tabs=[...document.querySelectorAll('#tourxSectionTabs .tourx-secttab')].map(e=>e.textContent.trim());
  var left=document.querySelector('#tourxOverview .tourx-ovleft');
  return {
    painted:true, tabs:tabs,
    scopeBtns:[...(left?left.querySelectorAll('span'):[])].map(e=>e.textContent.trim()).filter(x=>/week|season/i.test(x)).slice(0,2),
    heroName:(r.querySelector('span')||{}).textContent,
    hasConditionsRead:/conditions read/i.test(t),
    hasSlow:/SLOW/i.test(t)&&/MEDIUM/i.test(t)&&/FAST/i.test(t),
    hasRank:/fastest of/i.test(t)&&/tour median/i.test(t),
    hasAltitude:/altitude/i.test(t), hasFirstServe:/1st serve won/i.test(t), hasServiceHold:/service hold/i.test(t),
    hasAbstractTile:(t.match(/abstract court speed/gi)||[]).length,
    hasBounce:/bounce/i.test(t), hasChampion:/champion/i.test(t),
    has3yr:/last 3 years/i.test(t),
    hasRoiFav:/roi backing favourites/i.test(t), hasRoiDog:/roi backing underdogs/i.test(t),
    hasReliability:/favourite reliability/i.test(t),
    hasReport:/report/i.test(t),
    rankText:(t.match(/[0-9]+(?:st|nd|rd|th) fastest of [0-9]+ tour events · tour median [0-9.]+/i)||[])[0]||null
  };
})()`);
console.log('DROVE', JSON.stringify(drove));
console.log('PROBE', JSON.stringify(probe,null,2));

const dims = await evaluate(`({w:1400,h:Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)})`);
await c.send('Emulation.setDeviceMetricsOverride', {width:1400, height:dims.h, deviceScaleFactor:1, mobile:false});
await sleep(300);
const shot = await c.send('Page.captureScreenshot', {format:'png', captureBeyondViewport:true, clip:{x:0,y:0,width:1400,height:dims.h,scale:1}});
fs.writeFileSync(OUT, Buffer.from(shot.result.data,'base64'));
console.log('SHOT', OUT, 'height', dims.h);

chrome.kill(); server.close();
process.exit(0);
