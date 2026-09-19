#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// FOUNDER RULING 2026-09-19 — the archetype name join.
//
//   "canonicalise BOTH sides to one form, handle the multi-part surnames
//    (Moreno De Alboran, Meligeni Alves, Pacheco Mendez, A. Gomez, K. Trotter,
//    Pinnington Jones) and the Mccabe/McCabe casing."
//   "Do NOT join on surname alone anywhere, ever."
//   "The 4 collision rows ... stay UNJOINED until they have a player-ID mapping.
//    Blank is correct there; a wrong archetype on a real player is not."
//
// Every name the ruling names is driven here as a case, against a roster shaped
// like the real profile store.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const { canonName, namesCompatible, buildRosterIndex, resolveNameDetailed } = require('./name-canon.js');

let pass = 0; const fails = [];
function check(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fails.push(name); console.error(`  FAIL ${name}\n       ${e.message}`); }
}

// A roster in the profile store's own initial-last form. `Dar. Blanch` is real:
// the store abbreviates Darwin to three letters precisely because a second
// Blanch (Dali) shares the initial.
const ROSTER = buildRosterIndex({
  357:   { name: 'F. Meligeni Alves' },
  28260: { name: 'M. Alves' },
  1858:  { name: 'J. Pinnington Jones' },
  680:   { name: 'M. Jones' },
  742:   { name: 'S. Sakellaridis' },
  17584: { name: 'M. Sakellaridis' },
  17463: { name: 'Dar. Blanch' },
  717:   { name: 'F. A. Gomez' },
  9193:  { name: 'J. K. Trotter' },
  8762:  { name: 'R. Pacheco Mendez' },
  2000:  { name: 'N. Moreno De Alboran' },
  2001:  { name: 'J. McCabe' },
  2002:  { name: 'J. P. Ficovich' },
});
const resolve = (n) => resolveNameDetailed(n, ROSTER);

// ── the multi-part surnames the ruling names ────────────────────────────────
for (const [full, expect] of [
  ['Nicolas Moreno De Alboran', 'N. Moreno De Alboran'],
  ['Felipe Meligeni Alves',     'F. Meligeni Alves'],
  ['Rodrigo Pacheco Mendez',    'R. Pacheco Mendez'],
  ['Federico Agustin Gomez',    'F. A. Gomez'],
  ['James Trotter',             'J. K. Trotter'],
  ['Jack Pinnington Jones',     'J. Pinnington Jones'],
  ['Juan Pablo Ficovich',       'J. P. Ficovich'],
]) {
  check(`"${full}" resolves to "${expect}"`, () => {
    const r = resolve(full);
    assert.strictEqual(r.status, 'resolved', `status ${r.status} (candidates: ${r.candidates.map(c => c.name).join(', ') || 'none'})`);
    assert.strictEqual(r.match.name, expect, `resolved to ${r.match.name}`);
  });
}

// ── the Mccabe/McCabe casing ────────────────────────────────────────────────
check('"James Mccabe" resolves to "J. McCabe" despite the casing', () => {
  const r = resolve('James Mccabe');
  assert.strictEqual(r.status, 'resolved', `status ${r.status}`);
  assert.strictEqual(r.match.name, 'J. McCabe', `resolved to ${r.match.name}`);
});

// ── THE HAZARD. Dali is not Darwin. ─────────────────────────────────────────
// This is the one case where the founder's caution was load-bearing: a
// first-initial key collapses both to `blanch|d`, and joining would paint
// Dali's archetype onto a different real player.
check('"Dali Blanch" does NOT resolve to "Dar. Blanch" (Darwin)', () => {
  const r = resolve('Dali Blanch');
  assert.notStrictEqual(r.status, 'resolved',
    `MIS-ASSIGNMENT: Dali Blanch resolved to ${r.match && r.match.name} — a different player`);
  assert.strictEqual(r.status, 'absent', `status ${r.status}`);
});

// ── never surname alone ─────────────────────────────────────────────────────
check('a surname on its own never resolves', () => {
  assert.strictEqual(resolve('Alves').status, 'unparseable', 'a bare surname was parsed as a name');
  assert.strictEqual(canonName('Alves'), null, 'canonName accepted a single token');
});

