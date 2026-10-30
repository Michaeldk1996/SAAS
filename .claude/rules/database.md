# Database page — Tour · Tournament · Player (founder step 6, TEN-399, 2026-10-07)

Applies to `window.DatabaseTab` in `bsp-consult-dashboard.html` (header, control bar, Tour / Tournament / Player
views, the cumulative-profit charts). Ratings and Lines carry their own files (`ratings.md`, `lines.md`); colours and
surfaces follow `foundation.md`. The handoff (`design_handoff_database/`, 17 Sep) still governs tab structure, grids,
gates, data shapes and the chart algorithms; its colours and chart treatment are superseded by this file. The
reference `OFFICIAL VERSION 1.html` draws the **old** Database content (Heavy / Firm / Narrow favourite, Bet365 seam) —
take styling from it, structure from the rules below.

## Price join — one join, no seam
- **Test:** every row of `database-yield.json` is priced Pinnacle closing, else Bet365 closing, per match
  (`build-database-yield.js`, the same `pickBook` as Market edge). **Interim (founder 2026-10-26, "finish and close" item 2,
  replacing the same day's Jan–Apr-only window):** a Bet365-only row shows the real Bet365 close, marked "B", at every date,
  until a Pinnacle close is found — a Pinnacle pair (Tennis-Data's or our archive's) wins per row, so an arriving close
  replaces the B on the next build. Switch: `B365_INTERIM` (false = Bet365 only for 1 Jan – 30 Apr 2026, elsewhere a dash,
  reason `nopin`, counted in `meta.bet365Window.droppedOutside`). **Test:** `tools/test-b365-window.mjs`. Tour = Favourites −1.78% · Underdogs −6.96% on
  40,972 matches (All −4.37% = the tour-baselines figure), measured 2026-10-07.
- **Exact price ties behind a flag (founder ruling 2026-10-16: "Keep tied prices. Exclude them only from favourite/underdog
  figures.").** A tie is no favourite and no underdog, so it stays out of `rows` (every Database figure, `tour-baselines.json`,
  `tournament-market.json`; `meta.exclusions.exactTie` still counts it). The same build keeps every tie that passes the other
  filters (overround, window, level) in `tieRows` / `tieNames` (same row shape, favWon 1; `meta.ties`: 222 = Pinnacle 175 +
  Bet365 47, 5 of them retirements, measured 16 Oct 2026), read ONLY by the one price join (`dbPriceJoinRows`), which prices
  both players at the tie. Before = after on every Database figure (rows and tour-baselines byte-identical). **Test:**
  `test-ten402-b.mjs` "exact price ties ride BEHIND A FLAG" (controls: no Database row is a tie; a store without tieRows
  joins as before; a names shard out of step never prices).
- **Our Pinnacle archive's closes — books 3 and 4 (founder ruling 2026-10-16, round 3 item 1).** A row priced on a close
  from the permanent Pinnacle archive (the td-feed: a Tennis-Data 2026 row with no Pinnacle pair, or a match added after
  Tennis-Data's last day) carries `r[8] = 3` (label "from Pinnacle history") or `4` ("captured"), never 0 (0 = Tennis-Data's
  own Pinnacle column). Both are Pinnacle closes: every Database figure, count and split counts them as Pinnacle
  (`dbBk`; `meta.bookCounts.Pinnacle` includes them; `meta.archiveFeed.rowsByLabel` names each), so no price or figure
  moves. The join reads them as book "P" with source `hist` / `cap`, and every hover names the source: "Pinnacle close ·
  from Pinnacle history" (Tournament tab, sheets, Series), "Pinnacle closing price · from Pinnacle history" (Head to Head),
  the Player Profile's Record per tournament prices hover the same words (`pxSrcHtml` → the host's `fhSrcTitle`), its sheet through `pinnacle-history`; the join's Bet365 reaches the profile as Tennis-Data's (`bet365-archive`). Never "Tennis-Data" on our own close. **Test:**
  `tools/test-approx-pinnacle.mjs` (builder codes 3 / 4, the join, every hover, the Database counts),
  `tools/test-pinarch-tdfeed.py`.
