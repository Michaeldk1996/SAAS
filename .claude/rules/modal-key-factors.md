# Match analysis — Key Factors tab: founder rulings

Applies to the Match analysis modal's **Key Factors** tab in `bsp-consult-dashboard.html`: the Stennisfy
Model card (`kfModelCard`), the Tournament card (`kfTourCard`) and `openEdgeModelFromMatch`.
Restored from CLAUDE.md before 011e3e20 (2026-09-21 trim); TEN-312 N13, founder-approved 2026-09-28.
Where this file conflicts with `modal-analysis.md` (TEN-312, 2026-09-28), that file wins (e.g. N10: the
"Dimension edge" card uses the 5-axis DNA data; walkovers never count on this tab).

- **Key Factors — Stennisfy Model card destination (founder ruling 2026-08-02).** The full-width
  **Stennisfy Model** card at the foot of the modal's **Key Factors** tab (`kfModelCard`) deep-links to
  the **top-level Stennisfy Model page for that match** — *"exactly to the stennisfy model."* There is
  **no** model tab inside the modal, so the card routes out via `openEdgeModelFromMatch(id)`, which
  **closes the analysis overlay first** (else the page switch hides behind it and reads as a dead click)
  then calls `openEdgeModel(id)`. The empty/unpriced state links too (the model page carries its own empty
  state). Card gets a button affordance (hover tint, focus ring, right-aligned `›` chevron).
  **Test:** the card is `role="button"`; clicking it closes the modal and lands on the `edge` page/nav for
  that exact match id — it does not stay static and does not route to Odds.

- **Key Factors — best-soft-book "vs fair" gap (founder ruling 2026-08-02).** In the Stennisfy Model card,
  the **Pinnacle** box shows its real `edgeVsPinnacle` "±pp vs fair" (same edge that drives the SHARP VALUE
  / NO VALUE flag). The **Best soft book** box shows **only the real price + bookmaker name; its "vs fair"
  line is em-dashed (`● —`)**, never a computed pp. Rationale (chosen as the most logical of "keep raw /
  em-dash"): best odds **can't be de-vigged** — the best price per side can come from different books, and
  even a single book's price still carries its overround — so `fairP − 1/softPx` would fold the book margin
  into the "edge", a systematically biased, apples-to-oranges number sitting next to Pinnacle's clean edge.
  Consistent with the standing "never show a false-precision number" rule.
  **Test:** exactly the two Pinnacle boxes carry "pp vs fair"; both soft-book boxes show `● —` while still
  printing the soft price and book name.

- **Key Factors — tournament tier in the title (founder ruling 2026-08-02).** The Tournament card title
  (`kfTourCard`, `.kf-tour-title`) renders **"City · TIER"** (e.g. `Rotterdam · ATP 500`). The tier is
  **not** in the feed (`tourBadge` is only "ATP") and there is **no other source** — *"just fix it with what
  you have."* Derive it locally: prefer the per-draw **`m.venue.category`**, else a lookup in the static
  **`TOURNAMENT_CATALOG`** by cleaned event name. When neither knows the event, render the **name alone** —
  never a fabricated tier.
  **Test:** a catalogued/venue-tagged event shows `Name · TIER`; an unknown event shows the name with no
  `·` tier suffix.

## Key factors tab — TEN-341 rebuild (2026-09-30)
- **Structure = the design file's variant `v.o`** (`keyFactorsFor`, DF L3184–3308; template DF L344–458): a 3×2 grid
  (Playing style · Recent form · Head to head / Dimension edge · Tournament · Odds), then the Weather strip and the
  Stennisfy Model card. The file's hidden header (tally chips + SAMPLE DATA, DF L334–343) and its review variants
  (`kf2For`, a–e) are not built. Every card is a `.seg` link to its tab (the Model card to the Model page).
  **Test:** `test-ten341-key-factors.mjs` "the tab" (order, links, no SAMPLE / variants).
- **Every card reads the tab it links to**, never the file's internal samples (which contradict its own tabs):
  Playing style = `ps2Edge` (the Playing style tab's cell, mirror, floor); Recent form = the Form tab's rows
  (`fhFormPlayer`, all surfaces, last 10, walkovers and the analysed match out) + the Overview tab's season row for
  "{Surface} {season}" (`careerByYear`, every level; "—" where the Overview prints "—"); Head to head = the H2H tab's
  meetings (`fhMeetings`, all surfaces, a walkover is no meeting, a retirement counts) and its level mix; Dimension edge =
  the five-axis DNA (`ps2DnaModel`, N10); Tournament = the Tournament tab's editions (`trEditionsOf`) and round words
  (`trRoundWords`); Odds = ONE book from the Odds tab's rows (`aOddsRowsOf`): Pinnacle, then Bet365, then the tab's order —
  its price, its vig-removed split and its own pre-match movement; Weather = the Weather tab's model at match time
  (`wxModel().at`) and its verdict line. **Test:** one check per card in `test-ten341-key-factors.mjs`.
- **Dimension edge:** the file's mini-radar geometry with the DNA's five axes (never the MCP six); the three widest gaps
  are ranked by the percentile gap and print the raw ratings (the Playing style tab's axis labels); each gap label
  carries that tab's axis note (population + n) on the shared tooltip. Below the 10-match floor no shape is drawn (Surface
  Elo, current and unfloored, still compares).
- **Style edge bar:** the file draws a gradient in player A's blue; built flat (no gradients) as the Playing style tab's
  split — A's share in A's colour, the rest the B track (D4). Ruled difference, not a divergence.
- **Model card "Now":** the Pinnacle box's Now is the Odds tab's Pinnacle row (chart shape included; a stale book has no
  Now); "Opened" stays `pinnacleOpen`. The move arrow compares the two prices as printed (2 dp).
- **Hold rate:** still a dash with `MA_HOLD_NO_N` and the visible note "n not published" (TEN-312 Q9 parks our own
  box-score rate). **Test:** the hold mutants in `tools/test-ten341-mutants.js`.
- **DoD 8:** the tab draws **no match rows and no tooltip of its own** — the gap-label notes and count notes use
  `data-aotip`, the hold dash `maTipHtml`; no native `title`. The old renderers (bento `ak*`, the 5-card row, the key panels,
  "Recent Results" rows, the MCP radar and `loadStyleRadar`) and their CSS are deleted.
- **Design gaps** (interim = the tabs' one-line pattern, no new design): G29 a card with no data or still loading;
  G30 the Weather strip indoor / unavailable / loading (dashes + the Weather tab's own words); G31 the Model card without a
  value snapshot (the card's empty line, still a link). Numbering provisional until the TEN-312 `design-gaps` document is
  updated.
- **Harness:** `tools/ten341-key-factors-capture.mjs` (design + build capture, `--theme source`; the design's own
  figures fed to the build for the fixture only). **Tests:** `test-ten341-key-factors.mjs` + `tools/test-ten341-mutants.js`.
