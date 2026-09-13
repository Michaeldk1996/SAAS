#!/usr/bin/env node
// TEN-196 round 5 — CHARTS.md conformance, measured off what Chrome painted.
//
// Every expectation here is re-derived by THIS FILE from database-yield.json with its
// own parser. Nothing is imported from the page's code, and no figure is copied from
// the design export.
//
// SUBJECT CHOICE IS PART OF THE TEST (the CLAUDE.md rule from round 3: assert an
// invariant where a broken build can move it).
//
//   · §5 area path closes to the ZERO LINE, not the plot bottom → asserted on
//     GERRY WEBER OPEN, whose zero line sits at exactly 150.0 of 300 (50% of the
//     plot). On the Tour chart zeroY is 6.4 — 2% from the top — so "closes to zeroY"
//     and "closes to the top edge" are three pixels apart and a wrong build passes.
//   · §5.1 loss tint height = viewBoxHeight − zeroY → same subject, expected 150,
//     which is distinguishable from the full 300. On the Tour chart the expected
//     height is 293.6 and a full-height rect is within 2% of it.
//   · §7 plate collision → OPEN SUD DE FRANCE, where the two end values are 0.4167%
//     of plot height apart and the plates MUST separate to 13.50% while the dots must
//     NOT move. Asserted on the Tour chart it is vacuous: its ends are 58% apart.
//   · §4 positioning context → the overlays' PAINTED client rects are compared to the
//     svg's own painted rect. A build that positions them against a padded parent
//     still emits the right percentage string and only misses in layout.
//
// Usage: node ten196-r5-charts-probe.mjs
//        PROBE_BASE=http://127.0.0.1:8899 node ten196-r5-charts-probe.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.PROBE_BASE || 'https://michaeldk1996.github.io/SAAS';
const URL = `${BASE}/bsp-consult-dashboard.html`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bust = () => `?cb=${Math.floor(Math.random() * 1e9)}`;

