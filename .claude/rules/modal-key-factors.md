# Match analysis — Key Factors tab: founder rulings

Applies to the Match analysis modal's **Key Factors** tab in `bsp-consult-dashboard.html` (the `kf*` block,
`buildKeyFactorsSection`) and `openEdgeModelFromMatch`. Where this file conflicts with `modal-analysis.md`, that file wins
(e.g. N10: the DNA box uses the 5-axis DNA data; walkovers never count on this tab).

- **Key Factors — Stennisfy Model card destination (founder ruling 2026-08-02).** The full-width
  **Stennisfy Model** card at the foot of the modal's **Key Factors** tab (`kfModelCard`) deep-links to
  the **top-level Stennisfy Model page for that match** — *"exactly to the stennisfy model."* There is
  **no** model tab inside the modal, so the card routes out via `openEdgeModelFromMatch(id)`, which
  **closes the analysis overlay first** (else the page switch hides behind it and reads as a dead click)
  then calls `openEdgeModel(id)`. The empty/unpriced state links too (the model page carries its own empty
  state). The box gets a button affordance (hover tint, focus ring, the header's `›`).
  **Test:** the card is `role="button"`; clicking it closes the modal and lands on the `edge` page/nav for
  that exact match id — it does not stay static and does not route to Odds.

- **Key Factors — best-soft-book gap (founder ruling 2026-08-02; founder TEN-380 Q11 keeps it through TEN-380).** In the Stennisfy
  Model box, the **Pinnacle** panel prints its real `edgeVsPinnacle` pp gap (the same edge that drives the SHARP VALUE / NO
  VALUE flag; no edge → no flag). The **Best soft** panel shows **only the real price + bookmaker name; its gap is a dash**,
  never a computed pp. Rationale: best odds **can't be de-vigged** — the best price per side can come from different books,
  and even a single book's price still carries its overround — so `fairP − 1/softPx` would fold the book margin into the
  "edge", a biased number next to Pinnacle's clean edge (the "never show a false-precision number" rule).
  **Test:** exactly the two Pinnacle panels carry a `±x.xpp` gap; both Best soft panels print "—" there while still printing
  the soft price and book name.

- **Key Factors — tournament tier in the title (founder ruling 2026-08-02).** The Tournament card title
  (`kfTourCard`, `.kf-tour-title`) renders **"City · TIER"** (e.g. `Rotterdam · ATP 500`). The tier is
  **not** in the feed (`tourBadge` is only "ATP") and there is **no other source** — *"just fix it with what
  you have."* Derive it locally: prefer the per-draw **`m.venue.category`**, else a lookup in the static
  **`TOURNAMENT_CATALOG`** by cleaned event name. When neither knows the event, render the **name alone** —
  never a fabricated tier.
  **Test:** a catalogued/venue-tagged event shows `Name · TIER`; an unknown event shows the name with no
  `·` tier suffix.

## Key factors tab — TEN-380 rebuild (founder package step 3, locked 2026-10-03)
- **Structure = the locked reference** (`OFFICIAL VERSION 1.html`, measured at 1512 px night + day): ONE 6-column grid, gap 14,
  eleven tiles in this order and span — Playing style (2) · Recent form (2) · Tournament (2) / Odds · Match winner (3) ·
  Playing style DNA (3) / Head to head (2) · Progression (2) · News (2) / Stennisfy Model (6) · Market edge (6) · Weather (6).
  No extra margins, no review chips or variants. **Test:** `test-ten341-key-factors.mjs` "the tab" (order, spans, links).
- **Every tile is a clickable tile** (`--card` + 1px `--edge-7`, hover `--tile-hover` + `--edge-16`, no transition) whose click
  lands on its tab (DNA → Playing style; the Model → the Model page, above). Nothing inside a tile opens anything else
  (founder Q18). **Header = one line:** caps title `flex:none` (never clipped), Plex 11 meta that truncates, a grey `›`.
  Inner figure boxes are panels (`--card` + 1px `--edge-6`); chips (Today / Band, the Model flag) are `--inner`, no edge;
  Derived lines' two most covered in-band rows are `--wash-4`, no edge. **Test:** the tab check (title `flex:none`, meta
  ellipsis) + the per-box checks.
