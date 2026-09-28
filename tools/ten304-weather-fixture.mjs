#!/usr/bin/env node
// TEN-304 · TEST-ONLY pixel fixture for the Match analysis → Weather tab. Never loaded by the live page:
// it serves this worktree locally, opens the real dashboard in headless Chrome at the design's preview
// size (924×540, DPR 1), feeds the tab the spec's §7 sample data (states a, b, c, e) through the page's
// own lazy-load caches, and pixel-diffs each scrolled slice against design/handoff-weather/*.png.
//
//   node tools/ten304-weather-fixture.mjs <outDir>
//
// Each reference slice is matched to the scroll offset of the modal body that minimises the diff (the
// references are scrolled slices; our tab has no STATE switcher row, so offsets differ). A pixel
// "differs" when any channel is off by more than TOL (the references are JPEGs). Writes, per image,
// <name>-side.png (reference | ours | differing pixels in red) and prints a JSON table.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFile } from './ten304-weather-harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || join(ROOT, '.ten304-fixture');
const TOL = 40;
mkdirSync(OUT, { recursive: true });

// ── spec §7 sample data, in build-weather.js's file shape ─────────────────────────────────────────
const TZ = 'America/New_York';                                  // Washington
const DAYS = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26'];
const NOW = Date.parse('2026-07-20T14:00:00Z');                 // Mon Jul 20, 10:00 venue time
const CODE = { sun: 0, cloud: 3, rain: 61 };
const WEEK = {
  a: [['sun', 26, 17], ['sun', 27, 18], ['cloud', 25, 17], ['sun', 26, 16], ['cloud', 24, 16], ['sun', 25, 17], ['cloud', 24, 15]],
  b: [['sun', 26, 17], ['cloud', 25, 17], ['sun', 27, 18], ['cloud', 24, 16], ['cloud', 23, 16], ['rain', 21, 15], ['cloud', 23, 15]],
  c: [['cloud', 29, 21], ['rain', 24, 18], ['sun', 27, 18], ['sun', 28, 19], ['cloud', 26, 18], ['cloud', 25, 17], ['sun', 26, 17]],
};
// match-time values at 18:00 venue (gusts, avg wind, feels, temp, humidity, rain %, rain mm)
const MT = {
  a: { gusts: 14, wind: 8, feels: 25, temp: 24, humidity: 52, rainChance: 5, rainMm: 0 },
  b: { gusts: 16, wind: 9, feels: 27, temp: 26, humidity: 55, rainChance: 8, rainMm: 0 },
  c: { gusts: 38, wind: 22, feels: 31, temp: 29, humidity: 64, rainChance: 12, rainMm: 0.1 },
};
// in-window flags (the day's worst hour between 10:00 and 23:00)
const FLAGS = {
  a: {},
  b: { '2026-07-25': { 14: { rainChance: 72, gusts: 31 } } },
  c: { '2026-07-20': { 13: { feels: 33 } }, '2026-07-21': { 15: { rainChance: 44 } } },
};
function stateFile(k) {
  return makeFile({ tz: TZ, venue: 'Washington', from: '2026-07-18', days: 12,
    fetchedAt: new Date(NOW - 2 * 3600e3).toISOString(),
    day: d => { const i = DAYS.indexOf(d); return i < 0 ? {} : { code: CODE[WEEK[k][i][0]], hi: WEEK[k][i][1], lo: WEEK[k][i][2] }; },
    hour: (d, h) => Object.assign({}, d === '2026-07-20' && h === 18 ? MT[k] : {}, (FLAGS[k][d] || {})[h] || {}) });
}
// Mon Jul 20 18:00 Washington (EDT) = 22:00Z = 00:00 Tue in Berlin, the api-tennis wall clock.
const MATCH = { id: 'ten304-fixture', tour: 'ATP Washington', tournamentRound: 'Quarter-finals', date: '2026-07-21', time: '00:00',
  p1: 'J. Sinner', p2: 'C. Alcaraz', surface: 'Hard', courtSpeed: { abstractSpeed: 0.98, category: 'Medium' } };   // the reference renders show 0.98 (Medium)
const STATES = {
  a: { entry: { key: 'Washington', indoor: false, file: 'weather/fx-a.json' }, file: stateFile('a') },
  b: { entry: { key: 'Washington', indoor: false, file: 'weather/fx-b.json' }, file: stateFile('b') },
  c: { entry: { key: 'Washington', indoor: false, file: 'weather/fx-c.json' }, file: stateFile('c') },
  e: { entry: { key: 'Washington', indoor: false, file: null }, file: null },
  d: { entry: { key: 'Washington', indoor: true, file: null }, file: null },
};

