#!/usr/bin/env node
// TEN-333 — TEST-ONLY build-side capture of the Match analysis News tab, the other half of
// tools/ten312-design-capture.mjs for the News screens (04-news … 04f-news-unavailable). Never loaded by the live page
// and never run in CI: a manual tool. Same boot, frozen clock/zone, fixture match and framing as
// tools/ten312-build-capture.mjs (kept separate so the per-tab tickets do not all edit one capture loop).
//
// FIXTURE MODE lives here and only here. The design's own sample articles (DF newsFor `SAMPLE_NEWS`, read out of the
// committed design file at run time — nothing sample-like is committed anywhere else) are converted to the live
// feed's shape (`news-feed.json` rows: news_key, published_at UTC "YYYY-MM-DD HH:MM:SS.sss", player_key, title,
// content paragraphs split on blank lines) and pushed into the page's `_newsData` over CDP; the fixture match gets
// two fixture player keys so the SHIPPED join (player_key) attributes them. An article the design files under both
// players is fed as one row per player (the live feed carries one player_key per row).
//
//   node tools/ten333-news-capture.mjs <outDir> [--ref <design capture dir>] [--theme night|day] [--palette source] [--dump <expr.js>]
//
//   --palette source  re-point the tokens the News tab reads to the design file's SOURCE hex for the role each carries
//                     on this tab (SOURCE_PALETTE below), so a diff against the design capture measures structure, not
//                     the D1 Night/Day palette. Fixture-only CSS injected over CDP.
//
// Writes <outDir>/<screen>.png + <outDir>/manifest.json (each screen's header / menu / content crop boxes). Regenerates
// nothing else.
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
const THEME = opt('--theme') || null;
const PALETTE = opt('--palette') || null;
const DUMP = opt('--dump') ? fs.readFileSync(path.resolve(opt('--dump')), 'utf8') : null;   // debug: a page expression whose value is stored per screen
const REF = opt('--ref') ? JSON.parse(fs.readFileSync(path.join(path.resolve(opt('--ref')), 'manifest.json'), 'utf8')) : null;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!OUT) { console.error('usage: node tools/ten333-news-capture.mjs <outDir> [--ref <design capture dir>] [--theme night|day] [--palette source]'); process.exit(2); }

const FROZEN_NOW = Date.parse('2026-09-28T12:19:30+08:00');   // = tools/ten312-design-capture.mjs
const TZ = 'Asia/Makassar';
const VIEW_W = 1370, VIEW_H = 745, FIT_H = 760;
const FIXTURE = { id: 'ten312-fixture', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: 'ten333-fx-a', p2Key: 'ten333-fx-b',
  tour: 'ATP Washington', tournament: 'ATP Washington', tournamentRound: 'ATP Washington - Quarter-finals', surface: 'Hard',
  startTs: '2026-07-20T22:00:00Z', bestOdds: { p1: { price: 1.54 }, p2: { price: 2.62 } },
  finalScore: { display: '6-4, 4-6, 7-6', sets: [{ p1: 6, p2: 4 }, { p1: 4, p2: 6 }, { p1: 7, p2: 6 }], p1Sets: 2, p2Sets: 1, winner: 'p1' } };

