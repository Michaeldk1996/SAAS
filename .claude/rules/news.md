# News page (founder step 10, TEN-409, 2026-10-09)

Applies to the News page block of `bsp-consult-dashboard.html` (`renderNews`, the `news*` helpers from "TEN-409 step 10"
to the Post intel section, `newsRenderComposer`, the `[data-page="news"]` CSS). Reference = `OFFICIAL VERSION 1.html` →
News, night, 1512px; the reference wins except where a rule says *(override)*. Design file: `News.dc.html` (its raw
hexes are legacy, read through `tokens.json → legacyColourMap`). Night only. Header = the shared 35b `.sfh`
(`app-shell.md`); no page rule restyles it. **Test:** `test-ten409-news.mjs` (each check names its mutation).

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
- **Categories are our mapping** (`newsClassify`, title keywords; the feed has no category field): Withdrawals &
  Injuries, Draws & Schedules, Match Reports (strong / weak evidence), else Tour News — every article lands in one of the
  four. Intel posts carry "Stennisfy Intel" and leave the list under any category filter.
- **Header stats:** Articles = the list after every filter; Players = distinct players across it (by key); Updated =
  `generatedAt` of `news-feed.json` (HH:MM, member zone, `--text-soft`; hover = full date-time), **never the clock**.
- **Source = the outlet's display name from ONE table** (`NEWS_SOURCE_NAMES`: espn-tennis → ESPN, tennis365 → Tennis365,
  ubitennis → Ubitennis, tennis-majors → Tennis Majors, bbc-sport-tennis → BBC Sport, guardian-tennis → The Guardian …); an
  id the table lacks prints as sent (`newsSourceUnknown` lists them). **Article text is verbatim**: title and body exactly as
  the feed sends them (paragraphs split on blank lines), including the feed's own closing "Based on reporting from …" line.
- **No time on an article** (founder card 28bd8fc2): `published_at` is api-tennis's 4-hourly batch stamp (:00–:03 past
  02/06/10/14/18/22 UTC), not the outlet's time, and a wrong figure is not shown — no time and no "—" in Reading or
  Compact. Day groups and the newest-first sort still read it. The title's hover says what it is: **"Added to feed DD Mon
  HH:MM"** (member zone; an intel note: "Posted …"). Follow-up **TEN-415**: `build-news-feed.js` reads the outlet's own
  publish time; then the time column comes back. **Test:** "No time on an article …".
  Unsourced = grey "—", never 0. A feed older than `NEWS_STALE_HOURS` (24) adds the stale line above the list.
- **Time zone:** `stennisfy.tz` (Account settings), else the browser zone — day groups, the "Added to feed" hover and the header's Updated (hover: date + time with seconds).
- **Post intel:** founder only (`isBspAdmin`: admin allowlist, re-enforced by `firestore.rules`); notes live in Firestore
  `intel_notes`; every signed-in member reads them in the feed (and H2H's Latest news). Cap 5: Publish is disabled with
  an empty Update or at 5/5 (a new note); Edit / Delete on the founder's session only.

## Behaviour (keep)
- Filters combine: tournament AND categories (multi-select, All clears) AND window (6h · 24h · 48h · 7 days, default 7
  days) AND search (title, players, tournament, body — not the source). The tournament menu lists only events with
  articles in the current window (a kept selection outside it still names itself).
- Reading / Compact persists to `stennisfy.newsView`. Reading: a **2-paragraph preview** (R1 fix 1); "Read more" opens the
  rest in place, "Show less" closes it — the same in an open Compact row. Compact row = **player · title · ▾** (grid 104 /
  1fr / 16, gap 12; no time column). One row open at a time; the **open row keeps its columns**, the title wraps and the
  body sits under the title column (left 116 = 104 + 12), max 68ch.
- **Empty state** (15 white + 13 grey): no filters → "No articles available. Last updated HH:MM:SS." (feed refresh);
  otherwise "No articles match these filters." + the responsible filter ("No results for “x”.", "No {cats} articles for
  {event} in the last {window}." …). "Try a wider date range." only when a wider window has results; "Clear search" only
  when a search is set. No auto-widening.

## Display
- Cards (article, Compact, composer): `--card` + `--top-light`, no outline, radius 12, padding 18×22 (Compact 4×16).
  Category tag `--inner`, radius 6, 4×9, Hanken 10.5 / 700 / 0.10em caps `--text-label`; no category colours.
- Segmented controls (categories, Reading / Compact) = the site's darker track as the reference draws it: track `--card`
  + inset `--edge-6`, padding 3, radius 10; selected `--inner` + `--edge-10`, white 700; idle `--text-label` 600.
- Drop-downs = the shared `sfDd` menu; the trigger takes the reference geometry (10×15, gap 8) and its small chevron: ▾ at
  12.5px white (the menu's ▼ hidden; review round 2 fix 1). *Note:* Database's `.db-caret` is ▼ 9px — not this page's call.
- Search and triggers `--inner`, no edge, radius 10; focus / composer-open = `--edge-16`. No blue rings or fills.
- Links *(override)*: Read more / Show less, Try a wider date range., Clear search = `--link`, underline on hover — the
  only `--link` on the page. Player and tournament names in the meta line = white 600, underline on hover.
- Body `--text-soft`, 14 / 1.7, max 68ch; times Plex Mono 11.5 `--text-label`; day labels caps 10.5 on an `--edge-6`
  hairline; Compact rows on `--line`. No green / red / amber, no surface colours. **Test:** "Colour check".
