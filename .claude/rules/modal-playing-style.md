# Match analysis — Playing style tab (TEN-340, founder brief 2026-09-28; DoD item 8 2026-09-29)

Applies to the Playing style tab of the Match analysis modal (`buildStyleSection` and the `ps2*` block in
`bsp-consult-dashboard.html`). `modal-analysis.md` wins where the two conflict.

## Build
- **The design file wins** (`Match Analysis Progression v1.dc.html` `ps2For`, DF L3553–3685, template L495–664), in the
  variant it renders: palette `cur` (both players white; blue only for links, today's surface and an open box), personal
  record variant F "tug from centre", view fixed to `ratings`. The file's review switchers (`psPal`, `psPrVar`, the Style
  dimensions view) and its SAMPLE chip are **not built**. **Test:** `test-ten340-playing-style.mjs` (no sample data).
- Order: Style matchup card → Personal record vs this style → Career meetings vs this style (only for an open box) →
  Playing style DNA card with the "Show player profile" drop-down.
- **DoD 8:** the meeting rows are the shared rows (`maMatchRowsHtml`, table variant with the file's tournament group
  headers — `groupPad`, `cellPad`, `rowLine` are parameters, never a second renderer); every row opens the shared sheet
  (`maRowOnclick`: the player's career history by date + opponent, else the row's own score and prices). Every percentile
  tooltip is the modal's one tooltip (`data-aotip`). The pre-TEN-340 renderers (`styleEdgeHtml`, `stylePersonalCard`,
  `styleVsArchetypeCard`, `psvListHtml`, `styleDnaRadarHtml`, `styleSurfaceTableHtml`, …) are **deleted**.
  **Test:** DoD 8 check.

## Data
- **Archetypes** = `playing-styles.json` `archetype_label` (+ `variety` → "+ Variety Player"). Until the file is in memory
  the tab shows its one-line loading state, never "Not yet classified" (G17).
- **Style matchup** = `matchup-matrix.json`, the cell in **p1's direction** (`psCellFor`), `n` = tour meetings. Lean: the
  leader's points over 50; under 2 points reads "Effectively a coin-flip on style alone". Surface tiles =
  `matrixBySurface` for Clay / Hard / Grass, `n` = that surface's meetings; a cell below the matrix floor (20) shows "—"
  with its n. Today's surface = the match's (indoor → Hard). The archetype-matrix % is **not gated** (its own floor).
- **Mirror matchup** (same archetype, e.g. Sinner v Alcaraz, both All Court Elite): 50% / 50%, the diagonal's n, "Style
  gives neither player an edge", **no surface tiles** (DESIGN GAP G5). Each player's "Matrix avg" is 50%.
  **Test:** mirror check.
- **Personal record** = the player's `style-meetings/{slug}.json` rows vs the **opponent's** archetype, all surfaces,
  career. W–L, n, the tug and "Show career meetings (n)" all count the same rows. "Matrix avg" = the matrix cell in this
  player's direction; the deviation = win % − avg (green / red: the Playing Styles matchup exception).
- **Walkovers (N2):** a "W/O" row is not a match — out of the W–L, the n, the list and the counts. An in-match retirement
  counts; its unfinished set is out of the sets tally ("6-4 3-1 RET" → 1 - 0, "6-4, 3-1 ret."). The source is fixed too:
  `tools/build-matchup-matrix.js` drops TML walkovers from every cell, record and shard from its next run (the local
  styles bot, daily; measured 2026-09-29: 413 TML W/O rows in the window, 190 shard rows, 14 of 64 cells move ≤ 1 pt,
  162 of 1,777 records change). **Test:** personal-record check + the builder check.
- **Meeting rows:** the file's 8 rows under "Showing 8 of N", grouped by tournament edition, newest first; the rest behind
  "Show N more matches" (DESIGN GAP G18: the file draws no way to the rest; the control is its Form list foot, DF L1146,
  worded as DF L3871). H / A = the row's closing prices (the shard's book: Pinnacle, Bet365 where missing; one book per
  row), "—" where none. No price figure is summed here, so no retirement note applies.
- **DNA** = `dna-apitennis-ratings.json` (TEN-319, rebuilt twice daily). Axes Serve, Return, Under pressure (copied from
  surface-ratings, TEN-328), Dominance ratio, Surface Elo. Windows **"Last 52 weeks" | "Since Mar 2024"** — never
  "Career" (D6). **Surface Elo is the current rating on both views**, labelled "current" (the radar label "Surface Elo ·
  current"; the profile row prints "current" in its Δ slot). Percentiles are the file's **true percentiles**; every axis's
  tooltip states each player's raw value and percentile, and the population **and its n** (`_meta.percentiles` /
  `eloPercentiles`). On the since view, Under pressure is surface-ratings **career (2010–)** — its only other scope — and
  the tooltip says so. **Test:** DNA checks.
- **Δ vs 2024–now** only on the 52-week view; none on Elo, none on Under pressure (its baseline is the career scope). A
  player with fewer than 10 matches in the window on the match's surface draws **no shape** and the card says why under
  the file's foot (DESIGN GAP G19); no rating on file → the same line.

## Colour
- **Both players white** (the file's `cur` palette): A's radar solid + 0.12 fill, B's dashed at 0.85; the matchup bar's B
  side at 0.30 white. Tokens `--ma-s-e7e9ee-120 / -300 / -850` (Night; the Day palette keeps the alpha whites).
- **The profile's bars and values are neutral**: the file tones the leading value white and dims the other's bar to 30%;
  the non-negotiable "never highlight the better stat" wins — both bars full white, both values white. Parked for the
  end-of-queue card (open question). **Test:** both-players-white check.

## Design gaps (TEN-312 `design-gaps`)
- G5 mirror matchup · G17 an unclassified player, a matrix cell below its floor, the loading lines · G18 "Show N more
  matches" · G19 a DNA shape withheld (under the floor / no rating) and the DNA loading line.
