// TEN-206 §5.4 ruling cal-2 · drives the STREAKS tab in a real headless Chrome
// and READS the numbers back out of the DOM, then recomputes every one of them
// from the raw shard in this process and asserts they match. A screenshot proves
// it painted; this proves the painted figures are the ones the rows imply.
//
// Usage: node ten206-streaks-probe.mjs [baseURL] [playerKey]
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:8477';
const KEY = process.argv[3] || '1980';
const PORT = 9411 + (Number(process.env.PROBE_OFFSET) || 0);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=/tmp/ten206-streaks-${PORT}`, '--force-device-scale-factor=2',
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
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride',
  { width: 1512, height: 982, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,
    get(){return _b;},set(v){if(v){v.requireVerified=()=>true;v.requireAuth=()=>true;}_b=v;}});
    window.__e=[];window.addEventListener('error',e=>window.__e.push(String(e.message)));})();`
});
await send('Page.navigate', { url: `${BASE}/bsp-consult-dashboard.html?cb=st${Date.now()}` });
for (let i = 0; i < 150; i++) {
  const n = await ev(`(typeof playerProfiles!=='undefined'&&playerProfiles)?Object.keys(playerProfiles).length:0`);
  if (n > 100) break;
  await sleep(500);
}
await ev(`(function(){document.querySelectorAll('.tabpage').forEach(p=>p.classList.toggle('active',p.dataset.page==='players'));
  showPlayerProfile('${KEY}');})()`);
for (let i = 0; i < 40; i++) {
  const ok = await ev(`!!(window.careerHistory&&window.careerHistory['${KEY}']&&window.careerHistory['${KEY}'].length)`);
  if (ok) break;
  await sleep(500);
}
await ev(`document.querySelector('[data-pp2="box"][data-box="season"]').click()`);
await sleep(400);
const onStreaks = await ev(`(function(){
  const b=[...document.querySelectorAll('[data-pp2="cal-tab"]')].find(x=>x.textContent.trim()==='Streaks');
  if(!b) return 'no Streaks tab'; b.click(); return 'clicked';})()`);
await sleep(400);
console.log('── TAB ──', onStreaks);

const read = `(function(){
  const V=document.getElementById('playerProfileView');
  const card=V.querySelector('[data-pp2="card"]');
  const o={};
  // Anchor on the CAPTION text rather than an inline-style regex: the four-tile
  // grid is found by what it says, so a style rewrite cannot silently null it.
  const cap=[...card.querySelectorAll('div')].find(d=>d.textContent.trim()==='Runs of 5+');
  const tileGrid=cap?cap.parentElement.parentElement:null;
  o.tiles=tileGrid?[...tileGrid.children].map(t=>[...t.children].map(s=>s.textContent.trim())):null;
  o.tileTracks=tileGrid?getComputedStyle(tileGrid).gridTemplateColumns:null;
  o.bars=[...card.querySelectorAll('[data-pp2="cal-run"]')].length;
  const meta=[...card.querySelectorAll('div')].map(d=>d.textContent.trim())
    .filter(t=>/^\\d+ runs · longest \\d+$/.test(t));
  o.runMeta=meta[0]||null;
  const note=[...card.querySelectorAll('div')].map(d=>d.textContent.replace(/\\s+/g,' ').trim())
    .filter(t=>/^Runs are counted over/.test(t));
  o.note=note[note.length-1]||null;
  o.body=card.textContent;
  o.bad=['NaN','undefined','Infinity','[object'].filter(t=>card.innerHTML.includes(t));
  o.errors=window.__e;
  return JSON.stringify(o);})()`;
const dom = JSON.parse(await ev(read));
console.log('── STREAKS, CLOSED ──');
console.log(JSON.stringify({ tiles: dom.tiles, bars: dom.bars, runMeta: dom.runMeta, note: dom.note, bad: dom.bad, errors: dom.errors }, null, 1));

