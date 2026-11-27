# Lines tab — Database v3 (founder export 2026-11-18; v2 2026-11-16)

Applies to the Database tab's Lines view (`renderLines`, `db2Ln*`, `db3LineBox` in `bsp-consult-dashboard.html`), to
`build-lines-field.js` and to `tools/build-lines-field-cuts.mjs`. Design = `design_handoff_database_v3/` (CHANGES §8).
**Test:** `test-database-v2.mjs` "ladders", "push", "field", "fieldCuts"; `tools/test-lines-field-cuts.mjs`.

## What the view is (founder 2026-11-16)
- **Ladders** (`LN_LADDERS`, a literal — `build-lines-field.js` slices it, so the field file follows it on the next data
  run): Bo3 game handicap ±1 … ±6.5, set handicap ±1.5, total games over / under 20 … 24.5; Bo5 game handicap ±2.5 … ±7.5,
  set handicap ±2.5, totals 34.5 / 37.5 / 40.5. Three families; Match shape is not one. Bo3 and Bo5 are counted apart.
- **Cover** = his share of matches that covered the line, worked out from set scores (`lnHit`). **A whole line that lands
  exactly on the number is a push: void** (founder 2026-11-16) — neither covered nor missed, out of the rate and the Record
  (covered–missed); the match list marks it "Void" (grey) and its head counts "· N void". Half lines cannot push. The field
  file is built from the same `lnHit` / `lnLine`, so its rates exclude pushes too. A rate needs LN_MIN_N (5) matches and is
  muted under 10 (DB2_LN_FULL).
- **Field** = the field median at the slice the view shows: `lines-field.json` (format · surface · period) with no other
  filter on, else **`lines-field-cuts.json`** under the side (All / As favourite / As underdog), price band, opponent
  archetype or level filter (founder review 2026-11-18: "Field / Edge empty under As favourite: not normal, fix it";
  replaces "under any other filter it is an en dash"). Edge = Cover − Field, both as shown. The cut file is tallied by the
  page's own `DatabaseTab.lnCutTally` (the one price join, the archetype table, the catalogue) over the lines-field roster in
  headless Chrome by `tools/build-lines-field-cuts.mjs`, a pipeline step after the price guard (best-effort; a failed build
  ships no file and the field reads a dash under those filters). Cut key `fmt|surf|scope|P|X` (P = fav / dog / fav:i / dog:i,
  X = - / a:i / l:j / **a:i+l:j**). **Archetype and level together have their own cut** (founder 2026-11-27, "Build it!";
  replaces "no cut, a dash"): `db2LnCutTally` writes the `a:i+l:j` key for every match that has both, `db2LnCutKey` reads
  it. Measured 27 Nov (203 players): 910 → 1,360 cuts (539 of them archetype + level), 128 → 170 KB gzip (741 → 1,095 KB
  raw), build about 1 minute longer (warm local run 37 → 96 s); these fields are small (median 4 players, max 162), the n
  on every hover as for any cut. A player is in a cut's field from LN_MIN_N (5)
  matches on that line; **the field size n is on every Field figure's hover** and in the line box. The file is loaded only
  while such a filter is on (measured 18 Nov: 168 players, 824 cuts, 112 KB gzip, 3:54 to build), so no view loads slower.
- **Comparison works on a small sample** (founder review 2026-11-18): Edge prints from 5 matches (muted 5–9), and the two
  answer tiles rank every line with an Edge, not only lines of 10+.
- **As favourite / As underdog and price bands** (founder 2026-11-16, replacing "The Side control is not built"): the
  player's shorter Pinnacle closing price on the Database's one price join (`H2HPage.priceJoin`, the Player Profile's) =
  favourite; an exact tie is neither (no opening price on record); a row the join does not price is in no side view.
- Opponent archetype = the eight locked classifier labels (`playing-styles.json`); Level = the tournament catalogue
  (Grand Slam only under Bo5; Masters 1000 / ATP 500 / ATP 250 only under Bo3). Never colour a cover rate green.
- **Layout (CHANGES §8):** stacked cards. Head card: 44px avatar (photo) + name 18/800 + grey rank over the scope line |
  the two tiles "Most above / below the field" | "?". Per family a header card (name over "N lines · N matches" | the summary
  pill with a green / red dot), then two section cards "Minus lines" / "Plus lines" ("Over" / "Under"): head title over
  "N lines · Best of 3 · last 52 weeks" | the average edge 26px over "average edge on the field"; a row (60px) = the line 15px
  mono | the edge line with its pp chip | cover over "field n%" | record | ›. **A line click opens the line box** (band box
  anatomy: avatar + name + the line pill; four tiles Cover rate · Field median · Edge on the field · Rank; "Matches on this
  line" with All · Covered · Missed, 12 then "Show 12 more matches"). Nothing opens inside the list. Two or three players =
  one section card holding the flat table; a cell opens the line box for that player.

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
- **Answer tiles keep their place** (review 2026-11-16): with fewer than two lines that carry a field (any filter the
  field file does not cover — side, price band, style, level), both tiles show a grey dash and "No field to compare under
  these filters", not clickable; never a figure in place of the field.
