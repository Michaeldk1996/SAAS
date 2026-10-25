# Tournaments page — header, Overview, overlays, Entry list (founder step 7, TEN-401, 2026-10-08)

Applies to `renderTournamentsTab`, the Overview (`tourx*`) and `window.EntryListsTab` in `bsp-consult-dashboard.html`.
Reports has its own file: `.claude/rules/tournament-reports.md`. Every event name the page prints follows "Event names"
below. Reference = `OFFICIAL VERSION 1.html` → Tournaments,
night, 1512px; the reference wins except where a rule below says *(override)*. The Sep handoff
`design_handoff_tournaments/README.md` (TEN-242 zip, not committed) still holds structure, state and data shapes; its
colours are superseded by `foundation.md`. Reviews are night only; day tokens stay wired.

## Data
- **ROI cards and Favourite reliability come from `tournament-market.json`, built from `database-yield.json` rows** (round 2
  item 1.3: ROI = `Settlement.settleBet` population `n`; Favourite reliability = `Settlement.matchWinner`, retirements
  count, its own `nRel`) — the
  Database page's own rows (Pinnacle closing, else Bet365, per match; favourite = shorter price). Card = the Database →
  Tournament All row for the same event. No speed-derived formula (`roiFav = (speed − 1) × 8 − 2` …) exists anywhere.
  **Test:** the card's yields equal the Database All row (Wimbledon +0.30 / −11.96, n 1,949; `test-ten242-rulings.mjs`).
- **Yield colour = sign** (founder card c572b773, 2026-10-08): `--pos` above zero / `--neg` below, `--text-label` when
  within 1pp of the tour — never the gap to the tour (Madrid underdogs −4.4% vs tour −7.0 is red). **Test:**
  `test-ten242-rulings.mjs` "by SIGN". No join → grey `—`, and the card says "No closing prices joined to this event in
  our archive.", not "not enough matches". Hamburg includes "German Tennis Championships" (2016–20) and "European Open" clay (2021–24).
- **Shared archive strings are split by row** (founder card c572b773 "canada = split", + review fix): `build-tournament-market.js`
  `ROW_SPLIT` pools "Rogers Masters" / "Canadian Open" by the men's host year (to 2019 Toronto even / Montreal odd; from
  2021 Toronto odd / Montreal even — every edition 2010–26 checked against the Wikipedia infobox; 2020 not held, 0
  unplaced), "Masters Cup" = Turin 2021+ only, and "European Open" by surface + month + year (clay in July = Hamburg's editions 2021–24,
  hard in October to 2024 = Antwerp, from 2025 = Brussels; founder follow-up 697cbed9, round 2 2026-10-25). Each split event emits `archiveFilter`; the ROI panel locks to those rows (`DatabaseTab`
  `initialTournamentFilter` → `rowLockFor` / `rowLockOk`, dropped on any new pick); Match analysis never joins career rows
  on a split string (`trArchiveNames`). Measured: Montreal 460 + Toronto 446 = Canada 906; Turin 73; Hamburg 565
  (−4.8 / +4.6); Antwerp 260. **Test:** `test-ten242-rulings.mjs` "row lock" + `test-ten401-f1a.mjs` "review 3" (month branch, synthetic rows) (runs the panel's functions against a
  fixed host-city table) + the card-equals-panel recompute.
- **The tournament page lists every catalog event** (round 2, founder 2026-10-25, replacing "one court-speed registry feeds
  the rail"): `tpPageEvents()` = `TOURNAMENT_CATALOG`, one row per printed event (French Open / Roland Garros once), the
  court-conditions fields merged where a row exists. So events without a Tennis Abstract reading are on the page
  (Brussels, Lyon (France), Sydney, Zhuhai, Pune, Tel Aviv, Astana, Belgrade, Ho Chi Minh City, Jeddah) and the rail
  sorts by name. `tourxConditionRegistry()` still feeds the rest of the site (news, quotes, the speed overlay).
  *Known limit:* the page's `COURT_CONDITIONS` is a hand copy of the pipeline's table, held identical by a drift test.
- **No court speed on tournament pages** (founder 2026-10-25): no hero, knob, band word, rank line, speed-derived
  "Conditions read" or speed trend, and no speed figure in the rail. The Tennis Abstract field stays in the data, and
  other surfaces keep showing it unchanged (Match analysis Tournament tab header + trend, Key factors' Tournament and
  Weather cards, the player profile, the speed overlay). The sheet's count-less "1st serve point won" / "Service hold"
  tiles are off the page too: How it plays prints our own figures with n. **Test:** `tools/test-tournament-page.js`.
- **A card's event = its own api-tennis `tournamentKey`** (`tpEventOfCard`: a catalog entry's `tournamentKeys`, else the
  venue city). Lyon October 2026 (key 14763, "Lyon (France)", Hard (Indoor)) is a NEW event with no lineage to the
  clay Lyon (to 2025), the Grand Prix de Lyon or Marseille — every past-edition figure is a dash.
