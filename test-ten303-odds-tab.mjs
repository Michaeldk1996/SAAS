// TEN-303 (founder brief 2026-09-27) — the Odds tab, EXECUTED: the data model (aOddsRowsOf, the AODDS_* config, the
// chart / tooltip helpers) sliced out of the shipped HTML and the Match analysis rebuild's renderer (match-analysis-v2.js
// oddsBuild / oddsMv, design_handoff_match_analysis_2026-11-23, Odds LOCKED 2026-11-22) run on it (tools/ma2-odds-vm.mjs).
// Rules: .claude/rules/odds.md "The Odds tab (TEN-303)"; where the locked 2026-11-22 design replaced a layout (the 4c
// bookmaker boxes, signed-percent moves, the lifted best price, no foot notes, the opened-box shell) the check reads the
// design; every data rule is unchanged.
//
// Each §6 test names the mutation it catches; tools/test-ten303-mutants.js applies every one (to the page or to
// match-analysis-v2.js) and fails if any leaves this suite green. Tests named "renderer gap: …" check a rule the rebuild
// does not meet yet: the runner reports them apart.
//
// Run: node --test test-ten303-odds-tab.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build, constSrc, slice, FNS, V2, v2OddsSrc, HTML } from './tools/ma2-odds-vm.mjs';

const H = 3600e3;
const iso = ms => new Date(ms).toISOString();

