// Focused re-verify: FIX 1 (null Elo spans gap, no centre collapse) + FIX 2 (All-view
// DNA Surface Elo == header ELO, single live source). Reuses the same serve+stub harness.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
const WT = process.argv[2]; const OUTDIR = process.argv[3] || WT;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const src = fs.readFileSync(path.join(WT, 'bsp-consult-dashboard.html'), 'utf8');
const stub = `<script>window.BSP={ready:Promise.resolve(),_u:{uid:"p",name:"A",displayName:"A",email:"a@b.local",emailVerified:true},currentUser:function(){return this._u;},requireVerified:function(){return Promise.resolve(this._u);},requireAuth:function(){return Promise.resolve(this._u);},onAuthChange:function(cb){try{cb(this._u);}catch(e){}return function(){};},signOut:function(){return Promise.resolve();}};</script>`;
const marker = '<script src="./auth.js"></script>';
const previewName = '_render-dna-fix1.html';
fs.writeFileSync(path.join(WT, previewName), src.replace(marker, marker + '\n' + stub));
const types = {'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.woff':'font/woff'};
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/' + previewName; const fp = path.join(WT, p); if (!fp.startsWith(WT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, {'content-type': types[path.extname(fp)] || 'application/octet-stream'}); fs.createReadStream(fp).pipe(res); });
await new Promise(r => server.listen(0, r));
const port = server.address().port; const base = `http://127.0.0.1:${port}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = fs.mkdtempSync('/tmp/ch-fix1-'); const dport = 9200 + Math.floor(port % 300);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${profile}`,'--remote-allow-origins=*','--no-first-run','--no-default-browser-check','--hide-scrollbars','--force-device-scale-factor=1','about:blank'], {stdio:'ignore'});
async function cdpTarget(){ for(let i=0;i<60;i++){ try{ const l=await(await fetch(`http://127.0.0.1:${dport}/json`)).json(); const pg=l.find(t=>t.type==='page'); if(pg?.webSocketDebuggerUrl) return pg.webSocketDebuggerUrl;}catch{} await sleep(200);} throw new Error('no CDP');}
function clientF(ws){ const s=new WebSocket(ws); let id=0; const pend=new Map(); const ready=new Promise((res,rej)=>{s.onopen=()=>res();s.onerror=rej;}); s.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}}; const send=(mm,pp={})=>new Promise(res=>{const mid=++id;pend.set(mid,res);s.send(JSON.stringify({id:mid,method:mm,params:pp}));}); return {ready,send}; }
const c = clientF(await cdpTarget()); await c.ready;
await c.send('Page.enable'); await c.send('Runtime.enable');
await c.send('Emulation.setDeviceMetricsOverride', {width:1500, height:1100, deviceScaleFactor:1, mobile:false});
const ev = async (e) => { const r = await c.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true}); if(r.result?.exceptionDetails) throw new Error('eval threw '+JSON.stringify(r.result.exceptionDetails).slice(0,300)); return r.result?.result?.value; };
await c.send('Page.navigate', {url: `${base}/${previewName}`});
for(let i=0;i<120;i++){ const ok = await ev(`!!(window.H2HPage && document.getElementById('mainNav'))`).catch(()=>false); if(ok) break; await sleep(200); }
await ev(`(function(){var b=document.querySelector('#mainNav button[data-tab="h2h"]'); if(b)b.click(); if(window.H2HPage)window.H2HPage.ensureInit();})()`);
for(let i=0;i<120;i++){ const n = await ev(`(window.H2HPage&&window.H2HPage._debug?window.H2HPage._debug().ROSTER.length:0)`).catch(()=>0); if(n>0) break; await sleep(200); }

