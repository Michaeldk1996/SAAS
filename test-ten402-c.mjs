// TEN-402 (step 8 · Head to Head), builder c — Record against each style · Tournament record · Market edge, as rebuilt on
// the design handoff (design_handoff_head_to_head, reference/Head to Head.dc.html; founder 2026-11-16 "pixel for pixel").
// Each test is a ruling someone can apply: the page's own renderers are EXECUTED (tools/h2h-test-harness.js runs the
// shipped window.H2HPage module and slices every page helper it reaches) against the real MarketEdgeCore and the real
// Database join, so a regression in the shipped code (not a copy of the rule) turns this red. Mutants:
// tools/test-ten402-fix-mutants.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const html = readFileSync(process.env.TEN402_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const core = require(join(HERE, 'market-edge-core.js'));
const HX = require(join(HERE, 'tools/h2h-test-harness.js'));
// the profile's band names (player-profile-v2.js MK_BANDS) — the page reads them through PlayerProfileV2._internals
const PPV2 = readFileSync(join(HERE, 'player-profile-v2.js'), 'utf8');
const MK_BANDS = new Function('return ' + /var MK_BANDS = (\[[\s\S]*?\]\]);/.exec(PPV2)[1])();

function sliceFrom(src, start) {
  let d = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) break; }
  return src.slice(start, i + 1);
}
function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  return sliceFrom(html, start);
}
const H0 = html.indexOf('HEAD-TO-HEAD PAGE');
const h2h = sliceFrom(html, html.indexOf('(function () {', H0));
const text = h => String(h).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const DB_BASE = JSON.parse(readFileSync(join(HERE, 'database-yield.json'), 'utf8'));
const DB_NAMES = JSON.parse(readFileSync(join(HERE, 'database-yield-players.json'), 'utf8'));

// One harness per test (the module memoises joins per player): db = the Database join rows (null = not answered yet).
function page(o) {
  const opt = o || {};
  const h = HX.load({ html, globals: Object.assign({ _careerHistoryShards: opt.careers || {}, PlayerProfileV2: { _internals: Object.assign({ MK_BANDS }, opt.ppv2 || {}) } }, opt.globals || {}) });
  if (opt.db !== undefined) { h.sb._sfDbJoinSt = opt.db ? 'ready' : 'loading'; h.sb._sfDbJoin = opt.db || null; h.sb._sfDbJoinP = opt.db ? null : new Promise(() => {}); }
  return h;
}
const DB = (() => { const h = page(); return h.call(() => h.run('dbPriceJoinRows'))(DB_BASE, DB_NAMES); })();
const DB_ONLY = { rows: DB_BASE.rows, names: DB_NAMES.names, meta: DB_BASE.meta };   // the Database page's rows alone (control)

// The design's values (reference/Head to Head.dc.html, read through the page's --h2h-* tokens).
const SEC = 'background:var(--h2h-card); border:1.25px solid color-mix(in srgb, var(--h2h-white) 6%, transparent); border-radius:14px; padding:24px 26px;';
const LEDGER_COLS = '52px minmax(0,1fr) 34px minmax(0,1.1fr) 56px 44px 44px 8px';   // DF career + tournament rows
const BAND_COLS = 'minmax(0,1.1fr) 46px minmax(0,1fr) 54px 60px 8px';              // DF price-band rows
const BLUE = 'var(--h2h-blue)', WHITE = 'var(--h2h-text)';
const re = s => s.replace(/[()]/g, '\\$&');
// rows of one ledger (career / tournament): the cells' text
const ledgerRows = h => [...h.matchAll(new RegExp(`<div class="seg x-row"[^>]*grid-template-columns:${re(LEDGER_COLS)};[^>]*>([\\s\\S]*?)<\\/div>`, 'g'))].map(m => text(m[1]));
const ringOf = h => [...h.matchAll(/class="x-av"[^>]*box-shadow:0 0 0 ([\d.]+)px ([^;]+);/g)].map(m => m[2]);

// ---- a synthetic player: rows in the profile's ruling-B shape, priced, dated inside the last 52 weeks ----
const today = new Date(); const day0 = Math.floor(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) / 86400000);
const iso = d => new Date(d * 86400000).toISOString().slice(0, 10);
function rowsOf(list) {
  const rows = list.map(([ago, price, won], i) => ({ mid: 'r' + i, date: iso(day0 - ago), day: day0 - ago, won, price, oppPrice: 2.5, book: 'P', src: 'td', wo: false, round: 'R32' }));
  rows.win = rows;
  return rows;
}
let _k = 0;
function playerWith(rows, short) { const s = short || 'A. Player'; return { key: 'k' + (++_k), short: s, full: s, mono: 'AP', _cSt: { state: 'ready', me: 'ready', rows } }; }
const marketOf = (h, A, B, S) => { const m = h.call(h.marketVals, A, B, S || {}); return { m, html: h.call(h.marketCard, { market: m, a: A, b: B }) }; };
// one band row = from its opening tag to the next band row / group label / card end
const bandRows = h => h.split(/(?=<div class="(?:seg x-row)?"[^>]*grid-template-columns:minmax\(0,1\.1fr\) 46px)/).slice(1).map(s => s.slice(0, s.indexOf('</div>') + 6));

