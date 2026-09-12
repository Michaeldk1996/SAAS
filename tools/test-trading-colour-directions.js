// Trading Report — founder-ruling lock harness.
//
// Every ruling below was made on the board and is encoded here the same day so it
// cannot silently regress. Two gates are covered:
//
// TEN-151 (2026-09-07)
//   1) confirmation:TEN-151:direction-list:v1 — the only HIGH=BAD colour
//      inversions are oph, babb, bbk, bfsg; every other column reads HIGH=GOOD
//      (player-strength framing).
//   2) ask:TEN-151:colour-rulings:v1 — the extra columns not in the confirmed 12
//      stay HIGH=GOOD (spw/rpw/bps/bpw and wfs/ws2/ws1w2/ws1wm), RANK_MIN_POP = 8.
//
// TEN-192 (ask 356eb544, answered 2026-09-12) — the six rebuild rulings
//   3) TIER COLOUR is the export's: field average of the visible pool, ±3 points.
//      The shipped p25/p75 tour-percentile cuts are NO LONGER read by the page.
//   4) SECOND WINDOW is 52 weeks = 364 days, computed as its own query.
//   5) METRIC DEFINITIONS are the shipped ones; the export README is the thing
//      that is wrong. In particular ls1fb / ls1bf / bofs keep their shipped
//      glosses, and no two tooltips may be identical (the README's own BOFS≡BFSG
//      and BABB≡BBK copy-paste duplication must not be imported).
//   6) The slate-level LOW-SAMPLE NOTICE is dropped — the per-cell ladder only.
//   7) The FIELD-AVERAGE POOL narrows on Tournament as well as Surface.
//   8) AVATARS keep the monogram fallback, not the export's bare circle.
//
// Plus the two structural invariants the brief calls out as easy to get wrong:
//   9) ONE grid template, header and every row: 62px 210px 64px 40px 1fr repeat(7, 84px).
//  10) Column positions are identical across tabs, and the tab→column and
//      highlight maps match the export's.
//
// Run: node tools/test-trading-colour-directions.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'trading-report.js'), 'utf8');
const buildSrc = fs.readFileSync(path.join(ROOT, 'build-trading-splits.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');

const checks = [];
function ok(name) { checks.push(name); }

// "this identifier must be gone" checks run against a comment-stripped view, so
// the header block can still name what was removed and why.
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}
const srcCode = stripComments(src);
const buildCode = stripComments(buildSrc);

// ── literals live inside the trading-report.js browser IIFE (not exported), so
//    parse them out of the source rather than executing it.
function objectLiteral(varName) {
  const m = src.match(new RegExp('var ' + varName + ' = \\{([\\s\\S]*?)\\n  \\};'))
         || src.match(new RegExp('var ' + varName + ' = \\{([\\s\\S]*?)\\};'));
  assert(m, `${varName} object not found in trading-report.js`);
  return m[1];
}
function numberLiteral(varName) {
  const m = src.match(new RegExp('var\\s+' + varName + '\\s*=\\s*(\\d+)'));
  assert(m, `${varName} not found in trading-report.js`);
  return Number(m[1]);
}

// ── Rulings 1 + 2 — the inversion set ────────────────────────────────────────
const INVERTED = {};
for (const pair of objectLiteral('INVERTED').matchAll(/([a-z0-9]+)\s*:\s*1\b/gi)) INVERTED[pair[1]] = 1;

const INVERSIONS = ['oph', 'babb', 'bbk', 'bfsg'];
for (const k of INVERSIONS) {
  assert.strictEqual(INVERTED[k], 1, `expected ${k} to be a HIGH=BAD inversion`);
}
assert.deepStrictEqual(Object.keys(INVERTED).sort(), INVERSIONS.slice().sort(),
  `only oph/babb/bbk/bfsg may be inversions, got: ${Object.keys(INVERTED).join(',')}`);
ok(`${INVERSIONS.length} inversions locked`);

// The extra columns the founder confirmed stay HIGH=GOOD must appear in the
// metric catalogue and must NOT be inverted.
const EXTRA_HIGH_GOOD = ['spw', 'rpw', 'bps', 'bpw', 'wfs', 'ws2', 'ws1w2', 'ws1wm'];
const labels = objectLiteral('METRIC_LABELS');
for (const k of EXTRA_HIGH_GOOD) {
  assert(new RegExp('\\b' + k + '\\s*:').test(labels), `${k} missing from METRIC_LABELS`);
  assert(!INVERTED[k], `expected ${k} to stay HIGH=GOOD per colour-rulings:v1`);
}
ok(`${EXTRA_HIGH_GOOD.length} extra HIGH=GOOD locked`);

