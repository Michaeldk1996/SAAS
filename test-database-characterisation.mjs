// CHARACTERISATION TESTS for the Database tab — TEN-242 phase 2, step 1 of B3.
//
// FOUNDER, on the ROI-overlay refactor: "Whatever you do, the standalone Database
// page must behave exactly as it does today. Prove it — tests, not assertion."
//
// This file is that proof, and it exists because of a gap: there was NO test suite
// for the Database tab at all. Its correctness rested entirely on the TEN-196 and
// TEN-243 verification passes — a human looking at it once. A 1,888-line singleton
// was about to be refactored with no regression net under it.
//
// WHAT THIS PINS, AND WHY THAT IS THE RIGHT SET.
// The refactor is DOM plumbing: root-scoped queries and per-instance state. It must
// not touch a single number. So this pins the NUMERIC AND FORMATTING SPINE — every
// function between the archive rows and the characters a member reads:
//
//   yieldCell   the TEN-243 sample gates, all three states. Most recently changed,
//               so most likely to be disturbed.
//   agg/bands   the aggregate and the tercile partition — what every panel counts.
//   fmt*        every number-to-string on the page.
//   signCol     which yields are green and which are red.
//   smoothVals  the founder-ruled display smoothing (TEN-196 round 5, 'guarded').
//   sampleKeep  the down-sampler, INDEX-bucketed — TEN-243's calendar-axis fix.
//   lowerBound  the baseline binary search.
//   nrm         the name normaliser the tournament search matches on.
//
// If all of these produce byte-identical output before and after, a refactor that
// only moves DOM plumbing cannot have changed what the page shows.
//
// HOW IT READS THEM. It SLICES the real functions out of the shipped file and runs
// them. It does not re-implement them — a re-implementation is a second version
// that agrees with itself and proves nothing (see npm-test-runs-one-of-ten-mjs).
// It also does not import the module: that is browser code in an IIFE, and the
// point is to test what SHIPS.
//
// Run: node --test test-database-characterisation.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DASH = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');

const MOD = (() => {
  const i = DASH.indexOf('window.DatabaseTab = (function(){');
  assert.ok(i > 0, 'DatabaseTab module not found');
  const j = DASH.indexOf('return { init: init };', i);
  const k = DASH.indexOf('return { mount: mount, init: init };', i);
  const end = j > 0 ? j : k;
  assert.ok(end > i, 'DatabaseTab module end not found (neither init nor mount export)');
  return DASH.slice(i, end);
})();

// Cut `function name(...)` out of the source.
//
// A one-line function is taken WHOLE, before any scanning. That is not an
// optimisation — `esc` is `replace(/"/g, '&quot;')`, and a scanner that tracks
// string state cannot tell a quote inside a REGEX LITERAL from the start of a
// string. It ran away to the end of the module and produced 40KB of unbalanced
// source. Single-line first, brace-match only for the rest.
function fnSource(src, name) {
  const m = new RegExp('\\n  function ' + name + '\\s*\\(').exec(src);
  assert.ok(m, `function ${name} not found in DatabaseTab`);
  const line = src.slice(m.index + 1, src.indexOf('\n', m.index + 1));
  if (/^\s*function\s/.test(line) && line.trimEnd().endsWith('}')) {
    let d = 0; for (const ch of line) { if (ch === '{') d++; else if (ch === '}') d--; }
    if (d === 0) return line;
  }
  const start = m.index + 1;
  let k = src.indexOf('{', start), d = 0, s = null, esc = false, c = null;
  for (; k < src.length; k++) {
    const ch = src[k];
    if (c) { if (c === '//' && ch === '\n') c = null; else if (c === '/*' && ch === '*' && src[k + 1] === '/') { c = null; k++; } }
    else if (s) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === s) s = null; }
    else if (ch === '"' || ch === "'" || ch === '`') s = ch;
    else if (ch === '/' && (src[k + 1] === '/' || src[k + 1] === '*')) { c = src[k + 1] === '/' ? '//' : '/*'; k++; }
    else if (ch === '{') d++;
    else if (ch === '}') { d--; if (d === 0) break; }
  }
  assert.ok(d === 0, `unbalanced braces in ${name}`);
  return src.slice(start, k + 1);
}