// Open the LONGEST run — the one whose numbers are most load-bearing.
const drill = JSON.parse(await ev(`(function(){
  const V=document.getElementById('playerProfileView');
  const bars=[...V.querySelectorAll('[data-pp2="cal-run"]')];
  let best=bars[0],bl=0;
  bars.forEach(b=>{const n=parseInt((b.title||'').slice(1),10)||0;if(n>bl){bl=n;best=b;}});
  const title=best.title;
  best.click();
  const card=V.querySelector('[data-pp2="card"]');
  const box=[...card.querySelectorAll('div')].find(d=>/rgba\\(91, 155, 255, 0\\.3\\)/.test(getComputedStyle(d).borderColor));
  const o={clicked:title,opened:!!box};
  if(box){
    o.header=box.firstElementChild.textContent.replace(/\\s+/g,' ').trim();
    const rows=[...box.children].slice(1);
    o.rowCount=rows.length;
    o.sample=rows.slice(0,3).map(r=>[...r.children].map(s=>s.textContent.trim()));
    o.priceDashes=rows.filter(r=>r.children[4].textContent.trim()==='—').length;
    o.plDashes=rows.filter(r=>r.children[5].textContent.trim()==='—').length;
    o.pairedDashes=rows.every(r=>(r.children[4].textContent.trim()==='—')===(r.children[5].textContent.trim()==='—'));
    let sum=0,n=0;
    rows.forEach(r=>{const v=r.children[5].textContent.trim();
      if(v!=='—'){n++;sum+=parseFloat(v.replace('−','-'));}});
    o.rowPricedN=n;o.rowPnlSum=Math.round(sum*100)/100;
  }
  return JSON.stringify(o);})()`));
console.log('── LONGEST RUN OPEN ──');
console.log(JSON.stringify(drill, null, 1));

// ── the independent recompute, from the raw shard in THIS process ──────────
const ch = JSON.parse(readFileSync(`career-history/${KEY}.json`, 'utf8')).matches
  .filter(r => r && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)))
  .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
const runs = [];
ch.forEach((r) => {
  const res = r.won ? 'W' : 'L';
  const last = runs[runs.length - 1];
  if (last && last.res === res) { last.len += 1; last.rows.push(r); }
  else runs.push({ res, len: 1, rows: [r] });
});
const wins = ch.filter(r => r.won).length;
const pr = ch.length ? wins / ch.length : 0;
const expLong = (n, p) => (!n || !(p > 0 && p < 1) ? null
  : Math.round(Math.log(n * (1 - p)) / Math.log(1 / p) + 0.5772 / Math.log(1 / p) - 0.5));
const exp5 = (n, p) => (!n || !(p > 0 && p < 1) ? null
  : Math.round(n * (1 - p) * Math.pow(p, 5) + n * p * Math.pow(1 - p, 5)));
const want = {
  rows: ch.length,
  runs: runs.length,
  obs5: runs.filter(r => r.len >= 5).length,
  longestW: Math.max(0, ...runs.filter(r => r.res === 'W').map(r => r.len)),
  longestL: Math.max(0, ...runs.filter(r => r.res === 'L').map(r => r.len)),
  expLongest: expLong(ch.length, pr),
  exp5: exp5(ch.length, pr),
  maxRun: Math.max(...runs.map(r => r.len)),
};

const fails = [];
const eq = (name, got, exp) => {
  if (String(got) !== String(exp)) fails.push(`${name}: DOM ${got} vs recompute ${exp}`);
  console.log(`  ${String(got) === String(exp) ? 'OK  ' : 'FAIL'} ${name.padEnd(22)} DOM ${String(got).padEnd(10)} recompute ${exp}`);
};
console.log('\n── DOM vs INDEPENDENT RECOMPUTE ──');
eq('bars = runs', dom.bars, want.runs);
eq('run meta', dom.runMeta, `${want.runs} runs · longest ${want.maxRun}`);
eq('tile · runs of 5+', dom.tiles?.[0]?.[1], String(want.obs5));
eq('tile · longest win run', dom.tiles?.[1]?.[1], String(want.longestW));
eq('tile · longest loss run', dom.tiles?.[2]?.[1], String(want.longestL));
eq('tile · expected longest', dom.tiles?.[3]?.[1], String(want.expLongest));
eq('tile sub · expected 5+', /expected (\d+)/.exec(dom.tiles?.[0]?.[2] || '')?.[1], String(want.exp5));
eq('scope note n', /· (\d+) matches ·/.exec(dom.note || '')?.[1], String(want.rows));
eq('drill row count', drill.rowCount, String(want.maxRun));
eq('drill header run', /^([WL]\d+)/.exec(drill.header || '')?.[1],
  `${runs.find(r => r.len === want.maxRun).res}${want.maxRun}`);
