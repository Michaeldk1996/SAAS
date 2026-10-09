# Tournaments → Reports (Round comparison, Player progression, Head-to-head)

Applies to the Reports section of the Tournaments page (`tourx*` in `bsp-consult-dashboard.html`), which reads
`tournament-progression.json` (rebuilt by `bsp-pipeline.js` `buildTournamentProgression` on every pipeline tick, not
committed). Styling = step 7 (TEN-401, founder ticket 2026-10-08, OFFICIAL VERSION 1 → Tournaments → Reports, night) —
it supersedes the colours in `design-export/README.md` §Tournaments; that README still holds structure (card order, the
serve-left / rally-right metric grid). Every rule below is locked by `tools/test-ten386-round-comparison.js` (in `npm test`),
which slices and executes the real functions.

## Surfaces and controls (TEN-401 items 2, 9, 10)
- **The Reports body is one top-level card** (`.tourx-rpcard`: `--card` + `--top-light`, no outline, radius 12, padding
  18 24 40, line-height normal — the reference). Metric cards, empty states and not-played notes inside it are panels
  (`--card` + 1px `--edge-6`; no dashed outlines). *Merge note:* if the shell ever wraps every tab body in this card, drop
  `.tourx-rpcard` from `renderTourxReports` so it is not doubled.
- **Every segmented control is the darker track** — the tournament picker, View, round chips, metric chips, Auto-fill:
  track `--card` + 1px `--edge-6` (radius 10, padding 3), selected `--inner` + 1px `--edge-10` white 700, idle
  `--text-label` 600; idle hover changes nothing. Typography per family (`tourxSegItem`): View Hanken 13 / 7×16, round
  chips — "All rounds" and R32 … F — Hanken 12 / 7×12 (founder r1 fix 10: rounds are labels, not figures; no mono round
  chip), metric chips Hanken 11.5 / 7×11, tournament Hanken 13.5 / 7×14 with an inner-tone monogram (10% ring)
  and the season year (Plex 12 600, = `tournament-progression.json` `fetchedAt` year, never the reader's clock).
- **Control order** (reference): Round comparison = Players · Metrics · Compare at round; Player progression = Players ·
  Metrics · Rounds through · Auto-fill.
- **Metric names are sentence case everywhere in Reports** (founder r1 fix 12) — chips, card titles, the match-stats
  sheet: Serve rating · 1st serve % · 1st serve points won · 2nd serve points won · Return rating · Dominance ratio ·
  Pressure points · Winners (per point) · Unforced errors (per point) · Winners / unforced errors ratio (chips: the short
  names, e.g. 1st serve won, W/UE ratio). Metric card titles (`.tourx-mtitle`) print the label as written — Hanken 13 /
  700 `--text`, never `text-transform: uppercase`. One source: `TOURX_METRICS`.
- **Player chips and the Add-player trigger are inner tone, no edge.** A focused progression chip lifts to `--selected` +
  1px `--edge-10`. Round-comparison chips are name + Elo; progression chips add the grey-ramp swatch (`TOURX_GREYS`).
- **The Add-player and head-to-head menus are the compact site menu** (README §5.5 = `.sf-dd-menu`): `--card` + 1px
  `--edge-10`, radius 10, padding 4, `--shadow-menu`; rows 12.5 / 600, padding 6 9, hover `--inner`, selected
  `--selected`; search field `--inner`, no edge, focus `--edge-16`. Head-to-head pickers: `--card` + 1px `--edge-6`,
  `--edge-10` while open.
- **No blue text, fill or selected state** in Reports: blue (`--bar` / `--viz-lead`) is a bar fill or a series stroke
  only; figures are white / grey.

## Round comparison
- **Bars are Ring blue: the leader `--bar` solid, everyone else `--bar-2` (45%)**; the dashed average marker is white 35%
  (1px); the leader's value is white, the rest grey (TEN-401 item 9; replaces the white/grey bars).
- **A `--bar-2` bar composites to exactly 45% blue on the card** (founder r1 fix 14): the `--track` (`.tourx-rtrack`) runs
  only from the bar's end to the right — never under the bar — and no bar or parent carries a gradient, opacity or filter
  (no hover brightening). *Measured* (Beijing SF, Serve rating, night): leader `rgb(0,122,255)`; non-leader on the card
  `rgb(8,65,130)` = 45% `--bar` over `--card` `rgb(16,19,29)`. With the old full-width track under it the bar read
  `rgb(16,72,138)` (45% over track-on-card).
- **Hovering a bar shows its match** in a tooltip (`--card` + 1px `--edge-10`, `--shadow-menu`, Plex 10.5 / 600 white):
  "Full name vs Opponent · SF · won 2–0". The set score is the feed's `resultDisplay`, which is first-player oriented and
  identical on both rows; it is oriented to the player **only** when the outcome is known and the match completed (higher
  count = sets to win: 3 at a Grand Slam, else 2; an R128 ladder of unknown tier orients nothing). A retirement score
  ("1 - 0") prints the outcome word with no score. *Measured:* Beijing 2026 SF/F rows carry "1 - 0".
- **Clicking a bar opens the match-stats sheet** (below).
- **A selected round lists every player with a box score in that round: winners and losers** (founder, TEN-386,
  2026-10-05: "I expected the 4 QF losers (Zverev, Rublev, Khachanov, Cerundolo) to show under Round comparison → QF").
  This replaces the July winners-only rule (314c8298). "All rounds" = the latest round with any box score.
  **Test:** Beijing 2026 QF shows 8 rows (4 W, 4 L); `tools/test-ten386-round-comparison.js`.
- **Each row carries the round's outcome as a W/L letter** (Mono 11px 700, `--pos` W / `--neg` L, the Player Profile's
  result marker; foundation.md allows green/red for result markers). The name is never dimmed for losing.
  **Test:** the letter is the first element of the row's name cell; the surname stays `--text`.
