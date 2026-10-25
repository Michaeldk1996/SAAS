#!/usr/bin/env node
// Founder ruling 2026-10-23 (item 2): when api-tennis drops `event_winner` on a finished match, the winner is read from the
// vendor's own score — only a complete, unambiguous one (fixture-winner.js), never for a retirement or a walkover.
// Real shapes from the 22–23 Oct re-import (8133 Aguilar v Browning, 9217 Vallejo v Kimhi), every refusal, the wiring
// (every fetched fixture passes the pipeline's sanitizeFixtures), and mutants that must go red.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'fixture-winner.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };

const fx = (status, sets, fr, winner) => ({ event_status: status, event_winner: winner === undefined ? null : winner, event_final_result: fr,
  scores: sets.map(([a, b]) => ({ score_first: String(a), score_second: String(b) })) });
const CASES = [
  ['8133 shape: 4-6 6-4 3-6 + two 0-0 placeholders, "1 - 2"', fx('Finished', [[4, 6], [6, 4], [3, 6], [0, 0], [0, 0]], '1 - 2'), 'Second Player'],
  ['9217 shape: 0-6 4-6, "0 - 2"', fx('Finished', [[0, 6], [4, 6]], '0 - 2'), 'Second Player'],
  ['tie-break notation 7.7-6.5', fx('Finished', [['7.7', '6.5'], [6, 3]], '2 - 0'), 'First Player'],
  ['a match tie-break as the final set (10-8)', fx('Finished', [[6, 4], [3, 6], [10, 8]], '2 - 1'), 'First Player'],
  ['best of five, 3-1', fx('Finished', [[6, 4], [3, 6], [6, 2], [7, 5]], '3 - 1'), 'First Player'],
  ['REFUSED: a retirement', fx('Retired', [[7, 6], [3, 1]], '1 - 0'), null],
  ['REFUSED: a retirement whose sets look complete (the status decides, never the score)', fx('Retired', [[6, 4], [6, 3]], '2 - 0'), null],
  ['REFUSED: a walkover', fx('Walk Over', [], '0 - 0'), null],
  ['REFUSED: the last set unfinished (6-4 3-1)', fx('Finished', [[6, 4], [3, 1]], '1 - 0'), null],
  ['REFUSED: only one set', fx('Finished', [[6, 1]], '1 - 0'), null],
  ['REFUSED: leading 0-0 placeholders (0-0 0-0 7-5 3-6 6-2)', fx('Finished', [[0, 0], [0, 0], [7, 5], [3, 6], [6, 2]], '2 - 1'), null],
  ['REFUSED: no scores at all', fx('Finished', [], ''), null],
  ['REFUSED: the vendor\'s set count disagrees with the sets', fx('Finished', [[6, 4], [6, 4]], '1 - 2'), null],
  ['REFUSED: the match ends on the loser\'s set', fx('Finished', [[6, 4], [6, 4], [3, 6]], ''), null],
  ['untouched: a winner already present', fx('Finished', [[0, 6], [4, 6]], '0 - 2', 'First Player'), null],
];
function load(src) {
  const f = path.join(ROOT, '.test-fixture-winner-mod.js');
  fs.writeFileSync(f, src);
  try { delete require.cache[require.resolve(f)]; return require(f); } finally { fs.rmSync(f, { force: true }); }
}
const run = (mod) => CASES.filter(([, f, want]) => mod.winnerFromScore(JSON.parse(JSON.stringify(f))) !== want).map(([l]) => l);

console.log('\nItem 2 · the winner a re-import dropped, read from a complete score only\n');
const bad = run(require(path.join(ROOT, 'fixture-winner.js')));
for (const [label, , want] of CASES) ok(!bad.includes(label), `${label} → ${want || 'no winner'}`);

// the pipeline: every fetched fixture passes sanitizeFixtures, which now fills the winner — and the row then exists
const PIPE = fs.readFileSync(path.join(ROOT, 'bsp-pipeline.js'), 'utf8');
ok(/const sanitizeFixture = \(fx\) => \(fx \? fillWinnerFromScore\(sanitizeFixtureStats\(fx\)\) : fx\);/.test(PIPE) &&
  /const sanitizeFixtures = \(list\) => \{ if \(Array\.isArray\(list\)\) for \(const fx of list\) sanitizeFixture\(fx\); return list; \};/.test(PIPE),
  'bsp-pipeline.js sanitizeFixture(s) fill the winner for every fetched fixture');
const { playerMatchHistory } = require(path.join(ROOT, 'bsp-pipeline.js'));
const { fillWinnerFromScore } = require(path.join(ROOT, 'fixture-winner.js'));
const raw = Object.assign(fx('Finished', [[4, 6], [6, 4], [3, 6], [0, 0], [0, 0]], '1 - 2'), { event_key: 12000187, event_date: '2024-11-20',
  event_type_type: 'Itf Men Singles', first_player_key: 12949, second_player_key: 8133, event_first_player: 'T. Browning',
  event_second_player: 'C. M. Aguilar J.', tournament_name: 'M15 Santo Domingo', tournament_round: 'M15 Santo Domingo - 1/16-finals' });
const before = playerMatchHistory([JSON.parse(JSON.stringify(raw))], '8133', 2026, new Map());
const after = playerMatchHistory([fillWinnerFromScore(JSON.parse(JSON.stringify(raw)))], '8133', 2026, new Map());
ok(before.length === 0 && after.length === 1 && after[0].won === true, `Aguilar v Browning: no row without the winner, one WON row with it (${before.length} → ${after.length})`);

// CONTROLS
const m1 = SRC.replace("while (raw.length && raw[raw.length - 1][0] === 0 && raw[raw.length - 1][1] === 0) raw.pop();", '');
ok(m1 !== SRC && run(load(m1)).length > 0, 'CONTROL 1 · without the 0-0 placeholder strip the 8133 shape is lost');
const m2 = SRC.replace("if (!f || f.event_status !== 'Finished' || f.event_winner) return null;", "if (!f || f.event_winner) return null;");
ok(m2 !== SRC && run(load(m2)).length > 0, 'CONTROL 2 · a rule that also reads retirements is caught');
const m3 = SRC.replace("if (fr && (+fr[1] !== first || +fr[2] !== second)) return null;", '');
ok(m3 !== SRC && run(load(m3)).length > 0, 'CONTROL 3 · ignoring the vendor\'s own set count is caught');

console.log(`\ntest-fixture-winner: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
