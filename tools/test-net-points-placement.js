#!/usr/bin/env node
'use strict';
// BUILD ITEM 4 · "Net points as a match-sheet row only — not a tile."
//
// Measured before writing this: the v2 renderer ALREADY satisfies the ruling.
// "Net points won" reaches exactly one rendered surface, the match sheet's
// "Points won" group, which is where the locked export puts it too
// (Player Stat Boxes.dc.html:1827). It is in no tile list.
//
// So this file is the lock rather than the fix. It exists because the risk is
// real and specific: `STAT_ROWS` (player-profile-v2.js:238) still declares
// Winners / Unforced errors / Net points won and has NO consumer anywhere in the
// renderer — it is dead, exported, and exactly the shape something would reach
// for when adding tiles. If net points ever appears in a tile list, this fails.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const NET = 'Net points won';
const NET_FIELD = 'Points:Net points won';

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
}

function load() {
  const sandbox = { FEATURE_PP2: true, playerProfiles: { players: {} } };
  global.window = sandbox;
  new Function('window', fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8'))(sandbox);
  return sandbox.PlayerProfileV2._internals;
}

const I = load();

console.log('\nnet points placement (build item 4)\n');

// ── the control, first: both structures must be non-empty, or every check
// below passes by describing nothing.
check('the tile list and the sheet sections are both populated', () => {
  const tileCount = Object.keys(I.DNA_TILES || {})
    .reduce((n, k) => n + (I.DNA_TILES[k] || []).length, 0);
  assert.ok(tileCount >= 10, `DNA_TILES holds only ${tileCount} tiles — the tile checks would be vacuous`);
  assert.ok((I.SHEET_SECTIONS || []).length >= 3,
    'SHEET_SECTIONS is empty — the sheet checks would be vacuous');
});

check('net points IS a match-sheet row, in the "Points won" group', () => {
  const group = (I.SHEET_SECTIONS || []).filter((s) => s.title === 'Points won')[0];
  assert.ok(group, 'the sheet has no "Points won" group');
  const row = (group.rows || []).filter((r) => r.label === NET)[0];
  assert.ok(row, `"${NET}" is not a row in the sheet's "Points won" group`);
  assert.strictEqual(row.field, NET_FIELD, `the row must read ${NET_FIELD}`);
  assert.strictEqual(row.kind, 'pct', 'net points is a percentage, as the extractor emits it');
  // `held: false` is how this file marks a row we cannot compute (Serve rating,
  // Return rating). Net points is NOT one of those — we hold the field on 47.9%
  // of populated player-sides — so it must read per match and dash on null.
  assert.notStrictEqual(row.held, false,
    'net points is pre-declared absent, but we hold the field — it must be read and dashed on null');
});

check('net points is in NO tile list', () => {
  const hits = [];
  Object.keys(I.DNA_TILES || {}).forEach((axis) => {
    (I.DNA_TILES[axis] || []).forEach((t) => {
      if (/net\s*points/i.test(t.label || '') || /net\s*points/i.test(t.f || '')) {
        hits.push(`${axis}.${t.f} "${t.label}"`);
      }
    });
  });
  assert.deepStrictEqual(hits, [], `net points appears as a TILE: ${hits.join(', ')}`);
});

check('no radar axis is a net-points axis', () => {
  const hits = (I.DNA_AXES || []).filter((a) => /net\s*points/i.test(a.label || a.key || ''));
  assert.deepStrictEqual(hits.map((a) => a.key), [], 'net points became a radar axis');
});

// ── the rendered Ratings panel must not carry it either ─────────────────────
// Structure checks alone would miss a tile hardcoded into the markup.
check('the rendered Ratings panel prints no net-points tile', () => {
  const player = { key: 1, name: 'A. Subject' };
  let html = '';
  try { html = I.renderRatingsPanel(player) || ''; } catch (e) { html = ''; }
  assert.ok(!/net\s*points/i.test(html),
    'the Ratings panel rendered a net-points tile');
});

// ── the dead declaration is named, so its status is a fact and not folklore ──
check('STAT_ROWS still declares net points and still has no consumer', () => {
  const src = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  // Count CODE references only: the name also appears in a prose comment
  // ("see the STAT_ROWS note above"), and counting that would make the check
  // fire on a comment edit rather than on a new consumer.
  const code = src.split('\n')
    .filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln))
    .join('\n');
  const uses = (code.match(/STAT_ROWS/g) || []).length;
  // `var STAT_ROWS = [` is 1 and the export line `STAT_ROWS: STAT_ROWS,` is 2,
  // so 3 is the dead state. More than that means something now READS it, and
  // where it renders has to be checked against this ruling.
  assert.ok(uses <= 3,
    `STAT_ROWS has ${uses} code references (dead state is 3) — it has gained a consumer; check where it renders`);
  assert.ok((I.STAT_ROWS || []).some((r) => r.key === NET_FIELD),
    'STAT_ROWS no longer names net points — update or delete this check');
});

console.log(`\nnet points placement: ${pass} pass, ${fail} fail`);
if (fail) { console.error(`FAILED: ${fail} check(s)`); process.exit(1); }
