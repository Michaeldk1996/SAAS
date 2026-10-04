# Match analysis — Overview tab: founder rulings

Applies to the Match analysis modal's **Overview** tab in `bsp-consult-dashboard.html`: the career card,
its surface bars, the `THIS SEASON · BY SURFACE` rows, the year table and the pop-up behind a count.
Restored from CLAUDE.md before 011e3e20 (2026-09-21 trim); TEN-312 N13, founder-approved 2026-09-28.
Where this file conflicts with `modal-analysis.md` (TEN-312, 2026-09-28), that file wins; the conflicts
found at restore time are marked inline.

- **Overview tab — identity vs outcome (founder ruling 2026-08-01; colours TEN-380).** Two distinct axes coexist on the
  Overview modal tab. **(1) Identity is the column, never a hue:** both players' career-card surface bars are `--bar` on
  `--track` (6px, radius 3; the D2 gate greys a 5–9 bar), **never** by clay/hard/grass and never by value; the
  `THIS SEASON · BY SURFACE` rows carry no accent bar (`--card` + `--edge-6`, chevron `--link`). The surface % is 700
  `--text` (small sample grey). Panels `--edge-6`; a count cell hovers white 5%; the ATP chip `--selected` + `--line`,
  8.5/700 `--text-label`; the pop-up's figure tiles `--inner` with no edge (step 3 reference, TEN-380; supersedes the
  per-player bar colours and the 3px accent of D4). **Test:** `test-ten334-overview.mjs` "TEN-380".
  **(2) Outcome as a data fact:** the result square and the Sets figure of a pop-up row are
  coloured by outcome — canonical W / L green / red — and a `ret.` suffix carries the loss red (`w/o` stays
  neutral). A completed match's result is a data-fact verdict, not a two-player comparison, so it is a
  permitted green/red exception alongside LOST SERVE/BP markers (reverses the earlier "W/L neutral in modal"
  call). *Colour values (TEN-312 D1):* the old hex `#3dd68c` / `#e0616f` is retired; the modal takes these
  colours from the foundation tokens (TEN-376). *Walkovers (TEN-312 N2):* a `w/o` row is excluded
  from every count on the page (`modal-analysis.md` "Walkovers and retirements").
  **Test:** surface bars never change hue with the surface or the *value*; the W/L letter never stays neutral on a
  completed match.

- **Build (TEN-334, 2026-09-29): the tab is the design file's `overviewFor`** (DF L2969–3181, markup L1933–2076, pop-up
  L1484–1515) in its live variants: the tier control inside each career card (maSeg `ov`), the "Soft ink" card, the name
  inside the card. The file's review switchers (tvTabs / cvTabs / nvTabs) are not built. There is no inline drill and no
  nested match-stats block any more: a count (year × surface cell, a year's Total, a season row) opens the **pop-up** —
  every match behind it (maPopFrame + maMatchRowsHtml table rows) — and every pop-up row opens the one match stats sheet
  (DoD item 8). **Test:** `test-ten334-overview.mjs`.
- **What a count opens.** A count lists its matches only where career-history holds the matches the count is made of:
  every 2021+ row, and a pre-2021 row that keeps an exact ATP split (tour-level only). A pre-2021 all-tier aggregate shows
  its count, opens nothing, and says why on hover (its Challenger/ITF matches are in no archive we hold) — kept by founder
  ruling Q12 (2026-09-30): shown, not clickable, reason on hover.
  **Test:** a 2018 aggregate cell has no opener and the "Match list not on file" note; a 2019 ATP-only cell opens.
- **Pop-up figures.** Record and Win rate over the listed matches (walkovers out, N2; Win rate through the D2 gate);
  Avg price and "At 1u flat" over the priced rows only, prices in the R8 order (`meRowFromCareer` → `fhPickBook`),
  Challenger/ITF rows unpriced (N8); 1u through the gate on the priced n (Form's flat 1u rule). The sub-line names the
  priced count out of n; the 1u tooltip names the book split and prints `RET_SETTLE_NOTE`. A retirement counts and is
  marked "ret." after its set scores — loss red when the player retired, neutral when his opponent did (DF L1997).
  A count that opens nothing says why on hover (no player id, a pre-2021 aggregate, no tier split before 2021). **Test:** `test-ten334-overview.mjs` (N2, N8, R8, D2, retirement, sheet).

See also: `modal-analysis.md` "Overview career spine (N3)" (the Overview reads `careerByYear`) and "Match stats sheet —
every tab" (the sheet a pop-up row opens).
