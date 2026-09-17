// TEN-206 §5.4 Streaks — re-verify (a)-(d): render the PROTOTYPE and the STAGED
// page at identical viewport/DPR in one headless Chrome, diff computed styles
// element by element, drive the scripted interactions, and write 50% overlays.
//
// A read proves correctness; a screenshot only proves it painted. Every row of
// the diff table below is a getComputedStyle() read on BOTH documents.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT_HTTP = Number(process.env.HTTP_PORT || 8974);
const PORT_CDP = Number(process.env.CDP_PORT || 9364);
const OUT = process.env.OUT_DIR || '.streaks-shots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PROTO = '/.ten206-design/design_handoff_player_profile/Player Stat Boxes.dc.html';
const LIVE = process.env.LIVE_URL || `http://127.0.0.1:${PORT_HTTP}/bsp-consult-dashboard.html`;

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', `--remote-debugging-port=${PORT_CDP}`, '--no-first-run',
    '--no-default-browser-check', `--user-data-dir=/tmp/ten206-streaks-${PORT_CDP}-${Date.now()}`,
    '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

async function tws() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT_CDP}/json/list`);
      const t = (await r.json()).find(x => x.type === 'page');
      if (t?.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('no CDP target');
}
const ws = new WebSocket(await tws());
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
async function ev(expr, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(JSON.stringify(ex).slice(0, 500));
  return r.result?.result?.value;
}
async function shoot(name, clip) {
  const p = { format: 'png', captureBeyondViewport: true };
  if (clip) p.clip = { ...clip, scale: 1 };
  const r = await send('Page.captureScreenshot', p);
  if (r.result?.data) fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
}
// Bounding box of the Streaks block, measured from the SAME anchor on both
// documents (the "Runs of 5+" tile grid) down to the footnote, so the two crops
// frame the same content and a 50% overlay is meaningful. Blending two
// full-page shots would only show that the dashboard has a sidebar and the
// export does not.
const CLIP = `(function(){
  var all=[].slice.call(document.querySelectorAll('*'));
  var txt=function(e){return (e.textContent||'').replace(/\\s+/g,' ').trim();};
  var cap=all.filter(function(e){return !e.children.length&&/^Runs of 5\\+$/.test(txt(e));})[0];
  if(!cap)return null;
  var box=cap; for(var i=0;i<6&&box;i++){box=box.parentElement;
    if(box&&getComputedStyle(box).borderRadius==='12px')break;}
  var grid=box?box.parentElement:null;
  var fn=all.filter(function(e){return /^Runs count all/.test(txt(e));});
  if(!grid)return null;
  var a=grid.getBoundingClientRect();
  var b=fn.length?fn[0].getBoundingClientRect():a;
  return {x:Math.round(a.left+scrollX),y:Math.round(a.top+scrollY),
    width:Math.round(a.width),height:Math.round(Math.max(a.height,b.bottom-a.top))};
})()`;
// The five states the founder's re-verify (a) names, driven with the SAME
// expressions on both documents so the pair is directly comparable.
const BARS = `(function(){
  var c=[].slice.call(document.querySelectorAll('*')).filter(function(e){
    var s=getComputedStyle(e);
    if(s.height!=='140px'||s.display!=='flex')return false;
    return [].slice.call(e.children).some(function(k){return getComputedStyle(k).width==='6px';});})[0];
  return c?[].slice.call(c.children).filter(function(e){return getComputedStyle(e).width==='6px';}):[];
})()`;
const CLICK = (pick) => `(function(){
  var bars=${BARS};
  var b=(${pick});
  if(!b)return 'none';
  b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
  return 'ok';})()`;
const DESELECT = `(function(){
  var t=[].slice.call(document.querySelectorAll('*')).filter(function(e){
    return !e.children.length&&/^Click a run for its matches$/.test((e.textContent||'').trim());})[0];
  if(t)return 'already';
  var bars=${BARS};
  var on=bars.filter(function(e){var k=[].slice.call(e.children).filter(function(c){
    var bg=getComputedStyle(c).backgroundColor;return bg==='rgb(61, 214, 140)'||bg==='rgb(224, 97, 111)';});
    return k.length;})[0];
  if(on)on.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
  return on?'deselected':'none';})()`;
const SCROLL_END = `(function(){
  var c=[].slice.call(document.querySelectorAll('*')).filter(function(e){
    return e.scrollWidth>e.clientWidth+50&&getComputedStyle(e).overflowX==='auto';})[0];
  if(!c)return 'none'; c.scrollLeft=c.scrollWidth; return c.scrollLeft;})()`;
async function states(side, tag){
  await ev(DESELECT); await sleep(500);
  await shootBlock(`s1-top-${side}-${tag}`);
  await ev(SCROLL_END); await sleep(400);
  await shootBlock(`s2-scrolled-${side}-${tag}`);
  await ev(CLICK(`bars.filter(function(e){return /^W/.test(e.getAttribute('title')||'');})[0]||bars[0]`));
  await sleep(600); await shootBlock(`s3-winrun-${side}-${tag}`);
  await ev(CLICK(`bars.filter(function(e){return /^L/.test(e.getAttribute('title')||'');})[0]||bars[1]`));
  await sleep(600); await shootBlock(`s4-lossrun-${side}-${tag}`);
  await shootBlock(`s5-follows-${side}-${tag}`);
}
async function shootBlock(name){
  const c = await ev(CLIP);
  if(!c||!c.width){ console.log(`    (no clip for ${name})`); return null; }
  await shoot(name, c);
  return c;
}
async function viewport(w, h, dpr) {
  await send('Emulation.setDeviceMetricsOverride',
    { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
}

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });

// ─── PROTOTYPE ───────────────────────────────────────────────────────────────
// The .dc.html renders through support.js; open it, switch to the Streaks tab
// and read the computed style of every element section 1 names.
const SPEC = [
  ['tile box', 'background-color,border-top-color,border-top-width,border-radius,padding-top,padding-left,text-align'],
  ['tile cap', 'font-family,font-size,font-weight,letter-spacing,text-transform,color'],
  ['tile value', 'font-family,font-size,font-weight,line-height,color'],
  ['tile sub', 'font-family,font-size,color'],
  ['timeline eyebrow', 'font-family,font-size,font-weight,letter-spacing,text-transform,color'],
  ['timeline meta', 'font-family,font-size,color'],
  ['chart', 'height,display,align-items,column-gap'],
  ['bar', 'width,flex-grow,flex-shrink,height,flex-direction,cursor'],
  ['mid rule', 'position,top,height,background-color'],
  ['year tick', 'border-left-color,border-left-width,font-family,font-size,font-weight,letter-spacing,color,padding-top,padding-left'],
  ['hint', 'font-family,font-size,letter-spacing,text-transform,color'],
  ['detail box', 'background-color,border-top-color,border-top-width,border-radius,padding-top,padding-left'],
  ['detail title', 'font-size,font-weight'],
  ['detail span', 'font-family,font-size,font-weight,letter-spacing,text-transform,color'],
  ['detail pl', 'font-family,font-size,font-weight,text-align'],
  ['detail grid', 'grid-template-columns,column-gap,row-gap,align-items'],
  ['detail head', 'font-family,font-size,font-weight,letter-spacing,text-transform,color,padding-bottom'],
  ['detail res', 'font-family,font-size,font-weight'],
  ['detail opp', 'font-family,font-size,color'],
  ['detail home', 'font-family,font-size,font-weight,text-align,color'],
  ['detail away', 'font-family,font-size,text-align,color'],
  ['follows card', 'background-color,border-top-color,border-top-width,border-radius,padding-top,padding-left'],
  ['follows eyebrow', 'font-family,font-size,font-weight,letter-spacing,text-transform,color'],
  ['follows grid', 'grid-template-columns,column-gap'],
  ['follows head', 'font-family,font-size,font-weight,letter-spacing,text-transform,color,padding-bottom'],
  ['follows state', 'font-size,font-weight,letter-spacing,color'],
  ['follows rec', 'font-family,font-size,color'],
  ['follows rate', 'font-family,font-size,color'],
  ['follows bar', 'height,border-radius,background-color'],
  ['follows n', 'font-family,font-size,color'],
  ['follows yield', 'font-family,font-size'],
  ['follows vs', 'font-family,font-size,font-weight'],
  ['follows base state', 'font-size,font-weight,color,border-top-color'],
  ['follows note', 'font-size,line-height,color'],
  ['footnote', 'font-size,line-height,color,max-width']
];

// One picker per row, written twice — once against the prototype's DOM, once
// against ours — so the table compares the SAME visual element, not the same
// selector. Anything not present returns null and the row reads "absent".
const PICK_PROTO = `(function(){
  var q=function(s){return document.querySelector(s);};
  var all=function(s){return [].slice.call(document.querySelectorAll(s));};
  var byText=function(sel,re){return all(sel).filter(function(e){return re.test(e.textContent||'');})[0]||null;};
  var tile=byText('div','^\\\\s*Runs of 5\\\\+');
  var tileBox=tile;
  var eb=byText('span','Run timeline');
  var chart=q('div[style*="height:140px"]');
  var bar=chart?chart.querySelector('span[onclick],span[style*="width:6px"]'):null;
  var mid=chart?chart.querySelector('span[style*="top:50%"]'):null;
  var ticks=chart&&chart.parentElement?chart.parentElement.querySelector('div[style*="display:flex"]>span[style*="border-left"]'):null;
  var det=q('div[style*="rgba(91,155,255,0.3)"]');
  var grid=det?det.querySelector('div[style*="grid-template-columns"]'):null;
  var fcard=byText('div','What follows a run');
  fcard=fcard?fcard.parentElement:null;
  var fgrid=fcard?fcard.querySelector('div[style*="118px"]'):null;
  return {__ids:1};
})()`;

// Rather than two hand-written pickers (which drift), both documents are probed
// with ONE function that tags elements by role using role-specific anchors.
const TAGGER = `function(doc){
  var all=function(s){return [].slice.call(doc.querySelectorAll(s));};
  var txt=function(e){return (e.textContent||'').replace(/\\s+/g,' ').trim();};
  var byText=function(sel,re){return all(sel).filter(function(e){return re.test(txt(e));});};
  // A text anchor must be a LEAF. Without this the first pass matched the
  // enclosing card (whose text also starts with the eyebrow) and then compared
  // the wrong element on both sides — a diff table that agrees about the wrong
  // node is worse than no table.
  var leaf=function(re){return all('*').filter(function(e){
    return !e.children.length&&re.test(txt(e));})[0]||null;};
  var cs=function(e){return doc.defaultView.getComputedStyle(e);};
  // The prototype renders through React and wraps each text node in an extra
  // <span>; our renderer emits the span directly. Fixed-depth parentElement
  // walks therefore compare different nodes on the two sides. Every structural
  // anchor below CLIMBS to the nearest ancestor that satisfies a predicate, so
  // the wrapper depth stops mattering.
  var up=function(e,pred,max){for(var i=0;i<(max||6)&&e;i++){e=e.parentElement;
    if(e&&pred(e,cs(e)))return e;}return null;};
  var out={};
  // TILES — the leaf caption, then its own box
  var cap=leaf(/^Runs of 5\\+$/);
  var tb=cap?up(cap,function(e,s){return s.borderRadius==='12px';}):null;
  out['tile box']=tb;
  if(tb){var kids=[].slice.call(tb.children);
    // leaf-normalise: a wrapper with exactly one child IS that child visually
    var deep=function(e){while(e&&e.children.length===1&&!txt(e.children[0]).length===false)e=e.children[0];return e;};
    out['tile cap']=deep(kids[0]||null); out['tile value']=deep(kids[1]||null);
    out['tile sub']=deep(kids[2]||null);}
  // TIMELINE
  var eb=leaf(/^Run timeline/); out['timeline eyebrow']=eb;
  var meta=leaf(/runs · longest/); out['timeline meta']=meta;
  // The chart is the 140px flex box that actually CONTAINS a 6px bar — matching
  // on height+display alone picked an unrelated 140px flex row in the export.
  var chart=all('*').filter(function(e){var s=cs(e);
    if(s.height!=='140px'||s.display!=='flex')return false;
    return [].slice.call(e.children).some(function(c){return cs(c).width==='6px';});})[0]||null;
  out['chart']=chart;
  if(chart){
    var ch=[].slice.call(chart.children);
    out['mid rule']=ch.filter(function(e){var s=cs(e);
      return s.position==='absolute'&&s.height==='1px';})[0]||null;
    out['bar']=ch.filter(function(e){return cs(e).width==='6px';})[0]||null;
  }
  // The year tick is the leaf whose text is a bare 4-digit year and which
  // carries a left rule — found by role, not by walking siblings.
  // NOT leaf-gated: React wraps the year text in an inner span, so the element
  // that actually carries the left rule has a child in the export and none in
  // ours. The style predicate is what identifies it on both sides.
  out['year tick']=all('*').filter(function(e){
    return /^(19|20)\\d\\d$/.test(txt(e))&&cs(e).borderLeftWidth==='1px';})[0]||null;
  out['hint']=leaf(/^Click a run for its matches$/);
  // RUN DETAIL — anchored on the run title, then climbed to its panel
  var dt=leaf(/^(Winning|Losing) run ·/);
  out['detail title']=dt;
  var det=dt?up(dt,function(e,s){return s.borderRadius==='10px'&&
    /91, 155, 255/.test(s.borderTopColor);},8):null;
  out['detail box']=det;
  if(dt){
    var hdr=up(dt,function(e,s){return s.display==='flex'&&e.children.length>=3;},4);
    if(hdr){var hc=[].slice.call(hdr.children);
      out['detail span']=hc[1]||null; out['detail pl']=hc[2]||null;}
  }
  if(det){
    var g=all('*').filter(function(e){return det.contains(e)&&cs(e).display==='grid';})[0]||null;
    out['detail grid']=g;
    if(g){var gc=[].slice.call(g.children);
      out['detail head']=gc[1]||null;
      out['detail res']=gc[8]||null; out['detail opp']=gc[11]||null;
      out['detail home']=gc[13]||null; out['detail away']=gc[14]||null;}
  }
  // WHAT FOLLOWS — anchored on the leaf eyebrow, then on the leaf state cell
  // "after W1", so the six data columns are found by walking from a cell that
  // can only be that row rather than by index into a grid that might be a
  // different grid.
  var fe=leaf(/^What follows a run/);
  out['follows eyebrow']=fe;
  out['follows card']=fe?fe.parentElement:null;
  var st=leaf(/^after W1$/);
  var fg=st?up(st,function(e,s){return s.display==='grid';},4):null;
  out['follows grid']=fg;
  // the state CELL is the direct grid child that contains the leaf
  var stCell=st&&fg?[].slice.call(fg.children).filter(function(e){return e.contains(st);})[0]:null;
  out['follows state']=stCell;
  if(fg){
    var fc=[].slice.call(fg.children);
    var i=fc.indexOf(stCell);
    out['follows head']=fc[0]||null;
    var nm=fc[i+1]||null;
    if(nm&&nm.children[0]){
      out['follows rec']=nm.children[0].children[0]||null;
      out['follows rate']=nm.children[0].children[1]||null;
      out['follows bar']=nm.children[1]||null;}
    out['follows n']=fc[i+2]||null;
    out['follows yield']=fc[i+3]?fc[i+3].children[0]:null;
    out['follows vs']=fc[i+4]||null;
    var bs=leaf(/^baseline$/);
    out['follows base state']=bs?[].slice.call(fg.children).filter(function(e){
      return e.contains(bs);})[0]||bs:null;}
  out['follows note']=fe&&fe.parentElement?fe.parentElement.lastElementChild:null;
  // deepest element whose whole text is the footnote — wrapper-tolerant
  var fn=byText('*',/^Runs count all/);
  out['footnote']=fn.length?fn[fn.length-1]:null;
  return out;
}`;

const READ = `function(doc,spec){
  var tag=(${TAGGER})(doc);
  var r={};
  spec.forEach(function(row){
    var el=tag[row[0]];
    if(!el){r[row[0]]=null;return;}
    var cs=doc.defaultView.getComputedStyle(el);
    var o={};
    row[1].split(',').forEach(function(p){o[p]=cs.getPropertyValue(p);});
    r[row[0]]=o;
  });
  return r;
}`;

// ─── serve the worktree ──────────────────────────────────────────────────────
const server = spawn('python3', ['-m', 'http.server', String(PORT_HTTP)], { stdio: 'ignore' });
await sleep(1200);

async function openProto(w, h, dpr) {
  await viewport(w, h, dpr);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}${PROTO}` });
  for (let i = 0; i < 90; i++) {
    if (await ev(`!!document.body&&/Calendar record/.test(document.body.innerText||'')`)) break;
    await sleep(400);
  }
  // The .dc.html boots into the BOX GRID; the Calendar record modal has to be
  // opened before the Streaks control exists at all.
  const box = await ev(`(function(){
    var t=[].slice.call(document.querySelectorAll('*')).filter(function(e){
      return (e.textContent||'').trim()==='Calendar record'&&!e.children.length;})[0];
    if(!t)return 'no-box';
    var n=t; for(var i=0;i<6&&n;i++){ n=n.parentElement;
      if(n&&getComputedStyle(n).cursor==='pointer'){n.click();return 'opened';} }
    t.click(); return 'clicked-label';})()`);
  await sleep(1200);
  const ok = await ev(`(function(){
    var seg=[].slice.call(document.querySelectorAll('span,button,div'))
      .filter(function(e){return (e.textContent||'').trim()==='Streaks'&&!e.children.length;})[0];
    if(seg){seg.click();return 'streaks';}
    return 'no-streaks-control';})()`);
  await sleep(1200);
  return box + ' -> ' + ok;
}

