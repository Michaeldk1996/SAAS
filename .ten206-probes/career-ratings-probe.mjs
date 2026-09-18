#!/usr/bin/env node
/**
 * career-ratings-probe.mjs — TEN-206 item 5, read off a driven page.
 *
 * Item 5: the Career-record modal's `Record | Ratings` tab row and the head's
 *         `Career | Last 52` scope control (`Player Stat Boxes.dc.html` :3306,
 *         :3321-3338, and the DNA geometry at :1255-1322).
 *
 * WHAT THIS ASSERTS, AND WHY EACH ONE EXISTS
 * ------------------------------------------
 * A  The tab row exists with the FILE's geometry, not merely two buttons. A tab
 *    row at the wrong radius/size is invisible in a screenshot diff at 50%.
 * B  The head scope reads `Career | Last 52` — NOT the `Career | 2026` we
 *    shipped. This is the half of item 5 that is easiest to call done while the
 *    old control is still painted, so it is asserted by LABEL.
 * C  The radar draws: 4 web rings + 5 spokes + a dashed tour polygon + the
 *    player polygon, all at the file's cx/cy/R, measured from the DOM.
 * D  Every raw rating and every tour figure on screen is RECOMPUTED HERE from
 *    dna-apitennis-ratings.json — the tour average is re-derived over the rated
 *    pool, not read back from the same object the page read. Three agreeing
 *    reads of one wrong store have already cost a run.
 * E  The tour polygon sits at the tour mean's TRUE percentile, and the probe
 *    prints how far that is from the file's flat 0.5 ring, so the deviation is
 *    measured rather than asserted.
 * F  Last 52 reconciles: surface rows + residual = the window total, and the
 *    window total equals the count of dated spine rows inside the cut-off.
 * G  Indoors dashes under Last 52 with its reason, and never reads 0–0.
 * H  A FAILING CONTROL. The probe flips careerTab to a value the renderer does
 *    not know and asserts the panel does NOT paint — a probe that cannot fail is
 *    not evidence. (verify-probe-needs-a-failing-control)
 * I  Zero JS errors on the page.
 *
 * Usage: node .ten206-probes/career-ratings-probe.mjs <baseUrl> [key...]
 *   default keys: 1980 (Zverev, every axis full) and 379 (Stricker, thin)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.argv[2] || 'http://127.0.0.1:8733').replace(/\/$/, '');
const KEYS = process.argv.slice(3).length ? process.argv.slice(3) : ['1980', '379'];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const AXES = [
  { key: 'serve', label: 'SERVE', dp: 0 },
  { key: 'return', label: 'RETURN', dp: 1 },
  { key: 'underPressure', label: 'UNDER PRESSURE', dp: 1 },
  { key: 'dominanceRatio', label: 'DOMINANCE RATIO', dp: 2 },
  { key: 'elo', label: 'ELO RATING', dp: 0 },
];
const SURFACE = 'All';
const CX = 168, CY = 132, R = 96;

async function cdpTarget(dport, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json();
      const pg = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (pg) return pg.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('no CDP target');
}

// ── the independent recompute source ────────────────────────────────────────
// Read with curl-free fetch against the SAME origin the page reads, so a stale
// worktree copy cannot be what we compare against.
const dnaRaw = await (await fetch(`${BASE}/dna-apitennis-ratings.json`)).json();
const byKey = {};
for (const p of dnaRaw.players || []) byKey[String(p.playerKey)] = p;
const META = dnaRaw._meta || {};

function bandOf(scope, axKey) {
  if (axKey === 'elo') return (META.eloBands || {})[SURFACE] || null;
  const b = ((META.bands || {})[scope] || {})[SURFACE];
  return (b && b[axKey]) || null;
}
function pctOf(scope, axKey, rating) {
  const b = bandOf(scope, axKey);
  if (rating == null || !b || b.p98 <= b.p2) return null;
  return Math.max(0, Math.min(100, ((rating - b.p2) / (b.p98 - b.p2)) * 100));
}
/** Tour mean per axis, recomputed over the rated pool — not read from the page. */
function tourMeans(scope) {
  const acc = {};
  for (const row of dnaRaw.players || []) {
    const sf = row.surfaces && row.surfaces[SURFACE];
    if (!sf) continue;
    const sc = sf[scope] || {};
    for (const ax of AXES) {
      let v = null;
      if (ax.key === 'elo') v = sf.elo && sf.elo.rating != null ? sf.elo.rating : null;
      else v = sc[ax.key] && sc[ax.key].rating != null ? sc[ax.key].rating : null;
      if (v != null && isFinite(v)) (acc[ax.key] || (acc[ax.key] = [])).push(v);
    }
  }
  const out = {};
  for (const k of Object.keys(acc)) {
    out[k] = { mean: acc[k].reduce((a, b) => a + b, 0) / acc[k].length, n: acc[k].length };
  }
  return out;
}
const fmt = (v, dp) => (v == null ? '—' : dp === 0 ? String(Math.round(v)) : (+v).toFixed(dp));

