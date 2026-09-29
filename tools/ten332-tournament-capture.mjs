#!/usr/bin/env node
// TEN-332 — TEST-ONLY Tournament-tab capture for the Match analysis pixel diff (both halves in one tool). Never loaded by
// the live page and never run in CI: a manual tool, like tools/ten331-h2h-capture.mjs (whose clock, zone, viewport, raster
// flags, framing and helpers it repeats).
//
//   node tools/ten332-tournament-capture.mjs <outDir> [--only a,b] [--theme night|day|source] [--ruled-off]
//
// 1. Renders the LOCKED design file (needs network: React + Babel from unpkg) and captures every Tournament state below.
//    The file draws no review switcher on this tab.
// 2. Serves THIS checkout's dashboard, pushes the design's demo match (ten312-build-capture FIXTURE) and hands the
//    Tournament builder the design's OWN records (DF tourRecFor, read from the running design: every edition, every
//    match, its set scores and closing pair) in our data shapes — the pipeline's edition list, career-history rows, a
//    parsed match-closes shard — plus the design's header / market values (tournamentFor) as m.venue, m.courtSpeed and a
//    tournament-market row. FIXTURE MODE LIVES ONLY HERE: nothing reaches bsp-consult-dashboard.html.
// 3. Dumps every visible text leaf of the Tournament section on both sides → leaves.json (structure: python3
//    tools/ten330-form-structure.py <outDir>/leaves.json — the comparison is tab-agnostic).
//
// --theme source: every modal shade token set to the source value its name carries, so the diff isolates structure from
// the ruled palette. --ruled-off: undo, on the build side only, the differences a founder ruling put there (measurement
// aid, reported as such): the TEN-325 retirement note and the D2 small-sample greys.
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
if (!OUT) { console.error('usage: node tools/ten332-tournament-capture.mjs <outDir> [--only a,b] [--theme night|day|source]'); process.exit(2); }
const FROZEN_NOW = Date.parse('2026-09-28T12:19:30+08:00');
const TZ = 'Asia/Makassar';
const VIEW_W = 1370, VIEW_H = 745, FIT_H = 760, POP_W = 1001;