// The line above passes because canonName REJECTS a single token, not because of
// the surname-only guard inside namesCompatible — a mutation run proved that
// guard unreachable through the public path and therefore untested. Drive it
// directly, so "never join on surname alone" is asserted rather than assumed.
check('namesCompatible refuses a zero-given canon (surname-only guard)', () => {
  assert.strictEqual(
    namesCompatible({ surname: 'alves', givens: [] }, canonName('F. Meligeni Alves')),
    false, 'a canon with no given names matched on the surname alone');
  assert.strictEqual(
    namesCompatible({ surname: 'alves', givens: [] }, { surname: 'alves', givens: [] }),
    false, 'two surname-only canons matched each other');
});

check('a non-matching given name never resolves, however rare the surname', () => {
  // Sakellaridis appears twice; "Zebedee" matches neither.
  const r = resolve('Zebedee Sakellaridis');
  assert.strictEqual(r.status, 'absent',
    `status ${r.status} -> ${r.match && r.match.name}: given names must agree`);
});

// ── the uniqueness guard ────────────────────────────────────────────────────
check('two compatible candidates refuse rather than pick one', () => {
  const ix = buildRosterIndex({ 1: { name: 'J. Smith' }, 2: { name: 'J. Smith' } });
  const r = resolveNameDetailed('John Smith', ix);
  assert.strictEqual(r.status, 'ambiguous', `status ${r.status}`);
  assert.strictEqual(r.match, null, 'an ambiguous name returned a match');
});

// ── CONTROLS ────────────────────────────────────────────────────────────────
// Without these, "refuse the hazard" is satisfiable by a normaliser that
// refuses everything, and every assertion above except the resolves would pass.
check('CONTROL: the sibling rows are still reachable by their own names', () => {
  assert.strictEqual(resolve('Marcelo Alves').match.name, 'M. Alves');
  assert.strictEqual(resolve('Mateo Jones').match.name, 'M. Jones');
  assert.strictEqual(resolve('Marco Sakellaridis').match.name, 'M. Sakellaridis');
});

check('CONTROL: an exact roster name resolves to itself, never to a sibling', () => {
  for (const n of ['F. Meligeni Alves', 'M. Alves', 'J. Pinnington Jones', 'M. Jones', 'Dar. Blanch']) {
    const r = resolve(n);
    assert.strictEqual(r.status, 'resolved', `${n}: status ${r.status}`);
    assert.strictEqual(r.match.name, n, `${n} re-pointed to ${r.match.name}`);
  }
});

check('CONTROL: a genuinely off-roster name stays absent', () => {
  assert.strictEqual(resolve('Diego Schwartzman').status, 'absent');
  assert.strictEqual(resolve('Matteo Martineau').status, 'absent');
});

// namesCompatible is the rule everything above rests on; assert it directly so a
// regression names the rule rather than a downstream symptom.
check('namesCompatible: prefix-wise on givens, exact on the last token', () => {
  const c = canonName;
  assert.ok(namesCompatible(c('Felipe Meligeni Alves'), c('F. Meligeni Alves')));
  assert.ok(!namesCompatible(c('Dali Blanch'), c('Dar. Blanch')), 'dali ~ dar must not match');
  // A DIFFERENT last token must never match, however compatible the givens.
  assert.ok(!namesCompatible(c('Felipe Meligeni'), c('F. Meligeni Alves')),
    'the last token must match exactly');
  // Deliberate: givens are compared over min(len), so a source that drops a
  // middle surname ("Felipe Alves") still reaches "F. Meligeni Alves". That is
  // the widening the ruling asked for, and the uniqueness guard is what keeps it
  // safe — if a separate "Felipe Alves" row existed, both would be candidates
  // and the resolution would refuse rather than pick.
  assert.ok(namesCompatible(c('Felipe Alves'), c('F. Meligeni Alves')),
    'min-length given comparison regressed');
});

console.log(`\nname-canon: ${pass} pass, ${fails.length} fail`);
if (fails.length) { console.error('FAILED: ' + fails.join(' · ')); process.exit(1); }