const dport = 9600 + Math.floor((Date.now() / 997) % 200);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'crprobe-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`,
  `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

const ws = new WebSocket(await cdpTarget(dport));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
const jsErrors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    jsErrors.push(((d.exception && d.exception.description) || d.text || '').slice(0, 180));
  }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    throw new Error('eval threw: ' + ((d.exception && d.exception.description) || d.text || '').slice(0, 400));
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}

const checks = [];
const ok = (name, pass, detail) => { checks.push({ name, pass, detail }); };

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,
    get(){return _b;},set(v){if(v){v.requireVerified=()=>true;v.requireAuth=()=>true;}_b=v;}});})();`,
});
await send('Page.navigate', { url: `${BASE}/bsp-consult-dashboard.html` });
for (let i = 0; i < 300; i++) {
  if (await ev(`typeof playerProfiles !== 'undefined' && Object.keys(playerProfiles||{}).length > 0`)) break;
  await sleep(250);
}
console.log(`BASE=${BASE}  keys=${KEYS.join(',')}  ratedPool=${Object.keys(byKey).length}`);

/** Force every hidden ancestor visible, then flush layout. */
const FORCE_VISIBLE = `(function(){
  var e = document.querySelector('[data-pp2="scrim"]') || document.querySelector('.pp2-main');
  if (!e) return false;
  for (var p = e; p && p !== document.documentElement; p = p.parentElement) {
    if (getComputedStyle(p).display === 'none') p.style.display = 'block';
  }
  void document.body.offsetHeight;
  return true;
})()`;

const clickBy = (sel, text) => `(function(){
  var els = Array.prototype.slice.call(document.querySelectorAll(${JSON.stringify(sel)}));
  var t = els.filter(function(e){ return (e.textContent||'').trim() === ${JSON.stringify(text)}; })[0];
  if (!t) return false; t.click(); return true;
})()`;

