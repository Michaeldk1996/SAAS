#!/usr/bin/env node
// TEN-341 — TEST-ONLY Key factors capture for the Match analysis pixel diff (both halves in one tool). Never loaded by the
// live page and never run in CI: a manual tool, like tools/ten340-playing-style-capture.mjs (whose clock, zone, viewport,
// raster flags, framing and helpers it repeats).
//
//   node tools/ten341-key-factors-capture.mjs <outDir> [--theme night|day|source] [--design-only]
//
// 1. Renders the LOCKED design file (needs network: React + Babel from unpkg) and captures the Key factors tab in the one
//    variant the file renders (`analysis.kf.v.o`, DF L344–458; KV is fixed to 'o', DF L3349). The tab has no pop-up: every
//    card deep-links to another tab (DF keyFactorsFor go* L3280–3286), so there is one screen.
// 2. Serves THIS checkout's dashboard, pushes the design's demo match (J. Sinner v C. Alcaraz, ATP Washington, Hard) and
//    hands the Key factors builder the design's own demo values — read on the committed file's rendered tab (every card's
//    figures) — in our shapes (archetypes + matrix cell, form rows, H2H meetings, tournament history + court speed, one
//    book's odds series, the Weather tab's model, the DNA file, the value snapshot), then captures the same screen.
//    FIXTURE MODE LIVES ONLY HERE: nothing reaches bsp-consult-dashboard.html.
// 3. Dumps every visible text leaf of the tab on both sides → leaves.json (structure: python3
//    tools/ten330-form-structure.py <outDir>/leaves.json).
//
// --theme source: every modal shade token set to the source value its name carries (--ma-s-<hex>[-<alpha×1000>]) and the
// role tokens to the design's source values, so the pixel diff isolates structure from the ruled palette.
// Writes <outDir>/design/*.png, <outDir>/build/*.png, <outDir>/{design,build}/manifest.json, <outDir>/leaves.json.
// Regenerates nothing else.
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
const HANDOFF = path.join(ROOT, 'design', 'handoff-ten312-match-analysis');
const DESIGN = 'Match Analysis Progression v1.dc.html';
const ONLY = opt('--only') ? new Set(opt('--only').split(',')) : null;
const THEME = opt('--theme') || 'night';
const DESIGN_ONLY = args.includes('--design-only');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!OUT) { console.error('usage: node tools/ten341-key-factors-capture.mjs <outDir> [--theme night|day|source] [--design-only]'); process.exit(2); }
const FROZEN_NOW = Date.parse('2026-09-28T12:19:30+08:00');
const TZ = 'Asia/Makassar';
const VIEW_W = 1370, VIEW_H = 745, FIT_H = 760, POP_W = 1001;

// The one designed Key factors state (README §5.1 screen 01; DF analysis.kf.v.o). No pop-up exists on this tab.
const STATES = [{ name: '01-key-factors', d: {}, b: {} }];
// Source value of a role token (README §3 read backwards) for --theme source; the shade tokens carry theirs in their names.
const SOURCE_TOKENS = { '--ma-page': '#0a0d14', '--ma-card': '#0a0d14', '--ma-inner': '#06070a', '--ma-raised': '#11151f', '--ma-hover': 'rgba(255,255,255,0.03)',
  '--ma-sel': 'rgba(91,155,255,0.16)', '--ma-hair': 'rgba(255,255,255,0.09)', '--ma-hair-soft': 'rgba(255,255,255,0.05)', '--ma-hair-strong': 'rgba(255,255,255,0.14)',
  '--ma-outline': 'rgba(91,155,255,0.22)', '--ma-t1': '#e7e9ee', '--ma-t2': '#8b96b5', '--ma-t3': '#5b6880', '--ma-fill': '#5b9bff', '--ma-link': '#5b9bff',
  '--ma-pos': '#3dd68c', '--ma-neg': '#e0616f', '--ma-track': 'rgba(255,255,255,0.08)', '--ma-pb-fill': 'rgba(231,233,238,0.7)' };

