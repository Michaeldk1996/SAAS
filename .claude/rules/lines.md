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

## Rate highlight = full sample at 65% (README TAB 5, quoted)

> "A **full-sample rate at 65% or better** is the highlight state: `#7ee0a8` on
> `rgba(78,200,130,0.15)` with `border:1px solid rgba(78,200,130,0.34)` at weight 700."

Full sample = n ≥ 10. **Test:** 65.0% at n = 20 highlighted; 64.5% at n = 200 not;
100% at n = 9 not. Locked by `test-ten260-lines.mjs`.
