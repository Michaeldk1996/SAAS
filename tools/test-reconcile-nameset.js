// tools/test-reconcile-nameset.js — locks the two additive reconciler tiers
// added for TEN-206-A (founder ruling 2026-09-18 item 1).
//
// These run on FIXTURES, not on the live store, on purpose: the behaviour being
// locked is the MATCHER's, and a matcher lock that depends on today's roster
// stops testing the matcher the moment the roster moves. The roster-wide
// before/after measurement lives in tools/audit-reconcile-nameset.js, which
// reads the deployed store.
//
// Every positive assertion below is paired with a NEGATIVE CONTROL that must
// FAIL — the house rule. Where a check can only fail in one direction, it says
// which.
//
// Run: node tools/test-reconcile-nameset.js

'use strict';
const assert = require('assert');
const { _internal } = require('../career-backfill.js');
const { reconcile, apiInitialSig, tmlInitialCanons, fullNameSig, surnameSig } = _internal;

let pass = 0, fail = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; failures.push(name + ' :: ' + e.message); console.log('  FAIL  ' + name + ' :: ' + e.message); }
}
function neg(name, fn) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (threw) { pass++; console.log('  PASS  [neg] ' + name + ' (correctly rejected)'); }
  else { fail++; failures.push('[neg] ' + name + ' :: DID NOT FAIL — the positive check is vacuous'); console.log('  FAIL  [neg] ' + name + ' :: DID NOT FAIL — the positive check above is vacuous'); }
}

// A TML identity as buildTmlIndex() shapes it.
function ident(names, ioc, maxYear) {
  return { key: null, names: new Map(names.map((n) => [n, 1])), iocs: new Set([ioc]), maxYear };
}
function run(profiles, identityEntries) {
  return reconcile(profiles, new Map(identityEntries), {});
}

console.log('\n── signatures ──────────────────────────────────────────────────');

check('apiInitialSig parses a two-initial name into initials + surname', () => {
  const s = apiInitialSig('D. E. Galan');
  assert.deepStrictEqual(s.initials, ['d', 'e']);
  assert.deepStrictEqual([...s.set], ['galan']);
  assert.strictEqual(s.canon, 'de|galan');
});

check('apiInitialSig REFUSES a single-initial name — that is tier 1\'s job', () => {
  assert.strictEqual(apiInitialSig('N. Djokovic'), null);
  assert.strictEqual(apiInitialSig('C. Alcaraz'), null);
});

check('apiInitialSig REFUSES a name with a trailing lone initial', () => {
  // "J. M. C. R." is not "initials then surname"; a guess here would match the
  // wrong person rather than decline.
  assert.strictEqual(apiInitialSig('J. M. C. R.'), null);
});

check('tmlInitialCanons offers one canon per given/surname boundary', () => {
  assert.deepStrictEqual(tmlInitialCanons('Daniel Elahi Galan'), ['de|galan']);
  assert.deepStrictEqual(tmlInitialCanons('Juan Pablo Varillas Patino Samudio'),
    ['jp|patino samudio varillas', 'jpv|patino samudio', 'jpvp|samudio']);
});

check('tmlInitialCanons declines a two-token name (no boundary to infer)', () => {
  assert.deepStrictEqual(tmlInitialCanons('Novak Djokovic'), []);
});

check('fullNameSig is order-insensitive over every token', () => {
  assert.strictEqual(fullNameSig('Elahi Galan Daniel').canon, fullNameSig('Daniel Elahi Galan').canon);
});

check('fullNameSig REFUSES any set containing an initial', () => {
  // An initial can never equal a spelled-out token, so admitting one would only
  // ever produce a near-miss that some other tier should handle.
  assert.strictEqual(fullNameSig('D. E. Galan'), null);
});

console.log('\n── tier 2b · multi-initial ─────────────────────────────────────');

const GALAN = { 1735: { name: 'D. E. Galan', country: 'Colombia' } };
const GALAN_TML = [['t1', ident(['Daniel Elahi Galan'], 'COL', 2020)]];

check('a two-initial API name reconciles to its spelled-out TML identity', () => {
  const m = run(GALAN, GALAN_TML);
  assert.strictEqual(m.get('1735'), 't1', 'D. E. Galan did not reach Daniel Elahi Galan');
});

