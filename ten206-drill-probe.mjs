// TEN-206 §5.2 — Career record modal drills + minimal bars.
// Drives a real headless Chrome over CDP. BASE is passed in so the same probe
// runs against the local worktree and against the deployed site unchanged.
import { spawn } from 'node:child_process';
const BASE = process.argv[2] || 'http://127.0.0.1:8899';
const URL_ = BASE + '/bsp-consult-dashboard.html';
const WHO = process.argv[3] || 'Djokovic';
const PORT = 9377;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
   '--user-data-dir=/tmp/ten206-drill', '--window-size=1512,982', '--force-device-scale-factor=2', 'about:blank'],
  { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tws() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const t = (await r.json()).find((x) => x.type === 'page');
      if (t?.webSocketDebuggerUrl) return t.webSocketDebuggerUrl; } catch {}
    await sleep(500);
  }
  throw new Error('no target');
}
const ws = new WebSocket(await tws());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => { const i = ++id; return new Promise((res) => { pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); }); };
async function ev(e, a = true) {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: a, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result?.result?.value;
}
await send('Page.enable'); await send('Runtime.enable');
// Never read a cached bundle — a shipped fix reads as broken otherwise.
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', { source:
  `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,get(){return _b;},set(v){if(v){v.requireVerified=()=>true;v.requireAuth=()=>true;}_b=v;}});window.__e=[];window.addEventListener('error',e=>window.__e.push(String(e.message)));})();` });
await send('Page.navigate', { url: URL_ });
for (let i = 0; i < 150; i++) {
  const n = await ev(`(typeof playerProfiles!=='undefined'&&playerProfiles)?Object.keys(playerProfiles).length:0`, false);
  if (n > 50) break; await sleep(1000);
}

const key = await ev(`(function(){
  document.querySelectorAll('.tabpage').forEach(p=>p.classList.toggle('active',p.dataset.page==='players'));
  var k=Object.keys(playerProfiles).find(k=>new RegExp(${JSON.stringify(WHO)}).test(playerProfiles[k].name))||Object.keys(playerProfiles)[0];
  showPlayerProfile(k); return k; })()`);
for (let i = 0; i < 30; i++) { if (await ev(`!!(window.marketEdge&&window.marketEdge['${key}'])`, false)) break; await sleep(1000); }

// open the Career record modal
await ev(`(function(){var b=document.querySelector('[data-pp2="box"][data-box="career"]');b.click();return 1;})()`);
await sleep(300);

const HELP = `
window.__q=function(sel){return [...document.querySelectorAll(sel)];};
window.__drill=function(){
  var card=[...document.querySelectorAll('div')].filter(function(d){
    return /border:\\s*1px solid rgba\\(91,155,255,\\s*0\\.3\\)/.test(d.getAttribute('style')||'');});
  if(!card.length) return null;
  var c=card[card.length-1];
  var kids=c.firstElementChild.children;
  var scroll=c.querySelector('[data-pp2-drill-scroll]');
  var grid=c.querySelector('[data-pp2-drill-grid]');
  return {title:kids[0].textContent.trim(), record:kids[1].textContent.trim(),
    note:(c.querySelector('[data-pp2-drill-note]')||{}).textContent,
    painted: grid? [...grid.children].filter(function(x){return /width:8px;height:8px/.test(x.getAttribute('style')||'');}).length : 0,
    sheetRows: grid? grid.querySelectorAll('[data-pp2="sheet"]').length : 0,
    scrollH: scroll? scroll.scrollHeight : 0, clientH: scroll? scroll.clientHeight : 0,
    style:(function(){var cs=getComputedStyle(c);return {bg:cs.backgroundColor,border:cs.borderTopWidth+' '+cs.borderTopColor,radius:cs.borderTopLeftRadius,pad:cs.paddingTop+' '+cs.paddingRight};})()};
};
window.__cells=function(){return __q('[data-pp2="career-cell"]').map(function(el){
  return {v:el.getAttribute('data-v'), text:el.textContent.trim(), cursor:getComputedStyle(el).cursor, cls:el.className};});};
1;`;
await ev(HELP, false);

const report = { base: BASE, key, name: await ev(`playerProfiles['${key}'].name`, false) };
report.renderer = await ev(`document.querySelector('#playerProfileView .pp2-main')?'v2':'NONE'`, false);

