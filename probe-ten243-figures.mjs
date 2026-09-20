// TEN-243 figure-integrity check against the TEN-242 phase-2 merge.
// The sibling probe proves the five tabs PAINT. This one proves they still
// paint the RIGHT NUMBERS — the per-board fields I derived independently from
// surface-ratings.json, and the ruled Tour figures. A mount refactor that
// rewires how every tab finds its DOM is exactly the change that can leave a
// tab rendering confidently off the wrong instance's state.
import { spawn } from 'node:child_process';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const WT = '/Users/Michael/.bsp-splits-cron/ten243-wt';
const PORT = 8877;
const STUB = `(function(g){var u={emailVerified:true,email:'p@l',uid:'p'};g.BSP={currentUser:()=>u,onAuthChange:f=>{f(u);return()=>{}},ready:Promise.resolve(u),whenAuthReady:()=>Promise.resolve(u),requireAuth:()=>Promise.resolve(u),requireVerified:()=>Promise.resolve(u),isValidEmail:()=>true,updateProfile:()=>Promise.resolve(),NOTIF:{}};})(window);`;
const srv = http.createServer((q,s)=>{const u=decodeURIComponent(q.url.split('?')[0]);
 if(u==='/auth.js'){s.writeHead(200,{'content-type':'text/javascript'});return s.end(STUB);}
 const f=path.join(WT,u.replace(/^\/+/,''));
 if(!f.startsWith(WT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){s.writeHead(404);return s.end('x');}
 const e=path.extname(f);
 s.writeHead(200,{'content-type':e==='.html'?'text/html':e==='.json'?'application/json':'text/javascript'});
 fs.createReadStream(f).pipe(s);});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));

const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new','--remote-debugging-port=0','--no-first-run','--disable-gpu',
   '--window-size=1440,1400','--user-data-dir='+fs.mkdtempSync('/tmp/cdpfig-'),'about:blank'],
  {stdio:['ignore','pipe','pipe']});
const port=await new Promise((res,rej)=>{let b='';const t=setTimeout(()=>rej(new Error('no port')),20000);
 ch.stderr.on('data',d=>{b+=d;const m=/ws:\/\/127\.0\.0\.1:(\d+)\//.exec(b);if(m){clearTimeout(t);res(+m[1]);}});});
const tg=(await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t=>t.type==='page');
const ws=new WebSocket(tg.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r));
let id=0; const w=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&w.has(m.id)){w.get(m.id)(m);w.delete(m.id);}});
const send=(m,p={})=>new Promise(res=>{const i=++id;w.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,awaitPromise:true,returnByValue:true});
 if(r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description||'threw');
 return r.result?.result?.value;};
await send('Page.enable'); await send('Runtime.enable');
const errors=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);
  if(m.method==='Runtime.exceptionThrown') errors.push((m.params?.exceptionDetails?.exception?.description||'').slice(0,140));});
await send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(window,'BSP',{value:(function(){var u={emailVerified:true};return {currentUser:()=>u,onAuthChange:f=>{f(u);return()=>{}},ready:Promise.resolve(u),whenAuthReady:()=>Promise.resolve(u),requireAuth:()=>Promise.resolve(u),requireVerified:()=>Promise.resolve(u),isValidEmail:()=>true,updateProfile:()=>Promise.resolve(),NOTIF:{}};})(),writable:false,configurable:false});`});
await send('Page.navigate',{url:`http://127.0.0.1:${PORT}/bsp-consult-dashboard.html`});
const wait=async(x,l,ms=30000)=>{const t0=Date.now();for(;;){let v;try{v=await ev(x);}catch{v=null;}
 if(v)return v; if(Date.now()-t0>ms) throw new Error('timeout: '+l); await new Promise(r=>setTimeout(r,250));}};
await wait(`!!document.querySelector('[data-db-root="standalone"]')`,'boot');
await ev(`document.querySelector('[data-tab="database"]').click()`);
await wait(`(function(){var b=document.querySelector('[data-db-root="standalone"] [data-db="body"]');return b&&b.textContent.length>400;})()`,'database render');

const ROOT = `document.querySelector('[data-db-root="standalone"]')`;
const BODY = `${ROOT}.querySelector('[data-db="body"]')`;
let pass=0, fail=0;
const check=(n,ok,detail)=>{ if(ok){pass++;console.log(`  ok    ${n}${detail?'  — '+detail:''}`);}
  else {fail++;console.log(`  FAIL  ${n}  — ${detail}`);} };

// 1 · Tour figures — the founder's ruled numbers.
const tour = await ev(`(function(){var t=${BODY}.innerText;
  var m=t.match(/All\\n[\\d.]+\\n[\\d,]+\\n-?\\d+\\.\\d+%/g); return m?m.slice(0,2):null;})()`);
check('Tour band table still reports the ruled figures',
  JSON.stringify(tour)===JSON.stringify(['All\n1.44\n41,667\n-2.14%','All\n3.00\n41,667\n-5.44%']),
  JSON.stringify(tour));

// 2 · Season caption letter-spacing — the CSS regression the review caught.
const season = await ev(`(function(){var s=${BODY}.querySelector('.db-xcap .db-eyebrow');
  return s?{t:s.textContent.trim(),ls:getComputedStyle(s).letterSpacing}:null;})()`);
