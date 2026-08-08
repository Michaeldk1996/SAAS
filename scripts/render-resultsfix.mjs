// Render Results view from the working tree and probe the 3 founder-flagged areas:
// (1) date rail Today tab, (2) typography of section labels/values, (3) odds journey bar.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const WT = process.argv[2];
const OUT = process.argv[3];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const src = fs.readFileSync(path.join(WT, 'bsp-consult-dashboard.html'), 'utf8');
const stub = `<script>window.BSP={ready:Promise.resolve(),_u:{uid:"preview",name:"Alex Morgan",displayName:"Alex Morgan",email:"alex.morgan@stennisfy.local",emailVerified:true},currentUser:function(){return this._u;},requireVerified:function(){return Promise.resolve(this._u);},requireAuth:function(){return Promise.resolve(this._u);},onAuthChange:function(cb){try{cb(this._u);}catch(e){}return function(){};},signOut:function(){return Promise.resolve();}};</script>`;
const marker = '<script src="./auth.js"></script>';
if (!src.includes(marker)) throw new Error('auth.js marker not found');
const html = src.replace(marker, marker + '\n' + stub);
const previewName = '_render-resultsfix.html';
fs.writeFileSync(path.join(WT, previewName), html);

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
const profile = fs.mkdtempSync('/tmp/ch-resultsfix-');
const dport = 9600 + Math.floor(port % 300);
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

await c.send('Page.navigate', {url: `${base}/${previewName}#/matches`});
for(let i=0;i<80;i++){ const n = await evaluate(`document.querySelectorAll('.match-card').length`).catch(()=>0); if(n>0) break; await sleep(200); }
await evaluate(`document.querySelector('#mainNav button[data-tab="results"]').click()`);
await sleep(300);
const dayPick = await evaluate(`(function(){
  var days=['today','yesterday','daymin2','daymin3'];
  for(var i=0;i<days.length;i++){
    var b=document.querySelector('#dayTabs button[data-day="'+days[i]+'"]');
    if(!b || getComputedStyle(b).display==='none') continue;
    b.click();
    var n=document.querySelectorAll('.match-card .mc-sets, .match-card .mc-won').length;
    if(n>0) return {day:days[i], cards:n};
  }
  return {day:null, cards:0};
})()`);
console.log('DAYPICK', JSON.stringify(dayPick));
for(let i=0;i<60;i++){ const n=await evaluate(`document.querySelectorAll('.match-card .mc-sets, .match-card .mc-won').length`).catch(()=>0); if(n>0) break; await sleep(150); }
await sleep(400);

const probe = await evaluate(`(function(){
  var out={};
  // 1) RAIL — visible tabs, their labels + sub-labels + today styling
  out.rail = [...document.querySelectorAll('#dayTabs button[data-day]')]
    .filter(b=>getComputedStyle(b).display!=='none')
    .map(b=>{ var cs=getComputedStyle(b);
      return { day:b.getAttribute('data-day'), text:b.innerText.replace(/\\n/g,' | '),
        fontSize:cs.fontSize, fontWeight:cs.fontWeight, isToday:b.classList.contains('is-today'),
        hasDot: !!b.querySelector('.mc-dot, .day-dot, [class*=dot]') };
    });
  // 2) TYPOGRAPHY — day-summary section label + a value
  var lab=document.querySelector('.mc-story__label');
  if(lab){var c=getComputedStyle(lab); out.storyLabel={text:lab.textContent.trim(),font:c.fontFamily,size:c.fontSize,weight:c.fontWeight,ls:c.letterSpacing,color:c.color,transform:c.textTransform};}
  var oh=document.querySelector('.mc-story__odds, .mc-story__num, .mc-story b');
  // 3) ODDS JOURNEY — every journey object: close text, bar width, delta text, and vertical alignment
  out.journeys = [...document.querySelectorAll('.match-card .mc-journey')].slice(0,8).map(function(j){
    var bar=j.querySelector('.mc-journey__bar'); var open=j.querySelector('.mc-journey__open');
    var close=j.querySelector('.mc-journey__close'); var delta=j.querySelector('.mc-journey__delta');
    var jr=j.getBoundingClientRect();
    var br=bar?bar.getBoundingClientRect():null; var cr=close?close.getBoundingClientRect():null;
    var jcs=getComputedStyle(j);
    return { close:close?close.textContent:null, closeFont:close?getComputedStyle(close).fontFamily:null,
      barWidthPx: bar?getComputedStyle(bar).width:null,
      barCenterY: br?Math.round(br.top+br.height/2):null,
      closeCenterY: cr?Math.round(cr.top+cr.height/2):null,
      delta:delta?delta.textContent:null, deltaColor:delta?getComputedStyle(delta).color:null,
      journeyFlexDir: jcs.flexDirection, journeyAlign: jcs.alignItems };
  });
  return out;
})()`);
console.log('PROBE', JSON.stringify(probe, null, 2));

const dims = await evaluate(`({w:1400,h:Math.min(2600,Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))})`);
await c.send('Emulation.setDeviceMetricsOverride', {width:1400, height:dims.h, deviceScaleFactor:1, mobile:false});
await sleep(300);
const shot = await c.send('Page.captureScreenshot', {format:'png', captureBeyondViewport:true, clip:{x:0,y:0,width:1400,height:dims.h,scale:1}});
fs.writeFileSync(OUT, Buffer.from(shot.result.data,'base64'));
console.log('SHOT', OUT, 'height', dims.h);

chrome.kill(); server.close();
process.exit(0);
