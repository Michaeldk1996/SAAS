# Today's Matches (Upcoming + Completed) — founder TEN-377, 2026-10-03

Package: `design_handoff_todays_matches/README.md` on TEN-377 + `OFFICIAL VERSION 1.html` → Matches. The reference wins
except where a ruling below says otherwise. Colours are foundation tokens (`foundation.md`). Tests: `test-ten377-todays-matches.mjs`.

- **Header card = the shared 35b page header** (founder shell refresh TEN-403, 2026-10-08; supersedes the 29px card, the
  separate status line and founder R3's "no dot"; values in `app-shell.md` "Page header (35b, TEN-403)"). One line under the
  title: the sentence and nothing after it (CHANGES_2026-11-11 A1 / C1): Upcoming "Live odds across bookmakers for every
  listed ATP match.", Completed "Every settled ATP match, with its odds from open to close." — no zone and no "Settled ·
  <date>" tail; the zone is the date bar's label (below). Upcoming's **first stat column is the live clock**: caps label over a 7px `--pos` dot + the clock in Plex Mono
  15/700 `--text-soft`; the label keeps ruling A's words ("Live · oldest odds" / "Live · odds from … or older" / "Live ·
  loaded" — the clock is the OLDEST price on the board, never a wall clock; founder TEN-403 R2 2026-10-09 withdrew R1's
  "Live · updated", and the tail carries no oldest-odds part); Completed draws no live column. Then the stats — Upcoming
  `Matches · Tournaments` (CHANGES_2026-11-11 A3: Books and Updated removed; Next match / Prices moved were proposed and
  rejected), Completed `Settled · Tournaments · Upsets · Updated`; each value **centred under its label**
  (`.sfh__stats--c`, the component's centred variant); Matches/Settled = cards rendered; Upsets = the Upsets-tile rule (`mcUpsetRows`); Updated = newest odds observation among the prices shown (`mxOddsUpdatedAt`, the same set and clock as the oldest bound), HH:MM, `--text-soft`;
  no clock → grey `—`. **Test:** `test-ten403-header.mjs` (live column + tail), `test-ten225-header-clock.mjs` (oldest on the face, Updated never older), `test-ten377-todays-matches.mjs` (stats).
- **Date bar zone label (CHANGES_2026-11-11 A2 / C1):** right after the ›, `margin-left:6px`, on both views: the short offset
  of the zone the cards are printed in (`newsTz()` — the member's setting, else the browser's Intl zone), "GMT+8", "GMT−3"
  (true minus), "GMT+5:30" (minutes only when non-zero), the full IANA name on hover; Plex 11 / 500 `--text-label`, nowrap,
  default cursor, no box. **Test:** `test-todays-matches-1111.mjs` (`mxTzShort` over five zones + DST).
- **Upcoming card header (CHANGES_2026-11-11 A8–A10):** start time Plex 11.5 / **700 `--text`**; surface **400** (its colour
  kept); **no FAV badge** on any card, Upcoming (standard or move view) or Results (founder 2026-11-12, extending A9 to Results); a next-day preview card
  below the day divider shows the **time only** and its tournament name in full (`.mx-preview`). **Test:**
  `test-todays-matches-1111.mjs`.
- **Upcoming card:** both names `--text`; both form bars `--viz-lead`; surfaces neutral;
  head/foot hairlines and the column divider are white 3.5% (founder Q1, reference). Market Signal drawer = `--card` on a
  `--edge-6` rule, fav % white, bars `--viz-lead` + `--viz-second`.
- **Card click targets (CHANGES_2026-11-11 A4; replaces the 2026-10-22 whole-card click):** the card root has **no** click,
  no pointer, no hover edge. The header row (surface · tournament · round · time · column labels) and each player row
  (avatar, odds, implied, form) open the analysis — Upcoming on Key factors, Completed on its landing tab (`mxLandingTab`) —
  with a pointer; the player **name** opens the profile (founder 2026-11-12: keep); the star toggles only; "Market Signal ▾"
  opens / closes its panel only; "See full analysis →" opens the analysis; the footer's empty space, anything in the open
  panel (except the Pro model row) and the odds-movement pop-up do nothing. The header row is the keyboard target
  (`role="button"`, Enter/Space, focus ring). The bug it fixes: a click beside "Market Signal" opened the card.
  **Test:** `test-match-card-click.mjs` (control: the pre-change page fails 9).
- **Completed card switches to Pinnacle once Oddspapi's close is held** (founder 2026-11-09, replacing "Open and Close
  from the card's ONE book" for finished matches): until then the card shows its book (Bet105 by the ladder) as below;
  once `m.pinClose.oddspapiClose` is on the card (`tools/apply-archive-pinclose.mjs`, from the archive export) the whole
  card is Pinnacle — Open = the first pre-start pinnacle+30 pair the archive holds, Close = Oddspapi's own close
  (`odds.md`), Move between them, one book — through `mcOddspapiCloseOcs` inside `_ocsOf`, so the card, the Move, the
  tiles and the Match analysis header read the same pair. The odds pop-up lists Pinnacle's history (founder 2026-11-09):
  the pipeline writes `pinnacle-ledger/{eventKey}.json` per finished card (`tools/pinarch.py card-ledgers`: the stored
  pinnacle+30 payload, active entries change-only, cut at the close's start, oriented to the card; refused when it does not
  reproduce the close), the pop-up's source `pinnacle` reads it (`price-history-box.js`); none published yet → "No price
  history yet", unreadable → "Price history unavailable". **Test:** `tools/test-apply-archive-pinclose.mjs` "card:" (no switch before the finish, without the
  flag or without an Open).