// Page-wide polygon read: the DNA aPoints (stroke #6aaeff) / bPoints (#e7e9ee, dashed)
// are unique on the h2h page. Report vertex count, whether any vertex is at the centre
// (150,150), and the Surface Elo readout cell + header ELO chip.
const RB = `(function(){
  var page=document.querySelector('.tabpage[data-page="h2h"]');
  function poly(stroke){ var el=[...page.querySelectorAll('svg polygon')].find(function(p){ return (p.getAttribute('stroke')||'').toLowerCase()===stroke; });
    if(!el) return null; var pts=(el.getAttribute('points')||'').trim().split(/\\s+/).filter(Boolean);
    return { n:pts.length, atCenter: pts.filter(function(s){return s==='150.0,150.0';}).length, pts:pts }; }
  var rows=[...page.querySelectorAll('div')].filter(function(d){return d.style&&d.style.gridTemplateColumns&&/minmax\\(120px/.test(d.style.gridTemplateColumns);}).map(function(r){var bigs=[...r.querySelectorAll('span')].filter(function(s){return s.style.fontSize==='13px';}); var lbl=([...r.querySelectorAll('span')].find(function(s){return s.style.textAlign==='center';})||{}).textContent||''; return {label:(lbl||'').trim(),aRaw:(bigs[0]||{}).textContent||'',bRaw:(bigs[1]||{}).textContent||''};});
  var elo=[...page.querySelectorAll('span')].filter(function(s){return /^ELO\\b/.test((s.textContent||'').trim());}).map(function(s){return (s.textContent||'').replace(/\\s+/g,' ').trim();});
  var scope=([...page.querySelectorAll('span')].find(function(s){return /percentile vs the api-tennis/.test(s.textContent||'');})||{}).textContent||'';
  return { aPoly:poly('#6aaeff'), bPoly:poly('#e7e9ee'), eloRow: rows.find(function(x){return /Surface Elo/i.test(x.label);}), headerElo:elo, scope:scope.trim() };
})()`;
async function waitReady(){ for(let i=0;i<40;i++){ const r=await ev(RB).catch(()=>null); if(r && r.eloRow) return r; await sleep(250); } return await ev(RB); }
function pair(a,b){ return ev(`window.H2HPage._selftest(${JSON.stringify(a)},${JSON.stringify(b)})`); }
function surf(s){ return ev(`(function(){var st=window.H2HPage._debug().state; st.ctxSurface=${JSON.stringify(s)}; window.H2HPage.render(); return st.ctxSurface;})()`); }
async function shot(name){ const d=await ev(`({h:Math.max(document.body.scrollHeight,document.documentElement.scrollHeight)})`); await c.send('Emulation.setDeviceMetricsOverride',{width:1500,height:Math.min(4000,d.h),deviceScaleFactor:1,mobile:false}); await sleep(150); const s=await c.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:1500,height:Math.min(4000,d.h),scale:1}}); const png=path.join(OUTDIR,name); fs.writeFileSync(png,Buffer.from(s.result.data,'base64')); await c.send('Emulation.setDeviceMetricsOverride',{width:1500,height:1100,deviceScaleFactor:1,mobile:false}); return png; }

const OUT={};
await pair('J. Sinner','D. Schwartzman'); await sleep(300);
// FIX 1 on Clay — Schwartzman has 12 clay matches (>=10) but NO clay Elo -> null spoke
await surf('Clay'); await sleep(300);
OUT.schwartzman_clay = await waitReady();
OUT.schwartzman_clay.png = await shot('fix1-schwartzman-clay.png');
// FIX 1 on All — Schwartzman 20 matches, null Elo
await surf('All'); await sleep(300);
OUT.schwartzman_all = await waitReady();
OUT.schwartzman_all.png = await shot('fix1-schwartzman-all.png');
// FIX 2 on All — Sinner vs Alcaraz: DNA Surface Elo must equal header ELO (2322/2147)
await pair('J. Sinner','C. Alcaraz'); await sleep(300);
await surf('All'); await sleep(300);
OUT.alcaraz_all = await waitReady();
OUT.alcaraz_all.png = await shot('fix2-sinner-alcaraz-all.png');

console.log('RESULT_JSON_START');
console.log(JSON.stringify(OUT,null,2));
console.log('RESULT_JSON_END');
chrome.kill(); server.close(); try{fs.unlinkSync(path.join(WT,previewName));}catch(_){}
process.exit(0);
