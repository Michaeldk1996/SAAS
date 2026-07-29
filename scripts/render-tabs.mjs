// TEN-8 Item 5 — end-to-end verification of the Match Analysis modal's TEN tabs.
// Opens a REAL match's Analysis modal, asserts the aside rail is EXACTLY the ten
// README tabs in order (Key factors · Playing style · Form · H2H · Match Stats ·
// Progression · Overview · Tournament · Weather · Odds) with NO "Extra stats",
// then CLICKS THROUGH all ten, waits for each section to actually paint (polls the
// DOM — never a fixed-sleep-and-assume), probes content, and screenshots each tab.
// Same fixture support as render-matchdetail.mjs: setstats/{ek}.json synthesized
// from real historical-match-stats.json and a re-keyed real point-by-point log, so
// Form/H2H/Stats/PbP paint from real numbers even though those shard dirs are
// pipeline-built and absent locally. Zero installs: Node global WebSocket + Chrome.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const WT = process.argv[2];
const OUTDIR = process.argv[3] || WT;
const COMMIT = process.argv[4] || 'WORKING';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const src = COMMIT === 'WORKING'
  ? fs.readFileSync(path.join(WT, 'bsp-consult-dashboard.html'), 'utf8')
  : spawnSync('git', ['-C', WT, 'show', `${COMMIT}:bsp-consult-dashboard.html`], {maxBuffer: 1<<30}).stdout.toString('utf8');
const stub = `<script>window.BSP={ready:Promise.resolve(),_u:{uid:"preview",name:"Alex Morgan",displayName:"Alex Morgan",email:"alex.morgan@stennisfy.local",emailVerified:true},currentUser:function(){return this._u;},requireVerified:function(){return Promise.resolve(this._u);},requireAuth:function(){return Promise.resolve(this._u);},onAuthChange:function(cb){try{cb(this._u);}catch(e){}return function(){};},signOut:function(){return Promise.resolve();}};</script>`;
const marker = '<script src="./auth.js"></script>';
if (!src.includes(marker)) throw new Error('auth.js marker not found');
const previewName = '_render-tabs.html';
fs.writeFileSync(path.join(WT, previewName), src.replace(marker, marker + '\n' + stub));

const pbpAll = JSON.parse(fs.readFileSync(path.join(WT, 'point-by-point.json'), 'utf8'));
let donorEntry = null;
for (const k of Object.keys(pbpAll)) { const e = pbpAll[k]; if (e && Array.isArray(e.sets) && e.sets.length) { donorEntry = e; break; } }
let injectEk = null;

const hist = JSON.parse(fs.readFileSync(path.join(WT, 'historical-match-stats.json'), 'utf8'));
const histEks = Object.keys(hist).filter(k => hist[k] && hist[k].matchStats && hist[k].p1Key != null);
function synthShard(ek){ const h = hist[ek]; if (!h || !h.matchStats) return null;
  return { p1Key: h.p1Key, p2Key: h.p2Key, match: { p1: h.matchStats.p1, p2: h.matchStats.p2 } }; }

