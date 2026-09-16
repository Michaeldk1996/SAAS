// TEN-206 career-record modal — read the DEPLOYED page's own computed styles.
// Nothing here is derived from the source; every value is measured off the live DOM,
// so a "live" column in the diff table cannot be a restatement of what I think shipped.
import { spawn } from 'node:child_process';
const URL_ = process.env.PP_URL || 'https://michaeldk1996.github.io/SAAS/bsp-consult-dashboard.html';
const PORT = Number(process.env.PP_PORT || 9377);
const WHO = process.env.PP_PLAYER || 'Zverev';
const W = Number(process.env.PP_W || 1512), H = Number(process.env.PP_H || 982);
const DPR = Number(process.env.PP_DPR || 2);
const SHOT = process.env.PP_SHOT || '';

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
   `--user-data-dir=/tmp/ten206-cm-${PORT}`, `--window-size=${W},${H}`, `--force-device-scale-factor=${DPR}`,
   '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tws() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const t = (await r.json()).find(x => x.type === 'page');
      if (t?.webSocketDebuggerUrl) return t.webSocketDebuggerUrl; } catch {}
    await sleep(500);
  } throw new Error('no target');
}
const ws = new WebSocket(await tws());
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => { const i = ++id; return new Promise(res => { pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); }); };
async function ev(expr, await_ = true) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: await_, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
// Memory: CDP deployed-page auth bypass — neuter BSP.requireVerified via init script.
await send('Page.addScriptToEvaluateOnNewDocument', { source:
  `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,get(){return _b;},set(v){if(v){v.requireVerified=()=>true;v.requireAuth=()=>true;}_b=v;}});window.__e=[];window.addEventListener('error',e=>window.__e.push(String(e.message)));})();` });
await send('Page.navigate', { url: URL_ });
// The host bridges the file in one of two shapes across builds; resolve it rather
// than assume, so a shape change reads as "not loaded yet" instead of a crash.
// NOT window.playerProfiles — the dashboard declares it as a module-scope `let`,
// so it is reachable only as a BARE identifier inside the page's own scope. This
// repo has been bitten by exactly this before; typeof-guard it and read it bare.
const MAP = `(function(){ if(typeof playerProfiles==='undefined'||!playerProfiles) return null; return playerProfiles.players||playerProfiles; })()`;
// playerProfiles is LAZY — it is fetched by the Players nav handler, not at load.
// Toggling .tabpage classes moves the view without firing that handler, so the
// store stays undefined and every lookup misses. Click the real nav element.
for (let i = 0; i < 90; i++) {
  if (await ev(`typeof showPlayerProfile==='function'`, false)) break; await sleep(1000);
}
await ev(`(function(){
  var sel=['[data-page="players"]','[data-nav="players"]','[data-tab="players"]','a[href="#players"]'];
  for(var i=0;i<sel.length;i++){ var n=document.querySelector('nav '+sel[i])||document.querySelector('.sidebar '+sel[i])||document.querySelector(sel[i]);
    if(n && typeof n.click==='function'){ n.click(); return sel[i]; } }
  var byText=[].slice.call(document.querySelectorAll('a,button,li,div'))
    .filter(function(e){ return e.children.length===0 && /^players$/i.test((e.textContent||'').trim()); });
  if(byText.length){ byText[0].click(); return 'text:Players'; }
  return null;})()`);
for (let i = 0; i < 90; i++) {
  const n = await ev(`(function(){var m=${MAP}; return m?Object.keys(m).length:0;})()`, false);
  if (n > 100) break; await sleep(1000);
}
const key = await ev(`(function(){
  var P=${MAP}; if(!P) return null;
  var k=Object.keys(P).find(function(k){return new RegExp(${JSON.stringify(WHO)},'i').test(P[k].name||'');});
  if(!k) return null; showPlayerProfile(k); return k;})()`);
if (!key) {
  const diag = await ev(`(function(){var s=(typeof playerProfiles!=='undefined')?playerProfiles:null; var m=(s&&s.players)||s;
    return JSON.stringify({ hasStore:!!s, storeKeys:s?Object.keys(s).slice(0,6):null,
      mapSize:m?Object.keys(m).length:0, sampleNames:m?Object.keys(m).slice(0,8).map(function(k){return m[k]&&m[k].name;}):null,
      hasShow:typeof showPlayerProfile, errors:window.__e });})()`, false);
  console.log(JSON.stringify({ error: 'player not found: ' + WHO, diag: JSON.parse(diag) }));
  ws.close(); chrome.kill(); process.exit(1);
}
await sleep(2500);
// Open the Career record box.
await ev(`(function(){var b=document.querySelector('[data-pp2="box"][data-box="career"]'); if(b) b.click(); return !!b;})()`);
await sleep(900);
// PP_CLICK drives the scripted interaction test. Its RETURN VALUE is printed —
// an interaction probe that only fires clicks and never reads the result proves
// nothing about what the clicks did.
let clickResult = null;
if (process.env.PP_CLICK) { clickResult = await ev(process.env.PP_CLICK); await sleep(800); }

