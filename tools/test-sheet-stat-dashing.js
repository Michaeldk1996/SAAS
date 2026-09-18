#!/usr/bin/env node
'use strict';
// TEN-206 — locks the founder's Q2 dashing ruling on the §8.1 match sheet.
//
// RULING (2026-09-18): "per match — read the field, dash on null. Per-event
// mis-dashes the 146 mixed-match rows exactly as per-tier mis-dashes whole events.
// Apply the same rule to Winners, UE and Net points."
//
// Two things must hold and they pull in opposite directions, which is why both are
// asserted here against the REAL committed floor rather than a fixture:
//
//   1. a field the feed published must RENDER, and
//   2. a field the feed withheld must DASH,
//
// for the same row label, in the same store. A renderer that satisfies only (1)
// invents numbers; one that satisfies only (2) is what this ticket just fixed —
// `Net points won` was hard-coded `held:false, why:'not an api-tennis field'` and
// dashed on 1,674 player-sides that carry the value. Under this repo's rules a dash
// means "we do not hold this", so saying it about data we DO hold is the same defect
// as inventing a value, pointed the other way.
//
// Every check carries a MUTATING NEGATIVE CONTROL: the assertion is re-run against
// a store broken in the one way it exists to catch, and the test fails if it stays
// quiet. This repo has shipped vacuous probes before.
//
// Run: node tools/test-sheet-stat-dashing.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FLOOR = path.join(ROOT, 'historical-match-stats.floor.json');

let checks = 0;
function check(label, fn) { fn(); checks++; console.log(`  ok  ${label}`); }

// ── load the module under test into a window shim ───────────────────────────
// `matchStats` goes in the SANDBOX, not on global.window after the fact: the module
// closes over the object it was constructed with, and a later assignment to
// global.window is read by nothing. That mistake has already cost this repo a test
// that read an empty store and passed.
function load(store) {
  const sandbox = { FEATURE_PP2: true, playerProfiles: { players: [] }, matchStats: store };
  global.window = sandbox;
  const src = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', src)(sandbox);
  if (!sandbox.PlayerProfileV2) throw new Error('module did not export PlayerProfileV2');
  // The renderer's internals hang off `_internals`; the three public entry points
  // (render/mount/repaint) need a DOM. Asserted rather than assumed, because reading
  // a missing namespace yields `undefined` and every check below would throw rather
  // than fail with a diagnosis.
  const api = sandbox.PlayerProfileV2._internals;
  if (!api || !api.SHEET_SECTIONS) throw new Error('PlayerProfileV2._internals.SHEET_SECTIONS is missing');
  return api;
}

const floor = JSON.parse(fs.readFileSync(FLOOR, 'utf8'));

// The three fields the ruling names, with the label each renders under.
const RULED = [
  { field: 'Points:Winners', label: 'Winners' },
  { field: 'Points:Unforced errors', label: 'Unforced errors' },
  { field: 'Points:Net points won', label: 'Net points won' },
];

/** An eventKey whose p1 side holds `field`, and one whose p1 side does not. */
function findSides(field) {
  let held = null, absent = null;
  for (const k of Object.keys(floor)) {
    const ms = floor[k] && floor[k].matchStats;
    if (!ms || !ms.p1 || !ms.p2 || !Object.keys(ms.p1).length) continue;
    if (ms.p1[field] != null) { if (!held) held = k; }
    else if (!absent) absent = k;
    if (held && absent) break;
  }
  return { held, absent };
}

console.log('sheet dashing: the ruled fields are READ per match, not pre-declared');

check('all three ruled fields are ordinary field reads in SHEET_SECTIONS', () => {
  const api = load(floor);
  const rows = api.SHEET_SECTIONS.flatMap((s) => s.rows);
  for (const { field, label } of RULED) {
    const row = rows.find((r) => r.label === label);
    assert.ok(row, `the sheet has no "${label}" row at all`);
    assert.strictEqual(row.field, field, `"${label}" does not read ${field}`);
    assert.notStrictEqual(row.held, false,
      `"${label}" is pre-declared absent — it would dash even where the feed published a value`);
  }
  // Control: the two rows that genuinely are NOT held must still say so, or this
  // check would pass on a renderer that simply stopped declaring anything absent.
  for (const label of ['Serve rating', 'Return rating']) {
    const row = rows.find((r) => r.label === label);
    assert.strictEqual(row.held, false, `"${label}" is no longer declared unheld — the formula still needs hold%`);
  }
});

check('each ruled field RENDERS its value where the feed published one', () => {
  const api = load(floor);
  for (const { field, label } of RULED) {
    const { held } = findSides(field);
    assert.ok(held, `no entry in the committed floor carries ${field} — fixture is vacuous`);
    const e = floor[held];
    const row = api.SHEET_SECTIONS.flatMap((s) => s.rows).find((r) => r.label === label);
    const v = api.sheetValue(row, e.matchStats.p1, e.matchStats.p2);
    assert.strictEqual(v, e.matchStats.p1[field],
      `"${label}" did not read through to the stored value on eventKey ${held}`);
    assert.notStrictEqual(v, null, `"${label}" dashed on a match that holds it (eventKey ${held})`);
  }
});

