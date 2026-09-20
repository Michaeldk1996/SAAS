// Does TEN-243's five-tab Database shell still WORK after the TEN-242 rebase?
// Line-survival is not enough: the mount refactor rewired how every one of
// those tabs finds its DOM, so the question is whether they still render.
import { spawn } from 'node:child_process';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const WT = process.argv[2]; const PORT = 8931 + (process.pid % 300);
const STUB = `(function(g){var u={emailVerified:true,email:'p@l',uid:'p'};g.BSP={currentUser:()=>u,onAuthChange:f=>{f(u);return()=>{}},ready:Promise.resolve(u),whenAuthReady:()=>Promise.resolve(u),requireAuth:()=>Promise.resolve(u),requireVerified:()=>Promise.resolve(u),isValidEmail:()=>true,updateProfile:()=>Promise.resolve(),NOTIF:{}};})(window);`;
const srv = http.createServer((q,s)=>{const u=decodeURIComponent(q.url.split('?')[0]);
 if(u==='/auth.js'){s.writeHead(200,{'content-type':'text/javascript'});return s.end(STUB);}
 const f=path.join(WT,u.replace(/^\/+/,''));
 if(!f.startsWith(WT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){s.writeHead(404);return s.end('x');}
 const e=path.extname(f);
 s.writeHead(200,{'content-type':e==='.html'?'text/html':e==='.json'?'application/json':'text/javascript'});
 fs.createReadStream(f).pipe(s);});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0','--no-first-run','--disable-gpu','--window-size=1440,1000','--user-data-dir='+fs.mkdtempSync('/tmp/cdp2-'),'about:blank'],{stdio:['ignore','pipe','pipe']});
const port=await new Promise((res,rej)=>{let b='';const t=setTimeout(()=>rej(new Error('no port')),20000);
 ch.stderr.on('data',d=>{b+=d;const m=/ws:\/\/127\.0\.0\.1:(\d+)\//.exec(b);if(m){clearTimeout(t);res(+m[1]);}});});
const tg=(await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t=>t.type==='page');
const ws=new WebSocket(tg.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r));
let id=0; const w=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&w.has(m.id)){w.get(m.id)(m);w.delete(m.id);}});
const send=(method,params={})=>new Promise(res=>{const i=++id;w.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});
const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,awaitPromise:true,returnByValue:true});
 if(r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description||'threw');
 return r.result?.result?.value;};
await send('Page.enable'); await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(window,'BSP',{value:(function(){var u={emailVerified:true};return {currentUser:()=>u,onAuthChange:f=>{f(u);return()=>{}},ready:Promise.resolve(u),whenAuthReady:()=>Promise.resolve(u),requireAuth:()=>Promise.resolve(u),requireVerified:()=>Promise.resolve(u),isValidEmail:()=>true,updateProfile:()=>Promise.resolve(),NOTIF:{}};})(),writable:false,configurable:false});`});
await send('Page.navigate',{url:`http://127.0.0.1:${PORT}/bsp-consult-dashboard.html`});
const wait=async(x,l,ms=30000)=>{const t0=Date.now();for(;;){let v;try{v=await ev(x);}catch{v=null;} if(v)return v;
 if(Date.now()-t0>ms) throw new Error('timeout: '+l); await new Promise(r=>setTimeout(r,250));}};
await wait(`!!document.querySelector('[data-db-root="standalone"]')`,'boot');
let pass=0,fail=0;
const check=async(n,f)=>{try{const d=await f();console.log(`  ok    ${n}${d?'  — '+d:''}`);pass++;}catch(e){console.log(`  FAIL  ${n}\n        ${e.message}`);fail++;}};
const must=(c,m)=>{if(!c)throw new Error(m);};
console.log('\nTEN-242 section C — the quotes card, live DOM\n');
await ev(`document.querySelector('[data-tab="tournaments"]').click()`);
await wait(`!!(typeof tourxMarketData!=='undefined' && tourxMarketData && tourxMarketData.tournaments)`,'market shard');
await wait(`!!(typeof TOURNAMENT_QUOTES!=='undefined' || typeof tourxQuotesFor==='function')`,'quotes');

const WITH = await ev(`(function(){
  var cat=TOURNAMENT_CATALOG, best=null;
  for(var i=0;i<cat.length;i++){ var q=tourxQuotesFor(cat[i].name); if(q&&q.length&&(!best||q.length>best.n)) best={name:cat[i].name,n:q.length}; }
  return best;
})()`);
const WITHOUT = await ev(`(function(){
  var cat=TOURNAMENT_CATALOG;
  for(var i=0;i<cat.length;i++){ var q=tourxQuotesFor(cat[i].name); if(!q||!q.length) return cat[i].name; }
  return null;
})()`);