// Every Tournament state: design state patch ↔ our trSet state (b). sheet = the newest match of player A's newest edition.
const STATES = [
  { name: '09-tournament', d: {}, b: {} },
  { name: '09b-tournament-earlier-editions', d: { maTrMore0: true }, b: { recMore: [true, false] } },
  { name: '09c-tournament-court-speed-panel', d: { maTourMore: true }, b: { more: true } },
  { name: 'P9-tournament-roi-popup', d: { maTourMore: true, maRoi: true }, b: { more: true, roi: 'fav' }, pop: 'roi' },
  { name: 'P7-tournament-match-stats-sheet', d: {}, b: {}, sheet: true, pop: 'sheet' },
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
    // the design's own data for this tab: every edition of both players (tourRecFor with both lists expanded), the sheet
    // entries (set scores + closing pair) and the header / market values (tournamentFor)
    data() { const L = host().logic, AN = L.mkAnalysis(L.demoMatch(), 1.54, 2.62), S = Object.assign({}, L.state, { maTrMore0: true, maTrMore1: true });
      const T = L.tournamentFor(AN, S), R = L.tourRecFor(AN, S), sheet = L._trSheet;
      return { aName: AN.aName, bName: AN.bName, round: AN.roundLabel, meta: T.meta, location: T.location, market: { speed: T.market.speed, speedLabel: T.market.speedLabel,
        pts: T.market.trendPts.map(p => ({ year: p.year, v: p.v })), roiFav: T.market.roiFav, roiDog: T.market.roiDog, favRel: T.market.favRel },
        players: R.players.map(p => ({ name: p.name, rows: p.rows.map(r => r.isGroup ? { g: r.event, meta: r.eventMeta } : { date: r.date, opp: r.opp, rd: r.rd, sets: r.sets, won: r.wlColor === '#3DD68C' || r.wlColor === '#3dd68c' }) })),
        sheet: sheet.map(e => ({ mid: e.mid, pName: e.pName, opp: e.opp, tourn: e.tourn, round: e.round, date: e.date, won: e.won, setArr: e.setArr, price: +e.price, oppPrice: +e.oppPrice })) }; },
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
  await x.ev(`__cap.reset()`); await x.ev(`__cap.set({ maTab: 'Tournament' })`); await x.ev(SETTLE);
  const data = await x.ev(`__cap.data()`);
  const man = [], leaves = {};
  for (const st of STATES) {
    if (ONLY && !ONLY.has(st.name)) continue;
    await x.ev(`__cap.reset()`); await x.ev(`__cap.set(${JSON.stringify(Object.assign({ maTab: 'Tournament' }, st.d))})`); await x.ev(SETTLE);
    if (st.sheet) {   // the newest match of player A's newest edition (the first row the tab draws)
      const mid = await x.ev(`(() => { const L = __cap.host().logic; const e = L._trSheet.filter(z => z.mid.startsWith('tr_0_')); const y = Math.max(...e.map(z => +z.mid.split('_')[2]));
        const k = Math.max(...e.filter(z => +z.mid.split('_')[2] === y).map(z => +z.mid.split('_')[3])); return 'tr_0_' + y + '_' + k; })()`);
      await x.ev(`__cap.set({ maFormSheet: ${JSON.stringify(mid)} })`); await x.ev(SETTLE);
    }
    if (st.pop) { await x.ev(`__cap.framePop()`); await sleep(st.pop === 'roi' ? 1500 : 100); await x.ev(SETTLE); const clip = await x.ev(`__cap.clipPop()`); await shot(x, clip, path.join(dir, st.name + '.png')); man.push({ name: st.name, size: [clip.w, clip.h] }); await x.ev(`__cap.unframe()`); continue; }
    // --ruled-off (measurement aid): hide what a founder ruling removed from our build — the reading paragraph (placeholder
    // copy, "show nothing") and the synthesised "Withdrawal" edition headers (N6)
    if (RULED_OFF) await x.ev(`(() => { const root = __cap.formRoot();
      for (const d of root.querySelectorAll('div')) { const t = d.textContent.trim(); if ((!d.querySelector('div') && /Read the records below/.test(t)) || (d.children.length === 2 && /^Washington \\d{4}/.test(t) && /Withdrawal$/.test(t))) __cap._style(d, 'display:none !important;'); }
      return true; })()`);
    const fr = await x.ev(`__cap.frameModal(1296)`); await sleep(100); await x.ev(SETTLE);
    const clip = await x.ev(`__cap.clipModal()`);
    await shot(x, clip, path.join(dir, st.name + '.png'));
    leaves[st.name] = await x.ev(LEAVES(`__cap.formRoot()`));
    const cr = await x.ev(`(() => { const r = __cap.formRoot().getBoundingClientRect(), m = document.querySelector('[data-cap-modal]').getBoundingClientRect(); return [Math.round(r.left - m.left), Math.round(r.top - m.top), Math.round(r.right - m.left), Math.round(r.bottom - m.top)]; })()`);
    man.push({ name: st.name, size: [clip.w, clip.h], frame: fr, content: cr });
    await x.ev(`__cap.unframe()`);
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ design: path.join(HANDOFF, DESIGN), screens: man }, null, 1));
  return { leaves, data };
}

// ---------------------------------------------------------------------------------------------------------------
// BUILD side
const FIXTURE = { id: 'ten312-fixture', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: '900001', p2Key: '900002', date: '2026-07-20',
  tour: 'ATP Washington', tournament: 'ATP Washington', tournamentRound: 'ATP Washington - Quarter-finals', surface: 'Hard',
  startTs: '2026-07-20T22:00:00Z', bestOdds: { p1: { price: 1.54 }, p2: { price: 2.62 } },
  finalScore: { display: '6-4, 4-6, 7-6', sets: [{ p1: 6, p2: 4 }, { p1: 4, p2: 6 }, { p1: 7, p2: 6 }], p1Sets: 2, p2Sets: 1, winner: 'p1' } };
