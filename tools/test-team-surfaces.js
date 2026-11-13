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
ok(F.sources.every(s => /^(Wikipedia: |Tennis Abstract \(TML\): |Sackmann tennis_atp |FISU, |Avondhu Press )/.test(s)), 'every source is named (Wikipedia, Tennis Abstract, Sackmann, FISU or a cited press report)');
ok(F.sources.every(s => !/\/Users\//.test(s)), 'no source names a local path');

// Founder 2026-11-13 ("find these surfaces out"): a CARPET row with no court class takes the table's (indoor → Indoors),
// and where the table's source names another surface it wins; a carpet row the table gives no court class stays.
const ct = { rows: { '9|2006-04-07|safin': ['carpet', 1, 0], '9|2007-09-21|berdych': ['hard', 1, 0], '9|2009-03-06|balazs': ['carpet', null, 0] } };
const r4 = [{ date: '2006-04-07', opponent: 'M. Safin', surface: 'carpet' }, { date: '2007-09-21', opponent: 'T. Berdych', surface: 'carpet' },
  { date: '2009-03-06', opponent: 'A. Balazs', surface: 'carpet' }, { date: '2006-04-07', opponent: 'M. Safin', surface: 'clay' }];
T.fillTeamSurfaces(r4, ct, '9', {});
ok(r4[0].surface === 'carpet' && r4[0].indoor === true, 'a carpet row takes its stated court class (indoor → the Indoors column)');
ok(r4[1].surface === 'hard' && r4[1].indoor === true, 'a carpet row the table\'s source calls hard (indoors) becomes hard');
ok(r4[2].surface === 'carpet' && !('indoor' in r4[2]), 'no court class in the table: the carpet row is left as it was');
ok(r4[3].surface === 'clay' && !('indoor' in r4[3]), 'a clay row is never touched');
// the feed side: a fixture whose tournament has no surface reads the same table, either player's side; a tournament surface wins
const P = require('../bsp-pipeline.js');
const fx = (a, b, d, key) => ({ first_player_key: a, second_player_key: b, event_first_player: 'X. ' + a, event_second_player: 'Y. Safin', event_date: d, tournament_key: key, tournament_name: 'Davis Cup' });
if (typeof P.fixtureSurface === 'function') {
  const map = new Map([['500', 'clay']]);
  const rowsT = require('../team-event-surfaces.json').rows; const k = Object.keys(rowsT)[0].split('|');
  const f1 = { first_player_key: k[0], second_player_key: '0', event_first_player: 'A. Bee', event_second_player: 'Z. ' + k[2], event_date: k[1], tournament_key: '1', tournament_name: 'Davis Cup' };
  ok(P.fixtureSurface(f1, new Map()) === rowsT[Object.keys(rowsT)[0]][0], 'a feed fixture with no tournament surface takes the table\'s');
  const f2 = Object.assign({}, f1, { first_player_key: '0', second_player_key: k[0], event_first_player: 'Z. ' + k[2], event_second_player: 'A. Bee' });
  ok(P.fixtureSurface(f2, new Map()) === rowsT[Object.keys(rowsT)[0]][0], 'either side of the fixture finds it');
  ok(P.fixtureSurface(Object.assign({}, f1, { tournament_key: '500' }), map) === 'clay', 'a tournament surface always wins');
  ok(P.fixtureSurface(Object.assign({}, f1, { event_date: '1999-01-01' }), new Map()) == null, 'another day: no surface');
} else ok(false, 'bsp-pipeline.js exports fixtureSurface');
console.log(`\ntest-team-surfaces: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