const rows = [];
const report = [];
async function run(w, h, dpr, SHOTS) {
  const tag = `${w}x${h}@${dpr}`;
  console.log(`\n══ viewport ${tag} ══`);
  const protoState = await openProto(w, h, dpr);
  console.log(`  prototype: ${protoState}`);
  // select a run so the detail box exists on both sides
  // The prototype's bar handler is React-bound on the 6px column; a synthetic
  // MouseEvent with bubbles:true is what React's delegated listener sees.
  const pbars = await ev(`(function(){
    var c=[].slice.call(document.querySelectorAll('*')).filter(function(e){
      var s=getComputedStyle(e);
      if(s.height!=='140px'||s.display!=='flex')return false;
      return [].slice.call(e.children).some(function(k){return getComputedStyle(k).width==='6px';});})[0];
    if(!c)return 0;
    var bars=[].slice.call(c.children).filter(function(e){return getComputedStyle(e).width==='6px';});
    if(!bars.length)return 0;
    var b=bars[Math.floor(bars.length/2)];
    b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
    return bars.length;})()`);
  console.log(`  prototype: ${pbars} run bars, clicked the middle one`);
  await sleep(900);
  await shoot(`proto-${tag}`);
  await shootBlock(`block-proto-${tag}`);
  const A = await ev(`(${READ})(document, ${JSON.stringify(SPEC)})`);
  if (SHOTS) await states('proto', tag);

  // ─── STAGED PAGE ───────────────────────────────────────────────────────────
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,
      get(){return _b;},set(v){if(v){v.requireVerified=function(){return true;};
      v.requireAuth=function(){return true;};}_b=v;}});
      window.FEATURE_PP2=true;window.__err=[];
      window.addEventListener('error',function(e){window.__err.push(String(e.message));});})();`
  });
  await send('Page.navigate', { url: LIVE });
  let loaded = 0;
  for (let i = 0; i < 120; i++) {
    const n = await ev(`(typeof playerProfiles!=='undefined'&&playerProfiles)?Object.keys(playerProfiles).length:0`);
    if (typeof n === 'number' && n > 50) { loaded = n; break; }
    await sleep(700);
  }
  if (!loaded) throw new Error('the staged dashboard never loaded playerProfiles');
  const key = await ev(`(function(){
    document.querySelectorAll('.tabpage').forEach(function(p){
      p.classList.toggle('active',p.dataset.page==='players');});
    var k=Object.keys(playerProfiles).find(function(k){return /Zverev/.test(playerProfiles[k].name);});
    showPlayerProfile(k);return k;})()`);
  console.log(`  staged: player key ${key}`);
  for (let i = 0; i < 40; i++) {
    if (await ev(`!!(window.careerHistory&&window.careerHistory['${key}']&&window.careerHistory['${key}'].length)`)) break;
    await sleep(700);
  }
  // open the Calendar record modal, Streaks tab
  const opened = await ev(`(function(){
    var b=[].slice.call(document.querySelectorAll('[data-pp2="box"]'))
      .filter(function(e){return /Calendar record/i.test(e.textContent||'');})[0];
    if(!b)return 'no-box';
    b.click();return 'box';})()`);
  await sleep(600);
  const tabbed = await ev(`(function(){
    var t=document.querySelector('[data-pp2="cal-tab"][data-v="streaks"]');
    if(!t)return 'no-tab'; t.click(); return 'streaks';})()`);
  await sleep(600);
  console.log(`  staged: ${opened} -> ${tabbed}`);
  const nbars = await ev(`(function(){
    var bars=document.querySelectorAll('[data-pp2="cal-run"]');
    if(bars.length)bars[Math.floor(bars.length/2)].click();
    return bars.length;})()`);
  await sleep(600);
  await shoot(`live-${tag}`);
  await shootBlock(`block-live-${tag}`);
  const B = await ev(`(${READ})(document, ${JSON.stringify(SPEC)})`);
  if (SHOTS) await states('live', tag);
  console.log(`  staged: ${nbars} run bars`);

  // ─── the diff table ────────────────────────────────────────────────────────
  let same = 0, diff = 0, absent = 0;
  for (const [el, props] of SPEC) {
    const a = A[el], b = B[el];
    if (!a && !b) { rows.push([el, '(both absent)', '', '', 'n/a']); continue; }
    if (!a) { rows.push([el, '—', 'absent in prototype', 'present', 'PROTO-ONLY']); absent++; continue; }
    if (!b) { rows.push([el, '—', 'present', 'absent in staged', 'MISSING']); absent++; continue; }
    for (const p of props.split(',')) {
      const va = String(a[p] ?? ''), vb = String(b[p] ?? '');
      const ok = va === vb;
      if (ok) same++; else diff++;
      rows.push([el, p, va, vb, ok ? 'ok' : 'DIFF']);
    }
  }
  report.push({ tag, same, diff, absent });
  console.log(`  computed-style diff: ${same} match, ${diff} differ, ${absent} element(s) absent`);
}

await run(1512, 982, 2, true);
await run(1440, 900, 1, false);

// ─── (d) scripted interactions on the staged page ───────────────────────────
console.log('\n══ scripted interactions ══');
const inter = await ev(`(function(){
  var out={};
  var bars=[].slice.call(document.querySelectorAll('[data-pp2="cal-run"]'));
  var win=bars.filter(function(b){return /^W/.test(b.getAttribute('title')||'');});
  var los=bars.filter(function(b){return /^L/.test(b.getAttribute('title')||'');});
  function title(){var d=[].slice.call(document.querySelectorAll('div')).filter(function(e){
    return /^(Winning|Losing) run ·/.test((e.textContent||'').trim());});
    var s=[].slice.call(document.querySelectorAll('span')).filter(function(e){
    return /^(Winning|Losing) run ·/.test((e.textContent||'').trim());});
    return (s[0]||d[0]||{}).textContent||null;}
  if(win.length){win[0].click();out.winClick=title();}
  if(los.length){los[0].click();out.lossClick=title();}
  if(win.length>1){win[1].click();out.switchRun=title();}
  var sc=[].slice.call(document.querySelectorAll('.pp2-xscroll'))[0];
  if(sc){out.scrollW=sc.scrollWidth;out.clientW=sc.clientWidth;
    sc.scrollLeft=sc.scrollWidth;out.scrolledTo=sc.scrollLeft;}
  var row=document.querySelector('[data-pp2="sheet"]');
  if(row){row.click();out.sheetOpen=!!document.querySelector('.pp2-sheet');
    var cl=document.querySelector('[data-pp2="sheet-close"],[data-pp2="sheet-scrim"]');
    if(cl)cl.click();}
  // tab switch keeps state
  document.querySelector('[data-pp2="cal-tab"][data-v="calendar"]').click();
  out.onCalendar=!!document.querySelector('[data-pp2="cal-surface"]');
  document.querySelector('[data-pp2="cal-tab"][data-v="streaks"]').click();
  out.backOnStreaks=!!document.querySelector('[data-pp2="cal-run"]');
  out.runStatePersists=title();
  out.errors=(window.__err||[]).slice(0,5);
  return out;})()`);
console.log(JSON.stringify(inter, null, 2));
await sleep(400);
await shoot('live-interactions');

// ─── write the table ─────────────────────────────────────────────────────────
const md = ['| element | property | design | live | status |', '|---|---|---|---|---|']
  .concat(rows.map(r => '| ' + r.map(x => String(x).replace(/\|/g, '/')).join(' | ') + ' |'));
fs.writeFileSync(path.join(OUT, 'diff-table.md'), md.join('\n'));
console.log('\n══ summary ══');
report.forEach(r => console.log(`  ${r.tag}: ${r.same} match / ${r.diff} differ / ${r.absent} absent`));
const bad = rows.filter(r => r[4] === 'DIFF' || r[4] === 'MISSING');
console.log(`\n  ${bad.length} non-matching rows:`);
bad.slice(0, 60).forEach(r => console.log(`    ${r[0].padEnd(20)} ${String(r[1]).padEnd(22)} design=${r[2]}  live=${r[3]}`));
fs.writeFileSync(path.join(OUT, 'diff-table.json'), JSON.stringify(rows, null, 1));

server.kill(); chrome.kill();
process.exit(0);
