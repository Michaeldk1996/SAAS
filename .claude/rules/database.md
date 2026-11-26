# Database page — Tour · Tournament · Player · Fade finder · Lines · Ratings (Database v3, founder 2026-11-18)

Applies to `window.DatabaseTab` in `bsp-consult-dashboard.html` (shell, filter card, the six views, the cumulative chart,
the pop-up boxes). **Design = `design_handoff_database_v3/` (`CHANGES_2026-11-18.md` first, then `reference/Database.dc.html`,
then `README.md` / `CHARTS.md`), pixel for pixel, identical colours** — the founder's export of 2026-11-18 and his review of
the live page the same day. It replaces the v2 export of 2026-11-16 where they differ. The design's own colours are
`--db2-*` in `tokens.css` (`--db2-layer` #121521, `--db2-hover` #171B28 added 2026-11-18), mapped onto the foundation surfaces
inside every mount (`[data-db-root]`). Ratings and Lines rules: `ratings.md`, `lines.md`. **Test:** `test-database-v2.mjs`
(each rule with a mutant), `test-ten399-database-frame.mjs` (bar + chart), `tools/test-lines-field-cuts.mjs`.

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
- **Tennis Explorer's Pinnacle ranks above api-tennis's on the ATP main draw** (founder 2026-11-16, "use the Tennis
  Explorer download to have the Pinnacle close"; replaces 2026-10-30's "api-tennis > TE"). Order per row: Tennis-Data
  Pinnacle > our archive close > E > Tennis Explorer Pinnacle (book 8) > api-tennis Pinnacle (book 2) > Bet365 > a dash.
  Tennis Explorer carries the time of Pinnacle's last change and passed the in-play rule; api-tennis's snapshot carries no
  time. Labelled a close (founder 2026-11-16, "call it a close"): the join reads book 8 on the ATP main draw as P / `tec`,
  "Pinnacle close · Tennis Explorer, last pre-match price"; a lower-level row (flag l) stays A / `te`. Switch `TE_OVER_API`
  (`build-database-yield.js`), counted in `meta.approx.sources.te.overApiTennis`. The 13 Jan – 12 Apr 2026 ATP main draw
  (758 matches on api-tennis's snapshot) is downloaded by the `atp-md-approx-*` batches (stennisfy-ops). **Test:**
  `tools/test-approx-pinnacle.mjs` "TE ranks above api-tennis Pinnacle" (mutant: the switch off).
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

## Filter card (CHANGES §1)
- **Test:** one card (`--db2-card`, 1.25px 6% edge, radius 14, padding 6×26). Rows `104px 1fr`, the View row adds the blue
  **Reset filters** at its right end (12.5/600, the only reset on the page). View tabs, in this order: **Tour · Tournament ·
  Player · Fade finder · Lines · Ratings** (6×16, 13px; selected `--db2-raised` + 16% edge, 700; idle muted 600).
- Filter triggers 36px, padding 0 10px, gap 6: grey 12/500 label · 13/600 value · the CSS chevron; picked = `--db2-raised` +
  16%, then a 1px 12% divider and the DRAWN remove cross (22px, radius 6; never a "×" glyph). Years = one plain box "Years
  2010 to 2026". No rolling windows (Last 52 weeks / 24 months) on this bar.
- Filters per view: Tour and Fade finder = **Level · Surface · Round · Swing · Years**; Tournament = event search
  (1–4 chips) · Level · Surface · Round · Years; Player = player search (1–2 chips) · Surface · **Years + Last 52 weeks · Career** · **Level · Round**
  (founder 2026-11-19: tournament type and round, on his rows and the tour beside them) · Tournament · Side;
  Lines and Ratings in their files.
- **Swing** = the 13 swings of the Player Profile's swing calendar ("Team / other" left out), ONE rule with the profile:
  `PlayerProfileV2._internals.calSwingOf` over the match month, its surface, Tennis-Data's own court and the event's
  country (`db3SwingOf`). **Country** = the site's tournament catalog (`TOURNAMENT_CATALOG`, through `sfEventKey`) for the
  Tennis-Data name or its city, else the host city's country (`DB3_CITY_CC`, geography); **indoor** = `meta.indoor`
  (`build-database-yield.js`: the seasons in which most of an event's rows carry Tennis-Data's Court = Indoor), else the
  catalog. Founder 2026-11-20: the lookup used to read the Database's own name list, which carries no country or court, so
  every February match outside Australia read as Middle East (Dallas, Delray Beach, Acapulco, Montpellier). **Test:** does a
  February Dallas / Delray Beach / Acapulco row read North American winter, Dubai in March Middle East, Montpellier Euro
  indoor? (`test-database-v2.mjs` "swing", `test-pp2-reconcile.js` "North American winter swing"). **No Tour (ATP / Challenger / ITF) filter** (founder 2026-11-19, replacing the 2026-11-18 greyed
  menu): the Database holds ATP main draw only, so there is nothing to choose. **Test:** the Tour bar has Level · Surface ·
  Round · Swing · Years and no Tour trigger (`test-ten399-database-frame.mjs` "caret").
- Search with chips: well `--db2-inset`, radius 9; chips 26px, radius 6, `--db2-raised` + 16%, **a player chip carries a
  20px avatar** and every remove cross is drawn (18px). The player search pop-up: a caps "Players  N" head, each row a 24px
  ringed avatar, the name and "#rank". **Every player avatar is his photo when he has one** (founder review 2026-11-18): the
  one resolver `playerPhotoImg` by the key the name joins to (`db2Who`; the ratings roster's own key on Lines / Ratings),
  initials only when no photo exists.

- **A broken Tennis-Data Pinnacle pair falls through** (founder 2026-11-11, "find the closest price"; odds.md "Suspended
  market"): a `psw` / `psl` pair adding up to more than 115% (Marseille 2015 final, 1.58 / 1.58) is read as missing, so the
  match takes the next source (our archive close, api-tennis, Bet365 as the join's "B") instead of leaving the Database
  whole; `meta.exclusions.pinnacleBrokenFellThrough` counts them. **Test:** `tools/test-approx-pinnacle.mjs` "broken".

## Tour
- **Fixed price bands** (founder 2026-11-16): Favourites = Heavy favourite 1.01–1.20 · Clear favourite 1.21–1.35 ·
  Favourite 1.36–1.50 · Slight favourite 1.51–1.70 · Near coin-flip 1.71–1.94; Underdogs = Slight
  underdog 1.95–2.49 · Underdog 2.50–2.99 · Big underdog 3.00–3.99 · Long underdog 4.00–5.99 · Longshot 6.00 + (`DB2_BANDS`).
  **Near coin-flip is a favourite band only**; the underdog bands start at **1.95** (founder 2026-11-26, replacing 2.00 —
  the one ladder, `modal-market-edge.md` "Bands"); an underdog priced under 1.95 or a favourite at 1.95+ (45 of 82,574
  sides) counts in the side's total and in no band row, the count on the headline's hover. Edges are half-open (an archive close of 1.357 is a Clear favourite). **Test:** every
  favourite price under 1.95 lands in exactly one band; an underdog price under 1.95 lands in none (`test-database-v2.mjs` "bands").
- **Band cards (CHANGES §2):** two section cards (24/26/10, radius 14). Head: title 18/800 over the 13px hint ("Back the
  shorter / longer price") | the side's yield 26px over "N matches · median price X" (+ " · tour Y"). Columns Odds · Yield
  (Event / Player) · Matches (· Tour); a row (min 64px, hover `--db2-hover`) = the odds 19px mono low · grey dash · high over
  the band name | the **yield line** (4px track, a segment from the centre, right green / left red, the chip on the centre)
  | Matches 14/700 | (Tour 13) | blue ›. **No Median column.** Every row opens the band box (§3).
- **A yield shows from 1 match, green or red** (founder 2026-11-19, "we need information and not dashes"; replaces the
  HARD_GATE dash of the export's CHANGES §0 and the 2026-11-18 grey): every band row draws its yield line and chip, with
  its record (W–L) under the match count; under 30 the row's hover says "Small sample: n matches". The band box's four
  tiles fill from 1 match (Yield sub "Small sample"; Rank among the bands with matches); the player head, the compare tiles
  and band rows likewise. The cumulative chart draws a line from 2 matches. The Fade finder still ranks from 30 matches
  (fewer = unranked at the bottom, their figures shown). **Test:** `test-database-v2.mjs` "yieldColour" (+ mutant).
- **The Tour column is always computed** (founder review 2026-11-18: "compare vs tour, fix it"; replaces "only while round
  and years are untouched"): the tour baseline is rebuilt over the Database rows under the SAME round, years, level,
  surface, swing and tour filters (`tourBaseIndex` keyed by `tbKey`), on the same bands and the same settlement as the
  figure beside it; its n is on the hover. **Test:** "tourUnderFilters" (+ two mutants).
- **The band box (CHANGES §3):** a pop-up (overlay `--db2-scrim` 72%, box max 900, radius 14, `--db2-shadow-box`): head =
  odds 22px + band name 18/800 over the scope line | drawn close cross; four centred tiles Yield · Win rate ("won n · lost
  n") · Market expected (implied from the band's median price, "+x pts against the price") · Rank (bands with 30+ matches);
  under 30 Yield and Win rate are dashes; then "Matches in this band": Date · Match (backed player bold v opponent) · Event ·
  Rd · Score · Price · Result pill · Return, newest first, 12 then "Show 12 more matches". **Score is a dash** (the Database
  archive holds no set score; the hover says so). On Player the backed name is the player, or his opponent when fading.
  **Every match row opens the one match stats sheet** (founder 2026-11-19; the band box and the fade box): the backed
  player's career-history row of that match (same result, opponent surname, match day ±2 for a feed row, event start up to
  16 days before for an archive row, nearest wins) through the profile's hand-off `pp2OpenMatchSheet`, priced with the
  Database's Pinnacle close; no career row = the sheet on the Database's own facts. Escape closes the sheet, then the box.
- **Cumulative return chart (CHANGES §4, LOCKED; replaces the dated x axis of 2026-11-16):** "Cumulative return" over "Flat
  1% stake on every match, as % of bankroll" | legend + "?". **x = the match number** (date order, stable tie-break, one
  equal step per match), ticks "Match 1 · n · n · n · N matches" + the caption "Matches, in the order played"; **y in %**
  (steps 0.5 → 2,500, at most ~8, zero always labelled) in a 52px gutter; **seasons = a segment bar above the plot** (one 4px
  16% bar per season placed at its first match, the year centred over it; one season = one full bar; a year label needs
  34px of its segment), 20px clear of the plot; **plain background** (the zero line, 32% 1.25px, is the only line behind
  the curves; no grid, no wash, no area); "Break even" at the right end of the zero line, above when 30px+ is clear and no
  curve is there, else under, else hidden; end plates in % (one decimal under 10), pushed apart. **Under 30 settled
  matches on every line: no chart, one sentence** "Too few matches for a return line. Widen the filters." One builder
  (`db3Chart`) draws Tour, Tournament, Player and the compare chart. **Test:** `test-ten399-database-frame.mjs` "seam",
  `test-database-v2.mjs` "dates". **Display smoothing = the export's** (founder 2026-11-19, "use export smoothing"; replaces the 'guarded' mode of TEN-196,
  gate e8453243): `SMOOTH_MODE` 'sample-first' — a series longer than the vertex budget is cut into equal buckets by
  index, each drawn at its mean, then a centred ±3 moving average (`smoothVals`); both ends are the raw values, so the
  line lands on the printed end value. The y axis is built from the line as drawn. **Test:** does a drawn line end off its
  plate's value, or does the axis reach past the drawn line by more than one step? Then it is wrong.
- **"How this is built" and the disclaimer live in the "?" hovers** (founder 2026-11-16).

## Tournament
- One event = the Tour cards (with the Tour column) and the chart. **Two events (pair compare, CHANGES §5):** the summary
  card with the two heads (**no remove button**: removal lives in the filter chips) and per side three centred tiles
  Favourite yield · Underdog yield · Best price band (`--db2-card` + 9% edge, radius 11); the compare chart (§4 rule 11: no
  season bar = the seasons of the line with the most matches (founder 2026-11-19, over the export's "no season bar"); the
  axis is the longest event's match count; a shorter line and its end dot STOP where its matches run out);
  then one "Yield by price band" card per event (rows 60px, `132px minmax(0,1fr) 48px 8px`: odds 17px over the band name |
  the yield line | matches | ›), each row opening the band box with the event's name first in its scope line. Three or four
  events = the aligned table + the chart.
- **Tournament logos** (founder 2026-11-16; breathing room, founder review 2026-11-18): the self-hosted file
  (`tournament-logos/index.json`) sits 6px inside its 44px tile, `object-fit: contain`, never stretched; the export draws no
  inset (a named divergence by the founder's request). Initials when no file.
- **Best price band** = the highest band yield among bands with at least `DB2_BEST_MIN` = **20** matches (founder
  2026-11-16). **"All matches" counts each match once:** `(fav + dog) / 2` per match (founder 2026-10-23).

## Player
- One player: head card (24/26; 60px avatar, no ring (founder 2026-11-19); photo and "ATP #n" only when the Tennis-Data name joins exactly one
  ranked player), tiles All matches (tour figure under the same filters) and Record (`--db2-card` + 9% edge, radius 11 —
  one tile colour, CHANGES §0/§6), "Compare with" = the five best-ranked players this week who have Database rows
  (`--db2-layer` + 8% edge chips, hover `--db2-hover` + 22%, a photo on a `--db2-inset` disc). Band cards As favourite / As
  underdog on HIS price, with the Tour column. The chart: x = his match number over every match in view, each line stepping
  on its own matches. Side = Backing him / Fading him flips every figure; fading hides the Tour column. Two players = the
  pair compare above with circle avatars.
- **Record under the match count** (founder design 2026-11-20, every band card): the band's W–L under its count (Plex
  11.5/600 `--db2-ink-2`, right aligned, 4px under), hover "70 won · 3 lost · 96% won"; fading = the bet's own record. The card
  head reads "363 matches · 251–112 · median price 1.44", the record over the same matches as the count. **Test:** do the two
  record figures add up to the count beside them? They must.
- **Years + Last 52 weeks · Career** (founder design 2026-11-20, replacing the Period menu): the shared Years range (the same
  `yearMin` / `yearMax` the Tour, Tournament and Fade finder read, as the design shares it) and a two-option switch (track
  `--db2-track` + 10% edge, r10, pad 3, 36px; picked `--db2-layer` + 14% ring, white 700; idle `--db2-ink-2` 600; 12.5px, r7,
  0 12px). Career (default) resets the years; Last 52 weeks greys the year figures and counts the 364 days to the archive's
  last match; picking a year turns both options off. The label reads "Career", "Last 52 weeks", "Season 2024" or "2019–2023".
  **Test:** `test-database-v2.mjs` "playerPeriod".

## Fade finder (CHANGES §7; founder export 2026-11-18)
- "Which players should I bet against in this round?" Sixth tab, after Player; opening it with no round chosen presets
  Round = 1st Round. The Tour filter bar. **Every figure is the Database's own rows** under those filters (Pinnacle closing):
  per player, a flat 1% stake on his opponent (To fade) or on him (To back), All · As favourite · As underdog by the shorter
  price of the match. **The list = players with a Database match in the 24 months to the archive's end** (the export lists the
  current tour; built 2026-11-18, the founder to confirm); his whole filtered record counts. **A player is listed from
  FADE_MIN = 5 matches under the filters, and every listed player is ranked** (founder 2026-11-20: "a sample start of 5
  matches … not list players with 1 match"; replaces the unranked under-30 block). **24 months** = the same filters over the
  24 months to the archive's last match. **Vs price** = the backed side's win rate minus the mean implied chance of its
  closing price, in points ("lost 41% · priced 33%"). Opp. price / His price = the backed side's mean closing price.
- The card: "Players to fade / back" over the scope line (filters only) | "N players ranked" + "?" (every explanation).
  Controls on one line: the pin search (well, max 320px), To fade · To back, All · As favourite · As underdog. Table grid
  `26px minmax(140px,1.1fr) minmax(100px,1.3fr) 90px 122px 68px 54px 14px`, min 684px; 12 rows, then "Show all N players".
- **Today:** a player with a match on today's board (`matches`, `matchDayBucket` = today, not finished, his key from `db2Who`)
  reads a blue dot + "Today" + the time under his name; a click opens that match (`openAnalysisModal`).
- **Pin:** a pick from the search pins the player: a chip in the well, his row first and lifted (`--db2-layer` + 14% ring,
  "PINNED", his real rank, a drawn cross to unpin), gone from the list below.
- A row opens the fade box (band box anatomy): Yield fading / backing him · He lost / won (his record) · Market expected ·
  Rank; "Open in Player ›" jumps to the Player view with the player and Side preset. **Window switch in the box** (founder
  2026-11-19): All · Last 52 weeks · Last 24 months recompute the tiles and the list from his matches in that window; Rank
  stays his place in the list (whole period). Its match rows open the sheet like the band box.
- **Filters (founder 2026-11-19):** All ranks · Top 25 · Top 50 · Top 100 (this week's ATP ranking) and Any day · Plays
  today · Plays tomorrow (a match on Today's Matches; the row says "Today" / "Tomorrow" + the time). **12 months and 24
  months** columns: the same bet over the 12 / 24 months to the archive's last match, each with its count.

## Formatting
- **Test:** yields 2 dp with sign, `pp` deltas, units, all with a true minus `−` (`fmtPct`, `fmtPP`, `fmtU`);
  thousands separators; en dash in records.
