# Today's Matches — build notes (TEN-8 redesign port)

Scoped entirely to `[data-page="matches"]` in `bsp-consult-dashboard.html`. Values taken
from the Stennisfy export (zip 32, `export/matches-upcoming.html`) — decoded from its
Framer scene-stack so the markup/tokens are the export's real ones, not icon-library or
eyeballed substitutes.

## Card-review round (founder comment 2026-07-29 04:12Z) — what changed

1. **Market Signal — expands in place.** The chip no longer navigates to the Edge page
   (`openEdgeModelAt`); it toggles a `.sig-open` class on its own card (`toggleSig`).
   The panel shows a centred `Player A vs Player B` header (A `#6aaeff`, "vs" muted,
   B `#e7e9ee`), a SHARP ESTIMATES group and a MARKET MONEY group with LIQUIDITY
   right-aligned on the group label line. Chevron flips (▾→▲) while open.
2. **Recent-form bars fill.** The fill was an inline `<span>` with no `display:block`,
   so it ignored its width and never painted. Fixed; the bar now fills proportionally in
   brand blue (`#2f6bd8→#5b9bff` gradient) at every level — never pos/warn/neg, which the
   design system reserves for data quality — and the value carries a `%`.
3. **Sidebar icons** are the export's exact six path strings (viewBox `0 0 20 20`):
   Matches = list rules, Players = person, Tournaments = trophy, Stennisfy Model = star,
   Playing Styles = bar chart, News = newspaper.
4. **Positioning.** Sidebar `250px` (was 280); content column left-aligned beside it,
   `padding:30px 40px 70px`, `max-width:1360px` — from the export's `<main>`.
5. **Date rail.** Tight inline cluster at the left, chevrons immediately adjacent; the
   full-width hairline under the rail is gone — only the ACTIVE day is underlined.
6. **Pro card.** Icon tile · "3 Bets Today" heading + subtext (left), PRO badge + CTA
   right-aligned — not a large standalone numeral.
7. **Nits.** Date/time separated by a space (`2026-07-29 01:00`), surface and tournament
   by spacing only (no middot), sort control shows the up-down glyph `⇅`.

## Market Money — three venues in the export, two shipped (per founder amendment)

The export's MARKET MONEY group renders **three** venues — Betfair Exchange, Polymarket,
Kalshi. This build ships **two: Polymarket and Kalshi only**. Betfair Exchange is dropped
because we can't link it, so it must not render. Both shipped venues are prediction-market
venues with real, sourceable liquidity. This is a decision, not a missing row.

## Data binding — what is live vs pending on this card

The card renders from `matches.json`. Only some Market Signal values are bound there:

- **Sharp / Pinnacle split — LIVE.** De-vigged from the card's bound odds: `m.odds` is a
  single-bookmaker two-way snapshot; the two implied probabilities are normalised to sum
  to 100. The row is labelled by the actual bookmaker that priced it.
- **Stennisfy model % — PENDING.** The model output is produced in CI and served
  separately; it is not carried on `matches.json`, so the row renders `—`.
- **Polymarket / Kalshi % + liquidity — PENDING.** The prediction-market feed / shards
  aren't on this card's data source yet, so both venue rows render `—` (including the
  LIQUIDITY column).

Pending values render as `—` with an explicit on-card note, never invented — per the
founder's instruction to say which values are missing rather than fabricate or fall back
to navigation.

## Verify

Rendered headless (Chrome `--headless=new`, 1400px) against the local today-dated slate
(37 real matches, both card states). Screenshots: `ten8-review2-default.png`,
`ten8-review2-sigopen.png` (in `~/.bsp-splits-cron/`). Preview served at
`http://localhost:8850/ten8-matches-preview.html` (auth gate neutralised in the preview
copy only; the committed file keeps the real gate).
