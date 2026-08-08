// Verify the date-rail paging arrows (founder task 2026-08-08): both arrows on both
// rails, one-day-per-press stepping, and correct active/disabled edges.
// Walk (from founder's spec):
//   Results: from Today → press left 3× (window steps back one day each press; left
//     disables at daymin3) → press right 3× (walks forward; right disables at today).
//   Matches: left disables at yesterday (leftmost), right disables at +2 (day2).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const WT = process.argv[2];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const src = fs.readFileSync(path.join(WT, 'bsp-consult-dashboard.html'), 'utf8');
const stub = `<script>window.BSP={ready:Promise.resolve(),_u:{uid:"preview",name:"Alex Morgan",displayName:"Alex Morgan",email:"alex.morgan@stennisfy.local",emailVerified:true},currentUser:function(){return this._u;},requireVerified:function(){return Promise.resolve(this._u);},requireAuth:function(){return Promise.resolve(this._u);},onAuthChange:function(cb){try{cb(this._u);}catch(e){}return function(){};},signOut:function(){return Promise.resolve();}};</script>`;
const marker = '<script src="./auth.js"></script>';
if (!src.includes(marker)) throw new Error('auth.js marker not found');
const previewName = '_render-railarrows.html';
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
const profile = fs.mkdtempSync('/tmp/ch-railarrows-');
const dport = 9300 + Math.floor(port % 300);
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

// Snapshot: active day, arrow disabled-state (class + computed cursor/opacity), visible tabs
const snap = `(function(){
  var L=document.getElementById('dayTabsLeft'), R=document.getElementById('dayTabsRight');
  var cs=function(el){var s=getComputedStyle(el);return {disp:s.display,cursor:s.cursor,op:+(+s.opacity).toFixed(2),pe:s.pointerEvents};};
  var vis=[].slice.call(document.querySelectorAll('#dayTabs button[data-day]')).filter(function(b){return b.style.display!=='none';}).map(function(b){return b.dataset.day;});
  var act=(document.querySelector('#dayTabs button.active')||{}).dataset;
  return {active:act?act.day:null, visible:vis,
    left:{shown:cs(L).disp!=='none', disabled:L.classList.contains('is-disabled'), aria:L.getAttribute('aria-disabled'), cursor:cs(L).cursor, op:cs(L).op, pe:cs(L).pe},
    right:{shown:cs(R).disp!=='none', disabled:R.classList.contains('is-disabled'), aria:R.getAttribute('aria-disabled'), cursor:cs(R).cursor, op:cs(R).op, pe:cs(R).pe}};
})()`;
const clickL = `document.getElementById('dayTabsLeft').click()`;
const clickR = `document.getElementById('dayTabsRight').click()`;

await c.send('Page.navigate', {url: `${base}/${previewName}#/matches`});
for(let i=0;i<100;i++){ const n = await evaluate(`document.querySelectorAll('.match-card').length`).catch(()=>0); if(n>0) break; await sleep(200); }

const results = { RESULTS: [], MATCHES: [] };
// ---- RESULTS rail ----
await evaluate(`document.querySelector('#mainNav button[data-tab="results"]').click()`); await sleep(250);
results.RESULTS.push(['initial', await evaluate(snap)]);
for (let i=1;i<=3;i++){ await evaluate(clickL); await sleep(120); results.RESULTS.push([`left#${i}`, await evaluate(snap)]); }
await evaluate(clickL); await sleep(120); results.RESULTS.push(['left#4(noop)', await evaluate(snap)]);
for (let i=1;i<=3;i++){ await evaluate(clickR); await sleep(120); results.RESULTS.push([`right#${i}`, await evaluate(snap)]); }
await evaluate(clickR); await sleep(120); results.RESULTS.push(['right#4(noop)', await evaluate(snap)]);
// ---- MATCHES rail ----
await evaluate(`document.querySelector('#mainNav button[data-tab="matches"]').click()`); await sleep(250);
results.MATCHES.push(['initial(today)', await evaluate(snap)]);
await evaluate(clickL); await sleep(120); results.MATCHES.push(['left#1', await evaluate(snap)]);
await evaluate(clickL); await sleep(120); results.MATCHES.push(['left#2(noop@yesterday)', await evaluate(snap)]);
for (let i=1;i<=3;i++){ await evaluate(clickR); await sleep(120); results.MATCHES.push([`right#${i}`, await evaluate(snap)]); }
await evaluate(clickR); await sleep(120); results.MATCHES.push(['right#4(noop@day2)', await evaluate(snap)]);

console.log(JSON.stringify(results, null, 2));

// ---- assertions ----
const fails = [];
const ck = (cond, msg) => { if (!cond) fails.push(msg); };
const R = Object.fromEntries(results.RESULTS);
const M = Object.fromEntries(results.MATCHES);
// Results: initial today -> right disabled, left active
ck(R['initial'].active==='today', 'RESULTS initial active should be today, got '+R['initial'].active);
ck(R['initial'].left.shown && R['initial'].right.shown, 'RESULTS both arrows must render');
ck(R['initial'].right.disabled===true && R['initial'].left.disabled===false, 'RESULTS initial: right disabled, left active');
ck(JSON.stringify(R['left#1'].active)==='"yesterday"', 'RESULTS left#1 -> yesterday, got '+R['left#1'].active);
ck(R['left#2'].active==='daymin2', 'RESULTS left#2 -> daymin2, got '+R['left#2'].active);
ck(R['left#3'].active==='daymin3', 'RESULTS left#3 -> daymin3, got '+R['left#3'].active);
ck(R['left#3'].left.disabled===true, 'RESULTS left disables at daymin3');
ck(R['left#4(noop)'].active==='daymin3', 'RESULTS left beyond limit is a no-op');
ck(R['right#1'].active==='daymin2' && R['right#2'].active==='yesterday' && R['right#3'].active==='today', 'RESULTS right walks daymin2->yesterday->today');
ck(R['right#3'].right.disabled===true, 'RESULTS right disables at today');
ck(R['right#4(noop)'].active==='today', 'RESULTS right beyond today is a no-op');
// disabled visuals distinct from active
ck(R['initial'].right.op < 0.6 && R['initial'].right.cursor==='default' && R['initial'].right.pe==='none', 'RESULTS disabled arrow is muted/no-cursor/no-pointer-events');
ck(R['initial'].left.op > 0.6 && R['initial'].left.cursor==='pointer', 'RESULTS active arrow is full-opacity/pointer');
// Matches: initial today
ck(M['initial(today)'].active==='today', 'MATCHES initial active today');
ck(M['initial(today)'].left.shown && M['initial(today)'].right.shown, 'MATCHES both arrows render');
ck(M['left#1'].active==='yesterday' && M['left#1'].left.disabled===true, 'MATCHES left#1 -> yesterday, left disables (leftmost)');
ck(M['left#2(noop@yesterday)'].active==='yesterday', 'MATCHES left beyond yesterday no-op');
ck(M['right#1'].active==='today' && M['right#2'].active==='tomorrow' && M['right#3'].active==='day2', 'MATCHES right walks today->tomorrow->day2');
ck(M['right#3'].right.disabled===true, 'MATCHES right disables at +2 (day2)');
ck(M['right#4(noop@day2)'].active==='day2', 'MATCHES right beyond +2 no-op');

if (fails.length){ console.error('\nFAILURES:\n - '+fails.join('\n - ')); } else { console.error('\nALL CHECKS PASSED'); }

chrome.kill(); server.close();
try { fs.unlinkSync(path.join(WT, previewName)); } catch {}
process.exit(fails.length ? 1 : 0);
