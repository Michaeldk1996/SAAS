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

const store = require('./match-stats-store.js');
const { depth, sideDepths, notShallower, strictlyDeeper, census, mergeStores, hydrate, freeze, PLAIN, FLOOR } = store;

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
  // Both sides carry the four aggregate fields: census() counts a match as covered
  // only when BOTH players do, so a p1-only fixture would make every census check
  // read 0% and hide that distinction rather than test it.
  p2: {
    'Service:Aces': 2, 'Points:Total Points Won': 44.9,
    'Points:Service Points Won': 40, 'Points:Return Points Won': 60,
    'Games:Service games won': 70, 'Games:Return games won': 10,
  },
};
// The shape the feed actually produces for some qualifying draws — one player's
// box score published, the other absent. Real: eventKey 12153350.
const ONE_SIDED = { p1: FULL.p1, p2: {} };
const SHALLOW = { p1: { 'Service:Aces': 4, 'Points:Total Points Won': 55.1 }, p2: { 'Service:Aces': 2 } };

// How a PLAIN floor actually corrupts, now that it cannot fail to gunzip: a writer
// killed mid-write, or a merge resolution left half a file. Deliberately valid-looking
// JSON right up to the cut, so this tests JSON.parse failing rather than a fixture
// that is obviously not the artifact at all.
const TRUNCATED = '{"12153350":{"p1Key":1,"p2Key":2,"matchStats":{"p1":{"Service:Aces":4';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hms-store-'));
const writePlain = (root, obj) => fs.writeFileSync(path.join(root, PLAIN), JSON.stringify(obj));
const writeFloor = (root, obj) => fs.writeFileSync(path.join(root, FLOOR), JSON.stringify(obj));
const readPlain = (root) => JSON.parse(fs.readFileSync(path.join(root, PLAIN), 'utf8'));
const readFloor = (root) => JSON.parse(fs.readFileSync(path.join(root, FLOOR), 'utf8'));

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

check('hydrate writes the working file from the floor when nothing was restored', () => {
  const root = tmp();
  writeFloor(root, { a: { matchStats: FULL } });
  hydrate(root);
  assert.deepStrictEqual(Object.keys(readPlain(root)), ['a']);
});

check('hydrate UNIONs a warm cache with the committed floor', () => {
  const root = tmp();
  writeFloor(root, { floorOnly: { matchStats: FULL }, both: { matchStats: FULL } });
  writePlain(root, { warmOnly: { matchStats: SHALLOW }, both: { matchStats: SHALLOW } });
  hydrate(root);
  const out = readPlain(root);
  assert.deepStrictEqual(Object.keys(out).sort(), ['both', 'floorOnly', 'warmOnly']);
  // the shared key must keep the DEEPER side, not "whichever was restored"
  assert.strictEqual(depth(out.both.matchStats), depth(FULL));
});

check('hydrate REPORTS a corrupt floor rather than proceeding (negative control)', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, FLOOR), TRUNCATED);
  writePlain(root, { warm: { matchStats: FULL } });
  // Asserting the RETURN VALUE, not just the file. The first version of this check
  // only looked at the plain file, and a warm cache survives a corrupt floor whether
  // or not the guard exists (mergeStores(null, warm) returns warm anyway) — so it
  // passed with the guard deleted. Proven by mutation in the clean-context review.
  assert.strictEqual(hydrate(root), 0, 'hydrate did not report the corrupt floor');
  assert.deepStrictEqual(Object.keys(readPlain(root)), ['warm'], 'a corrupt floor destroyed the warm cache');
  // control: a readable floor must return 1 through the identical call
  writeFloor(root, { floor: { matchStats: FULL } });
  assert.strictEqual(hydrate(root), 1);
});

check('hydrate does NOT invent a store from a corrupt floor', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, FLOOR), TRUNCATED);
  assert.strictEqual(hydrate(root), 0);
  assert.ok(!fs.existsSync(path.join(root, PLAIN)), 'hydrate created a store out of an unreadable floor');
});

console.log('match-stats-store: freeze()');

check('freeze writes the committed floor from the live store', () => {
  const root = tmp();
  writePlain(root, { a: { matchStats: FULL } });
  assert.strictEqual(freeze(root, { bootstrap: true }), 1);
  assert.deepStrictEqual(Object.keys(readFloor(root)), ['a']);
});