// Read a module-level `var NAME=...;` constant so the test uses the SHIPPED value,
// not a copy. A test that hardcodes 30 would still pass if HARD_GATE became 40.
function constOf(name) {
  const m = new RegExp('\\b' + name + '\\s*=\\s*(-?[\\d.]+)').exec(MOD);
  assert.ok(m, `constant ${name} not found`);
  return Number(m[1]);
}

const HARD_GATE = constOf('HARD_GATE');
const SOFT_GATE = constOf('SOFT_GATE');
const POS = /POS\s*=\s*'(#[0-9a-f]{6})'/i.exec(MOD)[1];
const NEG = /NEG\s*=\s*'(#[0-9a-f]{6})'/i.exec(MOD)[1];

// Build a sandbox holding the real functions plus the constants they close over.
const SANDBOX = [
  `var HARD_GATE=${HARD_GATE}, SOFT_GATE=${SOFT_GATE};`,
  `var POS='${POS}', NEG='${NEG}';`,
  `var MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];`,
  `var N_TOUR=${(/N_TOUR\s*=\s*(\d+)/.exec(MOD) || [0, 120])[1]};`,
  ...['fmtInt', 'fmtP', 'fmtPct', 'fmtPP', 'fmtU', 'signCol', 'median', 'fmtDate',
    'yr', 'dnum', 'esc', 'nrm', 'lowerBound', 'upperBound',
    'agg', 'bands', 'yieldCell', 'smoothVals', 'sampleKeep'].map((n) => fnSource(MOD, n)),
].join('\n');

const F = eval(`(function(){ ${SANDBOX}
  return { fmtInt, fmtP, fmtPct, fmtPP, fmtU, signCol, median, fmtDate, yr, dnum, esc, nrm,
           lowerBound, upperBound, agg, bands, yieldCell, smoothVals, sampleKeep,
           HARD_GATE, SOFT_GATE, POS, NEG }; })()`);

// A fixed archive slice. `p` price, `w` won, `b` book (0 = ps, 1 = b365).
const ROWS = [
  { p: 1.10, w: 1, b: 0 }, { p: 1.25, w: 1, b: 1 }, { p: 1.40, w: 0, b: 0 },
  { p: 1.55, w: 1, b: 1 }, { p: 1.80, w: 0, b: 0 }, { p: 2.10, w: 1, b: 1 },
  { p: 2.50, w: 0, b: 0 }, { p: 3.20, w: 1, b: 1 }, { p: 4.50, w: 0, b: 0 },
];

