#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// TEN-243 gate `b5a358e9` (2026-09-19) — two founder rulings on surface-ratings.js.
//
// 1 · SERVE RATING must implement the 2026-08-29 lock:
//        1stIn% + 1stWon% + 2ndWon% + hold% + aces/match − DF/match
//     with aces and double faults as RAW PER-MATCH COUNTS. Until TEN-243 this file
//     summed ace% and applied NO df penalty, so it did not implement the ruling it
//     was supposed to — the board printed a number that contradicted the lock.
//     Founder: "Regenerate surface-ratings.js with the locked terms."
//
// 2 · MENTAL EDGE: "PW = BP saved + BP converted; PL = BP missed + BP lost;
//     rating = PW ÷ PL." A pressure point IS a break point.
//
// These run against the REAL shipped `computeRatings`, sliced out of the generator
// and evaluated in a sandbox — the module has no exports and calling it would hit
// api-tennis (real quota). Slicing tests the shipped code; a stub would only test
// the stub. See memory: npm-test-runs-one-of-ten-mjs-suites.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'surface-ratings.js'), 'utf8');

let pass = 0; const fails = [];
function check(name, fn) {
  try { fn(); pass++; console.log(`  ok    ${name}`); }
  catch (e) { fails.push(name); console.log(`  FAIL  ${name} :: ${e.message}`); }
}

