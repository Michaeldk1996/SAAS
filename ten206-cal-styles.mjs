// TEN-206 §5.4 · computed-style diff for every element the founder listed in
// section 2, against the value declared in `Player Stat Boxes.dc.html`.
//
// The EXPECTED column is not a judgement — each entry carries the file line it
// was read from, so a disagreement is a disagreement with the file rather than
// with me. Only data-driven text may differ, so nothing here reads text.
import { spawn } from 'node:child_process';
const BASE = process.argv[2] || 'http://127.0.0.1:8477';
const KEY = process.argv[3] || '1980';
const PORT = 9390;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=/tmp/ten206-styles`, '--force-device-scale-factor=2',
    '--window-size=1512,982', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tws() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const t = (await r.json()).find(x => x.type === 'page');
      if (t?.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
    } catch { /* not up */ }
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
const send = (m, p = {}) => { const i = ++id; return new Promise(res => { pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); }); };
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1512, height: 982, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,get(){return _b;},
    set(v){if(v){v.requireVerified=()=>true;v.requireAuth=()=>true;}_b=v;}});})();`
});
await send('Page.navigate', { url: `${BASE}/bsp-consult-dashboard.html?cb=st${Date.now()}` });
for (let i = 0; i < 150; i++) {
  if (await ev(`(typeof playerProfiles!=='undefined'&&playerProfiles)?Object.keys(playerProfiles).length>100:false`)) break;
  await sleep(500);
}
await ev(`(function(){document.querySelectorAll('.tabpage').forEach(p=>p.classList.toggle('active',p.dataset.page==='players'));showPlayerProfile('${KEY}');})()`);
for (let i = 0; i < 40; i++) {
  if (await ev(`!!(window.marketEdge&&window.marketEdge['${KEY}'])&&!!(window.careerHistory&&(window.careerHistory['${KEY}']||[]).length)`)) break;
  await sleep(500);
}
await ev(`document.querySelector('[data-pp2="box"][data-box="season"]').click()`);
await sleep(300);
await ev(`(function(){const c=[...document.querySelectorAll('[data-pp2="cal-cell"]')]
  .find(x=>x.dataset.v.startsWith('2024')&&/–/.test(x.textContent));if(c)c.click();})()`);
await sleep(300);

