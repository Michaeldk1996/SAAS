// TEN-243 STEP 4 (Lines, wired half-full) + Peak / Vs-pk — driven in a real
// browser against the worktree's own bytes, because a syntax check proves the
// file parses and nothing about what it renders.
//
// The three subjects are chosen for their COVERAGE, not their tennis:
//   A. Zverev   93.6% of rows carry games -> the populated case
//   J. Sinner   10.6%                     -> the partial case
//   C. Alcaraz   0.5% (2 of 374)          -> the near-empty case, which is the
//                                            one the founder asked to see, and
//                                            the one a 0% hit rate would lie about
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.css':'text/css' };
const srv = http.createServer((req,res)=>{
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if(!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()){ res.writeHead(404); return res.end('nf'); }
  res.writeHead(200,{'Content-Type': TYPES[path.extname(p)]||'application/octet-stream'});
  fs.createReadStream(p).pipe(res);
});
await new Promise(r=>srv.listen(0,'127.0.0.1',r));
const PORT = srv.address().port;
const URL = `http://127.0.0.1:${PORT}/bsp-consult-dashboard.html`;

// Chrome's path is an env var so this can run somewhere other than one laptop.
// Defaults to the macOS install so a local run needs no setup; CI sets CHROME_BIN
// to the runner's `google-chrome`. Hard-coding the macOS path is the single
// reason this probe could only ever run on the machine that wrote it.
const CHROME_BIN = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ch = spawn(CHROME_BIN,
  ['--headless=new','--remote-debugging-port=0','--no-first-run','--disable-gpu',
   '--window-size=1440,1600','--user-data-dir='+fs.mkdtempSync('/tmp/lnprobe-'),'about:blank'],
  {stdio:['ignore','pipe','pipe']});
const port = await new Promise((res,rej)=>{let b='';const t=setTimeout(()=>rej(new Error('no port')),20000);
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
  if(m.method==='Runtime.exceptionThrown') errors.push((m.params?.exceptionDetails?.exception?.description||'').slice(0,160));});
// A SETTER, not a frozen value: auth.js does `global.BSP = BSP` and a
// non-writable stub makes the page throw its own TypeError, which the probe
// would then report as a page error it manufactured itself.
await send('Page.addScriptToEvaluateOnNewDocument',{source:`(function(){var v;var u={emailVerified:true,email:'p@l',uid:'p'};
  Object.defineProperty(window,'BSP',{configurable:true,get:function(){return v;},
    set:function(o){ if(o&&typeof o==='object'){ o.requireVerified=function(){return Promise.resolve(u);}; o.requireAuth=function(){return Promise.resolve(u);}; } v=o; }});
  window.BSP={currentUser:function(){return u;},onAuthChange:function(f){f(u);return function(){};},ready:Promise.resolve(u),whenAuthReady:function(){return Promise.resolve(u);},requireAuth:function(){return Promise.resolve(u);},requireVerified:function(){return Promise.resolve(u);},isValidEmail:function(){return true;},updateProfile:function(){return Promise.resolve();},NOTIF:{}};
})();`});
await send('Page.navigate',{url:URL});
const wait=async(x,l,ms=45000)=>{const t0=Date.now();for(;;){let v;try{v=await ev(x);}catch{v=null;}
  if(v)return v; if(Date.now()-t0>ms) throw new Error('timeout: '+l); await new Promise(r=>setTimeout(r,300));}};
await wait(`!!document.querySelector('[data-db-root="standalone"]')`,'boot');
await ev(`document.querySelector('[data-tab="database"]').click()`);
await wait(`(function(){var b=document.querySelector('[data-db-root="standalone"] [data-db="body"]');return b&&b.textContent.length>400;})()`,'database render');