- **Completed card:** inset tiles (winner white 3.5% + 3px `--pos` 90% pill; loser name `--text-label` 600, never red).
  Surface `--text-soft`; round chip `--inner` + 10% inset edge, white (Q1). Score = sets-won tile (winner white 9% + 10% inset
  edge, white; loser white 4.5%, grey, no edge — Q1, README 7a) · 1px divider · one 24px cell per played set (won white 8% /
  lost 2.5%, one style always), each side's own tie-break points in the corner. Prices = `Open → Close · Move` on a
  38/14/42/44 grid, Open and Close from the card's ONE book (TEN-377 card 0b990217; `odds.md`); no journey bar; Close
  always white mono 15/700; Move signed on every row with both legs, older closes included (ruling 2 = stats only); no Move
  for a vendor-pinned open or a missing leg; missing leg = grey "—"; the Move is THE move formula `mxMovePct` (2-dp prices as shown, one decimal, true minus; a genuine zero reads `±0.0%` grey — founder card 9b1c3aa1, 2026-10-09, replaces the whole-percent `oddsPctDelta`), and so is the Completed Biggest market move tile and its ranking: the tile and the "Biggest move" sort rank EVERY close the cards show, older closes included (founder TEN-403 414de0fe; `odds.md` → Numbers), so the tile is always the largest drop a card prints (CHANGES_2026-11-11 B4: shortening side only), with that card's player. The odds pop-up's open → close
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
  name 700 white + "shortened" · v opponent · tournament round (ellipsis, never wraps). Shortest price: price
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
  The list re-orders by the **shortening side's** printed drop, biggest first (CHANGES_2026-11-11 B4: one definition of
  "biggest move" — a drift never ranks; a card where no side shortened is the 0% tier), then `—` cards in time order, then
  unpriced cards;
  **no card is dropped**. Click again → Odds · implied + Recent form in time order. The sort control reads `Sort: Move`
  while the view is on and `Sort: Time` when it is off (founder R1 nit; option text `Move`, internal key `drift`). The
  sort (`moveNowScore`) and the tile's pick rank on the SAME figure — the shown move below, not the unrounded
  |now / open − 1| — ties by earlier start, then time string; the tile names the player whose price shortened most, in the
  match the sort puts first. **While the view is on** the tile's open → now line ends, right-aligned, in "{n} of {N} matches
  moved" (B3; label ruled by the founder 2026-11-12: a price that moves moves its opponent's too, so the unit is the match): N = the day's cards with a measurable open → now pair, n = those whose shortening side fell 2%+
  (`MX_MOVE_MIN`) on the printed prices; no pair at all = a dash; count Plex 700 `--text`, words 12.5 `--text-label`, nowrap;
  tooltip "Matches where one side's price shortened 2% or more since open, out of matches with an open price"; the
  shortening-side 2% rule is kept (founder 2026-11-12). The move view's card grid track is **480px** (`#matchlist.mx-mv`; standard 360px), its header
  never wraps, carries no start time, and its tournament is `flex:none`, never cut (B2).
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
- **Prediction-market liquidity (founder 2026-11-01, re-adds what Step 15 removed, for this one figure):** under the six-row
  Market Signal grid, "Polymarket · $Y liquidity" then "Kalshi · $Y liquidity" — ONLY the match-winner market's liquidity
  (Polymarket's own figure for that market's book; Kalshi = every resting order on both players' markets, dollars), no traded
  figure. One rule above the pair. From `polymarket.json` / `kalshi.json` (pipeline steps), keyed by the card's event key, joined
  one-to-one on both surnames + initials and a start within 36 h. **A finished match shows the last read before its start**
  (`carryPreStart`: a read at / after the start is never shown — an in-play book is not the pre-match market; Kalshi empties a
  finalized market's book, measured 1 Nov), the hover names the read time. No liquidity → no line (never $0); a genuine 0 is
  "$0". **Test:** `test-polymarket-signal.mjs`, `tools/test-polymarket-volume.mjs` (carry), `tools/test-kalshi-volume.mjs`.
- **Market Signal drawer (review):** no explainer paragraph; a source without data is not drawn (no "—" rows, no empty bars);
  a group with no rows is not drawn; nothing at all → one grey line `No market signal for this match yet`. Caret ▾ closed /
  ▴ open (180° turn), white, font stack `'Hanken Grotesk', sans-serif` (system-ui drew a dot).
- **Market Signal ledger (founder design 2026-11-07, `design_handoff_todays_matches` CHANGES_2026-11-07 §2–§3; replaces
  the same morning's three-group build and the Completed "Price on {winner}" grid):** ONE ledger, eight rows in fixed order —
  Pinnacle · Bet105 · Bet365 | Elo Overall · Elo {surface} · Stennisfy Model | Kalshi · Polymarket — a `--sig-rule`
  hairline only before Elo Overall and before Kalshi; no group heads. Header = SOURCE (Completed "SOURCE · AT CLOSE") and
  each player's last name token centred over his two columns (Completed: winner `--text`, loser grey, "| = Pinnacle close"
  over the bar). A missing source is a dash row with its reason in the hover. **Upcoming:** the books' opens, Elo / model
  fair odds, the venue's current mid; the leaning side (≥ 50%) white 700. **Completed:** closes, stored pre-match Elo /
  model only (no Elo snapshot is stored today → dash), a prediction row only from a read the database froze before the
  start; the winner's side white 700; a white tick at Pinnacle's closing chance on every bar with data (none without a
  Pinnacle close); BEST ×2 = the book and the rating that gave the winner the highest chance (never a prediction market,
  never a blurred model). **Prediction rows:** the venue's mid for both players (`market_live_current`, joined by surname,
  one each, else a dash), scaled to 100%, as fair odds; nothing under the prices and nothing under the name — ONE sentence
  under the row across every column (CHANGES_2026-11-11 A5 / C4): "$29.8k traded · 593 trades · $18.1k on Sonego · $11.7k
  on Tabilo" (Hanken 10, `--text-label`, line-height 1.3, padding-top 2, `text-wrap: pretty`); no traded sum = no sentence;
  a dash row never has one; resting liquidity in the hover only. Not a match price: no price join
  reads it. **Model row:** Pro = hover wash, click opens the Stennisfy Model page; not Pro = blurred + lock, no click.
  **Test:** `test-ten377-todays-matches.mjs` (the ledger, both views), `test-market-live-signal.mjs`,
  `test-polymarket-signal.mjs`, `tools/test-market-live-recorder.mjs`, `tools/test-market-live-sql.py`.
- **Completed rail stops at Today; favourite cards open the match (founder design 2026-11-07 §1, §4):** on Completed the
  forward arrow dims at Today (supersedes 2026-10-30's paging past Today; Upcoming unchanged). A favourite mini card opens
  Match analysis on Key factors; its star only toggles. **Test:** `test-ten377-todays-matches.mjs` "§1/§4/§5".
- **Day tabs, date bar, move-view head (founder 2026-10-30, matches-day-tabs-datebar-drift; supersedes TEN-179's
  2026-09-09 `yesterday · today · +1 · +2` rail and the tabs keyed on the feed's Berlin `date`).** A match belongs to the
  **local calendar day of its start instant in the member zone** (`matchLocalDayKey`: `newsTz`, the start through
  `apiStartMs`); a record with no start (no time, or api-tennis's 02:00Z placeholder) keeps its feed date. The tabs, the
  Today divider, Completed and every `matchDayBucket` reader (Trading Report, Series) use that one rule. **Today under
  Upcoming** = today's cards, then a divider for the next local day and that day's cards — the same cards as its own tab;
  no next-day fixtures, no divider (`mxTodayPreview`). The time sort orders by the start instant. **Date bar = three
  days:** Upcoming `Today · +1 · +2` (Today leftmost), Completed `−2 · −1 · Today` (Today rightmost); ‹ › page one day at a
  time through every rail slot (−3 … +3), the window sliding to keep the selected day on screen (`mxRailWindow`). **A day
  the feed holds no fixture for** (Today and later) reads "Order of play for <Sat 31 Oct> isn’t published yet." and its
  header Updated and Live · loaded show the last pipeline run (`build-info.json` `data.builtAt`), never a dash. **Move
  view head:** one line — surface · event · round, then OPEN / NOW / MOVE over their columns — with no start time (a live
  card keeps its LIVE word); the default head is unchanged. **Test:** `test-matches-day-tabs.mjs` (a 00:30-local start
  lands on the next day's tab; mutants: feed-date rule, no preview, the four-day rail, a wrapping head).
- **Qualifying is shown, never hidden (founder 2026-10-31, publish-and-qualifying).** Neither card builder skips
  `event_qualification === 'True'`: a qualifying match is an Upcoming card and, once finished, a Completed card (founder
  "Yes, card them"; the Completed Upsets tile names its round the same way). The live-card alarm (`liveCardCheck`) counts a qualifier in play
  like any other match, and the Stennisfy Model page and the profile's Next match name its round through the same label
  (founder 2026-11-01). A card is qualifying (`boardQualifying`, `board-qualifying.js`) when the
  feed flags it, or when its event's OFFICIAL main draw (`draws.json`, joined through the ATP tier map
  `tools/points-at-risk/atp-tier-map-v1.json`) starts after the fixture's date and either both players are on the posted
  qualifying sheet or — sheet not posted — neither is on the posted main-draw sheet (the Paris rows of 31 Oct arrive with
  `event_qualification: null` and no round). The round slot reads `Q1` / `Q2` where the sheet gives the bracket depth
  (rounds = log2(qualifying size / qualifier places); the feed's "Final" = the last round), else **"Qualifying"**, never a
  guessed round. The raw `qualifying` field stays the feed flag the captures carry. **Chips:** a qualifying event has its
  own chip "<Event> · Qualifying" right after its main draw's (`mxTourKey`); the header Tournaments count = the distinct
  chips. **Test:** `tools/test-board-qualifying.js` (real rows: Basel / Vienna Q1 / Q2, Paris 14 of 14 qualifying with no
  round, the SFs main draw; 6 mutants).
- **Search shows both views (founder 2026-10-12, supersedes TEN-95's "the upcoming/completed split still applies"):** a
  typed player name drops the date (TEN-95) AND the Upcoming / Completed split, so the player's upcoming and completed
  matches on the board show together in either view. The active view's group comes first: Upcoming → upcoming / live
  (nearest first, no start last) then completed (most recent first); Completed → the reverse. Each card keeps its own
  layout. The tournament and surface filters still apply; with no search, the day and the split apply as before.
  **Test:** `test-matches-search.mjs` (the real `getFiltered`) + `tools/test-matches-search-mutants.js`.
- **Tournament chips (review):** one row on both views — `All tournaments` first (clears the selection), then one chip per
  event of the selected day. **Upcoming hides the row** when at most one chip besides All would show (a Qualifying chip
  counts as a second; CHANGES_2026-11-11 A11). **Test:** `test-todays-matches-1111.mjs`.
- **Bets today, empty (CHANGES_2026-11-11 A6):** one line, "0 bets today" — zero posted is a real 0; no second text, no
  divider. Loading or a failed read keeps the figure a dash (never a 0 from a read that did not answer). **Test:**
  `test-step15-matches.mjs`.
- **Completed tiles (CHANGES_2026-11-11 C2 / C3):** Market read's 30-day label "Last 30 days · right in {won} of {moved}
  moved matches" (`market-read-30d.json`: Pinnacle first Oddspapi tick → Pinnacle close within 60 min of the actual start,
  30 days, Davis Cup out; moved = the shortening side fell 2%+; right = the shortened player won) and "· small sample"
  under 3 moved (was "· thin"). Biggest market move = the **biggest drop** among the cards (B4: shortening side only, the
  card's printed Move ranks), line 1 `{open} → {close}` + the drop as a whole percent with a true minus in `--neg`
  ("−12%", Plex 12 / 600), line 2 `{name} shortened · v {opponent surname, particles kept} · {Tournament} {Round}`.
  **Test:** `test-todays-matches-1111.mjs`, `test-ten403-matches.mjs`. The 30-day figure stays on the page even below half
  (founder 2026-11-12: 56 of 128 = 44% on 11 Nov, "Yes").
- **Results keeps two columns (founder 2026-11-12, closes C5 "three columns"; FAV removed instead).** Measured 12 Nov at
  1512px on the live grid: three columns make a 438.7px card whose row is 420.7px; after padding 20, gaps 36, the score
  cluster, the 1px rule and the 150px Open · Close · Move block, the name gets **48.6px** on a best-of-3 card (cluster 121px)
  and **nothing** on a best-of-5 card (cluster 175px: five 24px cells + 3px gaps). Names measured that day need up to 96px
  ("M. Kecmanovic"; "A. de Minaur" 81px), so three columns would cut names at both formats. Two columns leave 274px (best-of-3)
  / 220px (best-of-5). **Test:** a Results card name is never cut at 1512px (CLAUDE.md non-negotiable: names never truncated).