// The design's sample, evaluated from the design file's own source with the fixture's names (DF L2318–2333).
function designSample() {
  const src = fs.readFileSync(path.join(ROOT, 'design', 'handoff-ten312-match-analysis', 'Match Analysis Progression v1.dc.html'), 'utf8');
  const m = src.match(/const SAMPLE_NEWS = (\[[\s\S]*?\n\s*\]);/);
  if (!m) throw new Error('design sample not found in the design file');
  const AN = { aName: FIXTURE.p1, bName: FIXTURE.p2, tourn: FIXTURE.tour };
  return new Function('AN', 'return ' + m[1])(AN);
}
const pad = (n, w = 2) => String(n).padStart(w, '0');
const feedTs = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`; };
function fixtureFeed() {
  const rows = [];
  for (const a of designSample()) {
    for (const [side, name, key] of [['a', FIXTURE.p1, FIXTURE.p1Key], ['b', FIXTURE.p2, FIXTURE.p2Key]]) {
      if (!a.players.includes(name)) continue;
      rows.push({ news_key: a.id, player_key: key, player_name: name, tournament_name: a.tourn, published_at: feedTs(FROZEN_NOW - a.h * 3600e3),
        title: a.title, content: a.body.map((p) => p.t).join('\n\n'), _side: side });
    }
  }
  return { generatedAt: new Date(FROZEN_NOW).toISOString(), articles: rows };
}

// News screens: the design capture's name → how our page is put in that state.
//   feed: 'sample' | 'empty' | 'fail'; filter: our _aNewsFilter; open: our _aNewsOpen key.
const SCREENS = [
  ['04-news', { feed: 'sample' }],
  ['04b-news-article-expanded', { feed: 'sample', open: 'p1:s1' }],        // DF maNewsOpen 'a:s1'
  ['04c-news-filter-player-a', { feed: 'sample', filter: 'p1' }],
  ['04d-news-filter-player-b', { feed: 'sample', filter: 'p2' }],
  ['04e-news-empty', { feed: 'empty' }],
  ['04f-news-unavailable', { feed: 'fail' }],
];

// The design file's source values for the roles the News tab's tokens carry (DF L18, L77–80, L2204–2246).
const SOURCE_PALETTE = `#analysisModal .abody { background:#0A0D14 !important; }
#aSectionNews { --text:#e7e9ee; --label:#5b6880; --text-sub:#a8b0c0; --periwinkle:#5b9bff; --line:rgba(255,255,255,0.09);
  --surface-inner:#0C0E16; --seg-active:rgba(91,155,255,0.16); --seg-active-line:rgba(91,155,255,0.22); }
