#!/usr/bin/env node
// TEN-334 — TEST-ONLY Overview-tab capture for the Match analysis pixel diff (both halves in one tool). Never loaded by the
// live page and never run in CI: a manual tool, like tools/ten331-h2h-capture.mjs (whose clock, zone, viewport, raster
// flags, framing and helpers it repeats).
//
//   node tools/ten334-overview-capture.mjs <outDir> [--only a,b] [--theme night|day|source] [--ruled-off]
//
// 1. Renders the LOCKED design file (needs network: React + Babel from unpkg) and captures every Overview state below:
//    the tab in its three tiers and the pop-up behind a count (a season row, a year's Total, a year × surface cell) plus
//    the match stats sheet opened from a pop-up row. The file carries no review switcher on this tab (TV / CVK / NV are
//    constants in overviewFor, DF L3159–3180).
// 2. Reads the design's OWN numbers out of the file (its overviewFor, run per tier; its pop-up rows and ovSheet) and hands
//    them to THIS checkout's dashboard in our data shapes — careerByYear rows (tier splits; pre-2021 rows ATP-only, as the
//    file's), career-history rows and a parsed match-closes shard for the opened counts — on the design's demo match
//    (ten312-build-capture FIXTURE), then captures the same states. FIXTURE MODE LIVES ONLY HERE: nothing reaches
//    bsp-consult-dashboard.html.
// 3. Dumps every visible text leaf on both sides → leaves.json (structure: python3 tools/ten330-form-structure.py
//    <outDir>/leaves.json).
//
// --theme source: every modal shade token set to the source value its name carries (--ma-s-<hex>[-<alpha×1000>]) and the
// role tokens to the design's source values, so the pixel diff isolates structure from the ruled palette.
// --ruled-off (build side only, a measurement aid reported as such): undo the ruled colour differences — D4 player identity
// on the career bars and season-row accents (the file's accents: A blue, B light, season rows by surface).
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
const RULED_OFF = args.includes('--ruled-off');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!OUT) { console.error('usage: node tools/ten334-overview-capture.mjs <outDir> [--only a,b] [--theme night|day|source] [--ruled-off]'); process.exit(2); }
const FROZEN_NOW = Date.parse('2026-09-28T12:19:30+08:00');
const TZ = 'Asia/Makassar';
const VIEW_W = 1370, VIEW_H = 745, FIT_H = 760, POP_W = 1001;

