#!/usr/bin/env node
// Founder 2026-11-08 ("find the surface of all these matches"): te-join.js fillTeamSurfaces gives a team-event row with NO
// surface its tie's researched surface (team-event-surfaces.json) on the career record — never replacing a surface, never
// overriding an indoor row, indoor only where the source states it, and never touching the shared feed rows.
const fs = require('fs'), path = require('path');
const T = require('../te-join.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const table = { rows: {
  '207|2017-04-07|sock': ['hard', null, 0],
  '424|2020-03-06|ivanov': ['clay', 1, 1],
  '424|2016-07-15|fynn': ['hard', 0, 1],
  '1|2024-02-02|moller': ['clay', null, 0] } };
const rows = [
  { date: '2017-04-07', opponent: 'J. Sock', surface: null, tournament: 'Davis Cup WG QF: AUS vs USA' },
  { date: '2017-04-08', opponent: 'J. Sock', surface: null },                         // another day: not this tie
  { date: '2017-04-07', opponent: 'J. Sock', surface: 'grass' },                      // has a surface: never replaced
];
const d = {};
T.fillTeamSurfaces(rows, table, '207', d);
ok(rows[0].surface === 'hard' && !('indoor' in rows[0]), 'a blank Davis Cup row takes its tie\'s surface; indoor not stated → not set');
ok(rows[1].surface === null, 'another day is another match: left blank');
ok(rows[2].surface === 'grass', 'a row with a surface is never replaced');
ok(d.teamSurfaceFilled === 1, 'the fill is counted');
const r2 = [{ date: '2020-03-06', opponent: 'V. Ivanov', surface: null }, { date: '2016-07-15', opponent: 'M. Fynn', surface: null },
  { date: '2016-07-15', opponent: 'M. Fynn', surface: null, indoor: true }];
T.fillTeamSurfaces(r2, table, '424', {});
ok(r2[0].surface === 'clay' && r2[0].indoor === true, 'indoor = 1 sets indoor');
ok(r2[1].surface === 'hard' && r2[1].indoor === false, 'indoor = 0 sets outdoor');
ok(r2[2].surface === null, 'a row already counted under Indoors is never touched');
const r3 = [{ date: '2024-02-02', opponent: 'E. Moller', surface: null }];
T.fillTeamSurfaces(r3, table, '207', {});
ok(r3[0].surface === null, 'another player\'s entry never fills (the key carries the player)');
T.fillTeamSurfaces(r3, null, '1', {});
ok(r3[0].surface === null, 'no table: nothing filled');
// the merge calls it on the record's rows only; the shared rows stay as they were
const src = fs.readFileSync(path.join(__dirname, '..', 'te-join.js'), 'utf8');
ok(/fillTeamSurfaces\(merged, opts\.teamSurfaces, opts\.key \|\| teRec\.key, diag\);\n  return \{ rows: merged/.test(src), 'applyTeHistory fills the merged record rows, just before returning them');
const pipe = fs.readFileSync(path.join(__dirname, '..', 'bsp-pipeline.js'), 'utf8');
ok(/teamSurfaces: teamEventSurfaces\(\)/.test(pipe) && /JSON\.stringify\(rows\) !== feedBefore/.test(pipe), 'the pipeline passes the table, and the golden guard still checks the shared rows after the merge');
// the committed research file: shape, values and provenance
const F = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'team-event-surfaces.json'), 'utf8'));
const vals = Object.entries(F.rows);
ok(vals.length >= 2400 && vals.length === F.counts.rows, `the research file holds ${vals.length} entries`);
ok(vals.every(([k, v]) => /^\d+\|\d{4}-\d\d-\d\d\|[a-z]+$/.test(k) && ['hard', 'clay', 'grass', 'carpet'].includes(v[0]) && [1, 0, null].includes(v[1]) && typeof F.sources[v[2]] === 'string'),
  'every entry: key = player|date|surname, a real surface, indoor 1/0/null, a named source');
ok(F.sources.every(s => /^(Wikipedia: |Tennis Abstract \(TML\): )/.test(s)), 'every source is Wikipedia or Tennis Abstract, named');
console.log(`\ntest-team-surfaces: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
