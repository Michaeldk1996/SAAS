# Match analysis modal — TEN-312 rebuild rulings (founder, 2026-09-28)

Applies to the whole Match analysis modal (`openAnalysisModal` and every tab builder in
`bsp-consult-dashboard.html`) as it is rebuilt against `design_handoff_match_analysis_v1`
(`Match Analysis Progression v1.dc.html`). Phase 0 evidence: TEN-312 documents `phase0-report`,
`phase0-a` … `phase0-f`. Tab-specific rulings stay in `modal-form-h2h.md`, `modal-market-edge.md`,
`modal-weather.md` and `odds.md`; where one of those conflicts with this file, this file wins.

## Build order (D-order)
- Tabs ship in the brief's order: Form → H2H → Overview → Tournament → Odds → Market edge → Weather →
  Match Stats (+ sheet data) → Progression → Playing style → News → Key factors (`v.o` only).
  The CEO's alternative order was declined. **Test:** no tab's rebuild lands before every tab ahead of it
  in this list has landed or been explicitly skipped by the founder.

## Palette (D1)
- **The modal is coloured only through one token file**, mapped from the design's source hex by the
  handoff README §3 table: **Night 24b** and **Day 26f**. The modal re-themes live when the
  Night / Day / Auto setting changes (Auto follows the OS `prefers-color-scheme`).
  **Test:** a grep of the modal's builders finds no literal hex/rgba outside the token file; switching the
  setting changes the computed colours of every open modal surface without a reload.
- **Scope of the Night / Day / Auto switch = the whole site** (founder 2026-09-28, TEN-312 follow-up):
  24b / 26f retires 12a everywhere, as a **separate task** after the modal's token layer. Until that task
  lands, the rest of the site stays 12a (CLAUDE.md "Palette = 12a") and the modal is the only surface on
  the 24b / 26f token file. **Test:** after the site-wide task, the computed-style audit reports zero 12a
  values on any surface, in Night and in Day.
- Amber `#E8A84E` is allowed only on Weather severity. Surfaces (Hard / Clay / Grass) are neutral text.
- **Transition:** until the TEN-312 Phase 1 token layer lands, the TEN-303 design-verbatim values
  (`AODDS_C`, `WX_C`, `<style id="design-verbatim-analysis">`) remain in code and their tests remain
  green; the Phase 1 change deletes that exception from CLAUDE.md and rewrites those tests against the
  token file in the same commit.

## Players and avatars (D4, D5)
- **Both players are neutral on every tab, Odds included:** player A white/primary, player B grey — as on
  Market edge. Blue is only links, TODAY and selection. **Test:** no player name, sparkline, chart line or
  pop-up square takes the link/accent blue.
- **Avatars = ATP photos from `player-atp-aliases.json`, monogram fallback** (header and match stats
  sheet), not the design's initials-in-rings. **Test:** a player with an alias renders an `<img>` from the
  alias chain; one without renders the monogram.

## Download report (D7)
- The menu item renders exactly as designed and does nothing (no print, no export).
  **Test:** clicking it fires no handler and opens nothing.

## Sample-size gate (D2)
- Hot lines keep the existing minimum of **3** eligible matches (`FH_HOT_MIN_ELIGIBLE`), on Form and H2H.
- Every other rate follows STENNISFY-DESIGN-INSTRUCTIONS §5: n ≥ 10 full · 5–9 greyed + "small sample"
  · < 5 W–L only · 0 dash. **Test:** a fixture with n = 3, 7 and 12 renders W–L only, greyed + note, full.

## Market edge default view (D3)
- The tab opens on **Match winner** (`meView` default `winner`). See `modal-market-edge.md`.

## Walkovers and retirements — every tab (N2: "as the ATP rules and the ATP website do")
- **A walkover is neither a win nor a loss, for either player, on every tab** (Form, H2H, Overview,
  Tournament, Playing style, Market edge, Key factors): it is not a match played. It never enters a W–L,
  a set count, a rate, a hot line or a price population. It may appear as a row only where the design
  lists results, marked "w/o", and it is excluded from every count on that row's page.
- **An in-match retirement is a match:** a win for the opponent, a loss for the retiree, marked "ret."; its
  unfinished set is excluded from set tallies, deciding sets and games/sets lines (H2H rule e).
- This **supersedes the TEN-8 "W/O received = win" records rule everywhere**, the player profile included
  (founder 2026-09-28: one spine, both surfaces agree). `careerByYear`, career-history-derived W–L and
  tournament-history W–L all follow it. **Test:** a fixture player with one W/O given, one W/O received and one retirement shows
  W–L that counts only the retirement, on Form, H2H, Overview and Tournament alike.

## Overview career spine (N3)
- The Overview reads `careerByYear` (the player-profile spine), not `matches.json p?Yearly`.
- `bsp-pipeline.js` must keep every tier/surface split reconciled: for every year row,
  `atp + chitf = total` (2021 hole-fill rebuilds the tier fields too), and a pre-2021 row is never labelled
  "ATP" unless it holds tour-level matches only. **Test:** over the deployed `player-profiles.json`, 0 rows
  where atp + chitf ≠ total; 0 pre-2021 rows labelled ATP with more matches than tour-level rows held.
