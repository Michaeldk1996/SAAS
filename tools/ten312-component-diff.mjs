#!/usr/bin/env node
// TEN-312 / TEN-314 — TEST-ONLY per-component pixel diff for the Match analysis shared components. Never loaded by the
// live page and never run in CI: a manual tool, like tools/ten312-design-capture.mjs and tools/ten312-build-capture.mjs
// (same Chrome flags, frozen clock, time zone, viewport and software raster; the fixture match of the build capture).
//
//   node tools/ten312-component-diff.mjs <outDir> [--only seg-sheet,rows-form,...] [--no-full]
//
// What it measures. For each shared component (README §4 / §6) it drives the LOCKED design file to a state where a
// concrete instance is visible, clips that instance, then mounts OUR helper with the same content (labels, values,
// widths — read from the design instance's DOM, never typed here) inside the open fixture modal, and clips that.
// Every other element is hidden (visibility), the canvas behind the component is painted one flat colour:
//   ref/     the design instance, on the colour behind it in the design (its ancestors' backgrounds, composited)
//   source/  ours with the modal re-pointed to the SOURCE palette (FIXTURE_SOURCE_PALETTE below, fixture-only
//            <style>) on the design's own background colour → structure
//   night/   ours with the shipped Night tokens on our background (the real parent, or the README-role token where
//            the helper has no parent of its own) → what the user sees
// Components: seg-sheet (sheet scope tabs, fhSheetSeg→maSeg 'sheet'), seg-me (Market edge view tabs, meSegHtml→maSeg
// 'me'), popframe (Market edge line pop-up P4 → mePopShell→maPopFrame, body emptied to 120px both sides), rows-form
// (Form recent matches, maMatchRowsHtml), rows-tournament (Tournament records, maMatchRowsHtml), tooltip (Form bar
// .elotip-pop → maTipHtml), sheet-head / sheet-key (P1 match stats sheet: our real fhOpenSheet header; the Key stats
// section through fhSheetKeyHtml fed the design's numbers). Plus the frame / header / menu from the full-modal
// captures: the design capture (--only 03-key-factors) and the build capture (--only key) are RUN (child processes);
// the source-palette variant of the build capture is this tool's own copy of its framing, checked against the build
// capture's own night PNG (fullEquivalence in components.json). frame-corners / frame-edges / frame-sides are crops
// of those full PNGs (python3 + PIL, as tools/ten312-pixel-diff.py).
//
// Writes, under <outDir>: ref/ source/ night/ (same-named PNGs; source|night/manifest.json = header/menu regions),
// full/ (the full-modal captures), diff-source/ diff-night/ (tools/ten312-pixel-diff.py output: *.diff.png,
// report.json, report.md), components.json (the content fed to each side, backgrounds, line-heights, sub-pixel
// offsets, text checks) and summary.md (both palettes in one table). Regenerates nothing else; no repo file is touched.
// Chrome profiles live under <outDir> and are removed on exit; Chrome is killed on exit / SIGINT / SIGTERM.
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const OUT = args[0] && !args[0].startsWith('--') ? path.resolve(args[0]) : null;
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const ONLY = opt('--only') ? new Set(opt('--only').split(',')) : null;
const NO_FULL = args.includes('--no-full');
const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(TOOLS, '..');
const HANDOFF_REL = 'design/handoff-ten312-match-analysis';
const DESIGN = 'Match Analysis Progression v1.dc.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!OUT) { console.error('usage: node tools/ten312-component-diff.mjs <outDir> [--only a,b] [--no-full]'); process.exit(2); }

// Same clock, zone, viewport as the two capture tools.
const FROZEN_NOW = Date.parse('2026-09-28T12:19:30+08:00');
const TZ = 'Asia/Makassar';
const VIEW_W = 1370, VIEW_H = 745, FIT_H = 760;

// The build capture's fixture (DF demoMatch / README §9) — copied verbatim from tools/ten312-build-capture.mjs.
const FIXTURE = { id: 'ten312-fixture', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: null, p2Key: null,
  tour: 'ATP Washington', tournament: 'ATP Washington', tournamentRound: 'ATP Washington - Quarter-finals', surface: 'Hard',
  startTs: '2026-07-20T22:00:00Z', bestOdds: { p1: { price: 1.54 }, p2: { price: 2.62 } },
  finalScore: { display: '6-4, 4-6, 7-6', sets: [{ p1: 6, p2: 4 }, { p1: 4, p2: 6 }, { p1: 7, p2: 6 }], p1Sets: 2, p2Sets: 1, winner: 'p1' } };

// Source palette for the structural run — copied verbatim from the branch that defined it. Fixture-only.
const FIXTURE_SOURCE_PALETTE = { '--ma-page': '#0A0D14', '--ma-card': '#0E1019', '--ma-inner': '#0A0D14', '--ma-raised': '#131623',
  '--ma-hover': '#11141F', '--ma-sel': 'rgba(91,155,255,0.16)', '--ma-hair': 'rgba(255,255,255,0.06)', '--ma-hair-soft': 'rgba(255,255,255,0.05)',
  '--ma-hair-strong': 'rgba(255,255,255,0.1)', '--ma-hair-hover': 'rgba(255,255,255,0.2)', '--ma-outline': 'rgba(91,155,255,0.45)',
  '--ma-t1': '#E7E9EE', '--ma-t2': '#8B96B5', '--ma-t3': '#5B6880', '--ma-fill': '#5B9BFF', '--ma-link': '#5B9BFF',
  '--ma-on-fill': '#06070A', '--ma-pos': '#3DD68C', '--ma-neg': '#E0616F', '--ma-pb-fill': '#E7E9EE',
  '--ma-scrim': 'rgba(4,5,9,0.62)', '--ma-chart-grid': 'rgba(255,255,255,0.07)' };
const PALETTE_CSS = `#analysisModal.ma-theme, #analysisModal.ma-theme[data-ma-theme]{ ${Object.entries(FIXTURE_SOURCE_PALETTE).map(([k, v]) => `${k}:${v};`).join(' ')} }`;

