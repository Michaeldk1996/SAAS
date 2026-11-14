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
- An item whose match left the board is kept. Nothing is removed. **A published report keeps following the current
  report rules while its match data is on file** (founder 2026-11-13): a finished main-draw match off the board is
  rebuilt from the draw store's frozen board row (`draw-matches.json`, 16 days); a report with no data left
  (qualifying) only has its names turned into surnames. The store never adds a report, a status item or a tournament.
  **Test:** `tools/test-news-ticker-live.mjs` "a report whose match left the board…".
- Built inside every pipeline run from the files that run wrote; committed back (`bsp-bot`, `[skip ci]`).

## Match reports — written automatically as a full report, from the fact sheet only (founder 2026-11-14)

"The goal is to make it automatic": the published report reads like the founder's hand-written ones — what kind of match
it was, the match in playing order, the numbers that explain it, one or two quotes, "All in all," and the next opponent.
`tools/news-ticker/compose.mjs`; pipeline only (key from Actions secrets).
- **The fact sheet is the only source** (`factSheet`): the result, head to head, the breaks / break points / set and match
  points in playing order (`setStory`, only when the whole point log agrees with the final score), the box score per
  match and per set, the shot numbers (serve quality, unreturned serves, return quality, baseline and long-rally gaps, and — founder 2026-11-14 — forehand / backhand winners and unforced errors, with "the best shot" named from 10 winners and 1.5 times the other wing, "most of his errors" from 12 and 1.5 times; thresholds are ours, `BEST_SHOT_*`), what was seen in the match, the winner's earlier rounds and
  the next opponent's (`pathLines`), and the two players' own quotes about this match (`matchQuotes`).
- **Published only when it passes the check** (`checkComposed`). **Test:** is every number, score, capitalised name and
  quotation of the text on the sheet? A quotation is word for word, whole sentences, with its speaker named in the words
  leading into it; a word about a shot, the body, nerves, a title, a season or the conditions (`RISKY`) needs a sheet line
  with that word (a quote does not count); no first person, no named source, no initial, no question, one "(!!!)" at
  most; the last paragraph starts "All in all,". One retry with the reasons; a second failure keeps the older report
  (template + voice, below) and the same facts are not sent again. The check cannot read meaning: it keeps anything NEW
  out of the text.
- **Written once per fact sheet** (`composed {version, sheetHash, status, runs, body}` on the item): new facts (a later
  quote, the next opponent) write it again, at most `MAX_COMPOSE_RUNS` (3) times and only within `COMPOSE_FRESH_HOURS`
  (36) of the match; `COMPOSE_VERSION` rewrites every report on file. A run writes at most `NEWS_COMPOSE_MAX_CALLS` (6)
  reports, 2 of them kept for matches that have just finished.
- **Added by code, never by the model:** the physical paragraph (before the verdict) and the closing line per player
  (`assemble`).
- **Test:** `tools/test-news-compose.mjs` (a real match frozen from the live site; every "refuses" check is a mutant of a
  passing text). Read-only measurement on live data: `tools/news-ticker/compose-probe.mjs`.

The sections below describe the older report (template + sentence-by-sentence voice). It is what a report falls back to
when the full report could not be written or did not pass its check.

## Match reports — the template is the facts; the wording is Michael's voice, checked sentence by sentence (founder 2026-11-12)
- **The template report stays the source of truth** (`reportText`: one sentence per stored fact group). A model rewrites
  the sentences one for one in the founder's voice (`humanise.mjs`, pipeline only, key from Actions secrets); this
  replaces "template fill only, no model wording". Voice guide: Michael's PDF (never committed, never published).
- **Every rewritten sentence is checked against the template sentence it replaces** (`checkSentence`, a whitelist):
  every number, score, ordinal and "X of Y" is in that sentence with the same word after it, scores in the same order;
  only that sentence's players, in the same order; "He" only for the one player the sentence is about; every other word
  is the template sentence's own, a player's name, or `VOCAB` (neutral connecting words: no judgement, quantity or stat
  verb). So no "looked", "felt", rating or opinion can pass. **A sentence that fails keeps the template wording** (the
  card name as the surname). **Test:** `tools/test-news-ticker-live.mjs` "voice"
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
- **Surnames only, also at first mention** (founder 2026-11-13; replaces "full name at first mention"): "Fritz beat
  Norrie", never "Taylor Fritz" or "T. Fritz" (`surnameOf`: "A. De Minaur" → "De Minaur", "J-L. Struff" → "Struff").
  A first name in a rewrite is not in the facts and fails the check; a report the voice step did not reach prints the
  template with surnames. **Test:** `tools/test-news-ticker-live.mjs` "voice" (a first-name rewrite refused).
- **A report is paragraphs** (blank line between): the match, what was seen, the physical paragraph, then one closing
  line per player. **Nothing in it names a source** (no "the card", "the commentators") and **nothing is from after
  the match**. Simple words, no idioms, never "I" or "we".
