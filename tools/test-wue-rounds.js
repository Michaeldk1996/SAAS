// W/UE export (founder rulings 2026-10-20): actual-round tabs, match by match (ruling 6), quarters + BYE rows from the
// official draw (ruling 7), WINNERS ONLY with one row per match slot (ruling 1, second round).
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
console.log('W/UE export — winners only, one row per match slot, quarters + byes, actual-round tabs');
const players = r => r.rows.filter(x => !x.header);
const slots = draw.main.slots;
check('fixture: 9 completed R32 matches, all with stats; draw 32 slots', prog.matches.length === 9 && prog.matches.every(m => m.roundCode === 'R32' && m.hasStats) && draw.main.size === 32);

// ── tab + status ──
let R = W.sheetRounds(prog, draw);
check('one tab, named R32 (never "ROUND 1")', R.length === 1 && R[0].title === 'R32', R.map(r => r.title).join());
check('status "R32: 9 of 12" (12 = 16 slot pairs − 4 byes); no draw → total is a dash', W.roundStatus(prog, draw) === 'R32: 9 of 12' && W.roundStatus(prog, null) === 'R32: 9 of —');

// ── one row per match slot, quarters, byes (first round only) ──
const r32 = R[0], p = players(r32);
const heads = r32.rows.filter(x => x.header).map(x => x.header);
check('R32: 16 rows = 4 per quarter, under Q1 Q2 Q3 Q4', p.length === 16 && heads.join() === 'Q1,Q2,Q3,Q4'
  && [0, 1, 2, 3].every(q => { const i = r32.rows.findIndex(x => x.header === `Q${q + 1}`); return r32.rows.slice(i + 1, i + 5).every(x => !x.header); }));
check('BYE rows: Medvedev, Bublik, Rublev, Darderi — the seeds beside the sheet\'s bye slots 2, 10, 23, 31',
  p.filter(r => r.values[0] === 'BYE').map(r => r.player).join() === 'D. Medvedev,A. Bublik,A. Rublev,L. Darderi' && slots.filter(s => s.bye).map(s => s.pos).join() === '2,10,23,31');
check('winners only: 9 finished matches → their 9 winners; no loser appears', p.filter(r => typeof r.values[0] === 'number').length === 9
  && !p.some(r => ['M. Kecmanovic', 'T. A. Tirante', 'A. Vukic', 'M. Cilic', 'S. Sakellaridis', 'A. Kovacevic', 'R. Safiullin', 'R. Hijikata', 'T. Skatov'].includes(r.player)), p.map(r => r.player).join(' · '));
check('a winner carries the stats of the match he won (Basilashvili d. Cilic: 26/20/122)', (() => { const r = p.find(x => x.player === 'N. Basilashvili'); return r && r.values[0] === 26 && r.values[1] === 20 && r.values[2] === 122; })());
const tbd = p.filter(r => r.player.startsWith('TBD'));
check('unplayed match slots keep their row: "TBD (A v B)", stats blank — never zeros', tbd.map(r => r.player).join(' | ') === 'TBD (M. Bellucci v T. M. Etcheverry) | TBD (Z. Nurlanuly v T. Machac) | TBD (R. Sakamoto v K. Khachanov)'
  && tbd.every(r => r.values.every(v => v === W.BLANK)), tbd.map(r => r.player).join(' | '));
check('rows in draw order: each row\'s match slot = its position in the quarter', (() => {
  const order = []; let j = 0; for (const x of r32.rows) { if (x.header) continue; order.push(j++); } return order.length === 16; })());
for (const [n, w, ue, tt, dr] of [['F. Diaz Acosta', 26, 24, 186, 1.54], ['A. Mannarino', 34, 37, 205, 1.45], ['J. Duckworth', 27, 18, 113, 1.21]]) {
  const r = p.find(x => x.player === n);
  check(`acceptance (a winner): ${n} ${w}/${ue}/${tt}/${dr}`, r && r.values[0] === w && r.values[1] === ue && r.values[2] === tt && r.values[6] === dr, r && JSON.stringify(r.values));
}
check('no draw → R32 tab = the 9 winners in order of play, no quarter headers', (() => { const r0 = W.sheetRounds(prog, null); return r0.length === 1 && r0[0].rows.length === 9 && !r0[0].rows.some(x => x.header) && r0[0].rows[0].player === 'J. Duckworth'; })());

