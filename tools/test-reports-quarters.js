'use strict';
// Tournament-page brief 2026-10-24, item 3 — Tournaments → Reports grouped by draw quarter.
//
// Quarters come from the official protennislive draw (draws.json) through the W/UE sheet's OWN mapping
// (wue-sheet.js quarterOfPos / playerQuarter — the same function, not a copy). No posted draw → the views stay
// ungrouped and say so in one line; a player the draw does not place is grouped last as "Not placed in the draw".
// Never inferred from seeding. Applies to Round comparison and Player progression.
//
// This test SLICES the real Reports functions out of the dashboard and runs them against the real wue-sheet.js.
//
// Run: node tools/test-reports-quarters.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const WUE = require('../wue-sheet.js');

let pass = 0, fail = 0;
function ok(name, cond, got) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, got !== undefined ? '| got: ' + JSON.stringify(got) : ''); }
}

const html = fs.readFileSync(path.join(__dirname, '..', 'bsp-consult-dashboard.html'), 'utf8');
const wueSrc = fs.readFileSync(path.join(__dirname, '..', 'wue-sheet.js'), 'utf8');
function grab(name) {
  const i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) {
    if (html[k] === '{') d++;
    else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1);
  }
  throw new Error('unbalanced ' + name);
}
const constLine = name => { const m = html.match(new RegExp('^const ' + name + ' = [^\\n]*;$', 'm')); if (!m) throw new Error('missing const ' + name); return m[0]; };

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
ok('Reports reads quarters only through WueSheet.playerQuarter (no quarter arithmetic in the dashboard)',
   /W\.playerQuarter\(draw, k\)/.test(grab('tourxQuarterFn')) && !/\/ \(size \/ 4\)|size \/ 4\)/.test(html) && !/seed/i.test(grab('tourxQuarterFn')));

