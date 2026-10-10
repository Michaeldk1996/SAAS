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
//   8) AVATARS — SUPERSEDED by TEN-421 (founder step 13, override): initials avatars only, no photos.
//
// TEN-192 (ask a0d8fcbe, answered 2026-09-12) — the two post-ship conflicts
//  11) A SURFACELESS LIVE ROW resolves its surface from the fixture's tournament
//      (tournament-surfaces.json, the same map the shard generator buckets by),
//      in the order slate → fixture tournament → dash. Never the blended bucket.
//  12) DIM and TIER stay AS WRITTEN and keep gating on DIFFERENT numbers: the dim
//      on the player's own window n, tier membership on the cell's own denominator.
//      They are allowed to disagree; reconciling them needs a new ruling.
//
// TEN-192 (ask 57993e8d, answered 2026-09-12) — two findings, both ruled LEAVE IT
//  13) The FIELD AVERAGE has no minimum-pool floor and no leave-one-out, and an
//      under-10 cell is untiered yet still summed into the bar. Both asymmetries
//      were reported with the measurement that motivated changing them; the
//      export is the spec and they stand. The tests pin the behaviour the
//      founder was SHOWN — reconciling either one needs a new ruling.
//  14) matches.json's surfaceFromEvent() stays a three-branch keyword guess
//      (Wimbledon grass, Roland Garros clay, everything else hard) and still
//      OUTRANKS the tournament map in the Trading Report. Not worth rewriting
//      matches.json, which every page reads.
//
// TEN-421 (founder step 13, 2026-10-10) — the redesign
//  15) The tabs, their column groups and highlighted columns are the design file's TAB_GROUPS / HIGHLIGHT
//      (Trading Report.dc.html). Its 'LOST SET 1 FB' / 'LOST SET 1 BF' are ls1b1s2 / ls1o1s2: set 2's first break by
//      the player / the opponent over EVERY lost-set-1 match with set 2 played (founder R1, not a mirror pair);
//      ls1o1s2 is the one added inversion (lower is better). Tier = the PRINTED gap (rounded % − rounded field),
//      |gap| <= 3 amber, 4+ green / red (founder R1).
//  16) Tooltips are one plain sentence each saying what the code counts and over what; no two alike.
//
// Plus the structural invariants:
//   9) ONE grid for the head and every row: 52px 250px 56px 36px 8px repeat(var(--tr-n, 7), minmax(0,1fr)), the
//      metric count per tab in --tr-n.
//  10) The tab→column-group and highlight maps match the design file's.
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

const INVERSIONS = ['oph', 'babb', 'bbk', 'bfsg', 'ls1o1s2'];   // + ls1o1s2: TEN-421 ruling 15
for (const k of INVERSIONS) {
  assert.strictEqual(INVERTED[k], 1, `expected ${k} to be a HIGH=BAD inversion`);
}
assert.deepStrictEqual(Object.keys(INVERTED).sort(), INVERSIONS.slice().sort(),
  `only oph/babb/bbk/bfsg/ls1o1s2 may be inversions, got: ${Object.keys(INVERTED).join(',')}`);
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
// The ones the README gets wrong, pinned to the shipped meaning (TEN-421 ruling 16: one plain sentence each).
assert(/^Matches won after losing set 1/.test(tips.ls1fb),
  'ls1fb must keep the shipped meaning (lost set 1 → won the MATCH)');
assert(/made the first break of set 2 after losing set 1/.test(tips.ls1bf),
  'ls1bf must keep the shipped meaning (lost set 1 → BROKE first in set 2)');
assert(/opponent made the first break of set 2, out of every match where the player lost set 1/.test(tips.ls1o1s2),
  'ls1o1s2 = the opponent broke first in set 2, over every lost-set-1 match (the design file\'s LOST SET 1 BF, founder R1)');
assert(/broke the opponent’s first service game/.test(tips.bofs),
  'bofs must keep the shipped meaning (BROKE the opponent\'s first service game), unlike the README\'s BFSG copy');
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

// ── Ruling 8 — SUPERSEDED (TEN-421 override): initials avatars, no photos ─────
assert(/tr-ava/.test(src) && /playerInitials/.test(src), 'the initials avatar must be drawn');
assert(!/photoCandidatesFor|resolveProfilePhotoUrl|randomuser|<img/.test(srcCode), 'no photo on the Trading Report (TEN-421)');
ok('initials avatars, no photos');

