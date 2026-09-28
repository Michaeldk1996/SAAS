# Market edge — Match analysis tab and the player-profile basis (founder brief TEN-310, 2026-09-27)

Applies to the TEN-310 block in `bsp-consult-dashboard.html` (`me*` functions, `buildMarketEdgeSection`),
`market-edge-core.js` (`MarketEdgeCore`), and the player-profile Market edge's basis (`build-market-edge.js`,
`player-profile-v2.js` §5.8). Design: `Market Edge Tab.dc.html` + `Market Edge Tab - Paperclip.md`
(handoff 16). Tests: `test-ten310-market-edge.mjs` (fixtures: `tools/fixtures/ten310/`, snapshots of the deployed shards).

## Data
- **Source (ruling B, founder 2026-09-28 — one row source, tab = profile for every player).**
  - **Match winner view (bands, profit chart, band pop-up)** = the player-profile Market edge's own rows,
    `market-edge/{key}.json` `matches` with `inBasis` (`meWinnerRows`). Each row borrows set scores, eventKey and the
    display name/round from the one career-history row that joined the same Tennis-Data row (`tdKey`); a row with no
    such career row is joined by opponent surname + result in the event window (exactly one candidate), else it shows a
    dash there; the row still opens the match stats sheet (header wired, stats dashed where absent — TEN-312 sheet rule). A 404 shard = the profile has no Market edge and dashes it → the tab dashes that
    player too (state `none`), never "0 priced"; a failed fetch = failed.
    **Test:** `test-ten310-market-edge.mjs` "ruling B" — every band's W–L and 1u, the legend n and end = the profile
    shard's bands and headline; control: the career rows do not match.
  - **Derived lines (card + pop-up)** = `career-history/{key}.json` (ATP tour level only) joined to
    `match-closes/{key}.json` through the Form/H2H picker (`fhCloseFor` → `fhPickBook`): career-history is the only
    store with set scores.
  - All three shards are lazy, per player, rebuilt by the pipeline, loaded **only when the tab opens**. **Test:** the
    block's only own fetch is `market-edge/{key}.json` in `meLoadProfileShard`; it never reads `player-profiles.json`.
- **Today's price = the modal header's price** (`aHeaderOdds`, which also fills the header pills). No header price
  (completed / live / suspended, or no odds) → no TODAY band and the Derived lines card reads "Derived lines need
  today's price."; Match winner still renders.
- **Bands** are half-open in thousandths: [1.01,1.21) [1.21,1.41) [1.41,1.65) [1.65,2.00) | [2.00,2.50) [2.50,3.50)
  [3.50,6.00) [6.00,∞). Favourite = price < 2.00; **2.00 is underdog**. **Test:** 1.205 → 1.01 – 1.20, 2.00 → 2.00 – 2.49.

## Sheet and footnote (TEN-312, founder 2026-09-28)
- **Every pop-up row opens the match stats sheet** — the "stats on file" click condition (`meSheetOk`) is dropped; where no stats exist the sheet shows the wired header and "Match stats not available for this match".
- **The profit chart footnote describes the shared date axis** (both players on one real-date axis; a later career starts further right), not the design's per-player index axis (M5). **Test:** the footnote text does not say each line spans the player's own matches.

## Default view (TEN-312 D3, founder 2026-09-28)
- The tab opens on **Match winner** (`meView` default `winner`), not Derived lines. **Test:** a fresh modal's Market edge tab renders the Price sensitivity card first.

## Match format (R7, founder 2026-09-28)
- **Derived lines only on a standard best-of-3 match.** Otherwise the Derived lines card body reads "Derived lines
  cover best-of-3 matches only." (the no-price state's style); the view is never switched; Match winner is unchanged.
