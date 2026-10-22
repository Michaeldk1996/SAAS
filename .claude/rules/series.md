# Series (founder step 14, TEN-427, 2026-10-10)

Applies to `series.js` (rendered into `#seriesGrid`), `series.css`, the Series block in `bsp-consult-dashboard.html` and
the generator `build-series.js` (runs on every `pipeline.yml` run, writes `series.json` + `series-outcomes.json`; the
committed `series.json` is a 15 Sep fossil — read the deployed one). Reference = `OFFICIAL VERSION 1.html` → Series,
night, 1512px; design file `Series.dc.html` (card 2b, filters 1c, pop-up header "Count tile"; its hexes are legacy).
Night only. Header = the shared 35b `.sfh` (`app-shell.md`). **Test:** `test-ten427-series.mjs` executes the shipped page
on the dashboard's own Today's Matches / name / time helpers, fed a frozen live capture (`tools/fixtures/ten427-series.json`,
10 Oct 2026 14:52Z: series.json, the board, names, canonical events, and the real Database join's answer per row);
`tools/test-ten427-series-mutants.js` (95 mutants, 0 may survive). Older locks that still stand: `tools/test-series-rows.js`
(every row satisfies its claim — also a fail-closed pipeline gate after the build), `test-series-dates.js`,
`test-series-reference.js`, `test-series-outcome-summary.js`.

## Page
- **Order:** header · filters (the Type tab row with mono counts, then Level · Day · Direction · Min length left, Show
  already-played + Sort right) · card grid · footnote · history pop-up. No sidebar branch, no header card of its own,
  no "How to read" footer, no reference sub-line on the card (the 2b card has no slot; the engine still writes
  `streak.reference`).
- **Header:** title "Series"; the ticket's sentence verbatim (128 characters — the second exception to the 120 cap,
  `test-ten403-header.mjs`). Stats over the filtered list: Streaks · Players (distinct keys) · Longest run (white,
  grey `—` when empty) · **Updated = `series.json` `generatedAt`** (the last rebuild of the streak data) as HH:MM in
  `stennisfy.tz`, else the browser zone; `—` without it. Never the clock.
- **Footnote = the reference's form** (founder round 3 item 1, SUPERSEDES round 2's sentence form and its "no date
  stamp"): line 1 (Hanken 12.5 / 1.6, `--text-label`, max 1130px) = "Direction shows as a word in the tag row — Winning
  run, Losing run, Neutral. Betting lines (over/under, handicap) and set-shape volatility are a direction, not good or
  bad." (the reference's sentence whole, the three words `--text-soft`) + a line break + "Prices are closing prices, flat
  1 unit per match." (appended inline it orphaned "unit per match." at the reference's 1130px cap); line 2 (mono 11.5 / 1.7,
  `--text-label`) = the engine's real values from `series.json` `rules`, `·` separated: "runs {minLen}+ · one card per
  player per family (only when `onePerFamily`) · recency cap {maxAgeDays}d (Grand Slams exempt — only when
  `slamAgeExempt`) · a gap over {maxGapDays}d ends a run · pool floor {minPoolConditional} for surface, style, set and
  line runs · data {generatedAt as YYYY-MM-DD in stennisfy.tz}" (`—` without it, never the clock). No filter state.
  Box: gap 10, padding-top 18, `--line` rule (reference measured: identical). **Test:** the exact two lines; identical
  across Min length / Level / Show already-played; follows `rules` and `generatedAt` in the member's zone.
- **Empty state** (card): "No streaks match these filters." + Clear (`--link`) → every filter back to its default.

