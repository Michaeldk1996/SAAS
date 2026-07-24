'use strict';

/**
 * config.js — Central tuning file for the H2H betting model.
 *
 * IMPORTANT (per CLAUDE.md rule: "Do not invent or approximate the value
 * methodology — ask Michael"): every weight/magnitude in this file is a
 * CALIBRATION PLACEHOLDER. They are deliberately centralised, named, and
 * documented here so Michael can tune them against backtests. They are NOT
 * a hidden secret-sauce claim — they are honest starting values that make
 * the plumbing testable end-to-end.
 *
 * Units:
 *  - All `maxMagnitude` values are in *probability points* (0.05 = 5%).
 *    Each adjustment produces a signed signal in [-1, +1] (from p1's point
 *    of view) and contributes `signal * maxMagnitude` to p1's probability.
 *  - Stage-1 blend weights are fractions that sum to 1.0.
 */

module.exports = {
  // ---- Stage 1: base probability blend --------------------------------
  // baseP1 = w.raw*eloRaw + w.surface*eloSurface + w.blend*elo5050
  //   eloRaw     : overall ELO win prob
  //   eloSurface : surface-specific ELO win prob
  //   elo5050    : 50/50 blend of raw+surface (stabiliser)
  eloBlend: {
    raw: 0.30,
    surface: 0.40,
    blend: 0.30,
  },

  // ELO divisor in the logistic (standard chess/tennis ELO = 400)
  eloDivisor: 400,

  // ---- Stage 1 (Model v2.0 STEP 2): three-state market-anchored base ----
  // Replaces the Elo-only base with a market-anchored blend. elo.js stays
  // PURE (it exposes the component win-probs); model.js selects the state and
  // does the blend using these tables. Each state's weights sum to 1.0.
  // Inputs (all P(p1 wins)):
  //   blendedElo = elo5050  (50% overall + 50% surface ratings — a stabiliser)
  //   surfaceElo = surface-specific ELO standalone
  //   market     = vig-free implied prob of the state's anchor book
  // State selection (model.js): State 2 if a Pinnacle line exists (frozen
  // opening preferred), else State 1 if any alternative book has a clean
  // pre-match line, else State 3 (Elo-only).
  baseState: {
    state1: { blendedElo: 0.30, surfaceElo: 0.30, market: 0.40 }, // alt-book anchor
    state2: { blendedElo: 0.25, surfaceElo: 0.25, market: 0.50 }, // Pinnacle confirmed
    state3: { blendedElo: 0.50, surfaceElo: 0.50, market: 0.00 }, // Elo-only
    flags: {
      1: '⚠️ Temporary base — alternative book anchor, awaiting Pinnacle line',
      2: '✅ Full blended base active — Pinnacle anchor confirmed',
      3: '⚠️ Elo-only base — no market anchor available. Treat with caution.',
    },
  },
  // Book anchoring. Pinnacle is the State-2 (primary) anchor; State 1 uses the
  // first available NON-Pinnacle book in `alternatives`, left to right. The
  // strings are the EXACT oddsMovement.books keys written by
  // refresh-odds-history.py's BOOK_LABELS (note 'bet365' is lowercase and
  // 'William Hill' has a space — a wrong case would silently disable State 1).
  // Founder decision 2026-07-24: amended to books we actually capture
  // (Sbobet/Betfair are NOT captured; add later if the provider supplies them).
  marketAnchorBooks: {
    pinnacle: 'Pinnacle',
    alternatives: ['bet365', 'William Hill', '1xBet', 'Betano', 'Betsson'],
  },

  // ---- Stage 2 dampening by base state (Model v2.0 STEP 3) ----
  // Statistical layers the market already prices are dampened to avoid
  // double-counting the market signal. Multiplier applied to each layer's
  // final deltaP1 BEFORE it enters the adjustment sum, keyed by layer id then
  // base state (1/2/3). Layers not listed here run at full magnitude in every
  // state. State 3 (no market) is always ×1.0 — nothing to double-count.
  layerDampening: {
    4:  { 1: 0.70, 2: 0.50, 3: 1.0 },   // #4  surface record
    5:  { 1: 0.70, 2: 0.50, 3: 1.0 },   // #5  recent form
    7:  { 1: 0.70, 2: 0.50, 3: 1.0 },   // #7  quality form
    9:  { 1: 0.70, 2: 0.50, 3: 1.0 },   // #9  serve strength
    10: { 1: 0.70, 2: 0.50, 3: 1.0 },   // #10 return / pressure
  },

  // ---- Stage 2: adjustment magnitudes (probability points) ------------
  // Ordered by the brief's weight hierarchy (highest influence first).
  // `gated: true` means the data source is not reliable/available yet
  // (see feasibility report) — the adjustment is stubbed and contributes 0
  // until Michael supplies the missing input.
  adjustments: {
    // 1. Style matchup — archetype vs archetype (matchup-matrix.json)
    styleMatchup:   { id: 1,  maxMagnitude: 0.10, gated: false },
    // 2. Subjective input — Michael's manual read (passthrough, default 0)
    subjective:     { id: 2,  maxMagnitude: 0.10, gated: false },
    // 3. H2H record — career head-to-head balance
    //    (calibrated 2026-07 from 0.05 -> 0.03: logistic fit on 42.6k Sackmann
    //     matches gave a significant (z=2.8) but ~half-size effect vs the guess.)
    h2h:            { id: 3,  maxMagnitude: 0.03, gated: false },
    // 4. Surface record — career win% on the match surface
    surface:        { id: 4,  maxMagnitude: 0.05, gated: false },
    // 5. Recent form — last-N results (all levels incl. Challenger/ITF)
    recentForm:     { id: 5,  maxMagnitude: 0.04, gated: false },
    // 6. [REMOVED in Model v2.0] Round / stage performance — deleted per the
    //    Stennisfy v2.0 rebuild (Step 1). Layer id 6 is retired; the id is not
    //    reused so historical output remains comparable.
    // 7. Quality-adjusted recent form — top-50 form vs overall form + top-20
    //    wins on this surface. Uses opponent CURRENT rank resolved via
    //    player-profiles (proxy for match-day rank).
    qualityForm:    { id: 7,  maxMagnitude: 0.04, gated: false,
                      signal2Weight: 0.30 },  // secondary "big wins on surface" weight
    // 8. W/UE ratio — api-tennis feed unreliable; activates ONLY when Michael
    //    supplies values in h2h-model/manual-inputs.json (else stays inert).
    winnerUE:       { id: 8,  maxMagnitude: 0.02, gated: true,
                      gateReason: 'api-tennis W/UE not reliable yet; awaiting manual-inputs.json or big-tournament feed' },
    // 9. Serve strength — momentum-weighted 4-tier blend (this-tournament >
    //    last-3-on-surface > season-on-surface > career-on-surface).
    //    Deliberate 0.035 override (2026-07): the Sackmann/backtest fit trims
    //    serve to ~0.02 because it can only see diluted career serve; it cannot
    //    reconstruct the live tier-1/tier-2 tournament-specific serve the model
    //    now uses. The live signal is sharper (recent, surface- and event-
    //    specific), so we override the fitted magnitude back up. See serve() in
    //    adjustments.js and the note in calibrate.js.
    serve:          { id: 9,  maxMagnitude: 0.035, gated: false },
    // 10. Return / pressure — career return% + break% + return radar
    returnPressure: { id: 10, maxMagnitude: 0.02, gated: false },
    // 11. Fatigue — 14-day match/set load from recent form dates
    fatigue:        { id: 11, maxMagnitude: 0.02, gated: false },
    // 12. Weather / conditions — heat & wind vs style
    weather:        { id: 12, maxMagnitude: 0.03, gated: false },
    // 13. Format split — Bo3 vs Bo5 career win%
    formatSplit:    { id: 13, maxMagnitude: 0.03, gated: false },
    // 14. [REMOVED in Model v2.0] Court speed / altitude — deleted per the
    //    Stennisfy v2.0 rebuild (Step 1). Layer id 14 is retired (id not reused).
    //    The court-speed DATA field (m.courtSpeed) and its dashboard environment
    //    display are unaffected — only the model adjustment layer is gone. The
    //    altitudeMeters table below is retained for the future #9/#10 redesign.
    // 15. Clutch ("Under pressure") rating — clutch-rating.json index.
    //     Model v2.0 Phase-0: flat 3pp cap (was 2pp), no surface/altitude
    //     modifier. clutchIndex is a 0-100 pool-percentile, so `divisor` = 94
    //     (the widest REAL spread ~94) makes that extreme land at exactly the
    //     full 3pp cap; smaller gaps scale below it. Old /40 saturated any 40-pt
    //     gap to full. (Founder spec: div 94 so the max real gap reaches 3pp.)
    clutch:         { id: 15, maxMagnitude: 0.03, gated: false, divisor: 94 },
    // 16/17. Odds market movement — opening vs current (lowest influence).
    //     (H2H trend removed 2026-07 per review: redundant with H2H record #3.)
    //     Model v2.0 Phase-0 #17 upgrade: the raw Pinnacle vig-free shift is now
    //     sharpened by four honest filters before it contributes. Magnitude cap
    //     raised 0.015 -> 0.03 (3pp) per founder spec 2026-07-23: the sharpened
    //     signal earns the same 3pp headroom as clutch #15. The four filters below
    //     still gate WHEN it fires; the cap only bounds HOW FAR a confirmed move
    //     can push the price:
    //       (1) move-size threshold — a vig-free move under `minMove` is book
    //           noise and contributes 0 (dead-zone); above it, scaled to
    //           saturate at `fullMove`.
    //       (2) timing weight — a move that lands LATE (within `lateWindowHours`
    //           of the scheduled start) is sharper than early opening drift;
    //           an all-early move is discounted to `timingFloor`.
    //       (3) steam detection — cross-book agreement: when >= `steamMinBooks`
    //           books move the same direction it's steam (full weight); a lone
    //           Pinnacle move is discounted to `steamLoneMult`, partial to
    //           `steamMidMult`.
    //       (4) ATP-level gate — the layer is gated (contributes 0) below ATP
    //           main-tour level, where the market is too thin to trust.
    //     A missing pre-match line is surfaced as an explicit no-line flag
    //     (res.noLine) rather than a fake 0-move.
    //     DATA-BLOCKED: reverse-line-move (price moves opposite the public
    //     betting %) is NOT built — it needs public-betting/ticket %, which no
    //     feed we license carries. It is left as an honest gap, not faked.
    oddsMovement:   { id: 17, maxMagnitude: 0.03, gated: false,
                      minMove: 0.015,        // vig-free dead-zone (1.5pp)
                      fullMove: 0.08,        // vig-free move that saturates raw signal (8pp)
                      timingFloor: 0.6,      // weight when the whole move is at the open
                      lateWindowHours: 12,   // "late" = within this many hours of start
                      steamMinBooks: 3,      // books that must agree to confirm steam
                      steamLoneMult: 0.5,    // discount when only Pinnacle moved
                      steamMidMult: 0.8,     // discount for partial cross-book agreement
                      reverseLineMove: { available: false,
                        reason: 'needs public-betting/ticket %; no licensed feed carries it' } },
  },

  // Final clamp on adjusted probability so no single match is called a lock.
  // probFloor/probCeil are the *baseline* clamp; probCeilBothTop50 /
  // probCeilOneTop50 are the rank-tier ceilings applied on top (see model.js).
  probFloor: 0.05,
  probCeil: 0.98,
  // ---- Rank-tier probability ceiling (Model v2.0 Phase-0) ----
  // Stacked adjustment layers can push a win-prob high enough to manufacture
  // false market value. Cap the FAVOURITE (either side) by how strong the two
  // players' current ranks are. rankTierCutoff = the "top-N" boundary.
  //   both players in top-N        -> probCeilBothTop50 (elite vs elite is
  //                                    rarely a >85% lock)
  //   exactly one outside top-N    -> probCeilOneTop50
  //   both outside top-N           -> no tier cap; baseline probCeil applies
  rankTierCutoff: 50,
  probCeilBothTop50: 0.85,
  probCeilOneTop50: 0.90,

  // ---- Combined live-signal cap (Model v2.0 Phase-0) ----
  // Layers #8 (W/UE), #9 (serve) and #12 (weather) are "live reads": their
  // magnitudes sum to 8.5pp, so stacked they could move the price more than the
  // evidentiary weight of one strong in-match signal warrants. Their COMBINED
  // deltaP1 is clipped to +/- liveSignalCap BEFORE it enters the model; the
  // other 11 layers are untouched. Clip (not per-layer rescale) because only the
  // summed contribution feeds the price. Layers keyed by retained id, so this
  // stays correct regardless of display order.
  liveSignalCap: 0.07,
  liveSignalCapLayerIds: [8, 9, 12],

  // ---- Stage 3: value detection --------------------------------------
  value: {
    // Edge = fairProb - marketImplied (vig-removed). Flag thresholds:
    sharpEdge: 0.03,   // >= 3% edge vs Pinnacle (vig-removed) => Sharp Value
    softEdge: 0.05,    // >= 5% edge vs best soft book price   => Soft Book Value
    // Books treated as "sharp" for the fair-market reference
    sharpBooks: ['Pinnacle', 'Pncl'],
  },

  // ---- Stage 4: AI match summary (Claude) ----------------------------
  // Optional layer. It NEVER runs inside runModel() (that stays pure/sync).
  // summary.js reads these + ANTHROPIC_API_KEY from the environment and
  // no-ops cleanly when the key or SDK is absent (R&D-safe: the engine runs
  // with or without it). No key is ever hard-coded here.
  summary: {
    enabled: true,               // master switch (still requires a key at runtime)
    model: 'claude-opus-4-6',    // default per platform guidance
    maxTokens: 700,              // a summary is short; keep spend low
    thinking: 'adaptive',        // 'adaptive' | 'off' — adaptive for nuanced reads
    // How many of the strongest applied adjustments to hand the model.
    topAdjustments: 6,
    // Env var names (documented so Michael can see exactly what is read).
    apiKeyEnv: 'ANTHROPIC_API_KEY',
  },

  // ---- Misc ----------------------------------------------------------
  // Tours played best-of-5 (Grand Slams). Everything else Bo3.
  bestOf5Tours: ['Australian Open', 'Roland Garros', 'French Open', 'Wimbledon', 'US Open'],

  // Venue altitude reference (metres above sea level) — factual geographic
  // data. The court-speed/altitude adjustment layer that consumed this was
  // removed in Model v2.0 (Step 1); this table is retained for the planned
  // #9/#10 surface-speed × altitude redesign. Keyed by a substring of the
  // tournament name (case-insensitive). Used two ways: (a) if matches.json has
  // no courtSpeed.altitude for the current match, look it up here; (b) to score
  // a player's historical win-rate at high-altitude events (>350 m) from their
  // recent-form tournament names. Extend this list as Michael confirms venues —
  // only add real, verifiable altitudes here (never a guess).
  altitudeMeters: {
    'quito': 2850,
    'bogota': 2640,
    'gstaad': 1050,
    'kitzbuhel': 762,
    'kitzbühel': 762,
    'sao paulo': 760,
    'madrid': 667,
    'santiago': 570,
    'munich': 520,
    'marrakech': 466,
    'cordoba': 425,
  },
  // Altitude threshold (metres) at/above which a venue is treated as "altitude"
  // and the altitude-affinity dimension of the court-speed layer activates.
  altitudeThresholdM: 350,

  // Recent-form window sizes
  recentFormN: 5,       // last-5 for the form signal
  fatigueWindowDays: 14, // rolling load window

  // Market reference: matches.json `time` is VENUE-LOCAL. To find the
  // pre-match (closing) Pinnacle line we only trust ticks at/before the
  // scheduled start. This buffer (hours) is subtracted from the start parsed
  // as UTC to absorb the local->UTC offset for European venues (+1/+2), so we
  // never pick up in-play ticks. Tune if non-European tours are added.
  marketCutoffBufferHours: 3,
  // Backstop: reject a "current" tick whose vig-free prob has moved more than
  // this from the opening — a pre-match line essentially never moves this far,
  // so such a jump means the tick is in-play.
  maxPreMatchMove: 0.35,
};
