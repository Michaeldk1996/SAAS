#!/usr/bin/env node
// TEN-338 — TEST-ONLY Match Stats tab capture for the Match analysis pixel diff (both halves in one tool). Never loaded by
// the live page and never run in CI: a manual tool, like tools/ten331-h2h-capture.mjs (whose clock, zone, viewport, raster
// flags, framing and helpers it repeats).
//
//   node tools/ten338-match-stats-capture.mjs <outDir> [--only a,b] [--theme night|day|source] [--ruled-off] [--real <dir>]
//
// Every state is captured on both sides and fed the SAME numbers:
//  * demo  — the design's own demo match (DF demoMatch, J. Sinner v C. Alcaraz 6-4 4-6 7-6). The design renders it as it
//            is; our build gets the design's numbers in our shapes: each scope's `maSheetFor` rows turned back into an
//            api-tennis box score (counts from the "(won/total)" subs; service / return games from the design's own
//            `svcGames` rule, DF L4189) and the design's `_fGen` point log turned into a pbp shard.
//  * np    — the design's demo match without a score (DF `msNotCompleted`, L2079); our fixture without a result.
//  * R1/R2 — two REAL matches (--real <dir>/<eventKey>/{match,pbp}.json, the deployed board match and its pbp shard).
//            Our build renders them through the shipped path (inline box score, pbp shard over HTTP). The design is fed
//            OUR model's output (fhSheetModel / fhSheetKeyModel / fhPbpSetModel, read from the build page) in its own
//            shapes: `maSheetFor` and `_fGen` return our rows / sets for the Match Stats tab's match, `demoMatch` returns
//            the real header. Bars in the design keep the design's rule (share of the two values) unless --ruled-off.
// FIXTURE MODE LIVES ONLY HERE: nothing reaches bsp-consult-dashboard.html; the fixture shards are served from
// <outDir>/overlay, never written into the checkout.
//
// --theme source: every modal shade token set to the source value its name carries (--ma-s-<hex>[-<alpha×1000>]) and the
//   role tokens to the design's source values, so the pixel diff isolates structure from the ruled palette.
// --ruled-off: undo the ruled differences for measurement (reported as such): player A's values / bars in the design's
//   blue, B's values white and bars at the design's 0.75 white (D4 neutral players), monograms for the ATP photos (D5), the design fed OUR bar widths (the 2026-09-24 bar
//   rule, a logged design exception) and the D2 grey / footnote hidden.
// Writes <outDir>/design/*.png, <outDir>/build/*.png, <outDir>/{design,build}/manifest.json, <outDir>/leaves.json,
// <outDir>/feeds.json. Structure: python3 tools/ten330-form-structure.py <outDir>/leaves.json. Regenerates nothing else.
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
const REAL = opt('--real') ? path.resolve(opt('--real')) : null;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!OUT) { console.error('usage: node tools/ten338-match-stats-capture.mjs <outDir> [--only a,b] [--theme night|day|source] [--ruled-off] [--real dir]'); process.exit(2); }
const FROZEN_NOW = Date.parse('2026-09-28T12:19:30+08:00');
const TZ = 'Asia/Makassar';
const VIEW_W = 1370, VIEW_H = 745;

