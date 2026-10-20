// Rulings 6 + 7 (founder 2026-10-20): W/UE export rounds fill in match by match, named by the ACTUAL round, with
// quarters Q1–Q4 + BYE rows from the official draw positions only.
// Pinned: real Almaty 2026 R32 rows (9 completed, api-tennis) + the real official Almaty 2026 main draw.
// Run: node tools/test-wue-rounds.js
'use strict';
const fs = require('fs'); const path = require('path');
const W = require(path.join(__dirname, '..', 'wue-sheet.js'));
const FX = path.join(__dirname, 'fixtures', 'wue-sheet');
const prog = JSON.parse(fs.readFileSync(path.join(FX, 'almaty-2026-r1.json'), 'utf8'));
const draw = W.drawFor(JSON.parse(fs.readFileSync(path.join(FX, 'almaty-2026-draw.json'), 'utf8')), 'Almaty');
let pass = 0, fail = 0;
const check = (l, c, d) => { if (c) { pass++; console.log(`  ok   ${l}`); } else { fail++; console.log(`  FAIL ${l}${d ? `\n       ${d}` : ''}`); } };
console.log('W/UE export — actual-round tabs, match by match, quarters + byes');
const players = r => r.rows.filter(x => !x.header);
check('fixture non-empty: 9 completed R32 matches, all with stats', prog.matches.length === 9 && prog.matches.every(m => m.roundCode === 'R32' && m.hasStats));
check('draw posted: 32 slots', draw && draw.main.size === 32);

// ── tab names + status ──
let R = W.sheetRounds(prog, draw);
check('one tab, named R32 (never "ROUND 1")', R.length === 1 && R[0].title === 'R32', R.map(r => r.title).join());
check('status with the draw: "R32: 9 of 12" (12 = 16 slot pairs − 4 byes)', W.roundStatus(prog, draw) === 'R32: 9 of 12', W.roundStatus(prog, draw));
check('status without a draw: the total is a dash, never guessed', W.roundStatus(prog, null) === 'R32: 9 of —');
check('draw rounds for 32 slots: R32 R16 QF SF F', W.drawRounds(32).join(' ') === 'R32 R16 QF SF F' && W.drawRounds(128).join(' ') === 'R128 R64 R32 R16 QF SF F');

// ── quarters + byes + blanks (ruling 7) ──
const r32 = R[0];
check('R32 grouped Q1, Q2, Q3, Q4 in draw order', r32.rows.filter(x => x.header).map(x => x.header).join() === 'Q1,Q2,Q3,Q4');
const p = players(r32);
check('R32 lists all 28 draw players: 18 played + 4 byes + 6 not yet played', p.length === 28
  && p.filter(r => r.values[0] === 'BYE').length === 4 && p.filter(r => r.values.every(v => v === W.BLANK)).length === 6, p.length);
check('BYE rows: Medvedev, Bublik, Rublev, Darderi', p.filter(r => r.values[0] === 'BYE').map(r => r.player).join() === 'D. Medvedev,A. Bublik,A. Rublev,L. Darderi');
check('unplayed rows are blank — never a 0, never a dash', p.filter(r => r.values.every(v => v === W.BLANK)).every(r => !r.values.includes(0) && !r.values.includes(W.DASH)));
for (const [n, w, ue, tt, dr] of [['F. Diaz Acosta', 26, 24, 186, 1.54], ['A. Mannarino', 34, 37, 205, 1.45], ['J. Duckworth', 27, 18, 113, 1.21]]) {
  const r = p.find(x => x.player === n);
  check(`acceptance in the R32 tab: ${n} ${w}/${ue}/${tt}/${dr}`, r && r.values[0] === w && r.values[1] === ue && r.values[2] === tt && r.values[6] === dr, r && JSON.stringify(r.values));
}
check('no draw → R32 tab in order of play, no quarter headers, 18 rows', (() => { const r0 = W.sheetRounds(prog, null); return r0.length === 1 && r0[0].title === 'R32' && r0[0].rows.length === 18 && !r0[0].rows.some(x => x.header); })());

