#!/usr/bin/env node
// TEN-196 · founder ruling 2026-09-13, items 1 and 3.
//
//   item 1 — the two curves must be genuinely different colours, dash KEPT as well.
//   item 3 — 'Finals' folded out of the Tour tab's Level picker, kept in the
//            archive, still counted by `All`.
//
// Everything is read off what Chrome actually painted (computed style / live DOM),
// and every expectation is re-derived here from the artefact with this file's own
// parser. Nothing is imported from the page's code.
//
// The item-3 assertion is a MUTATION, not a read: checking every offered Level box
// must reproduce the unfiltered total, which INCLUDES the folded Finals rows. A
// source-text regex for "Finals" would pass against a build that silently dropped
// those 238 matches from `All`.
//
// Usage: node ten196-items13-probe.mjs            (deployed)
//        PROBE_BASE=http://127.0.0.1:8899 node …  (local worktree)
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

// ── colour maths, implemented here from the spec (sRGB → Lab → CIEDE2000) ───────
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function parseColor(s) {                       // accepts #rrggbb or rgb(r, g, b)
  s = String(s).trim();
  if (s[0] === '#') return hex2rgb(s);
  const m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (!m) throw new Error('unparsed colour: ' + s);
  return [+m[1], +m[2], +m[3]];
}
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const relLum = (rgb) => { const [r, g, b] = rgb.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function toLab(rgb) {
  const [r, g, b] = rgb.map(lin);
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
  const hp = (b, a) => { if (a === 0 && b === 0) return 0; const d = Math.atan2(b, a) * 180 / Math.PI; return d < 0 ? d + 360 : d; };
  const hp1 = hp(b1, ap1), hp2 = hp(b2, ap2);
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
  return {
    ready,
    on: (m, fn) => handlers.set(m, fn),
    send: (method, params = {}) => ready.then(() => new Promise((res, rej) => {
      const mid = ++id; pend.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    })),
    close: () => ws.close(),
  };
}

(async () => {
  console.log(`TEN-196 items 1 + 3 · ${URL}\n`);

  // ── independent expectations, straight from the deployed artefact ─────────────
  const art = await (await fetch(`${BASE}/database-yield.json${bust()}`)).json();
  const meta = art.meta, rows = art.rows;
  const LEV = meta.levels, FOLD = 'Finals';
  const foldIx = LEV.indexOf(FOLD);
  const wantOffered = LEV.filter((n) => n !== FOLD);
  const totalAll = rows.length;
  const totalFolded = rows.filter((r) => r[1] === foldIx).length;
  const totalOffered = totalAll - totalFolded;
  console.log('── recomputed from the artefact ──');
  console.log(`  level dictionary      : ${JSON.stringify(LEV)}`);
  console.log(`  should be offered     : ${JSON.stringify(wantOffered)}`);
  console.log(`  rows, all levels      : ${totalAll}`);
  console.log(`  rows at '${FOLD}'       : ${totalFolded}  (${(totalFolded / totalAll * 100).toFixed(2)}%)`);
  console.log(`  rows, offered levels  : ${totalOffered}`);

  // ── PRECONDITIONS, pinned as literals ────────────────────────────────────────
  // Everything downstream is derived from this artefact, so without these the
  // headline assertion degenerates. Demonstrated, not theorised: an artefact with
  // all 238 Finals rows DELETED but 'Finals' still in meta.levels passed the whole
  // probe 22/22, because `afterAllChecked - totalOffered === totalFolded` became
  // `0 === 0`. A derived expectation cannot detect a change in what it derives from.
  // These three literals are the fixed point that makes the rest mean something.
  const PIN_ALL = 41667, PIN_FOLDED = 238, PIN_OFFERED = 41429;
  ok(`precondition: the archive still holds ${PIN_ALL} rows`, totalAll === PIN_ALL, totalAll, PIN_ALL);
  ok(`precondition: '${FOLD}' still holds ${PIN_FOLDED} rows (0 would make the headline test vacuous)`,
    totalFolded === PIN_FOLDED, totalFolded, PIN_FOLDED);
  ok(`precondition: the offered levels still hold ${PIN_OFFERED} rows`, totalOffered === PIN_OFFERED, totalOffered, PIN_OFFERED);
  ok(`precondition: '${FOLD}' is still in the artefact's level dictionary`, foldIx >= 0, foldIx, '>=0');

  // Acceptance criterion the probe previously did not cover: both series colours
  // must be tokens the design export already uses. Checked against the export file.
  let exportSrc = null;
  try { exportSrc = fs.readFileSync('design-export/database-handoff/Database.dc.html', 'utf8'); } catch { /* not present */ }

  // ── browser ──────────────────────────────────────────────────────────────────
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten196i13-'));
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
      '--no-first-run', '--window-size=1680,1400', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
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
      // getter/setter, not a frozen value: auth.js assigns window.BSP on load, and a
      // read-only value property makes that assignment THROW in strict mode. The
      // throw is a probe artefact, but it would sit in the same error channel this
      // probe asserts on, so swallow the write instead of letting it fake a defect.
      Object.defineProperty(window,'BSP',{get:function(){return stub},set:function(){},configurable:true,enumerable:true});})();`,
  });
  await c.send('Page.navigate', { url: URL + bust() });
  await sleep(2000);
  const ev = async (expr) => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || ''));
    return r.result.value;
  };

  await ev(`(function(){var b=document.getElementById('databaseTabBtn'); if(b){b.style.display=''; b.click();} })()`);
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    if (await ev(`document.querySelectorAll('[data-page="database"] .db-bandpanel').length`) >= 2) break;
    await sleep(400);
  }

  // ══ ITEM 1 ═══════════════════════════════════════════════════════════════════
  console.log('\n── item 1: curve colours (computed style, as painted) ──');
  const curves = await ev(`(function(){
    var sv=document.querySelector('[data-page="database"] .db-plotinner svg'); if(!sv) return {error:'no chart svg'};
    var pl=[].slice.call(sv.querySelectorAll('polyline'));
    if(pl.length<2) return {error:'expected 2 polylines, saw '+pl.length};
    return pl.map(function(p){var cs=getComputedStyle(p);
      return {stroke:cs.stroke, dash:cs.strokeDasharray, width:cs.strokeWidth, verts:p.getAttribute('points').trim().split(/\\s+/).length};});
  })()`);
  if (curves.error) { console.log('FATAL: ' + curves.error); chrome.kill(); process.exit(1); }
  const bg = await ev(`getComputedStyle(document.querySelector('[data-page="database"] .db-card')||document.body).backgroundColor`);
  const [favC, dogC] = curves.map((x) => parseColor(x.stroke));
  const dE = deltaE2000(favC, dogC);
  console.log(`  favourites stroke ${curves[0].stroke}  dash="${curves[0].dash}"`);
  console.log(`  underdogs  stroke ${curves[1].stroke}  dash="${curves[1].dash}"`);
  console.log(`  panel background  ${bg}`);

  ok('the two curves are not the same colour', curves[0].stroke !== curves[1].stroke,
    `${curves[0].stroke} vs ${curves[1].stroke}`, 'different');
  // The pair the ruling replaced (#5b9bff/#4db8ff) measures dE2000 10.88. Require a
  // real step beyond it, not a nudge.
  ok('colour separation clears the pair it replaced (dE2000 > 20, was 10.88)', dE > 20, dE.toFixed(2), '>20');
  ok('favourites keeps a solid line', /^(none|)$/.test(curves[0].dash.trim()), curves[0].dash || 'none', 'none');
  ok('underdogs KEEPS the dash as well as the new colour', /\d/.test(curves[1].dash), curves[1].dash, 'a dash pattern');
  const bgC = parseColor(bg);
  const cf = contrast(favC, bgC), cd = contrast(dogC, bgC);
  ok('favourites clears 3:1 against the panel', cf >= 3, cf.toFixed(2) + ':1', '>=3:1');
  ok('underdogs clears 3:1 against the panel', cd >= 3, cd.toFixed(2) + ':1', '>=3:1');
  // Reserved tokens must not be borrowed for a series: two of them carry yield sign
  // and the third is the book-seam marker drawn on this same chart.
  const reserved = { '#3dd68c': 'positive yield', '#e0616f': 'negative yield', '#e8a84e': 'book-seam marker' };
  for (const [h, what] of Object.entries(reserved)) {
    const r = hex2rgb(h);
    ok(`neither curve borrows ${h} (${what})`, deltaE2000(favC, r) > 5 && deltaE2000(dogC, r) > 5,
      `dE ${deltaE2000(favC, r).toFixed(1)} / ${deltaE2000(dogC, r).toFixed(1)}`, '>5 each');
  }
  if (exportSrc) {
    const asHex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    for (const [label, rgb] of [['favourites', favC], ['underdogs', dogC]]) {
      const h = asHex(rgb), n = (exportSrc.match(new RegExp(h, 'gi')) || []).length;
      ok(`the ${label} colour ${h} is a token the export already uses`, n > 0, `${n} uses in Database.dc.html`, '>0');
    }
  } else ok('the design export is readable for the token check', false, 'not found', 'Database.dc.html');

  const legend = await ev(`(function(){
    var L=document.querySelector('[data-page="database"] .db-legend'); if(!L) return null;
    return [].slice.call(L.querySelectorAll('i')).map(function(i){var cs=getComputedStyle(i);
      return {col:cs.borderTopColor, style:cs.borderTopStyle};});
  })()`);
  if (legend && legend.length === 2) {
    ok('legend swatch 1 matches the favourites stroke',
      deltaE2000(parseColor(legend[0].col), favC) < 1, legend[0].col, curves[0].stroke);
    ok('legend swatch 2 matches the underdogs stroke',
      deltaE2000(parseColor(legend[1].col), dogC) < 1, legend[1].col, curves[1].stroke);
    ok('legend still encodes line style too (solid + dashed)',
      legend[0].style === 'solid' && legend[1].style === 'dashed',
      `${legend[0].style}/${legend[1].style}`, 'solid/dashed');
  } else ok('legend has two swatches', false, legend && legend.length, 2);

  // The end labels are where the colour cue matters most, and they are where the new
  // pair can collide: the underdog stroke IS the export's primary-text colour, so a
  // value rendered in --db-txt would print the "Underdogs" name and its own number
  // in the identical colour while "Favourites" kept a blue/white contrast.
  const labs = await ev(`(function(){
    return [].slice.call(document.querySelectorAll('[data-page="database"] .db-endlab')).map(function(l){
      var b=l.querySelector('b'), s=l.querySelector('span');
      return {name:b&&b.textContent.trim(), nameCol:b&&getComputedStyle(b).color, valCol:s&&getComputedStyle(s).color};
    });
  })()`);
  ok('two end labels painted', labs.length === 2, labs.length, 2);
  for (const l of labs) {
    const d = deltaE2000(parseColor(l.nameCol), parseColor(l.valCol));
    ok(`'${l.name}' end label keeps its name distinct from its own value`, d > 10, `dE ${d.toFixed(1)}`, '>10');
  }
  ok('the favourites end label is the favourites colour',
    deltaE2000(parseColor(labs[0].nameCol), favC) < 1, labs[0].nameCol, curves[0].stroke);
  ok('the underdogs end label is the underdogs colour',
    deltaE2000(parseColor(labs[1].nameCol), dogC) < 1, labs[1].nameCol, curves[1].stroke);

  // ══ ITEM 3 ═══════════════════════════════════════════════════════════════════
  console.log('\n── item 3: Finals folded out of the Tour Level picker ──');
  const openMenu = `(function(){
    var t=[].slice.call(document.querySelectorAll('[data-page="database"] button.db-trig'))
      .filter(function(e){return /^Level/.test(e.textContent);})[0];
    if(!t) return null; t.click(); return true; })()`;
  ok('a Level trigger is present on the Tour tab', (await ev(openMenu)) === true, true, true);
  await sleep(250);
  const menu = await ev(`(function(){
    var m=document.querySelector('[data-page="database"] .db-menu'); if(!m) return {error:'menu did not open'};
    return {rows:[].slice.call(m.querySelectorAll('.db-mrow')).map(function(r){return r.textContent.trim();})};
  })()`);
  if (menu.error) { console.log('FATAL: ' + menu.error); chrome.kill(); process.exit(1); }
  console.log(`  offered: ${JSON.stringify(menu.rows)}`);
  ok(`the Level picker offers ${wantOffered.length} rows`, menu.rows.length === wantOffered.length, menu.rows.length, wantOffered.length);
  ok(`'${FOLD}' is not offered`, !menu.rows.includes(FOLD), menu.rows.join('/'), `no ${FOLD}`);
  ok('the offered rows are exactly the level dictionary minus the fold',
    JSON.stringify(menu.rows) === JSON.stringify(wantOffered), menu.rows.join('/'), wantOffered.join('/'));

  // The mutation. Read the unfiltered count, then check every offered box and read
  // it again. Reading the menu alone cannot distinguish a fold from a deletion.
  // The 'All' row of the Favourites panel; its Matches cell is column 5. Every match
  // appears once on each side, so this cell IS the filtered row count.
  const readN = `(function(){
    var a=document.querySelector('[data-page="database"] .db-ga'); if(!a) return null;
    var cells=a.children; if(cells.length<5) return null;
    return +cells[4].textContent.trim().replace(/,/g,'');
  })()`;
  const nUnfiltered = await ev(readN);
  ok('the unfiltered All-row match count equals the artefact row count', nUnfiltered === totalAll, nUnfiltered, totalAll);

  // Check every offered box one at a time, re-opening the menu after each click
  // (renderFilters() rebuilds the bar, so the node list goes stale).
  // Guard against a vacuous pass: if the picker did nothing at all, the count would
  // read 41667 throughout and the "All still counts Finals" assertion below would
  // pass for the wrong reason. So check ONE box first and require the count to drop
  // to that level's own recomputed total.
  const firstLevel = wantOffered[0];
  const wantFirst = rows.filter((r) => r[1] === LEV.indexOf(firstLevel)).length;
  await ev(`(function(){var m=document.querySelector('[data-page="database"] .db-menu');
    var r=[].slice.call(m.querySelectorAll('.db-mrow')).filter(function(x){return x.textContent.trim()===${JSON.stringify(firstLevel)};})[0];
    if(r) r.click(); })()`);
  await sleep(300);
  const nFirst = await ev(readN);
  ok(`the picker actually filters: '${firstLevel}' alone gives its own recomputed count`,
    nFirst === wantFirst, nFirst, wantFirst);
  if (!(await ev(`!!document.querySelector('[data-page="database"] .db-menu')`))) { await ev(openMenu); await sleep(200); }

  // Now check the REMAINING boxes. Clicking the last one collapses the picker back
  // to "All" (setter(null)), at which point every row renders unchecked again — so
  // the loop cannot terminate on "no unchecked rows left"; it terminates when the
  // painted count returns to the unfiltered total. Capped so a broken picker fails
  // the assertion rather than spinning.
  let clicks = 0, afterAllChecked = null;
  for (let i = 0; i < wantOffered.length; i++) {
    const did = await ev(`(function(){
      var m=document.querySelector('[data-page="database"] .db-menu'); if(!m) return 'no menu';
      var r=[].slice.call(m.querySelectorAll('.db-mrow')).filter(function(x){return !/(^| )on( |$)/.test(x.className);})[0];
      if(!r) return 'none left'; r.click(); return 'clicked'; })()`);
    if (did !== 'clicked') break;
    clicks++;
    await sleep(250);
    afterAllChecked = await ev(readN);
    if (afterAllChecked === totalAll) break;
    // The menu stays open across a row click (state.menu is untouched and
    // renderFilters rebuilds it open), so only re-open it if it actually closed.
    // Clicking the trigger unconditionally would TOGGLE it shut.
    if (!(await ev(`!!document.querySelector('[data-page="database"] .db-menu')`))) { await ev(openMenu); await sleep(200); }
  }
  console.log(`  clicked ${clicks} further box(es); 1 + ${clicks} = ${1 + clicks} of ${wantOffered.length} offered levels`);
  ok('every offered level was reachable and checkable', 1 + clicks === wantOffered.length, 1 + clicks, wantOffered.length);
  ok('checking every offered Level reproduces the unfiltered total — so `All` STILL COUNTS the folded rows',
    afterAllChecked === totalAll, afterAllChecked, totalAll);
  ok(`and that total is ${totalFolded} MORE than the offered levels alone (${totalOffered}) — the fold is a picker change, not a data change`,
    afterAllChecked - totalOffered === totalFolded, afterAllChecked - totalOffered, totalFolded);

  console.log(`\nconsole errors: ${errs.length}${errs.length ? '\n  ' + errs.join('\n  ') : ''}`);
  ok('no uncaught exception while driving the picker', errs.length === 0, errs.length, 0);

  console.log(`\n${'─'.repeat(60)}\n${PASS} pass, ${FAILS.length} fail`);
  if (FAILS.length) FAILS.forEach((f) => console.log(`  FAILED: ${f}`));
  c.close(); chrome.kill();
  process.exit(FAILS.length ? 1 : 0);
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(2); });