check('Season caption keeps its 0.14em (1.4px) — the reverted CSS regression stays reverted',
  season && season.ls==='1.4px' && season.t==='Season', JSON.stringify(season));

// 3 · Per-board fields at All/career, recomputed independently last run.
async function goRatings(){
  await ev(`(function(){var b=[].slice.call(${ROOT}.querySelectorAll('[data-db="viewtabs"] button')).filter(x=>x.dataset.dbview==='ratings')[0];b.click();return true;})()`);
  await wait(`!!${BODY}.querySelector('.db-rgrid')`,'ratings grid');
}
async function board(name){
  await ev(`(function(){var b=[].slice.call(${BODY}.querySelectorAll('.db-btabs button')).filter(x=>x.textContent.trim()===${JSON.stringify(name)})[0];b.click();return true;})()`);
  await new Promise(r=>setTimeout(r,900));
  return await ev(`(function(){var c=${BODY}.querySelector('.db-rcard');
    var g=c.querySelector('.db-rgrid'); var W=g.querySelectorAll('.db-rhead').length; var k=[].slice.call(g.children);
    return { count:c.querySelector('.db-rcount').textContent.trim(), rows:(k.length/W)-2, aligned:k.length%W===0,
             note:c.querySelector('.db-unwired').innerText.trim().split('\\n')[0] };})()`);
}
await goRatings();
const EXPECT_CAREER = {'Overview':237,'Serve':236,'Return':237,'Under pressure':236,'Mental Edge':237,'Elo':216};
for (const [b,n] of Object.entries(EXPECT_CAREER)) {
  const r = await board(b);
  const got = parseInt(String(r.count).replace(/[^\d]/g,''),10);
  check(`${b} field at All/career is ${n} (independently recomputed)`, got===n && r.aligned,
    `${r.count}, rows ${r.rows}, grid-aligned ${r.aligned}`);
}

// 4 · Clay / Last 52 — the slice the denominator bug under-reported (was 74, is 156).
await ev(`(function(){var g=${ROOT}.querySelectorAll('.db-pills')[0];
  [].slice.call(g.querySelectorAll('button')).filter(b=>b.textContent.trim()==='Clay')[0].click();return true;})()`);
await new Promise(r=>setTimeout(r,500));
await ev(`(function(){var g=${ROOT}.querySelectorAll('.db-pills')[1];
  [].slice.call(g.querySelectorAll('button')).filter(b=>b.textContent.trim()==='Last 52 weeks')[0].click();return true;})()`);
await new Promise(r=>setTimeout(r,800));
const EXPECT_CLAY = {'Overview':156,'Serve':140,'Return':141,'Under pressure':148,'Mental Edge':74};
for (const [b,n] of Object.entries(EXPECT_CLAY)) {
  const r = await board(b);
  const got = parseInt(String(r.count).replace(/[^\d]/g,''),10);
  check(`Clay/Last-52 ${b} field is ${n} (the fold-aware denominator)`, got===n, `${r.count}`);
}

// 5 · The ruled gate is still what renders: a 16-match player must still be on
//     the Mental Edge board at All/career. Option (b) would have removed him.
await ev(`(function(){var g=${ROOT}.querySelectorAll('.db-pills')[0];
  [].slice.call(g.querySelectorAll('button')).filter(b=>b.textContent.trim()==='All')[0].click();return true;})()`);
await new Promise(r=>setTimeout(r,400));
await ev(`(function(){var g=${ROOT}.querySelectorAll('.db-pills')[1];
  [].slice.call(g.querySelectorAll('button')).filter(b=>b.textContent.trim()==='Career')[0].click();return true;})()`);
await new Promise(r=>setTimeout(r,600));
await board('Mental Edge');
const top = await ev(`(function(){var g=${BODY}.querySelector('.db-rgrid');
  var W=g.querySelectorAll('.db-rhead').length; var k=[].slice.call(g.children);
  return k.slice(2*W,3*W).map(x=>x.textContent.trim());})()`);
check('ruling keep_10 still renders: the n=16 leader is ON the board, not gated out',
  top.includes('16') && /Budkov/.test(top.join(' ')), JSON.stringify(top));

// 6 · Two mounts must not corrupt each other — the ROI overlay is the new risk.
const dual = await ev(`(function(){
  var host=document.createElement('div'); host.setAttribute('data-db-root','probe'); document.body.appendChild(host);
  try { if(window.DatabaseTab && window.DatabaseTab.mount){ window.DatabaseTab.mount(host,{}); return 'mounted'; } return 'no mount api'; }
  catch(e){ return 'threw: '+e.message; }})()`);
await new Promise(r=>setTimeout(r,2500));
const afterDual = await ev(`(function(){var c=${BODY}.querySelector('.db-rcard');
  return c?c.querySelector('.db-rcount').textContent.trim():'standalone ratings card GONE';})()`);
check('a second mount does not steal the standalone tab\'s render',
  afterDual==='237 players', `second mount: ${dual}; standalone still reads "${afterDual}"`);

check('no uncaught page errors', errors.length===0, errors.join(' | ') || 'none');

console.log(`\n  ${pass} passed, ${fail} failed\n`);
ws.close(); ch.kill(); srv.close(); process.exit(fail?1:0);