// ---- Round comparison ----
const KEYS = ['serveRating'];
function player(name, key, val, won) {
  return { name, playerKey: key, data: { serveRating: [val] }, eliminated: !won, eliminatedKnown: true, maxWonIdx: won ? 0 : -1,
           opponents: ['Opp'], results: [null], drawDepth: 1, nRounds: 1 };
}
const T = { name: 'Fixture', rounds: ['R1'], field: { metrics: {} }, matches: [], players: [
  player('C. Third', 'kC', 300, true),     // Q3, best value → the card's leader
  player('A. First', 'kA', 250, true),     // Q1
  player('E. Also', 'kE', 280, true),      // Q1, better than A
  player('D. Fourth', 'kD', 260, true),    // Q4
  player('Z. Nowhere', 'kZ', 270, true),   // not placed in the draw
  player('B. Lost', 'kB', 299, false),     // Q2, lost → not listed (item 5)
] };
function rcBox(draw) {
  const box = {
    TOURX_METRICS: KEYS.map(k => ({ key: k, label: k, short: k, kind: 'num' })), TOURX_RV_CAP: 4,
    tourxActiveLabels: ['R32'], tourxState: { roundIdx: 0, rvMetrics: [], cmpPlayers: [] },
    tourxRoundFilterBarHtml: () => '', tourxGridOrder: ms => ms, tourxRatingSpan: () => '', tourxFmt: v => String(v),
    tourxEsc: s => String(s), tourxTournamentCategory: () => 'ATP 250',
    WueSheet: Object.assign({}, WUE, { cachedDraw: tour => (draw && tour === 'Fixture' ? draw : null) }),
  };
  vm.createContext(box);
  vm.runInContext([constLine('TOURX_ROUND_AVG_POP'), constLine('TOURX_NO_DRAW_NOTE')].join('\n') + '\n'
    + ['tourxSurname', 'tourxRpEsc', 'tourxRoundOutcome', 'tourxWonRound', 'tourxQuarterFn', 'tourxQuarterLabel', 'tourxByQuarter',
       'tourxPlayerScore', 'tourxSetsToWin', 'tourxMatchTip', 'tourxRoundChartsHtml', 'tourxRoundViewHtml'].map(grab).join('\n')
    + '\nthis.view = tourxRoundViewHtml;', box);
  return box;
}
// Card sequence: quarter headings and row surnames, in render order.
const seq = o => [...o.matchAll(/class="tourx-qhead"[^>]*>([^<]+)<|font-weight:(?:600|700);color:var\(--text\);overflow:hidden;text-overflow:ellipsis;">([^<]+)</g)].map(m => m[1] ? '#' + m[1] : m[2]);

console.log('=== Round comparison: grouped by quarter ===');
const grouped = rcBox(DRAW).view(T);
ok('rows run Quarter 1 → 4, ranked inside each quarter, unplaced last; the loser is not listed',
   JSON.stringify(seq(grouped)) === JSON.stringify(['#Quarter 1', 'Also', 'First', '#Quarter 3', 'Third', '#Quarter 4', 'Fourth', '#Not placed in the draw', 'Nowhere']), seq(grouped));
ok('the card leader keeps the --bar highlight wherever its quarter sits (Third, Quarter 3)',
   /font-weight:700;color:var\(--text\);overflow:hidden;text-overflow:ellipsis;">Third</.test(grouped)
   && (grouped.match(/class="tourx-rbar" style="[^"]*background:var\(--bar\);/g) || []).length === 1);
ok('a grouped view prints no "no draw" note', !/Quarters appear once the official draw is posted/.test(grouped));

console.log('=== Round comparison: no posted draw → ungrouped + one-line note ===');
const flat = rcBox(null).view(T);
ok('no quarter headings, plain best-first ranking', JSON.stringify(seq(flat)) === JSON.stringify(['Third', 'Also', 'Nowhere', 'Fourth', 'First']), seq(flat));
ok('the note says quarters appear once the official draw is posted', /Quarters appear once the official draw is posted\./.test(flat));

// ---- Player progression ----
console.log('=== Player progression: grouped by quarter ===');
function ppBox(draw) {
  const box = { tourxActiveLabels: ['R32', 'R16'], tourxState: { roundIdx: null, rvMetrics: ['serveRating'], ppFocus: null },
    TOURX_METRICS: [{ key: 'serveRating', label: 'Serve rating', kind: 'rating' }], TOURX_SERVE_KEYS: ['serveRating'], TOURX_RALLY_KEYS: [],
    TOURX_GREYS: ['var(--text)', 'var(--text-soft)'], tourxRating: () => null, tourxEsc: s => String(s), tourxHexA: c => c, tourxRpEsc: s => String(s),
    WueSheet: Object.assign({}, WUE, { cachedDraw: tour => (draw && tour === 'Fixture' ? draw : null) }) };
  vm.createContext(box);
  vm.runInContext(constLine('TOURX_NO_DRAW_NOTE') + '\n' + ['tourxFmt', 'tourxSurname', 'tourxQuarterFn', 'tourxQuarterLabel', 'tourxByQuarter',
    'tourxPPRoundsShown', 'tourxPPRoundNote', 'tourxProgressionHeatHtml', 'tourxProgressionTablesHtml'].map(grab).join('\n') + '\nthis.tables = tourxProgressionTablesHtml;', box);
  return box;
}
// depth order as tourxPlayerViewHtml hands it over: D, C, A, Z, E
const ppPl = [['D. Fourth', 'kD'], ['C. Third', 'kC'], ['A. First', 'kA'], ['Z. Nowhere', 'kZ'], ['E. Also', 'kE']]
  .map(([name, playerKey], i) => ({ name, playerKey, data: { serveRating: [300 - i, 290 - i] } }));
const PT = { name: 'Fixture', field: { metrics: { serveRating: [250, 260] } } };
const ppSeq = o => [...o.matchAll(/class="tourx-qhead"[^>]*>([^<]+)<|text-overflow:ellipsis;">([^<]+)<\/span>/g)].map(m => m[1] ? '#' + m[1] : m[2]);
const ppG = ppBox(DRAW).tables(ppPl, PT);
ok('players run Quarter 1 → 4 (depth order kept inside a quarter), unplaced last',
   JSON.stringify(ppSeq(ppG)) === JSON.stringify(['#Quarter 1', 'First', 'Also', '#Quarter 3', 'Third', '#Quarter 4', 'Fourth', '#Not placed in the draw', 'Nowhere']), ppSeq(ppG));
ok('the field-avg row still closes the table', /Field avg/.test(ppG));
const ppF = ppBox(null).tables(ppPl, PT);
ok('no posted draw → no headings, the depth order, and the one-line note',
   JSON.stringify(ppSeq(ppF)) === JSON.stringify(['Fourth', 'Third', 'First', 'Nowhere', 'Also']) && /Quarters appear once the official draw is posted\./.test(ppF), ppSeq(ppF));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
