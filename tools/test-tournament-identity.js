// tools/test-tournament-identity.js — locks the canonical tournament aliases,
// and in particular the year-end championship merge (founder ruling 2026-09-18).
//
// The risk this file exists for is the BARE KEY. 'finals' collapses any name
// that normalizes to exactly "finals" into Tour Finals; if identityKey() ever
// became lossier — stripping a "Davis Cup " prefix, dropping a colon clause —
// 789 Davis Cup tie identities and two Next Gen ones would silently pour into
// the year-end row. The negative controls below are that alarm, and they are
// worth more than the positive ones.
//
// Run: node tools/test-tournament-identity.js

'use strict';
const assert = require('assert');
const { canonicalTournament, identityKey } = require('../tournament-identity.js');

let pass = 0, fail = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; failures.push(name + ' :: ' + e.message); console.log('  FAIL  ' + name + ' :: ' + e.message); }
}

const id = (n) => canonicalTournament(n).id;
const disp = (n) => canonicalTournament(n).display;

console.log('\n── year-end championship · the four names are ONE event ─────────');

['Tour Finals', 'Masters Cup', 'Finals - Turin', 'Finals', 'ATP Finals'].forEach((n) => {
  if (n === 'ATP Finals') return; // not a name the feeds emit; covered below
  check(`"${n}" is the Tour Finals identity`, () => {
    assert.strictEqual(disp(n), 'Tour Finals', `display was "${disp(n)}"`);
    assert.strictEqual(id(n), id('Tour Finals'));
  });
});

check('all four collapse to exactly ONE identity', () => {
  const ids = new Set(['Tour Finals', 'Masters Cup', 'Finals - Turin', 'Finals'].map(id));
  assert.strictEqual(ids.size, 1, `got ${ids.size} identities: ${[...ids].join(', ')}`);
});

check('the ATP tour prefix does not defeat the merge', () => {
  assert.strictEqual(disp('ATP Finals - Turin'), 'Tour Finals');
});

console.log('\n── the bare "finals" key must NOT swallow anything else ─────────');

check('Next Gen Finals stays its own event, under every spelling', () => {
  ['Next Gen Finals', 'NextGen Finals', 'Next Gen ATP Finals',
    'Next Gen Finals - Milan', 'Next Gen Finals - Jeddah'].forEach((n) => {
    assert.notStrictEqual(disp(n), 'Tour Finals', `"${n}" was swallowed by the year-end row`);
  });
});

check('Davis Cup ties stay their own identities', () => {
  ['Davis Cup Finals RR: ITA vs BEL', 'Davis Cup Finals F: ITA vs ESP',
    'Davis Cup Finals QF: AUS vs NED', 'Davis Cup WG SF: BEL vs AUS'].forEach((n) => {
    assert.notStrictEqual(disp(n), 'Tour Finals', `"${n}" was swallowed by the year-end row`);
  });
  // ...and stay distinct from EACH OTHER: the ties are separate rows today, and
  // whether they should be is a pending ruling, not something this file decides.
  assert.notStrictEqual(id('Davis Cup Finals RR: ITA vs BEL'), id('Davis Cup Finals F: ITA vs ESP'));
});

check('an event merely CONTAINING "finals" is untouched', () => {
  assert.notStrictEqual(disp('Laver Cup Finals'), 'Tour Finals');
  assert.notStrictEqual(disp('Finals Qualifying'), 'Tour Finals');
});

console.log('\n── the pre-existing aliases still hold ──────────────────────────');

check('Roland Garros folds into French Open', () => {
  assert.strictEqual(disp('Roland Garros'), 'French Open');
});

check('the Canadian Open collects all six of its names', () => {
  const ids = new Set(['Montreal', 'Toronto', 'Canada Masters', 'Canadian Open',
    'National Bank Open', 'Rogers Cup'].map(id));
  assert.strictEqual(ids.size, 1, `Canada fragmented into ${ids.size}`);
  assert.strictEqual(disp('Toronto'), 'Canada Masters');
});

check('Masters 1000 city/suffix pairs are one identity each', () => {
  [['Cincinnati', 'Cincinnati Masters'], ['Madrid', 'Madrid Masters'],
    ['Miami', 'Miami Masters'], ['Rome', 'Rome Masters'],
    ['Shanghai', 'Shanghai Masters'], ['Paris', 'Paris Masters'],
    ['Monte Carlo', 'Monte Carlo Masters'], ['Indian Wells', 'Indian Wells Masters'],
    ['Hamburg', 'Hamburg Masters']].forEach(([a, b]) => {
    assert.strictEqual(id(a), id(b), `${a} !== ${b}`);
  });
});

check('same-city SECOND events stay separate — merging those is the opposite bug', () => {
  assert.notStrictEqual(id('Adelaide'), id('Adelaide 2'));
  assert.notStrictEqual(id('Stuttgart'), id('Stuttgart 1'));
});

check('identityKey keeps digits and strips only the tour prefix', () => {
  assert.strictEqual(identityKey('ATP Adelaide 2'), 'adelaide 2');
  assert.strictEqual(identityKey("'s-Hertogenbosch"), 's hertogenbosch');
});

console.log(`\n================================================================\nPASS ${pass}   FAIL ${fail}`);
if (failures.length) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