// Plain JSON removes the compressor from this argument but not the argument: what
// makes an idle run a no-commit is that JSON.stringify over the same object emits the
// same bytes, and V8's ascending order for numeric-like keys is what makes the object
// the same. The mutating control below is what stops this passing vacuously.
check('freeze is byte-identical for identical content (this IS the day-guard)', () => {
  const root = tmp();
  writePlain(root, { a: { matchStats: FULL }, b: { matchStats: SHALLOW } });
  freeze(root, { bootstrap: true });
  const first = fs.readFileSync(path.join(root, FLOOR));
  // Re-freeze IN PLACE — no unlink. The real run always has a floor present, and
  // deleting it first would exercise the bootstrap path instead of the steady state
  // this check exists to describe.
  assert.strictEqual(freeze(root), 1);
  assert.ok(first.equals(fs.readFileSync(path.join(root, FLOOR))), 'identical content produced different bytes — git would commit every run');
  // control: a real change must produce different bytes, or the check above is vacuous
  writePlain(root, { a: { matchStats: FULL }, b: { matchStats: SHALLOW }, c: { matchStats: FULL } });
  assert.strictEqual(freeze(root), 1);
  assert.ok(!first.equals(fs.readFileSync(path.join(root, FLOOR))), 'a genuine change produced identical bytes');
});

// D4 — the minification rule must bind the WRITER, not only the artifact. The repo-floor
// check further down inspects the committed file, so mutating freeze() to pretty-print
// (or to append a trailing newline) left the suite green and only went red one cycle
// later, AFTER the bot had committed a ~15 MB pretty blob. This closes that window by
// asserting what freeze() itself emits.
check('freeze WRITES minified — no newline anywhere in its own output', () => {
  const root = tmp();
  writeFloor(root, { a: { matchStats: FULL } });
  writePlain(root, { a: { matchStats: FULL }, b: { matchStats: SHALLOW } });
  assert.strictEqual(freeze(root), 1);
  const bytes = fs.readFileSync(path.join(root, FLOOR), 'utf8');
  assert.strictEqual(bytes.indexOf('\n'), -1, 'freeze() emitted a newline — the floor would commit ~4x the bytes');
  // control: the same bytes must still be the store, so this cannot pass on an empty write
  assert.deepStrictEqual(Object.keys(JSON.parse(bytes)).sort(), ['a', 'b']);
});

// D5 — the per-side depth guard was only ever exercised through strictlyDeeper() /
// notShallower() directly, never through freeze(). The existing "equal-sized but
// SHALLOWER" fixture shrinks on BOTH sides, so it cannot tell a per-side comparison
// from a summed one: swapping freeze()'s notShallower() for a summed depth() left the
// suite green. This fixture is deeper on the SUM and empties a player, which only a
// per-side comparison can reject.
check('freeze REFUSES a store that is deeper on the SUM but empties a player (D5)', () => {
  const root = tmp();
  const even = { p1: { x: 1, y: 1, z: 1 }, p2: { x: 1, y: 1, z: 1 } };          // sum 6
  const wide = { p1: { x: 1, y: 1, z: 1, q: 1, r: 1, s: 1, t: 1 }, p2: {} };    // sum 7
  assert.ok(depth(wide) > depth(even), 'fixture is wrong: wide must win on SUMMED depth');
  writeFloor(root, { a: { matchStats: even } });
  const floorBytes = fs.readFileSync(path.join(root, FLOOR));
  writePlain(root, { a: { matchStats: wide } });
  assert.strictEqual(freeze(root), 0, 'a summed-depth gain was allowed to empty p2 through freeze()');
  assert.ok(floorBytes.equals(fs.readFileSync(path.join(root, FLOOR))), 'the floor was overwritten anyway');
  // control: a genuine both-sides upgrade must still go through the SAME call
  writePlain(root, { a: { matchStats: { p1: { x: 1, y: 1, z: 1, q: 1 }, p2: { x: 1, y: 1, z: 1 } } } });
  assert.strictEqual(freeze(root), 1, 'the guard also blocks a legitimate upgrade');
});

// Captures what freeze() actually said. Needed because the containment guard
// SUBSUMES the shrink guard — a store with fewer entries necessarily drops a key,
// so both would reject it and "returned 0" cannot tell which fired. Without this
// the shrink guard is untested: inverting it left the suite green, found by
// mutation testing. It is kept for its diagnostic, so its diagnostic is what the
// check asserts.
function freezeSaying(root, opts) {
  const said = [];
  const real = console.log;
  console.log = (...a) => said.push(a.join(' '));
  try { return { rc: freeze(root, opts), out: said.join('\n') }; } finally { console.log = real; }
}

