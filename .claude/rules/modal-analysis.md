# Match analysis modal — TEN-312 rebuild rulings (founder, 2026-09-28)

Applies to the whole Match analysis modal (`openAnalysisModal` and every tab builder in
`bsp-consult-dashboard.html`) as it is rebuilt against `design_handoff_match_analysis_v1`
(`Match Analysis Progression v1.dc.html`), plus the pipeline records and player-profile figures it shares.
Phase 0 evidence: TEN-312 documents `phase0-report`, `phase0-a` … `phase0-f`. Tab-specific rulings stay in
`modal-form-h2h.md`, `modal-market-edge.md`, `modal-weather.md`, `modal-overview.md`,
`modal-key-factors.md`, `modal-match-stats.md`, `modal-news.md`, `modal-progression.md`, `modal-playing-style.md` and `odds.md`; where one of those conflicts with this file,
this file wins.

## Build order (founder 2026-09-28, TEN-312 comments 8574fb97 + 940d7634)
- **Priority: finish all 12 tabs** (TEN-330 … TEN-341), built, matched to the design file, wired to real data and live.
  Everything else is secondary.
- **Phase 1** = frame + one token file + per-tab lazy fetch + one merged match stats sheet with real stats + shared
  components + fixture harness / pixel diff (TEN-314).
- **Tabs wait only on their data prerequisite, never on queue order** (founder 2026-09-29, TEN-312 c288de06 +
  bbe5c072): Tournament (starts at once; Roland Garros court speed dashed until TEN-321 lands), Overview (TEN-324),
  Market edge (TEN-325), Match Stats (TEN-318), Progression (TEN-327a), Playing style (TEN-328), then Key factors
  (`v.o` only) after Playing style. **Test:** no tab ticket's `blockedBy` holds another tab ticket, except Key factors
  ← Playing style.
- **In parallel, as soon as Phase 1 lands:** News, Odds and Weather. They have no data prerequisite beyond Phase 1.
- The Edge model re-fit (TEN-345, split from TEN-327) was approved by the founder (2026-09-28, TEN-314 70fb039e)
  and ships on its own ticket; it **blocks no tab**.

## Definition of done — per tab (every item required)
1. Every element in the design file for that tab is built. Nothing is skipped silently.
2. Fixture pixel diff against the design file rendered in Chromium at 1296 px: diff % per state and per pop-up, diff images
   attached, **zero structural differences**.
