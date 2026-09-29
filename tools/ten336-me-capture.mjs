#!/usr/bin/env node
// TEN-336 — TEST-ONLY Market edge capture for the Match analysis pixel diff (both halves in one tool). Never loaded by the
// live page and never run in CI: a manual tool, like tools/ten331-h2h-capture.mjs (whose clock, zone, viewport, raster
// flags, framing and helpers it repeats).
//
//   node tools/ten336-me-capture.mjs <outDir> [--only a,b] [--theme night|day|source]
//
// 1. Renders the LOCKED design file (needs network: React + Babel from unpkg) and captures every Market edge state below.
//    The file's Market edge draws no review switcher in its template (PALS / LAYS / pv / cv are fixed in code: 'a', 'a',
//    'cur', 'a'), so nothing is hidden. The design's view default is Derived lines (DF L3374); D3 opens ours on Match
//    winner, so every state names its view.
// 2. Serves THIS checkout's dashboard, pushes an UPCOMING demo match (Sinner 1.54 / Alcaraz 2.62, the design's prices,
//    ATP Washington = best-of-3) and hands OUR data layer the design's own generated matches (meFor `matchesFor`, read back
//    from the design page's `_meSheet` per scope) in our shard shapes: a career-history list (set scores, rounds, events),
//    a match-closes shard (the Pinnacle pair) and a market-edge profile shard (`inBasis` rows) — so the build's bands,
//    legend, chart, lines and pop-ups are computed by meRowsFor → meWinnerRows → MarketEdgeCore, not injected. The
//    design's "Last 52 weeks" sample is not date-consistent (its rows are dated 2023–25), so for the l52 states its rows
//    are re-dated, in order, into our 52-week window (only the chart's x labels show those dates; the axis is ruled, M4).
//    FIXTURE MODE LIVES ONLY HERE: nothing reaches bsp-consult-dashboard.html.
// 3. Dumps every visible text leaf of the Market edge pane on both sides → leaves.json (structure: python3
//    tools/ten330-form-structure.py <outDir>/leaves.json — the comparison is tab-agnostic).
//
// --theme source: every modal shade token set to the source value its name carries (--ma-s-<hex>[-<alpha×1000>]) and the
// role tokens to the design's source values, so the pixel diff isolates structure from the ruled palette.
// Writes <outDir>/design/*.png, <outDir>/build/*.png, <outDir>/{design,build}/manifest.json (with each card's box),
// <outDir>/leaves.json, <outDir>/design-matches.json. Per-card diff: python3 tools/ten336-card-diff.py <outDir>.
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
if (!OUT) { console.error('usage: node tools/ten336-me-capture.mjs <outDir> [--only a,b] [--theme night|day|source]'); process.exit(2); }
const FROZEN_NOW = Date.parse('2026-09-28T12:19:30+08:00');
const TZ = 'Asia/Makassar';
const VIEW_W = 1370, VIEW_H = 745, FIT_H = 760, POP_W = 1001;

