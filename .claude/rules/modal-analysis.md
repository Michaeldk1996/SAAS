# Match analysis modal — TEN-312 rebuild rulings (founder, 2026-09-28)

Applies to the whole Match analysis modal (`openAnalysisModal` and every tab builder in
`bsp-consult-dashboard.html`) as it is rebuilt against `design_handoff_match_analysis_v1`
(`Match Analysis Progression v1.dc.html`), plus the pipeline records and player-profile figures it shares.
Phase 0 evidence: TEN-312 documents `phase0-report`, `phase0-a` … `phase0-f`. Tab-specific rulings stay in
`modal-form-h2h.md`, `modal-market-edge.md`, `modal-weather.md`, `modal-overview.md`,
`modal-key-factors.md`, `modal-match-stats.md` and `odds.md`; where one of those conflicts with this file,
this file wins.

## Build order (founder 2026-09-28, TEN-312 comment 8574fb97 — supersedes the §6 order)
- **Phase 1** = frame + one token file + **per-tab lazy fetch** + **one merged match stats sheet with real stats**
  + shared components + fixture harness / pixel diff (TEN-314).
- Then tabs, one at a time: **Form → H2H → Tournament → News → Overview (after TEN-313) → Odds → Market edge →
  Weather → Match Stats → Progression (DRAW avg for active events only) → Playing style (after the DNA rebuild,
  N11) → Key factors (`v.o` only).** **Test:** no tab's rebuild lands before every tab ahead of it has landed or
  been explicitly skipped by the founder.

## Palette (D1)
- **The modal is coloured only through one token file**, mapped from the design's source hex by the
  handoff README §3 table: **Night 24b** and **Day 26f**. The modal re-themes live when the
  Night / Day / Auto setting changes (Auto follows the OS `prefers-color-scheme`).
  **Test:** a grep of the modal's builders finds no literal hex/rgba outside the token file; switching the
  setting changes the computed colours of every open modal surface without a reload.
- **Scope of the Night / Day / Auto switch = the whole site**, as a **separate task** after the modal's token
  layer (TEN-315). Until that task lands, the rest of the site stays 12a (CLAUDE.md "Palette = 12a") and the
  modal is the only surface on the 24b / 26f token file. **Test:** after TEN-315, the computed-style audit
  reports zero 12a values on any surface, in Night and in Day.
- Amber `#E8A84E` is allowed only on Weather severity. Surfaces (Hard / Clay / Grass) are neutral text — this
  includes the H2H/Form hot-line column-header dots, the Tournament tile and the Overview season rows.
- **Transition:** until the TEN-312 Phase 1 token layer lands, the TEN-303 design-verbatim values
  (`AODDS_C`, `WX_C`, `<style id="design-verbatim-analysis">`) remain in code and their tests remain
  green; the Phase 1 change deletes that exception from CLAUDE.md and rewrites those tests against the
  token file in the same commit.

## Players and avatars (D4, D5)
- **Both players are neutral on every tab, Odds included:** player A white/primary, player B grey — as on
  Market edge. Blue is only links, TODAY and selection. **Test:** no player name, sparkline, chart line or
  pop-up square takes the link/accent blue.
- **Avatars = ATP photos from `player-atp-aliases.json`, monogram fallback**, in the header and the match stats
  sheet, **inside the design's ring and size geometry** (header 40px, sheet 56px, ring as designed).
  **Test:** a player with an alias renders an `<img>` from the alias chain at the design's size and ring; one
  without renders the monogram in the same ring.

## Download report (D7)
- Keeps the existing behaviour: `printAnalysisReport()` → `window.print()` of the modal. Rendered as designed.
  **Test:** clicking it calls `window.print`.

## Sample-size gate (D2) — one gate, `tourxSampleGate`
- **Counts always show** ("5 of 7", "3 of 3", W–L). **Percentages / rates** go through `tourxSampleGate` (dash)
  and nothing else: n ≥ 10 full · n 5–9 greyed + "small sample" note · n < 5 no % (W–L or count only) ·
  n = 0 "—". **Test:** a fixture with n = 0, 3, 7, 12 renders "—", count only, greyed + note, full — on every tab.
- **Hot lines** need ≥ 3 eligible matches (`FH_HOT_MIN_ELIGIBLE`) to **appear**; the % beside a line follows the
  gate (a "3 of 3" line shows no %).
- The Market edge floor (`ME_THIN_FLOOR = 5`) and Form `THIN = 5` keep their n < 5 behaviour and **gain the 5–9
  grey tier** through the same gate.
- **Never render `0%`, `0.0%` or `NaN%` at n = 0** (design sites: Tournament W–L tile, Overview career/surface/
  season %, sheet `pct` helper, Playing style personal record). **Test:** n = 0 renders "—".
- **Small-sample chip:** shown for every n 1–9 per the gate, not only `n === 2` (design L4346 and dash
  `fhH2hRecCard` both wrong). **Test:** n = 1, 3, 9 show it; n = 10 doesn't.

