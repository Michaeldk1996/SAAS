# Tournaments tab — Overview · Entry list · Draw · Reports (founder rulings 2026-11-15, rebuild)

Applies to the Tournaments page: the shell in `bsp-consult-dashboard.html` (`renderTournamentsTab`, the header card, the
tab track, the data helpers the modules call) and the four section modules `tournaments-overview.js` (`TTOverview`, which
also styles the shell), `tournaments-entry.js` (`TTEntry`), `tournaments-draw.js` (`TTDraw`) and
`tournaments-reports.js` (`TTReports`). Reports has its own file: `.claude/rules/tournament-reports.md`.
Rationale: `BUILD-NOTES.md` "2026-11-15 — Tournaments tab rebuild".

## The design is the specification
- **The handoff `design_handoff_tournaments_tab/` is canonical** (prototype `*.dc.html` + `README.md` + `DECISIONS.md`;
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
  page). **Test:** `tools/test-tournament-page.js` (no Stats tab), the builders' own `tools/test-how-it-plays.js`,
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
  number or formula; a genuine zero prints 0. **Dashes by ruling (no source, founder 2026-11-15):** every Draw chance figure
  (title, quarter, per round, face-off, lead-bar position, "both get there", "x% likely", opponent win chance, the outright
  leader / rows / quarter cards, the Outright pill, any verdict built on chances), fair-odds ranges, likely opening price
  ranges, "Be careful" / "No warning", the underdog lists. The boxes are built; the figures read "—"; a sentence built only
  on chances is omitted. **Test:** `tools/test-tt-draw.mjs` "chances are dashes everywhere" (mutant: a chance figure).
- **Court speed = the Tennis Abstract readings we hold** (founder 2026-11-16, "we have court speed data"; replaces the
  2026-11-15 dashes). The figure, its band word, the rank line, the speed-by-year series (2023–2025 readings; a year with
  none is a dash) and the Court speed box read `COURT_CONDITIONS` (`abstractSpeed`, `as2023`–`as2025`) — the same figures
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
  current ISO week ∪ the registry's in-play events, de-duplicated on city); the header stat and the current week's chip
  count it. **Test:** `test-ten401-b.mjs` header + r1.4, `test-ten403-header.mjs`.
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
- **Altitude** = `COURT_CONDITIONS.altitude`. **1st serve points won** = `how-it-plays.json` `past.metrics.firstServeWon`
  num / den over every past edition on file — hard courts only; elsewhere "—". **Service hold** = `event-hold.json` held /
  games (our box scores, main draw, every edition on file); no box score → "—". **Test:** `tools/test-tt-overview.mjs`
  "service hold" + "1st serve won".
- **ROI tiles coloured by their gap to the tour:** within 1 pp `--text`, above `--pos`, below `--neg`. **Favourite
  reliability** prints "Nth of N tournaments" over events with n ≥ 30, judged on the printed whole percent (ties share a
  rank). **Test:** `tools/test-tt-overview.mjs` "ROI coloured by its gap to the tour; reliability rank of N".
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
- **Clicking a player selects him** (route card), a finished match included; a qualifying row opens his profile.
  (Supersedes "a finished match opens Match Analysis".)
- **Finished draw matches stay openable elsewhere:** `draw-matches.json` keeps every finished main-draw match's board row +
  model entry 16 days from the match date (refreshed while on the board, frozen once off; the board's copy wins); read by
  `matchById`. **Test:** `tools/test-draw-matches-store.js`.
- **The W/UE sheet bar lives on the Draw view only**, under the progress line (`tourxWueBarHtml`: "Download W/UE sheet",
  one "Copy {round}" per round, the round status). Reports does not carry it. **Test:** `tools/test-wue-sheet.js`,
  `tools/test-wue-fixes.js`, `tools/test-wue-rounds.js`.
- **How it plays may be shown to members** (founder 2026-11-16: we have an agreement covering the Sackmann data it is
  built from, 2016–24), on the Overview's 1st serve points won and the Draw Statistics Speed tiles.
- **Statistics:** Speed tiles = `how-it-plays.json` (this edition + tour average; "vs 2025", "vs past five" and the past
  bars "—" where How it plays holds only the pooled figure). Favourites and underdogs = `favourites-by-round.json`
  (Favourites won) + this event's `database-yield.json` rows + retRows through `settlement.js` (yields, the match box) +
  `tour-baselines.json`; decider / comeback from this edition's scores. **Test:** `tools/test-tt-draw.mjs` "statistics".
- **Opponent report:** head to head and last five from `H2HCore` over career-history shards; record against his archetype
  from `playing-styles.json` + style-meetings; every chance / warning a dash.
- *Open (not ruled):* "Favourites won" mixes this edition's favourites-by-round with past Database rows; played bracket
  matches carry no closing-price hover.
