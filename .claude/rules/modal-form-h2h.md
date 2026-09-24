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

## H2H covers all of men's singles (ruling 2026-09-24)
- The pipeline keeps **ATP, Challenger and ITF singles** (`H2H_EVENT_TYPES`). Exhibitions,
  doubles, juniors, UTR and women's events stay out. **Test:** the set holds exactly these three
  singles types.
- **Every meeting row carries `level`** (ATP / CH / ITF). **A record that includes Challenger or
  ITF meetings says so** wherever it is shown: the match card, the Key factors H2H panel and
  block, the insight sentence ("· incl. 1 CH, 2 ITF"), and the Form/H2H tab's row tags.
  **Test:** a 3–1 built on ITF meetings never renders without its level mix.
- The tab's meeting list = api-tennis H2H ∪ the career-history eventKey join. A shared
  eventKey counts only when both rows carry the same date and opposite results. The levels
  that count are one constant, `FH_H2H_LEVELS`.

## Market-edge is a pipeline output (ruling 2026-09-24)
- `market-edge/` and `market-edge-index.json` are rebuilt by `build-market-edge.js` in
  **every pipeline run**. They are never hand-built or hand-edited: any edit is overwritten on
  the next run. The committed copy is only the floor published if the builder fails.
- Inputs: `odds-archive/*.csv` (drop-in refresh), `player-profiles.json` (pipeline),
  `court-speed-map.json`, `playing-styles.json`.

## Alarms (rulings 2026-09-23 / 2026-09-24): two separate workflows, both go red
- **Tennis-Data staleness** (`odds-archive-staleness.yml`): red when the newest archive row
  is more than 7 days old. The threshold is not ruled final; don't change it without a ruling.
- **Capture freshness** (`odds-capture-freshness.yml`): red when no book in the board's captured
  series (`matches.json` `oddsMovement`) has ticked for 24 h. 24 h is a starting default. It
  also fires on quiet boards with nothing to price; the message prints the upcoming count.
