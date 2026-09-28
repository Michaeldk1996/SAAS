#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// TEN-319 — the DNA radar's percentiles and its roster (founder D6, 2026-09-28).
//
//  1. `pct` is a TRUE percentile rank, 100 × (below + ½·equal) / n, within a stated
//     population — not the retired p2–p98 linear rescale that pinned ~6 players per
//     axis to the rim.
//  2. The population is rated players with >= POP_MIN_MATCHES matches in that
//     scope × surface, and the file publishes it (population, n, values).
//  3. The page ranks a value the file does not hold (live Elo, the tour mean) by the
//     SAME rule, over the SAME published values — sliced from the shipped files and
//     run, never re-implemented here.
//  4. The builder never rates the committed July roster: with the deployed store
//     unreachable it aborts, and it holds no absolute path.
//
// Mutations that turn this red (each tried by hand):
//   M1  pctRank: `equal / 2` -> `equal`                  (unit ranks + synthetic top)
//   M2  POP_MIN_MATCHES 10 -> 0 (population floor gone)   (synthetic n, committed n)
//   M3  builder back to the p2–p98 rescale                (synthetic + committed pct)
//   M4  delete the `pp.source !== 'deployed'` abort       (fail-closed check)
//   M5  dashboard mdnaEloPctFromPop / eloPctFromPop back to the band formula
//   M6  player-profile-v2 dnaPctFromPop back to the band formula (tour pct check)
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const B = require(path.join(ROOT, 'dna-apitennis-ratings.js'));
const RAW = JSON.parse(fs.readFileSync(path.join(ROOT, 'dna-apitennis-ratings.json'), 'utf8'));
const META = RAW._meta || {};
const ROWS = RAW.players || [];
const SURF = ['Hard', 'Clay', 'Grass', 'All'];
const AXES = ['serve', 'return', 'underPressure', 'dominanceRatio'];
const SCOPES = ['last52', 'sinceBase'];

let pass = 0; const fails = [];
function check(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fails.push(name); console.error(`  FAIL ${name}\n       ${e.message}`); }
}

// Independent statement of the rule, used ONLY to recompute; the shipped copies are
// what is under test.
function rank(vals, v) {
  let below = 0, equal = 0;
  for (const x of vals) { if (x < v) below++; else if (x === v) equal++; }
  return +(100 * (below + equal / 2) / vals.length).toFixed(1);
}

// ── 1. the rule ───────────────────────────────────────────────────────────────
check('pctRank: top of 4 is 87.5, bottom 12.5, ties share the midpoint', () => {
  assert.strictEqual(B.pctRank([1, 2, 3, 4], 4), 87.5);
  assert.strictEqual(B.pctRank([1, 2, 3, 4], 1), 12.5);
  assert.strictEqual(B.pctRank([5, 5, 5], 5), 50);
  assert.strictEqual(B.pctRank([10, 20, 30], 25), 66.7, 'a value between members');
  assert.strictEqual(B.pctRank([10, 20, 30], 99), 100, 'above every member');
  assert.strictEqual(B.pctRank([], 5), null);
  assert.strictEqual(B.pctRank([1, 2], null), null);
});

// ── 2. the population, on a synthetic field run through the builder ──────────
function fakePlayer(key, rating, matches) {
  const node = () => ({
    serve: { rating }, return: { rating }, underPressure: { rating }, dominanceRatio: { rating },
    sample: { matches },
  });
  const surfaces = {};
  for (const s of SURF) surfaces[s] = { last52: node(), sinceBase: node(), elo: { rating: 1500 + rating, pct: null } };
  return { playerKey: key, surfaces };
}
check('synthetic field: floor-10 population, true ranks, thin player ranked but not a member', () => {
  const field = [];
  for (let i = 1; i <= 11; i++) field.push(fakePlayer(String(i), 100 + i, 12));
  field.push(fakePlayer('thin', 500, 9));           // off the chart, under the floor
  const { percentiles, eloPercentiles } = B.assignPercentiles(field);
  const pop = percentiles.last52.Hard.serve;
  assert.strictEqual(pop.n, 11, `population n ${pop.n} — the ${B.POP_MIN_MATCHES}-match floor is not applied`);
  assert.deepStrictEqual(pop.values, field.slice(0, 11).map(p => p.surfaces.Hard.last52.serve.rating));
  assert.ok(/>= 10 matches/.test(pop.population) && /Hard/.test(pop.population), `population text: ${pop.population}`);
  const top = field[10].surfaces.Hard.last52.serve.pct;
  assert.strictEqual(top, 95.5, `best member pct ${top} (want 100×10.5/11 = 95.5; a rescale pins it to 100)`);
  assert.strictEqual(field[0].surfaces.Hard.last52.serve.pct, 4.5);
  assert.strictEqual(field[11].surfaces.Hard.last52.serve.pct, 100, 'the thin player is ranked against the population');
  assert.strictEqual(eloPercentiles.Hard.n, 12, 'Elo population = every rated player with that Elo (current only, no match floor)');
});