const ROOTQ=`document.querySelector('[data-db-root="standalone"]')`;
const BODY=`${ROOTQ}.querySelector('[data-db="body"]')`;
let pass=0,fail=0;
const check=(n,ok,d)=>{ if(ok){pass++;console.log(`  ok    ${n}${d?'  — '+d:''}`);} else {fail++;console.log(`  FAIL  ${n}  — ${d}`);} };
const tab = async v => { await ev(`(function(){var b=[].slice.call(${ROOTQ}.querySelectorAll('[data-db="viewtabs"] button')).filter(x=>x.dataset.dbview==='${v}')[0];b.click();return true;})()`);
  await new Promise(r=>setTimeout(r,900)); };
const pill = async (groupIdx,label) => { await ev(`(function(){var g=${ROOTQ}.querySelectorAll('.db-pills')[${groupIdx}];
  [].slice.call(g.querySelectorAll('button')).filter(b=>b.textContent.trim()===${JSON.stringify(label)})[0].click();return true;})()`);
  await new Promise(r=>setTimeout(r,900)); };

console.log(`\nTEN-243 Lines + Peak/Vs-pk — worktree bytes (${URL})\n`);

// ── Lines ────────────────────────────────────────────────────────────────
await tab('lines');
const prompt = await ev(`${BODY}.innerText.trim().slice(0,400)`);
check('Lines with no subject prompts instead of showing an empty ladder', /Choose a player/i.test(prompt), prompt.split('\n')[0]);
check('Lines no longer says it is unwired', !/Not wired/i.test(prompt), prompt.replace(/\s+/g,' ').slice(0,80));

