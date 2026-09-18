#!/usr/bin/env node
'use strict';
// TEN-206 — locks the founder's Q2 dashing ruling on the §8.1 match sheet.
//
// RULING (2026-09-18), quoted in full — an earlier version of this comment dropped
// the third sentence with no ellipsis, which read as though the ruling had two parts:
//   "per match — read the field, dash on null. Per-event mis-dashes the 146
//    mixed-match rows exactly as per-tier mis-dashes whole events. Add the whole-event
//    note when an event is 0/n ('no match at this event carries winners'), so a total
//    absence reads as a feed gap rather than a per-player one. Apply the same rule to
//    Winners, UE and Net points."
// The third sentence is implemented further down this file (the whole-event note).
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
  // `field` MUST be present. Without it sheetValue() returns null through the field
  // lookup whether or not the held:false branch exists, so the check passes with the
  // guard deleted — measured: with-guard null / without-guard null, identical. With
  // the field it reads 75 once the guard is gone, which is what makes this a control.
  const broken = { label: 'Net points won', field: 'Points:Net points won', kind: 'pct',
    held: false, why: 'not an api-tennis field' };
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

// ═══════════════════════════════════════════════════════════════════════════════
// Q2 THIRD CLAUSE — the whole-event note.
// "Add the whole-event note when an event is 0/n ('no match at this event carries
// winners'), so a total absence reads as a feed gap rather than a per-player one."
//
// The note makes a claim about data the reader cannot see, so each check below pins
// the ONE condition that makes the claim true and mutates it to prove the note goes
// away. A note that appears unconditionally is a fabrication with good manners.
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\nwhole-event note: fires on a feed gap, stays silent otherwise');

// A hand-built index, not the real artifact: the note's behaviour must be pinned to
// the COUNTS, and a fixture is the only way to hold every other variable still.
const IDX = {
  keys: { 100: 'Gap Open|2026', 200: 'Full Open|2026', 300: 'Mixed Open|2026', 400: 'Thin Open|2026' },
  events: {
    'Gap Open|2026': { n: 20, w: 0, u: 0, n_: 0 },    // feed carries none of the three
    'Full Open|2026': { n: 40, w: 40, u: 40, n_: 40 },  // feed carries all
    'Mixed Open|2026': { n: 11, w: 4, u: 4, n_: 4 },   // the 146-match case
    'Thin Open|2026': { n: 1, w: 0, u: 0, n_: 0 },    // 0/1 — below the floor
  },
};
const BARE = { 'Service:Aces': 5 };            // carries none of the ruled fields
const RICH = { 'Service:Aces': 5, 'Points:Winners': 20, 'Points:Unforced errors': 18, 'Points:Net points won': 60 };

function withIdx(idx) {
  const sandbox = { FEATURE_PP2: true, playerProfiles: { players: [] }, matchStats: {}, matchStatEventCoverage: idx };
  global.window = sandbox;
  new Function('window', fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8'))(sandbox);
  return sandbox.PlayerProfileV2._internals;
}

check('fires on a 0/n event, naming the event, the count and all three fields', () => {
  const note = withIdx(IDX).wholeEventNote(100, BARE, BARE);
  assert.match(note, /No match at Gap Open 2026 carries/, `note did not name the event: "${note}"`);
  assert.match(note, /20 matches on record/, 'note did not state n — an unquantified gap is an assertion');
  for (const w of ['winners', 'unforced errors', 'net points']) assert.ok(note.includes(w), `note omitted ${w}`);
});

check('SILENT when the event carries the field on every match', () => {
  assert.strictEqual(withIdx(IDX).wholeEventNote(200, BARE, BARE), '',
    'claimed a feed gap at an event that carries the field on all 40 matches');
});

check('SILENT on a MIXED event — the case the ruling rejects per-event dashing for', () => {
  // 4 of 11 carry it. A per-event rule would dash all 11; the note must not describe
  // this as a feed gap either, or it re-tells the same lie in prose.
  assert.strictEqual(withIdx(IDX).wholeEventNote(300, BARE, BARE), '',
    'called a mixed event a whole-event gap — exactly the mis-dashing the ruling forbids');
});

check('SILENT at n=1 — a lone match dashing is the per-player case, not a feed gap', () => {
  assert.strictEqual(withIdx(IDX).wholeEventNote(400, BARE, BARE), '',
    'a 0/1 event produced a feed-gap note, which is the confusion the note exists to remove');
  // Control: the SAME counts at n>=2 must speak, or this proves nothing about the floor.
  const lifted = JSON.parse(JSON.stringify(IDX));
  lifted.events['Thin Open|2026'].n = 2;
  assert.match(withIdx(lifted).wholeEventNote(400, BARE, BARE), /No match at Thin Open 2026/,
    'the n>=2 floor is not a floor — it silences the note at every n');
});

check('SILENT about a field THIS match does hold, even at a 0/n event', () => {
  // Contrived but load-bearing: the note must describe what the reader is looking at.
  const note = withIdx(IDX).wholeEventNote(100, RICH, RICH);
  assert.strictEqual(note, '', `spoke about fields that are visible on this very row: "${note}"`);
  // ...and one-sided data still counts as held, since the sheet shows it.
  assert.strictEqual(withIdx(IDX).wholeEventNote(100, BARE, RICH), '',
    'ignored the opponent side, which the sheet renders in the same row');
});

check('SILENT when the index is absent or does not know the event', () => {
  assert.strictEqual(withIdx(null).wholeEventNote(100, BARE, BARE), '', 'invented a note with no index at all');
  assert.strictEqual(withIdx(IDX).wholeEventNote(999, BARE, BARE), '', 'spoke about an eventKey it has no edition for');
  assert.strictEqual(withIdx(IDX).wholeEventNote(null, BARE, BARE), '', 'spoke about a match with no eventKey');
});

check('MUTATION CONTROL: a non-zero count must silence the note', () => {
  const api0 = withIdx(IDX);
  assert.notStrictEqual(api0.wholeEventNote(100, BARE, BARE), '', 'fixture is wrong — the gap case is already silent');
  const bumped = JSON.parse(JSON.stringify(IDX));
  bumped.events['Gap Open|2026'].w = 1;
  bumped.events['Gap Open|2026'].u = 1;
  bumped.events['Gap Open|2026'].n_ = 1;
  assert.strictEqual(withIdx(bumped).wholeEventNote(100, BARE, BARE), '',
    'one covered match at the event did not silence the note — it is not reading the counts');
});

console.log('\nwhole-event note: the REAL published index agrees with the renderer');

check('the real index (when built) drives the note the same way', () => {
  const real = path.join(ROOT, 'match-stat-event-coverage.json');
  if (!fs.existsSync(real)) { console.log('      (index not built in this checkout — skipped)'); return; }
  const idx = JSON.parse(fs.readFileSync(real, 'utf8'));
  const api = withIdx(idx);
  let fired = 0, silent = 0;
  for (const [ek, edition] of Object.entries(idx.keys)) {
    const e = idx.events[edition];
    const note = api.wholeEventNote(ek, BARE, BARE);
    const expectGap = e.n >= 2 && e.w === 0;
    if (note) { fired++; assert.ok(/No match at /.test(note), `malformed note: ${note}`); }
    else silent++;
    if (expectGap) assert.notStrictEqual(note, '', `event ${edition} is 0/${e.n} on winners but produced no note`);
  }
  assert.ok(fired > 0, 'the real index produced no note anywhere — the artifact or the join is empty');
  console.log(`      real index: ${fired} eventKey(s) would show a note, ${silent} would not`);
});

console.log(`\nsheet dashing + whole-event note: ${checks} checks passed.`);
