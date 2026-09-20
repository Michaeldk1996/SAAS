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
console.log('\nTEN-243 five-tab Database shell — still working after the TEN-242 rebase?\n');
await ev(`document.querySelector('[data-tab="database"]').click()`);
await wait(`(function(){var b=document.querySelector('[data-db-root="standalone"] [data-db="body"]');return b&&b.textContent.length>400;})()`,'database render');

await check('all FIVE TEN-243 tabs are present, in the specced order', async()=>{
  const t=await ev(`[].slice.call(document.querySelectorAll('[data-db-root="standalone"] [data-db="viewtabs"] button')).map(b=>b.textContent.trim())`);
  must(t.length===5,`expected 5 tabs, got ${t.length}: ${JSON.stringify(t)}`);
  must(JSON.stringify(t)===JSON.stringify(['Tour','Tournament','Player','Ratings','Lines']),`tab labels changed: ${JSON.stringify(t)}`);
  return t.join(' · ');
});

for (const [view,label] of [['ratings','Ratings'],['lines','Lines'],['tournaments','Tournament'],['players','Player'],['tour','Tour']]) {
  await check(`the ${label} tab still renders real content`, async()=>{
    await ev(`(function(){var b=[].slice.call(document.querySelectorAll('[data-db-root="standalone"] [data-db="viewtabs"] button')).filter(x=>x.dataset.dbview==='${view}')[0];b.click();return true;})()`);
    await new Promise(r=>setTimeout(r,1400));
    const r=await ev(`(function(){var b=document.querySelector('[data-db-root="standalone"] [data-db="body"]');
      return {len:b.textContent.length, loading:/Loading|could not be loaded|unavailable/i.test(b.textContent), head:b.textContent.replace(/\\s+/g,' ').trim().slice(0,70)};})()`);
    must(!r.loading,`the ${label} tab is stuck on a loading/error state: "${r.head}"`);
    must(r.len>300,`the ${label} tab rendered only ${r.len} chars: "${r.head}"`);
    return `${r.len} chars — "${r.head}"`;
  });
}
console.log(`\n  ${pass} passed, ${fail} failed\n`);
ws.close(); ch.kill(); srv.close(); process.exit(fail?1:0);