const RD = { R128: '1/64-finals', R64: '1/32-finals', R32: '1/16-finals', R16: '1/8-finals', QF: 'Quarter-finals', SF: 'Semi-finals', F: 'Final' };
// The design's records in our shapes. Its "Withdrawal" editions are not carried (N6: only editions entered — ruled).
function buildInputs(D) {
  const byMid = {}; D.sheet.forEach(e => { byMid[e.mid] = e; });
  const out = D.players.map((p, idx) => {
    const years = [], ch = [], rows = []; let cur = null, ek = 9300000 + idx * 1000;
    const entries = D.sheet.filter(e => e.mid.startsWith('tr_' + idx + '_'));
    p.rows.forEach(r => {
      if (r.g != null) { const y = r.g.slice(-4); cur = r.meta === 'Withdrawal' ? null : { year: y, matchCount: 0, won: 0, lost: 0, roundReached: '', matches: [] }; if (cur) years.push(cur); return; }
      if (!cur) return;
      const e = entries.find(z => z.mid.split('_')[2] === cur.year && z.opp === r.opp && z.round === r.rd);
      const iso = cur.year + '-07-' + r.date.slice(0, 2), key = ++ek;
      const pS = e.setArr.filter(s => s[0] > s[1]).length, oS = e.setArr.length - pS;
      cur.matches.push({ date: iso, opponent: r.opp, round: RD[r.rd], won: e.won, result: pS + ' - ' + oS, eventKey: key });
      cur.matchCount++; if (e.won) cur.won++; else cur.lost++; if (!cur.roundReached) cur.roundReached = RD[r.rd];
      ch.push({ date: iso, year: cur.year, opponent: r.opp, round: RD[r.rd], won: e.won, result: pS + ' - ' + oS, eventKey: key, tournament: 'Washington', surface: 'hard', level: 'atp',
        sets: e.setArr.map(s => ({ p: s[0], o: s[1] })) });
      rows.push({ date: iso, opp: r.opp, won: e.won, P: [e.price, e.oppPrice], B: null, ret: false, oppKey: null });
    });
    return { hist: { editionsPlayed: years.length, totalWon: 0, totalLost: 0, years }, ch, cl: { rows, cap: [] } };
  });
  const n = s => parseFloat(String(s).replace('−', '-').replace('%', ''));
  const pt = y => { const x = D.market.pts.find(q => q.year === y); return x ? +x.v : null; };
  const alt = parseInt(String((D.meta.find(q => q.label === 'Altitude') || {}).value), 10);
  return { players: out, venue: { city: 'Washington', country: 'US', category: (D.meta.find(q => q.label === 'Category') || {}).value, indoor: false },
    courtSpeed: { speed: 60, abstractSpeed: +D.market.speed, altitude: alt, as2023: pt(2023), as2024: pt(2024), as2025: pt(2025), category: D.market.speedLabel },
    // the design's placeholder yields and its tour averages (DF L2804–2808 with TOUR_SPEED 1.0), n = a full sample
    market: { baseline: { roiFav: -2, roiDog: 0.8, favRel: 69 }, tournaments: { Washington: { n: 120, roiFav: n(D.market.roiFav), roiDog: n(D.market.roiDog), favRel: n(D.market.favRel), archiveNames: ['Citi Open'] } } } };
}
const B_FRAME = `(() => {
  const ov = document.getElementById('analysisModal'), m = ov.querySelector('.modal-analysis'), body = m.querySelector('.aanalysis-body-wrap');
  window.__saved = [document.documentElement, document.body, ov, m, body, m.querySelector('.asidenav'), m.querySelector('.abody')].map(e => [e, e.getAttribute('style')]);
  const st = (e, css) => e.setAttribute('style', (e.getAttribute('style') || '') + ';' + css);
  st(document.documentElement, 'background:transparent !important;'); st(document.body, 'background:transparent !important;');
  if (!document.getElementById('__capHide')) { const h = document.createElement('style'); h.id = '__capHide'; h.textContent = 'body > *:not(#analysisModal):not(#trRoiPop){ visibility:hidden !important; }'; document.head.appendChild(h); }
  st(ov, 'background:transparent !important; backdrop-filter:none !important; position:absolute !important; inset:auto !important; left:0 !important; top:0 !important; width:${VIEW_W}px !important; height:auto !important; min-height:${VIEW_H}px !important; align-items:flex-start !important;');
  st(m, 'height:auto !important;'); st(body, 'flex:none !important; grid-template-rows:auto !important;');
  st(m.querySelector('.asidenav'), 'overflow:visible !important;'); st(m.querySelector('.abody'), 'overflow:visible !important;');
  st(ov, 'width:${1296 + 64}px !important; padding:32px !important;'); st(m, 'min-height:${Math.round(VIEW_H * 0.88)}px !important;');
  const r = m.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: Math.round(r.width), h: Math.round(r.height) }; })()`;
