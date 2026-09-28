#!/usr/bin/env node
// TEN-312 / TEN-314 — TEST-ONLY design-side capture for the Match analysis pixel-diff harness.
// Never loaded by the live page and never run in CI: a manual tool. It renders the LOCKED design file
// (`Match Analysis Progression v1.dc.html`, via its own support.js runtime — React 18 + Babel from unpkg,
// so it needs network) in headless Chrome and writes one full-height PNG per reference screen, named
// exactly like the handoff's `screens/*.png`, so tools/ten312-pixel-diff.py can diff them.
//
//   node tools/ten312-design-capture.mjs <outDir> [--handoff <dir>] [--only <name,name>] [--gpu] [--eval <js>]
//
//   --handoff  the design_handoff_match_analysis_v1 folder (default design/handoff-ten312-match-analysis, committed; its screens/ stay out of the repo)
//   --only     capture just these screens (comma-separated names, no .png)
//   --gpu      GPU raster (matches screens/ at t=0 better, not deterministic) — default is software raster
//   --eval     debug: boot the design, print the JSON value of <js> (page context), exit — no captures
//   --palette night   recolour the rendered design through the token map (README §3 + TEN-314 U1–U24, Night 24b) before
//              each capture, so a diff against the tokenised build measures structure, not the ruled palette change
//              (TEN-337). Every computed colour the map does not cover is listed per screen in the manifest (`unmapped`).
//
// Writes <outDir>/<name>.png for every screen + <outDir>/manifest.json (name → state driven, clip, size).
// Regenerates nothing else. Chrome's profile lives in <outDir>/.chrome-profile and is removed on exit.
//
// FRAMING (how the reference screens/ were framed — reverse-engineered from their pixels, see report):
//  * The references are ELEMENT captures with a transparent background (RGBA; the modal's rounded corners
//    carry only box-shadow alpha, no overlay scrim). So: Emulation.setDefaultBackgroundColorOverride(a=0),
//    the page scrim is made transparent (and its backdrop-filter dropped), and we clip to the element.
//  * Tab screens = the modal box (border-box), grown to full content height: the modal's `height:88vh`
//    becomes `height:auto`, the menu + content columns lose their `overflow:auto`, so nothing scrolls.
//    Width: 1296 px, except screens whose content fits inside the 88vh frame, which the reference shows at
//    1306 px and exactly 656 px tall minimum (88vh of a 745 px viewport; 1306 = 1296 + the 10 px custom
//    page scrollbar that was absent when nothing overflowed). Rule used: natural (grown) height <= FIT_H →
//    width 1306, height max(656, natural); else width 1296.
//  * Pop-up screens (P*) = the pop-up's scrim element, 1001 px wide, cropped to the pop-up box ± 24 px
//    vertically, box grown to full height (max-height/overflow dropped); everything else is hidden.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const OUT = args[0] && !args[0].startsWith('--') ? path.resolve(args[0]) : null;
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const HANDOFF = path.resolve(opt('--handoff') || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'design', 'handoff-ten312-match-analysis'));
const ONLY = opt('--only') ? new Set(opt('--only').split(',')) : null;
const EVAL = opt('--eval');
// Raster: default = software (--disable-gpu): byte-identical PNGs run to run (verified 0 px over 41 screens).
// --gpu = GPU raster, which is what the reference screens/ were rasterised with (lower t=0 residual vs
// screens/, identical at t=8) but NOT deterministic (~4.7k px of low-bit AA noise across 41 screens per rerun).
const GPU = args.includes('--gpu');
const PALETTE = opt('--palette') || null;
if (PALETTE && PALETTE !== 'night') { console.error('--palette: only night is mapped'); process.exit(2); }
// Source colour (as Chrome computes it) → Night 24b token value, per property class (text | fill | line). Taken from the
// handoff README §3 table and match-analysis-tokens.css (U1–U24). Alpha ranges are README §3's.
const NIGHT = {
  t1: '#FFFFFF', t2: '#DDE0EA', t3: '#A3AABE', page: '#191B24', card: '#14151D', inner: '#181922', raised: '#1B1C27', hover: '#20222E',
  sel: '#222431', fill: '#5B82E8', link: '#9DB3F2', pos: '#5CCB84', neg: '#E06266', amber: '#E8A84E', onFill: '#06070A',
};
const PALETTE_RULES = [
  // [class, r, g, b, alpha lo, alpha hi, to]   class: text (color, svg stroke/fill) | svg (tried first for svg stroke/fill) | fill (background) | line (borders)
  ['text', 231, 233, 238, 1, 1, NIGHT.t1], ['text', 255, 255, 255, 1, 1, NIGHT.t1],
  ['text', 170, 179, 200, 1, 1, NIGHT.t2], ['text', 139, 150, 181, 1, 1, NIGHT.t2],
  ['text', 91, 104, 128, 1, 1, NIGHT.t3], ['text', 75, 86, 114, 1, 1, NIGHT.t3], ['text', 107, 117, 144, 1, 1, NIGHT.t3],
  ['text', 106, 174, 255, 1, 1, NIGHT.link], ['text', 91, 155, 255, 1, 1, NIGHT.link], ['text', 130, 180, 255, 1, 1, '#B5C6F5'],
  ['text', 61, 214, 140, 1, 1, NIGHT.pos], ['text', 224, 97, 111, 1, 1, NIGHT.neg], ['text', 232, 168, 78, 1, 1, NIGHT.amber],
  ['text', 6, 7, 10, 1, 1, NIGHT.onFill],
  // SVG stroke / fill: a blue is a chart line / bar (README §3 "bars, fills, chart lines" → fill); greys and signals as text
  ['svg', 106, 174, 255, 1, 1, NIGHT.fill], ['svg', 91, 155, 255, 1, 1, NIGHT.fill],
  ['fill', 16, 18, 27, 1, 1, NIGHT.card],   // #10121B soft ink (U8)
  ['fill', 14, 16, 25, 1, 1, NIGHT.card], ['fill', 10, 13, 20, 1, 1, NIGHT.card], ['fill', 12, 14, 22, 1, 1, NIGHT.inner], ['fill', 15, 20, 32, 1, 1, NIGHT.inner],
  ['fill', 19, 22, 35, 1, 1, NIGHT.raised], ['fill', 6, 7, 10, 1, 1, NIGHT.inner], ['fill', 17, 20, 31, 1, 1, NIGHT.hover],
  ['fill', 255, 255, 255, 0.04, 0.04, NIGHT.hover], ['fill', 91, 155, 255, 0.06, 0.22, NIGHT.sel],
  ['fill', 106, 174, 255, 1, 1, NIGHT.fill], ['fill', 91, 155, 255, 1, 1, NIGHT.fill], ['fill', 61, 214, 140, 1, 1, NIGHT.pos],
  ['fill', 224, 97, 111, 1, 1, NIGHT.neg], ['fill', 232, 168, 78, 1, 1, NIGHT.amber], ['fill', 91, 104, 128, 1, 1, NIGHT.t3],
  ['fill', 255, 255, 255, 0.08, 0.08, 'rgba(255, 255, 255, 0.08)'], ['fill', 255, 255, 255, 0.15, 0.15, 'rgba(255, 255, 255, 0.15)'],
  ['line', 255, 255, 255, 0.06, 0.09, 'rgba(255, 255, 255, 0.05)'], ['line', 255, 255, 255, 0.03, 0.05, 'rgba(255, 255, 255, 0.035)'],
  ['line', 255, 255, 255, 0.10, 0.16, 'rgba(255, 255, 255, 0.1)'], ['line', 255, 255, 255, 0.18, 0.25, 'rgba(255, 255, 255, 0.2)'],
  ['line', 91, 155, 255, 0.20, 0.45, 'rgba(157, 179, 242, 0.3)'], ['line', 106, 174, 255, 0.75, 0.75, 'rgba(157, 179, 242, 0.75)'],
  ['line', 224, 97, 111, 0.35, 0.35, 'rgba(224, 98, 102, 0.35)'], ['line', 232, 168, 78, 0.35, 0.45, null],   // amber keeps its value
];
const DESIGN = 'Match Analysis Progression v1.dc.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!OUT) { console.error('usage: node tools/ten312-design-capture.mjs <outDir> [--handoff dir] [--only a,b] [--eval js]'); process.exit(2); }

