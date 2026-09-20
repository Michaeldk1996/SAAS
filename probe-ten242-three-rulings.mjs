import { spawn } from 'node:child_process'; import fs from 'node:fs';
const URL='https://michaeldk1996.github.io/SAAS/bsp-consult-dashboard.html';
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0','--no-first-run','--disable-gpu','--window-size=1500,1150','--user-data-dir='+fs.mkdtempSync('/tmp/cdpL3-'),'about:blank'],{stdio:['ignore','pipe','pipe']});
const port=await new Promise((res,rej)=>{let b='';const t=setTimeout(()=>rej(new Error('no port')),20000);
 ch.stderr.on('data',d=>{b+=d;const m=/ws:\/\/127\.0\.0\.1:(\d+)\//.exec(b);if(m){clearTimeout(t);res(+m[1]);}});});
const tg=(await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t=>t.type==='page');
const ws=new WebSocket(tg.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r));
let id=0; const w=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&w.has(m.id)){w.get(m.id)(m);w.delete(m.id);}});
const send=(m,p={})=>new Promise(res=>{const i=++id;w.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,awaitPromise:true,returnByValue:true});
 if(r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description||'threw'); return r.result?.result?.value;};
await send('Page.enable'); await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(window,'BSP',{value:(function(){var u={emailVerified:true};return {currentUser:()=>u,onAuthChange:f=>{f(u);return()=>{}},ready:Promise.resolve(u),whenAuthReady:()=>Promise.resolve(u),requireAuth:()=>Promise.resolve(u),requireVerified:()=>Promise.resolve(u),isValidEmail:()=>true,updateProfile:()=>Promise.resolve(),NOTIF:{}};})(),writable:false,configurable:false});`});
await send('Page.navigate',{url:URL}); await new Promise(r=>setTimeout(r,5000));
let pass=0,fail=0;
const check=async(n,f)=>{try{const d=await f();console.log(`  ok    ${n}${d?'  — '+d:''}`);pass++;}catch(e){console.log(`  FAIL  ${n}\n        ${e.message}`);fail++;}};
const must=(c,m)=>{if(!c)throw new Error(m);};
const bi=await ev(`fetch('build-info.json').then(r=>r.json())`);
console.log(`\nTEN-242 three rulings — DEPLOYED page, run ${bi.runNumber}, ${bi.builtAt}\n`);

await check('3: the deployed store has retirements VOIDED',async()=>{
  const y=await ev(`fetch('database-yield.json').then(r=>r.json()).then(j=>({used:j.meta.used,ex:j.meta.exclusions}))`);
  must(y.ex.retired>0,`meta.exclusions.retired missing — the deployed store still settles retirements`);
  must(y.used===40389,`store has ${y.used} rows, expected 40,389`);
  return `used ${y.used}, retired ${y.ex.retired} voided`;
});
await check('3: the deployed CARDS moved with it',async()=>{
  const m=await ev(`fetch('tournament-market.json').then(r=>r.json()).then(j=>j.baseline)`);
  must(m.n===40389,`baseline n=${m.n}`);
  must(Math.abs(m.roiFav-(-1.7))<0.05 && Math.abs(m.roiDog-(-6.9))<0.05,`roiFav ${m.roiFav} roiDog ${m.roiDog}`);
  return `n ${m.n}, roiFav ${m.roiFav}%, roiDog ${m.roiDog}%`;
});
await ev(`document.querySelector('[data-tab="database"]').click()`); await new Promise(r=>setTimeout(r,3000));
await ev(`(function(){var h=document.createElement('div');h.setAttribute('data-db-root','live');h.setAttribute('data-page','database');h.className='pagewrap';
  h.innerHTML=document.querySelector('[data-db-root="standalone"]').innerHTML;document.body.appendChild(h);
  window.DatabaseTab.mount(h,{hideHeader:true,lockSubject:true,initialTournamentNames:['Australian Open'],initialTournamentLabel:'Australian Open'});return true;})()`);
await new Promise(r=>setTimeout(r,3000));
await check('2: the live curve is on a MATCH INDEX axis (ticks match the index, not the calendar)',async()=>{
  // The first version of this check asserted the tick gaps were NON-uniform.
  // That was a bad assertion: the Australian Open plays a fixed 128-draw every
  // year, so its seasons are near-equal in MATCH COUNT as well as in time and
  // both axes put the ticks in nearly the same place (0.7pp spread either way).
  // The direct check is to recompute both candidate positions from the deployed
  // store and see which one the page actually drew.
  const r=await ev(`(async function(){
    var y = await fetch('database-yield.json').then(function(r){return r.json();});
    var ix = y.meta.tournaments.indexOf('Australian Open');
    var rows = y.rows.filter(function(r){return r[4]===ix;});
    var n = rows.length;
    var yrOf = function(d){ return Math.floor(d/10000); };
    // INDEX position of each season's first row
    var firstIdx = {}, order = [];
    rows.forEach(function(r,i){ var s=yrOf(r[0]); if(!(s in firstIdx)){ firstIdx[s]=i; order.push(s); } });
    // CALENDAR position of each season's 1 Jan, on the old d0/span domain
    var d0 = Date.UTC(yrOf(rows[0][0]),0,1)/86400000;
    var dnum = function(di){ var s=''+di; return Date.UTC(+s.slice(0,4),(+s.slice(4,6))-1,+s.slice(6,8))/86400000; };
    var span = dnum(rows[n-1][0]) - d0;
    var out = {};
    order.forEach(function(s){
      out[s] = { index: firstIdx[s]/(n-1)*100, calendar: (Date.UTC(s,0,1)/86400000 - d0)/span*100 };
    });
    return {n:n, expect:out};
  })()`);
  const rendered=await ev(`(function(){var root=document.querySelector('[data-db-root="live"]');
    var x=root.querySelector('.db-xaxis'), c=root.querySelector('.db-xcap');
    var o={}; if(x) [].slice.call(x.children).forEach(function(d){ o[d.textContent.trim()]=parseFloat(d.style.left); });
    return {ticks:o, cap:c?c.textContent.trim():null};})()`);
  must(/match index/i.test(rendered.cap||''),`caption is "${rendered.cap}"`);
  let idxErr=0, calErr=0, shown=[];
  for(const [season,pos] of Object.entries(rendered.ticks)){
    const e=r.expect[season]; if(!e) continue;
    idxErr += Math.abs(pos-e.index); calErr += Math.abs(pos-e.calendar);
    shown.push(`${season} drawn ${pos.toFixed(1)} idx ${e.index.toFixed(1)} cal ${e.calendar.toFixed(1)}`);
  }
  must(shown.length>=3,'not enough ticks to compare');
  must(idxErr < 0.5, `ticks do not sit at the match index (total error ${idxErr.toFixed(2)}pp) — ${shown.join(' | ')}`);
  must(idxErr < calErr, `ticks match the CALENDAR better than the index (idx ${idxErr.toFixed(2)} vs cal ${calErr.toFixed(2)})`);
  return `index error ${idxErr.toFixed(2)}pp vs calendar ${calErr.toFixed(2)}pp over ${shown.length} ticks · n=${r.n}`;
});

await check('3: the live footnote names retirements',async()=>{
  const t=await ev(`(function(){var f=document.querySelector('[data-db-root="live"] .db-footnote');return f?f.textContent:'';})()`);
  must(/retirements \(voided, as a book would\)/.test(t),'the footnote does not mention retirements');
  must(/walkovers/.test(t),'walkovers line lost');
  return t.match(/[\d,]+ retirements \(voided[^)]*\)/)[0];
});
await ev(`(function(){var p=document.querySelector('[data-db-root="live"]');if(p)p.remove();return true;})()`);
await ev(`document.querySelector('[data-tab="tournaments"]').click()`); await new Promise(r=>setTimeout(r,1500));
await check('1: live selection is surface-tinted, columns neutral',async()=>{
  const out=[];
  for(const [n,want] of [['Rome','232, 168, 78'],['Wimbledon','42, 184, 160'],['Paris','77, 184, 255']]){
    await ev(`(function(){tourxState.speedPanel=null;tourxSelectCondition(${JSON.stringify(n)});tourxOpenSpeedPanel();return true;})()`);
    await new Promise(r=>setTimeout(r,900));
    const p=await ev(`(function(){var o=document.getElementById('tourxOverlayRoot');
      var s=[].slice.call(o.querySelectorAll('div[onclick^="tourxSelectCondition"]')).filter(function(d){return d.style.background&&d.style.background!=='transparent';});
      var heads=[].slice.call(o.querySelectorAll('div[style*="height:41px"]')).map(function(h){var l=h.querySelector('span:nth-child(2)');return l?getComputedStyle(l).color:null;});
      return {bg:s.length?getComputedStyle(s[0]).backgroundColor:null, heads:heads};})()`);
    must(p.bg&&p.bg.includes(want),`${n}: wash is ${p.bg}, expected the ${want} token`);
    must(p.heads.every(h=>h==='rgb(231, 233, 238)'),`${n}: a column heading is tinted — ${JSON.stringify(p.heads)}`);
    out.push(`${n} ${p.bg}`);
  }
  return out.join(' · ');
});
console.log(`\n  ${pass} passed, ${fail} failed\n`);
ws.close();ch.kill();process.exit(fail?1:0);
