#!/usr/bin/env node
// TEN-340 — TEST-ONLY Playing-style capture for the Match analysis pixel diff (both halves in one tool). Never loaded by
// the live page and never run in CI: a manual tool, like tools/ten339-progression-capture.mjs (whose clock, zone,
// viewport, raster flags, framing and helpers it repeats).
//
//   node tools/ten340-playing-style-capture.mjs <outDir> [--only a,b] [--theme night|day|source] [--hide-gaps]
//
// 1. Renders the LOCKED design file (needs network: React + Babel from unpkg) and captures every Playing style state below.
//    The file's "SAMPLE" chip (DF L499) is hidden before each capture: a review marker, not a designed element (DoD item 4).
// 2. Serves THIS checkout's dashboard, pushes the design's demo match (J. Sinner v C. Alcaraz, ATP Washington, Hard) and
//    hands the Playing style builder the design's own demo values — DF ps2For read on the committed file: both
//    archetypes, the Counterpuncher v Attacking Baseliner cell and its three surfaces, the two personal records (26–24,
//    10–23) with the file's 8 meeting rows each at the head of the list, and the five DNA axes (raw, percentile, Δ) — in
//    our shapes (ppStyleFor, psMatrixData, the meeting shards on the match, _mdna, ppEloForSurface), then captures the
//    same states. FIXTURE MODE LIVES ONLY HERE: nothing reaches bsp-consult-dashboard.html.
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
// --hide-gaps: hide the build's DESIGN GAP G18 control ("Show N more matches", which the file does not draw) so a diff
// measures everything else; the default capture keeps it (what ships).
const HIDE_GAPS = args.includes('--hide-gaps');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!OUT) { console.error('usage: node tools/ten340-playing-style-capture.mjs <outDir> [--only a,b] [--theme night|day|source]'); process.exit(2); }
const FROZEN_NOW = Date.parse('2026-09-28T12:19:30+08:00');
const TZ = 'Asia/Makassar';
const VIEW_W = 1370, VIEW_H = 745, FIT_H = 760, POP_W = 1001;

// Every designed Playing style state (README §5.3 screens 05 / 05b, §7 state keys psMeetA / psMeetB / psProf / psDnaWin)
// and the meeting row's match stats pop-up (DF L3646: a row opens maFormSheet).
const STATES = [
  { name: '05-playing-style', d: {}, b: {} },
  { name: '05b-playing-style-meetings-profile-open', d: { psMeetA: true, psMeetB: true, psProf: true }, b: { meetA: true, meetB: true, prof: true } },
  { name: '05c-playing-style-dna-since-mar-2024', d: { psDnaWin: 'career', psProf: true }, b: { win: 'since', prof: true } },
  { name: '05d-playing-style-meeting-sheet', d: { psMeetA: true, maFormSheet: 'ps|a|0' }, b: { meetA: true }, sheet: true, pop: true },
];
// Source value of a role token (README §3 read backwards) for --theme source; the shade tokens carry theirs in their names.
const SOURCE_TOKENS = { '--ma-page': '#0a0d14', '--ma-card': '#0a0d14', '--ma-inner': '#06070a', '--ma-raised': '#11151f', '--ma-hover': 'rgba(255,255,255,0.03)',
  '--ma-sel': 'rgba(91,155,255,0.16)', '--ma-hair': 'rgba(255,255,255,0.09)', '--ma-hair-soft': 'rgba(255,255,255,0.05)', '--ma-hair-strong': 'rgba(255,255,255,0.14)',
  '--ma-outline': 'rgba(91,155,255,0.22)', '--ma-t1': '#e7e9ee', '--ma-t2': '#8b96b5', '--ma-t3': '#5b6880', '--ma-fill': '#5b9bff', '--ma-link': '#5b9bff',
  '--ma-pos': '#3dd68c', '--ma-neg': '#e0616f', '--ma-track': 'rgba(255,255,255,0.08)', '--ma-pb-fill': 'rgba(231,233,238,0.7)' };