// ── Invariant 9 — ONE grid template, header and every row ──────────────────
const TRACKS = '52px 250px 56px 36px 8px repeat(var(--tr-n, 7), minmax(0,1fr))';
const gridRule = htmlSrc.match(/\[data-page="trading"\] \.tr-hgrid,\[data-page="trading"\] \.tr-row\{([^}]*)\}/);
assert(gridRule, 'the shared .tr-hgrid/.tr-row grid rule is missing from the dashboard');
assert(gridRule[1].includes('grid-template-columns:' + TRACKS),
  `the grid template must be exactly "${TRACKS}"`);
// and nothing else may declare a competing template for these two
const templates = [...htmlSrc.matchAll(/\[data-page="trading"\]([^{]*)\{[^}]*grid-template-columns:([^;]+);/g)]
  .filter(m => /tr-row|tr-head|tr-hgrid/.test(m[1])).map(m => m[2].trim());
assert.deepStrictEqual([...new Set(templates)], [TRACKS],
  `exactly one grid template may exist on this page, found: ${JSON.stringify([...new Set(templates)])}`);
assert(/style="--tr-n:' \+ V\.codes\.length \+ '"/.test(src), 'the metric count per tab sets --tr-n');
ok('one grid template, one fr per metric (--tr-n)');

// ── Invariant 10 — tab→column and highlight maps match the export ──────────
function parseMap(varName, re) {
  const block = objectLiteral(varName);
  const out = {};
  for (const m of block.matchAll(re)) {
    out[m[1]] = m[2].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  }
  return out;
}
// COLUMN_SETS carries the design file's groups: key: { label, groups: [[group, [metrics…]], …] }
const COLUMN_GROUPS = {};
for (const m of objectLiteral('COLUMN_SETS').matchAll(/(\w+):\s*\{[^\n]*groups:\s*(\[[^\n]*\])\s*\},/g)) {
  COLUMN_GROUPS[m[1]] = JSON.parse(m[2].replace(/'/g, '"'));
}
const COLUMN_SETS = {};
for (const [k, g] of Object.entries(COLUMN_GROUPS)) COLUMN_SETS[k] = g.reduce((a, x) => a.concat(x[1]), []);
const HIGHLIGHT   = parseMap('HIGHLIGHT',   /(\w+):\s*\[([^\]]*)\]/g);

// TEN-421 ruling 15: the design file's TAB_GROUPS, translated through the metric keys ('LOST SET 1 WS' = ls1ws2,
// 'LOST SET 1 FB' = ls1bf, 'LOST SET 1 BF' = ls1bkf).
const EXPORT_GROUPS = {
  key:          [['serve', ['sh', 'spw', 'bps']], ['ret', ['rpw', 'bpw', 'oph']]],
  laysetwinner: [['lost', ['ls1ws2', 'ls1b1s2', 'ls1o1s2']], ['won', ['ws1w2', 'ws1wm', 'ws1b1s2']], ['all', ['bpw']]],
  scalping:     [['serve', ['sh', 'spw', 'bps']], ['press', ['htws', 'htss']]],
  laybreakup:   [['afterBrk', ['babb', 'bbk']], ['afterBrkn', ['bbkb']], ['start', ['gfb', 'bfsg']]],
  settrading20: [['all', ['wfs', 'ws2', 'gfb']], ['won', ['ws1w2']], ['lost', ['ls1ws2']]],
  layserve:     [['press', ['htws', 'htss']], ['start', ['bofs']], ['bp', ['bps', 'bpw']]],
  laysetbreak:  [['lost', ['ls1o1s2', 'ls1ws2']], ['won', ['ws1w2']], ['afterBrk', ['babb', 'bbk']], ['afterBrkn', ['bbkb']]],
};
const EXPORT_HL = {
  key:          [],
  laysetwinner: ['ls1ws2', 'ws1w2'],
  scalping:     ['bps', 'htws', 'htss'],
  laybreakup:   ['babb', 'bbk'],
  settrading20: ['ws1w2'],
  layserve:     ['htws', 'bofs'],
  laysetbreak:  ['ls1o1s2', 'ls1ws2', 'babb', 'ws1w2'],
};
assert.deepStrictEqual(COLUMN_GROUPS, EXPORT_GROUPS, 'tab → column-group map drifted from the design file');
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

// ── Ruling 11 — a surfaceless live row resolves from the fixture's tournament ─
// EXECUTED, not grepped: the resolution order IS the ruling. Every extraction below
// runs against the COMMENT-STRIPPED source, because a review pass proved that
// matching raw `src` lets a commented-out copy satisfy the whole section while the
// live code is gutted.
function fnBlock(name) {
  const code = stripComments(src);
  const start = code.indexOf('function ' + name + '(');
  assert(start !== -1, `${name}() is missing from trading-report.js`);
  let i = code.indexOf('{', start), depth = 0;
  for (let j = i; j < code.length; j++) {
    if (code[j] === '{') depth++;
    else if (code[j] === '}' && --depth === 0) return code.slice(start, j + 1);
  }
  throw new Error(`${name}() is unbalanced`);
}
function surfaceResolverWith(map) {
  // eslint-disable-next-line no-new-func
  return new Function('MAP', 'var _tsurf = MAP;\n' + fnBlock('surfaceFromTournament') + '\nreturn surfaceFromTournament;')(map);
}
{
  const MAP = { 1217: 'hard', 2255: 'clay', 2361: 'Grass', 1200: null, 9999: '- Qualification', 7000: 'carpet' };
  const f = surfaceResolverWith(MAP);
  assert.strictEqual(f(1217), 'hard', 'US Open (tournament_key 1217) must resolve to hard');
  assert.strictEqual(f(2255), 'clay', 'a clay tournament_key must resolve to clay');
  assert.strictEqual(f(2361), 'grass', 'the map value must be case-folded');
  // Everything that has no bucket DASHES. It may never become a surface or a blend.
  for (const bad of [1200, 9999, 7000, 4242, null, undefined, '']) {
    assert.strictEqual(f(bad), '', `unmapped/non-surface key ${String(bad)} must resolve to '' (dash), not a guess`);
  }
  // Before the map lands, every row still dashes — never a default surface.
  assert.strictEqual(surfaceResolverWith(null)(1217), '', 'with no map loaded the row must dash, not default to hard');
  // An empty published map must be treated as absent, not latched as loaded.
  assert.strictEqual(surfaceResolverWith({})(1217), '', 'an empty map must dash, not guess');
  assert(/Object\.keys\(m\)\.length/.test(stripComments(src)),
    'an empty `surfaces` object must be rejected at load, or one bad deploy latches every such row to a dash for the session');
  // The fetch must not sit in front of the shard pump on a board that never reads it,
  // and a failed fetch must be re-armed — neither is true without these two.
  assert(/needsSurfaceMap\(\)/.test(stripComments(fnBlock('ensureStatics'))),
    'the surface map must only be fetched when an in-play fixture actually needs it');
  assert(/_tsurfTries < SURFACES_MAX_TRIES && needsSurfaceMap\(\)/.test(stripComments(fnBlock('tick'))),
    'tick() must re-arm the surface-map fetch, or one failed load dashes those rows for the whole session');
  // Because the map is lazy, a row can hold its shard before its surface. On this
  // page a dash means "we looked and there is nothing", so that row must show the
  // LOADING dot until the map lands — never a dash it will take back.
  for (const fn of ['cellHtml', 'nHtml']) {
    assert(/rowPending\(row, V\)/.test(stripComments(fnBlock(fn))),
      `${fn} must treat an unresolved surface as PENDING, not as absent data`);
  }
  assert(/!row\.surface && !!V\.surfacePending/.test(stripComments(fnBlock('rowPending'))),
    'rowPending must hold a row whose surface has not resolved yet');
}
// …and liveFixtureRow must consult it, in the order slate → fixture → dash. Run the
// WHOLE function, not the two lines: a review pass showed that lifting the lines out
// by regex passes even if they are commented out and the live code is gutted.
const liveRowBlock = fnBlock('liveFixtureRow');
{
  const run = (slate, fixture, map) => new Function('SLATE', 'MAP',
    ['var _index = null, _tsurf = MAP;',
     'function slateMatchByKeys(){ return SLATE; }',
     'function pairKey(a,b){ return a+":"+b; }',
     'function oddsFor(){ return null; }',
     'function displayName(k, f){ return f || "—"; } function eventLabel(r){ return r || ""; } function roundWords(){ return ""; }',
     'function startClockOf(){ return "—"; } function isInterruptedFix(){ return false; }',
     fnBlock('surfaceFromTournament'),
     liveRowBlock,
     'return liveFixtureRow(arguments[2], 1);'].join('\n'))(slate, map, fixture);
  const MAP = { 1217: 'hard', 2255: 'clay' };
  // The row object itself must carry the resolved surface — not just compute it.
  assert.strictEqual(run(null, { tournament_key: 1217, first_player_key: 1, second_player_key: 2 }, MAP).surface, 'hard',
    'a live fixture absent from matches.json must take its surface from its tournament');
  assert.strictEqual(run({ surface: 'Clay', p1Key: 1 }, { tournament_key: 1217, first_player_key: 1, second_player_key: 2 }, MAP).surface, 'clay',
    'the slate surface wins when it has one — the tournament map is a FALLBACK, not an override');
  assert.strictEqual(run(null, { tournament_key: 7752, first_player_key: 1, second_player_key: 2 }, MAP).surface, '',
    'an unresolvable tournament must still dash');
  assert.strictEqual(run(null, { tournament_key: 1217, first_player_key: 1, second_player_key: 2 }, null).surface, '',
    'with no map loaded the row must dash, not default to hard');
  // Pins the number→string coercion at the point it is load-bearing: fixtures carry
  // tournament_key as a NUMBER, the published map is keyed by strings.
  assert.strictEqual(typeof { tournament_key: 1217 }.tournament_key, 'number',
    'guard: the fixture key is a number, which is why String() is needed');
  assert.strictEqual(run(null, { tournament_key: 2255, first_player_key: 1, second_player_key: 2 },
    new Map(Object.entries(MAP))).surface, '',
    'the map must be read as a plain object, not something Map-like that silently misses');
}
// The blended `all` bucket stays unreachable from EVERY row-facing read — bucketFor
// picks the cell bucket, nOf feeds the n column AND the dim override.
for (const fn of ['bucketFor', 'nOf']) {
  const body = stripComments(fnBlock(fn));
  assert(!/(\[\s*(['"`])all\2\s*\]|\.all\b)/.test(body),
    `${fn} must never read the blended \`all\` bucket`);
}
assert(/surf !== 'hard' && surf !== 'clay' && surf !== 'grass'/.test(stripComments(fnBlock('bucketFor'))),
  'bucketFor must still refuse any surface outside hard/clay/grass');
ok('surfaceless live row resolves slate → fixture tournament → dash');

// ── Ruling 12 — dim and tier gate on DIFFERENT numbers, as written ───────────
// The founder ruled "as written" on the inconsistency he was shown, so the test
// pins the disagreement in place: reconciling them is a new ruling, not a tidy-up.
const cellBlock = stripComments(fnBlock('cellHtml'));
assert(/var n = nOf\(row\);\s*\n\s*if \(n != null && n < MIN_TIER_DEN\) \{\s*\n\s*color = DIM;/.test(cellBlock),
  'the dim override must gate on the PLAYER\'S OWN window n (nOf(row)), per the README');
const tierBlock = stripComments(fnBlock('tierOf'));
assert(/if \(!c \|\| c\[1\] < MIN_TIER_DEN\) return null;/.test(tierBlock),
  'tier membership must gate on the CELL\'S OWN denominator, per the README');
// TEN-421 R2 (founder) SUPERSEDES ruling 12's "as written": a greyed (n < 10) player is untiered too, so the filter
// menu counts equal the cell colours.
assert(/var pn = nOf\(row\);\s*\n\s*if \(pn != null && pn < MIN_TIER_DEN\) return null;/.test(tierBlock),
  'TEN-421 R2: tierOf must leave a player under 10 matches untiered (counts = colours)');
assert(!/c\[1\] < MIN_TIER_DEN/.test(cellBlock.split('var n = nOf(row);')[1] || ''),
  'ruling 12 is AS WRITTEN: the dim must NOT be re-expressed as the cell denominator');
ok('dim and tier: a player under 10 is greyed AND untiered (TEN-421 R2)');

// ── Ruling 13 — the field average has NO pool floor, and the under-10 cell ───
//    still counts toward it. Both were put to the founder with the measurement
//    that motivated changing them; he ruled the export is the spec. So the tests
//    below pin the behaviour he was SHOWN, not the behaviour I recommended —
//    a later "tidy-up" of either asymmetry needs a new ruling, not a refactor.
const cvBlock = fnBlock('computeView');
// Driven with the page's OWN constants, so the engine under test cannot pass by
// being fed thresholds the page doesn't use.
const TIER_PTS_N = numberLiteral('TIER_PTS');
const MIN_TIER_DEN_N = numberLiteral('MIN_TIER_DEN');
function fieldEngine() {
  const start = cvBlock.indexOf('var fieldAvg = {};');
  assert(start !== -1, 'the field-average loop is missing from computeView()');
  const end = cvBlock.indexOf('var tabFilters');
  assert(end > start, 'tierOf must still sit between the field-average loop and the filter step');
  const body = cvBlock.slice(start, end);
  // No row-count guard may creep into the region that builds the bar and reads it.
  assert(!/pool\.length/.test(body),
    'ruling 13 is LEAVE IT: the field average may not gate on how many rows the pool holds');
  // eslint-disable-next-line no-new-func
  // TEN-421 R2: the field is pooled over fieldPool (the whole day); the engine is driven with the same rows for both.
  return new Function('codes', 'pool', 'cellOf', 'isInv', 'MIN_TIER_DEN', 'TIER_PTS',
    'var fieldPool = pool; function nOf(){ return null; }\n' + body + '\nreturn { fieldAvg: fieldAvg, tierOf: tierOf };');
}
{
  const engine = fieldEngine();
  const cellOf = (row, mk) => row[mk] || null;
  const isInv = (mk) => mk === 'oph';
  const run = (pool) => engine(['spw'], pool, cellOf, isInv, MIN_TIER_DEN_N, TIER_PTS_N);

  // A pool of ONE: the player IS the field. No leave-one-out, no suppression —
  // he is measured against himself, lands at d = 0, and paints amber.
  const one = run([{ spw: [60, 100] }]);
  assert.strictEqual(one.fieldAvg.spw, 0.6, 'a one-row pool still publishes a bar');
  assert.strictEqual(one.tierOf({ spw: [60, 100] }, 'spw'), 'within',
    'ruling 13: a player is included in the field average he is measured against');

  // A pool of TWO with equal denominators: the bar is the midpoint, so each
  // player's deviation is exactly HALF the spread between them. That is the
  // mechanism behind the all-amber finding — a spread under 6pt cannot colour
  // either row, however far apart the two players really are from the tour.
  const two = run([{ spw: [70, 100] }, { spw: [50, 100] }]);
  assert.strictEqual(two.fieldAvg.spw, 0.6, 'the two-row bar is the pooled midpoint');
  assert.strictEqual(two.tierOf({ spw: [70, 100] }, 'spw'), 'above', 'd = +10, half of the 20pt spread');
  const near = run([{ spw: [53, 100] }, { spw: [48, 100] }]);
  assert.strictEqual(near.tierOf({ spw: [53, 100] }, 'spw'), 'within',
    'ruling 13: on a two-row pool a sub-6pt spread paints amber on BOTH rows, by design');
  assert.strictEqual(near.tierOf({ spw: [48, 100] }, 'spw'), 'within',
    'ruling 13: on a two-row pool a sub-6pt spread paints amber on BOTH rows, by design');

  // The asymmetry, pinned: a cell under the tier denominator is untiered itself
  // but IS still summed into the bar everyone else is measured against.
  const asym = run([{ spw: [9, 10] }, { spw: [0, 4] }]);
  assert.strictEqual(asym.fieldAvg.spw, 9 / 14,
    'ruling 13: an under-10 cell must still be summed into the field average');
  assert.strictEqual(asym.tierOf({ spw: [0, 4] }, 'spw'), null,
    'ruling 13: …while remaining untiered itself — the two rules stay out of step, as ruled');

  // An empty pool has no bar, and nothing tiers off it.
  assert.strictEqual(run([]).fieldAvg.spw, null, 'an empty pool publishes no bar');
  assert.strictEqual(run([]).tierOf({ spw: [60, 100] }, 'spw'), null, 'and nothing tiers off a null bar');
  // TEN-421 R1: the gap is read off the PRINTED figures. Etcheverry, Opponent holds 81% v field 78% (inverted): the
  // raw gap is 3.45 pts, the printed gap 3 → amber, not red.
  const runInv = (pool) => engine(['oph'], pool, cellOf, m => m === 'oph', MIN_TIER_DEN_N, TIER_PTS_N);
  const eo = runInv([{ oph: [811, 1000] }, { oph: [742, 1000] }]);
  assert.strictEqual(Math.round(eo.fieldAvg.oph * 100), 78);
  assert.strictEqual(eo.tierOf({ oph: [811, 1000] }, 'oph'), 'within', 'printed 81 v 78 = 3 → amber (R1)');
  const e4 = run([{ spw: [61, 100] }, { spw: [69, 100] }]);
  assert.strictEqual(e4.tierOf({ spw: [69, 100] }, 'spw'), 'above', 'printed gap 4 → green');
  assert.strictEqual(e4.tierOf({ spw: [61, 100] }, 'spw'), 'below', 'printed gap −4 → red');
}
for (const dead of ['MIN_POOL', 'POOL_FLOOR', 'MIN_FIELD_POOL', 'leaveOneOut']) {
  assert(!srcCode.includes(dead),
    `ruling 13 is LEAVE IT: no pool floor or leave-one-out may be introduced (found ${dead})`);
}
ok('field average has no pool floor, no leave-one-out, under-10 cells still counted');

// ── Ruling 14 — matches.json's surface heuristic stays, and so does its order ─
//    surfaceFromEvent() is a three-branch keyword guess on the odds path (~88% of
//    `today` rows) and it outranks the tournament map the shards are bucketed by.
//    Put to the founder with that measurement; ruled LEAVE IT — fixing it means
//    rewriting matches.json, which every page reads. Pinned so nobody "improves"
//    it here and moves every other page's surface underneath it.
{
  const pipeSrc = fs.readFileSync(path.join(ROOT, 'bsp-pipeline.js'), 'utf8');
  const start = stripComments(pipeSrc).indexOf('function surfaceFromEvent(');
  assert(start !== -1, 'surfaceFromEvent() is missing from bsp-pipeline.js');
  const code = stripComments(pipeSrc);
  let i = code.indexOf('{', start), depth = 0, block = null;
  for (let j = i; j < code.length; j++) {
    if (code[j] === '{') depth++;
    else if (code[j] === '}' && --depth === 0) { block = code.slice(start, j + 1); break; }
  }
  assert(block, 'surfaceFromEvent() is unbalanced');
  // eslint-disable-next-line no-new-func
  const sfe = new Function(block + '\nreturn surfaceFromEvent;')();
  assert.strictEqual(sfe({ sport_title: 'ATP Wimbledon' }), 'grass');
  assert.strictEqual(sfe({ sport_title: 'ATP Roland Garros' }), 'clay');
  assert.strictEqual(sfe({ sport_title: 'ATP French Open' }), 'clay');
  // The known-wrong branch, ruled in place: a clay event that is neither of the
  // two named majors is published as hard. This assertion is not describing
  // correct behaviour — it is holding a ruling. Changing it is a board decision.
  assert.strictEqual(sfe({ sport_title: 'ATP Rome Masters' }), 'hard',
    'ruling 14 is LEAVE IT: every non-Wimbledon, non-RG event is published as hard');
  assert.strictEqual(sfe({ sport_title: 'ATP Monte Carlo Masters' }), 'hard',
    'ruling 14 is LEAVE IT: every non-Wimbledon, non-RG event is published as hard');
  assert.strictEqual(sfe({}), 'hard', 'a titleless event still defaults to hard');
}
// …and the Trading Report keeps the slate FIRST. The fallback added under ruling
// 11 reads the stronger source, so inverting the two here was the tempting fix;
// ruled against. Ruling 11's own assertion at "the slate surface wins" is what
// enforces it — this pins that the page has not grown a second, competing path.
assert(!/surfaceFromEvent/.test(srcCode),
  'ruling 14: the Trading Report must not re-implement the pipeline heuristic');
{
  const body = stripComments(fnBlock('liveFixtureRow'));
  const slateAt = body.indexOf('.surface');
  const tourAt = body.indexOf('surfaceFromTournament');
  assert(slateAt !== -1 && tourAt !== -1 && slateAt < tourAt,
    'ruling 14: the slate surface must still be consulted BEFORE the tournament map');
}
ok('matches.json surface heuristic and slate-first order kept, as ruled');

console.log('PASS  trading-report rulings:\n  - ' + checks.join('\n  - '));
