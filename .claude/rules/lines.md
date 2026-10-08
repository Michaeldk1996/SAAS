# Lines tab — founder rulings and the facts behind them

Applies to the Database tab's Lines view (`renderLines`, `lnPaint`, `lnHead` in
`bsp-consult-dashboard.html`) and to `build-lines-field.js`.

## The Side control is not built (founder ruling, TEN-256 / TEN-260)

README TAB 5 specs a **Side** menu (All matches / As favourite / As underdog) splitting
handicap lines. It is **not built and must not be**: career-history rows carry no price
and no favourite marker — measured 2026-09-23, **0 of 85,779 rows across all 225 shards**.
The only honest paths are a pipeline join to the odds archive (ATP main draw only,
2004–2026, partial, with its own denominator) or a rank-based "favourite", which is a
different statistic under a market heading — neither is ruled. This explanation lives
HERE, not in the UI (founder, TEN-260 Part C.9).

**Test:** the Lines control bar renders no Side control and no "All matches" chip.

## Field / Vs field / Ranking come from the pipeline file (TEN-260 Part B)

`build-lines-field.js` writes `lines-field.json` every pipeline run: sorted rates per
format × surface × period × line over every roster player with **≥ 5 matches on that
line** (the page's own rate gate, `LN_MIN_N`). It SLICES the line functions out of the
dashboard — never re-implement them there. Field = median, Vs field = rate − median,
Ranking = 1 + rates strictly above / field size. Without the file those three columns
are dashes with a note; **Rate never waits for it.**

**Retired players are not in the field (founder ruling TEN-262 #6, 2026-09-23).** Every name
in `retired-players.json` → `retired[]` is dropped from the roster before the field is built,
so it leaves Field, Vs field, Ranking and every "N of M". The file records who was removed
(`source.retiredExcluded`). A missing or unreadable list **fails the build** — it is never
read as "nobody retired". A retired player can still be picked on Lines: his Rate and Vs
field show, his Ranking is a dash (he is not in the field) even when an active player has the
same rate (`lnFieldStats` checks the name against `source.retiredExcluded`). **Test:** build
the field from fixture shards with one retired player: no field array holds his rate, every
field size drops by one, and a retired subject with a rate equal to an active player's
paints Ranking "—" while the active player paints "1/3". Locked by `test-ten262.mjs`.

**Open, NOT ruled:** a field-size floor (field size runs 215 down to 5 after the TEN-262 retired exclusion, measured 2026-09-23). Until ruled, a
field under 10 carries a `field N` small-sample mark and every Ranking shows its
denominator — flagged, not hidden, not filled.

## Compare view and notes (founder TEN-399 fix 3 + 4, card ff586600, and R2 post-live, 2026-10-08)

**Test:** a compare row reads Line | Field (one shared field median) | per player **Rate · Vs field · Record** (R2 item 4);
Vs field is in the three-way sign colour at the single table's 13px mono (the old "neutral compare delta" is retired).
The note above the table names no file and no pipeline step. With the field file it reads exactly "Field = the median
rate on each line across tour players with at least 5 matches on that line. Last 52 = matches since <date>."; without it
"Field, Vs field and Ranking are not published yet; Rate is computed from each player’s own matches." The coverage line
keeps "Lines computed on N of M matches (x%) · K best of three" and carries no "excluded as unfinished or a different
format" clause (R2 item 1); no "no readable best-of" line and no unresolved-name list. Locked by `test-ten260-lines.mjs`
(compare, noField) and `test-ten399-fixes.mjs` (linesCoverage).

## Vs field adds up on screen (founder card 0122a989 "ship-rounded", 2026-10-08)

**Test:** Vs field = the displayed Rate (1 dp) minus the displayed Field (1 dp), in the single table and in compare, so
the three figures on screen always add up (Alcaraz −1.5 sets: 57.8% − 37.9% = +19.9pp, not the unrounded +20.0pp).
Ranking still uses the unrounded rate. Locked by `test-ten399-fixes.mjs` (vsFieldDisplayed) and `test-ten260-lines.mjs` (field).

## Rate highlight = full sample at 65% (founder step-6 ticket TEN-399 item 8, 2026-10-07)

A **full-sample rate at 65% or better** is the highlight state: `--pos` text, weight 700,
on a **12% `--pos` wash** (`color-mix(in srgb, var(--pos) 12%, transparent)`), **no
border**. This SUPERSEDES README TAB 5's lighter green on a 15% wash with a 34% green border —
do not put the border back.

Full sample = n ≥ 10. A rate on n < 10 is `--text-label` ink with no wash. **Test:** 65.0%
at n = 20 highlighted; 64.5% at n = 200 not; 100% at n = 9 not (and grey). Locked by
`test-ten260-lines.mjs`.

## Surfaces and marks (TEN-399 item 8)

- The Lines card is a top-level card: `--card` + `--top-light`, no outline.
- State chips (format · surface · period · line group): `--inner`, no edge, Hanken 10.5 /
  700 / 0.10em caps in `--text-label`.
- Group headings: Hanken 10.5 / 700 / 0.10em caps, `--text-label`, the same in the
  compare view (the old 9px / 600 compare heading is gone).
- Small-sample marks (`n < 5`, `small n`, `field N`) are grey caps labels
  (`--text-label`). **No amber anywhere on the tab.**
- Compare view: each player's name band is white 14 / 800 on a **14% white rule**
  (`--text` at 14%).

**Test:** each rule read off the page's stylesheet, plus the painted small-sample marks
(no inline colour) and the highlight state. Locked by `test-ten260-lines.mjs` (TEN-399
block, 8 mutants).
