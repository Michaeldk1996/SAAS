#!/usr/bin/env node
// The single qualifying rule (founder 2026-10-30): "one shared isQualifying() using the h2h-core.js rule everywhere".
// api-tennis filed 2021–23 qualifying brackets under the main-draw key with their own words ("Semi-finals", "Final") and no
// event_qualification flag; the first-loss net only re-tagged qualifying WINS after a main-draw loss, so a qualifier who
// LOST in the qualifying SF / F read as a main-draw SF / F (measured 30 Oct on the 733 deployed career histories: 520 ATP
// rows — 514 shown in Record per tournament as SF 347 / F 149 / QF 17 / R32 1 — and 1,841 Challenger / ITF rows).
// Checked here on the REAL builders: h2h-core qualifyingByMainDraw, playerMatchHistory (career-history rows),
// fetchPlayerCareerHistory (Record per tournament editions, fetch mocked), applyQualifyingRule (rows of a cached profile at
// shard write) — and the H2H golden pairs, which must not move. Each wiring has a mutant that must turn its check red.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const MUT = process.env.QUAL_MUTANT || '';
let src = fs.readFileSync(path.join(ROOT, 'bsp-pipeline.js'), 'utf8');
// named mutants: each removes one wiring of the rule
const MUTANTS = {
  'no-career-pass': ["    for (const m of ms) if (!m._qual && H2H_QUAL_RULE(m, ms)) { m._qual = true; m._short = 'Q'; m._rank = -1; }", ''],
  'no-editions-rule': ["        && H2H_QUAL_RULE({ date: f.event_date, round: f.tournament_round }, edRows.get(`${f.tournament_key}|${f.tournament_season || String(f.event_date || '').slice(0, 4)}`))) code = 'Q';", ") code = code;"],
  'no-shard-pass': ["    qualRuleTotals.relabelled += applyQualifyingRule(rows);", ''],
};
let P;
if (MUT) {
  const [a, b] = MUTANTS[MUT] || [];
  if (!a || !src.includes(a)) { console.error('mutant anchor not found: ' + MUT); process.exit(2); }
  const tmp = path.join(ROOT, '.qual-mutant-' + process.pid + '.js');
  fs.writeFileSync(tmp, src.replace(a, b));
  try { P = require(tmp); } finally { fs.unlinkSync(tmp); }
} else P = require('../bsp-pipeline.js');
const H = require('../h2h-core.js');

let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); } };

const KEY = '359', CUR = 2026;
const surfaceMap = new Map([['2053', 'grass'], ['2100', 'hard'], ['2200', 'hard'], ['2300', 'hard']]);
const courtMap = new Map([['2053', 'outdoor'], ['2100', 'outdoor'], ['2200', 'outdoor'], ['2300', 'indoor']]);
const EV = { 2053: 'Wimbledon', 2100: 'Washington', 2200: 'Atlanta', 2300: 'ATP Davis Cup - World Group I' };
let ek = 9000;
function fx(date, tk, won, opp, round, flag) {
  return {
    event_key: String(ek++), event_date: date, tournament_key: String(tk), tournament_name: EV[tk], tournament_season: date.slice(0, 4),
    event_type_type: 'Atp Singles', event_status: 'Finished', event_winner: won ? 'First Player' : 'Second Player',
    first_player_key: KEY, second_player_key: String(ek + 50000), event_first_player: 'S. Ofner', event_second_player: opp,
    event_final_result: won ? '2 - 0' : '0 - 2', tournament_round: `${EV[tk]} - ${round}`, event_qualification: flag ? 'True' : 'False', scores: [],
  };
}
const FIX = [
  // Wimbledon 2021: the qualifying bracket under the main-draw key, unflagged, with its own words; lost the qualifying final
  fx('2021-06-21', 2053, true, 'Q. One', '1/16-finals', true), fx('2021-06-23', 2053, true, 'Q. Two', 'Semi-finals'), fx('2021-06-24', 2053, false, 'D. Masur', 'Final'),
  // Washington 2021: a lucky loser — lost the qualifying final, then played main draw R64 (a "1/32-finals") after it
  fx('2021-07-31', 2100, true, 'T. Ito', 'Semi-finals'), fx('2021-08-01', 2100, false, 'R. Ramanathan', 'Final'), fx('2021-08-03', 2100, false, 'M. Main', '1/32-finals'),
  // Atlanta 2021: a real main-draw run — R32, R16, then word rounds QF / SF after the first "1/N-finals"
  fx('2021-07-26', 2200, true, 'A. Aa', '1/16-finals'), fx('2021-07-28', 2200, true, 'B. Bb', '1/8-finals'), fx('2021-07-30', 2200, true, 'C. Cc', 'Quarter-finals'), fx('2021-07-31', 2200, false, 'D. Dd', 'Semi-finals'),
  // Davis Cup: no qualifying draw; its word rounds stay
  fx('2021-09-18', 2300, true, 'E. Ee', 'Semi-finals'),
];

