# Odds — sources, ladder, cards, close

Applies to any task touching odds ingestion, pricing or odds display.
Hard invariants that apply everywhere are in the root `CLAUDE.md`.

---

## Sources

**Kibl — Bet105 (`feed_source_id` 171). PRIMARY.**
Free, no quota. Sharp book, affiliate partner. Match winner only so far.
**No history endpoint** — uncaptured prices are lost permanently, so the archive must run daily.
Every timestamp is **Kibl insert time, never book-post time** — label it that way everywhere.

> **Sports411 (id 43) is a different book** (sports411.ag, a Bookmaker EU clone), no longer entitled. Its rows keep the sports411 label and are frozen history — never relabelled as Bet105.

**Oddspapi — bet365 only. The only ageable Open/Close.**
5,000 requests/month, hard. ~53 units/day, ~44% at reset. Metered leg runs every 30 min.
Pinnacle and Bet105 are **not entitled** here — they 403 and still bill.
*Which bet365:* oddspapi's unqualified bet365, distinct from the nine country variants it lists separately (NJ, AR, BR, DE, ES, FR, GR, IT, NL). Which physical site it scrapes is unknown; oddspapi does not say. api-tennis's bet365 is the same book — 94.5% identical, n=820.

**api-tennis — Ultra, 2M requests/day. Fallback books + stored close.**
No timestamps on any price. Refreshes at least every 30 min (vendor-confirmed). 17 books claimed, 8 usually absent.
Their stored "last odds before start" **is** a usable Close: bet365 agrees with our trusted close to 0.06pp on ATP (n=199) and 0.08pp on Challenger (n=205); every other book sits 0.80–1.48pp away.
Wired as a **dash-filler only** — bet365 only, ATP and Challenger, never overriding an ageable close, labelled no-timestamp/no-lag-check. WTA and team events excluded.

**Tennis-Data.co.uk** — Pinnacle closes, ATP main tour, pre-2026.

---

## Book names

Vendor-confirmed abbreviations: `Sbo` = SBOBET, `Pncl` = Pinnacle, `Victor Chandler` = BetVictor.
Expand at **display only**; identity tests use `canon()`, never the display name.

**Always normalise before comparing across sources.** A literal match once reported WilliamHill (244 fixtures) and Pncl as absent books.

---

## Book ladder — TWO ladders, and which one decides the card

**1. The card ladder (`odds_card_state.book_rank`) decides which book a card shows.** It is set in the database, not the page:

> **Bet105 / Kibl (rank 1) > bet365 via Oddspapi (rank 2) > bet365 via api-tennis (rank 3) > other api-tennis books (rank 4)**

Bet105 is the **top** of this ladder. Test: for any fixture `odds-card-state.json` covers, the book it names is the one the card shows.

**2. The `matches.json` ladder** orders api-tennis books only, and only where the card state does not cover a fixture:

> bet365 > Superbet > Betano > Unibet > William Hill > Betfair > 1xBet > Pinnacle

SBOBET, Marathon and BetVictor rank **below every unlisted book** — SBOBET carries the widest margin measured (11.61%) and must never win a card on coverage alone. bwin is out. (Bet105 and Sports411 never appear on this ladder; they are not api-tennis books.)

---

## Card rules

