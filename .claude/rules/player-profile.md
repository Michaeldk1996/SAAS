# Player Profile page: founder rulings

Applies to the Player Profile page: the TEN-206 renderer (`player-profile-v2.js`, mounted from
`bsp-consult-dashboard.html`), the only player profile since the legacy renderer was retired (2026-10-21).
Restored from CLAUDE.md before 011e3e20 (2026-09-21 trim); TEN-312 N13, founder-approved 2026-09-28.
Newer rulings that also bind the profile: `modal-analysis.md` "Walkovers and retirements" (the TEN-8
"W/O received = win" rule is superseded on the profile too) and "Overview career spine"; `modal-market-edge.md`
(player-profile Market edge basis).

- **No legacy fallback (founder, 2026-10-21).** The TEN-206 renderer is the only player profile: the legacy
  full-page view (`buildPlayerProfileHtml`, `ppCareerYears`) and its `?pp2=0` / `stennisfy.flags.pp2` switch are
  retired. A profile that cannot paint — the module did not load, or its mount refused or threw — shows
  "Couldn't load this profile" and a Retry (a missing module is fetched again first), nothing else.
  **Points at Risk is retired with it** (TEN-172/173: the tile, its breakdown drawer and the profile's
  `points-at-risk.json` loader lived only in the legacy view); no profile shows a Points at Risk figure.
  **Test:** force a failed mount — the view holds only that message and Retry, no digit, and a lazy repaint
  leaves it (`tools/test-pp-load-error.mjs`).
- **Player Profile — export parity (founder ruling 2026-08-01).** The Player Profile page
  (`buildPlayerProfileHtml`) drops three intentional enrichments the export lacks. **(1) No "Surface record"
  rail card** — the Layer #4A career + rolling-52-week per-surface card is removed; the left rail carries
  only the **Surface performance** bars. **(2) Recent form is a flat, most-recent-first list** — one row per
  match, labelled inline with its tournament, **not** grouped under per-tournament headers (tournament
  grouping stays only in the modal Form tab). **(3) The header archetype line is a single archetype label**
  (e.g. `All-Court Elite`, or a composed `A / B`) with **no appended "· <surface> Specialist" tag**, coloured
  **primary text** — never brand blue (Blue rule). These are the **fourth** export-has-not / product-had
  divergence resolved toward the export, alongside Extra-stats, the Summary view and the H2H trend.
  *Colour value (TEN-376 foundation):* primary text is `--text`; every colour is a `tokens.css` token.
  *Scope note:* this ruling named `buildPlayerProfileHtml`, retired 2026-10-21. Whether the three parity points
  bind the TEN-206 renderer has not been re-ruled.
  **Test:** the profile rail has no "Surface record" card; Recent form shows no tournament group headers;
  the archetype line is one label in primary text, not blue and with no Specialist suffix.
- **Recent form counts the Form list** (founder TEN-383, 2026-10-04): Laver Cup and exhibitions are never a Recent form
  row — the ribbon (rate, strip, chips) and the full ledger, in both renderers; Davis Cup and United Cup stay; records keep
  every match. Rule and test: `modal-form-h2h.md` "A Laver Cup match never becomes a Form row".

- **Per-event Backing = the ONE price join across the site (founder ruling 2026-10-08, TEN-402 card 01102d24;
  supersedes Q8's "the Match analysis Tournament tab's rows" and the 2026-10-07 "keep the tab join").** Record per
  tournament → each event's Backing column, the "Backing him here" tile (units, and "+Y.Ypt vs market" from 5 priced),
  the box-3 headline and every edition row's H / A are ONE model (`trProfileModel`, read by `trProfileBacking` and
  `trProfilePriceOf`): the event's main-draw rows (walkovers and qualifying out) resolved to career-history and priced on
  the **Database join** — `database-yield.json` rows plus the retirements behind its flag (`DatabaseTab.priceRows()`),
  Pinnacle closing, else Bet365 closing, per match, through the Head to Head page's `h2hPriceJoin` — flat 1u, **a
  retirement settled on Pinnacle rules** (founder 2026-10-22). Never the closes shard (`match-closes/`), never the market-edge
  shard's attribution or price. A row the join lacks (no career-history row, no archive row) is `—`; an exact price tie is priced at the tie since the
  founder ruling of 2026-10-16 (`tieRows`, `database.md` "Price join").
  The Head to Head page's Tournament card reads the same model, so both print the identical figure (Alcaraz, US Open
  +7.1u / 32 priced on 8 Oct 2026). The Match analysis Tournament tab (`trModelFor`) prices on the same join since the
  founder ruling of 2026-10-09 (card 7bc622d5; `modal-analysis.md` "Tournament tab → Prices"): for an event whose match
  lists agree, its Backing equals this column (Alcaraz, US Open +7.1u / 32 on all three surfaces, 9 Oct 2026). Apply: on a profile event, sum flat 1u over the detail
  rows that show an H price; it must equal the tile and the column. **Test:** `test-ten332-tournament.mjs` "ruling
  2026-10-08" (Database prices ≠ closes ≠ market shard; the flagged retirement in; the Database-rows-only control;
  pending / failed words), `tools/test-ten332-mutants.js` (TEN-402 mutants).
