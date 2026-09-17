#!/usr/bin/env node
/**
 * ten225-implied-gap-probe.mjs — the founder's design-gap question, measured.
 *
 * "The ODDS · IMPLIED header sits above a dash while a percentage still renders
 *  to its right (Recent form). Can a member tell those two columns apart when
 *  the price is missing?"
 *
 * Asserting an answer from the markup is not enough: whether the two columns
 * stay distinguishable is a GEOMETRY question. If the implied cell keeps its
 * box when empty, the form % stays in its own column and the per-card header
 * disambiguates. If the empty cell collapses, the form % slides left into the
 * space the implied % occupied on every other row - and then the same pixel
 * position carries two different meanings depending on data we did not fetch.
 *
 * So this measures, on the DEPLOYED board, for a PRICED row and a DASHED row:
 *   - the x/width of the odds, implied and form cells
 *   - the gap between the dash and the next number a member's eye reaches
 *   - whether any accessible name (header cell, aria-label, title) ties the
 *     visible percentage to "Form" rather than to "Implied"
 *
 * Usage: node ten225-implied-gap-probe.mjs [baseUrl]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.argv[2] || 'https://michaeldk1996.github.io/SAAS').replace(/\/$/, '');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

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

const dport = 9700 + Math.floor((Date.now() / 991) % 200);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'ten225gap-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`,
  `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });

const ws = new WebSocket(await cdpTarget(dport));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
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

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,
    get(){return _b;},set(v){if(v){v.requireVerified=()=>true;v.requireAuth=()=>true;}_b=v;}});})();`,
});
await send('Page.navigate', { url: `${BASE}/bsp-consult-dashboard.html` });
for (let i = 0; i < 400; i++) {
  if (await ev(`typeof matches !== 'undefined' && Array.isArray(matches) && matches.length > 0`)) break;
  await sleep(250);
}
const info = await ev(`fetch('${BASE}/build-info.json?cb=' + performance.now()).then(r => r.json())`);
await ev(`(function(){var b=document.querySelector('#dayTabs [data-day="today"]'); if(b) b.click();})()`);
await sleep(800);

const out = await ev(`(function(){
  function boxes(row){
    // Every leaf text node's owning element, left to right - this is what the
    // eye actually scans, independent of what the class names claim.
    var r = row.getBoundingClientRect();
    var leaves = Array.prototype.slice.call(row.querySelectorAll('*')).filter(function(e){
      return e.children.length === 0 && (e.textContent||'').trim() !== '';
    });
    return leaves.map(function(e){
      var b = e.getBoundingClientRect();
      return { t: (e.textContent||'').trim().slice(0,14), cls: e.className||'',
               x: Math.round(b.left - r.left), w: Math.round(b.width) };
    }).sort(function(a,b){ return a.x - b.x; });
  }
  function implied(row){
    return Array.prototype.slice.call(row.querySelectorAll('.mc-implied')).map(function(e){
      var b = e.getBoundingClientRect();
      return { t: (e.textContent||'').trim(), x: Math.round(b.left), w: Math.round(b.width),
               display: getComputedStyle(e).display, vis: getComputedStyle(e).visibility };
    });
  }
  var rows = Array.prototype.slice.call(document.querySelectorAll('#matchlist > *'))
    .filter(function(c){ return c.querySelector('.mc-players'); });
  var priced = null, dashed = null;
  rows.forEach(function(c){
    var p = c.querySelector('.mc-players');
    var t = (p.textContent||'');
    if (!priced && /\\d\\.\\d\\d/.test(t)) priced = c;
    if (!dashed && t.indexOf('\\u2014') >= 0 && !/\\d\\.\\d\\d/.test(t)) dashed = c;
  });
  function pack(c, label){
    if (!c) return { label: label, missing: true };
    var p = c.querySelector('.mc-players');
    return { label: label, id: c.id||null,
             text: (p.textContent||'').replace(/\\s+/g,' ').trim().slice(0,120),
             leaves: boxes(p), implied: implied(c),
             // does anything name the column for a screen reader / on hover?
             head: (c.querySelector('.mc-head') ? (c.querySelector('.mc-head').textContent||'').replace(/\\s+/g,' ').trim().slice(-40) : null),
             aria: Array.prototype.slice.call(c.querySelectorAll('[aria-label],[title]'))
               .map(function(e){ return (e.getAttribute('aria-label')||e.getAttribute('title')); }).slice(0,8) };
  }
  function heads(c){
    if (!c) return null;
    var h = c.querySelector('.mc-head'); if (!h) return null;
    var r = h.getBoundingClientRect();
    return Array.prototype.slice.call(h.querySelectorAll('*')).filter(function(e){
      return e.children.length === 0 && (e.textContent||'').trim() !== '';
    }).map(function(e){ var b = e.getBoundingClientRect();
      return { t:(e.textContent||'').trim().slice(0,18), cls:e.className||'',
               x: Math.round(b.left - r.left), w: Math.round(b.width) }; })
      .sort(function(a,b){ return a.x - b.x; });
  }
  return { headsPriced: heads(priced), headsDashed: heads(dashed), thead: Array.prototype.slice.call(document.querySelectorAll('.mx-thead > span'))
             .map(function(s){ var b=s.getBoundingClientRect();
               return { t:(s.textContent||'').trim(), x:Math.round(b.left), w:Math.round(b.width) }; }),
           priced: pack(priced, 'PRICED'), dashed: pack(dashed, 'DASHED') };
})()`);

console.log(`deployed=${info.commit.slice(0,8)} builtAt=${info.builtAt}`);
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync('.ten206-probes/ten225-implied-gap-probe.json', JSON.stringify({ info, ...out }, null, 1));
ws.close(); chrome.kill();
process.exit(0);