// Every Market edge state: design state patch (d, maTab added) ↔ our _me.S patch (b). sc = the data scope fed.
// Pop-ups: a2 = Sinner's today band (1.54 → 1.41–1.64, the TODAY'S BAND chip), b4 = an Alcaraz underdog band that is not
// today's (2.00–2.49); a|0 = Sinner "Wins match" over all matches, b|2 = Alcaraz "Wins a set" in today's band.
const STATES = [
  { name: '12-me-winner', d: { meView: 'winner' }, b: { meView: 'winner' } },
  { name: '12b-me-winner-l52', d: { meView: 'winner', meScope: 'l52' }, b: { meView: 'winner', meScope: 'l52' }, sc: 'l52' },
  { name: '12c-me-lines', d: { meView: 'lines' }, b: { meView: 'lines' } },
  { name: '12d-me-lines-l52', d: { meView: 'lines', meScope: 'l52' }, b: { meView: 'lines', meScope: 'l52' }, sc: 'l52' },
  { name: 'P12-me-band-today', d: { meView: 'winner', meBand: 'a2' }, b: { meView: 'winner', meBand: 'a2' }, pop: true },
  { name: 'P12b-me-band-dog', d: { meView: 'winner', meBand: 'b4' }, b: { meView: 'winner', meBand: 'b4' }, pop: true },
  { name: 'P12c-me-line-all', d: { meView: 'lines', meLine: 'a|0', meLineScope: 'all' }, b: { meView: 'lines', meLine: 'a|0', meLineScope: 'all' }, pop: true },
  { name: 'P12d-me-line-band', d: { meView: 'lines', meLine: 'b|2', meLineScope: 'band' }, b: { meView: 'lines', meLine: 'b|2', meLineScope: 'band' }, pop: true },
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

// The pane's cards (radius 14) as modal-relative boxes: the per-card diff aligns each card on its own origin, so a ruled
// height change above one card (the TEN-325 footnote line) doesn't count against the card below it.
const CARDS = (rootExpr, modalExpr) => `(() => { const root = ${rootExpr}, m = ${modalExpr}.getBoundingClientRect();
  return [...root.querySelectorAll('div')].filter(d => getComputedStyle(d).borderTopLeftRadius === '14px' && d.getClientRects().length)
    .map(d => { const r = d.getBoundingClientRect(); return [Math.round(r.left - m.left), Math.round(r.top - m.top), Math.round(r.right - m.left), Math.round(r.bottom - m.top)]; }); })()`;
// ---------------------------------------------------------------------------------------------------------------
// DESIGN side (helpers = tools/ten330-form-capture.mjs D_HELPERS)
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
  // the design's generated matches, per scope (meFor → matchesFor → this._meSheet)
  const sheets = {};
  for (const sc of ['career', 'l52']) {
    await x.ev(`__cap.reset()`); await x.ev(`__cap.set(${JSON.stringify({ maTab: 'Market edge', meView: 'winner', meScope: sc })})`);
    sheets[sc] = await x.ev(`(__cap.host().logic._meSheet || []).map(m => ({ mid: m.mid, opp: m.opp, tourn: m.tourn, round: m.round, date: m.date, won: m.won, price: +m.price, oppPrice: +m.oppPrice, setArr: m.setArr }))`);
    if (!sheets[sc].length) throw new Error('no design matches for ' + sc);
  }
  const man = [], leaves = {};
  for (const st of STATES) {
    if (ONLY && !ONLY.has(st.name)) continue;
    await x.ev(`__cap.reset()`); await x.ev(`__cap.set(${JSON.stringify(Object.assign({ maTab: 'Market edge' }, st.d))})`); await x.ev(SETTLE);
    if (st.pop) { await x.ev(`__cap.framePop()`); await sleep(100); await x.ev(SETTLE); const clip = await x.ev(`__cap.clipPop()`); await shot(x, clip, path.join(dir, st.name + '.png'));
      leaves[st.name] = await x.ev(LEAVES(`document.querySelector('[data-cap-box]')`)); man.push({ name: st.name, size: [clip.w, clip.h] }); await x.ev(`__cap.unframe()`); continue; }
    const fr = await x.ev(`__cap.frameModal(1296)`); await sleep(100); await x.ev(SETTLE);
    const clip = await x.ev(`__cap.clipModal()`);
    await shot(x, clip, path.join(dir, st.name + '.png'));
    leaves[st.name] = await x.ev(LEAVES(`__cap.formRoot()`));
    const cr = await x.ev(`(() => { const r = __cap.formRoot().getBoundingClientRect(), m = document.querySelector('[data-cap-modal]').getBoundingClientRect(); return [Math.round(r.left - m.left), Math.round(r.top - m.top), Math.round(r.right - m.left), Math.round(r.bottom - m.top)]; })()`);
    const cards = await x.ev(CARDS(`__cap.formRoot()`, `document.querySelector('[data-cap-modal]')`));
    man.push({ name: st.name, size: [clip.w, clip.h], frame: fr, content: cr, cards });
    await x.ev(`__cap.unframe()`);
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ design: path.join(HANDOFF, DESIGN), reviewSwitcherHidden: false, screens: man }, null, 1));
  return { leaves, sheets };
}

