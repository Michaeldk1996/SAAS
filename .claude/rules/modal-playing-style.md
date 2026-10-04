# Match analysis — Playing style tab (TEN-340, founder brief 2026-09-28; DoD item 8 2026-09-29)

Applies to the Playing style tab of the Match analysis modal (`buildStyleSection` and the `ps2*` block in
`bsp-consult-dashboard.html`). `modal-analysis.md` wins where the two conflict.

## Build
- **The design file wins** (`Match Analysis Progression v1.dc.html` `ps2For`, DF L3553–3685, template L495–664), in the
  variant it renders: palette `cur` (both players white; blue only for links, today's surface and an open box), personal
  record variant F "tug from centre", view fixed to `ratings`. The file's review switchers (`psPal`, `psPrVar`, the Style
  dimensions view) and its SAMPLE chip are **not built**. **Test:** `test-ten340-playing-style.mjs` (no sample data).
- **Order (TEN-380, the reference):** Playing style DNA card (with the "Show player profile" drop-down) → Personal record vs
  this style, one column per player: the record box, then **that player's career meetings under it, always shown** →
  Style matchup, **collapsed by default** behind its head (caps "Style matchup" + the headline, the compact bar, the
  archetype labels with the tour n) and "Leans … · Show matchup ▾"; open = the archetype header, the big bar, the Leans pill,
  the surface tiles. Cards 22 px apart, each `--card` + 1px `--edge-6`, radius 16; caps labels `--text-label`.
  **Test:** `test-ten340-playing-style.mjs` "TEN-380: reference order…".
- **DoD 8:** the meeting rows are the shared rows (`maMatchRowsHtml`, table variant with the file's tournament group
  headers — `groupPad`, `cellPad`, `rowLine` are parameters, never a second renderer); every row opens the shared sheet
  (`maRowOnclick`: the player's career history by date + opponent, else the row's own score and prices). Every percentile
  tooltip is the modal's one tooltip (`data-aotip`). The pre-TEN-340 renderers (`styleEdgeHtml`, `stylePersonalCard`,
  `styleVsArchetypeCard`, `psvListHtml`, `styleDnaRadarHtml`, `styleSurfaceTableHtml`, …) are **deleted**.
  **Test:** DoD 8 check.

## Data
- **Archetypes** = `playing-styles.json` `archetype_label` (+ `variety` → "+ Variety Player"). Until the file is in memory
  the tab shows its one-line loading state, never "Not yet classified" (G29).
- **Style matchup** = `matchup-matrix.json`, the cell in **p1's direction** (`psCellFor`), `n` = tour meetings. Lean: the
  leader's points over 50; under 2 points reads "Effectively a coin-flip on style alone". Surface tiles =
  `matrixBySurface` for Clay / Hard / Grass, `n` = that surface's meetings; a cell below the matrix floor (20) shows "—"
  with its n. Today's surface = the match's (indoor → Hard). The archetype-matrix % is **not gated** (its own floor).
- **Mirror matchup** (same archetype, e.g. Sinner v Alcaraz, both All Court Elite): 50% / 50%, the diagonal's n, "Style
  gives neither player an edge", **no surface tiles** (DESIGN GAP G5). Each player's "Matrix avg" is 50%.
  **Test:** mirror check.
- **Personal record** = the player's `style-meetings/{slug}.json` rows vs the **opponent's** archetype, all surfaces,
  career. W–L, n, the tug and "Showing k of n" all count the same rows (n counts classified opponents only: its hover says so). "Matrix avg" = the matrix cell in this
  player's direction; the deviation = win % − avg (green / red: the Playing Styles matchup exception).
- **Walkovers (N2):** a "W/O" row is not a match — out of the W–L, the n, the list and the counts. An in-match retirement
  counts; its unfinished set is out of the sets tally ("6-4 3-1 RET" → 1 - 0, "6-4, 3-1 ret."). The source is fixed too:
  `tools/build-matchup-matrix.js` drops TML walkovers from every cell, record and shard from its next run (the local
  styles bot, daily; measured 2026-09-29: 413 TML W/O rows in the window, 190 shard rows, 14 of 64 cells move ≤ 1 pt,
  162 of 1,777 records change). **Test:** personal-record check + the builder check.
