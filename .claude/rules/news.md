# News page v3 (founder 2026-11-19 / 2026-11-20, handoff `design_handoff_news_2026-11-20`; replaces the TEN-409 step-10 look)

Applies to the News page block of `bsp-consult-dashboard.html` (`renderNews`, the `news*` helpers from "TEN-409 step 10"
to the Post intel section, `newsRenderComposer`, `intelPublish`) and `news-page.css`. Reference =
`design_handoff_news_2026-11-20/reference/News.dc.html` + its `README.md` (diff: `CHANGELOG_2026-11-20.md`) (night only, high fidelity): every size and colour is the
export's own, as `--news-*` tokens in `tokens.css` read by `news-page.css` only. The page draws its own header card (not
the 35b `.sfh`; `test-ten403-header.mjs` lists it beside Stennisfy Model). **Test:** `test-ten409-news.mjs` (each check
names its mutation). Measured against the reference in Chrome on the same match (Zverev v Fils), 2026-11-20: at 1440 the
header card, its stats, Reset filters, the Reading report card (590) and box (479) and every text element in them, the
Compact row (54) and the opened report (535, box 540×450) equal to the pixel; at 800 the box (560×370, one column) equal.

## Data
- **One feed: `news-feed.json`** (`build-news-feed.js`, api-tennis `get_news`), the same `_newsData` as Match analysis →
  News. An article shows the same title, time and source wherever it appears. A failed fetch with no last-good data =
  "News feed unavailable." + "Last checked HH:MM:SS."; before the fetch settles, "Loading news…".
