# Today's Matches (Upcoming + Completed) — founder TEN-377, 2026-10-03

Package: `design_handoff_todays_matches/README.md` on TEN-377 + `OFFICIAL VERSION 1.html` → Matches. The reference wins
except where a ruling below says otherwise. Colours are foundation tokens (`foundation.md`). Tests: `test-ten377-todays-matches.mjs`.

- **Header card = the shared 35b page header** (founder shell refresh TEN-403, 2026-10-08; supersedes the 29px card, the
  separate status line and founder R3's "no dot"; values in `app-shell.md` "Page header (35b, TEN-403)"). One line under the
  title: the sentence, then a `--text-label` tail — Upcoming `· Times in <zone>`, Completed `· Settled · <date> · Times in
  <zone>`. Upcoming's **first stat column is the live clock**: caps label over a 7px `--pos` dot + the clock in Plex Mono
  15/700 `--text-soft`; the label keeps ruling A's words ("Live · oldest odds" / "Live · odds from … or older" / "Live ·
  loaded" — the clock is the OLDEST price on the board, never a wall clock; founder TEN-403 R2 2026-10-09 withdrew R1's
  "Live · updated", and the tail carries no oldest-odds part); Completed draws no live column. Then four
  stats — Upcoming `Matches · Tournaments · Books · Updated`, Completed `Settled · Tournaments · Upsets · Updated`; Matches/
  Settled = cards rendered; Books = distinct bookmakers priced on them (card book + Now + Open books, one per
  `mxBookLabel`); Upsets = the Upsets-tile rule (`mcUpsetRows`); Updated = newest odds observation among the prices shown (`mxOddsUpdatedAt`, the same set and clock as the oldest bound), HH:MM, `--text-soft`;
  no clock → grey `—`. **Test:** `test-ten403-header.mjs` (live column + tail), `test-ten225-header-clock.mjs` (oldest on the face, Updated never older), `test-ten377-todays-matches.mjs` (stats).
- **Upcoming card:** both names `--text` (FAV badge carries the favourite); both form bars `--viz-lead`; surfaces neutral;
  head/foot hairlines and the column divider are white 3.5% (founder Q1, reference). Market Signal drawer = `--card` on a
  `--edge-6` rule, fav % white, bars `--viz-lead` + `--viz-second`.
- **Completed card:** inset tiles (winner white 3.5% + 3px `--pos` 90% pill; loser name `--text-label` 600, never red).
  Surface `--text-soft`; round chip `--inner` + 10% inset edge, white (Q1). Score = sets-won tile (winner white 9% + 10% inset
  edge, white; loser white 4.5%, grey, no edge — Q1, README 7a) · 1px divider · one 24px cell per played set (won white 8% /
  lost 2.5%, one style always), each side's own tie-break points in the corner. Prices = `Open → Close · Move` on a
  38/14/42/44 grid, Open and Close from the card's ONE book (TEN-377 card 0b990217; `odds.md`); no journey bar; Close
  always white mono 15/700; Move signed on every row with both legs, older closes included (ruling 2 = stats only); no Move
  for a vendor-pinned open or a missing leg; missing leg = grey "—"; the Move is THE move formula `mxMovePct` (2-dp prices as shown, one decimal, true minus; a genuine zero reads `±0.0%` grey — founder card 9b1c3aa1, 2026-10-09, replaces the whole-percent `oddsPctDelta`), and so is the Completed Biggest market move tile and its ranking: the tile and the "Biggest move" sort rank EVERY close the cards show, older closes included (founder TEN-403 414de0fe; `odds.md` → Numbers), so the tile is always the largest |Move| a card prints, with that card's player. The odds pop-up's open → close
  equals the card's exactly, for the book named in its header; Pinnacle's close is its own grey line. Footer and drawer rules 6% (Q1); drawer = one flat list, book names `--text-soft`, no
  liquidity; "See full analysis" 600. The "Showing … settled" context bar is removed.
- **Card grid (founder 2026-10-03, replaces TEN-270 stretch):** `#matchlist` `align-items:start`. Closed cards in a row
  line up because they share one structure; a card that could grow is fixed inside the card, never by stretching the row.
  An open Market Signal grows only its own card. Same on Completed.
- **Insight tiles (TEN-403 Shell refresh, reference "39b", replaces the review 2026-10-03 line):** always three tiles,
  same size, both views, below the date row and above the filter / search row. Upcoming = Biggest market move · Shortest
  price · Tightest match on the 39b surface: `--card`, 1px `--edge-7`, radius 12, `--top-light`, padding 14/18/15, column
  gap 8, three equal columns at gap 12; caps title Hanken 10.5/700/0.10em grey. Biggest market move: title left + hint
  right (11/600) · open mono 22/700 grey → now mono 22/800 white · move mono 13/700 signed · one 12.5 grey line, player
  name 700 white + "drifted"/"shortened" · v opponent · tournament round (ellipsis, never wraps). Shortest price: price
  mono 22/800 white + name 14/700 white, then "v opponent · tournament round". Tightest match: two rows name 14/700 white
  + price mono 15/700 white (row gap 3), then `Tour R16 · 13:45` (tournament and round joined by a space, as the
  reference). Completed keeps its tiles (Biggest market move · Upsets · Value picks; reference: padding 15/19, no edge).
  A tile with no data keeps its slot and shows one short grey line (`No market moves` = pairs exist but none moved, `No
  opening prices on file` = no measurable pair, `No upsets`, `Not enough pick history yet`, `No prices yet`). No
  provenance / coverage line, no `· book` suffix, no "in 2h" countdown (TEN-225 ruling 1). Test: `test-ten403-matches.mjs`.