check('THE BUG THIS FIXES: tier 1 alone cannot match it', () => {
  // surnameSig reads the second initial as a surname token. This is the
  // measurement, not a restatement: {e,galan} != {elahi,galan}.
  const api = surnameSig('D. E. Galan');
  const tml = surnameSig('Daniel Elahi Galan');
  assert.notStrictEqual(api.canon, tml.canon);
  assert.deepStrictEqual([...api.set].sort(), ['e', 'galan']);
  assert.deepStrictEqual([...tml.set].sort(), ['elahi', 'galan']);
});

neg('a WRONG surname must not match on the initials alone', () => {
  const m = run({ 1735: { name: 'D. E. Gomez', country: 'Colombia' } }, GALAN_TML);
  assert.strictEqual(m.get('1735'), 't1');
});

neg('the initial SEQUENCE is ordered — reversing it must not match', () => {
  const m = run({ 1735: { name: 'E. D. Galan', country: 'Colombia' } }, GALAN_TML);
  assert.strictEqual(m.get('1735'), 't1');
});

neg('a WRONG second initial must not match', () => {
  const m = run({ 1735: { name: 'D. X. Galan', country: 'Colombia' } }, GALAN_TML);
  assert.strictEqual(m.get('1735'), 't1');
});

check('two co-active namesakes are DROPPED, never guessed', () => {
  // Same canon, same country, both current: IOC cannot separate them and the
  // >=4yr era guard refuses. Direction: this check can only fail by the matcher
  // becoming MORE permissive, which is the direction that corrupts records.
  const m = run({ 9: { name: 'D. E. Galan', country: 'Colombia' } }, [
    ['t1', ident(['Daniel Elahi Galan'], 'COL', 2020)],
    ['t2', ident(['Diego Eduardo Galan'], 'COL', 2019)],
  ]);
  assert.strictEqual(m.has('9'), false, 'an ambiguous pair was resolved instead of dropped');
});

check('a >=4yr era separation DOES resolve the same pair', () => {
  const m = run({ 9: { name: 'D. E. Galan', country: 'Colombia' } }, [
    ['t1', ident(['Daniel Elahi Galan'], 'COL', 2020)],
    ['t2', ident(['Diego Eduardo Galan'], 'COL', 2009)],
  ]);
  assert.strictEqual(m.get('9'), 't1');
});

console.log('\n── tier 2 · full token set ─────────────────────────────────────');

check('a surname-first API name reconciles to the same person', () => {
  const m = run({ 5: { name: 'Elahi Galan Daniel', country: 'Colombia' } },
    [['t1', ident(['Daniel Elahi Galan'], 'COL', 2020)]]);
  assert.strictEqual(m.get('5'), 't1');
});

neg('a SUBSET of the token set must not match — equality only', () => {
  // Order is already gone at this tier, so a subset test has no direction left
  // to constrain it; "Silva" would swallow "Reis Da Silva".
  const m = run({ 5: { name: 'Da Silva', country: 'Brazil' } },
    [['t1', ident(['Joao Reis Da Silva'], 'BRA', 2020)]]);
  assert.strictEqual(m.get('5'), 't1');
});

console.log('\n── the tiers are ADDITIVE ──────────────────────────────────────');

check('tier 1 still wins where it applies, and the new tiers never re-point it', () => {
  // Mischa (2019) and Alexander (current) share canon "z|zverev". Tier 1 +
  // era-disambiguation resolves to the active one; the new tiers must not run
  // at all here, and must not move him.
  const m = run({ 3: { name: 'A. Zverev', country: 'Germany' } }, [
    ['mz', ident(['Mischa Zverev'], 'GER', 2019)],
    ['az', ident(['Alexander Zverev'], 'GER', 2026)],
  ]);
  assert.strictEqual(m.get('3'), 'az');
});

check('a name no tier can place stays UNMATCHED rather than falling through', () => {
  const m = run({ 4: { name: 'Q. Z. Nobody', country: 'World' } }, GALAN_TML);
  assert.strictEqual(m.has('4'), false);
});

console.log(`\n================================================================\nPASS ${pass}   FAIL ${fail}`);
if (failures.length) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