## Slate (Data 2, 3)
- **Which players:** each card's next match is the Today's Matches card when the board (`matches.json`) carries it
  (joined by event key), else the series fixture itself — the board carries ATP only, so Challenger fixtures come from
  `series.json` `upcoming` — Challenger players stay on the page (founder card 939259c6, 2026-10-11), under the same day
  rule and helpers. **Day rule = Today's Matches':** `matchDayBucket({date})` (the member's calendar day); only
  `today` / `tomorrow` keep a card.
- **Next line** = "Next" (grey 700) · day word + `cardFmtStart` time · `sfEventName(event)` · "vs " +
  `newsPlayerName(opponentKey, feed name)` (founder round 3 item 2, SUPERSEDES "v" and the white mono time): one line,
  Hanken 12.5 `--text-soft` — the time in the line's own face, as the reference. **The event is shown whole or not at
  all:** after every paint `fitNextLines` measures each line (`scrollWidth > clientWidth`) and removes an overflowing
  line's event span (it carries its own " · "), leaving "Next <day> <time> · vs <opponent>" — the reference's own form;
  never an ellipsis inside the event. Re-fitted when the grid's width changes (ResizeObserver, width only) and when a web
  font lands. The full line (with the event) is always the `title` tooltip. Measured 11 Oct 1512px: 6 of 49 cards drop
  it (cards 319px wide). **Test:** a fixed layout model (box px, px per character) — a line over the box drops the event
  whole, a line inside keeps it, both exercised. Cards in a row are equal height (grid `align-items: stretch`, the ruled
  rows at the card's foot).
- **Level = ATP / Challenger only:** the engine's `tierOf` admits `event_type_type` "Atp Singles" / "Challenger Men
  Singles" and nothing else (ITF, WTA, doubles never reach the slate), and the page paints no card for any other tier.
  A Challenger event the canonical table (`SF_EVENT_NAMES`, Grand Slams / Masters / 500s) does not hold prints the
  shared cleaned feed name ("Wuning 3 (China) - Qualification" → "Wuning 3", api-tennis tournament key 14335).
- **Level** = the streak tier = the next match's tour tag (step 13 rule): ATP = `event_type_type` "Atp Singles",
  Challenger = "Challenger Men Singles", qualifying included in both. **Day** = the scheduled date's bucket.
  **Show already-played** (unchecked by default) INCLUDES cards whose next match has started or finished: board card
  `live` / `interrupted` / `isFinishedMatch`, or the feed's final status; a fixture the board does not carry counts as
  started once its start instant has passed (the deployed matches.json leaves a match out while in play).
  **A started / finished next match = the run AS IT STOOD AT ITS START** (founder round 2 fix 1), computed AT THE SOURCE:
  series.json is rebuilt after the match, so its runs already hold a match they continued (Medvedev Last 10 Oct) and
  have lost a run it BROKE (J. Pinnington Jones won 6, 8, 9 Oct, lost 10 Oct: no all-comps run left). So for every
  slate match that has started or finished at build time (final status, or its Berlin start instant passed),
  `build-series.js asOfStartStreaks` recomputes the player's runs from his history cut strictly before it — the
  fixture itself (event key) and every fixture that started at / after it go; a same-day fixture stays only when both
  carry a start time and its start is earlier — with every engine rule (floors, pools, the 75-day break, families,
  relevance to that match, one card per family, the run reference) and the 45-day recency measured AT THE MATCH'S START,
  and emits them as `players[].asOfStart` (`rules.asOfStart` marks a build that does this; a player whose only runs are
  as-of-start ships on that set alone). The page, Show already-played on, shows that set for a started / finished next
  match IN PLACE OF `players[].streaks` (an empty set = no card); before the start, only `streaks`. Count, Started, Last,
  pool, the claim's N, Avg price and the pop-up ledger read the shown run (one object — the single source). The
  outcome-subset rule runs on the shown runs. Prospective: live after the first pipeline run that builds series.json
  with this generator. Measured on real history (11 Oct, 4 get_fixtures calls): Pinnington Jones as of 10 Oct 12:00 =
  all comps Won 3 of 94 (Last 9 Oct), Total games under 21.5 5, Handicap −3.5 3 (clay 3 and first set 3 = the same
  rows); Medvedev as of 10 Oct 06:10 = all comps / hard / −3.5 / won the opening set 7 (Last 4 Oct), vs style 3 of 39;
  Baez Total over 21.5 7 (Last 8 Oct); Vacherot first set over 9.5 6 (Last 5 Oct).
  **Fallback only (a series.json without `rules.asOfStart`):** the page trims the post-match run — the next match's own
  row (event key) and every row after it; when the run lacks that key, rows dated after its date and, once it has
  started, rows on its date unless the board card with that row's event key starts earlier than the next match; a run
  under the engine floors after the cut (length < `rules.minLen`; pool < `rules.minPoolConditional` for every family
  but all comps) or whose last row is older than `rules.maxAgeDays` at the match's start (Grand Slams exempt) gets no
  card. A run the match broke cannot be rebuilt by the fallback. A series.json WITH the field is never trimmed.
  **Soonest** = the start instant (`cardStartMs`), unknown last; **Longest** = count, then pool.
- Type counts follow every other filter, ignore Type; "All" = the sum.
- **Freshness:** the slots (day word, already-played, start) are recomputed on every page show and every 5 minutes while
  the page is shown; a page show refetches `series.json` once the loaded copy was fetched more than 15 minutes ago
  (a failed refetch keeps the last good copy). Updated stays that copy's `generatedAt`.

## The seven families (build-series.js)
**What counts (every family):** api-tennis `get_fixtures` for the player, Jan 1 five years back → today; in-tier only
(tiers never blended: a tour match's card reads tour matches); status Finished, **or Retired with at least one game
played — retirements count, the feed's winner wins** (TEN-427, the ATP rule of steps 8 and 13; SUPERSEDES TEN-168
"retire = SKIP"); **walkovers never**. Deduped by event key, oldest → newest. A run = consecutive matches in one state
ending at the player's latest countable match; a gap > 75 days inside it cuts it; the latest match must be ≤ 45 days old
(Grand Slams exempt). Engine emits runs ≥ 3; the page shows 6+ by default (3+…8+), vs style from 3. **One card per
player per family** (longest, ties → bigger pool; Handicap by line priority below). Page-side: an all-comps / surface /
vs-style run that is a subset of a same-or-longer run of a broader one of those families gets no card.
**Why Surface / Handicap are thin (founder round 2 fix 5, measured — not a bug):** both families are computed. Live
series.json 11 Oct 01:01Z: 42 Surface runs emitted, 36 are the same matches as the player's all-comps run (a player
whose recent matches are all on one surface has identical runs: Alcaraz hard 6 = all comps 6) → no card; of the 6 left,
1 is 6+ (Broady hard 7). 35 Handicap runs: 16 on ±1.5 (off the card, ruling handicap-line (a)), 19 at 3.5, of which 1
is 6+ (Seyboth Wild). Most Handicap candidates die earlier: the last match lands inside the ±h band (breaks the run).
| Family | State | Pool (≥ 8 unless noted) | Card only when |
|---|---|---|---|
| All comps | won / lost | every countable in-tier match (no floor) | always |
| Surface | won / lost on hard · clay · grass (`tournament-surfaces.json`) | matches on that surface | next match on that surface |
| Vs style (tour only) | won / lost vs one label = the **step 9 classifier's `playing-styles.json` `archetype_label`** (the Playing Styles / Profile label), opponent joined by name | matches vs that label | next opponent carries that exact label |
| Total games | over / under 21.5 · 22.5 · 23.5 (bo3), 36.5 · 38.5 · 40.5 (bo5) | clean matches of that best-of | next match has the same best-of (Slam main draw 5, else 3) |
| Handicap | covered −h (margin > h) / beaten by more than h, h = 1.5 · 3.5 · 5.5; in between breaks | clean matches of that best-of | same best-of; **card shows −3.5 only** (priority 3.5 > 5.5 > 1.5) |
| Set outcome | won / lost the opening set · won / lost the 2nd set · straight-sets win / loss · went the distance · failed to win a set | matches where that set / shape is decided | always |
| Set games | first set over / under 9.5 games | matches with set 1 decided (NextGen short sets out) | always |
"Clean" = known best-of, no super-tiebreak (≥ 10-game) set, no unfinished set — a retirement is never in Total games,
Handicap or a set shape; it counts in the match-result families and in an outcome whose set was decided.
A Retired record carries `complete: false` and no best-of (the winner's set count never types it: a Slam "6-3 6-2 ret"
or "6-3 3-6 6-4 ret" is not a best-of-3), so it is out of straight sets / went the distance / failed to win a set and
the line calibration; won / lost the opening or 2nd set and first-set games count when that set was completed.
**Lines are settled against the score, never a price:** Total games = both players' games vs the card's line;
Handicap = the player's game margin vs ±h. No source holds a closing price for those lines, so their ledgers print the
match-winner closes (Home / Away) and no P&L.

## Prices (Data 5) — the one Database join
- Home / Away = the site's one price join (`database.md`): `trDbJoinPx(name, career)` over `DatabaseTab.priceRows()`
  (database-yield rows + flagged retirements, **Pinnacle closing, else Bet365 closing**, retirements settled on the ATP
  result), done on the page (`priceBoard`, one call per player, each distinct match once). Book named in house style
  ("Pinnacle", "bet365") in the price cell's title; `—` when the join holds no row (an after-archive row's title is the
  shared `trPxAfterOf` reason). A failed join: the pop-up says "Prices unavailable" and the card's Avg price is `—`
  titled "Prices unavailable" (never the plain unpriced dash); it is tried again on the next render / show once 2 min
  have passed (step 13's shard retry). The generator writes no prices (the TEN-204 api-tennis `get_odds` snapshot pass is gone).
- **The Database join is the only price source** (founder card 939259c6, 2026-10-11): not our captured Pinnacle closes
  (`match-closes/`, ~42% of rows), not any card price. Coverage grows when the join does (TEN-406). **Test:** every priced
  ledger cell equals `trDbJoinPx` for that match; a match the join lacks is `—` even when a captured close exists.
- **Single source:** `streakRows()` feeds the card's Avg price (mean Home price of the priced rows, exact cents) and the
  ledger. Ledger (all comps / surface / vs style): flat 1u, win = price − 1, loss −1.00, each row rounded to 2 dp,
  total = sum of the rounded rows, yield = total ÷ priced (tenths of a percent, half away from zero: −22.75 → −22.8); "{n} priced" on every family; P&L, total in green / red,
  true minus. **Under a priced total, one line, grey 11, exactly:** "A run is selected for its results, so this total's
  sign is set by the run itself, not by the market." (founder `pnl`=keep, re-ruled round 2 — it stops a winning run's
  +P&L reading as an edge.)