check('each ruled field DASHES where the feed withheld it (per match, not per tier)', () => {
  const api = load(floor);
  for (const { field, label } of RULED) {
    const { absent } = findSides(field);
    assert.ok(absent, `every entry carries ${field} — the dash path is untested`);
    const e = floor[absent];
    const row = api.SHEET_SECTIONS.flatMap((s) => s.rows).find((r) => r.label === label);
    assert.strictEqual(api.sheetValue(row, e.matchStats.p1, e.matchStats.p2), null,
      `"${label}" produced a value on a match that does not carry it (eventKey ${absent})`);
  }
});

check('MUTATION CONTROL: re-declaring a ruled field unheld is caught', () => {
  const api = load(floor);
  const row = api.SHEET_SECTIONS.flatMap((s) => s.rows).find((r) => r.label === 'Net points won');
  const { held } = findSides('Points:Net points won');
  const e = floor[held];
  // The exact regression this file exists to prevent — the shape the code had before
  // the Q2 ruling. If sheetValue() stops honouring it, every check above is vacuous.
  const broken = { label: 'Net points won', held: false, why: 'not an api-tennis field' };
  assert.strictEqual(api.sheetValue(broken, e.matchStats.p1, e.matchStats.p2), null,
    'sheetValue ignores held:false — the guard above cannot detect a re-declared field');
  assert.notStrictEqual(api.sheetValue(row, e.matchStats.p1, e.matchStats.p2), null,
    'the live row and the broken row behave identically — this check measures nothing');
});

check('MUTATION CONTROL: a store with the field stripped makes the render check FAIL', () => {
  const stripped = JSON.parse(JSON.stringify(floor));
  for (const k of Object.keys(stripped)) {
    const ms = stripped[k] && stripped[k].matchStats;
    if (!ms) continue;
    for (const p of ['p1', 'p2']) if (ms[p]) delete ms[p]['Points:Net points won'];
  }
  const api = load(stripped);
  const row = api.SHEET_SECTIONS.flatMap((s) => s.rows).find((r) => r.label === 'Net points won');
  let any = false;
  for (const k of Object.keys(stripped)) {
    const ms = stripped[k] && stripped[k].matchStats;
    if (!ms || !ms.p1 || !ms.p2) continue;
    if (api.sheetValue(row, ms.p1, ms.p2) != null) { any = true; break; }
  }
  assert.strictEqual(any, false, 'a value was rendered from a store that carries none — the reader is inventing');
});

check('the rendered TEXT follows the value — a number, or the U+2014 em dash', () => {
  const api = load(floor);
  const row = api.SHEET_SECTIONS.flatMap((s) => s.rows).find((r) => r.label === 'Net points won');
  const { held, absent } = findSides('Points:Net points won');
  // sheetValue() returning a number proves the READ; this proves what the user
  // actually sees, which is the only thing the ruling is about.
  //
  // The dash is U+2014 EM DASH, and this check originally asserted U+2212 and failed
  // — the test was wrong, not the renderer. §3 uses two different characters for two
  // different jobs: "not wired -> '—'" is the missing-data dash, while U+2212 MINUS is
  // for negative NUMBERS. Both constants exist in the module (DASH / MINUS) and
  // conflating them would have made "no data" read as "minus something".
  const shown = api.sheetText(row, api.sheetValue(row, floor[held].matchStats.p1, floor[held].matchStats.p2));
  assert.match(shown, /^\d+(\.\d)?%$/, `a held net-points value rendered as "${shown}"`);
  const dashed = api.sheetText(row, api.sheetValue(row, floor[absent].matchStats.p1, floor[absent].matchStats.p2));
  assert.strictEqual(dashed, '\u2014', `a withheld net-points value rendered as "${dashed}" rather than the em dash`);
  assert.notStrictEqual(dashed, '\u2212', 'the missing-data dash must not be the MINUS sign — that reads as a negative number');
  assert.notStrictEqual(dashed, '0', 'a withheld value rendered as zero');
  assert.notStrictEqual(dashed, '0.0%', 'a withheld value rendered as a plausible default');
});

// Coverage is REPORTED, not asserted at a threshold: a number that must stay above a
// line becomes a reason not to look. Printing it puts the movement in the run log,
// where a halving is visible the way the original fossil-floor bug was not.
check('the ruled fields\' coverage is reported for the run log', () => {
  let sides = 0;
  const n = Object.fromEntries(RULED.map((r) => [r.field, 0]));
  for (const k of Object.keys(floor)) {
    const ms = floor[k] && floor[k].matchStats;
    if (!ms) continue;
    for (const p of ['p1', 'p2']) {
      const o = ms[p];
      if (!o || !Object.keys(o).length) continue;
      sides++;
      for (const { field } of RULED) if (o[field] != null) n[field]++;
    }
  }
  assert.ok(sides > 0, 'the committed floor has no populated player-sides');
  for (const { field, label } of RULED) {
    console.log(`      ${label.padEnd(17)} ${String(n[field]).padStart(5)} / ${sides} sides  ${(100 * n[field] / sides).toFixed(1)}%`);
  }
});

console.log(`\nsheet dashing: ${checks} checks passed.`);