// ---------------------------------------------------------------------------------------------------------------
// BUILD side
const FIXTURE = { id: 'ten336-fixture', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: '900001', p2Key: '900002', date: '2026-07-20',
  tour: 'ATP Washington', tournament: 'ATP Washington', tournamentRound: 'ATP Washington - Quarter-finals', tourBadge: 'ATP', surface: 'Hard',
  startTs: '2026-07-20T22:00:00Z', bestOdds: { p1: { price: 1.54 }, p2: { price: 2.62 } } };
const RD = { R128: '1/64-finals', R64: '1/32-finals', R32: '1/16-finals', R16: '1/8-finals', QF: 'Quarter-finals', SF: 'Semi-finals', F: 'Final' };
const TD_RD = { R32: '2nd Round', R16: '3rd Round', QF: 'Quarterfinals', SF: 'Semifinals', F: 'The Final' };
const isoOf = (dmy) => { const [d, m, y] = dmy.split('.'); return '20' + y + '-' + m + '-' + d; };
const addDays = (iso, k) => new Date(Date.parse(iso + 'T00:00:00Z') + k * 86400000).toISOString().slice(0, 10);
const tdName = (n) => { const p = n.split(' '); return p.slice(1).join(' ') + ' ' + p[0]; };   // "A. Rinderknech" → "Rinderknech A."
// One scope's design matches → per player: the career-history list, the match-closes shard and the market-edge shard.
function buildInputs(sheet, sc) {
  const out = {};
  for (const [k, key] of [['a', FIXTURE.p1Key], ['b', FIXTURE.p2Key]]) {
    let ms = sheet.filter((m) => m.mid.startsWith('me|' + k + '|')).map((m) => Object.assign({}, m, { iso: isoOf(m.date) }));
    if (sc === 'l52') ms = ms.sort((u, v) => (u.iso < v.iso ? 1 : u.iso > v.iso ? -1 : 0)).map((m, i) => Object.assign(m, { iso: addDays(FIXTURE.date, -2 - i * 3) }));
    // The page joins a career row to its close by opponent + result within ±1 day (meRowFromCareer), so two design rows
    // with the same opponent and result a day apart would both go unpriced: move the later one on by 3 days (a few
    // pop-up dates differ from the design's; the counts then agree).
    const seen = [];
    for (const m of ms) { while (seen.some((o) => o.opp === m.opp && o.won === m.won && Math.abs(Date.parse(o.iso) - Date.parse(m.iso)) <= 2 * 86400000)) m.iso = addDays(m.iso, 3); seen.push(m); }
    const career = ms.map((m, i) => { const pS = m.setArr.filter((s) => s[0] > s[1]).length;
      return { date: m.iso, level: 'atp', tournament: m.tourn, round: RD[m.round], surface: 'hard', opponent: m.opp, result: pS + ' - ' + (m.setArr.length - pS),
        won: m.won, eventKey: (k === 'a' ? 9300000 : 9400000) + i, src: 'fixtures', bestOf: 3, sets: m.setArr.map((s) => ({ p: s[0], o: s[1] })) }; });
    const closes = { rows: ms.map((m) => [m.iso, tdName(m.opp), m.won ? 1 : 0, Math.round(m.price * 1000) / 1000, Math.round(m.oppPrice * 1000) / 1000, null, null, 0, null]), cap: [] };
    const shard = { matches: ms.map((m) => ({ date: m.iso, event: m.tourn, surface: 'Hard', round: TD_RD[m.round], opp: tdName(m.opp), won: m.won,
      price: Math.round(m.price * 1000) / 1000, oppPrice: Math.round(m.oppPrice * 1000) / 1000, book: 'pinnacle', inBasis: true })) };
    out[key] = { career, closes, shard };
  }
  return out;
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

async function buildSide(dir, sheets) {
  const I = { career: buildInputs(sheets.career, 'career'), l52: buildInputs(sheets.l52, 'l52') };
  const x = await browser(ROOT, 'bsp-consult-dashboard.html', `var _b; Object.defineProperty(window, 'BSP', { configurable: true, get() { return _b; }, set(v) { if (v) { const u = Promise.resolve({ emailVerified: true }); v.requireVerified = () => u; v.requireAuth = () => u; } _b = v; } });`);
  const t0 = Date.now();
  while (!(await x.ev(`typeof matches === 'object' && Array.isArray(matches) && typeof openAnalysisModal === 'function' && typeof aShowTab === 'function'`).catch(() => false))) { if (Date.now() - t0 > 90000) throw new Error('dashboard did not boot'); await sleep(300); }
  await x.ev(`document.fonts.ready.then(() => true)`);
  const served = await x.ev(`typeof mePopTable === 'function' && typeof meRowsHtml === 'undefined'`);
  if (!served) throw new Error('the page served is not this checkout (no mePopTable)');
  // the fixture match (held in window.__fx: the board refresh replaces \`matches\` mid-capture) + the data for one scope,
  // seeded into the three per-player caches the tab reads (career-history, match-closes, market-edge)
  await x.ev(`(() => { const fx = ${JSON.stringify(FIXTURE)}; window.__fx = fx; window.__meI = ${JSON.stringify(I)};
    const put = () => { const i = matches.findIndex(m => m.id === fx.id); if (i >= 0) matches.splice(i, 1); matches.push(fx); };
    window.__meSet = (sc) => { put(); const D = window.__meI[sc];
      for (const k of Object.keys(D)) { _careerHistoryShards[k] = D[k].career; _fhCl[k] = fhParseCloses(D[k].closes); _meShard[k] = D[k].shard; delete _meShardP[k]; }
      _me = null; return true; };
    return window.__meSet('career'); })()`);
  if (THEME === 'day' || THEME === 'night') await x.ev(`typeof maSetTheme === 'function' ? (maSetTheme(${JSON.stringify(THEME)}), true) : false`);
  await x.ev(`openAnalysisModal('ten336-fixture'), true`);
  if (THEME === 'source') await x.ev(`(() => { const ov = document.getElementById('analysisModal');
    ${JSON.stringify(Object.entries(SOURCE_TOKENS))}.forEach(([k, v]) => ov.style.setProperty(k, v));
    const names = new Set(); for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch (e) { continue; } for (const r of rules) { if (r.style) for (const p of r.style) if (p.startsWith('--ma-s-')) names.add(p); if (r.cssRules) for (const q of r.cssRules) if (q.style) for (const p of q.style) if (p.startsWith('--ma-s-')) names.add(p); } }
    for (const n of names) { const mm = /^--ma-s-([0-9a-f]{6})(?:-(\\d{3}))?/.exec(n); if (!mm) continue; const h = mm[1], a = mm[2] != null ? +mm[2] / 1000 : 1;
      ov.style.setProperty(n, 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')'); }
    return names.size; })()`);
  await x.ev(`aShowTab('marketedge'), true`);
  const man = [], leaves = {};
  for (const st of STATES) {
    if (ONLY && !ONLY.has(st.name)) continue;
    await x.ev(`(() => { fhCloseSheet(); __meSet(${JSON.stringify(st.sc || 'career')}); meLoad(window.__fx); return true; })()`);
    for (let t = Date.now(); !(await x.ev(`!!_me && _me.state[0] === 'ready' && _me.state[1] === 'ready'`)); ) { if (Date.now() - t > 30000) throw new Error('Market edge never loaded: ' + await x.ev('JSON.stringify(_me && _me.state)')); await sleep(200); }
    await x.ev(`(() => { meSet(${JSON.stringify(st.b)}); return true; })()`);
    await sleep(150); await x.ev(SETTLE);
    if (st.pop) {
      const clip = await x.ev(`(() => { const ps = document.querySelector('#mePop .ma-pop-overlay'); if (!ps) throw new Error('no pop-up'); const box = ps.firstElementChild;
        window.__saved = [document.documentElement, document.body, ps, box].map(e => [e, e.getAttribute('style')]);
        const st = (e, css) => e.setAttribute('style', (e.getAttribute('style') || '') + ';' + css);
        st(document.documentElement, 'background:transparent !important;'); st(document.body, 'background:transparent !important;');
        if (!document.getElementById('__capHide2')) { const h = document.createElement('style'); h.id = '__capHide2'; h.textContent = 'body > *:not(#analysisModal){ visibility:hidden !important; } #analysisModal .modal-analysis > *:not(#mePop){ visibility:hidden !important; } #analysisModal{ background:transparent !important; backdrop-filter:none !important; } #analysisModal .modal-analysis{ background:transparent !important; border-color:transparent !important; box-shadow:none !important; }'; document.head.appendChild(h); }
        st(ps, 'position:absolute !important; inset:auto !important; left:0 !important; top:0 !important; width:${POP_W}px !important; height:auto !important; overflow:visible !important; padding-top:24px !important; padding-bottom:24px !important;');
        box.setAttribute('data-cap-box', '1');
        const r = ps.getBoundingClientRect(), br = box.getBoundingClientRect(); return { x: r.left + scrollX, y: br.top - 24 + scrollY, w: Math.round(r.width), h: Math.round(br.height + 48) }; })()`);
      await sleep(100); await x.ev(SETTLE);
      await shot(x, clip, path.join(dir, st.name + '.png')); man.push({ name: st.name, ref: st.name, size: [clip.w, clip.h] });
      leaves[st.name] = await x.ev(LEAVES(`document.querySelector('[data-cap-box]')`));
      await x.ev(`(() => { for (const [e, s] of window.__saved) { if (s == null) e.removeAttribute('style'); else e.setAttribute('style', s); } document.getElementById('__capHide2').remove(); meSet({ meBand: null, meLine: null }); return true; })()`);
      continue;
    }
    const fr = await x.ev(B_FRAME); await sleep(100); await x.ev(SETTLE);
    const clip = await x.ev(`(() => { const r = document.querySelector('#analysisModal .modal-analysis').getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: Math.round(r.width), h: Math.round(r.height) }; })()`);
    await shot(x, clip, path.join(dir, st.name + '.png'));
    leaves[st.name] = await x.ev(LEAVES(`document.getElementById('aSectionMarketEdge')`));
    const cr = await x.ev(`(() => { const r = document.querySelector('#analysisModal .abody').getBoundingClientRect(), m = document.querySelector('#analysisModal .modal-analysis').getBoundingClientRect(); return [Math.round(r.left - m.left), Math.round(r.top - m.top), Math.round(m.width), Math.round(m.height)]; })()`);
    const cards = await x.ev(CARDS(`document.getElementById('aSectionMarketEdge')`, `document.querySelector('#analysisModal .modal-analysis')`));
    man.push({ name: st.name, ref: st.name, size: [clip.w, clip.h], frame: fr, content: cr, cards });
    await x.ev(B_UNFRAME);
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ servedThisCheckout: true, root: ROOT, theme: THEME, fixture: FIXTURE, screens: man }, null, 1));
  return { leaves };
}

async function main() {
  const dd = path.join(OUT, 'design'), bd = path.join(OUT, 'build');
  fs.mkdirSync(dd, { recursive: true }); fs.mkdirSync(bd, { recursive: true });
  const D = await designSide(dd);
  fs.writeFileSync(path.join(OUT, 'design-matches.json'), JSON.stringify(D.sheets));
  const B = await buildSide(bd, D.sheets);
  fs.writeFileSync(path.join(OUT, 'leaves.json'), JSON.stringify({ design: D.leaves, build: B.leaves }, null, 1));
  console.log('wrote', OUT);
}
main().then(() => { cleanup(); process.exit(0); }, (e) => { console.error('FAIL:', e.stack || e.message); cleanup(); process.exit(1); });
