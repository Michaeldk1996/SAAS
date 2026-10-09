# Head to Head page — header, cards, data, bars, sheet (founder step 8, TEN-402, 2026-10-08)

Applies to `window.H2HPage` in `bsp-consult-dashboard.html`. Reference = `OFFICIAL VERSION 1.html` → Head to Head,
night, 1512px; the reference wins except where a rule below says *(override)*. The Aug handoff
`design_handoff_head_to_head/` (not committed; founder's Downloads) holds structure and interactions only; its colours
are superseded by `foundation.md`. **Night only** (founder f49da477): the day theme is being redesigned separately —
no day work, checks or screenshots on this page until the founder reopens it.

## Page
- **Order:** header card · Suggested matchups (empty state) · thin-data caveat · Stennisfy Model · Playing style DNA ·
  Head-to-head record · Playing styles · Tournament · Market edge · Latest news. The older Serve / Return / Under
  pressure / Holds & breaks cards are off — founder-ruled 2026-10-08, card 01102d24 (`H2H_SHOW_STAT_CARDS = false`; code
  kept). **Test:** `test-ten402-c.mjs` "flag and block order".
- **Header card** = the shared 35b header, controls variant (TEN-403, overrides step 8 item 1's 29 / 22×26 / caps
  line): `.sfh.sfh--ctl` (18×26×22) → `.sfh__row` (margin-bottom 16: title 24/800, ONE line "Two players, mirrored
  across every metric." + the coverage line as the grey `.sfh__tail`, reading "· a dash means not covered" (founder R1
  nit 2026-10-09, replaces "· Data honesty · em dash means not covered"); no caps line, no stats) → pickers → Surface /
  Format strip, all in the one card. Sticky with its shadow; the page owns only that shadow (`#h2hRoot .h2h-head`), no
  header type/padding rule. Search box `--inner`, no edge; avatars = initials; "Change" Hanken 10.5 caps
  `--text-label`, white on hover. **Test:** `test-ten403-header.mjs` (H2H check + mutants), `test-ten402-a.mjs`.
- **Cards:** every section card `--card` + `--top-light`, no outline; titles via `sectionHead` (caps 10.5 on a 6%
  hairline). Boxes inside a card (Model boxes, Tournament info box, player panels, stat tiles, price-sensitivity panel,
  every ledger) = `--card` + 1px `--edge-6`; ledger heads panel tone, no edge; rows on 6% hairlines, `--inner` hover.
- **Every tab / chip row** (Surface / Format, DNA tabs, H2H scope chips, Market edge scope tabs) = `h2hSeg` (the site
  darker track `sfSegHtml`): track `--card` + `--edge-6`, selected `--inner` + `--edge-10` white 700, idle grey. No blue.
  The H2H scope chips carry the track although the reference draws none (ticket item 4 overrides).
- **Menus** (player pickers, tournament picker) = compact site menu: `--card` + 1px `--edge-10`, r10, `--shadow-menu`,
  ~6 rows then scroll, `--inner` hover, white tick on the current pick *(override: reference r12 / padding 6)*.
- **Toggle words** (Breakdown ▾, Show all lines (N), Meetings ↓, Show / Hide career meetings) are white.

