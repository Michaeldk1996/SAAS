# Ratings board — founder rulings that OVERRIDE the design bundle

Applies to the Database tab's Ratings board (`ratLeaderboard`, `ratOverview`,
`ratBoardPool`, `ratComparePanel` in `bsp-consult-dashboard.html`).

⚠️ **Why this file exists rather than an edit to the bundle.** The authoritative
Database handoff is `.ten243-design/design_handoff_database/` — the ZIP the founder
sent. **It is not committed to this repo.** Both tracked copies
(`design-export/database-handoff/` and `design-export/database-handoff-4/`) carry a
`SUPERSEDED.md` reading "do not build from this bundle". So a ruling written into
either tracked copy would be written into a bundle the next reader is told to
ignore, and a ruling written into the untracked copy exists on one laptop only —
invisible to every other agent and to CI. Rulings therefore live **here**.

---

## Vs pk renders with NO colour (founder ruling, 2026-09-23)

**The rule.** The Elo board's `Vs pk` column (current overall Elo minus peak Elo)
renders as a signed figure in the same tabular mono as its neighbouring component
cells, at the same 13px / weight 400, **with no colour applied at any value**.

**The test someone can apply.** Render the Elo board and read the computed style of
any `Vs pk` cell. It must carry no sign colour — not `#e0616f`, not `#3dd68c` — and
no colour distinct from the other component cells in the same row. `ratFmt` must
contain no colour branch for its `sgn` path. Locked by
`test-ten254-rulings-3-4.mjs`.

**This SUPERSEDES the bundle.** README TAB 4 "Leaderboards" specifies
`Vs pk` as *"13px / 700, signed, `#8b96b5` at −60 or better and `#e0616f` below"*.
**That text is overturned — do not implement it, and do not "fix" the code back
toward it.**

**The measurement behind the ruling** (2026-09-23, on the published store, computed
by executing the shipped `ratBoardPool('elo')` and `ratVal`): the Elo board renders
**216 rows**, every one with a non-null `Vs pk`. The bundle's −60 threshold would
colour **173 of 216 (80.1%)** red; median `Vs pk` is **−159**, p25 −207, p75 −77.
The threshold was calibrated against the prototype's 23-player roster, whose peaks
were *derived* (`career value ± 20`), not against real scraped peaks — so on real
data it reddens four rows in five. Thresholds that would redden about a quarter of
the field are −200 (57 of 216, 26.4%) and −250 (34, 15.7%). The founder chose no
colour rather than a re-picked threshold.

**Exception:** none. This applies at every value, including 0 (a player at his
peak) and a dash (a player with no peak in the source).

---

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
> | ≥ 10 | percentage at full size, `#e7e9ee` |
> | 5–9 | percentage greyed `#5b6880`, smaller, with a "small sample" note |
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

## Mental Edge — the pressure-point count stays

Every Mental Edge ratio carries its pressure-point count (PW + PL), on the board
**and** in the Compare panel. This is the founder's standing instruction while the
ranking minimum is unset; a minimum being chosen later does **not** make the count
redundant — the minimum decides who is *ranked*, the count says how thin the ones
on screen are. Locked by `test-ten254-mental-count.mjs` (12 mutants).
