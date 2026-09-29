#!/usr/bin/env node
// TEN-330 — TEST-ONLY Form-tab capture for the Match analysis pixel diff (both halves in one tool). Never loaded by
// the live page and never run in CI: a manual tool, like tools/ten312-design-capture.mjs / ten312-build-capture.mjs,
// whose clock, zone, viewport, raster flags and framing it repeats.
//
//   node tools/ten330-form-capture.mjs <outDir> [--only a,b] [--theme night|day|source]
//
// 1. Renders the LOCKED design file (needs network: React + Babel from unpkg), reads the design's own Form rows for
//    both players out of its `formFor` (every row: maFormN 999, all surfaces) and captures every Form state below.
// 2. Serves THIS checkout's dashboard, pushes the design's demo match (ten312-build-capture FIXTURE) and hands the
//    Form builder the design's rows in our data shapes — form-shard rows, match-closes rows (Pinnacle pair = the
//    design's unrounded prices), an elo-history built so each snapshot holds the design's Elo — then captures the
//    same states. FIXTURE MODE LIVES ONLY HERE: nothing reaches bsp-consult-dashboard.html.
// 3. Dumps every visible text leaf of the Form section (text, box, font size/weight) on both sides → leaves.json,
//    the structural comparison (tools/ten330-form-structure.py).
//
// --theme source: our build with the modal tokens set to the design's own source values for this tab (the README §3
// table read backwards, one source value per token), so the pixel diff isolates structure from the ruled palette.
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
if (!OUT) { console.error('usage: node tools/ten330-form-capture.mjs <outDir> [--only a,b] [--theme night|day|source]'); process.exit(2); }
const FROZEN_NOW = Date.parse('2026-09-28T12:19:30+08:00');
const TZ = 'Asia/Makassar';
const VIEW_W = 1370, VIEW_H = 745, FIT_H = 760, POP_W = 1001;

