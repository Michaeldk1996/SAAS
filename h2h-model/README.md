# H2H Betting Model — engine (green build)

Feasibility-first engine for the Head-to-Head model. It turns ELO into a fair
win probability, applies 17 weighted adjustment layers from the **real pipeline
data only**, produces a fair price, and compares it to Pinnacle (sharp) + the
best soft-book price to flag value. **No UI, no fabricated data** — missing
inputs no-op rather than being approximated (per `CLAUDE.md`).

Stage 4 (Claude AI match summary) is now built as an **optional, key-gated**
layer in `summary.js` — it stays out of `runModel()` so the engine remains pure
and offline. See _Stage 4_ below.

---

## Run it

```bash
node h2h-model/run.js                 # first upcoming match
node h2h-model/run.js <matchId>       # e.g. past-12147290
node h2h-model/run.js "Rublev" "Tabilo"
node h2h-model/run.js --list 20       # scoreboard of N matches
node h2h-model/run.js --json <id>     # full structured object
node h2h-model/run.js --subj <id> 0.3 # inject a subjective signal (-1..1)
node h2h-model/run.js --summary <id>  # also print the Stage 4 AI summary
```

`runModel(match, opts)` in `model.js` returns a structured object (`stage1`,
`stage2`, `stage3`, `meta`) with no console output — that is the integration
point for the dashboard / AI summary later.

---

## Pipeline

**Stage 1 — base probability** (`elo.js`)
Blend of three ELO estimates (weights in `config.eloBlend`):
`0.30·raw + 0.40·surface + 0.30·(50/50 stabiliser)`, logistic divisor 400.
If either player has no overall ELO the match is skipped (never forced to 0.5).

**Stage 2 — 17 adjustments** (`adjustments.js`)
Each returns a signed signal in `[-1,+1]` from p1's view and contributes
`signal × maxMagnitude` probability points. Surface/serve/return/format are
written **relative to each player's own baseline** so they add texture ELO
can't see rather than double-counting skill ELO already saw.

**Stage 3 — fair price & value** (`price.js`)
Fair odds = `1/prob`. Sharp reference = Pinnacle vig-free two-way. Soft
reference = best available book price. Flags:
`Sharp Value` when `fairProb − pinnacleVigFree ≥ 3%`;
`Soft Book Value` when `fairProb − softImplied ≥ 5%`.

---

## Adjustment status (17 layers)

| # | Layer | Status | Source | Notes |
|---|---|---|---|---|
| 1 | Style matchup | 🟢 | matchup-matrix.json | archetype vs archetype; needs `minSampleN` |
| 2 | Subjective input | 🟢 | manual (opts) | passthrough, default neutral |
| 3 | H2H record | 🟢 | matches.json:h2h | sample-damped |
| 4 | Surface record | 🟢 | player-profiles:kpis | surface win% **vs own baseline** |
| 5 | Recent form | 🟢 | player-profiles:recentForm | last-5, incl. Challenger/ITF |
| 6 | Round / stage | 🟢 | career-splits.json:rounds | stage win% vs own baseline; **see Adjustment 6** |
| 7 | Quality-adjusted form | 🟢 | recentForm + rank | **see Adjustment 7** |
| 8 | Winner / UE ratio | 🔴 gated | manual-inputs.json | inert until Michael supplies W/UE |
| 9 | Serve strength | 🟢 | style-radar → career fallback | radar only when `ok:true` |
| 10 | Return / pressure | 🟢 | style-radar → career fallback | radar only when `ok:true` |
| 11 | Fatigue (14d load) | 🟢 | recentForm dates | sets played in window |
| 12 | Weather / conditions | 🟢* | matches:weather + radar | *needs reliable radar for both |
| 13 | Format split Bo3/Bo5 | 🟢 | career-splits.json | needs 10+ in both formats |
| 14 | Court speed | 🟢* | matches:courtSpeed + radar | *needs reliable radar for both |
| 15 | Clutch rating | 🟢 | clutch-rating.json | clutch-index gap |
| 16 | H2H trend | 🟢 | matches:h2h | recency-weighted direction |
| 17 | Odds market movement | 🟢 | matches:oddsMovement | Pinnacle open→current, **cleaned** |

🟢 green (runs on real data) · 🟢* green but abstains when the style radar is
unreliable (`ok:false`, thin charting) · 🔴 gated (data not usable yet).

**Every magnitude in `config.js` is a labelled CALIBRATION PLACEHOLDER**, not a
tuned secret sauce. They are centralised so Michael can backtest and tune them.

---

## Data-hygiene fixes baked in

1. **Style radar reliability** — `style-radar.json` rows for thinly-charted
   players carry `ok:false` and near-random percentiles. The resolver only
   surfaces `radar` when `ok===true`; serve/return then fall back to career
   split %, and weather/court-speed abstain rather than trust noise.

