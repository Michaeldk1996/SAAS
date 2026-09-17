// TEN-206 §5.4 · drives the Calendar record modal in a real headless Chrome and
// READS the numbers back out of the DOM. A screenshot only proves it painted;
// this proves the published figures are the ones the model computed.
//
// Usage: node ten206-cal-probe.mjs [baseURL] [playerKey]
import { spawn } from 'node:child_process';
const BASE = process.argv[2] || 'http://127.0.0.1:8477';
const KEY = process.argv[3] || '1980';
const PORT = 9361 + (Number(process.env.PROBE_OFFSET) || 0);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=/tmp/ten206-cal-${PORT}`, '--force-device-scale-factor=2',
    '--window-size=1512,982', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tws() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const t = (await r.json()).find(x => x.type === 'page');
      if (t?.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
    } catch { /* chrome not up yet */ }
    await sleep(500);
  }
  throw new Error('no CDP target');
}
const ws = new WebSocket(await tws());
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (method, params = {}) => {
  const i = ++id;
  return new Promise(res => { pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
};
async function ev(expr, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result?.result?.value;
}
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
// Memory: always setCacheDisabled in CDP — a cached bundle has faked a "verified"
// read before.
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride',
  { width: 1512, height: 982, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,
    get(){return _b;},set(v){if(v){v.requireVerified=()=>true;v.requireAuth=()=>true;}_b=v;}});
    window.__e=[];window.addEventListener('error',e=>window.__e.push(String(e.message)));})();`
});
await send('Page.navigate', { url: `${BASE}/bsp-consult-dashboard.html?cb=cal${Date.now()}` });
for (let i = 0; i < 150; i++) {
  const n = await ev(`(typeof playerProfiles!=='undefined'&&playerProfiles)?Object.keys(playerProfiles).length:0`);
  if (n > 100) break;
  await sleep(500);
}
await ev(`(function(){document.querySelectorAll('.tabpage').forEach(p=>p.classList.toggle('active',p.dataset.page==='players'));
  showPlayerProfile('${KEY}');})()`);
// The modal needs BOTH lazy shards; reading before they land measures the
// pre-fetch state and calls it the answer.
for (let i = 0; i < 40; i++) {
  const ok = await ev(`!!(window.marketEdge&&window.marketEdge['${KEY}']) &&
    !!(window.careerHistory&&window.careerHistory['${KEY}']&&window.careerHistory['${KEY}'].length)`);
  if (ok) break;
  await sleep(500);
}
await ev(`document.querySelector('[data-pp2="box"][data-box="season"]').click()`);
await sleep(400);

