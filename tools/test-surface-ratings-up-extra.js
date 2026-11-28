// Founder 2026-11-26: players under the board's inclusion gate get a career Under-pressure index
// against the pool's own components (surface-ratings.js upExtraIndex), and never move the pool.
const assert = require('assert');
const { upExtraIndex, computeRatings, newBucket } = require('../surface-ratings.js');
const comps = ['bpSavedPct', 'bpConvPct', 'tbWinPct', 'decWinPct'];
const sorted = { bpSavedPct: [50, 60, 70], bpConvPct: [30, 40, 50], tbWinPct: [40, 50, 60], decWinPct: [40, 50, 60] };
const before = JSON.stringify(sorted);
const up = (a, b, c, d) => ({ career: { underPressure: { bpSavedPct: a, bpConvPct: b, tbWinPct: c, decWinPct: d, rating: 1 } } });
const extra = [{ key: '1', surfaces: { All: up(70, 50, 60, null) } }, { key: '2', surfaces: { All: up(50, 30, 40, 40) } },
  { key: '3', surfaces: { All: { career: { underPressure: { rating: null } } } } }];
upExtraIndex(extra, 'All', sorted, comps);
const i1 = extra[0].surfaces.All.career.underPressure.index, i2 = extra[1].surfaces.All.career.underPressure.index;
assert(i1 > i2, `the stronger player ranks higher (${i1} vs ${i2})`);
assert(extra[2].surfaces.All.career.underPressure.index === undefined, 'an unrated row gets no index');
assert.strictEqual(JSON.stringify(sorted), before, 'the pool is never changed');
// A thin-at-tour player with a Challenger sample clears the Under-pressure floors.
const tour = Object.assign(newBucket(), { matches: 5, bpSaved: 10, bpFaced: 20, oBpFaced: 20, oBpSaved: 14, tbWon: 1, tbPlayed: 3, decWon: 1, decPlayed: 2 });
const ch = Object.assign(newBucket(), { matches: 80, bpSaved: 200, bpFaced: 320, oBpFaced: 300, oBpSaved: 190, tbWon: 12, tbPlayed: 22, decWon: 10, decPlayed: 18 });
const floors = { minMatches: 20, minSvpt: 400, minBpFaced: 50, minBpChance: 50, minTb: 6, minDec: 5 };
const r = computeRatings(tour, floors, ch).underPressure;
assert(r.rating != null && r.components === 4 && r.inclChallenger, 'the Challenger top-up rates him: ' + JSON.stringify(r));
assert(computeRatings(tour, floors, null).underPressure.rating == null, 'control: tour alone is below the floors');
// ITF (founder 2026-11-28): success counts scaled so that after the Challenger discount (0.9) an ITF success counts 0.8.
const { scaleSuccess } = require('../surface-ratings-chall-apitennis.js');
const itf = scaleSuccess({ bpFaced: 10, bpSaved: 6, oBpFaced: 10, oBpSaved: 6, tbPlayed: 2, tbWon: 1, decPlayed: 1, decWon: 1 }, 0.8 / 0.9);
const near = (a, b) => Math.abs(a - b) < 1e-9;
assert(itf.itf && near(itf.bpSaved * 0.9, 6 * 0.8) && near((itf.oBpFaced - itf.oBpSaved) * 0.9, 4 * 0.8) && near(itf.tbWon * 0.9, 0.8) && near(itf.decWon * 0.9, 0.8), 'ITF successes count 0.8: ' + JSON.stringify(itf));
assert(itf.bpFaced === 10 && itf.oBpFaced === 10 && itf.tbPlayed === 2 && itf.decPlayed === 1, 'denominators untouched');
console.log('surface-ratings Under-pressure extra: all checks pass');
