// TEN-303 (founder brief 2026-09-27) — the Odds tab rebuilt to the locked Claude Design (handoff 15),
// EXECUTED: the renderer is SLICED out of the shipped HTML and run; a regex over the source would pass
// on code that never runs. Rules: .claude/rules/odds.md "The Odds tab (TEN-303)".
//
// Each §6 test names the mutation it catches (brief §6); tools/test-ten303-mutants.js applies every one
// to a copy of the page and fails if any leaves this suite green.
//
// Run: node --test test-ten303-odds-tab.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build, constSrc, slice, FNS } from './tools/ten303-odds-harness.mjs';

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

const rowsOf = h => [...h.matchAll(/class="aox-row[^"]*" data-book="([^"]*)" data-group="([^"]*)" data-src="([^"]*)"/g)].map(x => ({ book: x[1], group: x[2], src: x[3] }));
const rowHtml = (h, book) => { const i = h.indexOf(`data-book="${book}"`, h.indexOf('class="aox-row')); const j = h.indexOf('class="aox-row', i + 10); return h.slice(i, j < 0 ? h.indexOf('class="aox-foot', i) : j); };
const cellTxt = (row, cls, side) => { const mm = new RegExp(`class="${cls}" data-side="${side}" style="[^"]*">([^<]*)<`).exec(row); return mm && mm[1]; };
const colorOf = (row, cls, side) => { const mm = new RegExp(`class="${cls}" data-side="${side}" style="[^"]*color:([^;"]+)`).exec(row); return mm && mm[1]; };
// A test that pins its fixture to a fixed instant must pin the renderer's clock too: the page reads Date.now()
// for staleness (60-min rule), so a fixed fixture silently turns stale once the wall clock passes it (the
// 2026-09-27 ~09:00Z pipeline gate failure). atClock() freezes Date.now for the test body and restores it.
const atClock = (now, fn) => { const real = Date.now; Date.now = () => now; try { return fn(); } finally { Date.now = real; } };
const unesc = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tipOf = (h, book) => { const r = rowHtml(h, book); const mm = /class="aox-book"[\s\S]*?data-aotip="([^"]*)"/.exec(r); return mm ? unesc(mm[1]) : ''; };

// ── §6 test 1 ─ mutants: a stale "now" kept (drop `row.stale ? null :`); best over all books (drop `!r.stale`);
//    STEAM counting every book (moving = rows) ──
test('§6.1 a stale book: NOW and MOVE "—", never green, outside STEAM n and N', () => {
  const now = Date.now();
  const A = build(undefined, { AODDS_STEAM: '{ minBooks: 3, minShareOfN: 0, minMovePct: 0 }' });
  const m = fixture({ now, withAt: true, superbetChecked: now - 2 * H });   // Superbet: last check 2 h ago, the HIGHEST p1 (2.60)
  A.open(m);
  const h = A.buildOddsSection(m);
  const sb = rowHtml(h, 'Superbet');
  assert.ok(/class="aox-row aox-stale"/.test(h.slice(h.lastIndexOf('<div', h.indexOf('data-book="Superbet"')))), 'Superbet is the stale row');
  for (const x of ['a', 'b']) {
    assert.equal(cellTxt(sb, 'aox-now', x), '\u2014', `NOW ${x} is a dash`);
    assert.equal(cellTxt(sb, 'aox-move', x), '\u2014', `MOVE ${x} is a dash`);
    assert.equal(colorOf(sb, 'aox-now', x), A.AODDS_C.label);
    assert.equal(colorOf(sb, 'aox-move', x), A.AODDS_C.label, 'a stale move is grey, never signed');
  }
  assert.ok(sb.includes('>no recent data<'), 'margin line reads "no recent data"');
  assert.ok(!/<svg/.test(sb), 'TEN-380: no per-row sparkline (the reference rows are open → now + move)');
  assert.ok(sb.includes('onclick="aOddsOpenMv'), 'the row still opens the pop-up');
  // best p1 among LIVE books = 2.50 (Betano); the stale 2.60 never wins. The best price is neutral on screen
  // (founder R4/R6.1, TEN-376), so the rule is read from the rows, and no NOW is ever green.
  assert.deepEqual(A.aOddsRowsOf(m, { nowMs: now }).rows.filter(r => r.aBest).map(r => r.name), ['Betano']);
  assert.deepEqual(rowsOf(h).filter(r => colorOf(rowHtml(h, r.book), 'aox-now', 'a') === A.AODDS_C.up), [], 'no green NOW');
  // STEAM: every live book with an open and a now drifted? Pinnacle 2.50→2.35 (shortened), Bet105 2.40→2.30 (shortened),
  // Betano / Pinnacle-api / BF Exch: one tick each (no move). Make four live books shorten on p1 and the stale one too:
  const D = A.aOddsRowsOf(m, { nowMs: now });
  assert.ok(!D.rows.find(r => r.name === 'Superbet').aBest);
  assert.equal(D.N, 4, 'N = the 4 live books with an open and a now (Pinnacle, Bet105, Betfair Exchange, Betano), never the stale Superbet');
  const m2 = fixture({ now, superbetChecked: now - 2 * H });
  m2.oddsMovement.chart.books['Betfair Exchange (recorded by us)'].p1.push([iso(now - 30 * 60e3), 2.2]);
  m2.oddsMovement.chart.books['Superbet'].p1.push([iso(now - 7 * H), 2.1]);         // the stale book shortened too
  const D2 = A.aOddsRowsOf(m2, { nowMs: now });
  assert.equal(D2.steam && D2.steam.text, '3 of 3 books shortened on J. Sinner', 'the stale Superbet is in neither n nor N');
  A.open(m2);
  // TEN-380: the chip's sentence lives in its shared tooltip (data-aotip), never on screen and never a native title
  const h2 = A.buildOddsSection(m2), chip = /<span class="aox-steam" tabindex="0" data-aotip="([^"]*)"/.exec(h2);
  assert.ok(chip && unesc(chip[1]).includes('>3 of 3 books shortened on J. Sinner<'), 'the chip carries it in its tooltip');
  assert.ok(!h2.replace(/data-aotip="[^"]*"/g, '').includes('3 of 3 books'), 'the sentence is not printed beside the chip');
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
  assert.equal(cellTxt(row, 'aox-open', 'a'), '2.50'); assert.equal(cellTxt(row, 'aox-now', 'a'), '2.35');
  // TEN-380 Move = (now − open) / open on the displayed prices, 1 dp, ▲ / ▼ in the signed colours:
  // 2.50 → 2.35 = −6.0%; 1.578 → 1.657 reads 1.58 → 1.66 = +5.1% (the raw prices would give +5.0%)
  assert.equal(cellTxt(row, 'aox-move', 'a'), '\u25bc 6.0%');
  assert.equal(colorOf(row, 'aox-move', 'a'), A.AODDS_C.dn);
  assert.equal(cellTxt(row, 'aox-move', 'b'), '\u25b2 5.1%', 'measured on the displayed prices');
  assert.equal(colorOf(row, 'aox-move', 'b'), A.AODDS_C.up);
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
  // Bet105 posts p1 last, p2 never again -> its latest tick still pairs with p2's last price (same source)
  // a book whose p2 never posted has no pair at all
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
    const row = rowHtml(h, r.book), a = cellTxt(row, 'aox-now', 'a'), b = cellTxt(row, 'aox-now', 'b');
    if (a === '\u2014' || b === '\u2014') continue;
    const tol = 0.005 / (+a) ** 2 + 0.005 / (+b) ** 2 + 1e-9;   // 2-decimal display rounding
    assert.ok(Math.abs(1 / +a + 1 / +b - 1) <= tol, `${r.book} rendered ${a}/${b}`);
  }
  const betano = rowHtml(h, 'Betano');
  assert.equal(cellTxt(betano, 'aox-now', 'a'), '\u2014', 'no matched pair -> no no-vig price');
  assert.equal(cellTxt(betano, 'aox-now', 'b'), '\u2014');
  assert.ok(h.includes('>margin removed<') && /class="aox-meta"[^>]*>Match Winner \u00b7 \d+ books \u00b7 no-vig</.test(h), 'the header meta names the price mode');
  // Bet105 pairs across timestamps: 4 ticks, the first (p1 only) unpaired
  const b105 = D.rows.find(r => r.name === 'Bet105');
  assert.deepEqual(b105.ticks.map(t => t.pair), [false, true, true, true]);
  // Market mode margin = 1/a + 1/b - 1 on the current pair: Pinnacle 1/2.35 + 1/1.657 - 1 = 2.9%
  const Dm = A.aOddsRowsOf(m, { nowMs: now });
  assert.equal((Dm.rows.find(r => r.name === 'Pinnacle').margin * 100).toFixed(1), '2.9');
});

