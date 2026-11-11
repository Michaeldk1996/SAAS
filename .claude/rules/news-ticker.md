# News ticker — live feed, quotes, alerts (founder briefs 2026-11-11)

Applies to `tools/news-ticker/`, `data/news-outlets.json`, `.github/workflows/news-quotes.yml`, the "Build news ticker"
steps of `pipeline.yml` and `supabase/migrations/20261111090000_live_match_end.sql`. No page reads the feed yet (the
ticker page comes through Claude Design). Tests: `tools/test-news-ticker.mjs`, `tools/test-news-ticker-live.mjs`,
`tools/test-live-match-end.py`.

## Scope
- ATP singles, main draw and qualifying, every tournament on the board. **Test:** a doubles card, a non-ATP card and an
  unfinished card produce no item.

## Feed files
- `news-ticker/<tournamentKey>-<season>.json` holds every item of one tournament edition, permanently;
  `news-ticker.json` is the index (one line per tournament + the newest 40 items). The site never loads the history.
- **An item, once published, is never rewritten unless its source data changed.** **Test:** a second build on the same
  inputs writes no file; a changed input rewrites that item only, keeps `publishedAt`, stamps `revisedAt` + `revision`.
- An item whose match left the board is kept. Nothing is removed.
- Built inside every pipeline run from the files that run wrote; committed back (`bsp-bot`, `[skip ci]`).

## Match reports — template fill only, no model wording
- Every number is a stored field or a count of stored rows; a clause with nothing behind it is not written.
  **Test:** no box score and no point log → the first sentence alone; a null is never printed as 0.
- **Break points:** the box score's count, else the point-by-point count. "faced no break points" prints only from a
  usable point log that shows zero. **Test:** a walkover gets no report; a missing or empty log prints no break-point
  clause for a blank box score (`test-news-ticker-live.mjs` "a walkover gets a status item and NO report", "a missing
  or empty point log never prints").
- Point-by-point fact definitions are in `tools/news-ticker/pbp-facts.mjs` (header). **Longest run prints at 4 or more**
  (founder 2026-11-11), never when tied.
- Head-to-head reads "for the Nth time in M meetings" from the one H2H list (`h2h-core.js`); main draw only.
- No rating, no opinion line, no commentary.

## Times
- **Timestamp = the observed match end; where none was observed, the scheduled start, labelled `scheduled`.**
- **Duration prints only when both ends were observed** by the live poller: start = `play_seen_at` with the live flag
  on an earlier tick; end = `live_match_end.decided_seen_at` with `last_undecided_seen_at` at most 120 s before it.
  Never estimated. **Test:** a match first seen already decided, or a gap around the end, has no duration.
- A run whose time read fails keeps the times an item already holds.

## Quotes
- **A quote is verbatim from its source or it is not published.** The check runs on the original-language text of the
  fetched page; a failing item is dropped and counted, never repaired.
- **Only outlets marked `allowed` in `data/news-outlets.json` are fetched.** allowed = robots.txt permits a generic
  automated client and the outlet itself permits retrieval or reuse. A general "no reuse without consent" clause is
  `unverified` until Michael rules. Changing a status is an edit to that file with the clause quoted.
- Read for a tournament: its registry tournament site (ATP daily reports), the host country's allowed outlets and the
  home countries' of the players in the draw.
- Speaker = exactly one player of that tournament's field; a quote that names nobody is skipped.
- Non-English quotes are translated in the pipeline only (key in Actions secrets), original kept, `translated: true`.
  Checks: same sentence count, every name and number present in the original. If the same quote exists in English, the
  English one is published only. Second-hand renderings (a Swedish print of English speech) are published, marked
  translated. The same quote from two outlets is one item (`alsoReportedBy`).
- ATP report text is published on Michael's word that ATP's written permission is being obtained (2026-11-11).
- No X API (founder 2026-11-11); X commentary will be manual in a later task.

## Alerts — pipeline Telegram chat
- A day with finished ATP matches and 0 reports (one message per day).
- The quote job failing; no new quote for 24 hours while a tournament is on (one message per 24 hours).
- A model call failing on credit or key, on the first failure of a streak.