// ════════════════════════════════════════ page structure ════════════════════════════════════════
test('page order (README "Page structure"): Model → Playing style → Head to head record → Record against each style → Tournament → Market edge → News; the old stat / hold-break cards are gone', () => {
  const body = sliceFrom(h2h, h2h.indexOf('function bodyHTML('));
  const at = s => body.indexOf(s);
  const order = ['modelCard(v)', 'dnaCard(v)', 'h2hCard(v)', 'stylesCard(v)', 'tourneyCard(v)', 'marketCard(v)', 'newsCard(v)'];
  order.forEach(s => assert.ok(at(s) > 0, s));
  for (let i = 1; i < order.length; i++) assert.ok(at(order[i - 1]) < at(order[i]), order[i - 1] + ' before ' + order[i]);
  assert.ok(!/H2H_SHOW_STAT_CARDS|function holdbreakCard\(|function statCard\(/.test(h2h), 'the retired stat cards and their flag are deleted');
});

test('surfaces: every section is the design card (--h2h-card #0E1019, 1.25px 6% white edge, radius 14, padding 24/26); tokens hold the design hexes', () => {
  const h = page({ db: DB });
  assert.equal(h.consts.X_SEC, SEC + ' display:flex; flex-direction:column;');
  const A = playerWith(rowsOf([[20, 1.10, true]])), B = playerWith(rowsOf([[20, 2.2, false]]));
  assert.ok(marketOf(h, A, B).html.startsWith(`<div id="h2h-market" class="x-sec" style="${SEC}`), 'Market edge');
  assert.ok(h.call(h.stylesCard, styleView([], [])).startsWith(`<div id="h2h-styles" class="x-sec" style="${SEC}`), 'Record against each style');
  assert.ok(h.call(h.tourneyCard, { tourney: { empty: true, emptyText: 'x' } }).startsWith(`<div id="h2h-tour" class="x-sec" style="${SEC}`), 'Tournament record');
  const tok = readFileSync(join(HERE, 'tokens.css'), 'utf8');
  for (const [k, v] of [['--h2h-card', '#0E1019'], ['--h2h-inner', '#0C0E16'], ['--h2h-raised', '#131623'], ['--h2h-blue', '#5B9BFF'], ['--h2h-text', '#E7E9EE'], ['--h2h-grey', '#8B96B5'], ['--h2h-soft', '#C6CCDB']])
    assert.match(tok, new RegExp(`${k}:\\s*${v};`, 'i'), k);
});

// ════════════════════════════════════════ Market edge ════════════════════════════════════════
test('Market edge = the Match analysis maths: the site\'s ten MarketEdgeCore.BANDS, named as the profile names them; Needs = n / Σ price; Won and Edge dash under 5', () => {
  const h = page();
  const A = playerWith(rowsOf([[20, 1.10, true], [21, 1.10, true], [22, 1.18, false], [23, 2.2, true]]), 'A. One');
  const F = playerWith(rowsOf(Array.from({ length: 12 }, (_, i) => [10 + i, 1.5, i < 8])), 'F. Full');
  const { m, html: card } = marketOf(h, A, F, { mScope: 'l52' });
  assert.equal(core.BANDS.length, 10);
  assert.equal(m.MM[0].bands.length, core.BANDS.length, 'ten bands');
  const rowsA = bandRows(card.slice(0, card.indexOf('F. Full')));
  assert.equal(rowsA.length, 10, 'one row per band, every band drawn');
  assert.deepEqual(rowsA.map(r => /font-size:13px; font-weight:600;[^>]*>([^<]+)</.exec(r)[1]), MK_BANDS.map(b => b[2]), 'the profile\'s band names, in order');
  assert.match(text(rowsA[0]), /^Heavy favourite 1\.01–1\.20 · 2–1 — — /, 'n = 3: Won and Edge "—"');
  const M = core.playerModel(F._cSt.rows, { scope: 'l52', refDay: day0, winnerRows: F._cSt.rows.win });
  const fb = M.bands[core.bandOf(1.5)];
  const rowF = text(bandRows(card.slice(card.indexOf('F. Full')))[core.bandOf(1.5)]);
  const edge = Math.round((fb.won - fb.needs) * 100);
  assert.match(rowF, new RegExp(`^Favourite 1\\.36–1\\.50 · 8–4 ${Math.round(fb.won * 100)}% ${edge > 0 ? '\\+' : edge < 0 ? '−' : ''}${Math.abs(edge)}pp 0\\.0%`));
  assert.equal(Math.round(fb.needs * 1000), Math.round(12 / (12 * 1.5) * 1000), 'Needs = n / Σ price');
  assert.match(card, /12 priced matches/);
  // half-open bands in thousandths, 2.00 underdog
  assert.deepEqual([1.205, 1.21, 1.99, 2.00, 5.99, 6.0, 21].map(p => core.BANDS[core.bandOf(p)].gk + core.bandOf(p)), ['fav0', 'fav1', 'fav4', 'dog5', 'dog8', 'dog9', 'dog9']);
});

// PRODUCT BUG (reported, not fixed here): the band row prints its Return (units) at n < 5 while Won and Edge dash; the
// ruling (modal-market-edge.md, TEN-380 review item 6; this page's own pre-rebuild test) is that Won, Edge and the 1u
// stake dash TOGETHER under n = 5. A todo so it is reported on every run, never silently passed.
test('Market edge gate: under 5 matches the band\'s Return dashes with Won and Edge (never a stake beside two dashes)', () => {
  const h = page();
  const A = playerWith(rowsOf([[20, 1.10, true], [21, 1.10, true], [22, 1.18, false]]));
  assert.match(text(bandRows(marketOf(h, A, A).html)[0]), /^Heavy favourite 1\.01–1\.20 · 2–1 — — —/);
});

test('Market edge: 5–9 greyed (small sample), 10+ in the signed colour; A ring blue, B ring white; Total return = the sum of the priced matches', () => {
  const h = page();
  const S = playerWith(rowsOf(Array.from({ length: 7 }, (_, i) => [10 + i, 1.5, i < 6])), 'S. Small');
  const L = playerWith(rowsOf(Array.from({ length: 12 }, (_, i) => [10 + i, 1.5, i < 11])), 'L. Large');
  const card = marketOf(h, S, L).html;
  const sRow = bandRows(card.slice(0, card.indexOf('L. Large')))[core.bandOf(1.5)], lRow = bandRows(card.slice(card.indexOf('L. Large')))[core.bandOf(1.5)];
  assert.match(sRow, /title="Small sample · n=7"/);
  assert.match(sRow, /font-size:12\.5px; font-weight:700; text-align:right; color:var\(--h2h-grey\);">\+\d+pp</, '5–9: the edge greyed');
  assert.match(lRow, /font-size:12\.5px; font-weight:700; text-align:right; color:var\(--h2h-up\);">\+\d+pp</, '10+: a positive edge in --h2h-up');
  assert.deepEqual(ringOf(card).slice(0, 2), [BLUE, WHITE], 'player one blue, player two white');
  const M = core.playerModel(L._cSt.rows, { scope: 'l52', refDay: day0, winnerRows: L._cSt.rows.win });
  const u = M.priced.reduce((s2, r) => s2 + core.plCents(r), 0) / 100;
  assert.match(text(card.slice(card.indexOf('L. Large'))), new RegExp(`^L\\. Large 12 priced matches \\+${u.toFixed(1)}% Total return`), 'every return in % (CHANGES 2026-11-17 §4)');
});

test('Market edge windows: Last 52 weeks (default) · Last 24 months (the same day two years back) · Career, on the one large switch, in the head AND on the chart card (CHANGES 2026-11-17 §4–5)', () => {
  const h = page();
  const A = playerWith(rowsOf([[20, 1.10, true], [500, 1.10, true], [800, 1.10, false], [900, 1.10, true]]));
  const n = S => h.call(h.marketVals, A, A, S).MM[0].priced.length;
  assert.equal(n({}), 1, 'default = Last 52 weeks');
  assert.equal(n({ mScope: 'm24' }), 2, 'Last 24 months: 20 and 500 days back, not 800');
  assert.equal(n({ mScope: 'career' }), 4);
  const card = marketOf(h, A, A, { mScope: 'm24' }).html;
  const sws = [...card.matchAll(/<div class="x-sw x-sw--lg" style="display:inline-flex; gap:3px; background:var\(--h2h-inner\); border:1px solid color-mix\(in srgb, var\(--h2h-white\) 8%, transparent\); border-radius:10px; padding:3px;">([\s\S]*?)<\/div>/g)];
  assert.equal(sws.length, 2, 'the large switch (lg) in the head and again on the chart card');
  for (const sw of sws) {
    assert.deepEqual([...sw[1].matchAll(/>([^<]+)<\/span>/g)].map(x => x[1]), ['Last 52 weeks', 'Last 24 months', 'Career']);
    assert.match(sw[1], /class="seg x-sw__o on"[^>]*padding:6px 14px; border-radius:7px; font-size:13px; font-weight:700; color:var\(--h2h-text\); background:var\(--h2h-raised\); box-shadow:inset 0 0 0 1px color-mix\(in srgb, var\(--h2h-white\) 16%, transparent\);[^>]*>Last 24 months</);
  }
  // both switches write the same state (meScope): the n-th tab of each carries the same handler
  assert.deepEqual([...sws[0][1].matchAll(/data-hid="(\d+)"/g)].map(x => x[1]), [...sws[1][1].matchAll(/data-hid="(\d+)"/g)].map(x => x[1]));
  assert.doesNotMatch(text(card), /Price sensitivity/, 'the sub-head is gone');
  assert.match(text(card), /^Market edge Last 24 months · closing prices/);
});

test('Return chart: each line spans that player\'s own matches (cChartModel), A blue / B white 2px, break even the 60% rule, dotted horizontal guides; a band click filters both lines', () => {
  const h = page();
  const A = playerWith(rowsOf([[300, 1.6, true], [200, 1.6, false], [20, 1.6, true]]), 'A. One');
  const B = playerWith(rowsOf(Array.from({ length: 10 }, (_, i) => [330 - i * 33, 2.4, i % 2 === 0])), 'B. Two');
  const { m, html: card } = marketOf(h, A, B, { mScope: 'career' });
  const C = m.chart;
  assert.deepEqual(C.a.pts.map(p => Math.round(p[0])), [0, 333, 667, 1000], 'A: break even + 3 matches across the full plot');
  assert.equal(C.b.pts.length, 11); assert.equal(C.dateOf, 1, 'the dates follow the longer series');
  const ref = core.chartModel(m.ser[0], m.ser[1], 'career');
  assert.deepEqual([C.lo, C.hi, C.zeroY], [ref.lo, ref.hi, ref.zeroY], 'y = MarketEdgeCore.chartModel\'s own range');
  assert.match(card, new RegExp(`<path data-h2h-series="a" d="[^"]+" fill="none" stroke="${re(BLUE)}" stroke-width="2"`));
  assert.match(card, new RegExp(`<path data-h2h-series="b" d="[^"]+" fill="none" stroke="${re(WHITE)}" stroke-width="2"`));
  assert.match(card, /stroke="color-mix\(in srgb, var\(--h2h-white\) 60%, transparent\)" stroke-width="1\.5"/, 'break even');
  const guides = [...card.matchAll(/<line [^>]*stroke-dasharray="2 6"[^>]*>/g)].map(x => x[0]);
  assert.ok(guides.length >= 2, 'dotted guides');
  guides.forEach(l => { assert.equal(/y1="([^"]+)"/.exec(l)[1], /y2="([^"]+)"/.exec(l)[1], 'horizontal'); assert.match(l, /stroke="color-mix\(in srgb, var\(--h2h-white\) 12%, transparent\)"/); });
  assert.match(text(card.slice(card.indexOf('Return at a flat'))), /Break even/);
  assert.match(card, /each line spans that player&#39;s own matches \(the dates follow B\. Two’s\)/);
  // a band click filters both series to that band; the chip names it and "All bands" clears it
  const X = playerWith(rowsOf([[20, 1.10, true], [30, 1.10, true], [40, 3.0, false], [50, 3.0, true]]));
  const all = h.call(h.marketVals, X, X, {}), one = h.call(h.marketVals, X, X, { mBand: core.bandOf(3.0) });
  assert.equal(all.ser[0].length, 5); assert.equal(one.ser[0].length, 3); assert.equal(one.ser[0][2].c, 100);
  assert.match(text(h.call(h.marketCard, { market: one, a: X, b: X })), /Priced 3\.00–3\.99 All bands/);
});

// ════════════════════════════════════════ Record against each style ════════════════════════════════════════
const SIN = { key: '2072', full: 'J. Sinner', short: 'J. Sinner', mono: 'JS' }, ALC = { key: '2382', full: 'C. Alcaraz', short: 'C. Alcaraz', mono: 'CA' };
function styleView(rowsA, rowsB, o) {
  const opt = o || {};
  return { a: opt.a || SIN, b: opt.b || ALC, styles: { sides: [
    { p: opt.a || SIN, R: Object.assign({ state: 'ready', oppLab: opt.labA || 'All Court Elite', avg: opt.avgA == null ? 50 : opt.avgA, rows: rowsA }, opt.RA || {}) },
    { p: opt.b || ALC, R: Object.assign({ state: 'ready', oppLab: opt.labB || 'Big Server', avg: opt.avgB == null ? 55 : opt.avgB, rows: rowsB }, opt.RB || {}) }],
    arch: opt.arch || ['All Court Elite', 'All Court Elite'] } };
}
const recRow = (ago, won, extra) => Object.assign({ won, opponent: 'Player ' + ago, surface: 'hard', tournament: 'Basel', result: won ? '6-4 6-4' : '4-6 4-6', date: iso(day0 - ago), round: 'R32' }, extra || {});
// the three figures (Record · Win rate · Vs style average) of each player's record card
const styleCards = h => [...h.matchAll(/<div style="display:grid; grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\) minmax\(0,1\.35fr\);[\s\S]*?(?=<div style="display:flex; flex-direction:column; gap:9px;">)/g)].map(x => text(x[0]));

test('founder ruling 2 (2026-11-16): Record against each style opens on Career; Window = Last 52 weeks (364 days) · Last 24 months · Career', () => {
  const h = page({ db: DB });
  assert.equal(h.state.psRecWin, 'career', 'the page state opens on Career');
  const rows = [recRow(20, true), recRow(200, true), recRow(500, false), recRow(1000, true), recRow(1500, true)];
  const card = h.call(h.stylesCard, styleView(rows, []));
  assert.match(text(card), /^Record against each style Career · all surfaces · all court speeds/);
  assert.match(styleCards(card)[0], /^Record 4–1 /, 'Career = every row');
  h.state.psRecWin = 'w52';
  assert.match(styleCards(h.call(h.stylesCard, styleView(rows, [])))[0], /^Record 2–0 /, 'Last 52 weeks = 364 days');
  h.state.psRecWin = 'm24';
  assert.match(styleCards(h.call(h.stylesCard, styleView(rows, [])))[0], /^Record 2–1 /, 'Last 24 months = the same day two years back');
});

test('Record vs style: under 5 no rate, 5–9 grey "small sample", 10+ white; Vs style average = win % − the matrix cell, signed (its sign colour at 5–9 too, founder 2026-11-17), a bar from the centre', () => {
  const h = page({ db: DB });
  const four = [recRow(10, true), recRow(11, true), recRow(12, true), recRow(13, false)];
  assert.equal(styleCards(h.call(h.stylesCard, styleView(four, [])))[0], 'Record 3–1 Win rate — Vs style average —', 'n 4: record only');
  const seven = four.concat([recRow(14, true), recRow(15, true), recRow(16, false)]);
  const c7 = h.call(h.stylesCard, styleView(seven, [], { avgA: 50 }));
  assert.equal(styleCards(c7)[0], 'Record 5–2 Win rate 71% Vs style average +21 pts');
  assert.match(c7, /title="Small sample · n=7"/);
  assert.match(c7, /font-size:20px; font-weight:700; line-height:1; color:var\(--h2h-grey\);">71%</, '5–9 greyed');
  assert.match(c7, /color:var\(--h2h-up\);">\+21 pts</, 'founder 2026-11-17: the gap keeps its sign colour at n 5–9 (only the win rate greys)');
  const twelve = Array.from({ length: 12 }, (_, i) => recRow(10 + i, i < 9));
  const c12 = h.call(h.stylesCard, styleView(twelve, [], { avgA: 50 }));
  assert.equal(styleCards(c12)[0], 'Record 9–3 Win rate 75% Vs style average +25 pts');
  assert.match(c12, /font-size:20px; font-weight:700; line-height:1;">75%</, '10+: the card\'s white');
  assert.match(c12, /color:var\(--h2h-up\);">\+25 pts</);
  // the bar: from the centre tick, width = |gap| / 40 × 46%, capped at 46%
  assert.match(c12, /top:4px; height:6px; border-radius:2px; background:var\(--h2h-up\); left:50\.0%; width:28\.8%;/);
  const lose = h.call(h.stylesCard, styleView(Array.from({ length: 12 }, (_, i) => recRow(10 + i, i < 2)), [], { avgA: 60 }));
  assert.match(lose, /background:var\(--h2h-down\); left:4\.0%; width:46\.0%;/, '−43 pts: capped at 46%, toward the left');
  assert.match(text(c12), /All Court Elites win 50% against All Court Elites on tour/);
});

test('Record vs style filters: Window by the row date, Surface by the row surface, Court speed by the profile\'s one speed rule; a row with no speed rating leaves a picked speed and is counted', () => {
  const ppv2 = { speedRowOf: r => r, speedBandForRow: r => (r.event === 'Basel' ? { key: 'fast', label: 'Fast' } : r.event === 'Rome' ? { key: 'slow', label: 'Slow' } : null) };
  const h = page({ db: DB, ppv2 });
  const rows = [recRow(20, true), recRow(30, true, { surface: 'clay', tournament: 'Rome' }), recRow(400, false), recRow(40, true, { tournament: 'Nowhere' })];
  const st = S => { Object.assign(h.state, S); return /^Record (\S+)/.exec(styleCards(h.call(h.stylesCard, styleView(rows, [])))[0])[1]; };
  assert.equal(st({ psRecWin: 'career', psRecSurf: 'all', psSpeed: 'all' }), '3–1');
  assert.equal(st({ psRecWin: 'w52' }), '3–0', 'Last 52 weeks drops the 400-day row');
  assert.equal(st({ psRecWin: 'career', psRecSurf: 'clay' }), '1–0');
  assert.equal(st({ psRecSurf: 'all', psSpeed: 'fast' }), '1–1', 'Basel only');
  const c = h.call(h.stylesCard, styleView(rows, []));
  assert.match(c, /title="1 with no court-speed rating left out"/, 'Nowhere has no speed rating');
  assert.match(text(c), /Career · all surfaces · fast courts/);
});

// The style-meeting rows are a SYNTHETIC fixture in the shard's shape (the committed style-meetings/*.json is rewritten
// daily by the Styles bot): frozen copies of Sinner's 2025 finals v Alcaraz as the shard carried them (edition-start
// dates, the shard's own oddsSelf / oddsOpp = the defect's input); the Database rows are the committed database-yield.json.
const STYLE_ROWS = () => [
  { won: true, opponent: 'Carlos Alcaraz', surface: 'hard', tournament: 'ATP Finals', result: '7-6(4) 7-5', date: '2025-11-10', round: 'F', oddsSelf: 1.5, oddsOpp: 2.8 },
  { won: false, opponent: 'Carlos Alcaraz', surface: 'hard', tournament: 'US Open', result: '2-6 6-3 1-6 4-6', date: '2025-08-24', round: 'F', oddsSelf: 1.53, oddsOpp: 2.71 },
  { won: false, opponent: 'Carlos Alcaraz', surface: 'hard', tournament: 'Cincinnati Masters', result: '0-5 RET', date: '2025-08-07', round: 'F', oddsSelf: 1.53, oddsOpp: 2.71 },
  { won: true, opponent: 'Carlos Alcaraz', surface: 'grass', tournament: 'Wimbledon', result: '4-6 6-4 6-4 6-4', date: '2025-06-30', round: 'F', oddsSelf: 1.85, oddsOpp: 2.07 },
  { won: false, opponent: 'Carlos Alcaraz', surface: 'clay', tournament: 'Roland Garros', result: '6-4 7-6(4) 4-6 6-7(3) 6-7(2)', date: '2025-05-26', round: 'F', oddsSelf: 1.63, oddsOpp: 2.43 },
  { won: false, opponent: 'Carlos Alcaraz', surface: 'clay', tournament: 'Rome Masters', result: '6-7(5) 1-6', date: '2025-05-05', round: 'F', oddsSelf: 1.63, oddsOpp: 2.43 }];
const styleLedger = (h, rows, p) => { h.state.styleAAll = true; return ledgerRows(h.call(h.stylesCard, styleView(rows, [], { a: p || SIN }))); };
test('fix 2: the career-match ledger prices Sinner\'s meetings from the Database — US Open 2025 F 1.81 / 2.12, Roland Garros 2025 F 1.88 / 2.03 (synthetic shard rows)', () => {
  const led = styleLedger(page({ db: DB }), STYLE_ROWS());
  const at = (d, sc) => led.find(t => t.startsWith(d) && t.includes(sc));
  assert.match(at('24.08.', '2-6, 6-3, 1-6, 4-6'), /F 2-6, 6-3, 1-6, 4-6 1–3 1\.81 2\.12 ›$/, 'US Open 2025 F = the archive, not the shard\'s 1.53 / 2.71');
  assert.match(at('26.05.', '6-7(2)'), / 1\.88 2\.03 ›$/, 'Roland Garros 2025 F = the archive, not Rome\'s 1.63 / 2.43');
  assert.match(at('05.05.', '6-7(5), 1-6'), / 1\.63 2\.43 ›$/, 'Rome 2025 F keeps its own price');
  assert.match(at('07.08.', '0–5'), /0–5 ret\. — 1\.53 2\.71 ›$/, 'Cincinnati 2025 F: the retirement priced on the join, sets "—", "0–5 ret." (en dash)');
  assert.match(styleLedger(page({ db: DB_ONLY }), STYLE_ROWS()).find(t => t.startsWith('07.08.')), / — — ›$/, 'control: the Database rows alone void it → dash');
  const led0 = styleLedger(page({ db: null }), STYLE_ROWS());
  assert.equal(led0.length, 6);
  assert.ok(led0.every(t => / — — ›$/.test(t)), 'no Database yet → dashes, never the shard\'s prices');
  // Sets = "pS–oS" (en dash, no spaces); the score is never cut (wraps between sets)
  assert.ok(led.filter(t => !/ret\./.test(t)).every(t => / \d–\d /.test(t)) && !led.some(t => /\d - \d/.test(t)));
  const h = page({ db: DB }); h.state.styleAAll = true;
  const c = h.call(h.stylesCard, styleView(STYLE_ROWS(), []));
  const scores = [...c.matchAll(/<span title="[^"]*" style="font-family:'IBM Plex Mono',monospace; font-size:11\.5px; color:var\(--h2h-soft\);([^"]*)">/g)].map(x => x[1]);
  assert.equal(scores.length, 6); scores.forEach(s => { assert.match(s, /white-space:normal;/); assert.doesNotMatch(s, /ellipsis|overflow:hidden|nowrap/); });
});
test('review 2 (c): the career-match ledger joins through the career-history date — Djokovic v Vacherot, Shanghai 2025 SF (shard 24.09) = 1.14 / 6.68', () => {
  const rows = () => [{ won: false, opponent: 'Valentin Vacherot', surface: 'hard', tournament: 'Shanghai Masters', result: '3-6 4-6', date: '2025-09-24', round: 'Semi-finals' }];
  const DJ = { key: '1905', full: 'N. Djokovic', short: 'N. Djokovic', mono: 'ND' };
  const career = { 1905: [{ date: '2025-10-11', tournament: 'Shanghai', round: 'Semi-finals', opponent: 'V. Vacherot', won: false, eventKey: 12160001, level: 'atp' }] };
  assert.match(styleLedger(page({ db: DB, careers: career }), rows(), DJ)[0], / 1\.14 6\.68 ›$/);
  assert.match(styleLedger(page({ db: DB, careers: {} }), rows(), DJ)[0], / — — ›$/, 'control: no career store → 17 days past the window, a dash');
});
const LAJ_DB = { meta: { rounds: ['Quarterfinals'] }, rows: [[20230217, 0, 1, 0, 0, 1.17, 6.20, 1, 0], [20230224, 0, 1, 0, 0, 1.15, 6.61, 1, 0]],
  names: [['Alcaraz C.', 'Lajovic D.'], ['Alcaraz C.', 'Lajovic D.']] };
const LAJ_ROWS = () => [{ won: true, opponent: 'Dusan Lajovic', surface: 'clay', tournament: 'Rio De Janeiro', result: '6-4 6-4', date: '2023-02-20', round: 'Quarter-finals' },
  { won: true, opponent: 'Dusan Lajovic', surface: 'clay', tournament: 'Buenos Aires', result: '6-4 6-2', date: '2023-02-13', round: 'Quarter-finals' }];
const LAJ_CAREER = { 2382: [{ date: '2023-02-18', tournament: 'Buenos Aires', round: 'Quarter-finals', opponent: 'D. Lajovic', won: true, eventKey: 1, level: 'atp' },
  { date: '2023-02-24', tournament: 'Rio de Janeiro', round: 'Quarter-finals', opponent: 'D. Lajovic', won: true, eventKey: 2, level: 'atp' }] };
test('review 3: a start-dated style row takes its own week, never the week before — Alcaraz v Lajovic, Rio 2023 = 1.15 / 6.61, Buenos Aires = 1.17 / 6.20', () => {
  const led = styleLedger(page({ db: LAJ_DB, careers: LAJ_CAREER }), LAJ_ROWS(), ALC);
  assert.match(led.find(t => t.startsWith('20.02.')), / 1\.15 6\.61 ›$/, 'Rio');
  assert.match(led.find(t => t.startsWith('13.02.')), / 1\.17 6\.20 ›$/, 'Buenos Aires');
});
test("review 3: the archive's \"O Connell C.\" joins our C. O'Connell (Sinner, Miami 2024 R16 = 1.06 / 13.39)", () => {
  const db = { meta: { rounds: ['Quarterfinals'] }, rows: [[20240326, 0, 0, 0, 0, 1.06, 13.39, 1, 0]], names: [['Sinner J.', 'O Connell C.']] };
  const career = { 2072: [{ date: '2024-03-26', tournament: 'Miami', round: 'Quarter-finals', opponent: "C. O'Connell", won: true, eventKey: 3, level: 'atp' }] };
  const rows = () => [{ won: true, opponent: "Christopher O'Connell", surface: 'hard', tournament: 'Miami Masters', result: '6-4 6-3', date: '2024-03-20', round: 'Quarter-finals' }];
  assert.match(styleLedger(page({ db, careers: career }), rows())[0], / 1\.06 13\.39 ›$/);
});
test('career-match card: the design\'s grid, six rows then "Show N more matches", grouped by the event\'s ONE name, A ring blue / B ring white', () => {
  const h = page({ db: DB });
  const rows = Array.from({ length: 8 }, (_, i) => recRow(10 + i * 3, i % 2 === 0, { tournament: i < 4 ? 'Shanghai' : 'ATP Finals' }));
  const c = h.call(h.stylesCard, styleView(rows, []));
  assert.equal(ledgerRows(c).length, 6, 'six rows');
  assert.match(text(c), /Showing 6 of 8/);
  assert.match(text(c), /Show 2 more matches/);
  assert.match(c, new RegExp(`grid-template-columns:${re(LEDGER_COLS)}; gap:0 10px; align-items:center; padding:8px 18px; background:var\\(--h2h-layer\\);`), 'the column head on the design grid, a layer strip (CHANGES 2026-11-17 §1)');
  // the price column head: the player's 20px mini avatar, no ring (CHANGES 2026-11-17 §2)
  assert.match(c, /<span style="justify-self:end;"><span class="x-av mini" title="J\. Sinner’s closing price" style="[^"]*width:20px; height:20px; border-radius:50%; background:var\(--h2h-raised\); overflow:hidden;">/);
  assert.match(text(c), /Shanghai Masters Hard · Masters 1000/, 'the group header prints the one event name (sfEventName)');
  assert.ok(!/>Shanghai</.test(c), 'never the raw key');
  assert.deepEqual(ringOf(c).slice(0, 2), [BLUE, WHITE], 'card A ring blue, card B ring white');
});

// ════════════════════════════════════════ Tournament record ════════════════════════════════════════
test('Tournament: the record is the profile\'s per-event model (trProfileModel shared with trProfileBacking), priced on the Database join', () => {
  const pm = slice('trProfileModel'), pb = slice('trProfileBacking'), px = slice('trDbJoinPx');
  assert.match(pm, /const P = trModelOf\(hist, \{ ch, cl: null, px: trDbJoinPx\(name, ch\) \}, k, name, clean, names, '', 'ready'\);/);
  assert.match(px, /const J = typeof window !== 'undefined' && window\.H2HPage && window\.H2HPage\.priceJoin;/);
  assert.match(px, /J\(js, \{ full: name \}, null, _sfDbJoin, null, ch\);/);
  assert.ok(!/_fhCl/.test(pm + pb), 'the closes shard prices nothing here');
  assert.match(html, /\n    priceJoin: h2hPriceJoin,\n/, 'the Head to Head page exports THE join');
  assert.match(pm, /y\.won = y\.matches\.filter\(x => x\.won\)\.length; y\.lost = y\.matches\.length - y\.won;/);
  assert.match(pb, /const P = trProfileModel\(k, name, t\);/);
  assert.ok(!/trModelOf\(/.test(pb), 'one join: trProfileBacking no longer builds its own');
  assert.match(h2h, /trProfileModel\(p\.key, p\.full, x\.t\)/, 'the Tournament record reads that model, per event (single or group mode)');
});
const tmk = o => Object.assign({ wo: false, ret: false, sets: [[6, 4], [6, 4], [6, 4]], pS: 3, oS: 0, src: 'td', surface: 'hard' }, o);
// one event's per-player model P (trProfileModel's shape) → the column the card draws: { p, state, agg } with agg the
// shipped xTrAgg over that one event (single mode, Career window)
const TR_FILTERS = [{ label: 'Window', items: [{ label: 'Last 52 weeks', hid: 11 }, { label: 'Last 24 months', hid: 12 }, { label: 'Career', on: true, hid: 13 }] },
  { label: 'Surface', items: [{ label: 'All', on: true, hid: 14 }, { label: 'Hard', hid: 15 }, { label: 'Clay', hid: 16 }, { label: 'Grass', hid: 17 }] },
  { label: 'Court speed', items: [{ label: 'All', on: true, hid: 18 }, { label: 'Slow', hid: 19 }, { label: 'Medium', hid: 20 }, { label: 'Fast', hid: 21 }] }];
function tourView(P, o, h) {
  const opt = o || {};
  const agg = P && h ? h.call(h.xTrAgg, [{ ev: { name: 'US Open', surface: 'Hard', speed: 'Medium' }, P }], null, false) : null;
  return { a: SIN, b: ALC, tourney: { empty: false, selName: 'US Open', query: '', listOpen: !!opt.listOpen, hSearch: 1, hOpen: 2, noMatch: false, grp: false, gLbl: 'courts', TW: 'career',
    backLabel: 'Back to US Open', hBack: 9, filters: TR_FILTERS,
    options: opt.options || [], info: { name: 'US Open', initial: 'U', location: 'New York, USA', surface: 'Hard', meta: [['Level', 'Grand Slam'], ['Draw', '128 · Bo5'], ['Dates', null], ['Court speed', 'Medium']] },
    cols: [{ p: SIN, agg, state: P ? 'ready' : 'loading' }, { p: ALC, agg: null, state: 'none' }] } };
}
const J = x => JSON.parse(JSON.stringify(x));   // a value from the vm realm, compared by content
const tiles = c => /Best result .*? bets?(?= )/.exec(text(c))[0];
test('ruling 2026-10-08: the Tournament panel draws ONE model — the ledger shows P.all\'s Database prices and Backing = a flat 1% stake over exactly those priced rows', () => {
  const f = tmk({ mid: 'm1', date: '2025-09-07', won: false, round: 'F', opp: 'C. Alcaraz', sets: [[2, 6], [6, 3], [1, 6], [4, 6]], pS: 1, oS: 3, price: 1.81, oppPrice: 2.12, book: 'P' });
  const sf = tmk({ mid: 'm2', date: '2025-09-05', won: true, round: 'SF', opp: 'F. Auger-Aliassime', price: 1.50, oppPrice: 2.60, book: 'B' });
  const qf = tmk({ mid: 'm3', date: '2025-09-03', won: true, round: 'QF', opp: 'L. Musetti', price: null, oppPrice: null, book: null, src: null });
  const r4 = tmk({ mid: 'm4', date: '2025-09-01', won: true, round: 'R16', opp: 'X. Retiree', ret: true, retSettle: true, price: 1.20, oppPrice: 4.5, book: 'P', pS: 1, oS: 0, sets: [[6, 2], [2, 1]] });
  const all = [f, sf, qf, r4], priced = all.filter(core.inWinner);
  const units = priced.reduce((t, r) => t + core.plCents(r), 0) / 100;   // −1 + 0.50 + 0.20 = −0.30
  const P = { eds: [{ year: '2025', won: 3, lost: 1, rows: all }], all, n: 4, W: 3, L: 1, best: null, sT: 9, sW: 8, played: [{ year: '2025', rows: all }], priced, units };
  const h = page({ db: null });   // no Database rows: the panel never re-joins, it shows P's prices
  const c = h.call(h.tourneyCard, tourView(P, null, h));
  const led = ledgerRows(c);
  assert.equal(led.length, 4);
  assert.match(led[0], / 1\.81 2\.12 ›$/, 'the final: the model row\'s Database price');
  assert.match(led[1], / 1\.50 2\.60 ›$/, 'the semi-final: Bet365');
  assert.match(led[2], / — — ›$/, 'a row the join lacks → dash');
  assert.match(led[3], / 1\.20 4\.50 ›$/, 'the retirement is priced');
  assert.match(tiles(c), /Backing −0\.3% flat 1% stake · 3 bets$/, 'every return in % (CHANGES 2026-11-17 §4)');
  assert.equal(led.filter(t => !/ — — ›$/.test(t)).length, 3, 'tile "3 priced" = the ledger\'s priced rows');
  assert.match(c, /color:var\(--h2h-down\); white-space:nowrap;">−0\.3%</, 'a loss in --h2h-down, true minus');
  // control: the same edition with the retirement unpriced sums the two completed rows only: −0.5% · 2 bets
  const r4u = Object.assign({}, r4, { price: null, oppPrice: null, book: null, src: null });
  const P2 = { eds: [{ year: '2025', rows: [f, sf, qf, r4u] }] };
  assert.match(tiles(h.call(h.tourneyCard, tourView(P2, null, h))), /Backing −0\.5% flat 1% stake · 2 bets$/);
  // the record head: W–L (en dash) and the rate through the gate (n 4 → the count, no %)
  assert.match(text(c), /J\. Sinner At US Open · since 2025 3–1 4 matches/);
  // the tournament rows: the design grid; Sets "pS–oS"; the score wraps, never cut
  assert.match(led[0], /2-6, 6-3, 1-6, 4-6 1–3 /);
  const sc = [...c.matchAll(/style="font-family:'IBM Plex Mono',monospace; font-size:11\.5px; color:var\(--h2h-soft\);([^"]*)">/g)].map(x => x[1]);
  assert.ok(sc.length >= 4 && sc.every(s => /white-space:normal;/.test(s) && !/ellipsis|overflow:hidden|nowrap/.test(s)), 'scores never cut');
  assert.match(text(c), /C\. Alcaraz has not played US Open\./);
});
test('Tournament tiles (xTrAgg): Best result · Sets won · Last played (the newest PLAYED row by date, never the list position) · Backing', () => {
  const r = tmk({ mid: 'x', date: '2024-09-05', won: false, round: 'SF', opp: 'T. Fritz', price: 1.4, oppPrice: 3.1, book: 'P', pS: 1, oS: 3 });
  const old = tmk({ mid: 'y', date: '2023-09-05', won: true, round: 'F', opp: 'D. Medvedev', price: 1.6, oppPrice: 2.4, book: 'P' });
  const P = { eds: [{ year: '2023', result: 'Won', rows: [old] }, { year: '2024', rows: [r] }, { year: '2026', rows: [] }] };
  const h = page({ db: null });
  assert.equal(tiles(h.call(h.tourneyCard, tourView(P, null, h))), 'Best result Won 2023 Sets won 4–3 57% of sets Last played 2024 lost SF v Fritz Backing −0.4% flat 1% stake · 2 bets');
  assert.equal(P.eds[0].year, '2023', 'control: the list position would read 2023');
});
test('Tournament default (brief 2026-11-16): an event of THIS week whose posted main draw lists both players, else the most recent event both played; never hard-coded', () => {
  const list = [{ name: 'Wimbledon', a: 10, b: 8, la: 2025, lb: 2025 }, { name: 'Basel', a: 4, b: 2, la: 2023, lb: 2024 }, { name: 'Shanghai', a: 6, b: 5, la: 2025, lb: 2024 }, { name: 'Halle', a: 3, b: 0, la: 2025, lb: null }];
  const week = both => [{ name: 'Swiss Indoors', city: 'Basel', sections: [{ title: 'Main draw', players: (both ? [{ playerKey: 2072 }, { playerKey: 2382 }] : [{ playerKey: 2072 }]) }, { title: 'Qualifying', players: [{ playerKey: 2382 }] }] }];
  const h = page({ globals: { EntryListsTab: { currentWeekRows: () => week(true) } } });
  assert.deepEqual(J(h.call(h.xTourDefault, SIN, ALC, {}, list)), { name: 'Basel', why: 'week' }, 'this week, both in the posted main draw');
  const h2 = page({ globals: { EntryListsTab: { currentWeekRows: () => week(false) } } });
  assert.deepEqual(J(h2.call(h2.xTourDefault, SIN, ALC, {}, list)), { name: 'Wimbledon', why: 'recent' }, 'one only in qualifying → the most recent event both played (2025 / 2025)');
  const h3 = page({ globals: { EntryListsTab: null } });
  assert.deepEqual(J(h3.call(h3.xTourDefault, SIN, ALC, {}, list.slice(1))), { name: 'Shanghai', why: 'recent' }, 'the later of the pair\'s last years (2024 v 2023)');
  assert.deepEqual(J(h3.call(h3.xTourDefault, SIN, ALC, {}, [list[3]])), { name: 'Halle', why: 'one' }, 'no shared event → the first listed');
});
test('Tournament picker: a search input (no <select>) on the design menu — raised, 10% edge, radius 12, max 300, the menu shadow', () => {
  const h = page({ db: null });
  const c = h.call(h.tourneyCard, tourView(null, { listOpen: true, options: [{ name: 'US Open', label: 'US Open', meta: 'Hard · Grand Slam', selected: true, hPick: 5 }, { name: 'Halle', label: 'Halle', meta: '', selected: false, hPick: 6 }] }));
  assert.match(c, /<input class="h2hin" id="h2h-input-tour"[^>]*placeholder="Search a tournament…"[^>]*style="background:var\(--h2h-inner\); border:1px solid color-mix\(in srgb, var\(--h2h-white\) 8%, transparent\); border-radius:10px;/);
  assert.match(c, /<div role="listbox" style="position:absolute; top:calc\(100% \+ 6px\); left:0; right:0; z-index:5; background:var\(--h2h-raised\); border:1px solid color-mix\(in srgb, var\(--h2h-white\) 10%, transparent\); border-radius:12px; padding:6px;[^"]*box-shadow:var\(--h2h-shadow-menu\); max-height:300px; overflow:auto;/);
  assert.match(c, /role="option" aria-selected="true"[^>]*background:var\(--h2h-card\);/);
  assert.ok(!/<select/i.test(c) && !/<select/i.test(h2h.slice(h2h.indexOf('==== H2H REBUILD'))), 'no native <select> in the rebuilt page');
});
test('Tournament levels read as the ledgers write them: the catalog\'s ATP 1000 = "Masters 1000"', () => {
  const h = page();
  assert.equal(h.cLevel({ category: 'ATP 1000' }), 'Masters 1000');
  assert.equal(h.cLevel({ category: 'Grand Slam' }), 'Grand Slam');
  assert.equal(h.cLevel({ category: 'ATP 500' }), 'ATP 500');
  assert.equal(h.cLevel(null), null);
});
test('formatting: true minus and an explicit sign on returns (in %, never u — CHANGES 2026-11-17 §4), en dash in every record', () => {
  const h = page();
  assert.equal(h.call(() => h.run("meSg(-0.4, 1, '%')")), '−0.4%');
  assert.equal(h.call(() => h.run("meSg(2, 1, '%')")), '+2.0%');
  const rebuilt = h2h.slice(h2h.indexOf('==== H2H REBUILD'));
  assert.ok(rebuilt.includes("w + '–' + l") && rebuilt.includes("A.W + '–' + A.L"));
  assert.ok(!/(?:meSg|sg)\([^)]*'u'\)/.test(rebuilt), 'no return is signed in units anywhere in the rebuilt page');
  // set scores keep the site's "6-4" (house style); no other figure is built with a hyphen-minus
  const noScores = rebuilt.replace(/q\[0\] \+ '-' \+ q\[1\]|r\.sets\[0\]\[0\] \+ '-' \+ r\.sets\[0\]\[1\]|' - '/g, '');
  assert.ok(!/'-' \+ |\+ '-'/.test(noScores), 'no hyphen-minus built into a figure');
});
