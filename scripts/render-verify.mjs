// Reproducible 1400px render of Today's Matches from the CURRENT worktree.
// Zero installs: Node 24 global WebSocket + a spawned headless Chrome via CDP.
// Injects a BSP auth stub so requireVerified resolves (display name "Alex Morgan").
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const WT = process.argv[2];
const OUT = process.argv[3];
const COMMIT = process.argv[4] || 'WORKING';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 1) Build preview file from the committed dashboard + auth stub.
const src = COMMIT === 'WORKING'
  ? fs.readFileSync(path.join(WT, 'bsp-consult-dashboard.html'), 'utf8')
  : spawnSync('git', ['-C', WT, 'show', `${COMMIT}:bsp-consult-dashboard.html`], {maxBuffer: 1<<30}).stdout.toString('utf8');
const stub = `<script>window.BSP={ready:Promise.resolve(),_u:{uid:"preview",name:"Alex Morgan",displayName:"Alex Morgan",email:"alex.morgan@stennisfy.local",emailVerified:true},currentUser:function(){return this._u;},requireVerified:function(){return Promise.resolve(this._u);},requireAuth:function(){return Promise.resolve(this._u);},onAuthChange:function(cb){try{cb(this._u);}catch(e){}return function(){};},signOut:function(){return Promise.resolve();}};</script>`;
// insert stub right AFTER the auth.js include so it overrides BSP
const marker = '<script src="./auth.js"></script>';
if (!src.includes(marker)) throw new Error('auth.js marker not found');
const html = src.replace(marker, marker + '\n' + stub);
const previewName = '_render-matches.html';
fs.writeFileSync(path.join(WT, previewName), html);

// 2) Static server rooted at the worktree (relative fetches resolve).
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

// 3) Fresh headless Chrome.
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

await c.send('Page.navigate', {url: `${base}/${previewName}#/matches`});
let cards=0;
for(let i=0;i<80;i++){ cards = await evaluate(`document.querySelectorAll('.match-card').length`).catch(()=>0); if(cards>0) break; await sleep(200); }
await sleep(800); // let bars/panels paint

// probe the disputed Item-1 points from the live DOM
const probe = await evaluate(`(function(){
  const q=s=>document.querySelector(s);
  const edgeBtn=[...document.querySelectorAll('#mainNav button')].find(b=>/Stennisfy Model/.test(b.textContent));
  const stylesBtn=[...document.querySelectorAll('#mainNav button')].find(b=>/Playing Styles/.test(b.textContent));
  const sig=q('.mx-msigchip');
  const foot=q('.sf-foot');
  return {
    cards: document.querySelectorAll('.match-card').length,
    edgeIconPaths: edgeBtn? [...edgeBtn.querySelectorAll('path')].map(p=>p.getAttribute('d')): null,
    stylesIconPaths: stylesBtn? [...stylesBtn.querySelectorAll('path')].map(p=>p.getAttribute('d')): null,
    sigOnclick: sig? sig.getAttribute('onclick'): null,
    footHTMLhasSignOut: foot? /sign\s*out/i.test(foot.textContent): null,
    acctLabel: (q('#acctLabel')||{}).textContent,
    acctPlan: (q('.sf-userplan')||{}).textContent,
    hasUpgrade: !!q('.sf-upgrade'),
    title: (q('.mx-h1,.page-title,h1')||{}).textContent,
  };
})()`);
console.log('PROBE', JSON.stringify(probe, null, 2));

// full page height + screenshot
const dims = await evaluate(`({w:1400,h:Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)})`);
await c.send('Emulation.setDeviceMetricsOverride', {width:1400, height:dims.h, deviceScaleFactor:1, mobile:false});
await sleep(300);
const shot = await c.send('Page.captureScreenshot', {format:'png', captureBeyondViewport:true, clip:{x:0,y:0,width:1400,height:dims.h,scale:1}});
fs.writeFileSync(OUT, Buffer.from(shot.result.data,'base64'));
console.log('SHOT', OUT, 'height', dims.h);

// ---- Market Signal EXPANDED capture ----
await evaluate(`(function(){var c=document.querySelector('.mx-msigchip'); if(c) c.click();})()`);
await sleep(600);
const sigProbe = await evaluate(`(function(){
  var card=document.querySelector('.match-card.sig-open'); if(!card) return {open:false};
  var panel=card.querySelector('.mc-sigpanel')||card;
  var txt=panel.textContent.replace(/\\s+/g,' ').trim();
  return {open:true,
    hasSharp:/SHARP ESTIMATES/i.test(txt), hasMoney:/MARKET MONEY/i.test(txt),
    hasLiquidity:/LIQUIDITY/i.test(txt),
    mentionsPinnacle:/Pinnacle/i.test(txt), mentionsStennisfy:/Stennisfy/i.test(txt),
    mentionsPoly:/Polymarket/i.test(txt), mentionsKalshi:/Kalshi/i.test(txt),
    mentionsBetfair:/Betfair/i.test(txt),
    snippet: txt.slice(0,600) };
})()`);
console.log('SIGPROBE', JSON.stringify(sigProbe,null,2));
try{
  const box = await evaluate(`(function(){var c=document.querySelector('.match-card.sig-open'); if(!c) return null; var r=c.getBoundingClientRect(); return {x:r.x,y:r.y+window.scrollY,w:r.width,h:r.height};})()`);
  if(box){ const shot2=await c.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:Math.max(0,box.x-8),y:Math.max(0,box.y-8),width:Math.min(1400,box.w+16),height:box.h+16,scale:1}});
    fs.writeFileSync(OUT.replace(/\.png$/,'-sigopen.png'), Buffer.from(shot2.result.data,'base64')); console.log('SIGSHOT', OUT.replace(/\.png$/,'-sigopen.png')); }
}catch(e){ console.log('sigshot err', e.message); }

chrome.kill(); server.close();
process.exit(0);