// ---------------------------------------------------------------------------------------------------------------------
// Components. design: the design state (the design capture's __cap steps). nightBg: 'real' = the colour behind our
// element where it really mounts; a token = the README §3 role of the design parent, for helpers mounted in a host.
// pad: extra px clipped around the instance (the tooltip's shadow).
// ---------------------------------------------------------------------------------------------------------------------
const tab = (t, extra) => ({ state: Object.assign({ maTab: t }, extra || {}) });
const FORM_SHEET = [tab('Form'), { click: '18.07.', nth: 0 }];        // = design capture P1 (Sinner v T. Griekspoor)
const COMPONENTS = [
  { name: 'seg-sheet', steps: FORM_SHEET, nightBg: 'real', pad: 0 },
  { name: 'seg-me', steps: [tab('Market edge', { meView: 'winner' })], nightBg: 'real', ourTab: 'marketedge', pad: 0 },
  { name: 'popframe', steps: [tab('Market edge', { meView: 'lines', meLine: 'a|0', meLineScope: 'band' })], nightBg: 'transparent', ourTab: 'marketedge', pad: 0 },
  { name: 'rows-form', steps: [tab('Form')], nightBg: 'var(--ma-card)', ourTab: 'form', pad: 0 },
  { name: 'rows-tournament', steps: [tab('Tournament')], nightBg: 'var(--ma-card)', ourTab: 'tournament', pad: 0 },
  { name: 'tooltip', steps: [tab('Form')], nightBg: 'var(--ma-card)', ourTab: 'form', pad: 32 },
  { name: 'sheet-head', steps: FORM_SHEET, nightBg: 'real', pad: 0 },
  { name: 'sheet-key', steps: FORM_SHEET, nightBg: 'real', pad: 0 },
];

