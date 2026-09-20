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
  // Match the export by SHAPE, not by an exact string: pinning the literal made
  // this slice break the moment the module gained an introspection method, which
  // is a maintenance trap rather than a real guard. The guard that matters —
  // that init() survives — lives in test-ten242-rulings.mjs.
  // Match the export LINE by shape, not by an exact string: pinning the literal
  // made this slice break the moment the module gained an introspection method.
  // A `[^}]*` character class does not work either — the export now contains a
  // nested function body. The guard that matters (init survives) lives in
  // test-ten242-rulings.mjs; this only needs to find where the module ends.
  const m = /\n[ \t]*return \{.*\binit:\s*init\b.*$/m.exec(DASH.slice(i));
  assert.ok(m, 'DatabaseTab module end not found (no return line exporting init)');
  const end = i + m.index;
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

// ===========================================================================
// THE SEAM — EXECUTED.
//
// The section above pins the numeric spine. A clean-context review pointed out
// that the intersection between what it pins and what the mount refactor CHANGED
// was EMPTY: not one changed line ran. It passed unchanged on a build where
// `q()` returned null for every node, or `use()` was a no-op and both mounts
// shared one state. I had cited it as proof the refactor was safe. It was not.
//
// This section runs the changed code. It slices `freshState`, `use`, `q` and the
// dedupe/evict block out of the shipped file and executes them against two real
// root objects. The roots are INPUTS, not stubs — the functions under test are
// the shipped ones, unmodified.
//
// Every assertion below has a MUTANT at the end of the section: the check is
// re-run against a deliberately broken copy of the same source, and the test
// fails if the check still passes. A check no mutant can break is not a check.
// ===========================================================================

// Names added here ONLY after the function has actually run in this file. The
// intersection guard at the bottom reads this set; it used to compare two
// identical hardcoded arrays, which could not fail for any code or any diff.
const EXECUTED = new Set();

// A root whose querySelector actually resolves `[data-db="name"]`, like the DOM's.
function makeRoot(id, attached = true) {
  const nodes = new Map();
  for (const n of ['head', 'subtitle', 'fresh', 'viewtabs', 'filters', 'body']) {
    nodes.set(n, { __root: id, __name: n, style: {}, innerHTML: '' });
  }
  return {
    __id: id, __attached: attached,
    getAttribute: (a) => (a === 'data-db-root' ? id : null),
    querySelector: (sel) => {
      const m = /^\[data-db="([^"]+)"\]$/.exec(sel);
      return m ? (nodes.get(m[1]) || null) : null;
    },
  };
}

function seam(src) {
  const dedupe = (() => {
    const i = src.indexOf("    var key = root.getAttribute('data-db-root') || 'anon';");
    assert.ok(i > 0, 'dedupe block not found in mount()');
    const j = src.indexOf('use(inst);', i);
    return src.slice(i, j + 'use(inst);'.length);
  })();
  ['freshState', 'use', 'markBuilt', 'q', 'mount'].forEach((f) => EXECUTED.add(f));
  return eval(`(function(){
    var INSTANCES=[], I=null, built=false, state=null;
    ${fnSource(src, 'freshState')}
    ${fnSource(src, 'use')}
    ${fnSource(src, 'markBuilt')}
    ${fnSource(src, 'q')}
    var document = { contains: function(n){ return !!(n && n.__attached); } };
    function mountRoot(root){ ${dedupe} return inst; }
    return {
      mountRoot: mountRoot, q: q, use: use, markBuilt: markBuilt,
      instances: function(){ return INSTANCES; },
      activeState: function(){ return state; },
      activeRoot: function(){ return I && I.root; },
    };
  })()`);
}

test('EXECUTED seam: q() resolves inside the ACTIVE root, never document-wide', () => {
  const S = seam(MOD);
  const a = makeRoot('standalone'), b = makeRoot('roi');
  S.mountRoot(a);
  const qa = S.q('body');
  S.mountRoot(b);
  const qb = S.q('body');
  assert.ok(qa && qb, 'both mounts must resolve their body node');
  assert.equal(qa.__root, 'standalone');
  assert.equal(qb.__root, 'roi');
  assert.notEqual(qa, qb,
    'the two mounts resolved to the SAME node — a document-wide lookup would do exactly this, and the overlay would write into the standalone page');
  // and with no active instance, q() must not reach into the document
  S.use({ root: null, state: S.activeState(), built: false });
  assert.equal(S.q('body'), null);
});