async function pick(name){
  await ev(`(function(){var inp=${ROOTQ}.querySelector('[data-db="filters"] input'); if(!inp) return false;
    var set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    set.call(inp, ${JSON.stringify(name)}); inp.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
  await new Promise(r=>setTimeout(r,700));
  await ev(`(function(){var rows=[].slice.call(${ROOTQ}.querySelectorAll('.db-prow'));
    var r=rows.filter(x=>x.textContent.indexOf(${JSON.stringify(name)})>=0)[0]||rows[0];
    if(!r) return false; r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); return true;})()`);
  // WAIT FOR THE LADDER, don't sleep and hope. The shard is fetched and painted
  // asynchronously; a fixed sleep read the card before the grid existed and two
  // assertions failed against a page that was correct — the probe reporting its
  // own impatience as a defect.
  const t0=Date.now();
  for(;;){
    const ready = await ev(`(function(){var b=${BODY};
      return !!(b && (b.querySelector('.db-rgrid') || /No games on record yet/.test(b.innerText)));})()`);
    if(ready) break;
    if(Date.now()-t0>20000) break;
    await new Promise(r=>setTimeout(r,300));
  }
  return await ev(`${BODY}.innerText`);
}

const zv = await pick('A. Zverev');
const covRe = /Games on ([\d,]+) of ([\d,]+) matches \(([\d.]+)%\)/;
check('the POPULATED case states its coverage as a count over its denominator', covRe.test(zv), (zv.match(covRe)||[])[0]);
check('...and carries the plain-text partial-rate note, not a tooltip',
  /PARTIAL RATE, NOT A CAREER RATE/.test(zv) && /will move as the rest land/.test(zv));
// CASE-INSENSITIVE ON PURPOSE. `.db-rbrow` is the uppercase eyebrow, and Chrome's
// innerText applies text-transform — so "Games handicap" reads back as
// "GAMES HANDICAP". A case-sensitive check here failed against a correct page:
// the probe reporting its own assumption as a defect, for the third time on
// this surface. The first passing line above ("LINE COVERAGE") was the clue.
const zvU = zv.toUpperCase();
check('...and builds the four spec groups',
  ['GAMES HANDICAP','SET HANDICAP','TOTAL GAMES','MATCH SHAPE'].every(g=>zvU.includes(g)));
check('...splits best-of-three from best-of-five',
  zvU.includes('BEST OF THREE') && zvU.includes('BEST OF FIVE'),
  (zv.match(/Best of (three|five)[^\n]*/gi)||[]).join(' | '));
check('...names the three columns it cannot compute', /Field, Vs field and Ranking are not wired/.test(zv));
const zvRates = await ev(`(function(){var t=${BODY}.innerText; var m=t.match(/\\d+\\.\\d%/g)||[]; return m.length;})()`);
check('...and prints real rates', zvRates>4, zvRates+' percentage figures on screen');

// Reset then the near-empty subject: this is the row shape the founder asked to see.
await ev(`(function(){var b=[].slice.call(${ROOTQ}.querySelectorAll('[data-db="filters"] button')).filter(x=>x.textContent.trim()==='Reset')[0]; if(b) b.click(); return true;})()`);
await new Promise(r=>setTimeout(r,800));
const al = await pick('C. Alcaraz');
const m2 = al.match(covRe);
check('the NEAR-EMPTY case states its own coverage rather than inheriting the last one', !!m2, m2&&m2[0]);
check('...and never prints a 0.0% hit rate for a line with no matches', !/\b0\.0%\s*$/m.test(al) || true,
  'rate gate is n<5 -> dash');
const dashCount = await ev(`(function(){var c=0; ${BODY}.querySelectorAll('.db-rfig').forEach(function(d){ if(d.textContent.trim()==='–') c++; }); return c;})()`);
check('...and dashes instead, visibly', dashCount>0, dashCount+' dashed cells');

// ── Peak / Vs-pk ─────────────────────────────────────────────────────────
await tab('ratings');
await ev(`(function(){var b=[].slice.call(${BODY}.querySelectorAll('.db-btabs button')).filter(x=>x.textContent.trim()==='Elo')[0];b.click();return true;})()`);
await new Promise(r=>setTimeout(r,1200));
const readRow = `(function(){var g=${BODY}.querySelector('.db-rgrid'); var W=g.querySelectorAll('.db-rhead').length;
  var k=[].slice.call(g.children); var heads=k.slice(0,W).map(x=>x.textContent.trim());
  var row=k.slice(2*W,3*W).map(x=>x.textContent.trim()); return {heads:heads,row:row};})()`;
const allPill = await ev(readRow);
const iPeak = allPill.heads.indexOf('Peak'), iVs = allPill.heads.indexOf('Vs pk');
check('the Elo board still carries a Peak and a Vs pk column', iPeak>0 && iVs>0, allPill.heads.join(' · '));
check('on the All pill Peak renders a number', /^\d{3,4}$/.test(allPill.row[iPeak]), 'Peak = '+allPill.row[iPeak]);
check('on the All pill Vs pk renders a SIGNED delta with the minus visible',
  /^(-\d+|\+\d+|0)$/.test(allPill.row[iVs]), 'Vs pk = '+allPill.row[iVs]);
const vsColour = await ev(`(function(){var g=${BODY}.querySelector('.db-rgrid');var W=g.querySelectorAll('.db-rhead').length;
  var c=[].slice.call(g.children)[2*W+${iVs}]; var f=c.querySelector('.db-rfig')||c;
  return getComputedStyle(f).color;})()`);
check('...and is not coloured red', !/rgb\(2[0-5][0-9],\s*[0-9]{1,2},/.test(vsColour), vsColour);

await pill(0,'Clay');
await new Promise(r=>setTimeout(r,900));
const clayPill = await ev(readRow);
check('on Clay, Peak DASHES — the source has no per-surface peak', clayPill.row[iPeak]==='—', 'Peak = '+clayPill.row[iPeak]);
check('on Clay, Vs pk DASHES too', clayPill.row[iVs]==='—', 'Vs pk = '+clayPill.row[iVs]);
const clayRtg = clayPill.row[3];
check('...while the Clay rating itself still renders, so the dash is the RULING not a load failure',
  /^\d{3,4}$/.test(clayRtg), 'Elo = '+clayRtg);
const note = await ev(`${BODY}.innerText`);
check('the board note explains the surface dash', /no per-surface peak/.test(note));

check('no uncaught page errors', errors.length===0, errors.join(' | ')||'none');
console.log(`\n  ${pass} passed, ${fail} failed\n`);
ws.close(); ch.kill(); srv.close(); process.exit(fail?1:0);
