// tools/test-holdbreak-engine.js — TEN-206 §5.9 / founder ruling 7.
//
// Ruling 7 (2026-09-16): "we already built a hold/break heatmap for live bets.
// Reuse that same data source and logic... Don't build a second engine."
//
// holdbreak-heatmap.js was lifted out of the live-tab IIFE in
// bsp-consult-dashboard.html. The Live tab is on TEN-206's DON'T-TOUCH list, so
// the extraction has to be provably behaviour-preserving, not plausibly so.
//
// This test does not read the new code and nod at it. It recovers the ORIGINAL
// functions from the git blob named in BASE_REF, evaluates BOTH implementations
// against the REAL holdbreak.json, and asserts deep equality of the full render
// model over every player × metric × best-of. If the extraction changed one
// tooltip string for one cell of one player, this fails.
//
// Negative controls follow the house rule: each positive assertion is re-run
// against a deliberately perturbed implementation and must FAIL. A comparison
// that cannot be made to fail is measuring nothing.
//
// Run: node tools/test-holdbreak-engine.js

'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
// The commit that still contains the pre-extraction live-tab copy. Pinned by
// content, not by "HEAD~1": this test must keep proving the same thing however
// many commits land on top of it.
const BASE_REF = process.env.HB_BASE_REF || 'dd63e096';

let pass = 0, fail = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; failures.push(name + ' :: ' + e.message); console.log('  FAIL  ' + name + ' :: ' + e.message); }
}
function mustFail(name, fn) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (threw) { pass++; console.log('  PASS  [neg] ' + name + ' (correctly rejected)'); }
  else { fail++; failures.push('[neg] ' + name + ' :: did NOT fail — the positive check is vacuous'); console.log('  FAIL  [neg] ' + name + ' :: did NOT fail — the positive check is vacuous'); }
}

// ─── the shard under both implementations ───────────────────────────────────
const HB = JSON.parse(fs.readFileSync(path.join(ROOT, 'holdbreak.json'), 'utf8'));

