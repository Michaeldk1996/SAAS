#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// TEN-328 — Under pressure has ONE builder (founder 2026-09-28): surface-ratings.js,
// with its floors, 3-of-4 -> mean×4 and Challenger fold-in ×0.9, on every display.
// The DNA radars read dna-apitennis-ratings.json, so that file must carry the
// surface-ratings value and no formula of its own.
//
//  1. The DNA builder no longer computes Under pressure from its own box scores.
//  2. sourceUnderPressure() copies surface-ratings: last52 <- last52, sinceBase <-
//     career; estimated = surface-ratings' 3-of-4 case.
//  3. A player surface-ratings does not rate gets a null axis, never a fallback; a
//     name held twice in surface-ratings joins nothing.
//  4. A short surface-ratings file stops the build.
//  5. The committed files agree (Medvedev Clay last-52 reads the same on the Ratings
//     board and the radar) whenever the DNA file was sourced from this SR build.
//  6. Both dashboard radars print no Δ for Under pressure (its baseline is career,
//     not the "2024–now" the label names).
//  7. surface-ratings.yml re-sources the DNA axis and commits both files together,
//     so the radar never trails the Ratings board.
//  8. dna-ratings.yml rebuilds its commit on the current main (re-sourced from main's
//     surface-ratings.json, re-gated) instead of line-merging two generated files.
//
// Every mutation below is APPLIED by this file to the real source and must turn the
// matching check red (a mutation that survives fails the suite):
//   M1  computeRatings computes Under pressure again (floor-less sum)      -> 1
//   M2  scope map sinceBase <- last52                                     -> 2, 5
//   M3  estimated always false                                            -> 2
//   M4  a player missing from surface-ratings is skipped, not nulled      -> 3
//   M5  duplicate surface-ratings names join the last row                 -> 3
//   M6  SR_MIN 150 -> 0                                                   -> 4
//   M7  a DNA Under-pressure value differs from surface-ratings           -> 5
//   M8  match radar Δ guard removed                                        -> 6
//   M9  H2H radar Δ guard removed                                          -> 6
//   M10 surface-ratings.yml commits surface-ratings.json alone             -> 7
//   M11 dna-ratings.yml back to rebasing its commit (commitback-push.sh)   -> 8
//   M12 dna-ratings.yml loop no longer restores this run's built file      -> 8
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const BUILDER = path.join(ROOT, 'dna-apitennis-ratings.js');
const SRC = fs.readFileSync(BUILDER, 'utf8');
const DASH = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const SURF = ['Hard', 'Clay', 'Grass', 'All'];

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log(`  ok    ${name}`); }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
}
function loadBuilder(src) {
  const m = new Module(BUILDER, null);
  m.filename = BUILDER;
  m.paths = Module._nodeModulePaths(ROOT);
  m._compile(src, BUILDER);
  return m.exports;
}
function mutate(src, from, to) {
  assert.ok(src.includes(from), `mutation anchor not found: ${from.slice(0, 60)}`);
  return src.split(from).join(to);
}

// ---- fixtures ----------------------------------------------------------------
function agg() {
  // One tiebreak won, one decider lost, a few break points: the floor-less rule
  // rated this (100% TB off one tiebreak) — surface-ratings' floors would not.
  return {
    matches: 3, svpt: 200, firstInTot: 120, firstWon: 90, secondTot: 80, secondWon: 40,
    svGmTot: 30, svGmWon: 26, svMatches: 3, aces: 15, dfs: 6,
    ret1Tot: 120, ret1Won: 36, ret2Tot: 80, ret2Won: 40, retGmTot: 30, retGmWon: 6,
    bpConvTot: 10, bpConvWon: 5, bpSavedTot: 8, bpSavedWon: 5,
    tbPlayed: 1, tbWon: 1, decPlayed: 1, decWon: 0, svcPWon: 130, retPTot: 200, retPWon: 76,
  };
}
function upNode(rating, components, extra) {
  return Object.assign({ bpSavedPct: 60, bpConvPct: 40, tbWinPct: components >= 4 ? 55 : null,
    decWinPct: 70, rating, components, inclChallenger: false }, extra || {});
}
function srFixture() {
  const surfaces = {};
  for (const s of SURF) surfaces[s] = {
    career: { underPressure: upNode(s === 'Clay' ? 207.6 : 222.6, 4) },
    last52: { underPressure: s === 'Grass' ? upNode(null, 2) : upNode(s === 'Clay' ? 231.5 : 203.9, 3) },
  };
  const players = [{ name: 'D. Medvedev', surfaces }, { name: 'X. Twin', surfaces }, { name: 'X. Twin', surfaces }];
  for (let i = 0; i < 200; i++) players.push({ name: `Filler ${i}`, surfaces: {} });
  return { generatedAt: 'fixture', players };
}
function dnaRated(B, names) {
  return names.map(name => {
    const surfaces = {};
    for (const s of SURF) surfaces[s] = { last52: B.computeRatings(agg()), sinceBase: B.computeRatings(agg()) };
    return { name, surfaces };
  });
}