let PASS = 0; const FAILS = [];
function ok(name, cond, got, want) {
  if (cond) { PASS++; console.log(`  ✓ ${name}` + (got !== undefined ? `  [${got}]` : '')); }
  else { FAILS.push(name); console.log(`  ✗ ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ── colour maths, implemented here ─────────────────────────────────────────────
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function parseColor(s) {
  s = String(s).trim();
  if (s[0] === '#') return hex2rgb(s);
  const m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
  if (!m) throw new Error('unparsed colour: ' + s);
  return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
}
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const relLum = (rgb) => { const [r, g, b] = rgb.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function toLab(rgb) {
  const [r, g, b] = rgb.slice(0, 3).map(lin);
  let X = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
  let Y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
  let Z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041;
  X /= 0.95047; Z /= 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function deltaE2000(c1, c2) {
  const [L1, a1, b1] = toLab(c1), [L2, a2, b2] = toLab(c2);
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
  const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  const hpf = (b, a) => { if (a === 0 && b === 0) return 0; const d = Math.atan2(b, a) * 180 / Math.PI; return d < 0 ? d + 360 : d; };
  const hp1 = hpf(b1, ap1), hp2 = hpf(b2, ap2);
  const dL = L2 - L1, dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) { dh = hp2 - hp1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(dh * Math.PI / 360);
  const Lb = (L1 + L2) / 2, Cpb = (Cp1 + Cp2) / 2;
  let Hb = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) { if (Math.abs(hp1 - hp2) > 180) Hb += (Hb < 360 ? 360 : -360); Hb /= 2; }
  const T = 1 - 0.17 * Math.cos((Hb - 30) * Math.PI / 180) + 0.24 * Math.cos(2 * Hb * Math.PI / 180)
    + 0.32 * Math.cos((3 * Hb + 6) * Math.PI / 180) - 0.20 * Math.cos((4 * Hb - 63) * Math.PI / 180);
  const Sl = 1 + (0.015 * Math.pow(Lb - 50, 2)) / Math.sqrt(20 + Math.pow(Lb - 50, 2));
  const Sc = 1 + 0.045 * Cpb, Sh = 1 + 0.015 * Cpb * T;
  const Rt = -2 * Math.sqrt(Math.pow(Cpb, 7) / (Math.pow(Cpb, 7) + Math.pow(25, 7)))
    * Math.sin(60 * Math.exp(-Math.pow((Hb - 275) / 25, 2)) * Math.PI / 180);
  return Math.sqrt(Math.pow(dL / Sl, 2) + Math.pow(dC / Sc, 2) + Math.pow(dH / Sh, 2) + Rt * (dC / Sc) * (dH / Sh));
}

// ── independent re-derivation of the chart geometry from the artefact ──────────
function cumSeries(rows) {
  const ord = rows.slice().sort((a, b) => a[0] - b[0]);
  const fav = [], dog = []; let cf = 0, cd = 0, seamX = null;
  const den = (ord.length - 1) || 1;
  ord.forEach((r, i) => {
    cf += r[7] ? (r[5] - 1) : -1;
    cd += r[7] ? -1 : (r[6] - 1);
    fav.push(cf); dog.push(cd);
    if (seamX === null && r[8] === 1) seamX = i / den;
  });
  return { fav, dog, seamX, n: ord.length, ord };
}
function chartGeom(rows, isTourn) {
  const s = cumSeries(rows);
  const rawHi = Math.max(Math.max(...s.fav), Math.max(...s.dog));
  const rawLo = Math.min(Math.min(...s.fav), Math.min(...s.dog));
  const sp = rawHi - rawLo;
  const step = [10, 25, 50, 100, 250, 500, 1000, 2500].find((x) => sp / x <= 10) || 5000;
  const rnd = Math.max(10, step / 10);
  let hi = (isTourn && rawHi > 0) ? Math.ceil(rawHi / step) * step : Math.max(rnd, Math.ceil(rawHi / rnd) * rnd);
  let lo = Math.floor(rawLo / rnd) * rnd;
  if (hi === lo) hi = lo + rnd;
  if (hi < 0) hi = 0;
  if (lo > 0) lo = 0;
  const H = 300, Y = (v) => ((hi - v) / (hi - lo)) * H;
  return { ...s, hi, lo, step, H, Y, zeroY: Y(0), rawHi, rawLo,
    favEnd: s.fav[s.fav.length - 1], dogEnd: s.dog[s.dog.length - 1] };
}
// Mirrors the page's own fmtU/fmtInt: ASCII hyphen from String(), thousands
// separators by regex, no forced '+'. Re-implemented here, not imported.
const fmtInt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const fmtU = (v) => fmtInt(Math.round(v)) + 'u';

// Independent port of the page's extrema-preserving sampler, used ONLY to build the
// unsmoothed baseline the guarded line is compared against.
function sampleKeepJS(xs, vals, N) {
  const n = xs.length;
  if (n <= N) return Array.from({ length: n }, (_, i) => i);
  const B = Math.max(1, Math.floor((N - 2) / 2)), x0 = xs[0], sp = (xs[n - 1] - x0) || 1;
  const keep = []; let b = -1, mn = 0, mx = 0;
  const flush = () => { const a = Math.min(mn, mx), z = Math.max(mn, mx); keep.push(a); if (z !== a) keep.push(z); };
  for (let i = 0; i < n; i++) {
    let bk = Math.floor((xs[i] - x0) / sp * B); if (bk >= B) bk = B - 1; if (bk < 0) bk = 0;
    if (bk !== b) { if (b >= 0) flush(); b = bk; mn = i; mx = i; }
    if (vals[i] < vals[mn]) mn = i;
    if (vals[i] > vals[mx]) mx = i;
  }
  if (b >= 0) flush();
  if (keep[0] !== 0) keep.unshift(0);
  if (keep[keep.length - 1] !== n - 1) keep.push(n - 1);
  return keep;
}

// ── CDP ────────────────────────────────────────────────────────────────────────
function client(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pend = new Map(); const handlers = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id); pend.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    } else if (m.method && handlers.has(m.method)) handlers.get(m.method)(m.params);
  };
  return { ready, on: (m, fn) => handlers.set(m, fn),
    send: (method, params = {}) => ready.then(() => new Promise((res, rej) => {
      const mid = ++id; pend.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    })), close: () => ws.close() };
}

(async () => {
  console.log(`TEN-196 round 5 · CHARTS.md conformance · ${URL}\n`);
  const art = await (await fetch(`${BASE}/database-yield.json${bust()}`)).json();
  const rows = art.rows, TOURN = art.meta.tournaments;

  // PRECONDITIONS pinned as literals. A derived expectation cannot detect a change in
  // what it derives from (round 2: 22/22 against a deleted-data artefact).
  ok('precondition: archive still holds 41,667 rows', rows.length === 41667, rows.length, 41667);
  const gwIx = TOURN.indexOf('Gerry Weber Open');
  const osfIx = TOURN.indexOf('Open Sud de France');
  ok('precondition: both probe subjects still exist', gwIx >= 0 && osfIx >= 0, [gwIx, osfIx], '>=0');
  const gwRows = rows.filter((r) => r[4] === gwIx);
  const osfRows = rows.filter((r) => r[4] === osfIx);
  ok('precondition: Gerry Weber Open still holds 260 rows', gwRows.length === 260, gwRows.length, 260);
  ok('precondition: Open Sud de France still holds 427 rows', osfRows.length === 427, osfRows.length, 427);

  const tourG = chartGeom(rows, false);
  const gwG = chartGeom(gwRows, true);
  const osfG = chartGeom(osfRows, true);
  console.log('\n── recomputed from the artefact ──');
  console.log(`  Tour        zeroY ${tourG.zeroY.toFixed(1)}  favEnd ${tourG.favEnd.toFixed(2)} (${fmtU(tourG.favEnd)})  dogEnd ${tourG.dogEnd.toFixed(2)} (${fmtU(tourG.dogEnd)})  seamX ${tourG.seamX.toFixed(4)}`);
  console.log(`  Gerry Weber zeroY ${gwG.zeroY.toFixed(1)}  lossH ${(300 - gwG.zeroY).toFixed(1)}  favEnd ${gwG.favEnd.toFixed(2)}  dogEnd ${gwG.dogEnd.toFixed(2)}`);
  const osfFavPct = osfG.Y(osfG.favEnd) / 3, osfDogPct = osfG.Y(osfG.dogEnd) / 3;
  console.log(`  Open Sud    fav top ${osfFavPct.toFixed(4)}%  dog top ${osfDogPct.toFixed(4)}%  gap ${Math.abs(osfFavPct - osfDogPct).toFixed(4)}%`);

  // The collision subject must actually collide, or §7's assertions are vacuous.
  ok('precondition: Open Sud de France end values DO collide (<13.50% apart)',
    Math.abs(osfFavPct - osfDogPct) < 13.5, Math.abs(osfFavPct - osfDogPct).toFixed(4) + '%', '<13.5%');
  ok('precondition: Gerry Weber zero line is mid-plot, not near an edge',
    gwG.zeroY > 100 && gwG.zeroY < 200, gwG.zeroY.toFixed(1), '100..200 of 300');

  // ── browser ──────────────────────────────────────────────────────────────────
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten196r5-'));
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
      '--no-first-run', '--window-size=1680,1600', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let dport = 0;
  await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('chrome start timeout')), 20000);
    chrome.stderr.on('data', (d) => {
      const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(String(d));
      if (m) { dport = +m[1]; clearTimeout(to); res(); }
    });
  });
  const list = await (await fetch(`http://127.0.0.1:${dport}/json`)).json();
  const c = client(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await c.ready;
  await c.send('Page.enable'); await c.send('Runtime.enable');
  const errs = [];
  c.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    errs.push(`${d.text || 'exception'} ${(d.exception && d.exception.description) || ''}`);
  });
  await c.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){var stub=new Proxy({},{get:function(t,k){
      if(k==='requireVerified'||k==='requireAuth') return function(){return Promise.resolve({ok:true,email:'probe@local'})};
      if(k==='onAuthChange') return function(){};
      return t[k]||function(){}; },set:function(t,k,v){t[k]=v;return true}});
      Object.defineProperty(window,'BSP',{get:function(){return stub},set:function(){},configurable:true,enumerable:true});})();`,
  });
  await c.send('Page.navigate', { url: URL + bust() });
  await sleep(2200);
  const ev = async (expr) => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || ''));
    return r.result.value;
  };
  await ev(`(function(){var b=document.getElementById('databaseTabBtn'); if(b){b.style.display=''; b.click();} })()`);
  const dl = Date.now() + 45000;
  while (Date.now() < dl) {
    if (await ev(`document.querySelectorAll('[data-page="database"] .db-plotarea svg').length`) >= 1) break;
    await sleep(400);
  }

  const Q = `[data-page="database"] `;
  const chart = async () => ev(`(function(){
    var pa=document.querySelector('${Q}.db-plotarea'); if(!pa) return {error:'no plotarea'};
    var sv=pa.querySelector('svg'), pr=pa.getBoundingClientRect(), sr=sv.getBoundingClientRect();
    var kids=[].slice.call(sv.children).map(function(n){return n.tagName.toLowerCase()+':'+(n.getAttribute('stroke')||n.getAttribute('fill')||'');});
    var pl=[].slice.call(sv.querySelectorAll('polyline')).map(function(p){var cs=getComputedStyle(p);
      return {stroke:cs.stroke, dash:cs.strokeDasharray, w:cs.strokeWidth, join:cs.strokeLinejoin, cap:cs.strokeLinecap,
              ve:p.getAttribute('vector-effect'), verts:p.getAttribute('points').trim().split(/\\s+/).length,
              pts:p.getAttribute('points')};});
    var paths=[].slice.call(sv.querySelectorAll('path')).map(function(p){return {d:p.getAttribute('d'), fill:getComputedStyle(p).fill};});
    var rect=sv.querySelector('rect');
    var zl=[].slice.call(sv.querySelectorAll('line')).filter(function(l){return /0\\.4\\)|0\\.40\\)/.test(l.getAttribute('stroke')||'');});
    var seam=[].slice.call(sv.querySelectorAll('line')).filter(function(l){return (l.getAttribute('stroke-dasharray')||'')==='4 4';});
    var be=pa.querySelector('.db-belab'), sm=pa.querySelector('.db-seamlab');
    var dots=[].slice.call(pa.querySelectorAll('.db-enddot')).map(function(d){var r=d.getBoundingClientRect(); var cs=getComputedStyle(d);
      return {cx:r.left+r.width/2, cy:r.top+r.height/2, w:r.width, h:r.height, bg:cs.backgroundColor, shadow:cs.boxShadow, top:d.style.top};});
    var ec=document.querySelector('${Q}.db-endcol');
    var plates=ec?[].slice.call(ec.querySelectorAll('.db-plate')).map(function(p){var r=p.getBoundingClientRect(); var cs=getComputedStyle(p);
      var b=p.querySelector('b'), s=p.querySelector('span'); var bs=getComputedStyle(b), ss=getComputedStyle(s);
      return {cy:r.top+r.height/2, h:r.height, top:p.style.top, cls:p.className,
              l:r.left, t:r.top, rt:r.right, b:r.bottom, bg:cs.backgroundColor, bd:cs.borderTopWidth+' '+cs.borderTopColor,
              radius:cs.borderTopLeftRadius, pad:cs.paddingTop+' '+cs.paddingLeft,
              name:b.textContent, nameSize:bs.fontSize, nameWeight:bs.fontWeight, nameCol:bs.color,
              val:s.textContent, valSize:ss.fontSize, valWeight:ss.fontWeight, valCol:ss.color, valLH:ss.lineHeight};}):[];
    var ya=document.querySelector('${Q}.db-yaxis'), yr=ya.getBoundingClientRect(), y0=ya.firstChild?getComputedStyle(ya.firstChild):null;
    var xa=document.querySelector('${Q}.db-xaxis'), xs=xa.firstChild?getComputedStyle(xa.firstChild):null;
    var cap=document.querySelector('${Q}.db-xcap .db-eyebrow'), cs2=cap?getComputedStyle(cap):null;
    var ecr=ec?ec.getBoundingClientRect():null;
    var leg=[].slice.call(document.querySelectorAll('${Q}.db-legend i')).map(function(i){var r=i.getBoundingClientRect(), s=getComputedStyle(i);
      return {w:r.width, h:r.height, bg:s.backgroundColor, radius:s.borderTopLeftRadius, bt:s.borderTopStyle};});
    var h3=document.querySelector('${Q}.db-charthead h3'), h3s=h3?getComputedStyle(h3):null;
    var sub=document.querySelector('${Q}.db-subline'), subs=sub?getComputedStyle(sub):null;
    var foot=document.querySelector('${Q}.db-seamfoot'), fs=foot?getComputedStyle(foot):null;
    return {
      plotRect:{l:pr.left,t:pr.top,w:pr.width,h:pr.height}, svgRect:{l:sr.left,t:sr.top,w:sr.width,h:sr.height},
      padRight:getComputedStyle(pa).paddingRight, pos:getComputedStyle(pa).position,
      gap:getComputedStyle(document.querySelector('${Q}.db-plot')).gap,
      viewBox:sv.getAttribute('viewBox'), par:sv.getAttribute('preserveAspectRatio'), ovf:getComputedStyle(sv).overflow,
      kids:kids, polylines:pl, paths:paths,
      tint: rect?{y:+rect.getAttribute('y'), h:+rect.getAttribute('height'), fill:getComputedStyle(rect).fill}:null,
      zeroLine: zl.length?{y:+zl[0].getAttribute('y1'), w:zl[0].getAttribute('stroke-width'), col:getComputedStyle(zl[0]).stroke}:null,
      seamLine: seam.length?{x:+seam[0].getAttribute('x1'), col:getComputedStyle(seam[0]).stroke}:null,
      be: be?(function(){var r=be.getBoundingClientRect(); var s=getComputedStyle(be);
        return {cy:r.top+r.height/2, left:r.left, txt:be.textContent, size:s.fontSize, weight:s.fontWeight, ls:s.letterSpacing, tt:s.textTransform, bg:s.backgroundColor, col:s.color, radius:s.borderTopLeftRadius};})():null,
      seamLab: sm?(function(){var r=sm.getBoundingClientRect(); var s=getComputedStyle(sm);
        return {cx:r.left+r.width/2, txt:sm.textContent, size:s.fontSize, ls:s.letterSpacing, col:s.color, bg:s.backgroundColor};})():null,
      dots:dots, plates:plates,
      yaxis:{w:yr.width, h:yr.height, size:y0&&y0.fontSize, weight:y0&&y0.fontWeight, col:y0&&y0.color, n:ya.children.length, first:ya.firstChild&&ya.firstChild.textContent},
      xaxis:{margin:getComputedStyle(xa).margin, size:xs&&xs.fontSize, col:xs&&xs.color, n:xa.children.length,
             labels:[].slice.call(xa.children).map(function(d){return d.textContent;}),
             rects:[].slice.call(xa.children).map(function(d){var r=d.getBoundingClientRect();
               return {l:r.left,t:r.top,r:r.right,b:r.bottom};})},
      cap: cap?{txt:cap.textContent, size:cs2.fontSize, weight:cs2.fontWeight, ls:cs2.letterSpacing, tt:cs2.textTransform, col:cs2.color}:null,
      endcol: ecr?{w:ecr.width, h:ecr.height}:null,
      legend:leg, title:h3s?{size:h3s.fontSize, weight:h3s.fontWeight, ls:h3s.letterSpacing, txt:h3.textContent}:null,
      subline:subs?{size:subs.fontSize, col:subs.color, txt:sub.textContent}:null,
      foot:fs?{bl:fs.borderLeftWidth+' '+fs.borderLeftColor, size:fs.fontSize, lh:fs.lineHeight, mw:fs.maxWidth, txt:foot.textContent}:null,
      cardBg:getComputedStyle(document.querySelector('${Q}.db-card')).backgroundColor
    };
  })()`);

  const T = await chart();
  if (T.error) { console.log('FATAL: ' + T.error); chrome.kill(); process.exit(1); }
  const BG = parseColor(T.cardBg);

  // ══ §4 geometry and positioning context ══════════════════════════════════════
  console.log('\n── §4 · plot geometry and positioning context ──');
  ok('viewBox is 0 0 1000 300', T.viewBox === '0 0 1000 300', T.viewBox, '0 0 1000 300');
  ok('preserveAspectRatio none', T.par === 'none', T.par, 'none');
  ok('svg overflow visible', T.ovf === 'visible', T.ovf, 'visible');
  ok('y-axis column is 70px', near(T.yaxis.w, 70, 0.6), T.yaxis.w, 70);
  ok('rendered plot height is 400px', near(T.plotRect.h, 400, 0.6), T.plotRect.h, 400);
  ok('end-plate column is 104px', T.endcol && near(T.endcol.w, 104, 0.6), T.endcol && T.endcol.w, 104);
  ok('flex gap between columns is 12px', T.gap === '12px', T.gap, '12px');
  ok('x-tick row margin is 10px 116px 0 82px', T.xaxis.margin === '10px 116px 0px 82px', T.xaxis.margin, '10px 116px 0px 82px');
  // THE §4 ASSERTION: the plot div, not a padded parent, is the positioning context.
  // A padded parent still yields the same top:% string and only misses in layout,
  // so this compares PAINTED rects.
  ok('plot div carries no padding (it is the positioning context)', T.padRight === '0px', T.padRight, '0px');
  ok('plot div is position:relative', T.pos === 'relative', T.pos, 'relative');
  ok('svg fills the plot div exactly (no inset from padding)',
    near(T.svgRect.w, T.plotRect.w, 0.6) && near(T.svgRect.l, T.plotRect.l, 0.6),
    [T.svgRect.w, T.plotRect.w], 'equal');

  // ══ §5 layer order ═══════════════════════════════════════════════════════════
  console.log('\n── §5 · layer order inside the svg ──');
  // §5 names an EXACT bottom-to-top sequence, so assert the sequence, not a pair of
  // inequalities. The previous form ("some <line> exists after the first <path>") was
  // satisfied by the SEAM line, so moving the zero line underneath both area fills —
  // a genuine break, the fills then wash over the chart's most important reference —
  // scored full marks. Mutation-confirmed by the clean-context review.
  const kinds = T.kids.map((k) => k.split(':')[0]);
  const nGridH = T.yaxis.n, nGridV = T.xaxis.n;
  const wantSeq = ['rect']
    .concat(Array(nGridH).fill('line'))    // 2 · horizontal gridlines
    .concat(Array(nGridV).fill('line'))    // 3 · vertical gridlines
    .concat(['path', 'path'])              // 4 · area fills, favourites then underdogs
    .concat(['line'])                      // 5 · zero line
    .concat(T.seamLine ? ['line'] : [])    // 6 · book seam
    .concat(['polyline', 'polyline']);     // 7 · lines
  ok('§5 layer sequence is exactly rect, grids, areas, zero, seam, lines',
    kinds.join(',') === wantSeq.join(','), kinds.join(','), wantSeq.join(','));
  // Tag-shape alone cannot tell the zero line from a gridline, so pin the zero line's
  // INDEX and check what sits either side of it by attribute.
  const zeroIdx = 1 + nGridH + nGridV + 2;
  ok('the zero line sits ABOVE both area fills (index, not just presence)',
    kinds[zeroIdx] === 'line' && kinds[zeroIdx - 1] === 'path' && kinds[zeroIdx - 2] === 'path',
    [kinds[zeroIdx - 2], kinds[zeroIdx - 1], kinds[zeroIdx]], ['path', 'path', 'line']);
  ok('horizontal gridlines precede vertical gridlines',
    T.kids.slice(1, 1 + nGridH).every((k) => /0\.06\)/.test(k)) &&
    T.kids.slice(1 + nGridH, 1 + nGridH + nGridV).every((k) => /0\.045\)/.test(k)),
    [T.kids[1], T.kids[1 + nGridH]], ['…0.06)', '…0.045)']);
  ok('exactly two area paths', T.paths.length === 2, T.paths.length, 2);
  ok('underdogs drawn first, favourites on top',
    deltaE2000(parseColor(T.polylines[0].stroke), hex2rgb('#c6ccdb')) < 1 &&
    deltaE2000(parseColor(T.polylines[1].stroke), hex2rgb('#5b9bff')) < 1,
    T.polylines.map((p) => p.stroke), 'dog then fav');

  // ══ §2 colours ═══════════════════════════════════════════════════════════════
  console.log('\n── §2 · series colours (computed, as painted) ──');
  const dogC = parseColor(T.polylines[0].stroke), favC = parseColor(T.polylines[1].stroke);
  const dE = deltaE2000(favC, dogC);
  ok('favourites stroke is #5b9bff', deltaE2000(favC, hex2rgb('#5b9bff')) < 1, T.polylines[1].stroke, '#5b9bff');
  ok('underdogs stroke is #c6ccdb', deltaE2000(dogC, hex2rgb('#c6ccdb')) < 1, T.polylines[0].stroke, '#c6ccdb');
  ok('series separation clears the bar that rejected #4db8ff (dE 10.87)', dE > 20, dE.toFixed(2), '>20');
  ok('underdog contrast on the card is >=7:1', contrast(dogC, BG) >= 7, contrast(dogC, BG).toFixed(1) + ':1', '>=7:1');
  ['#3dd68c', '#e0616f', '#e8a84e'].forEach((res) => {
    ok(`neither series takes the reserved token ${res}`,
      deltaE2000(favC, hex2rgb(res)) > 5 && deltaE2000(dogC, hex2rgb(res)) > 5, res, 'unused');
  });
  const favFill = parseColor(T.paths[0].fill), dogFill = parseColor(T.paths[1].fill);
  ok('favourites area fill rgba(91,155,255,0.11)',
    favFill[0] === 91 && favFill[1] === 155 && favFill[2] === 255 && near(favFill[3], 0.11, 0.005), T.paths[0].fill, 'rgba(91,155,255,0.11)');
  ok('underdogs area fill rgba(198,204,219,0.07)',
    dogFill[0] === 198 && dogFill[1] === 204 && dogFill[2] === 219 && near(dogFill[3], 0.07, 0.005), T.paths[1].fill, 'rgba(198,204,219,0.07)');

  // ══ §3 strokes ═══════════════════════════════════════════════════════════════
  console.log('\n── §3 · stroke widths and line attributes ──');
  ok('favourites stroke-width 2.6', T.polylines[1].w === '2.6px' || T.polylines[1].w === '2.6', T.polylines[1].w, '2.6');
  ok('underdogs stroke-width 2', T.polylines[0].w === '2px' || T.polylines[0].w === '2', T.polylines[0].w, '2');
  T.polylines.forEach((p, i) => {
    ok(`line ${i} stroke-linejoin round`, p.join === 'round', p.join, 'round');
    ok(`line ${i} stroke-linecap round`, p.cap === 'round', p.cap, 'round');
    ok(`line ${i} vector-effect non-scaling-stroke`, p.ve === 'non-scaling-stroke', p.ve, 'non-scaling-stroke');
  });

  // ══ §10 retired ══════════════════════════════════════════════════════════════
  console.log('\n── §10 · retired ──');
  ok('no dashed series line anywhere on the chart',
    T.polylines.every((p) => p.dash === 'none' || p.dash === ''), T.polylines.map((p) => p.dash), 'none');
  ok('#4db8ff is not painted by either series',
    deltaE2000(favC, hex2rgb('#4db8ff')) > 5 && deltaE2000(dogC, hex2rgb('#4db8ff')) > 5, 'absent', 'absent');
  ok('legend swatches are solid bars, not dashes',
    T.legend.length === 2 && T.legend.every((l) => near(l.w, 18, 0.6) && near(l.h, 3, 0.6) && l.bt === 'none'),
    T.legend.map((l) => `${l.w}x${l.h} ${l.bt}`), '18x3 none');

  // ══ §5.1 loss tint, §5 zero line, §6 overlays — on the Tour chart ════════════
  console.log('\n── §5.1 / §5.5 / §6 · tint, zero line, overlays (Tour) ──');
  ok('loss tint y equals the recomputed zeroY', near(T.tint.y, tourG.zeroY, 0.15), T.tint.y, tourG.zeroY.toFixed(1));
  ok('loss tint height is viewBoxHeight − zeroY, not full height',
    near(T.tint.h, 300 - tourG.zeroY, 0.15) && T.tint.h < 300, T.tint.h, (300 - tourG.zeroY).toFixed(1));
  ok('zero line at the recomputed zeroY', near(T.zeroLine.y, tourG.zeroY, 0.15), T.zeroLine.y, tourG.zeroY.toFixed(1));
  ok('zero line stroke-width 1.5', T.zeroLine.w === '1.5', T.zeroLine.w, '1.5');
  const zc = parseColor(T.zeroLine.col);
  ok('zero line rgba(255,255,255,0.40)', zc[0] === 255 && zc[1] === 255 && zc[2] === 255 && near(zc[3], 0.40, 0.005), T.zeroLine.col, 'rgba(255,255,255,0.4)');
  ok('book seam x equals the recomputed seam fraction', near(T.seamLine.x / 1000, tourG.seamX, 0.0005), (T.seamLine.x / 1000).toFixed(4), tourG.seamX.toFixed(4));
  ok('break-even label text', T.be.txt === 'Break even', T.be.txt, 'Break even');
  ok('break-even label 9.5px / 600 / uppercase', T.be.size === '9.5px' && T.be.weight === '600' && T.be.tt === 'uppercase',
    [T.be.size, T.be.weight, T.be.tt], ['9.5px', '600', 'uppercase']);
  ok('break-even label background is opaque #0a0d14',
    parseColor(T.be.bg).slice(0, 3).join() === BG.slice(0, 3).join() && parseColor(T.be.bg)[3] === 1, T.be.bg, T.cardBg);
  // PAINTED position — this is the §4 check that a padded parent would fail.
  const zeroClientY = T.svgRect.t + (tourG.zeroY / 300) * T.svgRect.h;
  ok('break-even label PAINTS on the zero line (±1.5px)', near(T.be.cy, zeroClientY, 1.5),
    T.be.cy.toFixed(1), zeroClientY.toFixed(1));
  const seamClientX = T.svgRect.l + tourG.seamX * T.svgRect.w;
  ok('seam label PAINTS on the seam line (±1.5px)', near(T.seamLab.cx, seamClientX, 1.5),
    T.seamLab.cx.toFixed(1), seamClientX.toFixed(1));
  ok('seam label reads the second book name', T.seamLab.txt === art.meta.books[1], T.seamLab.txt, art.meta.books[1]);
  ok('seam label colour #e8a84e', deltaE2000(parseColor(T.seamLab.col), hex2rgb('#e8a84e')) < 1, T.seamLab.col, '#e8a84e');

  // ══ §6 end markers ═══════════════════════════════════════════════════════════
  console.log('\n── §6 · end markers ──');
  ok('two end dots', T.dots.length === 2, T.dots.length, 2);
  ok('end dots are 9px', T.dots.every((d) => near(d.w, 9, 0.6) && near(d.h, 9, 0.6)), T.dots.map((d) => d.w), 9);
  ok('end dots carry the 3px punch-out ring', T.dots.every((d) => /3px/.test(d.shadow)), T.dots[0].shadow, '0 0 0 3px');
  const favDotY = T.svgRect.t + (tourG.Y(tourG.favEnd) / 300) * T.svgRect.h;
  const dogDotY = T.svgRect.t + (tourG.Y(tourG.dogEnd) / 300) * T.svgRect.h;
  const dotFav = T.dots.find((d) => deltaE2000(parseColor(d.bg), hex2rgb('#5b9bff')) < 1);
  const dotDog = T.dots.find((d) => deltaE2000(parseColor(d.bg), hex2rgb('#c6ccdb')) < 1);
  ok('favourites dot PAINTS at its true end value', near(dotFav.cy, favDotY, 1.5), dotFav.cy.toFixed(1), favDotY.toFixed(1));
  ok('underdogs dot PAINTS at its true end value', near(dotDog.cy, dogDotY, 1.5), dotDog.cy.toFixed(1), dogDotY.toFixed(1));
  ok('end dots sit on the plot’s right edge',
    T.dots.every((d) => near(d.cx, T.plotRect.l + T.plotRect.w, 1.5)), T.dots.map((d) => d.cx.toFixed(1)), (T.plotRect.l + T.plotRect.w).toFixed(1));

  // ══ §7 plates — Tour (non-colliding) ═════════════════════════════════════════
  console.log('\n── §7 · end-value plates (Tour) ──');
  ok('two plates', T.plates.length === 2, T.plates.length, 2);
  const pFav = T.plates.find((p) => /fav/.test(p.cls)), pDog = T.plates.find((p) => /dog/.test(p.cls));
  ok('favourites plate value matches the archive', pFav.val === fmtU(tourG.favEnd), pFav.val, fmtU(tourG.favEnd));
  ok('underdogs plate value matches the archive', pDog.val === fmtU(tourG.dogEnd), pDog.val, fmtU(tourG.dogEnd));
  ok('plate name 11px / 700', pFav.nameSize === '11px' && pFav.nameWeight === '700', [pFav.nameSize, pFav.nameWeight], ['11px', '700']);
  ok('plate value 16px / 700 / line-height 1', pFav.valSize === '16px' && pFav.valWeight === '700' && near(parseFloat(pFav.valLH), 16, 0.6),
    [pFav.valSize, pFav.valWeight, pFav.valLH], ['16px', '700', '16px']);
  ok('plate value colour #e7e9ee', deltaE2000(parseColor(pFav.valCol), hex2rgb('#e7e9ee')) < 1, pFav.valCol, '#e7e9ee');
  ok('favourites plate name colour #82b4ff', deltaE2000(parseColor(pFav.nameCol), hex2rgb('#82b4ff')) < 1, pFav.nameCol, '#82b4ff');
  ok('underdogs plate name colour #c6ccdb', deltaE2000(parseColor(pDog.nameCol), hex2rgb('#c6ccdb')) < 1, pDog.nameCol, '#c6ccdb');
  ok('plate radius 9px and padding 7px 9px', pFav.radius === '9px' && pFav.pad === '7px 9px', [pFav.radius, pFav.pad], ['9px', '7px 9px']);
  const tourGapPct = Math.abs(tourG.Y(tourG.favEnd) - tourG.Y(tourG.dogEnd)) / 3;
  const favPct = tourG.Y(tourG.favEnd) / 3, dogPct = tourG.Y(tourG.dogEnd) / 3;
  ok('precondition: the Tour ends do NOT collide (so the clamp, not the collision path, is under test)',
    tourGapPct > 13.5, tourGapPct.toFixed(2) + '%', '>13.5%');
  ok('no collision: the favourites plate sits on its true value',
    near(pFav.cy, favDotY, 2), pFav.cy.toFixed(1), favDotY.toFixed(1));
  // THE D3 SUBJECT. The Tour underdog end is at 98.55% — no collision anywhere near it,
  // but a 54px plate centred there runs to ~420px in a 400px column and lands on the
  // season labels. §7 words the 4%..96% clamp as the last step of the COLLISION path;
  // applied that way this plate gets no clamp at all. Asserted here because this is the
  // flagship chart and it is one of the 12 views that overflow without it.
  ok('precondition: the Tour underdog end really is past 96% (the clamp must bite)',
    dogPct > 96, dogPct.toFixed(2) + '%', '>96%');
  ok('the underdog PLATE is clamped to 96% even with no collision',
    near(parseFloat(pDog.top), 96, 0.02), pDog.top, '96%');
  ok('…and the underdog DOT is NOT clamped — it keeps its true value',
    near(dotDog.cy, dogDotY, 1.5) && !near(parseFloat(dotDog.top), 96, 0.02),
    [dotDog.top, dogPct.toFixed(2) + '%'], 'true position, not 96%');
  // §7's own numbers do not quite close: a ~54px plate centred at 96% of a 400px column
  // still reaches ~411px, 11px below the column. That is not a visual defect here and
  // the right test says so rather than asserting a proxy — the x-tick row is inset
  // 116px on the RIGHT (§4), so it never extends under the 104px plate column. The
  // invariant that actually matters is that no plate overlaps a season label.
  const overlaps = (a, b) => !(a.rt <= b.l || a.l >= b.r || a.b <= b.t || a.t >= b.b);
  ok('no end plate overlaps any season label (the real §7 invariant)',
    T.plates.every((pl) => T.xaxis.rects.every((lr) => !overlaps(pl, lr))),
    T.plates.map((pl) => pl.b.toFixed(0)).join('/') + ' vs labels from ' + T.xaxis.rects[0].t.toFixed(0),
    'no intersection');
  ok('the clamp keeps the plate out of the card’s padding (bottom within 16px of the column)',
    pDog.b <= T.plotRect.t + T.plotRect.h + 16, pDog.b.toFixed(1),
    '<= ' + (T.plotRect.t + T.plotRect.h + 16).toFixed(1));

  // ══ §8 axes ══════════════════════════════════════════════════════════════════
  console.log('\n── §8 · axes ──');
  ok('y-axis labels 11.5px / 500', T.yaxis.size === '11.5px' && T.yaxis.weight === '500', [T.yaxis.size, T.yaxis.weight], ['11.5px', '500']);
  ok('y-axis label colour #8b96b5', deltaE2000(parseColor(T.yaxis.col), hex2rgb('#8b96b5')) < 1, T.yaxis.col, '#8b96b5');
  ok('y-axis carries at most ten gridlines', T.yaxis.n <= 10, T.yaxis.n, '<=10');
  ok('x-axis labels 11.5px #8b96b5', T.xaxis.size === '11.5px' && deltaE2000(parseColor(T.xaxis.col), hex2rgb('#8b96b5')) < 1,
    [T.xaxis.size, T.xaxis.col], ['11.5px', '#8b96b5']);
  ok('eyebrow 10px / 600 / 0.14em / uppercase',
    T.cap.size === '10px' && T.cap.weight === '600' && near(parseFloat(T.cap.ls), 1.4, 0.05) && T.cap.tt === 'uppercase',
    [T.cap.size, T.cap.weight, T.cap.ls, T.cap.tt], ['10px', '600', '1.4px', 'uppercase']);
  // Founder ruling round 3: an index axis must NEVER be captioned "Season".
  ok('caption says "Match index (chronological)", never "Season"',
    /Match index \(chronological\)/.test(T.cap.txt) && !/\bSeason\b/.test(T.cap.txt), T.cap.txt, 'Match index (chronological) …');

  // ══ §9 card frame and copy ═══════════════════════════════════════════════════
  console.log('\n── §9 · card frame and copy ──');
  ok('title 19px / 800', T.title.size === '19px' && T.title.weight === '800', [T.title.size, T.title.weight], ['19px', '800']);
  ok('title text', T.title.txt === 'Cumulative profit, flat 1u', T.title.txt, 'Cumulative profit, flat 1u');
  ok('subline 11px mono #5b6880', T.subline.size === '11px' && deltaE2000(parseColor(T.subline.col), hex2rgb('#5b6880')) < 1,
    [T.subline.size, T.subline.col], ['11px', '#5b6880']);
  ok('footnote amber left rule 2px rgba(232,168,78,0.55)',
    /^2px/.test(T.foot.bl) && near(parseColor(T.foot.bl.replace(/^2px /, ''))[3], 0.55, 0.01), T.foot.bl, '2px rgba(232,168,78,0.55)');
  ok('footnote 12.5px / line-height 1.6 / max-width 820px',
    T.foot.size === '12.5px' && near(parseFloat(T.foot.lh), 20, 0.5) && T.foot.mw === '820px',
    [T.foot.size, T.foot.lh, T.foot.mw], ['12.5px', '20px', '820px']);

  // ══ DATA — the envelope must survive the paint ═══════════════════════════════
  console.log('\n── data · the painted curve still reaches the archive’s extrema ──');
  const paintedY = (pts) => pts.trim().split(/\s+/).map((p) => +p.split(',')[1]);
  const favYs = paintedY(T.polylines[1].pts), dogYs = paintedY(T.polylines[0].pts);
  // Compared in the EMITTED coordinate space, which is exact. Inverting the y back to
  // units and comparing with a tolerance would be comparing against the polyline's own
  // 0.1-viewBox-unit rounding (0.78u on this chart's 2,350u span) and would need a
  // tolerance wide enough to hide a real 0.4u flattening.
  const rawFavHi = Math.max(...tourG.fav), rawDogHi = Math.max(...tourG.dog), rawDogLo = Math.min(...tourG.dog);
  ok(`favourites painted maximum IS the raw maximum (${rawFavHi.toFixed(2)}u)`,
    Math.min(...favYs) === +tourG.Y(rawFavHi).toFixed(1), Math.min(...favYs), +tourG.Y(rawFavHi).toFixed(1));
  ok(`underdogs painted maximum IS the raw maximum (${rawDogHi.toFixed(2)}u)`,
    Math.min(...dogYs) === +tourG.Y(rawDogHi).toFixed(1), Math.min(...dogYs), +tourG.Y(rawDogHi).toFixed(1));
  ok('underdogs painted minimum IS the raw minimum',
    Math.max(...dogYs) === +tourG.Y(rawDogLo).toFixed(1), Math.max(...dogYs), +tourG.Y(rawDogLo).toFixed(1));
  // The assertion smoothing would break: this curve is above zero at 9 of 41,667
  // points and a plain centred average paints its maximum at -0.04u.
  ok('the underdog curve still shows its time in profit (painted max above the zero line)',
    Math.min(...dogYs) < tourG.zeroY, Math.min(...dogYs).toFixed(1), '< zeroY ' + tourG.zeroY.toFixed(1));
  ok('vertex budget honoured (Tour 260)', T.polylines.every((p) => p.verts <= 260), T.polylines.map((p) => p.verts), '<=260');

  // ══ area path closes to the ZERO LINE ════════════════════════════════════════
  console.log('\n── §5 · area path (Tour: weak subject, asserted again on Gerry Weber) ──');
  const closeY = (d) => { const m = d.trim().match(/L\s*([\d.]+),([\d.]+)\s*Z$/); return m ? +m[2] : NaN; };
  const openY = (d) => { const m = d.trim().match(/^M\s*([\d.]+),([\d.]+)/); return m ? +m[2] : NaN; };
  ok('favourites area opens at zeroY', near(openY(T.paths[0].d), tourG.zeroY, 0.15), openY(T.paths[0].d), tourG.zeroY.toFixed(1));
  ok('favourites area closes at zeroY', near(closeY(T.paths[0].d), tourG.zeroY, 0.15), closeY(T.paths[0].d), tourG.zeroY.toFixed(1));

  // ══ Tournaments: Gerry Weber Open (mid-plot zero) and Open Sud (collision) ════
  const pickTourn = async (name) => {
    await ev(`(function(){var b=document.querySelector('#dbViewTabs [data-dbview="tournaments"]'); if(b) b.click();})()`);
    await sleep(700);
    const typed = await ev(`(function(){
      var inp=document.querySelector('${Q}.db-search input');
      if(!inp) return 'no-input';
      inp.focus(); inp.value=${JSON.stringify(name)};
      inp.dispatchEvent(new Event('input',{bubbles:true}));
      return 'ok';
    })()`);
    if (typed === 'no-input') { console.log('   (no .db-search input on the Tournaments tab)'); return false; }
    await sleep(700);
    const rows = await ev(`[].slice.call(document.querySelectorAll('${Q}.db-prow')).map(function(r){return r.textContent;})`);
    if (!rows || !rows.length) { console.log('   (picker returned no rows for ' + name + ')'); return false; }
    console.log(`   picker rows for "${name}": ${JSON.stringify(rows.slice(0, 4))}`);
    // The picker rows bind onMOUSEDOWN, not onclick (they must fire before the input
    // blurs and tears the popover down). .click() is silently inert here.
    const clicked = await ev(`(function(){var r=document.querySelectorAll('${Q}.db-prow')[0]; if(!r) return false;
      r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true})); return true;})()`);
    if (!clicked) return false;
    // The chart is rebuilt asynchronously (the player/tournament shard loads lazily),
    // so wait for a plot that actually holds a curve rather than sleeping a guess.
    const dl2 = Date.now() + 20000;
    while (Date.now() < dl2) {
      const n = await ev(`document.querySelectorAll('${Q}.db-plotarea svg polyline').length`);
      if (n >= 2) { await sleep(250); return true; }
      await sleep(300);
    }
    console.log('   (chart did not render for ' + name + ')');
    return false;
  };

  console.log('\n── §5 / §5.1 · Gerry Weber Open (zero line at 150.0 of 300) ──');
  let gwOK = false;
  try { gwOK = await pickTourn('Gerry Weber Open'); } catch (e) { console.log('   (picker: ' + e.message + ')'); }
  if (gwOK) {
    const G = await chart();
    if (G.error) { ok('Gerry Weber chart read', false, G.error, 'chart'); }
    else {
    ok('Gerry Weber: loss tint y == zeroY 150.0', near(G.tint.y, gwG.zeroY, 0.15), G.tint.y, gwG.zeroY.toFixed(1));
    ok('Gerry Weber: loss tint height 150.0, NOT the full 300',
      near(G.tint.h, 300 - gwG.zeroY, 0.15) && G.tint.h < 299, G.tint.h, (300 - gwG.zeroY).toFixed(1));
    ok('Gerry Weber: area opens at zeroY 150.0, not at the plot top or bottom',
      near(openY(G.paths[0].d), gwG.zeroY, 0.15), openY(G.paths[0].d), gwG.zeroY.toFixed(1));
    ok('Gerry Weber: area closes at zeroY 150.0, not at the plot bottom (300)',
      near(closeY(G.paths[0].d), gwG.zeroY, 0.15), closeY(G.paths[0].d), gwG.zeroY.toFixed(1));
    ok('Gerry Weber: break-even label PAINTS at mid-plot',
      near(G.be.cy, G.svgRect.t + 0.5 * G.svgRect.h, 1.5), G.be.cy.toFixed(1), (G.svgRect.t + 0.5 * G.svgRect.h).toFixed(1));
    const gFav = G.plates.find((p) => /fav/.test(p.cls)), gDog = G.plates.find((p) => /dog/.test(p.cls));
    ok('Gerry Weber: plate values match the archive',
      gFav.val === fmtU(gwG.favEnd) && gDog.val === fmtU(gwG.dogEnd), [gFav.val, gDog.val], [fmtU(gwG.favEnd), fmtU(gwG.dogEnd)]);
    }
  } else { ok('Gerry Weber Open subject was driven (its assertions must RUN)', false, 'picker failed', 'driven'); }

  console.log('\n── §8 · Brisbane International — the view that drew 12 gridlines ──');
  // §8's "at most ten gridlines" was asserted only on Tour All, which sits at EXACTLY
  // ten and cannot move: `step` was picked from the raw span, then hi/lo were rounded
  // outward, and the drawn span grew. Brisbane International is where that shows.
  const briIx = TOURN.indexOf('Brisbane International');
  const briRows = rows.filter((r) => r[4] === briIx);
  // What the old rule WOULD have produced, recomputed here.
  const briS = cumSeries(briRows);
  const bRawHi = Math.max(Math.max(...briS.fav), Math.max(...briS.dog));
  const bRawLo = Math.min(Math.min(...briS.fav), Math.min(...briS.dog));
  const oldStep = [10, 25, 50, 100, 250, 500, 1000, 2500].find((x) => (bRawHi - bRawLo) / x <= 10) || 5000;
  const oldRnd = Math.max(10, oldStep / 10);
  const oldHi = bRawHi > 0 ? Math.ceil(bRawHi / oldStep) * oldStep : Math.max(oldRnd, Math.ceil(bRawHi / oldRnd) * oldRnd);
  const oldLo = Math.min(0, Math.floor(bRawLo / oldRnd) * oldRnd);
  const oldCount = Math.floor(oldHi / oldStep) - Math.ceil(oldLo / oldStep) + 1;
  ok('precondition: the raw-span rule really does overflow here (this subject can break)',
    oldCount > 10, oldCount + ' labels under the raw-span rule', '>10');
  let briOK = false;
  try { briOK = await pickTourn('Brisbane International'); } catch (e) { console.log('   (picker: ' + e.message + ')'); }
  if (briOK) {
    const BR = await chart();
    if (BR.error) { ok('Brisbane chart read', false, BR.error, 'chart'); }
    else {
      ok('Brisbane International draws at most ten gridlines (§8)', BR.yaxis.n <= 10, BR.yaxis.n, '<=10');
      ok('…and the axis still contains the whole curve',
        BR.tint.y >= 0 && BR.tint.y <= 300, BR.tint.y, '0..300');
    }
  } else { ok('Brisbane International subject was driven (its assertions must RUN)', false, 'picker failed', 'driven'); }

  console.log('\n── §7 · Open Sud de France (ends 0.42% apart — the collision branch) ──');
  let osfOK = false;
  try { osfOK = await pickTourn('Open Sud de France'); } catch (e) { console.log('   (picker: ' + e.message + ')'); }
  if (osfOK) {
    const O = await chart();
    if (O.error) { ok('Open Sud chart read', false, O.error, 'chart'); }
    else {
    const oFav = O.plates.find((p) => /fav/.test(p.cls)), oDog = O.plates.find((p) => /dog/.test(p.cls));
    const dotGapPx = Math.abs(O.dots[0].cy - O.dots[1].cy);
    const plateGapPx = Math.abs(oFav.cy - oDog.cy);
    const wantDotGap = Math.abs(osfG.Y(osfG.favEnd) - osfG.Y(osfG.dogEnd)) / 300 * O.svgRect.h;
    const wantPlateGap = 0.135 * O.plotRect.h;
    ok('Open Sud: plate values match the archive',
      oFav.val === fmtU(osfG.favEnd) && oDog.val === fmtU(osfG.dogEnd), [oFav.val, oDog.val], [fmtU(osfG.favEnd), fmtU(osfG.dogEnd)]);
    ok('Open Sud: the DOTS keep their true positions (0.42% apart, ~1.7px)',
      near(dotGapPx, wantDotGap, 1.2), dotGapPx.toFixed(2) + 'px', wantDotGap.toFixed(2) + 'px');
    ok('Open Sud: the PLATES separated to 13.50% of plot height (~54px)',
      near(plateGapPx, wantPlateGap, 2), plateGapPx.toFixed(2) + 'px', wantPlateGap.toFixed(2) + 'px');
    ok('Open Sud: plates moved but dots did not (the §7 rule)',
      plateGapPx > dotGapPx + 20, [plateGapPx.toFixed(1), dotGapPx.toFixed(1)], 'plate gap >> dot gap');
    ok('Open Sud: plates stay within 4%..96% of the plot',
      parseFloat(oFav.top) >= 4 && parseFloat(oFav.top) <= 96 && parseFloat(oDog.top) >= 4 && parseFloat(oDog.top) <= 96,
      [oFav.top, oDog.top], '4%..96%');
    }
  } else { console.log('   (could not drive the tournament picker — these assertions did not run)'); }


  // ══ PLAYERS panels ═══════════════════════════════════════════════════════════
  // Subjects: Djokovic N. (a normal career that crosses zero) and BECK K., who is
  // never once in profit across 37 matches — the input that breaks §5.1, because his
  // y-domain excludes zero and `viewBoxHeight - zeroY` then exceeds the viewBox.
  const names = await (await fetch(`${BASE}/database-yield-players.json${bust()}`)).json();
  const playerVals = (who) => {
    const recs = [];
    rows.forEach((r, i) => {
      const [w, l] = names.names[i];
      if (w === who) recs.push([r[0], r[7] ? r[5] : r[6], 1]);
      else if (l === who) recs.push([r[0], r[7] ? r[6] : r[5], 0]);
    });
    recs.sort((a, b) => a[0] - b[0]);
    let c = 0; return recs.map((t) => { c += t[2] ? (t[1] - 1) : -1; return c; });
  };
  const pickPlayer = async (who) => {
    await ev(`(function(){var b=document.querySelector('#dbViewTabs [data-dbview="players"]'); if(b) b.click();})()`);
    await sleep(900);
    const typed = await ev(`(function(){var i=document.querySelector('${Q}.db-search input'); if(!i) return 'no';
      i.focus(); i.value=${JSON.stringify(who)}; i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok';})()`);
    if (typed === 'no') return false;
    await sleep(1400);
    const got = await ev(`(function(){var r=document.querySelectorAll('${Q}.db-prow')[0]; if(!r) return false;
      r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true})); return true;})()`);
    if (!got) return false;
    const dl3 = Date.now() + 20000;
    while (Date.now() < dl3) {
      if (await ev(`document.querySelectorAll('${Q}.db-pcarea svg polyline').length`) >= 3) { await sleep(250); return true; }
      await sleep(300);
    }
    return false;
  };
  const panels = async () => ev(`(function(){
    var main=document.querySelector('${Q}.db-pcmain'); if(!main) return {error:'no player chart'};
    function read(p, isMain){
      var ar=p.querySelector('.db-pcarea'), sv=ar.querySelector('svg'), ax=p.querySelector('.db-pcaxis');
      var pl=sv.querySelector('polyline'), cs=getComputedStyle(pl), rect=sv.querySelector('rect');
      var zl=[].slice.call(sv.querySelectorAll('line')).filter(function(l){var v=l.getAttribute('stroke')||''; return v.indexOf('0.4)')>0 || v.indexOf('0.40)')>0;});
      var dot=ar.querySelector('.db-enddot'), be=ar.querySelector('.db-belab');
      var hd=p.querySelector('.db-pchead span');
      var tr=p.querySelector('.db-pcticks');
      var a0=ax.firstChild?getComputedStyle(ax.firstChild):null;
      var sr=sv.getBoundingClientRect(), arr=ar.getBoundingClientRect();
      return {h:arr.height, axw:ax.getBoundingClientRect().width, viewBox:sv.getAttribute('viewBox'),
        ovf:getComputedStyle(sv).overflow, stroke:cs.stroke, w:cs.strokeWidth, dash:cs.strokeDasharray,
        join:cs.strokeLinejoin, cap:cs.strokeLinecap,
        paths:[].slice.call(sv.querySelectorAll('path')).map(function(x){return {d:x.getAttribute('d'), fill:getComputedStyle(x).fill};}),
        tint:rect?{y:+rect.getAttribute('y'), h:+rect.getAttribute('height')}:null,
        zeroLines:zl.length, zeroY:zl.length?+zl[0].getAttribute('y1'):null,
        hasBE:!!be, end:hd?hd.textContent:null,
        dot:dot?(function(){var r=dot.getBoundingClientRect(); return {cy:r.top+r.height/2, w:r.width, bg:getComputedStyle(dot).backgroundColor};})():null,
        svgTop:sr.top, svgH:sr.height,
        tickMargin:getComputedStyle(tr).margin, tickSize:a0?null:null,
        axSize:a0&&a0.fontSize, axWeight:a0&&a0.fontWeight, axCol:a0&&a0.color,
        tickLabSize:tr.firstChild?getComputedStyle(tr.firstChild).fontSize:null};
    }
    var pair=[].slice.call(document.querySelectorAll('${Q}.db-pcpair > div'));
    return {main:read(main,true), pair:pair.map(function(x){return read(x,false);})};
  })()`);

  console.log('\n── §2 / §3 / §4 / §5 / §6 · Players panels (Djokovic N.) ──');
  let plOK = false;
  try { plOK = await pickPlayer('Djokovic N.'); } catch (e) { console.log('   (picker: ' + e.message + ')'); }
  if (plOK) {
    const P = await panels();
    if (P.error) { ok('Djokovic panels read', false, P.error, 'panels'); }
    else {
      ok('players main viewBox 0 0 1000 200', P.main.viewBox === '0 0 1000 200', P.main.viewBox, '0 0 1000 200');
      ok('players main plot height 360px', near(P.main.h, 360, 0.6), P.main.h, 360);
      ok('players pair plot height 230px', P.pair.every((c) => near(c.h, 230, 0.6)), P.pair.map((c) => c.h), 230);
      ok('players axis column 52px', near(P.main.axw, 52, 0.6) && P.pair.every((c) => near(c.axw, 52, 0.6)), P.main.axw, 52);
      ok('players tick row inset 64px', P.main.tickMargin === '10px 0px 0px 64px', P.main.tickMargin, '10px 0px 0px 64px');
      ok('players svg overflow visible', P.main.ovf === 'visible', P.main.ovf, 'visible');
      ok('players main stroke-width 2.6', P.main.w === '2.6px', P.main.w, '2.6px');
      ok('players pair stroke-width 2.2', P.pair.every((c) => c.w === '2.2px'), P.pair.map((c) => c.w), '2.2px');
      ok('every Players series is blue (§2: the second colour would carry no meaning)',
        [P.main, ...P.pair].every((c) => deltaE2000(parseColor(c.stroke), hex2rgb('#5b9bff')) < 1),
        [P.main.stroke, ...P.pair.map((c) => c.stroke)], '#5b9bff');
      ok('no dashed player line', [P.main, ...P.pair].every((c) => c.dash === 'none' || c.dash === ''), P.main.dash, 'none');
      ok('players lines round join and cap', [P.main, ...P.pair].every((c) => c.join === 'round' && c.cap === 'round'), [P.main.join, P.main.cap], 'round');
      ok('players area fill rgba(91,155,255,0.11)',
        P.main.paths.length === 1 && (function(){ const f = parseColor(P.main.paths[0].fill); return f[0] === 91 && f[1] === 155 && f[2] === 255 && near(f[3], 0.11, 0.005); })(),
        P.main.paths[0] && P.main.paths[0].fill, 'rgba(91,155,255,0.11)');
      ok('players axis labels 11.5px / 500 on the main panel', P.main.axSize === '11.5px' && P.main.axWeight === '500',
        [P.main.axSize, P.main.axWeight], ['11.5px', '500']);
      ok('players axis labels 11px on the pair panels', P.pair.every((c) => c.axSize === '11px'), P.pair.map((c) => c.axSize), '11px');
      ok('end dot 9px on the main panel, 8px on the pair', near(P.main.dot.w, 9, 0.6) && P.pair.every((c) => near(c.dot.w, 8, 0.6)),
        [P.main.dot.w, ...P.pair.map((c) => c.dot.w)], [9, 8, 8]);
      ok('break-even label on the main panel only',
        P.main.hasBE === true && P.pair.every((c) => c.hasBE === false), [P.main.hasBE, ...P.pair.map((c) => c.hasBE)], [true, false, false]);
      // Independent number check: the header end value, recomputed from the shard.
      const dj = playerVals('Djokovic N.');
      const want = (dj[dj.length - 1] > 0 ? '+' : '') + dj[dj.length - 1].toFixed(1) + 'u';
      ok('main panel end value matches the archive', P.main.end === want, P.main.end, want);
      ok('main panel: zero line drawn, tint inside the viewBox',
        P.main.zeroLines === 1 && P.main.tint.y >= 0 && P.main.tint.y + P.main.tint.h <= 200.05,
        [P.main.zeroLines, P.main.tint.y, P.main.tint.h], '1 line, tint within 0..200');
    }
  } else { ok('Djokovic N. subject was driven (its assertions must RUN)', false, 'picker failed', 'driven'); }

  console.log('\n── §5.1 · Wu D. — y-domain excludes zero, the input that breaks §5.1 ──');
  // SUBJECT CHOICE, and a correction worth recording. Beck K. was the obvious pick —
  // never once in profit across 37 matches — and he is IMMUNE. His raw maximum is
  // -0.75 and the axis rounds at rnd=1, so `Math.ceil(-0.75)` is -0 and the domain
  // ends up containing zero after all. A broken build passes on him.
  // Wu D.'s raw maximum is exactly -1.00 and rounds to -1, so his domain genuinely
  // excludes zero. The precondition below asserts the ROUNDED domain, not the raw
  // maximum, because the rounding is what decides whether the bug can fire.
  const playerDomain = (who) => {
    const all = [];
    ['all', 'fav', 'dog'].forEach((k) => {
      const recs = [];
      rows.forEach((r, i) => {
        const [w, l] = names.names[i];
        const isW = w === who, isL = l === who;
        if (!isW && !isL) return;
        const wasFav = isW ? !!r[7] : !r[7];
        if (k === 'fav' && !wasFav) return;
        if (k === 'dog' && wasFav) return;
        recs.push([r[0], isW ? (r[7] ? r[5] : r[6]) : (r[7] ? r[6] : r[5]), isW ? 1 : 0]);
      });
      recs.sort((a, b) => a[0] - b[0]);
      let c = 0; recs.forEach((t) => { c += t[2] ? (t[1] - 1) : -1; all.push(c); });
    });
    const rawHi = Math.max(...all), rawLo = Math.min(...all);
    const step = [1, 2, 5, 10, 20, 25, 50].find((x) => (rawHi - rawLo) / x <= 10) || 100;
    const rnd = Math.max(1, step / 5);
    let hi = Math.ceil(rawHi / rnd) * rnd, lo = Math.floor(rawLo / rnd) * rnd;
    if (hi === lo) hi = lo + rnd;
    return { rawHi, rawLo, hi, lo, zeroIn: (0 <= hi && 0 >= lo), all };
  };
  const wuD = playerDomain('Wu D.'), beckD = playerDomain('Beck K.');
  ok('precondition: Beck K. is IMMUNE — his domain rounds to include zero',
    beckD.zeroIn === true, `rawHi ${beckD.rawHi.toFixed(2)} → hi ${beckD.hi}`, 'zeroIn true');
  ok('precondition: Wu D.’s ROUNDED domain genuinely excludes zero',
    wuD.zeroIn === false && wuD.hi < 0, `rawHi ${wuD.rawHi.toFixed(2)} → hi ${wuD.hi}, lo ${wuD.lo}`, 'hi < 0');
  // If §5.1 were built literally, this is the rect it would emit.
  const naiveZeroY = ((wuD.hi - 0) / (wuD.hi - wuD.lo)) * 200;
  ok('precondition: a literal §5.1 on this subject WOULD spill (lossH > viewBox height)',
    200 - naiveZeroY > 200, (200 - naiveZeroY).toFixed(1), '>200 on a 200-tall viewBox');
  let bkOK = false;
  try { bkOK = await pickPlayer('Wu D.'); } catch (e) { console.log('   (picker: ' + e.message + ')'); }
  if (bkOK) {
    const B = await panels();
    if (B.error) { ok('Wu D. panels read', false, B.error, 'panels'); }
    else {
      // FOUNDER RULING `force-zero`: zero is now forced into the domain, so the panel
      // that used to have zero off-scale must now DRAW the zero line rather than
      // suppress it. Asserted here rather than on a player who was never affected.
      ok('Wu D.: zero is now inside the domain and the zero line IS drawn',
        B.main.zeroLines === 1, B.main.zeroLines, 1);
      ok('Wu D.: the "Break even" label is present on the main panel',
        B.main.hasBE === true, B.main.hasBE, true);
      ok('Wu D.: loss tint is valid and inside the viewBox',
        B.main.tint.y >= 0 && B.main.tint.h >= 0 && B.main.tint.y + B.main.tint.h <= 200.05,
        [B.main.tint.y, B.main.tint.h], 'within 0..200');
      // The tint must now start at the TRUE zero line, not at the clamped edge — that
      // is the difference between the ruling being applied and the holding behaviour
      // still being in force.
      // The discriminating consequence of `force-zero` on THIS subject: before the
      // ruling his domain was hi=-1, lo=-13, so zeroY was -16.67 — outside the viewBox
      // entirely. Forcing zero in makes hi=0, so the zero line lands exactly on the top
      // edge (his maximum IS his break-even) and the tint covers the full panel. Both
      // numbers are pinned, because "inside the viewBox" alone is also true of the
      // clamped holding behaviour this replaced.
      ok('Wu D.: zeroY is 0 — the ruling applied (it was -16.67, outside the viewBox)',
        Math.abs(B.main.zeroY) < 0.15, B.main.zeroY, 0);
      ok('Wu D.: the tint starts at the zero line',
        Math.abs(B.main.tint.y - B.main.zeroY) < 0.15, [B.main.tint.y, B.main.zeroY], 'equal');
      const wv = playerVals('Wu D.');
      const w2 = (wv[wv.length - 1] > 0 ? '+' : '') + wv[wv.length - 1].toFixed(1) + 'u';
      ok('Wu D.: end value still matches the archive', B.main.end === w2, B.main.end, w2);
    }
  } else { ok('Wu D. subject was driven (its assertions must RUN)', false, 'picker failed', 'driven'); }

  // ══ GUARDED SMOOTHING — the founder's ruling, asserted where it can break ═══════
  console.log('\n── §3 · guarded smoothing (founder ruling: `guarded`) ──');
  // The whole point of the guard is that the extrema and the zero crossings survive.
  // The Tour underdog curve is the subject a plain average provably breaks: above zero
  // at 9 of 41,667 points, painted at -0.04u by the unguarded form. If the guard is
  // ever dropped, THIS is the assertion that goes red.
  {
    const T2 = await (async () => { await ev(`(function(){var b=document.querySelector('#dbViewTabs [data-dbview="tour"]'); if(b) b.click();})()`); await sleep(1200); return chart(); })();
    if (T2.error) { ok('Tour chart re-read after guarded smoothing', false, T2.error, 'chart'); }
    else {
      const fY = paintedY(T2.polylines[1].pts), dY = paintedY(T2.polylines[0].pts);
      ok('guarded: favourites painted maximum IS STILL the raw maximum',
        Math.min(...fY) === +tourG.Y(Math.max(...tourG.fav)).toFixed(1),
        Math.min(...fY), +tourG.Y(Math.max(...tourG.fav)).toFixed(1));
      ok('guarded: underdogs painted maximum IS STILL the raw maximum (+1.89u)',
        Math.min(...dY) === +tourG.Y(Math.max(...tourG.dog)).toFixed(1),
        Math.min(...dY), +tourG.Y(Math.max(...tourG.dog)).toFixed(1));
      ok('guarded: underdogs painted minimum IS STILL the raw minimum',
        Math.max(...dY) === +tourG.Y(Math.min(...tourG.dog)).toFixed(1),
        Math.max(...dY), +tourG.Y(Math.min(...tourG.dog)).toFixed(1));
      ok('guarded: the underdog curve STILL shows its time in profit',
        Math.min(...dY) < tourG.zeroY, Math.min(...dY).toFixed(1), '< zeroY ' + tourG.zeroY.toFixed(1));
      ok('guarded: the end values are still exact archive figures',
        T2.plates.find((p) => /fav/.test(p.cls)).val === fmtU(tourG.favEnd) &&
        T2.plates.find((p) => /dog/.test(p.cls)).val === fmtU(tourG.dogEnd),
        T2.plates.map((p) => p.val), [fmtU(tourG.favEnd), fmtU(tourG.dogEnd)]);
      // …and that it is ACTUALLY smoothing: the painted line must be measurably
      // smoother than the unsmoothed sample, or the ruling has silently not applied.
      // …and that it IS actually smoothing. The baseline is recomputed here on the
      // SAME scale the page uses (the chart's rounded hi/lo across both series), not on
      // the single series' own span — mixing those two normalisations makes the numbers
      // differ by ~2.5x and the comparison meaningless.
      const dy = (ys) => { let t = 0; for (let i = 1; i < ys.length; i++) t += Math.abs(ys[i] - ys[i - 1]); return t / (ys.length - 1); };
      const favRaw = tourG.fav, nR = favRaw.length;
      const xsR = Array.from({ length: nR }, (_, i) => i / (nR - 1));
      const keepR = sampleKeepJS(xsR, favRaw, 260);
      const unsmoothedDy = dy(keepR.map((i) => tourG.Y(favRaw[i])));
      ok('guarded: the painted line is measurably smoother than the same vertices unsmoothed',
        dy(fY) < unsmoothedDy * 0.6,
        `${dy(fY).toFixed(2)} vs unsmoothed ${unsmoothedDy.toFixed(2)} (same scale)`, '< 60% of it');
    }
  }

  // ── the ZERO-CROSSER half of the guard, on a subject that isolates it ──────────
  // Mutation exposed a real hole: dropping the zero-crossing clause and keeping only
  // the extrema clause scored 143/143. Every assertion above is satisfied by the
  // extrema guard alone, because on the Tour chart the underdog maximum IS the global
  // maximum, so forcing the global max back also happens to preserve that crossing.
  // Monte Carlo Masters separates them: its favourite curve oscillates across zero
  // well away from its extremes.
  console.log('\n── §3 · Monte Carlo Masters — isolates the zero-crosser clause ──');
  const mcIx = TOURN.indexOf('Monte Carlo Masters');
  const mcRows = rows.filter((r) => r[4] === mcIx);
  ok('precondition: Monte Carlo Masters still holds 867 rows', mcRows.length === 867, mcRows.length, 867);
  const signChanges = (vals) => { let c = 0, prev = 0; for (const x of vals) { const sg = x > 0 ? 1 : x < 0 ? -1 : 0; if (!sg) continue; if (prev && sg !== prev) c++; prev = sg; } return c; };
  const smoothJS = (v, k = 3) => { const n = v.length; if (n < 3) return v.slice(); const o = []; for (let i = 0; i < n; i++) { const a = Math.max(0, i - k), b = Math.min(n - 1, i + k); let t = 0; for (let j = a; j <= b; j++) t += v[j]; o.push(t / (b - a + 1)); } o[0] = v[0]; o[n - 1] = v[n - 1]; return o; };
  const guardJS = (v, N, withCrossers) => {
    const n = v.length, xs = Array.from({ length: n }, (_, i) => i / ((n - 1) || 1));
    const keep = sampleKeepJS(xs, v, N), kv = keep.map((i) => v[i]), sm = smoothJS(kv, 3);
    let mx = 0, mn = 0; kv.forEach((x, i) => { if (x > kv[mx]) mx = i; if (x < kv[mn]) mn = i; });
    const f = new Set([0, kv.length - 1, mx, mn]);
    if (withCrossers) kv.forEach((a, i) => { if ((a > 0) !== (sm[i] > 0) || (a < 0) !== (sm[i] < 0)) f.add(i); });
    return kv.map((x, i) => (f.has(i) ? x : sm[i]));
  };
  const mcS = cumSeries(mcRows);
  const withG = signChanges(guardJS(mcS.fav, 240, true));
  const withoutG = signChanges(guardJS(mcS.fav, 240, false));
  ok('precondition: the crosser clause CHANGES this curve (34 crossings vs 10 without it)',
    withG > withoutG + 15, `${withG} with, ${withoutG} without`, 'materially different');
  let mcOK = false;
  try { mcOK = await pickTourn('Monte Carlo Masters'); } catch (e) { console.log('   (picker: ' + e.message + ')'); }
  if (mcOK) {
    const MC = await chart();
    if (MC.error) { ok('Monte Carlo chart read', false, MC.error, 'chart'); }
    else {
      // Counted in PAINTED space on both sides — a vertex is "in profit" when its y is
      // above the zero line. Inverting y back to units and counting there loses ~4
      // crossings to the emitted `.toFixed(1)` (0.1 viewBox unit is 0.2u on this
      // chart's 590u span, and a crossing can sit inside that), which is a property of
      // the coordinate format, not of the guard.
      const mcGeom = chartGeom(mcRows, true);
      const zY = +mcGeom.zeroY.toFixed(1);
      const crossY = (ys) => { let c = 0, prev = 0; for (const y of ys) { const sg = y < zY ? 1 : y > zY ? -1 : 0; if (!sg) continue; if (prev && sg !== prev) c++; prev = sg; } return c; };
      const paintedCross = crossY(paintedY(MC.polylines[1].pts));
      const expectCross = crossY(guardJS(mcS.fav, 240, true).map((v) => +mcGeom.Y(v).toFixed(1)));
      const withoutCross = crossY(guardJS(mcS.fav, 240, false).map((v) => +mcGeom.Y(v).toFixed(1)));
      ok('the PAINTED favourite curve keeps its zero crossings (crosser clause live)',
        paintedCross === expectCross, paintedCross, expectCross);
      ok('…and that count is unreachable without the crosser clause',
        paintedCross > withoutCross + 10, [paintedCross, withoutCross], 'guarded, not extrema-only');
    }
  } else { ok('Monte Carlo Masters subject was driven (its assertions must RUN)', false, 'picker failed', 'driven'); }

  // ══ console cleanliness ══════════════════════════════════════════════════════
  console.log('\n── console ──');
  const real = errs.filter((e) => !/read only property 'BSP'/.test(e));
  ok('no page console errors (probe’s own BSP stub filtered)', real.length === 0, real.slice(0, 3), []);

  // THE BACKSTOP. Without this the probe reports success when whole sections never
  // run: renaming `.db-prow` (a plausible refactor) made it print "94 passed, 0 failed,
  // exit 0" while silently dropping the 33 assertions its own header calls load-bearing
  // — every non-vacuous subject. A count that must be hit cannot be skipped past.
  const EXPECTED = 147;
  const total = PASS + FAILS.length;
  if (total !== EXPECTED) {
    FAILS.push(`assertion COUNT is ${total}, expected ${EXPECTED} — a section was skipped`);
    console.log(`\n  ✗ assertion count ${total} != ${EXPECTED}: a section did not run`);
  } else { console.log(`\n  ✓ all ${EXPECTED} assertions ran (none skipped)`); }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${PASS} passed, ${FAILS.length} failed`);
  if (FAILS.length) FAILS.forEach((f) => console.log(`   ✗ ${f}`));
  chrome.kill();
  process.exit(FAILS.length ? 1 : 0);
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(2); });