// ── §6 test 4 ─ founder Q10 (2026-10-03): the unrecorded markets are HIDDEN — only recorded tiles render; an unrecorded
//    market still cannot be selected. mutants: aOddsSetMarket without its `recorded` guard · the hidden tiles back ──
test('§6.4 Q10: only recorded markets render a tile; an unrecorded market cannot be selected', () => {
  const A = build();
  const m = fixture({ withAt: true });
  A.open(m); A.renderOddsSection();
  const before = A.section();
  const tiles = [...before.matchAll(/<div class="aox-tile[^"]*" data-market="([^"]*)"([^>]*)>/g)];
  assert.deepEqual(tiles.map(t => t[1]), ['Match Winner'], 'only the recorded market');
  assert.ok(!before.includes('not recorded') && !before.includes('aox-off'), 'no "not recorded" tile');
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
  const X = t => (t - t0) / 1000, Y = v => 1000 - v * 100;       // 1:1 back-mappable
  for (const shape of ['step', 'monotone']) {
    const P = A.aOddsLinePaths(s, t0, t0 + 6 * H, X, Y, 1000, shape);
    const ys = [...P.line.matchAll(/[MLHVC ,]?(-?\d+(?:\.\d+)?)/g)];
    // collect every y coordinate: V args, and the second of each x,y pair
    const nums = P.line.replace(/[MC]/g, ' ').trim();
    const yv = [];
    for (const tok of P.line.split(/(?=[MHVC])/)) {
      const cmd = tok[0], args = tok.slice(1).trim().split(/[ ,]+/).map(Number);
      if (cmd === 'V') yv.push(args[0]);
      if (cmd === 'M' || cmd === 'C') for (let i = 1; i < args.length; i += 2) yv.push(args[i]);
    }
    assert.ok(yv.length >= 2 && ys.length && nums.length, shape);
    const hi = Y(1.5) + 0.051, lo = Y(2.0) - 0.051;               // y grows downward; .1-px path rounding
    for (const y of yv) assert.ok(y <= hi && y >= lo, `${shape}: y ${y} outside [${lo}, ${hi}]`);
  }
  // the shipped charts use the configured shape (step): the pop-up line has no curve at all
  const svg = A.aOddsMvChart(s, '#6A9AF8', t0, t0 + 6 * H);
  const d = /class="aox-line" d="([^"]+)"/.exec(svg)[1];
  assert.ok(!/C/.test(d) && /H/.test(d) && /V/.test(d), d);
});

