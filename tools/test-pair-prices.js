'use strict';
// The Head to Head page's likely opening price (founder 2026-11-16): build-pair-prices.js runs the Stennisfy Model
// engine itself on pairs with no match behind them. Drives the REAL engine (h2h-model runModel) on the committed
// stores (elo-ratings.json, player-profiles.json, …) — every check has a control.
const assert = require('assert');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { runModel, PAIR_SKIP_LAYERS } = require(path.join(ROOT, 'h2h-model/model'));
const B = require(path.join(ROOT, 'build-pair-prices.js'));
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

const P = (JSON.parse(fs.readFileSync(path.join(ROOT, 'player-profiles.json'), 'utf8')).players) || {};
const pick = ['2072', '2382', '1980', '1905'].filter(k => P[k]);
if (pick.length < 3) { console.log('SKIP: the committed player-profiles.json holds fewer than 3 of the pinned players'); process.exit(0); }
const pl = pick.map(k => ({ key: k, name: P[k].name, rank: Number(P[k].rank) }));
const m = (a, b, surface) => ({ id: `pair-${a.key}-${b.key}`, p1Key: a.key, p2Key: b.key, p1: a.name, p2: b.name, surface, date: '2026-11-16', tour: '' });

ok('pairOnly: the four match-only layers never apply; the rest run; base state 3 (no market)', () => {
  const r = runModel(m(pl[0], pl[1], 'Hard'), { pairOnly: true, bestOf: 3 });
  assert.ok(r.ok, r.reason);
  assert.deepStrictEqual(PAIR_SKIP_LAYERS, ['subjective', 'fatigue', 'weather', 'oddsMovement']);
  for (const a of r.stage2.adjustments.filter(x => PAIR_SKIP_LAYERS.includes(x.key))) {
    assert.strictEqual(a.applied, false); assert.strictEqual(a.deltaP1, 0); assert.strictEqual(a.pairSkipped, true);
  }
  assert.strictEqual(r.stage2.adjustments.length - PAIR_SKIP_LAYERS.length, 10, 'the card says "of 10 layers"');
  assert.strictEqual(r.stage1.baseState.state, 3);
  assert.ok(r.stage2.adjustments.some(x => x.applied), 'at least one pair layer moves the price (control for the skip)');
  // control: the same record without pairOnly does not mark them skipped
  const plain = runModel(m(pl[0], pl[1], 'Hard'));
  assert.ok(plain.stage2.adjustments.every(x => !x.pairSkipped));
});
ok('pairOnly: the caller names the format (best of 5 reaches the format layer and the result)', () => {
  const r3 = runModel(m(pl[0], pl[1], 'Hard'), { pairOnly: true, bestOf: 3 });
  const r5 = runModel(m(pl[0], pl[1], 'Hard'), { pairOnly: true, bestOf: 5 });
  assert.strictEqual(r3.match.bestOf, 3); assert.strictEqual(r5.match.bestOf, 5);
  // control: without pairOnly the format comes from the tour name (none here → best of 3)
  assert.strictEqual(runModel(m(pl[0], pl[1], 'Hard'), { bestOf: 5 }).match.bestOf, 3);
});
ok('buildPairs: every pair, every context; the two shards mirror each other; the probability is the engine\'s', () => {
  const { shards, stats } = B.buildPairs(pl, { runModel, shortName: p => p.name, date: '2026-11-16' });
  assert.strictEqual(stats.pairs, pl.length * (pl.length - 1) / 2);
  const a = pl[0].key, b = pl[1].key;
  const ra = shards[a].opp[b], rb = shards[b].opp[a];
  assert.deepStrictEqual(Object.keys(ra).sort(), ['C3', 'C5', 'G3', 'G5', 'H3', 'H5']);
  for (const k of Object.keys(ra)) {
    assert.ok(Math.abs(ra[k][0] + rb[k][0] - 1e4) <= 1, `${k} mirrors`);
    assert.strictEqual(ra[k][2], rb[k][2]);
  }
  const eng = runModel(m(pl[0], pl[1], 'Clay'), { pairOnly: true, bestOf: 5 });
  assert.strictEqual(ra.C5[0], Math.round(eng.stage2.adjustedP1 * 1e4));
  assert.strictEqual(ra.C5[1], Math.round(eng.stage1.baseP1 * 1e4));
  // control: surfaces are different cells (surface Elo moves the base)
  assert.notStrictEqual(ra.H3[1], ra.C3[1]);
});
ok('buildPairs: a pair the engine cannot run is no row on either side (never a forced 50%)', () => {
  const ghost = { key: '99999999', name: 'Z. Nobody', rank: 999 };
  const { shards, stats } = B.buildPairs([pl[0], ghost], { runModel, shortName: p => p.name, date: '2026-11-16' });
  assert.strictEqual(stats.unpriced, 1);
  assert.deepStrictEqual(shards[pl[0].key].opp, {});
});
ok('topPlayers: this week\'s top N by rank from player-index.json, ranks outside it dropped', () => {
  const tmp = path.join(require('os').tmpdir(), 'pair-idx-' + process.pid + '.json');
  fs.writeFileSync(tmp, JSON.stringify({ players: [{ key: 1, name: 'A', rank: 3 }, { key: 2, name: 'B', rank: 1 }, { key: 3, name: 'C', rank: 201 }, { key: 4, name: 'D' }] }));
  assert.deepStrictEqual(B.topPlayers(tmp, 200).map(p => p.key), ['2', '1']);
  fs.unlinkSync(tmp);
});
ok('the margin is the measured Pinnacle opening margin and the shard carries it', () => {
  assert.strictEqual(B.PAIR_MARGIN, 0.0339); assert.strictEqual(B.PAIR_MARGIN_N, 442);
  assert.match(fs.readFileSync(path.join(ROOT, 'build-pair-prices.js'), 'utf8'), /margin: PAIR_MARGIN, marginN: PAIR_MARGIN_N \}, shards\[k\]/);
});
ok('pipeline.yml builds it after the run and publishes pair-prices/', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');
  const step = y.indexOf('- name: Build pair estimates (best-effort)');
  assert.ok(step > 0 && step < y.indexOf('- name: Assemble site'), 'built before the site is assembled');
  assert.match(y.slice(step, step + 600), /node build-pair-prices\.js \|\| rc=\$\?\n\s+node tools\/step-check\.mjs --step "Build pair estimates \(best-effort\)" --rc "\$rc" --since "\$t0" --fresh pair-prices-index\.json/);
  assert.match(y, /cp -r pair-prices _site\/ 2>\/dev\/null \|\| true/);
});
console.log(`pair prices: ${n} checks passed`);