// The real matches (eventKey → feed id). R1: 3 sets, tiebreaks in sets 1 and 2, no winners / errors in the feed (dashes).
// R2: 2 sets, tiebreak in set 1, winners / errors present.
const REALS = { R1: '12165823', R2: '12166238' };
// d = design state patch (DF maMsScope / maMsPbpSet); b = our sheet scope / pbp set.
const sc = (feed, name, scope, pbpSet) => ({ name, feed, d: { maMsScope: scope === 'pbp' ? 'pbp' : typeof scope === 'number' ? 's' + scope : scope, maMsPbpSet: 'set' + (pbpSet || 1) }, b: { scope, pbpSet: pbpSet || 1 } });
const STATES = [
  sc('demo', '08-match-stats-key-stats', 'key'), sc('demo', '08c-match-stats-match-view', 'match'),
  sc('demo', '08d-match-stats-set-1', 1), sc('demo', '08e-match-stats-set-2', 2), sc('demo', '08f-match-stats-set-3', 3),
  sc('demo', '08b-match-stats-point-by-point', 'pbp', 1), sc('demo', '08g-match-stats-pbp-set-3-tiebreak', 'pbp', 3),
  { name: '08h-match-stats-not-played', feed: 'np', d: {}, b: null },
  sc('R1', 'R1-key-stats', 'key'), sc('R1', 'R1-match', 'match'), sc('R1', 'R1-set-1', 1), sc('R1', 'R1-set-2', 2), sc('R1', 'R1-set-3', 3),
  sc('R1', 'R1-pbp-set-1-tiebreak', 'pbp', 1), sc('R1', 'R1-pbp-set-3', 'pbp', 3),
  sc('R2', 'R2-key-stats', 'key'), sc('R2', 'R2-match', 'match'), sc('R2', 'R2-set-1', 1), sc('R2', 'R2-pbp-set-1-tiebreak', 'pbp', 1),
].filter(s => !ONLY || ONLY.has(s.name));
const SOURCE_TOKENS = { '--ma-page': '#0a0d14', '--ma-card': '#0a0d14', '--ma-inner': '#06070a', '--ma-raised': '#11151f', '--ma-hover': 'rgba(255,255,255,0.03)',
  '--ma-sel': 'rgba(91,155,255,0.16)', '--ma-hair': 'rgba(255,255,255,0.09)', '--ma-hair-soft': 'rgba(255,255,255,0.05)', '--ma-hair-strong': 'rgba(255,255,255,0.14)',
  '--ma-outline': 'rgba(91,155,255,0.22)', '--ma-t1': '#e7e9ee', '--ma-t2': '#8b96b5', '--ma-t3': '#5b6880', '--ma-fill': '#5b9bff', '--ma-link': '#5b9bff',
  '--ma-pos': '#3dd68c', '--ma-neg': '#e0616f', '--ma-track': 'rgba(255,255,255,0.08)', '--ma-pb-fill': 'rgba(231,233,238,0.7)' };

