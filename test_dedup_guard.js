#!/usr/bin/env node
/* TEN-107 regression test for the player-key duplicate guard (founder ruling
 * 2026-09-03). The board's tour+surname dedup passes are defeated when the two
 * feeds render a match differently (un-aliased tour label, initials-only names);
 * that is how a match survived as TWO cards — one stranded-live odds card, one
 * completed api-tennis twin. dedupeByPlayerKeyPair keys on the numeric player
 * pair (identical across both feeds) to catch them.
 *
 * Asserts: (1) collapses a same-pair twin that differs in BOTH name and tour
 * label, keeping the finished (richest) card; (2) leaves a genuine rematch weeks
 * apart intact; (3) is a no-op on a real board with no duplicates.
 */
const assert = require('assert');
const { dedupeByPlayerKeyPair } = require('./bsp-pipeline');

// (1)+(2) synthetic board
const synth = [
  // stranded-live odds card: wrong day, different name + tour label than its twin
  { id: 'oddshash1', p1Key: '111', p2Key: '222', p1: 'A. Moutet', p2: 'B. Sweeny',
    date: '2026-09-02', tour: 'US Open', live: true, finalScore: null, odds: { p1: 1.8, p2: 2.0 } },
  // completed api-tennis twin: reversed key order, initials/hyphen name, aliased tour, +1 day
  { id: 'past-999', p1Key: '222', p2Key: '111', p1: 'Adrian-Moutet', p2: 'Brandon Sweeny',
    date: '2026-09-03', tour: 'ATP US Open', live: false, finalScore: '6-3 6-4', odds: null },
  // a distinct match — must be untouched
  { id: 'other', p1Key: '333', p2Key: '444', p1: 'C. X', p2: 'D. Y',
    date: '2026-09-03', tour: 'US Open', live: true, finalScore: null, odds: { p1: 1.5, p2: 2.5 } },
  // genuine rematch, same pair, 9 days apart — must NOT collapse
  { id: 'rematchA', p1Key: '555', p2Key: '666', p1: 'E', p2: 'F', date: '2026-09-01', tour: 'ATP A', finalScore: '6-1 6-1' },
  { id: 'rematchB', p1Key: '666', p2Key: '555', p1: 'E', p2: 'F', date: '2026-09-10', tour: 'ATP B', finalScore: '6-2 6-2' },
];
const removed = dedupeByPlayerKeyPair(synth);
const ids = new Set(synth.map(m => m.id));
assert.strictEqual(removed, 1, 'expected exactly 1 twin removed');
assert.ok(ids.has('past-999'), 'kept the finished (richest) twin');
assert.ok(!ids.has('oddshash1'), 'dropped the stranded-live twin');
assert.ok(ids.has('other'), 'left the distinct match');
assert.ok(ids.has('rematchA') && ids.has('rematchB'), 'left the distant rematch intact');

// (3) no-op on a board with no same-pair duplicates
const clean = [
  { id: 'a', p1Key: '1', p2Key: '2', date: '2026-09-03', live: true },
  { id: 'b', p1Key: '3', p2Key: '4', date: '2026-09-03', finalScore: '6-0 6-0' },
  { id: 'c', p1Key: '5', p2Key: '6', date: '2026-09-03' },
];
const before = clean.length;
const removed2 = dedupeByPlayerKeyPair(clean);
assert.strictEqual(removed2, 0, 'clean board: nothing removed');
assert.strictEqual(clean.length, before, 'clean board: length unchanged');

console.log('PASS: player-key duplicate guard collapses cross-feed twins, keeps richest, spares distinct + distant rematches, no-ops on clean boards.');