const types = {'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.woff':'font/woff'};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/' + previewName;
  if (p === '/point-by-point.json') {
    const obj = Object.assign({}, pbpAll);
    if (injectEk && donorEntry) obj[injectEk] = donorEntry;
    res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify(obj));
  }
  if (p === '/matchstats-index.json') { res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify(histEks)); }
  const sm = p.match(/^\/setstats\/(\d+)\.json$/);
  if (sm) { const shard = synthShard(sm[1]); res.writeHead(shard?200:404, {'content-type':'application/json'}); return res.end(JSON.stringify(shard||null)); }
  const fp = path.join(WT, p);
  if (!fp.startsWith(WT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, {'content-type': types[path.extname(fp)] || 'application/octet-stream'});
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = fs.mkdtempSync('/tmp/ch-tabs-');
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
for(let i=0;i<100;i++){ const n = await evaluate(`(typeof matches!=='undefined' && matches.length)||0`).catch(()=>0); if(n>0) break; await sleep(200); }

// EXPECTED rail — README order, exactly ten, no "extra".
const EXPECT = [
  ['key','Key factors'],['style','Playing style'],['form','Form'],['h2h','H2H'],
  ['matchstats','Match Stats'],['progression','Progression'],['overview','Overview'],
  ['tournament','Tournament'],['weather','Weather'],['odds','Odds'],
];

// Open a real finished match that has matchStats (so Stats/PbP paint) and, if we
// can, one where Progression is NOT round-hidden so all ten tabs are drivable.
const opened = await evaluate(`(function(){
  var cands = matches.filter(x=>x.matchStats && (x.finalScore||x.interrupted) && !x.live);
  if(!cands.length) cands = matches.filter(x=>x.matchStats);
  if(!cands.length) return {err:'no match with matchStats'};
  function progVisible(m){ try{ return progressionRoundState(m).state!=='hidden'; }catch(e){ return true; } }
  var m = cands.find(progVisible) || cands[0];
  openAnalysisModal(m.id);
  return {id:m.id, ek:String(m.id).split('-').pop(), p1:m.p1, p2:m.p2,
    finalScore:(m.finalScore||{}).display||null, progVisible:progVisible(m)};
})()`);
console.log('OPENED', JSON.stringify(opened));
if (opened.err) { console.error(opened.err); chrome.kill(); server.close(); process.exit(1); }
injectEk = opened.ek;
await sleep(300);

// (1) RAIL ASSERTION — exactly the ten README tabs, in order, no extra.
const rail = await evaluate(`(function(){
  var items=[...document.querySelectorAll('#aTabs .asidenav-item[data-atab]')];
  return { count:items.length,
    tabs: items.map(function(i){ return {atab:i.dataset.atab, label:(i.querySelector('span:last-child')||{}).textContent||'',
      display:getComputedStyle(i).display}; }),
    hasExtra: items.some(function(i){return i.dataset.atab==='extra';}),
    sections: [...document.querySelectorAll('.asection[data-asection]')].map(function(s){return s.dataset.asection;}) };
})()`);
console.log('RAIL', JSON.stringify(rail, null, 2));
const railOk = rail.count===10 && !rail.hasExtra &&
  EXPECT.every((e,i)=> rail.tabs[i] && rail.tabs[i].atab===e[0] && rail.tabs[i].label.trim()===e[1]) &&
  !rail.sections.includes('extra');
console.log('RAIL_EXACTLY_TEN_README_ORDER', railOk);

// Screenshot the whole modal element (rail + body) so the ten-tab rail is visible
// in a founder-facing artefact, not just clipped at the page's left edge.
const modalBox = await evaluate(`(function(){var host=document.querySelector('.modal-analysis'); var panel=host.querySelector('.aanalysis-body-wrap')||host.firstElementChild||host; var pr=panel.getBoundingClientRect(); var railEl=document.getElementById('aTabs'); var rr=railEl.getBoundingClientRect(); return {x:rr.x,y:rr.y,w:pr.width,h:rr.height, railX:rr.x, railW:rr.width, railVisible: rr.width>40 && rr.x>=-5};})()`);
console.log('MODAL_BOX', JSON.stringify(modalBox));
if (modalBox && modalBox.railVisible){
  const clipH = Math.min(1200, Math.max(560, modalBox.h+30));
  const mShot = await c.send('Page.captureScreenshot', {format:'png', captureBeyondViewport:true,
    clip:{x:Math.max(0,modalBox.railX-6), y:Math.max(0,modalBox.y-6), width:Math.min(560,modalBox.railW+360), height:clipH, scale:1}});
  const mPng = path.join(OUTDIR, `md-rail-1400-${COMMIT}.png`);
  fs.writeFileSync(mPng, Buffer.from(mShot.result.data,'base64'));
  console.log('SHOT_RAIL', mPng);
}

// (2) DRIVE ALL TEN — click each, wait for paint, probe, screenshot.
const results = [];
for (const [atab, label] of EXPECT){
  // Force-show a round-hidden Progression nav so the tab is still drivable/visible.
  await evaluate(`(function(){var n=document.querySelector('#aTabs .asidenav-item[data-atab="${atab}"]'); if(n){n.style.display=''; n.click();}})()`);
  // Poll until the section has real content: children present AND not still the
  // bare loading line. Placeholders (acomingsoon / "not available") count as
  // painted-but-empty and are reported honestly, not as a failure.
  let probe = null;
  for (let i=0;i<80;i++){
    probe = await evaluate(`(function(){
      var s=document.querySelector('.asection[data-asection="${atab}"]');
      if(!s) return {missing:true};
      var t=(s.textContent||'').replace(/\\s+/g,' ').trim();
      var loading = /Loading|Checking which matches|in flight/i.test(t) && s.childElementCount<=1;
      var placeholder = !!s.querySelector('.acomingsoon');
      return { active:s.classList.contains('active'), kids:s.childElementCount,
        chars:t.length, loading:loading, placeholder:placeholder, snippet:t.slice(0,140),
        bars:s.querySelectorAll('.msheet-bar').length };
    })()`);
    if (probe && !probe.loading && probe.kids>0 && probe.chars>0) break;
    await sleep(150);
  }
  // screenshot this tab full-height
  const dims = await evaluate(`({h:Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)})`);
  await c.send('Emulation.setDeviceMetricsOverride', {width:1400, height:dims.h, deviceScaleFactor:1, mobile:false});
  await sleep(180);
  const shot = await c.send('Page.captureScreenshot', {format:'png', captureBeyondViewport:true, clip:{x:0,y:0,width:1400,height:dims.h,scale:1}});
  const png = path.join(OUTDIR, `md-tab-${atab}-1400-${COMMIT}.png`);
  fs.writeFileSync(png, Buffer.from(shot.result.data,'base64'));
  await c.send('Emulation.setDeviceMetricsOverride', {width:1400, height:1000, deviceScaleFactor:1, mobile:false});
  results.push({atab, label, painted: !!(probe && probe.kids>0 && probe.chars>0 && !probe.loading),
    kids:probe&&probe.kids, chars:probe&&probe.chars, bars:probe&&probe.bars,
    placeholder:probe&&probe.placeholder, snippet:probe&&probe.snippet, png});
}
console.log('TABS', JSON.stringify(results, null, 2));

// Match Stats → Point by point sub-tab (real re-keyed log) as an extra depth check.
await evaluate(`(function(){var t=document.querySelector('#aTabs .asidenav-item[data-atab="matchstats"]'); if(t)t.click();})()`);
await sleep(200);
await evaluate(`(function(){var b=document.querySelector('#aSectionMatchStats .ms-subtab[data-mstab="pbp"]'); if(b) b.click();})()`);
let pbpRows=0; for(let i=0;i<60;i++){ pbpRows = await evaluate(`document.querySelectorAll('#msPbpPane .pbp-wrap .pbp-grow').length`).catch(()=>0); if(pbpRows>0) break; await sleep(150); }
console.log('PBP_SUBTAB_GAME_ROWS', pbpRows);

const allPainted = results.every(r=>r.painted);
console.log('ALL_TEN_PAINTED', allPainted);
console.log('SUMMARY', JSON.stringify({railOk, allPainted, tabs:results.map(r=>({t:r.atab, painted:r.painted, placeholder:r.placeholder}))}));

chrome.kill(); server.close();
process.exit(railOk && allPainted ? 0 : 2);