- **The Database join loads AFTER the profile shows (founder ruling 2026-10-09, TEN-402 card 7bc622d5; supersedes the
  2026-10-08 click-time load).** `database-yield.json` + `database-yield-players.json` (~410 KB gz) are requested by
  exactly two profile triggers, never by the profile open or by a render: (1) the first idle moment after the profile's
  first paint (`pp2MountNow` → `pp2DbJoinAfterPaint`: two animation frames, then `requestIdleCallback`, timeout 1 s) —
  chosen because the Record per tournament tile is on screen by default and must fill without a click; (2) opening
  Record per tournament or one of its events (the module calls `window.pp2DbJoinNeed`), so a click before idle, or after
  a failed load, asks at once. Reading the model (`trProfileModel`) never starts the fetch: not asked yet = pending.
  Until the join lands every Backing figure — the box tile, the column, the "Backing him here" tile and each edition
  row's H / A — is a **neutral loading state** (a blank box, `data-pp2-pending="backing"`; the tile keeps "loading
  prices"), never `0`, never `—` and never a closes / market-shard price. A failed load prints `—` ("prices
  unavailable", `BACKING_FAIL_TXT`) in the column, the "Backing him here" tile **and the Record per tournament box**
  (R3 fix 2: the box never falls back to another metric such as "82% · all events · 305–68" — that W–L fallback is the
  answer only when the join answered and no event clears ten priced); the next open (profile or Record per tournament)
  retries, and a retry that lands paints the Backing figure. **One fetch per session**: `sfDbJoinLoad` keeps its
  promise and the Database tab's `loadBase` / `loadNames` keep theirs, so the profile, the Head to Head page
  (`h2hEnsureDb`, which keeps no state of its own — R3 fix 1) and the Database page share the same rows.
  **Apply (the rule is the load ORDER, not a speed figure):** open a profile on a cold tab with the network panel open —
  (a) no `database-yield*.json` request starts before the profile header and boxes are painted (the two files are
  requested after first paint); (b) the Record per tournament tile then fills (Alcaraz: +7.1u US Open · 32 priced);
  (c) opening Head to Head or Database afterwards requests neither file again (one fetch each per session). First-paint
  time is NOT the test: measured 9 Oct 2026 (Alcaraz, cold cache) the medians moved ~643 → ~360 ms at 20 Mbps with large
  run-to-run variance, and 176 → 174 ms unthrottled — within noise; an independent re-measurement found no gain beyond
  it. Only the order is proven. **Test:** `test-ten402-r2l.mjs` (the real loaders and module: no request before paint /
  until asked, pending ≠ 0 ≠ "—", one fetch per session, failed → retry, the box on a failed join, the H2H page on the
  shared state), `tools/test-ten402-r2l-mutants.js`.
- **One event, one identity in the join (founder 2026-10-14, Pinnacle archive item 6).** Record per tournament meets its
  career-history rows through `trSameEvent`, which also accepts two names with one `tournament-identity.js` identity:
  "Canada Masters" = the career row's "Montreal" / "Toronto" (the season filter beside it ties each row to that year's
  edition, so the year decides the host), "Queen's Club" = "London". The substring test alone left 186 + 62 rows unjoined
  (measured 14 Oct). The Match analysis Tournament tab uses the same function. **Test:** `tools/test-trsameevent-identity.js`
  (the pre-fix test as control; London Olympics stays apart).
- **Fresh profile data (F1, founder ruling 2026-10-14).** A board player's fresh build is written to the profile cache
  every run (`bsp-pipeline.js` `buildPlayerProfiles` pass 1), so a player who leaves the board serves his last board build —
  never an older copy the 14-day TTL would reuse. A cached profile built on or before the day of a later board match of that
  player (a `captured-closes-pinnacle.json` row with his key) is stale and rebuilt (`profileCacheStaleByBoard`). Why:
  Musetti's cache was built 6 Oct, he played Zhou on 9 Oct and left the board; his career-history and recentForm ended on
  3 Sep until the TTL ran out (23 rows on 14 Oct). **Test:** `tools/test-f1-profile-cache.js`.
- **Set scores from career-history (F2, founder ruling 2026-10-14).** Record per tournament's Set scores column reads the
  career-history row the join meets for every edition row, all years (`tournJoin`); recentForm (this season + the last 10)
  still overrides with the same data where it holds the match. A row the join cannot meet stays a dash. **Test:**
  `tools/test-f2-set-scores.js` (Musetti Shanghai 2023–2026; control: career rows without sets → dashes).
- **"After the archive" on a dateless row (F4, founder ruling 2026-10-14).** A row with no date takes the reason from its
  edition (`trPxAfterOfEdition`: that season's dates in tournament-profiles.json, else its latest edition moved to the year;
  a later year needs no dates). An edition starting on or before the archive's last day, or one with no dated edition, gets
  no reason — never a guess. **Test:** `tools/test-f4-after-archive.js`.
- **Live-edition rows (R3 fix 3).** A Record per tournament row dated after the Database archive's last match
  (`database-yield.json` `meta.dateRange[1]`, 13 Sep 2026 on 9 Oct; e.g. Alcaraz Tokyo 2026) has no closing price on
  record yet: its H / A print `—` and the whole cell carries the Match analysis Tournament tab's hover, "After the
  Database archive's last match (13 Sep 2026): no closing price on record yet" — ONE string (`trPxAfterTitle`), read
  through `window.trPxAfterOf(date)`; never copied. **Test:** `test-ten402-r2l.mjs` "R3 fix 3".

- **One match sheet: the step-3 stats sheet (founder TEN-384, 2026-10-05).** Ribbon chips, ribbon and ledger strip cells,
  ledger rows (incl. their W/L square) and every drill row with a sheet hook open the Match analysis stats sheet
  (`fhOpenSheet`, tabs Match · Key stats · Set N · Point by point, opening on Key stats) through the host bridge
  `pp2OpenMatchSheet`; names go over as "I. Surname", prices as the row's own H / A. The TEN-206 §8.1 profile sheet
  (`renderSheet`) is retired. Tones (Q3): avatar, rank badge, Key-insight icon tiles and the open ledger row = `--selected`;
  avatar and badge carry an `--edge-16` hairline, the badge a 3px `--page` ring. Ledger filters (surface and price) sit on
  the Darker track (Q4). **Tests:** `tools/test-pp2-reconcile.js` "every ledger row that advertises a click",
  `tools/test-match-panel.js` "the hand-off gives the step-3 sheet", `test-ten330-form.mjs` TEN-383 profile test.