// element · property · design (with the file line) · live
const SPEC = [
  ['tile box', `[...card.querySelectorAll('div')].filter(d=>/^rgba\\(255, 255, 255, 0.09\\)/.test(getComputedStyle(d).borderColor)&&getComputedStyle(d).borderRadius==='12px')[0]`,
    { backgroundColor: ['rgb(10, 13, 20)', '#0a0d14 :88'], borderRadius: ['12px', ':88'], padding: ['15px 16px', ':88'], alignItems: ['center', ':88'], rowGap: ['8px', 'gap:8px :88'] }],
  ['tile grid', `[...card.querySelectorAll('div')].find(d=>d.style.gridTemplateColumns&&/repeat\\(4/.test(d.style.gridTemplateColumns))`,
    { columnGap: ['12px', ':86'], marginBottom: ['20px', ':86'] }],
  ['tab control', `card.querySelector('[data-pp2="cal-tab"]').parentElement`,
    { display: ['inline-flex', ':113'], backgroundColor: ['rgb(10, 13, 19)', '#0a0d13 :113'], borderRadius: ['9px', ':113'], padding: ['3px', ':113'], columnGap: ['3px', ':113'], marginBottom: ['16px', ':113'] }],
  ['tab item', `card.querySelector('[data-pp2="cal-tab"]')`,
    { padding: ['6px 14px', ':115'], fontSize: ['12px', ':115'], borderRadius: ['7px', ':115'] }],
  ['surface control', `card.querySelector('[data-pp2="cal-surface"]').parentElement`,
    // The file declares inline-flex (:122) but the control is a FLEX ITEM of
    // the eyebrow row (:121), and CSS blockifies a flex item's display. The
    // design computes to `flex` for the same reason; `inline-flex` here would
    // be a diff against the file's source, not against its rendering.
    { display: ['flex', 'inline-flex blockified as a flex item :121-122'], borderRadius: ['9px', ':122'], padding: ['3px', ':122'], columnGap: ['3px', ':122'] }],
  ['surface item', `card.querySelector('[data-pp2="cal-surface"]')`,
    { padding: ['5px 11px', ':124'], fontSize: ['11px', ':124'], borderRadius: ['7px', ':124'] }],
  ['surface item (on)', `[...card.querySelectorAll('[data-pp2="cal-surface"]')].find(b=>getComputedStyle(b).fontWeight==='700')`,
    { backgroundColor: ['rgba(91, 155, 255, 0.16)', ':3016'], borderColor: ['rgba(91, 155, 255, 0.22)', ':3017'] }],
  ['heat grid', `[...card.querySelectorAll('div')].find(d=>getComputedStyle(d).minWidth==='880px')`,
    { columnGap: ['6px', 'gap:0 6px :127'], rowGap: ['0px', ':127'], minWidth: ['880px', ':127'] }],
  ['grid scroller', `[...card.querySelectorAll('div')].find(d=>getComputedStyle(d).minWidth==='880px').parentElement`,
    { maxHeight: ['400px', ':126'], overflowY: ['scroll', ':126'] }],
  ['YEAR header', `[...card.querySelectorAll('span')].find(s=>s.textContent.trim()==='Year')`,
    { position: ['sticky', ':128'], fontSize: ['9.5px', ':128'], letterSpacing: ['1.33px', '0.14em :128'], padding: ['8px 8px 8px 10px', ':128'], backgroundColor: ['rgb(10, 13, 20)', ':128'] }],
  ['month header', `[...card.querySelectorAll('span')].find(s=>s.textContent.trim()==='Jan'&&getComputedStyle(s).position==='sticky')`,
    { position: ['sticky', ':130'], fontSize: ['9.5px', ':130'], textAlign: ['center', ':130'], padding: ['8px 0px', ':130'] }],
  ['year cell', `[...card.querySelectorAll('span')].find(s=>s.textContent.trim()==='2024'&&getComputedStyle(s).position==='sticky')`,
    { fontSize: ['11.5px', ':133'], fontWeight: ['700', ':133'], color: ['rgb(139, 150, 181)', '#8b96b5 :133'], padding: ['7px 8px 7px 10px', ':133'] }],
  ['heat cell', `card.querySelector('[data-pp2="cal-cell"]')`,
    { fontSize: ['11.5px', ':135'], textAlign: ['center', ':135'], padding: ['7px 0px', ':135'], borderRadius: ['0px', 'no radius in the file :135'], borderTopWidth: ['1px', ':135'] }],
  ['heat cell (win)', `[...card.querySelectorAll('[data-pp2="cal-cell"]')].find(c=>c.className==='calw'&&!c.style.outline.includes('solid'))`,
    { backgroundColor: ['rgba(61, 214, 140, 0.1)', 'GREENW :2086'] }],
  ['heat cell (loss)', `[...card.querySelectorAll('[data-pp2="cal-cell"]')].find(c=>c.className==='call'&&!c.style.outline.includes('solid'))`,
    { backgroundColor: ['rgba(224, 97, 111, 0.1)', 'REDW :2086'] }],
  ['drill box', `[...card.querySelectorAll('div')].find(d=>/rgba\\(91, 155, 255, 0.3\\)/.test(getComputedStyle(d).borderColor))`,
    { backgroundColor: ['rgb(6, 7, 10)', '#06070a :147'], borderRadius: ['10px', ':147'], padding: ['13px 15px', ':147'] }],
  ['drill close', `card.querySelector('[data-pp2="cal-cell-close"]')`,
    { width: ['28px', ':153'], height: ['28px', ':153'], borderRadius: ['8px', ':153'] }],
  ['drill row', `[...card.querySelectorAll('div')].filter(d=>getComputedStyle(d).display==='grid'&&getComputedStyle(d).columnGap==='20px'&&d.children.length===8)[1]`,
    { columnGap: ['20px', ':157'], paddingTop: ['6px', ':170'], paddingBottom: ['6px', ':170'], borderTopWidth: ['1px', ':170'] }],
  ['findings strip', `[...card.querySelectorAll('div')].find(d=>d.style.gridTemplateColumns&&/repeat\\(3/.test(d.style.gridTemplateColumns))`,
    { borderRadius: ['10px', ':236'], borderTopWidth: ['1px', ':236'], overflow: ['hidden', ':236'] }],
  ['swing band', `[...card.querySelectorAll('span')].find(s=>getComputedStyle(s).height==='66px')`,
    { height: ['66px', ':194'] }],
];
const rows = [];
for (const [name, sel, props] of SPEC) {
  const got = await ev(`(function(){const card=document.querySelector('[data-pp2="card"]');
    const el=${sel}; if(!el) return null; const cs=getComputedStyle(el); const o={};
    ${JSON.stringify(Object.keys(props))}.forEach(k=>{o[k]=cs[k];}); return JSON.stringify(o);})()`);
  if (!got) { rows.push([name, '(element not found)', '', '', 'MISS']); continue; }
  const live = JSON.parse(got);
  for (const [prop, [want, where]] of Object.entries(props)) {
    const have = live[prop];
    rows.push([name, prop, `${want}  (${where})`, have, have === want ? 'match' : 'DIFF']);
  }
}
const w = [18, 18, 40, 30, 6];
const line = r => r.map((c, i) => String(c).padEnd(w[i])).join(' | ');
console.log(line(['element', 'property', 'design (file line)', 'live', 'status']));
console.log(w.map(n => '-'.repeat(n)).join('-+-'));
rows.forEach(r => console.log(line(r)));
const diffs = rows.filter(r => r[4] !== 'match');
console.log(`\n${rows.length - diffs.length} match, ${diffs.length} differ`);
ws.close(); chrome.kill();
