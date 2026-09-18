import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.argv[2] || 'http://127.0.0.1:8776').replace(/\/$/, '');
const KEYS = process.argv.slice(3).length ? process.argv.slice(3) : ['1980', '379'];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const FAV_LABELS = ['1.01 – 1.20', '1.21 – 1.40', '1.41 – 1.64', '1.65 – 1.99'];
const DOG_LABELS = ['2.00 – 2.49', '2.50 – 3.49', '3.50 – 5.99', '6.00 +'];

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

const dport = 9400 + Math.floor((Date.now() / 997) % 200);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'mktprobe-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`,
  `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

const ws = new WebSocket(await cdpTarget(dport));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
const jsErrors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    jsErrors.push(((d.exception && d.exception.description) || d.text || '').slice(0, 180));
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

const checks = [];
const ok = (name, pass, detail) => { checks.push({ name, pass, detail }); };

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,
    get(){return _b;},set(v){if(v){v.requireVerified=()=>true;v.requireAuth=()=>true;}_b=v;}});})();`,
});
await send('Page.navigate', { url: `${BASE}/bsp-consult-dashboard.html` });
for (let i = 0; i < 300; i++) {
  if (await ev(`typeof playerProfiles !== 'undefined' && Object.keys(playerProfiles||{}).length > 0`)) break;
  await sleep(250);
}
console.log(`BASE=${BASE}  keys=${KEYS.join(',')}`);


