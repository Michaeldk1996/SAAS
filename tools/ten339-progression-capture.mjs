#!/usr/bin/env node
// TEN-339 — TEST-ONLY Progression-tab capture for the Match analysis pixel diff (both halves in one tool). Never loaded by
// the live page and never run in CI: a manual tool, like tools/ten331-h2h-capture.mjs (whose clock, zone, viewport, raster
// flags, framing and helpers it repeats).
//
//   node tools/ten339-progression-capture.mjs <outDir> [--only a,b] [--theme night|day|source]
//
// 1. Renders the LOCKED design file (needs network: React + Babel from unpkg) and captures every Progression state below.
//    The file's review switcher (the FACING R1…F / bye row with its SAMPLE DATA chip, DF L669–673) is hidden before each
//    capture: a review control, not a designed element (DoD item 4 — our build has none; the facing round is the match's).
// 2. Serves THIS checkout's dashboard, pushes the design's demo match (J. Sinner v C. Alcaraz, ATP Washington) and hands
//    the Progression builder the design's own demo values — DF progressionFor evaluated on the committed file: the road's
//    opponents, set scores, closing pairs and styles, each round's nine figures for both players and the draw average —
//    in our shapes (m._pg sides of career-history rows, pgDrawFor, ppStyleFor), then captures the same states.
//    FIXTURE MODE LIVES ONLY HERE: nothing reaches bsp-consult-dashboard.html.
// 3. Dumps every visible text leaf of the tab on both sides → leaves.json (structure: python3
//    tools/ten330-form-structure.py <outDir>/leaves.json — the comparison is tab-agnostic).
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
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!OUT) { console.error('usage: node tools/ten339-progression-capture.mjs <outDir> [--only a,b] [--theme night|day|source]'); process.exit(2); }
const FROZEN_NOW = Date.parse('2026-09-28T12:19:30+08:00');
const TZ = 'Asia/Makassar';
const VIEW_W = 1370, VIEW_H = 745, FIT_H = 760, POP_W = 1001;

// Every Progression state (DF ST, L3953): the design state patch ↔ the build's facing round (fixture tournamentRound) +
// its UI state (hi = highlighted round, met = metric filter). sheet = the first road cell's match stats pop-up.
const STATES = [
  { name: '01-progression', d: {}, f: 'QF' },
  { name: '01b-progression-round-highlight-metric-filter', d: { maPgHi: 1, maPgMet: { dominance: true, serveRating: true, returnRating: true } }, f: 'QF', b: { hi: 1, met: { dominance: true, serveRating: true, returnRating: true } } },
  { name: '01c-progression-r1-empty', d: { maPgState: 'R1' }, f: 'R1' },
  { name: '01d-progression-facing-final', d: { maPgState: 'F' }, f: 'F' },
  { name: '01e-progression-bye', d: { maPgState: 'bye' }, f: 'QF' },   // DF: C. Alcaraz's R1 is a bye (his R1 row absent)
  { name: 'P6-progression-box-match-sheet', d: { maFormSheet: 'pg|Washington|J. Sinner|R1' }, f: 'QF', sheet: true, pop: true },
];
const RDS = ['R1', 'R2', 'R3', 'R4', 'QF', 'SF', 'F'];
const FRAC = { R1: '1/64-finals', R2: '1/32-finals', R3: '1/16-finals', R4: '1/8-finals', QF: 'Quarter-finals', SF: 'Semi-finals', F: 'Final' };
// Source value of a role token (README §3 read backwards) for --theme source; the shade tokens carry theirs in their names.
const SOURCE_TOKENS = { '--ma-page': '#0a0d14', '--ma-card': '#0a0d14', '--ma-inner': '#06070a', '--ma-raised': '#11151f', '--ma-hover': 'rgba(255,255,255,0.03)',
  '--ma-sel': 'rgba(91,155,255,0.16)', '--ma-hair': 'rgba(255,255,255,0.09)', '--ma-hair-soft': 'rgba(255,255,255,0.05)', '--ma-hair-strong': 'rgba(255,255,255,0.14)',
  '--ma-outline': 'rgba(91,155,255,0.22)', '--ma-t1': '#e7e9ee', '--ma-t2': '#8b96b5', '--ma-t3': '#5b6880', '--ma-fill': '#5b9bff', '--ma-link': '#5b9bff',
  '--ma-pos': '#3dd68c', '--ma-neg': '#e0616f', '--ma-track': 'rgba(255,255,255,0.08)', '--ma-pb-fill': 'rgba(231,233,238,0.7)' };

