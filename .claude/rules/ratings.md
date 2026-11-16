# Ratings board — Database v2 (founder 2026-11-16, "follow the design")

Applies to the Database tab's Ratings view (`renderRatings`, `db2RatOverview`, `db2RatBoard`, `db2RatCompare` in
`bsp-consult-dashboard.html`). Design = `design_handoff_database_v2/reference/Database.dc.html` L254-403. **Test:**
`test-database-v2.mjs` "ratings".

## The board and the compare card (founder 2026-11-16)
- **One period at a time: Last 52 weeks first and the default, then Career** (replaces TEN-262 #1's Career-first control
  and the compare panel's Last 52 + Career + Δ columns). There is still no Last 52 Elo: every Elo cell on Last 52 weeks is
  a dash (TEN-262 ruling 1 stands; never create one; founder re-confirmed 2026-11-17 against the design, which draws
  Elo on Last 52 weeks: "it should be a dash").
- **Boards: Overview · Elo · Serve · Return · Under pressure** — the Mental Edge board, its view pills, the 200-point
  ranking minimum and its count line are gone with it (the design has none).
- The board lists the whole gated field while players are compared; a "Field median" row heads every table; the sorted
  column is white 700, the others ink-2 400; places 1-3 white 700. The "+" in the first track picks a player (blue + 3px
  halo, the row on a 9% blue wash; rotates to × in .22s; "Four players maximum").
- Compare card above the board: exactly two players = face to face (tally "a – b ratings ahead", one row per rating, a
  4px line leaning to the better player with the difference on a chip, "Level" on a tie); one, three or four = columns,
  the row's best white 800, every other cell its gap in red ("−n"). Rows, always seven: Elo · Elo · hard · Elo · clay ·
  Elo · grass · Serve rating · Return rating · Under pressure.
- The design's own colours (`--db2-*`); the ruled footnote words live in the board's "?" hover.

## Vs pk as the export draws it (founder 2026-11-16, "follow export"; replaces the 2026-09-23 no-colour ruling)
- **Test:** on the Elo board every `Vs pk` cell (current overall Elo − peak) is signed mono 13px **weight 700**, muted
  (`--db2-muted`) at −60 or better and red (`--db2-red`) below (`DB2_VSPK_RED = -60`); a red cell keeps its red when its
  column is sorted. `test-database-v2.mjs` "constants" (mutant: uncoloured). The 23 Sep measurement (173 of 216 rows below
  −60 on real peaks) stands as context: most of the board reads red.

## Fewer than 10 matches hides the WHOLE player (founder ruling, 2026-09-23)

**The rule.** On every Ratings leaderboard, a player who does not clear
`RAT_GATE` (10) matches at the current slice is **excluded from the board
entirely** — no row, no greyed figure, no partial cell.

**The test someone can apply.** Give `ratBoardPool` a player whose slice carries 9
matches and assert the returned pool does not contain them; the rendered grid must
paint no row for that name. Locked by `test-ten254-rulings-3-4.mjs`.

**This SUPERSEDES the bundle.** STENNISFY-DESIGN-INSTRUCTIONS §5 "Data rules —
non-negotiable" specifies a **per-cell** treatment with a middle band:

> | n | Show |
> | ≥ 10 | percentage at full size, `--text` |
> | 5–9 | percentage greyed `--text-label`, smaller, with a "small sample" note |
> | < 5 | no percentage — W–L only, plus "too few matches for a rate" |
> | 0 | an em dash `—` and "no matches on record" |

**On the Ratings board the 5–9 band is overturned and must NOT be built.** A
player under 10 is hidden, not greyed. §5's table still governs other surfaces —
this ruling is scoped to the Ratings board.

**Related, and still in force:** founder gate `94aed7f5` (2026-09-20) answered
`keep_10` and **declined** gating the board on the store's own `reliable` flag.
`RAT_GATE` stays 10 and `ratBoardPool` must not consult `reliable`. Locked by
`tools/test-ratings-rulings.js`. The accepted cost is that thin-sample players
reach the top of the Mental Edge board; the per-row pressure-point count is what
discloses it.

---

## Retired players leave the board (founder ruling TEN-254 #4, built TEN-260)

**The rule.** Every name in `retired-players.json` → `retired[]` is absent from every
Ratings board (Overview, all five leaderboards, the compare picker and panel), and every
count and denominator on the tab drops with it. `_candidates_for_review` is NOT read.
Lines excludes them from its FIELD too (TEN-262 #6, see `lines.md`). Profiles, H2H and the
Lines player picker still show the player.

**Adding a player** is one entry in `retired[]`, `name` exactly as in
`surface-ratings.json`, with its source. `retiredOn` is null unless a final-match date is
confirmed. 11 entries as of TEN-262 (2026-09-23): the four TEN-254 ones plus Monfils,
Wawrinka, Lestienne, Balleret, Bautista-Agut, Carreno-Busta and Basilashvili, each
"founder-confirmed 2026-09-23". N. Kyrgios stays ACTIVE (injured, not retired).

**The test.** Paint any board with the file loaded: no retired name appears, and the
Overview count is exactly (unfiltered count − retired players who were in it). If the
file fails to load, the board says (in `--text-soft`; amber is Model + Trading Report only, TEN-376) "Retired players could not be
excluded just now, so this board may include them." — never a silent fallback to the full roster.
**Footnote copy (founder TEN-399 fix 4 + R2 item 2, 2026-10-08):** under the Overview table, after the caps slice label,
exactly three short lines: "n is the serve-stat match count." · "Elo is a weekly snapshot from an external list: Last 52 is a
dash, Career is today’s rating." · "Retired players are excluded." No file name, no list of names, no "N of M stored
players". The card subtitle is two lines with no discount factor ("Elo comes from an external weekly list. Serve, return
and under-pressure are built from our ATP match archive, with Challenger matches added for players thin at tour level.
Higher is better in every column."). The compare panel's Career figures are `--text`, weight 400 (R2 item 3); Δ is
sign-coloured. Locked by `test-ten399-fixes.mjs` (ratingsCopy, careerWhite). Locked by `test-ten260-ratings.mjs`; the list itself (every name on the store, every entry sourced, the seven
TEN-262 names present, Kyrgios absent) by `test-ten262.mjs`.