// The design's demo values, read from DF ps2For on the committed file (the rows, the records, the DNA tables).
function designModel() {
  const dc = fs.readFileSync(path.join(HANDOFF, DESIGN), 'utf8');
  const a = dc.indexOf('  ps2For(AN, S) {'), b = dc.indexOf('\n  playingStyleFor(AN, S) {', a);
  if (a < 0 || b < 0) throw new Error('DF ps2For() not found');
  const src = dc.slice(a, b);
  const grab = (re) => { const m = re.exec(src); if (!m) throw new Error('DF value not found: ' + re); return m[1]; };
  const rows = (k) => eval(grab(new RegExp('const ' + k + ' = (\\[[\\s\\S]*?\\n    \\]);')));
  const surf = eval(grab(/const surfaces = (\[\[[^\]]*\][^;]*?\]\])\.map/));
  const dna52 = eval(grab(/: (\[\['Serve', 58, 62\][^\n]*?\]\]);/));
  const dnaSince = eval(grab(/\? (\[\['Serve', 54, 66\][^\n]*?\]\])\n/));
  const dnav52 = eval(grab(/: (\[\['267', '270'\][^\n]*?\]\]);/));
  const r52 = [...grab(/\] : \[\n([\s\S]*?)\n    \];\n    const dnaTabs/).matchAll(/mkRow\('([^']+)', '([^']+)', ([^,]+), (\d+), '([^']+)', ([^,]+), (\d+)\)/g)];
  return { A_ROWS: rows('A_ROWS'), B_ROWS: rows('B_ROWS'), surfaces: surf, dna52, dnaSince, dnav52,
    deltas: r52.map(m => [m[3] === 'null' ? null : +m[3], m[6] === 'null' ? null : +m[6]]) };
}
// DF row [tourn, meta, 'DD.MM.', opp, round, won, sets, 'set scores', own, opp] → a style-meetings shard row (subject-first
// result, ISO date in 2025 — the file's year, DF L3635), plus older filler rows so the record reproduces the file's W–L.
function shardRows(R, w, l) {
  const sfOf = (meta) => meta.split(' · ')[0].toLowerCase();
  const head = R.map(r => ({ won: !!r[5], opponent: r[3], surface: sfOf(r[1]), tournament: r[0],
    result: r[7].split(',').map(x => x.trim()).join(' '), date: '2025-' + r[2].slice(3, 5) + '-' + r[2].slice(0, 2), round: r[4],
    oddsSelf: r[8] === '—' ? null : +r[8], oddsOpp: r[9] === '—' ? null : +r[9] }));
  const hw = head.filter(x => x.won).length, hl = head.length - hw;
  const fill = [];
  for (let i = 0; i < (w - hw) + (l - hl); i++) fill.push({ won: i < w - hw, opponent: 'Earlier opponent ' + (i + 1), surface: 'hard', tournament: 'Earlier event',
    result: i < w - hw ? '6-4 6-4' : '4-6 4-6', date: '2024-0' + (1 + (i % 9)) + '-1' + (i % 9), round: 'R32', oddsSelf: null, oddsOpp: null });
  return head.concat(fill);
}
function buildInputs() {
  const D = designModel();
  const AX = ['serve', 'return', 'underPressure', 'dominanceRatio'];
  const dp = [0, 1, 1, 2];
  const side = (k) => { const last52 = {}, sinceBase = {};
    AX.forEach((ax, i) => { const raw = +D.dnav52[i][k], d = D.deltas[i][k];
      last52[ax] = { rating: raw, pct: D.dna52[i][k + 1] };
      // the Δ the file prints on the 52-week view (DF L3589) = last52 − sinceBase; a null Δ = a baseline we don't compare
      sinceBase[ax] = Object.assign({ rating: d == null ? raw : +(raw - d).toFixed(dp[i]), pct: D.dnaSince[i][k + 1] }, d == null ? { srScope: 'career' } : {}); });
    last52.sample = { matches: 53 }; sinceBase.sample = { matches: 99 };
    return { surfaces: { Hard: { last52, sinceBase, elo: { rating: +D.dnav52[4][k], pct: D.dna52[4][k + 1] } } } }; };
  const cell = (pct, n) => ({ pct, n });
  const mx = { 'Counterpuncher': { 'Attacking Baseliner': cell(52, 1591) }, 'Attacking Baseliner': { 'Counterpuncher': cell(48, 1591) } };
  const bySurf = {}; D.surfaces.forEach(([s, n, p]) => { bySurf[s.toLowerCase()] = { 'Counterpuncher': { 'Attacking Baseliner': cell(p, n) }, 'Attacking Baseliner': { 'Counterpuncher': cell(100 - p, n) } }; });
  return { styles: { 'J. Sinner': { archetype_label: 'Counterpuncher', variety: true }, 'C. Alcaraz': { archetype_label: 'Attacking Baseliner', variety: false } },
    matrix: { minSampleN: 20, matrix: mx, matrixBySurface: bySurf },
    meetA: { 'Attacking Baseliner': shardRows(D.A_ROWS, 26, 24) }, meetB: { 'Counterpuncher': shardRows(D.B_ROWS, 10, 23) },
    dna: { byKey: { '900001': side(0), '900002': side(1) } }, elo: { 'J. Sinner': +D.dnav52[4][0], 'C. Alcaraz': +D.dnav52[4][1] } };
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
    await x.ev(`__cap.reset()`); await x.ev(`__cap.set(${JSON.stringify(Object.assign({ maTab: 'Playing style' }, st.d))})`); await x.ev(SETTLE);
    if (st.pop) { await x.ev(`__cap.framePop()`); await sleep(100); await x.ev(SETTLE); const clip = await x.ev(`__cap.clipPop()`); await shot(x, clip, path.join(dir, st.name + '.png')); man.push({ name: st.name, size: [clip.w, clip.h] }); await x.ev(`__cap.unframe()`); continue; }
    // the SAMPLE chip beside "Style matchup" (DF L499): a review marker, hidden (our build has none)
    await x.ev(`(() => { const s = [...document.querySelectorAll('span')].find(e => e.textContent.trim() === 'SAMPLE' && e.getClientRects().length); if (!s) throw new Error('no SAMPLE chip'); __cap._style(s, 'display:none !important;'); return true; })()`);
    const fr = await x.ev(`__cap.frameModal(1296)`); await sleep(100); await x.ev(SETTLE);
    const clip = await x.ev(`__cap.clipModal()`);
    await shot(x, clip, path.join(dir, st.name + '.png'));
    leaves[st.name] = await x.ev(LEAVES(`__cap.tabRoot()`));
    const cr = await x.ev(`(() => { const r = __cap.tabRoot().getBoundingClientRect(), m = document.querySelector('[data-cap-modal]').getBoundingClientRect(); return [Math.round(r.left - m.left), Math.round(r.top - m.top), Math.round(r.right - m.left), Math.round(r.bottom - m.top)]; })()`);
    man.push({ name: st.name, size: [clip.w, clip.h], frame: fr, content: cr });
    await x.ev(`__cap.unframe()`);
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ design: path.join(HANDOFF, DESIGN), sampleChipHidden: true, screens: man }, null, 1));
  return { leaves };
}

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
  const served = await x.ev(`typeof ps2DnaCard === 'function' && typeof styleArchLabelsHtml === 'undefined'`);
  if (!served) throw new Error('the page served is not this checkout (no ps2DnaCard)');
  const I = buildInputs();
  // the fixture match + the design's values for the fixture's names / keys only (every other lookup stays real)
  await x.ev(`(() => { const fx = ${JSON.stringify(FIXTURE)}, I = ${JSON.stringify(I)};
    const i = matches.findIndex(m => m.id === fx.id); if (i >= 0) matches.splice(i, 1); matches.push(fx); window.__fx = fx;
    const _st = ppStyleFor; ppStyleFor = (name) => (I.styles[name] || _st(name));
    const _el = ppEloForSurface; ppEloForSurface = (p, s) => (p && I.elo[p.name] != null ? { rating: I.elo[p.name] } : _el(p, s));
    const _ho = aHeaderOdds; aHeaderOdds = (m) => (m && m.id === fx.id ? { p1: '1.54', p2: '2.62' } : _ho(m));
    ensurePsMatrix = () => Promise.resolve(psMatrixData = I.matrix);
    ensureMatchDna = () => Promise.resolve(_mdna = { byKey: I.dna.byKey, meta: {} });
    ensureStyleMeetings = (m) => { if (m.id === fx.id) { m.p1StyleMeetings = I.meetA; m.p2StyleMeetings = I.meetB; m._styleMeetLoaded = true; } return Promise.resolve(m); };
    return true; })()`);
  if (THEME === 'day' || THEME === 'night') await x.ev(`typeof maSetTheme === 'function' ? (maSetTheme(${JSON.stringify(THEME)}), true) : false`);
  await x.ev(`openAnalysisModal('ten312-fixture'), true`);
  if (THEME === 'source') await x.ev(`(() => { const ov = document.getElementById('analysisModal');
    ${JSON.stringify(Object.entries(SOURCE_TOKENS))}.forEach(([k, v]) => ov.style.setProperty(k, v));
    const names = new Set(); for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch (e) { continue; } for (const r of rules) { if (r.style) for (const p of r.style) if (p.startsWith('--ma-s-')) names.add(p); if (r.cssRules) for (const q of r.cssRules) if (q.style) for (const p of q.style) if (p.startsWith('--ma-s-')) names.add(p); } }
    for (const n of names) { const mm = /^--ma-s-([0-9a-f]{6})(?:-(\\d{3}))?/.exec(n); if (!mm) continue; const h = mm[1], a = mm[2] != null ? +mm[2] / 1000 : 1;
      ov.style.setProperty(n, 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')'); }
    return names.size; })()`);
  await x.ev(`aShowTab('style'), true`);
  if (HIDE_GAPS) await x.ev(`(() => { const h = document.createElement('style'); h.textContent = '#aSectionStyle .ps2-more{ display:none !important; }'; document.head.appendChild(h); return true; })()`);
  for (let t = Date.now(); !(await x.ev(`!!document.querySelector('#aSectionStyle .ps2-dna') && !!(_aM && _aM._ps2Loaded)`)); ) { if (Date.now() - t > 20000) throw new Error('Playing style never built'); await sleep(200); }
  const man = [], leaves = {};
  for (const st of STATES) {
    if (ONLY && !ONLY.has(st.name)) continue;
    await x.ev(`(() => { fhCloseSheet(); ps2Set(Object.assign({ meetA: false, meetB: false, moreA: false, moreB: false, prof: false, win: 'w52' }, ${JSON.stringify(st.b)})); return true; })()`);
    await sleep(150); await x.ev(SETTLE);
    if (st.sheet) {
      await x.ev(`(() => { const el = document.querySelector('#aSectionStyle [data-ps2-row="a"]'); if (!el) throw new Error('no meeting row'); el.click(); return true; })()`);
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
    leaves[st.name] = await x.ev(LEAVES(`document.getElementById('aSectionStyle')`));
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
  const B = await buildSide(bd);
  fs.writeFileSync(path.join(OUT, 'leaves.json'), JSON.stringify({ design: D.leaves, build: B.leaves }, null, 1));
  console.log('wrote', OUT);
}
main().then(() => { cleanup(); process.exit(0); }, (e) => { console.error('FAIL:', e.stack || e.message); cleanup(); process.exit(1); });
