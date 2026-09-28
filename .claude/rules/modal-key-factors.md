# Match analysis — Key Factors tab: founder rulings

Applies to the Match analysis modal's **Key Factors** tab in `bsp-consult-dashboard.html`: the Stennisfy
Model card (`akModelBlock`), the Tournament card (`akTournamentBlock`) and `openEdgeModelFromMatch`.
Restored from CLAUDE.md before 011e3e20 (2026-09-21 trim); TEN-312 N13, founder-approved 2026-09-28.
Where this file conflicts with `modal-analysis.md` (TEN-312, 2026-09-28), that file wins (e.g. N10: the
"Dimension edge" card uses the 5-axis DNA data; walkovers never count on this tab).

- **Key Factors — Stennisfy Model card destination (founder ruling 2026-08-02).** The full-width
  **Stennisfy Model** card at the foot of the modal's **Key Factors** tab (`akModelBlock`) deep-links to
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
  (`akTournamentBlock`, `.akt-title`) renders **"City · TIER"** (e.g. `Rotterdam · ATP 500`). The tier is
  **not** in the feed (`tourBadge` is only "ATP") and there is **no other source** — *"just fix it with what
  you have."* Derive it locally: prefer the per-draw **`m.venue.category`**, else a lookup in the static
  **`TOURNAMENT_CATALOG`** by cleaned event name. When neither knows the event, render the **name alone** —
  never a fabricated tier.
  **Test:** a catalogued/venue-tagged event shows `Name · TIER`; an unknown event shows the name with no
  `·` tier suffix.