// Every Form state: design state patch ↔ our fhForm patch. `hover` = the last bar of player A (the tooltip);
// `sheet` = click the row dated 18.07. (Sinner v Griekspoor, Washington R16 — the design capture's FORM_SHEET).
const STATES = [
  { name: '06-form', d: {}, b: {} },
  { name: '06b-form-data-and-hot-lines-open', d: { maFormCard: true, maFormHot: true }, b: { card: true, hot: true } },
  { name: '06c-form-all-lines', d: { maFormCard: true, maFormHot: true, maFormHotAll0: true, maFormHotAll1: true }, b: { card: true, hot: true, hotAll: [true, true] } },
  { name: '06d-form-days-30', d: { maFormWin: 'd' }, b: { wmode: 'd' } },
  { name: '06e-form-as-underdog', d: { maFormRole: 'dog' }, b: { role: 'dog' } },
  { name: '06f-form-all-surfaces-last-20-more', d: { maFormSurf: 'all', maFormN: 20, maFormMore0: true, maFormMore1: true }, b: { surf: 'all', n: 20, more: [true, true] } },
  { name: '06g-form-clay-last-5-data', d: { maFormSurf: 'Clay', maFormN: 5, maFormCard: true }, b: { surf: 'Clay', n: 5, card: true } },
  { name: '06h-form-bar-tooltip', d: {}, b: {}, hover: true },
  { name: 'P1-form-match-stats-sheet', d: {}, b: {}, sheet: '18.07.', pop: true },
];
// The design's source value per token, for --theme source (README §3 read backwards; the Form tab's own uses).
const SOURCE_TOKENS = { '--ma-page': '#0a0d14', '--ma-card': '#0a0d14', '--ma-inner': '#06070a', '--ma-raised': '#11151f', '--ma-hover': 'rgba(255,255,255,0.03)',
  '--ma-sel': 'rgba(91,155,255,0.16)', '--ma-hair': 'rgba(255,255,255,0.09)', '--ma-hair-soft': 'rgba(255,255,255,0.04)', '--ma-hair-strong': 'rgba(255,255,255,0.12)',
  '--ma-outline': 'rgba(91,155,255,0.22)', '--ma-t1': '#e7e9ee', '--ma-t2': '#8b96b5', '--ma-t3': '#5b6880', '--ma-fill': '#5b9bff', '--ma-link': '#5b9bff',
  '--ma-pos': '#3dd68c', '--ma-neg': '#e0616f', '--ma-track': 'rgba(255,255,255,0.07)' };

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
// DESIGN side (helpers = tools/ten312-design-capture.mjs HELPERS, trimmed to what the Form states use)
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
  // The design's own Form rows, every one, both players (NWIN 999, all surfaces).
  const data = await x.ev(`(() => { const L = __cap.host().logic; const AN = L.mkAnalysis(L.props.match || L.demoMatch(), 1.54, 2.62);
    const f = L.formFor(AN, Object.assign({}, L.state, { maFormN: 999, maFormSurf: 'all', maFormRole: 'all', maFormWin: 'n', maFormMore0: true, maFormMore1: true }));
    return { surface: AN.surface, players: f.players.map(p => ({ name: p.name, rows: p.entries.filter(e => e.isRow).map(e => { const m = e.m;
      return { date: m.date, ago: m.ago, tourn: m.tourn, surface: m.surface, round: m.round, opp: m.opp, oppElo: +m.oppElo, won: m.won, price: m.priceNum, oppPrice: m.oppNum, sets: m.setArr }; }) })) }; })()`);
  fs.writeFileSync(path.join(OUT, 'design-form-data.json'), JSON.stringify(data, null, 1));
  const man = [], leaves = {};
  for (const st of STATES) {
    if (ONLY && !ONLY.has(st.name)) continue;
    await x.ev(`__cap.reset()`); await x.ev(`__cap.set(${JSON.stringify(Object.assign({ maTab: 'Form' }, st.d))})`); await x.ev(SETTLE);
    if (st.sheet) { await x.ev(`__cap.click(${JSON.stringify(st.sheet)})`); await x.ev(SETTLE); }
    if (st.pop) { await x.ev(`__cap.framePop()`); await sleep(100); await x.ev(SETTLE); const clip = await x.ev(`__cap.clipPop()`); await shot(x, clip, path.join(dir, st.name + '.png')); man.push({ name: st.name, size: [clip.w, clip.h] }); await x.ev(`__cap.unframe()`); continue; }
    const fr = await x.ev(`__cap.frameModal(1296)`); await sleep(100); await x.ev(SETTLE);
    if (st.hover) { await hoverAt(x, await x.ev(`__cap.lastBarA()`)); await sleep(200); await x.ev(SETTLE); }
    const clip = await x.ev(`__cap.clipModal()`);
    await shot(x, clip, path.join(dir, st.name + '.png'));
    leaves[st.name] = await x.ev(LEAVES(`__cap.formRoot()`));
    man.push({ name: st.name, size: [clip.w, clip.h], frame: fr });
    if (st.hover) await hoverAt(x, { x: 1, y: 1 });
    await x.ev(`__cap.unframe()`);
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ design: path.join(HANDOFF, DESIGN), screens: man }, null, 1));
  return { data, leaves };
}

// ---------------------------------------------------------------------------------------------------------------
// BUILD side
const FIXTURE = { id: 'ten312-fixture', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: null, p2Key: null, date: '2026-07-20',
  tour: 'ATP Washington', tournament: 'ATP Washington', tournamentRound: 'ATP Washington - Quarter-finals', surface: 'Hard',
  startTs: '2026-07-20T22:00:00Z', bestOdds: { p1: { price: 1.54 }, p2: { price: 2.62 } },
  finalScore: { display: '6-4, 4-6, 7-6', sets: [{ p1: 6, p2: 4 }, { p1: 4, p2: 6 }, { p1: 7, p2: 6 }], p1Sets: 2, p2Sets: 1, winner: 'p1' } };
