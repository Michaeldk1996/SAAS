# Player Profile page: founder rulings

Applies to the Player Profile page in `bsp-consult-dashboard.html` (`buildPlayerProfileHtml` — the legacy
renderer — and the TEN-206 renderer behind the `pp2` flag, default ON).
Restored from CLAUDE.md before 011e3e20 (2026-09-21 trim); TEN-312 N13, founder-approved 2026-09-28.
Newer rulings that also bind the profile: `modal-analysis.md` "Walkovers and retirements" (the TEN-8
"W/O received = win" rule is superseded on the profile too) and "Overview career spine"; `modal-market-edge.md`
(player-profile Market edge basis).

- **Player Profile — export parity (founder ruling 2026-08-01).** The Player Profile page
  (`buildPlayerProfileHtml`) drops three intentional enrichments the export lacks. **(1) No "Surface record"
  rail card** — the Layer #4A career + rolling-52-week per-surface card is removed; the left rail carries
  only the **Surface performance** bars. **(2) Recent form is a flat, most-recent-first list** — one row per
  match, labelled inline with its tournament, **not** grouped under per-tournament headers (tournament
  grouping stays only in the modal Form tab). **(3) The header archetype line is a single archetype label**
  (e.g. `All-Court Elite`, or a composed `A / B`) with **no appended "· <surface> Specialist" tag**, coloured
  **primary text** — never brand blue (Blue rule). These are the **fourth** export-has-not / product-had
  divergence resolved toward the export, alongside Extra-stats, the Summary view and the H2H trend.
  *Colour value (CLAUDE.md "Palette = 12a", 2026-09-25):* the old primary-text hex `#e7e9ee` is a retired
  palette value; primary text is the 12a `text` tier (`#EBF1F2`).
  *Scope note (2026-09-28):* this ruling names `buildPlayerProfileHtml`, now the legacy renderer; the TEN-206
  renderer is the default. Whether the three parity points bind the TEN-206 renderer has not been re-ruled.
  **Test:** the profile rail has no "Surface record" card; Recent form shows no tournament group headers;
  the archetype line is one label in primary text, not blue and with no Specialist suffix.