async function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); }); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
// overlay first (fixture shards + indexes), then the checkout
function serve(roots, port, index) {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = null;
    for (const root of roots) { const g = path.join(root, rel === '/' ? '/' + index : rel); if (g.startsWith(root) && fs.existsSync(g) && !fs.statSync(g).isDirectory()) { f = g; break; } }
    if (!f) { res.writeHead(404); res.end(); return; }
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

async function browser(roots, index, extraInit) {
  const x = { profile: path.join(OUT, '.chrome-' + index.replace(/\W/g, '')) }; live.push(x);
  fs.rmSync(x.profile, { recursive: true, force: true });
  const port = await freePort(); x.srv = await serve(roots, port, index);
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
const LEAVES = (rootExpr) => `(() => { const root = ${rootExpr}; const R = root.getBoundingClientRect(); const out = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) { const t = n.textContent.replace(/\\s+/g, ' ').trim(); if (!t) continue; const el = n.parentElement; const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue; const rg = document.createRange(); rg.selectNodeContents(n); const b = rg.getBoundingClientRect(); if (!b.width) continue;
    let hid = false; for (let e = el; e && e !== root; e = e.parentElement) { const s = getComputedStyle(e); if (s.visibility === 'hidden' || +s.opacity === 0 || s.display === 'none') { hid = true; break; } } if (hid) continue;
    out.push({ t, x: +(b.left - R.left).toFixed(1), y: +(b.top - R.top).toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), fs: cs.fontSize, fw: cs.fontWeight, ff: cs.fontFamily.split(',')[0].replace(/['"]/g, ''), c: cs.color }); }
  return out; })()`;

// ---------------------------------------------------------------------------------------------------------------
// DESIGN side (tools/ten331-h2h-capture.mjs D_HELPERS + the Match Stats feed hooks)
const D_HELPERS = `window.__cap = (() => {
  const host = () => { const el = document.querySelector('.nav'); const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$'));
    for (let f = el[k]; f; f = f.return) if (f.stateNode && f.stateNode.logic && f.stateNode.logic.renderVals && 'maTab' in (f.stateNode.logic.state || {})) return f.stateNode;
    throw new Error('dc host not found'); };
  const modal = () => document.querySelector('.nav').closest('div[style*="88vh"], div[data-cap-modal]');
  const mkP = str => { let x = 0; for (let i = 0; i < str.length; i++) x = (x * 31 + str.charCodeAt(i)) >>> 0; return n => { x = (x * 1103515245 + 12345) >>> 0; return x % n; }; };   // DF L4880
  const api = { host, _saved: [], feed: null,
    reset() { const h = host(); h.logic.state = { maTab: null }; return new Promise((r) => h.forceUpdate(() => r(true))); },
    set(p) { const h = host(); return new Promise((r) => h.logic.setState(p, () => r(true))); },
    // The design's own Match Stats data (demo): each scope's maSheetFor rows + the _fGen point log, exactly as mkSheet asks.
    demoData() { const L = host().logic; const AN = L.mkAnalysis(L.demoMatch(), 1.54, 2.62); const mid = 'cur|' + AN.seed;
      const cs = AN.setScores.map(x => [+x.a, +x.b]), score = cs.map(x => x[0] + '-' + x[1]).join(' ');
      const scopes = { match: L.maSheetFor(mid + '|match', score, !!AN.aWon) };
      cs.forEach((x, i) => { scopes['s' + (i + 1)] = L.maSheetFor(mid + '|s' + (i + 1), x[0] + '-' + x[1], x[0] > x[1]); });
      if (typeof L._fGen !== 'function') throw new Error('DF _fGen not built yet');
      const det = L._fGen(mkP(mid + '|d'), mid, AN.aName, AN.bName, '#5b9bff', cs);
      return { aName: AN.aName, bName: AN.bName, sets: cs, won: !!AN.aWon, scopes, pbp: det.allPointSets }; },
    // Install a feed: null = the design as it is; {np:true} = no score; {match, scopes, pbp} = our model's output.
    install(F) { const L = host().logic; api.feed = F;
      if (!L.__orig) { L.__orig = { demoMatch: L.demoMatch, maSheetFor: L.maSheetFor };
        let fg = L._fGen; Object.defineProperty(L, '_fGen', { configurable: true, get() { return fg; }, set(v) { fg = function (pr, mid, ...r) { const d = v.call(this, pr, mid, ...r);
          if (api.feed && api.feed.pbp && String(mid).startsWith('cur|')) d.allPointSets = api.feed.pbp; return d; }; } }); }
      L.demoMatch = !F ? L.__orig.demoMatch : F.np ? function () { const m = L.__orig.demoMatch.call(this); return Object.assign({}, m, { a: Object.assign({}, m.a, { score: null, won: false }), b: Object.assign({}, m.b, { score: null, won: false }) }); }
        : function () { return F.match; };
      // the header prices come from renderVals' mkAnalysis arguments (DF L5300), not from the match: take the feed's
      if (!L.__orig.mkAnalysis) L.__orig.mkAnalysis = L.mkAnalysis;
      L.mkAnalysis = !F || !F.match ? L.__orig.mkAnalysis : function (mm, oa, ob) { const od = v => v != null ? v : { toFixed: () => '\u2014' };   // our dash for a missing close
        return L.__orig.mkAnalysis.call(this, mm, od(mm.a.odds), od(mm.b.odds)); };
      L.maSheetFor = !F || !F.scopes ? L.__orig.maSheetFor : function (seed, scoreStr, win) { const s = String(seed); if (!s.startsWith('cur|')) return L.__orig.maSheetFor.call(this, seed, scoreStr, win);
        const k = s.slice(s.lastIndexOf('|') + 1); const r = F.scopes[k]; if (!r) throw new Error('feed: no scope ' + k); return r; };
      return true; },
    _style(el, css) { api._saved.push([el, el.getAttribute('style')]); el.setAttribute('style', (el.getAttribute('style') || '') + ';' + css); },
    unframe() { for (const [el, s] of api._saved.reverse()) { if (s == null) el.removeAttribute('style'); else el.setAttribute('style', s); } api._saved = []; return true; },
    frameModal() { const m = modal(); m.setAttribute('data-cap-modal', '1'); const scrim = m.parentElement, body = m.children[1], menu = body.children[0], content = body.children[1];
      api._style(scrim, 'background:transparent !important; backdrop-filter:none !important; position:absolute !important; inset:auto !important; left:0 !important; top:0 !important; width:${1296 + 64}px !important; height:auto !important; min-height:${VIEW_H}px !important; align-items:flex-start !important; padding:32px !important;');
      api._style(m, 'height:auto !important; min-height:${Math.round(VIEW_H * 0.88)}px !important;'); api._style(body, 'flex:none !important; grid-template-rows:auto !important;'); api._style(menu, 'overflow:visible !important;'); api._style(content, 'overflow:visible !important;');
      return true; },
    clipModal() { const r = document.querySelector('[data-cap-modal]').getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: Math.round(r.width), h: Math.round(r.height) }; },
    contentRoot() { const m = document.querySelector('[data-cap-modal]') || modal(); return m.children[1].children[1]; },
  }; return api; })(); true`;

async function designBoot() {
  const x = await browser([HANDOFF], DESIGN);
  const t0 = Date.now();
  for (;;) { if (await x.ev(`!!document.querySelector('.nav') && document.readyState === 'complete'`).catch(() => false)) break; if (Date.now() - t0 > 60000) throw new Error('design did not mount'); await sleep(250); }
  await x.ev(D_HELPERS); await x.ev(`document.fonts.ready.then(() => true)`);
  await x.ev(`__cap.install(null)`);   // hooks _fGen before the first Match Stats render
  await x.ev(`__cap.reset()`); await x.ev(`__cap.set({ maTab: 'Match Stats' })`); await x.ev(SETTLE);
  return x;
}
async function designSide(x, dir, feeds) {
  const man = [], leaves = {};
  for (const st of STATES) {
    const F = st.feed === 'demo' ? null : st.feed === 'np' ? { np: true } : feeds[st.feed];
    await x.ev(`__cap.install(${JSON.stringify(F)})`);
    await x.ev(`__cap.reset()`); await x.ev(`__cap.set(${JSON.stringify(Object.assign({ maTab: 'Match Stats' }, st.d))})`); await x.ev(SETTLE);
    await x.ev(`__cap.frameModal()`); await sleep(100); await x.ev(SETTLE);
    const clip = await x.ev(`__cap.clipModal()`);
    await shot(x, clip, path.join(dir, st.name + '.png'));
    leaves[st.name] = await x.ev(LEAVES(`__cap.contentRoot()`));
    const cr = await x.ev(`(() => { const r = __cap.contentRoot().getBoundingClientRect(), m = document.querySelector('[data-cap-modal]').getBoundingClientRect(); return [Math.round(r.left - m.left), Math.round(r.top - m.top), Math.round(r.right - m.left), Math.round(r.bottom - m.top)]; })()`);
    man.push({ name: st.name, feed: st.feed, size: [clip.w, clip.h], content: cr });
    await x.ev(`__cap.unframe()`);
  }
  await x.ev(`__cap.install(null)`);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ design: path.join(HANDOFF, DESIGN), ruledOff: RULED_OFF, screens: man }, null, 1));
  return { leaves };
}