// ---- checks (each takes the builder module so a mutant can be fed in) -------
const CHECKS = {
  1: B => {
    const r = B.computeRatings(agg());
    assert.strictEqual(r.underPressure, null, 'computeRatings still computes an Under-pressure node of its own');
    assert.ok(r.serve && r.serve.rating != null, 'fixture should still rate Serve');
  },
  2: B => {
    const rated = dnaRated(B, ['D. Medvedev']);
    B.sourceUnderPressure(rated, srFixture());
    const clay = rated[0].surfaces.Clay;
    assert.strictEqual(clay.last52.underPressure.rating, 231.5, 'last52 must read surface-ratings last52');
    assert.strictEqual(clay.sinceBase.underPressure.rating, 207.6, 'sinceBase must read surface-ratings career');
    assert.strictEqual(clay.last52.underPressure.srScope, 'last52');
    assert.strictEqual(clay.sinceBase.underPressure.srScope, 'career');
    assert.strictEqual(clay.last52.underPressure.estimated, true, '3-of-4 must be flagged estimated');
    assert.strictEqual(clay.sinceBase.underPressure.estimated, false, '4-of-4 is not an estimate');
    assert.strictEqual(rated[0].surfaces.Grass.last52.underPressure.rating, null, 'under the floors = null');
    assert.strictEqual(rated[0].surfaces.Grass.last52.underPressure.estimated, false);
  },
  3: B => {
    const rated = dnaRated(B, ['J. Absent', 'X. Twin']);
    const joined = B.sourceUnderPressure(rated, srFixture());
    assert.strictEqual(joined, 0, 'neither an absent nor an ambiguous name may join');
    for (const p of rated) for (const s of SURF) for (const sc of ['last52', 'sinceBase']) {
      const u = p.surfaces[s][sc].underPressure;
      assert.ok(u && u.srScope, `${p.name} ${s} ${sc}: node not written from surface-ratings`);
      assert.strictEqual(u.rating, null, `${p.name} ${s} ${sc}: rated without a surface-ratings row`);
    }
  },
  4: B => {
    const f = path.join(os.tmpdir(), `ten328-sr-short-${process.pid}.json`);
    fs.writeFileSync(f, JSON.stringify({ players: [{ name: 'A' }] }));
    try { assert.throws(() => B.loadSurfaceRatings(f), /refusing/, 'a 1-player surface-ratings file must stop the build'); }
    finally { fs.unlinkSync(f); }
  },
};

// 5 — the committed files. Pinned only when the DNA file names the SR build it was
// sourced from; after a later SR refresh the next DNA run re-syncs (gate must not
// pin a value that moves), so a lag is reported, not failed.
function committedAgree(dna, sr, scopeMap, values) {
  const src = dna._meta && dna._meta.underPressureSource;
  assert.ok(src && src.file === 'surface-ratings.json', '_meta.underPressureSource missing');
  const byName = new Map();                      // same rule as the builder: a duplicate joins nothing
  for (const p of sr.players) byName.set(p.name, byName.has(p.name) ? null : p);
  let compared = 0;
  for (const p of dna.players) {
    const row = byName.get(p.name);
    for (const s of SURF) for (const sc of Object.keys(scopeMap)) {
      const u = p.surfaces[s][sc].underPressure;
      assert.ok(u && u.srScope === scopeMap[sc], `${p.name} ${s} ${sc}: srScope ${u && u.srScope}`);
      if (!values) continue;
      const want = row && row.surfaces[s] && row.surfaces[s][scopeMap[sc]] && row.surfaces[s][scopeMap[sc]].underPressure;
      const w = want && want.rating != null ? want.rating : null;
      assert.strictEqual(u.rating, w, `${p.name} ${s} ${sc}: DNA ${u.rating} vs surface-ratings ${w}`);
      compared++;
    }
  }
  return compared;
}