// Every Overview state: design state patch ↔ our state (tier + open cell). Cell ids: design 'i|year|Surf' (Surf = Clay |
// Hard | Grass | Total), ours 'i|year|surf' (lower case). sheet = the pop-up's newest row opened in the match stats sheet.
const STATES = [
  { name: '02-overview', d: {}, b: { tier: 'all' } },
  { name: '02b-overview-atp', d: { maOvTier: 'atp' }, b: { tier: 'atp' } },
  { name: '02c-overview-challenger-itf', d: { maOvTier: 'ch' }, b: { tier: 'chitf' } },
  { name: 'P5-overview-season-surface-popup', d: { maOvCell: '0|season|Hard' }, b: { tier: 'all', cell: '0|season|hard' }, pop: true },
  { name: 'P5b-overview-year-total-popup', d: { maOvCell: '0|2026|Total' }, b: { tier: 'all', cell: '0|2026|total' }, pop: true },
  { name: 'P5c-overview-year-surface-popup', d: { maOvCell: '1|2024|Clay' }, b: { tier: 'all', cell: '1|2024|clay' }, pop: true },
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
// DESIGN side (helpers = tools/ten331-h2h-capture.mjs D_HELPERS without the H2H hooks)
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


// The design's numbers, read from its own overviewFor: per player, year and surface the ATP and Challenger/ITF W–L
// (one overviewFor run per tier), plus the rows and sheet entries behind every pop-up state.
const D_EXTRACT = (cells) => `(() => { const L = __cap.host().logic;
  const dm = (L.props && L.props.match) || L.demoMatch(), AN2 = { aName: dm.a.name, bName: dm.b.name }, names = [AN2.aName, AN2.bName];
  const tiers = {}; ['atp', 'ch'].forEach(t => { tiers[t] = L.overviewFor(AN2, { maOvTier: t }).players.map(p => p.rows.map(r => ({ year: r.year, onTour: r.onTour, atpOnly: !!r.atpOnly, cells: r.onTour ? r.cells.map(c => c.txt) : null }))); });
  const pops = {}; ${JSON.stringify(cells)}.forEach(cid => { const o = L.overviewFor(AN2, { maOvCell: cid }); pops[cid] = { rows: o.pop ? o.pop.rows.map(r => ({ mid: r.mid, date: r.date, won: r.won, opp: r.opp, event: r.event, surf: r.surf, rd: r.rd, sets: r.sets, scores: r.scores, price: r.price, opPrice: r.opPrice })) : [], sheet: (L._ovSheet || []).map(x => ({ mid: x.mid, date: x.date, setArr: x.setArr, price: x.price, oppPrice: x.oppPrice, won: x.won, opp: x.opp, tourn: x.tourn, surface: x.surface, round: x.round })) }; });
  return { names, tiers, pops }; })()`;

async function designSide(dir) {
  const x = await browser(HANDOFF, DESIGN);
  const t0 = Date.now();
  for (;;) { if (await x.ev(`!!document.querySelector('.nav') && document.readyState === 'complete'`).catch(() => false)) break; if (Date.now() - t0 > 60000) throw new Error('design did not mount'); await sleep(250); }
  await x.ev(D_HELPERS); await x.ev(`document.fonts.ready.then(() => true)`);
  // the year Total's rows first: its order breaks same-day ties the way the file's pop-up lists them
  const data = await x.ev(D_EXTRACT(STATES.filter(s => s.d.maOvCell).map(s => s.d.maOvCell).sort((a, b) => /Total$/.test(b) - /Total$/.test(a))));
  const man = [], leaves = {};
  for (const st of STATES) {
    if (ONLY && !ONLY.has(st.name)) continue;
    await x.ev(`__cap.reset()`); await x.ev(`__cap.set(${JSON.stringify(Object.assign({ maTab: 'Overview' }, st.d))})`); await x.ev(SETTLE);
    if (st.pop) { await x.ev(`__cap.framePop()`); await sleep(100); await x.ev(SETTLE); const clip = await x.ev(`__cap.clipPop()`); await shot(x, clip, path.join(dir, st.name + '.png'));
      leaves[st.name] = await x.ev(LEAVES(`document.querySelector('[data-cap-box]')`)); man.push({ name: st.name, size: [clip.w, clip.h] }); await x.ev(`__cap.unframe()`); continue; }
    const fr = await x.ev(`__cap.frameModal(1296)`); await sleep(100); await x.ev(SETTLE);
    const clip = await x.ev(`__cap.clipModal()`);
    await shot(x, clip, path.join(dir, st.name + '.png'));
    leaves[st.name] = await x.ev(LEAVES(`__cap.formRoot()`));
    const cr = await x.ev(`(() => { const r = __cap.formRoot().getBoundingClientRect(), m = document.querySelector('[data-cap-modal]').getBoundingClientRect(); return [Math.round(r.left - m.left), Math.round(r.top - m.top), Math.round(r.right - m.left), Math.round(r.bottom - m.top)]; })()`);
    man.push({ name: st.name, size: [clip.w, clip.h], frame: fr, content: cr });
    await x.ev(`__cap.unframe()`);
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ design: path.join(HANDOFF, DESIGN), screens: man }, null, 1));
  fs.writeFileSync(path.join(dir, 'extract.json'), JSON.stringify(data, null, 1));
  return { leaves, data };
}

// ---------------------------------------------------------------------------------------------------------------
// BUILD side
const FIXTURE = { id: 'ten312-fixture', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: '900001', p2Key: '900002', date: '2026-07-20',
  tour: 'ATP Washington', tournament: 'ATP Washington', tournamentRound: 'ATP Washington - Quarter-finals', surface: 'Hard',
  startTs: '2026-07-20T22:00:00Z', bestOdds: { p1: { price: 1.54 }, p2: { price: 2.62 } },
  finalScore: { display: '6-4, 4-6, 7-6', sets: [{ p1: 6, p2: 4 }, { p1: 4, p2: 6 }, { p1: 7, p2: 6 }], p1Sets: 2, p2Sets: 1, winner: 'p1' } };