check('freeze REFUSES a store with fewer entries, naming the SHRINK (guard + control)', () => {
  const root = tmp();
  writeFloor(root, { a: { matchStats: FULL }, b: { matchStats: FULL } });
  const floor = fs.readFileSync(path.join(root, FLOOR));
  writePlain(root, { a: { matchStats: FULL } });
  const { rc, out } = freezeSaying(root);
  assert.strictEqual(rc, 0, 'the shrink guard did not fire');
  assert.match(out, /FEWER entries \(1\).*floor \(2\)/, 'refused, but not by the shrink guard — its message is gone');
  assert.match(out, /::error title=/, 'a refusal was logged without an annotation — invisible in CI');
  assert.ok(floor.equals(fs.readFileSync(path.join(root, FLOOR))), 'the floor was overwritten anyway');
  // control: the SAME call must succeed once the store is whole again
  writePlain(root, { a: { matchStats: FULL }, b: { matchStats: FULL }, c: { matchStats: FULL } });
  assert.strictEqual(freeze(root), 1, 'the guard fires on a legitimate store too');
});

check('freeze REFUSES an equal-sized but SHALLOWER store (depth guard + control)', () => {
  const root = tmp();
  writeFloor(root, { a: { matchStats: FULL } });
  const floor = fs.readFileSync(path.join(root, FLOOR));
  writePlain(root, { a: { matchStats: SHALLOW } });
  assert.strictEqual(freeze(root), 0, 'the depth guard did not fire — coverage could go backwards');
  assert.ok(floor.equals(fs.readFileSync(path.join(root, FLOOR))));
  // control: an equal-sized DEEPER store must be accepted
  writePlain(root, { a: { matchStats: { ...FULL, p2: { ...FULL.p2, 'Points:Net points won': 12 } } } });
  assert.strictEqual(freeze(root), 1);
});

check('freeze REFUSES to mint a floor when the floor is absent or corrupt', () => {
  const root = tmp();
  writePlain(root, { onlyToday: { matchStats: FULL } });
  assert.strictEqual(freeze(root), 0, 'freeze minted a new floor over a missing one');
  assert.ok(!fs.existsSync(path.join(root, FLOOR)));
  const root2 = tmp();
  fs.writeFileSync(path.join(root2, FLOOR), TRUNCATED);
  writePlain(root2, { onlyToday: { matchStats: FULL } });
  assert.strictEqual(freeze(root2), 0, 'freeze overwrote a corrupt floor with a partial store');
  // control: --bootstrap is the only way through, and it must work
  assert.strictEqual(freeze(root, { bootstrap: true }), 1);
  assert.deepStrictEqual(Object.keys(readFloor(root)), ['onlyToday']);
});

check('freeze REFUSES a same-sized store that DROPPED a key (containment + control)', () => {
  const root = tmp();
  // b is a recorded provider-miss: a missing key and a null sheet both score -1,
  // so only a containment check can tell "dropped b" from "b unchanged".
  writeFloor(root, { a: { matchStats: FULL }, b: { matchStats: null } });
  const floor = fs.readFileSync(path.join(root, FLOOR));
  writePlain(root, { a: { matchStats: FULL }, c: { matchStats: FULL } });
  assert.strictEqual(freeze(root), 0, 'the containment guard did not fire — an eventKey was lost');
  assert.ok(floor.equals(fs.readFileSync(path.join(root, FLOOR))));
  // control: keeping b and adding c must be accepted
  writePlain(root, { a: { matchStats: FULL }, b: { matchStats: null }, c: { matchStats: FULL } });
  assert.strictEqual(freeze(root), 1);
});

check('per-side depth: a total-depth gain may not wipe a player (D3 + control)', () => {
  const wide = { p1: { x: 1, y: 1, z: 1, q: 1, r: 1, s: 1, t: 1 }, p2: {} };
  const even = { p1: { x: 1, y: 1, z: 1 }, p2: { x: 1, y: 1, z: 1 } };
  assert.ok(depth(wide) > depth(even), 'fixture is wrong: wide must win on SUMMED depth');
  assert.ok(!strictlyDeeper(even, wide), 'a summed-depth gain was allowed to empty p2');
  assert.ok(!notShallower(even, wide));
  assert.deepStrictEqual(mergeStores({ a: { matchStats: even } }, { a: { matchStats: wide } }).a.matchStats, even);
  // control: a genuine both-sides upgrade must still go through
  const better = { p1: { x: 1, y: 1, z: 1, q: 1 }, p2: { x: 1, y: 1, z: 1 } };
  assert.ok(strictlyDeeper(even, better));
  assert.deepStrictEqual(mergeStores({ a: { matchStats: even } }, { a: { matchStats: better } }).a.matchStats, better);
  assert.deepStrictEqual(sideDepths(wide), [7, 0]);
});