test('EXECUTED seam: use() gives each mount its OWN state', () => {
  const S = seam(MOD);
  const a = S.mountRoot(makeRoot('standalone'));
  S.activeState().view = 'players';
  S.activeState().tournament = 'Wimbledon';
  const b = S.mountRoot(makeRoot('roi'));
  assert.equal(S.activeState().view, 'tour', 'a fresh mount starts from freshState, not the other mount\'s view');
  S.activeState().view = 'tournaments';
  assert.notEqual(a.state, b.state, 'the two instances must not share one state object');
  assert.equal(a.state.view, 'players', 'mounting the overlay must not move the standalone page');
  assert.equal(a.state.tournament, 'Wimbledon');
  assert.equal(b.state.view, 'tournaments');
});

test('EXECUTED seam: re-mounting the same logical root REUSES its instance (no leak)', () => {
  const S = seam(MOD);
  S.mountRoot(makeRoot('standalone'));
  // the overlay rebuilds its root element on every open — a NEW object each time
  for (let i = 0; i < 25; i++) S.mountRoot(makeRoot('roi'));
  const keys = S.instances().map((x) => x.key).sort();
  assert.deepEqual(keys, ['roi', 'standalone'],
    `25 opens produced ${S.instances().length} instances — each open leaked one, and the dismiss handler then sweeps them all on every click`);
});

test('EXECUTED seam: an instance whose root left the document is evicted', () => {
  const S = seam(MOD);
  S.mountRoot(makeRoot('standalone'));
  const gone = makeRoot('roi', /* attached */ false);
  S.mountRoot(gone);
  assert.equal(S.instances().length, 2);
  S.mountRoot(makeRoot('standalone'));   // any later mount sweeps detached roots
  assert.deepEqual(S.instances().map((x) => x.key), ['standalone'],
    'a detached root must be dropped, or the dismiss sweep renders into orphaned DOM forever');
});

test('EXECUTED seam: the mutants — every check above can actually fail', () => {
  // Each mutant breaks ONE property. If the matching assertion still passes on
  // the mutant, that assertion is decorative and this test says so.
  //
  // The trap in this kind of test: `catch { killed = true }`. An eval that throws
  // for an UNRELATED reason then reads as "the mutant was caught", and every
  // mutant passes vacuously. So each mutant is run in THREE steps and all three
  // must hold: (1) the mutation actually changed the source, (2) the mutated seam
  // CONSTRUCTS without throwing — proving the harness really ran it — and
  // (3) the check then returns false.
  const mutants = [
    { name: 'q() ignores the root and reads document-wide',
      apply: (s) => s.replace(
        `function q(name){ return (I && I.root) ? I.root.querySelector('[data-db="'+name+'"]') : null; }`,
        `function q(name){ return (INSTANCES[0] && INSTANCES[0].root) ? INSTANCES[0].root.querySelector('[data-db="'+name+'"]') : null; }`),
      check: (S) => { const a = makeRoot('standalone'), b = makeRoot('roi');
        S.mountRoot(a); const qa = S.q('body'); S.mountRoot(b); const qb = S.q('body');
        return !!qa && !!qb && qa.__root === 'standalone' && qb.__root === 'roi'; } },
    { name: 'use() does not repoint state (both mounts share one)',
      apply: (s) => s.replace(
        'function use(inst){ I=inst; state=inst.state; built=inst.built; return inst; }',
        'function use(inst){ I=inst; built=inst.built; return inst; }'),
      check: (S) => { const a = S.mountRoot(makeRoot('standalone'));
        S.activeState().view = 'players'; const b = S.mountRoot(makeRoot('roi'));
        return a.state !== b.state && a.state.view === 'players' && b.state.view === 'tour'; } },
    { name: 'dedupe keys on node identity again (the leak)',
      apply: (s) => s.replace(
        'for(var i2=0;i2<INSTANCES.length;i2++) if(INSTANCES[i2].key===key) inst=INSTANCES[i2];',
        'for(var i2=0;i2<INSTANCES.length;i2++) if(INSTANCES[i2].root===root) inst=INSTANCES[i2];'),
      check: (S) => { S.mountRoot(makeRoot('standalone'));
        for (let i = 0; i < 25; i++) S.mountRoot(makeRoot('roi'));
        return S.instances().length === 2; } },
    { name: 'detached roots are never evicted',
      apply: (s) => s.replace(
        'if(ex.root!==root && !document.contains(ex.root)) INSTANCES.splice(i,1);',
        'if(false) INSTANCES.splice(i,1);'),
      check: (S) => { S.mountRoot(makeRoot('standalone')); S.mountRoot(makeRoot('roi', false));
        S.mountRoot(makeRoot('standalone'));
        return S.instances().length === 1; } },
  ];

  // Control: the check functions must all PASS on the real, unmutated source.
  // Without this the "mutant killed it" results mean nothing — a check that is
  // false for everything kills every mutant while testing nothing.
  for (const m of mutants) {
    assert.equal(m.check(seam(MOD)), true,
      `control failed: "${m.name}" check does not hold on the REAL source, so killing the mutant proves nothing`);
  }

  const survived = [], unrun = [];
  for (const m of mutants) {
    const broken = m.apply(MOD);
    assert.notEqual(broken, MOD, `mutant "${m.name}" changed nothing — its anchor has drifted`);
    let S;
    try { S = seam(broken); }                       // (2) must construct
    catch (e) { unrun.push(`${m.name} (seam threw: ${e.message})`); continue; }
    let passed;
    try { passed = m.check(S); } catch { passed = false; }   // a throw IS a kill
    if (passed) survived.push(m.name);
  }
  assert.deepEqual(unrun, [],
    `these mutants never executed, so their result is vacuous: ${unrun.join('; ')}`);
  assert.deepEqual(survived, [],
    `these mutants did NOT break their check, so those assertions prove nothing: ${survived.join('; ')}`);
});