// The design's demo values, as the file renders them on the Key factors tab (DF keyFactorsFor L3184–3308 + the helpers it
// calls; read on the committed file's rendered tab), in OUR shapes. Where the file contradicts itself (its archetypes say
// "Both are All-Courters" while its edge reads 43% / 57%) the fixture takes the figures (a Counterpuncher v Attacking
// Baseliner cell at 43%, n 3,100) — here a mirror pairing, so the sentence has the file's length (its 43/57 needs a cell,
// whose sentence runs a line longer and moves every row below). The conditions prose is the file's own paragraph (our
// generator writes a different one), fed through tourxConditionsProse for the fixture only.
// the file's demo match is COMPLETED (6-4 4-6 7-6: no header strip); its odds card says "Current odd", as ours does (founder Q25)
const FX_DATE = '2026-09-26', FX_START = '2026-09-26T18:00:00Z';
function buildInputs() {
  const row = (i, won, surf) => ({ date: '2026-09-' + String(20 - i).padStart(2, '0'), opponent: 'Opponent ' + (i + 1), tournament: 'Event ' + (i + 1), round: 'R32', surface: surf || 'Hard',
    result: won ? '2 - 0' : '0 - 2', won, sets: null, retired: false, walkover: false, eventKey: 9000 + i });
  const form = (pills, wins10) => { const rows = pills.map((w, i) => row(i, w)); let w = pills.filter(Boolean).length;
    for (let i = pills.length; i < 10; i++) { const x = w < wins10; if (x) w++; rows.push(row(i, x)); } return rows; };
  const meet = (d, t) => ({ date: d, tournament: t, round: 'R16', surface: 'Hard', p1Won: true, result: '2 - 0', level: 'ATP', eventKey: null });
  const h2h = ['2021-05-10', '2022-02-14', '2022-08-01', '2023-03-20', '2024-04-15', '2025-01-20'].map((d, i) => meet(d, 'Event ' + (i + 1))).concat([meet('2025-10-15', 'Munich')]);
  // twelve hourly ticks before the start (a completed match: every series is cut at its start)
  const series = (a, b) => { const t0 = Date.parse('2026-09-26T04:00:00Z'); const N = 12; return [...Array(N)].map((_, i) => [new Date(t0 + i * 3600e3).toISOString(), +(a + (b - a) * i / (N - 1)).toFixed(2)]); };
  const dnaSide = (k) => { const P = [[9, 53], [47, 22], [13, 47], [39, 79]], AX = ['serve', 'return', 'underPressure', 'dominanceRatio'];
    const last52 = { sample: { matches: 30 } }; AX.forEach((ax, i) => { last52[ax] = { rating: P[i][k], pct: P[i][k] }; });
    return { surfaces: { Hard: { last52, sinceBase: { sample: { matches: 60 } }, elo: { rating: [67, 88][k], pct: [67, 88][k] } } } }; };
  return {
    styles: { 'J. Sinner': { archetype_label: 'Counterpuncher' }, 'C. Alcaraz': { archetype_label: 'Counterpuncher' } },
    matrix: { minSampleN: 20, matrix: { 'Counterpuncher': { 'Attacking Baseliner': { pct: 43, n: 3100 } }, 'Attacking Baseliner': { 'Counterpuncher': { pct: 57, n: 3100 } } } },
    formA: form([true, false, false, true, false], 4), formB: form([false, true, true, true, false], 5),
    profiles: { '900001': { careerByYear: [{ year: 2026, hard: { won: 3, lost: 0 } }] }, '900002': { careerByYear: [{ year: 2026, hard: { won: 0, lost: 3 } }] } },
    h2h: { p1Wins: 7, p2Wins: 0, matches: h2h },
    hist: { years: [{ year: 2025, won: 5, lost: 1, matches: [] }] },
    odds: { market: 'Match Winner', capturedAt: '2026-09-26T16:15:00Z', books: { bet365: { p1: series(1.29, 1.54), p2: series(2.65, 2.62) }, Pinnacle: { p1: series(1.63, 1.54), p2: series(2.49, 2.62) } } },
    prose: 'Medium-fast hard court with a true, medium-high bounce. At 1.24 court speed first strike matters: hold rates sit near 82% and free points off the serve decide tight sets. Rallies stay short, so the better server-returner combination usually wins the margins.',
    dna: { '900001': dnaSide(0), '900002': dnaSide(1) }, elo: { 'J. Sinner': 67, 'C. Alcaraz': 88 },
    wx: { indoor: false, unavail: false, verdict: 'Moderate humidity — mild stamina factor late on.', at: { temp: 18.4, wind: 6.2, hum: 69, rain: 0 } },
    value: { fairP1: 1 / 1.59, fairP2: 1 / 2.70, edgeVsPinnacleP1: -0.020, edgeVsPinnacleP2: -0.011 },
  };
}
async function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); }); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
function serve(root, port, index) {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = path.join(root, rel === '/' ? '/' + index : rel);
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
const live = [];
function cleanup() { for (const x of live) { try { x.c?.close(); } catch {} try { x.chrome?.exitCode == null && x.chrome.kill('SIGKILL'); } catch {} try { x.srv?.close(); x.srv?.closeAllConnections?.(); } catch {} try { fs.rmSync(x.profile, { recursive: true, force: true }); } catch {} } }
process.on('exit', cleanup);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { cleanup(); process.exit(130); });

