// TEN-303 — drive the REAL dashboard's Odds tab in headless Chrome (CDP, Node global WebSocket, no deps).
//
//   node tools/ten303-odds-probe.mjs <dashboardUrl> <outDir> [matchSurname]
//
// Neutralises only the Firebase auth gate (BSP stub before any page script), opens the analysis modal on
// the first board match whose p1/p2 contains <matchSurname> (default: the first match with an odds shard),
// switches to the Odds tab, and writes: tab.png, tooltip.png (book-name hover, 250 ms delay honoured),
// popup.png, novig.png, plus probe.json (rows, STEAM, tooltip text, pop-up header, build sha) read from the DOM.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [url, out, who] = process.argv.slice(2);
if (!url || !out) { console.error('usage: node tools/ten303-odds-probe.mjs <url> <outDir> [surname]'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 500);
const prof = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'ten303-chrome-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--force-device-scale-factor=2', '--window-size=1512,982', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pend = new Map(); const errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; };
const shot = async f => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, f), Buffer.from(r.data, 'base64')); };
const waitFor = async (expr, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(300); } throw new Error('timeout: ' + expr); };
try {
  let target;
  for (let k = 0; k < 60 && !target; k++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); } });
  await send('Page.enable'); await send('Runtime.enable');
  ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception ? d.params.exceptionDetails.exception.description : d.params.exceptionDetails.text); });
  await send('Emulation.setDeviceMetricsOverride', { width: 1512, height: 982, deviceScaleFactor: 2, mobile: false });
  // auth.js assigns window.BSP in strict mode: own the property with a setter that neuters only the
  // redirect (requireVerified / requireAuth resolve a verified probe user) — every other script loads real.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){var _b,u={emailVerified:true,email:'probe@x',uid:'probe'};Object.defineProperty(window,'BSP',{configurable:true,get:function(){return _b;},set:function(v){if(v){v.requireVerified=function(){return Promise.resolve(u);};v.requireAuth=function(){return Promise.resolve(u);};}_b=v;}});})();` });
  await send('Page.navigate', { url });
  await waitFor('typeof matches !== "undefined" && Array.isArray(matches) && matches.length > 0 && typeof openAnalysisModal === "function"');
  const pick = await ev(`(async () => { const idx = await loadOddsIndex(); const keys = new Set(idx || []);
    const want = ${JSON.stringify(who || '')};
    const m = matches.find(x => keys.has(eventKeyOfMatch(x)) && (!want || (x.p1 + ' ' + x.p2).includes(want))) || null;
    return m && { id: m.id, p1: m.p1, p2: m.p2 }; })()`);
  if (!pick) throw new Error('no match with an odds shard' + (who ? ' for ' + who : ''));
  await ev(`openAnalysisModal(${JSON.stringify(pick.id)})`);
  await ev(`document.querySelector('[data-atab="odds"]').click()`);
  await waitFor('document.querySelectorAll("#aSectionOdds .aox-row").length > 0 && !!document.querySelector("#aSectionOdds .aox-spark path")', 30000)
    .catch(async e => { console.error('section:', await ev('(document.getElementById("aSectionOdds")||{}).innerHTML.slice(0,600)'), '\nerrors:', JSON.stringify(errors.slice(0, 5))); throw e; });
  await sleep(600);
  const read = () => ev(`(() => { const S = document.getElementById('aSectionOdds');
    const rows = [...S.querySelectorAll('.aox-row')].map(r => ({ book: r.dataset.book, group: r.dataset.group, src: r.dataset.src, stale: r.classList.contains('aox-stale'), nodata: r.classList.contains('aox-nodata'),
      margin: (r.querySelector('.aox-margin') || {}).textContent, open: [...r.querySelectorAll('.aox-open')].map(e => e.textContent), now: [...r.querySelectorAll('.aox-now')].map(e => e.textContent + '|' + getComputedStyle(e).color),
      net: [...r.querySelectorAll('.aox-net')].map(e => e.textContent) }));
    const steam = S.querySelector('.aox-steam-text'); const titles = S.querySelectorAll('[title]').length;
    return { rows, steam: steam && steam.textContent, nativeTitles: titles, sub: (S.querySelector('.aox-sub') || {}).textContent, foot: (S.querySelector('.aox-foot') || {}).textContent,
      sha: (document.querySelector('meta[name="build-sha"]') || {}).content || null }; })()`);
  const probe = { match: pick, at: new Date().toISOString(), market: await read() };
  await ev(`document.querySelector('#aSectionOdds .aox-row').scrollIntoView({ block: 'center' })`); await sleep(300);
  await shot('tab.png');
  // hover the first book name: a real mouse move, then wait past the 250 ms delay
  const r0 = await ev(`(() => { const b = document.querySelector('#aSectionOdds .aox-row .aox-book').getBoundingClientRect(); return [b.left + 20, b.top + 8]; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r0[0], y: r0[1] });
  await sleep(120); probe.tipAt120ms = await ev(`(() => { const t = document.getElementById('aoddsTip'); return !!t && t.style.display === 'block'; })()`);
  await sleep(400);
  probe.tooltip = await ev(`(() => { const t = document.getElementById('aoddsTip'); if (!t) return null; const r = t.getBoundingClientRect(), cs = getComputedStyle(t);
    return { shown: t.style.display === 'block', text: t.innerText, rect: [r.left, r.top, r.width, r.height], z: cs.zIndex, bg: cs.backgroundColor, radius: cs.borderRadius, parent: t.parentElement.id }; })()`);
  await sleep(300); await shot('tooltip.png');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 }); await sleep(200);
  probe.tipHiddenAfterLeave = await ev(`document.getElementById('aoddsTip').style.display === 'none'`);
  // pop-up: click the first row with a line
  await ev(`document.querySelector('#aSectionOdds .aox-row:not(.aox-nodata)').click()`);
  await waitFor('!!document.querySelector("#aSectionOdds .aox-mv")'); await sleep(400);
  probe.popup = await ev(`(() => { const mv = document.querySelector('#aSectionOdds .aox-mv'); const box = mv.firstElementChild.getBoundingClientRect();
    return { book: mv.querySelector('.aox-mvbook').textContent, sub: mv.querySelector('.aox-mvsub').textContent, tabs: [...mv.querySelectorAll('.aox-tab')].map(t => t.dataset.book),
      stats: [...mv.querySelectorAll('.aox-stat')].map(e => e.textContent + ' ' + e.nextElementSibling.textContent), xlabels: [...mv.querySelectorAll('.aox-xt')].map(e => e.textContent),
      box: [box.left, box.top, box.width, box.height], onTop: document.elementFromPoint(box.left + 30, box.top + 30).closest('.aox-mv') === mv }; })()`);
  await shot('popup.png');
  await ev(`aOddsCloseMv()`); await sleep(200);
  await ev(`aOddsSetMode(true)`); await sleep(400);
  probe.novig = await read();
  await ev(`document.querySelector('#aSectionOdds .aox-row').scrollIntoView({ block: 'center' })`); await sleep(300);
  await shot('novig.png');
  fs.writeFileSync(path.join(out, 'probe.json'), JSON.stringify(probe, null, 1));
  console.log(JSON.stringify({ match: pick, steam: probe.market.steam, rows: probe.market.rows.length, nativeTitles: probe.market.nativeTitles, tipAt120ms: probe.tipAt120ms,
    tooltip: probe.tooltip && probe.tooltip.shown, tipHidden: probe.tipHiddenAfterLeave, popupOnTop: probe.popup.onTop, sha: probe.market.sha }));
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