// 6 — slice both radar resolvers out of the shipped page and run them.
function sliceFn(src, head) {
  const i = src.indexOf(head);
  assert.ok(i >= 0, `not found in dashboard: ${head}`);
  const indent = head.match(/^\s*/)[0];
  const end = src.indexOf('\n' + indent + '}\n', i);
  return src.slice(i, end + indent.length + 2);
}
function radarDeltas(dash) {
  const rec = { surfaces: { Clay: {
    last52: { sample: { matches: 12 }, serve: { rating: 280, pct: 50 }, underPressure: { rating: 231.5, pct: 80, srScope: 'last52' } },
    sinceBase: { serve: { rating: 270 }, underPressure: { rating: 207.6, srScope: 'career' } },
  } } };
  const axes = [{ key: 'serve', dp: 0 }, { key: 'underPressure', dp: 1 }];
  const out = {};
  const m = { _mdna: { byKey: { 1: rec } }, MDNA_AXES: axes, MDNA_FLOOR: 10 };
  vm.runInNewContext(sliceFn(dash, 'function mdnaRadarFor(') + '\nout = mdnaRadarFor(1, "Clay", "last52", null);', Object.assign(m, { out: null }));
  out.match = m.out.deltas;
  const h = { _dna: { byKey: { 1: rec } }, DNA_AXES: axes, DNA_FLOOR: 10, fn: null, out: null };
  vm.runInNewContext(sliceFn(dash, '  function dnaRadarFor(') + '\nout = dnaRadarFor(1, "Clay", "last52", null);', h);
  out.h2h = h.out.deltas;
  return out;
}
function deltasOk(d) {
  for (const k of ['match', 'h2h']) {
    assert.strictEqual(d[k][0], 10, `${k} radar: Serve Δ vs since-2024 should still print`);
    assert.strictEqual(d[k][1], null, `${k} radar: Under-pressure Δ against a career baseline must not print`);
  }
}

console.log('TEN-328 — Under pressure: one builder');
const B = loadBuilder(SRC);
for (const k of Object.keys(CHECKS)) check(`${k}. real builder`, () => CHECKS[k](B));

const dnaFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'dna-apitennis-ratings.json'), 'utf8'));
const srFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'surface-ratings.json'), 'utf8'));
const srcMeta = dnaFile._meta && dnaFile._meta.underPressureSource;
check('5. committed DNA file carries the surface-ratings value', () => {
  assert.ok(srcMeta, 'dna-apitennis-ratings.json has no _meta.underPressureSource — not sourced from surface-ratings');
  if (srcMeta.generatedAt !== srFile.generatedAt) {
    committedAgree(dnaFile, srFile, B.UP_SCOPE_FROM_SR, false);
    console.log(`        (DNA sourced from SR ${srcMeta.generatedAt}; committed SR is ${srFile.generatedAt} — ` +
      'surface-ratings.yml re-sources both together, so this is a race; value check skipped, scope check run)');
    return;
  }
  const n = committedAgree(dnaFile, srFile, B.UP_SCOPE_FROM_SR, true);
  const med = dnaFile.players.find(p => p.name === 'D. Medvedev');
  const srMed = srFile.players.find(p => p.name === 'D. Medvedev');
  if (med && srMed) assert.strictEqual(med.surfaces.Clay.last52.underPressure.rating, srMed.surfaces.Clay.last52.underPressure.rating);
  console.log(`        ${n} player×surface×scope cells equal surface-ratings`);
});
check('6. radars print no Under-pressure Δ against a career baseline', () => deltasOk(radarDeltas(DASH)));

// ---- mutation controls: each must turn its check red ------------------------
const MUTANTS = [
  ['M1', 1, s => mutate(s, 'serve, return: ret, underPressure: null,',
    'serve, return: ret, underPressure: { rating: a.tbPlayed > 0 ? 100 * a.tbWon / a.tbPlayed : null },')],
  ['M2', 2, s => mutate(s, "sinceBase: 'career' }", "sinceBase: 'last52' }")],
  ['M3', 2, s => mutate(s, 'estimated: rating != null && u.components === 3,', 'estimated: false,')],
  ['M4', 3, s => mutate(s, 'if (row) joined++;', 'if (row) joined++; else continue;')],
  ['M5', 3, s => mutate(s, 'byName.set(r.name, byName.has(r.name) ? null : r);', 'byName.set(r.name, r);')],
  ['M6', 4, s => mutate(s, 'const SR_MIN = 150;', 'const SR_MIN = 0;')],
];
for (const [id, k, fn] of MUTANTS) {
  check(`${id} is caught by check ${k}`, () => {
    const mutant = loadBuilder(fn(SRC));        // a mutant that does not load is not a catch
    let red = false;
    try { CHECKS[k](mutant); } catch (e) { red = true; }
    assert.ok(red, `${id} survived`);
  });
}
check('M2 is caught by check 5 (committed files, scope check alone)', () => {
  assert.throws(() => committedAgree(dnaFile, srFile, { last52: 'last52', sinceBase: 'last52' }, false));
});
check('M7 is caught by check 5 (one value off)', () => {
  // Re-source a copy from the committed SR first, so the pair is in sync whatever
  // the committed DNA file's lag — the control can never be vacuous.
  const copy = JSON.parse(JSON.stringify(dnaFile));
  B.sourceUnderPressure(copy.players, srFile);
  copy._meta.underPressureSource = B.underPressureMeta(srFile, 0, copy.players);
  committedAgree(copy, srFile, B.UP_SCOPE_FROM_SR, true);          // the synced copy passes
  const p = copy.players.find(x => srFile.players.some(r => r.name === x.name));
  const u = p.surfaces.All.sinceBase.underPressure;
  u.rating = u.rating == null ? 250 : u.rating + 0.1;
  assert.throws(() => committedAgree(copy, srFile, B.UP_SCOPE_FROM_SR, true), 'one wrong value survived');
});
check('M8 is caught by check 6 (match radar guard removed)', () => {
  const d = DASH.replace("const baseOk = b && b.rating != null && b.srScope !== 'career';\n      deltas",
    'const baseOk = b && b.rating != null;\n      deltas');
  assert.notStrictEqual(d, DASH, 'M8 anchor not found');
  assert.throws(() => deltasOk(radarDeltas(d)));
});
check('M9 is caught by check 6 (H2H radar guard removed)', () => {
  const d = DASH.replace("const baseOk = b && b.rating != null && b.srScope !== 'career';\n        deltas",
    'const baseOk = b && b.rating != null;\n        deltas');
  assert.notStrictEqual(d, DASH, 'M9 anchor not found');
  assert.throws(() => deltasOk(radarDeltas(d)));
});