const B_UNFRAME = `(() => { for (const [e, s] of window.__saved) { if (s == null) e.removeAttribute('style'); else e.setAttribute('style', s); } return true; })()`;
// a pop-up (the sheet, or the ROI overlay) framed alone at POP_W, as the design side frames its own
const B_POP = (sel) => `(() => { const ps = document.querySelector(${JSON.stringify(sel)}); const box = ps.querySelector('[role=dialog]') || ps.children[1] || ps.children[0];
  window.__saved = [document.documentElement, document.body, ps, box].map(e => [e, e.getAttribute('style')]);
  const st = (e, css) => e.setAttribute('style', (e.getAttribute('style') || '') + ';' + css);
  st(document.documentElement, 'background:transparent !important;'); st(document.body, 'background:transparent !important;');
  if (!document.getElementById('__capHide2')) { const h = document.createElement('style'); h.id = '__capHide2'; h.textContent = 'body > *:not(#analysisModal):not(#trRoiPop){ visibility:hidden !important; } #analysisModal .modal-analysis > *:not(#fhSheet){ visibility:hidden !important; } #analysisModal{ background:transparent !important; backdrop-filter:none !important; } #analysisModal .modal-analysis{ background:transparent !important; border-color:transparent !important; box-shadow:none !important; }'; document.head.appendChild(h); }
  st(ps, 'position:absolute !important; inset:auto !important; left:0 !important; top:0 !important; width:${POP_W}px !important; height:auto !important; overflow:visible !important; padding-top:24px !important; padding-bottom:24px !important;');
  const r = ps.getBoundingClientRect(), br = box.getBoundingClientRect(); return { x: r.left + scrollX, y: br.top - 24 + scrollY, w: Math.round(r.width), h: Math.round(br.height + 48) }; })()`;