// The News tab stamps each sample article `Date.now() - h hours`; the reference 04-news.png reads
// "Sep 28 · 11:19" for h=1 in the capturing machine's zone (WITA, UTC+8). Freeze the clock there.
const FROZEN_NOW = Date.parse('2026-09-28T12:19:30+08:00');
const TZ = 'Asia/Makassar';
const VIEW_W = 1370, VIEW_H = 745;          // 1370 − 2×32 overlay padding = 1306 modal; 88vh = 656
const FIT_H = 760;                          // natural modal height at or under this → the 1306-wide frame
const POP_W = 1001;

// ---------------------------------------------------------------------------------------------------
// Screens. Each screen starts from a clean state ({maTab:null}); `state` is merged via the component's
// own setState; `click` steps click the first element whose trimmed textContent equals / matches the text
// (the same handlers a user fires). `pop` = pop-up framing, else modal framing.
// ---------------------------------------------------------------------------------------------------
const tab = (t, extra) => ({ state: Object.assign({ maTab: t }, extra || {}) });
const NEWS_RESET = { js: `(() => { delete window.STENNISFY_NEWS; const L = __cap.host().logic; if (L.__nf) L.newsFor = L.__nf; return true; })()` };
const FORM_SHEET = [tab('Form'), { click: '18.07.', nth: 0 }];   // Sinner's row v T. Griekspoor, Washington R16
const SCREENS = [
  { name: '01-progression', steps: [tab('Progression')] },
  { name: '01b-progression-round-highlight-metric-filter', steps: [tab('Progression', { maPgHi: 1, maPgMet: { dominance: true, serveRating: true, returnRating: true } })] },
  { name: '01c-progression-r1-empty', steps: [tab('Progression'), { click: 'R1', nth: 0 }] },
  { name: '01d-progression-facing-final', steps: [tab('Progression'), { click: 'F', nth: 0 }] },
  { name: '02-overview', steps: [tab('Overview')] },
  { name: '03-key-factors', steps: [tab('Key factors')] },
  { name: '04-news', steps: [tab('News')] },
  { name: '04b-news-article-expanded', steps: [tab('News', { maNewsOpen: 'a:s1' })] },
  // TEN-333: the file's other News states (no screens/ PNG). Filter = the segmented control's own state; empty = the
  // file's `window.STENNISFY_NEWS` hook given an empty feed; unavailable = the template's drawn branch, which the file
  // itself never reaches (its sample fallback), forced through newsFor's own return. Each starts from NEWS_RESET.
  { name: '04c-news-filter-player-a', steps: [NEWS_RESET, tab('News', { maNewsFilter: 'a' })] },
  { name: '04d-news-filter-player-b', steps: [NEWS_RESET, tab('News', { maNewsFilter: 'b' })] },
  { name: '04e-news-empty', steps: [NEWS_RESET, { js: 'window.STENNISFY_NEWS = []' }, tab('News')] },
  { name: '04f-news-unavailable', steps: [NEWS_RESET, { js: `(() => { const L = __cap.host().logic; L.__nf = L.__nf || L.newsFor;
    L.newsFor = function (AN, S) { return Object.assign({}, L.__nf.call(this, AN, S), { unavailable: true, isEmpty: false, hasAny: false, groups: [] }); }; return true; })()` }, tab('News')] },
  { name: '05-playing-style', steps: [tab('Playing style')] },
  { name: '05b-playing-style-meetings-profile-open', steps: [tab('Playing style', { psMeetA: true, psProf: true })] },
  { name: '06-form', steps: [tab('Form')] },
  { name: '06b-form-data-and-hot-lines-open', steps: [tab('Form', { maFormCard: true, maFormHot: true })] },
  { name: '06c-form-all-lines', steps: [tab('Form', { maFormCard: true, maFormHot: true, maFormHotAll0: true, maFormHotAll1: true })] },
  { name: '07-h2h', steps: [tab('H2H')] },
  // the reference shows Hard WITHOUT all lines (clicking Hard resets h2AllLines — the designer's click order)
  { name: '07b-h2h-hard-filter-all-lines', steps: [tab('H2H', { h2AllLines: true }), { click: 'Hard', nth: 0 }] },
  { name: '07c-h2h-one-meeting', steps: [tab('H2H', { h2State: 'one' })] },
  // the reference reads "ON CLAY 0 — 0 · No meetings on clay." with no chip lit: that is h2Surf:'clay' (lower-case, matches no
  // meeting's 'Clay'); the canonical 'Clay' chip has 2 meetings and Grass (0) is unclickable.
  { name: '07d-h2h-surface-with-no-meetings', steps: [tab('H2H', { h2Surf: 'clay' })] },
  { name: '07e-h2h-no-meetings', steps: [tab('H2H', { h2State: 'none' })] },
  { name: '08-match-stats-key-stats', steps: [tab('Match Stats')] },
  { name: '08b-match-stats-point-by-point', steps: [tab('Match Stats'), { click: 'Point by point', nth: 0 }] },
  { name: '08c-match-stats-match-view', steps: [tab('Match Stats'), { click: 'Match', nth: 0 }] },
  { name: '09-tournament', steps: [tab('Tournament')] },
  { name: '09b-tournament-earlier-editions', steps: [tab('Tournament', { maTourMore: true })] },
  // The embedded Database.dc.html injects a global `body{background:#06070a}` helmet that outlives the panel, so
  // this screen is captured LAST (runLast) — otherwise every later pop-up's scrim is composited on an opaque body.
  { name: '09c-tournament-court-speed-panel', steps: [tab('Tournament', { maRoi: true })], inModalOverlay: true, runLast: true },
  { name: '10-weather-state-c', steps: [tab('Weather', { maWxState: 'c' })] },
  { name: '10b-weather-state-a-calm', steps: [tab('Weather', { maWxState: 'a' })] },
  { name: '10c-weather-state-d-indoor', steps: [tab('Weather', { maWxState: 'd' })] },
  { name: '10d-weather-state-e-unavailable', steps: [tab('Weather', { maWxState: 'e' })] },
  // state b is drawn by the file's STATE switcher but has no screens/ PNG (TEN-337 diffs every designed state)
  { name: '10e-weather-state-b-one-problem-day', steps: [tab('Weather', { maWxState: 'b' })] },
  { name: '11-odds', steps: [tab('Odds')] },
  { name: '11b-odds-novig-market-selected', steps: [tab('Odds', { maOddsNovig: true, maMarket: 'Game handicap' })] },
  { name: '12-market-edge-match-winner', steps: [tab('Market edge', { meView: 'winner' })] },
  { name: '12b-market-edge-derived-lines', steps: [tab('Market edge', { meView: 'lines' })] },
  { name: 'P1-match-stats-sheet-key-stats', pop: true, steps: FORM_SHEET },
  { name: 'P1b-match-stats-sheet-point-by-point', pop: true, steps: [...FORM_SHEET, { click: 'Point by point', nth: 0 }] },
  { name: 'P1c-match-stats-sheet-match-stats', pop: true, steps: [...FORM_SHEET, { click: 'Match', nth: 0 }] },
  { name: 'P2-odds-movement-popup', pop: true, steps: [tab('Odds', { maMvBook: 'Pinnacle' })] },
  { name: 'P3-market-edge-band-popup', pop: true, steps: [tab('Market edge', { meView: 'winner', meBand: 'a2' })] },
  { name: 'P4-market-edge-line-popup-today-band', pop: true, steps: [tab('Market edge', { meView: 'lines', meLine: 'a|0', meLineScope: 'band' })] },
  { name: 'P5-overview-season-surface-popup', pop: true, steps: [tab('Overview', { maOvCell: '0|season|Hard' })] },
  { name: 'P5b-overview-year-total-popup', pop: true, steps: [tab('Overview', { maOvCell: '0|2026|Total' })] },
  { name: 'P6-progression-box-match-sheet', pop: true, steps: [tab('Progression'), { click: '3-6 6-3 7-5', nth: 0 }, { click: 'Match', nth: 0 }] },   // reference is on the Match scope
];