const rm = buildSrc.match(/const\s+RANK_MIN_POP\s*=\s*(\d+)\s*;/);
assert(rm, 'RANK_MIN_POP declaration not found in build-trading-splits.js');
assert.strictEqual(Number(rm[1]), 8, `expected RANK_MIN_POP === 8, got ${rm[1]}`);
ok('RANK_MIN_POP=8');

// ── Ruling 3 — tier colour is field-average ±3pt, NOT the percentile cuts ─────
assert.strictEqual(numberLiteral('TIER_PTS'), 3, 'the ±3 percentage-point band is the export rule');
assert.strictEqual(numberLiteral('MIN_TIER_DEN'), 10, 'a cell is untiered below a denominator of 10');
assert(/fieldAvg/.test(src), 'the page must compute a field average');
// The percentile engine must be gone from the page (the generator may still emit it).
for (const dead of ['cutFor', '_index.cuts', 'cuts12', 'cuts52w']) {
  assert(!srcCode.includes(dead), `TEN-192 ruling 1: the page must no longer read ${dead}`);
}
ok('tier colour = field average ±3pt, percentile cuts unread');

// ── Ruling 4 — the second window is 52 weeks = 364 days ──────────────────────
const cm = buildSrc.match(/NOW\.getTime\(\)\s*-\s*(\d+)\s*\*\s*24\s*\*\s*3600\s*\*\s*1000/);
assert(cm, 'the 52-week cutoff must be expressed as a day count off NOW in build-trading-splits.js');
assert.strictEqual(Number(cm[1]), 364, `expected a 364-day inner window, got ${cm[1]}`);
for (const field of ['tiers52w', 'window52w', 'cuts52w']) {
  assert(buildSrc.includes(field), `build-trading-splits.js must publish ${field}`);
}
assert(!/tiers12|window12|cuts12/.test(buildCode), 'the 12-month field names must be gone from the generator');
assert(src.includes('tiers52w'), 'the page must read the 52-week sub-tree');
assert(!/tiers12|window12/.test(srcCode), 'the 12-month field names must be gone from the page');
ok('52-week window = 364 days, own sub-tree');

// ── Ruling 5 — shipped definitions, and no duplicated tooltips ───────────────
const tipsBlock = objectLiteral('METRIC_TIPS');
const tips = {};
for (const m of tipsBlock.matchAll(/^\s*([a-z0-9]+)\s*:\s*'((?:[^'\\]|\\.)*)'/gim)) tips[m[1]] = m[2];
assert(Object.keys(tips).length >= 22, `parsed too few tooltips: ${Object.keys(tips).length}`);
// The three the README gets wrong, pinned to the shipped meaning.
assert(/fought back to WIN THE MATCH/i.test(tips.ls1fb),
  'ls1fb must keep the shipped gloss (lost set 1 → fought back to win the MATCH)');
assert(/Broke First in Set 2/i.test(tips.ls1bf),
  'ls1bf must keep the shipped gloss (lost set 1 → BROKE first in set 2)');
assert(/Broke Opponent/i.test(tips.bofs),
  'bofs must keep the shipped gloss (BROKE the opponent\'s first service game)');
// The README duplicates two of its own tooltip texts; ours may not.
const seen = new Map();
for (const [k, v] of Object.entries(tips)) {
  const norm = v.replace(/\s+/g, ' ').trim();
  assert(!seen.has(norm), `duplicate tooltip text: ${k} repeats ${seen.get(norm)}`);
  seen.set(norm, k);
}
ok(`${Object.keys(tips).length} definitions shipped-side, none duplicated`);

// ── Ruling 6 — the slate-level low-sample notice is gone ────────────────────
for (const dead of ['slateMutePct', 'tr-notice', 'Low sample']) {
  assert(!srcCode.includes(dead), `TEN-192 ruling 4: the slate notice must be gone (found ${dead})`);
}
ok('slate low-sample notice dropped');

// ── Ruling 7 — the field-average pool narrows on Tournament too ─────────────
const poolBlock = src.match(/var pool = rows\.filter\(function \(r\) \{([\s\S]*?)\}\);/);
assert(poolBlock, 'the field-average pool must be built by filtering the slate rows');
assert(/surfSel/.test(poolBlock[1]), 'the pool must narrow on Surface');
assert(/tourSel/.test(poolBlock[1]), 'TEN-192 ruling 5: the pool must narrow on Tournament');
assert(!/S\.q|search/i.test(poolBlock[1]), 'the pool must be computed BEFORE the search box');
ok('pool = slate after surface + tournament, before search');

