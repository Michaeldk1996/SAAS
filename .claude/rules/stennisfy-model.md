# Stennisfy Model page (TEN-418, step 12)

Reference: `OFFICIAL VERSION 1.html` → Stennisfy Model (`Stennisfy Model.dc.html`; its raw hexes are legacy, read through
`tokens.json → legacyColourMap`). Night only. Header = the shared 35b `.sfh` (`app-shell.md`). The page owns no
navigation: no sidebar, no sub-tabs, no "Back to dashboard" (the shell rail is the only navigation). Tests:
`test-ten418-model.mjs` (runs the shipped renderer on a real frozen row) and `tools/test-ten418-mutants.js`.
Founder rulings: TEN-418 card 7a80b6fe and R1 review (2026-10-10).

## Data — every figure is the model run or the odds record
- **Test:** no "sample data" anywhere on the page; a section with nothing to source is hidden, never a disclaimer.
- **Model:** `model-output.json`, built every pipeline run by `buildModelOutput` (`bsp-pipeline.js` → `h2h-model`).
  Model base = `stage1.baseP1/P2` (Elo raw 0.3 · surface Elo 0.4 · 50/50 0.3, blended 50/50 with the Pinnacle anchor
  `pinnacleOpen` when one is confirmed). Layers = `stage2.adjustments`, summed into `totalDeltaP1`; adjusted fair =
  `stage3.fair`.
- **14 layers, one number everywhere.** **Test:** the header sentence ("Fair prices from 14 weighted layers…"), Layers
  active "N/14", "N of 14 active", the strip (14 segments) and the table (14 rows) agree on every match. A layer the
  engine hides or can't read is an inactive row with its reason — the format split on a best-of-three reads `—` / `—`,
  Favours "Gated", Why "Best of 3: this layer applies to best-of-five only". No placeholder rows for layers the engine
  lacks (Round performance, H2H trend, Tournament surface speed). The engine's "Subjective input" is named "Manual context".
- **No model price** (state ≠ 2, no run, or a failed run, before the start): match header + Market context book rows
  (no Model base tile, edges `—`) + one grey line "No model price for this match yet." in place of Value layers, Fair
  price and Biggest movers; Layers active / Updated read `—`. **Never an Elo-only price as the model price.** In play:
  match header + "Match in play…". Display gate (founder 2026-07-25): a price shows only for state 2 inside 0–30 h of
  the real start (`aOddsStartMs`).
- **Updated** = the shown run's `generatedAt` (HH:MM, hover "Model run …"), never the clock. Times read `stennisfy.tz`,
  else the browser zone.
- **Weight** = the layer's cap `maxMagnitude` → Highest ≥ 0.06 · High ≥ 0.035 · Medium-high ≥ 0.025 · Medium ≥ 0.016 ·
  Low. **Quality** = Good (applied, confidence high / med; or inputs in for both but too close to move — Favours "Even",
  Shift 0.0pp) · Medium (applied at low confidence, gated, not this format, or Style matchup with both labels known —
  Favours "Off", the model doesn't read styles yet, TEN-419) · Poor (no input for this match). Rows by weight, Highest →
  Low, then by |shift|. **Test:** the label, the Favours word, the Why and the Data quality sentence tell one story.
- **Player columns** = the two players' real figures in the layer's unit, read from the engine's sentence (44% / 63%,
  29 / 74, 258.0 / 303.5, 0.89 / 1.05, 4.0 / 8.0 load units, −22.0 / −8.0 top-50 pp, H2H wins); `—` when the sentence has
  none. The signal bar stays normalised.
- **Why** = this match's figures in plain words, from one template per engine sentence (`edgeWhyText`); no engine
  shorthand ("career+52wk", "Nₑₓ", "rel-to-archetype"). Style matchup reads the Playing Styles pair cell: "X v Y: N
  matches, under 30", or the cell's rate + "the model does not read playing styles yet" (TEN-419). **Data quality** = one
  fixed sentence per state and cause, never naming a different state than its label.
- **Prices** = the match's api-tennis odds record (`bookOpens` first sighting + `seenAt`, `bookNow`). Sharp tile =
  Pinnacle (`Pncl`), else Bet365 when Pinnacle has no current price. Best soft = the highest current price per player
  across every other book on the record (the foot names them; Betfair = Betfair Sportsbook and SBOBET are soft per the
  `odds.md` `AODDS_BOOKS` groups; kept by the founder, card 283aa920), never Pinnacle, never the sharp tile's book. Names: "Pinnacle", "Bet365" (the
  Database / H2H join's spelling), other books `mxBookLabel`. Note line: Pinnacle margin now, soft margins at open — the
  same quotes as the Soft open rows.
- **Pinnacle tile open → now** = Pinnacle's own first recorded price → its current price, move = `mxMovePct` on the 2 dp
  prices. It is not the Today's Matches pop-up pair (that is the card's book, Bet105 by the card ladder in `odds.md`).
  The model's frozen anchor (`pinnacleOpen`) is never shown as a third price.
- **Gap** = the adjusted fair % as printed (1 dp) − 100 / odd, in pp. An edited odd re-computes its own gap in place;
  empty, ≤ 1.00 or not a number reads `—`, never NaN.
- **Names:** players `newsPlayerName(key, feed)` (the profile string; a long pair wraps, never truncates); events
  `sfEventName`; styles the step-9 labels; "Elo" in both the header and the analysis. Rail = `getFiltered()`.

## Stennisfy Analysis
- **Switch:** `h2h-model/config.js` `summary.enabled`; the pipeline writes it into `model-output.json` as `analysisOn`.
  **OFF (founder 2026-10-10). Test:** with `analysisOn` not true the page draws no Analysis section for anyone and the
  pipeline makes no Claude call. Turning it on is a founder ruling.
- When on: generated pipeline-side (`summary.js`, Claude), facts = only the page's figures (the page's price / layer
  rules are copied verbatim into summary.js; the test fails on drift), five paragraphs Players · Matchup · Tournament ·
  Keys · Verdict. Cached per match, key = match id + the shown fair odds: re-written only when a model run changes the
  fair price, never on a price move; a key that failed is not retried until the fair price changes; only state-2 matches
  (the ones the page prices) get one. Click-to-generate needs a server endpoint — TEN-420. Pro sees the cached text + "Generated HH:MM" + "↻ Regenerate"; with none cached, the
  empty state + Generate; a failed generate keeps the empty state with "Couldn't generate the analysis. Try again." Free
  sees the Players paragraph and the shared Upgrade button only (no Regenerate, no stamp, nothing when none is cached).

## Pro gating
- Free = the rail's own lock (`.is-locked`, set by `sfPlanLocks`); the page adds no rail code. Free sees the whole page,
  the layer breakdown included (founder card 283aa920: not gated for now), plus the Biggest movers Upgrade button. Upgrade / Generate = the avatar menu's
  `.sf-upgrade`.

## Look
- Cards `--card` + `--top-light`, no outline, radius 16; panels and tiles `--inner`, radius 12–14, no edge; chips
  `--inner` radius 6, caps 10.5/700/0.10em grey; Market context view = the Darker track; rail drop-down = `sfDd` with the
  News page's small chevron; the Layer breakdown toggle = `--selected` + 1px `--line`, white caps.
- **Colour test:** green / red only on signed figures (edges, gaps, shifts, movers, move %), grey at 0.0; amber only
  on the quality strip, dot and label; the signal bar `--bar` on `--track` with the centre tick; links (`↻ Regenerate`)
  `--link`; player names white, underline on hover; odd inputs take a 16% edge on focus, never a blue ring.
