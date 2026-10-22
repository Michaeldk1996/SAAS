#!/usr/bin/env node
// tools/test-ret-pinnacle-render.js — founder ruling 2026-10-22 (ruling 4), on the RENDER path of the player profile:
// a retirement the Market edge shard settled VOID (first set not completed) keeps its close on the row, prints "void"
// where the Calendar month drill prints a row's units and is in no units sum; one that STANDS (first set completed)
// carries its units. On the pinned Korda fixture (tools/fixtures/ten384-figures/player-2840.json, clock at its asOf):
// his US Open 2021 R128 loss to Basilashvili (1.47, a retirement) is settled void, his Adelaide 2023 SF win over Nishioka
// (1.37, a retirement) stands. A control re-runs the void check on a spine that ignores `settle` and must go red.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const assert = require('assert');
const L = require('./ten384-figures-lib.js');
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten384-figures', 'player-2840.json'), 'utf8'));
const H = L.harness();
const KEY = FX.key, SRC = path.join(L.ROOT, 'player-profile-v2.js');
function settled() {
  const me = JSON.parse(JSON.stringify(FX.marketEdge));
  me.matches.forEach((m) => {
    if (!m.ret) return;
    if (m.date === '2021-08-31') Object.assign(m, { fs: 'i', settle: 'void', pl: null, inBasis: false });
    else Object.assign(m, { fs: 'c', settle: 'stands' });
  });
  return me;
}
function load(src) {
  const { I } = L.loadPp2({ src, now: FX.asOf, players: { [KEY]: FX.profile }, careerHistory: { [KEY]: FX.careerHistory },
    marketEdge: { [KEY]: settled() }, bet365History: FX.bet365History || {} });
  return I;
}
const rowOn = (I, date) => I.calSpine(FX.profile).find((r) => r.date === date);
function voidChecks(I) {
  const v = rowOn(I, '2021-08-31');
  assert.ok(v, 'the US Open 2021 row is on the spine');
  assert.strictEqual(v.price, 1.47, 'its close stays on the row');
  assert.strictEqual(v.cents, null, 'it carries no units');
  assert.strictEqual(v.settle, 'void');
  I.resetState(); I.state.key = KEY; I.state.calTab = 'calendar'; I.state.calSurface = 'all'; I.state.calCell = '2021|7';
  const t = L.text(I.renderSeasonModal(FX.profile));
  assert.ok(/Basilashvili/.test(t) && / void /.test(' ' + t + ' '), 'the month drill prints "void" on the row');
}
H.check('ruling 4 · RENDER: a retirement before the first set was completed shows its price and "void", no units', () => voidChecks(load(SRC)));
H.check('ruling 4 · a retirement after the first set was completed carries its units (+0.37u at 1.37)', () => {
  const s = rowOn(load(SRC), '2023-01-07');
  assert.ok(s && s.price === 1.37 && s.cents === 37, JSON.stringify(s && { price: s.price, cents: s.cents }));
});
H.check('ruling 4 · the void row is in no units sum: Calendar career yield counts the stands, not the void', () => {
  const I = load(SRC), sp = I.calSpine(FX.profile);
  const priced = sp.filter((r) => r.cents != null);
  assert.ok(!priced.some((r) => r.date === '2021-08-31'), 'the void row is not priced');
  assert.ok(priced.some((r) => r.date === '2023-01-07'), 'the standing retirement is');
});
const mut = fs.readFileSync(SRC, 'utf8').replace("var vd = !pin && hit && hit.price != null && (hit.settle === 'void' || hit.settle === 'no-sets') ? hit : null;", 'var vd = null;');
const mf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'r4-')), 'pp2.js'); fs.writeFileSync(mf, mut);
H.mustFail('ruling 4 · CONTROL: a spine that ignores `settle` loses the void row\'s own close', () => voidChecks(load(mf)));
fs.rmSync(path.dirname(mf), { recursive: true, force: true });
H.done();