- **Record modals (founder TEN-384 rulings, 2026-10-05; builder rec).**
  - *Q1 Calendar record* tabs are **Calendar (default) · 2026**; the Streaks tab (tiles, run timeline, "What follows a
    run") is removed with its code.
  - *2026 tab* (founder second card, 2026-10-05): three white tiles — Win–loss ("2026 season"), Win rate ("N matches",
    whole %), Best result (short event label via the host's `FH_TCODE`, else our name; support "round · month") — over
    the career spine cut to `CAL_SEASON`, every match counted (the Form rule's exhibition cut is ribbon/ledger only).
    Best result = deepest round (a won final = title), ties → bigger event → earlier; month = the event's first match.
    Then "Month by month · 2026": one row per month played (13.5/700 name + grey event note · W–L · rate · ›, 11×10,
    `--edge-6` hairline, scrolls at 420px); rate ≥ 10 full white 700, 5–9 12.5/400 grey + "small sample · n=X", < 5 a
    dash. A row opens that month on the ledger grid (`ledgerRowHtml`; open row `--selected`, panel `--card` +
    `--edge-6`); its rows open the step-3 sheet. No grid row, priced strip or Swing row on this tab.
  - *Calendar tiles* (founder correction): Career yield (white, "N priced matches") · Best month · Worst month (white
    month name; only the pp under it is green/red; n ≥ 10 priced gate) · Seasons on record ("N matches · S seasons").
    No Best / Worst stretch tiles.
  - *Market edge box* support line quotes the modal's All-tile tour figure (the Database aggregate, from
    `tour-baselines.json`). It draws complete on first paint (see Q8). No baseline yet (or the file failed) = the tour
    clause is left out, never "tour —" (fx2). Never the shard's `tour.all`.
  - *Q2 Swing row* = band colours on the bar only: 4px, r2, 75% opacity, `--viz-hard / --viz-clay / --viz-grass /
    --viz-indoor`, night and day; the surface name sits centred under the bar in caps `--text-label`.
  - *Q5 Court speed* = 3 bands (Slow ≤ 43 · Medium ≤ 68 · Fast) as three tiles side by side, slowest to fastest; a
    band that opens its matches is a clickable tile (7 / 16 / 24), a sub-minimum band a stat box (`--edge-6`); chips on
    the Darker track; figures mono, labels Hanken caps, no surface colours.
  - *Q4.6* Record per tournament goes up to 1440px; its helper, list footnote and in-detail explainer are removed (the
    stored-record disagreement line stays — a data disclosure).
  **Test:** `tools/test-pp2-reconcile.js` "TEN-384 Q1", "2026 tab ·", "Calendar tiles ·", "Market edge box = All tile", "Court speed: chips on the Darker track…", §5.3 items 2–3 / 6–7.
- **TEN-384 step-4 rulings, Group C (founder card, 2026-10-05).**
  - **Q6 · no Back/Fade and no surface controls.** The heatmap pop-up renders Hold | Break only (`HB_SHOW_SURF = false`). Market edge Match winner is the backing side over all surfaces (`MKT_SHOW_FILTERS = false`). The state paths behind both stay wired.
  - **Q7 · Draw record Opponent stops at vs Top 10.** There is no vs Top 50 row, dash or note: the career-splits files hold no Top-50 split. *Early rounds* is a render-only By round row. It is recomposed from the Round of 16/32/64/128 **counts**. Its Service rates print "—" because the store keeps those as rates, without their counts.
  - **Q8 · Market edge tour baselines = the Database Tour aggregates** (checked: they are real computed data, from `database-yield.json`). As favourite = Favourites All, As underdog = Underdogs All, All = both sides pooled. The arithmetic is the Database's own.
    - **Baselines file (founder ruling, 2026-10-05).** `tour-baselines.json` (~1 KB, ≤ 10 KB) is written by `build-database-yield.js` in the same run as `database-yield.json` (drop-in job; published by `pipeline.yml`, in the assert list). The host loads it WITH the profile data (`loadTourBaselines` inside `loadPlayerProfiles` / `ensurePlayerProfile`) and bridges it as `window.tourBaselines`. **The Market edge box never loads `database-yield.json`**; the module names no such URL. *TEN-402:* the per-event Backing's one join is read by the HOST through `DatabaseTab.priceRows()` (`sfDbJoinLoad`, once per session, shared with the Database and Head to Head pages: ~215 KB + ~196 KB gz) — accepted by the founder (2026-10-09, card 7bc622d5) on condition it loads only after the profile shows; see "The Database join loads AFTER the profile shows" above.
    - **First paint is complete:** `showPlayerProfileV2` waits for the player's market-edge shard (cached after the first open, capped at `PP2_FIRST_PAINT_WAIT_MS`) before it mounts, so the Market edge box never paints "no priced matches on record" / "tour —" and then fills.
      - **fx2 · every other per-profile load starts at CLICK time** (`pp2StartLoads`), in parallel with the shard, not after the wait.
      - **fx2 · past the cap, loading claims nothing:** the host marks the shard in flight (`window.marketEdgePending[key]`), and the box paints a neutral pending figure + support line (same boxes, `&nbsp;`, `data-pp2-pending`) until it lands, then paints once; the Market edge modal says "Loading the priced matches." A settled empty shard still says "no priced matches on record".
      - **fx2 · every leave path cancels the deferred mount** (`pp2CancelPendingMount`: Back / `showPlayerList`, every sidebar page switch, a legacy profile open); the timer mounts only if its sequence is current AND the Players page is active (`pp2MountStillWanted`).
    - **Price join (founder ruling TEN-384, 2026-10-07, option "me"):** the file and the Database use ONE join — each row priced Pinnacle closing when both Pinnacle prices are valid, else Bet365 closing (`build-market-edge.js` `pickBook`), every season. `tour-baselines.json` is `basis: 'market-edge'`, `equalsDatabaseTour: true`, computed from the same rows as `database-yield.json` (the `--baseline-basis` flag is gone). Today: All −4.37% · Favourite −1.78% · Underdog −6.96% over 40,972 matches (Pinnacle 38,830 / Bet365 2,142). Rule text: `odds-archive.md` "Price join".
    - **Test:** `test-pp2-reconcile.js` "Q8" (file = Database `agg`/`bands` over `database-yield.json`, size, never requests, publish wiring).
  - **Heatmap cell colour = the gap to the pair's all-sets rate** (founder TEN-417, 2026-10-10, SUPERSEDES U3's ≥ ±3): **neutral within ±3 inclusive, green from +4 pts, red from −4**, the same rule as Live. The gap is taken on the printed integers, and the tooltip word follows the same band ("at global · −3 pts vs this bucket's global 83%"; "above global" from +4, "below global" from −4), so colour, word and printed figure never disagree. **Test:** `test-holdbreak-engine.js` "TEN-417: −3 / +3 … −4 / +4". Cells with n 5–9 get an 8%/16% wash; n ≥ 10 get 16%/36%. The all-sets cell is never tinted. **Test:** `test-holdbreak-engine.js` 1c, `test-heatmap-shape.js`.
  - **Derived lines: "Vs avg pp" is withdrawn; Field and vs Field replace it (founder rulings 2026-10-23).** Vs avg compared a line with the player's own other lines (an easy line read as an edge): not computed, not shown. **Field (tier)** = the same line, same Window · Tier · format · card · Surface · Court speed, pooled over every player-side in the database (`derived-field.json`, built each pipeline run by `tools/build-derived-field.js` from the page's own `lineCoverage` — same exclusions, retirements, void rule); **vs Field** = player rate − field rate, pp. The header names the tier ("Field (ATP)"). Challenger & ITF on a favourite / underdog card is blank (no closing prices there: 2 of 222,732 player-sides). A field of n < 10 dims like the player's. Both columns neutral ink (a comparison with other players, never green / red). No file (404, a failed build) = a dash. **Test:** `test-derived-field.js` F (one player's field = his own tallies, every cell), R, [neg]; `test-derived-lines-drill.js` A.
  - **Derived lines population, ±3.5 / ±3, filters, drill (founder briefs 2026-10-21 / 22).**
    - **Population = the Career record's counted rows** (`drillScope`), every tier and year; never cut for want of a price. **Test:** record = Bo3 + Bo5 + every match out, by reason (+ undated) — `test-derived-lines-drill.js` P.
    - **Out of every line, every filter (rulings 2026-10-22):** NextGen (by name, or every set first-to-4); a best-of-3 decided by a **match tiebreak** stored as a set (`lineFormatOf`: decider won on 10+ — by 3+ always, by exactly 2 unless a Slam / Davis Cup / Olympics advantage set; or a 1-0 decider). A decider won on 9 (9-7) is a real advantage set and counts. Walkovers (no score), level set counts and other short sets also out, each counted in the note. **Test:** X (no NextGen / match-tiebreak match in any line or tab).
    - **Retirements are shown, never counted.** Never in a record, rate or Vs avg; listed on every line's **Retired** tab ("Retired — not counted", never "void"). No retired count on the family label (founder 2026-10-23). Roster-wide 3.3% of counted matches are retirements (10,007 of 305,424, 2026-10-23); none walkover-flagged. A retirement's table: Bo5 for a Slam main draw, a Davis Cup tie through 2018, or 3 sets already won; else Bo3 (`lineRetiredFormat`). No margin is read off an unfinished match (dash). **Test:** D (tabs = n + retired; a retired match in a record fails), [neg] mutant.
    - **Bettable side only (founder ruling 2026-10-23).** As favourite: the − games and set handicaps; As underdog: the + ones; All matches: every line. Total games and Match shape in every card. A hidden line leaves the table (and its Vs avg baseline), never dashed. **Test:** B.
    - **Thin samples are shown dimmed (2026-10-23).** Below n = 10 (threshold unchanged) the rate, bar and Vs avg are real values in `--text-label` with the bar at 0.4 opacity; no "n < 5" / "small sample" text anywhere; zero matches is a dash. The Vs avg mean still takes rows of n ≥ 5 only. **Test:** N.
    - **Surface filter (2026-10-23):** All / Hard / Indoors / Clay / Grass, the Career record's own per-match cell (`drillScope` `cell`, `seasonCellOf`); a row with no surface (or an unresolved court in an Indoors-split season) counts under All only. Second control row, under Window / Tier / format, fixed widths. Vs avg follows it (the filtered table's mean). **Test:** U (the five buckets partition All, every line and result).
    - **Court speed filter (founder 2026-10-23):** All / Slow / Medium / Fast / Unrated, beside Surface, fixed widths. The band is exactly the Court speed record's `speedBandForRow(speedRowOf(r))` (no cut-off in this module, none inferred from surface or event); a venue with no rating is **Unrated**, under every tier (ATP rows 88–100% banded, Challenger & ITF 2–8%, 2026-10-23). The record has no speed cell, so under a speed filter the note's record figure is the filtered list's own count. **Test:** Z (the four buckets partition All, every line and result) + mutant.
    - **Games handicap (Bo3 only) order:** −4.5, −3.5, −3, −2.5, +2.5, +3, +3.5, +4.5. Bo5 keeps its own ±3.5 / ±6.5 and gets no ±3. **±3 is a whole line:** margin exactly 3 = **void** (the ±3 push, nothing else); record W–V–L; rate = W ÷ (W + L). **Test:** +3.5 W = +3 W + +3 V.
    - **Window** Last 52 weeks / Last 24 months / Career (default Career; 52 weeks = the record's 364-day cutoff; 24 months = same day two years back) and **Tier** All / ATP / Challenger & ITF (the record's assignment: a season with no tier split counts under All only, stated in the note) re-cut every figure, Vs avg and the drill. **Test:** ATP + CH = All on a TE record.
    - **Nothing moves on a filter or card click.** Fixed "Coverage by line" title; every control button reserves its 700-weight width (`mkSeg(…, steady)`); each coverage card's subtitle shares its cell with a hidden widest-case copy, so a "—" card is as tall as a full one. **Test:** S (structure, npm test); `tools/probe-derived-lines-layout.js` (Chrome, by hand: title, controls, cards and table top identical across 54 states at 1000 / 760 / 560 / 400 / 340 px; 4af952d4c fails at 400).
    - **Drill:** every line opens its matches in the career drill panel (`drillPanelHtml`); tabs Covered / Not covered / Void (±3 only) / Retired, opening on the first that holds a match (an empty tab the reader picks says "No matches"), each with its count, adding to the line's matches + its retirements. **The LINE badge is the row's only colour** (Covered `--pos`, Not covered `--neg`, Void and Retired grey, LOST SERVE badge form); the match result is neutral text ("W 2-0", no square), the margin neutral and signed. Header = "record · N matches[ · R retired, not counted]", the same on every tab. No provisional source label on a line drill row (the field stays). At a narrow width the drill scrolls sideways inside its panel (opponent and set-score columns keep a floor), never overlapping. **Test:** D, O, V, [neg] mutants.
