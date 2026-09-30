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
//        [--palette source]
//
//   --palette source  (TEN-335) re-point the modal's tokens to the design file's SOURCE hex for the role each token
//                     carries on the Odds tab (FIXTURE_SOURCE_PALETTE below), so a diff against the design capture
//                     measures structure, not the D1 Night/Day palette. Fixture-only CSS injected over CDP.
//
// Odds (TEN-335): the Odds screens (11-odds, 11b-odds-novig-market-selected, P2-odds-movement-popup) feed the SHIPPED
// renderer the design's own seed — DF `oddsFor()` run in node on the committed design file (React stubbed), 7 books ×
// 9 snapshots — as the fixture's `oddsMovement.chart`, and put AODDS_BOOKS in the design's 7-book order for the
// duration of those screens only (the shipped 12-book config is ruled difference O2, verified on real data instead).
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
import { WX_NOW, WX_STATES, WX_COURT_SPEED } from './ten312-weather-states.mjs';

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
  ['weather', '10-weather-state-c', { wx: 'c' }], ['weather', '10b-weather-state-a-calm', { wx: 'a' }], ['weather', '10c-weather-state-d-indoor', { wx: 'd' }],
  ['weather', '10d-weather-state-e-unavailable', { wx: 'e' }], ['weather', '10e-weather-state-b-one-problem-day', { wx: 'b' }], ['odds', '11-odds'], ['marketedge', '12-market-edge-match-winner']];

// The design's demo match (DF demoMatch / README §9). Start = Jul 20, 2026 18:00 venue time (Washington, UTC−4).
// It is COMPLETED (Sinner won 6-4 4-6 7-6), which is why the design's screens draw no header matchup strip.
const FIXTURE = { id: 'ten312-fixture', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: null, p2Key: null,
  tour: 'ATP Washington', tournament: 'ATP Washington', tournamentRound: 'ATP Washington - Quarter-finals', surface: 'Hard',
  startTs: '2026-07-20T22:00:00Z', bestOdds: { p1: { price: 1.54 }, p2: { price: 2.62 } },
  finalScore: { display: '6-4, 4-6, 7-6', sets: [{ p1: 6, p2: 4 }, { p1: 4, p2: 6 }, { p1: 7, p2: 6 }], p1Sets: 2, p2Sets: 1, winner: 'p1' } };

const PALETTE = opt('--palette') || null;
// The design file's source value for the role each token plays on the Odds tab (AODDS_C comments, DF L1881–1931).
// Where several source values share one token (e.g. t2 = #AAB3C8 caps and #8B96B5 muted), the more common one wins
// and the residual is reported, not hidden.
const FIXTURE_SOURCE_PALETTE = { '--ma-page': '#0A0D14', '--ma-card': '#0E1019', '--ma-inner': '#0A0D14', '--ma-raised': '#131623',
  '--ma-hover': '#11141F', '--ma-sel': 'rgba(91,155,255,0.16)', '--ma-hair': 'rgba(255,255,255,0.06)', '--ma-hair-soft': 'rgba(255,255,255,0.05)',
  '--ma-hair-strong': 'rgba(255,255,255,0.1)', '--ma-hair-hover': 'rgba(255,255,255,0.2)', '--ma-outline': 'rgba(91,155,255,0.45)',
  '--ma-t1': '#E7E9EE', '--ma-t2': '#8B96B5', '--ma-t3': '#5B6880', '--ma-fill': '#5B9BFF', '--ma-link': '#5B9BFF',
  '--ma-on-fill': '#06070A', '--ma-pos': '#3DD68C', '--ma-neg': '#E0616F', '--ma-pb-fill': '#E7E9EE',
  '--ma-scrim': 'rgba(4,5,9,0.62)', '--ma-chart-grid': 'rgba(255,255,255,0.07)' };

