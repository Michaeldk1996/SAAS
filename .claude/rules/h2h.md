# Head to Head page — the design build (founder 2026-11-16, design_handoff_head_to_head)

Applies to `window.H2HPage` in `bsp-consult-dashboard.html` (the block after "H2H REBUILD (design_handoff_head_to_head)")
and `h2h-page.css`. **Design source:** `design_handoff_head_to_head/` (repo root, never published): `README.md` and
`reference/Head to Head.dc.html` — the reference file wins over the README for every pixel; its own `PROMPT_STEP8*.md`,
`FIXES_STEP8_*.md` and `PROMPT_CLAUDE_CODE.md` are the old version's history and are not followed. Night only. **This file
replaces the TEN-402 look** (white bars, caps section heads, the darker-track rows, the 35b header card): founder brief
2026-11-16, "the live Head to Head page matches the design … pixel for pixel". A display rebuild: every figure keeps its
live calculation (Data below).

## Page
- **Colours = the export's own values**, page-scoped tokens `--h2h-*` in `tokens.css` (`--h2h-card` #0E1019,
  `--h2h-layer` #121521, `--h2h-inner` #0C0E16, `--h2h-raised` #131623, `--h2h-text` #E7E9EE, `--h2h-soft` #C6CCDB, `--h2h-grey` #8B96B5,
  `--h2h-blue` #5B9BFF, `--h2h-up` / `--h2h-down`; white alphas = `color-mix` of `--h2h-white`). Nothing else reads them.
  **Test:** `tools/lint-raw-colours.mjs` (0 raw colours) and the H2H suites (each role's token).
- **Box tones (design change 2026-11-17 §1):** a box inside a section (or a pop-up) is card tone (`--h2h-card`) defined
  by its edge (9%, or 6% where the reference keeps it, e.g. the Model cards); a layer inside such a box (caps strips,
  figure tiles, an opened hot-line panel) is `--h2h-layer`; `--h2h-inner` is a WELL only (switch tracks, inputs).
  **Test:** is any box filled `--h2h-inner`? Then it is wrong. The match sheet takes the same rule when opened from this
  page only (`#fhSheet.h2hx`). Mini avatars over a price column (≤ 22px) have no ring.
- **No pair picked = the website's background** (founder 2026-11-17): the tab, the page and the sticky fade are
  transparent (`x-wrap--empty`), so the shell's page tone and glow show; with a pair the page keeps the design's
  `--h2h-page`. **Test:** with no pair, `.tabpage[data-page="h2h"]` and `.x-wrap` compute transparent.
- **Switches:** the large one (`xSw` 'lg' / 'fill': r10 well, 8% edge, pad 3, tabs 6/14 r7 13px, on = inset 16% ring)
  in the sticky picker (Surface / Format, labels 12.5 grey sentence case), the Tournament filters and both Market edge
  window switches; Playing style, News and the box's scope tabs keep the reference's small ones.
- **Returns read in %, never u** (2026-11-17 §4): "Return at a flat 1% stake" (1% of bankroll a match), its band rows,
  totals, chart axis and line ends, and the Tournament Backing ("flat 1% stake · N bets").
- **Player one is blue, player two white, everywhere on the page** (README): avatar rings, the radar polygons, the
  face-to-face lean, the bullets, the return chart, the sheet's figures and split bars. Green / red only on signed figures
  and results. *Exception (founder 2026-11-16, CLAUDE.md non-negotiables):* the Playing style face-to-face rows print the
  better figure white 800 and the other grey 500, as the export draws it (`H2H_FTF_LEAD_EMPHASIS`).
- **Order** (README "Page structure"): page head + "?" · sticky picker (pickers, VS + swap, jump links, Surface Hard /
  Clay / Grass, Format Best of 3 / 5) · empty state with Suggested matchups / loading skeleton · thin-data caveat ·
  Stennisfy Model · Playing style · Head to head record (Overall box, Hot lines) · Record against each style · Tournament
  record · Market edge · Latest news. The head to head box (z 80) and the match sheet open over it.
- **One component each:** the avatar `xAv` (photo by player ID from the one resolver over initials, ring 2px / 1.5px on
  the 20–22px column-head avatars), the "?" `xHelp` (22px, its explanation is the hover title — **no footnotes**; every
  definition lives in a "?" or a label's title), the pill switch `xSw`, the section head `xHead`. Hovers are classes in
  `h2h-page.css` (the reference's style-hover): rows, bands and lines → the raised tone; the Overall box lifts with a 16%
  edge; a ✕ / Filters ring brightens to 30%.
- **Narrow (< 900px; the reference breaks there):** the pickers stack around the VS row, a picked name wraps instead of
  being cut, the radar takes its own row, the hot-lines table scrolls sideways inside its card.
- **Hand-over:** `?a=&b=` (player keys, or a name that resolves to exactly one player), else sessionStorage
  `stn_h2h_pair` ([a, b], read once and removed), read when the page script runs; it opens Head to Head on the pair. While
  the page shows a pair the URL carries `?a=<key>&b=<key>`; leaving the page drops them. **Test:** the H2H suites.
- **Jump links** scroll the window to the section with its top under the sticky picker (never `scrollIntoView`).

## Sections (what the design build shows, on which live data)
- **Stennisfy Model:** the pair estimate (Data → Model) in two inner cards; a Surface / Format switch flashes both prices
  blue for 520 ms. Under each price, the **Elo-only price** (founder 2026-11-17: the engine's Elo base `cell[1]`, before
  any layer, on the same margin), so the layers' effect reads directly. The foot = the founder's ruled lines (win chances + context; Elo base, N of 10 layers, margin with n,
  model run), drawn in the design's foot style.
- **Playing style:** radar (both polygons solid, A blue on top) + ten face-to-face rows: Elo on <surface>, Serve, Return,
  Under pressure, Dominance ratio (DNA ratings) · 1st / 2nd serve points won, Service games held · Return games won,
  Break points converted (the DNA file's `serve.firstWonPct`, `secondWonPct`, `holdPct`, `return.returnGamesWonPct`,
  `bpConvPct`). Window Last 52 weeks · Since Mar 2024 (the file has no career scope, modal-analysis.md D6). Under the
  10-match floor: no shape, "—" on every row, the reason in the "?". The lean and its chip read the printed figures.
- **Head to head record:** surface tabs with counts (a surface with no meeting is inert, `--h2h-dead`); the Overall box
  (score all white, one bullet per meeting oldest → newest, blue = A won, white = B; "X won the last n meetings";
  "All n meetings ›" opens the box). Never met: the design's one sentence.
- **Hot lines (founder 2026-11-16, "follow the design"):** ranked once the scope has `H2H_HOT_MIN_MEETINGS` = 3 meetings
  (fewer → "Not enough meetings to rank lines (n=…)"); a line shows with `H2H_HOT_MIN_LINE` = 1 eligible meeting; no rate
  floor (`H2H_HOT_MIN_RATE` null); best line per family, "Show all lines (N)". The Rate keeps the page's thin rule (under
  5 eligible no %, 5–9 grey). The lines are `fhH2hLineDefs` (12; the design's 13th, "B +3.5 games", is not added).
  A line opens its panel: Covered, Last five, the average behind the line, every eligible meeting newest first with its
  figure on the line and Covered / Missed. Match analysis keeps its own model (rule a0) and table.
- **Hot-line panel, Covered tile** (founder 2026-11-17): under the rate floor (n < 5) the figure is the count ("1 of 3"),
  never a dash, and the sub names the covered meetings ("At Barcelona Open 2026, …" / "Not covered yet"); from 5 the rate.
  "Most covered" is a white pill (11/700 on white 7%, r999), the dots stay blue (design change 2026-11-17 §6).
- **Head to head box:** four tiles — Total points won (the meetings' own box scores, `setstats/`, summed; the sub says
  "N meetings" when every meeting has one, else "k of n meetings"; none → "—"), On <global surface> (+ the other two),
  Went to a deciding set (one decider: "<Winner> 2–1 <event> <year>"; more: each player's deciders won), Favourite won (the
  shorter closing price; the sub names the underdog's win — "<W> beat <L> as the underdog · <event> <year>", or the count
  and the last one; an exact tie is counted out and named — no opening price exists for archive meetings; founder
  2026-11-17) — then the
  meetings by year, prices under each player's mini avatar, "X leads a–b" in the count line.
- **Record against each style:** each player's record against the other's archetype, filtered for real by Window (Last 52
  weeks · Last 24 months · Career — **Career by default**, founder 2026-11-16), Surface and Court speed (the profile's one
  speed rule, `speedRowOf` → `speedBandForRow`; a venue with no rating leaves a picked speed and the card says how many).
  Win rate from `H2H_STYLE_FLOOR` = 5 matches (= the profile's Match-up record floor), greyed 5–9; the **Vs style average
  keeps its sign colour at 5–9** (founder 2026-11-17: a filter never takes the green away), "—" under 5. **Vs style average** =
  his win rate minus the matchup-matrix cell for his own style against that style (career, all surfaces — the only
  population the matrix holds; it does not follow the filters, the label's title says so). Career match cards: 6 rows,
  "Show n more", opponents by surname, every row opens the sheet.
- **Tournament record (design change 2026-11-17 §3):** a filter box — Tournament search, then Window (Career default ·
  Last 52 weeks = 364 days back · Last 24 months = the same day two years back, exact dates; a row with no date counts
  under Career only), Surface, Court speed. Surface or Court speed set = **group mode**: the record over every event
  either player has on record whose surface (catalog) and speed class fit; the class is the event's ONE rating
  (`COURT_CONDITIONS` speed → `courtSpeedCategory`, Slow ≤ 43 · Medium ≤ 68 · Fast) — the figure the tournament row prints,
  so the two never disagree; an event with no rating is in no speed class (the row's hover counts them). Picking a
  tournament clears both; "Back to <tournament> ›" clears both. Single event: opens on an event of this week whose posted
  main draw lists both players (`EntryListsTab.currentWeekRows`, by key), else the most recent event both have played,
  else the first listed. Tiles Best result, Sets won, Last played, Backing (flat 1% stake on the one join, Data below)
  over the window (`xTrAgg`); groups per year, or per tournament and year in group mode.
- **Market edge:** windows Last 52 weeks · Last 24 months · Career; bands = `MarketEdgeCore.BANDS` (the ten-band
  definition), named as the profile names them; a band click filters the chart. One head row (title, scope, the window switch, the "?" holding the
  band definition); the chart card carries the same switch (one state). "Return at a flat 1% stake" = the live flat-1u
  result (1u = 1% of bankroll), printed in %. The chart = the design's (`H2H_CHART_SMOOTH`: smoothed line, faint
  tint below break even, vertical month ticks — flagged against the foundation's chart rule), x = each player's own
  priced matches.
- **Latest news:** pills All · Match reports · Quotes · Injuries · Articles from the site's own fields — an ASAP item is a
  Quote; a feed article takes the News page's `newsClassify` (Match Reports → Match reports, Withdrawals & Injuries →
  Injuries, the rest → Articles); sources print the outlet names (`newsSourceNames`). No item → the design's sentence.
- **Match sheet:** the shared sheet, drawn by player only when this page opens it (`fhSheetTone()` 'h2h', host
  `#fhSheet.h2hx`): A's figures and bars blue, B's white, the scope tracks on the inner tone, price chips on the page tone,
  no per-set chips. Match analysis, the Match Stats tab and the profile are unchanged. **Test:** the H2H suites + the
  Match analysis sheet suites (`test-ten314-sheet.mjs`, `test-ten338-match-stats.mjs`).

- **One short name per player (founder, TEN-408 card 78054b1c):** `shortOf` keeps a given name that is already
  abbreviated ("C. Alcaraz", "Dar. Blanch", "J-L. Struff"), so the picker, the Tournament card, the DNA line and every
  sentence print the same name; re-cutting "Dar." to "D." printed Darwin under his brother Dali's spelling.
  **Test:** `test-ten408-styles.mjs` "founder R2".

## Data
- **Meetings** = `H2HCore.joinMeetings` (`h2h-core.js`) over both players' career-history shards — the ONE site-wide H2H
  list, the Match analysis tab's and Key factors' too, ATP's official H2H population (founder TEN-437, 2026-10-14; replaces
  TEN-402 Data 1's "including exhibitions"): Laver Cup counted, exhibitions and Hopman Cup not; walkovers out; a
  retirement counts (Cincinnati 2025 F, founder 2026-10-08, card 01102d24). Sinner–Alcaraz = 17, Alcaraz 10–7;
  Medvedev–Tsitsipas = 15, Medvedev 10–5 (ATP, 14 Oct 2026). Rules and constants: `modal-form-h2h.md` "One H2H record".
  A history that did not load shows "Head-to-head could not load" + Retry, never "No meetings on record", and is not
  cached (`h2hRetryPair`; a visit drops failed pairs). **Test:** `test-ten402-b.mjs`, `test-ten437-h2h.mjs`.
- **Prices — ONE join across the site (founder ruling 2026-10-08, card 01102d24).** Ledger Home / Away = the Database
  join, Pinnacle closing else Bet365 closing, per match: `DatabaseTab.priceRows()` = `database-yield.json` rows PLUS the
  retirements the store keeps behind its flag (`retRows` / `retNames`, `dbPriceJoinRows`; same book rule, ties,
  overround > 1.15 and pre-2010 out). **A retirement is priced, never `—`, and settled on Pinnacle rules** (founder 2026-10-22: first set
  completed → a win at the winner's close, a loss at the retiree's; not completed → `void`; no set scores → no units): Sinner–Alcaraz Cincinnati 2025 F = Alcaraz 2.71 / Sinner 1.53, all
  17 meetings priced. **An exact price tie is priced** at the tie for both players (founder ruling 2026-10-16: "keep tied
  prices, exclude them only from favourite/underdog figures" — the store's `tieRows` / `tieNames`, behind a flag like the
  retirements; no Database figure reads them). Favourite = shorter price; yield = flat
  1u. No price → `—`. ONE join on the page (`h2hPriceJoin`, exported as `H2HPage.priceJoin` and shared with the player
  profile): the Head-to-head ledger, the Playing styles ledger and the Tournament ledger (each row's own opponent) —
  never the style-meetings shard's `oddsSelf` / `oddsOpp` nor the closes shard. **Test:** `test-ten402-b.mjs` "Data 2
  on the real stores" + "the store keeps retirements BEHIND A FLAG" (each with the Database-rows-only control),
  `test-ten402-c.mjs` fix 2 (Cincinnati in the Playing styles ledger). **A ledger row never takes a neighbouring match's
  price** (review 2, 8 Oct):
  1. every Database row of player P goes to ONE of P's career-history matches (the loaded `career-history/{key}.json`,
     `h2hCareerOf`) — same opponent + winner, rounds that do not contradict, globally **nearest first** (`h2hNearest`;
     a tie at the same distance = a dash). A Database row nearer another career match never prices this one (Sinner,
     Monte Carlo 2023 R32 v Schwartzman, retired → `—`, not Barcelona's 1.09 / 9.13).
  2. distance: a career row with an eventKey (feed, 2021 on) is match day to match day, ±1 (`H2H_PAGE_MATCH_WINDOW`); one
     without is dated at the event START, so start to start (the archive event's first date, `h2hTdEvent`) within
     `H2H_PAGE_START_WINDOW` and the match date within `H2H_PAGE_PRICE_WINDOW` (−3…+16) — the match date alone swapped
     Djokovic's Madrid / Rome 2011 finals.
  3. rounds compare whenever both sides have one, R128…R16 too: the archive's "Nth Round" counts back from that event's
     last numbered round (`h2hTdRound`: a 128 / 96 draw 1st = R128, a 56 / 48 draw 1st = R64, a 32 / 28 draw 1st = R32).
     Qualifying (`Q`) never takes a price. The ATP Cup 2021 row (R128) never takes the AO 2021 QF's.
  4. each ledger row finds its career match (same opponent + winner, rounds agree, career date up to 24 days after the
     row's: `H2H_PAGE_ROW_WINDOW` — a style-meetings row is dated at the edition start; Djokovic v Vacherot, Shanghai
     2025 SF: shard 24.09, archive 11.10 → 1.14 / 6.68) and shows THAT match's row. A row with no career match takes
     only a Database row no career match holds. The result never depends on row order.
  - **A team-event row joins match day to match day** (founder 2026-11-08, "look deeper"): an era row with flag `t` (Davis
    Cup, Laver / United / ATP Cup, Olympics …) carries one event name for every tie of the year ("Davis Cup"), so its run's
    "start" is not its tie's; a keyless archive career row meets it on |match day − career date| within the price window,
    never start to start (`dbPriceJoinRows` `tIx`). Gojo v Rublev, Davis Cup Finals 2021 F = 5.92 / 1.17. **Test:**
    `test-ten402-b.mjs` "a team-event row joins" (control: the pre-fix join dashes it).
    **It prices a team-event career match only** (founder 2026-11-11): a career row whose event is not a team event (Davis /
    Laver / ATP / United / Hopman Cup, Olympics, Next Gen Finals, World Team Cup) never takes it. Goffin,
    Indian Wells 2016 QF v Cilic (archive row dated 7 Mar) had taken the Davis Cup tie's 2.24 / 1.71 (6 Mar); it reads its
    own Pinnacle close 2.32 / 1.70, and the tie its Tennis Explorer price. Measured over 741 players' histories: that one
    match was the only one to move. **Test:** `test-ten402-b.mjs` "a team-event row prices a team-event career match only"
    (control: without the rule Indian Wells shows the Davis Cup price).
  - **Names** (`h2hTdSame`): surname + initial; the surname-tail rule both ways — the archive's shorter name is the first
    or last word(s) of ours ("Mpetshi G." = G. Mpetshi Perricard, "Bautista R.", "Del Potro J.M."), a longer one must
    START with ours ("Ramos-Vinolas A." = A. Ramos; "Lopez San Martin A." is NOT A. Martin). The initial keeps brothers
    apart (A. / M. Zverev, F. / J.M. Cerundolo, S. / P. Tsitsipas). **The archive name table applies first** (founder
    brief 2026-10-15 item 2): `build-odds-performance.js` `ARCHIVE_NAME_ALIASES` (hand-checked, the table Market edge and
    the closes shards already use) rides in `database-yield-players.json` as `aliases` (archive name → our spelling, the
    profile's else `ARCHIVE_ALIAS_NAMES`: "Barrios M." / "Barrios Vera M.T." = T. Barrios Vera, "Miguel L." = G. Miguel).
    `ARCHIVE_NAME_BLOCK` is NOT carried: the Database feed's own rows spell Zhizhen Zhang "Zhang Z.", the archive's Ze
    Zhang spelling, so a name block would drop his 2026 prices (3 matches, measured 15 Oct). **Test:** `test-ten402-b.mjs`
    "archive name table". Residual: "Silva J." (1 row, US Open 2010, Júlio Silva) would
    pass the rule for J. Reis Da Silva but has no career match to join.
  - **Backing tile (Tournament) = flat 1u over the Tournament ledger's priced rows, on the one join, retirements settled
    on Pinnacle rules** (founder 2026-10-22; join from ruling 2026-10-08, card 01102d24 — the same rule as Market edge on this page
    and its footnote). One model draws both: `trProfileModel` prices every row on the Database join (`trDbJoinPx` →
    `H2HPage.priceJoin`) and the panel prints `P.all`'s prices and `P.priced` / `P.units` — so the tile's "N priced" IS the
    ledger's priced-row count, and the tile = Player Profile → Record per tournament for the event (`trProfileBacking`
    reads the same model). There is no second Backing source (`H2H_BACKING_SOURCE` is deleted). The Match analysis
    Tournament tab prices on the same join too (founder 2026-10-09, card 7bc622d5; `trModelFor` passes `trDbJoinPx`), so
    for an event whose match lists agree the three surfaces print one figure (`modal-analysis.md` "Tournament tab → Prices"). Measured 8 Oct 2026:
    Alcaraz, US Open +7.1u / 32 priced (+7.13u; the three retirements in: 2021 QF v Auger-Aliassime −1, 2022 R128 v Baez
    +0.02, 2023 R128 v Koepfer +0.02); Zverev, Roland Garros +5.3u / 30 (the 2023 SF v Ruud, an exact tie at 1.95, was `—` then and is priced 1.95 / 1.95 since the 2026-10-16 tie ruling;
    the 2016–2021 editions resolve to no career-history row → `—`). Apply: sum flat 1u (win = price − 1, loss = −1) over
    the panel's rows that show a price; it must equal the tile and the profile's "Backing him here".
    **Test:** `test-ten402-c.mjs` "ruling 2026-10-08: the Tournament panel draws ONE model", `test-ten332-tournament.mjs`
    "ruling 2026-10-08", `tools/test-ten402-fix-mutants.js`, `tools/test-ten332-mutants.js` (TEN-402 mutants).
  - **Market edge** (this page) reads each player's `market-edge/{key}.json` rows (`meWinnerRows`): Pinnacle closing, else
    Bet365, retirements settled on Pinnacle rules — its footnote prints `MarketEdgeCore.RET_SETTLE_NOTE`
    ("Retirements settle on Pinnacle rules for all rows."). The shard is built from the master (`database-yield-master.json`, founder 2026-10-17
    "one source of truth"), so its prices equal the Database join (team events stay out of Market edge).
  **Test:** `test-ten402-b.mjs` "review 2 …" (real `database-yield.json` + synthetic career fixtures), `test-ten402-c.mjs`
  (the ledgers' own path), `tools/test-ten402-fix-mutants.js`. Tests never read a bot-rewritten store
  (`style-meetings/*.json` is rewritten daily by the Styles bot): use an in-test fixture.
- **A start-dated row meets its match on or after its date** (style / draw ledgers carry the edition start): a career
  match before the row's date only wins when nothing on or after it fits (`H2H_PAGE_BEFORE_RANK`; Alcaraz v Lajovic
  2023: Rio = 1.15 / 6.61, never Buenos Aires' 1.17 / 6.20). Names are indexed by surname words AND the words joined
  (`h2hTdIx`: the archive's "O Connell C." = C. O'Connell). **Test:** `test-ten402-c.mjs` "review 3",
  `tools/test-ten402-fix-mutants.js`.
- **RD column:** a blank round at the season finals (ATP / Next Gen Finals) is the round robin → `RR`; a blank round
  anywhere else (Davis Cup, Laver Cup, ATP / United Cup) stays `—` (`h2hRoundOf`).
- **Set scores are never cut** (founder r4 fix 2, 2026-10-09; reverses R1's one-line ellipsis): in the Meetings,
  Playing styles and Tournament ledgers the score cell wraps between sets (each set is one nowrap piece in
  `maMatchRowsHtml`) and the row grows; no ellipsis, no clipping (`#h2hRoot .h2hc-led .ma-row-score` = `white-space:normal`).
  **Apply:** Alcaraz v Sinner → Tournament US Open: Shelton 2026 QF reads "7-6(5), 1-6, 3-6, / 6-1, 6-7(7)" on two lines.
  **Test:** `test-ten402-r4n.mjs` fix 2, `test-ten402-c.mjs` "r4 fix 2".
- **Sets column = `pS–oS`** (founder r4 fix 3): en dash U+2013, no spaces, nowrap ("0–2") in the Meetings, Playing styles
  and Tournament ledgers; a retirement reads `—` in Meetings / Playing styles, a walkover `—`. The Tournament rows are the
  shared `trRowData`, so Match analysis → Tournament prints the same (intended). `ps2Meeting` keeps " - " for its other
  hosts, and Match analysis Form / H2H (`fhFormRowData`, `fhH2hRowData`) still print "2 - 0" — outside this round.
  **Apply:** every Sets cell on this page matches `^\d+–\d+$` or is `—`. **Test:** `test-ten402-r4n.mjs` fix 3.
- **Model = the pair's likely opening price, for ANY two players** (founder 2026-11-16, replacing "the Model page's
  board price, else one empty line"): "the head to head is to compare two players, to have a likely opening price based
  on our database, Elo ratings etc." `build-pair-prices.js` (every pipeline run) runs the Stennisfy Model engine itself
  (`runModel(m, { pairOnly, bestOf })`) on every pair of this week's ATP top 200 (`player-index.json`), per surface
  (Hard / Clay / Grass) × format (3 / 5): base state 3 (Elo + surface Elo, no market), the 10 layers that need only the
  two players (`PAIR_SKIP_LAYERS` = manual note, fatigue, weather, market movement never run), H2H = the screens' list.
  Price = 1 / (p × (1 + 3.39%)), 3.39% = Pinnacle's median first two-sided price on the board (n = 442, 27 Sep – 16 Nov
  2026). The card follows the page's Surface / Format toggles; under the boxes: each player's win chance (whole %), the
  context, the Elo base, "N of 10 model layers", the margin with its n, the model run time. Not in the file (outside the
  top 200 / no weekly Elo) → "No estimate for this pair … X is not among them"; a failed load → "couldn't load", asked
  again after 60 s; never a price of the page's own. **Test:** `test-ten402-a.mjs` "Model:" (+ mutants),
  `tools/test-pair-prices.js` (the real engine). **Elo** = the weekly Elo of Database → Ratings.
- **Playing styles / DNA** = the Playing Styles page's archetypes and ratings. **Tournament** rows = Player Profile →
  Draw record for the event. **News** = the News page feed, items it attributes to A or B; none → the card's one sentence.
- **Suggested matchups** = ATP main-draw pairs on this week's board (Mon–Sun), both on the roster, best combined rank
  first, max 3; none → no chips.
- An unsourced metric is grey `—`, never 0.

## Behaviour
- **The Database join is the ONE shared session state (R3 fix 1, 2026-10-09).** `h2hEnsureDb` mirrors
  `_sfDbJoin` / `_sfDbJoinSt` (`sfDbJoinLoad`) on every read and keeps no state of its own: a join any surface loaded
  (profile, Tournament tile, Database) prices every ledger here at once, and a failed load is asked again by the next
  visit (`ensureInit(true)` from the nav clears the throttle) or a render ≥ `H2H_DB_RETRY_MS` (15 s) after this page's
  last ask — never in a loop. Apply: block `database-yield*`, open Alcaraz v Sinner (ledger `—`), unblock, open the
  Alcaraz profile, come back: all 17 meetings priced; without the profile, the next visit alone prices them.
  **Test:** `test-ten402-r2l.mjs` "R3 fix 1", `tools/test-ten402-r2l-mutants.js`.
- **The page never re-enters its own loaders:** `triggerLoads` runs at most once per `H2H_RELOAD_MS` (60 s).
  `loadMatches` ends by calling `H2HPage.ensureInit()`, which used to restart the loaders and repaint the pair ~17×/s.
  **Test:** `test-ten402-lead.mjs` (runs the page's own `triggerLoads`; its control removes the guard and goes red).
- **Match sheet** from any row on this page: the design's overlay (`--h2h-overlay`, no blur) over the content area; Esc,
  ✕ and an outside click close it; on `window.sfOverlayClosers`. Drawn by player (Sections → Match sheet): no
  better-figure emphasis and no better-bar rule on this page any more (the 2026-10 Dominance / lower-is-better emphasis is
  replaced by the design, founder 2026-11-16).
- **The H2H tone belongs only to a sheet opened from this page.** The profile's hand-off (`window.pp2OpenMatchSheet`)
  never reuses a state whose pseudo match carries `h2hPage` (it used to: open + close an H2H sheet, then Players →
  Zverev → the "Djokovic N." chip drew the page's tone). **Test:** `test-ten402-b.mjs` "review 2 item 2" (the real opener,
  `fhStateFor`, `fhOpenSheet`).
- **Hot lines "Show all lines (N)"**: N = the lines with an eligible meeting in the CURRENT scope (Sections → Hot lines).
  No line prices on this page (it is tied to no match).

## Founder round 1 (2026-10-09) — fixes 1, 2, 5, 6 (builder X)
- **Tournament "Last played" = the player's OWN last row in that event's ledger** (`trLastPlayed`): the newest edition
  that has a row, by its year (never its list position), and that edition's top row — year and row from the SAME edition.
  The Match analysis Tournament tab's tile reads it too. **Test:** `test-ten402-r1x.mjs` fix 1.
- **One tournament name per event, site-wide** (`sfEventName` / `sfEventKey`, next to `fhTournClean`): any feed / archive /
  shard / TournamentIdentity spelling → the Tournaments registry entry (`TOURNAMENT_CATALOG`) → its event name
  (`SF_EVENT_NAMES`: ATP Finals, Cincinnati Open, China Open, Roland Garros, Monte-Carlo Masters …; every Slam, Masters
  1000 and ATP 500; an ATP 250 keeps the registry's name; a name outside the registry keeps its own). Printed by the shared
  normalised rows (`fhRowFromForm`, `meRowFromCareer`, the Match analysis H2H rows, Market edge rows → ledgers, hot-line
  tips and the match-stats sheet header), `psGroupMeetings` (Playing style group headers) and this page's Tournament picker
  + info box and the Suggested matchups chips ("… · Shanghai Masters", never "Shanghai"). *Exception (founder
  2026-11-15, "Design wins"):* the Tournaments tab prints the design's city keys (`tournaments.md` "Event names on this
  tab"). Display only — joins read the raw name; the chip's pair keeps the
  board's word. `psTourMeta` / `fhTournCode` read a printed name through its registry key. **Apply:** an event name
  anywhere on the site equals `sfEventName` of any of its spellings. **Test:** `test-ten402-r1x.mjs` fix 2,
  `test-ten402-r2n.mjs` r2.6.
- **Round 3 (TEN-402 follow-up review, 2026-10-09) — the rest of the site prints it too.** Match analysis: the modal
  subtitle (`aContextLine`: "Shanghai Masters · R64 · 12:00", was "ATP Shanghai"), the Tournament tab (`trName`: title +
  tile letter, "Record at Shanghai Masters", the edition headers "Shanghai Masters 2025", the empty line, the hold-rate
  tip, the ROI overlay title and chip), Key factors' Tournament card ("Shanghai Masters · ATP 1000" + its record tip),
  Progression (header, first-round lines, draw-average tip) and Weather's "Court speed · {event}" line. The location line
  stays the venue ("Shanghai, CN"); Weather's city stays a city. The Matches board (`mxEventName`): card head, story strip
  and the tournament chips (ordered by the printed name; `data-tournament` / `state.tournaments` keep `m.tour`). Player
  Profile → Record per tournament (`tournDisplayName` → `window.sfEventName`): the row, the detail header, "best event";
  **the tier is the row's meta** (`tournLevelMeta`: "Cincinnati Open  Masters 1000"; none on a Slam or the ATP Finals),
  never part of the name. **ATP Cup:** the cleaner strips "ATP " from every feed name, so the ATP Cup (2020–22) read
  "Cup" — `SF_EVENT_LITERAL` prints "ATP Cup" (display only). **Shared official name + a city:** `sfEventKey(name, city)`
  — every shared spelling ("Canadian Open", "National Bank Open", "Rogers Cup", "Canada Masters") reads back to Montreal;
  with the row's city the city's own registry event wins when it carries the same official name (the Entry list's Toronto
  year prints "Canadian Open · Toronto"); a city never moves a row onto a different event. **Data never moves:** `trClean`
  (hold-rate `byName`, the catalog match, the career join names), `m.tour` (filters, counts, weather index, edge rail),
  the profile row's `t.name` (`data-t`, `state.tournOpen`, every join). Measured 9 Oct before → after: Zverev / Alcaraz
  every per-event W–L, Backing units and priced n identical (Zverev Shanghai +0.6u, 20 priced, on both the profile and the
  MA tab), the Matches board 16 cards / 1 chip either way. **Not yet renamed (outside this round):** the Players landing
  group headers ("ATP Tokyo") and the profile's per-match event labels (`eventName`: Recent form, last match, ledger
  meta). **Apply:** open any surface listed here; every event reads `sfEventName` of its data name, no tier inside a
  name, and every figure equals the same surface before the rename. **Test:** `test-ten402-r2n.mjs` r3.1–r3.5 (+
  `tools/test-ten402-r2n-mutants.js`), `test-ten332-tournament.mjs`, `test-ten341-key-factors.mjs`,
  `test-ten304-weather-tab.mjs`, `tools/test-pp2-reconcile.js` "TEN-402 r3".
- **Match-stats sheet BP rows / Return rating** come from the match-stats store row (`fhSheetInit` → the setstats shard),
  the same row Match analysis' Match Stats tab reads. A 2026-spring row at Indian Wells / Miami / Monte Carlo / Rome /
  Barcelona / Munich / Houston … holds `null` there (api-tennis sends those two stats only as `stat_value` "X/Y"; the
  store's extractor drops it — TEN-154 / TEN-165), so the sheet keeps `—` (Monte Carlo 2026 F). Not sourced client-side.
- **Suggested matchups = this week's events**: the date window AND the match's event in `tourxThisWeekEvents()` (the
  Entry list's rule, called — the shard row's `city` matches the board's "ATP {city}"); not live yet → no chips, one
  `EntryListsTab.load()`. **Test:** `test-ten402-a.mjs` "fix 6".
