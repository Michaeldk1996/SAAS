// How many matches END UP with the real captured chart, once the lazily-loaded odds
// shard has landed? The earlier count measured at first paint and raced that load.
const { spawn } = require('child_process');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT=9788, U='http://127.0.0.1:8797/index.html';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const c=spawn(CHROME,['--headless=new',`--remote-debugging-port=${PORT}`,'--no-sandbox','--disable-gpu','--window-size=1600,2400',`--user-data-dir=/tmp/kf3odds-${process.pid}`,U],{stdio:'ignore'});
 let ws=null;
 for(let i=0;i<40&&!ws;i++){await sleep(400);try{const l=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=l.find(t=>t.type==='page'&&t.url.includes('8797'));if(p)ws=p.webSocketDebuggerUrl;}catch(e){}}
 const s=new WebSocket(ws); await new Promise(r=>s.addEventListener('open',r));
 let id=0;const pend=new Map();
 s.addEventListener('message',e=>{const m=JSON.parse(e.data);if(pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}});
 const send=(m,p)=>new Promise(r=>{const i=++id;pend.set(i,r);s.send(JSON.stringify({id:i,method:m,params:p}));});
 await send('Runtime.enable',{});
 const ev=async x=>{const r=await send('Runtime.evaluate',{expression:`(async()=>(${x}))()`,awaitPromise:true,returnByValue:true});return r.result&&r.result.result?r.result.result.value:undefined;};
 let rows=null;
 for(let i=0;i<60&&!rows;i++){const b=await ev(`JSON.stringify((typeof matches!=='undefined'&&Array.isArray(matches))?matches.map(x=>({id:x.id,p1:x.p1,p2:x.p2})):null)`);if(typeof b==='string'&&b!=='null'){const p=JSON.parse(b);if(p.length)rows=p;} if(!rows)await sleep(1000);} 
 let real=0,fallback=0,endp=0,none=0;
 const detail=[];
 for(const m of rows){
   await ev(`(openAnalysisModal(${JSON.stringify(m.id)}),'ok')`);
   for(let i=0;i<40;i++){const ok=await ev(`!!document.querySelector('#aSectionKey .akbento .akb')`);if(ok)break;await sleep(250);} 
   // Wait for the odds shard specifically: m.oddsMovement flips from null once it lands.
   let mv=null;
   for(let i=0;i<40;i++){
     mv=await ev(`(()=>{const x=(typeof matches!=='undefined'?matches:[]).find(y=>y.id===${JSON.stringify(m.id)});return x&&x.oddsMovement&&x.oddsMovement.books?Object.keys(x.oddsMovement.books).length:0;})()`);
     if(mv)break; await sleep(300);
   }
   await sleep(400);
   const st=await ev(`(()=>{const el=document.querySelector('#aSectionKey .ako-move');if(!el)return 'none';if(el.querySelector('.ako-endrow'))return 'endpoints';const pts=el.querySelectorAll('circle,polyline').length;return pts?'chart':'none';})()`);
   const books=mv||0;
   if(st==='chart'&&books) real++; else if(st==='chart') fallback++; else if(st==='endpoints') endp++; else none++;
   detail.push(`${m.p1} v ${m.p2}: ${st} (books=${books})`);
 }
 console.log(`real captured chart: ${real}\nfallback 2-point chart: ${fallback}\nendpoints text: ${endp}\nnothing: ${none}\ntotal: ${rows.length}`);
 detail.slice(0,8).forEach(d=>console.log('  '+d));
 c.kill();process.exit(0);
})();