const read = `(function(){
  const V=document.getElementById('playerProfileView');
  const card=V.querySelector('[data-pp2="card"]');
  const o={};
  o.subtitle=[...card.querySelectorAll('div')].map(d=>d.textContent)
    .find(t=>/Where in the calendar/.test(t))||null;
  if(o.subtitle) o.subtitle=o.subtitle.split('\\n')[0].trim().slice(0,160);
  // tiles: the four bordered boxes in the first 4-col grid
  const tileGrid=[...card.querySelectorAll('div')].find(d=>/repeat\\(4,minmax\\(0,1fr\\)\\)/.test(d.style.gridTemplateColumns||'')
    || getComputedStyle(d).gridTemplateColumns.split(' ').length===4);
  o.tiles=tileGrid?[...tileGrid.children].map(t=>[...t.children].map(s=>s.textContent.trim())):null;
  // grid cells
  const cells=[...card.querySelectorAll('[data-pp2="cal-cell"]')];
  o.cellCount=cells.length;
  let w=0,l=0;
  cells.forEach(c=>{const m=/^(\\d+)–(\\d+)$/.exec(c.textContent.trim());if(m){w+=+m[1];l+=+m[2];}});
  o.cellW=w;o.cellL=l;o.cellTotal=w+l;
  o.emptyMonths=[...card.querySelectorAll('span')].filter(s=>s.textContent.trim()==='·'&&!s.hasAttribute('data-pp2')).length;
  o.yearHeader=!!([...card.querySelectorAll('span')].find(s=>s.textContent.trim()==='Year'));
  // footer rows
  const lab=t=>[...card.querySelectorAll('span')].find(s=>s.textContent.trim()===t);
  o.footLabels={};['Month','n','Yield','Vs other months','Consistent','Swing','Best swing','Worst swing','Surface spread']
    .forEach(t=>{o.footLabels[t]=!!lab(t);});
  // the N row's own cells, to compare against the column sums
  const nLab=lab('n');
  if(nLab){const sibs=[];let x=nLab.nextElementSibling;
    for(let i=0;i<12&&x;i++){sibs.push(x.textContent.trim());x=x.nextElementSibling;}
    o.nRow=sibs;o.nRowSum=sibs.reduce((a,v)=>a+(+v||0),0);}
  const yLab=lab('Yield');
  if(yLab){const sibs=[];let x=yLab.nextElementSibling;
    for(let i=0;i<12&&x;i++){sibs.push(x.textContent.trim());x=x.nextElementSibling;}
    o.yieldRow=sibs;o.yieldColour=getComputedStyle(yLab.nextElementSibling).color;}
  const gLab=lab('Vs other months');
  if(gLab){const sibs=[];let x=gLab.nextElementSibling;
    for(let i=0;i<12&&x;i++){sibs.push(x.textContent.trim());x=x.nextElementSibling;}
    o.gapRow=sibs;
    const cs=getComputedStyle(gLab.nextElementSibling);o.gapSize=cs.fontSize;o.gapWeight=cs.fontWeight;}
  const cLab=lab('Consistent');
  if(cLab){o.consFirst=cLab.nextElementSibling?cLab.nextElementSibling.textContent.trim():null;
    o.consSegs=cLab.nextElementSibling?cLab.nextElementSibling.querySelectorAll('span span').length:0;}
  // computed styles of the structural elements the founder listed
  const grid=[...card.querySelectorAll('div')].find(d=>getComputedStyle(d).minWidth==='880px');
  if(grid){const cs=getComputedStyle(grid);
    o.gridTracks=cs.gridTemplateColumns;o.gridGap=cs.columnGap+' / '+cs.rowGap;o.gridMin=cs.minWidth;}
  const scroller=grid&&grid.parentElement?getComputedStyle(grid.parentElement):null;
  if(scroller){o.scrollMax=scroller.maxHeight;o.scrollY=scroller.overflowY;}
  if(cells[0]){const cs=getComputedStyle(cells[0]);
    o.cellStyle={font:cs.fontSize,pad:cs.padding,radius:cs.borderRadius,align:cs.textAlign,bg:cs.backgroundColor};}
  o.errors=window.__e;
  return JSON.stringify(o);})()`;
const before = JSON.parse(await ev(read));
console.log('── CLOSED STATE ──');
console.log(JSON.stringify(before, null, 1));

// open a drill on the first clickable cell, read it, then close it with the ×
const drill = await ev(`(function(){
  const V=document.getElementById('playerProfileView');
  const cells=[...V.querySelectorAll('[data-pp2="cal-cell"]')];
  const target=cells.find(c=>{const m=/^(\\d+)–(\\d+)$/.exec(c.textContent.trim());return m&&(+m[1]+ +m[2])>=6;})||cells[0];
  const label=target.dataset.v, text=target.textContent.trim();
  target.click();
  const card=V.querySelector('[data-pp2="card"]');
  const box=[...card.querySelectorAll('div')].find(d=>/rgba\\(91, 155, 255, 0\\.3\\)/.test(getComputedStyle(d).borderColor));
  const o={cell:label,cellText:text,opened:!!box};
  if(box){
    o.header=box.firstElementChild.textContent.replace(/\\s+/g,' ').trim();
    o.eyebrow=box.children[1].textContent.replace(/\\s+/g,' ').trim().slice(0,200);
    o.hasClose=!!box.querySelector('[data-pp2="cal-cell-close"]');
    const rows=[...box.querySelectorAll('div > div > div')].filter(d=>getComputedStyle(d).display==='grid');
    o.rowCount=rows.length;
    o.sample=rows.slice(0,4).map(r=>[...r.children].map(s=>s.textContent.trim()));
    o.rowTracks=rows[0]?getComputedStyle(rows[0]).gridTemplateColumns:null;
    o.rowGap=rows[0]?getComputedStyle(rows[0]).columnGap:null;
    o.sheetHooks=[...box.querySelectorAll('[data-pp2="sheet"]')].length;
    o.pricedInHeader=/(\\d+) priced/.exec(o.header)?.[1]||null;
    o.pricedRows=rows.filter(r=>r.children[7]&&r.children[7].textContent.trim()!=='—').length;
    o.badRounds=o.sample.map(s=>s[1]).filter(r=>/Round|final|Quarter/i.test(r));
  }
  return JSON.stringify(o);})()`);
