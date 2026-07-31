// TEN-8 Tab 2/11 — verify the rebuilt Odds tab (buildOddsSection) end-to-end.
// Opens a real upcoming match that has oddsMovement, clicks the Odds tab, probes
// the export-parity structure (control bar, 7-col per-book grid, summary chips,
// chart svg), asserts no exception, screenshots. Zero installs: CDP + headless Chrome.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const WT = process.argv[2] || process.cwd();
const OUTDIR = process.argv[3] || WT;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const src = fs.readFileSync(path.join(WT, 'bsp-consult-dashboard.html'), 'utf8');
const stub = `<script>window.BSP={ready:Promise.resolve(),_u:{uid:"preview",name:"Alex",displayName:"Alex",email:"a@b.local",emailVerified:true},currentUser:function(){return this._u;},requireVerified:function(){return Promise.resolve(this._u);},requireAuth:function(){return Promise.resolve(this._u);},onAuthChange:function(cb){try{cb(this._u);}catch(e){}return function(){};},signOut:function(){return Promise.resolve();}};</script>`;
const marker = '<script src="./auth.js"></script>';
if (!src.includes(marker)) throw new Error('auth.js marker not found');
const previewName = '_render-odds.html';
fs.writeFileSync(path.join(WT, previewName), src.replace(marker, marker + '\n' + stub));

// The app hydrates per-match odds from lazy shards (ensureOddsMovement -> ./odds/{ek}.json,
// gated by ./odds-index.json). Local matches.json still carries oddsMovement inline, so
// synthesize the shards from it — otherwise a 404 nulls m.oddsMovement and the tab falls
// back to the reduced view. This is exactly what production serves.
const _mj = JSON.parse(fs.readFileSync(path.join(WT,'matches.json'),'utf8'));
const _marr = Array.isArray(_mj) ? _mj : (_mj.matches||_mj.data||[]);
const _ekOf = id => { id=String(id||''); const i=id.indexOf('-'); return i>=0?id.slice(i+1):id; };
const _oddsByEk = {};
_marr.forEach(m=>{ if(m && m.oddsMovement && m.oddsMovement.books && Object.keys(m.oddsMovement.books).length) _oddsByEk[_ekOf(m.id)] = m.oddsMovement; });

const types = {'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.woff':'font/woff'};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/' + previewName;
  if (p === '/odds-index.json') { res.writeHead(200,{'content-type':'application/json'}); return res.end(JSON.stringify(Object.keys(_oddsByEk))); }
  const om = p.match(/^\/odds\/(.+)\.json$/);
  if (om) { const d=_oddsByEk[om[1]]; res.writeHead(d?200:404,{'content-type':'application/json'}); return res.end(d?JSON.stringify({market:d.market,capturedAt:d.capturedAt,books:d.books}):'null'); }
  const fp = path.join(WT, p);
  if (!fp.startsWith(WT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, {'content-type': types[path.extname(fp)] || 'application/octet-stream'});
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = fs.mkdtempSync('/tmp/ch-od-');
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

// Open a match WITH oddsMovement (multi-book preferred), click Odds tab, probe — all in one eval.
const opened = await evaluate(`(function(){
  var withOm = matches.filter(function(x){return x.oddsMovement && x.oddsMovement.books && Object.keys(x.oddsMovement.books).length;});
  withOm.sort(function(a,b){return Object.keys(b.oddsMovement.books).length-Object.keys(a.oddsMovement.books).length;});
  var m = withOm[0];
  if(!m) return {err:'no match with oddsMovement'};
  try { openAnalysisModal(m.id); } catch(e){ return {err:'openAnalysisModal threw: '+e.message}; }
  var tab=document.querySelector('#aTabs .asidenav-item[data-atab="odds"]');
  if(tab) tab.click(); else return {err:'no odds tab'};
  return {id:m.id, p1:m.p1, p2:m.p2, books:Object.keys(m.oddsMovement.books)};
})()`);
console.log('OPENED', JSON.stringify(opened));
if (opened.err) { console.error('FAIL', opened.err); chrome.kill(); server.close(); process.exit(1); }
await sleep(300);

const probe = await evaluate(`(function(){
  var sec=document.getElementById('aSectionOdds');
  if(!sec) return {err:'no #aSectionOdds'};
  var txt=sec.textContent||'';
  // per-book grid rows: divs whose inline gridTemplateColumns has 7 tracks
  var grids=[...sec.querySelectorAll('div[style*="grid-template-columns"]')];
  var sevenCol=grids.filter(function(g){return (g.style.gridTemplateColumns.match(/fr/g)||[]).length===7;});
  var header=sevenCol[0], dataRows=sevenCol.slice(1);
  // summary chips = the two min-width:120px bordered boxes in the movement head
  var chips=[...sec.querySelectorAll('div[style*="min-width:120px"]')];
  // control: market pill + chart-line toggles
  var pill=[...sec.querySelectorAll('div[style*="min-width:200px"]')];
  var toggles=[...sec.querySelectorAll('span[onclick^="aOddsToggleBook"]')];
  var svg=sec.querySelector('svg polyline, .aomv-plot svg');
  return {
    hasPerBookTitle: /Per-book movement/.test(txt),
    hasOddsMovement: /Odds movement/.test(txt),
    sevenColGrids: sevenCol.length,
    perBookDataRows: dataRows.length,
    headerCols: header ? header.children.length : 0,
    firstRowCols: dataRows[0] ? dataRows[0].children.length : 0,
    summaryChips: chips.length,
    marketPill: pill.length,
    chartLineToggles: toggles.length,
    hasChartSvg: !!svg,
    droppedOpeningNowSeg: !/>Opening<|>Now<\\/button>/.test(sec.innerHTML),
    footnoteHasOddspapi: /oddspapi\\.io/.test(txt),
    sampleChipText: chips[0] ? (chips[0].textContent||'').replace(/\\s+/g,' ').trim().slice(0,40) : null
  };
})()`);
console.log('ODDS_PROBE', JSON.stringify(probe, null, 2));

let dims = await evaluate(`({w:1400,h:Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)})`);
await c.send('Emulation.setDeviceMetricsOverride', {width:1400, height:dims.h, deviceScaleFactor:1, mobile:false});
await sleep(250);
const shot = await c.send('Page.captureScreenshot', {format:'png', captureBeyondViewport:true, clip:{x:0,y:0,width:1400,height:dims.h,scale:1}});
const png = path.join(OUTDIR, `odds-tab-1400.png`);
fs.writeFileSync(png, Buffer.from(shot.result.data,'base64'));
console.log('SHOT', png, 'height', dims.h);

// Pass/fail gate
const pass = probe.hasPerBookTitle && probe.hasOddsMovement && probe.sevenColGrids>=2
  && probe.perBookDataRows===opened.books.length && probe.headerCols===5 && probe.firstRowCols===7
  && probe.summaryChips===2 && probe.marketPill===1 && probe.chartLineToggles===opened.books.length
  && probe.hasChartSvg;
console.log(pass ? 'VERIFY_PASS' : 'VERIFY_FAIL');
chrome.kill(); server.close();
process.exit(pass?0:2);