// ---------------------------------------------------------------------------------------------------------------
// The design's demo numbers in our shapes (DF maSheetFor rows → api-tennis box score; _fGen sets → pbp shard).
function demoToOurs(X) {
  const fr = (s) => { const m = /\((\d+)\/(\d+)\)/.exec(s || ''); return m ? { won: +m[1], total: +m[2] } : null; };
  const box = (rows, setSc) => {
    const R = {}; rows.sections.forEach((sec) => sec.rows.forEach((r) => { R[r.label] = r; }));
    const G = setSc.reduce((t, x) => t + x[0] + x[1], 0), gA = Math.round(G / 2), gB = G - gA;   // DF L4189 svcGames
    const side = (w) => { const sub = (l) => fr(R[l][w + 'Sub']);
      return { 'Service:Aces': +R['Aces'][w], 'Service:Double Faults': +R['Double faults'][w], 'Points:Winners': +R['Winners'][w], 'Points:Unforced errors': +R['Unforced errors'][w],
        raw: { 'Service:1st serve points won': sub('1st serve points won'), 'Service:2nd serve points won': sub('2nd serve points won'), 'Service:Break Points Saved': sub('Break points saved'),
          'Return:1st return points won': sub('1st return points won'), 'Return:2nd return points won': sub('2nd return points won'), 'Return:Break Points Converted': sub('Break points converted'),
          'Points:Net points won': sub('Net points won'), 'Points:Service Points Won': sub('Service points won'), 'Points:Return Points Won': sub('Return points won'), 'Points:Total Points Won': sub('Total points won') } }; };
    const a = side('a'), b = side('b'), cA = a.raw['Return:Break Points Converted'].won, cB = b.raw['Return:Break Points Converted'].won;
    a.raw['Games:Service games won'] = { won: gA - cB, total: gA }; a.raw['Games:Return games won'] = { won: cA, total: gB };
    b.raw['Games:Service games won'] = { won: gB - cA, total: gB }; b.raw['Games:Return games won'] = { won: cB, total: gA };
    return { p1: a, p2: b };
  };
  const setStats = {}; X.sets.forEach((s, i) => { setStats[String(i + 1)] = box(X.scopes['s' + (i + 1)], [s]); });
  const pbp = { p1: X.aName, p2: X.bName, sets: X.pbp.map((ps, i) => { let g = 0; const games = ps.games.map((gm) => ({ g: ++g, server: gm.serverA ? 'p1' : 'p2', winner: gm.aColor === '#e7e9ee' ? 'p1' : 'p2',
    score: gm.gA + ' - ' + gm.gB, points: gm.points.map((p, n) => Object.assign({ n: n + 1, s: p.txt.replace(':', ' - ') }, p.bp ? { bp: true } : {})) }));
    if (ps.tiebreak) ps.tb.pts.forEach((p) => games.push({ g: ++g, server: p.serverA ? 'p1' : 'p2', winner: p.aColor === '#e7e9ee' ? 'p1' : 'p2', score: p.a + ' - ' + p.b, points: [] }));
    return { set: i + 1, games }; }) };
  return { matchStats: box(X.scopes.match, X.sets), setStats, pbp };
}