// ---------------------------------------------------------------------------------------------------
async function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
function serve(root, port) {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = path.join(root, rel);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r(srv)));
}
async function cdpTarget(dport, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const l = await (await fetch(`http://127.0.0.1:${dport}/json`)).json(); const p = l.find((t) => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch {}
    await sleep(200);
  }
  throw new Error('no CDP page target');
}
function client(url) {
  const ws = new WebSocket(url); let id = 0; const pending = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = () => res(); ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, (m) => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result));
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
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
  profile = path.join(OUT, '.chrome-profile');
  fs.rmSync(profile, { recursive: true, force: true });
  const port = await freePort();
  srv = await serve(HANDOFF, port);
  const dport = await freePort();
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${profile}`,
    '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check', '--force-device-scale-factor=1',
    '--hide-scrollbars', '--font-render-hinting=none', ...(GPU ? [] : ['--disable-gpu']), '--disable-partial-raster', '--disable-threaded-animation', '--disable-checker-imaging', `--window-size=${VIEW_W},${VIEW_H}`, 'about:blank'], { stdio: 'ignore' });
  c = client(await cdpTarget(dport)); await c.ready;
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false });
  await c.send('Emulation.setTimezoneOverride', { timezoneId: TZ });
  await c.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  // Frozen clock (only Date; the design has no Math.random / performance.now use).
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const T = ${FROZEN_NOW}, RD = Date;
    function D(...a) { if (!new.target) return new RD(T).toString(); return a.length ? new RD(...a) : new RD(T); }
    D.prototype = RD.prototype; D.now = () => T; D.parse = RD.parse; D.UTC = RD.UTC;
    Object.defineProperty(D.prototype, 'constructor', { value: D });
    window.Date = D;
  })();` });

  const ev = async (expr) => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result?.value;
  };
  await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/${encodeURIComponent(DESIGN)}` });
  // Boot: support.js loads React + Babel from unpkg, compiles the class, mounts. Wait for the modal.
  const t0 = Date.now();
  for (;;) {
    const ok = await ev(`!!document.querySelector('.nav') && document.readyState === 'complete'`).catch(() => false);
    if (ok) break;
    if (Date.now() - t0 > 60000) throw new Error('design did not mount within 60 s');
    await sleep(250);
  }
  await ev(HELPERS);
  await ev(`document.fonts.ready.then(() => document.fonts.status)`);
  if (EVAL) { console.log(JSON.stringify(await ev(EVAL), null, 1)); return; }

  const manifest = [];
  const ORDER = SCREENS.filter((x) => !x.runLast).concat(SCREENS.filter((x) => x.runLast));
  for (const sc of ORDER) {
    if (ONLY && !ONLY.has(sc.name)) continue;
    await ev(`__cap.reset()`);
    for (const st of sc.steps) {
      if (st.state) await ev(`__cap.set(${JSON.stringify(st.state)})`);
      if (st.click) await ev(`__cap.click(${JSON.stringify(st.click)}, ${JSON.stringify(st.within || null)}, ${st.nth || 0})`);
      if (st.js) await ev(st.js);
      await ev(`__cap.settle()`);
    }
    await ev(`document.fonts.ready`);
    const unmapped = PALETTE ? await ev(`__cap.recolour(${JSON.stringify(PALETTE_RULES)}, ${JSON.stringify(NIGHT.page)})`) : undefined;
    const frame = await ev(sc.pop ? `__cap.framePop()` : `__cap.frameModal(${FIT_H}, ${!!sc.inModalOverlay})`);
    await sleep(120);
    await ev(`__cap.settle()`);
    const clip = await ev(sc.pop ? `__cap.clipPop()` : `__cap.clipModal()`);
    const shot = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true,
      clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 1 } });
    fs.writeFileSync(path.join(OUT, sc.name + '.png'), Buffer.from(shot.data, 'base64'));
    const state = await ev(`__cap.stateSummary()`);
    manifest.push({ name: sc.name, steps: sc.steps, state, frame, size: [clip.w, clip.h], ...(unmapped ? { unmapped } : {}) });
    console.log(`${sc.name.padEnd(48)} ${clip.w}x${clip.h}`);
    await ev(`__cap.unframe()`);
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ design: path.join(HANDOFF, DESIGN), frozenNow: new Date(FROZEN_NOW).toISOString(), timezone: TZ,
    raster: GPU ? 'gpu' : 'software', palette: PALETTE, viewport: [VIEW_W, VIEW_H], fitH: FIT_H, popW: POP_W, screens: manifest }, null, 1));
}

// In-page helpers. The component instance is found through React's fiber on a rendered node: walk up
// to the dc-runtime host (the wrapper whose `.logic` is the `class Component extends DCLogic`), then call
// the logic's own setState — the same path every onClick in the design takes.
const HELPERS = `window.__cap = (() => {
  const host = () => {
    const el = document.querySelector('.nav');
    const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$'));
    for (let f = el[k]; f; f = f.return) if (f.stateNode && f.stateNode.logic && f.stateNode.logic.renderVals && 'maTab' in (f.stateNode.logic.state || {})) return f.stateNode;
    throw new Error('dc host not found');
  };
  const flush = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30))));
  const modal = () => document.querySelector('.nav').closest('div[style*="88vh"], div[data-cap-modal]');
  const api = {
    host,
    reset() { const h = host(); h.logic.state = { maTab: null }; return new Promise((r) => h.forceUpdate(() => r(true))); },
    set(patch) { const h = host(); return new Promise((r) => h.logic.setState(patch, () => r(true))); },
    stateSummary() { const s = host().logic.state; const o = {}; for (const k in s) if (s[k] != null && typeof s[k] !== 'function') o[k] = s[k]; return o; },
    async settle() {
      await flush();
      // finish any CSS animation / transition (sigIn, seg transitions) so nothing is mid-flight
      // finite ones (sigIn, .14s seg transitions) jump to their end; infinite ones (skeleton pulse, live dots)
      // cannot finish, so they are paused at t=0 — otherwise every run catches them at a different phase.
      for (const a of document.getAnimations()) {
        const it = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming().iterations : 1;
        try { if (it === Infinity) { a.pause(); a.currentTime = 0; } else a.finish(); } catch (e) {}
      }
      await flush();
      return true;
    },
    click(text, within, nth) {
      const root = within ? document.querySelector(within) : document;
      const want = (t) => text.startsWith('/') ? new RegExp(text.slice(1, text.lastIndexOf('/')), text.slice(text.lastIndexOf('/') + 1)).test(t) : t === text;
      const all = [...root.querySelectorAll('*')].filter((e) => want((e.textContent || '').replace(/\\s+/g, ' ').trim()) && e.getClientRects().length);
      // deepest matches only (the element itself, not its ancestors)
      const leaves = all.filter((e) => !all.some((o) => o !== e && e.contains(o)));
      const el = leaves[nth];
      if (!el) throw new Error('click: no element for ' + text + ' (' + leaves.length + ' matches)');
      el.click();
      return true;
    },
    // --- palette (--palette): every computed colour in the modal through the token map; the modal box and its layout
    // wrappers (#0A0D14 as the modal surface) take the page token. Returns the colours no rule covered. ------------
    recolour(rules, pageTo) {
      const m = modal(), wrappers = new Set([m, m.children[0], m.children[1], ...(m.children[1] ? m.children[1].children : [])]);
      const cls = { color: 'text', stroke: 'text', fill: 'text', backgroundColor: 'fill', borderTopColor: 'line', borderRightColor: 'line', borderBottomColor: 'line', borderLeftColor: 'line' };
      const css = { color: 'color', stroke: 'stroke', fill: 'fill', backgroundColor: 'background-color', borderTopColor: 'border-top-color', borderRightColor: 'border-right-color', borderBottomColor: 'border-bottom-color', borderLeftColor: 'border-left-color' };
      const miss = {}, hex = h => h[0] === '#' ? 'rgb(' + [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ') + ')' : h;
      const targets = new Set(rules.map(x => x[6]).filter(Boolean).map(hex).concat([hex(pageTo)]));   // inherited, already mapped
      for (const el of [m, ...m.querySelectorAll('*')]) {
        const cs = getComputedStyle(el), isSvg = el instanceof SVGElement;
        for (const k in cls) {
          if ((k === 'stroke' || k === 'fill') && !isSvg) continue;
          if (k.startsWith('border') && !(parseFloat(cs[k.replace('Color', 'Width')]) > 0)) continue;
          const v = cs[k] || '';
          if (!/^rgba?[(]/.test(v)) continue;          // none, url(), currentcolor…
          const mm = [v].concat(v.slice(v.indexOf('(') + 1, v.lastIndexOf(')')).split(',').map(Number));
          const a = mm[4] == null ? 1 : +mm[4];
          if (a === 0) continue;
          let to;
          if (k === 'backgroundColor' && wrappers.has(el) && +mm[1] === 10 && +mm[2] === 13 && +mm[3] === 20) to = pageTo;
          else { const hit = c => rules.find(x => x[0] === c && +mm[1] === x[1] && +mm[2] === x[2] && +mm[3] === x[3] && a >= x[4] - 1e-9 && a <= x[5] + 1e-9);
            const r = (isSvg && (k === 'stroke' || k === 'fill') && hit('svg')) || hit(cls[k]);
            if (!r) { if (!targets.has(v)) miss[cls[k] + ' ' + v] = (miss[cls[k] + ' ' + v] || 0) + 1; continue; } to = r[6]; }
          if (to) api._style(el, css[k] + ':' + to + ' !important;');
        }
      }
      return miss;
    },
    // --- framing -------------------------------------------------------------------------------------
    _saved: [],
    _style(el, css) { api._saved.push([el, el.getAttribute('style')]); el.setAttribute('style', (el.getAttribute('style') || '') + ';' + css); },
    unframe() { for (const [el, s] of api._saved.reverse()) { if (s == null) el.removeAttribute('style'); else el.setAttribute('style', s); } api._saved = []; return true; },
    _grow() {
      const m = modal(); m.setAttribute('data-cap-modal', '1');
      const scrim = m.parentElement, body = m.children[1], menu = body.children[0], content = body.children[1];
      api._style(scrim, 'background:transparent !important; backdrop-filter:none !important; position:absolute !important; inset:auto !important; left:0 !important; top:0 !important; width:${VIEW_W}px !important; height:auto !important; min-height:${VIEW_H}px !important; align-items:flex-start !important;');
      api._style(m, 'height:auto !important;');
      api._style(body, 'flex:none !important; grid-template-rows:auto !important;');
      api._style(menu, 'overflow:visible !important;');
      api._style(content, 'overflow:visible !important;');
      return { m, scrim, body, menu, content };
    },
    frameModal(fitH, inOverlay) {
      const { m, scrim } = api._grow();
      if (inOverlay) {
        // an in-modal overlay (Tournament's court-speed panel): position:fixed would pin it to the 745 px
        // viewport; the reference shows it covering the whole grown modal, so anchor it to the modal box.
        api._style(m, 'position:relative !important;');
        for (const d of m.querySelectorAll('div')) if (getComputedStyle(d).position === 'fixed') api._style(d, 'position:absolute !important; inset:0 !important;');
      }
      // natural height at the 1306 frame
      let h = m.getBoundingClientRect().height, w = 1306;
      if (h > fitH) { w = 1296; }
      api._style(scrim, 'width:' + (w + 64) + 'px !important; padding:32px !important;');
      api._style(m, 'min-height:${Math.round(VIEW_H * 0.88)}px !important;');
      return { kind: 'modal', naturalH: Math.round(h), width: w };
    },
    clipModal() { const r = document.querySelector('[data-cap-modal]').getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: Math.round(r.width), h: Math.round(r.height) }; },
    _popScrim() {
      // the open pop-up = the top-most fixed scrim inside the modal content (z-index > 80's children)
      const m = modal();
      const cands = [...m.querySelectorAll('div')].filter((d) => getComputedStyle(d).position === 'fixed' && d.getClientRects().length);
      if (!cands.length) throw new Error('no pop-up open');
      cands.sort((a, b) => (+getComputedStyle(b).zIndex || 0) - (+getComputedStyle(a).zIndex || 0));
      return cands[0];
    },
    framePop() {
      const ps = api._popScrim(); ps.setAttribute('data-cap-pop', '1');
      // the visible box = first descendant that paints a background (skips transparent wrappers)
      const flowKid = (el) => [...el.children].find((x) => x.getClientRects().length && getComputedStyle(x).position !== 'absolute') || [...el.children].find((x) => x.getClientRects().length);
      let box = flowKid(ps);   // skips the absolute inset-0 click-catcher some scrims carry
      while (box && /rgba\(0, 0, 0, 0\)|transparent/.test(getComputedStyle(box).backgroundColor) && box.children.length) box = flowKid(box) || box.children[0];
      box.setAttribute('data-cap-box', '1');
      const { m, scrim } = api._grow();
      api._style(document.querySelector('section'), 'visibility:hidden !important;');
      api._style(ps, 'visibility:visible !important; position:absolute !important; inset:auto !important; left:0 !important; top:0 !important; width:${POP_W}px !important; height:auto !important; overflow:visible !important; padding-top:24px !important; padding-bottom:24px !important;');
      api._style(box, 'max-height:none !important; overflow:visible !important;');
      // the pop-up's own inner scroll areas grow too
      for (const d of box.querySelectorAll('div')) { const cs = getComputedStyle(d); if (/(auto|scroll)/.test(cs.overflowY) && d.scrollHeight > d.clientHeight + 1) api._style(d, 'max-height:none !important; overflow:visible !important;'); }
      return { kind: 'pop', width: ${POP_W}, zIndex: getComputedStyle(ps).zIndex };
    },
    clipPop() {
      const ps = document.querySelector('[data-cap-pop]'), b = document.querySelector('[data-cap-box]');
      const r = ps.getBoundingClientRect(), br = b.getBoundingClientRect();
      return { x: r.left + scrollX, y: br.top - 24 + scrollY, w: Math.round(r.width), h: Math.round(br.height + 48) };
    },
  };
  return api;
})(); true`;

main().then(() => { cleanup(); process.exit(0); }, (e) => { console.error('FAIL:', e.stack || e.message); cleanup(); process.exit(1); });
