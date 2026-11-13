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
- **Done once per report.** The item stores `templateText` + `voice {version, model, passed, total, failures}`; a later
  run reuses the stored rewrite while the template is unchanged. No key or a failed call = the template text, retried
  next run. `news-ticker-run.json` `voice` gives reports fully in voice X of Y and sentences passed.
- **Only what matters is printed (founder 2026-11-12).** The duration is always stored but printed only for a
  straight-sets win inside 60 minutes ("in just 58 minutes") or a match of 180+. "Broken when serving for the first
  set" names the set. A run of games is printed only with its turning point — from behind in the set ("from 3-5 down in
  the first set"), straight after being broken, the last 5+ games of the match — or at 7+. **Test:** "report: only what
  matters is printed".
- **What stood out, against the player's own baseline** (`standouts.mjs`; baseline = `surface-ratings.json`, his last 52
  weeks on the surface, else his career there, else last 52 on all surfaces, each from 30 matches; none = no
  comparison). A serve / return rate is news at 8 points from the baseline (10 on second serve / second-serve return),
  on enough points; counts are news by themselves (10+ aces, 5+ double faults, 30+ winners or errors, break points
  none faced / all or none saved from 3 / 8+ faced, 10 or fewer points lost on serve from 30+). Related figures share
  one sentence (serve, return, pressure, rally; at most 3 in the serve sentence); the baseline is named once per
  player, then "his usual N%". With nothing standing out the old stat line prints. The thresholds are the builder's
  defaults: the founder ruled "not tighter" (2026-11-12).
- **The loser gets one sentence: what went wrong** — at most his two worst numbers, nothing neutral or good; nothing
  bad enough = no sentence. **Test:** "standouts".
- **Opinion words are allowed (founder 2026-11-12), tied to a number:** each standout sentence carries a tone (good /
  bad / none) set by the code; a good-tone sentence may use strong, solid, clean, sharp, well, better, particularly
  (clutch only on break points); a bad-tone one shaky, poor, weak, error-prone, low, worse, struggled ("not clutch" on
  break points); no tone = no judgement word. **Test:** "voice: an opinion word passes only…".
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
  - **ATP is allowed (founder 2026-11-12: "we can use them now, we have an agreement" — it covers both ATP's website
    articles and ATP video / press conferences).** This replaces "ATP stays on the permission route; YouTube audio and
    the Tennis TV stream stay out". Still in force: no bypassing a technical block (atptour.com answered 403 to a plain
    request; founder 2026-11-12: "we do work around technical blocks, find a solution" — so ATP, and only ATP, is read
    by `tools/news-ticker/atp-reader.mjs` through a normal Chrome window on the Mac, the headshot job's route; registry
    status `browser`. It stores quoted words checked word for word on the page in `news-quotes/inbox-atp.json`, never
    article text; the collector takes those rows as checked, from atptour.com only. **Test:** "ATP reader"). Every other
    blocked outlet stays out. No login is ever entered,
    and a quote is word for word or not published (a transcription route needs the founder's ruling first).
    tennisformterminal.com stays out: nothing is fetched or copied from it; examples the founder pastes are read for
    format only.
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

## Tennis TV on-court interviews (founder 2026-11-12)
- **Source:** Tennis TV's on-court interview clips, under the founder's agreement with ATP. `interviews-worker/` (a Fly machine, no Mac) signs in, plays each clip in a real browser, records the audio it plays and transcribes it. It records until the clip has finished playing; a clip that did not finish is not kept.
- **What is published:** the player's answers only, one inbox row per answer in `news-quotes/inbox-ttv.json` (tennistv.com clip URLs only), each with a topic ("On the first set"). The interviewer's questions are never published. Obvious mis-hearings of names and tennis words are corrected (founder: "fix obvious transcription mistakes"); an answer that is not clearly heard is left out, never guessed.
- **On the News page:** the answers join the player's one card for that match; each reads `On the first set: "…"` with the source "On-court interview" linking to the clip. **Test:** `tools/test-news-ticker-live.mjs` "on-court interview inbox".
- **Timing (measured on 12 Stockholm clips, 8–11 Nov 2026):** Tennis TV posts the clip 7–24 minutes after match point, median 9. 12 of 19 played matches had one.
- **Automatic (founder 2026-11-12: "Publish automatically").** `.github/workflows/interviews.yml`, every 5 minutes from main: `tools/news-ticker/ttv-interviews.mjs list` reads Tennis TV's dated clip feed and keeps new singles interviews (last 3 days) whose title names exactly one player of that tournament on our board; the Fly worker plays and transcribes them; `ingest` asks the model for the player's answers with topics and publishes an answer only when **every word is in the transcript, in order** (the model may pick spans and punctuate, nothing else; a question mark, a replaced word or a reordered span drops the answer). Mis-hearings are fixed only from the fixed list `CORRECTIONS`. Rows go to `news-quotes/inbox-ttv.json`, state to `news-quotes/ttv-state.json` (a clip is tried at most 3 times; a failure sends one Telegram). **Test:** `tools/test-ttv-interviews.mjs`.
