import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.argv[2] || 'http://127.0.0.1:8776').replace(/\/$/, '');
const KEYS = process.argv.slice(3).length ? process.argv.slice(3) : ['1980', '379'];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const FAV_LABELS = ['1.01 – 1.20', '1.21 – 1.40', '1.41 – 1.64', '1.65 – 1.99'];
const DOG_LABELS = ['2.00 – 2.49', '2.50 – 3.49', '3.50 – 5.99', '6.00 +'];

async function cdpTarget(dport, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json();
      const pg = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (pg) return pg.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('no CDP target');
}

const dport = 9400 + Math.floor((Date.now() / 997) % 200);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'mktprobe-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`,
  `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

const ws = new WebSocket(await cdpTarget(dport));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
const jsErrors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    jsErrors.push(((d.exception && d.exception.description) || d.text || '').slice(0, 180));
  }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    throw new Error('eval threw: ' + ((d.exception && d.exception.description) || d.text || '').slice(0, 400));
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}

const checks = [];
const ok = (name, pass, detail) => { checks.push({ name, pass, detail }); };

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,
    get(){return _b;},set(v){if(v){v.requireVerified=()=>true;v.requireAuth=()=>true;}_b=v;}});})();`,
});
await send('Page.navigate', { url: `${BASE}/bsp-consult-dashboard.html` });
for (let i = 0; i < 300; i++) {
  if (await ev(`typeof playerProfiles !== 'undefined' && Object.keys(playerProfiles||{}).length > 0`)) break;
  await sleep(250);
}
console.log(`BASE=${BASE}  keys=${KEYS.join(',')}`);


// ─────────────────────────────────────────────────────────────────────────────
// Hold/break heatmap — computed-style diff table + capture.
// Every EXPECTED value is quoted from `Player Stat Boxes.dc.html` (overlay
// markup :1125-1177, data model :1326-1395). Rendered at deviceScaleFactor 1.8
// so the card lands at the design capture's own 1368 device px (760 layout at
// the 0.9 zoom that frame was taken at) with no resampling in the overlay.
// ─────────────────────────────────────────────────────────────────────────────
await send('Emulation.setDeviceMetricsOverride',
  { width: 1512, height: 1200, deviceScaleFactor: 1.8, mobile: false });

const KEY = KEYS[0];
await ev(`document.querySelector('#mainNav button[data-tab="players"]').click()`);
await sleep(300);
await ev(`(async()=>{ if (typeof ensurePlayerProfile==='function') await ensurePlayerProfile(${JSON.stringify(KEY)});
           showPlayerProfileV2(${JSON.stringify(KEY)}); })()`);
for (let i = 0; i < 80; i++) {
  if (await ev(`document.querySelectorAll('.pp2-box').length===8`)) break;
  await sleep(250);
}
// Live trading box -> modal -> heatmap launcher -> layer
await ev(`document.querySelector('.pp2-box[data-box="profile"]').click()`);
await sleep(400);
for (let i = 0; i < 60; i++) {
  if (await ev(`!!document.querySelector('[data-pp2="heat"]')`)) break;
  await sleep(250);
}
const hasLauncher = await ev(`!!document.querySelector('[data-pp2="heat"]')`);
if (!hasLauncher) { console.log('NO LAUNCHER — subject has no point-by-point data'); ws.close(); chrome.kill(); process.exit(1); }
await ev(`document.querySelector('[data-pp2="heat"]').click()`);
await sleep(400);

