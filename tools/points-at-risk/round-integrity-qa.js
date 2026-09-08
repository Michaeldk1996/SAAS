'use strict';
/**
 * round-integrity-qa.js — TEN-173 round-integrity QA gate (FAIL-CLOSED).
 *
 * WHY THIS EXISTS (TEN-172 feasibility §5): raw api-tennis `tournament_round`
 * labels are scrambled mid-event. In a live US-Open week-1 probe, 66 first-week
 * matches were mislabelled "Quarter-finals" and some "Final". If the points
 * resolver trusted those labels it would credit a first-round loser with QF
 * points. So NO points may be computed for an edition until its round labels
 * pass this gate. This is the data-integrity/pipeline bug class (an automated
 * fail-closed gate), NOT the code-review class.
 *
 * THE INVARIANTS (per completed single-elimination edition, main draw only):
 *   1. MATCH COUNT: a single-elimination draw of size N always has exactly
 *      N-1 matches, regardless of byes. A completed edition whose main-draw
 *      match count != drawSize-1 is incomplete or corrupt -> FAIL.
 *   2. ROUND CAP: no round may hold more matches than its bracket slot allows
 *      (F<=1, SF<=2, QF<=4, R16<=8, R32<=16, R64<=32, R128<=64). The US-Open
 *      "66 Quarter-finals" scramble is exactly a ROUND CAP violation -> FAIL.
 *   3. CONTIGUITY: the rounds present must run contiguously from the first
 *      round down to the Final with no interior gap (e.g. R32 present, R16
 *      absent, QF present is impossible in single elimination) -> FAIL.
 *   4. MONOTONICITY: once past the first round, each deeper round's count must
 *      be <= the previous round's count -> FAIL if a deeper round is larger.
 *
 * Qualifying matches (event_qualification 'True', or the Slam set-count net in
 * round-classify.js) are EXCLUDED from the main-draw bracket before validation
 * — those legitimately carry word-form round labels ("Final" = qualifying final)
 * and would otherwise trip the caps.
 *
 * Output: { ok, drawSize, expectedDraw, actualMatches, expectedMatches,
 *           byes, roundCounts, violations[] }. `ok:false` => the caller MUST
 *           dash + flag this edition, never compute points from its labels.
 */

const { classifyRound } = require('./round-classify.js');

// A fixture counts toward the draw only if it was actually PLAYED to a result.
// 'Cancelled' rows are voided/rescheduled scheduling artifacts (result "-") that
// still carry a main-draw round label + event_qualification 'False', so they
// inflate round counts and must be dropped. Live in-progress states ('Set 1',
// 'Set 5', '') are not results yet. Walk Over / Retired advance a real winner
// and DO count (they still eliminate one player: the N-1 invariant holds).
const PLAYED_STATUS = new Set(['Finished', 'Retired', 'Walk Over']);
function isPlayed(fx) { return PLAYED_STATUS.has(String(fx.event_status || '').trim()); }

// deepest-first bracket order and each round's maximum match count.
const BRACKET = [
  { code: 'F',    cap: 1 },
  { code: 'SF',   cap: 2 },
  { code: 'QF',   cap: 4 },
  { code: 'R16',  cap: 8 },
  { code: 'R32',  cap: 16 },
  { code: 'R64',  cap: 32 },
  { code: 'R128', cap: 64 },
  { code: 'R256', cap: 128 },
];
const CAP = Object.fromEntries(BRACKET.map((b) => [b.code, b.cap]));
// shallow-first order (R256..F) for contiguity / monotonicity walking.
const SHALLOW_FIRST = BRACKET.map((b) => b.code).reverse();

