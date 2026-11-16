# Stennisfy Model page (TEN-418, step 12)

Reference: `OFFICIAL VERSION 1.html` → Stennisfy Model (`Stennisfy Model.dc.html`; its raw hexes are legacy, read through
`tokens.json → legacyColourMap`). Night only. **Rebuilt 2026-11-16 on `design_handoff_stennisfy_model/` (founder brief: pixel for pixel, identical colours,
every figure from the live model): its `reference/Stennisfy Model.dc.html` is the look and layout; "Look" below.** The page
has the reference's own head (title, one line, "?"), not the shared `.sfh`. The page owns no
navigation: no sidebar, no sub-tabs, no "Back to dashboard" (the shell rail is the only navigation). Tests:
`test-ten418-model.mjs` (runs the shipped renderer on a real frozen row) and `tools/test-ten418-mutants.js`.
Founder rulings: TEN-418 card 7a80b6fe, R1 review and R2 review 73f754f9 (2026-10-10).

## Data — every figure is the model run or the odds record
- **Test:** no "sample data" anywhere on the page; a section with nothing to source is hidden, never a disclaimer.
- **Model:** `model-output.json`, built every pipeline run by `buildModelOutput` (`bsp-pipeline.js` → `h2h-model`).
  Model base = `stage1.baseP1/P2` (Elo raw 0.3 · surface Elo 0.4 · 50/50 0.3, blended 50/50 with the Pinnacle anchor
  `pinnacleOpen` when one is confirmed). **The Pinnacle line is api-tennis's Pinnacle quote** (founder brief 2026-10-30):
  `bookOpens.Pncl` (first sighting) and `bookNow.Pncl` (the pipeline's latest read), each with its `seenAt`, both legs or
  nothing (`h2h-model/price.js` `apiTennisPinnacle`); never `oddsMovement.books.Pinnacle` (Oddspapi plain pinnacle, not
  written since 2 Sep), never the bestOdds "Pinnacle best on both sides" path, never another book — no quote = State 3.
  The frozen opening (`pinnacleOpen`, written once, never recomputed) takes the first sighting and its time. The
  Market context head prints "Pinnacle (api-tennis) · read HH:MM" (`bookNow.Pncl.seenAt`, age on hover). Stale gate:
  `EDGE_PIN_STALE_MIN` = **120** (founder 2026-11-01): a read more than 120 min old dashes the model price with "Pinnacle
  quote stale (Xh)" (120 exactly still prices; measured 30 Oct: the live build carries a read ~56 min old the moment it
  publishes); the bet105 row stays live beside it. **The model never falls back to the bet105 line as its anchor**
  (founder 2026-11-01: ruled no) — a stale or missing api-tennis quote is a dash, never the derived line. **Test:**
  `tools/test-model-anchor-pncl.js` (+ mutants: bet105 standing in, no h2h-model file reading it),
  `test-ten418-model.mjs` "anchor label" / "stale gate" (120 / 121 min; the bet105 row live, no model price). Layers = `stage2.adjustments`, summed into `totalDeltaP1`; adjusted fair =
  `stage3.fair`.
- **14 layers, one number everywhere.** **Test:** the header sentence ("Fair prices from 14 weighted layers…"), Layers
  active "N/14", "N of 14 active", the strip (14 segments) and the table (14 rows) agree on every match. A layer the
  engine hides or can't read is an inactive row with its reason — the format split on a best-of-three reads `—` / `—`,
  Favours "Gated", Why "Best of 3: this layer applies to best-of-five only". No placeholder rows for layers the engine
  lacks (Round performance, H2H trend, Tournament surface speed). The engine's "Subjective input" is named "Manual context".
- **No model price** (state ≠ 2, no run, or a failed run, before the start): match header + Market context book rows
  (no Model base tile, edges `—`) + one grey line "No model price for this match yet." in place of Value layers, Fair
  price and Biggest movers; Layers active / Updated read `—`. **Never an Elo-only price as the model price.** *(This page only: the Head to Head page's pair estimate is a separate, labelled product — `h2h.md` "Model", founder 2026-11-16.)* In play:
  match header + "Match in play…". Display gate (founder 2026-07-25): a price shows only for state 2 inside 0–30 h of
  the real start (`aOddsStartMs`).
- **No stat header and no Updated on this page** (founder 2026-11-16: "follow the design"); the rail head carries the
  match count, the Value layers pill the active-layer count. Times read `stennisfy.tz`,
  else the browser zone.
- **Weight** = the layer's cap `maxMagnitude` → Highest ≥ 0.06 · High ≥ 0.035 · Medium-high ≥ 0.025 · Medium ≥ 0.016 ·
  Low. **Quality** = Good (applied, confidence high / med; or inputs in for both but too close to move — Favours "Even",
  Shift 0.0pp) · Medium (applied at low confidence, gated, not this format) · Poor (no input for this match — Style matchup included:
  the model has no style input yet, TEN-419). **Favours** = a player · Even · Gated · No data, never another word (R2). Rows by weight, Highest →
  Low, then by |shift|. **Test:** the label, the Favours word, the Why and the Data quality sentence tell one story.
- **Player columns** = the two players' real figures in the layer's unit, read from the engine's sentence (44% / 63%,
  29 / 74, 258.0 / 303.5, 0.89 / 1.05, 4.0 / 8.0 load units, −22.0pp / −8.0pp = top-50 win rate minus overall win rate (founder R3:
  the unit shows in the columns too; A / B columns are 60px so it fits); H2H wins); signed figures take a true minus (−), the sign inside the figure's mono span; `—` when the sentence has
  none. The signal bar stays normalised.
