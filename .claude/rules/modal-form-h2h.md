# Match analysis — Form and H2H tabs: founder rulings

Applies to the TEN-263 block in `bsp-consult-dashboard.html` (`fh*` functions), to
`build-match-closes.js` and to `h2h-core.js` (the ONE H2H meeting list, TEN-437). The api-tennis list the pipeline
builds (`fetchH2H`, `buildH2HMatchList`, `m.h2h`) is the model's input only (see "One H2H record" below).
Tests: `test-ten263.mjs`, `test-ten437-h2h.mjs`.

## One H2H record, everywhere — ATP's official population (founder TEN-437, 2026-10-14)
Replaces the 2026-09-24 "H2H covers all of men's singles" display rule, the 2026-09-25 team-events list as a display
rule, and the TEN-263 "api-tennis ∪ career-history eventKey join".
- **One function:** every surface that shows an H2H record, meeting count or anything computed over a pair's meetings
  (Match analysis → H2H tab, Key factors' H2H box, the Head to Head page, the Download report that prints them) builds the
  meetings with `H2HCore.joinMeetings` (`h2h-core.js`) over both players' career-history shards, fed by the same three
  helpers (`sfH2hNkCount`, `sfH2hSide`, and the own-match key: `[eventKeyOfMatch(m)]` in the tab, none on the page). A keyless archive row (TML, pre-2022) is joined by date + opposite
  result + names, so it counts. **Test:** `test-ten437-h2h.mjs` "UI" + "golden pairs".
- **The model reads the same list** (founder ruling 2026-10-14, card edd72529: "move the model to the full ATP-rule list,
  keep today's age bands and tiers"). `buildModelOutput` (`bsp-pipeline.js`) hands `runModel` a copy of each match whose
  `h2h.matches` is `modelH2hMatches` — `H2HCore.joinMeetings` over the career-history shards that run wrote, in the
  `buildH2HMatchList` row shape; `matches.json`'s own `m.h2h` is unchanged. The layer's math, age bands (2 / 4 years,
  weights 1.0 / 0.6 / 0.2) and tiers (Nₑₓ 8 / 3; ×1.0 / 0.45 / 0.10) are untouched; their review is a separate open
  decision. Measured before the switch on the 26-match board (14 Oct): median shift 0pp, max 0.23pp, no value flag
  flipped. So the Stennisfy Model page's "Why" text prints the screens' record too. **Test:** `test-ten437-h2h.mjs`
  "model" (Medvedev–Tsitsipas "H2H 10-5 (15 meetings…", bands and tiers pinned) + "single source".
- **Population = what atptour.com's H2H record counts** (read off ATP's own H2H data, report B, 2026-10-14; the every-pair
  reconciliation 2026-10-16): counted — tour-level main draw, Grand Slams, ATP Finals, Next Gen ATP Finals, Davis Cup
  (World Group / WG I / WG II, zonal Groups I–II), Olympics, ATP Cup, United Cup, Laver Cup (2017 on), retirements —
  including one before the first set finished (0 - 0, no set scores: a meeting, never a walkover) — and defaults. Not
  counted — Challengers and ITF (career-history `chitf`), every qualifying round, walkovers (listed "w/o", counted
  nowhere — N2), Hopman Cup, exhibitions, the Asian Games and Davis Cup Group III/IV round-robins (all absent from ATP's
  list; founder 2026-10-16 "following ATP"). Constants: `H2H_LEVELS`, `H2H_NOT_COUNTED` = `ATP_RECORD_NOT_COUNTED`
  (h2h-core.js) — **read by H2H only** (founder 2026-10-16: "ATP's rules apply to H2H only"): every screen's meeting list
  (`joinMeetings`), the pipeline's `H2H_NOT_ATP_RECORD` / `h2hCountsInAtpRecord`, the model (`modelH2hMatches`). No H2H
  copy anywhere (the dashboard holds none). Form never reads it — see the Form rule below. `inPopulation`, `isWalkover`. No record carries a level mix (there is no lower level in it).
  **Test:** "population constants", "D2", "D5", `test-ten273-team-events.mjs`.
- **Qualifying is read from BOTH players' rows, dated against the event's main draw** (founder 2026-10-16, D1).
  api-tennis files a qualifying draw under the main-draw key with its own "Semi-finals"/"Final" words. A feed meeting
  whose round is a word (QF / SF / F / Qualifying) is qualifying when it is dated BEFORE the first certified
  main-draw round ("1/N-finals") either player played at that event (same tournament and level, −16…+5 days; on that
  day it is main draw — a rain-delayed double after a bye), or when
  neither player has such a round there (a QF/SF/F needs one before it — a bye still plays R2) — except at a
  round-robin event (the Finals: group matches carry no round). It is main draw when dated after it, whatever either row's
  label says (a lucky loser's run: Kwon, Adelaide 2 2023), and when both rows say "Qualifying" it is qualifying.
  A "1/N-finals" round is always main draw; archive rows and team events keep their own round. `resolveQualifying`.
  Known limit: when one player has no career-history shard and the other's only main-draw rounds before the meeting
  were walkovers (not in the shards), the meeting reads as qualifying — such a pair is on no screen (both players of a
  board match or of the H2H page have shards). **Test:** "D1", golden pairs Basilashvili–Hanfmann (0–0) and Kwon–Bautista-Agut (1–0).
- **A one-sided row is credited on identity, never a name** (founder 2026-10-16, D3; replaces TEN-263's
  roster-unique-name rule for archive rows): an archive row only when its `oppId` (the opponent's TML/ATP id, written by
  `buildArchiveHistories`) equals the other player's shard `id`; a feed row on its `oppKey` (api-tennis key) against the
  other player's key. A row with no id is left out. Exception, until each cached profile rebuilds (14-day TTL): a feed
  row built before `oppKey` existed still uses the roster-unique-name rule. **Test:** "D3", golden pair
  Carreno-Busta–Z. Zhang (0–0: the Shanghai 2019 row is Ze Zhang).
- **Carpet is a surface; a blank surface is a dash** (founder 2026-10-16, D4): the archive builder keeps every TML match —
  carpet (indoor events to 2009) ships with `surface: 'carpet'`, a blank-surface match (some zonal Davis Cup ties) with
  `surface: null`; both are meetings; the surface chips stay All / Hard / Clay / Grass (a carpet meeting is in All and
  reads "Carpet" on its row). **Test:** "D4", golden pair Gasquet–Wawrinka (Paris 2006 R32 on carpet).
- **Next Gen Finals sets are sets** (founder 2026-10-16, S1): sets to 4 games (tiebreak at 3-3, best of five) are read
  as finished sets — sets won, deciders and its 4-3 tiebreaks count — and the match carries no games figure (totals,
  handicaps, "Tiebreak in match": a different scale — `fhEligible` drops it from every games line). **Test:** "S1".
- **An Olympic match carries its edition's surface** (founder 2026-10-16, S2): api-tennis gives one surface per
  tournament key and the Olympics reuse a key, so `OLYMPIC_SURFACE_BY_YEAR` (`bsp-pipeline.js`: Tokyo 2021 hard, Paris
  2024 clay, London 2012 grass, Rio 2016 / Beijing 2008 hard) decides every Olympic row, and the shard writer corrects
  rows of profiles cached before it. **Test:** "S2".
- **One match is one meeting:** a keyless archive row (dated at the event's start) and a keyed feed row (match day)
  for the same match are one meeting — same winner, same event (`TournamentIdentity`), the keyed row within
  `H2H_DEDUPE_WINDOW` [-1, 16] days, rounds not contradicting; the keyed row is kept. **Test:** "dedupe" (Shanghai 2019 SF:
  07.10 archive, 12.10 feed).
- **Prices attach to meetings, never the reverse:** the book rule is unchanged (Pinnacle close, else Bet365 close, one
  book per meeting; `fhCloseFor` is unchanged); only the pairing changed — a keyless archive meeting (dated at its event's
  start) looks for its close in the `H2H_DEDUPE_WINDOW` after that date, same opponent (`fhH2hWindowCloses`). Never
  ambiguous: meetings competing for the same closes get them in EVENT-DATE order, and only meetings of one event (same
  start date: an RR and a final) in round order (their rounds must be known), only when every close is there and each
  matches its meeting's result — else every one of them is a dash (founder 2026-10-16: "the tab prices the same 34 meetings
  the page does" — ordering a whole group by round gave RG 2020 QF Hamburg 2020 F's close and dashed both; 33 of the 34 now
  priced as the page, 0 priced differently; Cilic–Dimitrov Cincinnati 2016 stays a dash: a close-less Olympics meeting a week
  earlier, one close, one winner). A team tie (Davis / Laver / ATP / United Cup) takes none (no Tennis-Data close exists, a
  tour match's would be wrong). **Test:** "tab price pairing" (Rublev–Tsitsipas 2020 1.84 / 2.77). A keyed meeting keeps ±1 day. A meeting
  with no close prints a dash. **Test:** "prices attach to meetings" (Dimitrov–Goffin ATP Finals 2017 RR + F). "X of Y meetings priced": Y = every
  meeting in the filter (the full H2H count), never the priced subset. Sets won, Tiebreaks, Deciding sets and the surface
  counts read the same list, "N of M with set scores" with real counts. **Test:** "UI" ("0 of 15 meetings priced"), the
  mutant "coverage line counts priced meetings only".
- **Golden-pair gate:** `tools/fixtures/ten437/h2h-golden-pairs.json` (57 pairs — one per 2026-10-16 fix included — ATP's Record fields with the check date,
  the live shard rows each join reads; rebuilt by `tools/ten437-golden-build.mjs`). CI fails on any pair that differs from
  ATP. **Known gaps (reported, pinned so any change turns CI red):** Fils–M. Ymer (Lyon 2023) and Bublik–Rublev (Dubai
  2024) — defaults ATP counts, api-tennis status "Awarded", dropped by `playerMatchHistory`. Mutations:
  `tools/test-ten437-mutants.js` (the eventKey-only join back = 21 of 49 pairs red, 14 of the 18 scale-table pairs).
- **Pipeline reconciliation:** `tools/h2h-reconcile.mjs` runs on the store each pipeline run builds; the run fails if the
  golden pairs' total meetings fall below the previous published run's (`h2h-reconcile.json`) or any exact pair falls below
  ATP's count. No `|| true`.
- **A failed history load is a load error with a Retry, never "no meeting on record", and is never cached**
  (`careerHistoryAnswered`; tab, Key factors and the Head to Head page). **Test:** "failed load".

## Prices (rulings 2026-09-23 and 2026-09-24)
- **Order** (TEN-310 R8, founder 2026-09-28, supersedes the 2026-09-23 Pinnacle order). Every price on
  both tabs, the Match analysis Market edge tab and the player-profile Market edge goes through the order
  `FH_BOOK_ORDER = ['Pcap','Ptd','Btd','Bcap']`: Pinnacle close from our capture → Pinnacle close from
  Tennis-Data → Bet365 Tennis-Data → Bet365 captured → a dash. The builder (`build-market-edge.js`
  `pickSide`) uses the same order; `tools/test-ten310-price-order.js` reads the page constant.
  **Test:** reversing any adjacent pair turns a test red.
- **One book and one source per match**, both sides ≥ 1.01, else fall through.
  **Test:** no priced row carries sides from two slots.
- **A captured close is the last tick at or before the actual start**: the oddspapi `trueStart`
  (rejected when `trueEnd − trueStart > 6 h` or `trueEnd < trueStart`), **else the card state's
  live-flip start** (`odds-card-state.json` `startTs`, `startTsSource` `api-tennis-live` = the last poll
  where the match was NOT live) — TEN-316 board ruling 2026-09-28 (card 9f0e123c), because no trueStart
  is stored after 23 Sep. A capture with neither is dropped; never a scheduled time.
  **Test:** an in-play tick is never the close (`tools/test-captured-pinnacle.js`, with a no-cut mutant control).
- **Captured Pinnacle is refreshed every pipeline run** (TEN-316): `build-captured-pinnacle.js` runs before
  `build-match-closes.js`, reads the committed `matches.json` history for `oddsMovement.books.Pinnacle`
  (to 2 Sep) and `oddsMovement.chart.books["Pinnacle +30s"]` (Oddspapi pinnacle+30, from 23 Sep), and merges
  into `captured-closes-pinnacle.json` (committed back after the deploy; held rows are never deleted).
  Pinnacle +30s rows are labelled **"Pinnacle · captured"** like the Jul–Sep rows (board ruling, card 9f0e123c); a close
  the Oddspapi archive replaced (founder brief 2026-10-14) reads **"Pinnacle close · from Pinnacle history"** (the shard's
  `pinLabel`, `fhSrcTitle`). The closes come from the permanent Pinnacle archive's export (`pinnacle-closes.json`,
  `.claude/rules/pinnacle-archive.md`).
  **3–22 Sep** (no series in matches.json) was backfilled once (TEN-346, board ruling Q3 on card 9f0e123c) from
  Oddspapi `/v4/historical-odds` pinnacle+30 by `tools/ten346-backfill-captured-pinnacle.js` (+ the key-yielding
  `tools/ten346-backfill-pinnacle-fetch.py`), cut and merged by this builder; the file's `backfills` record says what
  was added and `build()` carries it through every run.
- **api-tennis closing prices (TEN-269)** join as a **5th, fallback-only** slot. They move up
  only after the TEN-269 validation shows they agree with Tennis-Data on overlapping
  matches, reported with the agreement rate and its denominator. api-tennis **opening**
  prices are never shown as closing prices.
- **Never `m.bestOdds`** on these tabs. **Test:** the block does not read it.

## Display constants (ruling 2026-09-24): each is one constant, and each is a test
- **a** `FH_HOT_MIN_ELIGIBLE = 3`: a hot line needs at least 3 eligible matches. That is the minimum to **appear**; the % beside it follows `tourxSampleGate` (TEN-312 D2: no % under 5, grey 5–9). Form `THIN = 5` gains the same 5–9 grey tier. The H2H small-sample chip shows for n 1–9, not only n = 2. H2H opens on All surfaces; Form on today's surface (TEN-312 N1).
- **b** `FH_PRICE_AVG_MARGIN_REMOVED = true`: the Price range average has the bookmaker margin
  removed, and every place it shows says so ("avg · margin removed", `FH_PRICE_AVG_LABEL`).
- **c** `FH_H2H_SET1_MIRROR = true`: H2H hot lines list "A wins set 1" and "B wins set 1".
  Each figure reads from the player it names, and no meeting is counted twice: the two lines
  are complements over the same eligible meetings. **Test:** covered(A) + covered(B) =
  eligible, and no meeting is covered by both.
- **e** `FH_H2H_RET_COUNTS = true`: a retirement during the match counts in the W-L record. A
  walkover or withdrawal before a ball is played is not a meeting (no set played = W/O).
  **Test:** a W/O never enters the record card. A retired match's unfinished set is excluded
  from the Sets / Tiebreaks tallies; a retired match never counts as a deciding set and is not
  eligible for games or sets lines ("wins set 1" only if set 1 was finished).

## Shared rows, hot lines, segmented track (TEN-380, step-3 handoff README §5–§6, measured on OFFICIAL VERSION 1)
- **Match rows** (`maMatchRowsHtml`, default path — Form, Tournament): README §5's grid `MA_ROW_COLS` =
  `40px 10px minmax(96px,1fr) 28px 34px minmax(86px,1fr) 38px 38px`, gap `0 6px` (`MA_ROW_GAP`), header and rows alike;
  columns Date · · Opponent · Rd · Sets · **Score** · H · A (the Score column is its own track, `--text-label`). The
  Opponent floor is raised to 96 px and the two shares are equal (1fr / 1fr, Score floor 86 px; founder TEN-380 review,
  2026-10-04) so a name like "Shimabukuro S." and a three-set score each stay on one line, and **a score is never cut**: a
  four- or five-set score wraps between sets only, each set kept whole;
  H `--text-soft`. The head is `--card` on a 1px `--line` rule (decisions §1: the reference measures 5%, not `--line-strong`),
  labels never wrap. **Test:** `test-ten314-components.mjs` (README §5 grid), `test-ten330-form.mjs` (rows).
- **No Elo in the opponent column** (founder TEN-380 Q5; the Elo lives in the Form bar tooltip, see below); names wrap between
  words, never cut (`fullNames`). The H2H Event cell reads "<surface> · <level>" with no Elo word. The TEN-350 "scores under the name" layout and `MA_ROW_COLS_SB` are gone. **Test:** `test-ten350-elo-slot.mjs`
  (1296 px layout in Chrome; mutation: the Opponent track loses its 78 px floor).
- **Hot lines** (`fhHotLinesTable`, identical on Form and H2H and for both players): Line · **Rate** · Covered · dots
  (`FH_HOT_COLS`). Rate follows the D2 gate (`fhHotRateHtml`: n 3–4 a grey "—" saying why, 5–9 greyed, 10+ `--text`); no
  gate bar. Dots `--hot-dot` with a 1px ring (filled = covered, ring = not covered, a small white-8% dot = not eligible); the
  column-head dot is white for a match on today's surface, white 22% otherwise. "Most covered" row = `--inner`, no edge, its
  label `--link`; "Show all lines (N)" / "Best line per family" `--text`, centred under the table (`fhHotMoreHtml`).
  **Test:** `test-ten330-form.mjs` hot-line checks, `test-ten331-h2h.mjs` "hot lines" (mutations in both runners).
- **Segmented track** (`fhSegTrack`): the Darker track — `--card` + 1px `--edge-6`, radius 9, padding 3, gap 4, never shrinks;
  selected `--inner` + 1px `--edge-10`, white 700; items 5px 11px (Form), 5px 12px (H2H's surface filter).

## Form tab build (TEN-330; restyled TEN-380)
- **Filters:** all four on ONE row that never wraps and scrolls sideways (`fh-filters`: gap 10, margin-bottom 22):
  surface | role | Matches/Days, then Last N (or N days) on its **own** track; `--edge-10` rules between the first three.
  **Test:** `test-ten330-form.mjs` "Form filters".
- **Built from the file:** header columns, bars with the **closing price under each bar** (`fh-bar-price`, "—" when unpriced,
  nothing in an empty slot), Show form data (thin count as the aside), hot lines (name `--text` over "window · surface · role",
  Hanken caps per foundation — the reference's mono caps are not used), Recent matches ("surface · W–L" group header, set
  scores "6-4, 6-3", " ret." on a retirement). The file hard-codes the "Short odds" chip off (`short:false`) and binds no
  "priced in at" line: neither is shown.
- **Cards:** summary, hot lines (radius 16, 22 px apart) and Recent matches (radius 14) are `--card` + 1px `--edge-6`; the two
  lists 22 px apart. "↑ used in form stats" = two `--edge-10` rules round a mono lowercase label. The v-market pill = white
  3% + `--line`; "oldest → newest" mono 9, not caps. The hot-lines toggle's right meta is mono, sentence case ("Last 10 · Hard").
- **Shared helpers only** (DoD item 8): Recent-matches rows are `maMatchRowsHtml` rows (`fhFormRowData`; head
  `10px 14px 8px`, groups `11px 14px 5px`, `inset: 8`), each bar is a `maTipHtml` tooltip (`popStyle: bottom:20px`), and every
  row / bar opens the shared sheet. Form has no row or tooltip renderer of its own.
- **A walkover never becomes a Form row** (N2): no bar, no row, no W–L, no count — the pipeline already drops them from
  the form shards; the tab drops any that reach it (career-history rows included).
- **A Laver Cup match never becomes a Form row** (founder TEN-380, 2026-10-04 07:33Z; kept by TEN-437 2026-10-16: "Form
  keeps its current rules, unchanged" — ATP's rules are H2H only): not in the last 10, the W–L, v market, the hot lines or
  Key factors' Recent form — the next match slides in. Hopman Cup and exhibitions are out too; Davis Cup, United Cup,
  Challengers / ITF / qualifying (TEN-8, 2026-08-03), the Asian Games and Davis Cup Group III/IV stay in. Form's OWN list
  (`FH_FORM_EVENTS_NOT_COUNTED` + Laver Cup = `FH_FORM_NOT_ATP_RECORD`), applied in `fhFormPlayer`; never h2h-core's
  `ATP_RECORD_NOT_COUNTED`. **The Matches board card's Recent form % follows the same rule** (founder TEN-383, 2026-10-04): the
  pipeline's `recentFormPct` scores the last 10 rows outside `FORM_NOT_ATP_RECORD` (bsp-pipeline.js; the same list as
  `FH_FORM_NOT_ATP_RECORD`), so the card equals the Form tab's All surfaces · Last 10 W–L. The form shard keeps every row;
  the tab filters them. **The Player Profile's Recent form follows it too** (founder TEN-383, 2026-10-04 10:04Z, "profile
  too"): the V2 ribbon (its rate, strip and chips) and the full ledger (rows and "Window: N matches") read
  `buildCtx`'s form rows (`inForm`, `FORM_NOT_ATP_RECORD` in player-profile-v2.js); the legacy renderer's Recent form tile,
  strip and list read `formRows`. Data only — the layout is locked, the ribbon still rates its last 18. Records keep every
  match: the header Current run / Last played / Season, Career record and its drills, the sheet lookup, the season W–L.
  H2H keeps ATP's list. **Test:** `test-ten437-h2h.mjs` "H2H counts Fritz's Laver Cup … Form counts the reverse" and "the
  list map" (Form's four readers pinned to one Form list, never the ATP one); `test-ten330-form.mjs` "review 2: a Laver Cup
  match is not a Form row; Davis Cup still is", "TEN-383: the board card's Recent form % counts the Form tab's matches" (one fixture: card = 100%, Form tab
  10–0) and "TEN-383: the Player Profile Recent form … counts the same matches" (the real V2 `buildCtx` → ribbon + ledger:
  no Laver Cup row, Davis/United Cup kept, last 10 = the card's 100%, "Window: 11 matches"); the three lists' sources are
  asserted equal. Mutants for all three in `tools/test-ten330-mutants.js`.
- **A player without a form shard** (non-board) reads his `career-history/{key}.json`, newest first, capped at
  `FH_FORM_ROW_CAP = 40` (= `RECENT_FORM_ROW_CAP`). Neither source → "No recent matches on record" (design gap G9).
- **Retirement settlement note** (TEN-325): the v-market pill's tooltip and each Flat 1u value's tooltip carry
  `MarketEdgeCore.RET_SETTLE_NOTE` (the tooltip form keeps the file's layout).
- **No Elo in a match row (founder TEN-380 Q5, 2026-10-03; replaces the TEN-350 row slot):** Form, H2H, Tournament and
  every other `maMatchRowsHtml` row follow the README §5 grid with no Elo. The opponent's Elo at the match date (D-12)
  lives in the Form bar tooltip ("v Opponent · Elo N", class `fh-tip-elo`); no qualifying snapshot → "Elo —" with the
  reason on hover (`fhEloText`); never the current Elo. The name's hover is the full name only. **Names are never cut:**
  they wrap between words (`fullNames`); a word wider than the whole track wraps mid-word only as a last resort.
  **Test:** `test-ten350-elo-slot.mjs` (tooltip Elo at date + reason; no `ma-row-elo` in any row) + `tools/test-ten350-mutants.js`.
- **Test:** `test-ten330-form.mjs` (+ `tools/test-ten330-mutants.js`). Pixel/structure harness (manual):
  `tools/ten330-form-capture.mjs` + `tools/ten330-form-structure.py`.

## H2H tab build (TEN-331; restructured TEN-380 on the reference)
- **Order:** surface filter with counts ("filters everything below"), then sections whose **titles sit outside their cards**
  (20/800 title, 12.5 `--text-label` subtitle, a `--line` rule 24 px above every section after the first; blocks 14 px apart):
  "Head to head" (one record card + the three stat tiles), "Price range", "Hot lines", "Meetings". **Test:**
  `test-ten331-h2h.mjs` "TEN-380: section titles outside the cards".
- **Record card** (the file's varA: "Overall", or "On clay" under a filter; "Meetings ↓" `--text` scrolls to the list and
  keeps the filter): both names and scores white; the **tug bar from the centre** (drawn at any n ≥ 1, the pull is a count)
  is white — player A `--white-bar`, player B white-bar at 70% (measured, decisions §1), `--line` track, `--viz-tick` tick.
- **Stat tiles** (Sets won / Tiebreaks / Deciding sets): title left, "Breakdown ▾" (`--text`) right on one header line; an
  open tile = `--card` + 1px `--edge-24`; its drawer = a panel (`--card` + 1px `--edge-6`), no blue outline; drawer rows on
  `--line`, dates `--text-label`, values `--text`; every row opens the sheet.
- **Price range:** both players' panels `--card` + `--edge-6`, figures white, venue labels `--text-label`.
- **Meetings:** "Meetings" + "{A}'s side · Home = {A}'s closing price", right "n on record · {X} leads a–b"; the shared rows on
  the reference's grid `MA_ROW_COLS_H2H` (`48px 12px minmax(0,1.4fr) 36px 40px minmax(0,1.3fr) 46px 46px`, gap `0 10px`),
  **grouped by year** (newest first, header "2025 · 1–0 · 1 meeting" in mono), one row per meeting with an **Event** column:
  the event, its tag "surface · level · Elo" (`--text-label`, the level never dropped), then B's Elo at the meeting
  (the Q5 slot). Set scores `--text-label`, Home `--text-soft`. Each row wrapper carries the hover-dim hooks.
- **Shared helpers only** (DoD item 8): meetings are `maMatchRowsHtml` rows (`fhH2hRowData`), the price range's "every priced
  close" pop-up is `maTipHtml`, and every meeting, dot, breakdown row and Lowest / Highest opens the shared sheet (date
  DD.MM.YY). The H2H row renderer, W/L chip, sticky header and `.fh-elotip` are deleted.
- **A walkover** is listed (marked "w/o") and enters no count, record, tally, line or price (N2); the list header says
  "k w/o not counted"; a surface whose only meetings are walkovers still opens (count 0). Every meeting a walkover → the
  card (0–0) and the list only (DESIGN GAP G11). A retirement's set scores end " ret.".
- **Price range header:** today's book is counted only where today's price is drawn (the range marker, n ≥ 2). No
  Pinnacle / Bet365 price for today → "Today —" with the reason on hover (`FH_TODAY_NONE`); `m.bestOdds` / other books never
  stand in (measured 2026-09-29: 1 of 26 upcoming board matches carried a Pinnacle now-price).
- **An empty drawer** (no tiebreak / no decider in these meetings) opens with the file's empty-line pattern and says why
  (DESIGN GAP G10 — the file opens nothing).
- **0 and 1 meeting:** 0 → the empty-state card and its two style tiles on `--edge-6`; 1 → the full layout with its n=1
  chips and "Not enough meetings to rank lines (n=1)". **Test:** `test-ten331-h2h.mjs` "TEN-380: the 1-meeting and 0-meeting states".
- **Test:** `test-ten331-h2h.mjs` (+ `tools/test-ten331-mutants.js`). Pixel/structure harness (manual):
  `tools/ten331-h2h-capture.mjs` (`--theme source --ruled-off`) + `tools/ten312-pixel-diff.py --regions` +
  `tools/ten330-form-structure.py`.

## Form rows: opponent Elo AT THE MATCH DATE (ruling 2026-09-24, D-12)
- **Basis:** overall Elo from the latest weekly Tennis Abstract snapshot in `elo-history.json` dated
  **strictly before** the match day (ruling 2026-09-24: a same-day snapshot can hold the match's own result), and only if it is **no more than 7 days old** (`FH_ELO_MAX_AGE_DAYS`). No
  qualifying snapshot → the row reads `ELO —`. **Never the current Elo as a stand-in, never a blank.**
  **Test:** an 8-day-old snapshot, or a snapshot dated after the match, gives a dash.
- **"Opposition Elo" is the mean of exactly the badges shown**, and needs 5+ rows with Elo; below full
  coverage it says "k of n with Elo" (on both sides when either side is short). **"Elo change"** is the
  player's own Elo at this match's date minus at the oldest window match, on the same snapshots.
  **Test:** the average equals the mean of the rendered badges.
- **No wrong player:** a name key two Tennis Abstract players share (`ambiguous`), a key two feed
  players use (`elo-key-conflicts.json`, rebuilt every pipeline run from the roster and every form
  shard: e.g. J. D. Silva / J. Reis Da Silva, Zhizhen / Ze Zhang), or a feed-marked namesake
  ("Dar. Blanch") gives a dash. Without the conflict list no number is shown at all. The
  surname-only fallback (`bySurname`) is never used here.
- `elo-history.json` is **append-only**: `tools/build-elo-history.mjs --append` runs in `elo.yml`;
  an unchanged report adds nothing (its `asOf` stays the date the numbers were first published).
- **Retry until the report moves (ruling 2026-09-24):** the job runs every Monday. If TA's printed
  "Last update" equals the last stored report's, it retries the next day, and daily until a new
  report is stored, then stops until next Monday (`shouldFetch`). A live snapshot's `asOf` is **the
  day we fetched it, never TA's label**; the label is stored beside it as `taLastUpdate`. A day with
  no new report appends and commits nothing. **Test:** an unchanged Monday report triggers a Tuesday
  retry; a new Tuesday report is stored with Tuesday's `asOf` and stops the retries.
- **Staleness (ruled 2026-09-24):** `ELO_STALE_WARN_DAYS = 8` warns at 8 days old or more;
  `ELO_STALE_RED_DAYS = 15` fails the job at 15. **Test:** 7 days ok, 8 warns, 15 red.
- **Archived reports (ruling 2026-09-24):** Wayback captures before 2026-07-18 are in the history
  (`source: 'wayback'`, `captureUrl`, `captureTimestamp`, `taLastUpdate`, `players`). Their `asOf` is
  **the capture day, not TA's label** — a report is never used before it provably existed. Several
  captures of one report keep the earliest. Keys two players share within an archived report are
  in its `ambiguous` and never resolve. archive.today is not used.

## H2H tab: Elo and labels (rulings 2026-09-24, H2H pixel pass; TEN-380 Event column)
- **H2H meeting rows carry the opponent's Elo** on the Form basis above (overall, strictly before the
  match day, at most 7 days old; `ELO —` otherwise), as a plain grey number after the event's tag. The level
  tag (ATP / CH / ITF) sits in every row's Event tag after the surface ("Clay · ATP · Elo"), never glued to a name. A Bet365
  row carries the "B" marker in the Home cell. **Test:** `test-ten263.mjs` (level in every row's tag), `test-ten350-elo-slot.mjs`.
- **Price range header:** any Bet365 figure in the section, today's price included, reads "Pinnacle,
  Bet365 where missing (…)". **Never a single book name over mixed data.** **Test:** Pinnacle meetings
  + a Bet365 today price → the mixed wording.
- **Hot-line dots on H2H use fixed columns** (1/max(n, 9) of the grid, right-aligned), so 4 meetings sit
  where 9 would (founder Q3, 2026-09-30: over the design's stretched columns). Form keeps stretched columns.
- **H2H with no meeting** (founder Q4, 2026-09-30): "{A} and {B} **have no meeting on record**." plus the line saying what
  was searched (`fhH2hScopeNote`, the Head to Head page's words: "Searched both players' match histories since {the
  earliest ATP year either holds}."; a player with no history file is named: the meetings are read from the other side). The design's "have not played" is a named exception:
  our store can only say what it holds. **Test:** `test-ten331-h2h.mjs` "Q4" (mutation: "have not played").
- **A player with no profile is plain text** on Form and H2H (founder Q27, 2026-09-30): `fhNameLink` links only when the
  key has a profile. **Test:** `test-ten330-form.mjs` "Q27" (no link without a profile key; mutation: always a link).
- **Long names:** never cut (founder bbe5c072, supersedes the 2026-09-24 ellipsis): they wrap between words; full name
  on hover (Form and H2H rows). **Test:** `test-ten350-elo-slot.mjs` renders the real rows in headless Chrome at the
  1296 px geometry (Davidovich Fokina, Van De Zandschulp…) + `tools/test-ten350-mutants.js` (8 mutants).

## Player identity by key (rulings 2026-09-24)
- The H2H compare page's roster, selections and meeting store are keyed by **player key**; two players
  with the same short name ("Z. Zhang") are both listed and selectable. **Test:** both same-name
  players selectable, each with only his own meetings.
- Odds-feed match cards orient p1 by given name when the surnames tie; if still undecidable the card
  gets **no player keys** (dashes), never a guess.
- The model's Elo join: aliases for Y. Bu (`yunchaokete|b`) and Wu Tung-Lin (`wu|t`) only; a player
  with no key falls back to the feed name; `fetch-elo.js` parses rows with a blank Age cell.
- `market-edge-index.json` carries `builtAt` / `builtFromCommit`; the Market edge panel shows
  "rebuilt …"; a stale index (builder crashed, committed floor shipped) is a run **warning**. Making it
  red is not ruled.

## matches.json's api-tennis H2H list (rulings 2026-09-24 / 2026-09-25 — read by nothing on screen or in the model since TEN-437)
- The pipeline's `m.h2h` (api-tennis `get_H2H` + the ATP-singles `get_fixtures` backfill) keeps **ATP, Challenger and
  ITF singles** (`H2H_EVENT_TYPES`); exhibitions, doubles, juniors, UTR and women's events stay out; Hopman Cup and
  exhibitions are removed by `H2H_NOT_ATP_RECORD` (the same list as `h2h-core.js`). It stays in matches.json (schema
  unchanged) and feeds the box-score prefetch (`build-point-by-point.js`); no screen and not the model reads it.
  **Test:** the set holds exactly these three singles types; `test-ten273-team-events.mjs`.
- **A match never counts in its own H2H record** (ruling 2026-09-24), on every surface and in the model: the pipeline
  drops the fixture's own eventKey at every H2H build site (`h2hExcludeOwn`) and again before `matches.json` is written
  (`stripOwnFixtureFromH2H`). **Superseded on the screens by founder 2026-10-16 (TEN-437 ruling 1):** only the match's OWN
  analysis leaves it out — the Match analysis tab opened on that match (`own = [eventKeyOfMatch(m)]`) and the model
  (`modelH2hMatches`, `own = [ek(m)]`); the H2H page and every other surface count every meeting, this week's included
  (`own = []`; `sfH2hOwnEks` is gone). Medvedev–Tsitsipas reads 11–5 / 16 on the H2H page while the Shanghai match's own
  analysis reads 10–5 / 15. **Test:** "board-match exclusion" in `test-ten437-h2h.mjs`; a finished board match whose own
  eventKey is in `h2h.matches` fails, and the record is recomputed without it.
- **Who won a meeting is decided by player key, never surname** (ruling 2026-09-24):
  `h2hP1WasFirst` compares `first_player_key` / `second_player_key` with p1's key; a row that
  carries neither is not counted. **Test:** two same-surname players (Zhizhen Zhang 590, Ze
  Zhang) orient by key, and `summarizeH2H` / `buildH2HMatchList` never call `lastName`.

## Market-edge is a pipeline output (ruling 2026-09-24)
- `market-edge/` and `market-edge-index.json` are rebuilt by `build-market-edge.js` in
  **every pipeline run**. They are never hand-built or hand-edited: any edit is overwritten on
  the next run. The committed copy is only the floor published if the builder fails.
- Inputs: `database-yield-master.json` (the one master, built by `build-database-yield.js` in the same run — founder 2026-10-17), `player-profiles.json` (pipeline),
  `court-speed-map.json`, `playing-styles.json`.

## Captured Bet365 covers ITF Men and Davis Cup (ruling 2026-09-24)
- `archive-bet365-history.py` `TIERS` includes `'ITF Men'` and `'Davis Cup'`, and
  `build-match-closes.js` `CAPTURE_CATS` prices them. ITF Women, BJK Cup, UTR and juniors stay
  out. A Davis Cup tie bet365 never priced stays a dash with its cause (a recorded miss); it
  is never filled. **Test:** `tier_of` keeps ITF Men and Davis Cup, drops ITF Women and BJK Cup.

## Alarms (rulings 2026-09-23 / 2026-09-24): two separate workflows
- **Tennis-Data staleness** (`odds-archive-staleness.yml`): red when the newest archive row
  is more than 7 days old. 7 days is ruled final (2026-09-24).
- **Capture freshness** (`odds-capture-freshness.yml`): red when no book in the board's captured
  series (`matches.json` `oddsMovement`) has ticked for 24 h **and at least one upcoming match
  is on the board** (`MIN_UPCOMING = 1`). A stale capture on a board with nothing to price is
  quiet, not red. **Test:** a stale board with 0 upcoming stays green; the same board with 1
  upcoming goes red.

## Match stats popup and every match-detail panel (rulings 2026-09-24)
- **One control** `Match | Set 1 | … | Point by point`, one set tab per set in the score. A set with no
  per-set stats is a **disabled** tab with the tooltip "No per-set stats for this match" — never hidden.
- **Every rate shows its count and one decimal**, computed from that count (`60.9% (46/76)`). A real
  0 with opportunities is `0.0% (0/4)`; 0/0 is `—` with its reason; a stat the feed never sent is `—`.
  Winners/unforced errors all 0 on both sides = not sent (`—`): a display guard until the pipeline
  stores `null` for an unsent count.
  **TEN-312 D2 applies on top (TEN-338):** a rate on n 1–4 shows its count only ("2/3", no %), n 5–9 greyed with a
  footnote — `fhGateCell`, rules in `modal-match-stats.md`.
- **Bars — one rule, on the popup and all eight other match-detail panels** (`msBarHtml` →
  `fhStatBarWidth`): a rate fills its own value of that player's half (a genuine 100.0% fills 100%);
  a count fills value ÷ max(p1, p2, floor) and a rating value ÷ its scale, both mapped onto
  `FH_BAR_CAP = 90` so they **never fill their half** (the larger side stops at 90%, the other keeps
  its proportion); a `—` side draws no bar and never moves the other side. Dominance ratio
  (RPW% ÷ (100 − SPW%)) is a number only. Ruled constants: `FH_BAR_FLOOR = {aces 30, df 15,
  winners 80, ue 80}`, `FH_RATING_SCALE = {serve 400, return 350}`. **Test:** 1 v 0 double faults
  stays short; a count above its floor stops at 90%; 100.0% fills 100%; a `—` side draws no bar.
- **Serve / Return rating — one rule across the product:** ATP's leaderboard components, summed by the
  2026-08-29 house rule (TEN-103); the Match Stats tab reads the popup's function (`msheetHouseRatings`),
  so the same match shows the same number. Any component missing or sent without its count → `—`;
  0 break-point chances → no Return rating (also in `surface-ratings.js`).
- **Pressure points (Michael's definition, as TEN-243):** break points saved + converted ÷ all break
  points the player played, shown `58.3% (7/12)`; 0 played → `—`. **Test:** its numerator and
  denominator are the sums of the Break points saved and converted rows.
- **Point by point follows the header** (player A on the left): the feed's order is flipped when A is
  the feed's second player (player keys, else set scores, else names). **Test:** a reversed feed flips.
- **Line-height:** the design's `normal` is set once for `#aSectionForm, #aSectionH2H, #fhSheet` — not
  on the whole modal shell, which (measured) moves every leaf of the nine other tabs.
- **Price range:** a range from fewer than `FH_PRICE_THIN = 3` priced meetings shows an `n=k` chip.

## Bet365 fallback on H2H prices (founder TEN-437, 2026-10-16, item 4)
- Bet365 closes stay where no Pinnacle close exists (884 meetings in ATP main draw 13 Jan–30 Apr 2026 among them), with the
  tab's "B" marker / "B365" tag and ONE hover on every H2H surface: `FH_B365_HOVER` = "Bet365 closing odds, Pinnacle not
  available" (`fhH2hSrcTitle` in the tab's rows, `fhB365Tag(r, true)`, `fhB365Meta`, the H2H page's `h2hPriceTitle`).
  H2H only: Form and every other surface keep `fhSrcTitle`'s source label. The H2H page's meeting rows carry the same
  "B" marker as the tab (founder 2026-10-16 item 4; supersedes TEN-402 r1 fix 3's no-marker ledger). Remove only when a
  Pinnacle source is found. **Test:** "a Bet365-priced meeting" in `test-ten437-h2h.mjs`; `test-ten402-r1y.mjs` fix 3.
- **No captured step on the H2H page** (founder 2026-10-17, round 2 item 5; REMOVES the 2026-10-16 item 5 "Pinnacle
  first on every screen"): the page and the tab price every meeting the master holds from the Database join only
  (`odds.md` "No other price path"); `h2hCapPinnacle` is gone. **Test:** "no captured step" in `test-ten437-h2h.mjs`.

