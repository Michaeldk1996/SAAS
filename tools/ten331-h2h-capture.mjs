#!/usr/bin/env node
// TEN-331 — TEST-ONLY H2H-tab capture for the Match analysis pixel diff (both halves in one tool). Never loaded by the
// live page and never run in CI: a manual tool, like tools/ten330-form-capture.mjs (whose clock, zone, viewport, raster
// flags, framing and helpers it repeats).
//
//   node tools/ten331-h2h-capture.mjs <outDir> [--only a,b] [--theme night|day|source]
//
// 1. Renders the LOCKED design file (needs network: React + Babel from unpkg) and captures every H2H state below. The
//    file's review switcher (the dashed "State" box, DF L1155–1158) is hidden before each capture: a review control, not
//    a designed element (DoD item 4 — our build has none).
// 2. Serves THIS checkout's dashboard, pushes the design's demo match (ten312-build-capture FIXTURE) and hands the H2H
//    builder the design's nine meetings (DF `h2hV2For` ALL, L4309–4319) in our data shapes — the api-tennis H2H list,
//    form-shard rows carrying the set scores, a parsed match-closes shard (Pinnacle pair = the design's closes), an
//    elo-history with the design's Elo — then captures the same states. Today's price is the design's 1.54 / 2.62
//    (the demo match is completed, and a completed match has no today price on our build: fhTodayPair is wrapped for
//    the fixture id only). FIXTURE MODE LIVES ONLY HERE: nothing reaches bsp-consult-dashboard.html.
// 3. Dumps every visible text leaf of the H2H section on both sides → leaves.json (structure: python3
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
// --ruled-off: undo, on the build side only, the differences a founder ruling put there (measurement aid, reported as such):
// player B neutral grey (D4) → the design's #E7E9EE, the neutral hot-line column dots (U22) → the design's surface colours,
// and hide the TEN-325 retirement note and the D2 small-sample chips. What remains is the structural residual.
const RULED_OFF = args.includes('--ruled-off');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!OUT) { console.error('usage: node tools/ten331-h2h-capture.mjs <outDir> [--only a,b] [--theme night|day|source]'); process.exit(2); }
const FROZEN_NOW = Date.parse('2026-09-28T12:19:30+08:00');
const TZ = 'Asia/Makassar';
const VIEW_W = 1370, VIEW_H = 745, FIT_H = 760, POP_W = 1001;