- **One book per card, always.** Open, Now and Close all come from the same book; the hover names that one book on every slot. Test: every selected row of a match names one book (the publisher drops a match whose rows disagree, and counts it).
- **The whole-card book switch** (TEN-253, founder 2026-09-23) — `switch_tier()` in `ten225-kibl-card-state.py`. Books are tried in card-ladder order; the first book at the best tier wins **all three slots**:
  - **Completed:** (1) the highest-priority book with a **within-60 Close** on both sides, else (2) the highest-priority book with an **older last-seen Close** on both sides, else (3) the highest-priority book with anything, Close dashed.
  - **Upcoming:** (1) the highest-priority book with a current, non-suspended Now on both sides, else (2) the highest-priority book with anything, Now dashed. An Open is not part of the test. A Now is **suspended** when either leg is below 1.01 (incl. Kibl's 0.000 marker) or the pair's overround is over 20% — the same test the page applies, so a suspended Now switches the card instead of dashing it (the Baez case).
  - Priority is the order complete books are tried in, never a reason to dash. A dash means no book could fill that slot.
- **The card carries no status line; the price-history box carries book, time and history** (TEN-270, founder 2026-09-24T10:16Z — supersedes "every pre-match Now shows its book and its time on the card face" and the one-line native tooltip). Tests:
  - **No `.mc-nowsrc` line on any match card**, and cards in one grid row are the same height (`#matchlist` `align-items:stretch`, card = flex column, footer pinned to the bottom).
  - **Hover (or tap on touch) on a player's price opens the box** (`price-history-box.js`); it stays open while the pointer is inside; tap outside closes it. No native `title` on card prices (`mcTitleAttr` writes `data-pt`).
  - **Box, top to bottom:** header = the card's book + `● live` only while the stream is connected, writing and this page is subscribed to the card, else `last updated [time]` · **Closing odds** row first on completed cards (the card's existing Close) · price **changes** newest first, `DD.MM. HH:MM` in the page display zone (`newsTz`), bold price, change vs the previous price coloured with the Biggest-market-move classes (`.mc-drift.pos` up, `.neg` down) · gap rows `no data from – to` · `history recorded from [time]` when the recorded history starts more than one sweep (5 min) after the Open · **Opening odds** at the bottom (the card's existing Open, first sighting wins) with its book.
  - **Sources, per book and state** (founder 2026-09-24T23:09Z for bet365). Test: `PriceHistoryBox.cardData(m).source` in `test-ten270-price-history-box.mjs`.
    - **Bet105:** the `price_history(card_key)` RPC (poller archive + stream, deduped on side + Kibl time + price). Loaded on open, one card, cached for 60 s.
    - **bet365 upcoming** (no result, not live, and before `cardStartMs(m)`): `m.oddsMovement` as stored in the lazy odds shard `odds/{eventKey}.json`, every distinct price the 15-min capture sees at bet365's own tick times, with the source line `change times from bet365 · refreshed every 15 min` under the header. The box reads the shard itself, cached for 60 s (not the page's session memo). A shard that can't be read says `history unavailable — try again`; no shard or no series says `history not recorded yet`, never `no price change recorded`. An underway bet365 card (past its start, no result) is not upcoming: the shard isn't cut at the off.
    - **bet365 completed:** the post-match raw-archive history. Until that loader ships the box says `history not recorded for this book`; it never falls back to the shard.
    - Any other book: `history not recorded for this book`.
    - Everywhere: same-price re-inserts are not changes. Never interpolated; a missing value is a dash.
    - **History ends at the card's start** (`odds-card-state` `startTs`, the clock the Close is judged against): no row after it, and a gap is cut at it. A vendor row inserted after the off without a live flag never shows above the Close. A card with no `startTs` (no live start recorded) is not cut; it never falls back to the scheduled time, which would drop real rows before a late start.