// ── ported TEN-295 rulings (the table kept its data rules; only the markup changed) ──
// TEN-380 review (founder 2026-10-04): a book with no odds for the match is not listed (ruling 15, as unrecorded markets).
test('rows: one per bookmaker with odds, plain names, SHARP then SOFT, live first then stale; books with no odds hidden', () => {
  const now = Date.now();
  const A = build();
  const m = fixture({ now, withAt: true, superbetChecked: now - 2 * H });
  A.open(m);
  const h = A.buildOddsSection(m);
  assert.deepEqual([...h.matchAll(/class="aox-grouphead" data-group="([^"]*)"/g)].map(x => x[1]), ['sharp', 'soft']);
  const rows = rowsOf(h);
  assert.deepEqual([...new Set(rows.map(r => r.group))], ['sharp', 'soft']);
  // exact order: SOFT live (Betano) first, then stale (bet365 legacy capture 26 h old, Superbet); the no-data books are not listed
  assert.deepEqual(rows.map(r => r.book), ['Pinnacle', 'Betfair Exchange', 'Bet105', 'Betano', 'bet365', 'Superbet']);
  assert.ok(!/aox-nodata/.test(h), 'no no-data row');
  assert.equal(rows.find(r => r.book === 'bet365').src, 'bet365 (Oddspapi, capture ended 26 Sep)', 'bet365 falls back to the legacy capture');
  // no source text in any row; no native title tooltips; no ↗ icon; no chart / chips / dropdown / "Sources" paragraph
  for (const r of rows) { const rh = rowHtml(h, r.book); assert.ok(!/Oddspapi|api-tennis|\+30s|seen by us|not in feed|Kibl/.test(rh.replace(/data-aotip="[^"]*"/g, '').replace(/data-src="[^"]*"/g, '')), r.book); }
  assert.ok(!/\stitle="/.test(h), 'no native title tooltips');
  assert.ok(!h.includes('\u2197') && !h.includes('Chart lines') && !h.includes('Sources (Match Winner)') && !h.includes('aodds-mkt') && !h.includes('SAMPLE DATA'));
  assert.ok(h.includes('>Match Winner only. Lines step until a book re-posts. Hover a book for its source.<'));   // founder Q24 (2026-09-30): kept
  // founder Q23 (2026-09-30): the Market / No-vig hints are the shared tooltip (data-aotip), never a native title.
  // Mutation 'Q23: a native title on the price-mode hints'.
  const hints = h.split('<span class="aox-seg"').slice(1).map(x => x.slice(0, x.indexOf('</span>')))   // (onkeydown carries "=>")
    .map(x => [x.slice(0, x.lastIndexOf('>')), x.slice(x.lastIndexOf('>') + 1)]);
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
  assert.ok(/class="aox-row" data-book="Bet105" data-group="soft"/.test(A.buildOddsSection(m)));
});

test('a completed or started match never reads "no recent data"', () => {
  const A = build();
  const m = fixture({ superbetChecked: Date.now() - 5 * H });
  m.finalScore = { winner: 'p1' };
  A.open(m);
  assert.ok(!A.buildOddsSection(m).includes('aox-stale'));
});

test('no carry-forward past checkedAt: the line ends at the last check, not the chart edge', () => {
  const now = Date.now();
  const A = build();
  const m = fixture({ now, superbetChecked: now - 2 * H });
  const sb = A.aOddsRowsOf(m, { nowMs: now }).rows.find(r => r.name === 'Superbet');
  assert.equal(sb.end, now - 2 * H, 'Superbet ends at its checkedAt');
  const pin = A.aOddsRowsOf(m, { nowMs: now }).rows.find(r => r.name === 'Pinnacle');
  assert.equal(pin.end, now - 4 * 60e3);
  // the pop-up x axis runs first tick -> last check: the end dot sits on the right edge (x = 468)
  A.open(m); A.state().mv = 'Superbet';
  const h = A.buildOddsSection(m);
  const dots = [...h.matchAll(/<circle cx="([\d.]+)"/g)].map(x => +x[1]);
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
  assert.ok(!/aox-nodata/.test(h) && !/>0\.00</.test(h), 'no dash row, never a zero');
  // nothing at all -> the reduced view + one line, no rows
  const h0 = A.buildOddsSection({ id: 'x', p1: 'A. B', p2: 'C. D', date: '2026-10-01', time: '10:00', oddsMovement: null, _oddsLoaded: true });
  assert.ok(h0.includes('REDUCED') && !/class="aox-row/.test(h0) && h0.includes('>No bookmaker has odds for this match yet.<'));
  // before the lazy shard lands: a loading line, no verdict rows, no reduced view
  const hl = A.buildOddsSection({ id: 'x', p1: 'A. B', p2: 'C. D', date: '2026-10-01', time: '10:00' });
  assert.ok(hl.includes('aox-loading') && !hl.includes('aox-row') && !hl.includes('REDUCED'));
});

test('a book gone from the feed reads "Not in feed since", no Now, never best', () => atClock(Date.parse('2026-09-28T12:00:00Z'), () => {
  // TEN-345: pinned — see 1c. `now - 2h` crosses the Berlin day 22:00Z→00:00Z and the tip rightly adds the date.
  const now = Date.now();
  const A = build();
  const m = fixture({ now, withAt: true });
  m.oddsMovement.chart.books['Betano'] = { p1: [[iso(now - 5 * H), 9.9]], p2: [[iso(now - 5 * H), 9.9]] };
  m.oddsMovement.chart.meta['Betano'].gaps = [[iso(now - 2 * H), null]];
  A.open(m);
  const h = A.buildOddsSection(m);
  const row = rowHtml(h, 'Betano');
  assert.equal(cellTxt(row, 'aox-now', 'a'), '\u2014');
  assert.ok(!/>9\.90</.test(row.replace(/class="aox-open"[^<]*<\/span>/, '')) || cellTxt(row, 'aox-open', 'a') === '9.90');
  assert.ok(/Not in feed since \d\d:\d\d/.test(tipOf(h, 'Betano')), tipOf(h, 'Betano'));
}));

test('start time: in-play points never draw (the page start is aOddsStartMs)', () => {
  const A = build();
  const m = { id: 'past-1', p1: 'A. B', p2: 'C. D', date: '2026-09-24', time: '14:00', finalScore: '6-4 6-4',
    oddsMovement: { capturedAt: '2026-09-24T13:30:00.000Z', books: { bet365: {
      p1: [['2026-09-24T09:00:00.000Z', 2.0], ['2026-09-24T13:00:00.000Z', 9.5]],
      p2: [['2026-09-24T09:00:00.000Z', 1.8], ['2026-09-24T13:00:00.000Z', 1.05]] } } } };
  A.open(m);
  const h = A.buildOddsSection(m);
  assert.ok(!/>9\.50</.test(h) && !/>1\.05</.test(h), 'the 13:00Z in-play tick is not shown');
  assert.equal(cellTxt(rowHtml(h, 'bet365'), 'aox-now', 'a'), '2.00');
});

test('pop-up: real window, stat boxes from the real series (earliest on ties), book tabs in table order', () => {
  const now = Date.parse('2026-09-27T08:00:00Z');
  atClock(now, () => {
  const A = build();
  const m = fixture({ now, withAt: true });
  m.oddsMovement.chart.books['Pinnacle +30s'].p1 = [[iso(now - 20 * H), 2.5], [iso(now - 10 * H), 2.6], [iso(now - 6 * H), 2.6], [iso(now - 2 * H), 2.35]];
  A.open(m); A.state().mv = 'Pinnacle';
  const D = A.aOddsRowsOf(m, { nowMs: now });
  const h = A.buildOddsSection(m);
  const mv = h.slice(h.indexOf('aox-mv-overlay"'));
  assert.ok(mv.includes('Odds movement \u00b7 Decimal odds \u00b7 as quoted \u00b7 since 26 Sep, 14:00'), 'since = first tick (Europe/Brussels)');
  assert.ok(/>sharp \u00b7 margin 2\.9%</.test(mv));
  const stats = [...mv.matchAll(/class="aox-stat"[^>]*>([^<]*)<\/span><span[^>]*>([^<]*)</g)].map(x => [x[1], x[2]]);
  // p1: OPENING 2.50 (26 Sep 12:00Z), HIGHEST 2.60 twice -> the EARLIER (22:00Z), LOWEST 2.35 (06:00Z); Europe/Brussels
  assert.deepEqual(stats.slice(0, 3), [['2.50', '26 Sep, 14:00'], ['2.60', '27 Sep, 00:00'], ['2.35', '27 Sep, 08:00']]);
  assert.ok(/class="aox-chg"[^>]*>\u22126\.0%</.test(mv), '% change (now - open) / open, the true minus (brief hard rule)');
  const tabs = [...mv.matchAll(/class="aox-seg aox-tab"[^>]*data-book="([^"]*)"/g)].map(x => x[1]);
  assert.deepEqual(tabs, D.rows.filter(r => !r.noData).map(r => r.name), 'one tab per row with a line, table order, stale included');
  // no hard-coded "last 72 hours", no Catmull-Rom
  assert.ok(!mv.includes('72 hours') && !/class="aox-line" d="[^"]*C/.test(mv));
  });
});

// ── review fold-in (clean-context review 2026-09-27) ─ mutants: the last pair reused as a no-vig NOW; pairing
//    without the gap check; only the first tied book green; STEAM threshold ignored; the pop-up x axis by tick index;
//    a legacy "<Book> (Oddspapi)" key as its own row ──
test('no-vig: a latest tick with no matched pair (inside a gap) reads "—", never the last pair', () => {
  const now = Date.now();
  const A = build();
  const m = fixture({ now, withAt: true });
  m.oddsMovement.chart.books['Betano'] = { p1: [[iso(now - 5 * H), 2.5], [iso(now - 3 * H), 2.6]], p2: [[iso(now - 5 * H), 1.55]] };
  m.oddsMovement.chart.meta['Betano'].gaps = [[iso(now - 4 * H), iso(now - 2 * H)]];   // closed: the book is back in its feed
  const row = A.aOddsRowsOf(m, { nowMs: now, novig: true }).rows.find(r => r.name === 'Betano');
  assert.equal(row.stale, false);
  assert.deepEqual(row.ticks.map(t => t.pair), [true, false], 'a tick inside a gap has no pair');
  assert.equal(row.aNow, null); assert.equal(row.bNow, null);
  A.open(m); A.state().novig = true;
  const h = A.buildOddsSection(m);
  assert.equal(cellTxt(rowHtml(h, 'Betano'), 'aox-now', 'a'), '\u2014');
});

test('best price: every tied live book is best, and none is green (founder R4/R6.1: best price is neutral)', () => {
  const A = build();
  const m = fixture({ withAt: true });
  m.oddsMovement.chart.books['Betano'].p1[0][1] = 2.46;   // ties Betfair Exchange's 2.46 at the top
  m.oddsMovement.chart.books['Superbet'].p1[0][1] = 2.3;
  A.open(m);
  const h = A.buildOddsSection(m);
  assert.deepEqual(A.aOddsRowsOf(m, { nowMs: Date.now() }).rows.filter(r => r.aBest).map(r => r.name).sort(), ['Betano', 'Betfair Exchange']);
  const best = ['Betano', 'Betfair Exchange'].map(b => colorOf(rowHtml(h, b), 'aox-now', 'a'));
  assert.deepEqual(best, [A.AODDS_C.text, A.AODDS_C.text], 'white like every price, never green');
});

// founder R4 (TEN-376): only the clicked Per-book row is marked — --inner + 10% edge — and only while its pop-up is open.
//    mutant: the mark sticks after close, or lands on every row
test('the clicked book row = --inner + --edge-10, the only marked row, cleared on close', () => {
  const now = Date.now();
  const A = build(); const m = fixture({ now, withAt: true }); A.open(m);
  const marked = h => rowsOf(h).filter(r => /class="aox-row[^"]*\baox-on\b/.test(h.slice(h.lastIndexOf('<div', h.indexOf('data-book="' + r.book + '"'))))).map(r => r.book);
  assert.deepEqual(marked(A.buildOddsSection(m)), [], 'nothing marked before a click');
  A.aOddsOpenMv('Pinnacle');
  const h = A.section();
  assert.deepEqual(marked(h), ['Pinnacle']);
  const row = h.slice(h.lastIndexOf('<div', h.indexOf('data-book="Pinnacle"')));
  assert.match(row.slice(0, 900), /background:var\(--inner\); border:1px solid var\(--edge-10\)/);
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
  // p1 flat as quoted, p2 shortened: stripping the margin makes p1 "drift" — STEAM must still read the market
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
  // uneven ticks: index spacing would put the middle label at the 3rd tick (00:10), time spacing at 04:00Z
  const s = [[t0, 1.5], [t0 + 5 * 60e3, 1.6], [t0 + 10 * 60e3, 1.7], [t0 + 15 * 60e3, 1.8], [t0 + 8 * H, 1.9]];
  const svg = A.aOddsMvChart(s, '#6A9AF8', t0, t0 + 8 * H, []);
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
  const rows = rowsOf(A.buildOddsSection(m));
  assert.equal(rows.filter(r => /Pinnacle/.test(r.book)).length, 1);
  const pin = A.aOddsRowsOf(m, { nowMs: now }).rows.find(r => r.name === 'Pinnacle');
  assert.equal(pin.key, 'Pinnacle +30s (Oddspapi)');
  delete m.oddsMovement.chart.books['Pinnacle +30s'];
  assert.equal(A.aOddsRowsOf(m, { nowMs: now }).rows.find(r => r.name === 'Pinnacle').key, 'Pinnacle (Oddspapi)');
});

// ── founder ruling 2026-09-27 (comment fdf4bb3f): a book counts toward n only if |now − open| / open ≥ minMovePct ──
//    mutant: the minimum-move filter dropped from the STEAM count (`&& bigMove(nw, op)` removed) ──
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
  assert.ok(!A.buildOddsSection(five(1.41)).includes('aox-steam'), 'no chip rendered');
  // control: the same five books moving 1.40 → 1.45 (+3.6%) do show it
  assert.equal(A.aOddsRowsOf(five(1.45), { nowMs: now }).steam.text, '5 of 5 books drifted on J. Sinner');
});