const RD = { R128: '1/64-finals', R64: '1/32-finals', R32: '1/16-finals', R16: '1/8-finals', QF: 'Quarter-finals', SF: 'Semi-finals', F: 'Final' };
const PLAN = { 'J. Sinner': { elo: 2241, drift: 0.9 }, 'C. Alcaraz': { elo: 2218, drift: -0.5 } };   // DF L4625–4626
const iso = (ddmm) => { const [d, m] = ddmm.split('.'); return `2026-${m}-${d}`; };
const feedName = (n) => { const i = n.lastIndexOf(' '); return n.slice(i + 1) + ' ' + n.slice(0, i); };      // "Nardi L." → "L. Nardi"
const dayIso = (s, k) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + k)).toISOString().slice(0, 10);
function buildInputs(data) {
  const REF = Date.UTC(2026, 6, 20);
  const agoOf = (isoD) => Math.round((REF - Date.parse(isoD + 'T00:00:00Z')) / 86400000);
  const eloAt = (P, ag) => Math.round(P.elo - P.drift * ag / 7 + 5 * Math.sin(ag / 11));     // DF L4681
  const rows = data.players.map((p, pi) => p.rows.map((r, i) => {
    const pS = r.sets.filter(s => s[0] > s[1]).length;
    return { opponent: feedName(r.opp), opponentKey: null, date: iso(r.date), tournament: r.tourn, round: RD[r.round] || r.round, surface: r.surface.toLowerCase(),
      result: pS + ' - ' + (r.sets.length - pS), won: r.won, sets: r.sets.map(s => ({ p: s[0], o: s[1] })), retired: false, walkover: false, qualifying: false,
      tier: 'atp', eventKey: 9000000 + pi * 1000 + i };
  }));
  const closes = data.players.map((p) => ({ rows: p.rows.map(r => ({ date: iso(r.date), opp: feedName(r.opp), won: r.won, P: [r.price, r.oppPrice], B: null, ret: false, oppKey: null })), cap: [] }));
  // snapshots: one the day before every match day (and before the analysed match), each holding every opponent's
  // design Elo and each player's design Elo on that match day.
  const days = new Set(['2026-07-20']); data.players.forEach(p => p.rows.forEach(r => days.add(iso(r.date))));
  const opps = {}; data.players.forEach(p => p.rows.forEach(r => { opps[feedName(r.opp)] = r.oppElo; }));
  const snaps = [...days].sort().map(d => ({ asOf: dayIso(d, -1), forDay: d, opps, own: Object.fromEntries(data.players.map(p => [p.name, eloAt(PLAN[p.name], agoOf(d))])) }));
  return { rows, closes, snaps };
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

async function buildSide(dir, inputs) {
  const x = await browser(ROOT, 'bsp-consult-dashboard.html', `var _b; Object.defineProperty(window, 'BSP', { configurable: true, get() { return _b; }, set(v) { if (v) { const u = Promise.resolve({ emailVerified: true }); v.requireVerified = () => u; v.requireAuth = () => u; } _b = v; } });`);
  const t0 = Date.now();
  while (!(await x.ev(`typeof matches === 'object' && Array.isArray(matches) && typeof openAnalysisModal === 'function' && typeof aShowTab === 'function'`).catch(() => false))) { if (Date.now() - t0 > 90000) throw new Error('dashboard did not boot'); await sleep(300); }
  await x.ev(`document.fonts.ready.then(() => true)`);
  // fixture match + the design's Form rows in our shapes (form shards, parsed match-closes, elo-history)
  await x.ev(`(() => { const fx = ${JSON.stringify(FIXTURE)}, I = ${JSON.stringify(inputs)};
    const i = matches.findIndex(m => m.id === fx.id); if (i >= 0) matches.splice(i, 1); matches.push(fx);
    fx.p1RecentFormMatches = I.rows[0]; fx.p2RecentFormMatches = I.rows[1]; fx._formLoaded = true;
    fx._fhFormRows = I.rows; fx._fhFormSrc = ['form', 'form']; fx._fhCloses = I.closes;
    fx._fhElo = { conflicts: {}, snapshots: I.snaps.map(s => { const ratings = {}; for (const n in s.opps) ratings[fhEloKey(n)] = s.opps[n]; for (const n in s.own) ratings[fhEloKey(n)] = s.own[n]; return { asOf: s.asOf, ratings }; }) };
    fx._fhFormData = true; return true; })()`);
  if (THEME === 'day' || THEME === 'night') await x.ev(`typeof maSetTheme === 'function' ? (maSetTheme(${JSON.stringify(THEME)}), true) : false`);
  await x.ev(`openAnalysisModal('ten312-fixture'), true`);
  if (THEME === 'source') await x.ev(`(() => { const ov = document.getElementById('analysisModal'); ${JSON.stringify(Object.entries(SOURCE_TOKENS))}.forEach(([k, v]) => ov.style.setProperty(k, v)); return true; })()`);
  const served = await x.ev(`!!document.querySelector('#analysisModal .aclosecell') && typeof fhFormSetScores === 'function'`);
  if (!served) throw new Error('the page served is not this checkout (no fhFormSetScores)');
  await x.ev(`aShowTab('form'), true`); await sleep(600); await x.ev(SETTLE);
  const man = [], leaves = {};
  for (const st of STATES) {
    if (ONLY && !ONLY.has(st.name)) continue;
    await x.ev(`(() => { fhCloseSheet(); _fh.form = Object.assign({ surf: 'Hard', role: 'all', wmode: 'n', n: 10, days: 30, card: false, hot: false, hotAll: [false, false], more: [false, false] }, ${JSON.stringify(st.b)}); fhForm({}); return true; })()`);
    await x.ev(SETTLE);
    if (st.sheet) {
      await x.ev(`(() => { const el = [...document.querySelectorAll('#aSectionForm .fh-frow')].find(e => e.firstElementChild && e.firstElementChild.textContent.trim() === ${JSON.stringify(st.sheet)}); if (!el) throw new Error('no row ${st.sheet}'); el.click(); return true; })()`);
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
      await shot(x, clip, path.join(dir, st.name + '.png')); man.push({ name: st.name, size: [clip.w, clip.h] });
      await x.ev(`(() => { for (const [e, s] of window.__saved) { if (s == null) e.removeAttribute('style'); else e.setAttribute('style', s); } document.getElementById('__capHide2').remove(); fhCloseSheet(); return true; })()`);
      continue;
    }
    const fr = await x.ev(B_FRAME); await sleep(100); await x.ev(SETTLE);
    if (st.hover) { const pt = await x.ev(`(() => { const c = document.getElementById('aSectionForm'); const R = c.getBoundingClientRect(); const bars = [...c.querySelectorAll('.fh-bar')].filter(b => b.getBoundingClientRect().left < R.left + R.width / 2); const b = bars[bars.length - 1].getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 8 }; })()`); await hoverAt(x, pt); await sleep(200); await x.ev(SETTLE); }
    const clip = await x.ev(`(() => { const r = document.querySelector('#analysisModal .modal-analysis').getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: Math.round(r.width), h: Math.round(r.height) }; })()`);
    await shot(x, clip, path.join(dir, st.name + '.png'));
    leaves[st.name] = await x.ev(LEAVES(`document.getElementById('aSectionForm')`));
    man.push({ name: st.name, size: [clip.w, clip.h], frame: fr });
    if (st.hover) await hoverAt(x, { x: 1, y: 1 });
    await x.ev(B_UNFRAME);
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ servedThisCheckout: true, root: ROOT, theme: THEME, fixture: FIXTURE, screens: man }, null, 1));
  return { leaves };
}

async function main() {
  const dd = path.join(OUT, 'design'), bd = path.join(OUT, 'build');
  fs.mkdirSync(dd, { recursive: true }); fs.mkdirSync(bd, { recursive: true });
  const D = await designSide(dd);
  const B = await buildSide(bd, buildInputs(D.data));
  fs.writeFileSync(path.join(OUT, 'leaves.json'), JSON.stringify({ design: D.leaves, build: B.leaves }, null, 1));
  console.log('wrote', OUT);
}
main().then(() => { cleanup(); process.exit(0); }, (e) => { console.error('FAIL:', e.stack || e.message); cleanup(); process.exit(1); });