- **The card-state key's date is the CARD's date** (TEN-270, founder 2026-09-24T10:16Z). `odds_card_state.match_key` = `DATE|a|b` where DATE is the board card's `date` (api-tennis, UTC+2) — never a vendor start time (Kibl's `scheduled_start` is UTC and sometimes a provisional listing hours away; oddspapi's start likewise). Both writers re-key with `ten225_names.rekey_rows_to_board()` before their upsert: exactly one board card with the same surname pair within ±2 days → its key; none → the vendor key stays (re-keyed once the card appears); two or more → kept and counted `rekey_ambiguous`, never guessed. Test: for every board card, the page's `ocsKeyOf(card)` finds its `odds-card-state.json` entry (`test-ten270-date-key.py`). The archive (`kibl_fixtures.match_key`, `kibl_line_observations`) keeps the vendor's own key.
- **UPCOMING and UNDERWAY:** Open + Now. **COMPLETED:** Open + Close. A Close column never appears on an unfinished match.
- **Decimals:** 3 below 1.10, but only where the third is non-zero — `1.012` stays, `1.020` reads `1.02`.
- **Header shows the oldest price on the board**, never the newest.
- **Biggest Market Move filters to movers only** — 0% and unpriced cards leave the view entirely.
- **No scoreline row on an upcoming card** unless the feed actually said something (live score, suspension, Retired/Walkover). No UNDERWAY chip, no INTERRUPTED chip — they break card symmetry and duplicate the score line.

- **Kibl stream → live Now** (TEN-270, founder 2026-09-24). Tests:
  - **Join (ruling 1):** a stream fixture joins a card when both players match (either order) and it is the ONLY such Kibl fixture within ±24 h of the card's start. A player matches (name ruling, founder 2026-09-24) when the card's FULL surname is the tail of Kibl's name — compound surnames whole: 'C. Ugo Carabelli' never matches 'Carlos Carabelli', 'P. Carreno Busta' never matches 'Pedro Busta' — and the card's first initial matches ANY of Kibl's given names ('D. Vallejo' = 'Adolfo Daniel Vallejo'). No initial or no given name is not a conflict. Code: `card_join.same_player()`. Two or more → neither, logged with names. Clock time is never a match condition — Kibl lists some matches at the day's first session, hours before the slot. Routing-key league is a cross-check only. Code: `kibl-stream/card_join.py` `pick()`.
  - **Pre-match only:** `betting_type_id` 1, `is_live` false, market 1, segment 1. In-play rows and 0.000 suspension markers never become a Now or a history point.
  - **Closing point:** the worker stops a card when our board marks it live or finished — not at its scheduled time.
  - **One book still:** the stream replaces a card's Now only when the card's SELECTED book is the stream's book, and only when its Kibl time is newer than the poller's. It passes the same suspended-pair test as every other Now. Test: a bet365-selected card never shows a Bet105 stream Now.
  - **Browser access:** the page reads `kibl_now_card` (prices) and the heartbeat row of `kibl_now_price`, with the publishable key, SELECT-only; `kibl_now_history` is not readable from the browser. Verify with `ten270-stream-now.yml` action `verify`.
  - **Realtime cost (founder 2026-09-24T08:58Z).** Tests, each in `test-ten270-now-stream.mjs` / `kibl-stream/test-now-worker.py`:
    - **One message per change:** only `kibl_now_card` (one row per card, both sides, each side with its own Kibl time) is subscribed to by the page; `kibl_now_price` stays published only until the `unpublish-price` action (after old-client tabs reload), then leaves the publication. The worker holds a card row `COALESCE_S` (1.5 s) after the first side moves so both sides ride in one row.
    - **Hidden tab = no subscription:** on `visibilitychange` to hidden the channel is left, the socket closed and the backstop stopped; back to visible, the table is re-read and the channel re-joined.
    - **"● live" means this page is receiving:** fresh heartbeat, broker connected, writes landing, tab visible AND the Realtime join acknowledged. A paused, refused or unjoined page shows the price with its real time, never "● live".
    - **Scope = pre-match cards ON SCREEN (founder 2026-09-24T10:16Z):** read from LAYOUT at each check (`getBoundingClientRect`, viewport ±150 px) — never from remembered observer state, because `renderMatches()` replaces every card element (the first viewport build, 3d6c5793, looped on exactly that and was reverted). Scroll, resize and list mutations trigger a check. A change after member input (wheel/touch/key/click) re-joins at once; a data-driven one is spread over 0–5 s. A repaint with the same cards on screen never leaves or re-joins; no re-scope while a join awaits confirmation; `● live` is judged on the keys actually joined. No card on screen → the channel is left (the socket stays open with heartbeats).