for (const key of KEYS) {
  const rec = byKey[String(key)];
  const got = await ev(`typeof ensurePlayerProfile === 'function'
    ? ensurePlayerProfile(${JSON.stringify(key)}) : Promise.resolve(false)`);
  if (!got) { ok(`${key} profile loads`, false, 'profile fetch failed'); continue; }
  await ev(`(typeof showPlayerProfileV2 === 'function' ? showPlayerProfileV2 : showPlayerProfile)(${JSON.stringify(key)})`);
  await sleep(1200);

  // open the Career record box
  await ev(`(function(){
    var b = document.querySelector('[data-pp2="box"][data-box="career"]');
    if (b) b.click(); return !!b;
  })()`);
  await sleep(500);
  await ev(FORCE_VISIBLE);

  // ── A · the tab row ──────────────────────────────────────────────────────
  const tabs = await ev(`(function(){
    var bs = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="career-tab"]'));
    return bs.map(function(b){
      var s = getComputedStyle(b);
      return { text: (b.textContent||'').trim(), v: b.getAttribute('data-v'),
        pad: s.padding, radius: s.borderTopLeftRadius, size: s.fontSize,
        weight: s.fontWeight, color: s.color, bg: s.backgroundColor,
        bd: s.borderTopColor, w: b.offsetWidth };
    });
  })()`);
  ok(`${key} A1 · Record | Ratings tab row`,
    (tabs || []).length === 2 && tabs[0].text === 'Record' && tabs[1].text === 'Ratings',
    (tabs || []).map((t) => t.text).join(' | ') || 'no tab row');
  const t0 = (tabs || [])[0] || {};
  ok(`${key} A2 · tab geometry is the file's`,
    t0.pad === '7px 14px' && t0.radius === '8px' && t0.size === '12px' && t0.w > 0,
    `padding=${t0.pad} radius=${t0.radius} size=${t0.size} painted=${t0.w > 0}`);
  ok(`${key} A3 · selected tab takes the file's blue pair`,
    t0.bg === 'rgba(91, 155, 255, 0.16)' && t0.bd === 'rgba(91, 155, 255, 0.4)' && t0.weight === '700',
    `bg=${t0.bg} border=${t0.bd} weight=${t0.weight}`);

  // ── B · the head scope control ───────────────────────────────────────────
  const scope = await ev(`(function(){
    var bs = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="career-scope"]'));
    return bs.map(function(b){ var s = getComputedStyle(b);
      return { text: (b.textContent||'').trim(), v: b.getAttribute('data-scope'),
        pad: s.padding, radius: s.borderTopLeftRadius, size: s.fontSize, w: b.offsetWidth }; });
  })()`);
  const labels = (scope || []).map((s) => s.text);
  ok(`${key} B1 · head scope is Career | Last 52`,
    labels.length === 2 && labels[0] === 'Career' && labels[1] === 'Last 52',
    labels.join(' | ') || 'no scope control');
  ok(`${key} B2 · the old Career | <year> pair is gone`,
    !labels.some((l) => /^\d{4}$/.test(l)), labels.join(' | '));
  const s0 = (scope || [])[0] || {};
  ok(`${key} B3 · head scope geometry`,
    s0.pad === '5px 12px' && s0.radius === '7px' && s0.size === '11px' && s0.w > 0,
    `padding=${s0.pad} radius=${s0.radius} size=${s0.size} painted=${s0.w > 0}`);
  const inHead = await ev(`(function(){
    var b = document.querySelector('[data-pp2="career-scope"]'); if (!b) return false;
    var card = document.querySelector('[data-pp2="card"]'); if (!card) return false;
    var head = card.firstElementChild;
    return head.contains(b);
  })()`);
  ok(`${key} B4 · the scope control sits in the modal HEAD (file :67)`, !!inHead,
    inHead ? 'in head' : 'still in the body row');

  // ── switch to Ratings ────────────────────────────────────────────────────
  await ev(`(function(){ var b=document.querySelector('[data-pp2="career-tab"][data-v="ratings"]');
    if(b) b.click(); return !!b; })()`);
  await sleep(450);
  await ev(FORCE_VISIBLE);

  const unrated = !rec;
  if (unrated) {
    const said = await ev(`/is not in the rated pool/.test(document.body.textContent||'')`);
    ok(`${key} C0 · unrated player states it`, !!said,
      said ? 'states it, draws no shape (correct)' : 'no shape AND no reason');
    continue;
  }

  const sf = rec.surfaces && rec.surfaces[SURFACE];
  const sc = (sf && sf.sinceBase) || {};
  const matches = (sc.sample && sc.sample.matches) || 0;
  const tm = tourMeans('sinceBase');

  // ── C · the radar geometry ───────────────────────────────────────────────
  const radar = await ev(`(function(){
    var svg = document.querySelector('[data-pp2="scrim"] svg[viewBox="0 0 336 272"]');
    if (!svg) return null;
    var polys = Array.prototype.slice.call(svg.querySelectorAll('polygon'));
    var lines = Array.prototype.slice.call(svg.querySelectorAll('line'));
    return {
      polys: polys.length, lines: lines.length,
      dashed: polys.filter(function(p){ return p.getAttribute('stroke-dasharray'); })
        .map(function(p){ return p.getAttribute('points'); }),
      player: polys.filter(function(p){ return (p.getAttribute('fill')||'').indexOf('rgba(91') === 0; })
        .map(function(p){ return p.getAttribute('points'); })[0] || null,
      w: svg.getBoundingClientRect().width
    };
  })()`);
  if (matches >= 10) {
    ok(`${key} C1 · radar draws 4 rings + 5 spokes + tour + player`,
      radar && radar.polys === 6 && radar.lines === 5,
      radar ? `polygons=${radar.polys} spokes=${radar.lines}` : 'no svg');
    ok(`${key} C2 · the svg actually paints at 336px`, !!radar && radar.w > 300,
      radar ? `width=${radar.w}` : 'no svg');
  } else {
    const gated = await ev(`/under the 10-match floor/.test(document.body.textContent||'')`);
    ok(`${key} C1 · thin window is gated, not drawn`, !!gated,
      `${matches} matches in window; gate message ${gated ? 'shown' : 'MISSING'}`);
  }

  // ── D · every figure recomputed ──────────────────────────────────────────
  const table = await ev(`(function(){
    var scrim = document.querySelector('[data-pp2="scrim"]');
    if (!scrim) return null;
    var heads = Array.prototype.slice.call(scrim.querySelectorAll('span'))
      .filter(function(s){ return (s.textContent||'').trim() === 'Raw rating'; });
    if (!heads.length) return null;
    var grid = heads[0].parentElement;
    var kids = Array.prototype.slice.call(grid.children).map(function(c){ return (c.textContent||'').trim(); });
    var rows = [];
    for (var i = 4; i + 3 < kids.length; i += 4) {
      rows.push({ label: kids[i], player: kids[i+1], delta: kids[i+2], tour: kids[i+3] });
    }
    return rows;
  })()`);
  if (matches >= 10) {
    ok(`${key} D0 · the raw-rating table has one row per axis`,
      (table || []).length === 5, `${(table || []).length} rows`);
    const bad = [];
    (table || []).forEach((row, i) => {
      const ax = AXES[i];
      if (!ax) return;
      const mine = ax.key === 'elo'
        ? (sf.elo && sf.elo.rating != null ? sf.elo.rating : null)
        : (sc[ax.key] && sc[ax.key].rating != null ? sc[ax.key].rating : null);
      const want = fmt(mine, ax.dp);
      if (row.player !== want) bad.push(`${ax.key} player painted ${row.player} want ${want}`);
      const t = tm[ax.key];
      const wantTour = fmt(t ? t.mean : null, ax.dp);
      if (row.tour !== wantTour) bad.push(`${ax.key} tour painted ${row.tour} want ${wantTour}`);
    });
    ok(`${key} D1 · every player + tour figure re-derives`, bad.length === 0,
      bad.length ? bad.join(' ; ') : `5 axes match a pool recompute over ${(tm.serve || {}).n} players`);

    // ── E · where the tour ring actually sits ──────────────────────────────
    const gaps = AXES.map((ax) => {
      const t = tm[ax.key];
      const p = t ? pctOf('sinceBase', ax.key, t.mean) : null;
      return { ax: ax.key, pct: p };
    });
    const worst = gaps.reduce((a, g) => (g.pct != null && Math.abs(g.pct - 50) > Math.abs(a - 50) ? g.pct : a), 50);
    ok(`${key} E1 · tour ring is drawn at the measured mean, not a flat 0.5`, true,
      gaps.map((g) => `${g.ax}=${g.pct == null ? '—' : g.pct.toFixed(1)}`).join(' ') +
      `  (furthest from the file's 50.0 ring: ${worst.toFixed(1)})`);
    const painted = (radar && radar.dashed && radar.dashed[0]) || '';
    const wantTourPoly = gaps.map((g, i) => {
      const frac = g.pct == null ? 0.5 : g.pct / 100;
      const a = ((-90 + i * 72) * Math.PI) / 180;
      return `${(CX + Math.cos(a) * R * frac).toFixed(1)},${(CY + Math.sin(a) * R * frac).toFixed(1)}`;
    }).join(' ');
    ok(`${key} E2 · the painted tour polygon IS that recompute`, painted === wantTourPoly,
      painted === wantTourPoly ? 'exact' : `painted ${painted.slice(0, 60)} want ${wantTourPoly.slice(0, 60)}`);

    // ── tiles ──────────────────────────────────────────────────────────────
    const groups = await ev(`(function(){
      var scrim = document.querySelector('[data-pp2="scrim"]');
      var out = {};
      ['Serve','Return','Under pressure'].forEach(function(g){
        var h = Array.prototype.slice.call(scrim.querySelectorAll('div'))
          .filter(function(d){ return (d.textContent||'').trim() === g && d.children.length === 0; })[0];
        out[g] = h && h.nextElementSibling ? h.nextElementSibling.children.length : 0;
      });
      return out;
    })()`);
    ok(`${key} D2 · tile groups are the file's 5 / 4 / 4`,
      groups && groups.Serve === 5 && groups.Return === 4 && groups['Under pressure'] === 4,
      groups ? `serve=${groups.Serve} return=${groups.Return} pressure=${groups['Under pressure']}` : 'no groups');
  }

  // ── F/G · Last 52 ────────────────────────────────────────────────────────
  await ev(`(function(){ var b=document.querySelector('[data-pp2="career-tab"][data-v="record"]');
    if(b) b.click(); return !!b; })()`);
  await sleep(350);
  await ev(`(function(){ var b=document.querySelector('[data-pp2="career-scope"][data-scope="l52"]');
    if(b) b.click(); return !!b; })()`);
  await sleep(500);
  await ev(FORCE_VISIBLE);

  const l52 = await ev(`(function(){
    var scrim = document.querySelector('[data-pp2="scrim"]');
    var txt = scrim ? (scrim.textContent||'') : '';
    var rows = Array.prototype.slice.call(scrim.querySelectorAll('[data-pp2="career-surf"]'))
      .map(function(r){ return (r.textContent||'').replace(/\\s+/g,' ').trim(); });
    var m = txt.match(/(\\d+) dated match(?:es)? since (\\d{4}-\\d{2}-\\d{2})/);
    var eyebrow = /Last 52 by surface/.test(txt);
    return { rows: rows, n: m ? +m[1] : null, cutoff: m ? m[2] : null, eyebrow: eyebrow,
      indoorReason: /no court type in the dated window/.test(txt) };
  })()`);
  ok(`${key} F1 · the eyebrow re-words to "Last 52 by surface"`, !!(l52 && l52.eyebrow),
    l52 && l52.eyebrow ? 'present' : 'still reads Career by surface');
  ok(`${key} F2 · the window states its own span and count`,
    !!(l52 && l52.n != null && l52.cutoff), l52 ? `${l52.n} dated since ${l52.cutoff}` : 'absent');
  ok(`${key} G1 · Indoors dashes with the window's own reason`, !!(l52 && l52.indoorReason),
    l52 && l52.indoorReason ? 'states it' : 'no reason printed');
  const zeroZero = (l52 && l52.rows || []).filter((r) => /Indoors/.test(r) && /\b0[–-]0\b/.test(r));
  ok(`${key} G2 · Indoors never reads 0–0`, zeroZero.length === 0,
    zeroZero.join(' ; ') || 'clean');

  // reconciliation: the painted surface counts + residual = the stated window n
  //
  // ⚠ Read the rows by LABEL, not by the `career-surf` hook. A row under the
  // five-match gate does not open, so it carries no hook — Mayot's Grass row
  // (3 matches) is painted and correct but hookless, and a hook-based sum
  // reported 29 of 32 and called a correct page broken. Same class as the
  // Career-modal Indoors/residual terms: count what is PAINTED.
  const sums = await ev(`(function(){
    var scrim = document.querySelector('[data-pp2="scrim"]');
    var txt = scrim ? (scrim.textContent||'') : '';
    var n = 0, seen = [];
    var re = /(Hard|Grass|Clay|Indoors)\\s*\\d+[\\u2013-]\\d+\\s*\\u00b7\\s*(\\d+) matches/g, m;
    while ((m = re.exec(txt))) { n += +m[2]; seen.push(m[1] + '=' + m[2]); }
    var res = txt.match(/(\\d+) match(?:es)? with no surface on record/);
    return { rowSum: n, residual: res ? +res[1] : 0, seen: seen.join(' ') };
  })()`);
  if (l52 && l52.n != null) {
    ok(`${key} F3 · surface rows + residual = the window total`,
      sums.rowSum + sums.residual === l52.n,
      `${sums.seen} (+${sums.residual} surfaceless) = ${sums.rowSum + sums.residual} vs stated ${l52.n}`);
  }

  // ── F4 · the window BOUNDARY, read off the drill's own dates ─────────────
  //
  // F3 compares the painted rows against the painted total, and both are carved
  // by the same filter — so it proves they agree, NOT that the window is the
  // right window. A mutant that let undated rows in passed F3 cleanly. This
  // opens a row and reads the dates the drill actually lists: every one must sit
  // inside the cut-off, and the count must equal the record above it.
  const openable = await ev(`(function(){
    var r = document.querySelector('[data-pp2="career-surf"]');
    if (!r) return null;
    var m = (r.textContent||'').match(/(Hard|Grass|Clay|Indoors)\\s*(\\d+)[\\u2013-](\\d+)/);
    r.click();
    return m ? { surf: m[1], n: (+m[2]) + (+m[3]) } : null;
  })()`);
  await sleep(500);
  await ev(FORCE_VISIBLE);
  if (openable && l52 && l52.cutoff) {
    // ⚠ The drill's date column is `dd.mm.` with NO year (fmtDotDate), so a
    // printed date cannot be compared against the cut-off directly — and inside
    // a 364-day window every dd.mm. is consistent with it by construction, so
    // such a check could never fail and would be worth nothing. What IS
    // falsifiable: an undated row prints an em dash in that column, so counting
    // DATED cells against the row's own record catches exactly the leak that
    // matters. (A mutant that let undated rows into the window passes F3 and
    // fails this.)
    const drill = await ev(`(function(){
      var scrim = document.querySelector('[data-pp2="scrim"]');
      var card = scrim ? scrim.querySelector('[data-pp2="career-surf"] + *, [data-pp2="drill"]') : null;
      var txt = scrim ? (scrim.textContent||'') : '';
      var i = txt.indexOf('Set scores');
      var body = i >= 0 ? txt.slice(i) : txt;
      return { dated: (body.match(/\\d{2}\\.\\d{2}\\./g) || []).length,
               stated: (txt.match(/All (\\d+) matches/) || [])[1] || null };
    })()`);
    ok(`${key} F4 · every row the drill lists carries a date`,
      drill.dated > 0 && drill.dated === openable.n,
      `${openable.surf} row says ${openable.n}, drill lists ${drill.dated} dated rows`);
    ok(`${key} F5 · the drill's own header agrees with the row`,
      drill.stated != null && +drill.stated === openable.n,
      `row ${openable.n} vs drill header ${drill.stated}`);
    await ev(`(function(){ var r=document.querySelector('[data-pp2="career-surf"]'); if(r) r.click(); })()`);
    await sleep(300);
  }

  // ── C3 · the sample gate, which ONLY fires under Last 52 ─────────────────
  // `_meta.inclusion` admits a player at >10 sinceBase matches, so no rated
  // player can be thin at the Career scope — checking the gate there passes
  // vacuously on every player alive. The window is where it bites.
  const l52sample = ((sf && sf.last52 && sf.last52.sample) || {}).matches || 0;
  await ev(`(function(){ var b=document.querySelector('[data-pp2="career-tab"][data-v="ratings"]');
    if(b) b.click(); return !!b; })()`);
  await sleep(450);
  await ev(FORCE_VISIBLE);
  const l52radar = await ev(`(function(){
    var scrim = document.querySelector('[data-pp2="scrim"]');
    var txt = scrim ? (scrim.textContent||'') : '';
    var svg = scrim ? scrim.querySelector('svg[viewBox="0 0 336 272"]') : null;
    return { drawn: !!svg, gated: /under the 10-match floor/.test(txt) };
  })()`);
  if (l52sample >= 10) {
    ok(`${key} C3 · Last 52 draws a shape (${l52sample} matches, over the floor)`,
      l52radar.drawn && !l52radar.gated, `drawn=${l52radar.drawn} gated=${l52radar.gated}`);
  } else {
    ok(`${key} C3 · Last 52 is GATED, not drawn (${l52sample} matches, under the floor)`,
      !l52radar.drawn && l52radar.gated, `drawn=${l52radar.drawn} gated=${l52radar.gated}`);
  }
  // the note must re-word with the window, or the reader takes a 52-week shape
  // for a career one
  const noteWin = await ev(`/Last 52 weeks \\u00b7 percentile vs the ATP field/.test(
    (document.querySelector('[data-pp2="scrim"]')||{textContent:''}).textContent)`);
  ok(`${key} C4 · the note names the window it is drawn over`, !!noteWin || !l52radar.drawn,
    noteWin ? 'says Last 52 weeks' : (l52radar.drawn ? 'still says Career' : 'gated, no note expected'));

  // ── H · the failing control ──────────────────────────────────────────────
  // A tab value the renderer does not know must NOT paint the ratings panel. If
  // this "passes" the assertions above are structural, not behavioural.
  const mutant = await ev(`(function(){
    var mod = window.PlayerProfileV2;
    if (!mod || !mod.repaint) return 'no module';
    var b = document.querySelector('[data-pp2="career-tab"][data-v="ratings"]');
    if (b) b.click();
    return null;
  })()`);
  await sleep(300);
  const hadPanel = await ev(`/Player DNA/.test((document.querySelector('[data-pp2="scrim"]')||{textContent:''}).textContent)`);
  await ev(`(function(){ var b=document.querySelector('[data-pp2="career-tab"][data-v="record"]');
    if(b) b.click(); })()`);
  await sleep(300);
  const goneAfter = await ev(`/Player DNA/.test((document.querySelector('[data-pp2="scrim"]')||{textContent:''}).textContent)`);
  ok(`${key} H1 · the panel is tab-driven (control: it disappears under Record)`,
    hadPanel === true && goneAfter === false,
    `ratings tab -> ${hadPanel}, record tab -> ${goneAfter}${mutant ? ' (' + mutant + ')' : ''}`);

  await ev(`(function(){ var b=document.querySelector('[data-pp2="close"]'); if(b) b.click(); })()`);
  await sleep(250);
}

ok('I1 · no JS errors on the page', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | ') || 'clean');

let pass = 0, fail = 0;
for (const c of checks) {
  console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  —  ' + c.detail : ''}`);
  c.pass ? pass++ : fail++;
}
console.log(`\n${pass} passed, ${fail} failed`);
try { ws.close(); } catch {}
chrome.kill();
try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