// ---------------------------------------------------------------------------------------------------------------
// BUILD side
const FIXTURE = { id: 'past-9338001', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: null, p2Key: null, date: '2026-07-20',
  tour: 'ATP Washington', tournament: 'ATP Washington', tournamentRound: 'ATP Washington - Quarter-finals', surface: 'Hard',
  startTs: '2026-07-20T22:00:00Z', bestOdds: { p1: { price: 1.54 }, p2: { price: 2.62 } }, closingOdds: { p1: 1.54, p2: 2.62, bookmaker: 'fixture' },
  finalScore: { display: '6-4, 4-6, 7-6', sets: [{ p1: 6, p2: 4 }, { p1: 4, p2: 6 }, { p1: 7, p2: 6 }], p1Sets: 2, p2Sets: 1, winner: 'p1' } };
const B_FRAME = `(() => {
  const ov = document.getElementById('analysisModal'), m = ov.querySelector('.modal-analysis'), body = m.querySelector('.aanalysis-body-wrap');
  window.__saved = [document.documentElement, document.body, ov, m, body, m.querySelector('.asidenav'), m.querySelector('.abody')].map(e => [e, e.getAttribute('style')]);
  const st = (e, css) => e.setAttribute('style', (e.getAttribute('style') || '') + ';' + css);
  st(document.documentElement, 'background:transparent !important;'); st(document.body, 'background:transparent !important;');
  if (!document.getElementById('__capHide')) { const h = document.createElement('style'); h.id = '__capHide'; h.textContent = 'body > *:not(#analysisModal){ visibility:hidden !important; }'; document.head.appendChild(h); }
  st(ov, 'background:transparent !important; backdrop-filter:none !important; position:absolute !important; inset:auto !important; left:0 !important; top:0 !important; width:${1296 + 64}px !important; height:auto !important; min-height:${VIEW_H}px !important; align-items:flex-start !important; padding:32px !important;');
  st(m, 'height:auto !important; min-height:${Math.round(VIEW_H * 0.88)}px !important;'); st(body, 'flex:none !important; grid-template-rows:auto !important;');
  st(m.querySelector('.asidenav'), 'overflow:visible !important;'); st(m.querySelector('.abody'), 'overflow:visible !important;');
  const r = m.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: Math.round(r.width), h: Math.round(r.height) }; })()`;