/** Next power of two >= n (draw sizes are powers of two once byes are filled). */
function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Validate one tournament edition's main-draw round labels.
 *
 * @param {object[]} fixtures  fixtures for ONE (tournament, season). Each row:
 *        { tournament_round, event_qualification, event_final_result,
 *          event_status, isGrandSlam? }
 * @param {object}  opts
 * @param {number=} opts.drawSize   declared draw size (from the tier map / profile).
 *        If omitted, the gate infers it from the bracket and only checks self-consistency.
 * @param {boolean=} opts.completed whether the edition is finished (default true).
 *        Match-count invariant (#1) is only enforced for completed editions.
 * @returns {{ok:boolean, drawSize:?number, expectedDraw:number, actualMatches:number,
 *            expectedMatches:?number, byes:?number, roundCounts:object, violations:string[]}}
 */
function validateEdition(fixtures, opts = {}) {
  const { drawSize = null, completed = true } = opts;
  const violations = [];

  // 1) split qualifying out; keep only main-draw, non-empty-round matches.
  const main = [];
  let emptyRound = 0;
  for (const fx of fixtures) {
    if (!isPlayed(fx)) continue; // drop cancelled / live-in-progress fixtures
    const round = fx.tournament_round || '';
    if (!String(round).trim()) { emptyRound += 1; continue; } // team/RR event signal
    const cls = classifyRound({
      tournamentRound: round,
      qualification: fx.event_qualification,
      isGrandSlam: fx.isGrandSlam,
      tournamentName: fx.tournament_name,
      finalScore: fx.event_final_result,
      status: fx.event_status,
    });
    if (cls.qualifying) continue;
    main.push(cls.code);
  }

  // 2) tally round counts.
  const roundCounts = {};
  for (const code of main) roundCounts[code] = (roundCounts[code] || 0) + 1;
  const actualMatches = main.length;

  // unknown round codes (label the classifier could not resolve) are a hard fail.
  const known = new Set(BRACKET.map((b) => b.code));
  for (const code of Object.keys(roundCounts)) {
    if (!known.has(code)) violations.push(`unrecognised round label "${code}" (${roundCounts[code]}x)`);
  }

  // 3) ROUND CAP — the scramble detector.
  for (const [code, n] of Object.entries(roundCounts)) {
    if (CAP[code] != null && n > CAP[code]) {
      violations.push(`round ${code} has ${n} matches but the bracket cap is ${CAP[code]} (scrambled labels)`);
    }
  }

  // 4) CONTIGUITY — rounds present must be a gap-free run ending at F.
  const present = SHALLOW_FIRST.filter((c) => roundCounts[c] > 0);
  if (present.length) {
    const idx = present.map((c) => SHALLOW_FIRST.indexOf(c));
    const lo = Math.min(...idx), hi = Math.max(...idx);
    for (let i = lo; i <= hi; i++) {
      if (!roundCounts[SHALLOW_FIRST[i]]) violations.push(`round ${SHALLOW_FIRST[i]} missing between present rounds (gap)`);
    }
    // deepest present round should be the Final for a completed edition.
    if (completed && SHALLOW_FIRST[hi] !== 'F') {
      violations.push(`deepest round present is ${SHALLOW_FIRST[hi]}, not F (edition incomplete or corrupt)`);
    }
  }

  // 5) MONOTONICITY past the first round (first round can be small due to byes).
  const chainDeepFirst = BRACKET.map((b) => b.code).filter((c) => roundCounts[c] > 0);
  for (let i = 0; i < chainDeepFirst.length - 1; i++) {
    const deeper = roundCounts[chainDeepFirst[i]];
    const shallower = roundCounts[chainDeepFirst[i + 1]];
    if (deeper > shallower) {
      violations.push(`round ${chainDeepFirst[i]} (${deeper}) larger than shallower ${chainDeepFirst[i + 1]} (${shallower})`);
    }
  }

  // 6) infer draw size from the bracket and cross-check the declared one.
  //    a clean single-elim has N-1 matches -> N = actualMatches + 1, snapped to
  //    the smallest power of two that can seat the widest round present.
  const widest = present.length ? SHALLOW_FIRST[Math.min(...present.map((c) => SHALLOW_FIRST.indexOf(c)))] : null;
  const widestCap = widest ? CAP[widest] : 0;
  const expectedDraw = completed ? nextPow2(actualMatches + 1) : Math.max(nextPow2(widestCap * 2), 0);

  let expectedMatches = null;
  let byes = null;
  if (drawSize != null) {
    expectedMatches = drawSize - 1;
    byes = nextPow2(drawSize) - drawSize;
    if (completed && actualMatches !== expectedMatches && violations.length === 0) {
      violations.push(`completed edition has ${actualMatches} main-draw matches, expected ${expectedMatches} for a ${drawSize} draw`);
    }
  }

  if (emptyRound && actualMatches === 0) {
    // pure empty-round event (team / round-robin) — not a bracket; caller routes to dash.
    violations.push(`no round-based matches (${emptyRound} empty-round fixtures) — non-round event, route to dash`);
  }

  return {
    ok: violations.length === 0,
    drawSize,
    expectedDraw,
    actualMatches,
    expectedMatches,
    byes,
    roundCounts,
    violations,
  };
}

module.exports = { validateEdition, nextPow2, CAP, BRACKET, isPlayed };
