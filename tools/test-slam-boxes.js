// TEN-89 Part 2 — unit checks for deriveSlamBoxes (Grand-Slam profile boxes).
// Verifies the founder's rulings (interaction f7ebc630, accepted 2026-08-27):
//   gsCareer  = W-L across all four majors, MAIN DRAW, INCL. retirements + w/o wins
//   over35    = 4+ set matches at THIS major, MAIN DRAW, COMPLETED only (ret & w/o out)
// Pure logic, no network. Run: node tools/test-slam-boxes.js
const { deriveSlamBoxes } = require('../bsp-pipeline.js');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
}

// One Slam edition, one non-Slam. Covers: main-draw W/L, a retirement win and a
// retirement loss (count in W-L, out of over35 sample), a walkover received
// (win in W-L, out of over35), a walkover GIVEN 'WD' (neither), a qualifying 'Q'
// and a raw 'Q2' (both dropped from everything), a 5-set and a 4-set (over35),
// a straight-sets win (in sample, not over), and an unscored row (out of sample).
const profile = {
  name: 'Test Player',
  tournamentHistory: [
    { name: 'US Open', editions: [
      { year: 2021, matches: [
        { res: 'W', round: 'Q2', score: '2 - 0' },              // qualifying — dropped everywhere
        { res: 'L', round: 'Q',  score: '2 - 1' },              // qualifying — dropped everywhere
        { res: 'W', round: 'R128', score: '3 - 0' },            // main-draw win, straight sets: sample yes, over no
        { res: 'W', round: 'R64',  score: '3 - 2' },            // 5 sets: over yes
        { res: 'W', round: 'R32',  score: '3 - 1' },            // 4 sets: over yes
        { res: 'W', round: 'R16',  score: '3 - 0', walkover: true }, // w/o received: W counts, over-sample no
        { res: 'W', round: 'QF',   score: '2 - 0', ret: true }, // ret win: W counts, over-sample no
        { res: 'L', round: 'SF',   score: '1 - 2', ret: true }, // ret loss: L counts, over-sample no
      ] },
      { year: 2020, matches: [
        { res: 'W', round: 'R128', score: '' },                 // unscored main-draw win: W counts, over-sample no
        { res: 'WD', round: 'R64', score: '' },                 // walkover GIVEN: neither W/L, not in sample
      ] },
    ] },
    { name: 'Wimbledon', editions: [
      { year: 2019, matches: [
        { res: 'W', round: 'F', score: '3 - 2' },               // Slam #2, main-draw win, 5 sets
        { res: 'L', round: 'F', score: '2 - 3' },               // (fictional) 5-set loss
      ] },
    ] },
    { name: 'Miami', editions: [ // non-Slam: must NOT get over35, must NOT touch gsCareer
      { year: 2022, matches: [ { res: 'W', round: 'F', score: '2 - 0' } ] },
    ] },
  ],
};

const any = deriveSlamBoxes(profile);
eq('returns true (has Slam history)', any, true);

// gsCareer: US Open main-draw W = R128,R64,R32,R16(w/o),QF(ret),R128'20 unscored, = 6;
//           L = SF(ret) = 1. Wimbledon W = F = 1; L = F = 1. Q/Q2/WD excluded.
// Total: W = 6 + 1 = 7 ; L = 1 + 1 = 2.
eq('gsCareer', profile.gsCareer, { won: 7, lost: 2 });

// US Open over35: sample = completed main-draw = R128(3-0), R64(3-2), R32(3-1) = 3
//   (w/o, both ret, unscored, WD, and all Q all excluded). count(>=4 sets) = R64,R32 = 2.
const uso = profile.tournamentHistory.find(t => t.name === 'US Open');
eq('US Open over35', uso.over35, { count: 2, sample: 3 });

// Wimbledon over35: sample = 2 (both scored, completed, main draw), count = 2 (both 5 sets).
const wim = profile.tournamentHistory.find(t => t.name === 'Wimbledon');
eq('Wimbledon over35', wim.over35, { count: 2, sample: 2 });

// TEN-89 2026-08-28: per-Slam main-draw W-L drives the record + win-rate tiles on
// the Slam card (founder ruling: whole card is main-draw-only). US Open main draw:
// W = R128,R64,R32,R16(w/o),QF(ret),R128'20 = 6 ; L = SF(ret) = 1.
eq('US Open mainDraw', uso.mainDraw, { won: 6, lost: 1 });
// Wimbledon main draw: W = F = 1 ; L = F = 1.
eq('Wimbledon mainDraw', wim.mainDraw, { won: 1, lost: 1 });

// All-majors over-3.5 aggregate (founder item 4): US Open {2,3} + Wimbledon {2,2}.
eq('gsOver35', profile.gsOver35, { count: 4, sample: 5 });

// Non-Slam tournament must be untouched.
const mia = profile.tournamentHistory.find(t => t.name === 'Miami');
eq('non-Slam has no over35', mia.over35, undefined);
eq('non-Slam has no mainDraw', mia.mainDraw, undefined);

// A player with zero Slam history: no gsCareer, returns false.
const noSlam = { name: 'X', tournamentHistory: [ { name: 'Miami', editions: [ { year: 2022, matches: [ { res: 'W', round: 'F', score: '2 - 0' } ] } ] } ] };
eq('no-Slam player returns false', deriveSlamBoxes(noSlam), false);
eq('no-Slam player has no gsCareer', noSlam.gsCareer, undefined);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
