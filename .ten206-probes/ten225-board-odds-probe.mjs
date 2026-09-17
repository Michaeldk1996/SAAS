#!/usr/bin/env node
/**
 * ten225-board-odds-probe.mjs — read the DEPLOYED Matches board and report, per
 * row, what the ODDS · IMPLIED column ACTUALLY renders.
 *
 * Why this is driven and not read off the source: bsp-consult-dashboard.html
 * says the odds column is pinned to bet365 (_mcBet365Now, TEN-179 item 5), and
 * no Davis Cup fixture on today's board carries a bet365 leg — so reading the
 * code predicts a dash on all 32. The founder reports seeing real prices
 * (Kwon 1.50, Suresh 2.37). One of those two is wrong, and only the rendered
 * DOM settles it. Memory: a DOM read proves correctness, a screenshot only
 * proves it painted.
 *
 * It also answers the design-gap question directly: for a row whose odds cell
 * is empty or dashed, what does the cell to its RIGHT render, and is there
 * anything in the DOM (header, aria, alignment) that tells a member the
 * percentage belongs to Form and not to Odds · Implied?
 *
 * Usage: node ten225-board-odds-probe.mjs [baseUrl]
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

const dport = 9700 + Math.floor((Date.now() / 997) % 200);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'ten225board-'));
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
// Memory: CDP deployed-page auth bypass.
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
console.log(`BASE=${BASE}  deployed=${info.commit.slice(0, 8)}  builtAt=${info.builtAt}`);

// The board's day tabs are the member's entry point. Walk every tab that has
// rows rather than assuming which one is "today" — the bucket is derived from
// the CLIENT clock, and guessing it wrong reports a false empty board.
const tabs = await ev(`(function(){
  var t = document.getElementById('dayTabs');
  if (!t) return [];
  return Array.prototype.slice.call(t.querySelectorAll('button,[data-day]')).map(function(b){
    return { day: b.dataset.day || '', label: (b.textContent||'').replace(/\\s+/g,' ').trim() };
  });
})()`);
console.log('day tabs:', JSON.stringify(tabs));

const report = { base: BASE, deployed: info.commit, builtAt: info.builtAt, tabs, days: {} };

for (const t of tabs) {
  if (!t.day) continue;
  await ev(`(function(){
    var b = document.querySelector('#dayTabs [data-day=${JSON.stringify(t.day)}]');
    if (b) b.click();
  })()`);
  await sleep(600);

  const rows = await ev(`(function(){
    var list = document.getElementById('matchlist');
    if (!list) return { error: 'no #matchlist' };
    // The header tells us how many columns the member sees and in what order.
    var head = Array.prototype.slice.call(document.querySelectorAll('.mx-thead > span'))
      .map(function(s){ return (s.textContent||'').replace(/\\s+/g,' ').trim(); });
    var cards = Array.prototype.slice.call(list.children);
    var out = cards.map(function(c){
      var txt = function(sel){ var e = c.querySelector(sel); return e ? (e.textContent||'').replace(/\\s+/g,' ').trim() : null; };
      var all = function(sel){ return Array.prototype.slice.call(c.querySelectorAll(sel))
        .map(function(e){ return (e.textContent||'').replace(/\\s+/g,' ').trim(); }); };
      return {
        id: c.id || c.dataset.id || null,
        // whole-card text, trimmed - the ground truth a member reads
        text: (c.textContent||'').replace(/\\s+/g,' ').trim().slice(0, 260),
        oddsMain: all('.mc-odds, .mc-oddsval, [class*="mc-odds"]'),
        implied: all('.mc-implied'),
        form: all('.mc-form, [class*="mc-form"], [class*="formbar"]'),
        // every direct grid child, in DOM order, so column alignment is visible
        cols: Array.prototype.slice.call(c.children).map(function(e){
          return { cls: e.className || '', t: (e.textContent||'').replace(/\\s+/g,' ').trim().slice(0, 90) };
        }),
      };
    });
    return { head: head, n: cards.length, rows: out };
  })()`);
  report.days[t.day] = { label: t.label, ...rows };
  console.log(`  tab ${t.day.padEnd(10)} (${t.label}): ${rows.n != null ? rows.n : '?'} rows`);
}

fs.writeFileSync('.ten206-probes/ten225-board-odds-probe.json', JSON.stringify(report, null, 1));
console.log('wrote .ten206-probes/ten225-board-odds-probe.json');
ws.close(); chrome.kill();
process.exit(0);