const out = await ev(`(function(){
  var __m=(typeof playerProfiles!=='undefined'&&playerProfiles)?(playerProfiles.players||playerProfiles):{};
  var o={player:(__m[${JSON.stringify(key)}]||{}).name, key:${JSON.stringify(key)}, url:location.href};
  var pick=['font-family','font-size','font-weight','letter-spacing','color','background-color','border-top-width',
            'border-top-color','border-radius','padding-top','padding-bottom','padding-left','padding-right',
            'gap','grid-template-columns','line-height','height','max-width','align-items','text-align','font-variant-numeric'];
  function css(el){ if(!el) return null; var c=getComputedStyle(el), r={}; pick.forEach(function(k){ r[k]=c.getPropertyValue(k); });
    var b=el.getBoundingClientRect(); r._box=Math.round(b.width)+'x'+Math.round(b.height)+'@'+Math.round(b.left)+','+Math.round(b.top); return r; }
  var scrim=document.querySelector('.pp2-scrim'), card=document.querySelector('.pp2-card');
  o.open=!!card;
  if(!card){ o.err='career modal did not open'; return JSON.stringify(o); }
  o.scrim=css(scrim); o.card=css(card);
  var head=card.firstElementChild;
  o.title=head.querySelector('div>div')?head.querySelector('div>div').textContent.trim():null;
  o.subtitle=(function(){var d=head.querySelectorAll('div'); for(var i=0;i<d.length;i++){ if(/^All-time|^Career win/.test(d[i].textContent.trim())) return d[i].textContent.trim(); } return null;})();
  var body=card.children[1];
  o.bodyText=body.textContent.replace(/\\s+/g,' ').slice(0,600);
  // surface rows: the bar-row grid (1fr 300px 58px)
  var rows=[].slice.call(body.querySelectorAll('div')).filter(function(d){
    return /minmax\\(0px, 1fr\\) 300px 58px|1fr 300px 58px/.test(getComputedStyle(d).gridTemplateColumns)
        || /px 300px 58px/.test(getComputedStyle(d).gridTemplateColumns); });
  o.surfaceRows=rows.map(function(d){ var name=d.querySelector('div>div'); var rate=d.lastElementChild;
    return { label:name?name.textContent.trim():null,
             meta:(name&&name.nextElementSibling)?name.nextElementSibling.textContent.trim():null,
             rate:rate?rate.textContent.trim():null,
             rateCss:css(rate&&rate.firstElementChild?rate:rate),
             rowCss:css(d),
             nameCss:css(name),
             metaCss:css(name&&name.nextElementSibling),
             bar:(function(){ var t=d.children[1]; var f=t&&t.firstElementChild;
                 return { trackCss:css(t), fillBg:f?getComputedStyle(f).backgroundColor:null,
                          fillW:f?getComputedStyle(f).width:null, fillOpacity:f?getComputedStyle(f).opacity:null }; })() }; });
  // season table
  var grids=[].slice.call(body.querySelectorAll('div')).filter(function(d){
    return /repeat|auto/.test(d.style.gridTemplateColumns||'') && /Year/.test(d.textContent); });
  o.seasonHeadCss=grids.length?css(grids[0]):null;
  o.seasonHeads=grids.length?[].slice.call(grids[0].children).map(function(c){ return { text:c.textContent.trim(), css:css(c) }; }):[];
  o.hasWinsLossesEyebrow=/Wins\\s*\\/\\s*Losses/i.test(body.textContent);
  o.helperText=(function(){ var d=body.querySelectorAll('div'); for(var i=0;i<d.length;i++){ var t=d[i].textContent.trim();
      if(/^Wins \\/ losses|^Click any record/.test(t) && t.length<160) return t; } return null; })();
  o.hasClickHelper=/Click any record to browse those matches/.test(body.textContent);
  o.recordBySeasonTitle=(function(){ var d=body.querySelectorAll('div'); for(var i=0;i<d.length;i++){ if(d[i].textContent.trim()==='Record by season') return css(d[i]); } return null; })();
  // clickability probe — do any season cells / surface rows advertise a click?
  o.clickableSurfaceRows=rows.filter(function(d){ return getComputedStyle(d).cursor==='pointer'||d.getAttribute('data-pp2'); }).length;
  o.seasonCellCursor=(function(){ var all=[].slice.call(body.querySelectorAll('div'));
    var cells=all.filter(function(d){ return /^\\d+\\/\\d+$/.test(d.textContent.trim()); });
    return { n:cells.length, pointer:cells.filter(function(d){return getComputedStyle(d).cursor==='pointer';}).length,
             sample:cells.slice(0,6).map(function(d){return d.textContent.trim();}),
             sampleCss:cells.length?css(cells[0]):null }; })();
  o.careerFooter=(function(){ var d=body.querySelectorAll('div'); for(var i=0;i<d.length;i++){ if(d[i].textContent.trim()==='Career'&&/mono/i.test(getComputedStyle(d[i]).fontFamily)) return css(d[i]); } return null; })();
  o.errors=window.__e;
  return JSON.stringify(o);
})()`);
const parsed = JSON.parse(out);
if (clickResult) parsed.interaction = JSON.parse(clickResult);
console.log(JSON.stringify(parsed));
if (SHOT) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  if (r.result?.data) (await import('node:fs')).writeFileSync(SHOT, Buffer.from(r.result.data, 'base64'));
}
ws.close(); chrome.kill();
