'use strict';

/**
 * model.js — orchestrator.
 *
 * runModel(match, opts) runs the full green pipeline for one match record:
 *   Stage 1  base probability from ELO
 *   Stage 2  14 adjustment layers (13 green, 1 gated: #8 W/UE)
 *            [Model v2.0 Step 1: #6 round-stage and #14 court-speed removed.]
 *   Stage 3  fair price + value flags
 *
 * It returns a single structured object (no console output, no UI) so it can
 * be reviewed, tested, or later wired into the dashboard / AI-summary stage.
 *
 * NOTE: Stage 4 (Claude AI match summary) is intentionally kept OUT of this
 * orchestrator so runModel() stays pure and synchronous (no network calls). It
 * lives in summary.js as an optional async layer that consumes this result and
 * calls Claude; it no-ops cleanly when ANTHROPIC_API_KEY / the SDK is absent.
 * Run it via `node run.js --summary <id>`.
 */

const config = require('./config');
const data = require('./data');
const { baseProbability } = require('./elo');
const { runAll, clamp } = require('./adjustments');
const { priceAndValue } = require('./price');

function inferBestOf(match) {
  const tour = String(match.tour || '');
  const isGS = config.bestOf5Tours.some(t => tour.toLowerCase().includes(t.toLowerCase()));
  return isGS ? 5 : 3;
}

/**
 * @param {object} match  a matches.json record (has p1Key/p2Key, odds, etc.)
 * @param {object} [opts] { subjectiveSignal?: number in [-1,1] }
 */
function runModel(match, opts = {}) {
  const p1 = data.resolvePlayer(match.p1Key, match.p1);
  const p2 = data.resolvePlayer(match.p2Key, match.p2);
  const surface = match.surface;
  const bestOf = inferBestOf(match);

  // ---- Stage 1 ----
  const stage1 = baseProbability(p1, p2, surface);
  if (!stage1.ok) {
    return {
      ok: false,
      reason: stage1.note,
      match: matchMeta(match, bestOf),
      players: { p1: playerMeta(p1), p2: playerMeta(p2) },
    };
  }

  // ---- Stage 2 ----
  const ctx = {
    p1, p2, match, surface, bestOf,
    subjectiveSignal: opts.subjectiveSignal,
    matchupMatrix: data.loadMatchupMatrix(),
    progression: data.loadProgression(),      // Tier-1 serve (this tournament)
    historicalStats: data.loadHistoricalStats(), // Tier-2 serve (last-3 on surface)
  };
  const adjustments = runAll(ctx);

  const totalDelta = adjustments.reduce((s, a) => s + (a.applied ? a.deltaP1 : 0), 0);
  const baselineP1 = clamp(stage1.baseP1 + totalDelta, config.probFloor, config.probCeil);

  // Rank-tier probability ceiling (Model v2.0 Phase-0). Cap the FAVOURITE on
  // whichever side it lands, so the ceiling holds whether p1 or p2 is stronger:
  // clamp to [1 - tierCeil, tierCeil]. Unknown rank (no profile/elo row — a
  // lower-tier player the sources don't cover) counts as OUTSIDE the top tier,
  // never as elite, so mid/low matches keep the loose 0.98 ceiling.
  const p1Rank = rankOfPlayer(p1);
  const p2Rank = rankOfPlayer(p2);
  const tierCeil = tierProbCeil(p1Rank, p2Rank, config);
  const adjustedP1 = clamp(baselineP1, 1 - tierCeil, tierCeil);

  // ---- Stage 3 ----
  const pricing = priceAndValue(adjustedP1, match);

  const appliedCount = adjustments.filter(a => a.applied).length;
  const gatedCount = adjustments.filter(a => a.gated).length;

  return {
    ok: true,
    match: matchMeta(match, bestOf),
    players: { p1: playerMeta(p1), p2: playerMeta(p2) },
    stage1: {
      baseP1: round4(stage1.baseP1),
      baseP2: round4(1 - stage1.baseP1),
      components: stage1.components,
      note: stage1.note,
    },
    stage2: {
      adjustments,
      totalDeltaP1: round4(totalDelta),
      adjustedP1: round4(adjustedP1),
      adjustedP2: round4(1 - adjustedP1),
      appliedCount,
      gatedCount,
      rankCeil: {
        p1Rank, p2Rank,
        cutoff: config.rankTierCutoff,
        ceil: tierCeil,
        clamped: round4(adjustedP1) !== round4(baselineP1),
      },
    },
    stage3: pricing,
    meta: {
      generatedAt: new Date().toISOString(),
      greenModel: true,
      pendingWarnings: adjustments.filter(a => a.gated).map(a => ({ id: a.id, name: a.name, reason: a.detail }))
        .concat([{ id: 'stage4', name: 'AI match summary', reason: 'built (summary.js) — optional layer, run with --summary; needs ANTHROPIC_API_KEY' }]),
    },
  };
}

function matchMeta(match, bestOf) {
  return {
    id: match.id,
    p1: match.p1, p2: match.p2,
    surface: match.surface,
    tour: match.tour,
    round: match.tournamentRound,
    bestOf,
    date: match.date,
  };
}

function playerMeta(p) {
  return {
    name: p.fullName,
    key: p.numericKey,
    eloKey: p.eloKey,
    archetype: p.style && p.style.primary || null,
    eloAll: p.elo && p.elo.all && p.elo.all.rating || null,
    sources: {
      elo: Boolean(p.elo), splits: Boolean(p.splits), profile: Boolean(p.profile),
      clutch: Boolean(p.clutch), radar: Boolean(p.radar), style: Boolean(p.style),
    },
  };
}

function round4(x) { return Math.round(x * 1e4) / 1e4; }

// Current-rank proxy for a resolved player bundle: profile rank first (only
// covers ~current-slate players), then elo-ratings overall rank (wider tail).
// Returns null when neither source knows the player — never fabricated.
function rankOfPlayer(p) {
  const pr = p && p.profile && p.profile.rank;
  if (typeof pr === 'number' && isFinite(pr)) return pr;
  const er = p && p.elo && p.elo.all && p.elo.all.rank;
  if (typeof er === 'number' && isFinite(er)) return er;
  return null;
}

// Rank-tier ceiling for the favourite. Null/unknown rank => treated as OUTSIDE
// the top tier (a lower-tier player the sources don't cover), so it never
// tightens a mid/low-tier match. Avoids the `null <= 50` coercion trap.
function tierProbCeil(r1, r2, config) {
  const cutoff = config.rankTierCutoff;
  const inTop = (r) => typeof r === 'number' && isFinite(r) && r <= cutoff;
  const t1 = inTop(r1), t2 = inTop(r2);
  if (t1 && t2) return config.probCeilBothTop50;      // both elite
  if (t1 !== t2) return config.probCeilOneTop50;      // exactly one outside
  return config.probCeil;                             // both outside -> baseline
}

module.exports = { runModel, inferBestOf };