- **Why** = this match's figures in plain words, from one template per engine sentence (`edgeWhyText`); no engine
  shorthand ("career+52wk", "Nₑₓ", "rel-to-archetype"). Style matchup reads the Playing Styles pair cell (`psCellFor`, the
  grid's own cell, same figure as its tooltip): "X v Y: N matches, under 30", or "On the Playing Styles grid, Xs win N% of
  M matches against Ys. The model doesn't read playing styles yet, so this layer doesn't move the price." (founder R3
  copy); the row stays No data / Poor, Data quality "The model doesn't read playing styles yet." Two-player figures name
  each player ("L. Darderi −8.3pp over 21 matches, S. Tsitsipas −1.7pp over 228"), never "A vs B" unnamed; a court
  figure under the engine's 10-match floor (`qualityForm.surfaceFloorM`) reads "under 10 top-50 matches there (not counted)",
  never the engine's placeholder +0.0pp. Soft scan also skips exchange-named keys (Matchbook, Smarkets, Betdaq). **Data quality** = one
  fixed sentence per state and cause, never naming a different state than its label. **Test:** no ticket number
  ("TEN-…") anywhere in the page's text (founder R3).
- **Prices** = the match's api-tennis odds record (`bookOpens` first sighting + `seenAt`, `bookNow`). Sharp tile =
  Pinnacle (`Pncl`), else Bet365 when Pinnacle has no current price. Best soft = the highest current price per player
  across every other book on the record (the foot names them; Betfair Sportsbook and SBOBET are soft per the
  `odds.md` `AODDS_BOOKS` groups; kept by the founder, card 283aa920), never Pinnacle, never the sharp tile's book, **never
  an exchange** (a key containing "exchange" is skipped — founder R2: an exchange feed, if added, stays out of best soft).
  Names: "Pinnacle", "Bet365" (the Database / H2H join's spelling), api-tennis "Betfair" = "Betfair Sportsbook" (R2;
  Database and News show no Betfair book), other books `mxBookLabel`. Note line: Pinnacle margin now, soft margins at open — the
  same quotes as the Soft open rows.
- **Pinnacle tile open → now** = Pinnacle's own first recorded price → its current price, move = `mxMovePct` on the 2 dp
  prices. It is not the Today's Matches pop-up pair (that is the card's book, Bet105 by the card ladder in `odds.md`).
  The model's frozen anchor (`pinnacleOpen`) is never shown as a third price.
- **bet105 (margin removed)** (founder brief 2026-10-31; label founder 2026-11-01, was "Pinnacle line (from Bet105)"):
  Bet105's live stream pair with its fixed cut removed —
  **Bet105 = Pinnacle × 0.9956** (`EDGE_B105_K`; measured 6–31 Oct on 3,489 stable moments / 268 matches, IQR
  0.9945–0.9963, every price band and day; Bet105's no-vig line = Pinnacle's, median 0.00pp). A Market context row
  "bet105 (margin removed)" (derived price or no-vig %, the Kibl time of the older side, edge = base − its no-vig)
  and a Fair price line per player (gap = adjusted fair % as printed − its no-vig %). Both legs or nothing, pre-match only,
  suspended = none; stream not live (`pairFor().live`: heartbeat < 180 s and joined) = dashes + "— stale" with the last
  pair on hover. Repainted in place on `kiblnow:change` (the page is never re-rendered for it); the shown match joins the
  stream's Realtime scope through `window.kiblExtraKeys`. **Display on this page only:** never written, never a close,
  never in a price join, never labelled a Pinnacle price; the model and its anchor are untouched. Hover (row and Fair
  price line): the 0.9956 derivation, "It tracks Pinnacle closely.", "Kibl recorded bet105's last change at HH:MM:SS (Kibl insert time, not
  bet105's own time)" (the newer side; Kibl publishes no book-post time) — hover only, never on the row, "Not a Pinnacle price."
  **Disagreement:** `EDGE_B105_DISAGREE_PP` = **1.5** (founder 2026-11-01): when the live line's no-vig and the api-tennis
  Pinnacle quote's differ by more than 1.5pp, a small neutral ⚠ mark sits after the label on the row and the Fair price
  line, and the hover adds "bet105 and Pinnacle (api-tennis) disagree by X.Xpp (over 1.5pp)". The price stays; nothing
  is hidden, suspended or blanked; the model is not affected. A stale stream or no Pinnacle quote is never compared.
  **Test:** `test-ten418-model.mjs` "Bet105 line" incl. "disagreement over 1.5pp" (+ mutants), `test-ten270-now-stream.mjs` "kiblExtraKeys" / "kiblnow:change".
