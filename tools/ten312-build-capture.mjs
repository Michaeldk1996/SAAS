#!/usr/bin/env node
// TEN-312 / TEN-314 — TEST-ONLY build-side capture for the Match analysis pixel-diff harness (the other half of
// tools/ten312-design-capture.mjs). Never loaded by the live page and never run in CI: a manual tool.
//
// FIXTURE MODE lives here and only here: the shipped dashboard is served from this checkout, the auth redirect
// is neutered, the clock and zone are frozen exactly as the design capture freezes them, and the design's demo
// match (DF `demoMatch()` / README §9: ATP Washington · QF · Hard · J. Sinner 1.54 v C. Alcaraz 2.62) is pushed
// into the page's `matches` over CDP. Nothing of this reaches bsp-consult-dashboard.html — test-ten314-modal-frame
// greps the deployed allowlist for it. Fixture players carry no player key, so the header shows the monogram
// fallback (D5) and no tab loads a real player's shard.
//
//   node tools/ten312-build-capture.mjs <outDir> [--ref <design capture dir>] [--only key,form] [--theme night|day]
//
// Writes <outDir>/<design screen name>.png (the modal box grown to full content height, 1296 or 1306 wide — the
// design capture's framing rules) + <outDir>/manifest.json, which also carries each screen's header and menu
// crop boxes (modal-relative px). Regenerates nothing else.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const OUT = args[0] && !args[0].startsWith('--') ? path.resolve(args[0]) : null;
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ONLY = opt('--only') ? new Set(opt('--only').split(',')) : null;
const THEME = opt('--theme') || null;
// --ref <design capture dir>: frame each screen at the width the design capture used (its manifest), so the two
// PNGs line up column for column even where our content height would pick the other width.
const REF = opt('--ref') ? JSON.parse(fs.readFileSync(path.join(path.resolve(opt('--ref')), 'manifest.json'), 'utf8')) : null;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!OUT) { console.error('usage: node tools/ten312-build-capture.mjs <outDir> [--only key,form] [--theme night|day]'); process.exit(2); }

// Same clock, zone, viewport and fit rule as tools/ten312-design-capture.mjs.
const FROZEN_NOW = Date.parse('2026-09-28T12:19:30+08:00');
const TZ = 'Asia/Makassar';
const VIEW_W = 1370, VIEW_H = 745, FIT_H = 760;
// our menu key → the design screen it compares with (default state of each tab)
const TABS = [['key', '03-key-factors'], ['news', '04-news'], ['style', '05-playing-style'], ['form', '06-form'], ['h2h', '07-h2h'],
  ['matchstats', '08-match-stats-key-stats'], ['progression', '01-progression'], ['overview', '02-overview'], ['tournament', '09-tournament'],
  ['weather', '10-weather-state-c'], ['odds', '11-odds'], ['marketedge', '12-market-edge-match-winner']];

// The design's demo match (DF demoMatch / README §9). Start = Jul 20, 2026 18:00 venue time (Washington, UTC−4).
// It is COMPLETED (Sinner won 6-4 4-6 7-6), which is why the design's screens draw no header matchup strip.
const FIXTURE = { id: 'ten312-fixture', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: null, p2Key: null,
  tour: 'ATP Washington', tournament: 'ATP Washington', tournamentRound: 'ATP Washington - Quarter-finals', surface: 'Hard',
  startTs: '2026-07-20T22:00:00Z', bestOdds: { p1: { price: 1.54 }, p2: { price: 2.62 } },
  finalScore: { display: '6-4, 4-6, 7-6', sets: [{ p1: 6, p2: 4 }, { p1: 4, p2: 6 }, { p1: 7, p2: 6 }], p1Sets: 2, p2Sets: 1, winner: 'p1' } };