- **Player-attributed articles only (standing founder ruling):** an article shows only if it carries a `player_key`
  (written by the builder's fail-closed resolver). The page never reads a headline for a name — no `newsPlayerFor`
  fallback here — and tournament-only articles do not come back as a "bug fix". **Test:** "Data 2" (the page's
  `newsPlayerFor` stub throws).
- **No sample article, ever.** The design file's 14 "Sample: …" articles and `window.STENNISFY_NEWS` are not ported;
  an empty feed shows the empty state. ASAP quote rows are not on this page (one feed). **Test:** "Data 3".
- **Names:** a player = the Player Profile name of his key (`playerProfiles[key].name`, else the feed's `player_name`,
  the same roster spelling). A feed player opens Player Profile (`psOpenProfile`) when he has a profile. An intel post's
  player is plain text.
- **Tournament = the article's own text, never the feed's `tournament_name`** (founder cards 91aec78c + 28bd8fc2 and review
  round 2, 2026-10-09; api-tennis tags an event the article only mentions, so the field stays in the data, unread).
  `newsArticleEvent`: out-of-play names are dropped first (founder card 78a3685b); **the title decides** when exactly ONE
  in-play event is left (a title with two in-play events never decides); otherwise **the first paragraph decides** on the same
  test; else no tournament. "Cobolli Falls Early in Beijing But ATP Finals Hopes Remain Strong" → China Open while the Finals
  are weeks away.
  - **In play** = played within 14 days of the article's date (`published_at`), before or after (`NEWS_EVENT_WINDOW_DAYS`).
    The event's dates = this year's edition in `tournament-profiles.json` (first → last match on record), else its latest
    edition moved to the article's year; no dated edition = never in play. Until that store loads no article has a
    tournament (the page re-renders when it lands; never a guess). "Melbourne" in October tags nothing.
  - **Names** = `TOURNAMENT_CATALOG` cities / slam names + `SF_EVENT_NAMES` official names + `NEWS_EVENT_SHORT` (Melbourne,
    Flushing Meadows, Roland-Garros, Monte-Carlo, Queen's, ATP Finals, Bercy, Kitzbühel, Montréal); exact, case-sensitive,
    whole-word; a phrase two events share ("Canadian Open") names neither; French Open / Roland Garros are one event.
  - Printed as the Tournaments page prints it (`tourxEventName`); opens Tournaments → Overview on that event when its
    registry holds it, else plain text. No tournament → meta line = category · source · players (no placeholder), no
    drop-down entry. Search still covers the body.
  - Measured 9 Oct 13:00Z feed: 29 of 38 keep one (25 title, 4 first paragraph).
  **Test:** "Tournament: exactly one event named …". Follow-up TEN-413: the builder attaches the article's own event.
- **Four categories, single select** (v2 §2): Match Reports · Quotes · Withdrawals & Injuries · Tour News; the switch reads
  "All" + these four; a click replaces the active one, a click on it returns to All. There is no Draws & Schedules: what
  `newsClassify` (title keywords) used to file there, and a ticker status item about a qualifier or lucky loser, is Tour
  News. **Match Reports holds only the reports we write** (founder 2026-11-20): an outlet article that reads like a result
  and a posted note are Tour News (`newsOwnCat`); the composer offers Quotes · Withdrawals & Injuries · Tour News. An intel
  post takes the group chosen in the composer (an older note: Tour News); there is no Stennisfy Intel category. **Test:** "Four categories, single select".
- **Header stats** (v3 §2, the Today's Matches / Players style): caps label 10.5/700 over a mono 15/700 value, right
  aligned, gap 30, no boxes. Articles = the list after every filter; Players = distinct players across it (by key); Updated =
  `generatedAt` of `news-feed.json` (HH:MM, member zone; hover = full date-time), **never the clock** (the reference's clock
  is its placeholder).
- **Source = the outlet's display name from ONE table** (`NEWS_SOURCE_NAMES`: espn-tennis → ESPN, tennis365 → Tennis365,
  ubitennis → Ubitennis, tennis-majors → Tennis Majors, bbc-sport-tennis → BBC Sport, guardian-tennis → The Guardian …); an
  id the table lacks prints as sent (`newsSourceUnknown` lists them). **Article text is verbatim**: title and body exactly as
  the feed sends them (paragraphs split on blank lines), including the feed's own closing "Based on reporting from …" line,
  with HTML codes decoded ("didn&#039;t" → "didn't", `newsDecode`). No source is shown anywhere on the
  page (founder 2026-11-19).
- **No time on a feed article** (founder card 28bd8fc2, kept over the reference's time): `published_at` is api-tennis's
  4-hourly batch stamp (:00–:03 past 02/06/10/14/18/22 UTC), not the outlet's time, and a wrong figure is not shown. Our
  own items (reports: the observed end; quotes: the outlet's publish time; posts) carry a real time and show it first in
  the sub line. Day groups and the newest-first sort still read it. The title's hover says what it is: **"Added to feed DD Mon
  HH:MM"** (member zone; an intel note: "Posted …"). Follow-up **TEN-415**: `build-news-feed.js` reads the outlet's own
  publish time; then the time column comes back. **Test:** "No time on an article …".
  Unsourced = grey "—", never 0. A feed older than `NEWS_STALE_HOURS` (24) adds the stale line above the list.
- **Time zone:** `stennisfy.tz` (Account settings), else the browser zone — day groups, the "Added to feed" hover and the header's Updated (hover: date + time with seconds).
- **Post intel** (v2 §6): founder only (`isBspAdmin`, re-enforced by `firestore.rules`); notes live in Firestore
  `intel_notes` (`text`, `player`, `playerKey`, `cat`, `tour`). **A player picked from the player search is required**
  (`intelPlayerHits`: this week's standings + every player on the page, up to 8 hits, with his tournament = his newest
  article's, else his board card's, else "No tournament this week"); a free-typed name is never accepted. The group switch
  (default Tour News) is the post's category. The foot names where it goes ("Goes to the top of today in Group · Player ·
  Tournament"); Publish now is blue only when ready. Cap 5. **Edit** takes the post out of the feed and reopens the composer
  with its text, player (by its stored key) and group; Delete removes it. **Test:** "Post intel".

## Ticker items (founder 2026-11-12: "it needs to be there in news, that's a bit our ticker")
- **The feed = the articles + the news ticker's items** (`news-ticker.json` → the tournament files with an item in the
  last 8 days; `loadNewsTicker`, `newsTickerItems`). This amends "One feed": the ticker is our own data and verbatim
  player quotes, never a sample. A failed ticker read shows no ticker item; a failed article feed still shows the ticker.
- **Report** → category Match Reports, title "{winner} beat {loser}, {score}", head = both players, winner first (v3: two
  avatars and "A · B" in Reading; the Compact row two avatars and the winner's name), sub line "time · Match
  Reports · 7-6 6-0 · event", body = the report. **The stats box** (v2 §4) = the item's `ms` rows (built by the feed build,
  `news-core.mjs` `msRows`: ours where we hold the figure, else the verified broadcast card; a row only with both figures;
  ordered on the page by ONE fixed list, `NEWS_MS_ORDER`, whatever the feed sends, older labels read through aliases):
  Dominance ratio across the box, then DOWN the left column Serve quality · Unreturned serves · 1st serve in · 1st serve
  points won · 2nd serve points won, then DOWN the right Return quality · Baseline points won · Ratio W/UE · Winners / point
  · Unforced / point (`columns: 190px 2`, one column under ~430px); no raw Winners / Unforced errors rows; text | 1px divider
  | box; leader = the higher figure (the lower on Unforced / point), white 700, the other grey 500, equal = both grey and no
  bar; the dominance ratio follows the same rule (no green / red); bar = 12 + |a − b| / max(a, b) × 88 % of the leader's half from the chip outwards; chip = the
  unsigned difference ("19 pts", "3", "0.4", "1.03", "Level"); only the dominance ratio spans both columns. With
  the box, the closing per-player lines leave the text (the box carries their numbers); no rows = no box, no divider, a
  plain text article. **Quote** → a quotes card (below). **Status** → Withdrawals & Injuries (walkover, withdrawal,
  retirement) or Tour News; title = the item's text. **Test:** "Match report", "Compact".
- **Quotes are one card per player per match** (founder 2026-11-12; v2 §3a; founder 2026-11-18/19 "5 or 6 blocks … not
  the same questions, same texts"): no headline; topic (13/700 grey) over his words (16.5 white), 3 shown then "Show n more
  topics"; the sub line says "n topics", never quotes; no quote marks, no outlet, no translation note. The card shows the
  quote job's **digest** (`news-ticker.md` "The quotes section") where one exists — at most 6 subject blocks, injury quotes
  included (no second card for the same match) — else the quotes as collected (80% word overlap = one statement). A quote
  tied to no match groups by player and day. **Test:** "Quotes card".
- An item with no text or no player is not shown. Names = the Player Profile name of the item's key; the event =
  `sfEventName`; a tour-wide quote carries no event.
- **Test:** `test-ten409-news.mjs` "Quotes card", "Match report", "Compact".

## Behaviour (keep)
- Filters combine: tournament AND category AND window (6h · 24h · 48h · 7 days · **All time**, default 7 days) AND search
  (title, players, tournament, body — not the source). "All time" (founder 2026-11-18, after the export: nothing leaves the
  archive) loads every tournament file. The tournament menu lists only events with articles in the current window.
  **Reset filters** (v3: a 34px lifted button, `--news-lifted` + 14% edge, white 600, hover `--news-hover`; right of row 2) shows only when a category, tournament, search or window other than 7 days is
  on, and clears them all. Opening one menu closes the other; a click outside or Escape closes it.
- Reading / Compact persists to `stennisfy.newsView`. **Read more** above 5 paragraphs (above 7 when the stats box has more
  than 6 rows): the card shows 4. Compact: one card per day; closed row = avatar + player · headline · "category · score |
  n topics" · blue ›; one row open at a time, the open row = card colour + 12% ring, its title wraps, a 184px-indented body
  (full width beside a stats box), a foot with the category pill and the event — **no source is named anywhere on the page** (founder 2026-11-19: "just don't mention our sources", over the export's "source · tournament"); no Close link — a second click
  closes it.
- **Empty state** (15 white + 13 grey): no filters → "No articles available. Last updated HH:MM:SS." (feed refresh);
  otherwise "No articles match these filters." + the responsible filter ("No results for “x”.", "No {cats} articles for
  {event} in the last {window}." …). "Try a wider date range." only when a wider window has results; "Clear search" only
  when a search is set. No auto-widening.

## Display
- Every value is the export's (`news-page.css`, README §1–§7): cards `--news-card` + 1.25px 6% white edge (radius 12 header
  / filter, 14 feed); pills, avatars and chips `--news-lifted`; wells (search, switch tracks, menu triggers, textarea)
  `--news-well` + 8% edge; hover `--news-hover`; switch tab on `--news-on` + 16% edge, white 700. Links, chevrons, bars and
  the ready Publish `--news-blue`; green / red only on "Won" and a dominance ratio by value. Avatars: initials over the
  player's photo where we hold one (`playerPhotoImg`, `player-photos.md`; the export draws initials only). The page sits
  in the portal ("embedded"): no ground of its own. **Test:** "Colour".
