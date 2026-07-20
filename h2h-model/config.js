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
    // 6. Round / stage performance — stage over/underperformance vs a player's
    //    OWN overall win% at the specific round this match is (R128..F). Uses
    //    the extended career-splits round categories; abstains when the round
    //    is unknown or the per-round sample is too thin.
    //    (calibrated 2026-07 from 0.03 -> 0.016: significant (z=2.4) on the
    //     Sackmann fit, about half the original placeholder.)
    roundStage:     { id: 6,  maxMagnitude: 0.016, gated: false,
                      minRoundM: 5,        // need >=5 career matches at this round per player
                      fullDampM: 15 },     // sample at/above which the signal is undamped
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
    // 14. Court speed — fast/slow vs style fit
    courtSpeed:     { id: 14, maxMagnitude: 0.015, gated: false },
    // 15. Clutch rating — clutch-rating.json index
    clutch:         { id: 15, maxMagnitude: 0.02, gated: false },
    // 16. H2H trend — recency-weighted head-to-head direction
    h2hTrend:       { id: 16, maxMagnitude: 0.015, gated: false },
    // 17. Odds market movement — opening vs current (lowest influence)
    oddsMovement:   { id: 17, maxMagnitude: 0.015, gated: false },
  },

  // Final clamp on adjusted probability so no single match is called a lock
  probFloor: 0.02,
  probCeil: 0.98,

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
    // Five paragraphs of 2-3 sentences, and with thinking:'adaptive' the
    // thinking tokens are drawn from this same budget. The old 700 was sized
    // for the 3-5 sentence note and would truncate the five-paragraph one
    // mid-sentence (a short stop_reason:'max_tokens' body, not an error).
    maxTokens: 2000,
    thinking: 'adaptive',        // 'adaptive' | 'off' — adaptive for nuanced reads
    // How many of the strongest applied adjustments to hand the model.
    topAdjustments: 6,
    // Env var names (documented so Michael can see exactly what is read).
    apiKeyEnv: 'ANTHROPIC_API_KEY',
  },

  // ---- Misc ----------------------------------------------------------
  // Tours played best-of-5 (Grand Slams). Everything else Bo3.
  bestOf5Tours: ['Australian Open', 'Roland Garros', 'French Open', 'Wimbledon', 'US Open'],

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
