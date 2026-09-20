import { spawn } from 'node:child_process'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const WT=process.argv[2], PORT=9211+(process.pid%400);
const STUB=`(function(g){var u={emailVerified:true};g.BSP={currentUser:()=>u,onAuthChange:f=>{f(u);return()=>{}},ready:Promise.resolve(u),whenAuthReady:()=>Promise.resolve(u),requireAuth:()=>Promise.resolve(u),requireVerified:()=>Promise.resolve(u),isValidEmail:()=>true,updateProfile:()=>Promise.resolve(),NOTIF:{}};})(window);`;
const srv=http.createServer((q,s)=>{const u=decodeURIComponent(q.url.split('?')[0]);
 if(u==='/auth.js'){s.writeHead(200,{'content-type':'text/javascript'});return s.end(STUB);}
 const f=path.join(WT,u.replace(/^\/+/,''));
 if(!f.startsWith(WT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){s.writeHead(404);return s.end('x');}
 const e=path.extname(f);
 s.writeHead(200,{'content-type':e==='.html'?'text/html':e==='.json'?'application/json':'text/javascript'});
 fs.createReadStream(f).pipe(s);});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0','--no-first-run','--disable-gpu','--force-device-scale-factor=2','--window-size=1500,1150','--user-data-dir='+fs.mkdtempSync('/tmp/cdpS-'),'about:blank'],{stdio:['ignore','pipe','pipe']});
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
const wait=async(x,l,ms=30000)=>{const t0=Date.now();for(;;){let v;try{v=await ev(x);}catch{v=null;} if(v)return v; if(Date.now()-t0>ms)throw new Error('timeout '+l); await new Promise(r=>setTimeout(r,250));}};

const CONTRAST=(fg,bg)=>{const L=h=>{const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4));return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];};
 const a=L(fg),b=L(bg);return ((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)).toFixed(2);};

for (const v of ['now','a','b','c']) {
  await send('Page.navigate',{url:`http://127.0.0.1:${PORT}/variant-${v}.html`});
  await new Promise(r=>setTimeout(r,3500));
  await ev(`document.querySelector('[data-tab="tournaments"]').click()`);
  await new Promise(r=>setTimeout(r,1000));
  await ev(`(function(){ tourxSelectCondition('Rome'); tourxOpenSpeedPanel(); return true; })()`);
  await new Promise(r=>setTimeout(r,1400));
  const box = await ev(`(function(){
    var o=document.getElementById('tourxOverlayRoot');
    var g=o.querySelector('div[style*="grid-template-columns"]');
    var card=g; for(var i=0;i<4&&card.parentElement;i++) card=card.parentElement;
    var r=(g||card).getBoundingClientRect();
    return {x:Math.max(0,r.x-24),y:Math.max(0,r.y-92),w:Math.min(1500,r.width+48),h:Math.min(1100,r.height+120)};
  })()`);
  const shot = await send('Page.captureScreenshot',{format:'png',clip:{x:box.x,y:box.y,width:box.w,height:box.h,scale:1}});
  fs.writeFileSync(`${process.env.OUT}/speed-${v}.png`, Buffer.from(shot.result.data,'base64'));
  const probe = await ev(`(function(){
    var o=document.getElementById('tourxOverlayRoot');
    var heads=[].slice.call(o.querySelectorAll('div[style*="height:41px"]'));
    return heads.map(function(h){
      var lab=h.querySelector('span:nth-child(2)');
      var chip=h.querySelector('span');
      return {label:(lab&&lab.textContent||'').trim(), headColor:lab?getComputedStyle(lab).color:null,
              chipBg:chip?getComputedStyle(chip).backgroundColor:null, chipColor:chip?getComputedStyle(chip).color:null};
    });
  })()`);
  console.log(`\n--- variant ${v} ---`);
  probe.forEach(p=>console.log(`  ${p.label.padEnd(8)} heading ${p.headColor}   chip bg ${p.chipBg}  fg ${p.chipColor}`));
}
console.log('\ncontrast of the tokens on the panel background #06070a:');
for(const [n,h] of [['Clay  #e8a84e','#e8a84e'],['Hard  #4db8ff','#4db8ff'],['Grass #2ab8a0','#2ab8a0'],['current #c6ccdb','#c6ccdb']])
  console.log(`  ${n}: ${CONTRAST(h,'#06070a')}:1`);
ws.close();ch.kill();srv.close();
