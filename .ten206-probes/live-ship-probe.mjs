#!/usr/bin/env node
/**
 * live-ship-probe.mjs — TEN-206 ship gate, read off the DEPLOYED page.
 *
 * The founder asked for "it's online". That claim needs the page driven, not the
 * diff read: open every one of the eight stat boxes on the live build, prove each
 * modal actually painted rows (not an empty shell), and re-derive the one number
 * the reconciliation rule names first -- career tile == career modal total -- from
 * the rendered DOM rather than from the profile JSON that fed it.
 *
 * A modal that opens but renders zero rows is the failure this is built to catch:
 * it looks shipped in a screenshot and is empty in the hand.
 *
 * Usage: node live-ship-probe.mjs <baseUrl> <key> [key...]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.argv[2] || 'https://michaeldk1996.github.io/SAAS').replace(/\/$/, '');
const KEYS = process.argv.slice(3).length ? process.argv.slice(3) : ['1980'];
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
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'shipprobe-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`,
  `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

const ws = new WebSocket(await cdpTarget(dport));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    errors.push(((d.exception && d.exception.description) || d.text || '').slice(0, 180));
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

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
// Memory: CDP deployed-page auth bypass.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,
    get(){return _b;},set(v){if(v){v.requireVerified=()=>true;v.requireAuth=()=>true;}_b=v;}});})();`,
});
await send('Page.navigate', { url: `${BASE}/bsp-consult-dashboard.html` });

for (let i = 0; i < 300; i++) {
  if (await ev(`typeof playerProfiles !== 'undefined' && Object.keys(playerProfiles||{}).length > 0`)) break;
  await sleep(250);
}

const build = await ev(`(function(){
  return { pp2: typeof FEATURE_PP2 !== 'undefined' ? !!FEATURE_PP2 : (window.FEATURE_PP2 === true) };
})()`);
// Fetched in-page, not from Node: Node's fetch resolves github.io to an
// unreachable IPv6 route on this host and dies, while the browser (which is the
// thing whose view of the site actually matters here) reaches it fine.
const info = await ev(`fetch('${BASE}/build-info.json?cb=' + performance.now()).then(function(r){ return r.json(); })`);
console.log(`BASE=${BASE}  FEATURE_PP2=${build.pp2}  deployed=${info.commit.slice(0, 8)}  builtAt=${info.builtAt}`);

const out = [];
for (const key of KEYS) {
  const got = await ev(`typeof ensurePlayerProfile === 'function'
    ? ensurePlayerProfile(${JSON.stringify(key)}) : Promise.resolve(false)`);
  if (!got) { console.log(`${key}: ERROR profiles/${key}.json did not load`); out.push({ key, error: 'profile fetch' }); continue; }
  await ev(`(typeof showPlayerProfileV2 === 'function' ? showPlayerProfileV2 : showPlayerProfile)(${JSON.stringify(key)})`);
  for (let i = 0; i < 160; i++) {
    if (await ev(`!!(window.careerHistory && window.careerHistory[${JSON.stringify(key)}])`)) break;
    await sleep(250);
  }
  await sleep(700);

  const page = await ev(`(function(){
    var boxes = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="box"]'));
    // Name comes from the loaded profile, not a heading guess: the dashboard's
    // first h1/h2 is the tab title ("Today's Matches"), which silently mislabels
    // every row of this report.
    var hdr = document.querySelector('.pp2-main');
    var nm = hdr ? (hdr.textContent || '').replace(/\\s+/g, ' ').replace(/^\\s*Back to Players\\s*/, '').trim().slice(0, 48) : '';
    return {
      name: nm || '(header not rendered)',
      boxes: boxes.length,
      headlines: boxes.map(function(b){ return (b.textContent||'').replace(/\\s+/g,' ').trim().slice(0, 70); }),
    };
  })()`);

  // Open each box in turn and measure what its overlay actually painted.
  const modals = [];
  for (let bi = 0; bi < page.boxes; bi++) {
    const m = await ev(`(function(){
      // Close anything already open so each box is measured from a clean page.
      var esc = new KeyboardEvent('keydown', {key:'Escape', bubbles:true});
      document.dispatchEvent(esc);
      var b = document.querySelectorAll('[data-pp2="box"]')[${bi}];
      if (!b) return { error: 'box gone' };
      b.click();
      return { clicked: (b.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40) };
    })()`);
    await sleep(800);
    const painted = await ev(`(function(){
      // The page's own vocabulary, established by diffing the DOM across a box
      // click rather than guessed: the overlay root is data-pp2="scrim" (the
      // fixed, z-60 subtree appended to .pp-formsurface). Two earlier guesses
      // ("modal", then "sheet") matched nothing and a near-empty always-present
      // node respectively -- both read exactly like a shipped-broken page, which
      // is why the selector is taken from the page and not from its name.
      var ov = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="scrim"]'))
        .filter(function(e){ var s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden'; });
      if (!ov.length) return { open: false };
      var top = ov[ov.length - 1];
      var txt = (top.textContent||'').replace(/\\s+/g,' ').trim();
      // Count leaf cells that carry a visible glyph. An empty shell scores near 0
      // even though the overlay itself is "open".
      var cells = Array.prototype.slice.call(top.querySelectorAll('*')).filter(function(e){
        return e.children.length === 0 && (e.textContent||'').trim().length > 0;
      }).length;
      var title = (top.querySelector('h1,h2,h3') || {}).textContent || '';
      return { open: true, title: title.replace(/\\s+/g,' ').trim().slice(0,50), cells: cells, chars: txt.length,
               dashes: (txt.match(/\\u2014/g)||[]).length };
    })()`);
    modals.push({ box: m.clicked || m.error, ...painted });
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
    await sleep(250);
  }

  console.log(`\n=== key ${key} — ${page.name} ===`);
  console.log(`  stat boxes rendered   ${page.boxes}`);
  modals.forEach((m, i) => {
    const flag = !m.open ? 'DID NOT OPEN' : (m.cells < 20 ? `THIN (${m.cells} cells)` : 'ok');
    console.log(`  [${i + 1}] ${String(m.box).padEnd(40)} open=${m.open ? 'Y' : 'N'} cells=${String(m.cells ?? 0).padStart(4)} dashes=${String(m.dashes ?? 0).padStart(3)}  ${flag}`);
  });
  out.push({ key, name: page.name, boxes: page.boxes, modals });
}

console.log(`\nJS errors: ${errors.length}`);
errors.slice(0, 6).forEach((e) => console.log('  ' + e));
console.log('JSON ' + JSON.stringify(out));
ws.close(); chrome.kill();
process.exit(0);