// ---------------------------------------------------------------------------------------------------------------------
async function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); }); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
function serve(root, port) {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = path.join(root, rel === '/' ? '/bsp-consult-dashboard.html' : rel);
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
let chrome, srv, c, profile, child;
function cleanup() {
  try { c?.close(); } catch {}
  try { chrome && chrome.exitCode == null && chrome.kill('SIGKILL'); } catch {}
  try { child && child.exitCode == null && child.kill('SIGKILL'); } catch {}
  try { srv?.close(); srv?.closeAllConnections?.(); } catch {}
  try { profile && fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.on('exit', cleanup);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { cleanup(); process.exit(130); });

function run(cmd, argv) {
  return new Promise((res, rej) => {
    child = spawn(cmd, argv, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${path.basename(argv[0])} exited ${code}`))));
  });
}
const call = (fn, ...a) => `(${fn.toString()})(${a.map((x) => JSON.stringify(x)).join(', ')})`;

// ---------------------------------------------------------------------------------------------------------------------
// In-page code, both pages. Serialised with Function.prototype.toString — no closure over node scope.
// ---------------------------------------------------------------------------------------------------------------------
function pageCommon() {
  const saved = [], added = [];
  const parse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const flush = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30))));
  const api = {
    parse,
    text: (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null),
    vis: (el) => el.getClientRects().length > 0,
    style(el, css) { saved.push([el, el.getAttribute('style')]); el.setAttribute('style', (el.getAttribute('style') || '') + ';' + css); },
    add(el) { added.push(el); return el; },
    // The colour seen behind `el` (its ancestors' background-colors composited, up to the first opaque one). With
    // self=true, `el`'s own background is the top layer. Background images are reported, not composited.
    bgBehind(el, self) {
      const layers = []; let images = [];
      for (let p = self ? el : el.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p), col = parse(cs.backgroundColor);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') images.push(cs.backgroundImage.slice(0, 80));
        if (col && col[3] > 0) { layers.push(col); if (col[3] >= 1) break; }
      }
      let acc = [0, 0, 0, 0];
      for (const L of layers.reverse()) {
        const a = L[3] + acc[3] * (1 - L[3]);
        acc = a ? [0, 1, 2].map((i) => (L[i] * L[3] + acc[i] * acc[3] * (1 - L[3])) / a).concat(a) : [0, 0, 0, 0];
      }
      const rgb = acc.slice(0, 3).map(Math.round).join(', ');
      return { color: !acc[3] ? 'transparent' : acc[3] >= 0.999 ? `rgb(${rgb})` : `rgba(${rgb}, ${+acc[3].toFixed(3)})`, images };
    },
    mark(show, clip, clipX) {
      for (const e of show) e.setAttribute('data-cd-show', '1');
      for (const e of clip) e.setAttribute('data-cd-clip', '1');
      if (clipX) clipX.setAttribute('data-cd-clipx', '1');
    },
    // hide everything but the marked subtrees; the canvas = one flat colour
    isolate(bg) {
      const st = document.createElement('style'); st.id = '__cdHide';
      // (the shown root must say visible itself: visibility inherits, and its ancestors are hidden)
      st.textContent = `body *:not([data-cd-show]):not([data-cd-show] *){ visibility:hidden !important; } [data-cd-show]{ visibility:visible !important; }
        html{ background:${bg} !important; } body{ background:transparent !important; }
        html::before, html::after, body::before, body::after{ display:none !important; }`;
      document.head.appendChild(st); return true;
    },
    scroll() { const e = document.querySelector('[data-cd-clip]'); e.scrollIntoView({ block: 'center', inline: 'nearest' }); return true; },
    // Put our instance on the design instance's sub-pixel phase (fractional x / y of its box), by nudging the host
    // < 1px — otherwise text and hairlines rasterise differently for a reason that is the harness's, not the helper's.
    // Only for helpers mounted in a host; the real sheet already sits where the design's sheet sits.
    alignPhase(want) {
      const e = document.querySelector('[data-cd-clip]'), h = e && e.closest('[data-cd-host]');
      if (!h) return null;
      const fr = (v) => v - Math.floor(v), before = api.clipRect(0).exact;
      // wrapped into [0,1) and snapped to Chrome's layout unit (1/64 px), so float noise is not a 1px nudge
      const d = (a, b) => { const v = Math.round((((fr(a) - fr(b)) % 1) + 1) % 1 * 64) / 64; return v >= 1 ? 0 : v; };
      const dx = d(want[0], before[0]), dy = d(want[1], before[1]);
      h.style.left = dx + 'px'; h.style.top = dy + 'px';
      return { dx: +dx.toFixed(3), dy: +dy.toFixed(3), before, after: api.clipRect(0).exact };
    },
    // union of the [data-cd-clip] boxes (x range from [data-cd-clipx]'s padding box when present), ±pad, snapped outward
    clipRect(pad) {
      const rs = [...document.querySelectorAll('[data-cd-clip]')].map((e) => e.getBoundingClientRect());
      let l = Math.min(...rs.map((r) => r.left)), t = Math.min(...rs.map((r) => r.top)), r = Math.max(...rs.map((q) => q.right)), b = Math.max(...rs.map((q) => q.bottom));
      const cx = document.querySelector('[data-cd-clipx]');
      if (cx) { const q = cx.getBoundingClientRect(); l = q.left + cx.clientLeft; r = l + cx.clientWidth; }
      const x0 = Math.floor(l - pad), y0 = Math.floor(t - pad), x1 = Math.ceil(r + pad), y1 = Math.ceil(b + pad);
      return { x: x0 + scrollX, y: y0 + scrollY, w: x1 - x0, h: y1 - y0, exact: [+l.toFixed(3), +t.toFixed(3), +(r - l).toFixed(3), +(b - t).toFixed(3)] };
    },
    undo() {
      for (const [el, s] of saved.splice(0).reverse()) { if (s == null) el.removeAttribute('style'); else el.setAttribute('style', s); }
      for (const el of added.splice(0)) el.remove();
      for (const a of ['data-cd-show', 'data-cd-clip', 'data-cd-clipx']) document.querySelectorAll(`[${a}]`).forEach((e) => e.removeAttribute(a));
      document.getElementById('__cdHide')?.remove();
      return true;
    },
    // the design capture's settle: finite animations/transitions jump to their end, infinite ones pause at t=0
    async settle() {
      await flush();
      for (const a of document.getAnimations()) {
        const it = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming().iterations : 1;
        try { if (it === Infinity) { a.pause(); a.currentTime = 0; } else a.finish(); } catch (e) {}
      }
      await flush();
      return true;
    },
  };
  window.__cd = api; return true;
}

// The design capture's __cap state helpers (reset / set / click), same fiber walk.
function pageCap() {
  const host = () => {
    const el = document.querySelector('.nav');
    const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$'));
    for (let f = el[k]; f; f = f.return) if (f.stateNode && f.stateNode.logic && f.stateNode.logic.renderVals && 'maTab' in (f.stateNode.logic.state || {})) return f.stateNode;
    throw new Error('dc host not found');
  };
  window.__cap = {
    reset() { const h = host(); h.logic.state = { maTab: null }; return new Promise((r) => h.forceUpdate(() => r(true))); },
    set(patch) { const h = host(); return new Promise((r) => h.logic.setState(patch, () => r(true))); },
    click(text, nth) {
      const all = [...document.querySelectorAll('*')].filter((e) => (e.textContent || '').replace(/\s+/g, ' ').trim() === text && e.getClientRects().length);
      const leaves = all.filter((e) => !all.some((o) => o !== e && e.contains(o)));
      const el = leaves[nth || 0];
      if (!el) throw new Error('click: no element for ' + text);
      el.click(); return true;
    },
  };
  return true;
}

// Design side: find the instance, prepare it (hide extra rows, force the tooltip open, empty the pop-up body), mark
// what is shown and clipped, and return the content our side needs.
function designProbe(name) {
  const D = window.__cd, T = D.text, $$ = (s, r) => [...(r || document).querySelectorAll(s)].filter(D.vis);
  const segItems = (track) => [...track.children].map((s) => ({ label: T(s), on: getComputedStyle(s).fontWeight === '700' }));
  const lh = (e) => getComputedStyle(e).lineHeight;
  const sheetBox = () => { const it = $$('span.seg').find((s) => T(s) === 'Key stats'); if (!it) throw new Error('sheet not open'); return it.parentElement.parentElement; };
  if (name === 'seg-sheet') {
    const track = $$('span.seg').find((s) => T(s) === 'Key stats').parentElement;
    D.mark([track], [track]);
    return { data: { items: segItems(track), parentW: track.parentElement.clientWidth }, bg: D.bgBehind(track), lh: lh(track) };
  }
  if (name === 'seg-me') {
    const track = $$('span.seg').find((s) => T(s) === 'Match winner').parentElement;
    D.mark([track], [track]);
    return { data: { items: segItems(track), parentW: track.parentElement.getBoundingClientRect().width }, bg: D.bgBehind(track), lh: lh(track) };
  }
  if (name === 'popframe') {
    const x = $$('span.seg').filter((s) => T(s) === '✕').find((s) => s.closest('div[style*="z-index: 85"]'));
    const box = x.parentElement.parentElement, head = box.children[0], col = head.children[0];
    const kids = [...box.children].slice(1);
    kids.forEach((k, i) => D.style(k, i === 0 ? 'height:120px !important; flex:none !important; overflow:hidden !important; visibility:hidden !important; margin:0 !important;' : 'display:none !important;'));
    D.mark([box], [box]);
    return { data: { title: T(col.children[0]), sub: T(col.children[1]), w: box.getBoundingClientRect().width, bodyH: 120 }, bg: { color: 'transparent', images: [], note: 'pop-up over its scrim: canvas transparent on every side' }, lh: lh(box) };
  }
  if (name === 'rows-form' || name === 'rows-tournament') {
    let head, card, list;
    if (name === 'rows-form') {
      const lab = $$('span').find((s) => /^Recent matches ·/.test(T(s)));
      card = lab.parentElement.nextElementSibling; list = card; head = card.children[0];
    } else {
      head = $$('div').find((d) => d.style.position === 'sticky' && /^48px 12px/.test(d.style.gridTemplateColumns) && d.style.padding === '6px 6px 7px');
      list = head.parentElement; card = list;
    }
    const keep = [head], groups = []; let nRows = 0;
    for (const k of [...list.children].slice(1)) {
      if (nRows >= 3) break;
      const grid = k.classList.contains('seg') ? k : k.children[0] && k.children[0].classList.contains('seg') ? k.children[0] : null;
      if (grid && /^48px 12px/.test(grid.style.gridTemplateColumns)) {
        const cs = [...grid.children];
        const sq = D.parse(getComputedStyle(cs[1]).backgroundColor);
        const won = sq && sq[1] > 150 && sq[0] < 100 ? true : sq && sq[0] > 150 && sq[1] < 150 ? false : null;
        groups[groups.length - 1].rows.push({ date: T(cs[0]), won, opp: T(cs[2]), rd: T(cs[3]), sets: T(cs[4]), scores: T(cs[5]), h: T(cs[6]), a: T(cs[7]) });
        nRows++; keep.push(k);
      } else if (k.children.length >= 1 && k.children[0].tagName === 'SPAN' && getComputedStyle(k.children[0]).fontWeight === '700') {
        groups.push({ title: T(k.children[0]), meta: T(k.children[1]), rows: [] }); keep.push(k);
      }
    }
    // everything after the kept entries goes (display:none), so the sticky header stays where it is
    for (const k of [...list.children]) if (!keep.includes(k)) D.style(k, 'display:none !important;');
    D.mark(keep, keep, name === 'rows-form' ? card : null);
    return { data: { labels: [...head.children].map(T), groups, w: name === 'rows-form' ? card.clientWidth : list.getBoundingClientRect().width,
      headPadding: head.style.padding, rowWrapPadding: keep[2] && keep[2].style.padding || null }, bg: D.bgBehind(head, true), lh: lh(head) };
  }
  if (name === 'tooltip') {
    // the first Form-bar tooltip that no ancestor's overflow cuts (the left-most bars' pops are clipped by the column)
    const pops = $$('.elotip').map((e) => e.querySelector('.elotip-pop')).filter(Boolean);
    const clippedBy = (el) => {
      const r = el.getBoundingClientRect();
      for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        const cs = getComputedStyle(p); if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const q = p.getBoundingClientRect(); if (r.left < q.left - 0.5 || r.right > q.right + 0.5 || r.top < q.top - 0.5 || r.bottom > q.bottom + 0.5) return p.tagName + '.' + p.className;
      }
      return null;
    };
    let pop = null, skipped = 0;
    for (const p of pops) { D.style(p, 'opacity:1 !important; visibility:visible !important; transition:none !important;'); p.scrollIntoView({ block: 'center' }); if (!clippedBy(p)) { pop = p; break; } skipped++; D.style(p, 'display:none !important;'); }
    if (!pop) throw new Error('tooltip: every design pop is clipped by an ancestor');
    D.mark([pop], [pop]);
    const cs = getComputedStyle(pop);
    return { data: { inner: pop.innerHTML.replace(/ data-dc-tpl="\d+"/g, '').replace(/\s*\n\s*/g, ''), text: T(pop), skippedClippedPops: skipped, popIndex: pops.indexOf(pop),
      layout: { display: cs.display, 'flex-direction': cs.flexDirection, gap: cs.rowGap, 'align-items': cs.alignItems, 'text-align': cs.textAlign },
      shell: { background: cs.backgroundColor, border: cs.borderTopWidth + ' ' + cs.borderTopColor, radius: cs.borderTopLeftRadius, padding: cs.padding, shadow: cs.boxShadow, font: cs.fontFamily + ' ' + cs.fontSize } },
      bg: D.bgBehind(pop), lh: lh(pop) };
  }
  if (name === 'sheet-head') {
    const box = sheetBox(), head = box.children[0];
    const grid = head.children[1], L = grid.children[0], C = grid.children[1], R = grid.children[2];
    const score = C.children[0].children;
    D.mark([head], [head]);
    return { data: { meta: T(head.children[0].children[0]), aName: T(L.children[1]), aPrice: T(L.children[0].children[1]), aIni: T(L.children[0].children[0]),
      bName: T(R.children[0]), bPrice: T(R.children[1].children[1]), bIni: T(R.children[1].children[0]), aSets: T(score[0]), bSets: T(score[2]),
      chips: [...C.children[1].children].map(T), winLine: T(head.children[2]), boxW: box.clientWidth, headW: head.getBoundingClientRect().width,
      tabs: segItems(box.children[1]) }, bg: D.bgBehind(head), lh: lh(head) };
  }
  if (name === 'sheet-key') {
    const box = sheetBox();
    // the section's caption strip (not the seg item of the same label, nor its inner interpolation span)
    const sec = [...box.querySelectorAll('span')].find((s) => T(s) === 'Key stats' && !s.closest('.seg') && getComputedStyle(s).textTransform === 'uppercase').parentElement;
    const rows = [...sec.children].slice(1).map((r) => { const g = r.children[0]; return { label: T(g.children[1]), a: T(g.children[0].children[0]), aSub: T(g.children[0].children[1]), b: T(g.children[2].children[1]), bSub: T(g.children[2].children[0]) }; });
    D.mark([sec], [sec]);
    return { data: { rows, w: sec.getBoundingClientRect().width }, bg: D.bgBehind(sec), lh: lh(sec) };
  }
  throw new Error('designProbe: unknown ' + name);
}

// Our side: mount the helper with the design's content inside the open fixture modal. Returns the real colour behind it.
function oursMount(name, d, tmap) {
  const D = window.__cd, esc = (s) => escapeHtml(s == null ? '' : String(s));
  const modal = document.querySelector('#analysisModal .modal-analysis');
  const host = (sectionId, w, css) => {
    const sec = document.getElementById(sectionId) || modal.querySelector('.abody');
    const h = D.add(document.createElement('div')); h.setAttribute('data-cd-host', name);
    h.setAttribute('style', `position:relative; width:${w}px; ${css || ''}`); sec.appendChild(h); return h;
  };
  const ret = (el, extra) => { D.mark([el], [el]); return Object.assign({ bgReal: D.bgBehind(el), lh: getComputedStyle(el).lineHeight }, extra || {}); };
  const sheet = () => {
    // our real stats sheet (fhOpenSheet) on the design's match, no event key → no shard fetch
    const h = d.sheet, parts = h.meta.split(' · ');
    const dm = /^(\d{1,2})\.(\d{1,2})\.?(\d{2}|\d{4})?$/.exec(parts[3] || '');
    const yy = dm && dm[3] ? (dm[3].length === 2 ? '20' + dm[3] : dm[3]) : String(new Date().getFullYear());
    const date = dm ? `${yy}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}` : null;
    const sets = h.chips.map((x) => x.split('-').map(Number));
    const r = { mid: 'cd-sheet', sets, pS: +h.aSets, oS: +h.bSets, won: +h.aSets > +h.bSets, price: +h.aPrice, oppPrice: +h.bPrice,
      tourn: parts[0], surface: parts[1], round: parts[2], date, ek: null };
    const st = fhStateFor(_aM); st.sheetMap['cd-sheet'] = { r, aName: h.aName, aKey: null, bName: h.bName, bKey: null };
    fhOpenSheet('cd-sheet');
    const box = document.querySelector('#fhSheet > div > div:nth-child(2)');
    return { box, head: box.children[0], body: document.getElementById('fhSheetBody'), fedDate: date };
  };
  if (name === 'seg-sheet' || name === 'sheet-head' || name === 'sheet-key') {
    const S = sheet();
    if (name === 'sheet-head') return ret(S.head, { fedDate: S.fedDate, text: D.text(S.head.children[0]) });
    // the scope tabs (fhSheetSeg = maSeg 'sheet', centred) + the Key stats section, both inside the real sheet body
    const tabs = d.sheet.tabs.map((t) => ({ label: t.label, on: t.on, onclick: '' }));
    let keyHtml = '', missing = [];
    if (name === 'sheet-key') {
      const ours = fhSheetKeyModel(null), byLabel = Object.fromEntries(ours.map((x) => [x.label, x]));
      const rows = d.key.rows.map((x) => {
        const o = byLabel[x.label]; if (!o) missing.push(x.label);
        const kind = o ? o.kind : 'ratio', k = o ? o.k : undefined;
        const cell = (txt, sub) => { const n = parseFloat(txt); return { v: Number.isFinite(n) ? (kind === 'pct' ? n * 100 : n) : null, txt, sub, title: '' }; };
        return { label: x.label, a: cell(x.a, x.aSub), b: cell(x.b, x.bSub), kind, k };
      });
      const real = fhSheetKeyModel;
      fhSheetKeyModel = () => rows;                          // eslint-disable-line no-global-assign
      try { keyHtml = fhSheetKeyHtml({ fed: true }); } finally { fhSheetKeyModel = real; }   // eslint-disable-line no-global-assign
    }
    S.body.innerHTML = fhSheetSeg(tabs) + keyHtml;
    const el = name === 'seg-sheet' ? S.body.children[0] : S.body.children[1];
    return ret(el, { missingLabels: missing });
  }
  if (name === 'seg-me') {
    const h = host('aSectionMarketEdge', Math.round(d.parentW));
    h.innerHTML = meSegHtml(d.items.map((t) => ({ label: esc(t.label), on: t.on, onclick: '' })));
    return ret(h.firstElementChild);
  }
  if (name === 'popframe') {
    const h = host('aSectionMarketEdge', Math.round(d.w));
    h.innerHTML = mePopShell(d.title, '', d.sub, `<div style="height:${d.bodyH}px;"></div>`, '', '');
    const ov = h.firstElementChild;
    D.style(ov, 'position:static !important; inset:auto !important; padding:0 !important; background:transparent !important; overflow:visible !important; display:block !important;');
    return ret(ov.firstElementChild);
  }
  if (name === 'rows-form' || name === 'rows-tournament') {
    const h = host(name === 'rows-form' ? 'aSectionForm' : 'aSectionTournament', Math.round(d.w));
    h.innerHTML = maMatchRowsHtml(d.groups, { labels: d.labels });
    return ret(h.firstElementChild);
  }
  if (name === 'tooltip') {
    // the design pop's inner markup, its literal colours re-pointed to the palette tokens (tmap: rgb → var); its
    // flex-column layout (the design puts it on the pop) carried by a wrapper, since maTipHtml's body is caller markup
    const unmapped = new Set();
    const inner = d.inner.replace(/rgba?\([^)]*\)/g, (m) => { const k = m.replace(/\s+/g, ''); if (tmap[k]) return `var(${tmap[k]})`; unmapped.add(m); return m; });
    const L = d.layout;
    const body = `<span style="display:${L.display}; flex-direction:${L['flex-direction']}; gap:${L.gap}; align-items:${L['align-items']}; text-align:${L['text-align']};">${inner}</span>`;
    const h = host('aSectionForm', 400, 'padding-top:200px; display:flex; justify-content:center;');
    h.innerHTML = maTipHtml('<span style="display:inline-block; width:8px; height:8px;"></span>', body);
    const pop = h.querySelector('.elotip-pop');
    D.style(pop, 'opacity:1 !important; visibility:visible !important; transition:none !important;');
    const cs = getComputedStyle(pop);
    return ret(pop, { unmapped: [...unmapped], text: D.text(pop),
      shell: { background: cs.backgroundColor, border: cs.borderTopWidth + ' ' + cs.borderTopColor, radius: cs.borderTopLeftRadius, padding: cs.padding, shadow: cs.boxShadow, font: cs.fontFamily + ' ' + cs.fontSize } });
  }
  throw new Error('oursMount: unknown ' + name);
}

// The build capture's full-modal framing (tools/ten312-build-capture.mjs, the per-tab block), verbatim in effect.
function oursFrameFull(refW, FIT_H, VIEW_W, VIEW_H) {
  const ov = document.getElementById('analysisModal'), m = ov.querySelector('.modal-analysis'), body = m.querySelector('.aanalysis-body-wrap');
  window.__saved = [document.documentElement, document.body, ov, m, body, m.querySelector('.asidenav'), m.querySelector('.abody')].map((e) => [e, e.getAttribute('style')]);
  const st = (e, css) => e.setAttribute('style', (e.getAttribute('style') || '') + ';' + css);
  st(document.documentElement, 'background:transparent !important;'); st(document.body, 'background:transparent !important;');
  if (!document.getElementById('__capHide')) { const h = document.createElement('style'); h.id = '__capHide'; h.textContent = 'body > *:not(#analysisModal){ visibility:hidden !important; }'; document.head.appendChild(h); }
  st(ov, `background:transparent !important; backdrop-filter:none !important; position:absolute !important; inset:auto !important; left:0 !important; top:0 !important; width:${VIEW_W}px !important; height:auto !important; min-height:${VIEW_H}px !important; align-items:flex-start !important;`);
  st(m, 'height:auto !important;'); st(body, 'flex:none !important; grid-template-rows:auto !important;');
  st(m.querySelector('.asidenav'), 'overflow:visible !important;'); st(m.querySelector('.abody'), 'overflow:visible !important;');
  const h = m.getBoundingClientRect().height, w = refW || (h > FIT_H ? 1296 : 1306);
  st(ov, 'width:' + (w + 64) + 'px !important; padding:32px !important;'); st(m, `min-height:${Math.round(VIEW_H * 0.88)}px !important;`);
  const r = m.getBoundingClientRect(), hd = m.querySelector('.ahead2').getBoundingClientRect(), nv = m.querySelector('.asidenav'), items = nv.querySelectorAll('.asidenav-item, .asidenav-download');
  const last = items[items.length - 1].getBoundingClientRect();
  return { x: r.left + scrollX, y: r.top + scrollY, w: Math.round(r.width), h: Math.round(r.height), naturalH: Math.round(h),
    header: [0, 0, Math.round(r.width), Math.round(hd.bottom - r.top)], menu: [0, Math.round(hd.bottom - r.top), Math.round(nv.getBoundingClientRect().right - r.left), Math.round(last.bottom - r.top + 16)] };
}
function oursUnframeFull() { for (const [e, s] of window.__saved) { if (s == null) e.removeAttribute('style'); else e.setAttribute('style', s); } document.getElementById('__capHide')?.remove(); return true; }

// ---------------------------------------------------------------------------------------------------------------------
// Frame crops (python3 + PIL, the pixel diff's own dependency): the modal box outline, taken from each full PNG
// relative to its own edges so a height difference does not shift them.
//   frame-corners  the four 32×32 corners stitched 2×2 (radius 22 + the 1px border + its AA, and what shows inside)
//   frame-edges    8px bands along the top and the bottom edge, stacked (the border + 7px inside)
//   frame-sides    8px bands along the left and the right edge, side by side (heights differ → overlap only)
const CROP_PY = `
import sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGBA'); W, H = im.size; C, B = 32, 8
cor = Image.new('RGBA', (2 * C, 2 * C))
for (x, y), (dx, dy) in zip([(0, 0), (W - C, 0), (0, H - C), (W - C, H - C)], [(0, 0), (C, 0), (0, C), (C, C)]):
    cor.paste(im.crop((x, y, x + C, y + C)), (dx, dy))
cor.save(out + '/frame-corners.png')
e = Image.new('RGBA', (W, 2 * B)); e.paste(im.crop((0, 0, W, B)), (0, 0)); e.paste(im.crop((0, H - B, W, H)), (0, B)); e.save(out + '/frame-edges.png')
s = Image.new('RGBA', (2 * B, H)); s.paste(im.crop((0, 0, B, H)), (0, 0)); s.paste(im.crop((W - B, 0, W, H)), (B, 0)); s.save(out + '/frame-sides.png')
`;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const dirs = Object.fromEntries(['ref', 'source', 'night', 'full'].map((k) => [k, path.join(OUT, k)]));
  for (const k of ['ref', 'source', 'night']) { fs.rmSync(dirs[k], { recursive: true, force: true }); fs.mkdirSync(dirs[k], { recursive: true }); }
  const meta = { tool: 'tools/ten312-component-diff.mjs', frozenNow: new Date(FROZEN_NOW).toISOString(), timezone: TZ, viewport: [VIEW_W, VIEW_H], raster: 'software',
    palette: FIXTURE_SOURCE_PALETTE, components: {}, full: {} };

  // ---- 1. the existing full-modal captures (their own Chrome, one after the other) ----
  const FULL = '03-key-factors';
  if (!NO_FULL) {
    fs.mkdirSync(dirs.full, { recursive: true });
    await run(process.execPath, [path.join(TOOLS, 'ten312-design-capture.mjs'), path.join(dirs.full, 'design'), '--only', FULL]);
    await run(process.execPath, [path.join(TOOLS, 'ten312-build-capture.mjs'), path.join(dirs.full, 'night'), '--only', 'key', '--ref', path.join(dirs.full, 'design')]);
    child = null;
  }

  // ---- 2. one Chrome for the components (and the source-palette full capture) ----
  profile = path.join(OUT, '.chrome-profile'); fs.rmSync(profile, { recursive: true, force: true });
  const port = await freePort(); srv = await serve(ROOT, port);
  const dport = await freePort();
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${profile}`, '--remote-allow-origins=*', '--no-first-run',
    '--no-default-browser-check', '--force-device-scale-factor=1', '--hide-scrollbars', '--font-render-hinting=none', '--disable-gpu', '--disable-partial-raster',
    '--disable-threaded-animation', '--disable-checker-imaging', `--window-size=${VIEW_W},${VIEW_H}`, 'about:blank'], { stdio: 'ignore' });
  c = client(await cdpTarget(dport)); await c.ready;
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false });
  await c.send('Emulation.setTimezoneOverride', { timezoneId: TZ });
  await c.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  // the frozen Date of both tools + the build capture's auth neuter (inert on the design page)
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const T = ${FROZEN_NOW}, RD = Date;
    function D(...a) { if (!new.target) return new RD(T).toString(); return a.length ? new RD(...a) : new RD(T); }
    D.prototype = RD.prototype; D.now = () => T; D.parse = RD.parse; D.UTC = RD.UTC;
    Object.defineProperty(D.prototype, 'constructor', { value: D }); window.Date = D;
    var _b; Object.defineProperty(window, 'BSP', { configurable: true, get() { return _b; }, set(v) { if (v) { const u = Promise.resolve({ emailVerified: true });
      v.requireVerified = () => u; v.requireAuth = () => u; } _b = v; } });
  })();` });
  const ev = async (expr) => { const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('eval threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result?.value; };
  const shoot = async (file, clip, beyond) => {
    const shot = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!beyond, fromSurface: true, clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 1 } });
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  };
  const wanted = COMPONENTS.filter((k) => !ONLY || ONLY.has(k.name));

  // ---- 2a. design side ----
  await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/${HANDOFF_REL}/${encodeURIComponent(DESIGN)}` });
  const t0 = Date.now();
  while (!(await ev(`!!document.querySelector('.nav') && document.readyState === 'complete'`).catch(() => false))) {
    if (Date.now() - t0 > 60000) throw new Error('design did not mount within 60 s'); await sleep(250);
  }
  await ev(call(pageCommon)); await ev(call(pageCap));
  await ev(`document.fonts.ready.then(() => document.fonts.status)`);
  const design = {};
  for (const k of wanted) {
    await ev(`__cap.reset()`);
    for (const st of k.steps) {
      if (st.state) await ev(`__cap.set(${JSON.stringify(st.state)})`);
      if (st.click) await ev(`__cap.click(${JSON.stringify(st.click)}, ${st.nth || 0})`);
      await ev(`__cd.settle()`);
    }
    await ev(`document.fonts.ready`);
    const p = await ev(call(designProbe, k.name));
    await ev(`__cd.isolate(${JSON.stringify(p.bg.color)})`);
    await ev(`__cd.scroll()`); await ev(`__cd.settle()`);
    const clip = await ev(`__cd.clipRect(${k.pad})`);
    await shoot(path.join(dirs.ref, k.name + '.png'), clip);
    design[k.name] = p;
    meta.components[k.name] = { designSteps: k.steps, design: { bg: p.bg, lineHeight: p.lh, clip }, fed: p.data };
    console.log(`design  ${k.name.padEnd(16)} ${clip.w}x${clip.h}  bg ${p.bg.color}`);
    await ev(`__cd.undo()`);
  }
  // sheet-key / seg-sheet mount inside our sheet, which needs the sheet header's data too
  const sheetData = design['sheet-head'] ? design['sheet-head'].data : null;

  // ---- 2b. our side: the fixture modal, then each palette ----
  await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/bsp-consult-dashboard.html` });
  const t1 = Date.now();
  while (!(await ev(`typeof matches === 'object' && Array.isArray(matches) && typeof openAnalysisModal === 'function' && typeof aShowTab === 'function'`).catch(() => false))) {
    if (Date.now() - t1 > 90000) throw new Error('dashboard did not boot within 90 s'); await sleep(300);
  }
  await ev(`document.fonts.ready.then(() => true)`);
  await ev(`(() => { const fx = ${JSON.stringify(FIXTURE)}; const i = matches.findIndex(m => m.id === fx.id); if (i >= 0) matches.splice(i, 1); matches.push(fx); return true; })()`);
  await ev(`openAnalysisModal('ten312-fixture'), true`);
  if (!(await ev(`!!document.querySelector('#analysisModal .aclosecell') && document.querySelector('#analysisModal').classList.contains('ma-theme')`))) throw new Error('not this checkout, or the modal has no .ma-theme');
  meta.ourTheme = await ev(`document.getElementById('analysisModal').getAttribute('data-ma-theme')`);
  await ev(call(pageCommon));
  // rgb(...) → token for the tooltip's inner colours: the palette table read backwards, text roles first
  const toRgb = (v) => { if (v.startsWith('#')) { const n = parseInt(v.slice(1), 16); return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`; } return v.replace(/\s+/g, '').replace(/^rgba\((\d+),(\d+),(\d+),1\)$/, 'rgb($1,$2,$3)'); };
  const tmap = {};
  for (const k of ['--ma-t1', '--ma-t2', '--ma-t3', '--ma-link', '--ma-pos', '--ma-neg', ...Object.keys(FIXTURE_SOURCE_PALETTE)]) { const rgb = toRgb(FIXTURE_SOURCE_PALETTE[k]); if (!tmap[rgb]) tmap[rgb] = k; }
  meta.tooltipColourMap = tmap;

  for (const pal of ['night', 'source']) {
    await ev(`(() => { document.getElementById('__cdPalette')?.remove(); if (${pal === 'source'}) { const s = document.createElement('style'); s.id = '__cdPalette'; s.textContent = ${JSON.stringify(PALETTE_CSS)}; document.head.appendChild(s); } return true; })()`);
    const outDir = dirs[pal];
    // full modal (Key factors): this tool's copy of the build capture's framing; night is checked against the build capture's own PNG
    if (!NO_FULL) {
      await ev(`aShowTab('key'), true`); await sleep(1500); await ev(`__cd.settle()`);
      const refW = JSON.parse(fs.readFileSync(path.join(dirs.full, 'design', 'manifest.json'), 'utf8')).screens.find((s) => s.name === FULL).size[0];
      const fr = await ev(call(oursFrameFull, refW, FIT_H, VIEW_W, VIEW_H));
      await sleep(120); await ev(`__cd.settle()`);
      fs.mkdirSync(path.join(dirs.full, 'own-' + pal), { recursive: true });
      await shoot(path.join(dirs.full, 'own-' + pal, FULL + '.png'), fr, true);
      await ev(call(oursUnframeFull));
      fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ screens: [{ tab: 'key', ref: FULL, size: [fr.w, fr.h], header: fr.header, menu: fr.menu }] }, null, 1));
      meta.full[pal] = { size: [fr.w, fr.h], header: fr.header, menu: fr.menu };
    }
    for (const k of wanted) {
      await ev(`fhCloseSheet(), true`);
      if (k.ourTab) { await ev(`aShowTab(${JSON.stringify(k.ourTab)}), true`); await sleep(1500); await ev(`__cd.settle()`); }
      const d = k.name === 'seg-sheet' || k.name === 'sheet-head' || k.name === 'sheet-key'
        ? { sheet: sheetData || (() => { throw new Error(k.name + ' needs sheet-head in the run'); })(), key: design['sheet-key'] && design['sheet-key'].data }
        : design[k.name].data;
      if (k.name === 'seg-sheet') d.sheet = Object.assign({}, sheetData, { tabs: design['seg-sheet'].data.items });
      const o = await ev(call(oursMount, k.name, d, tmap));
      let bg = pal === 'source' ? design[k.name].bg.color : k.nightBg === 'real' ? o.bgReal.color : k.nightBg;
      if (/^var\(/.test(bg)) bg = await ev(`(() => { const s = document.createElement('span'); s.style.background = ${JSON.stringify(bg)}; document.getElementById('analysisModal').appendChild(s); const v = getComputedStyle(s).backgroundColor; s.remove(); return v; })()`);
      await ev(`__cd.isolate(${JSON.stringify(bg)})`);
      await ev(`__cd.scroll()`); await ev(`__cd.settle()`);
      const phase = await ev(`__cd.alignPhase(${JSON.stringify(meta.components[k.name].design.clip.exact)})`);
      await ev(`__cd.settle()`);
      if (!(await ev(`!!document.querySelector('[data-cd-clip]') && document.querySelector('[data-cd-clip]').isConnected`))) throw new Error(k.name + ': our mount was removed before capture');
      const clip = await ev(`__cd.clipRect(${k.pad})`);
      await shoot(path.join(outDir, k.name + '.png'), clip);
      meta.components[k.name][pal] = { bg, bgReal: o.bgReal, lineHeight: o.lh, clip, phase, extra: Object.fromEntries(Object.entries(o).filter(([x]) => !['bgReal', 'lh'].includes(x))) };
      console.log(`${pal.padEnd(7)} ${k.name.padEnd(16)} ${clip.w}x${clip.h}  bg ${bg}`);
      await ev(`__cd.undo()`);
    }
    await ev(`fhCloseSheet(), true`);
  }
  cleanup(); chrome = null; c = null;

  // ---- 3. full PNGs + frame crops into ref/source/night, then the pixel diff per palette ----
  if (!NO_FULL) {
    const eq = spawnSync('python3', ['-c', `
import sys
from PIL import Image, ImageChops
a = Image.open(sys.argv[1]).convert('RGBA'); b = Image.open(sys.argv[2]).convert('RGBA')
print(a.size == b.size and ImageChops.difference(a, b).getbbox() is None, a.size, b.size)`, path.join(dirs.full, 'night', FULL + '.png'), path.join(dirs.full, 'own-night', FULL + '.png')], { encoding: 'utf8' });
    meta.fullEquivalence = { buildCaptureNight_vs_ownNight_identical: eq.stdout.trim(), note: 'True = this tool\'s copy of the build capture framing reproduces the build capture pixel for pixel, so own-source differs only by the palette' };
    const src = { ref: path.join(dirs.full, 'design', FULL + '.png'), night: path.join(dirs.full, 'night', FULL + '.png'), source: path.join(dirs.full, 'own-source', FULL + '.png') };
    for (const [k, f] of Object.entries(src)) {
      fs.copyFileSync(f, path.join(dirs[k], FULL + '.png'));
      const r = spawnSync('python3', ['-c', CROP_PY, f, dirs[k]], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error('frame crop: ' + r.stderr);
    }
  }
  // A capture that is one flat colour means the component was not painted (a vacuous 0 %): fail loudly.
  const flat = spawnSync('python3', ['-c', `
import sys, os, json
from PIL import Image
bad = []
for d in sys.argv[1:]:
    for f in sorted(os.listdir(d)):
        if f.endswith('.png'):
            cols = Image.open(os.path.join(d, f)).convert('RGBA').getcolors(4)
            if cols is not None and len(cols) < 4: bad.append(os.path.join(os.path.basename(d), f))
print(json.dumps(bad))`, dirs.ref, dirs.source, dirs.night], { encoding: 'utf8' });
  meta.nearFlatCaptures = JSON.parse(flat.stdout || '[]');
  if (meta.nearFlatCaptures.length) console.error('WARNING: captures with < 4 colours (component not painted?):', meta.nearFlatCaptures.join(', '));
  for (const pal of ['source', 'night']) {
    const a = [path.join(TOOLS, 'ten312-pixel-diff.py'), dirs.ref, dirs[pal], path.join(OUT, 'diff-' + pal)];
    if (!NO_FULL) a.push('--regions', path.join(dirs[pal], 'manifest.json'));
    const r = spawnSync('python3', a, { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('pixel diff: ' + r.stderr);
  }
  // ---- 4. summary: both palettes in one table ----
  const rep = Object.fromEntries(['source', 'night'].map((p) => [p, JSON.parse(fs.readFileSync(path.join(OUT, 'diff-' + p, 'report.json'), 'utf8')).rows]));
  const lines = ['| component | palette | ref size | ours size | size match | px t=0 | % t=0 | px t=8 | % t=8 |', '|---|---|---|---|---|---|---|---|---|'];
  for (const row of rep.source) for (const p of ['source', 'night']) {
    const r = rep[p].find((x) => x.name === row.name); if (!r) continue;
    lines.push(`| ${r.name} | ${p} | ${r.refSize.join('x')} | ${r.candSize.join('x')} | ${r.sizeMatch ? 'yes' : `NO (overlap ${r.compared.join('x')})`} | ${r.diffPx} | ${r.pct.toFixed(3)} | ${r.diffPxAlso} | ${r.pctAlso.toFixed(3)} |`);
  }
  fs.writeFileSync(path.join(OUT, 'summary.md'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'components.json'), JSON.stringify(meta, null, 1));
  console.log(lines.join('\n'));
}
main().then(() => { cleanup(); process.exit(0); }, (e) => { console.error('FAIL:', e.stack || e.message); cleanup(); process.exit(1); });