- **Gap** = the adjusted fair % as printed (1 dp) − 100 / odd, in pp. An edited odd re-computes its own gap in place;
  empty, ≤ 1.00 or not a number reads `—`, never NaN.
- **Names:** players `newsPlayerName(key, feed)` (the profile string, as Player Profile prints it — today "B. Van De
  Zandschulp"; founder card bef6d3c2, 2026-10-10: this page keeps the shared string, and lower-case particles land
  site-wide under TEN-410 — never a page-only rule. Test: the rail string = Player Profile's `pp2-name` for the same key; a long pair wraps, never truncates); events
  `sfEventName`; styles the step-9 labels; "Elo" in both the header and the analysis. Rail = `getFiltered()`.
- **An empty rail always says why** (founder brief 2026-10-30, "Model page empty"): the rail follows the Today's Matches
  view, so when that view is empty (Completed, another day, a search, a chip) while the board holds upcoming matches, the
  body reads "This page follows the Today's Matches view, which has no matches (<view>). N upcoming matches are on the
  board. Model last run <d Mon · HH:MM>." with **Show all upcoming matches** (`edgeShowAllUpcoming`: the same
  `getFiltered` under Upcoming · All days, no search / chips / surface; Today's Matches' own state is put back; a rail
  visit returns to following the board). No board yet = "Loading the match board…"; a failed board load or no upcoming
  match says so, with the model run time. **Test:** `test-ten418-model.mjs` "empty view" / "empty board".

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
  the layer breakdown included (founder card 283aa920: not gated for now), with no Upgrade button (removed by the client in the 2026-11-16 handoff). Generate = the avatar menu's
  `.sf-upgrade`.

## Look (handoff design_handoff_stennisfy_model, 2026-11-16)
- **Colours = the export's own values as `--sm-*` tokens** (`tokens.css`; white / black alphas = `color-mix` of
  `--sm-white` / `--sm-black` at the export's %). Player one = blue ring (`--sm-blue`), player two = white; names white,
  underline on hover; links and chevrons `--sm-blue`; green / red only on signed figures and verdict pills; amber only on
  the medium-quality strip segment, dot and pill. **Test:** `test-ten418-model.mjs` "look".
- **Sections:** page head · matches rail (244, one tournament dropdown, no search / day switch / Reset) · Match header
  (48 avatars, Tournament · Surface · Round · Format pills, Match card › = the Match analysis modal, Head to Head › =
  `sfGoToH2H` + `?a=&b=` + sessionStorage `stn_h2h_pair`) · Market context (four rows: Soft open · Soft now · Pinnacle
  open · Pinnacle now; Bet105 is not a row here) · Value layers (strip, legend, toggle, face-to-face breakdown) · Fair
  price & value (Best soft · Pinnacle fields, Bet105 read-only with its odds movement pop-up) · Biggest movers. No
  Stennisfy Analysis section while `analysisOn` is off; no Upgrade to Pro.
- **Quality on this page:** the live rule (Good / Medium / Poor) except a layer switched off by a model rule or not
  played in this format, which reads **Not applicable** (grey). A shift under `EDGE_LEVEL_PP` (0.05pp) is level: no pill,
  sub line "· level".
- **Verdict pills = the model's own flags** (`stage3.flags`, never recomputed): Sharp value / Soft book value (green) on
  the flagged side, Market side (grey) on the other; no flag = No value, red on the side with the larger engine edge,
  grey on the other. A typed odd moves only its own gap.
- **Biggest movers share** = the three largest shifts over the summed shifts of every layer that moved (absolute values).
- **Base, net adjustment and adjusted fair are shown as computed, with no step line between them** (founder 2026-11-16:
  "follow the design export"). They do not add up because the model applies the rank-tier ceiling and the stage-3
  calibration after the net (h2h-model/model.js).
- **Bet105 odds movement pop-up:** the Today's Matches data path (`PriceHistoryBox.fetchHistory` → `sideRows` →
  `changesOnly`, cut at the start) on margin-removed prices (÷ `EDGE_B105_K`); 312px, below the odd or above it within
  400px of the bottom, 160 ms leave delay. Today's Matches' own pop-up is untouched.