- **TEN-384 fix round 1 (founder "Not ready", 2026-10-05), items 7–13.**
  - **8 · A tile headline only from a split of n ≥ 10.** Matchup = the first row of the modal's rate-sorted list with n ≥ 10 (`bestMatchup`). Live trading = "from a set down" at n ≥ 10, else the Situational row of n ≥ 10 with the largest gap to its tour figure (`liveTileFallback`).
    **fx3 (founder D10, 2026-10-07): no split qualifies → the tile shows the OVERALL figure, never a dash** (a dash only when the overall population is under 5 or there is no data): Matchup = the rate over every labelled archetype ("all archetypes · none at 10+ matches · W–L"); Live trading = his record over every match with set-by-set scores ("all matches with set scores · rate"); Draw record = his rate across these splits, the modal's own baseline ("all splits · none at 10+ matches | no split above it · W–L"); Court speed = the rate over every speed-rated match ("all rated courts · no band above it | none at 10+ matches · W–L", fx4); Record per tournament = fx4: the rate and W–L over every event ("all events · W–L"), the fx3 summed Backing ("all events · W–L · N priced") held behind `TOURN_TILE_SUMMED_UNITS` (off: founder ruling 2026-10-07, see below). Draw record and Court speed keep their positive-gap pick (Q1 / §8.3): a band or split below his own rate is never headlined as "best".
  - **9 · One small-sample mark: "small sample · n=X", never an asterisk** (`smallSampleText` / `smallSampleHtml`, mono 10px `--text-label`). The Calendar tile's pp line reads "small sample · n=X" at 5–9. The test reads every rendered modal for any star glyph.
    **fx3 (founder D11, 2026-10-07): the mark sits UNDER the rate, in every table** (`rateOverMark`: the rate, then the mark right-aligned beneath it — the 2026 tab's month-row form): Record per tournament (fx2 had it after the event name), Career record's surface table (Career and Last 52), Draw record, Live trading's Situational rows (it left the label slot, which keeps only "n < 5") and Derived lines. A row that carries the mark lets its cells sit on the first line and gives the mark the second. **No "small sample" footnote line** (the Career record note's "Clay small sample · n=X" is gone; hover titles stay).
  - **10 · Two initials stay together:** "J. M. Cerundolo" → "Cerundolo J. M." (`surnameFirst` / `initialsOf`) on the ribbon and the ledger ONLY. **fx3 (founder D12):** every other surface keeps "I. Surname" with every initial: "J. M. Cerundolo" — the Career and Calendar drills, Court speed, Matchup, Market edge and the step-3 sheet hand-off (`initialSurname`, which also turns a surname-first "Cerundolo J. M." round whole and keeps "J. J. Wolf"'s second initial).
  - **11 · Swing row = the tour's calendar: five FIXED bands (fx6 item 5, founder r2, 2026-10-07).** HARD Jan–Mar · CLAY Apr–May · GRASS Jun–Jul · HARD Aug–Sep · INDOORS Oct–Nov; December carries no band. The same for every player; the rows are not read (`calSurfaceSpans`, `CAL_SWING_BANDS`). This REPLACES the per-month court / surface vote (fix 11, the fx2 tie order) and the fx4 Oct–Nov any-indoor rule, which painted seven segments for Alcaraz with Clay over February. Same visuals: 4px bars, r2, 75% opacity, band colour (`--viz-*`), caps `--text-label` label under each bar; the two Hard bands stay two bars with their own labels. While the market-edge shard loads the row stays blank and paints once (fx4). **Test:** `test-pp2-reconcile.js` "fix 11 · fx6", `tools/test-ten384-fx6.js` item 5, `tools/test-ten384-fx4.js` item 1.
  - **12 · "London" / "ATP London" = "Queen's Club"** in `tournament-identity.js` (one grass ATP 500); the builders merge the two rows. fx2: also "Hertogenbosch" = "'s-Hertogenbosch" and "NextGen Finals" / "Next Gen Finals - Milan" = "Next Gen Finals". The SERVED shards predate the aliases, so the page folds them at read time (`TournamentIdentity.mergeHistory`, in `loadTourHistShard` and `tournHistOf`): same-identity rows merge, a season held twice counts once (the larger edition, never summed). `tournament-identity.js` is a page script now (published by `pipeline.yml`).
  - **7 · Career splits = one file per player, NO rank cap (TEN-391, founder 2026-10-07; supersedes "ships with the rank cap / 250 400").** `tools/build-career-splits.js` writes `career-splits/<profileKey>.json` (one player's object) + `career-splits-tour.json` (build metadata, `coverage.missing` = the reason each profile has no file, `pooled` slim rows for the legacy profile's tour-wide readers only). It builds EVERY profile a reader can open (deployed `player-profiles.json` + every `player-index.json` `hasProfile` key) with no rank cap; `RANK_MAX` defaults to `Infinity` and `refresh-career-splits.sh` passes no cap. Name join = full name first, then TA ranking / full men's list by initial + surname; a namesake or a page shared with another key is accepted only on a positive identity check (ATP id, age vs DOB, country); rows dated before DOB + 14 are dropped and a page mostly made of them is rejected. **Loading:** nothing fetches career splits up front; the page fetches ONE player's file when his profile (or the H2H page) shows him (`loadCareerSplitsFor`; the v2 first paint waits for it). **"Splits not built for this player yet"** (Draw record tile, Draw record modal, Key insights; `splitsNotBuilt`, `SPLITS_NOT_BUILT`) appears ONLY when his file answered 404 (`careerSplits[key] === null`); while in flight or after a failed fetch the three are pending (no words, same height). The ten-match wording only when splits exist and none reaches 10. The old single `career-splits.json` is retired — do not reintroduce it or a cap. **Test:** `tools/test-ten391-splits-shards.js`, `test-pp2-reconcile.js` "fix 7" (fails if a cap returns) and "fx3 item 7".
    **fx6 item 8 (founder r2):** the Draw tile's figure SLOT is empty (a non-breaking space, not "—"; `blankFigure`), the support line stays, height unchanged (min 132). Tile and modal print the same words with NO trailing period in either. **fx6 item 7:** the Career record subtitle is exactly "Record by surface and season, and his ratings against the field" (Ratings tab landed; supersedes the Q4 "indoors" re-add and the "since <year>" label). **Test:** `tools/test-ten384-fx6.js` items 7, 8.
  - **Undated counts are signed (fx2):** `undatedFor` / `calResidual` no longer clamp at 0; a negative count is a reconciliation failure the figures-agree gate catches; the page prints the note only when > 0.
  - **fx3 · Calendar footnote / Backing tile wording (founder B8):** "closing price: Pinnacle, else Bet365". Calendar yields, Court speed units, Matchup Backing and Market edge all read the market-edge shard's join (Pinnacle, else Bet365) through `calSpine`; Record per tournament Backing is the Database join (`trProfileBacking` → `trProfileModel`; founder ruling 2026-10-08, see "Per-event Backing" above).
  - **fx3 · same-event alias:** "Melbourne (Great Ocean Road Open)" = "Great Ocean Road Open" (2021; listed twice with the same matches).
  - **fx4 · same-event aliases + the Olympics:** "Melbourne" = "Melbourne (Summer Set)" (2022 only; bare "Melbourne" occurs in no other season), "Melbourne (Murray River Open)" = "Murray River Open" (2021). **The Olympics are ONE identity, "Olympic Games"** ("Olympic Games", "Beijing / London / Rio / Tokyo / Paris Olympics"), one Record per tournament row across years. api-tennis files the Tokyo Games as season 2020; `EDITION_YEAR` re-years them to 2021 so they fold with the archive's "Tokyo Olympics" 2021. **Surface per edition comes from `EDITION_SURFACE`** (2008 hard · 2012 grass · 2016 hard · 2021 hard · 2024 clay), never the feed's single label (career-history writes "grass" on every "Olympic Games" row); a row spanning years takes the existing multi-surface rule (the surface holding most of its matches, ties to the newest). "London Olympics" stays apart from Queen's Club. **Test:** `tools/test-tournament-identity.js` "fx4", `tools/test-ten384-fx4.js` item 3.
- **Draw record drill-in (founder 2026-10-13).** Every Results row of the Draw record (Level · Format · By round ·
  Opponent) is clickable — pointer, whole-row hover (`.pp2-drow`), a chevron in a 12px track (the name column gave up the
  20px; the panel width is unchanged) — and opens its matches INSIDE the modal: back arrow + "Draw record › {row}", the
  row's own W–L and Win % big, a summary strip "W–L · win % · P&L ±x.xxu over N of M priced matches" (never a P&L total
  without its priced count; blank while prices load, "— · prices unavailable" on a failed join), All / Wins / Losses chips
  with counts, then the match-up record table (`mlRowHtml`, shared with Versus playing styles: square · Date · Opponent ·
  Event · Rd · Score · Price · Opp · P&L), newest first, 100 a page. Esc and the back arrow return to the summary with
  Career / Last 52 kept; the list follows the toggle. Sets & Games and Service stay summary-only.
  - **Rows** = `splits-matches/{key}.json`, the per-match file `tools/build-career-splits.js` writes in the same run and
    from the same Tennis Abstract rows as the figures, filtered by the builder's own predicates (`DRAW_PRED`); fetched when
    a row is first opened (`pp2DrawNeed`), never at profile open. **No figure changes.** A list that disagreed with its row
    would say so in one line, never trimmed or padded (measured 13 Oct 2026: 545 players, every row, 0 disagree).
  - **Definitions (from the builder):** vs Top 10 = the opponent's rank AT THE MATCH (matchmx); Early rounds = R16 + R32 +
    R64 + R128 (no RR / BR); Other Tours = the source's level A (ATP 250 / 500, plus Laver Cup, United Cup, ATP Cup, the
    Olympics and the 2023 Tour Finals the source codes A).
  - **Prices (founder: "confirm")** = the site's ONE join: the Database archive, Pinnacle closing, else Bet365 closing, per
    match (`H2HPage.priceJoin` via `window.pp2DrawJoin`, with his career-history), a retirement settled on Pinnacle rules
    (`RET_SETTLE_NOTE` in the footnote; founder 2026-10-22). P&L = 1u flat on him at his price. Missing price = "—", never 0.
  - **Walkovers** are listed as walkover rows with no price and no P&L, and are in no W–L — the Draw record
    included (founder 2026-10-22 closes the open question: a walkover is never a win or a loss).
  - **Date** = the tournament's month (the source dates every match at its event start; founder: "yes").
  - **Every row opens the step-3 stats sheet (founder: required):** on the career-history match the join met for it
    (`careerMatch`, event key → the full sheet), else on the row's own date, score and event (the sheet's "Match stats not
    available" state). A loss's score is turned to his side ("6-3 6-4" on a loss reads "3-6 4-6").
  - **An opponent links to his profile** only when the joined match carries his key and the standings say a profile exists
    (`pp2HasProfile`); otherwise plain text.
  **Test:** `tools/test-draw-record-drill.js` (every player in the committed store reconciles, the pinned Zverev fixture,
  the drill, the sheet payloads, the host bridge through the real `h2hPriceJoin`) + `tools/test-draw-record-drill-mutants.js`
  (17 mutants); `tools/test-ten384-r2-draw.js` (the chevron track, panel width unchanged).