// ── match by match: one R16 match with stats → an R16 tab now, while R32 is still finishing ──
const side = (name, key, w, ue, tt) => ({ name, playerKey: key, winners: w, unforcedErrors: ue, wueSource: 'api-tennis', totalPoints: tt, servicePoints: { won: 40, total: 60 }, returnPoints: { won: 20, total: 55 } });
const duck = draw.main.slots.find(s => s.name && s.name.startsWith('DUCKWORTH')).playerKey, dard = draw.main.slots.find(s => s.name && s.name.startsWith('DARDERI')).playerKey;
const plus = JSON.parse(JSON.stringify(prog));
plus.matches.push({ eventKey: 'x1', round: 'R2', roundCode: 'R16', hasStats: true, status: 'finished', winner: 1, p1: side('J. Duckworth', duck, 30, 20, 150), p2: side('L. Darderi', dard, 25, 28, 150) });
R = W.sheetRounds(plus, draw);
check('R16 tab appears as soon as ONE R16 match finished with stats (R32 still 9 of 12)', R.map(r => r.title).join() === 'R32,R16', R.map(r => r.title).join());
check('status: "R32: 9 of 12 · R16: 1 of 8"', W.roundStatus(plus, draw) === 'R32: 9 of 12 · R16: 1 of 8', W.roundStatus(plus, draw));
const r16 = players(R[1]);
check('R16 tab: the finished match (2 rows) + known players blank (R32 winners + byes, in draw order)',
  r16.filter(r => typeof r.values[0] === 'number').length === 2 && r16.length === 13 && r16.filter(r => r.values.every(v => v === W.BLANK)).length === 11, r16.length);
// ── a finished match without stats: dashes, flagged; it alone never opens a tab ──
const nostat = JSON.parse(JSON.stringify(prog));
nostat.matches.push({ eventKey: 'x2', round: 'R2', roundCode: 'R16', hasStats: false, status: 'finished', winner: 1,
  p1: { name: 'A. Mannarino', playerKey: prog.matches.find(m => m.p1.name === 'A. Mannarino').p1.playerKey, winners: null, unforcedErrors: null, totalPoints: null, servicePoints: null, returnPoints: null },
  p2: { name: 'A. Rublev', playerKey: draw.main.slots.find(s => s.name && s.name.startsWith('RUBLEV')).playerKey, winners: null, unforcedErrors: null, totalPoints: null, servicePoints: null, returnPoints: null } });
R = W.sheetRounds(nostat, draw);
check('a no-stats R16 match alone does not open an R16 tab', R.map(r => r.title).join() === 'R32');
check('…but the status says it out loud: "R16: 1 of 8 (1 without stats)"', W.roundStatus(nostat, draw).endsWith('R16: 1 of 8 (1 without stats)'), W.roundStatus(nostat, draw));
const mix = JSON.parse(JSON.stringify(plus)); mix.matches.push(nostat.matches[nostat.matches.length - 1]);
const r16m = players(W.sheetRounds(mix, draw)[1]);
const ns = r16m.find(r => r.player.startsWith('A. Rublev'));
check('in an open tab, a no-stats match shows dashes, flagged [NO STATS] — never zeros', ns && ns.player === 'A. Rublev [NO STATS]' && ns.values.every(v => v === null), ns && JSON.stringify(ns));
// ── unplaced: a played row whose player has no draw slot is kept, never placed by guess ──
const d2 = JSON.parse(JSON.stringify(draw)); d2.main.slots.find(s => s.playerKey === duck).playerKey = null;
const rr = W.sheetRounds(prog, d2)[0];
const heads = rr.rows.filter(x => x.header).map(x => x.header);
check('an unresolved draw key → the real row under UNPLACED', heads[heads.length - 1] === 'UNPLACED' && rr.rows.slice(rr.rows.findIndex(x => x.header === 'UNPLACED')).some(x => x.player === 'J. Duckworth'));
// ── copy per tab ──
const tsv = W.roundTsv(W.sheetRounds(plus, draw)[1]).split('\n');
check('Copy R16 = that tab only: quarter headers + rows, ratios 2dp, blanks empty', tsv[0].startsWith('Q') && tsv.some(l => l.startsWith('J. Duckworth\t30\t20\t150\t0.20\t0.13\t1.50')), tsv.slice(0, 4).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