- Coverage, measured 10 Oct 2026 (series.json 14:48Z, every card on the slate, already-played included): 54 of 601 rows
  priced — the archive ends 13 Sep 2026 (451 rows after it) and holds no Challenger match (312 Challenger rows).
  Re-measured 11 Oct (series.json 03:01Z, default view, 49 cards): 29 of 282 rows priced; all 52 unpriced ATP rows are
  dated after 13 Sep (0 unpriced inside the archive window) — the 2026 file's last founder drop-in (refresh-log 23 Sep,
  latestDate 2026-09-13), tennis-data.co.uk being unreachable from automation. Not a name / event join miss: the source
  carries China Open, Hangzhou, Japan Open, Shanghai and Chengdu every season (2025: 31 / 27 / 31 / 95 / 27 rows), so
  they price once the archive is refreshed; Laver Cup and Davis Cup rows (13 of the 52) it never carries.

## Display (night)
- **Claims = the reference's templates** (`Series.dc.html`, founder round 2 fix 2): "Won 8 straight" (all comps; the
  pop-up adds "across all competitions") · "Won 6 straight on Clay" · "Lost 4 straight vs Big Server + Complete
  Baseliner" · "Under 23.5 total games (best-of-3)" · "Won by more than 3.5 games — covered −3.5" (the losing side mirrors
  it: "Lost by more than 3.5 games — failed to cover +3.5", APPROVED by the founder, card 011f0d2d, 11 Oct — the file has
  no example; **Test:** "Fix 2" pins both sides; the file's "(best-of-3)" stays off the
  handicap card — standing ruling handicap-bestof (a), TEN-194 — and on the pop-up) · "Won the opening set" / "Won the
  2nd set" / … · "First set under 9.5 games". N = the card's (as-of-start) count.