// The design's Odds demo: DF `oddsFor()` evaluated on the committed file, exactly as the design renders it
// (AN = DF mkAnalysis(demoMatch(), 1.54, 2.62): seed 'm0' + 'ATP Washington' + 'J. Sinner').
function designOddsSeed() {
  process.env.TZ = TZ;   // DF builds its snapshot times with local-time `new Date(2026, 8, 26, 17, 52)`: the capture's zone
  const dc = fs.readFileSync(path.join(ROOT, 'design', 'handoff-ten312-match-analysis', 'Match Analysis Progression v1.dc.html'), 'utf8');
  const a = dc.indexOf('  oddsFor(AN, S) {'), b = dc.indexOf('\n  renderVals() {', a);
  if (a < 0 || b < 0) throw new Error('DF oddsFor() not found');
  let body = dc.slice(a + '  oddsFor(AN, S) '.length, b).trim();
  if (!body.includes('      books, groups, chart,')) throw new Error('DF oddsFor() return anchor moved');
  body = body.replace('      books, groups, chart,', '      __TS: TS, books, groups, chart,').replace(/^\{/, '').replace(/\}\s*$/, '');
  const oddsFor = new Function('React', 'AN', 'S', body);
  const AN = { seed: 'm0ATP WashingtonJ. Sinner', aName: 'J. Sinner', bName: 'C. Alcaraz', aOdds: '1.54', bOdds: '2.62' };
  const d = oddsFor.call({ setState() {} }, { createElement: () => null }, AN, {});
  const TS = d.__TS.map((x) => x.getTime()), iso = (ms) => new Date(ms).toISOString();
  const chart = { books: {}, meta: {} };
  d.books.forEach((bk) => {
    chart.books[bk.name] = { p1: bk.aS.map((v, j) => [iso(TS[j]), v]), p2: bk.bS.map((v, j) => [iso(TS[j]), v]) };
    chart.meta[bk.name] = { source: 'design fixture', group: bk.cls, clock: 'book tick', checkedAt: iso(TS[TS.length - 1]) };
  });
  return { chart, books: d.books.map((bk) => ({ name: bk.name, group: bk.cls, sources: [bk.name] })),
    startTs: iso(TS[TS.length - 1] + 60e3) };   // the demo's "Now" is its last snapshot: the start just after it
}
// Odds screens beyond the default tab: [ref, in-page js run after the fixture is on, pop-up framing?]
const ODDS_STATES = [['11b-odds-novig-market-selected', `_aOdds.novig = true; aOddsSetMarket('Game handicap'); renderOddsSection();`, false],
  ['P2-odds-movement-popup', `aOddsOpenMv('Pinnacle');`, true]];

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
    const now = () => window.__capNow || T;   // a screen may move the frozen clock (Weather states: window.__capNow)
    function D(...a) { if (!new.target) return new RD(now()).toString(); return a.length ? new RD(...a) : new RD(now()); }
    D.prototype = RD.prototype; D.now = now; D.parse = RD.parse; D.UTC = RD.UTC;
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
  await ev(`(() => { const fx = ${JSON.stringify(FIXTURE)}; const i = matches.findIndex(m => m.id === fx.id); if (i >= 0) matches.splice(i, 1); matches.push(fx); window.__fx = fx; return true; })()`);
  if (THEME) await ev(`typeof maSetTheme === 'function' ? (maSetTheme(${JSON.stringify(THEME)}), true) : false`);
  await ev(`openAnalysisModal('ten312-fixture'), true`);
  const served = await ev(`!!document.querySelector('#analysisModal .aclosecell')`);
  const settle = `new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => { for (const a of document.getAnimations()) { try { a.finish(); } catch (e) { try { a.pause(); a.currentTime = 0; } catch (_) {} } } r(true); }, 400))))`;
  const manifest = [];
  const REFW = r => { const x = REF && REF.screens.find(q => q.name === r); return x ? x.size[0] : 0; };
  if (PALETTE === 'source') await ev(`(() => { const s = document.createElement('style'); s.id = '__capPalette';
    s.textContent = '#analysisModal.ma-theme, #analysisModal.ma-theme[data-ma-theme]{' + ${JSON.stringify(Object.entries(FIXTURE_SOURCE_PALETTE).map(([k, v]) => k + ':' + v).join(';'))} + '}';
    document.head.appendChild(s); return true; })()`);
  else if (PALETTE) throw new Error('--palette: only "source" is known');
  for (const [tab, ref, st] of TABS) {
    if (ONLY && !ONLY.has(tab)) continue;
    if (tab === 'odds') {
      const seed = designOddsSeed();
      await ev(`(() => { const m = window.__fx; window.__oddsSaved = { m, startTs: m.startTs, books: AODDS_BOOKS.slice(), om: m.oddsMovement, loaded: m._oddsLoaded };   // the pinned fixture: a board refresh can replace \`matches\`
        m.oddsMovement = { market: 'Match Winner', books: {}, chart: ${JSON.stringify(seed.chart)} }; m._oddsLoaded = true; m.startTs = ${JSON.stringify(seed.startTs)};
        AODDS_BOOKS.splice(0, AODDS_BOOKS.length, ...${JSON.stringify(seed.books)}); renderOddsSection(); return true; })()`);
    }
    // Weather: the design's STATE switcher states, fed through the tab's own lazy-load caches (TEN-337). The clock
    // moves to Mon Jul 20 10:00 venue time so the demo match's forecast is the current one (the design draws a live
    // forecast on its completed demo match); the header keeps the completed layout.
    await ev(`(() => { window.__capNow = ${st && st.wx ? WX_NOW : 0};
      if (!window.__wxReload) window.__wxReload = wxOnMatchesReload;
      wxOnMatchesReload = ${!!(st && st.wx)} ? () => {} : window.__wxReload;   // a board reload must not swap the fed index mid-capture
      // the match the modal shows (_aWxMatch) may be an older copy than the pinned fixture after a reload: set both
      for (const fx of [window.__fx, typeof _aWxMatch !== 'undefined' ? _aWxMatch : null]) {
        if (fx) { if (${!!(st && st.wx)}) fx.courtSpeed = ${JSON.stringify(WX_COURT_SPEED)}; else delete fx.courtSpeed; } }
      ${st && st.wx ? `_wxIndex = { v: 1, tours: { [window.__fx.tour]: ${JSON.stringify(WX_STATES[st.wx].entry)} } }; _wxIndexStale = false; _aWx = { m: null };
      ${WX_STATES[st.wx].file ? `_wxFiles[${JSON.stringify(WX_STATES[st.wx].entry.file)}] = ${JSON.stringify(WX_STATES[st.wx].file)};` : ''}` : ''}
      return true; })()`);
    await ev(`aShowTab(${JSON.stringify(tab)}), true`);
    await sleep(1500); await ev(settle);
    manifest.push(await shootModal(tab, ref));
    if (tab === 'odds') {
      for (const [sref, js, pop] of ODDS_STATES) {
        await ev(`(() => { _aOdds.novig = false; _aOdds.market = 'Match Winner'; _aOdds.mv = null; ${js} return true; })()`);
        await sleep(400); await ev(settle);
        manifest.push(pop ? await shootPop(tab, sref, '.aox-mv-overlay') : await shootModal(tab, sref));
      }
      await ev(`(() => { _aOdds.novig = false; _aOdds.mv = null; const m = __oddsSaved.m; m.startTs = __oddsSaved.startTs; m.oddsMovement = __oddsSaved.om; m._oddsLoaded = __oddsSaved.loaded;
        AODDS_BOOKS.splice(0, AODDS_BOOKS.length, ...__oddsSaved.books); renderOddsSection(); return true; })()`);
    }
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ servedThisCheckout: served, root: ROOT, fixture: FIXTURE, frozenNow: new Date(FROZEN_NOW).toISOString(), timezone: TZ, theme: THEME, palette: PALETTE, screens: manifest }, null, 1));
  if (!served) throw new Error('the page served is not this checkout (no .aclosecell)');

  // A pop-up screen, framed as the design capture's framePop(): the pop-up's scrim, POP_W wide, cropped to its box ± 24 px,
  // box grown to full height; everything else hidden.
  async function shootPop(tab, ref, scrimSel) {
    const clip = await ev(`(() => {
      const ps = document.querySelector('#analysisModal ' + ${JSON.stringify(scrimSel)});
      if (!ps) throw new Error('no pop-up open');
      const box = ps.firstElementChild;
      window.__saved = [document.documentElement, document.body, ps, box].map(e => [e, e.getAttribute('style')]);
      const st = (e, css) => e.setAttribute('style', (e.getAttribute('style') || '') + ';' + css);
      st(document.documentElement, 'background:transparent !important;'); st(document.body, 'background:transparent !important;');
      if (!document.getElementById('__capHide')) { const h = document.createElement('style'); h.id = '__capHide';
        h.textContent = 'body > *:not(#analysisModal){ visibility:hidden !important; }'; document.head.appendChild(h); }
      const hp = document.createElement('style'); hp.id = '__capPopHide';
      hp.textContent = '#analysisModal, #analysisModal *{ visibility:hidden !important; } #analysisModal [data-cap-pop], #analysisModal [data-cap-pop] *{ visibility:visible !important; } #analysisModal{ background:transparent !important; backdrop-filter:none !important; }';
      document.head.appendChild(hp); ps.setAttribute('data-cap-pop', '1');
      st(ps, 'position:fixed !important; inset:auto !important; left:0 !important; top:0 !important; width:${1001}px !important; height:auto !important; overflow:visible !important; padding-top:24px !important; padding-bottom:24px !important;');
      st(box, 'max-height:none !important; overflow:visible !important;');
      const r = ps.getBoundingClientRect(), br = box.getBoundingClientRect();
      return { x: r.left + scrollX, y: br.top - 24 + scrollY, w: Math.round(r.width), h: Math.round(br.height + 48) };
    })()`);
    await sleep(120); await ev(settle);
    const shot = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true, clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 1 } });
    fs.writeFileSync(path.join(OUT, ref + '.png'), Buffer.from(shot.data, 'base64'));
    console.log(`${tab.padEnd(12)} → ${ref.padEnd(30)} ${clip.w}x${clip.h} (pop-up)`);
    await ev(`(() => { for (const [e, s] of window.__saved) { if (s == null) e.removeAttribute('style'); else e.setAttribute('style', s); }
      document.getElementById('__capPopHide').remove(); document.querySelectorAll('[data-cap-pop]').forEach(e => e.removeAttribute('data-cap-pop')); return true; })()`);
    return { tab, ref, size: [clip.w, clip.h], pop: true };
  }

  async function shootModal(tab, ref) {
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
      const nr = nv.getBoundingClientRect();
      const last = items[items.length - 1].getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, w: Math.round(r.width), h: Math.round(r.height), naturalH: Math.round(h),
        header: [0, 0, Math.round(r.width), Math.round(hd.bottom - r.top)],
        content: [Math.round(nr.right - r.left), Math.round(hd.bottom - r.top), Math.round(r.width), Math.round(r.height)], menu: [0, Math.round(hd.bottom - r.top), Math.round(nv.getBoundingClientRect().right - r.left), Math.round(last.bottom - r.top + 16)] };
    })()`);
    await sleep(120); await ev(settle);
    const shot = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true, clip: { x: frame.x, y: frame.y, width: frame.w, height: frame.h, scale: 1 } });
    fs.writeFileSync(path.join(OUT, ref + '.png'), Buffer.from(shot.data, 'base64'));
    console.log(`${tab.padEnd(12)} → ${ref.padEnd(30)} ${frame.w}x${frame.h}`);
    await ev(`(() => { for (const [e, s] of window.__saved) { if (s == null) e.removeAttribute('style'); else e.setAttribute('style', s); } return true; })()`);
    return { tab, ref, size: [frame.w, frame.h], header: frame.header, menu: frame.menu, content: frame.content };
  }
}
main().then(() => { cleanup(); process.exit(0); }, (e) => { console.error('FAIL:', e.stack || e.message); cleanup(); process.exit(1); });
