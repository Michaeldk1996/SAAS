// Batch B verify — drives the REAL Results sidebar tab (#mainNav [data-tab="results"])
// and checks the rail (Today rightmost / future days hidden / fwd dead / dropped word
// labels), the filter bar (surface dropdown hidden, relabelled+wired sort keys) and the
// one-tournament context bar. Zero installs: Node 24 WebSocket + spawned headless Chrome.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const WT = process.argv[2];
const COMMIT = process.argv[3] || 'WORKING';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const src = COMMIT === 'WORKING'
  ? fs.readFileSync(path.join(WT, 'bsp-consult-dashboard.html'), 'utf8')
  : spawnSync('git', ['-C', WT, 'show', `${COMMIT}:bsp-consult-dashboard.html`], {maxBuffer: 1<<30}).stdout.toString('utf8');
const stub = `<script>window.BSP={ready:Promise.resolve(),_u:{uid:"preview",name:"Alex Morgan",displayName:"Alex Morgan",email:"alex@stennisfy.local",emailVerified:true},currentUser:function(){return this._u;},requireVerified:function(){return Promise.resolve(this._u);},requireAuth:function(){return Promise.resolve(this._u);},onAuthChange:function(cb){try{cb(this._u);}catch(e){}return function(){};},signOut:function(){return Promise.resolve();}};</script>`;
const marker = '<script src="./auth.js"></script>';
if (!src.includes(marker)) throw new Error('auth.js marker not found');
const html = src.replace(marker, marker + '\n' + stub);
const previewName = '_render-batchb.html';
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
const profile = fs.mkdtempSync('/tmp/ch-batchb-');
const dport = 9600 + Math.floor(port % 300);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'], {stdio:'ignore'});

async function cdpTarget() {
  for (let i=0;i<60;i++){ try { const l = await (await fetch(`http://127.0.0.1:${dport}/json`)).json(); const pg=l.find(t=>t.type==='page'); if(pg?.webSocketDebuggerUrl) return pg.webSocketDebuggerUrl; } catch {} await sleep(200); }
  throw new Error('no CDP target');
}
const errors = [];
function client(ws){ const s=new WebSocket(ws); let id=0; const pend=new Map();
  const ready=new Promise((res,rej)=>{s.onopen=()=>res();s.onerror=rej;});
  s.onmessage=e=>{const m=JSON.parse(e.data);
    if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);return;}
    if(m.method==='Runtime.exceptionThrown'){ errors.push('EXC '+(m.params?.exceptionDetails?.exception?.description||m.params?.exceptionDetails?.text||'?')); }
    if(m.method==='Runtime.consoleAPICalled'&&m.params?.type==='error'){ errors.push('CON '+(m.params.args||[]).map(a=>a.value||a.description||'').join(' ')); }
  };
  const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,res);s.send(JSON.stringify({id:mid,method,params}));});
  return {ready,send}; }

const c = client(await cdpTarget());
await c.ready;
await c.send('Page.enable'); await c.send('Runtime.enable');
await c.send('Emulation.setDeviceMetricsOverride', {width:1400, height:1000, deviceScaleFactor:1, mobile:false});
const evaluate = async (expr) => { const r = await c.send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true}); if(r.result?.exceptionDetails) throw new Error('eval threw '+JSON.stringify(r.result.exceptionDetails)); return r.result?.result?.value; };

await c.send('Page.navigate', {url: `${base}/${previewName}#/matches`});
for(let i=0;i<80;i++){ const n = await evaluate(`document.querySelectorAll('.match-card').length`).catch(()=>0); if(n>0) break; await sleep(200); }

// 1) Click the REAL Results sidebar tab (the shipped code path).
await evaluate(`document.querySelector('#mainNav button[data-tab="results"]').click()`);
await sleep(300);
// 2) Find a day tab that actually carries settled cards and select it.
const dayPick = await evaluate(`(function(){
  var days=['daymin2','yesterday','today'];
  for(var i=0;i<days.length;i++){
    var b=document.querySelector('#dayTabs button[data-day="'+days[i]+'"]');
    if(!b || b.style.display==='none') continue;
    b.click();
    var n=document.querySelectorAll('.match-card .mc-sets, .match-card .mc-won').length;
    if(n>0) return {day:days[i], cards:n};
  }
  return {day:null, cards:0};
})()`);
console.log('DAYPICK', JSON.stringify(dayPick));
for(let i=0;i<60;i++){ const n=await evaluate(`document.querySelectorAll('.match-card .mc-sets, .match-card .mc-won').length`).catch(()=>0); if(n>0) break; await sleep(150); }

