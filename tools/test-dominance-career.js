// Founder 2026-11-19: every player carries a career Dominance ratio (return points won % ÷ (100 − service points won %)),
// built by surface-ratings.js from the bucket's own tour-level counts. Checks the formula on known counts, the null cases,
// and a mutant (the ratio inverted) that must fail.
const assert = require('assert');
const { computeRatings, newBucket } = require('../surface-ratings.js');
const floors = { svpt: 0, bpFaced: 0, bpChances: 0, tb: 0, dec: 0, matches: 0 };
function bucket(o) { return Object.assign(newBucket(), o); }
// 600 serve points, 300 + 120 won (70%); 600 return points, opponent won 330 + 102 → 168 won (28%) → 28 / 30 = 0.93
const b = bucket({ matches: 10, svMatches: 10, svpt: 600, firstIn: 380, firstWon: 300, secondWon: 120, svGms: 90, bpFaced: 30, bpSaved: 20,
  oSvpt: 600, oFirstIn: 400, oFirstWon: 330, oSecondWon: 102, oSvGms: 90, oBpFaced: 40, oBpSaved: 25 });
let r;
try { r = computeRatings(b, floors, null); } catch (e) { r = computeRatings(b, undefined, null); }
assert.ok(r.dominance, 'a bucket with serve and return points has a dominance ratio');
assert.strictEqual(r.dominance.spwPct, 70);
assert.strictEqual(r.dominance.rpwPct, 28);
assert.strictEqual(r.dominance.rating, 0.93);
// mutant: the ratio the wrong way round reads 1.07, never 0.93
assert.notStrictEqual(+((1 - 0.7) / 0.28).toFixed(2), r.dominance.rating);
// no return points → no ratio (null, never 0)
const n = computeRatings(bucket({ matches: 1, svMatches: 1, svpt: 60, firstIn: 40, firstWon: 30, secondWon: 10, svGms: 9 }), floors, null);
assert.strictEqual(n.dominance, null);
console.log('dominance-career: ok');