const SPEC = [
  ['card',          'card',      { maxWidth:'760px', backgroundColor:'rgb(10, 13, 20)', borderTopWidth:'1px', borderTopColor:'rgba(91, 155, 255, 0.3)', borderRadius:'14px', padding:'22px 24px 24px', display:'flex', flexDirection:'column', rowGap:'16px' }],
  ['scrim',         'scrim',     { position:'fixed', backgroundColor:'rgba(3, 5, 9, 0.72)', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'40px 24px' }],
  ['title',         'title',     { fontSize:'20px', fontWeight:'800', letterSpacing:'-0.3px' }],
  ['scope chip',    'chip',      { fontSize:'9.5px', fontWeight:'600', letterSpacing:'1.33px', textTransform:'uppercase', color:'rgb(91, 104, 128)', backgroundColor:'rgb(6, 7, 10)', borderTopWidth:'1px', borderTopColor:'rgba(255, 255, 255, 0.09)', borderRadius:'9px', padding:'8px 14px' }],
  ['mode seg box',  'modeSeg',   { columnGap:'3px', backgroundColor:'rgb(6, 7, 10)', borderTopWidth:'1px', borderTopColor:'rgba(255, 255, 255, 0.09)', borderRadius:'9px', padding:'3px' }],
  ['mode seg on',   'modeOn',    { padding:'5px 14px', borderRadius:'7px', fontSize:'11.5px', fontWeight:'700', color:'rgb(231, 233, 238)', backgroundColor:'rgba(91, 155, 255, 0.16)', borderTopColor:'rgba(91, 155, 255, 0.4)' }],
  ['mode seg off',  'modeOff',   { fontWeight:'600', color:'rgb(91, 104, 128)', backgroundColor:'rgba(0, 0, 0, 0)' }],
  ['surf seg box',  'surfSeg',   { columnGap:'3px', backgroundColor:'rgb(6, 7, 10)', borderTopWidth:'1px', borderTopColor:'rgba(255, 255, 255, 0.09)', borderRadius:'9px', padding:'3px' }],
  ['close button',  'close',     { backgroundColor:'rgba(255, 255, 255, 0.05)', borderTopWidth:'1px', borderTopColor:'rgba(255, 255, 255, 0.12)', borderRadius:'8px', width:'30px', height:'30px', color:'rgb(139, 150, 181)', fontSize:'15px' }],
  ['subject name',  'subject',   { fontSize:'15px', fontWeight:'700', color:'rgb(91, 155, 255)' }],
  ['overall pill',  'pill',      { fontSize:'12px', fontWeight:'700', letterSpacing:'1.2px', textTransform:'uppercase', color:'rgb(232, 236, 244)', backgroundColor:'rgb(6, 7, 10)', borderTopWidth:'1px', borderTopColor:'rgba(255, 255, 255, 0.09)', borderRadius:'9px', padding:'7px 14px' }],
  ['grid',          'grid',      { display:'grid', gap:'8px 7px', alignItems:'center' }],
  ['column head',   'head',      { fontSize:'9.5px', fontWeight:'600', letterSpacing:'1.33px', textTransform:'uppercase', color:'rgb(91, 104, 128)', textAlign:'center' }],
  ['row label',     'rowLabel',  { fontSize:'13.5px', fontWeight:'700', color:'rgb(231, 233, 238)', whiteSpace:'nowrap' }],
  ['row sub-label', 'rowSub',    { fontSize:'9.5px', color:'rgb(91, 155, 255)' }],
  ['GLOBAL cell',   'gCell',     { display:'flex', flexDirection:'column', alignItems:'center', rowGap:'1px', backgroundColor:'rgb(15, 19, 28)', borderTopWidth:'1px', borderTopColor:'rgba(255, 255, 255, 0.08)', borderRadius:'9px', padding:'10px 0px' }],
  ['GLOBAL value',  'gVal',      { fontSize:'14px', fontWeight:'700', color:'rgb(232, 236, 244)' }],
  ['GLOBAL frac',   'gFrac',     { fontSize:'9px', color:'rgb(91, 104, 128)' }],
  ['hairline rule', 'rule',      { width:'1px', height:'34px', backgroundColor:'rgba(255, 255, 255, 0.09)' }],
  ['set cell',      'cell',      { display:'flex', flexDirection:'column', alignItems:'center', rowGap:'1px', borderRadius:'9px', padding:'10px 0px', borderTopWidth:'0px' }],
  ['set value',     'cellVal',   { fontSize:'14px', fontWeight:'700' }],
  ['set frac',      'cellFrac',  { fontSize:'9px' }],
  ['legend note',   'note',      { fontSize:'11.5px', color:'rgb(75, 86, 114)', lineHeight:'18.4px' }],
];

const FINDERS = `{
  scrim:   () => document.querySelector('[data-pp2="heat-scrim"]'),
  card:    function(){ var s=this.scrim(); return s && s.querySelector(':scope > div'); },
  title:   function(){ var c=this.card(); return [].slice.call(c.querySelectorAll('span'))
             .filter(function(x){ return x.textContent.trim()==='Hold / break heatmap'; })[0]; },
  chip:    function(){ var c=this.card(); return [].slice.call(c.querySelectorAll('span'))
             .filter(function(x){ return getComputedStyle(x).padding==='8px 14px'; })[0]; },
  modeSeg: function(){ var b=this.card().querySelector('[data-pp2="hb-mode"]'); return b && b.parentElement; },
  modeOn:  () => document.querySelector('[data-pp2="hb-mode"][data-v="hold"]'),
  modeOff: () => document.querySelector('[data-pp2="hb-mode"][data-v="break"]'),
  surfSeg: function(){ var b=this.card().querySelector('[data-pp2="hb-surf"]'); return b && b.parentElement; },
  close:   () => document.querySelector('[data-pp2="heat-close"]'),
  grid:    () => document.querySelector('.pp2-hb-grid'),
  subject: function(){ var c=this.card(); return [].slice.call(c.querySelectorAll('span'))
             .filter(function(x){ var s=getComputedStyle(x); return s.fontSize==='15px' && s.fontWeight==='700'; })[0]; },
  pill:    function(){ var c=this.card(); return [].slice.call(c.querySelectorAll('span'))
             .filter(function(x){ return getComputedStyle(x).padding==='7px 14px'; })[0]; },
  head:    function(){ var g=this.grid(); return g && g.children[1]; },
  rowLabel:function(){ var g=this.grid(); return g && g.children[8] && g.children[8].children[0]; },
  rowSub:  function(){ var g=this.grid(); return g && g.children[8] && g.children[8].children[1]; },
  gCell:   function(){ var g=this.grid(); return g && g.children[9]; },
  gVal:    function(){ var c=this.gCell(); return c && c.children[0]; },
  gFrac:   function(){ var c=this.gCell(); return c && c.children[1]; },
  rule:    function(){ var g=this.grid(); return g && g.children[10] && g.children[10].children[0]; },
  cell:    () => document.querySelector('.pp2-hb-grid [data-pp2="hb-cell"]'),
  cellVal: function(){ var c=this.cell(); return c && c.children[0]; },
  cellFrac:function(){ var c=this.cell(); return c && c.children[1]; },
  note:    function(){ var c=this.card(); return c.children[c.children.length-1]; }
}`;

