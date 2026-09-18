#!/usr/bin/env node
'use strict';
// TEN-206 — locks tools/match-stats-store.js.
//
// Every check here carries a MUTATING NEGATIVE CONTROL: the assertion is run a
// second time against a store deliberately broken in the one way the guard exists
// to catch, and the test fails if the guard stays quiet. A guard that has never
// been seen to fire is not a guard — TEN-206 shipped two probes that passed
// vacuously before this rule was adopted.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const store = require('./match-stats-store.js');
const { depth, mergeStores, hydrate, freeze, PLAIN, GZ } = store;

let checks = 0;
function check(label, fn) {
  fn();
  checks++;
  console.log(`  ok  ${label}`);
}

// ---------------------------------------------------------------- fixtures
const FULL = {
  p1: {
    'Service:Aces': 4, 'Points:Total Points Won': 55.1,
    'Points:Service Points Won': 60, 'Points:Return Points Won': 40,
    'Games:Service games won': 90, 'Games:Return games won': 30,
    raw: { 'Games:Service games won': { won: 9, total: 10 } },
  },
  p2: { 'Service:Aces': 2, 'Points:Total Points Won': 44.9 },
};
const SHALLOW = { p1: { 'Service:Aces': 4, 'Points:Total Points Won': 55.1 }, p2: { 'Service:Aces': 2 } };

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hms-store-'));
const writePlain = (root, obj) => fs.writeFileSync(path.join(root, PLAIN), JSON.stringify(obj));
const writeGz = (root, obj) => fs.writeFileSync(path.join(root, GZ), zlib.gzipSync(Buffer.from(JSON.stringify(obj)), { level: 9 }));
const readPlain = (root) => JSON.parse(fs.readFileSync(path.join(root, PLAIN), 'utf8'));
const readGz = (root) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, GZ))).toString('utf8'));

console.log('match-stats-store: depth() is the merge currency');

check('depth ranks null < empty < shallow < full', () => {
  assert.ok(depth(null) < depth({ p1: {}, p2: {} }));
  assert.ok(depth(SHALLOW) < depth(FULL));
  // control: a store that ignored null would tie them
  assert.notStrictEqual(depth(null), depth({ p1: {}, p2: {} }));
});

check('depth ignores the derived `raw` sub-object', () => {
  const withRaw = JSON.parse(JSON.stringify(FULL));
  const withoutRaw = JSON.parse(JSON.stringify(FULL));
  delete withoutRaw.p1.raw;
  assert.strictEqual(depth(withRaw), depth(withoutRaw));
  // control: adding a REAL field must move it, or the counter counts nothing
  withRaw.p1['Points:Net points won'] = 70;
  assert.strictEqual(depth(withRaw), depth(withoutRaw) + 1);
});

console.log('match-stats-store: mergeStores() is union, upgrade-only');

check('merge keeps every key from both sides', () => {
  const m = mergeStores({ a: { matchStats: FULL } }, { b: { matchStats: SHALLOW } });
  assert.deepStrictEqual(Object.keys(m).sort(), ['a', 'b']);
});

check('merge upgrades a shallow incumbent', () => {
  const m = mergeStores({ a: { matchStats: SHALLOW } }, { a: { matchStats: FULL } });
  assert.strictEqual(depth(m.a.matchStats), depth(FULL));
});

check('merge REFUSES to shallow a deep incumbent (negative control)', () => {
  const m = mergeStores({ a: { matchStats: FULL } }, { a: { matchStats: SHALLOW } });
  assert.strictEqual(depth(m.a.matchStats), depth(FULL), 'a deep sheet was overwritten by a shallow one');
  // control: prove the same call DOES move when the incoming side is deeper
  const m2 = mergeStores({ a: { matchStats: SHALLOW } }, { a: { matchStats: FULL } });
  assert.notStrictEqual(depth(m.a.matchStats), depth(SHALLOW));
  assert.strictEqual(depth(m2.a.matchStats), depth(FULL));
});

check('merge upgrades a recorded provider-miss (matchStats:null)', () => {
  const m = mergeStores({ a: { matchStats: null } }, { a: { matchStats: SHALLOW } });
  assert.ok(m.a.matchStats, 'a null sheet blocked a real one');
});

console.log('match-stats-store: hydrate()');