- **Every box reads the tab it links to**, never the reference's sample figures: Playing style = `ps2Record` (each player vs
  the OPPONENT's archetype, walkovers out) + his 3 latest of those meetings; Recent form = the Form tab's default rows
  (`fhFormPlayer` on today's surface, last 10 — founder Q16, founder TEN-380 Q13: meta "Last 10 · <Surface>"), its v market /
  expected wins (FH_THIN gate) and its collapsed hot lines; Tournament = the round words, the hold cell (`trHoldHtml`,
  founder Q9), `m.courtSpeed` (abstract speed + N4 category, the knob on the 0–100 index — founder TEN-380 Q14, no "usual"),
  tournament-market.json (`trMarketFor`, gated on n; "±x.xpp vs tour avg") and the Tournament tab's record model
  (`trModelOf`; "first appearance" with no history — founder Q25); Odds = **the card's book** (founder TEN-380 review
  item 4: its Open and Now are the match card's and the Match Winner tile's; the box order Pinnacle → Bet365 → the Odds tab's
  order — founder Q17 — only for a match the card state does not cover): open, sparkline (line only), now, vig-free Fair; **no Soft avg** (founder TEN-380 Q12); DNA =
  `ps2DnaModel` percentiles on `--viz-lead` (blue: `#aSectionKey` makes `--bar` white for the other boxes), both players
  per axis the leader's bar solid `--viz-lead`, the trailer's `--viz-second` (45%) — founder ruling 8, TEN-380 Q3; H2H = `fhMeetings` (walkovers out, retirements in), the H2H tab's set / tiebreak / decider
  tallies + today's surface, its hot lines; Progression = `pgModel` (Pressure points kept — founder TEN-380 Q8, no draw avg — Q7);
  News = the News tab's per-player articles in the 5-day window, one shared article tagged BOTH; Model = the value snapshot
  + the Odds tab's Pinnacle row + the Model page's stage-2 net adjustment (`modelOutput`); Market edge = `meModels`
  (today's band tiles + derived lines; Key factors triggers the tab's loads); Weather = `wxModel` at match time + the court
  speed row. Both players' names and figures white everywhere; only bars split leader / trailer (founder ruling 8). **Test:** one or more checks per box in
  `test-ten341-key-factors.mjs`; the mutants in `tools/test-ten341-mutants.js`.
- **Empty states fabricate nothing:** a box with no data keeps its structure with "—" and the tab's own words (0 H2H meetings:
  0 · 0 with every tally "—"; no value snapshot: dashes + "The model has not published an adjusted fair price for this match
  yet.", still a link). A genuine zero prints 0. **Test:** the H2H empty check, the Model empty check.
- **Hold rate (founder Q9, 2026-09-30):** the event hold rate from our own box scores over every edition on file, n = service
  games — the Tournament tab's own cell (`trHoldHtml`); the tooltip always states n; no gate. **Test:** "Q9" + its mutants.
- **Loads:** opening Key factors loads what its boxes read (TEN-314 lazy rule): matrix + meeting shards, Form rows, H2H
  meetings, DNA, odds shard, event hold + tournament-market.json, the Progression rounds, the news feed, the Market edge
  shards, weather — never the MCP radar (N10) and never the Overview's season rows. **Test:** `test-ten314-modal-frame.mjs`
  "lazy".
- **DoD 8:** no match-row list, no sheet and no tooltip of its own (data-aotip / `maTipHtml` only); no native `title`. The
  old renderers (radar, strip, season record, style sentence) are deleted.
- **Harness:** `tools/ten341-key-factors-capture.mjs`. **Tests:** `test-ten341-key-factors.mjs` + `tools/test-ten341-mutants.js`.
