# Lines tab — Database v2 (founder 2026-11-16, "follow the design")

Applies to the Database tab's Lines view (`renderLines`, `db2Ln*` in `bsp-consult-dashboard.html`) and to
`build-lines-field.js`. Design = `design_handoff_database_v2/reference/Database.dc.html` L163-206 and L406-665.
**Test:** `test-database-v2.mjs` "ladders", "push", "field".

## What the view is (founder 2026-11-16)
- **Ladders** (`LN_LADDERS`, a literal — `build-lines-field.js` slices it, so the field file follows it on the next data
  run): Bo3 game handicap ±1 … ±6.5, set handicap ±1.5, total games over / under 20 … 24.5; Bo5 game handicap ±2.5 … ±7.5,
  set handicap ±2.5, totals 34.5 / 37.5 / 40.5. Three families; Match shape is not one. Bo3 and Bo5 are counted apart.
- **Cover** = his share of matches that covered the line, worked out from set scores (`lnHit`); **a whole line's push is
  not covered** (the design's own predicate, `margin > 0`). Record = covered–missed. A rate needs LN_MIN_N (5) matches and
  is muted under 10 (DB2_LN_FULL).
- **Field** = the field median from `lines-field.json` at the format · surface · period slice; **under any other filter
  (side, price band, archetype, level) it is an en dash** — no field file holds those. Edge = Cover − Field, both as shown.
- **As favourite / As underdog and price bands** (founder 2026-11-16, replacing "The Side control is not built"): the
  player's shorter Pinnacle closing price on the Database's one price join (`H2HPage.priceJoin`, the Player Profile's) =
  favourite; an exact tie is neither (no opening price on record); a row the join does not price is in no side view.
- Opponent archetype = the eight locked classifier labels (`playing-styles.json`); Level = the tournament catalogue
  (Grand Slam only under Bo5; Masters 1000 / ATP 500 / ATP 250 only under Bo3). Never colour a cover rate green.
- Layout: the Filters panel full width inside the filter card; answer tiles; per family two band cards (− lines / + lines,
  Over / Under) with the match list directly under the clicked row (latest 12, All · Covered · Missed); 2-3 players = the
  flat list.

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

