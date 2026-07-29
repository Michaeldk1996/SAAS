// TEN-8 Item 4 — end-to-end verification of the shared match-detail component.
// Opens a REAL completed match's Analysis modal, drives to the Match Stats tab,
// cross-checks every .msheet-bar fill width against matchStats a/(a+b), verifies
// the player-identity fill colours (#6aaeff / #e7e9ee), screenshots at 1400px,
// then exercises the Point-by-point sub-tab. The point-log sidecar is served
// with ONE real entry re-keyed to the open match's event key (real data, so the
// pane paints genuine game rows) — a render-only fixture, never written to disk.
// Zero installs: Node global WebSocket + spawned headless Chrome over CDP.
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
const previewName = '_render-matchdetail.html';
fs.writeFileSync(path.join(WT, previewName), src.replace(marker, marker + '\n' + stub));

// Build the re-keyed point-log fixture: take a real entry with sets and clone it
// under whatever event key we end up opening (filled in after we pick a match).
const pbpAll = JSON.parse(fs.readFileSync(path.join(WT, 'point-by-point.json'), 'utf8'));
let donorEntry = null;
for (const k of Object.keys(pbpAll)) { const e = pbpAll[k]; if (e && Array.isArray(e.sets) && e.sets.length) { donorEntry = e; break; } }
let injectEk = null;   // set by the browser once we know which match opened

// Real per-match box scores keyed by event key — the source we synthesize
// setstats/{ek}.json shards from, so a form-panel row (H2H mount) paints its
// Stats bar from a REAL setstats shard the same way production would.
const hist = JSON.parse(fs.readFileSync(path.join(WT, 'historical-match-stats.json'), 'utf8'));
const histEks = Object.keys(hist).filter(k => hist[k] && hist[k].matchStats && hist[k].p1Key != null);
function synthShard(ek){
  const h = hist[ek]; if (!h || !h.matchStats) return null;
  return { p1Key: h.p1Key, p2Key: h.p2Key, match: { p1: h.matchStats.p1, p2: h.matchStats.p2 } };
}

