# Stennisfy Model page (TEN-418, step 12)

Reference: `OFFICIAL VERSION 1.html` → Stennisfy Model (`Stennisfy Model.dc.html`; its raw hexes are legacy, read through
`tokens.json → legacyColourMap`). Night only. Header = the shared 35b `.sfh` (`app-shell.md`). The page owns no
navigation: no sidebar, no sub-tabs, no "Back to dashboard" (the shell rail is the only navigation). Tests:
`test-ten418-model.mjs` (runs the shipped renderer on a real frozen row) and `tools/test-ten418-mutants.js`.

## Data — every figure is the model run or the odds record
- **Test:** no "sample data" anywhere on the page; a section with nothing to source is hidden, never a disclaimer.
- **Model:** `model-output.json`, built every pipeline run by `buildModelOutput` (`bsp-pipeline.js` → `h2h-model`).
  Model base = `stage1.baseP1/P2` (Elo raw 0.3 · surface Elo 0.4 · 50/50 0.3, blended 50/50 with the Pinnacle anchor
  when one is confirmed). Layers = `stage2.adjustments` (14 in the engine), summed into `totalDeltaP1`; adjusted fair
  = `stage3.fair`. The header sentence counts the engine's layers ("Fair prices from 14 weighted layers…"); the Value
  layers count is the layers shown for this match (Format split is hidden on a best-of-three, W/UE with no data —
  Rule A), so a Bo3 match reads "N of 13".
- **Display gate (founder 2026-07-25, kept):** the price shows only when `stage1.baseState.state === 2` and the real
  start (`aOddsStartMs`) is 0–30 h away; otherwise the match header + one grey line, and the header's Layers active /
  Updated read `—`.
- **Updated** = the shown run's `generatedAt` (HH:MM, hover "Model run …"), never the clock; `—` without a price.
- **Weight** = the layer's cap `maxMagnitude` → Highest ≥ 0.06 · High ≥ 0.035 · Medium-high ≥ 0.025 · Medium ≥ 0.016 ·
  Low. **Quality** = Good (applied, confidence high / med) · Medium (applied at low confidence, or held by a model-wide
  gate) · Poor (no input for this match). Rows by weight, Highest → Low, then by |shift|.
- **Why** = the engine's own `detail` sentence for this match (ticket numbers dropped). **Data quality** = one fixed
  sentence per state and cause (applied high / applied medium / applied low / gated / no input).
- **Prices** = the match's api-tennis odds record: `bookOpens` (first sighting, `seenAt` = the "opened" stamp) and
  `bookNow`. Sharp tile = Pinnacle (`Pncl`), else bet365 when Pinnacle has no current price (a book with a price now
  wins over one with only an open). Best soft = the highest current price per player across every other book on the
  record, never Pinnacle and never the sharp tile's book (the foot names them). Margins from the same quotes.
  Pinnacle open → now · move = `mxMovePct` on the 2 dp prices (THE move formula); it is Pinnacle's own pair, so on a
  card priced on Bet105 it is not the odds pop-up's Bet105 pair.
- **Gap** = adjusted fair probability − 1 / odd, in pp. An edited odd re-computes its own gap in place; empty, ≤ 1.00 or
  not a number reads `—`, never NaN; the typed text survives a re-render.
- **Names:** players `newsPlayerName(key, feed)`; events `sfEventName`; styles the step-9 labels (`ppStyleFor` →
  `psArchFor(…).name`). Rail = `getFiltered()` (Today's Matches' own list, order and count), grouped by event.
- **Stennisfy Analysis** = the pipeline's `summary` (`h2h-model/summary.js`, Claude, `ANTHROPIC_API_KEY`), cached per
  match by a hash of its facts. Facts = only the page's figures (`buildFacts(r, m)`; the page's price / layer rules are
  copied character for character into summary.js and the test fails on drift); five paragraphs labelled Players ·
  Matchup · Tournament · Keys · Verdict. No summary for the match → the section is hidden. Generate / ↻ Regenerate re-read
  the newest run (shimmer while reading) and swap it in only if it carries this match's analysis; stamp = "Generated
  HH:MM" of `summary.generatedAt`. A failed regeneration keeps the last good text (`lastError` beside it). The facts
  carry the page's own gaps (`gapPP`), so the text never computes its own.

## Pro gating
- Free = the rail's own lock (`.is-locked` on the Stennisfy Model item, set by `sfPlanLocks`); the page adds no rail
  code. **Test:** Free sees the whole page plus the Biggest movers Upgrade line and the analysis cut to two paragraphs
  under a fade + lock; Pro sees neither. Upgrade / Generate = the avatar menu's `.sf-upgrade` button.

## Look
- Cards `--card` + `--top-light`, no outline, radius 16; panels and tiles `--inner`, radius 12–14, no edge; chips
  `--inner` radius 6, caps 10.5/700/0.10em grey; Market context view = the Darker track; rail drop-down = `sfDd` with the site's small ▼ chevron; the Layer breakdown toggle =
  `--selected` + 1px `--line`, white caps (measured on the reference).
- **Colour test:** green / red only on signed figures (edges, gaps, shifts, movers, move %), grey at 0.0; amber only
  on the quality strip, dot and label; the signal bar `--bar` on `--track` with the centre tick; links (`↻ Regenerate`)
  `--link`; player names white, underline on hover; odd inputs take a 16% edge on focus, never a blue ring.