---

## Price guards

- **Missing = dash.** Never zero, never a plausible default, never a price from another book.
- **Suspended market:** overround > 20% suppresses and falls through the ladder. Dash only if every book is suspended.
- **Price floor:** strictly below **1.01** is suppressed. 1.01 itself is a real book minimum (1xBet, and a bet365 open). Marathon's 1.00 is a placeholder. bet365's 1.001–1.008 are genuine but extreme.
- **A 0% move requires two real observations.** A single sighting rendered twice is not a flat market.

---

## Close rules

**Close = last price before the *actual* start.**

Start-time ladder:
1. oddspapi `trueStartTime`
2. live-flip lower bound (last poll where the match was not yet live)
3. dash

**Never the scheduled time** — it lands after the real start 58% of the time (p95 11 min), and matches often start *early* (median 11 min, one case 14 hours).

Reject `trueStartTime` when `end − start > 6h` or `end < start`.

**Kibl Close = the last price SEEN before the actual start** (TEN-253 Fix 1, founder 2026-09-23). A row competes only if it is a real price (≥ 1.01), was **inserted before the start**, and **Kibl marks it `is_current`**. The winner is the one with the latest `min(last_seen_at, start)`, ties to the later insert; `close_ts` is that capped clock — **our** sweep clock, not Kibl's insert time, so it is published with `closeTsKind: 'sighting'` and never labelled vendor-insert. Test: a price still listed at the off closes at lag 0; a price never re-seen closes at its own sighting time.
- **Never a superseded row.** Kibl keeps superseded prices listed — the opener for the life of the fixture, and superseded non-openers after replacement (10 of 22 re-seen after a later row replaced them, run `35827198225`). Such a row caps to a perfect-looking lag 0 and would put an earlier price in the Close column. Exception: an opener that is **still** current (opened, never moved) competes normally.
- `inserted_on` is never the Close clock (it is Kibl's first-saved time). It survives only as the control arm `close_of_inserted_on()`.

**Oddspapi Close** = the line summary's close (reliable by construction, flag TRUE), else the book's last tick when `last_tick_is_prestart` is true against a resolved start (flag FALSE, even if that tick is within 60 min — the summary nulled it for a reason, e.g. the 21-day decay limb).
- ⚠️ **Known gap:** when the summary nulled the close AND the series carries any tick after the start, no older close is shown although a pre-start price existed — the summary stores the last pre-start tick's time but not its price.

**Within-60 flag** (`close_within_60`, founder ruling 2, 2026-09-23): TRUE when `close_lag ≤ 60 min` **and**, for a live-flip start, flip gap `≤ 300 s`. The 21-day archive-age limb does **not** apply to Kibl — it has no history, so every Kibl close is captured live.
- **Display:** every close is shown — within-60 normally, older **muted**, with the hover `"[book] · last seen X min before start"` (`Xh Ym` over 60). A dash only when no book held a real price before the start.
- **Numbers:** CLV, ROI, price movement, Biggest Market Move, upsets and every close-based sort read **only** within-60 closes (`_mcCloseDerivedOf`). Test: an older close changes no figure on the page. One older leg disqualifies the pair.

One-sided close = dash on both sides.

---

## Known open issues

- **api-tennis coverage collapse**, two events, ruled not our fault: 12 Sep books 13 → 9 with Superbet and Unibet to zero; 16 Sep broad fall, bet365 191 → 4 priced fixtures. SBOBET is the only book rising. Question to api-tennis drafted.
- **Davis Cup:** no book prices most rubbers (bet365 0 of 32 on api-tennis, 6.7% historically on oddspapi). Those dashes are a tier fact, not a defect.
- **Deploy leg** is ~26 min median, tick-only — now the binding term on freshness.