eq('header priced n', /(\d+) of \d+ priced/.exec(drill.header || '')?.[1], String(drill.rowPricedN));
eq('header run size', /\d+ of (\d+) priced/.exec(drill.header || '')?.[1], String(drill.rowCount));
if (!drill.pairedDashes) fails.push('a row dashed its price but printed a P&L (or the reverse)');
console.log(`  ${drill.pairedDashes ? 'OK  ' : 'FAIL'} price/P&L dash together`);
if (dom.bad.length) fails.push(`the DOM contains ${dom.bad.join(', ')}`);
console.log(`  ${dom.bad.length ? 'FAIL' : 'OK  '} no NaN/undefined in the DOM`);
if ((dom.errors || []).length) fails.push(`page errors: ${dom.errors.join(' | ')}`);
console.log(`  ${(dom.errors || []).length ? 'FAIL' : 'OK  '} no page errors`);

// Indoors on the Streaks tab must refuse with the SAME sentence the Calendar
// tab uses — the two tabs share a spine now, so they must share the refusal.
const ind = await ev(`(function(){
  const V=document.getElementById('playerProfileView');
  const cal=[...V.querySelectorAll('[data-pp2="cal-tab"]')].find(x=>x.textContent.trim()==='Calendar');
  cal.click();
  const b=[...V.querySelectorAll('[data-pp2="cal-surface"]')].find(x=>x.textContent.trim()==='Indoors');
  b.click();
  const st=[...V.querySelectorAll('[data-pp2="cal-tab"]')].find(x=>x.textContent.trim()==='Streaks');
  st.click();
  const card=V.querySelector('[data-pp2="card"]');
  return card.textContent.includes('No per-match court type on record')?'refused with a reason':'RENDERED RUNS';})()`);
console.log('── INDOORS ON STREAKS ──', ind);
if (ind !== 'refused with a reason') fails.push(`Indoors on Streaks: ${ind}`);

mkdirSync('/tmp/ten206-streaks-shots', { recursive: true });
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (r.result?.data) writeFileSync(`/tmp/ten206-streaks-shots/${KEY}-${name}.png`, Buffer.from(r.result.data, 'base64'));
}
await ev(`(function(){const V=document.getElementById('playerProfileView');
  const b=[...V.querySelectorAll('[data-pp2="cal-surface"]')];
  const cal=[...V.querySelectorAll('[data-pp2="cal-tab"]')].find(x=>x.textContent.trim()==='Calendar');cal.click();
  const all=[...V.querySelectorAll('[data-pp2="cal-surface"]')].find(x=>x.textContent.trim()==='All surfaces');if(all)all.click();
  const st=[...V.querySelectorAll('[data-pp2="cal-tab"]')].find(x=>x.textContent.trim()==='Streaks');st.click();})()`);
await sleep(400); await shot('1-streaks');
await ev(`(function(){const bars=[...document.querySelectorAll('[data-pp2="cal-run"]')];
  let best=bars[0],bl=0;bars.forEach(b=>{const n=parseInt((b.title||'').slice(1),10)||0;if(n>bl){bl=n;best=b;}});best.click();})()`);
await sleep(400); await shot('2-run-open');
console.log('── SHOTS ── /tmp/ten206-streaks-shots/' + KEY + '-{1-streaks,2-run-open}.png');

console.log(fails.length ? `\nFAIL — ${fails.length}\n  ` + fails.join('\n  ') : '\nPASS — DOM and recompute agree on every figure');
ws.close(); chrome.kill();
process.exit(fails.length ? 1 : 0);
