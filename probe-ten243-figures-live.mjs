// TEN-243 figure-integrity check against the DEPLOYED bytes.
//
// Same assertions as probe-ten243-figures.mjs, but pointed at the live URL
// rather than a worktree served locally. That distinction is the whole point:
// the local run proves the merge is sound, this one proves what the founder is
// actually looking at is sound. Between the two sits the pipeline's own copy
// step, its credential injection and the Pages CDN — none of which a local
// server exercises.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const URL = 'https://michaeldk1996.github.io/SAAS/bsp-consult-dashboard.html';
// Chrome's path is an env var so this can run somewhere other than one laptop.
// Defaults to the macOS install so a local run needs no setup; CI sets CHROME_BIN
// to the runner's `google-chrome`. Hard-coding the macOS path is the single
// reason this probe could only ever run on the machine that wrote it.
const CHROME_BIN = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ch = spawn(CHROME_BIN,
  ['--headless=new','--remote-debugging-port=0','--no-first-run','--disable-gpu',
   '--window-size=1440,1400','--user-data-dir='+fs.mkdtempSync('/tmp/cdplive-'),'about:blank'],
  {stdio:['ignore','pipe','pipe']});
const port = await new Promise((res,rej)=>{let b='';const t=setTimeout(()=>rej(new Error('no port')),20000);
  ch.stderr.on('data',d=>{b+=d;const m=/ws:\/\/127\.0\.0\.1:(\d+)\//.exec(b);if(m){clearTimeout(t);res(+m[1]);}});});
const tg = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t=>t.type==='page');
const ws = new WebSocket(tg.webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r));
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
// The live dashboard is requireVerified-gated; without this it navigates to
// auth.html mid-render and the board reads as "never built".
// A SETTER, not a frozen value. auth.js:585 does `global.BSP = BSP`; defining
// BSP as non-writable makes that assignment throw, and the probe then reports
// its own TypeError as a page error. Accept the real object and neuter only the
// two auth gates that would navigate us away.
await send('Page.addScriptToEvaluateOnNewDocument',{source:`(function(){var v;var u={emailVerified:true,email:'p@l',uid:'p'};
  Object.defineProperty(window,'BSP',{configurable:true,
    get:function(){return v;},
    set:function(o){ if(o&&typeof o==='object'){ o.requireVerified=function(){return Promise.resolve(u);}; o.requireAuth=function(){return Promise.resolve(u);}; } v=o; }});
  window.BSP={currentUser:function(){return u;},onAuthChange:function(f){f(u);return function(){};},ready:Promise.resolve(u),whenAuthReady:function(){return Promise.resolve(u);},requireAuth:function(){return Promise.resolve(u);},requireVerified:function(){return Promise.resolve(u);},isValidEmail:function(){return true;},updateProfile:function(){return Promise.resolve();},NOTIF:{}};
})();`});
await send('Page.navigate',{url:URL});
const wait=async(x,l,ms=45000)=>{const t0=Date.now();for(;;){let v;try{v=await ev(x);}catch{v=null;}
  if(v)return v; if(Date.now()-t0>ms) throw new Error('timeout: '+l); await new Promise(r=>setTimeout(r,300));}};
await wait(`!!document.querySelector('[data-db-root="standalone"]')`,'boot (live bytes carry the mount refactor)');
await ev(`document.querySelector('[data-tab="database"]').click()`);
await wait(`(function(){var b=document.querySelector('[data-db-root="standalone"] [data-db="body"]');return b&&b.textContent.length>400;})()`,'database render');

const ROOT=`document.querySelector('[data-db-root="standalone"]')`;
const BODY=`${ROOT}.querySelector('[data-db="body"]')`;
let pass=0,fail=0;
const check=(n,ok,d)=>{ if(ok){pass++;console.log(`  ok    ${n}${d?'  — '+d:''}`);} else {fail++;console.log(`  FAIL  ${n}  — ${d}`);} };

console.log(`\nTEN-243 figure integrity — DEPLOYED bytes (${URL})\n`);

const tabs = await ev(`[].slice.call(${ROOT}.querySelectorAll('[data-db="viewtabs"] button')).map(b=>b.textContent.trim())`);
check('five tabs, specced order, singular labels',
  JSON.stringify(tabs)===JSON.stringify(['Tour','Tournament','Player','Ratings','Lines']), tabs.join(' · '));

const tour = await ev(`(function(){var t=${BODY}.innerText;
  var m=t.match(/All\\n[\\d.]+\\n[\\d,]+\\n-?\\d+\\.\\d+%/g); return m?m.slice(0,2):null;})()`);
// ── BASELINE MOVED 2026-09-20, AND HERE IS THE AUTHORITY, because a probe that
//    quietly adopts new numbers is indistinguishable from one hiding a regression.
//
//    This probe asserted Tour -2.14% / -5.44% over 41,667 with the caption
//    "Season". All three moved, and BOTH changes are RULED, not drift:
//
//      * gate 33f71aab (TEN-242, answered 2026-09-20T01:26:07Z)
//          axis   -> `index`  : the curve plots by MATCH INDEX; the caption is
//                               "Season · match index". The question was titled
//                               "the chart axis (which reverses your own ruling)"
//                               and the `keep` option was offered and declined.
//          retire -> `void`   : retirements are voided rather than settled, as a
//                               book does. 41,667 -> 40,389 rows (-1,278;
//                               1,837 archive-wide), fav -2.14% -> -1.74%,
//                               dog -5.44% -> -6.94%.
//      * gate efdce201 (TEN-246, answered 2026-09-20) re-confirmed both after I
//        wrongly reported them as an unauthorised regression: `index_stands`,
//        `void_stands`.
//
//    I held this probe RED across two heartbeats rather than re-baseline it on
//    my own reading. It is being updated now because the founder ruled, not
//    because it was inconvenient. If these numbers move again WITHOUT a gate id
//    you can point at, that is a regression - do not repeat what I nearly did
//    and assume the page is right because the probe is loud.
check('Tour band table reports the RULED figures (gate 33f71aab: retirements voided)',
  JSON.stringify(tour)===JSON.stringify(['All\n1.44\n40,389\n-1.74%','All\n3.00\n40,389\n-6.94%']), JSON.stringify(tour));

const season = await ev(`(function(){var s=${BODY}.querySelector('.db-xcap .db-eyebrow');
  return s?{t:s.textContent.trim(),ls:getComputedStyle(s).letterSpacing}:null;})()`);
check('caption is the RULED "Season · match index" at 0.14em (gate 33f71aab: axis=index)', season && season.ls==='1.4px' && season.t==='Season · match index', JSON.stringify(season));

const overrides = await ev(`(function(){var h=document.documentElement.innerHTML;
  return {soft:h.indexOf('SOFT_GATE=100')>=0, hard:h.indexOf('HARD_GATE=30')>=0, pz:h.indexOf('PLAYER_ZERO_IN_DOMAIN=false')>=0};})()`);
check('the three spec overrides are in the served bytes',
  overrides.soft&&overrides.hard&&overrides.pz, JSON.stringify(overrides));

async function goRatings(){
  await ev(`(function(){var b=[].slice.call(${ROOT}.querySelectorAll('[data-db="viewtabs"] button')).filter(x=>x.dataset.dbview==='ratings')[0];b.click();return true;})()`);
  await wait(`!!${BODY}.querySelector('.db-rgrid')`,'ratings grid');
}
async function board(name){
  await ev(`(function(){var b=[].slice.call(${BODY}.querySelectorAll('.db-btabs button')).filter(x=>x.textContent.trim()===${JSON.stringify(name)})[0];b.click();return true;})()`);
  await new Promise(r=>setTimeout(r,1000));
  return await ev(`(function(){var c=${BODY}.querySelector('.db-rcard');var g=c.querySelector('.db-rgrid');
    var W=g.querySelectorAll('.db-rhead').length; var k=[].slice.call(g.children);
    return {count:c.querySelector('.db-rcount').textContent.trim(), rows:(k.length/W)-2, aligned:k.length%W===0};})()`);
}
await goRatings();
for (const [b,n] of Object.entries({'Overview':237,'Serve':236,'Return':237,'Under pressure':236,'Mental Edge':237,'Elo':216})) {
  const r = await board(b);
  const got = parseInt(String(r.count).replace(/[^\d]/g,''),10);
  check(`${b} field at All/career is ${n}`, got===n && r.aligned, `${r.count}, grid-aligned ${r.aligned}`);
}

await ev(`(function(){var g=${ROOT}.querySelectorAll('.db-pills')[0];
  [].slice.call(g.querySelectorAll('button')).filter(b=>b.textContent.trim()==='Clay')[0].click();return true;})()`);
await new Promise(r=>setTimeout(r,600));
await ev(`(function(){var g=${ROOT}.querySelectorAll('.db-pills')[1];
  [].slice.call(g.querySelectorAll('button')).filter(b=>b.textContent.trim()==='Last 52 weeks')[0].click();return true;})()`);
await new Promise(r=>setTimeout(r,900));
for (const [b,n] of Object.entries({'Overview':156,'Serve':140,'Return':141,'Under pressure':148,'Mental Edge':74})) {
  const r = await board(b);
  const got = parseInt(String(r.count).replace(/[^\d]/g,''),10);
  check(`Clay/Last-52 ${b} field is ${n}`, got===n, r.count);
}

await ev(`(function(){var g=${ROOT}.querySelectorAll('.db-pills')[0];
  [].slice.call(g.querySelectorAll('button')).filter(b=>b.textContent.trim()==='All')[0].click();return true;})()`);
await new Promise(r=>setTimeout(r,400));
await ev(`(function(){var g=${ROOT}.querySelectorAll('.db-pills')[1];
  [].slice.call(g.querySelectorAll('button')).filter(b=>b.textContent.trim()==='Career')[0].click();return true;})()`);
await new Promise(r=>setTimeout(r,700));
await board('Mental Edge');
const top = await ev(`(function(){var g=${BODY}.querySelector('.db-rgrid');
  var W=g.querySelectorAll('.db-rhead').length;var k=[].slice.call(g.children);
  return k.slice(2*W,3*W).map(x=>x.textContent.trim());})()`);
check('ruling keep_10 RENDERS: the n=16 leader is on the board',
  top.includes('16') && /Budkov/.test(top.join(' ')), JSON.stringify(top));

const unwired = await ev(`${BODY}.querySelector('.db-unwired').innerText.trim()`);
check('Mental Edge names its unwired columns', /5TH%/.test(unwired)&&/FIN%/.test(unwired)&&/DSTB%/.test(unwired),
  unwired.split('\n').pop().slice(0,90));

await ev(`(function(){var b=[].slice.call(${ROOT}.querySelectorAll('[data-db="viewtabs"] button')).filter(x=>x.dataset.dbview==='lines')[0];b.click();return true;})()`);
await new Promise(r=>setTimeout(r,800));
// Read the WHOLE tab, not a 150-char head — the not-wired note follows the
// description, so a short slice fails on text that is present.
const lines = await ev(`${BODY}.innerText.trim()`);
check('Lines states it is not wired and names the blocker',
  /not wired/i.test(lines) && /TEN-244/.test(lines),
  lines.replace(/\s+/g,' ').slice(0,110));

check('no uncaught page errors', errors.length===0, errors.join(' | ')||'none');

console.log(`\n  ${pass} passed, ${fail} failed\n`);
ws.close(); ch.kill(); process.exit(fail?1:0);