- **Move view (TEN-403, replaces TEN-225 item 5's movers-only filter):** clicking Biggest market move toggles
  `state.sort === 'drift'`. On: the tile edge is `--edge-24` (hover `--edge-16`, also over an on tile; the surface stays
  `--card`), the hint reads `Showing open → now · biggest first` in white (off: `Show open → now`, grey). Every Upcoming
  card's head reads `Open · → · Now · Move` and its rows open mono 13/500 grey · grey → · now mono 19/800 white · move
  mono 12/700 signed, on `56px 14px 60px 48px` at gap 10 right-aligned (row = name · 1px divider · that block, gap 10).
  The list re-orders by the larger |move| of the two players, then 0%, then `—` cards in time order, then unpriced cards;
  **no card is dropped**. Click again → Odds · implied + Recent form in time order. The sort control reads `Sort: Move`
  while the view is on and `Sort: Time` when it is off (founder R1 nit; option text `Move`, internal key `drift`). The
  sort (`moveNowScore`) and the tile's pick rank on the SAME figure — the shown move below, not the unrounded
  |now / open − 1| — ties by earlier start, then time string; the tile names a leg of the match the sort puts first.
  Test: `test-ten403-matches.mjs` (order, columns, cells, tile = sort's first, "Sort: Move"; mutants: unrounded score,
  pre-R1 tile, "Drift"), `test-ten225-drift-order.mjs` (the five tiers).
- **The move (TEN-403; R1 founder 2026-10-09 item 1):** `mxMovePct(open, now)` = (now₂ / open₂ − 1) × 100 where x₂ is
  the price AS SHOWN (2 dp, `toFixed(2)`; the rounding is inside `mxMovePct`), one decimal (a half away from zero),
  explicit sign, true minus, zero `±0.0%` grey, green `--pos` / red `--neg` otherwise. One formula for the tile, its
  ranking, the sort, the Move column and the odds pop-up. Test table (founder's values): 1.28→1.34 `+4.7%`, 1.37→1.43
  `+4.4%`, 1.09→1.11 `+1.8%`, 1.41→1.38 `−2.1%`, 1.33→1.38 `+3.8%`, 1.59→1.55 `−2.5%`, 1.78→1.85 `+3.9%`, also from
  unrounded quotes that print those pairs. Every board price prints 2 dp (`mxOddsTxt`, open included; `odds.md`). A Move is drawn only for a measurable same-book pair (`_mcOpenNowPair`: one book, both
  legs, not a vendor-pinned api-tennis open — TEN-198, not an unevidenced flat single sighting); anything else is `—`
  and sorts last. Open = the card's first recorded price (`_openAnchorOf`), Now = the card's price.
- **Favourites (TEN-403, reference "39b"):** a star is the first item of every **Upcoming** card header (the reference's
  Completed cards carry none): 14px star in a 24px hit area, radius 7, `--inner` on hover; idle no fill + `--text-label`
  stroke, starred white fill + stroke; tooltip `Add to favourites` / `Remove from favourites`. While ≥ 1 starred match is
  still to be played, a strip sits between the filter row and the grid: caps `Favourites · N`, then a sideways-scrolling
  row (gap 10) of 272px mini cards (`--card`, radius 12, `--top-light`, padding 10/14/11, gap 7): `tournament · round ·
  time` 11px grey + a white star (click removes), then player 1 13/700 white + price mono 14/800 white, player 2 13/600
  `--text-soft` + price `--text-soft`; a missing price is `—`. Nothing starred → no strip at all (no empty state). The
  strip lists every starred upcoming match on the board, in start order, whatever day or filter is shown; the card list
  never re-orders for a star. Key = `eventKeyOfMatch(m)` (survives a refresh and the card turning into a result).
  Store: signed in → Firestore `users/{uid}.favouriteMatches` (`BSP.updateProfile`, cleaned by `cleanMatchKeys`);
  signed out → localStorage `stennisfy.favourites`; on sign-in the local list merges into the account (account order
  first) and is emptied once the write succeeds. A starred match that settles (finished, retired, walkover; not live)
  leaves the list on the next render. Nothing is starred by default. Test: `test-ten403-matches.mjs`.
- **Market Signal drawer (review):** no explainer paragraph; a source without data is not drawn (no "—" rows, no empty bars);
  a group with no rows is not drawn; nothing at all → one grey line `No market signal for this match yet`. Caret ▾ closed /
  ▴ open (180° turn), white, font stack `'Hanken Grotesk', sans-serif` (system-ui drew a dot).
- **Tournament chips (review):** one row on both views — `All tournaments` first (clears the selection), then one chip per
  event of the selected day.