// 3) RAIL + FILTER probe
const rail = await evaluate(`(function(){
  var q=s=>document.querySelector(s);
  var tomo=q('#dayTabs button[data-day="tomorrow"]');
  var d2=q('#day2Tab'); var fwd=q('#dayTabsRight'); var back=q('#dayTabsLeft');
  var today=q('#dayTabs button[data-day="today"]');
  // visible tabs, left->right
  var vis=[...document.querySelectorAll('#dayTabs button[data-day]')].filter(b=>b.style.display!=='none').map(b=>b.getAttribute('data-day'));
  return {
    tomorrowHidden: tomo? getComputedStyle(tomo).display==='none':null,
    day2Hidden: d2? getComputedStyle(d2).display==='none':null,
    fwdDisabled: fwd? fwd.disabled:null,
    todayIsRightmost: vis[vis.length-1]==='today',
    visibleTabs: vis,
    yesterdayLabel: (q('#yesterdayBottom')||{}).textContent,
    tomorrowLabel: (q('#tomorrowBottom')||{}).textContent,
    backTitle: back? back.title:null,
    surfaceHidden: q('#surfaceDropdown')? getComputedStyle(q('#surfaceDropdown')).display==='none':null,
  };
})()`);
console.log('RAIL', JSON.stringify(rail, null, 2));

// 4) SORT menu labels + wiring
await evaluate(`document.getElementById('sortBtn').click()`); await sleep(150);
const sort = await evaluate(`(function(){
  var opts=[...document.querySelectorAll('#sortMenu .mx-sortopt')].map(b=>({key:b.dataset.sort,label:b.querySelector('.lbl').textContent.replace(/needs odds/,'').trim(),disabled:b.disabled}));
  return {opts};
})()`);
console.log('SORT', JSON.stringify(sort, null, 2));
// exercise the two new sort keys — click each, confirm order changes without error
const sortDrive = await evaluate(`(function(){
  var out={};
  function firstNames(){return [...document.querySelectorAll('.match-card .mc-name')].slice(0,4).map(e=>e.textContent);}
  function pick(k){var b=document.querySelector('#sortMenu .mx-sortopt[data-sort="'+k+'"]'); if(!b||b.disabled) return null; document.getElementById('sortBtn').click(); b.click(); return firstNames();}
  out.move=pick('move'); out.marketwrong=pick('marketwrong');
  out.cardsAfter=document.querySelectorAll('.match-card').length;
  return out;
})()`);
console.log('SORTDRIVE', JSON.stringify(sortDrive));

// 5) CONTEXT BAR — activate exactly one tournament chip, expect the bar to show N of M.
const ctx = await evaluate(`(function(){
  var out={};
  var chip=document.querySelector('#tournamentGroup .mx-chip');
  out.chipCount=document.querySelectorAll('#tournamentGroup .mx-chip').length;
  if(chip){ chip.click(); }
  var bar=document.getElementById('mcContextBar');
  out.chipLabel=chip?chip.textContent.replace(/×/,'').trim():null;
  out.barHiddenBefore=bar?bar.hidden:null;
  out.barText=bar&&!bar.hidden?bar.textContent.trim():null;
  out.hasLink=!!document.getElementById('mcCtxLink');
  return out;
})()`);
console.log('CTX', JSON.stringify(ctx, null, 2));
// link should navigate to the tournaments page
const nav = await evaluate(`(function(){var l=document.getElementById('mcCtxLink'); if(!l) return null; l.click(); var t=document.querySelector('#mainNav button[data-tab="tournaments"]'); return {tournamentsActive: t?t.classList.contains('active'):null};})()`);
console.log('CTXNAV', JSON.stringify(nav));
// toggle the chip back off (return to Results first) — bar should hide again
const ctxOff = await evaluate(`(function(){
  document.querySelector('#mainNav button[data-tab="results"]').click();
  var chip=document.querySelector('#tournamentGroup .mx-chip.active')||document.querySelector('#tournamentGroup .mx-chip');
  if(chip) chip.click();
  var bar=document.getElementById('mcContextBar');
  return {barHiddenAfter: bar?bar.hidden:null};
})()`);
console.log('CTXOFF', JSON.stringify(ctxOff));

// 6) Confirm Matches (upcoming) rail is UNCHANGED (future tabs back, labels restored)
const matchesRail = await evaluate(`(function(){
  document.querySelector('#mainNav button[data-tab="matches"]').click();
  var q=s=>document.querySelector(s);
  return {
    tomorrowVisible: getComputedStyle(q('#dayTabs button[data-day="tomorrow"]')).display!=='none',
    day2Visible: getComputedStyle(q('#day2Tab')).display!=='none',
    fwdEnabled: !q('#dayTabsRight').disabled,
    yesterdayLabel: q('#yesterdayBottom').textContent,
    surfaceVisible: getComputedStyle(q('#surfaceDropdown')).display!=='none',
  };
})()`);
console.log('MATCHESRAIL', JSON.stringify(matchesRail, null, 2));

await sleep(200);
console.log('JSERRORS', JSON.stringify(errors));
chrome.kill(); server.close();
process.exit(errors.length?2:0);
