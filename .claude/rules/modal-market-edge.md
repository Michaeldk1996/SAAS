# Market edge — Match analysis tab and the player-profile basis (founder brief TEN-310, 2026-09-27)

Applies to the TEN-310 block in `bsp-consult-dashboard.html` (`me*` functions, `buildMarketEdgeSection`),
`market-edge-core.js` (`MarketEdgeCore`), and the player-profile Market edge's basis (`build-market-edge.js`,
`player-profile-v2.js` §5.8). Design: `Market Edge Tab.dc.html` + `Market Edge Tab - Paperclip.md`
(handoff 16). Tests: `test-ten310-market-edge.mjs` (fixtures: `tools/fixtures/ten310/`, snapshots of the deployed shards).

## Data
- **Source.** `career-history/{key}.json` (ATP tour level only; other levels are counted, never shown) joined to
  `match-closes/{key}.json` through the Form/H2H picker (`fhCloseFor` → `fhPickBook`): Pinnacle close, else Bet365
  close, one book and one source per match. Both shards are lazy, per player, rebuilt by the pipeline, and are loaded
  **only when the tab opens**. **Test:** nothing in the block fetches directly or reads `player-profiles.json`.
- **Today's price = the modal header's price** (`aHeaderOdds`, which also fills the header pills). No header price
  (completed / live / suspended, or no odds) → no TODAY band and the Derived lines card reads "Derived lines need
  today's price."; Match winner still renders.
- **Bands** are half-open in thousandths: [1.01,1.21) [1.21,1.41) [1.41,1.65) [1.65,2.00) | [2.00,2.50) [2.50,3.50)
  [3.50,6.00) [6.00,∞). Favourite = price < 2.00; **2.00 is underdog**. **Test:** 1.205 → 1.01 – 1.20, 2.00 → 2.00 – 2.49.

## Populations
- **Match winner (bands + profit chart):** priced, played matches, Bo5 included. Walkovers never. **Retirements are
  not settled** — the player-profile Market edge's rule (Tennis-Data rows not "Completed" are dropped): a match the feed
  flags retired or Tennis-Data marks not completed is out. A completed match whose stored set list is short ("3 - 0",
  two sets) is **not** a retirement.
- **Derived lines (card + pop-up):** the match-winner population restricted to completed best-of-3 with every set a
  standard finished set: no Bo5, no NextGen / team events (Laver, Davis, United, ATP, Hopman Cup), no match-tiebreak
  decider (a set above 7 games or below 6), no short set list. Tiebreak = a 7-6 / 6-7 set.
  **Test:** Σ band W − "Wins match" All = the wins among priced rows outside Bo3 (a documented difference, not equality).
- **Profit chart:** cumulative 1u P&L in date order on one date axis shared by both players (a later career starts
  further right); six labels at even fractions of the real date range (years on Career, months on Last 52 weeks).

## Rulings (founder, 2026-09-27, TEN-310 question card) — each one is a test
- **Needs = n / Σ price** (= 100 / mean closing price in the band; the flat-stake break-even), shown at any n > 0.
  Not 100 / band midpoint. `ME_NEEDS` in `market-edge-core.js`. **Test:** a band of prices 1.10, 1.30 shows
  2 / 2.40 = 83%.
- **Thin-sample floor = 5** (`ME_THIN_FLOOR`), both tables and both pop-ups: n < 5 → Won, Yield and line % read
  "—"; W–L and 1u stay (1u is a sum). n = 0 → not clickable, Won "—", 1u "—". **Test:** a 1–0 band prints "—".
- **Pill = "CLOSING ODDS"**, hover = Pinnacle / Bet365 split + latest match date in scope. "SAMPLE DATA" never
  renders. **Test:** `test-ten310-market-edge.mjs` finds no "sample data" in the tab or its pop-ups.
- **Today's price = the modal header's price** (`aHeaderOdds`, best across books), not the Form/H2H
  Pinnacle-else-Bet365 current price. Exception inline: the Form/H2H tabs keep their own today rule.
- **Retirements are not settled** in the Match winner view (bands, chart): a match the feed flags retired or
  Tennis-Data marks not "Completed" is out. Walkovers never count.
- **One basis for both Market edge surfaces** — the player-profile Market edge (`build-market-edge.js`,
  `market-edge/{key}.json`) uses this tab's rules, through `market-edge-core.js`: Pinnacle close, else Bet365
  close; favourite = price < 2.00 (no "level" role); the half-open band ladder; the same cents P&L; the tour
  baseline on the same basis. This supersedes R1 (2026-09-17, "Pinnacle closing only"). **Test:**
  `tools/test-market-edge-basis.js` (11 controls) and the pipeline's market-edge assert
  (`priceBasis === "Pinnacle closing, else Bet365 closing"`, Bet365 sides in the tour baseline).
  **Rows (ruling 2026-09-27, "Backfill career-history (2021 hole) and keep both joins"):** the profile keeps
  counting Tennis-Data rows and the tab keeps its career-history join. career-history's 2021 hole (api-tennis
  omits most of 2021; the TML half stopped at 2020) is filled from TML by `fillFixtureHole`
  (`career-backfill.js`, `FIXTURE_HOLE_YEARS = [2021]`): a TML row is added only if the feed half has neither
  its edition nor the match (same result, an opponent sharing a surname token, within the event's −3…+21 days).
  **Test:** `tools/test-ten310-hole-fill.js` — the same match under another event name or a hyphenated
  surname is never added; the index meta publishes `holeFill` (offered / kept / players).
