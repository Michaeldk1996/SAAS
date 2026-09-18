#!/usr/bin/env node
/**
 * market-ladder-chart-probe.mjs — TEN-206 items 1 and 2, read off a driven page.
 *
 * Item 1: the eight-band role-specific price ladder (founder ruling 2026-09-18,
 *         "the file wins — 8 bands").
 * Item 2: the cumulative chart at the locked file's geometry
 *         (`Player Stat Boxes.dc.html` :3085-3116 and :809-849).
 *
 * WHAT THIS ASSERTS, AND WHY EACH ONE EXISTS
 * ------------------------------------------
 * A  Eight band rows, in the file's exact label order. A ladder that renders the
 *    right COUNT with the wrong cut-offs looks identical in a screenshot.
 * B  Every band figure on screen is re-derived HERE from the shard's own match
 *    rows — n, record, win rate, yield — and compared to the painted text. The
 *    rule is recompute-then-compare, not read-the-JSON-the-page-read: three
 *    mutually-confirming reads of one wrong store have already cost a run.
 * C  The bands sum to the role card (§4 reconciliation).
 * D  The sample gate still dashes. This is the founder's explicit question:
 *    "confirm the sample gate still dashes thin bands rather than printing 0%."
 *    Driven on a player who HAS a thin band, because on a player who has none the
 *    check passes vacuously.
 * E  Chart geometry: a 300px plot, viewBox 1000x300, the fixed #5b9bff stroke,
 *    a gridline ladder, a season tick row, the sub-line and the signed total.
 *    Measured with offsetHeight as well as computed style — a computed style read
 *    inside a hidden subtree returns the SPECIFIED value and proves nothing.
 * F  Zero JS errors on the page.
 *
 * Usage: node .ten206-probes/market-ladder-chart-probe.mjs <baseUrl> [key...]
 *   default keys: 1980 (Zverev, every band full) and 379 (Stricker, thin bands)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.argv[2] || 'http://127.0.0.1:8776').replace(/\/$/, '');
const KEYS = process.argv.slice(3).length ? process.argv.slice(3) : ['1980', '379'];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const FAV_LABELS = ['1.01 – 1.20', '1.21 – 1.40', '1.41 – 1.64', '1.65 – 1.99'];
const DOG_LABELS = ['2.00 – 2.49', '2.50 – 3.49', '3.50 – 5.99', '6.00 +'];

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

const dport = 9400 + Math.floor((Date.now() / 997) % 200);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'mktprobe-'));
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
console.log(`BASE=${BASE}  keys=${KEYS.join(',')}`);

/** Local recompute of one band group, from the shard's own basis rows. */
function recompute(matches, role, labels) {
  const tests = role === 'fav'
    ? [(p) => p <= 1.2, (p) => p <= 1.4, (p) => p <= 1.64, () => true]
    : [(p) => p < 2.5, (p) => p < 3.5, (p) => p < 6.0, () => true];
  let pool = matches.filter((m) => m.inBasis && m.role === role);
  return labels.map((label, i) => {
    const rs = pool.filter((m) => tests[i](m.price));
    pool = pool.filter((m) => !tests[i](m.price));
    const n = rs.length;
    const w = rs.filter((m) => m.won).length;
    const cents = rs.reduce((a, m) => a + (m.won ? Math.round(m.price * 100) - 100 : -100), 0);
    const gate = n >= 10 ? 'full' : n >= 5 ? 'small' : n ? 'thin' : 'none';
    const rateOk = gate === 'full' || gate === 'small';
    return {
      label, n, w, l: n - w, gate,
      win: rateOk ? (w / n * 100).toFixed(1) + '%' : null,
      // Yield is per-match profit expressed as a percentage of a 1u stake, so
      // cents/n IS the percentage. The builder rounds to 1dp (r1) and the page
      // prints it through neg(v, 2, '%') — 1dp of value, 2dp of format, minus
      // sign U+2212, no leading + on a positive.
      yieldPct: rateOk ? Math.round((cents / n) * 10) / 10 : null,
    };
  });
}

