# Match analysis — Key Factors tab: founder rulings

Applies to the Match analysis modal's **Key Factors** tab: the boxes in `match-analysis-v2.js` (`maKeyFactorsV2`,
`kf*Box`), the shared data helpers left in `bsp-consult-dashboard.html` (`kfOddsBook`, `kfH2hTallies`, `kfNewsDay`,
`kfEnsure*`) and `openEdgeModelFromMatch`. Where this file conflicts with `modal-analysis.md`, that file wins (N10: the
DNA box uses the 5-axis DNA data; walkovers never count on this tab).

## Build (design 2026-11-23, `design_handoff_match_analysis_2026-11-23`, Key factors block `kf3For`)
- **One wrapping flex row**, gap 14, column max 1240; boxes `flex:1 1` basis full 100% · half `min(100%,440px)` · small
  `min(100%,304px)`. **Order = the tab order, decision weight first:** Stennisfy Model (full) → Odds | Playing style DNA
  (halves) → Market edge (full) → Recent form | Playing style | Tournament → Head to head | Progression | News → Weather at
  match time (full). **Test:** at 1440 the box sizes equal the prototype's (Model 312–313 tall, Odds / DNA 285, small boxes
  415 / 438); Market edge and Weather follow the data.
- **Every box is one clickable card** (`--ma2-card` + 1px 6% edge, r16, pad 24, gap 18, hover 22% edge): title 18/800, an
  optional "?" help, a grey 12.5 scope line, a 26px lifted `›`. The click opens the box's tab (the Model box: the Model page);
  nothing inside a box opens anything else (founder Q18). Players = ringed avatars (blue player one, white player two, 22px
  in small boxes, 40px in full boxes), the photo by ID over initials.
- **Every box reads the tab it opens**, never the prototype's mock figures: Odds = `kfOddsBook` (the card's one book: open,
  series, now, vig-free pair); DNA = `ps2DnaModel` (last 52 weeks); Market edge = `meStateFor` / `meModels` (today = the
  header price; the tab's gate); Recent form = `fhFormPlayer` on the Form tab's default view; Playing style = `ps2Record`;
  Tournament = `trMarketFor`, `trModelOf`, `trHoldHtml` and the one court-speed source `ma2CourtSpeed`; Head to head =
  `fhMeetings` + `fhHotModel`; Progression = `pgModel`; News = the News tab's own items (`newsItemsFor`); Weather =
  `wxModel` at the match hour.
- **Kept by earlier rulings until the founder answers (STEP1 report Q3):** no "Soft avg" column in the Odds box (Q12), no
  news dot (2026-10-04). The event hold rate rides in the Tournament scope line, where the design draws it (Q9).
- **Bet105 line prices** of the H2H hot lines (odds.md "Where") sit in each line's hover until the founder rules on a column.

## Stennisfy Model box
- **Destination (founder ruling 2026-08-02):** the box deep-links to the top-level Stennisfy Model page for that match via
  `openEdgeModelFromMatch(id)`, which closes the overlay first. The empty / unpriced state links too. **Test:** clicking the
  box closes the modal and lands on the `edge` page for that exact match id.
- **The box is the Model page's own figures** (founder brief 2026-11-23, item a; replaces the frozen `m.valueSnapshot`,
  the 0.5pp flag and the dashed best-soft gap of 2026-08-02 / Q11): `model-output.json` (else the draw store's copy) —
  the run's adjusted fair odd and probability, the page's verdict (`edgeVerdicts`: the run's flags — Sharp value ≥ 3% vs
  Pinnacle, Soft book value ≥ 5% — then prediction-market value), its best soft book (`edgeBestSoft`: never Pinnacle, the
  sharp tile's book or an exchange) and its sharp tile (`edgeSharp`: Pinnacle, else Bet365) with open → now and the move;
  every gap `edgeGapOf(prob, odd)` in pp. Scope line: surface · the run's net adjustment toward the player it favours.
  **Test:** for a board match the box's fair odds, verdict words, best-soft book and both gaps equal the Model page's
  Fair price & value card; a match with no ok run reads "The model has not published an adjusted fair price for this
  match yet." and still links.

## Tournament box
- **The event's one name** (`trName`) plus its tier when the tier differs from the name (`m.venue.category`, else
  `TOURNAMENT_CATALOG`; an unknown event shows the name alone), then the surface and the event hold rate, in the scope line.
  **Test:** "ATP Finals" never reads "ATP Finals · ATP Finals"; a catalogued 500 reads "Name · ATP 500".
- Court speed = `ma2CourtSpeed` (our own reading, the 3-band label, the knob on the 0–100 index); favourites win / return on
  favourites / return on underdogs from `tournament-market.json` through the event's gate; record here per player from the
  Tournament tab's model ("first appearance" / "no main-draw match" in the note line, founder Q25).

## Loads
- Opening Key factors loads what its boxes read (TEN-314 lazy rule): matrix + meeting shards, Form rows, H2H meetings, DNA,
  odds shard, event hold + tournament-market.json, the Progression rounds, the news feed and the news ticker, the Market edge
  shards, weather — never the MCP radar (N10). **Test:** `test-ten314-modal-frame.mjs` "lazy".