// ── item 3 · minimal bars ────────────────────────────────────────────────────
report.bars = await ev(`(function(){
  var rows=__q('[data-pp2="career-surf"]');
  return rows.map(function(r){
    var track=r.children[1], fill=track.firstElementChild;
    var t=getComputedStyle(track);
    var f=fill?getComputedStyle(fill):null;
    return {label:r.children[0].firstElementChild.textContent.trim(),
      meta:r.children[0].children[1].textContent.trim(),
      track:{h:t.height,r:t.borderTopLeftRadius,bg:t.backgroundColor,border:t.borderTopWidth,shadow:t.boxShadow,img:t.backgroundImage},
      fill:f?{h:f.height,r:f.borderTopLeftRadius,bg:f.backgroundColor,w:fill.style.width,img:f.backgroundImage}:null,
      col:getComputedStyle(r).gridTemplateColumns, align:getComputedStyle(r).alignItems};});})()`);

// ── items 1+2+4 · click EVERY record, compare cell vs drill ───────────────────
report.clicks = [];
const cells = await ev(`__cells()`);
for (const c of cells) {
  const row = await ev(`(function(){
    var el=__q('[data-pp2="career-cell"]').filter(function(x){return x.getAttribute('data-v')===${JSON.stringify(c.v)};})[0];
    if(!el) return {v:${JSON.stringify(c.v)},err:'gone'};
    // read the affordance BEFORE the click — repaint() replaces the node, and a
    // detached node returns an empty computed style, which reads as "no pointer"
    var cur=getComputedStyle(el).cursor, cls=el.className;
    el.click();
    var d=__drill();
    return {v:${JSON.stringify(c.v)}, cellText:el.textContent.trim(), cursor:cur, cls:cls,
      open:!!d, title:d&&d.title, record:d&&d.record, note:d&&d.note, painted:d&&d.painted,
      sheetRows:d&&d.sheetRows, style:d&&d.style,
      drills:__q('[data-pp2-drill-scroll]').length + (__drill()&&!__drill().painted?1:0)};})()`);
  report.clicks.push(row);
  // close again so the next click starts clean
  await ev(`(function(){var el=__q('[data-pp2="career-cell"]').filter(function(x){return x.getAttribute('data-v')===${JSON.stringify(c.v)};})[0]; if(el) el.click(); return 1;})()`);
}

// ── item 1g · same cell closes, another switches, only one open ──────────────
report.interaction = await ev(`(function(){
  var get=function(v){return __q('[data-pp2="career-cell"]').filter(function(x){return x.getAttribute('data-v')===v;})[0];};
  var vs=__cells().map(function(c){return c.v;});
  var a=vs.filter(function(v){return /\\|$/.test(v)&&!/^career/.test(v);})[0];
  var b=vs.filter(function(v){return /\\|(hard|clay|grass)$/.test(v);})[0];
  var o={};
  get(a).click(); o.afterOpen=!!__drill(); o.openTitle=__drill()&&__drill().title;
  get(a).click(); o.sameCellCloses=!__drill();
  get(a).click(); get(b).click();
  o.switched=__drill()&&__drill().title;
  o.onlyOne=__q('[data-pp2-drill-scroll]').length;
  // a Close button dismisses it
  var cl=[...document.querySelectorAll('[data-pp2="career-drill-close"]')];
  o.closeButtons=cl.length; if(cl.length) cl[0].click();
  o.afterCloseBtn=!__drill();
  return o;})()`);

// ── item 1f · dash cells are inert ───────────────────────────────────────────
report.inert = await ev(`(function(){
  var dashes=__q('#playerProfileView div').filter(function(d){
    return d.textContent.trim()==='\\u2014' && /font-variant-numeric:tabular-nums/.test(d.getAttribute('style')||'');});
  return {n:dashes.length,
    clickable:dashes.filter(function(d){return d.getAttribute('data-pp2')==='career-cell';}).length,
    pointer:dashes.filter(function(d){return getComputedStyle(d).cursor==='pointer';}).length,
    hoverClass:dashes.filter(function(d){return /pp2-crec/.test(d.className);}).length};})()`);

// ── item 2e · performance + reachability of "All matches · career" ───────────
report.perf = await ev(`(function(){
  var el=__q('[data-pp2="career-cell"]').filter(function(x){return x.getAttribute('data-v')==='career|';})[0];
  if(!el) return {err:'no career Total cell'};
  var t0=performance.now(); el.click(); var t1=performance.now();
  var d=__drill();
  return {ms:Math.round((t1-t0)*10)/10, title:d.title, record:d.record, note:d.note, painted:d.painted};})()`);

report.scroll = await ev(`(async function(){
  var sc=document.querySelector('[data-pp2-drill-scroll]'); if(!sc) return {err:'no scroll container'};
  var pages=0, last=-1;
  for(var i=0;i<60;i++){
    sc.scrollTop=sc.scrollHeight;
    await new Promise(function(r){setTimeout(r,60);});
    var n=__drill().painted;
    if(n===last) break; last=n; pages++;
  }
  return {pages:pages, painted:__drill().painted, note:__drill().note, scrollH:sc.scrollHeight};})()`);

report.errors = await ev(`window.__e`, false);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
process.exit(0);