for (const key of KEYS) {
  const got = await ev(`typeof ensurePlayerProfile === 'function'
    ? ensurePlayerProfile(${JSON.stringify(key)}) : Promise.resolve(false)`);
  if (!got) { ok(`${key} profile loads`, false, 'profile fetch failed'); continue; }
  await ev(`(typeof showPlayerProfileV2 === 'function' ? showPlayerProfileV2 : showPlayerProfile)(${JSON.stringify(key)})`);
  await sleep(900);

  // --- G · Key insights icon colour (founder ruling Q3, 2026-09-18) ------
  // Read BEFORE any modal opens, and with the profile subtree forced visible:
  // a computed style inside a display:none subtree returns the specified value
  // and would pass on markup that never paints.
  await ev(`(function(){
    var e = document.querySelector('[data-insight]'); if (!e) return;
    for (var p = e; p && p !== document.documentElement; p = p.parentElement) {
      if (getComputedStyle(p).display === 'none') p.style.display = 'block';
    }
    void document.body.offsetHeight;
  })()`);
  await sleep(250);
  const ins = await ev(`(function(){
    var cards = Array.prototype.slice.call(document.querySelectorAll('[data-insight]'))
      .filter(function(c){ return c.offsetWidth > 0; });
    return cards.map(function(c){
      var icon = c.querySelector('svg') ? c.querySelector('svg').parentElement : null;
      if (!icon) return null;
      var s = getComputedStyle(icon);
      var pth = c.querySelector('svg path');
      return { bg: s.backgroundColor, col: s.color, border: s.borderTopWidth,
        sw: pth ? pth.getAttribute('stroke-width') : null };
    });
  })()`);
  const cardsSeen = (ins || []).filter(Boolean);
  if (!cardsSeen.length) {
    // Zero cards is a legitimate state — the §9 gate means a player whose splits
    // all sit under ten matches gets the dashed "no splits clear" panel instead.
    // Distinguish it from a broken render rather than calling either a pass.
    const empty = await ev(`/No splits clear the ten-match minimum/.test(document.body.textContent||'')`);
    ok(`${key} G · Key insights`, !!empty,
      empty ? 'no card: every split is under the ten-match gate (correct)' : 'no card AND no gate panel');
  } else {
    const POS = { bg: 'rgba(62, 123, 250, 0.15)', col: 'rgb(91, 155, 255)' };
    const NEG = { bg: 'rgba(226, 75, 74, 0.14)', col: 'rgb(226, 75, 74)' };
    const bad = cardsSeen.filter((c) =>
      !((c.bg === POS.bg && c.col === POS.col) || (c.bg === NEG.bg && c.col === NEG.col)));
    ok(`${key} G1 · insight icons are the file's blue/red pair`, bad.length === 0,
      cardsSeen.map((c) => c.col + ' on ' + c.bg).join(' ; '));
    ok(`${key} G2 · no icon border, stroke-width 1.7`,
      cardsSeen.every((c) => c.border === '0px' && c.sw === '1.7'),
      cardsSeen.map((c) => 'border ' + c.border + ' sw ' + c.sw).join(' ; '));
  }

  // Open the Market edge box by its own text, not by index: the box ORDER is
  // locked but an index is silently wrong the day it moves.
  const opened = await ev(`(function(){
    var bs = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="box"]'));
    var b = bs.filter(function(e){ return /Market edge/i.test(e.textContent||''); })[0];
    if (!b) return null; b.click(); return (b.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40);
  })()`);
  ok(`${key} Market edge box opens`, !!opened, opened || 'box not found');
  if (!opened) continue;
  await sleep(900);

  // The profile lives inside a `.tabpage` that is `display:none` unless its tab
  // is the active one, and headless opens on Today's Matches. Inside a hidden
  // subtree every offsetWidth/offsetHeight is 0 and getComputedStyle returns the
  // SPECIFIED value — so a geometry read there proves nothing and an
  // offsetWidth>0 filter finds no overlay at all. Force the ancestors visible
  // and let layout run before measuring anything.
  const unhid = await ev(`(function(){
    var e = document.querySelector('[data-pp2="scrim"]'); var n = 0;
    for (var p = e; p && p !== document.documentElement; p = p.parentElement) {
      if (getComputedStyle(p).display === 'none') { p.style.display = 'block'; n++; }
    }
    void document.body.offsetHeight;   // force layout
    return n;
  })()`);
  await sleep(400);
  ok(`${key} overlay is laid out (hidden ancestors forced: ${unhid})`,
    (await ev(`!!document.querySelectorAll('[data-pp2="scrim"]')[0] &&
      document.querySelectorAll('[data-pp2="scrim"]')[0].offsetWidth > 0`)),
    'offsetWidth > 0');

  const shard = await ev(`(function(){ var s=(window.marketEdge||{})[${JSON.stringify(key)}]; return s ? {
    name: s.name, schema: s.schemaVersion, matches: s.matches,
    favN: s.roles.favourite.n, dogN: s.roles.underdog.n,
    straddle: (s.coverage||{}).bandStraddle } : null; })()`);
  ok(`${key} shard is schema 2`, shard && shard.schema === 2, shard ? 'schema ' + shard.schema : 'no shard');
  if (!shard) continue;

  // --- painted band rows -------------------------------------------------
  const painted = await ev(`(function(){
    var ov = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="scrim"]'))
      .filter(function(e){ return e.offsetWidth > 0; })[0];
    if (!ov) return null;
    var rows = Array.prototype.slice.call(ov.querySelectorAll('[data-pp2="market-band"]'));
    // Bands with n=0 carry no click hook, so collect by the grid signature too.
    var all = Array.prototype.slice.call(ov.querySelectorAll('div')).filter(function(d){
      return /^minmax\\(96px/.test(d.style.gridTemplateColumns || '');
    });
    return all.map(function(d){
      var cells = Array.prototype.slice.call(d.children).map(function(c){
        return (c.textContent||'').replace(/\\s+/g,' ').trim(); });
      return cells;
    });
  })()`);
  const bandRows = (painted || []).filter((c) => c.length === 6 && !/^$/.test(c[0]) && c[0] !== '');
  // drop the header row (its first cell is empty, already filtered) and any
  // non-band grid that happens to share the signature
  const labelled = bandRows.filter((c) => FAV_LABELS.concat(DOG_LABELS).indexOf(c[0]) >= 0);

  ok(`${key} A · eight band rows painted`, labelled.length === 8,
    labelled.length + ' rows: ' + labelled.map((c) => c[0]).join(' | '));
  ok(`${key} A · labels in the file's order`,
    JSON.stringify(labelled.map((c) => c[0])) === JSON.stringify(FAV_LABELS.concat(DOG_LABELS)),
    labelled.map((c) => c[0]).join(' | '));

  // --- B · recompute and compare ----------------------------------------
  const expect = recompute(shard.matches, 'fav', FAV_LABELS).concat(recompute(shard.matches, 'dog', DOG_LABELS));
  let bMismatch = [];
  expect.forEach((e, i) => {
    const c = labelled[i];
    if (!c) { bMismatch.push(e.label + ' not painted'); return; }
    const nTxt = e.n ? String(e.n) : '—';
    const recTxt = e.n ? e.w + '–' + e.l : '—';
    const winTxt = e.win == null ? '—' : e.win;
    const yTxt = e.yieldPct == null ? '—'
      : e.yieldPct.toFixed(2).replace(/^-/, '−') + '%';
    if (c[1] !== nTxt) bMismatch.push(`${e.label} n: page "${c[1]}" vs recomputed "${nTxt}"`);
    if (c[2] !== recTxt) bMismatch.push(`${e.label} record: page "${c[2]}" vs recomputed "${recTxt}"`);
    if (c[3] !== winTxt) bMismatch.push(`${e.label} win: page "${c[3]}" vs recomputed "${winTxt}"`);
    if (c[5] !== yTxt) bMismatch.push(`${e.label} yield: page "${c[5]}" vs recomputed "${yTxt}"`);
  });
  ok(`${key} B · every band figure matches an independent recompute`, bMismatch.length === 0,
    bMismatch.slice(0, 4).join(' ; ') || `${expect.length} bands x 4 figures re-derived`);

  // --- C · bands sum to the role card -----------------------------------
  const favSum = expect.slice(0, 4).reduce((a, e) => a + e.n, 0);
  const dogSum = expect.slice(4).reduce((a, e) => a + e.n, 0);
  ok(`${key} C · bands sum to the role cards`,
    favSum === shard.favN && dogSum === shard.dogN,
    `fav ${favSum}/${shard.favN} · dog ${dogSum}/${shard.dogN} · straddle ${shard.straddle}`);

  // --- D · the sample gate still dashes ---------------------------------
  const gated = expect.filter((e) => e.n > 0 && e.n < 5);
  if (!gated.length) {
    ok(`${key} D · gate (no thin band on this player — check is vacuous here)`, true, 'skipped');
  } else {
    const bad = gated.filter((e) => {
      const c = labelled[expect.indexOf(e)];
      return !c || c[3] !== '—' || c[5] !== '—';
    });
    ok(`${key} D · thin bands dash rather than print 0%`, bad.length === 0,
      gated.map((e) => `${e.label} n=${e.n} -> win "${(labelled[expect.indexOf(e)]||[])[3]}" yield "${(labelled[expect.indexOf(e)]||[])[5]}"`).join(' ; '));
  }

  // --- E · chart geometry ------------------------------------------------
  const chart = await ev(`(function(){
    var ov = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="scrim"]'))
      .filter(function(e){ return e.offsetWidth > 0; })[0];
    if (!ov) return null;
    var svg = Array.prototype.slice.call(ov.querySelectorAll('svg'))
      .filter(function(s){ return /^0 0 /.test(s.getAttribute('viewBox')||''); })
      .filter(function(s){ return s.querySelector('path[stroke]'); })[0];
    if (!svg) return { svg: false };
    var plot = svg.parentElement;
    var line = svg.querySelector('path[stroke]');
    var txt = (ov.textContent||'').replace(/\\s+/g,' ');
    // The tick row is the sibling block after the plot row; count absolutely
    // positioned year labels in it.
    var card = plot.closest ? plot.closest('div[style*="border-radius:12px"]') : null;
    var ticks = card ? Array.prototype.slice.call(card.querySelectorAll('div'))
      .filter(function(d){ return /^(19|20)\\d\\d$/.test((d.textContent||'').trim())
        && /absolute/.test(d.style.position||''); }).length : 0;
    var grid = card ? Array.prototype.slice.call(card.querySelectorAll('div'))
      .filter(function(d){ return (d.style.background||'').replace(/\\s/g,'') === 'rgba(255,255,255,0.05)'; }).length : 0;
    var zero = card ? Array.prototype.slice.call(card.querySelectorAll('div'))
      .filter(function(d){ return (d.style.background||'').replace(/\\s/g,'') === 'rgba(255,255,255,0.28)'; }).length : 0;
    return {
      svg: true,
      viewBox: svg.getAttribute('viewBox'),
      plotH: plot.offsetHeight,
      stroke: line.getAttribute('stroke'),
      fill: (svg.querySelector('path[fill]')||{getAttribute:function(){return null;}}).getAttribute('fill'),
      ticks: ticks, grid: grid, zero: zero,
      subline: /Flat 1u per match at closing odds/.test(txt),
      totalCaption: /Profit at 1u flat/i.test(txt),
      footer: /the bright rule is break even/i.test(txt)
    };
  })()`);
  if (!chart || !chart.svg) {
    ok(`${key} E · cumulative chart renders`, false, 'no chart svg found');
  } else {
    ok(`${key} E1 · viewBox 0 0 1000 300`, chart.viewBox === '0 0 1000 300', chart.viewBox);
    ok(`${key} E2 · plot is 300px tall (measured, not specified)`, chart.plotH === 300, chart.plotH + 'px');
    ok(`${key} E3 · line #5b9bff on rgba(91,155,255,0.13)`,
      chart.stroke === '#5b9bff' && chart.fill === 'rgba(91,155,255,0.13)',
      chart.stroke + ' / ' + chart.fill);
    ok(`${key} E4 · gridline ladder + one break-even rule`, chart.grid >= 3 && chart.zero === 1,
      chart.grid + ' gridlines, ' + chart.zero + ' zero rule');
    ok(`${key} E5 · a tick per season`, chart.ticks >= 3, chart.ticks + ' season ticks');
    ok(`${key} E6 · sub-line, total caption and footer`,
      chart.subline && chart.totalCaption && chart.footer,
      `subline ${chart.subline} · total ${chart.totalCaption} · footer ${chart.footer}`);
  }
}

ok('F · zero JS errors', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | ') || 'clean');

console.log('');
let fail = 0;
checks.forEach((c) => {
  if (!c.pass) fail += 1;
  console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}  ${c.detail ? '— ' + c.detail : ''}`);
});
console.log(`\n${checks.length - fail}/${checks.length} pass, ${fail} fail`);

ws.close(); chrome.kill();
process.exit(fail ? 1 : 0);
