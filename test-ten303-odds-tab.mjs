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
const unesc = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tipOf = (h, book) => { const r = rowHtml(h, book); const mm = /class="aox-book"[\s\S]*?data-aotip="([^"]*)"/.exec(r); return mm ? unesc(mm[1]) : ''; };

// ── §6 test 1 ─ mutants: a stale "now" kept (drop `row.stale ? null :`); best over all books (drop `!r.stale`);
//    STEAM counting every book (moving = rows) ──
test('§6.1 a stale book: NOW and NET "—", never green, outside STEAM n and N', () => {
  const now = Date.now();
  const A = build(undefined, { AODDS_STEAM: '{ minBooks: 3, minShareOfN: 0, minMovePct: 0 }' });
  const m = fixture({ now, withAt: true, superbetChecked: now - 2 * H });   // Superbet: last check 2 h ago, the HIGHEST p1 (2.60)
  A.open(m);
  const h = A.buildOddsSection(m);
  const sb = rowHtml(h, 'Superbet');
  assert.ok(/class="aox-row aox-stale"/.test(h.slice(h.lastIndexOf('<div', h.indexOf('data-book="Superbet"')))), 'Superbet is the stale row');
  for (const x of ['a', 'b']) {
    assert.equal(cellTxt(sb, 'aox-now', x), '\u2014', `NOW ${x} is a dash`);
    assert.equal(cellTxt(sb, 'aox-net', x), '\u2014', `NET ${x} is a dash`);
    assert.equal(colorOf(sb, 'aox-now', x), A.AODDS_C.label);
  }
  assert.ok(sb.includes('>no recent data<'), 'margin line reads "no recent data"');
  assert.ok(sb.includes('opacity:0.4'), 'sparkline at 40%');
  assert.ok(sb.includes('onclick="aOddsOpenMv'), 'the row still opens the pop-up');
  // best p1 among LIVE books = 2.50 (Betano); the stale 2.60 never wins
  const greens = rowsOf(h).filter(r => colorOf(rowHtml(h, r.book), 'aox-now', 'a') === A.AODDS_C.up).map(r => r.book);
  assert.deepEqual(greens, ['Betano']);
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
  assert.ok(A.buildOddsSection(m2).includes('>3 of 3 books shortened on J. Sinner<'), 'the chip renders it');
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
  assert.equal(cellTxt(row, 'aox-net', 'a'), '-0.15', 'net: a hyphen, never U+2212');
  assert.equal(cellTxt(row, 'aox-net', 'b'), '+0.08');
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
  assert.ok(h.includes('>margin removed<') && h.includes('No-vig prices, margin stripped.'));
  // Bet105 pairs across timestamps: 4 ticks, the first (p1 only) unpaired
  const b105 = D.rows.find(r => r.name === 'Bet105');
  assert.deepEqual(b105.ticks.map(t => t.pair), [false, true, true, true]);
  // Market mode margin = 1/a + 1/b - 1 on the current pair: Pinnacle 1/2.35 + 1/1.657 - 1 = 2.9%
  const Dm = A.aOddsRowsOf(m, { nowMs: now });
  assert.equal((Dm.rows.find(r => r.name === 'Pinnacle').margin * 100).toFixed(1), '2.9');
});