#aSectionNews .ma-seg { border-color:rgba(255,255,255,0.06) !important; }
#aSectionNews .anews-when { color:#4b5672 !important; }`;

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
  while (!(await ev(`typeof matches === 'object' && Array.isArray(matches) && typeof openAnalysisModal === 'function' && typeof aShowTab === 'function' && typeof buildNewsSection === 'function'`).catch(() => false))) {
    if (Date.now() - t0 > 90000) throw new Error('dashboard did not boot within 90 s'); await sleep(300);
  }
  await ev(`document.fonts.ready.then(() => true)`);
  await ev(`(() => { const fx = ${JSON.stringify(FIXTURE)}; const i = matches.findIndex(m => m.id === fx.id); if (i >= 0) matches.splice(i, 1); matches.push(fx); return true; })()`);
  if (THEME) await ev(`typeof maSetTheme === 'function' ? (maSetTheme(${JSON.stringify(THEME)}), true) : false`);
  if (PALETTE === 'source') await ev(`(() => { const s = document.createElement('style'); s.id = '__capPalette'; s.textContent = ${JSON.stringify(SOURCE_PALETTE)}; document.head.appendChild(s); return true; })()`);
  await ev(`openAnalysisModal('ten312-fixture'), true`);
  const served = await ev(`!!document.querySelector('#analysisModal .aclosecell') && typeof aNewsToggle === 'function'`);
  const settle = `new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => { for (const a of document.getAnimations()) { try { a.finish(); } catch (e) { try { a.pause(); a.currentTime = 0; } catch (_) {} } } r(true); }, 400))))`;
  const FEED = fixtureFeed();
  const manifest = [];
  const REFW = r => { const x = REF && REF.screens.find(q => q.name === r); return x ? x.size[0] : 0; };
  for (const [ref, st] of SCREENS) {
    // the tab's own state, then the shipped renderer
    await ev(`(() => { window.__realFetch = window.__realFetch || window.fetch;
      _newsData = ${st.feed === 'sample' ? JSON.stringify(FEED) : st.feed === 'empty' ? JSON.stringify({ generatedAt: FEED.generatedAt, articles: [] }) : 'null'};
      window.fetch = ${st.feed === 'fail' ? `(u, o) => String(u).includes('news-feed.json') ? Promise.resolve(new Response('', { status: 503 })) : window.__realFetch(u, o)` : 'window.__realFetch'};
      return true; })()`);
    await ev(`(async () => { _aBuilt.delete('news'); aShowTab('news'); await new Promise(r => setTimeout(r, 300));
      _aNewsFilter = ${JSON.stringify(st.filter || 'all')}; _aNewsOpen = ${JSON.stringify(st.open || '')}; renderNewsSection(); return _aNewsState; })()`);
    await sleep(600); await ev(settle);
    const frame = await ev(`(() => {
      const ov = document.getElementById('analysisModal'), m = ov.querySelector('.modal-analysis'), body = m.querySelector('.aanalysis-body-wrap');
      window.__saved = [document.documentElement, document.body, ov, m, body, m.querySelector('.asidenav'), m.querySelector('.abody')].map(e => [e, e.getAttribute('style')]);
      const st = (e, css) => e.setAttribute('style', (e.getAttribute('style') || '') + ';' + css);
      st(document.documentElement, 'background:transparent !important;'); st(document.body, 'background:transparent !important;');
      if (!document.getElementById('__capHide')) { const h = document.createElement('style'); h.id = '__capHide';
        h.textContent = 'body > *:not(#analysisModal){ visibility:hidden !important; }'; document.head.appendChild(h); }
      st(ov, 'background:transparent !important; backdrop-filter:none !important; position:absolute !important; inset:auto !important; left:0 !important; top:0 !important; width:${VIEW_W}px !important; height:auto !important; min-height:${VIEW_H}px !important; align-items:flex-start !important;');
      st(m, 'height:auto !important;'); st(body, 'flex:none !important; grid-template-rows:auto !important;');
      st(m.querySelector('.asidenav'), 'overflow:visible !important;'); st(m.querySelector('.abody'), 'overflow:visible !important;');
      const h = m.getBoundingClientRect().height, w = ${'${REFW}'} || (h > ${FIT_H} ? 1296 : 1306);
      st(ov, 'width:' + (w + 64) + 'px !important; padding:32px !important;'); st(m, 'min-height:${Math.round(VIEW_H * 0.88)}px !important;');
      const r = m.getBoundingClientRect(), hd = m.querySelector('.ahead2').getBoundingClientRect(), nv = m.querySelector('.asidenav'), nr = nv.getBoundingClientRect();
      const items = nv.querySelectorAll('.asidenav-item, .asidenav-download'), last = items[items.length - 1].getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, w: Math.round(r.width), h: Math.round(r.height), naturalH: Math.round(h),
        header: [0, 0, Math.round(r.width), Math.round(hd.bottom - r.top)],
        menu: [0, Math.round(hd.bottom - r.top), Math.round(nr.right - r.left), Math.round(last.bottom - r.top + 16)],
        content: [Math.round(nr.right - r.left), Math.round(hd.bottom - r.top), Math.round(r.width), Math.round(r.height)] };
    })()`.replace("${REFW}", String(REFW(ref))));
    await sleep(120); await ev(settle);
    const shot = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true, clip: { x: frame.x, y: frame.y, width: frame.w, height: frame.h, scale: 1 } });
    fs.writeFileSync(path.join(OUT, ref + '.png'), Buffer.from(shot.data, 'base64'));
    const dom = await ev(`(() => { const s = document.getElementById('aSectionNews'); return { state: _aNewsState, rows: s.querySelectorAll('.anews-row').length,
      groups: [...s.querySelectorAll('.anews-gname')].map(e => e.textContent), text: s.innerText.slice(0, 160) }; })()`);
    const dump = DUMP ? await ev(DUMP) : undefined;
    manifest.push({ tab: 'news', ref, state: st, dom, dump, size: [frame.w, frame.h], header: frame.header, menu: frame.menu, content: frame.content });
    console.log(`${ref.padEnd(30)} ${frame.w}x${frame.h}  ${dom.state} rows=${dom.rows} groups=${dom.groups.join('|')}`);
    await ev(`(() => { for (const [e, s] of window.__saved) { if (s == null) e.removeAttribute('style'); else e.setAttribute('style', s); } return true; })()`);
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ servedThisCheckout: served, root: ROOT, fixture: FIXTURE, frozenNow: new Date(FROZEN_NOW).toISOString(), timezone: TZ, theme: THEME, palette: PALETTE, screens: manifest }, null, 1));
  if (!served) throw new Error('the page served is not this checkout (no .aclosecell / aNewsToggle)');
}
main().then(() => { cleanup(); process.exit(0); }, (e) => { console.error('FAIL:', e.stack || e.message); cleanup(); process.exit(1); });