## Bars and charts *(override — the one page exempt from Ring blue)*
- **Every data bar is white:** lead `--viz-white-lead` solid, second 70% of it, on `--viz-track`. The tone follows who
  LEADS, never the side (`h2hTug`: B 3–1 up on clay draws B's bar solid). Hot-lines dots stay
  blue (dots, not bars). Signed bars (Record vs style) = `--pos` wins / `--neg` losses. The match-stats sheet shows
  white bars only when opened from this page. **Test:** `test-ten402-b.mjs`, `test-ten402-c.mjs` "white bars".
- **Profit chart:** horizontal dotted guides only (`--viz-guide`, dash 2 6), no vertical ticks, no area fill;
  break-even rule `--viz-rule` 1.25px; A white 2.4px, B white 45% 2px. x = each player's OWN priced-match index
  (`cChartModel`; the reference: "each line spans that player's own matches"), axis dates read off the longer series;
  "Break even" sits on the rule at the left and the lines start right of it (`C_BE_INSET`). **Test:** `test-ten402-c.mjs`. **DNA radar:** A solid white + 12% fill, B white
  dashed. **Model prices** mono white, no colour.

## Data
- **Meetings** = every completed ATP main-draw meeting in both players' match history, all levels incl. Laver Cup and
  exhibitions (25 Sep ruling; the Form rule does not apply). Walkovers out; a retirement counts (as the ATP does) —
  Cincinnati 2025 F (Sinner retired) is counted, founder-ruled 2026-10-08, card 01102d24. Sinner–Alcaraz = 17, Alcaraz
  10–7 on 8 Oct 2026. Flip: `H2H_PAGE_LEVELS`, `H2H_PAGE_NOT_COUNTED`. **Test:**
  `test-ten402-b.mjs`.
- **Prices — ONE join across the site (founder ruling 2026-10-08, card 01102d24).** Ledger Home / Away = the Database
  join, Pinnacle closing else Bet365 closing, per match: `DatabaseTab.priceRows()` = `database-yield.json` rows PLUS the
  retirements the store keeps behind its flag (`retRows` / `retNames`, `dbPriceJoinRows`; same book rule, ties,
  overround > 1.15 and pre-2010 out). **A retirement is priced and settled on the official ATP result** (a win at the
  winner's close, a loss at the retiree's), never `—`: Sinner–Alcaraz Cincinnati 2025 F = Alcaraz 2.71 / Sinner 1.53, all
  17 meetings priced. An exact price tie stays out (the Database drops it): `—`. Favourite = shorter price; yield = flat
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
  - **Names** (`h2hTdSame`): surname + initial; the surname-tail rule both ways — the archive's shorter name is the first
    or last word(s) of ours ("Mpetshi G." = G. Mpetshi Perricard, "Bautista R.", "Del Potro J.M."), a longer one must
    START with ours ("Ramos-Vinolas A." = A. Ramos; "Lopez San Martin A." is NOT A. Martin). The initial keeps brothers
    apart (A. / M. Zverev, F. / J.M. Cerundolo, S. / P. Tsitsipas). Barrios Vera (archive "Barrios M." / "Barrios Vera
    M.T.", ours T.) stays unjoined — the initials differ. Residual: "Silva J." (1 row, US Open 2010, Júlio Silva) would
    pass the rule for J. Reis Da Silva but has no career match to join.
  - **Backing tile (Tournament) = flat 1u over the Tournament ledger's priced rows, on the one join, retirements settled
    on the official ATP result** (founder ruling 2026-10-08, card 01102d24 — the same rule as Market edge on this page
    and its footnote). One model draws both: `trProfileModel` prices every row on the Database join (`trDbJoinPx` →
    `H2HPage.priceJoin`) and the panel prints `P.all`'s prices and `P.priced` / `P.units` — so the tile's "N priced" IS the
    ledger's priced-row count, and the tile = Player Profile → Record per tournament for the event (`trProfileBacking`
    reads the same model). There is no second Backing source (`H2H_BACKING_SOURCE` is deleted). Measured 8 Oct 2026:
    Alcaraz, US Open +7.1u / 32 priced (+7.13u; the three retirements in: 2021 QF v Auger-Aliassime −1, 2022 R128 v Baez
    +0.02, 2023 R128 v Koepfer +0.02); Zverev, Roland Garros +5.3u / 30 (the 2023 SF v Ruud is an exact tie at 1.95 → `—`;
    the 2016–2021 editions resolve to no career-history row → `—`). Apply: sum flat 1u (win = price − 1, loss = −1) over
    the panel's rows that show a price; it must equal the tile and the profile's "Backing him here".
    **Test:** `test-ten402-c.mjs` "ruling 2026-10-08: the Tournament panel draws ONE model", `test-ten332-tournament.mjs`
    "ruling 2026-10-08", `tools/test-ten402-fix-mutants.js`, `tools/test-ten332-mutants.js` (TEN-402 mutants).
  - **Market edge** (this page) reads each player's `market-edge/{key}.json` rows (`meWinnerRows`): Pinnacle closing, else
    Bet365, retirements settled on the official ATP result — its footnote prints `MarketEdgeCore.RET_SETTLE_NOTE`
    ("Retirements settled on the official ATP result."). Its book order is the shard's R8 order (founder 2026-09-28: our
    captured Pinnacle close first), so a handful of 2026 rows differ from the Database join (Alcaraz: US Open 2026 R128
    1.176 captured v Bet365 1.17, QF 1.294 v 1.25; Sinner: Madrid 2026 Bet365 capture, Wimbledon 2026 1.177 captured).
    Not re-ruled on 8 Oct — open question for the founder.
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
- **Set scores** in the Playing styles and Tournament ledgers stay on one line with an ellipsis (`#h2hRoot` only).
- **Model** = the Stennisfy Model page's `model-output.json` fair price behind the same display gate; otherwise one
  empty line, never a price of our own. **Elo** = the weekly Elo of Database → Ratings.
