# Database page — Tour · Tournament · Player · Lines · Ratings (Database v2, founder 2026-11-16)

Applies to `window.DatabaseTab` in `bsp-consult-dashboard.html` (shell, filter card, the five views, the cumulative
charts). **Design = `design_handoff_database_v2/` (README + `reference/Database.dc.html`), pixel for pixel, identical
colours** — the founder's brief of 2026-11-16 and his ruling "follow the design" on the conflicts it raised (fixed price
bands, the dated "flat 1% stake" chart, Lines favourite / underdog and price bands, Ratings one period with Last 52 weeks
first, no Mental Edge board). The design's own colours are `--db2-*` in `tokens.css`, mapped onto the foundation surfaces
inside every mount (`[data-db-root]`), as the Tournaments tab and Player Profile do. Ratings and Lines rules: `ratings.md`,
`lines.md`. **Test:** `test-database-v2.mjs` (each rule with a mutant). Step-1 evidence (checklist, feasibility, the
reference screenshots): `design_handoff_database_v2/step1/` (never published).

## Price join — one join, no seam
- **Test:** every row of `database-yield.json` is priced on a Pinnacle price, per match (founder ruling 2026-10-30, replacing
  the 2026-10-26 interim that kept Bet365 "B" rows in the Database): a Bet365-only ATP main-draw match is a Database dash and
  the join's "B" (era shard, flag `b`). `B365_INTERIM` now only decides whether such a row reaches the join at every date
  (on) or only for 1 Jan – 30 Apr 2026 (off); either way it is never a Database row. **Test:** `tools/test-b365-window.mjs`,
  `tools/test-te-b365.js`. (Before the ruling: Tour = Favourites −1.78% · Underdogs −6.96% on 40,972 matches, measured
  2026-10-07, Bet365 rows included.)
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
  Tennis Explorer (book 8, any date; also the one Pinnacle source for a start − 10 dash) > a dash in the Database (Bet365
  is the join's "B" only, founder 2026-10-30). Book 8 counts in the same "Pinnacle (approx.)" bucket (`meta.bookCounts`) and is named apart in
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
- **The ATP main draw is Pinnacle only (founder ruling 2026-10-30).** No Database row, figure, ROI, tour baseline or
  Tournaments figure carries a Bet365 price (book 1, or 10 = Tennis Explorer's Bet365); a match with no Pinnacle price is a
  Database dash. Its Bet365 price rides the era shard behind flag `b` — read by the price join only, so Market edge, Derived
  lines and every other page show it as "B" (`odds.md` "Price sources by page and level"). The Database header reads
  "Pinnacle closing only" while no Bet365 row is in its figures. `meta.bet365OutOfDatabase` counts the moved rows by year and
  book. Before 2010 (the `p` rows) nothing changes. **Test:** `tools/test-te-b365.js`, `tools/test-b365-window.mjs`.
- **Join-only ATP main draw — flag `j` (founder 2026-11-11, relayed by the Pinnacle-close session: "look for other books …
  we just need a price here since they don't come into the ROI database").** An ATP main-draw match the live site showed
  unpriced may be priced from its Tennis Explorer page, by TE match ID (stennisfy-ops `pre21-md-NN` batches, level
  `pre-atp-md` → `atp-mdj`; Pinnacle, else Bet365, else another book with its margin removed; the TE page start and the
  te-history result, as every pre-2021 row). It rides the era shard behind `j`: read by the price join only — never a
  Database figure, ROI, tour baseline, Market edge (`build-market-edge.js` skips `j`) or odds-performance row (`[tlj]`).
  A priced Database row of the same match wins and the `j` row is dropped (`meta.lower.mdjHasTd`). **Test:** does a `j` row
  change any Database file, ROI, baseline or Market edge yield? It must not — `tools/test-lower-master.js` "atp-mdj",
  `tools/test-tdarch.py` "pre21-md".
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

## Filter card (design L41-251)
- **Test:** one card (`--db2-card`, 1.25px 6% edge, radius 14, padding 4×18). Rows `104px 1fr` (+ `auto` on the View row),
  gap 14, padding 12×0, a 6% rule between rows, caps label in the first track. View row: the darker track (`--db2-inset`,
  6% edge, radius 10, padding 3) with **Tour · Tournament · Player · Lines · Ratings** (6×16, 13px; selected `--db2-raised`
  + 16% edge, 700; idle muted 600) and one blue **Reset filters** at the right end (12.5/600, hover `--db2-blue-hov`).
- Dropdown triggers: grey 12/500 label · 13/600 value · × once picked · the CSS chevron (`.db-caret`, 6px, 1.5px muted
  borders, rotated); transparent on a 6% edge, picked = `--db2-raised` + 16%. Year range = one transparent pill "Years
  2010 to 2026", mono 12 years. Menus `--db2-card` + 10% edge, radius 10, padding 4, `0 12px 28px` black 45%; rows
  12.5/500, picked 6% white + 700, hover `--db2-inset`. Search with chips: inset box on a 6% edge (16% while typing), chips
  `--db2-raised` + 16%, 26px, cap note grey ("Four events maximum", "Two players maximum", "Three players maximum").
- Filters per view, as the reference draws them: Tour = Level · Surface · Round · Years; Tournament = event search ·
  Round · Years; Player = player search · Surface · Period · Tournament · Side; Lines and Ratings in their files.

- **A broken Tennis-Data Pinnacle pair falls through** (founder 2026-11-11, "find the closest price"; odds.md "Suspended
  market"): a `psw` / `psl` pair adding up to more than 115% (Marseille 2015 final, 1.58 / 1.58) is read as missing, so the
  match takes the next source (our archive close, api-tennis, Bet365 as the join's "B") instead of leaving the Database
  whole; `meta.exclusions.pinnacleBrokenFellThrough` counts them. **Test:** `tools/test-approx-pinnacle.mjs` "broken".

## Tour
- **Fixed price bands** (founder 2026-11-16, replacing the terciles of TEN-399 / card ff586600): Favourites = Heavy
  favourite 1.01–1.20 · Clear favourite 1.21–1.35 · Favourite 1.36–1.50 · Slight favourite 1.51–1.70 · Near coin-flip
  1.71–1.99; Underdogs = Near coin-flip 1.71–1.99 · Slight underdog 2.00–2.49 · Underdog 2.50–2.99 · Big underdog
  3.00–3.99 · Long underdog 4.00–5.99 · Longshot 6.00 + (`DB2_BANDS`). Edges are half-open, the Player Profile's MK_BANDS rule:
  a band runs from its From up to, not including, the next band's From (an archive close of 1.357 is a Clear favourite).
  **Test:** every price lands in exactly one band (`test-database-v2.mjs` bands; measured 16 Nov: no favourite at 2.00+,
  no underdog under 1.71). The bands are a display grouping of the same rows; yields, gates and populations are unchanged.
- Band card (design L1018-1059): caps hint "Back the shorter / longer price" + title 18/800; right the side's yield 26px
  mono (green / red) over "N matches · median X" (+ " · tour Y" on Tournament / Player). Columns Band · From · To · Median
  · Matches · Yield (Event / Player) (+ Tour), `minmax(120px,1fr) 50 52 52 58 70` (with Tour `minmax(96px,1fr) 46 50 50 54
  66 62`). Gates SOFT_GATE 100 (yield muted 500) / HARD_GATE 30 ("n=N — too few matches for a yield", 11px; a Player
  cell an en dash). The Tour column shows while round and years are untouched, else a dash and the note "Tour baselines are
  not computed for these filters."
- **Cumulative return chart:** "Cumulative return, flat 1% stake" + the 22px "?" (1 unit = 1% of the bankroll, so the
  figures are the same units; only the words changed); x = the **real match date** (1 January of the first season to the
  last match; season ticks on 1 January, every 4 / 2 / 1 years); plot 400px; Favourites `--db2-blue` 2.4px, Underdogs
  `--db2-ink-2` 2px; 12% dotted guides, 32% break-even 1.25px; end plates `--db2-raised` + 16%. **Test:** "dates".
  Display smoothing (`SMOOTH_MODE`) is unchanged and lands on the printed end value.

## Tournament
- One event = the Tour cards with the Tour column. Two events = the summary card (logo slot = the event's initials, a
  neutral tile; never a mark), the chart with its All matches · Favourites · Underdogs switch, and one band box per event
  (yield 800 when better than the other event). Three or four = "Best for favourites / underdogs" tiles, one aligned table
  (the row's best on a 13% white pill) and the chart. Series: blue, ink, `--db2-grey3` dashed 6 5, ink dashed.
- **Best price band** = the event's highest band yield among bands with at least HARD_GATE matches (a thinner band is not
  a yield). **"All matches" counts each match once:** `(fav + dog) / 2` per match (founder 2026-10-23; test "compareOnce").

## Player
- One player: head card (60px avatar, blue ring; photo and "ATP #n" only when the Tennis-Data name joins exactly one
  ranked player — the archive name table, else surname + first initial against this week's standings; else initials and
  "ATP #—"), tiles All matches (tour figure recomputed under the same filters, PLAYER_BASELINE_SCOPE 'recompute') and
  Record, "Compare with" = the five best-ranked players this week who have Database rows. Band cards As favourite / As
  underdog on HIS price, with the Tour column (whole archive, same filters, same band). Two-line chart As favourite / As
  underdog, real dates, end labels signed 1 dp. Side = Backing him / Fading him flips every figure; fading hides the Tour
  column. Two players = the Tournament two-event page with circle avatars. **The "Split by book" strip is gone** (the
  Database holds no Bet365 row since 30 Oct).

## Formatting
- **Test:** yields 2 dp with sign, `pp` deltas, units, all with a true minus `−` (`fmtPct`, `fmtPP`, `fmtU`);
  thousands separators; en dash in records.