- **Pinnacle (approx.) — books 5 and 2 (founder rulings 2026-10-16, 2026-10-17 item 2).** An ATP main-draw row of 13 Jan –
  16 Sep 2026 with no Tennis-Data Pinnacle pair and no close in our Pinnacle archive is priced on a SNAPSHOT, never a close
  (`pinnacle-approx.csv`, `tools/tdarch.py approx-feed`, from the archive's snapshot table, each row naming its `source`,
  `cutTs`, `gapToStartS`). **The Oddspapi start − 10 snapshot (book 5) is never shown on the ATP main draw** (founder
  ruling 2026-10-26: Oddspapi's trueStart runs late — ATP p98 70.5 min — so start − 10 can be in play, and no live-flip
  exists before 17 Sep to prove otherwise): a match whose snapshot is start − 10 is a DASH, with no fall-through to
  api-tennis or Bet365 — only Tennis Explorer prices it (founder 2026-10-30) (unpriced reason `od10`, counted in `meta.od10Dropped` with how many had another price); the
  lower levels' start − 10 rows are not covered. Otherwise api-tennis's stored Pinnacle price (`r[8] = 2`, book "A"; hover "Pinnacle snapshot from api-tennis, no timestamp, not a confirmed close",
  `SF_APPROX_HOVER`) — 13 Jan – 12 Apr always (no archive exists). Both count as ONE book in every Database figure,
  "Pinnacle (approx.)" in `meta.bookCounts` (codes 2 + 5), `meta.approx.sources.od` / `.at` name each with its count and
  hover. Order per row (founder 2026-10-30): Tennis-Data Pinnacle > our archive's close (E included) > api-tennis >
  Tennis Explorer (book 8, any date; also the one source for a start − 10 dash) > Bet365 (every date while `B365_INTERIM`
  holds) > a dash. Book 8 counts in the same "Pinnacle (approx.)" bucket (`meta.bookCounts`) and is named apart in
  `meta.approx.sources.te` (used, over Bet365, filled a dash, filled a start − 10 dash); the footnote, chart note and
  Player split name it with its own count, never inside the dated 13 Jan – 16 Sep sentence. **Test:** `tools/test-b365-window.mjs` (every surface: Database, master, tour-baselines, Market edge,
  Favourites, the page join). The
  footnote, the chart note and the Player split name the snapshot with its count; no feed = nothing changes. *Known:* the
  header sentence ("Pinnacle closing, else Bet365, per match") is unchanged (the 120-character cap) — the footnote carries
  the disclosure. Market edge / Form / H2H tab closes (`FH_BOOK_ORDER`) do not read it. **Test:**
  `tools/test-approx-pinnacle.mjs` (start − 10 first, api-tennis fallback, the fold, each hover, an old feed refused).
- **Book 7 = api-tennis's Bet365 snapshot; the join's event test reads the Database's own city map (founder brief 2026-10-19).**
  A lower-level or `atp-x` era row priced on api-tennis's stored Bet365 carries `r[8] = 7`; the join reads it as book "B", src
  `atb`, hover `FH_B365_AT_HOVER` ("Bet365 (approx.) · Bet365 snapshot from api-tennis, no timestamp, not a confirmed close").
  No Database figure reads it (era shard). The round-tolerance pass's event test also accepts the city `DatabaseTab.tdCity`
  gives a Tennis-Data sponsor name ("Adelaide International 2" → "Adelaide 2"), so Kwon's lucky-loser run (Adelaide 2 2023,
  filed "Qualifying" by api-tennis) meets its Tennis-Data rows. **Test:** `test-ten402-b.mjs` "round tolerance" (+ control),
  `tools/test-approx-pinnacle.mjs`, `tools/test-close-label.py`.