// The design's demo values: DF progressionFor evaluated on the committed file for one facing state (AN = the demo match,
// DF demoMatch L2300: ATP Washington, J. Sinner 1.54 v C. Alcaraz 2.62).
function designModel(state) {
  const dc = fs.readFileSync(path.join(HANDOFF, DESIGN), 'utf8');
  const a = dc.indexOf('  progressionFor(AN, S) {'), b = dc.indexOf('\n  maSheetFor(seedKey', a);
  if (a < 0 || b < 0) throw new Error('DF progressionFor() not found');
  const body = dc.slice(a + '  progressionFor(AN, S) '.length, b).trim().replace(/^\{/, '').replace(/\}\s*$/, '');
  const f = new Function('AN', 'S', body);
  const AN = { tourn: 'ATP Washington', surface: 'Hard', aName: 'J. Sinner', bName: 'C. Alcaraz', aOdds: '1.54', bOdds: '2.62' };
  return f.call({ setState() {}, state: {} }, AN, { maPgState: state });
}
// One facing state → our inputs: both players' rows (meRowFromCareer's shape, r.pg = the nine figures carrying counts that
// pool back to the design's mean), the draw per round, the opponents' styles.
function buildInputs(state) {
  const D = designModel(state);
  if (D.isEmpty) return { empty: true, sides: [[], []], draw: [], styles: {} };
  const played = D.road[0].cells.length;
  const styles = {};
  const fig = (mt, v) => {
    if (v == null) return { v: null };
    if (mt.kind === 'pct') return { v, won: +v.toFixed(1), total: 100 };
    if (mt._m.key === 'dominance') return { v, rp: { won: v * 500, total: 1000 }, sp: { won: 500, total: 1000 } };
    if (mt._m.key === 'wue') return { v, w: v * 100, u: 100 };
    return { v };
  };
  const sides = D.road.map((p, k) => p.cells.map((c, i) => {
    if (c.isBye) return null;
    styles[c.opp] = c.style;
    const sets = c.score.split(' ').map(x => x.split('-').map(Number)).map(([o, q]) => [o, q, null]);
    const pS = sets.filter(x => x[0] > x[1]).length, oS = sets.length - pS;
    const pg = {}; D.metrics.forEach(mt => { pg[mt._m.key] = fig(Object.assign({ kind: mt._m.kind }, mt), (k ? mt._b : mt._a)[i]); });
    // the design's dateOf (DF L4043): 19 Jul 2026 − (n − i) × 2 days
    const dt = new Date(Date.UTC(2026, 6, 19 - (played - i) * 2)).toISOString().slice(0, 10);
    return { date: dt, tourn: 'Washington', surface: 'Hard', round: RDS[i], ri: i, opp: c.opp, won: true, result: pS + ' - ' + oS, sets, done: sets, pS, oS,
      wo: false, ret: false, ek: null, price: +c.own, oppPrice: +c.oppOdd, book: 'P', src: 'cap', pg };
  }).filter(Boolean));
  // the THIS MATCH cards' styles (DF L4128: the other player's)
  D.road.forEach((p, k) => { const now = p.tl.find(c => c.isNow); if (now) styles[now.opp] = now.style; });
  const draw = RDS.slice(0, played).map((_, i) => { const o = {}; D.metrics.forEach(mt => { o[mt._m.key] = { v: mt._f[i], n: 24 }; }); return o; });
  return { sides, draw, styles, sub: D.sub };
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
// DESIGN side (helpers = tools/ten331-h2h-capture.mjs D_HELPERS + the Progression review-row hook)
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
    // the FACING review row: the flex row holding the "FACING" caption (DF L669)
    hideReview() { const cap = [...document.querySelectorAll('span')].find(s => s.textContent.trim() === 'FACING' && s.getClientRects().length);
      if (!cap) throw new Error('no FACING row'); api._style(cap.parentElement, 'display:none !important;'); return true; },
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
    await x.ev(`__cap.reset()`); await x.ev(`__cap.set(${JSON.stringify(Object.assign({ maTab: 'Progression' }, st.d))})`); await x.ev(SETTLE);
    if (st.pop) { await x.ev(`__cap.framePop()`); await sleep(100); await x.ev(SETTLE); const clip = await x.ev(`__cap.clipPop()`); await shot(x, clip, path.join(dir, st.name + '.png')); man.push({ name: st.name, size: [clip.w, clip.h] }); await x.ev(`__cap.unframe()`); continue; }
    await x.ev(`__cap.hideReview()`);
    const fr = await x.ev(`__cap.frameModal(1296)`); await sleep(100); await x.ev(SETTLE);
    const clip = await x.ev(`__cap.clipModal()`);
    await shot(x, clip, path.join(dir, st.name + '.png'));
    leaves[st.name] = await x.ev(LEAVES(`__cap.tabRoot()`));
    const cr = await x.ev(`(() => { const r = __cap.tabRoot().getBoundingClientRect(), m = document.querySelector('[data-cap-modal]').getBoundingClientRect(); return [Math.round(r.left - m.left), Math.round(r.top - m.top), Math.round(r.right - m.left), Math.round(r.bottom - m.top)]; })()`);
    man.push({ name: st.name, size: [clip.w, clip.h], frame: fr, content: cr });
    await x.ev(`__cap.unframe()`);
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ design: path.join(HANDOFF, DESIGN), reviewSwitcherHidden: true, screens: man }, null, 1));
  return { leaves };
}