2. **Pinnacle in-play / settlement contamination** — the `oddsMovement` series
   mixes pre-match, in-play and settlement ticks (a settled favourite shows
   ~1.02 vs a loser ballooning to 20–70+). `pinnacleSeries()` keeps only ticks
   that are (a) a sane two-way overround, (b) at/before the scheduled start
   minus a venue-local buffer (`marketCutoffBufferHours`), and (c) within
   `maxPreMatchMove` of the opening. This dropped base MAE vs Pinnacle from
   **15.9% → 5.6%**.

3. **Opponent rank resolution (Adjustment 7)** — `rankOf()` is two-tier:
   numeric key → `player-profiles` (only ~current-slate players), then a name
   fallback → `"lastname|initial"` → `elo-ratings.json` `.all.rank` (covers
   ~540 players). Without tier 2, historical recent-form opponents resolved to
   `null` and Adjustment 7 never fired.

---

## Adjustment 6 — round / stage performance

- `tools/build-career-splits.js` was extended with four early-round categories
  (Round of 16/32/64/128; 1/8=R16, 1/16=R32, 1/32=R64, 1/64=R128). Regeneration
  is deterministic from the warm TA cache and **purely additive** — every
  existing category row is byte-identical (20,448 cells diffed, 0 changes), so
  the dashboard's existing rows are untouched and simply gain new round rows
  (zero-match rows auto-hide).
- Signal: each player's win% at **this match's round** minus their **own overall
  win%** (`kpis.All`). Relative-to-self, so it adds stage temperament without
  re-counting the skill ELO already saw. Damped by the smaller per-round sample
  (`fullDampM`); abstains when the round is unidentifiable or a player has fewer
  than `minRoundM` matches at that round.

## Adjustment 7 — quality-adjusted recent form

- **Signal 1 (primary):** last-10 win rate **vs top-50 opponents** minus the
  overall last-10 win rate. Rewards beating quality; discounts a record padded
  against low-ranked players. Needs ≥2 top-50 games to be confident, else a
  mild discount on soft high form.
- **Signal 2 (secondary, `signal2Weight` 0.30):** wins vs **top-20 opponents on
  this surface**, recency-weighted (last-52-weeks win = 1.0, older career win =
  0.4).
- Combined: `(1−w2)·sig1 + w2·sig2`, clamped to `[-1,1]`.

---

## Pending / gated (the "warning" items)

- **[8] Winner / UE ratio** — not reliably in the api-tennis feed yet. Activates
  automatically when values are added to `h2h-model/manual-inputs.json` under
  `wue.<numericKey>` (`{ winners, unforced, surface }`); a `_`-prefixed example
  is included and stays inert until the underscore is removed.

---

## Stage 4 — AI match summary (`summary.js`)

Optional layer that turns a `runModel()` result into a short, factual analyst
note via Claude. Deliberately kept **out** of `runModel()` so the engine stays
pure and offline; `summary.js` is a separate async module.

- **Model:** `claude-opus-4-6` with adaptive thinking (both configurable under
  `config.summary`). Streams the response and collects the final message to
  avoid request timeouts.
- **R&D-safe gating:** the Anthropic SDK is lazy-`require`d in a `try/catch`, and
  the key is read from `ANTHROPIC_API_KEY` (never hard-coded or logged). If the
  key, the SDK, or `config.summary.enabled` is missing/off, `generateSummary()`
  returns `{ ok:false, gated:true, reason }` and the engine runs unchanged.
- **No fabrication:** the prompt is built only from numbers `runModel()` already
  produced (base/adjusted probs, the strongest applied adjustments, fair price,
  sharp edge, value flags). Missing inputs are omitted, not invented.
- **Run it:** `node h2h-model/run.js --summary <id>` (append `--summary` to any
  normal run). Programmatic entry point: `generateSummary(runModelResult)`.

`meta.pendingWarnings` still lists `stage4` as a reminder that it is optional and
key-gated rather than always-on.

---

## Current calibration snapshot (today's `matches.json`, n=45 with a clean Pinnacle line)

| | base ELO | adjusted |
|---|---|---|
| MAE vs Pinnacle | **5.57%** | 7.40% |
| mean bias | +1.19% | +1.07% |

Interpretation for tuning: base ELO already tracks the sharp market well.
Adjusted MAE is **higher** than base, i.e. the current placeholder magnitudes
pull the model *away* from Pinnacle on average — a signal the magnitudes should
be **calibrated down** (or the layers reweighted) before trusting value flags.
The engine is correct; the weights are the next thing to tune against a
backtest. 12/62 matches skip cleanly for missing ELO.