- **Lineage = same venue only** (founder default 2026-10-25): Almaty = Almaty 2024–25 (not Astana / Nur-Sultan);
  Brussels = Brussels only (2025+; `ROW_SPLIT` gives Antwerp "European Open" ≤2024, Brussels ≥2025 — a name / price
  join, not a lineage merge).
- **SAMPLE_FLOOR = 15 matches** (`TP_SAMPLE_FLOOR`, one line; the builders carry the same value): below it a % / figure is
  a dash with its count.
- **How it plays** (`tpHowItPlaysHtml`, `how-it-plays.json`): service games held, 1st / 2nd serve points won, aces per
  match, tiebreaks per set — this event's main draw over its past editions vs ATP best-of-three hard on the event's own
  indoor / outdoor court, 2016–25 (Sackmann 2016–24, our box scores 2025+), plus this year once at the floor. Header:
  "Main draw, [years], [n] matches · compared with ATP [indoor/outdoor] hard, best-of-three". Partial box scores (off by
  ≥3) are excluded and counted. No verdict text. **Test:** `tools/test-how-it-plays.js` (+ mutants), `test-tournament-page.js`.
- **Favourites vs underdogs by round** (`tpFavDogHtml`, `favourites-by-round.json`): cumulative R1 / R1–R2 / … / F;
  favourite = shorter Pinnacle close from the master (Bet365 "B" Jan–Apr 2026); exact tie with no first-captured price =
  dash, counted; winner = `Settlement.matchWinner`; no-close and walkovers counted in the footnote. Tone only.
  **Test:** `tools/test-favourites-by-round.js`, `test-tournament-page.js`.
- **Points to defend** (`tpPointsDefendHtml`, `points-to-defend.json`, `points-to-defend.yml` twice a day; Points at Risk
  stays retired): order, IOC, player, live rank, badge ("SF | Q"), status, points (bar = points), drop date in the
  header. Q1 / Q2 losers score their actual qualifying round; qualifying rows drop with the main draw (ATP Rulebook
  §9.01 E). **Lucky losers** (founder confirmed 2026-10-25): main-draw points only, qualifying "—", an "LL" badge.
  "Withdrew" from entry-list history is inferred: tooltip "On the entry list, not in the draw". Lyon (France): "First
  edition — no points to defend here." **Test:** `tools/test-points-to-defend.js` (+ mutants), `test-tournament-page.js`.
