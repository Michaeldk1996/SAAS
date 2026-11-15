'use strict';
// Tournament-page brief 2026-10-24, item 3 — Tournaments → Reports grouped by draw quarter.
//
// Quarters come from the official protennislive draw (draws.json) through the W/UE sheet's OWN mapping
// (wue-sheet.js quarterOfPos / playerQuarter — the same function, not a copy). No posted draw → the views stay
// grouped under "Quarter —" (founder 2026-11-15, Tournaments tab rebuild: tournaments-reports.js). Never inferred from
// seeding or the finishing order.
// RETIRED 2026-11-15 (founder "Design wins"): the checks on the old renderer's grouping (tourxRoundChartsHtml /
// tourxProgressionTablesHtml: winners only, "Not placed in the draw", the no-draw note "Quarters appear once the
// official draw is posted.", depth order without a draw). The rebuilt grouping and ranking per quarter, losers
// included, are locked by tools/test-tt-reports.mjs on the shipped module.
//
// Run: node tools/test-reports-quarters.js

const fs = require('fs');
const path = require('path');
const WUE = require('../wue-sheet.js');

let pass = 0, fail = 0;
function ok(name, cond, got) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, got !== undefined ? '| got: ' + JSON.stringify(got) : ''); }
}

const html = fs.readFileSync(path.join(__dirname, '..', 'bsp-consult-dashboard.html'), 'utf8');
const wueSrc = fs.readFileSync(path.join(__dirname, '..', 'wue-sheet.js'), 'utf8');

// A posted 32-slot draw: kA pos 1 (Q1), kB pos 12 (Q2), kC pos 20 (Q3), kD pos 30 (Q4), kE pos 3 (Q1); kZ not placed.
const POS = { kA: 1, kB: 12, kC: 20, kD: 30, kE: 3 };
const slots = Array.from({ length: 32 }, (_, i) => ({ pos: i + 1, playerKey: Object.keys(POS).find(k => POS[k] === i + 1) || null }));
const DRAW = { city: 'Fixture', main: { status: 'posted', size: 32, slots } };

console.log('=== the one quarter mapping (wue-sheet.js) ===');
ok('quarterOfPos: a 32-draw splits 1–8 / 9–16 / 17–24 / 25–32',
   [1, 8, 9, 16, 17, 24, 25, 32].map(p => WUE.quarterOfPos(32, p)).join('') === '11223344');
ok('quarterOfPos: a 128-draw splits at 32 / 64 / 96', [32, 33, 64, 65, 96, 97].map(p => WUE.quarterOfPos(128, p)).join('') === '122334');
ok('playerQuarter finds the player by the draw\'s own playerKey', ['kA', 'kB', 'kC', 'kD', 'kE'].map(k => WUE.playerQuarter(DRAW, k)).join('') === '12341');
ok('playerQuarter: not placed / no key / unposted draw / no draw → null (never inferred)',
   WUE.playerQuarter(DRAW, 'kZ') === null && WUE.playerQuarter(DRAW, null) === null && WUE.playerQuarter(DRAW, '') === null
   && WUE.playerQuarter({ main: { status: 'not_posted', size: 32, slots } }, 'kA') === null && WUE.playerQuarter(null, 'kA') === null);
ok('the sheet\'s Q1–Q4 headers ride the same quarterOfPos (no private copy left in wue-sheet.js)',
   /`Q\$\{quarterOfPos\(size, /.test(wueSrc) && (wueSrc.match(/\(size \/ 4\)/g) || []).length === 1 && !/const quarterOfPos/.test(wueSrc));
const ttSrc = fs.readFileSync(path.join(__dirname, '..', 'tournaments-reports.js'), 'utf8');
ok('Reports reads quarters only through WueSheet.playerQuarter (no quarter arithmetic in the dashboard or the module)',
   /WS\.playerQuarter\(draw, k\)/.test(ttSrc) && !/size \/ 4\)/.test(html) && !/size \/ 4\)|QMAP|seed/i.test(ttSrc));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