console.log('── DRILL OPEN ──');
console.log(drill);

const closed = await ev(`(function(){
  const V=document.getElementById('playerProfileView');
  const b=V.querySelector('[data-pp2="cal-cell-close"]');
  if(!b) return 'no close button';
  b.click();
  const card=V.querySelector('[data-pp2="card"]');
  const still=[...card.querySelectorAll('div')].some(d=>/rgba\\(91, 155, 255, 0\\.3\\)/.test(getComputedStyle(d).borderColor));
  return still?'STILL OPEN':'closed';})()`);
console.log('── × CLOSE ──', closed);

// surface filter
const clay = await ev(`(function(){
  const V=document.getElementById('playerProfileView');
  const b=[...V.querySelectorAll('[data-pp2="cal-surface"]')].find(x=>x.textContent.trim()==='Clay');
  if(!b) return 'no clay segment';
  b.click();
  const card=V.querySelector('[data-pp2="card"]');
  const cells=[...card.querySelectorAll('[data-pp2="cal-cell"]')];
  let w=0,l=0;cells.forEach(c=>{const m=/^(\\d+)–(\\d+)$/.exec(c.textContent.trim());if(m){w+=+m[1];l+=+m[2];}});
  return JSON.stringify({cells:cells.length,total:w+l,record:w+'-'+l});})()`);
console.log('── CLAY FILTER ──', clay);

const ind = await ev(`(function(){
  const V=document.getElementById('playerProfileView');
  const b=[...V.querySelectorAll('[data-pp2="cal-surface"]')].find(x=>x.textContent.trim()==='Indoors');
  b.click();
  const card=V.querySelector('[data-pp2="card"]');
  return card.textContent.includes('No per-match court type on record')?'refused with a reason':'RENDERED A GRID';})()`);
console.log('── INDOORS ──', ind);
console.log('── PAGE ERRORS ──', JSON.stringify(await ev('JSON.stringify(window.__e)')));
// A PRICED month, chosen by data rather than by position: the header's yield and
// priced count must equal a direct sum of the rows under it.
const priced = await ev(`(function(){
  const V=document.getElementById('playerProfileView');
  const b=[...V.querySelectorAll('[data-pp2="cal-surface"]')].find(x=>x.textContent.trim()==='All surfaces');
  if(b) b.click();
  const cells=[...V.querySelectorAll('[data-pp2="cal-cell"]')];
  const t=cells.find(c=>/^20(1[5-9]|2[0-4])\\|/.test(c.dataset.v)&&/–/.test(c.textContent));
  if(!t) return 'no candidate cell';
  t.click();
  const card=V.querySelector('[data-pp2="card"]');
  const box=[...card.querySelectorAll('div')].find(d=>/rgba\\(91, 155, 255, 0\\.3\\)/.test(getComputedStyle(d).borderColor));
  const rows=[...box.querySelectorAll('div > div > div')].filter(d=>getComputedStyle(d).display==='grid').slice(1);
  let sum=0,n=0;
  rows.forEach(r=>{const v=r.children[7].textContent.trim();
    if(v!=='—'){n++;sum+=parseFloat(v.replace('−','-'));}});
  return JSON.stringify({cell:t.dataset.v,cellText:t.textContent.trim(),
    header:box.firstElementChild.textContent.replace(/\\s+/g,' ').trim(),
    rows:rows.length,pricedRows:n,rowPnlSum:Math.round(sum*100)/100,
    unpricedShowDash:rows.filter(r=>r.children[7].textContent.trim()==='—')
      .every(r=>r.children[5].textContent.trim()==='—'&&r.children[6].textContent.trim()==='—')});})()`);
console.log('── PRICED DRILL ──', priced);

