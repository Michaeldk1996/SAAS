# Tournaments tab — Overview · Entry list · Draw · Reports (founder rulings 2026-11-15, rebuild)

Applies to the Tournaments page: the shell in `bsp-consult-dashboard.html` (`renderTournamentsTab`, the header card, the
tab track, the data helpers the modules call) and the four section modules `tournaments-overview.js` (`TTOverview`, which
also styles the shell), `tournaments-entry.js` (`TTEntry`), `tournaments-draw.js` (`TTDraw`) and
`tournaments-reports.js` (`TTReports`). Reports has its own file: `.claude/rules/tournament-reports.md`.
Rationale: `BUILD-NOTES.md` "2026-11-15 — Tournaments tab rebuild".

## The design is the specification
- **2026-11-20: `design_handoff_tournaments_2026-11-20/` replaces `design_handoff_tournaments_tab/`** (founder; untracked,
  never published). `design/` is the build target, `reference_options/` is not built; README + `CHANGELOG_2026-11-20.md`
  (newest entry wins). Where this file and that handoff disagree on LOOK, the handoff wins; every data rule below stands.
  Its colours map to `--tt-*` (`--tt-lifted` #121521, `--tt-hover` #171B28, `--tt-track` #0A0C13 added); small labels
  11.5/600 grey, never caps; avatars = player photos by key (initials only as the fallback); tournament logos =
  `tournament-logos/index.json`. **Test:** the four `tools/test-tt-*.mjs`.
- (pre-2026-11-20) **The handoff `design_handoff_tournaments_tab/` was canonical** (prototype `*.dc.html` + `README.md` + `DECISIONS.md`;
  when they disagree: prototype source > newest DECISIONS entry > README). **Design wins** over every standing site rule it
  contradicts (founder 2026-11-15). Named exceptions this tab carries, each by that ruling:
  ROI coloured by its gap to the tour (not its sign) · no visible n on a figure (the n and its population live in the
  figure's hover `title`) · the gradient fill under the speed-by-year line · native `<select>` year menus · blue selected
  states and blue focus rings · overlays whose scrim covers the rail (`inset:0`, not `--sf-side`) · city names as the design
  prints them (never `tourxEventName` / `sfEventName` on this tab) · the 4-band speed label · the 1st serve points won /
  Service hold tiles · the Entry list "published" date (a dash: no source) and the selected week's count · Reports ranks
  every player per quarter and averages the rows shown (`tournament-reports.md`) · Reports' Head-to-head prints the
  better figure white 800, the other muted 500 (an exception to CLAUDE.md's neutral two-player display).
  **Test:** does a box, colour or copy differ from the prototype's inline style for that state? Then it is wrong, unless
  a rule below says why (a dash for a missing source, a post-export product feature).
- **Stats tab is gone**, and with it How it plays, Favourites vs underdogs by round and Points to defend on this page.
  `tourxSetSection('stats')` falls back to Overview. The builders and their files stay (`how-it-plays.json` and
  `favourites-by-round.json` feed the Overview and Draw figures below; `points-to-defend.json` is shown nowhere on this
  page; 2026-11-20: it is the Draw tab's Points to defend view, see Draw). **Test:** `tools/test-tournament-page.js` (no Stats tab), the builders' own `tools/test-how-it-plays.js`,
  `tools/test-favourites-by-round.js`, `tools/test-points-to-defend.js`.

## Colour, scope, theme
- **Colours = the export's exact values, through tokens.** `tournaments-tab.css` remaps `--card --inner --selected --text
  --text-soft --text-label --pos --neg --link` to `--tt-*` inside `.tabpage[data-page="tournaments"]`; every other export
  colour is a `--tt-*` token in `tokens.css`; alphas are `color-mix(in srgb, var(--tt-white|--tt-blue|--tt-black) N%,
  transparent)`. No raw colour anywhere; borders as the export writes them (1.25px stays 1.25px). **Night only** on this
  page. The site's page glow on `<html>` is shared and unchanged. **Test:** `tools/lint-raw-colours.mjs` = 0; each module's
  CSS is one injected `<style>` with every selector under `.tabpage[data-page="tournaments"]` (`tools/test-tt-overview.mjs`
  "CSS", `tools/test-tt-draw.mjs` "no raw colour, scoped CSS", `tools/test-tt-reports.mjs` "no raw colour").

## Data — every figure ours, or a dash
- **Every figure comes from our data or prints "—"**: never 0 for absent, never a plausible default, never a prototype
  number or formula; a genuine zero prints 0.
- **Draw chances are Stennisfy probabilities** (founder 2026-11-20, replacing the 2026-11-15 "chances are dashes" ruling):
  Outright chances (title, quarter), the route panel (Win his quarter, Title chance, per round, "x% likely"), Compare two
  routes (each open round = his chance against the most likely opponent; Title) and the opponents box (chance, bar on the
  50% tick). P(A beats B) = the Stennisfy Model's adjusted fair probability (`model-output.json` `stage3.fair`) for an
  unfinished Today's Matches card of that pair, else the model's Stage-1 Elo base (`h2h-model/elo.js` `baseProbability`,
  `config.js` weights, `elo-ratings.json` by the model's key rule), ported as `eloBaseP` in `tournaments-draw.js`. Chances
  follow the bracket exactly (`chanceDP`: played matches and walkovers fixed, byes advance). Fair odds = 1 / chance, two
  decimals, one price (no range). A player with no Elo → every chance that depends on him is a dash, never 50%. Round
  robin (ATP Finals) is not modelled: dash. Every figure's hover names its basis. Opening-price ranges and "Be careful" /
  "No warning" stay out until a source exists. **Test:**
  `tools/test-tt-draw.mjs` (DP sums, played match, missing Elo, formula parity with `h2h-model/elo.js`, model price; mutants:
  50% fallback, results ignored, quarter over the wrong half, weights drift, model price ignored).
- **Bookmakers chance beside the Stennisfy one** (founder 2026-11-21, "match prices + Elo", to compare the two; no feed
  sells ATP outright prices): the same bracket DP (`chancesFor(ev, M, F, bookPairP)`), where a pair that is an unfinished
  Today's Matches card takes the no-vig price of the card's ONE book (`_mcNowPair`; both legs ≥ 1.01, overround ≤ 20%,
  else no price) and every other pairing the same Elo base. Shown in the outright view: the leader card, the title rows
  ("Bookmakers") and the quarter cards ("Books"); hover "Bookmakers: no-vig <book> price for matches on Today's Matches,
  Elo base for later rounds". No pair in the draw priced → a dash with the hover "No match in this draw has a bookmaker
  price on Today's Matches yet". **Test:** is the R1 Bookmakers chance of a priced card its no-vig price, a suspended pair
  the Elo base, and the column a dash with no priced card? `tools/test-tt-draw.mjs` (mutant: book price ignored).
- **Speed by year = `court-speed-history.json`** (founder 2026-11-20: "use all of this in our database … until 2020"),
  committed, built by hand with `tools/build-court-speed-history.mjs`: `ta[event][year]` = Tennis Abstract surface speed —
  its season archive for 2020–2023, 2024–2025 from `COURT_CONDITIONS` `as2024`/`as2025` (TA no longer serves those pages;
  the 2023 values agree with TA's archive), the current season from TA's last-52-week page (rows dated in that season);
  `cpi[event][year]` = courtspeed.com Court Pace Index (2012–), Slams, Masters 1000, ATP Finals. Canadian rows follow the
  host-year rule (to 2019 Toronto even; from 2021 Toronto odd); Lyon 2026 = "Lyon (France)". A source that fails to load
  writes nothing. A finished draw's statistics are keyed by the progression's own `tournamentKey` once its board cards
  expire (`draw-matches.json` keeps 16 days). The Draw player box's Break points saved = the progression's `bpSaved`
  (api-tennis Service / Break Points Saved, won / total, summed over his matches; founder 2026-11-20). **CPI shows for Masters 1000 only** (speed card first row, trend Speed index · CPI switch, Compare all CPI
  table; the Canadian Open = Montreal + Toronto by year), credited to courtspeed.com on hover.
- **One speed figure on every page** (founder 2026-11-20, "fix both"): `COURT_CONDITIONS` `abstractSpeed` /
  `abstractSpeedYear` (both copies: bsp-pipeline.js and the dashboard) = the LATEST season reading in
  `court-speed-history.json`, written by `tools/refresh-court-conditions-speed.mjs` (run after the history builder). The
  0–100 `speed` index keeps its original anchors (0.41 = 0, 1.42 = 100, clamped), so a venue's Slow / Medium / Fast label
  moves only when its own reading moves (20 of 64 moved at the 2026-11-20 refresh: e.g. Paris 0.97 → 1.44 Fast, Roland
  Garros 0.68 → 0.84 still Slow, Los Cabos 1.02 → 0.55 Slow). Match analysis, Key factors, the profile's court-speed
  bands, Market edge and this page print the same figure. **Test:** `tools/test-ten321-rg-court-speed.js`,
  `tools/test-pp2-reconcile.js` N4.
- **Court speed = the Tennis Abstract readings we hold** (founder 2026-11-16, "we have court speed data"; replaces the
  2026-11-15 dashes). The figure, its band word, the rank line and the Court speed box read `COURT_CONDITIONS`
  (`abstractSpeed`) — the same figures
  Match analysis, Key factors and the profile print — credited on hover, with the 4-band label (≥ 1.10 Fast · ≥ 0.95 Medium
  · ≥ 0.82 Medium-slow · Slow). ONE switch `TT_SPEED_SOURCE` (`tournaments-overview.js`; `'ta'` default, `'own'` = every
  figure a dash). **Test:** `tools/test-tt-overview.mjs` "court speed defaults to the Tennis Abstract figure" + "court
  speed 'own'" (mutant: the default back on `'own'`).
- **Every n is on hover.** A figure that rests on a sample carries its count and population in its `title` ("n = 1,949");
  none prints it beside the figure. **Test:** `tools/test-tt-overview.mjs` "service hold … n on hover", "ROI … " (yield n
  in the hover); `tools/test-tt-reports.mjs` "the hover states n".
- **Floors.** Betting-market tiles: an event under `minMatches` 30 priced (`tournament-market.json`) is a dash. Draw
  Statistics: below 15 matches a % is a dash, its count in the hover. **Test:** `tools/test-tt-overview.mjs` "a window
  recomputes …" (n ≥ 30) and "no market = dashes, never 0"; `tools/test-tt-draw.mjs` "statistics … floor".
- **The betting market = the Database's rows.** `tournament-market.json` (`build-tournament-market.js`) pools
  `database-yield.json` rows through `settlement.js`: ROI = `Settlement.settleBet` population `n`, Favourite reliability =
  `Settlement.matchWinner`, retirements counted, its own `nRel`; favourite = shorter price. A From / To window recomputes
  the event, the tour baseline and the reliability rank from the same rows the same way (`aggRows`), never an offset; From
  2020 · To 2026 = every edition on record = the published file. No speed-derived formula anywhere. **Test:**
  `tools/test-tt-overview.mjs` "window recompute = builder" + "a window recomputes event, tour baseline and rank" + "the
  rendered window tiles read the window model"; `test-ten242-rulings.mjs` "every ROI card equals the panel it links to".
- **Shared archive strings are split by row** (`build-tournament-market.js` `ROW_SPLIT`): "Rogers Masters" / "Canadian
  Open" by host year (to 2019 Toronto even / Montreal odd; from 2021 Toronto odd / Montreal even), "Masters Cup" = Turin
  2021+, "European Open" by surface + month + year (clay in July = Hamburg 2021–24; hard in October to 2024 = Antwerp, from
  2025 = Brussels). Hamburg also pools "German Tennis Championships" (2016–20). Each split event emits `archiveFilter`; the
  Betting market detail locks the Database panel to those rows (`initialTournamentFilter` → `rowLockFor`). Match analysis
  never joins career rows on a split string (`trArchiveNames`). **Test:** `test-ten242-rulings.mjs` "the ROI panel row
  lock", `test-ten401-f1a.mjs` "review 3" (month branch).
- **A card's event = its own api-tennis `tournamentKey`** (`tpEventOfCard`: a catalog entry's `tournamentKeys`, else the
  venue city). Lyon October 2026 (key 14763, "Lyon (France)", indoor hard) is a new event with no lineage to the clay Lyon,
  the Grand Prix de Lyon or Marseille. **Lineage = same venue only:** Almaty = Almaty 2024–25 (not Astana); Brussels =
  Brussels 2025+. **Test:** `tools/test-tournament-page.js` "a card finds its event by its own key", `tools/test-tt-draw.mjs`
  "Lyon (October) is the new indoor event".
- **Players:** photos through `playerPhotoImg` / `playerPhotoUrl` by player key over the initials circle (initials when no
  key or no photo; `player-photos.md`); a name opens the player profile only on a trusted key. The Entry list draws no
  avatar (the design's row has none). **Test:** `tools/test-player-photos.js`, `tools/test-tt-entry.mjs` "identity".
- **Head to Head buttons** (Draw "Open head to head ›", Reports "Open the full head to head ›") call
  `window.sfGoToH2H(keyA, keyB)` and set `sessionStorage.stn_h2h_pair = JSON.stringify([keyA, keyB, countryA,
  countryB])` — api-tennis keys, not names. **Test:** `tools/test-tt-reports.mjs` "footer + button carry both api-tennis
  keys".

## Event names on this tab
- **This tab prints the city key as the design does** ("Paris", "Beijing", "Stockholm"; a Challenger / ITF entry keeps the
  shard's words, "Helsinki (CH 125)"), in the rail, titles, overlays, Entry list rows, Draw pills and Reports pills / sheet.
  The site's one event name (`sfEventName`, `tourxEventName` with the Montreal / Toronto city suffix) still names events
  on every other page (`h2h.md`, `modal-analysis.md`); search on this tab still finds an event by its printed, official,
  city or other catalog spelling (`tourxEventSearchText`). **Test:** `test-ten402-r2n.mjs` r2.1 (the helpers) + r2.2
  (search) + r2.4 (Reports prints the key); `tools/test-tt-entry.mjs` (city key, never `tourxEventName`).

## Shell — header and tabs
- Header card = the shared 35b `.sfh tourx-head` ("Tournaments", one sentence; stats Events · This week · Updated only when
  all three compute from live data). **"This week" is one set** (`tourxThisWeekEvents()`: every Entry-list shard row in the
  current ISO week ∪ the registry's in-play events, de-duplicated on city); the header stat counts it. **A week chip counts
  that week's list rows at every level** (= the sum of its ATP · Challenger · ITF counts; 2026-11-20 handoff). **Test:** `test-ten401-b.mjs` header + r1.4, `test-ten403-header.mjs`.
- Tabs: Overview · Entry list · Draw · Reports. The markup is `sfSegHtml` (class `tt-tabs`); the look is the design's tab
  track (`tournaments-overview.js` CSS: `--inner` track, 6% ring; selected `--selected` + 16% ring, white 700). **Test:**
  `test-ten401-b.mjs` "the page tabs use it" (markup).

## Overview (`tournaments-overview.js`)
- **Rail** = `tourxOverviewEvents()` (the 64 court-conditions events + the unrated catalog rows: Brussels, Lyon (France) …)
  in `TOURNAMENT_CATALOG` order, never sorted by speed; "This week" (`tourxActiveWeekNames()`) and "Season" heads always
  drawn; search filters both. **Test:** `tools/test-tt-overview.mjs` "rail".
- **Order:** court speed card (figure, track with marker and tour-median tick, "Compare all", then Altitude ·
  1st serve points won · Service hold) · speed by year · Conditions read beside What players say · Betting market with
  From / To native year selects (2020–2026) · three tiles Backing favourites · Backing underdogs · Favourite reliability.
  No Upsets tile.
- **Altitude** = `COURT_CONDITIONS.altitude`. **1st serve points won** = `event-hold.json` `fsWon` / `fsPlayed` (our box
  scores, main draw, every edition, EVERY surface, both players only where both carry the count; founder 2026-11-20 "every
  tournament"), else `how-it-plays.json` `past.metrics.firstServeWon`; neither → "—". **Service hold** = `event-hold.json` held /
  games (our box scores, main draw, every edition on file); no box score → "—". **Test:** `tools/test-tt-overview.mjs`
  "service hold" + "1st serve won".
- **ROI tiles coloured by their gap to the tour:** within 1 pp `--text`, above `--pos`, below `--neg`. **Favourite
  reliability** prints "Nth of N tournaments" over events with n ≥ 30, judged on the printed whole percent (ties share a
  rank). **Test:** `tools/test-tt-overview.mjs` "ROI coloured by its gap to the tour; reliability rank of N".
- **Quotes source (founder 2026-11-20 sheet):** `data/tournament-quotes.csv` = the founder's export with columns TOURNAMENT ·
  PLAYER · YEAR · COMMENTARY · BALLS · COMMENTATORS; the importer rewrites it into its original layout. COMMENTARY is the
  player's words; a BALLS cell that is a quotation on a row with a PLAYER is that player's words too (a separate note);
  COMMENTATORS and supplier notes never import. **Only notes about conditions ship** (speed, bounce, balls, weather /
  humidity, altitude, the court; `conditionsScore` > 0), ordered inside each year by that score (speed counts double); the
  rest are listed in the report. Speakers also resolve against the official draw sheets (`draws.json`,
  `draws-archive.json`) and the board's ATP Finals cards for a season the tournament store does not hold yet. The page
  offers a year switch (`quoteYear`; a year with no note is not offered). A note whose cleaning stays unsafe (narration
  between quotes) is not shown. **Test:** `tools/test-quote-speaker.js`, `test-ten401-f1a.mjs` (cleaner rules on the pinned
  October sheet `tools/fixtures/quotes-sheet-2026-10.json`; the live sheet's safety check).
- **What players say = real, traceable notes only:** the speaker resolves to exactly one entrant of that tournament-season
  (importer `playerMatch` `entrant`, `tools/quotes/quote-speaker.cjs`) and a year. A note whose lead-in names its speaker as
  the opponent, names another registry event and not its own (`tourxQuoteOtherEvent`), or is on `TOURX_QUOTE_EXCLUDE` (hand-
  reviewed, a reason per entry) is not traceable. A note prints the player's words only (`tourxQuoteClean`: no dateline, no
  "said X", the lead-in goes to the meta line; words never rewritten); the CSV and `tournament-quotes.json` stay verbatim.
  An event with no traceable note shows the card with "—" and no click. The box's year pills carry the abstract speed
  ("AS —" in a year with no reading). **Test:** `test-ten401-f1a.mjs` f1.1 + "hand-reviewed exclusions", `test-ten242-rulings.mjs`
  "TEN-401 Data 3 / L3", `tools/test-quote-speaker.js`, `tools/test-tt-overview.mjs` "quotes".
- **Overlays:** Court speed box (four courts side by side), What players say box, Betting market detail (mounts
  `DatabaseTab` with the event's `archiveFilter`). Scrim covers the rail; backdrop click and ✕ close them.

## Entry list (`tournaments-entry.js` on the `EntryListsTab` data layer)
- **Data layer kept:** the two-shard merge, the week set, the roster rank / name join. **The current week is always the
  first week**; every player row has a rank — the list's own, else the current ATP ranking (`player-index.json`, the hover
  says so), else "—"; a name the source PDF cut is completed from the roster; the roster join is by playerKey only when the
  names agree (`namesAgree`). **Test:** `test-ten401-b.mjs` r1.4, r1.5 / r1.6.
- **Design:** title "Entry lists" + the SELECTED week's count (searching: "Entered in N events · all weeks") · search "Find a
  player in every list" (every week) · week track · tier groups · event cards with Main draw / Qualifying / Alternates counts
  and meta "date · surface · published —" (no shard holds the publication date) · an opened card lists `No. · Player ·
  nationality · Rank` · footnote "Acceptance order, not seeding. Ranks are the ATP singles ranking when the list was
  published." No tier chip or status tag on screen (the status rides in the name's hover). The first visit to a week opens
  its first event that has names. Empty search → "No player found" + "Clear search".
- **Dashes:** a count we never fetched is "—" (a real 0 stays 0; a never-fetched list mints no zero); a missing country
  "—"; a missing rank "—". **Test:** `tools/test-tt-entry.mjs` (structure, dashes, search, identity; 17 mutants),
  `test-ten242-rulings.mjs` "ruling 3".
- *Open (not ruled):* names ellipsise in the design's row, against the site's never-truncate rule.

## Draw (`tournaments-draw.js`)
- **Positions come only from `draws.json`** (the ATP Supervisor's sheet). A result is placed by its two players' own draw
  slots (meet round = highest differing bit of (p−1) XOR (q−1), `DrawView.meetRound`); quarters are positions only; an
  undecided slot is empty, never a guessed name. Results from `tournament-progression.json` (`drawResults` once an event
  leaves the board) and `draws-archive.json` (a 404 = none). **Test:** `tools/test-draw-view.js`, `tools/test-tt-draw.mjs`
  "quarters come from draw positions" + "compare: where they meet from positions".
- **Events:** This week · Finished (the two newest ended draws) · Archive (the rest + `draws-archive.json`; the
  design draws no Archive group — kept by the founder, 2026-11-16). Views Draw ·
  Statistics · Outright chances; Main draw / Qualifying (Qualifying greyed while its draw is not posted; no From pills on
  qualifying; From never offers the final). **Test:** `tools/test-tt-draw.mjs` "draw view …" + "qualifying".
- **Status line names both clocks:** "Results {ago}" (progression `fetchedAt`; an archived draw "Final results · archived
  {when}") · "draw sheet {when}" (when the sheet's content last changed).
- **A bye** reads "Bye", no score, not a played match. **NEU** marks a blank country only on a sheet that prints countries.
  **A match in progress** shows the board's live set score oriented to the card. An unplayed pair on Today's Matches shows
  its card book's price (`_mcNowPair`).
- **Clicking a player's name selects him** (route card), a finished match included; a qualifying row opens his profile.
- **Clicking a finished main-draw match's set scores opens the one Match Analysis** (founder 2026-11-16, "clicking a match
  does nothing — fix it"; reverses the 2026-11-15 "supersedes a finished match opens Match Analysis"): `openAnalysisModal(
  'past-<eventKey>', 'matchstats')`, the scores a button (hover wash, Enter / Space). EVERY finished main-draw result is
  clickable, archived draws included. The row is, in order: the board's row (`matches.json`), the draw store's copy
  (`draw-matches.json`), else a row built from the draw's own published result (`resultRow`: players, keys, set scores,
  date, round, surface, event key — nothing else filled in; every tab reads its own shards by event key and player key,
  and a missing figure is a dash). Exact key, never a name. A qualifying match is not clickable. **Test:**
  `tools/test-tt-draw.mjs` "a finished match opens Match Analysis" (every Paris and archived Brussels result; the row = the
  feed result; qualifying never; mutant: no click), `tools/test-draw-matches-store.js` (board → store → draw result row).
- **Finished draw matches stay openable elsewhere:** `draw-matches.json` keeps every finished main-draw match's board row +
  model entry 16 days from the match date (refreshed while on the board, frozen once off; the board's copy wins); read by
  `matchById`. **Test:** `tools/test-draw-matches-store.js`.
  A stored match's court figures are re-read from the page's court table when it opens (`drawStoreFresh`, founder
  2026-11-24): the copy carried the table as it stood the day the match left the board (Paris Masters 55 · Medium against
  today's 100 · Fast). **Test:** `tools/test-match-lookups.mjs`.
- **The W/UE sheet bar lives on the Draw view only**, under the progress line (`tourxWueBarHtml`: "Download W/UE sheet",
  one "Copy {round}" per round, the round status). Reports does not carry it. An archived draw carries it too (founder
  2026-11-16): its rows are the archive's final results (`draws-archive.json` `results`; `WueSheet.fetchLatest` falls back
  to it, the bar reads `WueSheet.cachedArchiveEntry`). **Test:** `tools/test-tt-draw.mjs` "an archived draw shows its W/UE
  sheet bar", `tools/test-wue-sheet.js`,
  `tools/test-wue-fixes.js`, `tools/test-wue-rounds.js`.
- **How it plays may be shown to members** (founder 2026-11-16: we have an agreement covering the Sackmann data it is
  built from, 2016–24), on the Overview's 1st serve points won and the Draw Statistics Speed tiles.
- **Statistics:** Speed tiles = `how-it-plays.json` (this edition + tour average; "vs 2025", "vs past five" and the past
  bars "—" where How it plays holds only the pooled figure). Favourites and underdogs = `favourites-by-round.json`
  (Favourites won) + this event's `database-yield.json` rows + retRows through `settlement.js` (yields, the match box) +
  `tour-baselines.json`; decider / comeback from this edition's scores. **Test:** `tools/test-tt-draw.mjs` "statistics".
- **Favourites won prices every match on the price every page shows** (founder 2026-11-16, "we need these prices,
  everywhere"): `build-favourites-by-round.js` takes each match's `database-yield-master.json` price whatever its book —
  Pinnacle close, else Pinnacle (approx.) (api-tennis, Tennis Explorer, early cut), else Bet365 — and counts the approx.
  and Bet365 matches per scope (`approx`, `b365`; the tile's hover names the split). Only a match the master does not price
  is `noClose`. **Test:** `tools/test-favourites-by-round.js` "every master price counts" (the closes-only builder fails it).
- **Opponent report:** head to head and last five from `H2HCore` over career-history shards; record against his archetype
  from `playing-styles.json` + style-meetings; the win chance is the Stennisfy chance (above); every warning a dash.
- *Open (not ruled):* played bracket matches carry no closing-price hover.