// ── 3. the committed file obeys the rule it states ────────────────────────────
check('committed file: no p2–p98 bands; pctMethod states the percentile rank', () => {
  assert.ok(!('bands' in META) && !('eloBands' in META), 'retired p2–p98 bands still published');
  assert.ok(/percentile rank/.test(META.pctMethod || ''), `pctMethod: ${META.pctMethod}`);
  assert.ok(!/p2/.test(META.pctMethod || ''), 'pctMethod still describes the p2 band');
});
check('committed file: roster is the deployed store, not the July fossil', () => {
  assert.ok(META.roster && META.roster.source === 'deployed', `roster: ${JSON.stringify(META.roster)}`);
  assert.strictEqual(META.rosterSize, META.roster.players);
  assert.ok(ROWS.length >= 200, `only ${ROWS.length} rated`);
});
check('committed file: every pct = rank in its published population; n = the floor-cleared players', () => {
  let checked = 0;
  for (const scope of SCOPES) for (const s of SURF) for (const ax of AXES) {
    const pop = META.percentiles[scope][s][ax];
    assert.strictEqual(pop.n, pop.values.length, `${scope}/${s}/${ax} n != values.length`);
    for (let i = 1; i < pop.values.length; i++) assert.ok(pop.values[i - 1] <= pop.values[i], `${scope}/${s}/${ax} values not ascending`);
    const members = ROWS.filter(p => { const nd = p.surfaces[s][scope]; return nd.sample.matches >= B.POP_MIN_MATCHES && nd[ax] && nd[ax].rating != null; });
    assert.strictEqual(pop.n, members.length, `${scope}/${s}/${ax}: n ${pop.n} vs ${members.length} floor-cleared rated players`);
    for (const p of ROWS) {
      const r = p.surfaces[s][scope][ax];
      if (!r || r.rating == null) continue;
      if (!pop.n) { assert.strictEqual(r.pct, null); continue; }
      assert.strictEqual(r.pct, rank(pop.values, r.rating), `${p.name} ${scope}/${s}/${ax}: pct ${r.pct} vs rank ${rank(pop.values, r.rating)}`);
      checked++;
    }
  }
  for (const s of SURF) {
    const pop = META.eloPercentiles[s];
    for (const p of ROWS) {
      const e = p.surfaces[s].elo;
      if (!e) continue;
      assert.strictEqual(e.pct, rank(pop.values, e.rating), `${p.name} Elo ${s}`);
      checked++;
    }
  }
  assert.ok(checked > 1000, `only ${checked} pcts checked — vacuous`);
});
check('committed file: no axis pins a crowd to the rim (the p2–p98 symptom)', () => {
  const all = META.percentiles.last52.Hard.serve;
  const at100 = ROWS.filter(p => { const r = p.surfaces.Hard.last52.serve; return r && r.pct === 100; }).length;
  assert.ok(all.n > 50, 'Hard last52 serve population too small to judge');
  assert.ok(at100 <= 1, `${at100} players at exactly 100 on Hard last52 serve`);
});