- **How the format is read** (`MarketEdgeCore.matchFormat`): the board's match has no format field, so it comes from
  matches.json `tour` (api-tennis `tournament_name`), `tournamentRound` and `tourBadge`. No tournament name or not
  badged ATP → unknown → no lines. Laver / Davis / United / ATP / Hopman Cup, NextGen and UTS → no lines. A Grand Slam
  main draw → best-of-5 → no lines; a Slam round naming qualifying → best-of-3. A Slam match with **no round** → unknown
  → no lines (the feed sends Slam qualifying with `tournamentRound` null, so it can't be told from main draw). Any other
  ATP event → best-of-3.
  **Test:** `test-ten310-market-edge.mjs` R7 (Slam R1, Laver Cup, NextGen, ATP 250, unknown, Slam qualifying, Slam with
  null round, "Roland-Garros", Davis Cup, United Cup). The format gate outranks the price gate.

## Populations
- **Match winner (bands + profit chart):** the profile's priced rows (ruling B), Bo5 included: Tennis-Data
  "Completed" matches, each priced in `FH_BOOK_ORDER` (some from our captures). Walkovers and retirements never
  (Tennis-Data settles).
- **Derived lines (card + pop-up):** career-history rows priced through the Form/H2H picker, not walkovers, not
  retired (feed flag or Tennis-Data), restricted to completed best-of-3 with every set a
  standard finished set: no Bo5, no NextGen / team events (Laver, Davis, United, ATP, Hopman Cup), no match-tiebreak
  decider (a set above 7 games or below 6), no short set list. Tiebreak = a 7-6 / 6-7 set.
  **Test:** on one row set, Σ band W − "Wins match" All = the wins among priced rows outside Bo3 (a documented
  difference, not equality); under ruling B the lines' denominator = the career Bo3 count (ruling B test).
- **Profit chart:** cumulative 1u P&L in date order on one date axis shared by both players (a later career starts
  further right); six labels at even fractions of the real date range (years on Career, months on Last 52 weeks).
  The footnote says so, not the design's "each line spans that player's own matches" (TEN-322).
  **Test:** `test-ten310-market-edge.mjs` "TEN-322" — no per-player span claim, names the shared date axis.

## Rulings (founder, 2026-09-27, TEN-310 question card) — each one is a test
- **Needs = n / Σ price** (= 100 / mean closing price in the band; the flat-stake break-even), shown at any n > 0.
  Not 100 / band midpoint. `ME_NEEDS` in `market-edge-core.js`. **Test:** a band of prices 1.10, 1.30 shows
  2 / 2.40 = 83%.
- **Thin-sample floor = 5** (`ME_THIN_FLOOR`), both tables and both pop-ups: n < 5 → Won, Yield and line % read
  "—"; W–L and 1u stay (1u is a sum). **n 5–9 → greyed + "small sample" note** via `tourxSampleGate` (TEN-312 D2, 2026-09-28). n = 0 → not clickable, Won "—", 1u "—". **Test:** a 1–0 band prints "—".
- **Pill = "CLOSING ODDS"**, hover = Pinnacle / Bet365 split + latest match date in scope. "SAMPLE DATA" never
  renders. **Test:** `test-ten310-market-edge.mjs` finds no "sample data" in the tab or its pop-ups.
- **Today's price = the modal header's price** (`aHeaderOdds`, best across books), not the Form/H2H
  Pinnacle-else-Bet365 current price. Exception inline: the Form/H2H tabs keep their own today rule.
- **Retirements are not settled** in the Match winner view (bands, chart): under ruling B its rows are the profile's,
  which drop every Tennis-Data row not "Completed" (the price's own archive settles). Derived lines also drop what the
  feed flags retired. Walkovers never count.
- **One basis for both Market edge surfaces** — the player-profile Market edge (`build-market-edge.js`,
  `market-edge/{key}.json`) uses this tab's rules, through `market-edge-core.js`: Pinnacle close, else Bet365
  close in the tab's order (R8 + card ruling, 2026-09-28: **our captured Pinnacle → Tennis-Data Pinnacle** →
  Tennis-Data Bet365 → our captured Bet365, the page's `FH_BOOK_ORDER = ['Pcap','Ptd','Btd','Bcap']`, also the
  Form/H2H order; captures from `match-closes/{key}.json`, so `build-market-edge.js`
  runs after `build-match-closes.js`; test `tools/test-ten310-price-order.js`); favourite = price < 2.00 (no "level" role); the half-open band ladder; the same cents P&L; the tour
  baseline on the same basis. This supersedes R1 (2026-09-17, "Pinnacle closing only"). **Test:**
  `tools/test-market-edge-basis.js` (11 controls) and the pipeline's market-edge assert
  (`priceBasis === "Pinnacle closing, else Bet365 closing"`, Bet365 sides in the tour baseline).
  **Rows:** one row source since ruling B (2026-09-28, see Data): the tab's Match winner reads the profile's rows.
  career-history (the Derived lines' rows) has its 2021 hole (api-tennis
  omits most of 2021; the TML half stopped at 2020) filled from TML by `fillFixtureHole`
  (`career-backfill.js`, `FIXTURE_HOLE_YEARS = [2021]`): a TML row is added only if the feed half has neither
  its edition nor the match (same result, an opponent sharing a surname token, within the event's −2…+16 days).
  **Test:** `tools/test-ten310-hole-fill.js` — the same match under another event name or a hyphenated
  surname is never added; the index meta publishes `holeFill` (offered / kept / players).