// Every H2H state: design state patch ↔ our fhH2h state (b) + fixture set (set: full | one | none | loading).
// hover = the Price range figures of player A (the "every priced close" pop-up); sheet = the newest meeting's row.
const STATES = [
  { name: '07-h2h', d: {}, b: {} },
  { name: '07b-h2h-hard-filter', d: { h2Surf: 'Hard' }, b: { surf: 'Hard' } },
  { name: '07c-h2h-one-meeting', d: { h2State: 'one' }, b: {}, set: 'one' },
  // the design reference's own trick (ten312-design-capture): h2Surf 'clay' matches no meeting and lights no chip
  { name: '07d-h2h-surface-with-no-meetings', d: { h2Surf: 'clay' }, b: { surf: 'clay' } },
  { name: '07e-h2h-no-meetings', d: { h2State: 'none' }, b: {}, set: 'none' },
  { name: '07f-h2h-loading', d: { h2State: 'loading' }, b: {}, set: 'loading' },
  { name: '07g-h2h-all-lines', d: { h2AllLines: true }, b: { allLines: true } },
  { name: '07h-h2h-breakdown-sets', d: { h2Stat: 'sets' }, b: { stat: 'sets' } },
  { name: '07i-h2h-breakdown-tiebreaks', d: { h2Stat: 'tb' }, b: { stat: 'tb' } },
  { name: '07j-h2h-breakdown-deciding', d: { h2Stat: 'dec' }, b: { stat: 'dec' } },
  { name: '07k-h2h-price-tooltip', d: {}, b: {}, hover: true },
  { name: 'P7-h2h-match-stats-sheet', d: { maFormSheet: 'h2_2025-11-16' }, b: {}, sheet: true, pop: true },
];
// The design's meetings (DF h2hV2For ALL, L4309–4319): Sinner-first scores; sc = [own, opp, loser's tiebreak points];
// inc = the last set unfinished (a retirement); oA / oB = the closing pair; eB = Alcaraz's Elo at the time.
const ALL = [
  { d: '2021-11-03', t: 'Paris Masters', rd: 'R32', s: 'Hard', io: 'Indoor', w: 'b', bo: 3, sc: [[6, 7, 4], [7, 6, 5], [6, 7, 3]], oA: 1.45, oB: 2.78, eB: 1905 },
  { d: '2022-07-31', t: 'Umag', rd: 'F', s: 'Clay', io: 'Outdoor', w: 'b', bo: 3, sc: [[7, 6, 5], [1, 6], [1, 6]], oA: 2.20, oB: 1.70, eB: 2010 },
  { d: '2022-09-07', t: 'US Open', rd: 'QF', s: 'Hard', io: 'Outdoor', w: 'b', bo: 5, sc: [[6, 3], [6, 7, 7], [6, 7, 0], [7, 5], [3, 6]], oA: 1.95, oB: 1.92, eB: 2065 },
  { d: '2023-03-18', t: 'Indian Wells', rd: 'SF', s: 'Hard', io: 'Outdoor', w: 'b', bo: 3, sc: [[6, 7, 4], [3, 6]], oA: 2.45, oB: 1.60, eB: 2140 },
  { d: '2023-03-31', t: 'Miami', rd: 'SF', s: 'Hard', io: 'Outdoor', w: 'a', bo: 3, sc: [[6, 7, 4], [6, 4], [6, 2]], oA: null, oB: null, eB: 2155 },
  { d: '2024-03-16', t: 'Indian Wells', rd: 'SF', s: 'Hard', io: 'Outdoor', w: 'a', bo: 3, sc: [[6, 4], [6, 4]], oA: 2.10, oB: 1.78, eB: 2170 },
  { d: '2024-05-02', t: 'Madrid', rd: 'QF', s: 'Clay', io: 'Outdoor', w: 'b', bo: 3, sc: [[3, 6], [1, 2]], inc: true, oA: 2.05, oB: 1.80, eB: 2160 },
  { d: '2024-10-12', t: 'Shanghai', rd: 'SF', s: 'Hard', io: 'Outdoor', w: 'a', bo: 3, sc: [[6, 4], [7, 5]], oA: 1.55, oB: 2.55, eB: 2190 },
  { d: '2025-11-16', t: 'ATP Finals', rd: 'F', s: 'Hard', io: 'Indoor', w: 'a', bo: 3, sc: [[7, 6, 4], [6, 4]], oA: 1.70, oB: 2.22, eB: 2205 },
];
// Source value of a role token (README §3 read backwards) for --theme source; the shade tokens carry theirs in their names.
const SOURCE_TOKENS = { '--ma-page': '#0a0d14', '--ma-card': '#0a0d14', '--ma-inner': '#06070a', '--ma-raised': '#11151f', '--ma-hover': 'rgba(255,255,255,0.03)',
  '--ma-sel': 'rgba(91,155,255,0.16)', '--ma-hair': 'rgba(255,255,255,0.09)', '--ma-hair-soft': 'rgba(255,255,255,0.05)', '--ma-hair-strong': 'rgba(255,255,255,0.14)',
  '--ma-outline': 'rgba(91,155,255,0.22)', '--ma-t1': '#e7e9ee', '--ma-t2': '#8b96b5', '--ma-t3': '#5b6880', '--ma-fill': '#5b9bff', '--ma-link': '#5b9bff',
  '--ma-pos': '#3dd68c', '--ma-neg': '#e0616f', '--ma-track': 'rgba(255,255,255,0.08)', '--ma-pb-fill': 'rgba(231,233,238,0.7)' };

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
async function hoverAt(x, pt) { await x.c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y }); }
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
// DESIGN side (helpers = tools/ten330-form-capture.mjs D_HELPERS + the H2H hooks)
const D_HELPERS = `window.__cap = (() => {
  const host = () => { const el = document.querySelector('.nav'); const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$'));
    for (let f = el[k]; f; f = f.return) if (f.stateNode && f.stateNode.logic && f.stateNode.logic.renderVals && 'maTab' in (f.stateNode.logic.state || {})) return f.stateNode;
    throw new Error('dc host not found'); };
  const modal = () => document.querySelector('.nav').closest('div[style*="88vh"], div[data-cap-modal]');
  const api = { host, _saved: [],
    reset() { const h = host(); h.logic.state = { maTab: null }; return new Promise((r) => h.forceUpdate(() => r(true))); },
    set(p) { const h = host(); return new Promise((r) => h.logic.setState(p, () => r(true))); },
    click(text) { const all = [...document.querySelectorAll('*')].filter((e) => (e.textContent || '').replace(/\\s+/g, ' ').trim() === text && e.getClientRects().length);
      const leaves = all.filter((e) => !all.some((o) => o !== e && e.contains(o))); if (!leaves[0]) throw new Error('click: none for ' + text); leaves[0].click(); return true; },
    _style(el, css) { api._saved.push([el, el.getAttribute('style')]); el.setAttribute('style', (el.getAttribute('style') || '') + ';' + css); },
    unframe() { for (const [el, s] of api._saved.reverse()) { if (s == null) el.removeAttribute('style'); else el.setAttribute('style', s); } api._saved = []; return true; },
    _grow() { const m = modal(); m.setAttribute('data-cap-modal', '1'); const scrim = m.parentElement, body = m.children[1], menu = body.children[0], content = body.children[1];
      api._style(scrim, 'background:transparent !important; backdrop-filter:none !important; position:absolute !important; inset:auto !important; left:0 !important; top:0 !important; width:${VIEW_W}px !important; height:auto !important; min-height:${VIEW_H}px !important; align-items:flex-start !important;');
      api._style(m, 'height:auto !important;'); api._style(body, 'flex:none !important; grid-template-rows:auto !important;'); api._style(menu, 'overflow:visible !important;'); api._style(content, 'overflow:visible !important;');
      return { m, scrim, content }; },
    frameModal(forceW) { const { m, scrim } = api._grow(); let h = m.getBoundingClientRect().height, w = forceW || (h > ${FIT_H} ? 1296 : 1306);
      api._style(scrim, 'width:' + (w + 64) + 'px !important; padding:32px !important;'); api._style(m, 'min-height:${Math.round(VIEW_H * 0.88)}px !important;'); return { w }; },
    clipModal() { const r = document.querySelector('[data-cap-modal]').getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: Math.round(r.width), h: Math.round(r.height) }; },
    formRoot() { const m = document.querySelector('[data-cap-modal]') || modal(); const c = m.children[1].children[1]; return c; },
    hideReview() { const w = document.querySelector('.h2wrap'); if (w && w.firstElementChild) api._style(w.firstElementChild, 'display:none !important;'); return true; },
    priceFigsA() { const g = [...document.querySelectorAll('.elotip')].find(e => /Lowest/.test(e.textContent)); const b = g.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 12 }; },
    lastBarA() { const c = api.formRoot(); const bars = [...c.querySelectorAll('.elotip')]; const half = bars.filter(b => b.getBoundingClientRect().left < c.getBoundingClientRect().left + c.getBoundingClientRect().width / 2); const b = half[half.length - 1].getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 8 }; },
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
    await x.ev(`__cap.reset()`); await x.ev(`__cap.set(${JSON.stringify(Object.assign({ maTab: 'H2H' }, st.d))})`); await x.ev(SETTLE);
    if (st.pop) { await x.ev(`__cap.framePop()`); await sleep(100); await x.ev(SETTLE); const clip = await x.ev(`__cap.clipPop()`); await shot(x, clip, path.join(dir, st.name + '.png')); man.push({ name: st.name, size: [clip.w, clip.h] }); await x.ev(`__cap.unframe()`); continue; }
    await x.ev(`__cap.hideReview()`);
    const fr = await x.ev(`__cap.frameModal(1296)`); await sleep(100); await x.ev(SETTLE);
    if (st.hover) { await hoverAt(x, await x.ev(`__cap.priceFigsA()`)); await sleep(200); await x.ev(SETTLE); }
    const clip = await x.ev(`__cap.clipModal()`);
    await shot(x, clip, path.join(dir, st.name + '.png'));
    leaves[st.name] = await x.ev(LEAVES(`__cap.formRoot()`));
    const cr = await x.ev(`(() => { const r = __cap.formRoot().getBoundingClientRect(), m = document.querySelector('[data-cap-modal]').getBoundingClientRect(); return [Math.round(r.left - m.left), Math.round(r.top - m.top), Math.round(r.right - m.left), Math.round(r.bottom - m.top)]; })()`);
    man.push({ name: st.name, size: [clip.w, clip.h], frame: fr, content: cr });
    if (st.hover) await hoverAt(x, { x: 1, y: 1 });
    await x.ev(`__cap.unframe()`);
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ design: path.join(HANDOFF, DESIGN), reviewSwitcherHidden: true, screens: man }, null, 1));
  return { leaves };
}

// ---------------------------------------------------------------------------------------------------------------
// BUILD side
const FIXTURE = { id: 'ten312-fixture', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: '900001', p2Key: '900002', date: '2026-07-20',
  tour: 'ATP Washington', tournament: 'ATP Washington', tournamentRound: 'ATP Washington - Quarter-finals', surface: 'Hard',
  startTs: '2026-07-20T22:00:00Z', bestOdds: { p1: { price: 1.54 }, p2: { price: 2.62 } },
  finalScore: { display: '6-4, 4-6, 7-6', sets: [{ p1: 6, p2: 4 }, { p1: 4, p2: 6 }, { p1: 7, p2: 6 }], p1Sets: 2, p2Sets: 1, winner: 'p1' } };
const RD = { R128: '1/64-finals', R64: '1/32-finals', R32: '1/16-finals', R16: '1/8-finals', QF: 'Quarter-finals', SF: 'Semi-finals', F: 'Final' };
const dayIso = (s, k) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + k)).toISOString().slice(0, 10);
// The design's meetings in our shapes: the api-tennis H2H list (m.h2h.matches), p1's form-shard rows carrying the set
// scores by eventKey (tiebreak points: the loser's, as the design's), a parsed match-closes shard, elo snapshots.
function buildInputs() {
  const done = (m) => (m.inc ? m.sc.slice(0, -1) : m.sc);
  const list = ALL.map((m, i) => { const dn = done(m), pS = dn.filter(x => x[0] > x[1]).length;
    return { date: m.d, tournament: m.t, round: RD[m.rd], surface: m.s.toLowerCase(), p1Won: m.w === 'a', result: pS + ' - ' + (dn.length - pS), eventKey: 9100000 + i, level: 'ATP', qualifying: false }; });
  const form = ALL.map((m, i) => ({ opponent: 'C. Alcaraz', opponentKey: '900002', date: m.d, tournament: m.t, round: RD[m.rd], surface: m.s.toLowerCase(),
    result: list[i].result, won: m.w === 'a', retired: !!m.inc, walkover: false, qualifying: false, tier: 'atp', eventKey: 9100000 + i,
    sets: m.sc.map(x => { const s = { p: x[0], o: x[1] }; if (x[2] != null) { if (x[0] < x[1]) s.pTb = x[2]; else s.oTb = x[2]; } return s; }) }));
  const closes = { rows: ALL.filter(m => m.oA != null).map(m => ({ date: m.d, opp: 'Alcaraz C.', won: m.w === 'a', P: [m.oA, m.oB], B: null, ret: !!m.inc, oppKey: '900002' })), cap: [] };
  const snaps = ALL.map(m => ({ asOf: dayIso(m.d, -1), elo: m.eB }));
  return { list, form, closes, snaps };
}
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

async function buildSide(dir, I) {
  const x = await browser(ROOT, 'bsp-consult-dashboard.html', `var _b; Object.defineProperty(window, 'BSP', { configurable: true, get() { return _b; }, set(v) { if (v) { const u = Promise.resolve({ emailVerified: true }); v.requireVerified = () => u; v.requireAuth = () => u; } _b = v; } });`);
  const t0 = Date.now();
  while (!(await x.ev(`typeof matches === 'object' && Array.isArray(matches) && typeof openAnalysisModal === 'function' && typeof aShowTab === 'function'`).catch(() => false))) { if (Date.now() - t0 > 90000) throw new Error('dashboard did not boot'); await sleep(300); }
  await x.ev(`document.fonts.ready.then(() => true)`);
  const served = await x.ev(`typeof fhH2hRowData === 'function' && typeof fhH2hRowHtml === 'undefined'`);
  if (!served) throw new Error('the page served is not this checkout (no fhH2hRowData)');
  // fixture match + the design's meetings in our shapes; today's price = the design's (fixture id only)
  await x.ev(`(() => { const fx = ${JSON.stringify(FIXTURE)}, I = ${JSON.stringify(I)};
    const i = matches.findIndex(m => m.id === fx.id); if (i >= 0) matches.splice(i, 1); matches.push(fx);
    window.__h2hI = I; window.__h2hSet = (set) => { const m = matches.find(z => z.id === fx.id);
      m.h2h = { matches: set === 'one' ? I.list.slice(-1) : set === 'none' ? [] : I.list };
      m.p1RecentFormMatches = I.form; m.p2RecentFormMatches = []; m._formLoaded = true; m._fhCh = [[{ date: '2019-01-07', level: 'atp' }], [{ date: '2019-01-07', level: 'atp' }]]; /* both histories loaded: no gap note */ m._fhCloses = [I.closes, null]; m._styleMeetLoaded = true;
      m._fhElo = { conflicts: {}, snapshots: I.snaps.map(s => ({ asOf: s.asOf, ratings: { [fhEloKey('C. Alcaraz')]: s.elo } })) };
      if (set === 'loading') { m._fhH2hData = false; m._fhH2hP = new Promise(() => {}); } else { m._fhH2hData = true; m._fhH2hP = null; }
      return true; };
    const _tp = fhTodayPair; fhTodayPair = (m) => m && m.id === fx.id ? { price: 1.54, oppPrice: 2.62, book: 'P', src: 'cap' } : _tp(m);
    return window.__h2hSet('full'); })()`);
  if (THEME === 'day' || THEME === 'night') await x.ev(`typeof maSetTheme === 'function' ? (maSetTheme(${JSON.stringify(THEME)}), true) : false`);
  await x.ev(`openAnalysisModal('ten312-fixture'), true`);
  if (THEME === 'source') await x.ev(`(() => { const ov = document.getElementById('analysisModal');
    ${JSON.stringify(Object.entries(SOURCE_TOKENS))}.forEach(([k, v]) => ov.style.setProperty(k, v));
    // every shade token = the source value in its name: --ma-s-<rrggbb>[-<alpha×1000>][-fill|-line|-ink]
    const names = new Set(); for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch (e) { continue; } for (const r of rules) { if (r.style) for (const p of r.style) if (p.startsWith('--ma-s-')) names.add(p); if (r.cssRules) for (const q of r.cssRules) if (q.style) for (const p of q.style) if (p.startsWith('--ma-s-')) names.add(p); } }
    for (const n of names) { const mm = /^--ma-s-([0-9a-f]{6})(?:-(\\d{3}))?/.exec(n); if (!mm) continue; const h = mm[1], a = mm[2] != null ? +mm[2] / 1000 : 1;
      ov.style.setProperty(n, 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')'); }
    return names.size; })()`);
  if (RULED_OFF) await x.ev(`(() => { const ov = document.getElementById('analysisModal');
    ${THEME === 'source' ? "ov.style.setProperty('--fh-pb', '#e7e9ee'); ov.style.setProperty('--court-clay', '#e8a84e'); ov.style.setProperty('--court-hard', '#4db8ff'); ov.style.setProperty('--court-grass', '#2ab8a0');" : ''}
    const h = document.createElement('style'); h.id = '__ruledOff'; h.textContent = '#aSectionH2H [data-ret-note], #aSectionH2H .ma-small-chip{ display:none !important; }'; document.head.appendChild(h); return true; })()`);
  await x.ev(`aShowTab('h2h'), true`);
  // the tab builds lazily (TEN-314 per-tab fetch): wait for the section before driving it
  for (let t = Date.now(); !(await x.ev(`!!document.querySelector('#aSectionH2H .fh-h2wrap') && typeof _fh === 'object' && !!_fh`)); ) { if (Date.now() - t > 30000) throw new Error('H2H section never built'); await sleep(250); }
  await x.ev(SETTLE);
  const man = [], leaves = {};
  for (const st of STATES) {
    if (ONLY && !ONLY.has(st.name)) continue;
    await x.ev(`(() => { fhCloseSheet(); __h2hSet(${JSON.stringify(st.set || 'full')}); fhStateFor(matches.find(z => z.id === 'ten312-fixture')).h2h = Object.assign({ surf: 'all', allLines: false, stat: null }, ${JSON.stringify(st.b)}); fhH2h({}); return true; })()`);
    await sleep(150); await x.ev(SETTLE);
    if (st.sheet) {
      await x.ev(`(() => { const el = document.querySelector('#aSectionH2H .fh-h2row'); if (!el) throw new Error('no H2H row'); el.click(); return true; })()`);
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
    if (st.hover) { const pt = await x.ev(`(() => { const g = document.querySelector('#aSectionH2H .fh-prtip'); const b = g.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 12 }; })()`); await hoverAt(x, pt); await sleep(200); await x.ev(SETTLE); }
    const clip = await x.ev(`(() => { const r = document.querySelector('#analysisModal .modal-analysis').getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: Math.round(r.width), h: Math.round(r.height) }; })()`);
    await shot(x, clip, path.join(dir, st.name + '.png'));
    leaves[st.name] = await x.ev(LEAVES(`document.getElementById('aSectionH2H')`));
    const cr = await x.ev(`(() => { const r = document.querySelector('#analysisModal .abody').getBoundingClientRect(), m = document.querySelector('#analysisModal .modal-analysis').getBoundingClientRect(); return [Math.round(r.left - m.left), Math.round(r.top - m.top), Math.round(m.width), Math.round(m.height)]; })()`);
    // `ref` + `content` = the tab pane (right of the menu, under the header): tools/ten312-pixel-diff.py --regions build/manifest.json
    man.push({ name: st.name, ref: st.name, size: [clip.w, clip.h], frame: fr, content: cr });
    if (st.hover) await hoverAt(x, { x: 1, y: 1 });
    await x.ev(B_UNFRAME);
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ servedThisCheckout: true, root: ROOT, theme: THEME, ruledOff: RULED_OFF, fixture: FIXTURE, screens: man }, null, 1));
  return { leaves };
}

async function main() {
  const dd = path.join(OUT, 'design'), bd = path.join(OUT, 'build');
  fs.mkdirSync(dd, { recursive: true }); fs.mkdirSync(bd, { recursive: true });
  const D = await designSide(dd);
  const B = await buildSide(bd, buildInputs());
  fs.writeFileSync(path.join(OUT, 'leaves.json'), JSON.stringify({ design: D.leaves, build: B.leaves }, null, 1));
  console.log('wrote', OUT);
}
main().then(() => { cleanup(); process.exit(0); }, (e) => { console.error('FAIL:', e.stack || e.message); cleanup(); process.exit(1); });
