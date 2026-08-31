// TEN-103 fix-pass verification — Playing Style DNA radar (H2H compare page).
// Serves the worktree, stubs the Firebase auth gate, opens the H2H tab, drives it
// via window.H2HPage._selftest / _debug, and reads back the DNA radar DOM to prove:
//   FIX 1  null Surface Elo no longer collapses to centre (Sinner vs Schwartzman)
//   FIX 2  header ELO == DNA Surface Elo (single live source)  (Sinner vs Alcaraz)
//   FIX 3  Hard/Clay/Grass toggle re-renders the radar + scope note + floor state
//   FIX 4  Δ label reads "Δ vs 2024–now avg"
// Zero installs: Node global WebSocket + system Chrome (same pattern as render-tabs).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const WT = process.argv[2];
const OUTDIR = process.argv[3] || WT;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const src = fs.readFileSync(path.join(WT, 'bsp-consult-dashboard.html'), 'utf8');
const stub = `<script>window.BSP={ready:Promise.resolve(),_u:{uid:"preview",name:"Alex Morgan",displayName:"Alex Morgan",email:"alex.morgan@stennisfy.local",emailVerified:true},currentUser:function(){return this._u;},requireVerified:function(){return Promise.resolve(this._u);},requireAuth:function(){return Promise.resolve(this._u);},onAuthChange:function(cb){try{cb(this._u);}catch(e){}return function(){};},signOut:function(){return Promise.resolve();}};</script>`;
const marker = '<script src="./auth.js"></script>';
if (!src.includes(marker)) throw new Error('auth.js marker not found');
const previewName = '_render-dna.html';
fs.writeFileSync(path.join(WT, previewName), src.replace(marker, marker + '\n' + stub));

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
const profile = fs.mkdtempSync('/tmp/ch-dna-');
const dport = 9300 + Math.floor(port % 300);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${profile}`,
  '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--force-device-scale-factor=1', 'about:blank'], {stdio:'ignore'});

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
await c.send('Emulation.setDeviceMetricsOverride', {width:1500, height:1100, deviceScaleFactor:1, mobile:false});
const evaluate = async (expr) => { const r = await c.send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true}); if(r.result?.exceptionDetails) throw new Error('eval threw '+JSON.stringify(r.result.exceptionDetails)); return r.result?.result?.value; };

await c.send('Page.navigate', {url: `${base}/${previewName}`});
// wait for the app + H2H module
for(let i=0;i<120;i++){ const ok = await evaluate(`!!(window.H2HPage && document.getElementById('mainNav'))`).catch(()=>false); if(ok) break; await sleep(200); }
// open the H2H tab
await evaluate(`(function(){var b=document.querySelector('#mainNav button[data-tab="h2h"]'); if(b) b.click(); if(window.H2HPage) window.H2HPage.ensureInit(); })()`);
// wait for roster
for(let i=0;i<120;i++){ const n = await evaluate(`(window.H2HPage && window.H2HPage._debug && window.H2HPage._debug().ROSTER && window.H2HPage._debug().ROSTER.length)||0`).catch(()=>0); if(n>0) break; await sleep(200); }

// Resolve roster short-names for our three players.
const names = await evaluate(`(function(){
  var R = window.H2HPage._debug().ROSTER, P = window.H2HPage._debug().P;
  function find(rx){ return R.find(function(k){ return rx.test(k) || rx.test((P[k]&&P[k].full)||''); }); }
  return { sinner: find(/Sinner/i), alcaraz: find(/Alcaraz/i), schwartzman: find(/Schwartzman/i) };
})()`);
console.log('NAMES', JSON.stringify(names));

// DOM read-back of the DNA card for the currently-selected pair + surface.
const readbackExpr = `(function(){
  var page = document.querySelector('.tabpage[data-page="h2h"]');
  if(!page) return {err:'no h2h page'};
  // The DNA card is the one whose header says "Playing style DNA".
  var cards = [...page.querySelectorAll('div')];
  var card = cards.find(function(d){ return /Playing style DNA/i.test(d.textContent||'') && d.querySelector('svg polygon'); });
  if(!card) return {err:'no DNA card'};
  var svg = card.querySelector('svg');
  function poly(stroke){
    var el = [...svg.querySelectorAll('polygon')].find(function(p){ return (p.getAttribute('stroke')||'').toLowerCase()===stroke; });
    if(!el) return null;
    var pts = (el.getAttribute('points')||'').trim().split(/\\s+/).filter(Boolean);
    return { n: pts.length, pts: pts, atCenter: pts.filter(function(s){ return s==='150.0,150.0'; }).length };
  }
  // readout rows: label + a-raw + b-raw (mono spans). Grid rows in the readout block.
  var readoutRows = [...card.querySelectorAll('div')].filter(function(d){
    return d.style && d.style.gridTemplateColumns && /minmax\\(120px/.test(d.style.gridTemplateColumns);
  }).map(function(r){
    var monos = [...r.querySelectorAll('span')].filter(function(s){ return /IBM Plex Mono/.test(s.style.fontFamily||''); });
    var label = ([...r.querySelectorAll('span')].find(function(s){ return /letter-spacing/.test(s.style.letterSpacing||'') || s.style.textAlign==='center'; })||{}).textContent||'';
    // first big mono = a raw, then possibly delta, then b raw
    var bigs = [...r.querySelectorAll('span')].filter(function(s){ return (s.style.fontSize==='13px'); });
    return { label: (label||'').trim(), aRaw: (bigs[0]||{}).textContent||'', bRaw: (bigs[1]||{}).textContent||'' };
  });
  var deltaLabel = ([...card.querySelectorAll('span')].find(function(s){ return /Raw rating/.test(s.textContent||''); })||{}).textContent||'';
  var scope = ([...card.querySelectorAll('span')].find(function(s){ return /percentile vs the api-tennis/.test(s.textContent||''); })||{}).textContent||'';
  var withheld = [...card.querySelectorAll('span')].filter(function(s){ return /shape withheld|No api-tennis rating/.test(s.textContent||''); }).map(function(s){ return (s.textContent||'').trim(); });
  return { aPoly: poly('#6aaeff'), bPoly: poly('#e7e9ee'), readout: readoutRows, deltaLabel:deltaLabel.trim(), scope:scope.trim(), withheld:withheld };
})()`;

const headerEloExpr = `(function(){
  var page = document.querySelector('.tabpage[data-page="h2h"]');
  var chips = [...page.querySelectorAll('span')].filter(function(s){ return /^ELO\\b/.test((s.textContent||'').trim()); });
  return chips.map(function(s){ return (s.textContent||'').replace(/\\s+/g,' ').trim(); });
})()`;

async function waitDna(){
  for(let i=0;i<40;i++){
    const has = await evaluate(readbackExpr).catch(e=>({err:String(e).slice(0,120)}));
    if(has && !has.err && has.readout && has.readout.length>=5) return has;
    await sleep(250);
  }
  return await evaluate(readbackExpr).catch(e=>({err:String(e).slice(0,200)}));
}
const log = (...a)=>console.log('['+(Date.now()-T0)+'ms]', ...a);
const T0 = Date.now();

function setPair(a,b){ return evaluate(`(function(){ window.H2HPage._selftest(${JSON.stringify(a)}, ${JSON.stringify(b)}); return true; })()`); }
function setSurface(s){ return evaluate(`(function(){ var st=window.H2HPage._debug().state; st.ctxSurface=${JSON.stringify(s)}; window.H2HPage.render(); return st.ctxSurface; })()`); }

async function shot(name){
  const dims = await evaluate(`({h:Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)})`);
  await c.send('Emulation.setDeviceMetricsOverride', {width:1500, height:Math.min(4000,dims.h), deviceScaleFactor:1, mobile:false});
  await sleep(150);
  const s = await c.send('Page.captureScreenshot', {format:'png', captureBeyondViewport:true, clip:{x:0,y:0,width:1500,height:Math.min(4000,dims.h),scale:1}});
  const png = path.join(OUTDIR, name);
  fs.writeFileSync(png, Buffer.from(s.result.data,'base64'));
  await c.send('Emulation.setDeviceMetricsOverride', {width:1500, height:1100, deviceScaleFactor:1, mobile:false});
  return png;
}

const OUT = {};

// ---- (1) Sinner vs Schwartzman (default surface = Hard) ----
log("pair1 set"); await setPair(names.sinner, names.schwartzman); await sleep(400);
let rb = await waitDna(); log("pair1 readback", rb.err||(rb.readout&&rb.readout.length));
let hdr = await evaluate(headerEloExpr);
OUT.sinner_schwartzman = { surface: await evaluate(`window.H2HPage._debug().state.ctxSurface`), readback: rb, headerElo: hdr };
OUT.sinner_schwartzman.png = await shot('dna-sinner-schwartzman.png');

// ---- (2) Sinner vs Alcaraz — Elo reconciliation ----
log("pair2 set"); await setPair(names.sinner, names.alcaraz); await sleep(300);
// use All surface? page default is Hard; also capture All by temporarily setting to Hard (header ELO is all-surface).
rb = await waitDna();
hdr = await evaluate(headerEloExpr);
OUT.sinner_alcaraz = { surface: await evaluate(`window.H2HPage._debug().state.ctxSurface`), readback: rb, headerElo: hdr };
OUT.sinner_alcaraz.png = await shot('dna-sinner-alcaraz.png');

// ---- (3) Surface switch Hard -> Clay -> Grass on Sinner vs Alcaraz ----
OUT.surfaceSwitch = {};
log("surface loop"); for (const surf of ['Hard','Clay','Grass']){
  await setSurface(surf); await sleep(300);
  const r = await waitDna();
  OUT.surfaceSwitch[surf] = { scope: r.scope, aPolyN: r.aPoly&&r.aPoly.n, bPolyN: r.bPoly&&r.bPoly.n,
    eloRow: (r.readout||[]).find(x=>/Surface Elo/i.test(x.label)) || null, withheld: r.withheld };
  OUT.surfaceSwitch[surf].png = await shot('dna-surface-'+surf+'.png');
}

// ---- extra: grass thin-player floor demonstration (Sinner vs Schwartzman on Grass) ----
await setPair(names.sinner, names.schwartzman); await sleep(200);
await setSurface('Grass'); await sleep(300);
const grassThin = await waitDna();
OUT.grassThin = { scope: grassThin.scope, aPoly: grassThin.aPoly, bPoly: grassThin.bPoly, withheld: grassThin.withheld };
OUT.grassThin.png = await shot('dna-grass-thin.png');

console.log('RESULT_JSON_START');
console.log(JSON.stringify(OUT, null, 2));
console.log('RESULT_JSON_END');

chrome.kill(); server.close();
try { fs.unlinkSync(path.join(WT, previewName)); } catch(_){}
process.exit(0);
