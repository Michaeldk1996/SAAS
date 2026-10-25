#!/usr/bin/env node
// Ruling 4 · item 1 (founder 2026-10-23): build-market-edge.js careerFirstSet — a retirement the evidence file left
// without a first set reads it from the two players' own career rows. One case per cause measured on 23 Oct (30 of 1,282
// profile-ledger retirements settled "no set scores" though both career rows held the first set), the refusals that keep
// it from guessing, and controls: the builder without the fallback, and a fallback that ignores disagreement, go red.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'build-market-edge.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };

const r = (date, opponent, sets, extra) => Object.assign({ date, opponent, sets: sets.map(([p, o]) => ({ p, o })) }, extra || {});
const SHARDS = {
  // 8 · no Tennis-Data row: the master row comes from our own archive (Gea v Davidovich Fokina, 15 Oct 2026)
  1: [r('2026-10-15', 'A. Davidovich Fokina', [[4, 1]])],
  // 7 · an earlier meeting of the same pair inside the window (Cincinnati two weeks before the US Open): the latest wins
  2: [r('2015-08-31', 'T. Kokkinakis', [[6, 4], [1, 6]], { src: 'archive' }), r('2015-08-16', 'T. Kokkinakis', [[3, 6]], { src: 'archive' })],
  3: [r('2015-08-31', 'R. Gasquet', [[4, 6], [6, 1]], { src: 'archive' }), r('2015-08-16', 'R. Gasquet', [[6, 3]], { src: 'archive' })],
  // 5 · the archive row dated at the event's Monday start, one day after Tennis-Data's Sunday first round
  4: [r('2017-05-29', 'D. Medvedev', [[7, 5], [4, 6]], { src: 'archive' })],
  // 4 · surname spelled three ways: "Del Potro J.M." / "J. Martin del Potro"
  5: [r('2018-05-14', 'J. Martin del Potro', [[6, 2], [4, 5]], { src: 'archive' })],
  // refusals: two rows against the same surname on the latest day; the two players' rows disagree; a walkover row
  6: [r('2020-03-01', 'X. Twin', [[6, 1]]), r('2020-03-01', 'Y. Twin', [[2, 1]])],
  7: [r('2021-06-01', 'B. Other', [[6, 2]])],
  8: [r('2021-06-01', 'A. Seven', [[2, 1]])],
  9: [r('2022-02-02', 'C. Wo', [], { walkover: true })],
};
const KEYS = { 'Gea A.': 1, 'Gasquet R.': 2, 'Kokkinakis T.': 3, 'Bonzi B.': 4, 'Goffin D.': 5, 'Twin Z.': 6, 'Seven A.': 7, 'Other B.': 8, 'Wo Z.': 9 };
const resolveAt = (n) => (KEYS[n] ? { key: String(KEYS[n]) } : null);
const rowsOf = (k) => SHARDS[k] || null;
const CASES = [
  ['no Tennis-Data row (archive-fed 2026)', { date: '2026-10-15', winner: 'Davidovich Fokina A.', loser: 'Gea A.' }, 'i'],
  ['an earlier meeting in the window: the latest wins, both sides agree', { date: '2015-09-01', winner: 'Gasquet R.', loser: 'Kokkinakis T.' }, 'c'],
  ['archive row one day after Tennis-Data (event-start dating)', { date: '2017-05-28', winner: 'Bonzi B.', loser: 'Medvedev D.' }, 'c'],
  ['surname spelled another way (Del Potro J.M. / J. Martin del Potro)', { date: '2018-05-17', winner: 'Goffin D.', loser: 'Del Potro J.M.' }, 'c'],
  ['REFUSED: two rows against that surname on the latest day', { date: '2020-03-01', winner: 'Twin Z.', loser: 'Wex Twin' }, 'm'],
  ['REFUSED: the two players\' rows disagree on the first set', { date: '2021-06-01', winner: 'Seven A.', loser: 'Other B.' }, 'm'],
  ['REFUSED: a walkover row is never evidence', { date: '2022-02-02', winner: 'Wo Z.', loser: 'Wo C.' }, 'm'],
  ['REFUSED: no player resolves', { date: '2023-01-01', winner: 'Nobody N.', loser: 'Noone N.' }, 'm'],
];
function load(src) {
  const f = path.join(ROOT, '.test-career-first-set-mod.js');
  fs.writeFileSync(f, src);
  try { delete require.cache[require.resolve(f)]; return require(f); } finally { fs.rmSync(f, { force: true }); }
}
function run(mod) {
  const bad = [];
  for (const [label, row, want] of CASES) {
    let got; try { got = mod.careerFirstSet(row, resolveAt, rowsOf); } catch (e) { got = 'threw ' + e.message; }
    if (got !== want) bad.push(`${label}: got ${got}, want ${want}`);
  }
  return bad;
}

console.log('\nRuling 4 · item 1 · the first set from the players\' own career rows\n');
const real = run(require(path.join(ROOT, 'build-market-edge.js')));
for (const [label, , want] of CASES) ok(!real.some((b) => b.startsWith(label + ':')), `${label} → ${want}`);
// founder 2026-10-25 (round 2 item 1.3): the lookup is shared (firstSetLookup — Market edge and the Database read it)
ok(/const fs0 = retFs\.get\([^\n]*\) \|\| 'm';\n\s*if \(fs0 !== 'm'\) return \{ fs: fs0, fromCareer: false \};[\s\S]{0,400}?const v = careerFirstSet\(row, resolveAt, rowsOf\);/.test(SRC) &&
  /const fsHit = retired \? firstSet\.of\(row\) : null;/.test(SRC),
  'the builder consults it only where the evidence file had no answer (\'m\')');

// CONTROL 1 · a fallback that ignores the two sides disagreeing settles the disagreement case
const noAgree = SRC.replace("if (!states.length || states.some((x) => x !== states[0])) return 'm';", "if (!states.length) return 'm';");
ok(noAgree !== SRC && run(load(noAgree)).length > 0, 'CONTROL 1 · a fallback that ignores disagreement is caught');
// CONTROL 2 · exact surnames only: the Del Potro case falls back to unknown
const exact = SRC.replace('sameSurname(c.surname, ok.surname)', 'c.surname === ok.surname');
ok(exact !== SRC && run(load(exact)).length > 0, 'CONTROL 2 · exact-surname matching is caught (Del Potro J.M.)');
// CONTROL 3 · the builder without the fallback: the call site is gone
const noCall = SRC.replace("const v = careerFirstSet(row, resolveAt, rowsOf);", "const v = 'm';");
ok(noCall !== SRC && !/const v = careerFirstSet\(row, resolveAt, rowsOf\);/.test(noCall), 'CONTROL 3 · removing the call site is detected by the call-site check');

console.log(`\ntest-career-first-set: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