async function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); }); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
function serve(root, port) {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = path.join(root, rel === '/' ? '/bsp-consult-dashboard.html' : rel);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r(srv)));
}
async function cdpTarget(dport, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { const l = await (await fetch(`http://127.0.0.1:${dport}/json`)).json(); const p = l.find((t) => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch {} await sleep(200); }
  throw new Error('no CDP page target');
}
function client(url) {
  const ws = new WebSocket(url); let id = 0; const pending = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = () => res(); ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, (m) => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)); ws.send(JSON.stringify({ id: mid, method, params })); });
  return { ready, send, close: () => ws.close() };
}
let chrome, srv, c, profile;
function cleanup() {
  try { c?.close(); } catch {}
  try { chrome && chrome.exitCode == null && chrome.kill('SIGKILL'); } catch {}
  try { srv?.close(); srv?.closeAllConnections?.(); } catch {}
  try { profile && fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.on('exit', cleanup);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { cleanup(); process.exit(130); });

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  profile = path.join(OUT, '.chrome-profile'); fs.rmSync(profile, { recursive: true, force: true });
  const port = await freePort(); srv = await serve(ROOT, port);
  const dport = await freePort();
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${profile}`, '--remote-allow-origins=*', '--no-first-run',
    '--no-default-browser-check', '--force-device-scale-factor=1', '--hide-scrollbars', '--font-render-hinting=none', '--disable-gpu', '--disable-partial-raster',
    '--disable-threaded-animation', '--disable-checker-imaging', `--window-size=${VIEW_W},${VIEW_H}`, 'about:blank'], { stdio: 'ignore' });
  c = client(await cdpTarget(dport)); await c.ready;
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false });
  await c.send('Emulation.setTimezoneOverride', { timezoneId: TZ });
  await c.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const T = ${FROZEN_NOW}, RD = Date;
    function D(...a) { if (!new.target) return new RD(T).toString(); return a.length ? new RD(...a) : new RD(T); }
    D.prototype = RD.prototype; D.now = () => T; D.parse = RD.parse; D.UTC = RD.UTC;
    Object.defineProperty(D.prototype, 'constructor', { value: D }); window.Date = D;
    var _b; Object.defineProperty(window, 'BSP', { configurable: true, get() { return _b; }, set(v) { if (v) { const u = Promise.resolve({ emailVerified: true });
      v.requireVerified = () => u; v.requireAuth = () => u; } _b = v; } });
  })();` });
  const ev = async (expr) => { const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('eval threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result?.value; };
  await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/bsp-consult-dashboard.html` });
  const t0 = Date.now();
  while (!(await ev(`typeof matches === 'object' && Array.isArray(matches) && typeof openAnalysisModal === 'function' && typeof aShowTab === 'function'`).catch(() => false))) {
    if (Date.now() - t0 > 90000) throw new Error('dashboard did not boot within 90 s (is this checkout serving? see frame.json)'); await sleep(300);
  }
  await ev(`document.fonts.ready.then(() => true)`);
  // the fixture match, then open the modal on it
  await ev(`(() => { const fx = ${JSON.stringify(FIXTURE)}; const i = matches.findIndex(m => m.id === fx.id); if (i >= 0) matches.splice(i, 1); matches.push(fx); return true; })()`);
  if (THEME) await ev(`typeof maSetTheme === 'function' ? (maSetTheme(${JSON.stringify(THEME)}), true) : false`);
  await ev(`openAnalysisModal('ten312-fixture'), true`);
  const served = await ev(`!!document.querySelector('#analysisModal .aclosecell')`);
  const settle = `new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => { for (const a of document.getAnimations()) { try { a.finish(); } catch (e) { try { a.pause(); a.currentTime = 0; } catch (_) {} } } r(true); }, 400))))`;
  const manifest = [];
  const REFW = r => { const x = REF && REF.screens.find(q => q.name === r); return x ? x.size[0] : 0; };
  for (const [tab, ref] of TABS) {
    if (ONLY && !ONLY.has(tab)) continue;
    await ev(`aShowTab(${JSON.stringify(tab)}), true`);
    await sleep(1500); await ev(settle);
    // Grow the modal to its full content height — the design capture's _grow(), on our elements.
    const frame = await ev(`(() => {
      const ov = document.getElementById('analysisModal'), m = ov.querySelector('.modal-analysis'), body = m.querySelector('.aanalysis-body-wrap');
      window.__saved = [document.documentElement, document.body, ov, m, body, m.querySelector('.asidenav'), m.querySelector('.abody')].map(e => [e, e.getAttribute('style')]);
      const st = (e, css) => e.setAttribute('style', (e.getAttribute('style') || '') + ';' + css);
      // the design capture has nothing behind the modal's rounded corners: neither may we (the page paints its own bg)
      st(document.documentElement, 'background:transparent !important;'); st(document.body, 'background:transparent !important;');
      if (!document.getElementById('__capHide')) { const h = document.createElement('style'); h.id = '__capHide';
        h.textContent = 'body > *:not(#analysisModal){ visibility:hidden !important; }'; document.head.appendChild(h); }
      st(ov, 'background:transparent !important; backdrop-filter:none !important; position:absolute !important; inset:auto !important; left:0 !important; top:0 !important; width:${VIEW_W}px !important; height:auto !important; min-height:${VIEW_H}px !important; align-items:flex-start !important;');
      st(m, 'height:auto !important;'); st(body, 'flex:none !important; grid-template-rows:auto !important;');
      st(m.querySelector('.asidenav'), 'overflow:visible !important;'); st(m.querySelector('.abody'), 'overflow:visible !important;');
      const h = m.getBoundingClientRect().height, w = ${REFW(ref)} || (h > ${FIT_H} ? 1296 : 1306);
      st(ov, 'width:' + (w + 64) + 'px !important; padding:32px !important;'); st(m, 'min-height:${Math.round(VIEW_H * 0.88)}px !important;');
      const r = m.getBoundingClientRect(), hd = m.querySelector('.ahead2').getBoundingClientRect(), nv = m.querySelector('.asidenav'), items = nv.querySelectorAll('.asidenav-item, .asidenav-download');
      const last = items[items.length - 1].getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, w: Math.round(r.width), h: Math.round(r.height), naturalH: Math.round(h),
        header: [0, 0, Math.round(r.width), Math.round(hd.bottom - r.top)], menu: [0, Math.round(hd.bottom - r.top), Math.round(nv.getBoundingClientRect().right - r.left), Math.round(last.bottom - r.top + 16)] };
    })()`);
    await sleep(120); await ev(settle);
    const shot = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true, clip: { x: frame.x, y: frame.y, width: frame.w, height: frame.h, scale: 1 } });
    fs.writeFileSync(path.join(OUT, ref + '.png'), Buffer.from(shot.data, 'base64'));
    manifest.push({ tab, ref, size: [frame.w, frame.h], header: frame.header, menu: frame.menu });
    console.log(`${tab.padEnd(12)} → ${ref.padEnd(30)} ${frame.w}x${frame.h}`);
    await ev(`(() => { for (const [e, s] of window.__saved) { if (s == null) e.removeAttribute('style'); else e.setAttribute('style', s); } return true; })()`);
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ servedThisCheckout: served, root: ROOT, fixture: FIXTURE, frozenNow: new Date(FROZEN_NOW).toISOString(), timezone: TZ, theme: THEME, screens: manifest }, null, 1));
  if (!served) throw new Error('the page served is not this checkout (no .aclosecell)');
}
main().then(() => { cleanup(); process.exit(0); }, (e) => { console.error('FAIL:', e.stack || e.message); cleanup(); process.exit(1); });