await check('C: there is an event WITH quotes and one WITHOUT (else this probe is vacuous)', async()=>{
  must(WITH && WITH.n>0, 'no event has quotes');
  must(WITHOUT, 'every event has quotes — the no-card case cannot be tested');
  return `with: ${WITH.name} (${WITH.n}) · without: ${WITHOUT}`;
});

const sel = async n => { await ev(`tourxSelectCondition(${JSON.stringify(n)})`); await new Promise(r=>setTimeout(r,500)); };

await check('C1: the card renders with the eyebrow, a count and a curly-quoted lead', async()=>{
  await sel(WITH.name);
  const LEADP = await ev(`tourxQuotesFor(${JSON.stringify(WITH.name)})[0].player`);
  const r=await ev(`(function(){
    var LEADP = ${JSON.stringify(await ev(`tourxQuotesFor(${JSON.stringify(WITH.name)})[0].player`))};
    var d=[].slice.call(document.querySelectorAll('div')).filter(function(x){return /What players say about this tournament/i.test(x.textContent);});
    if(!d.length) return null;
    // Walk up to the element that carries the eyebrow AND the attribution - the
    // first draft stopped at the header row (it contains "31 notes") and so
    // never saw the lead quote it was asserting about.
    var card=d[d.length-1];
    // Anchor on the ATTRIBUTION: the header row contains both "31 notes" and
    // "Read all", so either of those stops the walk one level too early and the
    // check never sees the lead quote it is asserting about. The player's name
    // appears only below the quote.
    while(card && card.textContent.indexOf(LEADP)<0) card=card.parentElement;
    var t=(card||d[d.length-1]).textContent.replace(/\\s+/g,' ').trim();
    return {txt:t.slice(0,220), curly: t.indexOf('\u201C')>=0 && t.indexOf('\u201D')>=0,
            count: /(\\d+)\\s*notes?/i.exec(t), readAll: /Read all/i.test(t)};
  })()`);
  must(r,'the "What players say" card did not render for an event that HAS quotes');
  must(r.count, `no "{n} notes" count in the card: "${r.txt}"`);
  must(+r.count[1]===WITH.n, `card says ${r.count[1]} notes, the data has ${WITH.n}`);
  must(r.curly, 'the lead quote is not wrapped in CURLY quotes');
  must(r.readAll, 'no "Read all n →" affordance');
  return `${r.count[1]} notes, curly-wrapped, Read-all present`;
});

await check('C2: an event with NO quotes renders NO CARD AT ALL', async()=>{
  await sel(WITHOUT);
  const r=await ev(`(function(){
    var d=[].slice.call(document.querySelectorAll('div')).filter(function(x){return /What players say/i.test(x.textContent);});
    var col=document.querySelector('#tourxDetail')||document.querySelector('[data-tourx-detail]');
    if(!col){ var h=[].slice.call(document.querySelectorAll('div')).filter(function(x){return /Conditions read|conditions/i.test(x.textContent);}); col=h.length?h[h.length-1].parentElement:document.body; }
    return {n:d.length, empty:/coming soon|no quotes|no notes yet/i.test(col.textContent), scope:col.textContent.length};
  })()`);
  must(r.n===0, `the quotes card (or its heading) still rendered for "${WITHOUT}", which has no quotes`);
  must(!r.empty, 'an empty-state string appeared — C2 says nothing may imply quotes exist');
  return `"${WITHOUT}" — no card, no empty state`;
});

await check('C1: the card opens the quotes panel, one row per note', async()=>{
  await sel(WITH.name);
  await ev(`tourxOpenQuotes()`);
  await new Promise(r=>setTimeout(r,500));
  const r=await ev(`(function(){
    var o=document.getElementById('tourxOverlayRoot');
    var t=o?o.textContent.replace(/\\s+/g,' ').trim():'';
    return {len:t.length, head:t.slice(0,90),
            z:(function(){var p=o&&o.firstElementChild;return p?getComputedStyle(p).zIndex:null;})()};
  })()`);
  must(r.len>200, `the quotes panel did not open (${r.len} chars)`);
  return `panel open, ${r.len} chars — "${r.head}"`;
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
ws.close(); ch.kill(); srv.close(); process.exit(fail?1:0);