- **Book 8 = Tennis Explorer's Pinnacle (founder 2026-10-19, steps 0-3; switched ON 2026-10-20 after the calibration: median 0.10pp on 988).** A lower-level or `atp-x` row priced on a `Tennis Explorer · Pinnacle` snapshot carries `r[8] = 8`; the join
  reads it as book "A", src `te`. It prices a match only where no close, start − 10 or api-tennis Pinnacle snapshot does (founder
  2026-10-20 order). **One fixed hover, no time** (founder 2026-10-19): every Tennis Explorer price reads exactly
  "Pinnacle (approx.) · Tennis Explorer, last pre-match price, not a confirmed close" (`SF_TE_HOVER`). The last-change time
  stays in the archive (`price_ts`) and no page, feed or shard carries it. A price whose last change came after the start is
  never stored (`odds.md`, in-play rule). No Database figure reads book 8. **Test:**
  `tools/test-approx-pinnacle.mjs` (the exact words, no time anywhere on the page), `tools/test-lower-master.js` (book 8's rank,
  Database byte-identical, the era shard's shape unchanged, mutant), `tools/test-tdarch.py` (switch on, order, in-play rule).
- **Book 10 = Tennis Explorer's Bet365 (founder 2026-10-30).** Join-only (era shard, flag `l`): never a Database row, figure,
  ROI or tour baseline, so `database-yield.json` and `tour-baselines.json` are byte-identical with and without it. On the ATP
  main draw it fills only a match the Database shows as a dash (`meta.lower.teB365MainDraw`: offered / kept / notADash). The
  join reads it as Bet365 `B` + `teb`, hover `FH_B365_TE_HOVER` (`odds.md`). **Test:** `tools/test-te-b365.js`.
- **Retirements settle through settlement.js (founder ruling 2026-10-25, round 2 item 1.3; replaces the 2026-09-20 "void
  them" and 2026-10-08 "behind a flag, no Database figure" rulings).** Two rules, two functions, one module (`settlement.js`,
  UMD, `window.Settlement`): **yields / ROI / units → `settleBet`** (Pinnacle rules: a retirement after the first set was
  completed stands on the result; before it void; no set scores = no units, never guessed; a walkover void); **win rates →
  `matchWinner`** (the official ATP result: every retirement counts; walkovers never). The store keeps retirements out of
  `rows`, in `retRows` / `retNames`, each with `retComment` and `retFs` ('c' / 'i' / 'm', from `build-market-edge.js`
  `firstSetLookup`: started-evidence, else the players' career rows — the lookup Market edge uses). Every Database figure,
  `tour-baselines.json` and `tournament-market.json`'s ROI read the **figure rows** = `rows` + the retRows `settleBet` lets
  stand (`meta.settlement`; the page's `dbFigureView`, rows first then retRows order); `tournament-market.json` favRel reads
  `rows` + every retRow `matchWinner` gives a winner (its own n, `nRel`); the price join still reads the raw store and settles
  each surface through `MarketEdgeCore.retSettlement` → `settleBet`. A started "Awarded" / "Disqualified" settles on the
  result in yields (settleBet null, as Market edge always did) and is out of win rates (matchWinner null). Measured on the
  deployed store 25 Oct 2026: 1,313 retRows → 652 stand, 115 void, 538 no set scores, 8 started; Tour Favourites −1.72% →
  −1.97%, Underdogs −6.81% → −5.95% (41,238 → 41,898); tour favRel 70% (41,238) → 69% (42,543). **Test:**
  `tools/test-settlement.js` (rules, a fixture build of the Database / tour baselines / tournament market / odds performance,
  the source guard, 10 mutants); `test-ten242-rulings.mjs` "every ROI card equals the panel" (two populations) and
  "retirements settle through settlement.js".
- **Test:** no chart draws a seam line, a Bet365 pill or a "book artefact" footnote; `renderCurveCard` takes no seam.
  The per-book split paragraph is on the **Player tab only** and opens with the join (founder, card 52bf5cc5
  "split" = player-only, 2026-10-08). **Test:** a Tour or Tournament band panel paints no `db-split` line
  (`test-ten262.mjs` STALE.split).

## Header card
- The shared 35b page header (founder shell refresh TEN-403, 2026-10-08; supersedes card 52bf5cc5's caps line and 29/800
  title — values in `app-shell.md` "Page header (35b, TEN-403)"). **Test:** no caps line, title "Database", ONE plain line
  13px `--text-soft` (no bold / white run; founder R1 item 7) with no seam sentence, years with an en dash ("2010–2026"),
  mono stats right, ONE value each: Matches (whole archive on the join, ignores filters) · Seasons · Updated (the
  archive's last date). Once that date is more than 14 days old the sentence's grey tail (`.sfh__tail`) adds
  "· updates pending" — nothing sits under the Updated date (R1 item 7 SUPERSEDES the note under Updated). Both mounts
  (standalone + ROI overlay) paint through the same `renderChrome()` / `dbHeadStats()` (`test-ten262.mjs` archive stamp).

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
  Long shot To (`1.88` / `3.75+`; Hangzhou Open `2.04` / `3.05+` on the archive to 13 Sep, `2.00` / `3.00+` to 6 Oct; Wimbledon `1.95` / `5.57+`); Favourites All = Heavy
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
- **Compare events · "All matches" counts each match once** (founder 2026-10-23). The cumulative-profit curve and its
  legend units add `(fav + dog) / 2` per match, as the design's `yieldOf`; the both-sides sum counted every match twice
  (Australian Open −457u → −228u on the 22 Oct store). **Test:** is the All-matches end value Σ (fav + dog) / 2 over the
  event's rows? `test-ten399-b.mjs` "counts each match once" (mutant: the sum → red).

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
