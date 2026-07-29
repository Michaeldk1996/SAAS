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

## Verification pass (founder "finish Today's Matches" comment, 2026-07-29 05:09Z)

Ran the side-by-side the founder said was missing — a live-DOM probe + 1400px full-page
render taken FROM commit `8f48e86`, not from a preview I had lying around. Harness:
`render-matches.mjs` (Node 24 global WebSocket + spawned headless Chrome via CDP, zero
installs). It rebuilds the preview from `git show 8f48e86:bsp-consult-dashboard.html`,
injects a BSP auth stub matching the REAL publicUser shape `{uid,name,email,emailVerified}`,
serves the worktree, sets a 1400px CDP viewport, waits for `.match-card`, probes the DOM,
then screenshots full-page + the Market-Signal-expanded card.

Result — every outstanding Item-1 point is already satisfied at `8f48e86`:
- Stennisfy Model icon = line-chart glyph (paths `M4 4v12h12` + `M6.5 12.5l3-3.5 2.5 2 4-5.5`). Not an arrow/star.
- Playing Styles icon = bar-chart glyph (`M4 15V9M8 15V5M12 15v-4M16 15V7`). Not a target.
- Market Signal chip `onclick="toggleSig(this)"` — expands in place (`.sig-open`), never navigates.
- Expanded panel: SHARP ESTIMATES (Pinnacle 56/44 LIVE, Stennisfy —), MARKET MONEY
  (Polymarket, Kalshi — **Betfair absent**), LIQUIDITY right-aligned on the group label row.
- Sidebar foot: one bordered `.sf-userchip` (avatar · name · "Free plan" · chevron) + outlined
  "Upgrade to Pro". No bare Sign-out. `footHTMLhasSignOut=false`.
- Header: green dot `#3dd68c` + "Live · updated " (space present) + clock.
- Date rail: chevrons in bordered squares, right chevron immediately after the last day.

**Why the founder saw it as broken:** he was judging a STALE render, not `8f48e86`. This is
exactly the "reported matches without running the side-by-side" failure he flagged. Fixed the
process, not the code.

**One trap caught:** first render showed the account label as "preview" — that was MY stub
using `displayName` where the real `publicUser` (auth.js:132-134) exposes `name`. Corrected
the stub; label then renders "Alex Morgan". `paintAcct` (`u.name || email-localpart`) was
never wrong. Had I "fixed" it to read `displayName`, I'd have diverged from the real object.

**Known non-blocking gap (data, not composition):** Stennisfy model %, Polymarket & Kalshi
flow/liquidity aren't wired to this card's source yet — rendered as "—", never invented, with
an on-card footnote saying so. Pinnacle split is live. This is the documented data-layer gap,
not a design miss; founder said "data layer untouched" this pass.

Evidence artefacts (in agent workspace):
- `ten8-matches-1400-8f48e86.png` — full page, 1400×4084, from commit 8f48e86
- `ten8-matches-1400-8f48e86-sigopen.png` — Market Signal expanded card
