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


// ── ITEM 1 · the denominator each row PRINTS vs the one its Rate is over ────
// Read by GEOMETRY: the table is a flat 6-track CSS grid, so textContent on a
// parent concatenates cells with no separator. Cells are grouped by their
// rendered `left` edge — grouping by `top` shears the label off its row.
async function unhide() {
  await ev(`(function(){
    var e = document.querySelector('[data-pp2="scrim"]');
    for (var p = e; p && p !== document.documentElement; p = p.parentElement) {
      if (getComputedStyle(p).display === 'none') p.style.display = 'block';
    }
    void document.body.offsetHeight;
  })()`);
  await sleep(200);
}

async function readTable(key, grain) {
  const got = await ev(`typeof ensurePlayerProfile === 'function'
    ? ensurePlayerProfile(${JSON.stringify(key)}) : Promise.resolve(false)`);
  if (!got) return { error: 'profile fetch failed' };
  await ev(`(typeof showPlayerProfileV2 === 'function' ? showPlayerProfileV2 : showPlayerProfile)(${JSON.stringify(key)})`);
  await sleep(900);
  await ev(`(function(){
    var bs = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="box"]'));
    var b = bs.filter(function(e){ return /Market edge/i.test(e.textContent||''); })[0];
    if (b) b.click();
  })()`);
  await sleep(800); await unhide();
  await ev(`(function(){ var b = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="market-tab"]'))
    .filter(function(e){ return /Derived lines/.test(e.textContent||''); })[0]; if (b) b.click(); })()`);
  await sleep(700); await unhide();
  // Set the grain EXPLICITLY — it is module state and sticky across players.
  await ev(`(function(){ var b = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="lc-fmt"]'))
    .filter(function(e){ return new RegExp(${JSON.stringify(grain)}).test(e.textContent||''); })[0]; if (b) b.click(); })()`);
  await sleep(700); await unhide();

  return await ev(`(function(){
    var sc = document.querySelector('[data-pp2="scrim"]'); if (!sc) return { error: 'no scrim' };
    var grids = Array.prototype.slice.call(sc.querySelectorAll('div')).filter(function(d){
      var gt = getComputedStyle(d).gridTemplateColumns;
      return gt && gt.split(' ').length === 6 && /58px/.test(gt);
    });
    // grids[0] is the column head; the rest are the four group bodies.
    var out = [];
    for (var gi = 0; gi < grids.length; gi++) {
      var kids = Array.prototype.slice.call(grids[gi].children);
      if (!kids.length) continue;
      var lefts = [];
      kids.forEach(function(k){ var L = Math.round(k.getBoundingClientRect().left);
        if (lefts.indexOf(L) < 0) lefts.push(L); });
      lefts.sort(function(a,b){ return a-b; });
      if (lefts.length !== 6) continue;
      var body = [];
      for (var i = 0; i + 5 < kids.length; i += 6) {
        var cells = [];
        for (var c = 0; c < 6; c++) cells.push((kids[i+c].textContent||'').replace(/\\s+/g,' ').trim());
        if (/^Matches$/.test(cells[1] || '')) continue;
        body.push(cells);
      }
      if (body.length) out.push(body);
    }
    // group titles sit in a sibling block above each grid
    var titles = (sc.textContent||'').replace(/\\s+/g,' ');
    return { groups: out, hasTitles: ['Games handicap','Set handicap','Total games','Match shape']
      .filter(function(g){ return titles.indexOf(g) >= 0; }),
      note: (titles.match(/Lines are derived from set scores[^]*?priced of \d+\./)||[''])[0] };
  })()`);
}

const GROUP_ORDER = ['Games handicap', 'Set handicap', 'Total games', 'Match shape'];
for (const spec of (process.env.LC_SUBJECTS || '1980:Best of 3').split(',')) {
  const [key, grain] = spec.split(':');
  const t = await readTable(key, grain);
  const nm = await ev(`(function(){var p=(playerProfiles&&playerProfiles.players)||playerProfiles||{};
    var e=p[${JSON.stringify(key)}]; return e?e.name:null;})()`);
  console.log(`\n=== ${nm || key} (${key}) · ${grain} ===`);
  if (t.error) { console.log('  ERROR ' + t.error); continue; }
  console.log('  groups present: ' + t.hasTitles.join(' · '));
  t.groups.forEach(function (body, i) {
    console.log(`\n  --- grid ${i} (${GROUP_ORDER[i] || '?'}) ---`);
    console.log('  LABEL                 | MATCHES |  HIT | RECORD |   RATE   | rate-denom | record-sum');
    body.forEach(function (c) {
      const label = (c[0] || '').slice(0, 20).padEnd(20);
      const matches = c[1] || '';
      const hit = c[2] || '';
      const rec = c[3] || '';
      const rate = c[4] || '';
      // the denominator the RATE is actually over, two independent ways
      const m = String(rec).match(/^(\d+)[–-](\d+)$/);
      const recSum = m ? (+m[1] + +m[2]) : null;
      const pct = parseFloat(String(rate).replace('%', ''));
      const impl = (isFinite(pct) && pct > 0 && /^\d+$/.test(hit))
        ? Math.round(+hit / (pct / 100)) : null;
      console.log(`  ${label}| ${String(matches).padStart(7)} | ${String(hit).padStart(4)} | ${String(rec).padStart(6)} | ${String(rate).padStart(8)} | ${String(impl == null ? '—' : impl).padStart(10)} | ${String(recSum == null ? '—' : recSum).padStart(10)}`);
    });
  });
  if (t.note) console.log('\n  note: ' + t.note.slice(0, 320));
}
const errs = jsErrors.length;
console.log(`\nJS errors: ${errs}`);
process.exit(0);