- **Playing styles / DNA** = the Playing Styles page's archetypes and ratings. **Tournament** rows = Player Profile →
  Draw record for the event. **News** = the News page feed, items it attributes to A or B; none → card hidden.
- **Suggested matchups** = ATP main-draw pairs on this week's board (Mon–Sun), both on the roster, best combined rank
  first, max 3; none → no chips.
- An unsourced metric is grey `—`, never 0.

## Behaviour
- **The page never re-enters its own loaders:** `triggerLoads` runs at most once per `H2H_RELOAD_MS` (60 s).
  `loadMatches` ends by calling `H2HPage.ensureInit()`, which used to restart the loaders and repaint the pair ~17×/s.
  **Test:** `test-ten402-lead.mjs` (runs the page's own `triggerLoads`; its control removes the guard and goes red).
- **Match-stats sheet** from a meeting row: `--card` + 1px `--edge-10`, `--shadow-modal`, over `--backdrop` + blur(3px)
  covering the content area only; Esc + outside click close; on `window.sfOverlayClosers`. Dominance ratio: both
  figures white *(override)*, the better 700, the other `--text-label` 500 — in the Key stats row AND the Match / Set
  scopes' Dominance ratio card (`fhSheetStatsHtml`, Head to Head only). On this sheet the **bright bar is the better
  figure's** too: lower is better on the site's own list (`MATCH_STAT_ORDER`'s lowerBetter flag via
  `fhLowerIsBetter`: Double faults, Unforced errors and "Unforced errors / total points") — Monte Carlo 2026 F, Sinner 2
  v Alcaraz 5 double faults lights Sinner's bar; a tie / dash / gated count falls back to the longer bar. Every other host
  keeps the longer-bar rule.
- **The H2H tone belongs only to a sheet opened from this page.** The profile's hand-off (`window.pp2OpenMatchSheet`)
  never reuses a state whose pseudo match carries `h2hPage` (it used to: open + close an H2H sheet, then Players →
  Zverev → the "Djokovic N." chip drew white bars and the Dominance emphasis). **Test:** `test-ten402-b.mjs` "review 2
  item 2" (the real opener, `fhStateFor`, `fhOpenSheet`).
- **Hot lines "Show all lines (N)"**: N = the lines that clear the eligibility gate (≥ `FH_HOT_MIN_ELIGIBLE` meetings) in
  the CURRENT scope — the shared component's count of lines, not meetings. Sinner–Alcaraz shows 12 on All (17
  meetings) and on Clay (5) because all 12 line definitions clear the gate in both; Grass (2) shows "Not enough
  meetings". Unchanged by design.

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
  + info box. Display only — joins read the raw name. `psTourMeta` / `fhTournCode` read a printed name through its registry
  key. **Test:** `test-ten402-r1x.mjs` fix 2.
- **Match-stats sheet BP rows / Return rating** come from the match-stats store row (`fhSheetInit` → the setstats shard),
  the same row Match analysis' Match Stats tab reads. A 2026-spring row at Indian Wells / Miami / Monte Carlo / Rome /
  Barcelona / Munich / Houston … holds `null` there (api-tennis sends those two stats only as `stat_value` "X/Y"; the
  store's extractor drops it — TEN-154 / TEN-165), so the sheet keeps `—` (Monte Carlo 2026 F). Not sourced client-side.
- **Suggested matchups = this week's events**: the date window AND the match's event in `tourxThisWeekEvents()` (the
  Entry list's rule, called — the shard row's `city` matches the board's "ATP {city}"); not live yet → no chips, one
  `EntryListsTab.load()`. **Test:** `test-ten402-a.mjs` "fix 6".