// ── R16 opens with its first finished match; its other slots are TBD with the known names ──
const side = (name, key, w, ue, tt) => ({ name, playerKey: key, winners: w, unforcedErrors: ue, wueSource: 'api-tennis', totalPoints: tt, servicePoints: { won: 40, total: 60 }, returnPoints: { won: 20, total: 55 } });
const keyOf = pre => slots.find(s => s.name && s.name.startsWith(pre)).playerKey;
const plus = JSON.parse(JSON.stringify(prog));
plus.matches.push({ eventKey: 'x1', round: 'R2', roundCode: 'R16', hasStats: true, status: 'finished', winner: 2, p1: side('J. Duckworth', keyOf('DUCKWORTH'), 30, 20, 150), p2: side('L. Darderi', keyOf('DARDERI'), 25, 28, 150) });
R = W.sheetRounds(plus, draw);
check('R16 tab appears with ONE finished R16 match (R32 still 9 of 12); status "R32: 9 of 12 · R16: 1 of 8"', R.map(r => r.title).join() === 'R32,R16' && W.roundStatus(plus, draw) === 'R32: 9 of 12 · R16: 1 of 8');
const r16 = R[1], p16 = players(r16);
check('R16: 8 rows = 2 per quarter', p16.length === 8 && r16.rows.filter(x => x.header).length === 4);
check('R16: the finished match → its winner (Darderi) with that match\'s stats; Duckworth (lost) is gone', (() => { const r = p16.find(x => x.player === 'L. Darderi'); return r && r.values[0] === 25 && r.values[2] === 150 && !p16.some(x => x.player === 'J. Duckworth'); })());
check('R16: Medvedev (bye) v Shimabukuro (won R32) → "TBD (D. Medvedev v S. Shimabukuro)"', p16[0].player === 'TBD (D. Medvedev v S. Shimabukuro)', p16[0].player);
check('R16: an R32 match not yet played feeds "TBD" — never a guessed name (Bellucci v Etcheverry winner)', p16[1].player === 'TBD (S. Shimabukuro v TBD)' || p16[1].player === 'TBD (T. Atmane v TBD)', p16[1].player);
check('BYE rows only in the first round', !p16.some(r => r.values[0] === 'BYE'));
// ── finished without stats: the winner, dashes, flagged; such a match alone never opens a tab ──
const nostat = JSON.parse(JSON.stringify(plus));
nostat.matches.push({ eventKey: 'x2', round: 'R2', roundCode: 'R16', hasStats: false, status: 'finished', winner: 1,
  p1: { name: 'A. Mannarino', playerKey: keyOf('MANNARINO'), winners: null, unforcedErrors: null, totalPoints: null, servicePoints: null, returnPoints: null },
  p2: { name: 'A. Rublev', playerKey: keyOf('RUBLEV'), winners: null, unforcedErrors: null, totalPoints: null, servicePoints: null, returnPoints: null } });
const ns = players(W.sheetRounds(nostat, draw)[1]).find(r => r.player.startsWith('A. Mannarino'));
check('finished without stats → the winner, all dashes (null), flagged [NO STATS] — never zeros', ns && ns.player === 'A. Mannarino [NO STATS]' && ns.values.every(v => v === null), ns && JSON.stringify(ns));
const only = JSON.parse(JSON.stringify(prog)); only.matches.push(nostat.matches[nostat.matches.length - 1]);
check('a no-stats R16 match alone does not open an R16 tab; the status says it ("R16: 1 of 8 (1 without stats)")', W.sheetRounds(only, draw).map(r => r.title).join() === 'R32' && W.roundStatus(only, draw).endsWith('R16: 1 of 8 (1 without stats)'));
// ── unplaced: a played match whose player has no draw slot is kept under UNPLACED (winner only), never placed by guess ──
const d2 = JSON.parse(JSON.stringify(draw)); d2.main.slots.find(s => s.name && s.name.startsWith('DUCKWORTH')).playerKey = null;
const rr = W.sheetRounds(prog, d2)[0], hb = rr.rows.filter(x => x.header).map(x => x.header);
check('unresolved key → that match\'s winner under UNPLACED; its slot stays TBD', hb[hb.length - 1] === 'UNPLACED' && rr.rows.slice(rr.rows.findIndex(x => x.header === 'UNPLACED')).some(x => x.player === 'J. Duckworth')
  && players(rr).some(x => x.player === 'TBD (M. Kecmanovic v J. Duckworth)'));
// ── Copy per tab = exactly the tab's rows ──
const tsv = W.roundTsv(r32).split('\n');
check('Copy R32 = exactly the tab: 4 quarter lines + 16 rows; BYE / TBD / winners as shown', tsv.length === 20 && tsv[0] === 'Q1' && tsv[1] === 'D. Medvedev\tBYE\t\t\t\t\t\t' && tsv.includes('TBD (M. Bellucci v T. M. Etcheverry)\t\t\t\t\t\t\t') && tsv.includes('J. Duckworth\t27.00\t18.00\t113.00\t0.24\t0.16\t1.50\t1.21'), tsv.slice(0, 3).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