// A harness for filteredRows. DATA/state/M/yr are its INPUTS, supplied here;
// the function itself is the shipped one.
//   row = [date, level, surface, round, tournamentIdx, ...]
function rowFilter(src, { tournaments, rows, state }) {
  EXECUTED.add('filteredRows');
  return eval(`(function(){
    var DATA = ${JSON.stringify({ rows })};
    var M = ${JSON.stringify({ tournaments })};
    var state = ${JSON.stringify(state)};
    function yr(d){ return +String(d).slice(0,4); }
    ${fnSource(src, 'filteredRows')}
    return filteredRows();
  })()`);
}

const FIXTURE = {
  tournaments: ['Hamburg TMS', 'German Open Tennis Championships', 'Hamburg Open', 'Wimbledon'],
  //     date          lvl  surf  round  tournamentIdx
  rows: [
    ['2011-05-01', 'M', 'Clay', 'R32', 1],
    ['2012-05-02', 'M', 'Clay', 'R16', 1],
    ['2015-05-03', 'M', 'Clay', 'QF',  2],
    ['2025-05-04', 'M', 'Clay', 'SF',  2],
    ['2006-05-05', 'M', 'Clay', 'R32', 0],
    ['2013-07-01', 'G', 'Grass','R64', 3],
  ],
};

test('EXECUTED: filteredRows unions EVERY archive name, not just the first', () => {
  // This is the function that carries the whole multi-string key design, and it
  // had no node coverage at all: a clean-context review mutated it to honour
  // only the first resolving name — Hamburg 310 -> 172 rows — and the entire
  // suite stayed green. That mutant is the last case in this test.
  const pick = (t) => rowFilter(MOD, { ...FIXTURE, state: {
    view: 'tournaments', tournament: t, levels: null, surfaces: null,
    rounds: null, yearMin: null, yearMax: null } });

  const all = pick(['Hamburg TMS', 'German Open Tennis Championships', 'Hamburg Open']);
  assert.equal(all.length, 5, 'a 3-name subject must return every row of all three');

  const parts = ['Hamburg TMS', 'German Open Tennis Championships', 'Hamburg Open']
    .map((n) => pick([n]).length);
  assert.deepEqual(parts, [1, 2, 2]);
  assert.equal(all.length, parts.reduce((a, b) => a + b, 0),
    'the union must equal the sum of the parts — no dropping, no double-counting');

  // a name the archive does not hold contributes nothing and breaks nothing
  assert.equal(pick(['Hamburg Open', 'A Name The Archive Does Not Hold']).length, 2);
  // ALL names unresolved must return EMPTY, never fall through to the whole tour
  assert.equal(pick(['Nope One', 'Nope Two']).length, 0,
    'an all-unresolved subject must return no rows, never the unfiltered archive');
  // the single-string picker path is unchanged
  assert.equal(pick('German Open Tennis Championships').length, 2);
});