- Cards (2b): `--card` + `--top-light`, no outline, radius 16, hover 1px `--edge-16`; avatar 44px — the player's photo by ID
  (`playerPhotoImg`, founder 2026-10-22) over the initials (`fhIni`, `--inner`, 1px `--edge-10`, white 700); name 16/800 + mono rank grey; count tile `--inner` + 1px `--edge-6` (the
  reference's), mono 30/800 white, caps "in a row" grey; claim 16/700, "type · direction" 12 grey (Winning run / Losing
  run / Neutral — a word, never green / red); three rows on `--edge-6` hairlines, caps label, mono value, Avg price 700.
- Filters: Type = tab row on a `--line` rule, active white 700 + 2px white underline, counts mono 11 grey; segments =
  darker track (`--inner`, padding 3, radius 10; selected `--selected` + 1px `--edge-16`, white 700; idle grey 600);
  checkbox unchecked 18% white edge, checked white fill + dark tick.
- Pop-up: `--card` + 1px `--edge-10`, radius 16, shadow `0 30px 80px` `--page` 55% (the ticket's black 55%, read through
  the token: no raw colour), scrim `--page` 62% + blur 3px from `--sf-side`; header = 58px `--inner` count tile, name
  18/800 + claim 18/600 soft, mono meta "#rank · {count} of {pool} matches (· best of N)"; close = the Match analysis
  close (34px, radius 9, 1px `--line`). Ledger head caps Hanken 10.5/700/0.10em on a 6% rule, rows on 6% hairlines,
  W / L mark mono 11/700 green / red; scores with en dashes; the Score track widens to the longest score.
  **Tiebreak points** print as "7–6(5)" (the loser's points) when api-tennis carries them — the decimal in
  `scores[].score_first/second` ("7.7" / "6.5"); `pointbypoint` is no fallback (its tiebreak game holds one empty
  point " - "). The feed omits them for whole events (measured 11 Oct: ATP Tokyo + Beijing 3–6 Oct, 8 sets; Challenger
  Villena 4–9 Oct, 19 sets, Jingshan 3–4 Oct, 2), so those rows print "7–6" — never invented (founder round 3 item 3).
- **Colour:** green / red only on the pop-up's marks, P&L and total; `--link` only on Clear; no blue fills, rings or
  outlines; surfaces neutral.

## Outcomes ledger (`series-outcomes.json`) — judged on the run as it stood at the start
Founder ruling, card 011f0d2d, 11 Oct (SUPERSEDES TEN-168 fix #3's post-match judging): **each outcome is judged against
the run before the next match was played, so a run that match broke is recorded as broken** — the same frozen-at-start
rule as the cards and pop-up (round 2 fix 1), so all three read one rule.
- **Which matches:** every FINISHED ATP / Challenger slate match (final status or a winner), both players — not only the
  one each player's card is built on (the old selection skipped a winner whose next round was already on the slate:
  1,849 of 3,440 player-matches judged, 7 Sep – 10 Oct).
- **Which runs:** `asOfStartStreaks` for that match (history cut strictly before it, every engine rule, relevance to
  that match, one per family) — `build-series.js judgeAtStart`. One row per (eventKey|player|family).
- **held** = the run's own condition in that match (`conditionHeld`): `true` extended it, `false` broke it, `null` not
  evaluable (walkover / awarded, set undecided, another surface / style / format) — null rows are out of the held / broken
  counts. `streakCount` = the run as it stood (the judged match is not in it). Rows carry `won` and `opponent`.
- **P&L (report only, the file holds no price):** the pop-up ledger's rule on the judged match — match-result families
  (all comps, surface, vs style), flat 1u on the player at the Database join's closing price (Pinnacle, else bet365):
  win = price − 1, loss −1.00; unpriced rows out of the total and the count. Line and set families have no P&L.
- **File:** `{ rule: "as-of-start", records }`, atomic tmp + rename, committed back by `pipeline.yml` after each build
  (only if changed), so the next build continues from it. Only the commit-back writes `series-outcomes.json`; the
  rebuild ships as the committed SEED `series-outcomes.rebuild.json`. Rebuilt FROM SCRATCH for 7 Sep onward by
  `tools/rebuild-series-outcomes.js` (the generator's own `judgeAtStart` on each player's real api-tennis history; one
  get_fixtures per 7 days + one per player; refuses a plan over `--max-calls`, default 600, without `--yes`; refuses
  to write if any player's history fails or any week's get_fixtures comes back empty / without `result` — an empty
  answer is never cached; cache files written tmp + rename, an unparseable one is refetched; judges each player as his
  history loads, ~850 full histories do not fit the heap together) — never patched from the day the rule changed.
- **Surface map = the pipeline's:** the tool loads `tournament-surfaces.json` through `bsp-pipeline.js
  loadTournamentSurfaceMap()` (refreshed from get_tournaments when over 30 days old, exactly as each CI build does — CI
  never commits the refresh back, so the committed copy is a fossil), and refuses to write if the map's `fetchedAt` is
  over 30 days old or any finished fixture's `tournament_key` is missing from it. Measured: on the committed 15 Jul map
  379 of 1,332 Challenger fixtures had no surface and Surface counted 396 rows (193 / 198 / 5) instead of 547.
- **Rebuild 11 Oct, 7 Sep – 10 Oct:** 853 calls (1 get_tournaments + 5 slates + 847 players), 1,720 finished
  fixtures, 4,663 rows: 2,272 held, 2,249 broken, 142 not evaluable (the post-match ledger: 4,142 rows, 3,915 held,
  1 broken, 226 not evaluable).
- **Seed migration (`build-series.js loadLedger`):** a `series-outcomes.json` without `rule: "as-of-start"` (the old
  post-match file — `{ records }` with no marker, an array, unreadable or missing) is discarded WHOLE and the seed
  `series-outcomes.rebuild.json` is loaded instead (its rows, nothing merged from the old file); the build then adds its
  finished slate matches by key (eventKey|player|family — same match = overwrite, never a double) and writes
  `series-outcomes.json` with the marker, which the unchanged commit-back pushes. A file that carries the marker is kept
  as-is and the seed is never read again. A missing or invalid seed (not marked) with an old-rule file THROWS — the build
  never starts an empty or partial ledger. Why a seed: the pipeline appends old-rule rows to main's
  `series-outcomes.json` every few ticks until this lands, so a commit writing that file never passes
  `tools/clobber-check.sh` / deploy-batch. At landing (11 Oct) the old-rule rows on main for 11 Oct are dropped by the
  migration; today's finished slate is re-judged under the new rule by the next build (the build judges the slate,
  `SLATE_START` = today UTC — a day missing from both the seed and the slate is never filled). Re-running the tool
  (default `--out` = the seed) is never needed to land.
- **Test:** `test-ten427-series.mjs` "Outcomes ledger": three wins then a loss → the all-comps run of 3 reads broken (the
  post-match rule wrote no row); seven straight-set wins then a 4–6 6–3 6–4 win → the same Set outcome / Handicap keys
  that read held under the post-match rule read broken (opening-set run 7, −3.5 run 7), all comps held at 7; a walkover
  → null. The committed seed carries `rule: "as-of-start"`, only rebuilt rows (`won` / `opponent`), 4,663 of them.
  "Outcomes ledger migration": an old-rule file (no-marker `{ records }`, array, unreadable, missing) loads exactly the
  seed's rows; a marked file keeps its rows with the seed present or missing; an old-rule file with a missing or
  unmarked seed throws. The page still paints no
  continued / broken summary (`test-series-outcome-summary.js`).

## Pro gating
Series is not Pro-locked in the rail (`app-shell.md`: Trading Report and Stennisfy Model only) and navigation is not
gated: a Free user sees the whole page.