// ── 4. the page ranks by the same rule over the same values ──────────────────
// Brace-matched slice of a named function out of shipped source (no braces in
// strings inside these functions).
function fnSource(src, name) {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `function ${name} not found in shipped source`);
  let depth = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error(`unbalanced ${name}`);
}
const DASH = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
for (const [fname, holder] of [['mdnaEloPctFromPop', '_mdna'], ['eloPctFromPop', '_dna']]) {
  check(`dashboard ${fname}: a live Elo lands where the builder put it`, () => {
    const fn = new Function(holder, `${fnSource(DASH, fname)}; return ${fname};`)({ meta: META }); // eslint-disable-line no-new-func
    let n = 0;
    for (const p of ROWS) for (const s of SURF) {
      const e = p.surfaces[s].elo;
      if (!e) continue;
      assert.strictEqual(fn(e.rating, s), e.pct, `${p.name} ${s}: page ${fn(e.rating, s)} vs file ${e.pct}`);
      n++;
    }
    const vals = META.eloPercentiles.Hard.values;
    const probe = vals[Math.floor(vals.length / 2)] + 0.5;           // a rating the file does not hold
    assert.strictEqual(fn(probe, 'Hard'), rank(vals, probe));
    assert.ok(n > 200, `only ${n} Elo values compared`);
  });
}

check('player-profile-v2: tour polygon pct = rank of the tour mean in the published population', () => {
  const SUBJECT = ROWS.find(r => r.surfaces.All.last52.serve && r.surfaces.All.last52.sample.matches >= 10);
  const players = { [SUBJECT.playerKey]: { key: SUBJECT.playerKey, name: 'T. Subject', rank: 1 } };
  const sandbox = {
    FEATURE_PP2: true, playerProfiles: { players }, courtSpeedMap: {},
    dnaRatings: { byKey: Object.fromEntries(ROWS.map(r => [String(r.playerKey), r])), players: ROWS, meta: META },
  };
  global.window = sandbox;
  new Function('window', fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8'))(sandbox); // eslint-disable-line no-new-func
  const m = sandbox.PlayerProfileV2._internals.dnaModel(players[SUBJECT.playerKey]);
  const scope = m.scope;
  let n = 0;
  for (const a of m.axes) {
    const vals = a.key === 'elo' ? META.eloPercentiles.All.values : META.percentiles[scope].All[a.key].values;
    if (a.tour == null) continue;
    assert.ok(Math.abs(a.tourPct - 100 * rank(vals, a.tour) / 100) < 0.051, `${a.key}: tourPct ${a.tourPct} vs rank ${rank(vals, a.tour)}`);
    if (a.key === 'elo') assert.strictEqual(+a.pct.toFixed(1), SUBJECT.surfaces.All.elo.pct);
    else assert.strictEqual(a.pct, SUBJECT.surfaces.All[scope][a.key].pct);
    n++;
  }
  assert.ok(n >= 4, `only ${n} axes compared`);
});

// ── 5. the roster fails closed ────────────────────────────────────────────────
check('builder aborts when only the committed roster is reachable, and holds no absolute path', () => {
  const src = fs.readFileSync(path.join(ROOT, 'dna-apitennis-ratings.js'), 'utf8');
  assert.ok(!/['"`]\/Users\//.test(src), 'an absolute /Users/ path is back in the builder');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten319-'));
  try {
    fs.mkdirSync(path.join(tmp, 'tools'));
    fs.copyFileSync(path.join(ROOT, 'dna-apitennis-ratings.js'), path.join(tmp, 'dna-apitennis-ratings.js'));
    fs.copyFileSync(path.join(ROOT, 'tools', 'deployed-store.js'), path.join(tmp, 'tools', 'deployed-store.js'));
    // A committed roster the builder could fall back to — it must refuse it.
    fs.writeFileSync(path.join(tmp, 'player-profiles.json'), JSON.stringify({ fetchedAt: '2026-07-22', players: { 1: { name: 'A B' } } }));
    const r = spawnSync(process.execPath, ['dna-apitennis-ratings.js'], {
      cwd: tmp, encoding: 'utf8', timeout: 60000,
      env: Object.assign({}, process.env, { TEN206_DATA_BASE: 'http://127.0.0.1:9', API_TENNIS_KEY: 'unused' }),
    });
    assert.notStrictEqual(r.status, 0, 'the builder exited 0 with no deployed roster');
    assert.ok(/refusing to rate the committed July fossil/.test(r.stderr), `stderr: ${r.stderr.slice(0, 300)}`);
    assert.ok(!fs.existsSync(path.join(tmp, 'dna-apitennis-ratings.json')), 'an output file was written');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
