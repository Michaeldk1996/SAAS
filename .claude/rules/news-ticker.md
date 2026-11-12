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

## Match reports — the template is the facts; the wording is Michael's voice, checked sentence by sentence (founder 2026-11-12)
- **The template report stays the source of truth** (`reportText`: one sentence per stored fact group). A model rewrites
  the sentences one for one in the founder's voice (`humanise.mjs`, pipeline only, key from Actions secrets); this
  replaces "template fill only, no model wording". Voice guide: Michael's PDF (never committed, never published).
- **Every rewritten sentence is checked against the template sentence it replaces** (`checkSentence`, a whitelist):
  every number, score, ordinal and "X of Y" is in that sentence with the same word after it, scores in the same order;
  only that sentence's players, in the same order; "He" only for the one player the sentence is about; every other word
  is the template sentence's own, a player's name, or `VOCAB` (neutral connecting words: no judgement, quantity or stat
  verb). So no "looked", "felt", rating or opinion can pass. **A sentence that fails keeps the template wording** (the
  card name as the full name in sentence 1, the surname after). **Test:** `tools/test-news-ticker-live.mjs` "voice"
  (17 bad rewrites each refused for its reason; one failing sentence falls back alone).
- **No commentary line** ("clutch", "solid"…): the founder's fact rule of 12 Nov outranks the voice guide's section.
- **Done once per report.** The item stores `templateText` + `voice {version, model, passed, total, failures}`; a later
  run reuses the stored rewrite while the template is unchanged. No key or a failed call = the template text, retried
  next run. `news-ticker-run.json` `voice` gives reports fully in voice X of Y and sentences passed.
- **Full name at first mention** = the standings name, only when it reads given name + the card's surname.
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
- **Outlet ruling (Michael, 11 Nov 2026, risk accepted):** the collector may read any outlet page served publicly to a
  plain request, whatever its robots.txt or terms say. `data/news-outlets.json` keeps each outlet's clause and records
  "allowed by Michael's ruling, 11 Nov 2026". Limits, each a test in `test-news-ticker-live.mjs`:
  - **No bypassing a technical block:** 401 / 403 / 429, a CAPTCHA or bot-check page, a login or a paywall keeps the
    page out. One honest user agent; no proxy, no browser disguise, no headless browser.
  - **Only the quoted words, the speaker and the labelling context are kept.** Article text is never stored or
    published. Every item carries the outlet name and the article link.
  - **Polite rate:** one section request per outlet per run (every 30 minutes); an article page is fetched once
    (`news-quotes/fetched.json`), at most 6 new articles per outlet per run.
  - **Off switch:** `"enabled": false` on a registry entry stops collection and hides that outlet's items on the next
    run (the one case an item leaves the feed).
  - ATP stays on the permission route (read only through the tournament sites under `tournamentSites`). YouTube audio,
    the Tennis TV stream and tennisformterminal.com stay out.
  - `tools/news-ticker/probe-outlets.mjs --write` re-reads every section and sets `allowed` / `blocked` (technical).
- Read for a tournament: its tournament site, the host country's outlets, the home countries' of the players in the
  draw, and the international group.
- **Speaker = exactly one player of that tournament's field, named directly at a said-word outside the quotation.** A
  capitalised word before the surname must start with the player's initial ("siger Aneke Rune" is not H. Rune); a
  possessive or "the coach of Rune" is nobody; two players at said-words is nobody; a language with no said-word list
  yields nothing. A quote that names nobody is skipped.
- Non-English quotes are translated in the pipeline only (key in Actions secrets), original kept, `translated: true`.
  Checks: same sentence count, every name and number present in the original. If the same quote exists in English, the
  English one is published only. Second-hand renderings (a Swedish print of English speech) are published, marked
  translated. The same quote from two outlets is one item (`alsoReportedBy`).
- ATP report text is published on Michael's word that ATP's written permission is being obtained (2026-11-11).
- No X API (founder 2026-11-11); X commentary will be manual in a later task.

## Tour-wide quotes: press interviews and injuries (founder 2026-11-12)
- **The collector reads every allowed outlet on every run, for every ranked ATP player** (this week's top 200,
  `player-index.json`, plus every player on a tournament board), tournament week or not. One pass; one section request
  per outlet per run as before. **Test:** an article that names no tournament still yields its quote (control: the
  tournament reader drops it) — `tools/test-news-ticker-live.mjs` "tour-wide".
- **Routing.** A quote goes to a tournament's file when its speaker is in that field AND the article names the event
  (published inside the edition); else to `news-quotes/tour-<season>.json` → `news-ticker/tour-<season>.json` ("ATP
  Tour") when the speaker is ranked and the article is at most 3 days old; else nowhere. Every quote rule above
  (verbatim on the original text, exactly one speaker, translation checks, one item per quote) applies unchanged.
- **Tags** (`quoteCategory`): a quote whose English or original text names an injury → `Injuries`; one tied to a finished
  match → `Quotes`; any other → `Interviews`. **Test:** "back" alone is not an injury; the original-language text counts.
- **A standings name becomes "I. Surname" on its last word** (a particle kept: "A. De Minaur"). A double surname the
  press writes in full is missed, never misattributed. A player on a board is matched on his card's name.
- **A quote the model could not translate is retried:** its article is read again on a later run, at most `RETRY_MAX`
  (6) times — the one exception to "an article page is fetched once". **Test:** "polite rate" (the re-read, once per failure).
- **Not built (founder 2026-11-12):** ASAP Sports transcripts are dropped. Instagram goes through Meta's official API
  only (Business Discovery), never the site.

## On the News page (founder 2026-11-12: "it needs to be there in news")
- Every ticker item shows on the News page with the articles: rules in `news.md` "Ticker items".

## Alerts — pipeline Telegram chat
- A day with finished ATP matches and 0 reports (one message per day).
- The quote job failing; no new quote for 24 hours while a tournament is on (one message per 24 hours).
- A model call failing on credit or key, on the first failure of a streak.