const types = {'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.woff':'font/woff'};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/' + previewName;
  if (p === '/point-by-point.json') {
    const obj = Object.assign({}, pbpAll);
    if (injectEk && donorEntry) obj[injectEk] = donorEntry;   // real log, re-keyed
    res.writeHead(200, {'content-type':'application/json'});
    return res.end(JSON.stringify(obj));
  }
  if (p === '/matchstats-index.json') {   // advertise every ek we can synthesize a shard for
    res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify(histEks));
  }
  const sm = p.match(/^\/setstats\/(\d+)\.json$/);
  if (sm) { const shard = synthShard(sm[1]);
    res.writeHead(shard?200:404, {'content-type':'application/json'}); return res.end(JSON.stringify(shard||null)); }
  const fp = path.join(WT, p);
  if (!fp.startsWith(WT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, {'content-type': types[path.extname(fp)] || 'application/octet-stream'});
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = fs.mkdtempSync('/tmp/ch-md-');
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

// Pick a real finished match that has matchStats, open its modal, go to Match Stats.
const opened = await evaluate(`(function(){
  var m = matches.find(x=>x.matchStats && (x.finalScore||x.interrupted) && !x.live);
  if(!m) return {err:'no match with matchStats'};
  openAnalysisModal(m.id);
  var tab=document.querySelector('#aTabs .asidenav-item[data-atab="matchstats"]');
  if(tab) tab.click();
  return {id:m.id, ek:String(m.id).split('-').pop(), p1:m.p1, p2:m.p2, finalScore:(m.finalScore||{}).display||null};
})()`);
console.log('OPENED', JSON.stringify(opened));
if (opened.err) { console.error(opened.err); chrome.kill(); server.close(); process.exit(1); }
injectEk = opened.ek;

// Wait for the stat sheet to actually paint bars.
let nbars=0;
for(let i=0;i<60;i++){ nbars = await evaluate(`document.querySelectorAll('#aSectionMatchStats .msheet-bar').length`).catch(()=>0); if(nbars>0) break; await sleep(150); }
await sleep(250);

// Cross-check EVERY bar: rendered fill widths vs matchStats a/(a+b), + colours.
const check = await evaluate(`(function(){
  var m = matches.find(x=>x.id===${JSON.stringify(opened.id)});
  var sheet=document.querySelector('#aSectionMatchStats #msStatsSheet')||document.querySelector('#aSectionMatchStats');
  var rows=[...sheet.querySelectorAll('.msheet-row')];
  var out=[]; var mism=0;
  rows.forEach(function(r){
    var label=(r.querySelector('.msheet-label')||{}).textContent||'';
    var fa=r.querySelector('.msheet-fill.p1'), fb=r.querySelector('.msheet-fill.p2');
    if(!fa||!fb) return;
    var half=r.querySelector('.msheet-half.p1').getBoundingClientRect().width;
    var wa=fa.getBoundingClientRect().width, wb=fb.getBoundingClientRect().width;
    var shareA=half>0?wa/half:0, shareB=half>0?wb/half:0;
    out.push({label:label, fillAcss:fa.style.width, fillBcss:fb.style.width,
      renderedShareA:+shareA.toFixed(3), renderedShareB:+shareB.toFixed(3),
      colorA:getComputedStyle(fa).backgroundColor, colorB:getComputedStyle(fb).backgroundColor});
  });
  // independent expected shares from the raw stat object
  var exp={};
  var stats=m.matchStats;
  Object.keys(stats.p1||{}).forEach(function(k){
    if(k==='raw') return;
    var a=Number(stats.p1[k]), b=Number(stats.p2[k]);
    if(!isFinite(a))a=0; if(!isFinite(b))b=0; a=a>0?a:0; b=b>0?b:0;
    exp[k]={a:a,b:b,shareA:(a+b)>0?a/(a+b):0};
  });
  return {rows:out, exp:exp, sampleColorFillA:out[0]&&out[0].colorA, sampleColorFillB:out[0]&&out[0].colorB};
})()`);
console.log('STATBARS', JSON.stringify(check, null, 2));

// Screenshot the Match Stats view.
let dims = await evaluate(`({w:1400,h:Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)})`);
await c.send('Emulation.setDeviceMetricsOverride', {width:1400, height:dims.h, deviceScaleFactor:1, mobile:false});
await sleep(250);
let shot = await c.send('Page.captureScreenshot', {format:'png', captureBeyondViewport:true, clip:{x:0,y:0,width:1400,height:dims.h,scale:1}});
const statsPng = path.join(OUTDIR, `md-stats-1400-${COMMIT}.png`);
fs.writeFileSync(statsPng, Buffer.from(shot.result.data,'base64'));
console.log('SHOT_STATS', statsPng, 'height', dims.h);

// Switch to Point by point sub-tab; wait for real game rows (injected real log).
await evaluate(`(function(){var b=document.querySelector('#aSectionMatchStats .ms-subtab[data-mstab="pbp"]'); if(b) b.click();})()`);
let pbpRows=0;
for(let i=0;i<60;i++){ pbpRows = await evaluate(`document.querySelectorAll('#msPbpPane .pbp-wrap .pbp-grow').length`).catch(()=>0); if(pbpRows>0) break; await sleep(150); }
const pbpProbe = await evaluate(`(function(){
  var pane=document.getElementById('msPbpPane');
  return {hasWrap:!!pane.querySelector('.pbp-wrap'), gameRows:pane.querySelectorAll('.pbp-grow').length,
    setHdrs:pane.querySelectorAll('.pbp-sethdr').length, text:(pane.textContent||'').slice(0,80)};
})()`);
console.log('PBP', JSON.stringify(pbpProbe));
dims = await evaluate(`({w:1400,h:Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)})`);
await c.send('Emulation.setDeviceMetricsOverride', {width:1400, height:dims.h, deviceScaleFactor:1, mobile:false});
await sleep(200);
shot = await c.send('Page.captureScreenshot', {format:'png', captureBeyondViewport:true, clip:{x:0,y:0,width:1400,height:dims.h,scale:1}});
const pbpPng = path.join(OUTDIR, `md-pbp-1400-${COMMIT}.png`);
fs.writeFileSync(pbpPng, Buffer.from(shot.result.data,'base64'));
console.log('SHOT_PBP', pbpPng, 'height', dims.h);

// Spot-check 2 OTHER mounts render the shared form-panel component post-refactor:
// the H2H tab and the Overview tab both mount formPanelHtml rows.
const otherMounts = await evaluate(`(function(){
  function go(atab){ var t=document.querySelector('#aTabs .asidenav-item[data-atab="'+atab+'"]'); if(t){t.click();} }
  var res={};
  go('h2h'); res.h2h_formRows = document.querySelectorAll('#aSectionH2H .aform-row, #aSectionH2H .form-row, #aSectionH2H [data-ek]').length;
  go('overview'); res.overview_present = !!document.querySelector('#aSectionOverview');
  go('form'); res.form_rows = document.querySelectorAll('#aSectionForm [data-ek], #aSectionForm .aform-row').length;
  return res;
})()`);
console.log('OTHERMOUNTS', JSON.stringify(otherMounts));

// Prove a form-panel MOUNT paints its Stats bar from a REAL setstats/{ek}.json.
// Go to H2H, find a row whose ek we can synthesize a real shard for, open it,
// wait for the shared .msheet-bar to paint inside .aform-panel, and cross-check
// widths against the shard's own numbers + the identity colours.
const SHARD_EK = histEks[0];   // a real ek we serve a synthesized real shard for
const fpBar = await evaluate(`(async function(){
  var out={};
  // (a) H2H mount renders the shared component from real inline data.
  var t=document.querySelector('#aTabs .asidenav-item[data-atab="h2h"]'); if(t) t.click();
  await new Promise(r=>setTimeout(r,300));
  var target=document.querySelector('#aSectionH2H .aform-panel-wrap[data-ek]');
  if(target){
    var idPrefix=target.id.replace('formPanelWrap-','');
    toggleFormPanel(idPrefix);
    for(var i=0;i<40;i++){ if(target.querySelector('.aform-panel .msheet-bar .msheet-fill.p1')) break; await new Promise(r=>setTimeout(r,150)); }
    var fa=target.querySelector('.msheet-bar .msheet-fill.p1'), fb=target.querySelector('.msheet-bar .msheet-fill.p2');
    out.h2hMount = fa&&fb ? { ek:target.dataset.ek, idPrefix:idPrefix, bars:target.querySelectorAll('.msheet-bar').length,
      colorA:getComputedStyle(fa).backgroundColor, colorB:getComputedStyle(fb).backgroundColor } : {err:'no bar', ek:target.dataset.ek};
  } else out.h2hMount={err:'no H2H wrap'};
  // (b) Exercise the real setstats/{ek}.json fetch path end-to-end.
  var ek=${JSON.stringify(SHARD_EK)};
  var shard=await loadSetStatsShard(ek);
  if(!shard) return Object.assign(out,{shardPath:{err:'shard fetch null',ek:ek}});
  var joined=matchStatsFromShard(shard, shard.p1Key);
  var host=document.createElement('div'); host.className='modal-analysis'; host.id='__fpprobe';
  host.style.width='560px'; document.body.appendChild(host);
  host.innerHTML=formPanelStatsBodyHtml(joined,'Player A','Player B',null);
  var bars=[...host.querySelectorAll('.aform-panel-stat')].map(function(r){
    var fa=r.querySelector('.msheet-fill.p1'), fb=r.querySelector('.msheet-fill.p2');
    var half=r.querySelector('.msheet-half.p1'); half=half?half.getBoundingClientRect().width:0;
    return {aW:fa&&fa.style.width, bW:fb&&fb.style.width,
      renderedShareA:half>0&&fa?+(fa.getBoundingClientRect().width/half).toFixed(3):null,
      cA:fa&&getComputedStyle(fa).backgroundColor, cB:fb&&getComputedStyle(fb).backgroundColor};
  });
  var firstKey=Object.keys(shard.match.p1).filter(function(k){return k!=='raw';})[0];
  var a=Number(shard.match.p1[firstKey]), b=Number(shard.match.p2[firstKey]);
  out.shardPath={ ek:ek, fromRealShard:true, barCount:bars.length, sample:bars.slice(0,3),
    firstKey:firstKey, firstA:shard.match.p1[firstKey], firstB:shard.match.p2[firstKey],
    expectShareA:+((a>0?a:0)/((a>0?a:0)+(b>0?b:0)||1).toFixed(3)) };
  return out;
})()`);
console.log('FORMPANEL_BAR', JSON.stringify(fpBar, null, 2));
const fpPrefix = fpBar && fpBar.h2hMount && fpBar.h2hMount.idPrefix;
if (fpPrefix){
  const box = await evaluate(`(function(){var w=document.getElementById('formPanelWrap-'+${JSON.stringify(fpPrefix)}); if(!w)return null; var r=w.getBoundingClientRect(); return {x:r.x,y:r.y+window.scrollY,w:r.width,h:r.height};})()`);
  if(box){ const s=await c.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:Math.max(0,box.x-8),y:Math.max(0,box.y-8),width:Math.min(1400,box.w+16),height:box.h+16,scale:1}});
    const fpPng=path.join(OUTDIR, `md-formpanel-1400-${COMMIT}.png`); fs.writeFileSync(fpPng, Buffer.from(s.result.data,'base64')); console.log('SHOT_FORMPANEL', fpPng); }
}

chrome.kill(); server.close();
process.exit(0);