- **Meeting rows:** the reference's 6 rows under "Career meetings · Showing 6 of N" (TEN-380), grouped by tournament
  edition, newest first; the rest behind "Show N more matches" (`--text`; DESIGN GAP G30, **accepted by the founder** Q15,
  2026-09-30). Scores `--text-label`, H `--text-soft`. A box with no list says why in one line (loading, not classified,
  no meetings). H / A = the row's closing prices (the shard's book: Pinnacle, Bet365 where missing; one book per
  row), "—" where none. No price figure is summed here, so no retirement note applies.
- **DNA** = `dna-apitennis-ratings.json` (TEN-319, rebuilt twice daily). Axes Serve, Return, Under pressure (copied from
  surface-ratings, TEN-328), Dominance ratio, Surface Elo. Windows **"Last 52 weeks" | "Since Mar 2024"** — never
  "Career" (D6). **Surface Elo is the current rating on both views**, labelled "current" (the radar label "Surface Elo ·
  current"; the profile row prints "current" in its Δ slot). Percentiles are the file's **true percentiles**; every axis's
  tooltip states each player's raw value and percentile, and the population **and its n** (`_meta.percentiles` /
  `eloPercentiles`). **On the since view, Under pressure is "—"** (founder Q14, 2026-09-30, TEN-312 5262e790) with the
  tooltip "No since-Mar-2024 figure yet; see the career view." — surface-ratings has no since-Mar-2024 scope, and a career
  number never sits under a since-2024 label; no shape point, no percentile, no Δ for that axis there. **Test:** DNA
  checks + since-view Under pressure reads "—" with that tooltip for both players; mutation: falling back to the career
  scope prints a number.
- **Δ vs 2024–now** only on the 52-week view; none on Elo, none on Under pressure (its baseline is the career scope). A
  player with fewer than 10 matches in the window on the match's surface draws **no shape** and the card says why under
  the file's foot (DESIGN GAP G31); no rating on file → the same line.

## Colour
- **Both players white on the radar** (the file's `cur` palette): A's radar solid + 0.12 fill, B's dashed at 0.85
  (`--text` via `color-mix`, identical in night and day).
- **Green / red bars (README §7, TEN-380):** the personal record's tug — wins `--pos`, losses `--neg`, on a `--line` track,
  centre tick `--text` (5–9 meetings: both grey, D2); the style matchup bars (compact head and open) — A's share `--pos`,
  B's `--neg`, tick `--text`; B's % `--text-label`. The Leans pill = `--wash-4` + `--line`; today's surface tile = `--bar` 6%
  + `--edge-10`, its label `--link`; the other tiles `--card` + `--edge-6`. "Show player profile" and the matchup toggle are
  `--text`, never blue. **Test:** `test-ten340-playing-style.mjs` + `tools/test-ten340-mutants.js` (TEN-380 mutants).
- **Profile bars split leader / trailer; figures stay white** (founder ruling 8, TEN-380 Q3, 2026-10-03): per axis the
  higher percentile's bar is solid `--white-bar`, the other `--white-bar-2` (45%), a tie both solid; both players' values
  are `--text` — colour never marks the better figure (Q13 holds for figures and text). Profile rows on `--line`, track
  `--line`, labels `--text-label`. **Test:** `test-ten340-playing-style.mjs` "ruling 8" (mutations: bars toned per player,
  the trailer solid).

## Design gaps (TEN-312 `design-gaps`)
- G5 mirror matchup · G29 an unclassified player, a matrix cell below its floor, the loading lines · G30 "Show N more
  matches" (accepted, Q15) · G31 a DNA shape withheld (under the floor / no rating) and the DNA loading line.