// ── Ruling 8 — the monogram fallback survives ──────────────────────────────
assert(/tr-mono/.test(src) && /playerInitials/.test(src), 'the monogram avatar fallback must stay');
assert(/photoCandidatesFor/.test(src), 'the shared photo resolver chain must stay');
ok('monogram avatar fallback kept');

// ── Invariant 9 — ONE grid template, header and every row ──────────────────
const TRACKS = '62px 210px 64px 40px 1fr repeat(7, 84px)';
const gridRule = htmlSrc.match(/\[data-page="trading"\] \.tr-head,\[data-page="trading"\] \.tr-row\{([^}]*)\}/);
assert(gridRule, 'the shared .tr-head/.tr-row grid rule is missing from the dashboard');
assert(gridRule[1].includes('grid-template-columns:' + TRACKS),
  `the grid template must be exactly "${TRACKS}"`);
// and nothing else may declare a competing template for these two
const templates = [...htmlSrc.matchAll(/\[data-page="trading"\][^{]*\{[^}]*grid-template-columns:([^;]+);/g)]
  .map(m => m[1].trim());
assert.deepStrictEqual([...new Set(templates)], [TRACKS],
  `exactly one grid template may exist on this page, found: ${JSON.stringify([...new Set(templates)])}`);
ok('one grid template, 7 metric slots');

// ── Invariant 10 — tab→column and highlight maps match the export ──────────
function parseMap(varName, re) {
  const block = objectLiteral(varName);
  const out = {};
  for (const m of block.matchAll(re)) {
    out[m[1]] = m[2].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  }
  return out;
}
const COLUMN_SETS = parseMap('COLUMN_SETS', /(\w+):\s*\{[^}]*metrics:\s*\[([^\]]*)\]/g);
const HIGHLIGHT   = parseMap('HIGHLIGHT',   /(\w+):\s*\[([^\]]*)\]/g);

// verbatim from README §"Tab → columns (and highlighted columns)", translated
// through the shipped metric keys (the export's own codes for the three LOST
// SET 1 metrics are L1·WS2 / L1·FB / L1·BF).
const EXPORT_TABS = {
  key:          ['sh', 'spw', 'rpw', 'bps', 'bpw', 'oph'],
  laysetwinner: ['ls1ws2', 'ws1w2', 'ls1fb', 'ls1bf', 'bpw', 'ws1wm', 'bfs2aws1'],
  scalping:     ['sh', 'spw', 'bps', 'htws', 'htss'],
  laybreakup:   ['babb', 'bbk', 'bbkb', 'gfb', 'bfsg'],
  settrading20: ['ws1w2', 'wfs', 'ws2', 'ls1ws2', 'gfb'],
  layserve:     ['htws', 'bofs', 'htss', 'bps', 'bpw'],
  laysetbreak:  ['ls1bf', 'ls1ws2', 'babb', 'ws1w2', 'bbk', 'bbkb'],
};
const EXPORT_HL = {
  key:          [],
  laysetwinner: ['ls1ws2', 'ws1w2'],
  scalping:     ['bps', 'htws', 'htss'],
  laybreakup:   ['babb', 'bbk'],
  settrading20: ['ws1w2'],
  layserve:     ['htws', 'bofs'],
  laysetbreak:  ['ls1bf', 'ls1ws2', 'babb', 'ws1w2'],
};
assert.deepStrictEqual(COLUMN_SETS, EXPORT_TABS, 'tab → column map drifted from the export');
assert.deepStrictEqual(HIGHLIGHT, EXPORT_HL, 'highlight map drifted from the export');
// No tab may exceed the seven grid slots, and every highlighted column must exist
// on its own tab.
for (const [tab, cols] of Object.entries(COLUMN_SETS)) {
  assert(cols.length >= 5 && cols.length <= 7, `${tab} has ${cols.length} columns, expected 5–7`);
  for (const h of HIGHLIGHT[tab]) {
    assert(cols.includes(h), `${tab} highlights ${h}, which is not one of its columns`);
  }
  for (const c of cols) {
    assert(new RegExp('\\b' + c + '\\s*:').test(labels), `${tab} uses ${c}, which has no label`);
    assert(tips[c], `${tab} uses ${c}, which has no tooltip`);
  }
}
ok(`${Object.keys(COLUMN_SETS).length} tabs, columns + highlights match the export`);

console.log('PASS  trading-report rulings:\n  - ' + checks.join('\n  - '));