// ---------------------------------------------------------------- the gates
test('CHARACTERISATION: yieldCell — all three TEN-243 sample-gate states', () => {
  // HARD: no yield at all, the count replaces the number.
  const hard = F.yieldCell({ n: HARD_GATE - 1, yield: 0.1234 });
  assert.equal(hard, `<span class="db-yieldcell hard">n=${F.fmtInt(HARD_GATE - 1)} — too few matches for a yield</span>`);
  assert.ok(!/%/.test(hard), 'the hard state must emit NO percentage a reader could mistake for a rate');

  // SOFT: the yield, muted, and NO sign colour in the ink.
  const soft = F.yieldCell({ n: SOFT_GATE - 1, yield: 0.1234 });
  assert.equal(soft, '<span class="db-yieldcell soft">+12.34%</span>');
  assert.ok(!/color:/.test(soft), 'a soft-gated yield keeps its sign in the glyph, not the ink');

  // FULL: the yield with the sign colour.
  assert.equal(F.yieldCell({ n: SOFT_GATE, yield: 0.1234 }), `<span class="db-yieldcell" style="color:${POS}">+12.34%</span>`);
  assert.equal(F.yieldCell({ n: SOFT_GATE, yield: -0.0567 }), `<span class="db-yieldcell" style="color:${NEG}">-5.67%</span>`);

  // the exact boundaries, which is where an off-by-one would live
  assert.match(F.yieldCell({ n: HARD_GATE, yield: 0.1 }), /db-yieldcell soft/);
  assert.match(F.yieldCell({ n: HARD_GATE - 1, yield: 0.1 }), /db-yieldcell hard/);
  assert.match(F.yieldCell({ n: SOFT_GATE, yield: 0.1 }), /style="color:/);
  assert.match(F.yieldCell({ n: SOFT_GATE - 1, yield: 0.1 }), /db-yieldcell soft/);
});

// ---------------------------------------------------------------- the numbers
test('CHARACTERISATION: agg — counts, median, yield, range and the book split', () => {
  const a = F.agg(ROWS);
  assert.equal(a.n, 9);
  assert.equal(a.median, 1.80);
  assert.equal(a.lo, 1.10);
  assert.equal(a.hi, 4.50);
  // profit = sum(won ? p-1 : -1) over the slice
  const want = ROWS.reduce((s, v) => s + (v.w ? v.p - 1 : -1), 0) / ROWS.length;
  assert.ok(Math.abs(a.yield - want) < 1e-12, `yield ${a.yield} vs ${want}`);
  assert.equal(a.book.ps.n, 5);
  assert.equal(a.book.b365.n, 4);
  assert.equal(F.agg([]), null, 'an empty slice aggregates to null, never a zero row');
});

test('CHARACTERISATION: bands — the tercile partition, and the <3 honest single band', () => {
  const b = F.bands(ROWS);
  assert.equal(b.bands.length, 3);
  assert.deepEqual(b.bands.map((x) => x.n), [3, 3, 3]);
  assert.equal(b.all.n, 9);
  assert.ok(b.bands[0].hi <= b.bands[1].lo, 'bands must not overlap');

  // fewer than three cannot be split into terciles without inventing bands
  const two = F.bands(ROWS.slice(0, 2));
  assert.equal(two.bands.length, 1);
  assert.equal(two.single, true);
  assert.equal(F.bands([]).bands.length, 0);
  assert.equal(F.bands([]).all, null);

  // an uneven count still partitions every row exactly once
  const seven = F.bands(ROWS.slice(0, 7));
  assert.equal(seven.bands.reduce((s, x) => s + x.n, 0), 7);
});

test('CHARACTERISATION: every number-to-string on the page', () => {
  assert.equal(F.fmtPct(0.1234), '+12.34%');
  assert.equal(F.fmtPct(-0.1234), '-12.34%');
  assert.equal(F.fmtPct(0), '+0.00%');
  assert.equal(F.fmtPct(null), '—', 'no data is an em dash, never a zero');
  assert.equal(F.fmtP(1.5), '1.50');
  assert.equal(F.fmtP(null), '—');
  assert.equal(F.fmtPP(2.5), '+2.50pp');
  assert.equal(F.fmtPP(-2.5), '-2.50pp');
  assert.equal(F.fmtInt(1234567), '1,234,567');
  assert.equal(F.fmtInt(null), '—');
  assert.equal(F.fmtU(1234.6), '1,235u');
  assert.equal(F.median([3, 1, 2]), 2);
  assert.equal(F.median([4, 1, 3, 2]), 2.5);
  assert.equal(F.median([]), null);
  assert.equal(F.fmtDate('2026-09-19'), '19 Sep 2026');
  assert.equal(F.fmtDate(null), '—');
  assert.equal(F.yr(20260919), 2026);
  assert.equal(F.signCol('+1.00%'), POS);
  assert.equal(F.signCol('-1.00%'), NEG);
  assert.equal(F.signCol(' +1.00%'), POS, 'leading space must not flip the colour');
});

test('CHARACTERISATION: nrm — the string the tournament search actually matches on', () => {
  assert.equal(F.nrm('Monte-Carlo'), 'monte carlo');
  assert.equal(F.nrm("Internazionali BNL d'Italia"), 'internazionali bnl d italia');
  assert.equal(F.nrm('Båstad'), 'bastad', 'diacritics are folded, or the search misses its own events');
  assert.equal(F.nrm(null), '');
});

test('CHARACTERISATION: lowerBound / upperBound — the baseline binary search', () => {
  const a = [1, 3, 3, 5, 7];
  assert.equal(F.lowerBound(a, 3), 1);
  assert.equal(F.upperBound(a, 3), 3);
  assert.equal(F.lowerBound(a, 0), 0);
  assert.equal(F.lowerBound(a, 99), 5);
  assert.equal(F.upperBound(a, 99), 5);
});

// -------------------------------------------------------------- the charting
test('CHARACTERISATION: smoothVals — the founder-ruled guarded smoothing', () => {
  const v = [1, 5, 2, 8, 3, 9, 4];
  const out = F.smoothVals(v, 1);
  assert.equal(out.length, v.length);
  assert.equal(out[0], v[0], 'the first vertex is PINNED — a smoothed endpoint moves the curve off its own data');
  assert.equal(out[out.length - 1], v[v.length - 1], 'and the last');
  assert.deepEqual(F.smoothVals([1, 2], 3), [1, 2], 'fewer than three points are returned untouched');
  assert.deepEqual(F.smoothVals([], 3), []);
  // interior is a mean of the window
  assert.ok(Math.abs(out[1] - (1 + 5 + 2) / 3) < 1e-12);
});

test('CHARACTERISATION: sampleKeep — index-bucketed, endpoints pinned (TEN-243 calendar axis)', () => {
  const n = 500;
  const xs = Array.from({ length: n }, (_, i) => i);
  const vals = xs.map((x) => Math.sin(x));
  const keep = F.sampleKeep(xs, vals, 60);
  assert.ok(keep.length <= 60, `budget respected: ${keep.length}`);
  assert.equal(keep[0], 0, 'the first vertex is always kept');
  assert.equal(keep[keep.length - 1], n - 1, 'and the last');
  for (let i = 1; i < keep.length; i++) assert.ok(keep[i] > keep[i - 1], 'indices must be strictly increasing');
  // under budget -> every index survives, in order
  const small = F.sampleKeep([0, 1, 2], [0, 1, 2], 60);
  assert.deepEqual(small, [0, 1, 2]);
  assert.deepEqual(F.sampleKeep([], [], 60), []);

  // THE CALENDAR-AXIS PROPERTY. Bucketing by x would starve on a clustered axis —
  // a one-week-a-year event puts all its points in a few columns. Index bucketing
  // must spend the budget whatever the x distribution, so feed a brutally
  // clustered x and require the same vertex count as a uniform one.
  const clustered = Array.from({ length: n }, (_, i) => Math.floor(i / 50) * 10000 + (i % 50));
  const keepC = F.sampleKeep(clustered, vals, 60);
  assert.equal(keepC.length, keep.length,
    `a clustered calendar axis must not starve the sampler: ${keepC.length} vs ${keep.length}`);
});

// ------------------------------------------------------------- module shape
test('the Database module still exposes init(), whatever else it gains', () => {
  // The refactor may ADD mount(); it must never REMOVE init(), because the nav
  // hook calls it and that call site is deliberately left untouched.
  assert.match(DASH, /window\.DatabaseTab = \(function\(\)\{/);
  assert.match(DASH, /return \{ (mount: mount, )?init: init \};/);
  assert.match(DASH, /if \(tab === 'database'\) \{ if \(window\.DatabaseTab\) window\.DatabaseTab\.init\(\); \}/,
    'the standalone nav call site must keep working exactly as today');
});