check('h2h-core: a word round before the first "1/N-finals" (or with none) is qualifying; after it, main draw', () => {
  const ed = [{ date: '2021-07-26', round: '1/16-finals' }, { date: '2021-07-30', round: 'Quarter-finals' }, { date: '2021-07-24', round: 'Semi-finals' }];
  assert.strictEqual(H.qualifyingByMainDraw(ed[1], ed), false, 'QF after R32 is main draw');
  assert.strictEqual(H.qualifyingByMainDraw(ed[2], ed), true, 'SF before R32 is qualifying');
  assert.strictEqual(H.qualifyingByMainDraw(ed[0], ed), false, 'a "1/N-finals" row never is');
  assert.strictEqual(H.qualifyingByMainDraw({ date: '2021-06-24', round: 'Final' }, [{ date: '2021-06-24', round: 'Final' }]), true, 'no main-draw round at all → qualifying');
  assert.strictEqual(H.qualifyingByMainDraw({ date: '2021-07-26', round: 'Quarter-finals' }, ed), false, 'same day as the first main-draw round → main draw (rain-delayed double)');
});

const rows = P.playerMatchHistory(FIX, KEY, CUR, surfaceMap, courtMap);
const rowOf = (opp) => rows.find((r) => r.opponent === opp);
check('career-history rows (playerMatchHistory): the qualifying SF / F read "Qualifying" (mutant no-career-pass)', () => {
  assert.strictEqual(rowOf('D. Masur').round, 'Qualifying', 'Wimbledon 2021 qualifying final loss');
  assert.strictEqual(rowOf('Q. Two').round, 'Qualifying', 'Wimbledon 2021 qualifying SF win');
  assert.strictEqual(rowOf('R. Ramanathan').round, 'Qualifying', 'Washington 2021: before his main-draw R64');
  assert.strictEqual(rowOf('T. Ito').round, 'Qualifying');
});
check('controls: a main-draw run keeps its rounds; the lucky loser\'s R64 stays main draw; Davis Cup keeps its round', () => {
  assert.strictEqual(rowOf('C. Cc').round, 'Quarter-finals'); assert.strictEqual(rowOf('D. Dd').round, 'Semi-finals');
  assert.strictEqual(rowOf('M. Main').round, '1/32-finals'); assert.strictEqual(rowOf('E. Ee').round, 'Semi-finals');
  assert.strictEqual(rows.length, FIX.length, 'labels only: every match is still a row (counted)');
});

// Record per tournament: the real fetchPlayerCareerHistory over a mocked get_fixtures
const recP = (async () => {
  const realFetch = global.fetch;
  global.fetch = async () => ({ json: async () => ({ success: 1, result: JSON.parse(JSON.stringify(FIX)) }) });
  try { return await P.fetchPlayerCareerHistory(KEY); } finally { global.fetch = realFetch; }
})();