- **What players say = real, traceable notes only** (speaker matched to one of our players + a year); an event with none
  shows no card. `TOURX_QUOTE_RULE` flips it. No placeholder quote ships. A note whose own lead-in names its credited
  speaker as the opponent ("after his win over McDonald" under M. McDonald) is someone else's words — not traceable; so is
  one whose lead-in names another registry event and not its own ("after beating Poljicak in Umag" under Bastad;
  `tourxQuoteOtherEvent`), and one on `TOURX_QUOTE_EXCLUDE` — a hand-reviewed list keyed `event|speaker|year` with a reason
  per entry (Fucsovics 2026 mixes in women's-match answers, Bellucci 2025 is narration, De Jong 2025 is about Umag); the
  CSV stays verbatim. **Test:** `test-ten401-f1a.mjs` "review: hand-reviewed exclusions".
- **Each note = the player's words only, in curly quotes** (founder TEN-401 f1, supersedes "render verbatim"):
  `tourxQuoteClean` strips at render the city dateline ("WIMBLEDON:"), every "said X" attribution (a comma closing a
  quote before "said" becomes a full stop) and the lead-in outside the quote; the lead-in ("after beating Tien", "on the
  conditions", or a "… said after beating X" clause) goes to the meta line: "2026 · after beating Tien". A second answer
  after "On X:" joins with " … "; a segment another speaker / source said ("Misolic:", "Reddit:") is cut. Never rewrite
  words — the text is the source's own quoted spans in order; the context is a piece of the note. The importer and
  `tournament-quotes.json` stay verbatim (audit copy of the sheet). Measured on 160 traceable notes: dateline 71 → 0,
  "said" 71 → 0, lead-in 58 → 0; 155 of 160 ship (16 events; Wimbledon 13). **Test:** `test-ten401-f1a.mjs` f1.1 (every note).
- **An unsourced metric is `—`, never 0.**

## Event names (founder card 7bc622d5, 2026-10-09: "rename the Tournaments page too")
- **The page prints the site's ONE event name; the city is the data key.** Every place the page shows an event — rail
  rows, hero title, Compare all rows, the What players say / ROI overlay titles and the ROI chip label, the Reports
  picker chip and its monogram, the Reports empty-state lines, the match-stats sheet header, an ATP-tour Entry list row —
  prints `tourxEventName(key)` = `SF_EVENT_NAMES[key]` (the table `sfEventName` prints on Head to Head, Match analysis and
  every sheet), else the key itself. 24 of the 64 rated events change — every Masters 1000, ATP 500 and the Finals: Turin →
  ATP Finals, Cincinnati → Cincinnati Open, Beijing → China Open, Monte Carlo → Monte-Carlo Masters, Shanghai → Shanghai
  Masters, Tokyo → Japan Open, Basel → Swiss Indoors, London → Queen's Club Championships, Hamburg → Hamburg Open … The
  four Slams already print their name; **every ATP 250 keeps its registry name** (Antwerp, Chengdu, Hangzhou; Doha is
  filed ATP 250 in `TOURNAMENT_CATALOG`).
- **Two registry events with one official name print the city after it:** "Canadian Open · Montreal" / "Canadian Open ·
  Toronto" (`TOURX_EVENT_CITY_SUFFIX`; `''` turns it off and the two rows collide). No two rows on the page print alike.
  A rail / Compare all name takes up to two lines (`-webkit-line-clamp:2`), so the city is never ellipsised away
  ("Canadian Open · …" read the same on both rows); short names keep the one-line tile.
- **Roland Garros / French Open** are two `TOURNAMENT_CATALOG` entries for ONE event (a lookup alias; identical
  `tournament-market.json` rows, n 2,071). Only Roland Garros has a `COURT_CONDITIONS` row, so the page lists it once.
- **Display only.** `tourxState.tsSel` / `.tour`, every `onclick` argument, `COURT_CONDITIONS`, `tournament-market.json`,
  `tournament-quotes.json` (and the quote rules that read registry names), `tournament-progression.json`, `ROW_SPLIT` /
  `archiveFilter` and the ROI panel's `initialTournamentNames` all keep the key. Measured before → after on 9 Oct: ROI
  All rows Wimbledon 1,949 / +0.30%, Hamburg 565 / −4.75%, Antwerp 260 / −2.78%, Turin 73 / −11.27%, Montreal 460 /
  −8.10%, Toronto 446 / −5.26%, Shanghai 799 / −1.17%; every Overview figure, quote and Reports number identical.
- **Search** finds an event by its printed name, its official name, its city key or another catalog spelling of it
  (`tourxEventSearchText`): "Cincinnati Open" and "Cincinnati" both find Cincinnati Open; "French" finds Roland Garros.
- **Entry list:** only an ATP-tour row (Grand Slam / ATP …) is renamed (`sfEventKey(name, city)` on the shard's name, else
  its city): Basel → Swiss Indoors, Vienna → Vienna Open, Paris → Paris Masters. **A shared official name takes the row's
  city** (TEN-402 r3): "Canadian Open" / "National Bank Open" in a Toronto year → "Canadian Open · Toronto" (the name alone
  reads back to Montreal); a city never moves a row onto a different event. **Test:** `test-ten402-r2n.mjs` r3.4. A Challenger / ITF row ("Rome (CH 75)") and a
  name the registry lacks (Brussels) keep the shard's words. *Known limit:* rows inside a tier still sort by the shard
  name, not the printed one.
- **Apply:** pick any event on the page; its words must equal `sfEventName(key)` (+ " · city" for Montreal / Toronto),
  and every number must equal the same event before the rename. **Test:** `test-ten402-r2n.mjs` (+
  `tools/test-ten402-r2n-mutants.js`, 23 mutants).

## Header + tabs
- Header card = the shared 35b page header (founder shell refresh TEN-403, 2026-10-08: **no caps line** — "ATP tour ·
  Season calendar" is dropped, superseding TEN-401's kept line; values in `app-shell.md` "Page header (35b, TEN-403)"):
  "Tournaments", one sentence; stats Events · This week · Updated (= `tournament-progression.json` fetchedAt) **only when
  all three compute from live data**, otherwise none (`TOURX_HEAD_STATS`). **Test:** `test-ten401-b.mjs` header,
  `test-ten403-header.mjs`.
- **"This week" is one set of events** (founder TEN-401 r1 fix 4 + review): `tourxThisWeekEvents()` = every Entry-list
  shard row (ATP tour, all levels) in the current ISO week ∪ the registry's in-play events (the rail's This-week group:
  on the match feed, dropped 24h after their final), de-duplicated on city. The header stat, the Entry list eyebrow's
  events, the current week's chip and "lists loaded" (the members with a list, so lists ≤ events) all count it; the
  eyebrow never follows the selected chip. The page loads the shards for it (`EntryListsTab.load()`, no render).
  **Test:** `test-ten401-b.mjs` r1.4 (synthetic + the real shards at 8 Oct and 13 Oct).
- **Every segmented control is the darker track** (`sfSegHtml`): track `--card` + 1px `--edge-6`, selected `--inner` +
  1px `--edge-10` white 700, idle `--text-label`, no hover change. No blue fill or border. **Test:** `test-ten401-b.mjs`.

## Overview
- Rail = panel (`--card` + `--edge-6`); search `--inner`, no edge; group heads Hanken 10.5 caps grey; **selected row =
  `--selected` + inset 16% ring**, no surface wash; tier chip `--inner`, grey, no edge.
- **The selected rail tile is always on screen** (founder TEN-401 f1): after every Overview render (first load =
  Wimbledon, a rail click / search pick, Reports → Overview) `tourxRevealRailSel` scrolls only the rail's own list
  (`.tourlist`), instantly, by the least amount, into the part of the list that is inside the viewport; the page never
  scrolls. The list keeps its scroll across renders (same search). A tile in the last rows (Hamburg) gets the missing
  travel as a bottom spacer, carried over on the next render of the same search before the scroll is restored (else the
  shorter list clamps and visible tiles jump); a fully visible tile never moves. **Test:** `test-ten401-f1a.mjs` f1.5 +
  "review: re-rendering keeps the spacer".
- What players say card: one quote, clamped to 3 lines (`-webkit-line-clamp:3`), meta = player · year · context.
- "Read all N →", "Open … graphics →" are `--link`.
- Condition tiles + Favourite reliability = panels (`--edge-6`), figures mono white; reliability bar `--bar` on `--track`.
  "Completed" badge `--inner`, grey caps, no edge. ROI cards = clickable tiles (`--edge-7`, hover `--tile-hover` +
  `--edge-16`). "View tournament report →" = `--inner` button, white, `--edge-10` on hover.
- **Test:** `test-ten242-rulings.mjs` (TEN-401 blocks: rail, scale, blocks, chart).

## Overlays (Compare all · What players say · ROI)
- Pop-up sheet `--card` + 1px `--edge-10`, `--shadow-modal`, over `--backdrop` + blur covering the content area only;
  close button `--inner`; Esc, outside click and a sidebar click close it.
- Compare all: columns card tone, IND / OUT / CLY / GRS chips `--inner` grey; matched row = selected tile, white text, no
  blue bar or value; bars `--bar` for the matched event, `--bar-2` for the rest. Quote avatars: initials, `--inner`, grey, with the speaker's photo over them when the speaker resolves to one ID (the importer's `playerKey`, `tools/quotes/quote-speaker.cjs` — the ONE quote rule, founder 2026-10-24; `player-photos.md`).
  **A note ships only when its speaker resolves to exactly one entrant of that tournament-season** (importer `playerMatch`
  `entrant`), never against the roster — a roster that grows must not hide a quote. **Test:** `tools/test-quote-speaker.js`.

## Entry list
- Week chips on the darker track; tier heads Hanken 10.5 caps on a 10% rule; table = card; rows on 6% hairlines with an
  `--inner` hover; tier chip `--inner` grey; caret `--inner`, white when open; expanded panel `--inner`; ranks grey mono;
  a missing count is a grey `—`; the empty week is a card. **Test:** `test-ten401-b.mjs`.
- Founder TEN-401 r1 (2026-10-08), **Test:** `test-ten401-b.mjs` r1.4–r1.8:
  - **The current week is always the first chip**, even when the shards hold nothing for it (it then shows the empty
    state); its count is the `tourxThisWeekEvents()` set. Chips and the default week are re-derived at render time.
  - **Every player row has a rank**, grey mono `#12`: the list's own (ATP ranking at publication), else the current ATP
    standings (`player-index.json`), else a grey `—`. A Bye has none. The roster join is by playerKey **only when the
    names agree** (every list word in the roster name — "Clement Hemery" is not key 1206 Calvin Hemery; no rank, no
    profile link), else a unique same-words name (`namesAgree`).
  - **Full names**: a name the source PDF cut ("CERUNDOLO, Juan M…") is completed from the roster; unresolved prints
    surname first so the ellipsis is at the end. The name cell ellipsises at its end, on real overflow only.
  - **No "published {date}"** on an event row: neither shard holds the list's publication date (a draw's
    `sourcePublished` = the PDF's modDate, re-stamped per re-post; an advance list's = the aggregator page's update).
  - En dash in week ranges ("2–8 Nov", "12–18 Oct", "26 Oct – 1 Nov"); empty state title "No lists loaded for {range}" —
    the SELECTED week's range, the current week's too, never "this week" (TEN-402 r4 fix 5: "this week" showed while 2–8
    Nov was picked) — then "The ATP has {n} events in the week of {range}. …". **Test:** `test-ten402-r4n.mjs` fix 5. Hanken draws its en dash 5.99px vs a 4.58px hyphen (it reads as a hyphen), so every rendered range
    (`weekRangeHtml`: chips + empty state) sets the dash in Plex (`.el-ndash`, `--font-nums`); the text stays U+2013.
    **Test:** `test-ten401-f1a.mjs` f1.3 (every weekStart in both shards + the computed chips).
  - **A missing country is a grey `—`** (`--text-label`), never blank — Medvedev, Rublev, Khachanov, Safiullin play under no
    flag; a Bye stays blank. **Test:** `test-ten401-f1a.mjs` f1.4.
  - **Footnote** reads "… a dash = not listed in the feed. Acceptance order, not seeding." (founder 634ea470: the dash
    marks a missing rank or a missing country). **Test:** `test-ten401-f1a.mjs` "footnote".

## Draw (founder rulings 2026-10-20 item 2; 2026-10-21 items 8–13)
- **Positions come only from `draws.json`** (the ATP Supervisor's sheet). A result is placed by its two players' own draw
  slots (meet round = highest differing bit of (p−1) XOR (q−1)); an undecided slot is an empty placeholder, never a
  guessed name. **Test:** `tools/test-draw-view.js`.
- **A bye is a muted box in its first round** (Flashscore style): the seed, then "(Bye)" in `--text-label`; transparent
  fill, `--edge-6`; no score, not clickable, never counted in the round's "x of n" (Almaty R32 reads "of 12"). Every
  next-round slot has two feeders. *Supersedes the 2026-10-21 morning "no bye card" ruling.*
- **Every player row carries a photo** from the one resolver (`playerPhotoUrl`: the ATP headshot by player ID,
  `player-photos.md`), lazy; initials sit underneath, so a missing or failed photo shows initials — never a placeholder face.
- **NEU** marks a blank country only on a sheet that prints countries for most of its field; on a sheet with no country
  column (Brussels / Lyon qualifying) a blank is "not read" and gets no marker.
- **A finished match opens the one Match Analysis** (`openAnalysisModal(id, 'matchstats')`, landing on Match Stats →
  Key stats) — never a second stats pop-up. **Test:** a card is clickable iff the board (`matches.json`) or the draw
  store (`draw-matches.json`) holds the match as a scored `past-<eventKey>` row (exact key, no name match); otherwise it
  is not clickable. No qualifying match is clickable (neither carries one). *Supersedes the 2026-10-21 round-2 box-score
  overlay.*
- **Finished draw matches stay openable all week** (founder 2026-10-21, "Yes"): `draw-matches.json` keeps every finished
  main-draw match's board row + model entry after the board's 4-day window. **Test:** refreshed every run while on the
  board, frozen at its last copy once off it (its tabs read as of that run), kept 16 days from the match date; the
  board's copy always wins when both exist. **Test:** `tools/test-draw-matches-store.js`.
- **The W/UE sheet lives on the Draw tab only**, beside the tournament selector: "Download W/UE sheet", one "Copy {round}"
  per round with rows, and the round status ("R32: 11 of 12 · R16: 3 of 8") — for the selected tournament. Reports
  does not carry it.
- **A match in progress** shows the board's live set score and game score under a LIVE label, oriented to the card; it is
  not clickable and not counted as played.
- **Status line names both clocks:** "Results: {n} min ago" (progression `fetchedAt`) · "Draw sheet: {time}" (when the
  sheet's content last changed, not when it was last checked).
