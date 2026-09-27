# Match analysis — Market edge tab (founder brief TEN-310, 2026-09-27)

Applies to the TEN-310 block in `bsp-consult-dashboard.html` (`me*` functions, `buildMarketEdgeSection`) and
`market-edge-core.js` (`MarketEdgeCore`). Design: `Market Edge Tab.dc.html` + `Market Edge Tab - Paperclip.md`
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

## Provisional — founder has not ruled (report, don't resolve)
- **Needs** = n / Σ price (exact flat-stake break-even; equals 100 / mean price). Constant `ME_NEEDS`.
- **Thin-sample floor** = 5 (`ME_THIN_FLOOR`): below it Won, Yield and line % are "—"; W–L and 1u stay.
- **Pill** reads "CLOSING ODDS" with a hover of the book split and the latest match. "SAMPLE DATA" never shows.

## Not the same as the player-profile Market edge (pending ruling, TEN-310 report)
The profile's `build-market-edge.js` uses Pinnacle only (R1), role = shorter price than the opponent, and Tennis-Data
rows. This tab uses the Form/H2H price rule, role = price < 2.00, and the career-history join. The same player can
show different band records on the two surfaces until the founder rules which basis both use.
