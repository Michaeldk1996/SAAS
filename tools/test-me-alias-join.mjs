#!/usr/bin/env node
// Founder ruling 2026-10-18 ("spellings: approved"): 599 of 43,979 Market edge rows met no career row on the live site
// (probe r27). Most of the name-caused ones are opponents with no player key whom the archive spells another way
// ("Del Potro J.M.") and the career rows spell "J. Martin del Potro": no surname-key test can meet them. They now meet
// through the ONE name table the price join already reads (build-odds-performance.js ARCHIVE_PAGE_SPELLINGS, published as
// database-yield-players.json `aliases`):
//   1. meRowFromCareer joins the career row to its Tennis-Data row through an alias (tdKey set), and the Market edge
//      winner row then carries the career row; without the table (control) it does not; MUTANT: the alias step removed → red;
//   2. an alias never joins a row of another result or outside the window (still exactly one row);
//   3. the table holds the approved spellings, and a name in both tables keeps every spelling (build-database-yield.js).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildData, HTML } from './ten310-harness.mjs';
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m + (d ? ' — ' + d : '')); } };

const career = [{ date: '2016-02-08', level: 'atp', tournament: 'Delray Beach', round: 'R32', opponent: 'J. Martin del Potro', result: '0 - 2', won: false,
  src: 'archive', sets: [{ p: 4, o: 6 }, { p: 4, o: 6 }] }];
const closes = { rows: [['2016-02-10', 'Del Potro J.M.', 0, 2.1, 1.75, null, null, 0, null], ['2016-02-12', 'Del Potro J.M.', 1, 2.0, 1.8, null, null, 0, null]], cap: [] };
const shard = { matches: [{ date: '2016-02-10', event: 'Delray Beach Open', surface: 'Hard', round: '1st Round', opp: 'Del Potro J.M.', won: false,
  price: 2.1, oppPrice: 1.75, book: 'pinnacle', inBasis: true }] };
function run(src, aliases) {
  globalThis._sfDbJoin = aliases ? { aliases } : null;
  const ui = buildData(src ? { src } : {});
  const cl = ui.fhParseCloses(closes);
  const rows = ui.meRowsFor(career, cl, '9', 'A. Test');
  const win = ui.meWinnerRows(shard, rows, '9', 'A. Test');
  return { tdKey: rows[0] && rows[0].tdKey, joined: !!(win[0] && win[0].tournRaw != null), sets: win[0] && win[0].sets };
}
const AL = { 'Del Potro J.M.': 'J. Martin del Potro' };
const a = run(null, AL);
ok(a.tdKey === '2016-02-10|Del Potro J.M.|0', 'the career row meets its Tennis-Data row through the alias (the loss, not the win two days later)', JSON.stringify(a));
ok(a.joined && Array.isArray(a.sets), 'the Market edge row now carries its career row (set scores, the stats sheet)', JSON.stringify(a));
const c = run(null, null);
ok(!c.tdKey && !c.joined, 'CONTROL: without the name table the row stays unjoined (the pre-fix miss)', JSON.stringify(c));
const anchor = "    if (AL) hits = (cl.rows || []).filter(";
ok(HTML.split(anchor).length === 2, 'the mutant anchor is found once');
const m = run(HTML.replace(anchor, '    if (false) hits = (cl.rows || []).filter('), AL);
ok(!m.joined, 'MUTANT (the alias step removed) turns the check red');
globalThis._sfDbJoin = { aliases: AL };
const two = buildData({});
const cl2 = two.fhParseCloses({ rows: [['2016-02-10', 'Del Potro J.M.', 0, 2.1, 1.75, null, null, 0, null], ['2016-02-11', 'Del Potro J.M.', 0, 2.2, 1.7, null, null, 0, null]], cap: [] });
ok(!two.meRowsFor(career, cl2, '9', 'A. Test')[0].tdKey, 'two rows the alias could meet in the window: no join (never a guess)');
const far = two.fhParseCloses({ rows: [['2016-03-20', 'Del Potro J.M.', 0, 2.1, 1.75, null, null, 0, null]], cap: [] });
ok(!two.meRowsFor(career, far, '9', 'A. Test')[0].tdKey, 'a row outside the event window never joins through an alias');

const OP = require('../build-odds-performance.js');
const want = { 'Del Potro J.M.': 'J. Martin del Potro', 'Londero J.I.': 'J. Ignacio Londero', 'Chela J.I.': 'J. Ignacio Chela', 'Ferrero J.C.': 'J. Carlos Ferrero',
  'Galan D.E.': 'D. Elahi Galan', 'Cerundolo J.M.': 'J. Manuel Cerundolo', 'Wang Y.T.': 'J. Wang', 'Stepanek M.': 'R. Stepanek' };
ok(Object.entries(want).every(([n, v]) => OP.ARCHIVE_PAGE_SPELLINGS[n] === v), 'ARCHIVE_PAGE_SPELLINGS holds the approved spellings (Del Potro, Londero, Chela, Ferrero, Galan, Cerundolo, Wang, Stepanek)');
const B = readFileSync(new URL('../build-database-yield.js', import.meta.url), 'utf8');
ok(/if \(aliases\[n\]\) our\.unshift\(\.\.\.\[\]\.concat\(aliases\[n\]\)\);/.test(B) && !/!held\.has\(n\) \|\| aliases\[n\]\) continue;/.test(B),
  'build-database-yield.js: a name in both tables keeps the page spelling AND the profile spelling (never one replacing the other)');
console.log(`\ntest-me-alias-join: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