// ── founder pick 2026-09-27 (TEN-303 question card): SHIPPED default X = 5%, 3 books, on displayed prices ──
//    mutant: AODDS_STEAM.minMovePct back to 3 (the +3.6% case shows STEAM) ──
test('STEAM shipped default: X = 5% with 3 books — +3.6% moves do not count, +5.7% do, and a 3-of-5 mix counts only the big movers', () => {
  const now = Date.now();
  const A = build();                                  // the SHIPPED config
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
  // displayed-price basis (founder pick): 1.40 → 1.4695 (+4.96% raw) is shown as 1.47 (+5.0%) and counts
  assert.equal(A.aOddsRowsOf(mk([1.4695, 1.4695, 1.4695, 1.40, 1.40]), { nowMs: now }).steam.text, '3 of 5 books drifted on J. Sinner');
});

// ── founder follow-up 2026-09-27 (comment 2b0ef96f) 1a: the charts draw exactly what is stored ──
// Parse a step/line path into its vertices [x, y] (M / H / V / L commands).
function vertices(d) {
  const out = []; let x = null, y = null;
  for (const tok of d.split(/(?=[MHVLZ])/)) {
    const c = tok[0], a = tok.slice(1).trim().split(/[ ,]+/).filter(Boolean).map(Number);
    if (c === 'M' || c === 'L') { x = a[0]; y = a[1]; } else if (c === 'H') x = a[0]; else if (c === 'V') y = a[0]; else continue;
    out.push([c, x, y]);
  }
  return out;
}
//    mutants: a gap breaks the line again (a second M) · the flat run is interpolated (an L / slope) ──
test('1a: a stored series with a 3-hour no-change gap (and a feed gap) draws ONE flat segment — no break, no interpolated point', () => {
  const now = Date.parse('2026-09-27T08:00:00Z');
  atClock(now, () => {
  const A = build();
  const t0 = now - 8 * H;
  const s = [[t0, 2.50], [t0 + 1 * H, 2.40], [t0 + 4 * H, 2.60]];     // 2.40 held for 3 h, then 2.60
  const X = t => (t - t0) / 36e3, Y = v => 1000 - v * 100;
  const P = A.aOddsLinePaths(s, t0, t0 + 6 * H, X, Y, 1000);
  assert.equal((P.line.match(/M/g) || []).length, 1, 'one line, no break: ' + P.line);
  assert.ok(!/[LC]/.test(P.line), 'no slope, no curve: ' + P.line);
  const v = vertices(P.line);
  const flat = v.findIndex(p => p[0] === 'H' && Math.abs(p[1] - X(t0 + 4 * H)) < 0.06 && Math.abs(p[2] - Y(2.40)) < 0.06);
  assert.ok(flat > 0 && Math.abs(v[flat - 1][1] - X(t0 + 1 * H)) < 0.06, 'one H from the 2.40 tick to the next tick at 2.40: ' + P.line);
  assert.ok(Math.abs(P.end[0] - X(t0 + 6 * H)) < 0.06, 'ends at the last check');
  // the same through the page renderer: a row whose source dropped the book for 2 h inside that 3 h
  const m = fixture({ now, withAt: true });
  m.oddsMovement.chart.books['Pinnacle +30s'].p1 = s.map(p => [iso(p[0]), p[1]]);
  m.oddsMovement.chart.meta['Pinnacle +30s'].gaps = [[iso(t0 + 1.5 * H), iso(t0 + 3.5 * H)]];
  A.open(m);
  A.state().mv = 'Pinnacle';
  const mv = A.buildOddsSection(m); const pd = /class="aox-line" d="([^"]+)"/.exec(mv.slice(mv.indexOf('aox-mv-overlay"')))[1];
  assert.equal((pd.match(/M/g) || []).length, 1, 'pop-up: one line across the feed gap: ' + pd);
  });
});
//    mutant: the raw (unrounded) price is plotted — 1.4695 draws at 1.4695, not 1.47 ──
test('1a: every plotted y-value is a stored price at display precision (the NOW column rounding)', () => {
  const A = build();
  const t0 = Date.parse('2026-09-26T00:00:00Z');
  const s = [[t0, 1.4695], [t0 + 1 * H, 1.4712], [t0 + 2 * H, 1.52], [t0 + 3 * H, 1.068], [t0 + 4 * H, 2.345]];
  const allowed = new Set(s.map(p => +A.aOddsFmt(p[1])));          // the NOW column's own formatter
  const X = t => (t - t0) / 36e3, Y = v => 1000 - v * 100;
  const back = y => Math.round((1000 - y) * 10) / 1000;              // path y has 1 decimal → v to 3 dp
  const P = A.aOddsLinePaths(s, t0, t0 + 5 * H, X, Y, 1000);
  const ys = vertices(P.line).map(p => back(p[2]));
  for (const v of ys) assert.ok(allowed.has(v), `y ${v} is not a stored price at display precision (${[...allowed]})`);
  assert.ok(ys.includes(1.47) && !ys.includes(1.4695) && !ys.includes(1.4712), 'raw 1.4695 / 1.4712 draw as the displayed 1.47');
  // 1.4695 and 1.4712 both display 1.47: one flat run, not a step between them
  assert.equal(vertices(P.line).filter(p => p[0] === 'V').length, 3, 'three changes after rounding: 1.47 → 1.52 → 1.068 → the 2.345 tick');
});
// ── founder follow-up 1b: ONE missing-price mark on the tab, the design's DASH, defined once ──
//    mutants: a stale NOW rendered with U+2013 · a second literal dash in the tab's code ──
test('1b: every missing price on the tab (NOW, NET, margin, pop-up header, stat boxes) is AODDS_DASH (U+2014), defined once', () => {
  const now = Date.now();
  const A = build();
  const m = fixture({ now, withAt: true });
  m.oddsMovement.chart.meta['Betano'].gaps = [[iso(now - 2 * H), null]];          // stale: NOW / NET dashed
  A.open(m);
  const h = A.buildOddsSection(m);
  const row = rowHtml(h, 'Betano');
  for (const x of ['a', 'b']) { assert.equal(cellTxt(row, 'aox-now', x), '\u2014'); assert.equal(cellTxt(row, 'aox-move', x), '\u2014'); }
  A.state().mv = 'Betano';
  const all = A.buildOddsSection(m);
  // (U+2212 is no longer banned here: TEN-380 signs a negative move with the true minus, as the brief's hard rule)
  assert.ok(!/[\u2013\u2012]/.test(all.replace(/<svg[\s\S]*?<\/svg>/g, '')), 'no en dash / figure dash as a value mark');
  // defined once: no dash literal in the tab's functions — every one goes through AODDS_DASH
  const code = FNS.map(n => slice(n)).join('\n').replace(/\/\/[^\n]*/g, '');
  const lits = code.match(/'[^'\n]*\u2014[^'\n]*'|"[^"\n]*\u2014[^"\n]*"/g) || [];
  assert.deepEqual(lits.filter(l => !/ \u2014 /.test(l)), [], 'a value dash literal outside AODDS_DASH');
  assert.equal(constSrc('AODDS_DASH').trim(), "const AODDS_DASH = '\\u2014';");
});
// ── founder follow-up 1c: ALSO reads "<feed> · <status>", in the tooltip's label/value styling ──
//    mutant: the ALSO value keeps the source key ("Pinnacle (api-tennis) · …") ──
test('1c: the tooltip ALSO line reads "api-tennis · not in feed since HH:MM"', () => atClock(Date.parse('2026-09-28T12:00:00Z'), () => {
  // TEN-345: pinned. On the live clock, `now - 2h` falls on the PREVIOUS Berlin day from 22:00Z to 00:00Z,
  // the renderer rightly prints "28 Sep, 23:47", and this gate redded every pipeline run 22:40Z→00:00Z.
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
//    mutant: the stat boxes read raw prices again (1.404 beats 1.401 though both show 1.40) ──
test('pop-up stat boxes: HIGHEST / LOWEST compare displayed prices; a displayed tie keeps the earliest time', () => {
  const now = Date.parse('2026-09-27T08:00:00Z');
  atClock(now, () => {
  const A = build();
  const m = fixture({ now, withAt: true });
  m.oddsMovement.chart.books['Pinnacle +30s'].p1 = [[iso(now - 20 * H), 1.30], [iso(now - 10 * H), 1.401], [iso(now - 6 * H), 1.404], [iso(now - 2 * H), 1.35]];
  A.open(m); A.state().mv = 'Pinnacle';
  const h = A.buildOddsSection(m);
  const mv = h.slice(h.indexOf('aox-mv-overlay"'));
  const stats = [...mv.matchAll(/class="aox-stat"[^>]*>([^<]*)<\/span><span[^>]*>([^<]*)</g)].map(x => [x[1], x[2]]);
  assert.deepEqual(stats[1], ['1.40', '27 Sep, 00:00'], 'HIGHEST = the first 1.40 (10 h before now, Europe/Brussels)');
  });
});
// ── founder card 9e0ac649 (2026-09-27): a book out of its feed holds its last caught price to the LAST CHECK ──
//    mutant: the line stops at the 'not in feed since' time (the open gap's start) ──
test('a book with an open feed gap holds its last price flat to the last check, not to "not in feed since"', () => {
  const now = Date.parse('2026-09-27T08:00:00Z');
  atClock(now, () => {
    const A = build();
    const m = fixture({ now, withAt: true });
    m.oddsMovement.chart.books['Betano'] = { p1: [[iso(now - 6 * H), 2.5], [iso(now - 4 * H), 2.4]], p2: [[iso(now - 6 * H), 1.6], [iso(now - 4 * H), 1.65]] };
    m.oddsMovement.chart.meta['Betano'].gaps = [[iso(now - 3 * H), null]];         // pulled 3 h ago
    m.oddsMovement.chart.meta['Betano'].checkedAt = iso(now - 2 * 60e3);           // still checked 2 min ago
    // the row's end drives both charts (sparkline span, pop-up axis t1): it is the last check, not the pull time
    const r = A.aOddsRowsOf(m, { nowMs: now }).rows.find(x => x.name === 'Betano');
    assert.ok(r.stale && r.pulled === now - 3 * H, 'the book is out of its feed');
    assert.equal(r.end, now - 2 * 60e3, 'the line runs to the last check');
    // and the pop-up axis ends there: its last x label is the last check's clock (Europe/Brussels = UTC+2)
    A.open(m); A.state().mv = 'Betano';
    const mv = A.buildOddsSection(m); const xs = [...mv.slice(mv.indexOf('aox-mv-overlay"')).matchAll(/class="aox-xt"[^>]*>([^<]+)</g)].map(x => x[1]);
    assert.equal(xs[4], '09:58', 'the pop-up x axis ends at the last check: ' + xs);
  });
});

// TEN-380 / Q10 (founder 2026-10-03, parked as recommended): the Match Winner tile = the CARD's one book — its Now and the
// move against that same book's Open (one book per fixture); missing = dash; a leg below the 1.01 floor is suppressed.
//    mutants: the tile shows the best price across books · the move against another book's open · the floor dropped
test('Q10: the Match Winner tile is the card book (Now, and the move vs the same book\'s Open); dashes when absent', () => {
  const now = Date.now();
  const A = build(); const m = fixture({ now, withAt: true });
  const tileOf = h => { const i = h.indexOf('data-market="Match Winner"'); return h.slice(i, h.indexOf('class="aox-head"', i)); };
  const px = (t, x) => (new RegExp(`class="aox-tile-px" data-side="${x}" style="[^"]*">([^<]*)<`).exec(t) || [])[1];
  const mv = (t, x) => (new RegExp(`class="aox-tile-mv" data-side="${x}" style="[^"]*color:([^;"]+)[^"]*">([^<]*)<`).exec(t) || []).slice(1);
  // no card row → both prices dashed, no move (never the best price of the table: Betano's 2.50 / Betfair Exchange's 1.67)
  A.open(m); let t = tileOf(A.buildOddsSection(m));
  assert.deepEqual([px(t, 'a'), px(t, 'b')], ['\u2014', '\u2014']);
  assert.ok(!t.includes('aox-tile-mv'));
  // the card's book (Bet105 here): its Now, and Now − its OWN Open with the true minus
  m.__testOcs = { book: 'bet105', p1: { open: 2.40, now: 2.30, close: null }, p2: { open: 1.62, now: 1.70, close: null } };
  A.open(m); const h = A.buildOddsSection(m); t = tileOf(h);
  assert.deepEqual([px(t, 'a'), px(t, 'b')], ['2.30', '1.70']);
  assert.deepEqual(mv(t, 'a'), [A.AODDS_C.dn, '\u22120.10']);
  assert.deepEqual(mv(t, 'b'), [A.AODDS_C.up, '+0.08']);
  const onFile = A.aOddsRowsOf(m, { nowMs: now }).rows.filter(r => !r.noData).length;
  assert.ok(t.includes(`>${onFile} bk<`), 'TEN-380 review F4: the count = the books with a price on record (stale included), never 0 beside a price');
  assert.ok(new RegExp(`class="aox-meta"[^>]*>Match Winner \\u00b7 ${onFile} books \\u00b7 as quoted<`).test(h), 'the header meta');
  assert.ok(unesc(/data-aotip="([^"]*)"/.exec(t)[1]).includes('>bet105<'), 'the tile names its book on hover');
  // the Kibl stream, where newer, is the card's Now (same book)
  m.__testStream = { p1: 2.26, p2: 1.72, book: 'bet105' };
  A.open(m); t = tileOf(A.buildOddsSection(m));
  assert.deepEqual([px(t, 'a'), px(t, 'b')], ['2.26', '1.72']);
  delete m.__testStream;
  // a genuine zero move reads 0.00 in grey; a leg below the floor (1.005) is a dash and has no move
  m.__testOcs = { book: 'bet105', p1: { open: 2.30, now: 2.30 }, p2: { open: 1.62, now: 1.005 } };
  A.open(m); t = tileOf(A.buildOddsSection(m));
  assert.deepEqual(mv(t, 'a'), [A.AODDS_C.label, '0.00']);
  assert.equal(px(t, 'b'), '\u2014'); assert.deepEqual(mv(t, 'b'), []);
  // a missing open: the price stands, the move is absent (never against another book's open)
  m.__testOcs = { book: 'bet105', p1: { open: null, now: 2.30 }, p2: { open: null, now: 1.70 } };
  A.open(m); t = tileOf(A.buildOddsSection(m));
  assert.deepEqual([px(t, 'a'), mv(t, 'a').length], ['2.30', 0]);
});

// TEN-380 review item 4 (founder 2026-10-04, one book per fixture): Key factors' Odds box prints the card's book — the same
// Open and Now as the Match Winner tile (and the header) — never the box's own book order (Pinnacle first). Mutation: the
// card-book branch dropped from kfOddsBook (the box goes back to Pinnacle).
test('review item 4: Key factors Odds box = the card book (Open + Now as the tile), stream Now when newer; no card → the box order', () => {
  const now = Date.now();
  const A = build(); const m = fixture({ now, withAt: true });
  const before = A.kfOddsMove(m).row;
  assert.ok(before && !/bet105/i.test(before.name), 'no card state: the box picks by its own order (control)');
  m.__testOcs = { book: 'bet105', label: 'Bet105', p1: { open: 2.40, now: 2.30, close: null }, p2: { open: 1.62, now: 1.70, close: null } };
  let r = A.kfOddsMove(m).row;
  assert.deepEqual([r.name, r.aOpen, r.aNow, r.bOpen, r.bNow], ['Bet105', 2.40, 2.30, 1.62, 1.70], 'the card book, its own Open and Now');
  m.__testStream = { p1: 2.26, p2: 1.72, book: 'bet105' };
  r = A.kfOddsMove(m).row;
  assert.deepEqual([r.aNow, r.bNow], [2.26, 1.72], 'the newer stream tick, as the tile and the match card');
  // and the per-book table's card-book row prints the same Now (live, not "no recent data"); other books keep their own
  const row = A.aOddsRowsOf(m, { nowMs: now }).rows.find(x => x.name === 'Bet105');
  assert.deepEqual([row.aNow, row.bNow, row.stale], [2.26, 1.72, false], 'the table row = the card pair');
  const pin = A.aOddsRowsOf(m, { nowMs: now }).rows.find(x => x.name === 'Pinnacle');
  assert.ok(pin && pin.aNow !== 2.26, 'another book never takes the card stream');
  delete m.__testStream; delete m.__testOcs;
});

// TEN-380 reference: one-row header, one flat panel, option-A head, "open → now" rows; the legend has no "lifted price".
//    mutants: the per-row sparkline back · the legend keeps the lifted-price clause · the names leave the Open→Now block
test('TEN-380 table: option-A head over Open → Now + Move, one flat panel, the legend line without "lifted"', () => {
  const now = Date.now();
  const A = build(); const m = fixture({ now, withAt: true }); A.open(m);
  const h = A.buildOddsSection(m);
  const heads = [...h.matchAll(/<span class="aox-phead" style="grid-column:span 2; justify-self:end; display:grid; grid-template-columns:auto 56px;[^"]*"><span style="grid-column:1 \/ -1;[^"]*border-bottom:1px solid var\(--line\)[^"]*">([^<]*)<\/span><span [^>]*>Open \u2192 Now<\/span><span [^>]*>Move<\/span><\/span>/g)].map(x => x[1]);
  assert.deepEqual(heads, ['J. Sinner', 'C. Alcaraz'], 'each name sits on its rule over its own Open → Now + Move');
  assert.equal((h.match(/class="aox-table"/g) || []).length, 1, 'one panel');
  assert.match(h, /class="aox-table" style="[^"]*background:var\(--card\); border:1px solid var\(--edge-6\); border-radius:14px;/);
  assert.ok(!/<svg/.test(h), 'no sparkline anywhere in the table');
  assert.equal(cellTxt(rowHtml(h, 'Pinnacle'), 'aox-open', 'a'), '2.50');
  assert.match(rowHtml(h, 'Pinnacle'), /class="aox-open" data-side="a"[^>]*>2\.50<\/span><span [^>]*>\u2192<\/span><span class="aox-now" data-side="a"/);
  const leg = /class="aox-legend"[^>]*>([^<]*)</.exec(h);
  assert.ok(leg && /^Open \u2192 now per book, move in percent\./.test(leg[1]) && !/lifted/i.test(h), leg && leg[1]);
  // the group labels: caps, no trailing rule
  assert.ok(!/class="aox-grouphead"[^>]*>[\s\S]{0,400}?flex:1; height:1px/.test(h.slice(h.indexOf('aox-grouphead'), h.indexOf('aox-grouphead') + 500)));
});

// founder Q2 (2026-10-03): the pop-up chart = A --bar, B --white-bar, dotted horizontal guides only (--viz-guide, dash 2 6),
// no area fill, no vertical day line. mutants: A back on --text · the guides dashed 4 4 · an area path back
test('Q2: odds pop-up chart — A --bar, B --white-bar, dotted guides only, no fill, no vertical lines', () => {
  const now = Date.parse('2026-09-27T08:00:00Z');
  atClock(now, () => {
    const A = build(); const m = fixture({ now, withAt: true }); A.open(m); A.state().mv = 'Pinnacle';
    const h = A.buildOddsSection(m), mv = h.slice(h.indexOf('aox-mv-overlay"'));
    const lines = [...mv.matchAll(/class="aox-line" d="[^"]*" fill="none" style="stroke:([^"]+)"/g)].map(x => x[1]);
    assert.deepEqual(lines, ['var(--bar)', 'var(--white-bar)']);
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

// TEN-335 / TEN-366 — the odds pop-up IS the shared frame (maPopFrame, variant 'mv'; TEN-314): the overlay is a .ma-pop-overlay whose ✕ (.ma-pop-x) closes it,
// so the one Esc listener (maPopEscKey) closes it; the design's geometry (1080px, radius 18, centred) is kept. It enters
// with .ma-fade / .ma-sigin when it OPENS, never on a book-tab switch or a re-render.
// Mutations (tools/test-ten303-mutants.js): the pop-up builds its own frame (not maPopFrame); the ✕ loses ma-pop-x; the mv variant
// falls back to the std geometry; the entrance never
// plays; the entrance replays on a book-tab switch; the open flag is never cleared (a re-render replays it).
test('TEN-335 pop-up: a shared frame (Esc through maPopEscKey), entrance motion only when it opens', () => {
  const now = Date.parse('2026-09-27T08:00:00Z');
  atClock(now, () => {
    const A = build(); const m = fixture({ now, withAt: true }); A.open(m);
    A.aOddsOpenMv('Pinnacle');
    let h = A.section();
    assert.match(h, /class="ma-pop-overlay ma-fade aox-mv-overlay" onclick="if\(event.target===this\)\{aOddsCloseMv\(\)\}" style="position:fixed; inset:0 0 0 var\(--sf-side, 0px\); z-index:60; background:var\(--backdrop\); backdrop-filter:blur\(3px\); display:flex; align-items:center;/, 'the overlay is the shared frame (maPopFrame), fading in, centred on the one scrim (TEN-376 U5: --backdrop + blur)');
    assert.match(h, /class="ma-pop ma-sigin aox-mv" role="dialog" aria-modal="true" aria-label="Odds movement" onclick="event.stopPropagation\(\)" style="width:100%; max-width:1080px; background:var\(--card\); border:1px solid var\(--(?:line|edge-\d+)\); border-radius:18px; box-shadow:var\(--shadow-pop\);/, 'the box enters with sigIn; the design geometry (DF L1907) is the frame\'s mv variant (TEN-376: --card, 1px edge, --shadow-pop)');
    const x = /class="ma-pop-x aox-seg aox-x"[^>]*onclick="([^"]*)" style="width:32px; height:32px;/.exec(h);
    assert.ok(x, 'the ✕ is the frame\'s ma-pop-x (what maPopEscKey clicks)'); assert.equal(x[1], 'aOddsCloseMv()');
    A.renderOddsSection();
    assert.ok(!/ma-fade|ma-sigin/.test(A.section()), 'a re-render with the pop-up open does not replay the entrance');
    A.aOddsOpenMv('Bet105');
    h = A.section();
    assert.ok(h.includes('class="ma-pop-overlay aox-mv-overlay" onclick') && h.includes('class="ma-pop aox-mv" role="dialog"'), 'a book-tab switch does not replay it');
    assert.ok(/class="ma-pop-title aox-mv-title" tabindex="0" data-aotip="[^"]*" style="font-size:18px; font-weight:800;">Bet105</.test(h), 'the switch happened');
    A.aOddsCloseMv(); assert.ok(!A.section().includes('ma-pop-overlay'), 'closed');
    A.aOddsOpenMv('Pinnacle'); assert.ok(A.section().includes('ma-pop-overlay ma-fade'), 'reopening plays the entrance again');
  });
});