- **Closing line per player, winner first** (founder 2026-11-13): `Fritz: performance rating 8.8 | W: 31 / UE: 17 |
  DR: 1.40`. The rating is the broadcast card's; winners, unforced errors and the dominance ratio (return points won %
  ÷ (100 − service points won %)) are OURS (api-tennis). A missing part is left out; nothing to print = no line
  (`ratingLines`). **Test:** `tools/test-match-cards.mjs` "closing line per player".
- Every number is a stored field or a count of stored rows; a clause with nothing behind it is not written.
  **Test:** no box score and no point log → the first sentence alone; a null is never printed as 0.
- **Break points:** the box score's count, else the point-by-point count. "faced no break points" prints only from a
  usable point log that shows zero. **Test:** a walkover gets no report; a missing or empty log prints no break-point
  clause for a blank box score (`test-news-ticker-live.mjs` "a walkover gets a status item and NO report", "a missing
  or empty point log never prints").
- Point-by-point fact definitions are in `tools/news-ticker/pbp-facts.mjs` (header). **Longest run prints at 4 or more**
  (founder 2026-11-11), never when tied.
- Head-to-head reads "for the Nth time in M meetings" from the one H2H list (`h2h-core.js`); main draw only.

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

## Reading a quote card (founder 2026-11-13)
- **Every quote says what it is about.** A press quote carries a topic label ("On a possible ATP tournament in Copenhagen") written by the model from the quote and the article text around it, shown in front of the quotation marks. It is our label, never the player's words; the quote itself is untouched. Asked once per quote; a label that is not "On …" (≤ 60 characters) is not used. Quotes held from before are labelled 12 per tournament per run.
- **Order inside a card:** the on-court interview first, in the order of the match (the start and first set, moments in the match, the match as a whole, his game, his body, his season, the tournament, what is next: `newsTopicRank`), then what he told the press, oldest first. Never the longest quote first.
- **A withdrawal is named.** A quote dated on the day the speaker gave a walkover reads "after withdrawing before his match against X" (his opponent's: "after X withdrew before their match"), from our own fixture status. **Test:** `tools/test-news-ticker-live.mjs` "a press quote gets a topic label…" and "card order…".
- **The physical paragraph (founder 2026-11-13; replaces "one sentence at the end").** A match with a timeout in
  `mto-matches.json` (the MTO archive, built before the ticker in `pipeline.yml`) gets its own paragraph: "Physically,
  it is something to follow." + who called it and the score in the set ("Ruud took two medical timeouts: at 5–6 in the
  first set and at 0–0 in the second set.") + his own on-court words about his body, word for word, or "We do not know
  the reason." (the reason is not in our data and is never guessed) + what to follow: "Something to follow up for the
  next round." for the winner (not after a final), "Maybe something to follow up for the next tournaments of X." for
  the player who is out (`mtoSentences`, `MTO_BODY`). Added after the voice step, never rewritten. **Test:**
  `tools/test-news-ticker-live.mjs` "a medical timeout is named…".
- **From the broadcast card (founder 2026-11-13: "serve quality, unreturned serves, return quality, performance rating,
  and … high difference of over 9 shots won, and also from the baseline").** Printed only when it says something
  (`shotSentences`; thresholds are the builder's, not ruled): a serve quality from 8.5 or 35%+ unreturned serves; a
  return quality from 8.0 ("returned very well") or under 6.0 ("not his best return performance"); a baseline gap of
  10+ points; a long-rally (over 9 shots) gap of 6+. The loser gets one sentence at most. Wing winners / errors and net
  points are not printed. The card is verified against our score, serve figures and break points as before; its wing
  counts are also compared with our totals (W = aces + forehand + backhand winners, UE = forehand + backhand unforced +
  double faults) and the gap is stored — never a reason to drop a card. **Test:** `tools/test-match-cards.mjs`.
- **What was seen in the match (founder 2026-11-13; check loosened 2026-11-14: "don't make it so strict and check all
  the info you receive, from there on we decide how strict we will become").** The same job transcribes each finished
  match's 10-minute Tennis TV highlights (`video-type:match-highlights`, at most 3 per run) and a model writes three to
  six plain sentences of what happened (how each played, which shot worked, turning points, the body, conditions). It
  is our own observation. **Test:** refused only for a quotation, a named source, "I" / "we", or its length
  (`commentaryCheck`); a number or a name the transcript does not carry is KEPT and listed beside the summary
  (`notHeard` in `news-quotes/commentary.json`), and a refused summary is kept with its reason in the clip's state
  (`commentaryRejected`, `commentaryWhy`) so it can be read. A clip an older check refused is read again once
  (`COMMENTARY_VERSION`). "Nothing worth reporting" publishes nothing. The summary is a fact-sheet line of the full
  report (and its own paragraph in the fallback report). The strictness is to be re-ruled from this output.
  **Test:** `tools/test-ttv-interviews.mjs` "commentary…".