async function buildSide(dir, I) {
  const x = await browser(ROOT, 'bsp-consult-dashboard.html', `var _b; Object.defineProperty(window, 'BSP', { configurable: true, get() { return _b; }, set(v) { if (v) { const u = Promise.resolve({ emailVerified: true }); v.requireVerified = () => u; v.requireAuth = () => u; } _b = v; } });`);
  const t0 = Date.now();
  while (!(await x.ev(`typeof matches === 'object' && Array.isArray(matches) && typeof openAnalysisModal === 'function' && typeof aShowTab === 'function'`).catch(() => false))) { if (Date.now() - t0 > 90000) throw new Error('dashboard did not boot'); await sleep(300); }
  await x.ev(`document.fonts.ready.then(() => true)`);
  if (!(await x.ev(`typeof trModelFor === 'function' && typeof atournPlayerColumn === 'undefined'`))) throw new Error('the page served is not this checkout (no trModelFor)');
  // fixture match + the design's records in our shapes, held on window.__fx (the board refresh replaces `matches`)
  await x.ev(`(() => { const I = ${JSON.stringify(I)}; const fx = Object.assign(${JSON.stringify(FIXTURE)}, { venue: I.venue, courtSpeed: I.courtSpeed,
      p1TournamentHistory: I.players[0].hist, p2TournamentHistory: I.players[1].hist });
    const i = matches.findIndex(m => m.id === fx.id); if (i >= 0) matches.splice(i, 1); matches.push(fx); window.__fx = fx; window.__I = I;
    tourxMarketData = I.market; return true; })()`);
  if (THEME === 'day' || THEME === 'night') await x.ev(`typeof maSetTheme === 'function' ? (maSetTheme(${JSON.stringify(THEME)}), true) : false`);
  await x.ev(`openAnalysisModal('ten312-fixture'), true`);
  const arm = `(() => { const E = trStateFor(window.__fx); E.data = window.__I.players.map(p => ({ ch: p.ch, cl: p.cl })); E.state = ['ready', 'ready']; return true; })()`;
  await x.ev(arm);
  if (THEME === 'source') await x.ev(`(() => { const ov = document.getElementById('analysisModal');
    ${JSON.stringify(Object.entries(SOURCE_TOKENS))}.forEach(([k, v]) => ov.style.setProperty(k, v));
    const names = new Set(); for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch (e) { continue; } for (const r of rules) { if (r.style) for (const p of r.style) if (p.startsWith('--ma-s-')) names.add(p); if (r.cssRules) for (const q of r.cssRules) if (q.style) for (const p of q.style) if (p.startsWith('--ma-s-')) names.add(p); } }
    for (const n of names) { const mm = /^--ma-s-([0-9a-f]{6})(?:-(\\d{3}))?/.exec(n); if (!mm) continue; const h = mm[1], a = mm[2] != null ? +mm[2] / 1000 : 1;
      ov.style.setProperty(n, 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')'); }
    return names.size; })()`);
  if (RULED_OFF) await x.ev(`(() => { const h = document.createElement('style'); h.id = '__ruledOff'; h.textContent = '#aSectionTournament .ma-rate[data-ma-gate="small"]{ color:inherit !important; }'; document.head.appendChild(h); return true; })()`);
  await x.ev(`aShowTab('tournament'), true`);
  for (let t = Date.now(); !(await x.ev(`!!document.querySelector('#aSectionTournament .tr-card')`)); ) { if (Date.now() - t > 30000) throw new Error('Tournament section never built'); await sleep(250); }
  await x.ev(arm); await x.ev(SETTLE);
  const man = [], leaves = {};
  for (const st of STATES) {
    if (ONLY && !ONLY.has(st.name)) continue;
    await x.ev(`(() => { fhCloseSheet(); ${arm}; _tr.S = Object.assign({ more: false, roi: false, recMore: [false, false] }, ${JSON.stringify(st.b)}); trRender(); return true; })()`);
    await sleep(st.pop === 'roi' ? 2500 : 150); await x.ev(SETTLE);
    if (st.sheet) { await x.ev(`(() => { const el = document.querySelector('#aSectionTournament .tr-row'); if (!el) throw new Error('no row'); el.click(); return true; })()`); await sleep(800); await x.ev(SETTLE); }
    if (st.pop) {
      const sel = st.pop === 'roi' ? '#trRoiPop > div' : '#fhSheet > div';
      // the ROI overlay lives on <body> (outside the modal box): it takes the modal's source-palette overrides too
      if (st.pop === 'roi') await x.ev(`(() => { const ov = document.getElementById('analysisModal'), o = document.querySelector('#trRoiPop > div'); for (const p of ov.style) if (p.startsWith('--')) o.style.setProperty(p, ov.style.getPropertyValue(p)); return true; })()`);
      const clip = await x.ev(B_POP(sel)); await sleep(100); await x.ev(SETTLE);
      await shot(x, clip, path.join(dir, st.name + '.png')); man.push({ name: st.name, ref: st.name, size: [clip.w, clip.h] });
      await x.ev(`(() => { for (const [e, s] of window.__saved) { if (s == null) e.removeAttribute('style'); else e.setAttribute('style', s); } document.getElementById('__capHide2').remove(); fhCloseSheet(); trSet({ roi: false }); return true; })()`);
      continue;
    }
    const fr = await x.ev(B_FRAME); await sleep(100); await x.ev(SETTLE);
    const clip = await x.ev(`(() => { const r = document.querySelector('#analysisModal .modal-analysis').getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: Math.round(r.width), h: Math.round(r.height) }; })()`);
    await shot(x, clip, path.join(dir, st.name + '.png'));
    leaves[st.name] = await x.ev(LEAVES(`document.getElementById('aSectionTournament')`));
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
  fs.writeFileSync(path.join(OUT, 'design-data.json'), JSON.stringify(D.data, null, 1));
  const B = await buildSide(bd, buildInputs(D.data));
  fs.writeFileSync(path.join(OUT, 'leaves.json'), JSON.stringify({ design: D.leaves, build: B.leaves }, null, 1));
  console.log('wrote', OUT);
}
main().then(() => { cleanup(); process.exit(0); }, (e) => { console.error('FAIL:', e.stack || e.message); cleanup(); process.exit(1); });