## Match stats sheet — every tab
- **Every match row, dot and cell opens the one sheet**, on every tab, Market edge included (its "stats on file"
  click condition is dropped). The header (meta, score, set chips, closing odds) is always wired from match data;
  where stats don't exist (pre-2024, ITF, events without W/UE) the stat sections show "—" plus "Match stats not
  available for this match" (10.5px, faint). **Test:** a pre-2024 row opens a sheet with a wired header and the note.

## Metrics with no formula before TEN-312 (D6)
- **Per-tournament "+Y.Ypt vs market"** = the player-scope rule (`build-market-edge.js` `summarise`: actual win %
  − mean de-vigged implied %) applied to that player's rows at the event, **n ≥ 5**, prices in the R8 book order
  (`FH_BOOK_ORDER`). n < 5 → "—". **Test:** a fixture event with 5 priced rows reproduces `summarise`.
- **Surface Elo:** there is no 52-week or career Surface Elo (`ratings.md`). The DNA radar's Surface Elo axis
  shows the **current** surface Elo on both views, labelled "current". **Test:** switching the DNA window does not
  change the Elo axis value.
- **DNA "Career" is renamed "Since Mar 2024"** (the data starts 2024-03-06).
- **DNA percentiles are true percentiles** (rank within the stated population), not the p2–p98 linear rescale;
  a tooltip states the population and n. **Test:** exactly one player per axis/scope/surface sits at the top
  rank, and the tooltip's n equals the population size.

## Defaults and scope (N1, N5, N7, N8, N9, N10)
- **N1:** H2H opens on **All** surfaces; Form opens on **today's surface**.
- **N5:** Tournament **Backing** uses the R8 order (Pinnacle, then Bet365; `FH_BOOK_ORDER`), and the player-profile
  per-event tile moves to the same basis. **Test:** the two show the same units for the same player and event.
- **N6:** Tournament / profile edition lists show **only editions the player actually entered**. No edition header is
  synthesised from a gap year (the old `withdrew` fill in `bsp-pipeline.js` minted "Withdrawal" for editions never
  held). **Test:** a player with editions 2019 and 2022 shows no 2020/2021 header.
- **N7:** Tournament W–L is **main draw only** — qualifying rows are filtered out.
- **N8:** Challenger / ITF row prices stay "—" (no opponent-key join yet).
- **N9:** News empty state = the file's copy: "No recent news for {A} or {B}." + "View all news →".
  `SAMPLE_NEWS` and the sample fallback are deleted, never hidden.
- **N10:** the Key factors "Dimension edge" card uses the **5-axis DNA** data. The MCP / Sackmann radar
  (CC BY-NC-SA) is not used on any paid surface. **Test:** the modal never fetches `style-radar.json`.

## Design-file bugs not to port
- Market edge band `bandOf` returns −1 above 15 in the design (DF L3422) and crashes; the live band ladder is
  open-ended above 6.00 and stays so. **Test:** a 21.00 price lands in the 6.00+ band.

## Walkovers and retirements — every tab (N2: "as the ATP rules and the ATP website do")
- **A walkover is neither a win nor a loss, for either player, on every tab** (Form, H2H, Overview,
  Tournament, Playing style, Market edge, Key factors): it is not a match played. It never enters a W–L,
  a set count, a rate, a hot line or a price population. It may appear as a row only where the design
  lists results, marked "w/o", and it is excluded from every count on that row's page.
- **An in-match retirement is a match** for W–L: a win for the opponent, a loss for the retiree, marked "ret."; its
  unfinished set is excluded from set tallies, deciding sets and games/sets lines (H2H rule e). How retirements
  settle in **price** figures is an open founder question (TEN-312) — today Form/H2H settle them, Market edge
  excludes them.
- This **supersedes the TEN-8 "W/O received = win" records rule everywhere**, the player profile included
  (founder 2026-09-28: one spine, both surfaces agree). `careerByYear`, career-history-derived W–L and
  tournament-history W–L all follow it. **Test:** a fixture player with one W/O given, one W/O received and one
  retirement shows W–L that counts only the retirement, on Form, H2H, Overview and Tournament alike.

## Overview career spine (N3)
- The Overview reads `careerByYear` (the player-profile spine), not `matches.json p?Yearly`.
- `bsp-pipeline.js` keeps every tier/surface split reconciled: for every year row `atp + chitf = total`
  (the 2021 hole-fill rebuilds the tier and indoor fields too), and a pre-2021 row is never labelled "ATP" unless
  it holds tour-level matches only. Value changes in `player-profiles.json` and `matches.json` are approved;
  the roster-wide before/after delta (with denominators) is reported before deploy. **Test:** over the deployed
  `player-profiles.json`, 0 rows where atp + chitf ≠ total; 0 pre-2021 rows labelled ATP with more matches than
  tour-level rows held.

## Data protection
- **`point-by-point-cache.json` is irreplaceable:** api-tennis no longer returns tiebreak point rows for past
  matches. A from-scratch rebuild must not drop stored tiebreak points. **Test:** a rebuild over a cache holding
  tiebreak points fails if any stored tiebreak point row disappears.
- **`dna-apitennis-ratings.json` is rebuilt on a schedule from the current roster** (no absolute paths, never the
  committed July `player-profiles.json`). Playing style does not ship before this lands.