// ── §6 test 4 ─ mutant: aOddsSetMarket without its `recorded` guard / a disabled tile given an onclick ──
test('§6.4 the disabled market tiles do not change the table when clicked', () => {
  const A = build();
  const m = fixture({ withAt: true });
  A.open(m); A.renderOddsSection();
  const before = A.section();
  const tiles = [...before.matchAll(/<div class="aox-tile[^"]*" data-market="([^"]*)"([^>]*)>/g)];
  assert.equal(tiles.length, 7);
  assert.deepEqual(tiles.map(t => t[1]), ['Match Winner', '1st set winner', 'Game handicap', 'Total games', 'Set betting', 'Set handicap', 'Tiebreak in match']);
  for (const t of tiles.slice(1)) {
    assert.ok(!/onclick=/.test(t[2]) && /cursor:default/.test(t[2]) && /aria-disabled="true"/.test(t[2]), `${t[1]} is inert`);
    assert.ok(unesc(/data-aotip="([^"]*)"/.exec(t[2])[1]).includes('Not recorded yet \u2014 Match Winner only.'));
    A.aOddsSetMarket(t[1]);
    assert.equal(A.state().market, 'Match Winner');
    assert.equal(A.section(), before, `clicking ${t[1]} leaves the tab unchanged`);
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
test('rows: one per bookmaker, plain names, SHARP then SOFT, live first then stale then no-data', () => {
  const now = Date.now();
  const A = build();
  const m = fixture({ now, withAt: true, superbetChecked: now - 2 * H });
  A.open(m);
  const h = A.buildOddsSection(m);
  assert.deepEqual([...h.matchAll(/class="aox-grouphead" data-group="([^"]*)"/g)].map(x => x[1]), ['sharp', 'soft']);
  const rows = rowsOf(h);
  assert.deepEqual([...new Set(rows.map(r => r.group))], ['sharp', 'soft']);
  // exact order: SOFT live (Betano) first, then stale (bet365 legacy capture 26 h old, Superbet), then no-data in config order
  assert.deepEqual(rows.map(r => r.book), ['Pinnacle', 'Betfair Exchange', 'Bet105', 'Betano', 'bet365', 'Superbet',
    'Betfair', 'BetVictor', '1xBet', 'Marathon', 'Sbobet', 'William Hill']);
  assert.equal(rows.find(r => r.book === 'bet365').src, 'bet365 (Oddspapi, capture ended 26 Sep)', 'bet365 falls back to the legacy capture');
  // no source text in any row; no native title tooltips; no ↗ icon; no chart / chips / dropdown / "Sources" paragraph
  for (const r of rows) { const rh = rowHtml(h, r.book); assert.ok(!/Oddspapi|api-tennis|\+30s|seen by us|not in feed|Kibl/.test(rh.replace(/data-aotip="[^"]*"/g, '').replace(/data-src="[^"]*"/g, '')), r.book); }
  assert.ok(!/\stitle="/.test(h), 'no native title tooltips');
  assert.ok(!h.includes('\u2197') && !h.includes('Chart lines') && !h.includes('Sources (Match Winner)') && !h.includes('aodds-mkt') && !h.includes('SAMPLE DATA'));
  assert.ok(h.includes('>Match Winner only. Lines step until a book re-posts. Hover a book for its source.<'));
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

test('no line: a dash row with its verdict — never a zero, never opens a pop-up', () => {
  const A = build();
  const m = fixture();
  delete m.oddsMovement.chart.books['Bet105'];
  m.oddsMovement.chart.meta['Superbet'].note = 'not recorded — our recording began 26 Sep';
  delete m.oddsMovement.chart.books['Superbet'];
  A.open(m);
  const h = A.buildOddsSection(m);
  const b = rowHtml(h, 'Bet105');
  assert.ok(/class="aox-row aox-nodata" data-book="Bet105"/.test(h) && b.includes('>not priced for this match<'));
  assert.ok(!b.includes('onclick=') && !/>0\.00</.test(b));
  assert.ok(rowHtml(h, 'Superbet').includes('>not recorded — our recording began 26 Sep<'), 'the writer\'s note wins');
  assert.ok(rowHtml(h, 'Betano').includes('>not checked yet<'));
  // nothing at all -> the reduced view + the 12 no-data rows
  const h0 = A.buildOddsSection({ id: 'x', p1: 'A. B', p2: 'C. D', date: '2026-10-01', time: '10:00', oddsMovement: null, _oddsLoaded: true });
  assert.ok(h0.includes('REDUCED') && (h0.match(/class="aox-row aox-nodata"/g) || []).length === 12);
  // before the lazy shard lands: a loading line, no verdict rows, no reduced view
  const hl = A.buildOddsSection({ id: 'x', p1: 'A. B', p2: 'C. D', date: '2026-10-01', time: '10:00' });
  assert.ok(hl.includes('aox-loading') && !hl.includes('aox-row') && !hl.includes('REDUCED'));
});

test('a book gone from the feed reads "Not in feed since", no Now, never best', () => {
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
  assert.equal(cellTxt(rowHtml(h, 'bet365'), 'aox-now', 'a'), '2.00');
});

test('pop-up: real window, stat boxes from the real series (earliest on ties), book tabs in table order', () => {
  const now = Date.parse('2026-09-27T08:00:00Z');
  const A = build();
  const m = fixture({ now, withAt: true });
  m.oddsMovement.chart.books['Pinnacle +30s'].p1 = [[iso(now - 20 * H), 2.5], [iso(now - 10 * H), 2.6], [iso(now - 6 * H), 2.6], [iso(now - 2 * H), 2.35]];
  A.open(m); A.state().mv = 'Pinnacle';
  const D = A.aOddsRowsOf(m, { nowMs: now });
  const h = A.buildOddsSection(m);
  const mv = h.slice(h.indexOf('class="aox-mv"'));
  assert.ok(mv.includes('Odds movement \u00b7 Decimal odds \u00b7 as quoted \u00b7 since 26 Sep, 14:00'), 'since = first tick (Europe/Brussels)');
  assert.ok(/>sharp \u00b7 margin 2\.9%</.test(mv));
  const stats = [...mv.matchAll(/class="aox-stat"[^>]*>([^<]*)<\/span><span[^>]*>([^<]*)</g)].map(x => [x[1], x[2]]);
  // p1: OPENING 2.50 (26 Sep 12:00Z), HIGHEST 2.60 twice -> the EARLIER (22:00Z), LOWEST 2.35 (06:00Z); Europe/Brussels
  assert.deepEqual(stats.slice(0, 3), [['2.50', '26 Sep, 14:00'], ['2.60', '27 Sep, 00:00'], ['2.35', '27 Sep, 08:00']]);
  assert.ok(/class="aox-chg"[^>]*>-6\.0%</.test(mv), '% change (now - open) / open, hyphen');
  const tabs = [...mv.matchAll(/class="aox-seg aox-tab"[^>]*data-book="([^"]*)"/g)].map(x => x[1]);
  assert.deepEqual(tabs, D.rows.filter(r => !r.noData).map(r => r.name), 'one tab per row with a line, table order, stale included');
  // no hard-coded "last 72 hours", no Catmull-Rom
  assert.ok(!mv.includes('72 hours') && !/class="aox-line" d="[^"]*C/.test(mv));
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

test('best price: every tied live book is green', () => {
  const A = build();
  const m = fixture({ withAt: true });
  m.oddsMovement.chart.books['Betano'].p1[0][1] = 2.46;   // ties Betfair Exchange's 2.46 at the top
  m.oddsMovement.chart.books['Superbet'].p1[0][1] = 2.3;
  A.open(m);
  const h = A.buildOddsSection(m);
  const greens = rowsOf(h).filter(r => colorOf(rowHtml(h, r.book), 'aox-now', 'a') === A.AODDS_C.up).map(r => r.book).sort();
  assert.deepEqual(greens, ['Betano', 'Betfair Exchange']);
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
  const row = rowHtml(A.buildOddsSection(m), 'Pinnacle');
  const d = /<svg class="aox-spark"[\s\S]*?<path d="[^"]*"[^>]*\/><path d="([^"]+)"/.exec(row)[1];
  assert.equal((d.match(/M/g) || []).length, 1, 'sparkline: one line across the feed gap: ' + d);
  A.state().mv = 'Pinnacle';
  const mv = A.buildOddsSection(m); const pd = /class="aox-line" d="([^"]+)"/.exec(mv.slice(mv.indexOf('class="aox-mv"')))[1];
  assert.equal((pd.match(/M/g) || []).length, 1, 'pop-up: one line across the feed gap: ' + pd);
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
  // the sparkline's y-range is the plotted range: back-map every vertex through its own scale
  const r = { noData: false, stale: false, first: t0, end: t0 + 5 * H, series: { a: s } };
  const d = /<path d="[^"]*"[^>]*\/><path d="([^"]+)"/.exec(A.aOddsSparkSvg(r, 'a', '#fff'))[1];
  const mn = Math.min(...allowed), mx = Math.max(...allowed);
  for (const p of vertices(d)) { const v = mn + (18 - p[2]) / 14 * (mx - mn);
    assert.ok([...allowed].some(a => Math.abs(a - v) < 0.012), `sparkline y ${p[2]} → ${v.toFixed(3)} not a displayed price`); }
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
  for (const x of ['a', 'b']) { assert.equal(cellTxt(row, 'aox-now', x), '\u2014'); assert.equal(cellTxt(row, 'aox-net', x), '\u2014'); }
  A.state().mv = 'Betano';
  const all = A.buildOddsSection(m);
  assert.ok(!/[\u2013\u2012\u2212]/.test(all.replace(/<svg[\s\S]*?<\/svg>/g, '')), 'no en dash / figure dash / minus as a value mark');
  // defined once: no dash literal in the tab's functions — every one goes through AODDS_DASH
  const code = FNS.map(n => slice(n)).join('\n').replace(/\/\/[^\n]*/g, '');
  const lits = code.match(/'[^'\n]*\u2014[^'\n]*'|"[^"\n]*\u2014[^"\n]*"/g) || [];
  assert.deepEqual(lits.filter(l => !/ \u2014 /.test(l)), [], 'a value dash literal outside AODDS_DASH');
  assert.equal(constSrc('AODDS_DASH').trim(), "const AODDS_DASH = '\\u2014';");
});
// ── founder follow-up 1c: ALSO reads "<feed> · <status>", in the tooltip's label/value styling ──
//    mutant: the ALSO value keeps the source key ("Pinnacle (api-tennis) · …") ──
test('1c: the tooltip ALSO line reads "api-tennis · not in feed since HH:MM"', () => {
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
});