const rows = await ev(`(function(){
  var F = ${FINDERS};
  var SPEC = ${JSON.stringify(SPEC)};
  return SPEC.map(function(s){
    var el=null; try { el = F[s[1]](); } catch(e) { el=null; }
    if (!el) return { el:s[0], missing:true };
    var c = getComputedStyle(el), diffs=[], n=0;
    Object.keys(s[2]).forEach(function(p){ n++;
      if (String(c[p]) !== String(s[2][p])) diffs.push(p + ': export ' + s[2][p] + ' | ours ' + c[p]); });
    return { el:s[0], n:n, diffs:diffs };
  });
})()`);
let tot=0, bad=0;
console.log('\n' + '='.repeat(88));
console.log('COMPUTED-STYLE DIFF TABLE — hold/break heatmap vs Player Stat Boxes.dc.html');
console.log('='.repeat(88));
for (const r of rows) {
  if (r.missing) { console.log(`MISSING  ${r.el}`); bad++; continue; }
  tot += r.n;
  if (!r.diffs.length) console.log(`match    ${r.el.padEnd(16)} ${r.n} props`);
  else { bad += r.diffs.length; console.log(`DIFFER   ${r.el.padEnd(16)} ${r.n} props`);
    r.diffs.forEach(d => console.log(`           ${d}`)); }
}
console.log(`\n${tot} properties compared, ${bad} differ.`);

// ── row-by-row geometry, device px, against the export's declared tracks ────
const geom = await ev(`(function(){
  var g=document.querySelector('.pp2-hb-grid');
  var cs=getComputedStyle(g);
  var R=function(e){var r=e.getBoundingClientRect();return {x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)};};
  var card=document.querySelector('[data-pp2="heat-scrim"] > div');
  var kids=[].slice.call(g.children);
  var cells=[].slice.call(g.querySelectorAll('[data-pp2="hb-cell"]'));
  return {
    cardRect:R(card),
    tracks:cs.gridTemplateColumns, gap:cs.gap,
    headY:R(kids[1]).y,
    rowCount:(kids.length-8)/8,
    globalW:+R(kids[9]).w.toFixed(1), ruleH:+R(kids[10].children[0]).h.toFixed(1),
    cellW:+R(cells[0]).w.toFixed(1), cellH:+R(cells[0]).h.toFixed(1),
    cellPitch:+(R(cells[1]).x-R(cells[0]).x).toFixed(1),
    labelW:+R(kids[8]).w.toFixed(1),
    tiers:(function(){var o={full:0,muted:0,raw:0,dead:0};cells.forEach(function(c){
      var bg=getComputedStyle(c).backgroundColor;
      if(/0\\.0?2\\)/.test(bg))o.dead++; else if(/255, 255, 255, 0\\.03\\)/.test(bg))o.raw++;
      else if(/0\\.07\\)/.test(bg))o.muted++; else o.full++; });return o;})(),
    fills:(function(){var s={};cells.forEach(function(c){var b=getComputedStyle(c).backgroundColor;s[b]=(s[b]||0)+1;});return s;})()
  };
})()`);
console.log('\nROW-BY-ROW GEOMETRY (CSS px at the export\'s own layout scale)');
console.log(JSON.stringify(geom, null, 1));

const shot = await send('Page.captureScreenshot', { format:'png', captureBeyondViewport:true,
  clip: Object.assign({ scale: 1 }, (function(r){ return { x:r.x, y:r.y, width:r.w, height:r.h }; })(geom.cardRect)) });
fs.writeFileSync(process.env.HB_OUT || '/tmp/ours-heatmap.png', Buffer.from(shot.result.data, 'base64'));
console.log('\nwrote', process.env.HB_OUT || '/tmp/ours-heatmap.png');
console.log('jsErrors:', jsErrors.length ? jsErrors : 'none');
ws.close(); chrome.kill(); process.exit(0);
