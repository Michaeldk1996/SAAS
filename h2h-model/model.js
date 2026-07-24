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
const { priceAndValue, vigFree, pinnacleSeries, bookSeries } = require('./price');

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

  // ---- Stage 1 (Model v2.0 STEP 2): three-state market-anchored base ----
  // elo.js stays pure — it returns the component win-probs; the state
  // selection + market blend live here, where the odds are already in scope.
  const stage1 = baseProbability(p1, p2, surface);
  if (!stage1.ok) {
    return {
      ok: false,
      reason: stage1.note,
      match: matchMeta(match, bestOf),
      players: { p1: playerMeta(p1), p2: playerMeta(p2) },
    };
  }
  const blendedElo = stage1.components.elo5050.p1;    // 50/50 overall+surface
  const surfaceElo = stage1.components.eloSurface.p1; // surface standalone
  const anchor = selectMarketAnchor(match);           // {state, market, book, flag,...}
  const bw = config.baseState['state' + anchor.state];
  // State 3 carries market weight 0 (weights still sum to 1: 0.5+0.5), so a
  // null market never enters the sum.
  const baseP1 = bw.blendedElo * blendedElo
               + bw.surfaceElo * surfaceElo
               + (anchor.state === 3 ? 0 : bw.market * anchor.market);

  // ---- Stage 2 ----
  const ctx = {
    p1, p2, match, surface, bestOf,
    subjectiveSignal: opts.subjectiveSignal,
    matchupMatrix: data.loadMatchupMatrix(),
    progression: data.loadProgression(),      // Tier-1 serve (this tournament)
    historicalStats: data.loadHistoricalStats(), // Tier-2 serve (last-3 on surface)
  };
  const adjustments = runAll(ctx);

  // ---- Layer dampening by base state (Model v2.0 STEP 3) ----
  // Statistical layers the market already prices (#4/#5/#7/#9/#10) are dampened
  // to avoid double-counting the market anchor. Multiply the layer's final
  // deltaP1 by the state factor BEFORE it enters any sum; record the pre-damp
  // value so the displayed contribution is the real (dampened) one and the bars
  // still sum to the total. State 3 (no market) is ×1.0, so nothing changes.
  const dampMap = config.layerDampening;
  let dampenedCount = 0;
  for (const a of adjustments) {
    const f = a.applied && dampMap[a.id] ? dampMap[a.id][anchor.state] : null;
    if (f != null && f !== 1) {
      a.dampening = { state: anchor.state, factor: f, rawDeltaP1: a.deltaP1 };
      a.deltaP1 = round4(a.deltaP1 * f);
      dampenedCount++;
    }
  }

  // Combined live-signal cap (Model v2.0 Phase-0). Layers #8 (W/UE), #9 (serve)
  // and #12 (weather) are "live reads"; clip their COMBINED deltaP1 to
  // +/- config.liveSignalCap before summing, so together they can never move the
  // price more than one strong signal. The other layers pass through untouched.
  // Runs AFTER dampening (spec: "Cap applies after layer dampening") so the
  // capped total reflects the dampened #9 serve contribution.
  const liveIds = config.liveSignalCapLayerIds;
  const rawLiveDelta = adjustments.reduce(
    (s, a) => s + (a.applied && liveIds.includes(a.id) ? a.deltaP1 : 0), 0);
  const cappedLiveDelta = clamp(rawLiveDelta, -config.liveSignalCap, config.liveSignalCap);
  const nonLiveDelta = adjustments.reduce(
    (s, a) => s + (a.applied && !liveIds.includes(a.id) ? a.deltaP1 : 0), 0);
  const totalDelta = nonLiveDelta + cappedLiveDelta;
  const baselineP1 = clamp(baseP1 + totalDelta, config.probFloor, config.probCeil);

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
      baseP1: round4(baseP1),
      baseP2: round4(1 - baseP1),
      components: stage1.components,
      note: stage1.note,
      // Model v2.0 STEP 2: which of the three base states priced this match.
      baseState: {
        state: anchor.state,
        flag: anchor.flag,
        anchorBook: anchor.book,
        marketProb: anchor.market != null ? round4(anchor.market) : null,
        anchorPrice: anchor.anchorPrice || null,
        pinnacleFrozen: anchor.frozen || false,
        weights: bw,
        eloOnlyP1: round4(0.5 * blendedElo + 0.5 * surfaceElo),
      },
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
      liveCap: {
        layerIds: liveIds,
        cap: config.liveSignalCap,
        rawDeltaP1: round4(rawLiveDelta),
        cappedDeltaP1: round4(cappedLiveDelta),
        clamped: round4(cappedLiveDelta) !== round4(rawLiveDelta),
      },
      // Model v2.0 STEP 3: how many statistical layers were dampened, and at
      // what state level, so the double-counting guard is auditable per match.
      dampening: {
        state: anchor.state,
        layerIds: Object.keys(dampMap).map(Number),
        appliedCount: dampenedCount,
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

// ---- Model v2.0 STEP 2: market-anchor selection --------------------------
// Pick the base state and its market anchor from the match's odds:
//   State 2  Pinnacle line exists (frozen official opening preferred; else the
//            live opening tick) — the primary, most-trusted anchor.
//   State 1  no Pinnacle yet, but an alternative sharp book has a clean
//            pre-match line (first available in config order).
//   State 3  no book has a line — Elo-only.
// vig-free implied prob is always used (never raw implied), per spec.
function pinnacleAnchor(match) {
  // Frozen official opening line wins — written once by the pipeline and never
  // recomputed, so the anchor never drifts run-to-run (founder decision 2026-07-24).
  const fr = match.pinnacleOpen;
  if (fr && fr.p1 > 1 && fr.p2 > 1) {
    const vf = vigFree(fr.p1, fr.p2);
    if (vf) return { p1: fr.p1, p2: fr.p2, vfP1: vf.p1, ts: fr.ts || null, frozen: true };
  }
  // Fallback for standalone runs / matches not yet frozen: the live Pinnacle
  // opening tick (de-facto opening; not persisted).
  const s = pinnacleSeries(match);
  if (s && s.opening) {
    const vf = vigFree(s.opening.p1, s.opening.p2);
    if (vf) return { p1: s.opening.p1, p2: s.opening.p2, vfP1: vf.p1, ts: null, frozen: false };
  }
  return null;
}

function selectMarketAnchor(match) {
  const cfg = config.marketAnchorBooks;
  const flags = config.baseState.flags;
  const pin = pinnacleAnchor(match);
  if (pin) {
    return {
      state: 2, market: pin.vfP1, book: cfg.pinnacle,
      anchorPrice: { p1: pin.p1, p2: pin.p2, ts: pin.ts },
      frozen: pin.frozen, flag: flags[2],
    };
  }
  for (const book of cfg.alternatives) {
    const s = bookSeries(match, book);
    if (s && s.opening && s.opening.vfP1 != null) {
      return {
        state: 1, market: s.opening.vfP1, book,
        anchorPrice: { p1: s.opening.p1, p2: s.opening.p2, ts: s.opening.ts || null },
        frozen: false, flag: flags[1],
      };
    }
  }
  return { state: 3, market: null, book: null, anchorPrice: null, frozen: false, flag: flags[3] };
}

module.exports = { runModel, inferBestOf, selectMarketAnchor };