- **TEN-384 fx4 (independent review, 2026-10-07).**
  - **Header rank = the Players card's rank:** live standings (`player-index.json`, the host's `playerIndex`, read by ONE function `pp2LiveRankOf`, bridged as `window.pp2LiveRank`), else the frozen `profile.rank` (`headerRank`). The landing repaints an open profile when the standings land. **Test:** `tools/test-ten384-fx4.js` item 2.
  - **Loading claims nothing, on every surface that reads the market-edge shard** (`shardPending`): Calendar Career yield / Best / Worst tiles, the findings strip, Vs-others bars, Swing row, n / Yield / Vs others rows, the By-month head count, the footnote's priced sentences and the cell drill's prices; Court speed units and H / A; Matchup Backing (list, Career, summary, drill); the ledger's unpriced H / A cells. Each keeps its box with `&nbsp;` and paints once. Record per tournament's tile is pending while the page's Backing join (`trProfileBacking`: career-history + the Database join rows) has not answered (`tournBackingPending`). Key insights read no shard figure. **Test:** `tools/test-ten384-fx4.js` item 4.
  - **Record per tournament tile fallback (founder ruling 2026-10-07):** per-event Backing is on the Database join (2026-10-08, above), which can differ from the Market edge rows (captured closes first, R8), so the tile never sums units: no event clears ten priced → the rate and W–L over every event ("all events · W–L"), never a summed-units figure. Per-event Backing unchanged. `TOURN_TILE_SUMMED_UNITS = true` restores the fx3 summed fallback. **Test:** `tools/test-ten384-fx4.js` item 5.
  - **Minor:** Court speed fallback names the true reason ("none at 10+ matches" when no band reaches ten, else "no band above it"); hyphenated initials ("J-L. Struff" → "Struff J-L." on the ledger / ribbon) and `mkOppName` = `initialSurname` ("J.J. Wolf" → "J. J. Wolf"); Career hero 5–9: the mark sits under the rate; Database "1 match" (`dbMatchWord`).
  - **13 · An event is named by one rule everywhere** (`eventName(m, p)`): the per-player vote onto Record per tournament's name, else `calEventClean` (no "ATP " prefix).
  - **TEN-402 r3 (founder 2026-10-09, "one tournament name per event, site-wide") — Record per tournament prints the site's ONE event name**, superseding item 10's "{city} {tier}" ("Cincinnati Masters 1000", "Beijing ATP 500", "Tour Finals", "Canada Masters"): `tournDisplayName(name)` = the page's `window.sfEventName(name)` (Cincinnati Open, China Open, Monte-Carlo Masters, Italian Open, Canadian Open, ATP Finals, Roland Garros; an ATP 250 keeps its city; off the page the module's own map is the fallback). **The tier is the row's meta, never part of the name** (`tournLevelMeta(level)`: "Masters 1000" / "ATP 500" / "ATP 250" beside the name, 11.5 / 500 `--text-label`; none on a Slam, the ATP Finals or a row with no level). The detail header ("Cincinnati Open 2024"), the career caps and the box's "best event" ("ATP Finals · best event · 13–11 · 24 priced") read the same name. **"Cup" is the ATP Cup** (2020–2022 editions, 3 Jan 2020 / 2 Feb 2021 / 2 Jan 2022; Zverev 3–6): the feed's "ATP Cup" loses its "ATP " to the name cleaner — it prints "ATP Cup". Search matches the printed name, the data name and the tier ("masters 1000"). **Display only:** `t.name` stays the key (`data-t`, `state.tournOpen`, every join); the pinned order's last tie-break (display name ASC) now reads the new name, so two rows tied on matches and last year can swap (Zverev: Italian Open now above Madrid Open — 37 played each, same last year; ATP Finals above Hamburg Open, Canadian Open above China Open). Every W–L, Backing and priced n is unchanged (measured 9 Oct, Zverev 63 rows / Alcaraz 42). **Apply:** every row's words = `sfEventName(t.name)`, no tier inside a name, the tier beside it. **Test:** `test-ten402-r2n.mjs` r3.2 (+ PP2 mutants in `tools/test-ten402-r2n-mutants.js`), `tools/test-pp2-reconcile.js` "TEN-402 r3".
  **Test:** `tools/test-pp2-reconcile.js` "fix 7"–"fix 13", `tools/test-tournament-identity.js` "fix item 12", `tools/test-match-panel.js` box 8, `tools/test-ten384-fx2.js` (items 2, 3, 5, 6).
  **Figures-agree gate (fx2):** `tools/test-ten384-figures-agree.js` runs on the PINNED fixture `tools/fixtures/ten384-figures/player-2840.json` (one real player's complete record, module clock pinned to its `asOf`; refresh only deliberately with `extract.js` beside it) and on the deployed stores for Alcaraz / Thompson, which SKIP out loud without `career-history/`. The roster-wide sweeps are `tools/probe-ten384-figures-roster.js` — run by hand, NOT in `npm test`.
- **TEN-384 fx7 (independent review of the r2 list, 2026-10-07).**
  - **fx8 (lead, 2026-10-07) · THE LAST 52 WINDOW FOLLOWS THE SEASON TABLE; the season table is NOT touched.** (fx7 had done the reverse — re-split 980 of 1,893 top-120 season-table rows on a per-match classifier, e.g. Shelton 2022 Indoors 24–2 → "—" — and was reverted: every season-table cell equals 439b8605.) The table's Indoors column stays careerByYear's split (API-Tennis tournament court type, `bsp-pipeline.js` `buildAllTierYearly`; `gridCells` / `tierGridCells`). The dated rows carry no tournament key, so `seasonCourts(p)` classifies each one so its SEASON reproduces the table: **(a) a season with no indoor split** (careerByYear `indoor` null, Indoors "—", e.g. FAA 2025) splits nothing — every row counts under its surface, whatever the archive says; **(b) a season with the split**, in order: (1) the odds archive's per-match Indoor / Outdoor (calSpine `court`); (2) the same event's archive court that season; (3) a known event, `COURT_KNOWN_INDOOR` = **Laver Cup, ATP Finals ("Finals - Turin", "Tour Finals"), Next Gen Finals**, `COURT_KNOWN_OUTDOOR` = **the four Slams, United Cup, ATP Cup**; (4) the table itself, per season × tier (careerByYear `.atp` / `.chitf` each carry their own indoor record) × surface: an indoor record of 0–0 makes every row of the group Outdoor and one equal to the group's whole record makes every row Indoor (both override 1–3); otherwise the leftover indoor W–L is matched against the still court-less events (`seasonCourtForce`): an event in EVERY whole-event set that sums to it is Indoor, in none Outdoor, in some → unknown, counted under its surface. **The agreement test (sweep C):** for every season S and tier, the season's dated rows run through the classifier list the table's Indoors exactly and Hard / Clay / Grass differ from the table only by S's undated matches; the window opens mid-season, so its S rows are a SUBSET of S's classified rows (window S-cell ≤ table S-cell per column) — a partial season cannot equal a full one. Residuals are seasons where the leftover W–L is matched by several event sets (mostly Challenger seasons, never in the archive) — fixed for good only by the pipeline writing a court type onto each career-history match. **Test:** `tools/test-ten384-fx7.js` item 1 (fixture: an ambiguous Laver Cup + United Cup season, a no-split season, a season-table-unchanged check); roster form = `tools/probe-ten384-figures-roster.js` sweep C (top-120, probe only).
  - **Match shape: a per-set list LONGER than a decided result** ("1 - 2" with 4-6 6-3 4-6 1-0, Sinner Monte Carlo 2024 SF) takes the result's shape; the list is trimmed to its leading sets that make up the result (`lineSetCount` `trim`, read by `lineGames`), else the result's count stands with no games. Only a genuinely level count is "excluded because the set score on file is level". **Test:** `tools/test-ten384-fx7.js` item 2.
  - **"Splits not built for this player yet" carries no period anywhere** (Key insights empty state, Draw tile, Draw modal). **Test:** `tools/test-ten384-fx7.js` item 3, `test-pp2-reconcile.js` "fx3 item 7".
- **Every Career record cell opens the matches behind its number (founder, TEN-442, 2026-10-17).** A season cell, the
  Career row and the surface rows list the dated career-history rows (`calSpine`) of their scope — never recentForm or
  tournament-history editions — placed by ONE classifier, `seasonCellOf(row, court, carved)`, which the Last 52 window
  also counts and lists with (`last52SurfOf`). `carved` = the drilled season × tier row carries an Indoors split; then a
  row whose court did not resolve (`COURT_UNKNOWN`) is listed under neither Indoors nor its surface. **The test:** open
  any cell — the list holds exactly the cell's W–L and the note reads "All N matches"; where the store cannot back the
  count, the list shows what it holds and the note reads "N counted · M found in results · K missing" plus each reason
  it can count ("… have no court type on record yet", "… in scope carry no surface"). **r2 (founder 2026-10-17):** the
  part of a gap that falls in pre-window seasons (careerByYear `allTier: false`, before currentYear − 5) reads "P not in
  database · Challenger/ITF results before 2021 not in database" — the count never claims those P are Challenger
  matches (Zverev 2016–20 run short with no Challenger play), the clause states what the database lacks; a Total lists
  its unresolved-court rows and names them ("· K have no court type on record yet") — such a row vanishes nowhere; the
  Career footnote reads "N Davis Cup matches with no surface — listed under the year total" when the dated store holds
  exactly the footnote's N and every one is a Davis Cup tie ("N matches with no surface — listed under the year total"
  when not all are; the old wording when the store does not hold exactly N); N is the player's own. Indoors stays as
  shipped (tournament-level court type) pending the founder's ruling. A list longer than its cell reads
  "M found in results against N counted · the two sources disagree"; while the career-history shard is unanswered it
  reads "match list loading" and lists nothing. Never padded, never a blank panel. Each group row states surface ("No
  surface" where none), "Indoor" where the court resolved Indoor, and the tier (the joined level, else the Tier
  control's scope word). The cell figures themselves are untouched (careerByYear). **Test:**
  `tools/test-ten442-season-drills.js` (fixtures → `buildAllTierYearly` / `playerMatchHistory` / the shard writer →
  the painted modal; six mutations must go red). Roster form: `tools/probe-ten442-season-drills.js` (report only — it
  measures data convergence, not wiring).