test('EXECUTED: the filteredRows mutants — the union logic can actually fail', () => {
  const pick = (src, t) => rowFilter(src, { ...FIXTURE, state: {
    view: 'tournaments', tournament: t, levels: null, surfaces: null,
    rounds: null, yearMin: null, yearMax: null } });
  const SUBJ = ['Hamburg TMS', 'German Open Tennis Championships', 'Hamburg Open'];

  // Each mutant gets the check that targets ITS property. The first draft used
  // one shared check on a fully-resolving subject, so the "unresolved name falls
  // through" mutant survived — the branch it breaks was never reached by that
  // input. A mutant that survives because the test never exercises it is the
  // same vacuity in a different place.
  const mutants = [
    { name: 'honour only the FIRST resolving name (the review\'s mutant)',
      apply: (s) => s.replace('if(_ix>=0) tSet.push(_ix);', 'if(_ix>=0 && !tSet.length) tSet.push(_ix);'),
      check: (src) => pick(src, SUBJ).length === 5 },
    // NOT a mutant: dropping `!tSet.length` from the early return is
    // BEHAVIOURALLY IDENTICAL, because an empty tSet makes the per-row
    // `tSet.indexOf(r[4])<0` reject every row anyway. I tried it as a mutant,
    // it survived, and the code was right — the clause is a redundant guard,
    // not a load-bearing one. The property it looks like it protects (an
    // all-unresolved subject returns NOTHING rather than the whole tour) is
    // real and is asserted in the test above; it just cannot be broken here.
    { name: 'the subject is ignored entirely',
      apply: (s) => s.replace('if(tSet.indexOf(r[4])<0) continue;', ''),
      check: (src) => pick(src, ['Hamburg Open']).length === 2 },
  ];

  for (const m of mutants) {
    assert.equal(m.check(MOD), true,
      `control failed: "${m.name}" check does not hold on the REAL source, so killing the mutant proves nothing`);
  }

  const survived = [];
  for (const m of mutants) {
    const broken = m.apply(MOD);
    assert.notEqual(broken, MOD, `mutant "${m.name}" changed nothing — its anchor has drifted`);
    let ok; try { ok = m.check(broken); } catch { ok = false; }
    if (ok) survived.push(m.name);
  }
  assert.deepEqual(survived, [], `these mutants did NOT break their check: ${survived.join('; ')}`);
});

test('the suite INTERSECTS the refactor — every function B changes is EXECUTED here', () => {
  // The failure this exists to prevent, written down TWICE now. First version:
  // the suite pinned 19 numeric helpers the refactor never touched, and I cited
  // the green run as proof the refactor was safe. Second version: I "fixed" it
  // with `CHANGED.filter(f => !EXECUTED.includes(f))` where CHANGED and EXECUTED
  // were two identical hardcoded literals — an assertion that cannot fail for
  // any code, any diff, ever. A clean-context review found that one too.
  //
  // EXECUTED is now MEASURED: a name enters it only when this file has actually
  // run that function. The list below is still hand-maintained (nothing can
  // derive it after the branch merges and the diff goes empty), but it is now
  // checked against observed behaviour rather than against itself.
  const CHANGED_BY_B = [
    'freshState',     // gains tournLabel
    'filteredRows',   // the multi-name subject set — the behaviour of the key design
    'mount',          // new: opts, dedupe by key, eviction
    'focusSide',      // new
  ];
  const missing = CHANGED_BY_B.filter((f) => !EXECUTED.has(f));
  assert.deepEqual(missing, ['focusSide'],
    `expected exactly focusSide to be uncovered here (it is DOM-only and is covered by probe-ten242-b-mount.mjs); actually uncovered: ${JSON.stringify(missing)}`);

  // and prove EXECUTED is not simply everything — a name never run must be absent
  assert.equal(EXECUTED.has('renderChrome'), false,
    'EXECUTED contains a function this file never runs, so it is not measuring anything');

  for (const f of ['freshState', 'use', 'markBuilt', 'q', 'filteredRows']) {
    assert.ok(fnSource(MOD, f).length > 10, `${f} could not be sliced out of the shipped file`);
  }
  assert.ok(MOD.includes("var key = root.getAttribute('data-db-root') || 'anon';"),
    'the mount dedupe block seam() slices has moved');
});