// ── serve + drive ────────────────────────────────────────────────────────────────────────────────
const port = 18000 + Math.floor(Math.random() * 1000);
const srv = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=0',
  '--user-data-dir=' + join(OUT, 'profile'), '--window-size=924,540', '--force-device-scale-factor=1', '--hide-scrollbars', 'about:blank']);
const stop = () => { try { chrome.kill(); } catch {} try { srv.kill(); } catch {} };
process.on('exit', stop);
let dbg;
await new Promise(r => chrome.stderr.on('data', d => { const m = String(d).match(/127\.0\.0\.1:(\d+)\//); if (m && !dbg) { dbg = m[1]; r(); } }));
let page;
for (let i = 0; i < 60 && !page; i++) {
  try { page = (await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
  if (!page) await new Promise(r => setTimeout(r, 200));
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let seq = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result && r.result.result && r.result.result.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 924, height: 540, deviceScaleFactor: 1, mobile: false });
// The viewer sits in the venue's zone, so the header's viewer-time start reads 18:00 like the design's badge.
await send('Emulation.setTimezoneOverride', { timezoneId: TZ });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){var u={emailVerified:true,email:'fixture@test'};var S={currentUser:()=>u,onAuthChange:f=>{try{f(u)}catch(e){}},ready:Promise.resolve(u),whenAuthReady:()=>Promise.resolve(u),requireAuth:()=>Promise.resolve(u),requireVerified:()=>Promise.resolve(u),isValidEmail:()=>true,updateProfile:()=>Promise.resolve(),NOTIF:{}};Object.defineProperty(window,'BSP',{value:S,writable:false,configurable:false});})();` });
await send('Page.navigate', { url: `http://127.0.0.1:${port}/bsp-consult-dashboard.html` });
for (let i = 0; i < 120; i++) { if (await ev(`typeof matches!=='undefined' && Array.isArray(matches) && typeof openAnalysisModal==='function'`).catch(() => false)) break; await new Promise(r => setTimeout(r, 500)); }

async function show(k) {
  const S = STATES[k];
  await ev(`(() => { const FX = ${JSON.stringify(MATCH)}; Date.now = () => ${NOW};
    if (!matches.some(x => x.id === FX.id)) matches.push(FX);
    _wxIndex = { v: 1, tours: { [FX.tour]: ${JSON.stringify(S.entry)} } };
    ${S.entry.file ? `_wxFiles[${JSON.stringify(S.entry.file)}] = ${JSON.stringify(S.file)};` : ''}
    _aWx = { m: null }; openAnalysisModal(FX.id);
    document.querySelector('#aTabs .asidenav-item[data-atab="weather"]').click();
    return true; })()`);
  for (let i = 0; i < 40; i++) { if (await ev(`!!document.querySelector('#aSectionWeather .wx-tab')`)) break; await new Promise(r => setTimeout(r, 100)); }
  await new Promise(r => setTimeout(r, 300));
}
const shot = async () => (await send('Page.captureScreenshot', { format: 'png' })).result.data;
// Diff a data-URL screenshot against a reference inside the page (Chrome decodes both).
const DIFF_FN = `window.__wxDiff = async (refUrl, ours, tol, region, wantSide) => {
  const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
  const [a, b] = await Promise.all([load(refUrl), load('data:image/png;base64,' + ours)]);
  const W = 924, H = 540, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const cx = cv.getContext('2d');
  cx.drawImage(a, 0, 0); const A = cx.getImageData(0, 0, W, H).data; cx.clearRect(0, 0, W, H); cx.drawImage(b, 0, 0); const B = cx.getImageData(0, 0, W, H).data;
  let n = 0, nr = 0, tr = 0; const mask = wantSide ? cx.createImageData(W, H) : null;
  for (let p = 0; p < W * H; p++) { const i = p * 4, d = Math.max(Math.abs(A[i]-B[i]), Math.abs(A[i+1]-B[i+1]), Math.abs(A[i+2]-B[i+2])) > tol;
    const x = p % W, y = (p / W) | 0, inR = x >= region.x && x < region.x + region.w && y >= region.y && y < region.y + region.h;
    if (d) n++; if (inR) { tr++; if (d) nr++; }
    if (mask) { mask.data[i] = d ? 255 : B[i] * 0.25; mask.data[i+1] = d ? 40 : B[i+1] * 0.25; mask.data[i+2] = d ? 40 : B[i+2] * 0.25; mask.data[i+3] = 255; } }
  const out = { full: n / (W * H), region: tr ? nr / tr : null };
  if (wantSide) { const s = document.createElement('canvas'); s.width = W * 3 + 16; s.height = H; const sx = s.getContext('2d'); sx.fillStyle = '#fff'; sx.fillRect(0, 0, s.width, H);
    sx.drawImage(a, 0, 0); sx.drawImage(b, W + 8, 0); sx.putImageData(mask, 2 * W + 16, 0); out.side = s.toDataURL('image/png').split(',')[1]; }
  return out; };`;
await ev(DIFF_FN);

const REFS = readdirSync(join(ROOT, 'design/handoff-weather')).filter(f => /^weather-[a-e]-\d-.*\.png$/.test(f)).sort();
const rows = [];
for (const ref of REFS) {
  const k = ref.split('-')[1];
  await show(k);
  await ev(DIFF_FN);
  const region = await ev(`(() => { const r = document.getElementById('aSectionWeather').getBoundingClientRect(); const x = Math.max(0, Math.round(r.left)), y = 0; return { x, y, w: Math.min(924, Math.round(r.right)) - x, h: 540 }; })()`);
  const max = await ev(`(() => { const b = document.querySelector('.modal-analysis .abody'); return b ? b.scrollHeight - b.clientHeight : 0; })()`);
  const diffAt = async (top, side) => { await ev(`(() => { const b = document.querySelector('.modal-analysis .abody'); if (b) b.scrollTop = ${top}; return true; })()`);
    await new Promise(r => setTimeout(r, 60)); return ev(`window.__wxDiff('/design/handoff-weather/${ref}', ${JSON.stringify(await shot())}, ${TOL}, ${JSON.stringify(region)}, ${side})`); };
  let best = { top: 0, d: await diffAt(0, false) };
  for (let t = 8; t <= max; t += 8) { const d = await diffAt(t, false); if (d.region < best.d.region) best = { top: t, d }; }
  for (let t = Math.max(0, best.top - 7); t <= Math.min(max, best.top + 7); t++) { const d = await diffAt(t, false); if (d.region < best.d.region) best = { top: t, d }; }
  const fin = await diffAt(best.top, true);
  writeFileSync(join(OUT, ref.replace(/\.png$/, '') + '-side.png'), Buffer.from(fin.side, 'base64'));
  rows.push({ ref, state: k, scrollTop: best.top, diffFullPct: +(fin.full * 100).toFixed(2), diffWeatherColumnPct: +(fin.region * 100).toFixed(2) });
  console.error(ref, rows[rows.length - 1]);
}
// indoor (no reference PNG in the handoff): capture only.
await show('d'); writeFileSync(join(OUT, 'weather-d-indoor-ours.png'), Buffer.from(await shot(), 'base64'));

// ── phase 2 · the Weather COLUMN, aligned ─────────────────────────────────────────────────────────
// The full-window diff above is dominated by the modal chrome (the design's preview modal is inset with
// a 554 px content column; the live 12a modal fills the window and its column is wider), which is out
// of TEN-304's scope. Here the tab is rendered at the design's column width (554 px, TEST-ONLY style),
// captured whole, and each reference's visible content column (x 293–859, y 144–504) is matched to the
// best (dx, dy) in it. Same TOL. Side-by-side crops: <name>-column.png (reference | ours | diff).
const REF_COL = { x: 293, y: 144, w: 566, h: 360 }, PAD = 6;
// The design's content column is 554 px (x 299–852) in every slice but e-3, where the preview's scrollbar
// was gone at capture time and the column is 564 px (tiles at x 299 / 490 / 680, right edge 862; measured).
const COL_W_OF = ref => ref === 'weather-e-3-tiles.png' ? 564 : 554;
const COL_FN = `window.__wxCol = async (refUrl, ours, tol, rc) => {
  const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
  const [a, b] = await Promise.all([load(refUrl), load('data:image/png;base64,' + ours)]);
  const cA = document.createElement('canvas'); cA.width = rc.w; cA.height = rc.h; const xA = cA.getContext('2d');
  xA.drawImage(a, rc.x, rc.y, rc.w, rc.h, 0, 0, rc.w, rc.h); const A = xA.getImageData(0, 0, rc.w, rc.h).data;
  const BW = b.width, BH = b.height, cB = document.createElement('canvas'); cB.width = BW; cB.height = BH; const xB = cB.getContext('2d');
  xB.drawImage(b, 0, 0); const B = xB.getImageData(0, 0, BW, BH).data;
  const bg = [B[0], B[1], B[2]];
  const px = (x, y) => (x < 0 || y < 0 || x >= BW || y >= BH) ? bg : [B[(y * BW + x) * 4], B[(y * BW + x) * 4 + 1], B[(y * BW + x) * 4 + 2]];
  // Alignment scores INK pixels only (either image brighter than the dark surfaces): a plain pixel count
  // prefers aligning onto empty background. The reported figure is the plain share of differing pixels.
  const lum = (r, g, b) => Math.max(r, g, b);
  const count = (dx, dy, step) => { let n = 0, t = 0, ni = 0, ti = 0; for (let y = 0; y < rc.h; y += step) for (let x = 0; x < rc.w; x += step) {
    const i = (y * rc.w + x) * 4, q = px(x + dx, y + dy), d = Math.max(Math.abs(A[i] - q[0]), Math.abs(A[i + 1] - q[1]), Math.abs(A[i + 2] - q[2])) > tol;
    t++; if (d) n++; if (lum(A[i], A[i + 1], A[i + 2]) > 70 || lum(q[0], q[1], q[2]) > 70) { ti++; if (d) ni++; } }
    return { plain: n / t, ink: ti ? ni / ti : 1 }; };
  let best = { dx: 0, dy: 0, s: { ink: 2 } };
  for (let dy = -80; dy <= BH - rc.h + 20; dy += 2) { const s = count(0, dy, 3); if (s.ink < best.s.ink) best = { dx: 0, dy, s }; }
  const c0 = best; best = { s: { ink: 2 } };
  for (let dy = c0.dy - 3; dy <= c0.dy + 3; dy++) for (let dx = -6; dx <= 6; dx++) { const s = count(dx, dy, 1); if (s.ink < best.s.ink) best = { dx, dy, s }; }
  best.d = best.s.plain; best.ink = best.s.ink;
  const s = document.createElement('canvas'); s.width = rc.w * 3 + 16; s.height = rc.h; const sx = s.getContext('2d');
  sx.fillStyle = '#fff'; sx.fillRect(0, 0, s.width, rc.h); sx.drawImage(cA, 0, 0);
  const o = sx.createImageData(rc.w, rc.h), m = sx.createImageData(rc.w, rc.h);
  for (let y = 0; y < rc.h; y++) for (let x = 0; x < rc.w; x++) { const i = (y * rc.w + x) * 4, q = px(x + best.dx, y + best.dy);
    o.data[i] = q[0]; o.data[i + 1] = q[1]; o.data[i + 2] = q[2]; o.data[i + 3] = 255;
    const d = Math.max(Math.abs(A[i] - q[0]), Math.abs(A[i + 1] - q[1]), Math.abs(A[i + 2] - q[2])) > tol;
    m.data[i] = d ? 255 : q[0] * 0.25; m.data[i + 1] = d ? 40 : q[1] * 0.25; m.data[i + 2] = d ? 40 : q[2] * 0.25; m.data[i + 3] = 255; }
  sx.putImageData(o, rc.w + 8, 0); sx.putImageData(m, 2 * rc.w + 16, 0);
  return { dx: best.dx, dy: best.dy, diff: best.d, ink: best.ink, side: s.toDataURL('image/png').split(',')[1] }; };`;
await send('Emulation.setDeviceMetricsOverride', { width: 924, height: 2600, deviceScaleFactor: 1, mobile: false });
const colShot = async (COL_W = 554) => {
  await ev(`(() => { let st = document.getElementById('__wxColCss'); if (!st) { st = document.createElement('style'); st.id = '__wxColCss'; document.head.appendChild(st); }
    st.textContent = '.wx-tab{width:${COL_W}px!important;box-sizing:border-box}'; const b = document.querySelector('.modal-analysis .abody'); if (b) b.scrollTop = 0; return true; })()`);
  await new Promise(r => setTimeout(r, 150));
  const r = await ev(`(() => { const r = document.querySelector('#aSectionWeather .wx-tab').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, vh: innerHeight }; })()`);
  if (r.y + r.h > r.vh) console.error('column capture clipped', r);
  return (await send('Page.captureScreenshot', { format: 'png', clip: { x: r.x - PAD, y: Math.max(0, r.y - 20), width: COL_W + 2 * PAD, height: Math.min(r.h + 40, r.vh - r.y), scale: 1 } })).result.data;
};
const colRows = [], COLDIR = process.env.TEN304_PIXEL_DIR || OUT;
mkdirSync(COLDIR, { recursive: true });
for (const ref of REFS) {
  const k = ref.split('-')[1];
  await show(k); await ev(COL_FN);
  const ours = await colShot(COL_W_OF(ref));
  if (process.env.TEN304_RAW) writeFileSync(join(COLDIR, ref.replace(/\.png$/, '') + '-ours-raw.png'), Buffer.from(ours, 'base64'));
  const r = await ev(`window.__wxCol('/design/handoff-weather/${ref}', ${JSON.stringify(ours)}, ${TOL}, ${JSON.stringify(Object.assign({}, REF_COL, { w: COL_W_OF(ref) + 2 * PAD }))})`);
  writeFileSync(join(COLDIR, ref.replace(/\.png$/, '') + '-column.png'), Buffer.from(r.side, 'base64'));
  const row = rows.find(x => x.ref === ref); Object.assign(row, { columnDiffPct: +(r.diff * 100).toFixed(2), columnInkDiffPct: +(r.ink * 100).toFixed(2), columnAt: { dx: r.dx, dy: r.dy } });
  console.error(ref, 'column', row.columnDiffPct, 'ink', row.columnInkDiffPct, r.dx, r.dy);
}
// ── phase 3 · behaviour in the real page: the shared TEN-303 tooltip (#aoddsTip: 250 ms delay, hover +
//    keyboard focus), native title= count, pace tile ──
await send('Emulation.setDeviceMetricsOverride', { width: 924, height: 2600, deviceScaleFactor: 1, mobile: false });
await show('c');
const tipText = () => ev(`(() => { const t = document.getElementById('aoddsTip'); return t && t.style.display !== 'none' ? t.innerText.replace(/\\s+/g, ' ').trim() : null; })()`);
const hover = async sel => { const c = await ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(8, r.height / 2) }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 }); await new Promise(r => setTimeout(r, 50));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y }); };
const behaviour = {};
await hover('#aSectionWeather .wx-more'); await new Promise(r => setTimeout(r, 120)); behaviour.moreAt120ms = await tipText();
await new Promise(r => setTimeout(r, 250)); behaviour.moreAt370ms = await tipText();
await hover('#aSectionWeather .wx-tbd'); await new Promise(r => setTimeout(r, 400)); behaviour.chip = await tipText();
await hover('#aSectionWeather .wx-day[data-date="2026-07-21"] .wx-hi'); await new Promise(r => setTimeout(r, 400)); behaviour.dayCard = await tipText();
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 }); await new Promise(r => setTimeout(r, 100)); behaviour.afterLeave = await tipText();
await ev(`(document.querySelector('#aSectionWeather .wx-more').focus(), true)`); await new Promise(r => setTimeout(r, 400)); behaviour.keyboardFocus = await tipText();
behaviour.nativeTitles = await ev(`document.querySelectorAll('#aSectionWeather [title]').length`);
behaviour.paceCursor = await ev(`getComputedStyle(document.querySelector('#aSectionWeather .wx-tile[data-factor="pace"]')).cursor`);
behaviour.otherTileCursor = await ev(`getComputedStyle(document.querySelector('#aSectionWeather .wx-tile[data-factor="rain"]')).cursor`);
behaviour.header = await ev(`document.getElementById('aContext').textContent`);
behaviour.badge = await ev(`document.querySelector('#aSectionWeather .wx-badge').textContent`);
await ev(`(document.querySelector('#aSectionWeather .wx-tile[data-factor="pace"]').click(), true)`); await new Promise(r => setTimeout(r, 200));
behaviour.afterPaceClick = await ev(`document.querySelector('#aTabs .asidenav-item.active').dataset.atab`);
console.error('behaviour', JSON.stringify(behaviour, null, 1));
await ev(`(document.querySelector('#aTabs .asidenav-item[data-atab="weather"]').click(), true)`);

await show('d'); writeFileSync(join(COLDIR, 'weather-d-indoor-column-ours.png'), Buffer.from(await colShot(), 'base64'));
console.log(JSON.stringify({ tol: TOL, rows, behaviour }, null, 1));
stop(); process.exit(0);