// ---- slice the real functions out of the generator --------------------------
function sliceFn(name) {
  const start = SRC.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found in surface-ratings.js`);
  let depth = 0, seen = false;
  for (let i = start; i < SRC.length; i++) {
    if (SRC[i] === '{') { depth++; seen = true; }
    else if (SRC[i] === '}') { depth--; if (seen && !depth) return SRC.slice(start, i + 1); }
  }
  throw new Error(`could not close function ${name}`);
}
const CHALL_DISCOUNT = (() => {
  const m = SRC.match(/const CHALL_DISCOUNT = \(\(\) => \{[^}]*Number\.isFinite\(v\) \? v : ([\d.]+)/);
  assert.ok(m, 'CHALL_DISCOUNT default not found — the test must use the shipped value, not its own');
  return parseFloat(m[1]);
})();

const sandbox = new Function(
  'CHALL_DISCOUNT',
  `${sliceFn('newBucket')}\n${sliceFn('addContribution')}\n${sliceFn('round1')}\n${sliceFn('computeRatings')}\n` +
  `return { newBucket, addContribution, round1, computeRatings };`
)(CHALL_DISCOUNT);
const { newBucket, addContribution, computeRatings } = sandbox;

// Floors low enough that the synthetic buckets clear them — the floors are not
// what is under test here, the arithmetic is.
const FLOORS = { minMatches: 1, minSvpt: 1, minBpFaced: 1, minBpChance: 1, minTb: 1, minDec: 1 };

// One contribution shaped like a real match row.
function contrib(o) {
  return Object.assign({
    svpt: 0, firstIn: 0, firstWon: 0, secondWon: 0, svGms: 0, ace: 0, df: 0,
    bpFaced: null, bpSaved: 0,
    oSvpt: 0, oFirstIn: 0, oFirstWon: 0, oSecondWon: 0, oSvGms: 0, oBpFaced: null, oBpSaved: 0,
    tbPlayed: 0, tbWon: 0, decPlayed: 0, decWon: 0,
  }, o);
}
// A bucket of `n` identical serve-bearing matches.
function serveBucket(n, per) {
  const b = newBucket();
  for (let i = 0; i < n; i++) addContribution(b, contrib(per));
  return b;
}

console.log('\n1 · SERVE RATING — the 2026-08-29 lock');

check('rating = components + aces/match − DF/match, to the decimal', () => {
  // 10 matches, 100 svpt each: 60 first in, 45 first won, 20 second won, 10 sv games
  // (1 bp faced, 1 saved => hold 100%), 8 aces, 3 DFs.
  const b = serveBucket(10, { svpt: 100, firstIn: 60, firstWon: 45, secondWon: 20, svGms: 10, ace: 8, df: 3, bpFaced: 1, bpSaved: 1 });
  const r = computeRatings(b, FLOORS, null);
  const s = r.serve;
  assert.ok(s, 'no serve node');
  assert.strictEqual(s.acesPerMatch, 8, `acesPerMatch ${s.acesPerMatch}`);
  assert.strictEqual(s.dfPerMatch, 3, `dfPerMatch ${s.dfPerMatch}`);
  const expected = +(s.firstInPct + s.firstWonPct + s.secondWonPct + s.holdPct + 8 - 3).toFixed(1);
  assert.strictEqual(s.rating, expected, `rating ${s.rating} != ${expected}`);
});

check('the DF penalty is REAL — two servers identical but for double faults differ by exactly the DF gap', () => {
  const base = { svpt: 100, firstIn: 60, firstWon: 45, secondWon: 20, svGms: 10, ace: 8, bpFaced: 1, bpSaved: 1 };
  const clean = computeRatings(serveBucket(10, Object.assign({}, base, { df: 0 })), FLOORS, null).serve;
  const spray = computeRatings(serveBucket(10, Object.assign({}, base, { df: 5 })), FLOORS, null).serve;
  assert.strictEqual(+(clean.rating - spray.rating).toFixed(1), 5.0,
    `DF gap ${clean.rating - spray.rating}, expected exactly 5.0 — the penalty is missing or scaled`);
});

check('MUTATION CONTROL: the OLD formula (ace% and no DF penalty) does NOT reproduce the rating', () => {
  const b = serveBucket(10, { svpt: 100, firstIn: 60, firstWon: 45, secondWon: 20, svGms: 10, ace: 8, df: 3, bpFaced: 1, bpSaved: 1 });
  const s = computeRatings(b, FLOORS, null).serve;
  const old = +(s.firstInPct + s.firstWonPct + s.secondWonPct + s.holdPct + s.acePct).toFixed(1);
  assert.notStrictEqual(s.rating, old,
    `the shipped rating (${s.rating}) still equals the pre-TEN-243 ace%-no-penalty sum (${old}) — the regen did not take`);
});

check('aces/DF divide by svMatches, NOT by matches — stat-less rows must not dilute them', () => {
  const b = newBucket();
  for (let i = 0; i < 5; i++) addContribution(b, contrib({ svpt: 100, firstIn: 60, firstWon: 45, secondWon: 20, svGms: 10, ace: 10, df: 2, bpFaced: 1, bpSaved: 1 }));
  for (let i = 0; i < 5; i++) addContribution(b, contrib({ svGms: 10, bpFaced: 1, bpSaved: 1 })); // no serve stats
  assert.strictEqual(b.matches, 10, 'matches');
  assert.strictEqual(b.svMatches, 5, 'svMatches');
  const s = computeRatings(b, FLOORS, null).serve;
  assert.strictEqual(s.acesPerMatch, 10, `acesPerMatch ${s.acesPerMatch} — dividing by matches would give 5`);
  assert.strictEqual(s.dfPerMatch, 2, `dfPerMatch ${s.dfPerMatch} — dividing by matches would give 1`);
});

check('acePct / dfPct survive as RATES — they are emitted but are not the rating', () => {
  const b = serveBucket(10, { svpt: 100, firstIn: 60, firstWon: 45, secondWon: 20, svGms: 10, ace: 8, df: 3, bpFaced: 1, bpSaved: 1 });
  const s = computeRatings(b, FLOORS, null).serve;
  assert.strictEqual(s.acePct, 8, `acePct ${s.acePct}`);   // 8 of 100 svpt
  assert.strictEqual(s.dfPct, 3, `dfPct ${s.dfPct}`);
});

check('Challenger fold-in discounts ACES but never DOUBLE FAULTS', () => {
  // Tour bucket left thin so srBlend turns on (okSample false needs matches < floor).
  const hardFloors = Object.assign({}, FLOORS, { minMatches: 99 });
  const tour = serveBucket(4, { svpt: 100, firstIn: 60, firstWon: 45, secondWon: 20, svGms: 10, ace: 10, df: 4, bpFaced: 1, bpSaved: 1 });
  const chall = serveBucket(4, { svpt: 100, firstIn: 60, firstWon: 45, secondWon: 20, svGms: 10, ace: 10, df: 4, bpFaced: 1, bpSaved: 1 });
  const s = computeRatings(tour, hardFloors, chall).serve;
  // aces: (40 + 0.9*40) / 8 = 9.5 ; DFs: (16 + 16) / 8 = 4.0 (undiscounted)
  assert.strictEqual(s.acesPerMatch, +(((40 + CHALL_DISCOUNT * 40) / 8)).toFixed(1), `acesPerMatch ${s.acesPerMatch}`);
  assert.strictEqual(s.dfPerMatch, 4, `dfPerMatch ${s.dfPerMatch} — a discounted penalty would read 3.8`);
});

console.log('\n2 · MENTAL EDGE — PW / PL, a pressure point is a break point');

check('PW = BP saved + BP converted; PL = BP lost + BP missed', () => {
  const b = newBucket();
  // served: 20 bp faced, 13 saved  => saved 13, lost 7
  // returned: opponent faced 18 bp, saved 6 => converted 12, missed 6
  addContribution(b, contrib({ bpFaced: 20, bpSaved: 13, oBpFaced: 18, oBpSaved: 6 }));
  const m = computeRatings(b, FLOORS, null).mental;
  assert.ok(m, 'no mental node');
  assert.strictEqual(m.pw, 13 + 12, `PW ${m.pw}`);
  assert.strictEqual(m.pl, 7 + 6, `PL ${m.pl}`);
  assert.strictEqual(m.rating, +((25 / 13).toFixed(3)), `rating ${m.rating}`);
});

check('the identity holds: PW + PL == bpFaced + bpChances, every break point in exactly one bucket', () => {
  const b = newBucket();
  addContribution(b, contrib({ bpFaced: 20, bpSaved: 13, oBpFaced: 18, oBpSaved: 6 }));
  addContribution(b, contrib({ bpFaced: 7, bpSaved: 2, oBpFaced: 11, oBpSaved: 9 }));
  const r = computeRatings(b, FLOORS, null);
  assert.strictEqual(r.mental.pw + r.mental.pl, r.sample.bpFaced + r.sample.bpChances,
    `PW+PL ${r.mental.pw + r.mental.pl} != bpFaced+bpChances ${r.sample.bpFaced + r.sample.bpChances}`);
});

check('rating is 3 decimal places', () => {
  const b = newBucket();
  addContribution(b, contrib({ bpFaced: 3, bpSaved: 2, oBpFaced: 3, oBpSaved: 2 }));
  const m = computeRatings(b, FLOORS, null).mental;
  // PW = 2 + 1 = 3 ; PL = 1 + 2 = 3 => 1.000
  assert.strictEqual(m.rating, 1, `rating ${m.rating}`);
  const b2 = newBucket();
  addContribution(b2, contrib({ bpFaced: 7, bpSaved: 5, oBpFaced: 9, oBpSaved: 4 }));
  const m2 = computeRatings(b2, FLOORS, null).mental;  // PW 5+5=10, PL 2+4=6 => 1.667
  assert.strictEqual(m2.rating, 1.667, `rating ${m2.rating} — expected 3dp 1.667`);
});

check('a player who never lost a break point gets NULL, not Infinity', () => {
  const b = newBucket();
  addContribution(b, contrib({ bpFaced: 4, bpSaved: 4, oBpFaced: 4, oBpSaved: 0 }));
  const m = computeRatings(b, FLOORS, null).mental;
  assert.strictEqual(m.pl, 0, `PL ${m.pl}`);
  assert.strictEqual(m.rating, null, `rating ${m.rating} — Infinity or a fabricated ceiling is not a rating`);
  assert.strictEqual(m.pw, 8, `PW ${m.pw} — the counts still render even when the ratio cannot`);
});

check('no break points at all => no mental node (a dash, never a zero)', () => {
  const b = newBucket();
  addContribution(b, contrib({ svpt: 50, firstIn: 30, firstWon: 22, secondWon: 10, svGms: 8 }));
  const r = computeRatings(b, FLOORS, null);
  assert.strictEqual(r.mental, null, 'mental should be null with zero break points on either side');
});

check('raw BP counters are emitted so PW/PL never need reconstructing from a rounded %', () => {
  const b = newBucket();
  addContribution(b, contrib({ bpFaced: 1855, bpSaved: 1193, oBpFaced: 3189, oBpSaved: 1860 }));
  const r = computeRatings(b, FLOORS, null);
  assert.strictEqual(r.sample.bpSaved, 1193, 'sample.bpSaved');
  assert.strictEqual(r.sample.bpConverted, 3189 - 1860, 'sample.bpConverted');
  assert.strictEqual(r.mental.pw, 1193 + (3189 - 1860), 'PW from raw counters');
});

console.log('\n2b · RETURN RATING — TEN-263 ruling: 0 break-point chances => null, one rule across the product');

// One return-bearing match: opponent serves 100 pts, 60 first in (won 42), 40 second
// (won 20), 10 service games. r1 = 18/60 = 30%, r2 = 20/40 = 50%.
const RET = { oSvpt: 100, oFirstIn: 60, oFirstWon: 42, oSecondWon: 20, oSvGms: 10 };

check('0 break-point chances => return rating NULL, bpConvPct NULL (not 0)', () => {
  const b = newBucket();
  addContribution(b, contrib(Object.assign({}, RET, { oBpFaced: 0, oBpSaved: 0 })));
  const r = computeRatings(b, FLOORS, null).return;
  assert.ok(r, 'the return node itself should still exist — its other components are real');
  assert.strictEqual(r.bpConvPct, null, `bpConvPct ${r.bpConvPct} — 0 chances has no rate`);
  assert.strictEqual(r.rating, null, `rating ${r.rating} — was 0-substituted before TEN-263 (would read 80)`);
  assert.strictEqual(r.ret1stWonPct, 30, `ret1stWonPct ${r.ret1stWonPct} — the real components still publish`);
  assert.strictEqual(r.ret2ndWonPct, 50, `ret2ndWonPct ${r.ret2ndWonPct}`);
  assert.strictEqual(r.breakPct, 0, `breakPct ${r.breakPct} — 0 breaks over 10 return games IS a real 0%`);
});

check('BP data absent (oBpFaced null, the api-tennis shape) => also null', () => {
  const b = newBucket();
  addContribution(b, contrib(RET));   // oBpFaced defaults to null
  const r = computeRatings(b, FLOORS, null).return;
  assert.strictEqual(r.rating, null, `rating ${r.rating}`);
});

check('nonzero chances are UNCHANGED — a real 0% conversion still sums', () => {
  const b = newBucket();
  addContribution(b, contrib(Object.assign({}, RET, { oBpFaced: 4, oBpSaved: 4 })));
  const r = computeRatings(b, FLOORS, null).return;
  assert.strictEqual(r.bpConvPct, 0, `bpConvPct ${r.bpConvPct}`);
  assert.strictEqual(r.rating, 80, `rating ${r.rating} — 30 + 50 + 0 + 0`);
});

check('nonzero chances: rating = r1 + r2 + breakPct + bpConvPct to the decimal', () => {
  const b = newBucket();
  addContribution(b, contrib(Object.assign({}, RET, { oBpFaced: 8, oBpSaved: 5 })));
  const r = computeRatings(b, FLOORS, null).return;
  // 30 + 50 + 3/10=30 + 3/8=37.5 = 147.5
  assert.strictEqual(r.bpConvPct, 37.5, `bpConvPct ${r.bpConvPct}`);
  assert.strictEqual(r.rating, 147.5, `rating ${r.rating}`);
});

check('Challenger chances fill a tour-level 0 for a thin player (blended den > 0 => rated)', () => {
  const b = newBucket();
  addContribution(b, contrib(Object.assign({}, RET, { oBpFaced: 0, oBpSaved: 0 })));
  const cb = newBucket();
  addContribution(cb, contrib(Object.assign({}, RET, { oBpFaced: 5, oBpSaved: 3 })));
  const thin = { minMatches: 99, minSvpt: 99, minBpFaced: 1, minBpChance: 1, minTb: 1, minDec: 1 };
  const r = computeRatings(b, thin, cb).return;
  assert.ok(r.rating != null, 'blended denominator is 5 chances — this player IS rated');
  assert.strictEqual(r.inclChallenger, true, 'inclChallenger');
});

check('zero 2nd-serve return points (oFirstIn == oSvpt) => null, same rule', () => {
  const b = newBucket();
  addContribution(b, contrib({ oSvpt: 50, oFirstIn: 50, oFirstWon: 35, oSecondWon: 0, oSvGms: 8, oBpFaced: 3, oBpSaved: 1 }));
  const r = computeRatings(b, FLOORS, null).return;
  assert.strictEqual(r.ret2ndWonPct, null, `ret2ndWonPct ${r.ret2ndWonPct}`);
  assert.strictEqual(r.rating, null, `rating ${r.rating}`);
});

check('method.return states the null rule', () => {
  assert.ok(/rating is null \(a dash\) when any component has a zero denominator/.test(SRC), 'method.return does not state the TEN-263 rule');
});

console.log('\n3 · the shipped meta says what the shipped code does');
check('method.serve quotes the per-match terms, not ace%', () => {
  assert.ok(/acesPerMatch - dfPerMatch/.test(SRC), 'method.serve does not quote the locked terms');
  assert.ok(!/Serve Rating = 1stIn% \+ 1stWon% \+ 2ndWon% \+ serviceGamesWon% \+ ace%/.test(SRC),
    'the old ace%-no-penalty method string is still in the file');
});
check('method.mental is published', () => {
  assert.ok(/mental: 'Mental Edge = PW \/ PL/.test(SRC), 'no method.mental entry');
});

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log('failed: ' + fails.join(' | ')); process.exit(1); }