// findings strip + the footnote, read as TEXT so the wording is checked too
const strip = await ev(`(function(){
  const V=document.getElementById('playerProfileView');
  const b=[...V.querySelectorAll('[data-pp2="cal-surface"]')].find(x=>x.textContent.trim()==='All surfaces');
  if(b) b.click();
  const card=V.querySelector('[data-pp2="card"]');
  const lab=t=>[...card.querySelectorAll('span')].find(s=>s.textContent.trim()===t);
  const cell=t=>{const l=lab(t);return l&&l.parentElement?l.parentElement.textContent.replace(/\\s+/g,' ').trim():null;};
  const note=[...card.querySelectorAll('div')].map(d=>d.textContent)
    .filter(t=>/Grid cells are W/.test(t)).pop();
  const swing=[...card.querySelectorAll('span')].filter(s=>/^(Hard|Clay|Grass)$/.test(s.textContent.trim())
    && s.parentElement && /span/.test(s.parentElement.style.gridColumn||''));
  return JSON.stringify({
    bestSwing:cell('Best swing'), worstSwing:cell('Worst swing'), spread:cell('Surface spread'),
    swingSpans:swing.map(s=>s.textContent.trim()+':'+(s.parentElement.style.gridColumn||'')),
    note:note?note.replace(/\\s+/g,' ').trim():null});})()`);
console.log('── FINDINGS + FOOTNOTE ──', strip);

// Screenshots. Five states at 1512x982 DPR 2, written next to this script so
// they can be attached to the report rather than described.
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('/tmp/ten206-cal-shots', { recursive: true });
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const d = r.result?.data;
  if (d) writeFileSync(`/tmp/ten206-cal-shots/${KEY}-${name}.png`, Buffer.from(d, 'base64'));
  return !!d;
}
await ev(`(function(){const V=document.getElementById('playerProfileView');
  const b=[...V.querySelectorAll('[data-pp2="cal-surface"]')].find(x=>x.textContent.trim()==='All surfaces');
  if(b)b.click();const c=V.querySelector('[data-pp2="cal-cell-close"]');if(c)c.click();
  V.querySelector('[data-pp2="card"]').scrollTop=0;window.scrollTo(0,0);})()`);
await sleep(300); await shot('1-top');
// Scroll the element that actually scrolls, found by measurement rather than
// assumed: card.scrollTop=520 was a no-op and produced a byte-identical shot.
const SCROLLER = `(function(){const V=document.getElementById('playerProfileView');
  return [...V.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+20
    && /auto|scroll/.test(getComputedStyle(e).overflowY)).map(e=>e.className||e.tagName);})()`;
console.log('── SCROLLERS ──', JSON.stringify(await ev(SCROLLER)));
await ev(`(function(){const V=document.getElementById('playerProfileView');
  const els=[...V.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+20
    && /auto|scroll/.test(getComputedStyle(e).overflowY));
  els.forEach(e=>{e.scrollTop=Math.min(400,e.scrollHeight-e.clientHeight);});return els.length;})()`);
await sleep(300); await shot('2-grid');
await ev(`(function(){const c=[...document.querySelectorAll('[data-pp2="cal-cell"]')]
  .find(x=>/^(\\d+)–(\\d+)$/.test(x.textContent.trim())&&x.dataset.v.startsWith('2024'));if(c)c.click();})()`);
await sleep(300); await shot('3-drill');
await ev(`(function(){const V=document.getElementById('playerProfileView');
  const els=[...V.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+20
    && /auto|scroll/.test(getComputedStyle(e).overflowY));
  els.forEach(e=>{e.scrollTop=e.scrollHeight;});})()`);
await sleep(300); await shot('4-footer');
await ev(`(function(){const b=[...document.querySelectorAll('[data-pp2="cal-surface"]')]
  .find(x=>x.textContent.trim()==='Clay');if(b)b.click();
  const V=document.getElementById('playerProfileView');
  [...V.querySelectorAll('*')].forEach(e=>{if(e.scrollTop)e.scrollTop=0;});})()`);
await sleep(300); await shot('5-clay');
console.log('── SHOTS ── /tmp/ten206-cal-shots/' + KEY + '-{1-top,2-grid,3-drill,4-footer,5-clay}.png');

ws.close(); chrome.kill();