// An upcoming card 6 h out; real-shaped sources, p1/p2 in card orientation.
export function fixture({ now = Date.now(), withAt = false, superbetChecked = now - 5 * 60e3 } = {}) {
  const start = new Date(now + 6 * H);
  const pad = n => String(n).padStart(2, '0');
  const m = { id: 'upcoming-1', p1: 'J. Sinner', p2: 'C. Alcaraz',
    date: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}`,
    time: `${pad(start.getUTCHours())}:${pad(start.getUTCMinutes())}`, startTs: iso(start.getTime()) };
  const chart = { books: {}, meta: {} };
  const put = (k, meta, p1, p2) => { chart.books[k] = { p1, p2 }; chart.meta[k] = meta; };
  put('Pinnacle +30s', { source: 'Oddspapi', group: 'sharp', clock: 'book tick', checkedAt: iso(now - 4 * 60e3) },
    [[iso(now - 20 * H), 2.5], [iso(now - 2 * H), 2.35]], [[iso(now - 20 * H), 1.578], [iso(now - 2 * H), 1.657]]);
  // Kibl stores one side per row: never the same timestamp
  put('Bet105', { source: 'Kibl', group: 'sharp', clock: 'Kibl insert', checkedAt: iso(now - 3 * 60e3) },
    [[iso(now - 10 * H), 2.4], [iso(now - 3 * H), 2.3]], [[iso(now - 10 * H + 60e3), 1.62], [iso(now - 3 * H + 90e3), 1.66]]);
  put('Superbet', { source: 'odds-api.io', group: 'soft', clock: 'vendor updatedAt', checkedAt: iso(superbetChecked) },
    [[iso(now - 8 * H), 2.6]], [[iso(now - 8 * H), 1.5]]);
  put('Betfair Exchange (recorded by us)', { source: 'odds-api.io', group: 'soft', clock: 'recorded by us', checkedAt: iso(now - 60e3) },
    [[iso(now - 1 * H), 2.46]], [[iso(now - 1 * H), 1.67]]);
  if (withAt) {
    const at = (p1, p2, t = now - 5 * H) => [[[iso(t), p1]], [[iso(t), p2]]];
    const atMeta = { source: 'api-tennis', group: 'soft', clock: 'seen by us every 5 min', checkedAt: iso(now - 2 * 60e3), firstSeen: iso(now - 5 * H) };
    put('Pinnacle (api-tennis)', Object.assign({}, atMeta, { group: 'sharp' }), ...at(2.45, 1.6));
    put('Betano', atMeta, ...at(2.5, 1.55));
  }
  m.oddsMovement = { market: 'Match Winner', capturedAt: iso(now - 26 * H),
    books: { bet365: { p1: [[iso(now - 30 * H), 2.37]], p2: [[iso(now - 30 * H), 1.54]] } }, chart };
  return m;
}


// ---- the rebuilt markup: Bookmakers card = one .ma2-group box per group, a row per book, one .ma2-pbox per player ----
const unesc = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tabOf = h => { const i = h.indexOf('class="ma2-pop-ov"'); return i < 0 ? h : h.slice(0, i); };
const popOf = h => { const i = h.indexOf('class="ma2-pop-ov"'); return i < 0 ? '' : h.slice(i); };
const rowsOf = h => {
  const t = tabOf(h), out = [], gs = [...t.matchAll(/class="ma2-group" data-group="([^"]*)"/g)];
  gs.forEach((g, i) => { const seg = t.slice(g.index, i + 1 < gs.length ? gs[i + 1].index : t.length);
    for (const r of seg.matchAll(/data-bkrow="" data-book="([^"]*)" data-src="([^"]*)"/g)) out.push({ book: unesc(r[1]), group: g[1], src: unesc(r[2]) }); });
  return out;
};
const rowHtml = (h, book) => { const t = tabOf(h), i = t.indexOf(`data-bkrow="" data-book="${book}"`); if (i < 0) return '';
  const s = t.lastIndexOf('<div', i), ends = [t.indexOf('data-bkrow=""', i + 20), t.indexOf('class="ma2-group"', i), t.indexOf('class="ma2-avg"', i)].filter(x => x > 0);
  return t.slice(s, ends.length ? Math.min(...ends) : t.length); };
const boxes = row => row.split('class="ma2-pbox"').slice(1);
const side = x => (x === 'a' ? 0 : 1);
const nowTxt = (row, x) => (/class="ma2-now" style="[^"]*">([^<]*)</.exec(boxes(row)[side(x)] || '') || [])[1];
const nowCol = (row, x) => (/class="ma2-now" style="[^"]*color:([^;"]+)/.exec(boxes(row)[side(x)] || '') || [])[1];
const mvTxt = (row, x) => (/class="ma2-now"[^>]*>[^<]*<\/span><span style="[^"]*">([^<]*)</.exec(boxes(row)[side(x)] || '') || [])[1];
const mvCol = (row, x) => (/class="ma2-now"[^>]*>[^<]*<\/span><span style="[^"]*color:([^;"]+)/.exec(boxes(row)[side(x)] || '') || [])[1];
const openTxt = (row, x) => (/>Opening odd<\/span><span style="[^"]*">([^<]*)</.exec(boxes(row)[side(x)] || '') || [])[1];
const isLifted = (row, x) => /^ style="[^"]*background:var\(--ma2-lifted\)/.test(boxes(row)[side(x)] || '');
const marginTxt = row => (/class="ma2-margin"[^>]*>([^<]*)</.exec(row) || [])[1];
const tipOf = (h, book) => { const r = rowHtml(h, book); const mm = /data-aotip="([^"]*)"/.exec(r); return mm ? unesc(mm[1]) : ''; };
// pop-up player panel (side a / b) and its three tiles [label, figure, note]
const mvPanel = (h, x) => { const p = popOf(h), i = p.indexOf(`class="ma2-mvp" data-side="${x}"`), j = x === 'a' ? p.indexOf('class="ma2-mvp" data-side="b"') : p.length; return i < 0 ? '' : p.slice(i, j); };
const mvMove = (h, x) => (/<span style="[^"]*font-size:20px[^"]*">[^<]*<\/span><span style="[^"]*">([^<]*)</.exec(mvPanel(h, x)) || [])[1];
const tilesOf = s => [...s.matchAll(/<span style="font-size:11\.5px; font-weight:600; color:var\(--ma2-grey\);">([^<]*)<\/span><span style="[^"]*font-size:20px[^"]*">([^<]*)<\/span><span style="[^"]*">([^<]*)</g)].map(x => [x[1], x[2], x[3]]);
const GREEN = 'var(--ma2-green)', RED = 'var(--ma2-red)', QUIET = 'var(--ma2-quiet)';
// A test that pins its fixture to a fixed instant must pin the renderer's clock too (the page reads Date.now()).
const atClock = (now, fn) => { const real = Date.now; Date.now = () => now; try { return fn(); } finally { Date.now = real; } };

// ── §6 test 1 ─ mutants: a stale "now" kept (drop `row.stale ? null :`); the 60-min staleness rule dropped;
//    best over all books (drop `!r.stale`); STEAM counting every book ──
test('§6.1 a stale book: NOW "—", no move figure, never green, outside STEAM n and N', () => {
  const now = Date.now();
  const A = build(undefined, { AODDS_STEAM: '{ minBooks: 3, minShareOfN: 0, minMovePct: 0 }' });
  const m = fixture({ now, withAt: true, superbetChecked: now - 2 * H });   // Superbet: last check 2 h ago, the HIGHEST p1 (2.60)
  A.open(m);
  const h = A.buildOddsSection(m);
  const sb = rowHtml(h, 'Superbet');
  assert.ok(sb, 'the stale book is listed');
  for (const x of ['a', 'b']) {
    assert.equal(nowTxt(sb, x), '\u2014', `NOW ${x} is a dash`);
    assert.ok(mvTxt(sb, x) === '' || mvTxt(sb, x) === '\u2014', `MOVE ${x} carries no figure (${mvTxt(sb, x)})`);
    assert.ok(![GREEN, RED].includes(mvCol(sb, x)), 'a stale move is never signed');
    assert.ok(!isLifted(sb, x), 'a stale book is never the best price');
  }
  assert.equal(marginTxt(sb), 'No recent data', 'margin line reads "No recent data"');
  assert.ok(!/<svg/.test(sb), 'no per-row sparkline');
  assert.ok(sb.includes('onclick="aOddsOpenMv(this.dataset.book)"'), 'the row still opens the pop-up');
  // best p1 among LIVE books = 2.50 (Betano); the stale 2.60 never wins; no NOW is ever green
  assert.deepEqual(A.aOddsRowsOf(m, { nowMs: now }).rows.filter(r => r.aBest).map(r => r.name), ['Betano']);
  assert.ok(isLifted(rowHtml(h, 'Betano'), 'a'), 'Betano carries the best price box');
  assert.deepEqual(rowsOf(h).filter(r => [GREEN, RED].includes(nowCol(rowHtml(h, r.book), 'a'))), [], 'no green / red NOW');
  const D = A.aOddsRowsOf(m, { nowMs: now });
  assert.ok(!D.rows.find(r => r.name === 'Superbet').aBest);
  assert.equal(D.N, 4, 'N = the 4 live books with an open and a now (Pinnacle, Bet105, Betfair Exchange, Betano), never the stale Superbet');
  const m2 = fixture({ now, superbetChecked: now - 2 * H });
  m2.oddsMovement.chart.books['Betfair Exchange (recorded by us)'].p1.push([iso(now - 30 * 60e3), 2.2]);
  m2.oddsMovement.chart.books['Superbet'].p1.push([iso(now - 7 * H), 2.1]);         // the stale book shortened too
  const D2 = A.aOddsRowsOf(m2, { nowMs: now });
  assert.equal(D2.steam && D2.steam.text, '3 of 3 books shortened on J. Sinner', 'the stale Superbet is in neither n nor N');
  A.open(m2);
  // the locked design (2026-11-22): the STEAM chip sits on the Bookmakers card head and carries its sentence
  assert.ok(A.buildOddsSection(m2).includes('>3 of 3 books shortened on J. Sinner<'), 'the chip carries the sentence');
});

// ── §6 test 2 ─ mutants: series from the union of a book's sources; fallback taken although the primary has data ──
test('§6.2 no row mixes two sources: Pinnacle in both feeds draws only Pinnacle +30s', () => {
  const now = Date.now();
  const A = build();
  const m = fixture({ now, withAt: true });
  const D = A.aOddsRowsOf(m, { nowMs: now });
  const pin = D.rows.find(r => r.name === 'Pinnacle');
  assert.equal(pin.key, 'Pinnacle +30s (Oddspapi)');
  assert.equal(pin.alt, 'Pinnacle (api-tennis)');
  const own = new Set(m.oddsMovement.chart.books['Pinnacle +30s'].p1.concat(m.oddsMovement.chart.books['Pinnacle +30s'].p2).map(p => Date.parse(p[0])));
  assert.ok(pin.ticks.length && pin.ticks.every(t => own.has(t.t)), 'every tick of the row is a Pinnacle +30s tick');
  assert.deepEqual([pin.aOpen, pin.aNow, pin.bOpen, pin.bNow], [2.5, 2.35, 1.578, 1.657]);
  A.open(m);
  const h = A.buildOddsSection(m);
  const row = rowHtml(h, 'Pinnacle');
  assert.equal(openTxt(row, 'a'), '2.50'); assert.equal(nowTxt(row, 'a'), '2.35');
  // Move = (now − open) / open on the displayed prices, 1 dp, signed percent (the locked design: no arrows), true minus:
  // 2.50 → 2.35 = −6.0%; 1.578 → 1.657 reads 1.58 → 1.66 = +5.1% (the raw prices would give +5.0%)
  assert.equal(mvTxt(row, 'a'), '\u22126.0%');
  assert.equal(mvCol(row, 'a'), RED);
  assert.equal(mvTxt(row, 'b'), '+5.1%', 'measured on the displayed prices');
  assert.equal(mvCol(row, 'b'), GREEN);
  assert.equal(rowsOf(h).filter(r => r.book === 'Pinnacle').length, 1, 'one row per bookmaker');
  assert.ok(!/data-book="Pinnacle \(api-tennis\)"|data-book="Pinnacle \+30s/.test(h), 'no sourced row name');
  const tip = tipOf(h, 'Pinnacle');
  assert.ok(tip.includes('>Pinnacle +30s<') && tip.includes('Oddspapi \u00b7 book ticks') && tip.includes('>api-tennis \u00b7 live<'), tip);
  // no Pinnacle +30s -> the whole row is the api-tennis line
  delete m.oddsMovement.chart.books['Pinnacle +30s'];
  const p2 = A.aOddsRowsOf(m, { nowMs: now }).rows.find(r => r.name === 'Pinnacle');
  assert.equal(p2.key, 'Pinnacle (api-tennis)'); assert.equal(p2.alt, null);
  assert.deepEqual([p2.aOpen, p2.aNow], [2.45, 2.45]);
});

// ── §6 test 3 ─ mutants: no-vig = 1/p un-normalised; a missing pair reusing the last one; Kibl sides never paired ──
test('§6.3 No-vig: both players sum to 100% on every row with a matched pair; no pair = "—"', () => {
  const now = Date.now();
  const A = build();
  const m = fixture({ now, withAt: true });
  m.oddsMovement.chart.books['Betano'] = { p1: [[iso(now - 5 * H), 2.5]], p2: [] };
  A.open(m); A.state().novig = true;
  const D = A.aOddsRowsOf(m, { nowMs: now, novig: true });
  let checked = 0;
  for (const r of D.rows.filter(r => !r.noData && !r.stale)) {
    if (r.aNow == null) continue;
    assert.ok(Math.abs(1 / r.aNow + 1 / r.bNow - 1) <= 0.001, `${r.name}: ${1 / r.aNow + 1 / r.bNow}`);
    for (const k of r.nv.a.keys()) assert.ok(Math.abs(1 / r.nv.a[k][1] + 1 / r.nv.b[k][1] - 1) <= 0.001, `${r.name} tick ${k}`);
    checked++;
  }
  assert.ok(checked >= 4, `checked ${checked} rows`);
  const h = A.buildOddsSection(m);
  for (const r of rowsOf(h)) {
    const row = rowHtml(h, r.book), a = nowTxt(row, 'a'), b = nowTxt(row, 'b');
    if (a === '\u2014' || b === '\u2014') continue;
    const tol = 0.005 / (+a) ** 2 + 0.005 / (+b) ** 2 + 1e-9;   // 2-decimal display rounding
    assert.ok(Math.abs(1 / +a + 1 / +b - 1) <= tol, `${r.book} rendered ${a}/${b}`);
  }
  const betano = rowHtml(h, 'Betano');
  assert.equal(nowTxt(betano, 'a'), '\u2014', 'no matched pair -> no no-vig price');
  assert.equal(nowTxt(betano, 'b'), '\u2014');
  assert.ok(h.includes('>Margin removed<') && />Match Winner \u00b7 \d+ books? \u00b7 no-vig</.test(h), 'the card scope names the price mode');
  const b105 = D.rows.find(r => r.name === 'Bet105');
  assert.deepEqual(b105.ticks.map(t => t.pair), [false, true, true, true]);
  const Dm = A.aOddsRowsOf(m, { nowMs: now });
  assert.equal((Dm.rows.find(r => r.name === 'Pinnacle').margin * 100).toFixed(1), '2.9');
  A.state().novig = false;
  assert.ok(rowHtml(A.buildOddsSection(m), 'Pinnacle').includes('>Margin 2.9%<'), 'the margin printed on the book\'s own prices');
});

// ── §6 test 4 ─ founder Q10: only recorded markets render; an unrecorded market cannot be selected ──
test('§6.4 Q10: only recorded markets render a row; an unrecorded market cannot be selected', () => {
  const A = build();
  const m = fixture({ withAt: true });
  A.open(m); A.renderOddsSection();
  const before = A.section();
  assert.deepEqual([...before.matchAll(/data-market="([^"]*)"/g)].map(t => t[1]), ['Match Winner'], 'only the recorded market');
  assert.ok(!before.includes('not recorded'), 'no "not recorded" row');
  for (const name of ['1st set winner', 'Game handicap', 'Total games', 'Set betting', 'Set handicap', 'Tiebreak in match']) {
    A.aOddsSetMarket(name);
    assert.equal(A.state().market, 'Match Winner');
    assert.equal(A.section(), before, `selecting ${name} leaves the tab unchanged`);
  }
});

// ── §6 test 5 ─ mutant: the spec's Catmull-Rom Bézier (overshoots) instead of step / monotone ──
test('§6.5 a drawn line never leaves [series min, series max]', () => {
  const A = build();
  const t0 = Date.parse('2026-09-26T00:00:00Z');
  const s = [[t0, 1.5], [t0 + 1 * H, 1.5], [t0 + 2 * H, 2.0], [t0 + 3 * H, 2.0], [t0 + 4 * H, 1.6], [t0 + 5 * H, 1.6]];
  const X = t => (t - t0) / 1000, Y = v => 1000 - v * 100;
  for (const shape of ['step', 'monotone']) {
    const P = A.aOddsLinePaths(s, t0, t0 + 6 * H, X, Y, 1000, shape);
    const yv = [];
    for (const tok of P.line.split(/(?=[MHVC])/)) {
      const cmd = tok[0], args = tok.slice(1).trim().split(/[ ,]+/).map(Number);
      if (cmd === 'V') yv.push(args[0]);
      if (cmd === 'M' || cmd === 'C') for (let i = 1; i < args.length; i += 2) yv.push(args[i]);
    }
    assert.ok(yv.length >= 2, shape);
    const hi = Y(1.5) + 0.051, lo = Y(2.0) - 0.051;
    for (const y of yv) assert.ok(y <= hi && y >= lo, `${shape}: y ${y} outside [${lo}, ${hi}]`);
  }
  const svg = A.aOddsMvChart(s, 'var(--ma2-blue)', t0, t0 + 6 * H);
  const d = /class="aox-line" d="([^"]+)"/.exec(svg)[1];
  assert.ok(!/C/.test(d) && /H/.test(d) && /V/.test(d), d);
});

// TEN-380 review (founder 2026-10-04): a book with no odds for the match is not listed (ruling 15).
test('rows: one per bookmaker with odds, plain names, SHARP then SOFT, live first then stale; books with no odds hidden', () => {
  const now = Date.now();
  const A = build();
  const m = fixture({ now, withAt: true, superbetChecked: now - 2 * H });
  A.open(m);
  const h = A.buildOddsSection(m);
  assert.deepEqual([...h.matchAll(/class="ma2-group" data-group="([^"]*)"/g)].map(x => x[1]), ['sharp', 'soft']);
  const rows = rowsOf(h);
  assert.deepEqual(rows.map(r => r.book), ['Pinnacle', 'Betfair Exchange', 'Bet105', 'Betano', 'bet365', 'Superbet']);
  assert.equal(rows.find(r => r.book === 'bet365').src, 'bet365 (Oddspapi, capture ended 26 Sep)', 'bet365 falls back to the legacy capture');
  for (const r of rows) { const rh = rowHtml(h, r.book); assert.ok(!/Oddspapi|api-tennis|\+30s|seen by us|not in feed|Kibl/.test(rh.replace(/data-aotip="[^"]*"/g, '').replace(/data-src="[^"]*"/g, '')), r.book); }
  assert.ok(!h.includes('\u2197') && !h.includes('Chart lines') && !h.includes('Sources (Match Winner)') && !h.includes('SAMPLE DATA') && !h.includes('>Sample<'));
  // every book row carries its source on the shared tooltip (data-aotip), never a native title
  for (const r of rows) { const rh = rowHtml(h, r.book), tag = rh.slice(0, rh.indexOf('>')); assert.ok(/ data-aotip="/.test(tag) && !/\stitle="/.test(tag), r.book + ': the source on the shared tooltip'); }
});

// founder Q23 (2026-09-30): the Market / No-vig hints are the shared tooltip (data-aotip), never a native title.
test('renderer gap: Q23 — the Market / No-vig hints are the shared tooltip (data-aotip), never a native title', () => {
  const A = build(); const m = fixture(); A.open(m);
  const h = tabOf(A.buildOddsSection(m));
  const hints = [...h.matchAll(/<span class="seg ma2-seg"([^>]*)>(Market|No-vig)<\/span>/g)].map(x => [x[1], x[2]]);
  assert.deepEqual(hints.map(x => x[1]), ['Market', 'No-vig']);
  for (const [tag, label] of hints) {
    assert.ok(/ data-aotip="[^"]*(Prices as quoted|Margin stripped)/.test(tag), label + ': the hint on the shared tooltip');
    assert.ok(!/\stitle="/.test(tag), label + ': no native title');
  }
});

test('a group is config: moving Bet105 to SOFT is one edit to AODDS_BOOKS', () => {
  const cfg = constSrc('AODDS_BOOKS').replace(/^\nconst AODDS_BOOKS = /, '').replace(/;$/, '')
    .replace("{ name: 'Bet105', group: 'sharp'", "{ name: 'Bet105', group: 'soft'");
  const A = build(undefined, { AODDS_BOOKS: cfg });
  const m = fixture(); A.open(m);
  assert.equal(rowsOf(A.buildOddsSection(m)).find(r => r.book === 'Bet105').group, 'soft');
});

test('a completed or started match never reads "no recent data"', () => {
  const A = build();
  const m = fixture({ superbetChecked: Date.now() - 5 * H });
  m.finalScore = { winner: 'p1' };
  A.open(m);
  assert.ok(!A.buildOddsSection(m).includes('No recent data'));
});

test('no carry-forward past checkedAt: the line ends at the last check, not the chart edge', () => {
  const now = Date.now();
  const A = build();
  const m = fixture({ now, superbetChecked: now - 2 * H });
  const sb = A.aOddsRowsOf(m, { nowMs: now }).rows.find(r => r.name === 'Superbet');
  assert.equal(sb.end, now - 2 * H, 'Superbet ends at its checkedAt');
  const pin = A.aOddsRowsOf(m, { nowMs: now }).rows.find(r => r.name === 'Pinnacle');
  assert.equal(pin.end, now - 4 * 60e3);
  A.open(m); A.state().mv = 'Superbet';
  const h = A.buildOddsSection(m);
  const dots = [...popOf(h).matchAll(/<circle cx="([\d.]+)"/g)].map(x => +x[1]);
  assert.deepEqual(dots, [468, 468]);
});

// TEN-380 review (founder 2026-10-04): a book with no line is hidden, not a dash row; nothing at all → one line.
// Mutation: the no-data filter dropped (the dash rows come back).
test('no line: the book is not listed — never a dash row, never a zero; no book at all → one line', () => {
  const A = build();
  const m = fixture();
  delete m.oddsMovement.chart.books['Bet105'];
  m.oddsMovement.chart.meta['Superbet'].note = 'not recorded — our recording began 26 Sep';
  delete m.oddsMovement.chart.books['Superbet'];
  A.open(m);
  const h = A.buildOddsSection(m);
  for (const book of ['Bet105', 'Superbet']) assert.ok(!new RegExp('data-book="' + book + '"').test(h), book + ' (no line) is not listed');
  assert.ok(!/>0\.00</.test(h), 'never a zero');
  // nothing at all -> one line, no rows (the locked design keeps its cards with dashes: no separate reduced view)
  const h0 = A.buildOddsSection({ id: 'x', p1: 'A. B', p2: 'C. D', date: '2026-10-01', time: '10:00', oddsMovement: null, _oddsLoaded: true });
  assert.ok(!/data-bkrow/.test(h0) && h0.includes('>No bookmaker has odds for this match yet.<'));
  // before the lazy shard lands: a loading line, no verdict rows
  const hl = A.buildOddsSection({ id: 'x', p1: 'A. B', p2: 'C. D', date: '2026-10-01', time: '10:00' });
  assert.ok(hl.includes('>Loading bookmaker odds…<') && !hl.includes('data-bkrow') && !hl.includes('No bookmaker has odds'));
});

test('a book gone from the feed reads "Not in feed since", no Now, never best', () => atClock(Date.parse('2026-09-28T12:00:00Z'), () => {
  const now = Date.now();
  const A = build();
  const m = fixture({ now, withAt: true });
  m.oddsMovement.chart.books['Betano'] = { p1: [[iso(now - 5 * H), 9.9]], p2: [[iso(now - 5 * H), 9.9]] };
  m.oddsMovement.chart.meta['Betano'].gaps = [[iso(now - 2 * H), null]];
  A.open(m);
  const h = A.buildOddsSection(m);
  const row = rowHtml(h, 'Betano');
  assert.equal(nowTxt(row, 'a'), '\u2014');
  assert.ok(!isLifted(row, 'a') && !isLifted(row, 'b'), 'never best');
  assert.ok(/Not in feed since \d\d:\d\d/.test(tipOf(h, 'Betano')), tipOf(h, 'Betano'));
}));

// Founder review 2 (TEN-380, 2026-10-04): the per-book row and its pop-up print ONE Move % (displayed prices, 1 dp).
test('review 2: the pop-up Move % = its row\'s Move % (displayed prices, one rounding)', () => {
  const now = Date.parse('2026-09-27T08:00:00Z');
  atClock(now, () => {
    const A = build();
    const m = fixture({ now, withAt: true });
    m.oddsMovement.chart.books['Pinnacle +30s'].p1 = [[iso(now - 20 * H), 1.396], [iso(now - 2 * H), 1.404]];
    A.open(m); A.state().mv = 'Pinnacle';
    const h = A.buildOddsSection(m);
    assert.equal(mvTxt(rowHtml(h, 'Pinnacle'), 'a'), '0.0%', 'row: 1.40 → 1.40');
    assert.equal(mvMove(h, 'a'), '0.0%', 'pop-up: the same figure, not +0.6%');
  });
});

test('start time: in-play points never draw (the page start is aOddsStartMs)', () => {
  const A = build();
  const m = { id: 'past-1', p1: 'A. B', p2: 'C. D', date: '2026-09-24', time: '14:00', finalScore: '6-4 6-4',
    oddsMovement: { capturedAt: '2026-09-24T13:30:00.000Z', books: { bet365: {
      p1: [['2026-09-24T09:00:00.000Z', 2.0], ['2026-09-24T13:00:00.000Z', 9.5]],
      p2: [['2026-09-24T09:00:00.000Z', 1.8], ['2026-09-24T13:00:00.000Z', 1.05]] } } } };
  A.open(m);
  const h = A.buildOddsSection(m);
  assert.ok(!/>9\.50</.test(h) && !/>1\.05</.test(h), 'the 13:00Z in-play tick is not shown');
  assert.equal(nowTxt(rowHtml(h, 'bet365'), 'a'), '2.00');
});

test('pop-up: real window, tiles from the real series (earliest on ties), book tabs in table order', () => {
  const now = Date.parse('2026-09-27T08:00:00Z');
  atClock(now, () => {
    const A = build();
    const m = fixture({ now, withAt: true });
    m.oddsMovement.chart.books['Pinnacle +30s'].p1 = [[iso(now - 20 * H), 2.5], [iso(now - 10 * H), 2.6], [iso(now - 6 * H), 2.6], [iso(now - 2 * H), 2.35]];
    A.open(m); A.state().mv = 'Pinnacle';
    const D = A.aOddsRowsOf(m, { nowMs: now });
    const h = A.buildOddsSection(m), mv = popOf(h);
    assert.ok(mv.includes('>Sharp book \u00b7 margin 2.9% \u00b7 decimal odds, as quoted, since 26 Sep, 14:00<'), 'since = first tick (Europe/Brussels)');
    // p1: OPENING 2.50 (26 Sep 12:00Z), HIGHEST 2.60 twice -> the EARLIER (22:00Z), LOWEST 2.35 (06:00Z); Europe/Brussels
    assert.deepEqual(tilesOf(mvPanel(h, 'a')), [['Opening odd', '2.50', '26 Sep, 14:00'], ['Highest', '2.60', '27 Sep, 00:00'], ['Lowest', '2.35', '27 Sep, 08:00']]);
    assert.equal(mvMove(h, 'a'), '\u22126.0%', '% change (now - open) / open, the true minus');
    const tabs = [...mv.matchAll(/onclick="aOddsOpenMv\('([^']*)'\)"/g)].map(x => x[1]);
    assert.deepEqual(tabs, D.rows.filter(r => !r.noData).map(r => r.name), 'one tab per row with a line, table order, stale included');
    assert.ok(!mv.includes('72 hours') && !/class="aox-line" d="[^"]*C/.test(mv));
  });
});

test('no-vig: a latest tick with no matched pair (inside a gap) reads "—", never the last pair', () => {
  const now = Date.now();
  const A = build();
  const m = fixture({ now, withAt: true });
  m.oddsMovement.chart.books['Betano'] = { p1: [[iso(now - 5 * H), 2.5], [iso(now - 3 * H), 2.6]], p2: [[iso(now - 5 * H), 1.55]] };
  m.oddsMovement.chart.meta['Betano'].gaps = [[iso(now - 4 * H), iso(now - 2 * H)]];
  const row = A.aOddsRowsOf(m, { nowMs: now, novig: true }).rows.find(r => r.name === 'Betano');
  assert.equal(row.stale, false);
  assert.deepEqual(row.ticks.map(t => t.pair), [true, false], 'a tick inside a gap has no pair');
  assert.equal(row.aNow, null); assert.equal(row.bNow, null);
  A.open(m); A.state().novig = true;
  assert.equal(nowTxt(rowHtml(A.buildOddsSection(m), 'Betano'), 'a'), '\u2014');
});

// The locked design (2026-11-22, 4c): the best price on each side is the LIFTED box; it is never green (founder R4/R6.1).
test('best price: every tied live book is best (lifted), and none is green', () => {
  const A = build();
  const m = fixture({ withAt: true });
  m.oddsMovement.chart.books['Betano'].p1[0][1] = 2.46;   // ties Betfair Exchange's 2.46 at the top
  m.oddsMovement.chart.books['Superbet'].p1[0][1] = 2.3;
  A.open(m);
  const h = A.buildOddsSection(m);
  assert.deepEqual(A.aOddsRowsOf(m, { nowMs: Date.now() }).rows.filter(r => r.aBest).map(r => r.name).sort(), ['Betano', 'Betfair Exchange']);
  assert.deepEqual(rowsOf(h).filter(r => isLifted(rowHtml(h, r.book), 'a')).map(r => r.book).sort(), ['Betano', 'Betfair Exchange'], 'every tied book lifted, no other');
  assert.deepEqual(['Betano', 'Betfair Exchange'].map(b => nowCol(rowHtml(h, b), 'a')), ['var(--ma2-text)', 'var(--ma2-text)'], 'white like a price, never green');
});

// Only the clicked row is marked (the locked design: picked = lifted) and only while its pop-up is open.
test('the clicked book row is the only marked row (lifted), cleared on close', () => {
  const now = Date.now();
  const A = build(); const m = fixture({ now, withAt: true }); A.open(m);
  const marked = h => rowsOf(h).filter(r => /^<div class="seg ma2-row"[^>]*style="[^"]*background:var\(--ma2-lifted\)/.test(rowHtml(h, r.book))).map(r => r.book);
  assert.deepEqual(marked(A.buildOddsSection(m)), [], 'nothing marked before a click');
  A.aOddsOpenMv('Pinnacle');
  assert.deepEqual(marked(A.section()), ['Pinnacle']);
  A.aOddsCloseMv();
  assert.deepEqual(marked(A.section()), [], 'cleared on close');
});

test('STEAM follows the configured threshold; it reads the as-quoted move in both modes', () => {
  const now = Date.now();
  const m = fixture({ now });          // Pinnacle and Bet105 shortened on p1: 2 books
  assert.equal(build(undefined, { AODDS_STEAM: '{ minBooks: 3, minShareOfN: 0, minMovePct: 0 }' }).aOddsRowsOf(m, { nowMs: now }).steam, null);
  assert.equal(build(undefined, { AODDS_STEAM: '{ minBooks: 2, minShareOfN: 0, minMovePct: 0 }' }).aOddsRowsOf(m, { nowMs: now }).steam.text, '2 of 4 books shortened on J. Sinner');
  assert.equal(build(undefined, { AODDS_STEAM: '{ minBooks: 2, minShareOfN: 0.6, minMovePct: 0 }' }).aOddsRowsOf(m, { nowMs: now }).steam, null, '2 < 60% of 4');
  const A = build(undefined, { AODDS_STEAM: '{ minBooks: 2, minShareOfN: 0, minMovePct: 0 }' });
  assert.equal(A.aOddsRowsOf(m, { nowMs: now, novig: true }).steam.text, '2 of 4 books shortened on J. Sinner', 'same in No-vig');
  const m1 = fixture({ now });
  for (const k of ['Bet105', 'Superbet', 'Betfair Exchange (recorded by us)']) { delete m1.oddsMovement.chart.books[k]; }
  delete m1.oddsMovement.books;
  m1.oddsMovement.chart.books['Pinnacle +30s'] = { p1: [[iso(now - 20 * H), 2.5], [iso(now - 2 * H), 2.5]], p2: [[iso(now - 20 * H), 1.578], [iso(now - 2 * H), 1.5]] };
  const B = build(undefined, { AODDS_STEAM: '{ minBooks: 1, minShareOfN: 0, minMovePct: 0 }' });
  assert.equal(B.aOddsRowsOf(m1, { nowMs: now }).steam.text, '1 of 1 books shortened on C. Alcaraz');
  assert.equal(B.aOddsRowsOf(m1, { nowMs: now, novig: true }).steam.text, '1 of 1 books shortened on C. Alcaraz', 'No-vig reads the same market move');
});

test('pop-up x axis is real time: 5 labels evenly spaced from the first tick to the last check', () => {
  const A = build();
  const t0 = Date.parse('2026-09-26T00:00:00Z');
  const s = [[t0, 1.5], [t0 + 5 * 60e3, 1.6], [t0 + 10 * 60e3, 1.7], [t0 + 15 * 60e3, 1.8], [t0 + 8 * H, 1.9]];
  const svg = A.aOddsMvChart(s, 'var(--ma2-blue)', t0, t0 + 8 * H, []);
  const xs = [...svg.matchAll(/class="aox-xt" x="([\d.]+)"[^>]*>([^<]*)</g)];
  assert.deepEqual(xs.map(x => x[2]), ['02:00', '04:00', '06:00', '08:00', '10:00'], 'Europe/Brussels = UTC+2');
  assert.deepEqual(xs.map(x => +x[1]), [42, 148.5, 255, 361.5, 468]);
});

test('a legacy "<Book> (Oddspapi)" key joins that book\'s row as its last fallback — never a second row', () => {
  const now = Date.now();
  const A = build();
  const m = fixture({ now });
  m.oddsMovement.books.Pinnacle = { p1: [[iso(now - 40 * H), 2.2]], p2: [[iso(now - 40 * H), 1.7]] };
  A.open(m);
  assert.equal(rowsOf(A.buildOddsSection(m)).filter(r => /Pinnacle/.test(r.book)).length, 1);
  const pin = A.aOddsRowsOf(m, { nowMs: now }).rows.find(r => r.name === 'Pinnacle');
  assert.equal(pin.key, 'Pinnacle +30s (Oddspapi)');
  delete m.oddsMovement.chart.books['Pinnacle +30s'];
  assert.equal(A.aOddsRowsOf(m, { nowMs: now }).rows.find(r => r.name === 'Pinnacle').key, 'Pinnacle (Oddspapi)');
});

// ── founder ruling 2026-09-27 (comment fdf4bb3f): a book counts toward n only if |now − open| / open ≥ minMovePct ──
test('STEAM minimum move: 5 books each 1.40 → 1.41 never show STEAM at X = 3%', () => {
  const now = Date.now();
  const A = build(undefined, { AODDS_STEAM: '{ minBooks: 3, minShareOfN: 0, minMovePct: 3 }' });
  const five = (to) => {
    const m = fixture({ now });
    for (const k of Object.keys(m.oddsMovement.chart.books)) delete m.oddsMovement.chart.books[k];
    delete m.oddsMovement.books;
    const t0 = iso(now - 5 * H), t1 = iso(now - 1 * H);
    const meta = { source: 'api-tennis', group: 'soft', clock: 'seen by us every 5 min', checkedAt: iso(now - 2 * 60e3) };
    for (const k of ['Betano', '1xBet', 'BetVictor', 'Marathon', 'Sbobet']) {
      m.oddsMovement.chart.books[k] = { p1: [[t0, 1.40], [t1, to]], p2: [[t0, 3.0], [t1, 3.0]] };
      m.oddsMovement.chart.meta[k] = meta;
    }
    return m;
  };
  const small = A.aOddsRowsOf(five(1.41), { nowMs: now });
  assert.equal(small.N, 5, 'all five still count toward N');
  assert.equal(small.steam, null, '+0.7% per book is below X = 3%: no STEAM');
  A.open(five(1.41));
  assert.ok(!A.buildOddsSection(five(1.41)).includes('books drifted'), 'no chip rendered');
  assert.equal(A.aOddsRowsOf(five(1.45), { nowMs: now }).steam.text, '5 of 5 books drifted on J. Sinner');
});

// ── founder pick 2026-09-27: SHIPPED default X = 5%, 3 books, on displayed prices ──
test('STEAM shipped default: X = 5% with 3 books — +3.6% moves do not count, +5.7% do, and a 3-of-5 mix counts only the big movers', () => {
  const now = Date.now();
  const A = build();
  const mk = (tos) => {
    const m = fixture({ now });
    for (const k of Object.keys(m.oddsMovement.chart.books)) delete m.oddsMovement.chart.books[k];
    delete m.oddsMovement.books;
    const t0 = iso(now - 5 * H), t1 = iso(now - 1 * H);
    const meta = { source: 'api-tennis', group: 'soft', clock: 'seen by us every 5 min', checkedAt: iso(now - 2 * 60e3) };
    ['Betano', '1xBet', 'BetVictor', 'Marathon', 'Sbobet'].forEach((k, i) => {
      m.oddsMovement.chart.books[k] = { p1: [[t0, 1.40], [t1, tos[i]]], p2: [[t0, 3.0], [t1, 3.0]] };
      m.oddsMovement.chart.meta[k] = meta;
    });
    return m;
  };
  const mid = A.aOddsRowsOf(mk([1.45, 1.45, 1.45, 1.45, 1.45]), { nowMs: now });
  assert.equal(mid.N, 5);
  assert.equal(mid.steam, null, '+3.6% per book is below the shipped X = 5%');
  assert.equal(A.aOddsRowsOf(mk([1.48, 1.48, 1.48, 1.48, 1.48]), { nowMs: now }).steam.text, '5 of 5 books drifted on J. Sinner');
  assert.equal(A.aOddsRowsOf(mk([1.48, 1.48, 1.48, 1.45, 1.41]), { nowMs: now }).steam.text, '3 of 5 books drifted on J. Sinner');
  assert.equal(A.aOddsRowsOf(mk([1.48, 1.48, 1.45, 1.45, 1.41]), { nowMs: now }).steam, null, 'only 2 books clear 5%: below 3 books');
  assert.equal(A.aOddsRowsOf(mk([1.4695, 1.4695, 1.4695, 1.40, 1.40]), { nowMs: now }).steam.text, '3 of 5 books drifted on J. Sinner');
});

function vertices(d) {
  const out = []; let x = null, y = null;
  for (const tok of d.split(/(?=[MHVLZ])/)) {
    const c = tok[0], a = tok.slice(1).trim().split(/[ ,]+/).filter(Boolean).map(Number);
    if (c === 'M' || c === 'L') { x = a[0]; y = a[1]; } else if (c === 'H') x = a[0]; else if (c === 'V') y = a[0]; else continue;
    out.push([c, x, y]);
  }
  return out;
}
test('1a: a stored series with a 3-hour no-change gap (and a feed gap) draws ONE flat segment — no break, no interpolated point', () => {
  const now = Date.parse('2026-09-27T08:00:00Z');
  atClock(now, () => {
    const A = build();
    const t0 = now - 8 * H;
    const s = [[t0, 2.50], [t0 + 1 * H, 2.40], [t0 + 4 * H, 2.60]];
    const X = t => (t - t0) / 36e3, Y = v => 1000 - v * 100;
    const P = A.aOddsLinePaths(s, t0, t0 + 6 * H, X, Y, 1000);
    assert.equal((P.line.match(/M/g) || []).length, 1, 'one line, no break: ' + P.line);
    assert.ok(!/[LC]/.test(P.line), 'no slope, no curve: ' + P.line);
    const v = vertices(P.line);
    const flat = v.findIndex(p => p[0] === 'H' && Math.abs(p[1] - X(t0 + 4 * H)) < 0.06 && Math.abs(p[2] - Y(2.40)) < 0.06);
    assert.ok(flat > 0 && Math.abs(v[flat - 1][1] - X(t0 + 1 * H)) < 0.06, 'one H from the 2.40 tick to the next tick at 2.40: ' + P.line);
    assert.ok(Math.abs(P.end[0] - X(t0 + 6 * H)) < 0.06, 'ends at the last check');
    const m = fixture({ now, withAt: true });
    m.oddsMovement.chart.books['Pinnacle +30s'].p1 = s.map(p => [iso(p[0]), p[1]]);
    m.oddsMovement.chart.meta['Pinnacle +30s'].gaps = [[iso(t0 + 1.5 * H), iso(t0 + 3.5 * H)]];
    A.open(m);
    A.state().mv = 'Pinnacle';
    const pd = /class="aox-line" d="([^"]+)"/.exec(popOf(A.buildOddsSection(m)))[1];
    assert.equal((pd.match(/M/g) || []).length, 1, 'pop-up: one line across the feed gap: ' + pd);
  });
});
test('1a: every plotted y-value is a stored price at display precision (the NOW column rounding)', () => {
  const A = build();
  const t0 = Date.parse('2026-09-26T00:00:00Z');
  const s = [[t0, 1.4695], [t0 + 1 * H, 1.4712], [t0 + 2 * H, 1.52], [t0 + 3 * H, 1.068], [t0 + 4 * H, 2.345]];
  const allowed = new Set(s.map(p => +A.aOddsFmt(p[1])));
  const X = t => (t - t0) / 36e3, Y = v => 1000 - v * 100;
  const back = y => Math.round((1000 - y) * 10) / 1000;
  const P = A.aOddsLinePaths(s, t0, t0 + 5 * H, X, Y, 1000);
  const ys = vertices(P.line).map(p => back(p[2]));
  for (const v of ys) assert.ok(allowed.has(v), `y ${v} is not a stored price at display precision (${[...allowed]})`);
  assert.ok(ys.includes(1.47) && !ys.includes(1.4695) && !ys.includes(1.4712), 'raw 1.4695 / 1.4712 draw as the displayed 1.47');
  assert.equal(vertices(P.line).filter(p => p[0] === 'V').length, 3, 'three changes after rounding');
});
// ── founder follow-up 1b: ONE missing-price mark on the tab, U+2014 ──
//    mutants: the renderer's dash an en dash · AODDS_DASH an en dash · a literal dash in the tab's code ──
test('1b: every missing price on the tab (NOW, margin, pop-up header, tiles) is U+2014, through one constant', () => {
  const now = Date.now();
  const A = build();
  const m = fixture({ now, withAt: true });
  m.oddsMovement.chart.meta['Betano'].gaps = [[iso(now - 2 * H), null]];
  A.open(m);
  const h = A.buildOddsSection(m);
  const row = rowHtml(h, 'Betano');
  for (const x of ['a', 'b']) assert.equal(nowTxt(row, x), '\u2014');
  A.state().mv = 'Betano';
  const all = A.buildOddsSection(m);
  assert.ok(!/[\u2013\u2012]/.test(all.replace(/<svg[\s\S]*?<\/svg>/g, '')), 'no en dash / figure dash as a value mark');
  // the page's Odds functions: no dash literal outside AODDS_DASH
  const code = FNS.map(n => slice(n)).join('\n').replace(/\/\/[^\n]*/g, '');
  const lits = code.match(/'[^'\n]*\u2014[^'\n]*'|"[^"\n]*\u2014[^"\n]*"/g) || [];
  assert.deepEqual(lits.filter(l => !/ \u2014 /.test(l)), [], 'a value dash literal outside AODDS_DASH');
  assert.equal(constSrc('AODDS_DASH').trim(), "const AODDS_DASH = '\\u2014';");
  // the rebuild's Odds code reads its one DASH (U+2014); no other dash literal in it
  assert.match(V2, /\n  const DASH = '\u2014';\n/, 'match-analysis-v2.js DASH = U+2014');
  const v2lits = v2OddsSrc().replace(/\/\/[^\n]*/g, '').match(/'[^'\n]*[\u2014\u2013][^'\n]*'/g) || [];
  assert.deepEqual(v2lits.filter(l => !/ \u2014 /.test(l)), [], 'a dash literal in the Odds code outside DASH');
});
// ── founder follow-up 1c: ALSO reads "<feed> · <status>", in the tooltip's label/value styling ──
test('1c: the tooltip ALSO line reads "api-tennis · not in feed since HH:MM"', () => atClock(Date.parse('2026-09-28T12:00:00Z'), () => {
  const now = Date.now();
  const A = build();
  const m = fixture({ now, withAt: true });
  m.oddsMovement.chart.meta['Pinnacle (api-tennis)'].gaps = [[iso(now - 2 * H), null]];
  A.open(m);
  const tip = tipOf(A.buildOddsSection(m), 'Pinnacle');
  const mm = />Also<\/span><span style="([^"]*)">([^<]*)</.exec(tip);
  assert.ok(mm, tip);
  assert.match(mm[2], /^api-tennis · not in feed since \d\d:\d\d$/);
  const src = />Source<\/span><span style="([^"]*)">/.exec(tip);
  assert.equal(mm[1], src[1], 'same value styling as the SOURCE line');
}));

// ── review fold-in: HIGHEST / LOWEST on the DISPLAYED prices, earliest on a tie ──
test('pop-up tiles: HIGHEST / LOWEST compare displayed prices; a displayed tie keeps the earliest time', () => {
  const now = Date.parse('2026-09-27T08:00:00Z');
  atClock(now, () => {
    const A = build();
    const m = fixture({ now, withAt: true });
    m.oddsMovement.chart.books['Pinnacle +30s'].p1 = [[iso(now - 20 * H), 1.30], [iso(now - 10 * H), 1.401], [iso(now - 6 * H), 1.404], [iso(now - 2 * H), 1.35]];
    A.open(m); A.state().mv = 'Pinnacle';
    assert.deepEqual(tilesOf(mvPanel(A.buildOddsSection(m), 'a'))[1], ['Highest', '1.40', '27 Sep, 00:00'], 'HIGHEST = the first 1.40');
  });
});
// ── founder card 9e0ac649 (2026-09-27): a book out of its feed holds its last caught price to the LAST CHECK ──
test('a book with an open feed gap holds its last price flat to the last check, not to "not in feed since"', () => {
  const now = Date.parse('2026-09-27T08:00:00Z');
  atClock(now, () => {
    const A = build();
    const m = fixture({ now, withAt: true });
    m.oddsMovement.chart.books['Betano'] = { p1: [[iso(now - 6 * H), 2.5], [iso(now - 4 * H), 2.4]], p2: [[iso(now - 6 * H), 1.6], [iso(now - 4 * H), 1.65]] };
    m.oddsMovement.chart.meta['Betano'].gaps = [[iso(now - 3 * H), null]];
    m.oddsMovement.chart.meta['Betano'].checkedAt = iso(now - 2 * 60e3);
    const r = A.aOddsRowsOf(m, { nowMs: now }).rows.find(x => x.name === 'Betano');
    assert.ok(r.stale && r.pulled === now - 3 * H, 'the book is out of its feed');
    assert.equal(r.end, now - 2 * 60e3, 'the line runs to the last check');
    A.open(m); A.state().mv = 'Betano';
    const xs = [...popOf(A.buildOddsSection(m)).matchAll(/class="aox-xt"[^>]*>([^<]+)</g)].map(x => x[1]);
    assert.equal(xs[4], '09:58', 'the pop-up x axis ends at the last check: ' + xs);
  });
});

// TEN-380 / Q10: the Match Winner row = the CARD's one book — its Now and the move against that same book's Open; missing =
// dash; a leg below the 1.01 floor is suppressed. The locked design (2026-11-22) prints the move as a signed percent.
//    mutants: the row shows the best price across books · the move against another book's open · the floor dropped
test('Q10: the Match Winner row is the card book (Now, and the move vs the same book\'s Open); dashes when absent', () => {
  const now = Date.now();
  const A = build(); const m = fixture({ now, withAt: true });
  const mkt = h => { const t = tabOf(h), i = t.indexOf('data-market="Match Winner"'); return t.slice(t.lastIndexOf('<div', i)); };
  // no card row → both prices dashed, no move (never the best price of the table: Betano's 2.50 / Betfair Exchange's 1.67)
  A.open(m); let t = mkt(A.buildOddsSection(m));
  assert.deepEqual([nowTxt(t, 'a'), nowTxt(t, 'b')], ['\u2014', '\u2014']);
  assert.ok(!/[+\u2212]\d/.test(mvTxt(t, 'a') + mvTxt(t, 'b')), 'no move');
  assert.ok(t.includes('>Not offered<'));
  m.__testOcs = { book: 'bet105', p1: { open: 2.40, now: 2.30, close: null }, p2: { open: 1.62, now: 1.70, close: null } };
  A.open(m); const h = A.buildOddsSection(m); t = mkt(h);
  assert.deepEqual([nowTxt(t, 'a'), nowTxt(t, 'b')], ['2.30', '1.70']);
  assert.deepEqual([mvTxt(t, 'a'), mvCol(t, 'a')], ['\u22124.2%', RED]);
  assert.deepEqual([mvTxt(t, 'b'), mvCol(t, 'b')], ['+4.9%', GREEN]);
  assert.ok(t.includes('>bet105<'), 'the row names its book');
  const live = A.aOddsRowsOf(m, { nowMs: now }).rows.filter(r => !r.noData && !r.stale).length;
  assert.ok(new RegExp(`>Match Winner \\u00b7 ${live} books \\u00b7 as quoted<`).test(h), 'the Best price scope: N = the books quoting now');
  // the Kibl stream, where newer, is the card's Now (same book)
  m.__testStream = { p1: 2.26, p2: 1.72, book: 'bet105' };
  A.open(m); t = mkt(A.buildOddsSection(m));
  assert.deepEqual([nowTxt(t, 'a'), nowTxt(t, 'b')], ['2.26', '1.72']);
  delete m.__testStream;
  // a genuine zero move reads 0.0% in grey; a leg below the floor (1.005) is a dash and has no move
  m.__testOcs = { book: 'bet105', p1: { open: 2.30, now: 2.30 }, p2: { open: 1.62, now: 1.005 } };
  A.open(m); t = mkt(A.buildOddsSection(m));
  assert.deepEqual([mvTxt(t, 'a'), mvCol(t, 'a')], ['0.0%', QUIET]);
  assert.equal(nowTxt(t, 'b'), '\u2014'); assert.ok(!/\d/.test(mvTxt(t, 'b')));
  // a missing open: the price stands, the move is absent (never against another book's open)
  m.__testOcs = { book: 'bet105', p1: { open: null, now: 2.30 }, p2: { open: null, now: 1.70 } };
  A.open(m); t = mkt(A.buildOddsSection(m));
  assert.equal(nowTxt(t, 'a'), '2.30'); assert.ok(!/\d/.test(mvTxt(t, 'a')), 'no move without the same book\'s open');
});

// TEN-380 review item 4 (one book per fixture): Key factors' Odds box (kfOddsBook) prints the card's book.
test('review item 4: Key factors Odds box = the card book (Open + Now as the tile), stream Now when newer; no card → the box order', () => {
  const now = Date.now();
  const A = build(); const m = fixture({ now, withAt: true });
  const before = A.kfOddsBook(m).row;
  assert.ok(before && !/bet105/i.test(before.name), 'no card state: the box picks by its own order (control)');
  m.__testOcs = { book: 'bet105', label: 'Bet105', p1: { open: 2.40, now: 2.30, close: null }, p2: { open: 1.62, now: 1.70, close: null } };
  let r = A.kfOddsBook(m).row;
  assert.deepEqual([r.name, r.aOpen, r.aNow, r.bOpen, r.bNow], ['Bet105', 2.40, 2.30, 1.62, 1.70], 'the card book, its own Open and Now');
  m.__testStream = { p1: 2.26, p2: 1.72, book: 'bet105' };
  r = A.kfOddsBook(m).row;
  assert.deepEqual([r.aNow, r.bNow], [2.26, 1.72], 'the newer stream tick, as the tile and the match card');
  const row = A.aOddsRowsOf(m, { nowMs: now }).rows.find(x => x.name === 'Bet105');
  assert.deepEqual([row.aNow, row.bNow, row.stale], [2.26, 1.72, false], 'the table row = the card pair');
  const pin = A.aOddsRowsOf(m, { nowMs: now }).rows.find(x => x.name === 'Pinnacle');
  assert.ok(pin && pin.aNow !== 2.26, 'another book never takes the card stream');
  delete m.__testStream;
  const r2 = A.aOddsRowsOf(m, { nowMs: now }).rows.find(x => x.name === 'Bet105');
  assert.deepEqual([r2.aNow, r2.bNow, r2.stale], [2.30, 1.70, false], 'the card state Now on the table row');
  const k = A.kfOddsBook(m).row, ov = 1 / 2.30 + 1 / 1.70;
  assert.deepEqual([+k.nv.a[0][1].toFixed(4), +k.nv.b[0][1].toFixed(4)], [+(2.30 * ov).toFixed(4), +(1.70 * ov).toFixed(4)], 'Key factors Fair = the vig-free price of the pair it prints');
  const done = Object.assign({}, m, { finalScore: { sets: [], winner: 'p1' }, __testOcs: { book: 'bet105', p1: { open: 2.40, now: 2.30, close: 2.18 }, p2: { open: 1.62, now: 1.70, close: 1.79 } } });
  const r3 = A.aOddsRowsOf(done, { nowMs: now }).rows.find(x => x.name === 'Bet105');
  assert.deepEqual([r3.aNow, r3.bNow], [2.18, 1.79], 'the card close, not the last tick');
  delete m.__testOcs; m.__testNowPair = { p1: 2.20, p2: 1.75, book: 'bet105', bookName: 'Bet105' };
  const D = A.aOddsRowsOf(m, { nowMs: now });
  assert.deepEqual(A.aOddsCardTile(m, D).now, [2.20, 1.75], 'tile = the card pair');
  assert.deepEqual([A.kfOddsBook(m).row.aNow, A.kfOddsBook(m).row.bNow], [2.20, 1.75], 'Key factors = the card pair');
});

// The locked 2026-11-22 design (4c picked): one box per group (Sharp / Soft), a column head with each player over his own
// price box, rows = name over margin | one price box per player (Now + move, foot "Opening odd"), an Average box; no
// per-row sparkline. mutants: a sparkline back in a row · the price box loses its "Opening odd" foot
test('locked design: one box per group, a price box per player (Now + move over "Opening odd"), an Average box, no sparkline', () => {
  const now = Date.now();
  const A = build(); const m = fixture({ now, withAt: true }); A.open(m);
  const h = A.buildOddsSection(m);
  for (const g of ['sharp', 'soft']) {
    const t = tabOf(h), i = t.indexOf(`class="ma2-group" data-group="${g}"`), seg = t.slice(i, t.indexOf('class="ma2-group"', i + 10) > 0 ? t.indexOf('class="ma2-group"', i + 10) : t.indexOf('class="ma2-avg"'));
    assert.ok(i > 0 && />Bookmaker</.test(seg), g + ': column head');
    assert.ok(seg.includes('>J. Sinner<') && seg.includes('>C. Alcaraz<'), g + ': each player over his column');
  }
  for (const r of rowsOf(h)) { const rh = rowHtml(h, r.book); assert.equal(boxes(rh).length, 2, r.book); assert.ok(!/<svg/.test(rh), r.book + ': no sparkline'); assert.ok(openTxt(rh, 'a') != null, r.book + ': Opening odd foot'); }
  assert.equal(nowTxt(rowHtml(h, 'Pinnacle'), 'a'), '2.35');
  assert.ok(/class="ma2-avg"[\s\S]*>Average</.test(h), 'the Average box');
  assert.ok(!/lifted/i.test(h.replace(/var\(--ma2-lifted\)/g, '').replace(/The lifted box is the best price on that side\./, '')), 'no "lifted price" legend line');
});

// founder Q2 (2026-10-03) → the locked design (2026-11-22): the pop-up chart = player one blue, player two white, dotted
// horizontal guides only (--viz-guide, dash 2 6), no area fill, no vertical line. mutants: A line on --ma2-text · guides 4 4
test('Q2: odds pop-up chart — A blue, B white, dotted guides only, no fill, no vertical lines', () => {
  const now = Date.parse('2026-09-27T08:00:00Z');
  atClock(now, () => {
    const A = build(); const m = fixture({ now, withAt: true }); A.open(m); A.state().mv = 'Pinnacle';
    const mv = popOf(A.buildOddsSection(m));
    const lines = [...mv.matchAll(/class="aox-line" d="[^"]*" fill="none" style="stroke:([^"]+)"/g)].map(x => x[1]);
    assert.deepEqual(lines, ['var(--ma2-blue)', 'var(--ma2-text)']);
    const svgs = [...mv.matchAll(/<svg class="aox-chart"[\s\S]*?<\/svg>/g)].map(x => x[0]);
    assert.equal(svgs.length, 2);
    for (const svg of svgs) {
      const guides = [...svg.matchAll(/<line x1="([\d.]+)" x2="([\d.]+)" y1="([\d.]+)" y2="([\d.]+)" style="stroke:([^"]+)"( stroke-dasharray="([^"]+)")?/g)];
      assert.ok(guides.length >= 3);
      for (const g of guides) assert.equal(g[3], g[4], 'horizontal only');
      assert.ok(guides.filter(g => g[7]).every(g => g[7] === '2 6' && g[5] === 'var(--viz-guide)'), 'dotted --viz-guide');
      assert.ok(!/<path(?![^>]*fill="none")/.test(svg) && !/<polygon|<rect/.test(svg), 'no area fill');
    }
  });
});

// The pop-up is the shared opened-box shell (match-analysis-v2.js popShell, the locked design's "shared opened-box shell");
// it closes on its Close button and on a click outside it. mutant: the outside click stops closing it
test('pop-up: the shared opened-box shell, closed by its Close button and an outside click', () => {
  const now = Date.parse('2026-09-27T08:00:00Z');
  atClock(now, () => {
    const A = build(); const m = fixture({ now, withAt: true }); A.open(m);
    A.aOddsOpenMv('Pinnacle');
    let h = A.section();
    assert.match(h, /class="ma2-pop-ov" onclick="if\(event\.target===this\)\{aOddsCloseMv\(\)\}" style="position:fixed; inset:0 0 0 var\(--sf-side, 0px\);/);
    assert.match(h, /class="ma2-pop" style="width:100%; max-width:980px;/, 'the 980 shell');
    assert.match(h, /class="seg ma2-btn" role="button" tabindex="0" onclick="aOddsCloseMv\(\)"[^>]*>Close</);
    A.aOddsOpenMv('Bet105');
    assert.ok(/>Bet105 price movement</.test(A.section()), 'a book-tab switch');
    A.aOddsCloseMv(); assert.ok(!A.section().includes('ma2-pop-ov'), 'closed');
  });
});

// TEN-335 (still in force): Esc closes the odds pop-up — not the whole modal. The one Esc handler (esc-nav.js) only sees
// frames that register a layer: the page's 'ma-pop' layer looks for .ma-pop-overlay .ma-pop-x (maPopEscKey clicks it).
test('renderer gap: TEN-335 — Esc closes the odds pop-up through an Esc layer, not the whole modal', () => {
  const now = Date.parse('2026-09-27T08:00:00Z');
  atClock(now, () => {
    const A = build(); const m = fixture({ now, withAt: true }); A.open(m);
    A.aOddsOpenMv('Pinnacle');
    const h = A.section();
    const viaMaPop = /class="[^"]*\bma-pop-overlay\b/.test(h) && /class="[^"]*\bma-pop-x\b/.test(h);
    const ownLayer = /sfEscLayers[^\n]*ma2-pop/.test(HTML + V2);
    assert.ok(viaMaPop || ownLayer, 'the price movement box (.ma2-pop-ov) is on no Esc layer: Esc falls through to the analysis modal');
  });
});