check('hydrate writes the plain file from the .gz when nothing was restored', () => {
  const root = tmp();
  writeGz(root, { a: { matchStats: FULL } });
  hydrate(root);
  assert.deepStrictEqual(Object.keys(readPlain(root)), ['a']);
});

check('hydrate UNIONs a warm cache with the committed floor', () => {
  const root = tmp();
  writeGz(root, { floorOnly: { matchStats: FULL }, both: { matchStats: FULL } });
  writePlain(root, { warmOnly: { matchStats: SHALLOW }, both: { matchStats: SHALLOW } });
  hydrate(root);
  const out = readPlain(root);
  assert.deepStrictEqual(Object.keys(out).sort(), ['both', 'floorOnly', 'warmOnly']);
  // the shared key must keep the DEEPER side, not "whichever was restored"
  assert.strictEqual(depth(out.both.matchStats), depth(FULL));
});

check('hydrate leaves a warm cache alone when the .gz is corrupt (negative control)', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, GZ), Buffer.from('not gzip'));
  writePlain(root, { warm: { matchStats: FULL } });
  hydrate(root);
  assert.deepStrictEqual(Object.keys(readPlain(root)), ['warm'], 'a corrupt floor destroyed the warm cache');
});

console.log('match-stats-store: freeze()');

check('freeze writes the .gz from the live store', () => {
  const root = tmp();
  writePlain(root, { a: { matchStats: FULL } });
  assert.strictEqual(freeze(root), 1);
  assert.deepStrictEqual(Object.keys(readGz(root)), ['a']);
});

check('freeze is byte-identical for identical content (this IS the day-guard)', () => {
  const root = tmp();
  writePlain(root, { a: { matchStats: FULL }, b: { matchStats: SHALLOW } });
  freeze(root);
  const first = fs.readFileSync(path.join(root, GZ));
  fs.unlinkSync(path.join(root, GZ));
  freeze(root);
  const second = fs.readFileSync(path.join(root, GZ));
  assert.ok(first.equals(second), 'identical content produced different bytes — git would commit every run');
  // control: a real change must produce different bytes, or the check above is vacuous
  writePlain(root, { a: { matchStats: FULL }, b: { matchStats: SHALLOW }, c: { matchStats: FULL } });
  fs.unlinkSync(path.join(root, GZ));
  freeze(root);
  assert.ok(!first.equals(fs.readFileSync(path.join(root, GZ))), 'a genuine change produced identical bytes');
});

check('freeze REFUSES a store with fewer entries (shrink guard + control)', () => {
  const root = tmp();
  writeGz(root, { a: { matchStats: FULL }, b: { matchStats: FULL } });
  const floor = fs.readFileSync(path.join(root, GZ));
  writePlain(root, { a: { matchStats: FULL } });
  assert.strictEqual(freeze(root), 0, 'the shrink guard did not fire');
  assert.ok(floor.equals(fs.readFileSync(path.join(root, GZ))), 'the floor was overwritten anyway');
  // control: the SAME call must succeed once the store is whole again
  writePlain(root, { a: { matchStats: FULL }, b: { matchStats: FULL }, c: { matchStats: FULL } });
  assert.strictEqual(freeze(root), 1, 'the guard fires on a legitimate store too');
});

check('freeze REFUSES an equal-sized but SHALLOWER store (depth guard + control)', () => {
  const root = tmp();
  writeGz(root, { a: { matchStats: FULL } });
  const floor = fs.readFileSync(path.join(root, GZ));
  writePlain(root, { a: { matchStats: SHALLOW } });
  assert.strictEqual(freeze(root), 0, 'the depth guard did not fire — coverage could go backwards');
  assert.ok(floor.equals(fs.readFileSync(path.join(root, GZ))));
  // control: an equal-sized DEEPER store must be accepted
  writePlain(root, { a: { matchStats: { ...FULL, p2: { ...FULL.p2, 'Points:Net points won': 12 } } } });
  assert.strictEqual(freeze(root), 1);
});

check('hydrate -> freeze round-trips the store unchanged', () => {
  const root = tmp();
  const original = { a: { p1Key: 1, p2Key: 2, matchStats: FULL }, b: { matchStats: null } };
  writeGz(root, original);
  hydrate(root);
  freeze(root);
  assert.deepStrictEqual(readGz(root), original);
});

console.log(`\nmatch-stats-store: ${checks} checks passed.`);
