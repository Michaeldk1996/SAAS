# Match analysis — Form and H2H tabs: founder rulings

Applies to the TEN-263 block in `bsp-consult-dashboard.html` (`fh*` functions), to
`build-match-closes.js`, and to the H2H meeting list the pipeline builds (`fetchH2H`,
`buildH2HMatchList` in `bsp-pipeline.js`). Tests: `test-ten263.mjs`.

## Prices (rulings 2026-09-23 and 2026-09-24)
- **Order.** Every price on both tabs goes through `fhPickBook` in the order
  `FH_BOOK_ORDER = ['Ptd','Pcap','Btd','Bcap']`: Pinnacle close from Tennis-Data → Pinnacle
  close from our capture → Bet365 Tennis-Data → Bet365 captured → a dash.
  **Test:** reversing any adjacent pair turns a test red.
- **One book and one source per match**, both sides ≥ 1.01, else fall through.
  **Test:** no priced row carries sides from two slots.
- **A captured close is the last tick at or before the oddspapi actual start** (`trueStart`).
  A capture without an actual start is dropped. **Test:** an in-play tick is never the close.
- **api-tennis closing prices (TEN-269)** join as a **5th, fallback-only** slot. They move up
  only after the TEN-269 validation shows they agree with Tennis-Data on overlapping
  matches, reported with the agreement rate and its denominator. api-tennis **opening**
  prices are never shown as closing prices.
- **Never `m.bestOdds`** on these tabs. **Test:** the block does not read it.

## Display constants (ruling 2026-09-24): each is one constant, and each is a test
- **a** `FH_HOT_MIN_ELIGIBLE = 3`: a hot line needs at least 3 eligible matches.
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

## H2H tab: Elo and labels (rulings 2026-09-24, H2H pixel pass)
- **H2H meeting rows carry the opponent's Elo** on the Form basis above (overall, strictly before the
  match day, at most 7 days old; `ELO —` otherwise), as a plain grey number after the name. The level
  tag (ATP / CH / ITF) sits in every group header next to the surface, never after the name. A Bet365
  row carries the "B" marker in the Home cell. **Test:** no level badge after the name; every group
  header ends with its level.
- **Price range header:** any Bet365 figure in the section, today's price included, reads "Pinnacle,
  Bet365 where missing (…)". **Never a single book name over mixed data.** **Test:** Pinnacle meetings
  + a Bet365 today price → the mixed wording.
- **Hot-line dots on H2H use fixed columns** (1/max(n, 9) of the grid, right-aligned), so 4 meetings sit
  where 9 would. Form keeps stretched columns.
- **Long names:** ellipsis, full name on hover (Form and H2H rows).

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

## H2H covers all of men's singles (ruling 2026-09-24)
- The pipeline keeps **ATP, Challenger and ITF singles** (`H2H_EVENT_TYPES`). Exhibitions,
  doubles, juniors, UTR and women's events stay out. **Test:** the set holds exactly these three
  singles types.
- **Team events count exactly as the ATP counts them in its official win-loss record** (ruling
  2026-09-25, TEN-273: "do as the ATP"). Davis Cup, ATP Cup, United Cup, Laver Cup, the Olympics
  and the Next Gen Finals count. Hopman Cup (ITF-sanctioned, mixed) and exhibitions (UTS, Six Kings
  Slam, Kooyong, Mubadala…) never do, even when api-tennis tags them "Atp Singles". One list,
  applied in `fetchH2H` (`H2H_NOT_ATP_RECORD`) and in the career-history join
  (`FH_H2H_NOT_ATP_RECORD`). **Test:** a Hopman Cup meeting never enters the list or the record;
  a Laver Cup or United Cup meeting does; the two lists are identical.
- **Every meeting row carries `level`** (ATP / CH / ITF). **A record that includes Challenger or
  ITF meetings says so** wherever it is shown: the match card, the Key factors H2H panel and
  block, the insight sentence ("· incl. 1 CH, 2 ITF"), and the Form/H2H tab's row tags.
  **Test:** a 3–1 built on ITF meetings never renders without its level mix.
- **A match never counts in its own H2H record** (ruling 2026-09-24), on the cards, in the
  model or on the H2H page. The pipeline drops the fixture's own eventKey at every H2H build
  site (`h2hExcludeOwn`) and again in a final pass over the board before `matches.json` is
  written (`stripOwnFixtureFromH2H`; the model reads that file). **Test:** a finished board
  match whose own eventKey is in `h2h.matches` fails, and the record is recomputed without it.
- **Who won a meeting is decided by player key, never surname** (ruling 2026-09-24):
  `h2hP1WasFirst` compares `first_player_key` / `second_player_key` with p1's key; a row that
  carries neither is not counted. **Test:** two same-surname players (Zhizhen Zhang 590, Ze
  Zhang) orient by key, and `summarizeH2H` / `buildH2HMatchList` never call `lastName`.
- The tab's meeting list = api-tennis H2H ∪ the career-history eventKey join. A shared
  eventKey counts only when both rows carry the same date and opposite results. The levels
  that count are one constant, `FH_H2H_LEVELS`.

## Market-edge is a pipeline output (ruling 2026-09-24)
- `market-edge/` and `market-edge-index.json` are rebuilt by `build-market-edge.js` in
  **every pipeline run**. They are never hand-built or hand-edited: any edit is overwritten on
  the next run. The committed copy is only the floor published if the builder fails.
- Inputs: `odds-archive/*.csv` (drop-in refresh), `player-profiles.json` (pipeline),
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