recP.then((hist) => {
  const t = (name) => (hist || []).find((x) => x.name === name || String(x.name).includes(name));
  check('Record per tournament (fetchPlayerCareerHistory, fetch mocked): every Wimbledon / Washington 2021 qualifying match is "Q"; the edition finish is not "Final" (mutant no-editions-rule)', () => {
    const w = t('Wimbledon'), e = w && w.editions.find((x) => x.year === 2021);
    assert.ok(e, 'no Wimbledon 2021 edition');
    assert.deepStrictEqual(e.matches.map((m) => m.round), ['Q', 'Q', 'Q'], 'Wimbledon 2021 rounds');
    assert.notStrictEqual(e.finish, 'Final');
    const d = t('Washington').editions.find((x) => x.year === 2021);
    assert.deepStrictEqual(d.matches.map((m) => m.round).sort(), ['Q', 'Q', 'R64'].sort(), 'Washington 2021 rounds');
  });
  check('control: Atlanta 2021 main-draw run keeps QF / SF; the best result is the real SF', () => {
    const a = t('Atlanta').editions.find((x) => x.year === 2021);
    assert.ok(a.matches.some((m) => m.round === 'SF') && a.matches.some((m) => m.round === 'QF'));
    assert.strictEqual(a.finish, 'Semi-final');
  });

  check('a cached profile\'s rows are relabelled at shard write (applyQualifyingRule; mutant no-shard-pass reaches the writer)', () => {
    const cached = [
      { src: 'fixtures', level: 'atp', tournament: 'Wimbledon', date: '2021-06-24', round: 'Final', opponent: 'D. Masur' },
      { src: 'fixtures', level: 'atp', tournament: 'Atlanta', date: '2021-07-26', round: '1/16-finals' },
      { src: 'fixtures', level: 'atp', tournament: 'Atlanta', date: '2021-07-31', round: 'Semi-finals' },
      { src: 'archive', level: 'atp', tournament: 'Gstaad', date: '2019-07-15', round: 'F' },
      // an edition across 1 January stays one: the Brisbane main draw starts 30 Dec, its QF is in January
      { src: 'fixtures', level: 'atp', tournament: 'Brisbane', date: '2024-12-30', round: '1/16-finals' },
      { src: 'fixtures', level: 'atp', tournament: 'Brisbane', date: '2025-01-02', round: 'Quarter-finals' },
    ];
    assert.strictEqual(P.applyQualifyingRule(cached), 1);
    assert.deepStrictEqual(cached.map((r) => r.round), ['Qualifying', '1/16-finals', 'Semi-finals', 'F', '1/16-finals', 'Quarter-finals']);
    assert.ok(src.includes('qualRuleTotals.relabelled += applyQualifyingRule(rows);') || MUT === 'no-shard-pass', 'the shard writer calls it');
    if (MUT === 'no-shard-pass') throw new Error('the shard writer does not call applyQualifyingRule');
  });

  check('H2H golden pairs (ATP\'s own counts): the rule moves none of the 57', () => {
    const g = require('./fixtures/ten437/h2h-golden-pairs.json');
    let moved = 0;
    for (const p of g.pairs) {
      const before = JSON.stringify(H.record(H.joinMeetings(p.a, p.b, p.chA, p.chB, p.nk, [])));
      const A = JSON.parse(JSON.stringify(p.chA || [])), B = JSON.parse(JSON.stringify(p.chB || []));
      P.applyQualifyingRule(A); P.applyQualifyingRule(B);
      if (before !== JSON.stringify(H.record(H.joinMeetings(p.a, p.b, A, B, p.nk, [])))) moved++;
    }
    assert.strictEqual(moved, 0);
  });

  console.log(`\nqualifying-rule: ${pass} passed, ${fail} failed${MUT ? ' (mutant ' + MUT + ')' : ''}`);
  process.exit(fail ? 1 : 0);
});