check('merge is upgrade-only, NOT replace-on-tie (control)', () => {
  const incumbent = { p1: { x: 1 }, p2: { x: 1 } };
  const tie = { p1: { y: 2 }, p2: { y: 2 } };
  // equal depth on both sides -> the incumbent must survive. A `>=` tie-break here
  // would make hydrate's result depend on argument order rather than on content.
  assert.deepStrictEqual(mergeStores({ a: { matchStats: incumbent } }, { a: { matchStats: tie } }).a.matchStats, incumbent);
});

check('census() reports real coverage, not a constant (control)', () => {
  const full = { a: { matchStats: FULL }, b: { matchStats: FULL } };
  const half = { a: { matchStats: FULL }, b: { matchStats: SHALLOW } };
  const none = { a: { matchStats: null }, b: { matchStats: null } };
  assert.match(census(full), /2 entries, 2 with a sheet, agg 100\.0%/);
  assert.match(census(half), /2 entries, 2 with a sheet, agg 50\.0%/);
  assert.match(census(none), /2 entries, 0 with a sheet, agg —/);
  assert.notStrictEqual(census(full), census(half), 'census is blind to the thing it measures');
  // and it must SEE a one-sided sheet rather than scoring it as covered
  const lopsided = { a: { matchStats: FULL }, b: { matchStats: ONE_SIDED } };
  assert.match(census(lopsided), /agg 50\.0%, 1 one-sided/, 'census counted a half-published match as covered');
});

// THE GUARD D1 NAMES. tools/match-stats-store.js says an unreadable committed floor
// "must be caught by npm test, before the commit" — and until this check existed, it
// was not: every other check runs on mkdtemp fixtures and never opens the real file.
// This is the only thing standing between a corrupt .gz and a deploy that publishes
// a blank match sheet.
check('the REPO\'s committed floor is readable, non-degenerate and well-formed', () => {
  const repoFloor = path.join(__dirname, '..', FLOOR);
  assert.ok(fs.existsSync(repoFloor), `${FLOOR} is not committed`);
  const bytes = fs.readFileSync(repoFloor, 'utf8');
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(bytes); },
    `${FLOOR} is corrupt — CI would hydrate nothing and publish a blank match sheet`);
  // MINIFIED, and asserted rather than assumed. A pretty-printed floor parses and
  // hydrates identically, so nothing downstream would complain — it would just
  // quietly cost ~4x the bytes on every one of the ~340 refresh commits a year,
  // which is the entire point of the founder's plain-JSON ruling. The check is a
  // newline count, not a byte total, so legitimate growth never trips it.
  assert.strictEqual(bytes.indexOf('\n'), -1,
    `${FLOOR} is pretty-printed — the committed floor must be minified`);
  const keys = Object.keys(parsed);
  assert.ok(keys.length > 0, 'the committed floor is empty');
  let sheets = 0;
  for (const k of keys) {
    const e = parsed[k];
    assert.ok(e && typeof e === 'object', `entry ${k} is not an object`);
    assert.ok('matchStats' in e, `entry ${k} has no matchStats field — a provider-miss must be recorded as null, not omitted`);
    if (e.matchStats) { assert.ok(e.matchStats.p1, `entry ${k} has a sheet with no p1 side`); sheets++; }
  }
  // A floor that has stopped carrying box scores is as bad as a missing one, and
  // fails silently. Deliberately a floor, not the current value: this asserts the
  // artifact is a box-score store, and does not freeze today's coverage number.
  assert.ok(sheets > keys.length / 2, `only ${sheets}/${keys.length} entries carry a sheet — the floor has rotted`);
  console.log(`      (repo floor: ${census(parsed)})`);
});

check('hydrate -> freeze round-trips the store unchanged', () => {
  const root = tmp();
  const original = { a: { p1Key: 1, p2Key: 2, matchStats: FULL }, b: { matchStats: null } };
  writeFloor(root, original);
  hydrate(root);
  freeze(root);
  assert.deepStrictEqual(readFloor(root), original);
});

console.log(`\nmatch-stats-store: ${checks} checks passed.`);