const RD = { R128: '1/64-finals', R64: '1/32-finals', R32: '1/16-finals', R16: '1/8-finals', QF: 'Quarter-finals', SF: 'Semi-finals', F: 'Final' };
const SURF = ['clay', 'hard', 'grass'];
// The design's numbers in our shapes. careerByYear: one row per on-tour year, tier splits from the atp / ch runs; a
// pre-2021 row is ATP-only in the file (chW = chL = 0), so it keeps an exact ATP split (allTier false) and no chitf.
function buildInputs(D) {
  const wl = (t) => { const m = /^(\d+)-(\d+)$/.exec(t || ''); return m ? { won: +m[1], lost: +m[2] } : { won: 0, lost: 0 }; };
  const add = (a, b) => ({ won: a.won + b.won, lost: a.lost + b.lost });
  const nz = (c) => (c.won + c.lost ? c : null);
  const cby = [0, 1].map(i => D.tiers.atp[i].filter(r => r.onTour).map((r, k) => {
    const ch = D.tiers.ch[i].find(x => x.year === r.year);
    const A = r.cells.map(wl), C = ch && ch.cells ? ch.cells.map(wl) : SURF.map(() => ({ won: 0, lost: 0 }));
    const T = A.map((a, j) => add(a, C[j]));
    const sum = (arr) => arr.reduce(add, { won: 0, lost: 0 });
    const pre = +r.year < 2021;
    const split = (arr) => ({ total: nz(sum(arr)), clay: nz(arr[0]), hard: nz(arr[1]), grass: nz(arr[2]), indoor: null });
    return Object.assign({ year: r.year, allTier: !pre }, split(T), { atp: split(A), chitf: pre ? null : split(C), rows: 0, atpOnly: pre });
  }));
  // career-history rows + closes for every opened count (the file's pop-up rows and ovSheet entries, joined on mid)
  const hist = [[], []], closes = [{ rows: [], cap: [] }, { rows: [], cap: [] }];
  let ek = 9300000;
  Object.entries(D.pops).forEach(([cid, P]) => {
    const i = +cid.split('|')[0];
    P.rows.forEach(r => {
      const sh = P.sheet.find(x => x.mid === r.mid); if (!sh) return;
      const [dd, mm, yy] = sh.date.split('.'); const iso = `20${yy}-${mm}-${dd}`;
      // the same design match reaches two pop-ups under two mids (season row and year Total): one history row per match
      const uid = [iso, r.opp, r.event, r.rd, r.sets, r.scores].join('|');
      if (hist[i].some(h => h._mid === uid)) return;
      const sets = sh.setArr.map(s => ({ p: s[0], o: s[1] }));
      // bestOf 3: the file draws best-of-3 scores at every event, Slams included
      hist[i].push({ _mid: uid, bestOf: 3, year: iso.slice(0, 4), surface: String(r.surf).toLowerCase(), level: 'atp', date: iso, tournament: r.event, round: RD[r.rd] || r.rd,
        opponent: r.opp, result: r.sets, won: !!r.won, eventKey: ek++, src: 'fixtures', sets });
      const sn = r.opp.split(' ').slice(1).join(' ') + ' ' + r.opp.split(' ')[0];
      closes[i].rows.push({ date: iso, opp: sn, won: !!r.won, P: [+r.price, +r.opPrice], B: null, ret: false, oppKey: null });
    });
  });
  hist.forEach(h => { h.sort((a, b) => b.date.localeCompare(a.date)); h.forEach(x => delete x._mid); });
  return { cby, hist, closes };
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
  while (!(await x.ev(`typeof matches === 'object' && Array.isArray(matches) && typeof openAnalysisModal === 'function' && typeof aShowTab === 'function' && typeof playerProfiles === 'object' && !!playerProfiles`).catch(() => false))) { if (Date.now() - t0 > 90000) throw new Error('dashboard did not boot'); await sleep(300); }
  await x.ev(`document.fonts.ready.then(() => true)`);
  const served = await x.ev(`typeof ovColumnHtml === 'function' && typeof buildYearlyTable === 'undefined'`);
  if (!served) throw new Error('the page served is not this checkout (no ovColumnHtml)');
  // fixture match + the design's numbers in our shapes; re-armed before every state (a board / profiles refresh replaces them)
  await x.ev(`(() => { const fx = ${JSON.stringify(FIXTURE)}, I = ${JSON.stringify(I)};
    window.__fx = fx; window.__ovArm = () => { const i = matches.findIndex(m => m.id === fx.id); if (i >= 0) matches.splice(i, 1); matches.push(fx);
      playerProfiles[fx.p1Key] = { key: fx.p1Key, name: fx.p1, careerByYear: I.cby[0] }; playerProfiles[fx.p2Key] = { key: fx.p2Key, name: fx.p2, careerByYear: I.cby[1] };
      _careerHistoryShards[fx.p1Key] = I.hist[0]; _careerHistoryShards[fx.p2Key] = I.hist[1];
      _fhCl[fx.p1Key] = I.closes[0]; _fhCl[fx.p2Key] = I.closes[1]; return true; };
    return window.__ovArm(); })()`);
  if (THEME === 'day' || THEME === 'night') await x.ev(`typeof maSetTheme === 'function' ? (maSetTheme(${JSON.stringify(THEME)}), true) : false`);
  await x.ev(`openAnalysisModal('ten312-fixture'), true`);
  if (THEME === 'source') await x.ev(`(() => { const ov = document.getElementById('analysisModal');
    ${JSON.stringify(Object.entries(SOURCE_TOKENS))}.forEach(([k, v]) => ov.style.setProperty(k, v));
    const names = new Set(); for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch (e) { continue; } for (const r of rules) { if (r.style) for (const p of r.style) if (p.startsWith('--ma-s-')) names.add(p); if (r.cssRules) for (const q of r.cssRules) if (q.style) for (const p of q.style) if (p.startsWith('--ma-s-')) names.add(p); } }
    for (const n of names) { const mm = /^--ma-s-([0-9a-f]{6})(?:-(\\d{3}))?/.exec(n); if (!mm) continue; const h = mm[1], a = mm[2] != null ? +mm[2] / 1000 : 1;
      ov.style.setProperty(n, 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')'); }
    return names.size; })()`);
  if (RULED_OFF) await x.ev(`(() => { const ov = document.getElementById('analysisModal');
    ov.style.setProperty('--fh-pa', '#6aaeff'); ov.style.setProperty('--fh-pb-fill', '#e7e9ee');
    const h = document.createElement('style'); h.id = '__ruledOff'; h.textContent = '#aSectionOverview .ov-srow[data-ov-cell$="|clay"]{ border-left-color:#6aaeff !important; } #aSectionOverview .ov-srow[data-ov-cell$="|hard"], #aSectionOverview .ov-srow[data-ov-cell$="|grass"]{ border-left-color:#5b9bff !important; }'; document.head.appendChild(h); return true; })()`);
  await x.ev(`aShowTab('overview'), true`);
  for (let t = Date.now(); !(await x.ev(`!!document.querySelector('#aSectionOverview .ov-grid')`)); ) { if (Date.now() - t > 30000) throw new Error('Overview section never built'); await sleep(250); }
  await x.ev(SETTLE);
  const man = [], leaves = {};
  for (const st of STATES) {
    if (ONLY && !ONLY.has(st.name)) continue;
    await x.ev(`(() => { __ovArm(); const m = matches.find(z => z.id === 'ten312-fixture'); if (_ov.cell) ovCloseCell(); _ov.tier = ${JSON.stringify(st.b.tier)}; aPaint('aSectionOverview', buildYearlyTables(m)); ${st.b.cell ? `ovOpenCell(${JSON.stringify(st.b.cell)});` : ''} return true; })()`);
    await sleep(200); await x.ev(SETTLE);
    if (st.pop) {
      const clip = await x.ev(`(() => { const ps = document.querySelector('#ovPop > .ma-pop-overlay'); if (!ps) throw new Error('no pop-up'); const box = ps.querySelector('.ma-pop');
        window.__saved = [document.documentElement, document.body, ps, box].map(e => [e, e.getAttribute('style')]);
        const st = (e, css) => e.setAttribute('style', (e.getAttribute('style') || '') + ';' + css);
        st(document.documentElement, 'background:transparent !important;'); st(document.body, 'background:transparent !important;');
        if (!document.getElementById('__capHide2')) { const h = document.createElement('style'); h.id = '__capHide2'; h.textContent = 'body > *:not(#analysisModal){ visibility:hidden !important; } #analysisModal .modal-analysis > *:not(#ovPop){ visibility:hidden !important; } #analysisModal{ background:transparent !important; backdrop-filter:none !important; } #analysisModal .modal-analysis{ background:transparent !important; border-color:transparent !important; box-shadow:none !important; }'; document.head.appendChild(h); }
        st(ps, 'position:absolute !important; inset:auto !important; left:0 !important; top:0 !important; width:${POP_W}px !important; height:auto !important; overflow:visible !important; padding-top:24px !important; padding-bottom:24px !important;');
        const r = ps.getBoundingClientRect(), br = box.getBoundingClientRect(); return { x: r.left + scrollX, y: br.top - 24 + scrollY, w: Math.round(r.width), h: Math.round(br.height + 48) }; })()`);
      await sleep(100); await x.ev(SETTLE);
      await shot(x, clip, path.join(dir, st.name + '.png')); man.push({ name: st.name, ref: st.name, size: [clip.w, clip.h] });
      leaves[st.name] = await x.ev(LEAVES(`document.querySelector('#ovPop .ma-pop')`));
      await x.ev(`(() => { for (const [e, s] of window.__saved) { if (s == null) e.removeAttribute('style'); else e.setAttribute('style', s); } document.getElementById('__capHide2').remove(); ovCloseCell(); return true; })()`);
      continue;
    }
    const fr = await x.ev(B_FRAME); await sleep(100); await x.ev(SETTLE);
    const clip = await x.ev(`(() => { const r = document.querySelector('#analysisModal .modal-analysis').getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: Math.round(r.width), h: Math.round(r.height) }; })()`);
    await shot(x, clip, path.join(dir, st.name + '.png'));
    leaves[st.name] = await x.ev(LEAVES(`document.getElementById('aSectionOverview')`));
    const cr = await x.ev(`(() => { const r = document.querySelector('#analysisModal .abody').getBoundingClientRect(), m = document.querySelector('#analysisModal .modal-analysis').getBoundingClientRect(); return [Math.round(r.left - m.left), Math.round(r.top - m.top), Math.round(m.width), Math.round(m.height)]; })()`);
    man.push({ name: st.name, ref: st.name, size: [clip.w, clip.h], frame: fr, content: cr });
    await x.ev(B_UNFRAME);
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ servedThisCheckout: true, root: ROOT, theme: THEME, ruledOff: RULED_OFF, fixture: FIXTURE, screens: man }, null, 1));
  return { leaves };
}

async function main() {
  const dd = path.join(OUT, 'design'), bd = path.join(OUT, 'build');
  fs.mkdirSync(dd, { recursive: true }); fs.mkdirSync(bd, { recursive: true });
  const D = await designSide(dd);
  const I = buildInputs(D.data);
  fs.writeFileSync(path.join(bd, 'inputs.json'), JSON.stringify(I, null, 1));
  const B = await buildSide(bd, I);
  fs.writeFileSync(path.join(OUT, 'leaves.json'), JSON.stringify({ design: D.leaves, build: B.leaves }, null, 1));
  console.log('wrote', OUT);
}
main().then(() => { cleanup(); process.exit(0); }, (e) => { console.error('FAIL:', e.stack || e.message); cleanup(); process.exit(1); });