// 7 — the SR workflow keeps the two files in one commit.
const SR_WF = fs.readFileSync(path.join(ROOT, '.github/workflows/surface-ratings.yml'), 'utf8');
function srWorkflowResyncs(wf) {
  const resource = wf.indexOf('node tools/dna-up-from-surface-ratings.js');
  const commit = wf.indexOf('git add surface-ratings.json dna-apitennis-ratings.json');
  assert.ok(resource > 0, 'surface-ratings.yml does not re-source the DNA Under-pressure axis');
  assert.ok(commit > resource, 'surface-ratings.yml does not commit the re-sourced DNA file with surface-ratings.json');
  assert.ok(wf.indexOf('node tools/test-dna-up-one-builder.js', resource) > resource, 'the re-sourced file is not gated');
}
check('7. surface-ratings.yml re-sources and commits the DNA file', () => srWorkflowResyncs(SR_WF));
check('M10 is caught by check 7 (SR committed alone)', () => {
  const w = SR_WF.split('git add surface-ratings.json dna-apitennis-ratings.json').join('git add surface-ratings.json');
  assert.notStrictEqual(w, SR_WF, 'M10 anchor not found');
  assert.throws(() => srWorkflowResyncs(w));
});

// 8 — the DNA bot never rebases a generated file over the SR bot's copy.
const DNA_WF = fs.readFileSync(path.join(ROOT, '.github/workflows/dna-ratings.yml'), 'utf8');
function dnaWorkflowRebuilds(wf) {
  const step = wf.slice(wf.indexOf('- name: Commit refreshed dna-apitennis-ratings.json'));
  assert.ok(step.length < wf.length, 'dna-ratings.yml commit step not found');
  assert.ok(!/commitback-push\.sh|pull --rebase/.test(step), 'dna-ratings.yml rebases its generated file again');
  const reset = step.indexOf('git reset -q --hard origin/main');
  // without the restore, every attempt re-sources main's OLD file and exits green
  // having thrown away this run's Serve/Return/Dominance rebuild
  const restore = step.indexOf('cp "$RUNNER_TEMP/dna-built.json" dna-apitennis-ratings.json');
  const resource = step.indexOf('node tools/dna-up-from-surface-ratings.js');
  const pctGate = step.indexOf('node tools/test-dna-percentiles.js');
  const gate = step.indexOf('node tools/test-dna-up-one-builder.js');
  const push = step.indexOf('git push origin HEAD:main');
  assert.ok(reset >= 0 && reset < restore && restore < resource && resource < pctGate && pctGate < push &&
    resource < gate && gate < push, 'each attempt must reset to main, restore the built file, re-source, run both gates, then push');
}
check('8. dna-ratings.yml rebuilds its commit on the current main', () => dnaWorkflowRebuilds(DNA_WF));
check('M11 is caught by check 8 (back to commitback-push.sh)', () => {
  const i = DNA_WF.indexOf('- name: Commit refreshed dna-apitennis-ratings.json');
  const w = DNA_WF.slice(0, i) + '- name: Commit refreshed dna-apitennis-ratings.json\n        run: |\n' +
    '          COMMITBACK_OWNED=dna-apitennis-ratings.json bash tools/commitback-push.sh "m" dna-apitennis-ratings.json\n';
  assert.throws(() => dnaWorkflowRebuilds(w));
});

check('M12 is caught by check 8 (built file not restored)', () => {
  const w = DNA_WF.split('cp "$RUNNER_TEMP/dna-built.json" dna-apitennis-ratings.json\n').join('');
  assert.notStrictEqual(w, DNA_WF, 'M12 anchor not found');
  assert.throws(() => dnaWorkflowRebuilds(w));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