const B_UNFRAME = `(() => { for (const [e, s] of window.__saved) { if (s == null) e.removeAttribute('style'); else e.setAttribute('style', s); } return true; })()`;
// Read OUR model for the open tab sheet and return it in the design's shapes (maSheetFor rows per scope, _fGen sets, the
// header as a DF match). Everything comes from the shipped functions: fhSheetKeyModel / fhSheetModel / fhPbpSetModel.
const B_FEED = (ruledOff) => `(() => { const S = _maMsSheet; if (!S) throw new Error('no tab sheet');
  const bar = (r, which) => { const a = r.a.v, b = r.b.v;
    if (${ruledOff}) { const w = fhStatBarWidth(r.kind, which === 'a' ? a : b, which === 'a' ? b : a, r.k); return (w == null ? 0 : w).toFixed(1) + '%'; }
    const x = Math.abs(which === 'a' ? (a || 0) : (b || 0)), t = Math.abs(a || 0) + Math.abs(b || 0) || 1; return (x / t * 100).toFixed(1) + '%'; };   // DF L4232 share of the two
  const dfRow = r => ({ label: r.label, a: r.a.txt, b: r.b.txt, aSub: r.a.sub || '', bSub: r.b.sub || '', aBar: bar(r, 'a'), bBar: bar(r, 'b') });
  const rows = j => { const M = fhSheetModel(j || null); return { keySection: { title: 'Key stats', rows: fhSheetKeyModel(j || null).map(dfRow) }, showDr: true, drA: M.dr[0].txt, drB: M.dr[1].txt,
    sections: M.sections.map(sec => ({ title: sec.title, rows: sec.rows.map(dfRow) })) }; };
  const scopes = { match: rows(S.match) }; for (let i = 1; i <= S.nSets; i++) scopes['s' + i] = rows(S.sets && S.sets[i]);
  const sh = S.pbp && fhPbpForA(S.pbp, S); const hi = '#e7e9ee', dim = '#5b6880', mut = '#4b5672';
  const setNos = sh ? sh.sets.map(s => Number(s.set)).sort((a, b) => a - b) : [], last = Math.max(S.nSets || 0, setNos[setNos.length - 1] || 0);
  const pbp = !sh ? [] : sh.sets.map(st => { const M = fhPbpSetModel(st, fhPbpMatchCtx(sh, S.bo)[st.set]);
    return { key: 'set' + st.set, label: M.label, games: M.games.map(g => ({ key: 'set' + st.set, gA: g.gA, gB: g.gB, serverA: g.serverA, serverB: g.serverB, aLost: g.aLost, bLost: g.bLost,
      aColor: g.aWon ? hi : dim, bColor: g.bWon ? hi : dim, points: g.points.map((p, i, arr) => ({ txt: p.txt, bp: p.bp, comma: i < arr.length - 1 })) })),
      tiebreak: !!M.tb, tb: M.tb ? { label: M.tb.label, pts: M.tb.pts.map(p => ({ a: p.a, b: p.b, serverA: p.serverA, serverB: p.serverB, aLost: p.aLost, bLost: p.bLost, sp: p.spA || p.spB, spA: p.spA, spB: p.spB,
        aColor: p.aWon ? hi : mut, bColor: p.bWon ? hi : mut })) } : { label: '', pts: [] } }; });
  // header: the sheet head's own meta line (tourn · surface · round · date, a dash where one is missing): the date is its last part
  const meta = document.querySelector('#aSectionMatchStats .ma-ms-sheet span[style*="letter-spacing:0.06em"]').textContent.split(' · ');
  const e = maMsSheetEntry(window.__fx), r = e.r;   // the pinned fixture: a board refresh can replace the matches array
  const gm = i => (r.sets || []).map(x => x[i]).join(' ');
  const match = { id: 'real', tourn: r.tourn, surface: r.surface || '\u2014', round: r.round || '\u2014', when: meta[meta.length - 1] + ' · 00:00',
    a: { name: e.e.aName, odds: r.price, score: gm(0), won: r.won === true }, b: { name: e.e.bName, odds: r.oppPrice, score: gm(1), won: r.won === false } };
  return { match, scopes, pbp }; })()`;