async function browser(root, index, extraInit) {
  const x = { profile: path.join(OUT, '.chrome-' + index.replace(/\W/g, '')) }; live.push(x);
  fs.rmSync(x.profile, { recursive: true, force: true });
  const port = await freePort(); x.srv = await serve(root, port, index);
  const dport = await freePort();
  x.chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${x.profile}`, '--remote-allow-origins=*', '--no-first-run',
    '--no-default-browser-check', '--force-device-scale-factor=1', '--hide-scrollbars', '--font-render-hinting=none', '--disable-gpu', '--disable-partial-raster',
    '--disable-threaded-animation', '--disable-checker-imaging', `--window-size=${VIEW_W},${VIEW_H}`, 'about:blank'], { stdio: 'ignore' });
  x.c = client(await cdpTarget(dport)); await x.c.ready;
  const c = x.c;
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false });
  await c.send('Emulation.setTimezoneOverride', { timezoneId: TZ });
  await c.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const T = ${FROZEN_NOW}, RD = Date;
    function D(...a) { if (!new.target) return new RD(T).toString(); return a.length ? new RD(...a) : new RD(T); }
    D.prototype = RD.prototype; D.now = () => T; D.parse = RD.parse; D.UTC = RD.UTC;
    Object.defineProperty(D.prototype, 'constructor', { value: D }); window.Date = D; ${extraInit || ''}
  })();` });
  x.ev = async (expr) => { const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('eval threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result?.value; };
  await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/${encodeURIComponent(index)}` });
  return x;
}
async function shot(x, clip, file) {
  const s = await x.c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true, clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 1 } });
  fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
}
const SETTLE = `new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => { for (const a of document.getAnimations()) { const it = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming().iterations : 1; try { if (it === Infinity) { a.pause(); a.currentTime = 0; } else a.finish(); } catch (e) {} } r(true); }, 60))))`;
// Visible text leaves under a root: [{t, x, y, w, h, fs, fw, c}] relative to the root's box.
const LEAVES = (rootExpr) => `(() => { const root = ${rootExpr}; const R = root.getBoundingClientRect(); const out = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) { const t = n.textContent.replace(/\\s+/g, ' ').trim(); if (!t) continue; const el = n.parentElement; const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue; const rg = document.createRange(); rg.selectNodeContents(n); const b = rg.getBoundingClientRect(); if (!b.width) continue;
    let hid = false; for (let e = el; e && e !== root; e = e.parentElement) { const s = getComputedStyle(e); if (s.visibility === 'hidden' || +s.opacity === 0 || s.display === 'none') { hid = true; break; } } if (hid) continue;
    out.push({ t, x: +(b.left - R.left).toFixed(1), y: +(b.top - R.top).toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), fs: cs.fontSize, fw: cs.fontWeight, ff: cs.fontFamily.split(',')[0].replace(/['"]/g, ''), c: cs.color }); }
  return out; })()`;

// ---------------------------------------------------------------------------------------------------------------
// DESIGN side (helpers = tools/ten339-progression-capture.mjs D_HELPERS)
const D_HELPERS = `window.__cap = (() => {
  const host = () => { const el = document.querySelector('.nav'); const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$'));
    for (let f = el[k]; f; f = f.return) if (f.stateNode && f.stateNode.logic && f.stateNode.logic.renderVals && 'maTab' in (f.stateNode.logic.state || {})) return f.stateNode;
    throw new Error('dc host not found'); };
  const modal = () => document.querySelector('.nav').closest('div[style*="88vh"], div[data-cap-modal]');
  const api = { host, _saved: [],
    reset() { const h = host(); h.logic.state = { maTab: null }; return new Promise((r) => h.forceUpdate(() => r(true))); },
    set(p) { const h = host(); return new Promise((r) => h.logic.setState(p, () => r(true))); },
    _style(el, css) { api._saved.push([el, el.getAttribute('style')]); el.setAttribute('style', (el.getAttribute('style') || '') + ';' + css); },
    unframe() { for (const [el, s] of api._saved.reverse()) { if (s == null) el.removeAttribute('style'); else el.setAttribute('style', s); } api._saved = []; return true; },
    _grow() { const m = modal(); m.setAttribute('data-cap-modal', '1'); const scrim = m.parentElement, body = m.children[1], menu = body.children[0], content = body.children[1];
      api._style(scrim, 'background:transparent !important; backdrop-filter:none !important; position:absolute !important; inset:auto !important; left:0 !important; top:0 !important; width:${VIEW_W}px !important; height:auto !important; min-height:${VIEW_H}px !important; align-items:flex-start !important;');
      api._style(m, 'height:auto !important;'); api._style(body, 'flex:none !important; grid-template-rows:auto !important;'); api._style(menu, 'overflow:visible !important;'); api._style(content, 'overflow:visible !important;');
      return { m, scrim, content }; },
    frameModal(forceW) { const { m, scrim } = api._grow(); let h = m.getBoundingClientRect().height, w = forceW || (h > ${FIT_H} ? 1296 : 1306);
      api._style(scrim, 'width:' + (w + 64) + 'px !important; padding:32px !important;'); api._style(m, 'min-height:${Math.round(VIEW_H * 0.88)}px !important;'); return { w }; },
    clipModal() { const r = document.querySelector('[data-cap-modal]').getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: Math.round(r.width), h: Math.round(r.height) }; },
    tabRoot() { const m = document.querySelector('[data-cap-modal]') || modal(); return m.children[1].children[1]; },
    framePop() { const m = modal(); const cands = [...m.querySelectorAll('div')].filter((d) => getComputedStyle(d).position === 'fixed' && d.getClientRects().length);
      cands.sort((a, b) => (+getComputedStyle(b).zIndex || 0) - (+getComputedStyle(a).zIndex || 0)); const ps = cands[0]; ps.setAttribute('data-cap-pop', '1');
      const flowKid = (el) => [...el.children].find((x) => x.getClientRects().length && getComputedStyle(x).position !== 'absolute') || [...el.children].find((x) => x.getClientRects().length);
      let box = flowKid(ps); while (box && /rgba\\(0, 0, 0, 0\\)|transparent/.test(getComputedStyle(box).backgroundColor) && box.children.length) box = flowKid(box) || box.children[0];
      box.setAttribute('data-cap-box', '1'); api._grow();
      api._style(document.querySelector('section'), 'visibility:hidden !important;');
      api._style(ps, 'visibility:visible !important; position:absolute !important; inset:auto !important; left:0 !important; top:0 !important; width:${POP_W}px !important; height:auto !important; overflow:visible !important; padding-top:24px !important; padding-bottom:24px !important;');
      api._style(box, 'max-height:none !important; overflow:visible !important;');
      for (const d of box.querySelectorAll('div')) { const cs = getComputedStyle(d); if (/(auto|scroll)/.test(cs.overflowY) && d.scrollHeight > d.clientHeight + 1) api._style(d, 'max-height:none !important; overflow:visible !important;'); }
      return true; },
    clipPop() { const ps = document.querySelector('[data-cap-pop]'), b = document.querySelector('[data-cap-box]'); const r = ps.getBoundingClientRect(), br = b.getBoundingClientRect();
      return { x: r.left + scrollX, y: br.top - 24 + scrollY, w: Math.round(r.width), h: Math.round(br.height + 48) }; },
  }; return api; })(); true`;

async function designSide(dir) {
  const x = await browser(HANDOFF, DESIGN);
  const t0 = Date.now();
  for (;;) { if (await x.ev(`!!document.querySelector('.nav') && document.readyState === 'complete'`).catch(() => false)) break; if (Date.now() - t0 > 60000) throw new Error('design did not mount'); await sleep(250); }
  await x.ev(D_HELPERS); await x.ev(`document.fonts.ready.then(() => true)`);
  const man = [], leaves = {};
  for (const st of STATES) {
    if (ONLY && !ONLY.has(st.name)) continue;
    await x.ev(`__cap.reset()`); await x.ev(`__cap.set(${JSON.stringify(Object.assign({ maTab: 'Key factors' }, st.d))})`); await x.ev(SETTLE);
    if (st.pop) { await x.ev(`__cap.framePop()`); await sleep(100); await x.ev(SETTLE); const clip = await x.ev(`__cap.clipPop()`); await shot(x, clip, path.join(dir, st.name + '.png')); man.push({ name: st.name, size: [clip.w, clip.h] }); await x.ev(`__cap.unframe()`); continue; }
    // the tab's SAMPLE DATA chip sits in the file's display:none header (DF L334–343): nothing to hide
    const fr = await x.ev(`__cap.frameModal(1296)`); await sleep(100); await x.ev(SETTLE);
    const clip = await x.ev(`__cap.clipModal()`);
    await shot(x, clip, path.join(dir, st.name + '.png'));
    leaves[st.name] = await x.ev(LEAVES(`__cap.tabRoot()`));
    const cr = await x.ev(`(() => { const r = __cap.tabRoot().getBoundingClientRect(), m = document.querySelector('[data-cap-modal]').getBoundingClientRect(); return [Math.round(r.left - m.left), Math.round(r.top - m.top), Math.round(r.right - m.left), Math.round(r.bottom - m.top)]; })()`);
    man.push({ name: st.name, size: [clip.w, clip.h], frame: fr, content: cr });
    await x.ev(`__cap.unframe()`);
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ design: path.join(HANDOFF, DESIGN), screens: man }, null, 1));
  return { leaves };
}

const FIXTURE = { id: 'ten312-fixture', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: '900001', p2Key: '900002', date: FX_DATE,
  tour: 'ATP Washington', tournament: 'ATP Washington', tournamentRound: 'ATP Washington - Quarter-finals', surface: 'Hard',
  startTs: FX_START, finalScore: '6-4 4-6 7-6', venue: { category: 'ATP 500' }, courtSpeed: { abstractSpeed: 1.24, category: 'Medium-fast', altitude: 20, serviceHold: 82 },
  pinnacleOpen: { p1: 1.63, p2: 2.49 }, bestOdds: { p1: { price: 1.59, bookmaker: 'Bet365' }, p2: { price: 2.67, bookmaker: 'Bet365' } } };
const B_FRAME = `(() => {
  const ov = document.getElementById('analysisModal'), m = ov.querySelector('.modal-analysis'), body = m.querySelector('.aanalysis-body-wrap');
  window.__saved = [document.documentElement, document.body, ov, m, body, m.querySelector('.asidenav'), m.querySelector('.abody')].map(e => [e, e.getAttribute('style')]);
  const st = (e, css) => e.setAttribute('style', (e.getAttribute('style') || '') + ';' + css);
  st(document.documentElement, 'background:transparent !important;'); st(document.body, 'background:transparent !important;');
  if (!document.getElementById('__capHide')) { const h = document.createElement('style'); h.id = '__capHide'; h.textContent = 'body > *:not(#analysisModal){ visibility:hidden !important; }'; document.head.appendChild(h); }
  st(ov, 'background:transparent !important; backdrop-filter:none !important; position:absolute !important; inset:auto !important; left:0 !important; top:0 !important; width:${VIEW_W}px !important; height:auto !important; min-height:${VIEW_H}px !important; align-items:flex-start !important;');
  st(m, 'height:auto !important;'); st(body, 'flex:none !important; grid-template-rows:auto !important;');
  st(m.querySelector('.asidenav'), 'overflow:visible !important;'); st(m.querySelector('.abody'), 'overflow:visible !important;');
  st(ov, 'width:${1296 + 64}px !important; padding:32px !important;'); st(m, 'min-height:${Math.round(VIEW_H * 0.88)}px !important;');
  const r = m.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: Math.round(r.width), h: Math.round(r.height) }; })()`;
const B_UNFRAME = `(() => { for (const [e, s] of window.__saved) { if (s == null) e.removeAttribute('style'); else e.setAttribute('style', s); } return true; })()`;

async function buildSide(dir) {
  const x = await browser(ROOT, 'bsp-consult-dashboard.html', `var _b; Object.defineProperty(window, 'BSP', { configurable: true, get() { return _b; }, set(v) { if (v) { const u = Promise.resolve({ emailVerified: true }); v.requireVerified = () => u; v.requireAuth = () => u; } _b = v; } });`);
  const t0 = Date.now();
  while (!(await x.ev(`typeof matches === 'object' && Array.isArray(matches) && typeof openAnalysisModal === 'function' && typeof aShowTab === 'function'`).catch(() => false))) { if (Date.now() - t0 > 90000) throw new Error('dashboard did not boot'); await sleep(300); }
  await x.ev(`document.fonts.ready.then(() => true)`);
  const served = await x.ev(`typeof kfDimCard === 'function' && typeof akCard === 'undefined' && typeof loadStyleRadar === 'undefined'`);
  if (!served) throw new Error('the page served is not this checkout (no kfDimCard)');
  const I = buildInputs();
  // the fixture match + the design's values for the fixture's names / keys only (every other lookup stays real)
  await x.ev(`(() => { const fx = ${JSON.stringify(FIXTURE)}, I = ${JSON.stringify(I)};
    const i = matches.findIndex(m => m.id === fx.id); if (i >= 0) matches.splice(i, 1); matches.push(fx); window.__fx = fx;
    Object.assign(fx, { h2h: I.h2h, p1TournamentHistory: I.hist, p2TournamentHistory: null, oddsMovement: I.odds, _oddsLoaded: true, valueSnapshot: I.value,
      p1RecentFormMatches: I.formA, p2RecentFormMatches: I.formB, _fhFormRows: [I.formA, I.formB], _fhFormSrc: ['form', 'form'], _fhCloses: [null, null], _fhElo: null, _fhFormData: true,
      _fhCh: [[], []], _fhH2hData: true, _kfWx: { entry: {}, file: null, arch: null } });
    const _st = ppStyleFor; ppStyleFor = (name) => (I.styles[name] || _st(name));
    const _el = ppEloForSurface; ppEloForSurface = (p, s) => (p && I.elo[p.name] != null ? { rating: I.elo[p.name] } : _el(p, s));
    Object.keys(I.profiles).forEach(k => { playerProfiles[k] = I.profiles[k]; _ovProfileSettled.add(k); });
    psMatrixData = I.matrix; ensurePsMatrix = () => Promise.resolve(psMatrixData);
    _mdna = { byKey: I.dna, meta: {} }; ensureMatchDna = () => Promise.resolve(_mdna);
    const _pr = tourxConditionsProse; tourxConditionsProse = (surf, cat, spd, b) => (spd === fx.courtSpeed.abstractSpeed && cat === fx.courtSpeed.category ? I.prose : _pr(surf, cat, spd, b));
    const _wx = wxModel; wxModel = (m, ...a) => (m && m.id === fx.id ? I.wx : _wx(m, ...a));
    const hold = (f) => (m, ...a) => (m && m.id === fx.id ? Promise.resolve(m) : f(m, ...a));
    fhEnsureFormData = hold(fhEnsureFormData); fhEnsureH2hData = hold(fhEnsureH2hData); ensureOddsMovement = hold(ensureOddsMovement);
    kfEnsureWeather = hold(kfEnsureWeather); ensureOverviewProfiles = hold(ensureOverviewProfiles);
    return true; })()`);
  if (THEME === 'day' || THEME === 'night') await x.ev(`typeof maSetTheme === 'function' ? (maSetTheme(${JSON.stringify(THEME)}), true) : false`);
  await x.ev(`openAnalysisModal('ten312-fixture'), true`);
  if (THEME === 'source') await x.ev(`(() => { const ov = document.getElementById('analysisModal');
    ${JSON.stringify(Object.entries(SOURCE_TOKENS))}.forEach(([k, v]) => ov.style.setProperty(k, v));
    const names = new Set(); for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch (e) { continue; } for (const r of rules) { if (r.style) for (const p of r.style) if (p.startsWith('--ma-s-')) names.add(p); if (r.cssRules) for (const q of r.cssRules) if (q.style) for (const p of q.style) if (p.startsWith('--ma-s-')) names.add(p); } }
    for (const n of names) { const mm = /^--ma-s-([0-9a-f]{6})(?:-(\\d{3}))?/.exec(n); if (!mm) continue; const h = mm[1], a = mm[2] != null ? +mm[2] / 1000 : 1;
      ov.style.setProperty(n, 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')'); }
    return names.size; })()`);
  await x.ev(`aShowTab('key'), true`);
  for (let t = Date.now(); !(await x.ev(`!!document.querySelector('#aSectionKey .kf-model') && !!document.querySelector('#aSectionKey .kf-poly-a')`)); ) { if (Date.now() - t > 20000) throw new Error('Key factors never built'); await sleep(200); }
  await sleep(300);
  const man = [], leaves = {};
  for (const st of STATES) {
    if (ONLY && !ONLY.has(st.name)) continue;
    await x.ev(SETTLE);
    const fr = await x.ev(B_FRAME); await sleep(100); await x.ev(SETTLE);
    const clip = await x.ev(`(() => { const r = document.querySelector('#analysisModal .modal-analysis').getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: Math.round(r.width), h: Math.round(r.height) }; })()`);
    await shot(x, clip, path.join(dir, st.name + '.png'));
    leaves[st.name] = await x.ev(LEAVES(`document.getElementById('aSectionKey')`));
    const cr = await x.ev(`(() => { const r = document.querySelector('#analysisModal .abody').getBoundingClientRect(), m = document.querySelector('#analysisModal .modal-analysis').getBoundingClientRect(); return [Math.round(r.left - m.left), Math.round(r.top - m.top), Math.round(m.width), Math.round(m.height)]; })()`);
    man.push({ name: st.name, ref: st.name, size: [clip.w, clip.h], frame: fr, content: cr });
    await x.ev(B_UNFRAME);
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ servedThisCheckout: true, root: ROOT, theme: THEME, fixture: FIXTURE, screens: man }, null, 1));
  return { leaves };
}

async function main() {
  const dd = path.join(OUT, 'design'), bd = path.join(OUT, 'build');
  fs.mkdirSync(dd, { recursive: true }); fs.mkdirSync(bd, { recursive: true });
  const D = await designSide(dd);
  if (DESIGN_ONLY){ fs.writeFileSync(path.join(OUT, 'leaves.json'), JSON.stringify({ design: D.leaves }, null, 1)); console.log('wrote', OUT); return; }
  const B = await buildSide(bd);
  fs.writeFileSync(path.join(OUT, 'leaves.json'), JSON.stringify({ design: D.leaves, build: B.leaves }, null, 1));
  console.log('wrote', OUT);
}
main().then(() => { cleanup(); process.exit(0); }, (e) => { console.error('FAIL:', e.stack || e.message); cleanup(); process.exit(1); });