// ── §5.8 Derived lines, read off the DRIVEN deployed page ──────────────────
for (const key of KEYS) {
  const got = await ev(`typeof ensurePlayerProfile === 'function'
    ? ensurePlayerProfile(${JSON.stringify(key)}) : Promise.resolve(false)`);
  if (!got) { ok(`${key} profile loads`, false, 'profile fetch failed'); continue; }
  await ev(`(typeof showPlayerProfileV2 === 'function' ? showPlayerProfileV2 : showPlayerProfile)(${JSON.stringify(key)})`);
  await sleep(900);

  const opened = await ev(`(function(){
    var bs = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="box"]'));
    var b = bs.filter(function(e){ return /Market edge/i.test(e.textContent||''); })[0];
    if (!b) return null; b.click(); return true;
  })()`);
  ok(`${key} Market edge box opens`, !!opened);
  if (!opened) continue;
  await sleep(800);

  // The profile sits in a display:none tabpage in headless; inside it every
  // offset* is 0 and getComputedStyle returns the SPECIFIED value, so a
  // geometry read there proves nothing. Force ancestors visible first.
  await ev(`(function(){
    var e = document.querySelector('[data-pp2="scrim"]');
    for (var p = e; p && p !== document.documentElement; p = p.parentElement) {
      if (getComputedStyle(p).display === 'none') p.style.display = 'block';
    }
    void document.body.offsetHeight;
  })()`);
  await sleep(200);

  const tabs = await ev(`(function(){
    return Array.prototype.slice.call(document.querySelectorAll('[data-pp2="market-tab"]'))
      .map(function(b){ return (b.textContent||'').trim(); });
  })()`);
  ok(`${key} tab row is Match winner | Derived lines`,
    JSON.stringify(tabs) === JSON.stringify(['Match winner', 'Derived lines']), JSON.stringify(tabs));

  const clicked = await ev(`(function(){
    var b = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="market-tab"]'))
      .filter(function(e){ return /Derived lines/.test(e.textContent||''); })[0];
    if (!b) return false; b.click(); return true;
  })()`);
  ok(`${key} Derived lines tab clicks`, !!clicked);
  await sleep(700);
  await ev(`(function(){
    var e = document.querySelector('[data-pp2="scrim"]');
    for (var p = e; p && p !== document.documentElement; p = p.parentElement) {
      if (getComputedStyle(p).display === 'none') p.style.display = 'block';
    }
    void document.body.offsetHeight;
  })()`);
  await sleep(200);

  // The Bo3|Bo5 grain is module state and is DELIBERATELY sticky across players
  // (switching tab must not reset the format). So set it explicitly before
  // reading: the first draft assumed each player opened on Bo3 and reported a
  // correct page as broken on the second subject.
  await ev(`(function(){ var b = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="lc-fmt"]'))
    .filter(function(e){ return /Best of 3/.test(e.textContent||''); })[0]; if (b) b.click(); })()`);
  await sleep(600);
  await ev(`(function(){
    var e = document.querySelector('[data-pp2="scrim"]');
    for (var p = e; p && p !== document.documentElement; p = p.parentElement) {
      if (getComputedStyle(p).display === 'none') p.style.display = 'block';
    }
    void document.body.offsetHeight;
  })()`);
  await sleep(150);

  const seen = await ev(`(function(){
    var sc = document.querySelector('[data-pp2="scrim"]'); if (!sc) return null;
    var t = (sc.textContent||'').replace(/\\s+/g,' ');
    var groups = ['Games handicap','Set handicap','Total games','Match shape']
      .filter(function(g){ return t.indexOf(g) >= 0; });
    var cols = ['Matches','Hit','Record','Rate','Avg margin']
      .filter(function(c){ return t.indexOf(c) >= 0; });
    var grid = null;
    var els = Array.prototype.slice.call(sc.querySelectorAll('div'));
    for (var i=0;i<els.length;i++){
      var gt = getComputedStyle(els[i]).gridTemplateColumns;
      if (gt && gt.split(' ').length === 6 && /58px|58\\./.test(gt)) { grid = gt; break; }
    }
    return { groups: groups, cols: cols, grid: grid,
      fmt: Array.prototype.slice.call(sc.querySelectorAll('[data-pp2="lc-fmt"]'))
        .map(function(b){ return (b.textContent||'').trim(); }),
      note: (t.match(/Lines are derived from set scores[^]*?priced of \\d+\\./)||[''])[0].slice(0,400),
      rows: (t.match(/−?\\+?[\\d.]+ (games|sets)/g)||[]).slice(0,6) };
  })()`);
  ok(`${key} all four line groups render`, seen && seen.groups.length === 4, seen && seen.groups.join(' · '));
  ok(`${key} column set is the export's`, seen && seen.cols.length === 5, seen && seen.cols.join(' · '));
  ok(`${key} Bo3|Bo5 grain control`, seen && JSON.stringify(seen.fmt) === JSON.stringify(['Best of 3','Best of 5']),
    seen && JSON.stringify(seen.fmt));
  ok(`${key} 6-track grid at the export's geometry`, !!(seen && seen.grid), seen && seen.grid);
  ok(`${key} footnote carries the ruled disclaimer + counts`,
    !!(seen && /coverage rates, not results against a priced line/.test(seen.note)
      && /excluded — retired or abandoned/.test(seen.note)), seen && seen.note.slice(0,200));

  // Switching the grain must change the printed lines: Bo3 is ±4.5/±2.5,
  // Bo5 is ±6.5/±3.5. A control that only checked "it still renders" would
  // pass on a grain switch that did nothing.
  const bo3 = seen && seen.rows.join(',');
  await ev(`(function(){ var b = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="lc-fmt"]'))
    .filter(function(e){ return /Best of 5/.test(e.textContent||''); })[0]; if (b) b.click(); })()`);
  await sleep(600);
  const bo5 = await ev(`(function(){
    var sc = document.querySelector('[data-pp2="scrim"]');
    var t = (sc.textContent||'').replace(/\\s+/g,' ');
    return (t.match(/−?\\+?[\\d.]+ (games|sets)/g)||[]).slice(0,6).join(',');
  })()`);
  ok(`${key} Bo3|Bo5 actually re-derives the ladder`, !!bo3 && !!bo5 && bo3 !== bo5,
    `bo3 [${bo3}] -> bo5 [${bo5}]`);
}

const errs = await ev(`window.__pp2errs ? window.__pp2errs.length : 0`);
ok('zero JS errors on the page', errs === 0, String(errs));
let PASS = 0, FAIL = 0;
for (const c of checks) {
  if (c.pass) PASS++; else FAIL++;
  console.log(`  ${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? ' :: ' + c.detail : ''}`);
}
console.log(`\nPASS ${PASS}  FAIL ${FAIL}`);
process.exit(FAIL ? 1 : 0);