async function buildSide(dir, overlay, demo) {
  const x = await browser([overlay, ROOT], 'bsp-consult-dashboard.html', `var _b; Object.defineProperty(window, 'BSP', { configurable: true, get() { return _b; }, set(v) { if (v) { const u = Promise.resolve({ emailVerified: true }); v.requireVerified = () => u; v.requireAuth = () => u; } _b = v; } });`);
  const t0 = Date.now();
  while (!(await x.ev(`typeof matches === 'object' && Array.isArray(matches) && typeof openAnalysisModal === 'function' && typeof aShowTab === 'function'`).catch(() => false))) { if (Date.now() - t0 > 90000) throw new Error('dashboard did not boot'); await sleep(300); }
  await x.ev(`document.fonts.ready.then(() => true)`);
  if (!(await x.ev(`typeof fhPbpSetModel === 'function' && typeof buildMatchStatsSheet === 'undefined'`))) throw new Error('the page served is not this checkout (no fhPbpSetModel)');
  if (THEME === 'day' || THEME === 'night') await x.ev(`typeof maSetTheme === 'function' ? (maSetTheme(${JSON.stringify(THEME)}), true) : false`);
  const fixtures = { demo: Object.assign({}, FIXTURE, { matchStats: demo.matchStats, setStats: demo.setStats }),
    np: Object.assign({}, FIXTURE, { id: 'upcoming-9338002', finalScore: null, closingOdds: null, startTs: '2026-10-01T10:00:00Z' }) };
  for (const [k, ek] of Object.entries(REALS)) if (REAL) fixtures[k] = JSON.parse(fs.readFileSync(path.join(REAL, ek, 'match.json'), 'utf8'));
  const open = async (fx) => {
    await x.ev(`(() => { const fx = ${JSON.stringify(fx)}; const i = matches.findIndex(m => m.id === fx.id); if (i >= 0) matches.splice(i, 1); matches.push(fx); window.__fx = fx; return true; })()`);
    await x.ev(`(() => { if (typeof closeAnalysisModal === 'function') closeAnalysisModal(); openAnalysisModal(${JSON.stringify(fx.id)}); return true; })()`);
    if (THEME === 'source') await x.ev(`(() => { const ov = document.getElementById('analysisModal');
      ${JSON.stringify(Object.entries(SOURCE_TOKENS))}.forEach(([k, v]) => ov.style.setProperty(k, v));
      const names = new Set(); for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch (e) { continue; } for (const r of rules) { if (r.style) for (const p of r.style) if (p.startsWith('--ma-s-')) names.add(p); if (r.cssRules) for (const q of r.cssRules) if (q.style) for (const p of q.style) if (p.startsWith('--ma-s-')) names.add(p); } }
      for (const n of names) { const mm = /^--ma-s-([0-9a-f]{6})(?:-(\\d{3}))?/.exec(n); if (!mm) continue; const h = mm[1], a = mm[2] != null ? +mm[2] / 1000 : 1;
        ov.style.setProperty(n, 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')'); }
      return names.size; })()`);
    if (RULED_OFF) await x.ev(`(() => { const ov = document.getElementById('analysisModal'); ov.style.setProperty('--fh-pa', '#5b9bff'); ov.style.setProperty('--fh-pb', '#e7e9ee'); ov.style.setProperty('--ma-s-ffffff-750', 'rgba(255,255,255,0.75)');
      if (!document.getElementById('__ruledOff')) { const h = document.createElement('style'); h.id = '__ruledOff'; h.textContent = '#aSectionMatchStats .ma-sheet-gate{ display:none !important; } #aSectionMatchStats [data-ma-gate="small"]{ color:var(--fh-pa) !important; }'; document.head.appendChild(h); } return true; })()`);
    await x.ev(`aShowTab('matchstats'), true`);
  };
  // --ruled-off: the design draws monograms; ATP photos in the ring are ruled (D5) — monograms here, before any modal opens
  if (RULED_OFF) await x.ev(`(() => { atpPhotoFor = () => null; return true; })()`);
  const waitSheet = async (st) => {
    for (let t = Date.now(); ; ) {
      const ok = await x.ev(`(() => { const b = document.getElementById('maMsSheetBody'); if (!b) return !!document.querySelector('#aSectionMatchStats .ma-ms-notplayed'); const S = _maMsSheet;
        return !!S && !S.matchLoading && !S.setsLoading && !S.pbpLoading && !/Loading/.test(b.textContent) && (${st && st.b && st.b.scope === 'pbp'} ? !!S.pbp : true); })()`);
      if (ok) return; if (Date.now() - t > 30000) throw new Error('sheet never settled: ' + (st && st.name)); await sleep(200);
    }
  };
  const man = [], leaves = {}, feeds = {};
  let cur = null;
  for (const st of STATES.concat(Object.keys(REALS).filter(k => REAL && !STATES.some(s => s.feed === k)).map(k => ({ feed: k, feedOnly: true })))) {
    if (!fixtures[st.feed]) throw new Error('no fixture for feed ' + st.feed + (REAL ? '' : ' (pass --real)'));
    if (cur !== st.feed) { await open(fixtures[st.feed]); cur = st.feed; await waitSheet(null); }
    if (st.b) {
      await x.ev(`(() => { fhSheetScope(${JSON.stringify(st.b.scope)}, 'tab'); fhSheetPbpSet(${st.b.pbpSet}, 'tab'); return true; })()`);
      await waitSheet(st);
    }
    if (/^R/.test(st.feed) && !feeds[st.feed]) { await x.ev(`(() => { fhSheetScope('pbp', 'tab'); return true; })()`); await waitSheet({ b: { scope: 'pbp' } }); feeds[st.feed] = await x.ev(B_FEED(RULED_OFF));
      if (st.b) { await x.ev(`(() => { fhSheetScope(${JSON.stringify(st.b.scope)}, 'tab'); fhSheetPbpSet(${st.b.pbpSet}, 'tab'); return true; })()`); await waitSheet(st); } }
    if (st.feedOnly) continue;
    await sleep(150); await x.ev(SETTLE);
    const fr = await x.ev(B_FRAME); await sleep(100); await x.ev(SETTLE);
    const clip = await x.ev(`(() => { const r = document.querySelector('#analysisModal .modal-analysis').getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: Math.round(r.width), h: Math.round(r.height) }; })()`);
    await shot(x, clip, path.join(dir, st.name + '.png'));
    leaves[st.name] = await x.ev(LEAVES(`document.getElementById('aSectionMatchStats')`));
    const cr = await x.ev(`(() => { const r = document.querySelector('#analysisModal .abody').getBoundingClientRect(), m = document.querySelector('#analysisModal .modal-analysis').getBoundingClientRect(); return [Math.round(r.left - m.left), Math.round(r.top - m.top), Math.round(m.width), Math.round(m.height)]; })()`);
    man.push({ name: st.name, ref: st.name, feed: st.feed, size: [clip.w, clip.h], frame: fr, content: cr });
    await x.ev(B_UNFRAME);
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ servedThisCheckout: true, root: ROOT, theme: THEME, ruledOff: RULED_OFF, reals: REAL ? REALS : null, screens: man }, null, 1));
  return { leaves, feeds };
}

