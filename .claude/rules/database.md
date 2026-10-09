# Database page — Tour · Tournament · Player (founder step 6, TEN-399, 2026-10-07)

Applies to `window.DatabaseTab` in `bsp-consult-dashboard.html` (header, control bar, Tour / Tournament / Player
views, the cumulative-profit charts). Ratings and Lines carry their own files (`ratings.md`, `lines.md`); colours and
surfaces follow `foundation.md`. The handoff (`design_handoff_database/`, 17 Sep) still governs tab structure, grids,
gates, data shapes and the chart algorithms; its colours and chart treatment are superseded by this file. The
reference `OFFICIAL VERSION 1.html` draws the **old** Database content (Heavy / Firm / Narrow favourite, Bet365 seam) —
take styling from it, structure from the rules below.

## Price join — one join, no seam
- **Test:** every row of `database-yield.json` is priced Pinnacle closing, else Bet365 closing, per match
  (`build-database-yield.js`, the same `pickBook` as Market edge). Tour = Favourites −1.78% · Underdogs −6.96% on
  40,972 matches (All −4.37% = the tour-baselines figure), measured 2026-10-07.
- **Retirements behind a flag (founder ruling 2026-10-08, TEN-402 card 01102d24).** The Database voids a retirement
  (2026-09-20) — none is in `rows` / `names`, `meta.exclusions.retired` counts them. The same build keeps the priced ones
  in `retRows` / `retNames` (same row shape, same book rule, tie / overround / pre-2010 filters; `meta.retired`: 1,297 of
  1,850 on 8 Oct 2026), read ONLY by the site's one price join (`DatabaseTab.priceRows()` → `dbPriceJoinRows`: the Head
  to Head ledgers and the Player Profile per-event Backing), which settles them on the official ATP result. No Database
  figure, `tour-baselines.json` or `tournament-market.json` reads them: before = after on Tour All (40,972; Favourites
  −1.78% · Underdogs −6.96%). Size: +44 KB raw / +10 KB gz (`database-yield.json`), +37 KB / +8 KB (names shard).
  **Test:** `test-ten402-b.mjs` "the store keeps retirements BEHIND A FLAG" (rows = used, parallel arrays, each flagged
  row a Retired archive match, each Database row a Completed one); the Database suites below run unchanged.
- **Test:** no chart draws a seam line, a Bet365 pill or a "book artefact" footnote; `renderCurveCard` takes no seam.
  The per-book split paragraph is on the **Player tab only** and opens with the join (founder, card 52bf5cc5
  "split" = player-only, 2026-10-08). **Test:** a Tour or Tournament band panel paints no `db-split` line
  (`test-ten262.mjs` STALE.split).

## Header card
- Ruled as proposed (card 52bf5cc5 "header" = ok). **Test:** caps line "ATP tour · closing-line archive", title "Database" 29/800, sub 13.5 `--text-soft` with no seam
  sentence, mono stats right: Matches (whole archive on the join, ignores filters) · Seasons · Updated (the archive's
  last date; "Updates pending" under it once it is more than 14 days old). `dbHeadStats()`.

## Control bar
- **Test:** no native `<select>` in the page DOM with any menu open, year range included (`test-ten399-database-frame.mjs`).
- Tab row and every pill group = darker track (track `--card` + `--edge-6`; selected `--inner` + `--edge-10`, white 700;
  idle `--text-label`); a disabled option is 40% grey with no fill.
- Dropdown triggers = `--inner`, no edge; all five Tour triggers (Level · Surface · Round · year from · year to) render
  the same caret element (`DB_CARET`: ▼, 9px, `--text-label`, 8px gap).
- Menus = `--card` + 1px `--edge-10`, radius 10, padding 4, `--shadow-menu`; max 212px (search) / 252px (filter) then
  scroll; rows 12.5px, padding 6×9; hover `--inner`; selected `--selected`; ticks white; in-menu search 32px `--inner`.
- Chips-and-search box `--inner`, no edge (`data-search`); chips `--inner` + white text, remove × grey; cap notes grey.
  Reset = white text.