- **The outcome is the draw-structure `maxWonIdx`** (`tourxBuildTournament`: round labels + the event_winner-derived
  `eliminated` flag), never `resultDisplay` (first-player oriented) and never "does the next round have a box score".
  A walkover or stat-less next match must leave a won round as W. *Exception:* when `eliminated` is unknown (null), the
  player's latest round prints no letter; earlier rounds read W.
  **Test:** `test-ten386-round-comparison.js` (walkover and unknown-flag fixtures).
- *Known limit:* when a player's LOSING match has no stats, the pipeline drops it, so the round before it reads L.

## Match-stats sheet (TEN-401 item 9)
- Opened by a Round comparison bar or a Player progression heat cell: that player's match in that round, both players'
  ten metrics side by side from the same `tournament-progression.json` rows (the opponent's row for the same round). A
  figure either side lacks is a grey `—` and marks neither side better.
- **Every % in Reports prints one decimal** — the sheet (80.0% / 63.9%, founder r1 fix 13) and every bar value, heat
  cell, average and H2H label (founder card ff400963 "decimals = all": 67.0%, never 67%); the shared `tourxFmt` does it.
  Ratios and per-point figures keep two decimals, ratings stay whole. **Test:** `tools/test-ten386-round-comparison.js`
  "every % in Reports has one decimal".
- **Ties are judged on the printed value:** two figures that print the same (63.94 / 63.88 → 63.9%) mark neither side.
- Pop-up sheet: `--card` + 1px `--edge-10`, radius 14, `--shadow-modal`, max 640, no blue outline; over `--backdrop` +
  blur(3px) from `--sf-side` with `clip-path: inset(0)`. Header "Name v Opponent" 17/800 (the `v` grey) + Plex 11 meta
  "Event year · round · surface · Surname won/lost [score]" — Event = the one event name (`tourxEventName`: "Japan Open
  2026 · F", never "Tokyo 2026"; `tournaments.md` "Event names"), as are the tournament picker chips and their monograms
  (SM Shanghai Masters · JO Japan Open · CO China Open); the picker's click and state keep the key. **Better value white 700, the other grey 500** (lower is better
  for unforced errors; a tie marks neither). Close = inner-tone 32px button; Esc, a scrim click and a user's sidebar click
  (`window.sfOverlayClosers`) also close it.

## Player progression (TEN-401 item 9)
- **The round filter is "Rounds through"** (founder r1 fix 9, the reference's `ppRoundsShown`): a selected round is the
  last column — with SF selected, F and anything after are hidden; "All rounds" shows the whole ladder. The note beside
  the track is the reference's: "Showing rounds up to SF. Players eliminated earlier stop where they went out." /
  "Showing every round played." The AVG column (mean of the rounds shown) appears whenever ≥ 2 round columns show.
- Heat cells stay neutral (plain mono text, no per-cell container). **Only the best cell per round** (≥ 2 values) is white
  6% + 700; a hovered cell is `--selected`. Player marks use the neutral grey ramp. The heat-matrix maths is unchanged.

## Head-to-head (TEN-401 item 9, multi-series rule)
- Player A `--viz-lead` (Ring blue), player B `--viz-white-lead`, field average white dashed (`4 4`, 1.3px). Value labels
  and header figures are white text with a series swatch (never blue text). The "vs opponent" pills are `--card` + a 1px
  edge in the series colour; hover shows, click pins.
- **No overlaps** (founder r1 fix 11): while a pill shows (hover or pinned) it hides its own point's value label and any
  other value label under it (`data-covers`, `tourxTipSync`); a label returns when no shown pill covers it. **The plot
  carries no field value text:** the field figure sits in the card head after the series figures as "Field 287" in grey
  `--text-label` (Hanken word, Plex figure, 12 / 600) — the value at the dashed line's right end.

## Data (TEN-401 Data 4 / 5)
- **Only ingested box scores exist in the report:** `tourxBuildTournament` drops a round whose metrics carry no figure
  and drops a player with no such round (no estimated rounds, no name without data). The pipeline already emits only
  stat-bearing rounds (`buildTournamentProgression`); this keeps the client honest.
- **The Elo beside a name is Database → Ratings' weekly Elo:** `elo-ratings.json` (fetch-elo.js, weekly Tennis Abstract
  mirror) via the Ratings board's own path `elo[surname|initial].all.rating`, else `bySurnameElo[surname].all.rating`
  (`tourxRating` = `ratEloRec` + `ratVal('elo.all')`). Never derived. Not in the store → grey `—`.
- Unsourced → `—`, never 0: a player missing from the Elo store; a metric the box score lacks (e.g. winners / UE on matches
  whose feed has no winners count); a round average with no players.