async function main() {
  const dd = path.join(OUT, 'design'), bd = path.join(OUT, 'build'), ov = path.join(OUT, 'overlay');
  for (const d of [dd, bd, path.join(ov, 'pbp')]) fs.mkdirSync(d, { recursive: true });
  const dx = await designBoot();
  const demoX = await dx.ev(`__cap.demoData()`);
  const demo = demoToOurs(demoX);
  // overlay: the pbp index + shards the fixtures need (demo = the design's log; R* = the deployed shard snapshot)
  const idx = ['9338001'];
  fs.writeFileSync(path.join(ov, 'pbp', '9338001.json'), JSON.stringify(demo.pbp));
  if (REAL) for (const ek of Object.values(REALS)) { fs.copyFileSync(path.join(REAL, ek, 'pbp.json'), path.join(ov, 'pbp', ek + '.json')); idx.push(ek); }
  fs.writeFileSync(path.join(ov, 'pbp-index.json'), JSON.stringify(idx));
  const B = await buildSide(bd, ov, demo);
  const D = await designSide(dx, dd, B.feeds);
  fs.writeFileSync(path.join(OUT, 'leaves.json'), JSON.stringify({ design: D.leaves, build: B.leaves }, null, 1));
  fs.writeFileSync(path.join(OUT, 'feeds.json'), JSON.stringify({ demoDesign: demoX, demoOurs: demo, real: B.feeds }, null, 1));
  console.log('wrote', OUT);
}
main().then(() => { cleanup(); process.exit(0); }, (e) => { console.error('FAIL:', e.stack || e.message); cleanup(); process.exit(1); });
