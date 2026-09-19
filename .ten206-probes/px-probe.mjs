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
  '--disable-gpu', `--window-size=${process.env.PX_W || 1440},1000`, 'about:blank'], { stdio: 'ignore' });

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
if (process.env.PX_W) await send('Emulation.setDeviceMetricsOverride', { width: +process.env.PX_W, height: 1000, deviceScaleFactor: 2, mobile: false });
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


// ─────────────────────────────────────────────────────────────────────────────
// TEN-206 pixel refinement pass — row-by-row measurement off the rendered page.
// Every number below is read back from getBoundingClientRect / getComputedStyle,
// never from the source. The page mounts inside a display:none .tabpage, where
// every offset* is 0 and getComputedStyle returns the SPECIFIED value, so the
// nav's own deep-link path is taken first and the profile's visibility asserted
// before a single measurement is trusted.
// ─────────────────────────────────────────────────────────────────────────────
const out = {};
for (const KEY of KEYS) {
  await ev(`document.querySelector('#mainNav button[data-tab="players"]').click()`);
  await sleep(300);
  await ev(`(async()=>{ if (typeof ensurePlayerProfile==='function') await ensurePlayerProfile(${JSON.stringify(KEY)});
             showPlayerProfileV2(${JSON.stringify(KEY)}); })()`);
  // Lazy-store settle: five stores repaint on arrival. Reading early reported
  // four correct boxes as dashes on a previous run.
  for (let i = 0; i < 80; i++) {
    const pend = await ev(`(function(){var b=[].slice.call(document.querySelectorAll('.pp2-box'));
      return b.length===8 && !b.some(function(x){return /not loaded|Loading/.test(x.textContent);});})()`);
    if (pend) break;
    await sleep(250);
  }
  const degenerate = await ev(`(function(){var c=document.querySelector('.pp2-box');
    if(!c) return 'no box'; var r=c.getBoundingClientRect();
    return (r.width<10||r.height<10) ? ('degenerate '+r.width+'x'+r.height) : null;})()`);
  if (degenerate) { console.log(`KEY ${KEY}: REFUSING TO MEASURE — ${degenerate}`); continue; }

  out[KEY] = await ev(`(function(){
    var R = function(el){ var r = el.getBoundingClientRect();
      return {x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1)}; };
    var CS = function(el, props){ var c = getComputedStyle(el), o = {};
      props.forEach(function(p){ o[p] = c[p]; }); return o; };
    // A block's line count from its own box and its own line-height — not from
    // a character estimate, which is what "it wraps" was being eyeballed from.
    var lines = function(el){ var lh = parseFloat(getComputedStyle(el).lineHeight);
      return lh ? Math.round(el.getBoundingClientRect().height / lh) : null; };
    var res = { name: (document.querySelector('[data-pp2="pname"]')||{}).textContent || null };

    // ── item 1 · meta-strip vertical rules ──────────────────────────────────
    var boxesEl = document.querySelector('.pp2-grid');
    var head = boxesEl ? boxesEl.closest('.pp2-root') || document.body : document.body;
    var rules = [].slice.call(document.querySelectorAll('span')).filter(function(s){
      var r = s.getBoundingClientRect(), c = getComputedStyle(s);
      return r.width > 0 && r.width <= 2 && r.height > 20 && r.height < 200 &&
             /rgba\\(255, 255, 255/.test(c.backgroundColor);
    });
    res.metaRules = rules.map(function(s){
      var sib = s.nextElementSibling;
      return { rect: R(s), bg: getComputedStyle(s).backgroundColor,
               width: getComputedStyle(s).width,
               blockH: sib ? +sib.getBoundingClientRect().height.toFixed(1) : null };
    });

    // ── item 1b · the header's horizontal divider ───────────────────────────
    var hdr = [].slice.call(document.querySelectorAll('div')).filter(function(d){
      var c = getComputedStyle(d);
      return c.borderBottomStyle === 'solid' && parseFloat(c.borderBottomWidth) > 0 &&
             /rgba\\(255, 255, 255, 0\\.0[6-9]/.test(c.borderBottomColor) &&
             d.getBoundingClientRect().width > 500;
    })[0];
    res.divider = hdr ? { rect: R(hdr),
      width: getComputedStyle(hdr).borderBottomWidth,
      color: getComputedStyle(hdr).borderBottomColor,
      padBottom: getComputedStyle(hdr).paddingBottom } : null;

    // ── items 2/3/4/7 · the eight boxes ─────────────────────────────────────
    var boxes = [].slice.call(document.querySelectorAll('.pp2-box'));
    res.boxes = boxes.map(function(b){
      var kids = [].slice.call(b.children).filter(function(k){ return k.tagName !== 'svg'; });
      var hl = kids[0], ti = kids[1], su = kids[2];
      var sufSpan = hl && hl.querySelector('span');
      return {
        key: b.getAttribute('data-box'),
        rect: R(b),
        headline: hl ? hl.textContent : null,
        // item 2 · does the headline slot carry a NUMBER? A digit anywhere in it.
        headlineHasDigit: hl ? /[0-9]/.test(hl.textContent) : null,
        headlineFont: hl ? CS(hl, ['fontSize','fontWeight','lineHeight','color','fontFamily','letterSpacing']) : null,
        suffixColor: sufSpan ? getComputedStyle(sufSpan).color : null,
        suffixText: sufSpan ? sufSpan.textContent : null,
        title: ti ? ti.textContent : null,
        support: su ? su.textContent : null,
        supportTokens: su ? su.textContent.split(' \\u00b7 ').length : null,
        supportLines: su ? lines(su) : null,
        supportFont: su ? CS(su, ['fontSize','lineHeight','color']) : null
      };
    });
    // item 4 · card heights, computed independently per ROW from the grid's own
    // geometry rather than asserted from the markup's min-height.
    var hs = res.boxes.map(function(b){ return b.rect.h; });
    var ys = res.boxes.map(function(b){ return b.rect.y; });
    var row1 = res.boxes.filter(function(b){ return b.rect.y === ys[0]; });
    var row2 = res.boxes.filter(function(b){ return b.rect.y !== ys[0]; });
    res.heights = { all: hs, uniq: hs.filter(function(v,i,a){return a.indexOf(v)===i;}),
      row1h: row1.map(function(b){return b.rect.h;}),
      row2h: row2.map(function(b){return b.rect.h;}),
      rowGap: row2.length ? +(row2[0].rect.y - (row1[0].rect.y + row1[0].rect.h)).toFixed(1) : null,
      colGaps: row1.slice(1).map(function(b,i){ return +(b.rect.x - (row1[i].rect.x + row1[i].rect.w)).toFixed(1); }) };

    // ── item 5 · key insights ───────────────────────────────────────────────
    res.insights = [].slice.call(document.querySelectorAll('[data-insight]')).map(function(c){
      var kids = [].slice.call(c.children);
      var ti = kids[1], bo = kids[2];
      return { id: c.getAttribute('data-insight'), rect: R(c),
        title: ti ? ti.textContent : null,
        titleHasDigit: ti ? /[0-9]/.test(ti.textContent) : null,
        titleLines: ti ? lines(ti) : null,
        titleFont: ti ? CS(ti, ['fontSize','fontWeight','lineHeight','letterSpacing','color']) : null,
        body: bo ? bo.textContent : null,
        bodyLines: bo ? lines(bo) : null,
        bodyFont: bo ? CS(bo, ['fontSize','lineHeight','color']) : null };
    });

    // ── item 6 · recent-form ribbon ─────────────────────────────────────────
    var chips = [].slice.call(document.querySelectorAll('.pp2-chip'));
    var track = chips.length ? chips[0].parentElement : null;
    res.ribbon = { chipCount: chips.length,
      chipRects: chips.map(R),
      trackRect: track ? R(track) : null,
      trackMask: track ? (getComputedStyle(track).webkitMaskImage || getComputedStyle(track).maskImage) : null,
      trackOverflow: track ? getComputedStyle(track).overflow : null,
      // How many chips are actually INSIDE the track, i.e. what the eye sees
      // before the fade — the founder's "two with dead space" is a claim about
      // this number, not about the emitted count.
      visible: track ? chips.filter(function(c){
        return c.getBoundingClientRect().right <= track.getBoundingClientRect().right + 0.5; }).length : null,
      deadSpace: track && chips.length ? +(track.getBoundingClientRect().right -
        chips[chips.length-1].getBoundingClientRect().right).toFixed(1) : null };

    return res;
  })()`);
  console.log(`\n${'='.repeat(78)}\nKEY ${KEY} — ${out[KEY].name}\n${'='.repeat(78)}`);
  console.log(JSON.stringify(out[KEY], null, 1));
}
fs.writeFileSync(process.env.PX_OUT || '/tmp/px-measure.json', JSON.stringify(out, null, 1));
console.log('\njsErrors:', jsErrors.length ? jsErrors : 'none');
ws.close(); chrome.kill(); process.exit(0);
