#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// FOUNDER RULING 2026-09-19 — the tournament list order is PINNED.
//
//   "162 positions moving with a 22-place jump is a member opening a page they
//    know and finding it rearranged … Pin it to a stable, stated key and write
//    the key into the spec."
//
// PINNED KEY:  matches played DESC -> last played DESC -> display name ASC
//
// The defect was never the primary key. `tournViews` sorted on `b.n - a.n`
// alone; Array.sort is stable, so all ties fell through to whatever order
// career-backfill.js happened to emit. Measured on the deployed store, 89.6% of
// rows (11,664 of 13,012) sit in a tie on match count, so ~90% of the list was
// ordered by upstream merge sequence.
//
// THE LOAD-BEARING PROPERTY THIS FILE ASSERTS is therefore not "the list is
// sorted" — it is that the STORE'S EMISSION ORDER CANNOT REACH THE PAGE. The
// test shuffles the store and requires the rendered order to be byte-identical.
// A sort that is merely "sorted" passes a sortedness check while still leaking
// merge order through its ties; only the shuffle catches that.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0; const fails = [];
function check(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fails.push(name); console.error(`  FAIL ${name}\n       ${e.message}`); }
}

function loadModule(profiles) {
  const sandbox = { FEATURE_PP2: true, playerProfiles: { players: profiles }, courtSpeedMap: {} };
  global.window = sandbox;
  const src = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  new Function('window', src)(sandbox);   // eslint-disable-line no-new-func
  return sandbox.PlayerProfileV2;
}

// A player whose rows are deliberately built so that the count alone cannot
// order them: five of the seven tie at n=4. Under the old key those five were
// ordered by however the store listed them.
function ed(year, w, l) {
  const matches = [];
  for (let i = 0; i < w; i++) matches.push({ res: 'W', round: 'R32', opp: 'X', score: '6-3 6-4' });
  for (let i = 0; i < l; i++) matches.push({ res: 'L', round: 'R32', opp: 'Y', score: '3-6 4-6' });
  return { year: String(year), matches };
}
const ROWS = [
  { name: 'Zagreb',    won: 9, lost: 1, editions: [ed(2019, 9, 1)] },   // n=10
  { name: 'Delray',    won: 3, lost: 1, editions: [ed(2026, 3, 1)] },   // n=4  2026
  { name: 'Acapulco',  won: 2, lost: 2, editions: [ed(2026, 2, 2)] },   // n=4  2026
  { name: 'Basel',     won: 1, lost: 3, editions: [ed(2024, 1, 3)] },   // n=4  2024
  { name: 'Cordoba',   won: 4, lost: 0, editions: [ed(2024, 4, 0)] },   // n=4  2024
  { name: 'Estoril',   won: 0, lost: 4, editions: [ed(2011, 0, 4)] },   // n=4  2011
  { name: 'Newport',   won: 1, lost: 0, editions: [ed(2022, 1, 0)] },   // n=1
];
const PROFILE = (rows) => ({ 1: { name: 'T. Subject', rank: 1, tournamentHistory: rows } });

const EXPECTED = [
  'Zagreb',    // n=10
  'Acapulco',  // n=4, 2026, A before D
  'Delray',    // n=4, 2026
  'Basel',     // n=4, 2024, B before C
  'Cordoba',   // n=4, 2024
  'Estoril',   // n=4, 2011
  'Newport',   // n=1
];

function orderFor(rows) {
  const M = loadModule(PROFILE(rows));
  const views = M._internals.tournViews(PROFILE(rows)[1]);
  return views.map(v => v.display);
}

check('the pinned key orders: matches desc, then last played desc, then name', () => {
  assert.deepStrictEqual(orderFor(ROWS), EXPECTED);
});

// ── THE ONE THAT MATTERS ────────────────────────────────────────────────────
// Deterministic shuffles of the store. Every one must render identically. This
// is what fails if the sort ever falls back to emission order for its ties.
check('the STORE ORDER cannot reach the page (8 shuffles, all identical)', () => {
  const base = orderFor(ROWS);
  assert.deepStrictEqual(base, EXPECTED, 'baseline order drifted');
  for (let seed = 1; seed <= 8; seed++) {
    // deterministic permutation: rotate by `seed`, then reverse every other run
    const rot = ROWS.slice(seed % ROWS.length).concat(ROWS.slice(0, seed % ROWS.length));
    const shuffled = seed % 2 ? rot.slice().reverse() : rot;
    const got = orderFor(shuffled);
    assert.deepStrictEqual(got, base,
      `shuffle ${seed} changed the rendered order:\n       ${got.join(' · ')}\n       vs\n       ${base.join(' · ')}`);
  }
});

check('reversing the store leaves the order byte-identical', () => {
  assert.deepStrictEqual(orderFor(ROWS.slice().reverse()), EXPECTED);
});

// ── CONTROLS ────────────────────────────────────────────────────────────────
// Without these, "order is stable under shuffle" is satisfied by any constant
// order — including one that ignores the data entirely.
check('CONTROL: the count still decides when counts differ', () => {
  const M = loadModule(PROFILE(ROWS));
  const o = M._internals.tournOrder;
  assert.ok(o({ n: 10, lastYear: 2000, display: 'Z' }, { n: 4, lastYear: 2026, display: 'A' }) < 0,
    'a 10-match row must outrank a 4-match row whatever its year or name');
});

check('CONTROL: recency decides within a count band, before the name', () => {
  const M = loadModule(PROFILE(ROWS));
  const o = M._internals.tournOrder;
  assert.ok(o({ n: 4, lastYear: 2026, display: 'Z' }, { n: 4, lastYear: 2011, display: 'A' }) < 0,
    'within one count band the more recent row must come first, even with a later name');
});

check('CONTROL: the order is TOTAL — no pair ever compares equal', () => {
  const M = loadModule(PROFILE(ROWS));
  const o = M._internals.tournOrder;
  const views = M._internals.tournViews(PROFILE(ROWS)[1]);
  for (let i = 0; i < views.length; i++) {
    for (let j = i + 1; j < views.length; j++) {
      assert.notStrictEqual(o(views[i], views[j]), 0,
        `${views[i].display} and ${views[j].display} compare equal — the order falls back to store order for this pair`);
    }
  }
});

console.log(`\ntournament order: ${pass} pass, ${fails.length} fail`);
if (fails.length) { console.error('FAILED: ' + fails.join(' · ')); process.exit(1); }