// ---------------------------------------------------------------------------------------------------------------
// BUILD side
const FIXTURE = { id: 'ten312-fixture', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: '900001', p2Key: '900002', date: '2026-07-20',
  tour: 'ATP Washington', tournament: 'ATP Washington', tournamentRound: 'ATP Washington - Quarter-finals', surface: 'Hard',
  startTs: '2026-07-20T22:00:00Z', bestOdds: { p1: { price: 1.54 }, p2: { price: 2.62 } } };
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
  const served = await x.ev(`typeof pgModel === 'function' && typeof PROGRESSION_TABLE_METRICS === 'undefined'`);
  if (!served) throw new Error('the page served is not this checkout (no pgModel)');
  // the fixture match; the design's styles and draw average for the fixture's names / event only
  await x.ev(`(() => { const fx = ${JSON.stringify(FIXTURE)};
    const i = matches.findIndex(m => m.id === fx.id); if (i >= 0) matches.splice(i, 1); matches.push(fx);
    window.__pgFx = null;
    const _st = ppStyleFor; ppStyleFor = (name) => (window.__pgFx && window.__pgFx.styles[name] ? { archetype_label: window.__pgFx.styles[name] } : _st(name));
    const _dr = pgDrawFor; pgDrawFor = (t, labels) => (window.__pgFx ? window.__pgFx.draw.slice(0, labels.length) : _dr(t, labels));
    const _ho = aHeaderOdds; aHeaderOdds = (m) => (m && m.id === fx.id ? { p1: '1.54', p2: '2.62' } : _ho(m));
    window.__pgSet = (I, facing, ui) => { const m = matches.find(z => z.id === fx.id); window.__pgFx = I;
      m.tournamentRound = 'ATP Washington - ' + facing;
      m._pgP = Promise.resolve(); m._pg = { sides: [0, 1].map(k => ({ key: k ? '900002' : '900001', name: k ? fx.p2 : fx.p1, loaded: true, rows: I.sides[k] || [] })) };
      _pg = { m, hi: ui && ui.hi != null ? ui.hi : null, met: ui && ui.met || null }; pgRender(); return true; };
    return true; })()`);
  if (THEME === 'day' || THEME === 'night') await x.ev(`typeof maSetTheme === 'function' ? (maSetTheme(${JSON.stringify(THEME)}), true) : false`);
  await x.ev(`openAnalysisModal('ten312-fixture'), true`);
  if (THEME === 'source') await x.ev(`(() => { const ov = document.getElementById('analysisModal');
    ${JSON.stringify(Object.entries(SOURCE_TOKENS))}.forEach(([k, v]) => ov.style.setProperty(k, v));
    const names = new Set(); for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch (e) { continue; } for (const r of rules) { if (r.style) for (const p of r.style) if (p.startsWith('--ma-s-')) names.add(p); if (r.cssRules) for (const q of r.cssRules) if (q.style) for (const p of q.style) if (p.startsWith('--ma-s-')) names.add(p); } }
    for (const n of names) { const mm = /^--ma-s-([0-9a-f]{6})(?:-(\\d{3}))?/.exec(n); if (!mm) continue; const h = mm[1], a = mm[2] != null ? +mm[2] / 1000 : 1;
      ov.style.setProperty(n, 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')'); }
    return names.size; })()`);
  await x.ev(`aShowTab('progression'), true`);
  const man = [], leaves = {};
  for (const st of STATES) {
    if (ONLY && !ONLY.has(st.name)) continue;
    const I = buildInputs(st.d.maPgState || 'QF');
    await x.ev(`(() => { fhCloseSheet(); return __pgSet(${JSON.stringify(I)}, ${JSON.stringify(FRAC[st.f] || st.f)}, ${JSON.stringify(st.b || null)}); })()`);
    for (let t = Date.now(); !(await x.ev(`!!document.querySelector('#aSectionProgression .pg-wrap')`)); ) { if (Date.now() - t > 20000) throw new Error('Progression never built'); await sleep(200); }
    await sleep(150); await x.ev(SETTLE);
    if (st.sheet) {
      await x.ev(`(() => { const el = document.querySelector('#aSectionProgression .pg-cell[onclick]'); if (!el) throw new Error('no road cell'); el.click(); return true; })()`);
      for (let t = Date.now(); !(await x.ev(`!!document.querySelector('#fhSheet > div')`)); ) { if (Date.now() - t > 20000) throw new Error('sheet never opened'); await sleep(200); }
      await sleep(800); await x.ev(SETTLE);
    }
    if (st.pop) {
      const clip = await x.ev(`(() => { const ps = document.querySelector('#fhSheet > div'); const box = ps.children[1];
        window.__saved = [document.documentElement, document.body, ps, box].map(e => [e, e.getAttribute('style')]);
        const st = (e, css) => e.setAttribute('style', (e.getAttribute('style') || '') + ';' + css);
        st(document.documentElement, 'background:transparent !important;'); st(document.body, 'background:transparent !important;');
        if (!document.getElementById('__capHide2')) { const h = document.createElement('style'); h.id = '__capHide2'; h.textContent = 'body > *:not(#analysisModal){ visibility:hidden !important; } #analysisModal .modal-analysis > *:not(#fhSheet){ visibility:hidden !important; } #analysisModal{ background:transparent !important; backdrop-filter:none !important; } #analysisModal .modal-analysis{ background:transparent !important; border-color:transparent !important; box-shadow:none !important; }'; document.head.appendChild(h); }
        st(ps, 'position:absolute !important; inset:auto !important; left:0 !important; top:0 !important; width:${POP_W}px !important; height:auto !important; overflow:visible !important; padding-top:24px !important; padding-bottom:24px !important;');
        const r = ps.getBoundingClientRect(), br = box.getBoundingClientRect(); return { x: r.left + scrollX, y: br.top - 24 + scrollY, w: Math.round(r.width), h: Math.round(br.height + 48) }; })()`);
      await sleep(100); await x.ev(SETTLE);
      await shot(x, clip, path.join(dir, st.name + '.png')); man.push({ name: st.name, ref: st.name, size: [clip.w, clip.h] });
      await x.ev(`(() => { for (const [e, s] of window.__saved) { if (s == null) e.removeAttribute('style'); else e.setAttribute('style', s); } document.getElementById('__capHide2').remove(); fhCloseSheet(); return true; })()`);
      continue;
    }
    const fr = await x.ev(B_FRAME); await sleep(100); await x.ev(SETTLE);
    const clip = await x.ev(`(() => { const r = document.querySelector('#analysisModal .modal-analysis').getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: Math.round(r.width), h: Math.round(r.height) }; })()`);
    await shot(x, clip, path.join(dir, st.name + '.png'));
    leaves[st.name] = await x.ev(LEAVES(`document.getElementById('aSectionProgression')`));
    const cr = await x.ev(`(() => { const r = document.querySelector('#analysisModal .abody').getBoundingClientRect(), m = document.querySelector('#analysisModal .modal-analysis').getBoundingClientRect(); return [Math.round(r.left - m.left), Math.round(r.top - m.top), Math.round(m.width), Math.round(m.height)]; })()`);
    // `ref` + `content` = the tab pane (right of the menu, under the header): tools/ten312-pixel-diff.py --regions build/manifest.json
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
  const B = await buildSide(bd);
  fs.writeFileSync(path.join(OUT, 'leaves.json'), JSON.stringify({ design: D.leaves, build: B.leaves }, null, 1));
  console.log('wrote', OUT);
}
main().then(() => { cleanup(); process.exit(0); }, (e) => { console.error('FAIL:', e.stack || e.message); cleanup(); process.exit(1); });