## Tour
- **Test:** Favourites left | Underdogs right, each a panel (`--card` + `--edge-6`); rows Heavy favourite · Firm favourite ·
  Narrow favourite and Narrow underdog · Mid underdog · Long shot (founder fix 7, card ff586600, 2026-10-08 — replaces the
  ticket's Super / Mid / Slight names; Tour and Tournament; `FAV_NAMES` / `DOG_NAMES`, `test-ten399-fixes.mjs`), each with its
  own From / To (a 45px track = five mono characters, the same in both tables). **Band names never wrap**
  (`white-space:nowrap` on the band cell; founder TEN-401 r1 fix 2): the band track is `minmax(108px,1fr)` and the yield
  columns are 62px, so the ROI overlay at 1512 keeps "Narrow underdog" (107px) on one line. **Test:** `test-ten401-b.mjs` r1.2.
- **Test:** each band carries its own Matches; the three bands sum to the All row on each side. All yield =
  match-weighted (total profit ÷ matches, 2 dp, sign colour); All median = pooled median, inside the side's range.
- **Test (card 52bf5cc5 "superdog" = to-plus; reverses TEN-196's real-top-end ruling):** Long shot From = its real
  lower cut, To = that + "+" (`3.75` / `3.75+`). Cut-points follow the active filter (`DB_DOG_OPEN_TOP=true`).
- **Test (founder TEN-401 r1 fix 1, 2026-10-08, both sides, Tour and Tournament):** an All row spans its side — From =
  the lowest band's From, To = the **top band's To exactly as that row prints it**. Underdogs All = Narrow underdog From /
  Long shot To (`1.88` / `3.75+`; Hangzhou Open `2.04` / `3.05+`, Wimbledon `1.95` / `5.57+`); Favourites All = Heavy
  favourite From / Narrow favourite To (`1.01` / `1.97`; Hangzhou `1.20` / `1.85`, Wimbledon `1.01` / `1.95`). Never the
  side's lowest price + "+" (the old Underdogs "1.88+"). `test-ten399-database-frame.mjs` bands, `test-ten401-b.mjs` r1.1.
- **Test (card 52bf5cc5 "allcount" = figures):** both All rows count every priced match (40,972; exact-price ties
  excluded) and each carries its own median and yield — never one shared row.
- Sample gates as built (soft 100 grey / hard 30 no yield). **An All row keeps its sign colour under the soft gate**
  (founder TEN-401 carry-over, 2026-10-08: it rendered grey; bands still go grey). **Test:** `test-ten401-b.mjs` — Hangzhou
  Open (50 matches) All rows read `--pos` / `--neg` over grey bands. A hard-gated band or All cell prints `—` and the panel
  carries one note under the table (founder card ff586600 "hardnote" = ok) ("— fewer than 30 matches: too few for a yield."); the Player book split gates each
  book the same way ("N matches priced on … (too few for a yield)").
- No "Back the shorter price" / "Back the longer price" copy anywhere. Column heads Hanken 10.5 caps on a 10% rule;
  All row on a 14% 2px rule. Chart plot 340px, title 19/800, legend swatches `--viz-lead` (Favourites) ·
  `--viz-white-lead` (Underdogs).

## Tournament
- **Test:** same Favourites | Underdogs layout; each row's tour comparison sits in the same row as the event figure;
  the band-box header carries only the side title (the event name sits outside), so Tour and Tournament boxes are the
  same height. Baseline `—` rule unchanged. The "Choose a tournament" prompt names the band yields and the curve only —
  never the per-book split (founder fix 1).
- **Test (card 52bf5cc5 "tmtcount" = own count):** each band's Matches is its own tercile count and the All row is the
  event total, the same as Tour (Australian Open on the one join: 684 × 3 = 2,052).
- **Compare events (2–4):** a panel (`--card` + `--edge-6`) with the table and one multi-series chart; at most 4
  events; series 1 `--viz-lead` 2.4px, 2 `--viz-white-lead`, 3 `--viz-tick`, 4 `--viz-white-lead` dashed `6 5`; no
  categorical hue; end values in the legend only (no plates, no end dots). Series 2 is solid white (founder card ff586600
  "series2" = solid; the chart rule's "second line white 45%" applies to two-series charts only). `test-ten399-b.mjs`.

## Player
- **Test:** Side = Backing him / Fading him flips every figure, note and curve.
- **Test:** As favourite / As underdog = card, no outline; no status pill, no gap bar or legend; the "Gap vs tour
  baseline" row is the only rendering of the gap and its only sign colour besides the player's yield; the tour-baseline
  figure is `--text-label` (#A3AABE) at the same 26px, **weight 500** (R2 item 6), so it reads as secondary.
- **Test (R2 item 5):** the Player split strip reads "Each match is priced on its Pinnacle closing price, else Bet365. Split
  by book: <yield> across N matches priced on Pinnacle, <yield> across M matches priced on Bet365."; a book under 30
  matches reads "M matches priced on Bet365 (too few for a yield)" — never "too few matches for a yield across M".
- **Test:** the three charts share one y-domain and one tick set (match-index axis, season ticks, first season to
  2026); no coverage caption.
- **Test (founder card ff586600 "clay" = recompute, 2026-10-08):** under a Player Surface / Level filter the tour baseline
  is recomputed with the same filter (`PLAYER_BASELINE_SCOPE='recompute'`; Khachanov Clay: tour −1.43% / −7.16%). The
  `'gate'` (`—`) path stays in code, unused.

## Charts (all Database charts)
- **Test:** horizontal guides only, `--viz-guide` dotted `2 6`; no vertical tick line, no loss wash, no area fill;
  break-even `--viz-rule` 1.25px; Favourites `--viz-lead` 2.4px, **Underdogs white `--viz-white-lead` 2px** (founder
  TEN-401 r1 fix 3, as the reference draws it — was white 45%; `COL_DOG`); end dots and legend swatches match their line; axis and
  tick labels mono `--text-label`. Smoothing (`SMOOTH_MODE='guarded'`), the y-axis algorithm, shared scales, the
  late-start rule and "nothing interactive" are unchanged.

## Formatting
- **Test:** yields 2 dp with sign, `pp` deltas, units, all with a true minus `−` (`fmtPct`, `fmtPP`, `fmtU`);
  thousands separators; en dash in records.