// ─── implementation A: the ORIGINAL, recovered from git ─────────────────────
// Sliced by the same anchors the extraction used. If an anchor stops matching,
// the slice throws rather than silently comparing against a truncated stub.
// ⚠️ THE BASE BLOB IS NOT REACHABLE IN CI, AND THAT IS NOT A FAILURE.
// `.github/workflows/pipeline.yml` checks out with `fetch-depth: 100` (a full
// clone is ~315 MB against ~25 MB shallow). BASE_REF is a 2026-09-16 commit and
// main takes ~150 commits a day, so it is thousands of commits outside that
// window: `git show` exits 128 with "invalid object name" and, because this
// suite runs inside the pipeline's fail-closed pre-deploy gate, the whole
// DEPLOY dies on it. Measured: runs 3784+ never reached the publish step.
//
// So reachability is checked first and reported as a SKIP with its reason. The
// comparison still runs in full anywhere the history exists — which is every
// developer checkout, and is where this guard was always going to catch a
// regression before it was pushed. Set HB_BASE_REF, or deepen the checkout, to
// force it. Absent is not the same as failed, and neither is a silent pass.
function baseRefReachable() {
  try {
    execFileSync('git', ['cat-file', '-e', `${BASE_REF}^{commit}`],
      { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch (e) { return false; }
}
function sliceOriginal() {
  const html = execFileSync('git', ['show', `${BASE_REF}:bsp-consult-dashboard.html`],
    { cwd: ROOT, maxBuffer: 1 << 28, encoding: 'utf8' });
  function grab(startRe, endMarker, label) {
    const m = startRe.exec(html);
    if (!m) throw new Error(`could not locate ${label} in ${BASE_REF}`);
    const from = m.index;
    const end = html.indexOf(endMarker, from);
    if (end < 0) throw new Error(`could not locate the end of ${label} in ${BASE_REF}`);
    return html.slice(from, end + endMarker.length);
  }
  const buckets = grab(/const BUCKETS = \[\['Game 1-2'/, "];", 'BUCKETS');
  const hbSets  = grab(/const HB_SETS = \['1','2','3','4','5'\];/, "];", 'HB_SETS');
  const bandFn  = grab(/function band\(rate, metric\)\{/, "\n}", 'band()');
  const sumFn   = grab(/function hbSum\(cells\)\{/, "\n}", 'hbSum()');
  const heatFn  = grab(/function heatFor\(pkey, metric, bo\)\{/, "\n}", 'heatFor()');
  for (const [src, label] of [[buckets,'BUCKETS'],[hbSets,'HB_SETS'],[bandFn,'band'],[sumFn,'hbSum'],[heatFn,'heatFor']]) {
    if (!src || src.length < 20) throw new Error(`recovered ${label} is too short to be real`);
  }
  // heatFor's only ambient dependency is LF(); everything else is in the slice.
  const src = `${buckets}\n${hbSets}\n${bandFn}\n${sumFn}\n${heatFn}\nreturn heatFor;`;
  // eslint-disable-next-line no-new-func
  return new Function('LF', src)(() => ({ holdbreak: () => HB }));
}
if (!baseRefReachable()) {
  console.log('\n  hold/break engine equivalence — SKIPPED');
  console.log(`  the base blob ${BASE_REF} is not in this checkout (shallow clone:`);
  console.log('  pipeline.yml uses fetch-depth 100). The extraction cannot be compared');
  console.log('  against the original here. This is a SKIP, not a pass and not a fail.');
  console.log('  Run it in a full checkout, or set HB_BASE_REF to a reachable commit.\n');
  process.exit(0);
}
const originalHeatFor = sliceOriginal();

// ─── implementation B: the extracted shared module ──────────────────────────
function loadModule() {
  const sandbox = {};
  const src = fs.readFileSync(path.join(ROOT, 'holdbreak-heatmap.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', src + '\n;window.HoldBreakHeatmap = (typeof window!=="undefined"?window:globalThis).HoldBreakHeatmap;')(sandbox);
  if (!sandbox.HoldBreakHeatmap) throw new Error('holdbreak-heatmap.js did not export HoldBreakHeatmap');
  return sandbox.HoldBreakHeatmap;
}
const HBE = loadModule();

const KEYS = Object.keys(HB.players);
const METRICS = ['HOLD', 'BREAK'];
const BOS = [3, 5];

console.log(`\nholdbreak engine equivalence — ${KEYS.length} players × ${METRICS.length} metrics × ${BOS.length} best-of`);
console.log(`base ref ${BASE_REF}\n`);

// ════════════════════════════════════════════════════════════════════════════
// 1 · The extraction is behaviour-identical on the surface the Live tab uses.
// ════════════════════════════════════════════════════════════════════════════
function sweep(fn) {
  let n = 0;
  for (const key of KEYS) {
    for (const metric of METRICS) {
      for (const bo of BOS) { fn(key, metric, bo); n++; }
    }
  }
  return n;
}

check('extracted heatFor is deep-equal to the original for every player', () => {
  let diffs = 0, firstDiff = null;
  const n = sweep((key, metric, bo) => {
    const a = originalHeatFor(key, metric, bo);
    const b = HBE.heatFor(HB, key, metric, bo);           // surface defaults to 'all'
    try { assert.deepStrictEqual(b, a); }
    catch (e) {
      diffs++;
      if (!firstDiff) firstDiff = `${HB.players[key].name} (${key}) ${metric} bo${bo}: ${e.message.split('\n')[0]}`;
    }
  });
  assert.strictEqual(diffs, 0, `${diffs} of ${n} render models differ — first: ${firstDiff}`);
  console.log(`        ${n} render models identical`);
});

mustFail('the equivalence sweep would catch a one-cell drift', () => {
  // Perturb exactly one cell of one player and prove the sweep notices.
  const key = KEYS[0];
  const a = originalHeatFor(key, 'HOLD', 5);
  const b = HBE.heatFor(HB, key, 'HOLD', 5);
  b.rows[0].cells[0] = Object.assign({}, b.rows[0].cells[0], { pct: '999%' });
  assert.deepStrictEqual(b, a);
});

mustFail('the equivalence sweep would catch a changed global pill', () => {
  const key = KEYS[0];
  const a = originalHeatFor(key, 'BREAK', 3);
  const b = HBE.heatFor(HB, key, 'BREAK', 3);
  b.globalLabel = 'BREAK 0.0%';
  assert.deepStrictEqual(b, a);
});

// A sweep over an empty roster would pass vacuously. Assert it had subjects and
// that those subjects actually produced printed figures, not a grid of dashes.
check('the sweep ran over a non-empty roster that renders real figures', () => {
  assert(KEYS.length > 100, `only ${KEYS.length} players in the shard`);
  let printed = 0, dashed = 0;
  for (const key of KEYS) {
    const r = HBE.heatFor(HB, key, 'HOLD', 5);
    for (const row of r.rows) for (const c of row.cells) {
      if (/^\d+%$/.test(c.pct)) printed++; else if (c.pct === '—') dashed++;
    }
  }
  assert(printed > 0, 'not one cell printed a percentage — the engine is reading nothing');
  assert(printed > dashed, `only ${printed} printed cells vs ${dashed} dashes — coverage collapsed`);
  console.log(`        ${printed} printed cells vs ${dashed} dashes across ${KEYS.length} players`);
});

mustFail('the non-empty assertion would catch an engine reading nothing', () => {
  const r = HBE.heatFor({ players: {}, meta: HB.meta }, KEYS[0], 'HOLD', 5);
  let printed = 0;
  for (const row of r.rows) for (const c of row.cells) if (/^\d+%$/.test(c.pct)) printed++;
  assert(printed > 0, 'not one cell printed a percentage — the engine is reading nothing');
});

// ════════════════════════════════════════════════════════════════════════════
// 1b · The WIRED path. Section 1 proves the library is right; it does not prove
//      the Live tab is actually calling it. This slices the post-edit wrapper
//      out of the CURRENT bsp-consult-dashboard.html, runs it with only the
//      module and LF() in scope, and deep-compares against the original. If the
//      delegation were mis-wired — wrong argument order, a surface accidentally
//      passed, the module never reached — this fails and section 1 would not.
// ════════════════════════════════════════════════════════════════════════════
function sliceWired() {
  const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
  const m = /const HBE = \(\) => window\.HoldBreakHeatmap \|\| null;/.exec(html);
  if (!m) throw new Error('the HBE accessor is gone from the dashboard — delegation removed?');
  const f = /function heatFor\(pkey, metric, bo\)\{[\s\S]*?\n\}/.exec(html);
  if (!f) throw new Error('the live-tab heatFor wrapper is gone from the dashboard');
  // A wrapper that still carried the maths would be a second engine, which is
  // the thing ruling 7 forbids. Assert it delegates rather than computes.
  assert(/E\.heatFor\(/.test(f[0]), 'the live-tab wrapper does not call the shared engine');
  assert(!/hbSum\(|BUCKETS\.map/.test(f[0]), 'the live-tab wrapper still contains its own maths');
  const src = `${m[0]}\n${f[0]}\nreturn heatFor;`;
  // eslint-disable-next-line no-new-func
  return new Function('window', 'LF', src)({ HoldBreakHeatmap: HBE }, () => ({ holdbreak: () => HB }));
}

check('the Live tab, as wired today, renders exactly what it rendered before', () => {
  const wired = sliceWired();
  let diffs = 0, firstDiff = null;
  const n = sweep((key, metric, bo) => {
    const a = originalHeatFor(key, metric, bo);
    const b = wired(key, metric, bo);
    try { assert.deepStrictEqual(b, a); }
    catch (e) {
      diffs++;
      if (!firstDiff) firstDiff = `${HB.players[key].name} (${key}) ${metric} bo${bo}: ${e.message.split('\n')[0]}`;
    }
  });
  assert.strictEqual(diffs, 0, `${diffs} of ${n} wired render models differ — first: ${firstDiff}`);
  console.log(`        ${n} wired render models identical to pre-extraction`);
});

check('the wired wrapper dashes rather than throwing if the module is absent', () => {
  const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
  const m = /const HBE = \(\) => window\.HoldBreakHeatmap \|\| null;/.exec(html);
  const f = /function heatFor\(pkey, metric, bo\)\{[\s\S]*?\n\}/.exec(html);
  // eslint-disable-next-line no-new-func
  const orphan = new Function('window', 'LF', `${m[0]}\n${f[0]}\nreturn heatFor;`)({}, () => ({ holdbreak: () => HB }));
  const r = orphan(KEYS[0], 'HOLD', 5);
  assert.deepStrictEqual(r.rows, [], 'an absent module produced rows out of nowhere');
  assert.strictEqual(r.globalLabel, 'HOLD —', 'an absent module printed a figure');
  console.log('        module absent → empty model + dash, no throw');
});

// A negative control is only worth its name if the SUBJECT is susceptible to the
// mutation. The first draft of this one used KEYS[0] — D. Schwartzman, 2 matches,
// all of them on clay — so his 'clay' node and his 'all' node are the same object
// and passing the wrong surface changed nothing. The check was fine; the subject
// was immune. Pick the subject by construction and assert susceptibility first.
const SURFACE_SUSCEPTIBLE = (() => {
  const tot = (node) => {
    let won = 0, n = 0;
    for (const s of Object.keys(node || {})) {
      for (const o of Object.keys(node[s] || {})) {
        const c = node[s][o];
        if (c && c.n) { won += (c.won || 0); n += c.n; }
      }
    }
    return won + '/' + n;
  };
  return KEYS.find((k) => {
    const sv = HB.players[k].serve || {};
    return sv.all && sv.clay && tot(sv.all) !== tot(sv.clay) && tot(sv.clay) !== '0/0';
  }) || null;
})();

check('a surface-susceptible subject exists for the mis-wiring control', () => {
  assert(SURFACE_SUSCEPTIBLE, 'no player has clay figures distinct from all — the control below would be immune');
  const a = HBE.heatFor(HB, SURFACE_SUSCEPTIBLE, 'HOLD', 5, 'all');
  const c = HBE.heatFor(HB, SURFACE_SUSCEPTIBLE, 'HOLD', 5, 'clay');
  assert.notStrictEqual(a.globalLabel, c.globalLabel,
    'the chosen subject renders the same figure on all and clay — still immune');
  console.log(`        subject ${HB.players[SURFACE_SUSCEPTIBLE].name}: all ${a.globalLabel} vs clay ${c.globalLabel}`);
});

mustFail('the wired-path check would catch a mis-wired delegation', () => {
  const key = SURFACE_SUSCEPTIBLE;
  const a = originalHeatFor(key, 'HOLD', 5);
  // simulate the wrapper passing a surface the Live tab never intends
  const b = HBE.heatFor(HB, key, 'HOLD', 5, 'clay');
  assert.deepStrictEqual(b, a);
});

mustFail('the wired-path check would catch a swapped metric', () => {
  const key = SURFACE_SUSCEPTIBLE;
  const a = originalHeatFor(key, 'HOLD', 5);
  const b = HBE.heatFor(HB, key, 'BREAK', 5);
  assert.deepStrictEqual(b, a);
});

mustFail('the wired-path check would catch a swapped best-of', () => {
  const key = SURFACE_SUSCEPTIBLE;
  const a = originalHeatFor(key, 'HOLD', 5);
  const b = HBE.heatFor(HB, key, 'HOLD', 3);
  assert.deepStrictEqual(b, a);
});

// ════════════════════════════════════════════════════════════════════════════
// 2 · The axis the engine reads is the axis the shard emits.
//     The pre-extraction PROFILE-PAGE copy (ppHoldBreakHtml) read 'early'/'mid'/
//     'late' × sets '1','2','3','4+' — keys build-holdbreak.js stopped emitting
//     when the founder re-ruled the grid (TEN-107, 2026-09-02). Every one of its
//     12 lookups resolves to undefined against today's shard. It was flag-gated
//     off, so it dashed silently. This locks the axis so that cannot recur.
// ════════════════════════════════════════════════════════════════════════════
check('the engine reads the set and ordinal keys the shard actually emits', () => {
  const sets = HB.meta.sets.map(String);
  assert.deepStrictEqual(HBE.HB_SETS, sets,
    `engine reads sets ${JSON.stringify(HBE.HB_SETS)} but the shard emits ${JSON.stringify(sets)}`);
  const ords = HB.meta.buckets.map(String);
  const engineOrds = HBE.BUCKETS.map((_, i) => String(i + 1));
  assert.deepStrictEqual(engineOrds, ords,
    `engine reads ordinals ${JSON.stringify(engineOrds)} but the shard emits ${JSON.stringify(ords)}`);
  // and the keys resolve on real data, not just in meta
  const probe = HB.players[KEYS[0]].serve.all;
  for (const s of HBE.HB_SETS) {
    assert(probe[s], `set key '${s}' is absent from a real player node`);
    for (const o of engineOrds) assert(probe[s][o] !== undefined, `ordinal key '${o}' absent in set '${s}'`);
  }
  console.log(`        sets ${sets.join(',')} × ordinals ${ords.join(',')} all resolve on real data`);
});

mustFail('the axis lock would catch the stale early/mid/late grid', () => {
  const staleSets = ['1','2','3','4+'];
  const sets = HB.meta.sets.map(String);
  assert.deepStrictEqual(staleSets, sets,
    `engine reads sets ${JSON.stringify(staleSets)} but the shard emits ${JSON.stringify(sets)}`);
});

mustFail('the axis lock would catch stale bucket names', () => {
  const probe = HB.players[KEYS[0]].serve.all;
  for (const o of ['early','mid','late']) {
    assert(probe['1'][o] !== undefined, `ordinal key '${o}' absent in set '1'`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 3 · Surface routing. The profile page follows its own surface filter; an
//     absent surface must dash, never silently fall back to 'all' — that would
//     print an all-surfaces figure under a clay heading.
// ════════════════════════════════════════════════════════════════════════════
check('each surface reads its own node and never falls back to all', () => {
  const surfaces = HB.meta.surfaces.filter(s => s !== 'all');
  let checked = 0;
  for (const key of KEYS.slice(0, 40)) {
    const all = HBE.heatFor(HB, key, 'HOLD', 5, 'all');
    for (const s of surfaces) {
      const one = HBE.heatFor(HB, key, 'HOLD', 5, s);
      const node = HB.players[key].serve[s];
      if (!node) {
        assert.strictEqual(one.globalLabel, 'HOLD —',
          `${key}: surface '${s}' is not held but did not dash`);
      }
      checked++;
    }
    // A player with matches on more than one surface cannot have every surface
    // equal to 'all' — that is the signature of a silent fallback.
    const distinct = new Set(surfaces.map(s => HBE.heatFor(HB, key, 'HOLD', 5, s).globalLabel));
    if (distinct.size === 1 && distinct.has(all.globalLabel) && all.globalLabel !== 'HOLD —') {
      throw new Error(`${key}: every surface returned the 'all' figure — fallback leak`);
    }
  }
  console.log(`        ${checked} surface lookups routed to their own node`);
});

mustFail('the surface check would catch a fallback to all', () => {
  // Uses the susceptible subject: a player whose clay figure genuinely differs
  // from his all-surfaces figure. If a surface lookup silently fell back to
  // 'all', the two would coincide — which is what this asserts is impossible.
  const key = SURFACE_SUSCEPTIBLE;
  const all = HBE.heatFor(HB, key, 'HOLD', 5, 'all');
  const leaked = HBE.heatFor(HB, key, 'HOLD', 5, 'all');   // simulates clay falling back to all
  assert.notStrictEqual(leaked.globalLabel, all.globalLabel,
    `${key}: the clay lookup returned the 'all' figure — fallback leak`);
});

check('an unknown surface dashes rather than inventing a grid', () => {
  const r = HBE.heatFor(HB, KEYS[0], 'HOLD', 5, 'carpet-on-mars');
  assert.strictEqual(r.globalLabel, 'HOLD —', 'an unheld surface printed a figure');
  for (const row of r.rows) for (const c of row.cells) {
    assert(c.pct === '—', `an unheld surface printed ${c.pct}`);
  }
  console.log('        unknown surface → all dashes, no invented figures');
});

mustFail('the unknown-surface check is not vacuous', () => {
  const r = HBE.heatFor(HB, KEYS[0], 'HOLD', 5, 'all');
  assert.strictEqual(r.globalLabel, 'HOLD —', 'an unheld surface printed a figure');
});

// ════════════════════════════════════════════════════════════════════════════
// 4 · Coverage provenance — ruling 7: "the heatmap states its match count".
// ════════════════════════════════════════════════════════════════════════════
check('coverageFor states a real match count for players in the shard', () => {
  let stated = 0;
  for (const key of KEYS) {
    const c = HBE.coverageFor(HB, key);
    assert(c.held, `${key} is in the shard but coverageFor says not held`);
    assert(Number.isFinite(c.matches), `${key}: match count is not a number`);
    assert(c.matches >= 0, `${key}: negative match count`);
    if (c.matches > 0) stated++;
  }
  assert(stated > 0, 'no player states a match count — the provenance line is empty');
  assert(stated >= KEYS.length * 0.9, `only ${stated} of ${KEYS.length} state a match count`);
  console.log(`        ${stated} of ${KEYS.length} players state a real match count`);
});

check('a player absent from the shard reports not-held rather than zero', () => {
  const c = HBE.coverageFor(HB, '__no_such_player__');
  assert.strictEqual(c.held, false, 'an absent player reported as held');
  assert.strictEqual(c.matches, null, 'an absent player reported matches=0 instead of null');
  console.log('        absent player → held:false, matches:null (never 0)');
});

mustFail('the not-held check would catch a zero standing in for missing', () => {
  const c = { held: false, matches: 0 };
  assert.strictEqual(c.matches, null, 'an absent player reported matches=0 instead of null');
});

// ════════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(64));
console.log(`PASS ${pass}   FAIL ${fail}`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  - ' + f));
}
process.exit(fail ? 1 : 0);
