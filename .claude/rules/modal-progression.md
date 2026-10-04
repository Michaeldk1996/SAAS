# Match analysis — Progression tab (TEN-339, founder brief 2026-09-28; DoD item 8 2026-09-29)

Applies to the Progression tab of the Match analysis modal (`buildMatchProgressionSection` and the `pg*` block in
`bsp-consult-dashboard.html`). `modal-analysis.md` wins where the two conflict.

## Build
- **The design file wins** (`Match Analysis Progression v1.dc.html` `progressionFor`, DF L3936–4168, template L668–839),
  in the variants it renders: palette A · Uniform, road cards A · Soft ink, road C · Timeline, THIS MATCH C · Raised ink,
  metric chips B · Soft ink, heat cards B · 3 per row. The file's SAMPLE DATA chip is not built; the FACING row is built
  as ruled below (founder Q7 / ruling 12, TEN-380); the facing round is the match's own `tournamentRound`.
- **The tab is listed in every round.** The R1 state is the file's empty state ("No progression yet", DF L681), not a
  hidden tab. **Test:** `test-ten339-progression.mjs` (R1 empty state).
- **DoD 8:** the tab draws no match-row list and no pop-up tooltip; its hover text is the file's native `title`. Every match
  cell (road card or heat cell with a value) opens the shared sheet through `maRowOnclick`, with the draw's round label.

## Data
- **Road and per-round figures = career-history** (`career-history/{key}.json`) rows at this event (same cleaned tournament
  name, within 20 days before the match), **main draw only** (N7), **this match excluded** (by event key, else opponent).
  Set scores = career-history `sets`, player-oriented; **never** `tournament-progression.json` `resultDisplay` (feed order).
- **Figures = the setstats/{ek} whole-match box score through the house formulas** (`HouseRatings`: the 6-part Serve rating,
  the 4-term Return rating, TEN-327); every rate rebuilt from its count; Dominance = RPW% ÷ (100 − SPW%); Pressure =
  (BP saved + converted) ÷ all BPs played; Winners % = winners ÷ total points; W/UE needs a UE count > 0. A match with no
  box score on file is dashed, never filled from another source.
- **Closes** through the Form/H2H picker (`meRowFromCareer` → `fhCloseFor` → `fhPickBook`, `FH_BOOK_ORDER`).
- **DRAW avg = `tournament-progression.json`, active ATP events only**: per round, the mean over every player who played
  that round (both players of every match, DF L4167), same formulas from the file's raw fields. The file carries no
  first-serve counts, so the draw's 1st serve % — and the 1st-in term of its Serve rating — is the feed's whole-number
  rate, and its Winners % may come from the pipeline's ATP_Entry OCR fallback (`wueSource`). Any other event: "—" with the
  reason in the tooltip. The modal waits on the boot fetch (`_tpLoad`, a rejection read as "no file"), never refetches.
  **Test:** DRAW avg check.
- Opponent style = `playing-styles.json` `archetype_label`; none → "—" with a tooltip.

## Gate and counts (D2)
- **Every rate goes through `tourxSampleGate` on its own count**: a per-round rate on n 1–4 prints the count ("2/4"),
  5–9 is greyed with the note on hover and the footnote "Grey = small sample (5–9)" under the cards; 10+ full.
- **AVG** = the rate over the summed counts (Dominance and W/UE over their summed counts; a rating = the mean of its
  rounds); "(n)" = rounds with a value when fewer than the rounds shown (DF L4101).
- **DRAW avg rates** are gated on the player-rounds they average (n < 5 → "—", 5–9 grey); a draw mean has no count to show.
- **DRAW avg of Pressure points is always "—"** (founder Q7, 2026-09-30, TEN-312 6c9a9e55), with the tooltip "Always 50%
  by construction: the two players' shares of a match's break points add up to 100%." **Test:** the DRAW row's Pressure
  cell reads "—" with that tooltip on every round; mutation: computing it again shows 50.0%.

## Road
- A round with no row is a **bye only at the draw's first round**, only from a history that loaded, never where the active
  draw's own file shows the player in that round or its bye arithmetic fails (`progressionByesCredible`). Any other hole is
  "no record of this round" (DESIGN GAP G13). **Test:** bye check.
- **This match** is found by event key when both carry one, else by the opponent's name on the same day (a surname alone
  would drop an earlier round against a namesake). **A history that failed to load is not an empty one**: no bye is
  claimed from it, and the next open retries it.
- The draw's first round = the earliest round either player's history shows, never later than an ATP main draw's R32
  (1/16-finals) — R128 at a Slam — and as early as the active draw's own "Rn" rounds say; rounds before the QF are numbered
  R1…R4 from it (founder Q28, 2026-09-30: numbered from the draw's real first round). Known limit: a non-active 48/56/96
  draw where both players had a first-round bye numbers one round low. The round wording ("Round of 16" versus the
  file's "Second round", Q10) has no ruling: the live wording stays.
- **A walkover** is listed "w/o" and counted nowhere (N2): not in the W–L, not in the sets, no figures.
- The unplayed rounds' blurred placeholders carry **no numbers** (dashes where the file prints sample values).

## Display (TEN-380, step 3 reference `OFFICIAL VERSION 1.html`)
- **Road cards are clickable tiles:** `--card` + 1px `--edge-7`, hover `--tile-hover` + `--edge-16`; the highlighted round
  `--edge-24`. **THIS MATCH** = `--card` + `--edge-24`, its label `--text` (blue text = links only; the reference's `--link`
  is a residual). The facing round's axis chip has a `--bar-2` edge and `--text` label; unreached rounds `--edge-6`; the axis
  line `--viz-guide`. Opponent style, the non-favourite price and player B's name line are `--text-label`; the card rule `--line`.
- **Metrics section:** a `--line` divider, then the 20/800 title "Metrics · round by round" with its 12.5 sub-line; the nine
  chips on **one** sideways-scrolling row (`--inner` + `--edge-10`, 11/700, padding 6 9, gap 5).
- **Heat cards** `--card` + `--edge-6`; the better cell white 7%, the other white 3%; no name accent; the DRAW row upright.
- **Facing row (founder Q7 / ruling 12, TEN-380):** above the title, a Darker track (`--card` + 1px `--edge-6`, r9, pad 3,
  gap 3; selected `--inner` + 1px `--edge-10`, 12/700 `--text`; idle 12/600 `--text-label`). It lists **only the rounds
  already played**, each "Rn · {A's opponent} / {B's opponent}" from both players' results at this event (a click highlights
  that round), then **this match's round as the selected segment**. No future round, no projected opponent. "Bye" is written
  only when the draw data lists one — the feed never does (a bye is inferred), so such a round prints "—". A first-round
  match shows the current segment alone above the empty state. **Test:** `test-ten339-progression.mjs` "Q7" (mutations: a
  future round on the track, the current round not selected, a bye written from inference, the row missing in R1).
- **Founder Q8:** Pressure points stays the ninth metric.
- **Test:** `test-ten339-progression.mjs` "TEN-380" (mutation: a tile back on `--inner`, the accent bar back, chips wrapping).

## Design gaps (TEN-312 `design-gaps`)
- G12 loading line · G13 a round with no record · G14 THIS MATCH on a live/finished match prints nothing in the file's
  "not played" slot · G15 the small-sample footnote.