3. Real data wired. Dashes plus a note where data is missing. The §5 gate applies to every rate.
4. The review switchers and SAMPLE chips are gone, and no seeded data is in the bundle.
5. Deployed and verified on the live URL with a **real match**, not the demo.
6. Night and Day screenshots from the deployed site posted to the founder.
7. A list of every parked element and design gap, each with its reason.
8. **Shared helpers only** (founder 2026-09-29, TEN-314 comment 1641c7ce): the tab renders its match rows with
   `maMatchRowsHtml`, its tooltips with the shared tooltip, and every match opens the shared sheet. The tab's own row
   and tooltip renderers are **deleted**, not hidden (Form first: `.fh-elotip-pop` and Form's own rows go). Variant
   geometry (e.g. Form's 14 px inset) is a parameter of the shared helper, never a second renderer. **Test:** a grep
   finds no tab-local row or tooltip renderer; a tab that draws no rows or tooltips says so in its report.
   **The one pop-up frame** is `maPopFrame` (TEN-366). The file draws two frame geometries, each a `MA_POP` variant key:
   `std` (README §4.4, DF L1485–1560: Overview, Market edge) and `mv` (the Odds movement pop-up, DF L1906–1915).
   A new pop-up geometry is a new variant key, never a tab-local overlay.
   **The one tooltip component** is the design's `.elotip-pop` (DF L950). It has two triggers and no other look:
   `maTipHtml` (hover / focus on a wrapper) and the positioned mode `data-aotip` (`initAOddsTips`: one delegated
   listener, 250 ms, anchored at the trigger and flipped at the viewport / modal edge; Odds, Weather, Market edge, the
   News group count). The positioned element carries only the class `elotip-pop ma-tip-float`, no styling of its own.
   A design-file native `title` (e.g. News article times) stays as the file draws it. The Odds Market / No-vig hints use
   the shared tooltip (`data-aotip`), as `odds.md` rules (founder Q23, 2026-09-30).
   **Test:** `test-ten314-components.mjs` (one component; News count on it).

- **Undrawn states** (TEN-312 `design-gaps`) never block a tab: use the nearest existing pattern in the design file, mark
  the code `// DESIGN GAP Gn`, and list it in the tab report. Never invent a new visual pattern. The TEN-312
  `design-gaps` document goes to Claude Design (founder 2026-09-29): one row per gap with where it is, what's missing,
  the interim and a deployed-site screenshot, kept current; when a drawing comes back, the interim is swapped for it.
- **No silent stalls** (founder 2026-09-29, TEN-312 bbe5c072 §3): every 2 hours every open TEN-312 child ticket is
  checked (routine "TEN-312 stall sweep"); one that is `in_progress` or `todo` with no run in the last 2 hours is
  **restarted**, not just reported (founder 2026-09-29, 5dd79b7e). Only a ticket with a scheduled monitor, a review
  path or a founder park (TEN-315, the site-wide theme, until the review pack is reviewed) is flagged instead.
  Internal only, no new outbound channel.
- **Estimate discipline:** the accepted estimate is all 12 live 29 Sep 20:00–23:00Z. A slip of more than 2 hours gets
  one line on TEN-312 with the cause and the new time.
- **TEN-312 is done** when all 12 tabs are live and pass all 8 DoD items, TEN-349, TEN-350 and TEN-352 are closed, and the
  single review pack is posted on TEN-312.
- **An element that needs a founder ruling** is parked alone, as a dash with a note. The rest of the tab ships. A tab
  never waits whole on one decision, and nobody stops mid-queue for the founder: every open question is collected into
  **one card at the end** (founder 2026-09-29).
- **Batching:** when the lane is the bottleneck, compatible tab commits land together in one lane cycle.
- **Review pack when all 12 are live** (founder 2026-09-29): (1) the status table `tab · ticket · live commit ·
  pixel-diff % · parked items · design gaps`; (2) Night/Day screenshots of every tab and pop-up from the deployed site;
  (3) the single card of open questions.
- **Reporting:** every tab update leads with one row
  `tab · ticket · status (queued/building/diff/wiring/live) · pixel-diff % · parked items · blocker`.
- **Core-data changes wait on the pre-publish reconcile gate (TEN-329, landed `9394f7db`).**

## Palette (D1)
- **The modal is coloured like every other surface: from `tokens.css`** (founder TEN-376, 2026-10-03 — the modal's own
  Night 24b / Day 26f file `match-analysis-tokens.css`, its `--ma-*` tokens and the U1–U24 mappings are retired). It
  follows the one site theme (`data-theme` on `<html>`, `theme.js`); `maSetTheme` / `maApplyTheme` delegate to it.
  All rules — surfaces, three greys, blue = fills, green/red = signed only, neutral surfaces, 1px edges — are
  `.claude/rules/foundation.md`. **Test:** `tools/lint-raw-colours.mjs` finds no raw colour in the modal's builders,
  and switching the theme re-colours every open modal surface without a reload.
- **No figure without a count** (founder, same comment). **The event hold rate** (founder Q9, 2026-09-30) = service
  games held ÷ service games played at this event, from **our own box scores over every edition on file**
  (`event-hold.json`, built by `build-event-hold.js` from `boxscore-archive/` in every pipeline run), n = service games,
  both players, qualifying included (the archive carries no round). The Tournament tab (header meta cell) and Key
  factors' Tournament card print the same cell (`trHoldHtml`); its tooltip always states n. It replaces the
  court-conditions sheet's count-less `COURT_CONDITIONS.serviceHold`, which no modal surface prints. No box score for
  the event → "—" with the reason. **Test:** `test-ten341-key-factors.mjs` "Q9" (Key factors = the Tournament tab,
  n in the tooltip; mutations: Key factors back on the count-less dash, the window cut to recent seasons) and
  `tools/test-ten368-event-hold.js` (the builder).

## Players and avatars (D4, D5)
- **Both players are neutral on every tab, Odds included** (TEN-380, measured on OFFICIAL VERSION 1): both names, both
  header prices and both players' key figures are white (`--text`); a series that must tell the two apart uses the
  chart rule (lead / second), never the link blue. **Test:** no player name, sparkline, chart line or pop-up square takes
  the link blue, and the header's player-B name and price read `--text` (`test-ten303-colours.mjs`).
- **Avatars = ATP photos from `player-atp-aliases.json`, monogram fallback**, in the header and the match stats
  sheet, **inside the design's ring and size geometry** (header 40px, sheet 56px, ring as designed).
  **Test:** a player with an alias renders an `<img>` from the alias chain at the design's size and ring; one
  without renders the monogram in the same ring.

## Opening tab (founder step 3, TEN-380 README §1, 2026-10-03; replaces Q26 "always opens on Key factors")
- **The modal always opens on Odds**, as the reference does. There is no last-used-tab memory. An explicit link to a
  tab (`openAnalysisModal(id, tab)`) still opens that tab. **Test:** `test-ten314-modal-frame.mjs` "TEN-380" (open,
  switch to Key factors, reopen: Odds; an explicit tab still opens; mutations in `tools/test-ten341-mutants.js`: the
  last-used tab restored, the default back on Key factors).

## Header and footer (founder 2026-09-28, TEN-314 card answered in TEN-312 comment c1883bb0)
- **Not-completed, not-live match:** the design's centred matchup strip (avatars, names, price pills).
- **Live / suspended match:** keep the **sets-won pills and the live bar** (the design draws no live state; logged as a
  design gap on TEN-312 document `design-gaps`). Don't invent new design for it.
- **Completed match** (founder TEN-380 review item 5, 2026-10-04; replaces 2026-09-28 "nothing in the header centre"): the
  matchup strip stays (avatars, names), its pills the **card book's close** (`_mcCardCloseOf`, the same one book as the card;
  a missing close is "—", never another book); still **no sets score** beside the subtitle — the result lives on Match Stats.
- **Prices on every surface are the card's one book** (founder TEN-380 review item 4, ruling 15): the header (= Market edge's
  "today"), Key factors' Odds box and the Odds Match Winner tile all print the match card's pair — `_mcNowPair` (the card
  state's book, its stream tick when newer) and that book's own Open — never `m.bestOdds` or another book. **Test:**
  `test-ten310-market-edge.mjs` (header = card pair, never bestOdds), `test-ten303-odds-tab.mjs` "review item 4" (KF box =
  tile).
- **Round names are ours** (review item 5): the subtitle and the match stats sheet read `maRoundName` — 1/16-finals → R32,
  1/8-finals → R16, 1/4 → Quarter-finals, 1/2 → Semi-finals; anything else as the feed writes it. **Test:**
  `test-ten314-sheet.mjs` "review item 5".
- **No footer line.** "All stats are updated live…" is removed (it isn't true and isn't in the design). If a real data
  timestamp exists for the open match, show "Updated X min ago"; otherwise show nothing. **Test:** the modal contains no
  "All stats are updated live" text.

## Download report (D7)
- Keeps the existing behaviour: `printAnalysisReport()` → `window.print()` of the modal. Rendered as designed.
  **Test:** clicking it calls `window.print`.

## Sample-size gate (D2) — one gate, `tourxSampleGate`
- **Counts always show** ("5 of 7", "3 of 3", W–L). **Percentages / rates** go through `tourxSampleGate` (dash)
  and nothing else: n ≥ 10 full · n 5–9 greyed + "small sample" note · n < 5 no % (W–L or count only) ·
  n = 0 "—". **Test:** a fixture with n = 0, 3, 7, 12 renders "—", count only, greyed + note, full — on every tab.
- **Hot lines** need ≥ 3 eligible matches (`FH_HOT_MIN_ELIGIBLE`) to **appear**; the % beside a line follows the
  gate (a "3 of 3" line shows no %).
- The Market edge floor (`ME_THIN_FLOOR = 5`) and Form `THIN = 5` keep their n < 5 behaviour and **gain the 5–9
  grey tier** through the same gate.
- **Never render `0%`, `0.0%` or `NaN%` at n = 0** (design sites: Tournament W–L tile, Overview career/surface/
  season %, sheet `pct` helper, Playing style personal record). **Test:** n = 0 renders "—".
- **Small-sample chip:** shown for every n 1–9 per the gate, not only `n === 2` (design L4346 and dash
  `fhH2hRecCard` both wrong). **Test:** n = 1, 3, 9 show it; n = 10 doesn't.
- **Exceptions to the gate (founder 2026-09-29, TEN-312 card):**
  - **H2H record tug bar** is drawn at any n ≥ 1, as the design draws it (a 2–1 record fills 67/33). The numbers
    beside it still follow the gate. **Test:** a 2–1 H2H renders the bar at 67/33 and no %.
  - **Market edge "Needs"** is not gated: it is derived from prices, not a sample rate.
  - **Archetype-matrix %** is not gated here (its own upstream floor applies). The **event hold rate** is not
    gated, but its tooltip always shows its n (service games) — no figure without a count (founder 2026-09-28,
    TEN-314 70fb039e; the rate itself: Palette, "No figure without a count", founder Q9). **Test:** the hold rate's
    tooltip states n; an event with no box score shows "—", never a %.
  - In narrow table cells the 5–9 "small sample" note is a hover note plus a footnote, not inline text.

## Match stats sheet — every tab
- **Every match row, dot and cell opens the one sheet**, on every tab, Market edge included (its "stats on file"
  click condition is dropped). The header (meta, score, set chips, closing odds) is always wired from match data;
  where stats don't exist (pre-2024, ITF, events without W/UE) the stat sections show "—" plus "Match stats not
  available for this match" (10.5px, faint). **Test:** a pre-2024 row opens a sheet with a wired header and the note.
- **Date format** in the sheet is exactly the design file's (founder 2026-09-29). DF mkSheet L4856 prints its source's
  date: a Form row `DD.MM` (P1 "Washington · Hard · R16 · 18.07"); every other list `DD.MM.YY` (Tournament L2609,
  Overview L3140, Market edge L3411, H2H L4481, Progression L4043, Playing style L3639); the Match Stats tab's inline
  copy the long date ("Jul 20, 2026", DF L4881). **Test:** `test-ten314-sheet.mjs`.
- **Sheet scopes in the pixel diff:** Match, Set N and Point-by-point are each diffed against the design file, fed
  through **our real stats model**, not only the demo numbers. Required before TEN-338 Match Stats is done.
- **Design exception — Key stats bars:** the bars keep the 2026-09-24 rule (`modal-form-h2h.md` "Bars — one rule",
  `fhStatBarWidth`), not the design's share-of-total. Deliberate; the pixel diff reports it as ruled, not structural.
- **Design exception — point order (Q5, founder 2026-09-29, TEN-312 bbe5c072):** the point log follows the **header's
  player order**, as Flashscore does (the 2026-09-24 ruling kept); the serve ball marks the server. The file writes each
  point server first; we don't. **Test:** on a game player B serves, the running score reads A's points first.
- **Design follows the data (founder 2026-09-29):** where the design file contradicts its own numbers, our counts win and
  each case is a logged design exception, not a divergence: (1) 1st serve % drawn 58.8% against its 38/65 = 58.5%;
  (2) its pressure-points figure, which matches none of its counts; (3) LOST SERVE tags that disagree with its own running
  score in 11 of 20 games. **Test:** every sheet % equals its own count ratio; LOST SERVE appears exactly on games the
  server lost.

## Metrics with no formula before TEN-312 (D6)
- **Per-tournament "+Y.Ypt vs market"** = the player-scope rule (`build-market-edge.js` `summarise`: actual win %
  − mean de-vigged implied %) applied to that player's rows at the event, **n ≥ 5**, prices in the R8 book order
  (`FH_BOOK_ORDER`). n < 5 → "—". **Test:** a fixture event with 5 priced rows reproduces `summarise`.
- **Surface Elo:** there is no 52-week or career Surface Elo (`ratings.md`). The DNA radar's Surface Elo axis
  shows the **current** surface Elo on both views, labelled "current". **Test:** switching the DNA window does not
  change the Elo axis value.
- **DNA "Career" is renamed "Since Mar 2024"** (the data starts 2024-03-06).
- **DNA percentiles are true percentiles** (rank within the stated population), not the p2–p98 linear rescale;
  a tooltip states the population and n. **Test:** exactly one player per axis/scope/surface sits at the top
  rank, and the tooltip's n equals the population size.

## Defaults and scope (N1, N5, N7, N8, N9, N10)
- **N1:** H2H opens on **All** surfaces; Form opens on **today's surface**.
- **N5:** Tournament **Backing** uses the R8 order (Pinnacle, then Bet365; `FH_BOOK_ORDER`). The player-profile
  per-event Backing reads the same rows (founder Q8, see Tournament tab). **Test:** the two show the same units and
  "vs market" for the same player and event.
- **N6:** Tournament / profile edition lists show **only editions the player actually entered**. No edition header is
  synthesised from a gap year (the old `withdrew` fill in `bsp-pipeline.js` minted "Withdrawal" for editions never
  held). **Test:** a player with editions 2019 and 2022 shows no 2020/2021 header.
- **N7:** Tournament W–L is **main draw only** — qualifying rows are filtered out.
- **N8:** Challenger / ITF row prices stay "—" (no opponent-key join yet).
- **N9:** News empty state = the file's copy: "No recent news for {A} or {B}." + "View all news →".
  `SAMPLE_NEWS` and the sample fallback are deleted, never hidden.
- **N10:** the Key factors "Dimension edge" card uses the **5-axis DNA** data. The MCP / Sackmann radar
  (CC BY-NC-SA) is not used on any paid surface. **Test:** the modal never fetches `style-radar.json`.

## Tournament tab (TEN-332, built 2026-09-29)
- **Structure = the design file** (DF L216–331, `tournamentFor` / `tourRecFor`): header card (tile, name, location, surface
  as neutral text, four meta cells), the "Show court speed & market" toggle opening the **inline** panel (speed gauge,
  seven-season trend, two ROI cards, favourite reliability), the ROI cards opening the **Database page embedded**
  (`DatabaseTab.mount`, reused as built, mounted on `<body>` so the modal's `.modal button` rule cannot restyle it), and
  "Record at X": per player five tiles + the shared rows (`maMatchRowsHtml`), one group per edition
  ("X YYYY" + result · W–L), every row a registered sheet row (`fhOpenSheet`).
- **Display (founder step 3, TEN-380, measured on OFFICIAL VERSION 1):** header card `--card` + `--edge-6`; the surface is a
  chip ("Hard court", `--selected` + `--line`); meta values in IBM Plex Mono, the current cell (Round) on `--inner`; the
  "Show court speed & market" toggle is plain text with white words; ROI values are `--text` (a value's colour never follows
  its gap to the tour average — the "−3.7% drawn green" bug); favourite reliability = `--bar` on `--track`; record rows on the
  shared README §5 grid with a "Score" head. No tooltip may widen the column (the Backing tooltip opens leftwards).
  Charts (founder TEN-380 Q2, 2026-10-03): the court-speed bar is flat `--white-bar` with a white knob (README §11; no
  gradient, no blue); the seven-season trend is a line only on dotted horizontal guides (`--viz-guide`, dash 2 6), no area
  fill, no vertical ticks. **Test:** `test-ten332-tournament.mjs` "TEN-380" + the Q2 mutants in `tools/test-ten332-mutants.js`.
- **Data:** editions = `m.p?TournamentHistory` (pipeline; main draw only, N7; walkovers out, N2; only editions entered,
  N6). Set scores from `career-history/{key}.json` joined by event key, else season + opponent + result (exactly one row).
  Prices from `match-closes/{key}.json` through the Form/H2H picker (R8, N5). Header / panel from `m.venue`, `m.courtSpeed`
  (N4 label = `courtSpeed.category`, never re-banded in the tab) and `tournament-market.json`.
- **Backing** = flat 1u over the rows priced by the R8 picker; a retirement settles at the close (TEN-325, the note from
  `MarketEdgeCore.RET_SETTLE_NOTE` in the tile's tooltip). **"vs market"** (D6) = win rate − mean de-vigged implied rate,
  n ≥ 5 priced, 5–9 greyed. Units show at any priced n.
- **Result label** per edition: "Won" (won the final) · the round lost in the feed's words ("Quarter-final", "Round of 16")
  · "In progress" (this event, this year, last match a win; DESIGN GAP G17) · "<round> · w/o" (reached unplayed).
- **Not drawn:** the reading paragraph (DF L231) is dropped (founder Q11, 2026-09-30): no node, no heading and no
  reserved space until the founder sends copy; synthesised "Withdrawal" headers (N6). **Test:** `test-ten332-tournament.mjs`
  "Q11" (no paragraph node; the header card ends at its meta grid).
- **Hold rate:** a fifth header meta cell (DESIGN GAP G43: the file draws no hold rate on this tab), the event hold
  rate of Palette "No figure without a count" (founder Q9).
- **Seven-season trend:** the axis is 2020–2026 as drawn; only seasons the sheet holds (2023–25) get a dot and a value, the
  rest a dash; a hole breaks the line; the delta states the real span. Roland Garros speed and altitude dash with the
  TEN-321 note until its key lands.
- **One row source for Backing (founder Q8, 2026-09-30):** the player-profile per-event Backing (the Record per
  tournament column and the "Backing him here" tile, units and "vs market") is the tab's row-level join — each
  edition's main-draw matches (walkovers out) joined to career-history and the closes shard, R8, retirements settled at
  the close — computed by the page's `trProfileBacking` → `trModelOf`, never the market-edge shard's attribution.
  The profile's edition rows carry no event key or date, so each is first resolved to its one career-history row (season +
  opponent + result + this event's names, the archive names and the names this player's unambiguous rows vote for it; the
  round breaks a tie) and then joined by that row's key, as the tab joins. A row with no single match stays unpriced, never
  guessed (known limit: the tab can still price a row career-history lacks, by its date; the profile store has none). A
  failed load reads "prices unavailable", as on the tab.
  **Test:** `test-ten332-tournament.mjs` "Q8" (the profile prints the tab's units and "vs market"; mutation: the
  profile reads the market-edge shard's attribution) + `tools/test-ten332-mutants.js`.

## Retirements in price figures (founder 2026-09-28, TEN-312 option A)
- **An in-match retirement settles at the listed closing price, everywhere**: Form (flat 1u, v market, medians), H2H
  (price range), Market edge (tab and profile), Tournament Backing and "vs market". One treatment for the same match on
  every surface. W–L already counts it (N2). Evidence: document `retirement-options` (1,237 of 42,858 priced ATP
  matches, 2.9%). **Test:** the same retired match contributes the same P&L on Form, Market edge and Backing.
- **Settled on the ATP result only** (founder 2026-09-28, TEN-314 comment 70fb039e): the player the ATP credits with
  the win is the winner, at his listed closing price. **Bookmaker settlement rules do not apply** — no book's
  retirement rule (void, "one set completed", etc.) is fetched, quoted or modelled, and no "unconfirmed book rule"
  label appears anywhere.
- **Every surface that counts retirements in profit prints "Retirements settled on the official ATP result."** as a
  footnote or tooltip: Market edge (tab band card + profit chart, player-profile Market edge), Form (flat 1u / v market),
  H2H (Price range), Tournament Backing (modal tile and the profile per-event Backing column). The words come from one
  constant, `MarketEdgeCore.RET_SETTLE_NOTE` (`market-edge-core.js`); no surface spells them out. A tab rebuild
  (TEN-330 … TEN-341) that renders one of these figures carries the note in its definition of done.
  **Test:** `tools/test-ten325-retirements.js` (exact text, one source, H2H + profile sites) and
  `test-ten310-market-edge.mjs` "TEN-325" (both Market edge footnotes, rendered).

## Court-speed label — one scheme site-wide (N4, founder 2026-09-28)
- The label is the **pipeline 3-band on the 0–100 index**: `courtSpeedCategory` (`bsp-pipeline.js`) — ≤ 43 Slow,
  ≤ 68 Medium, else Fast. The player-profile quintile bands (`SPEED_BANDS`, grass forced Very fast) and the design's
  raw-AS cut-offs (< 0.90 / < 1.15) are retired. Evidence: document `n4-court-speed` (64 venues).
  **Test:** for every venue, the modal Tournament card, Key factors, Weather pace tile, Tournament Report and player
  profile print the same label.

## One formula per stat name (founder 2026-09-28)
- **Serve rating** = 1st-in % + 1st-won % + 2nd-won % + service-games-held % + aces − double faults (per match: the
  counts; per season: per-match averages). **Return rating** = 1st-return-won % + 2nd-return-won % + return-games-won %
  + BP-converted %. These are the house formulas (`fhSheetModel`, dash) and apply on **every** surface, including the
  Tournament Report (`tourxDerivedMetrics`, today 4-term serve), the Live tab (today 3-term return, aces/DF as % of
  service points, a 10-point warm-up floor and missing-as-0 — a missing component now shows "—") and the **Edge model**
  value layers, whose return divisor is **re-fitted** to the new scale (report the re-fit before it goes live).
  **Test:** one shared helper computes each rating; a grep finds no second implementation.
  - **Built (TEN-327):** the helper is `house-ratings.js` (dashboard `<script src>`, required by `h2h-model`);
    `tools/test-ten327-house-ratings.js` locks every surface on the doc's three box scores.
  - **Edge model — house formula LIVE (founder approved 2026-09-28, TEN-314 70fb039e; TEN-345 `cd809633`):**
    `h2h-model/config.js` `EDGE_RATING_FORMULA = 'house'` is the **one switch** layers #9 and #10 read (re-fit
    return divisor 16.9). The legacy formulas stay in the code; rollback = that line back to `'legacy'`, one commit.
    A before-switch copy of the board's fair prices and picks is kept; after deploy, 3 matches' live fair prices must
    equal the re-fit report; after 7 days live, report picks, hit rate and ROI (each with n) beside what legacy would
    have produced on the same matches. **Test:** `test-ten327-house-ratings.js` fails if the switch is rolled back
    or a layer stops reading it. The **deployed** `career-splits.json` must carry `acesPM` / `dfPM` (the house serve
    abstains without them).
- **Under pressure** has **one builder**: the `surface-ratings.js` formula with its floors (50 BP faced, 50 BP chances,
  6 tiebreaks, 5 deciders; 3-of-4 → mean × 4; Challenger fold-in × 0.9), used by **every display** — the Edge Ratings
  table, Database boards, H2H rating row and all three style radars (DNA). The DNA builder's floor-less version and any
  display of `clutch-rating.js` are retired for display. **Test:** Medvedev Clay last-52 reads the same value on the
  Ratings board and the Playing style radar.
- Evidence: document `formula-unification` (every place that changes, before/after on 3 players).

## Design-file bugs not to port
- Market edge band `bandOf` returns −1 above 15 in the design (DF L3422) and crashes; the live band ladder is
  open-ended above 6.00 and stays so. **Test:** a 21.00 price lands in the 6.00+ band.

## Walkovers and retirements — every tab (N2: "as the ATP rules and the ATP website do")
- **A walkover is neither a win nor a loss, for either player, on every tab** (Form, H2H, Overview,
  Tournament, Playing style, Market edge, Key factors): it is not a match played. It never enters a W–L,
  a set count, a rate, a hot line or a price population. It may appear as a row only where the design
  lists results, marked "w/o", and it is excluded from every count on that row's page.
- **An in-match retirement is a match** for W–L: a win for the opponent, a loss for the retiree, marked "ret."; its
  unfinished set is excluded from set tallies, deciding sets and games/sets lines (H2H rule e). In **price** figures a retirement settles at the listed price everywhere (ruling A, 2026-09-28; see `modal-analysis.md` "Retirements in price figures").
- This **supersedes the TEN-8 "W/O received = win" records rule everywhere**, the player profile included
  (founder 2026-09-28: one spine, both surfaces agree). `careerByYear`, career-history-derived W–L and
  tournament-history W–L all follow it. **Test:** a fixture player with one W/O given, one W/O received and one
  retirement shows W–L that counts only the retirement, on Form, H2H, Overview and Tournament alike.

## Overview career spine (N3)
- The Overview reads `careerByYear` (the player-profile spine), not `matches.json p?Yearly`.
- `bsp-pipeline.js` keeps every tier/surface split reconciled: for every year row `atp + chitf = total`
  (the 2021 hole-fill rebuilds the tier and indoor fields too), and a pre-2021 row is never labelled "ATP" unless
  it holds tour-level matches only. Value changes in `player-profiles.json` and `matches.json` are approved;
  the roster-wide before/after delta (with denominators) is reported before deploy. **Test:** over the deployed
  `player-profiles.json`, 0 rows where atp + chitf ≠ total; 0 pre-2021 rows labelled ATP with more matches than
  tour-level rows held.

## Gates for this build
- **Every tab** goes: build → fixture pixel diff against the design file in Chromium (diff % per screen) → real data →
  dashes where data is missing → deploy → verify on the deployed URL → Night/Day screenshots to the founder.
- **Rebuilt data is tested before it is published:** the reconcile checks (`tools/test-pp2-reconcile.js` and friends)
  run against the **freshly built** store inside the pipeline, before the commit-back / publish step, and fail closed
  (TEN-329). **Test:** reverting a data fix that the reconciler catches stops the pipeline before the push, not after.
  **It runs on every rebuild** (founder 2026-09-30, TEN-312 6c9a9e55, TEN-351): speed-ups may parallelise, cache or
  de-duplicate its work, but never skip it, run it less often than every rebuild, or move it after publishing.
  **Test:** every `pipeline.yml` run that publishes has the gate step before the publish step, with a pass result.
- **A walkover is never counted in W–L**: an assertion in the reconciler fails if one is (TEN-320).
- **Edge model re-fits are staged, never flipped without the founder**: a layer change ships with a report of fair
  odds, picks changed (n of N) and accuracy before/after on the last 30 days of completed matches (TEN-327), and goes
  live only on the founder's explicit approval (as TEN-345 did), behind one rollback switch.

## Data protection
- **`point-by-point-cache.json` is irreplaceable:** api-tennis no longer returns tiebreak point rows for past
  matches. A from-scratch rebuild must not drop stored tiebreak points. **Test:** a rebuild over a cache holding
  tiebreak points fails if any stored tiebreak point row disappears.
- **`dna-apitennis-ratings.json` is rebuilt on a schedule from the current roster** (no absolute paths, never the
  committed July `player-profiles.json`). Playing style does not ship before this lands.
