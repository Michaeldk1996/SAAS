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

**Oddspapi — pinnacle+30 only (founder 2026-09-26, TEN-287 card 89e3671d; bet365 and plain pinnacle 403).**
5,000 requests/month, hard. Metered leg runs every 30 min. The subscription (`/v4/account`) carries `pinnacle+30` and nothing else: `bookmakers=bet365` → 403 "Restricted bookmakers: bet365", `pinnacle` → 403, `pinnacle+30` → 200 (measured 2026-09-26). One book per call — a batch with any non-entitled book 403s in full.
Tests (`test-ten295-chart-books.py`):
- `refresh-odds-history.py` `BOOKS == ('pinnacle+30',)`; both legs (the 3-hourly `main()` and the 15-min `--first-appearance`) write it ONLY to `m.oddsMovement.chart.books['Pinnacle +30s']`, never to `m.oddsMovement.books` (the model's field; "Pinnacle" there is the model's anchor key), and never touch `books`, `capturedAt`, `startTime` or `fixtureId`.
- The bet365-only paths (open-monitor, firstSeenAt OPEN pin, the legacy `books` write) run only while `'bet365'` is in `BOOKS`.
- The bet365 series already in `m.oddsMovement.books` is frozen history (last tick 25 Sep 22:34Z). It is kept and shown as "bet365 (Oddspapi, capture ended 26 Sep)".
- Still on bet365 and out of this rule until their own issue lands: `refresh-odds.py` (card `bet365Now`), `archive-bet365-history.py`, `archive-oddspapi-raw.py` and the post-match archive below — every bet365 call there now 403s.

**The bet365 post-match archive** (TEN-270, founder 2026-09-24/25: "Find a way to archive it straight after the game"; "Separate 15-min job … the live price loop always wins the key"). `archive-oddspapi-raw.py postmatch`, workflow `oddspapi-postmatch.yml`. Tests in `test-oddspapi-postmatch.py`; mutants reproducible with `python3 tools/mutate-ten270-postmatch.py`:
- **Target** = a board card with a result (`past-` id AND a `finalScore`), an oddspapi `fixtureId` in `odds-fixture-map.json`, no object in the bucket, and at least 30 min since this job first saw the result. It is pulled once and saved only when both sides' last match-winner tick is `active=False`; otherwise it is deferred (at most 8 runs, then left to the daily run).
- **Completeness check** (founder 2026-09-25: "30 min, and measure completeness on the first 20 pulls against a +24 h re-pull held outside the archive"). The wait stays 30 min. The first 20 fixtures the job saves get ONE re-pull ≥ 24 h after their pull, stored at `_meta/verify/{fixtureId}.json.gz` — the canonical object is never touched — through the same key gate and 429 rule. `_meta/verify/report.json` holds, per fixture and side: bet365 match-winner ticks pre-start / in-play (split at the card's `startTs`; dash when unknown), first and last tick time, whether every early tick is in the late copy, and ticks only in the late copy (pre-start / in-play). After 20, no more re-pulls. Read it with `oddspapi-postmatch.yml` mode=verify-report (read-only).
- **The daily raw archive yields the key too** (founder 2026-09-25: "Make it yield to the price loop the same way the post-match job does"). Before every `/v4/historical-odds` call `archive` needs `loop_idle()` and, also the :05–:14 window: `DAILY_YIELD_MODE=window`, ruled by the founder 2026-09-25 (`gate`, which drops the window, is available but not in use); when the key isn't ours it WAITS (polling every 20 s) inside its time budget and never exits for it. On a 429 it pauses 60 s and tries the same fixture again (up to 3 times), and the run continues. `keyWaitSeconds` and `http429` are in its heartbeat. Ordering, never-re-pull and the held check are unchanged. Test: section 12.
- **Same path as the daily raw archive** (`object_path()`), uploaded without overwrite; the daily `held_objects()` then skips it. A fixture the bucket holds — in ANY month folder — is never pulled again by either job. If the upload finds a copy already there, that held copy is the record and its ticks are the ones loaded.
- **Trigger: the pg_cron dispatcher only** (founder 2026-09-25: "install the dispatcher and remove the GitHub schedule"). `oddspapi-postmatch-pinger.sql` dispatches `oddspapi-postmatch.yml` at :07/:22/:37/:52 with the Vault secret `gh_postmatch_dispatch_pat` (stored by the founder; the `schema` action of `ten270-stream-now.yml` writes it only when the `POSTMATCH_DISPATCH_PAT` repo secret exists and never deletes or overwrites it otherwise). The workflow has **no** `schedule:`. Any install failure is a WARNING, never a failed schema apply. Test: section 8e / 13 of `test-oddspapi-postmatch.py`.
- **A failed dispatch is a visible alert, never a silent skip** (founder 2026-09-25T00:53Z). A checker job (:12/:27/:42/:57) reads `net._http_response` for the dispatcher's own recorded request ids and alerts on: a non-2xx dispatch in the last 45 min (401/403 = token expired or invalid), no 2xx dispatch in 45 min (once 45 min of history exists), or a pg_net timeout/error/no response after 10 min — at most once per condition per 6 h, plus a `RECOVERED` message. It sends to the Telegram ops chat (`bsp_alerts.py`'s bot, Vault `ops_telegram_bot_token` / `ops_telegram_chat_id`, copied from the `TELEGRAM_BOT_TOKEN` / `TELEGRAM_OPS_CHAT_ID` repo secrets). A send is `queued` until the next check resolves it from pg_net (`sent` on 2xx; `failed: HTTP n`, `failed: timeout/error`, `failed: no response` after 10 min). Without the Telegram secrets the alert is recorded as `unsent` and RAISE WARNING'd. `ten270-stream-now.yml` action=verify prints every alert not `sent` in 7 days and exits 1, and also exits 1 unless both cron jobs (`ten270-oddspapi-postmatch-ping`, `ten270-oddspapi-postmatch-check`) exist and are active, or when the alert log is unreadable. Hosts: `api.github.com` and `api.telegram.org` only. Test: section 13.
- **The loop wins the key.** An oddspapi call starts only (a) inside :05–:14 of a quarter hour with 30 s to spare, and (b) when `loop_idle()` says the odds loop is not using the key: busy if an `odds-now.yml` run is queued/pending/waiting/requested with none iterating, if one completed under 2 min ago, if the iterating run is ≥ 314 min old (its last iteration and the post-step `/v4/account` read), or if its `chore(odds): capture tick` commit is not on main since both the quarter hour and that run's start. Checked before every call; anything unreadable or malformed counts as busy.
- **429:** the first 429 stops the run with exit 0, no retry; the next run resumes. Every 429 is counted in the log and in `_meta/postmatch-last-run.json`.
- **404:** recorded in `_meta/postmatch-state.json`; after 3 runs with a 404 the fixture is not asked for again. Only a not-found reads as "no state yet": any other failure reading that object stops the run without writing.
- **Zero billable calls:** only `/v4/historical-odds` and `/v4/account`; `free_get()` raises on any other path, and the meter is read before and after the pulls.
- **Ticks:** bet365 cards only, into `bet365_mw_ticks` (RLS on, no policy, anon/authenticated revoked) in CARD orientation (`p1`/`p2` via the map's `orient`, checked against the card's names — a mismatch loads nothing), one row per change of price or active flag. Held bet365 cards the daily run archived are projected from the bucket with no oddspapi call.

**api-tennis — Ultra, 2M requests/day. Fallback books + stored close + 9 chart lines (Wave 2, below).**
No timestamps on any price. Refreshes at least every 30 min (vendor-confirmed; measured 26 Sep 03:55–09:13Z: prices moved in batches every ~30 min, 13 of our 64 five-minute polls saw any change). 17 books claimed, 8 usually absent.
Their stored "last odds before start" **is** a usable Close: bet365 agrees with our trusted close to 0.06pp on ATP (n=199) and 0.08pp on Challenger (n=205); every other book sits 0.80–1.48pp away.
Wired as a **dash-filler only** — bet365 only, ATP and Challenger, never overriding an ageable close, labelled no-timestamp/no-lag-check. WTA and team events excluded.

**Tennis-Data.co.uk** — Pinnacle closes, ATP main tour, pre-2026.

**odds-api.io — Superbet + Betfair Exchange, shown to members** (founder 2026-09-26, TEN-287 card 89e3671d: "show them to members now"; the ToS §9 written-consent risk is accepted by the founder). Our recorder `ten287_rec` (pg_cron, 30 s) holds them; the vendor has no history for Betfair Exchange, so that book is **self-recorded, forward only (from 26 Sep 2026)**. The book list is `ten287_rec.config.books` — a slot swap needs no code change.

---

## The odds-movement chart (Odds tab) — TEN-295, founder 2026-09-26

- **Chart-only field.** Every chart line is `m.oddsMovement.chart = {books: {label: {p1, p2}}, meta: {label: {source, group, clock, checkedAt}}}`. Test: after a writer runs, `m.oddsMovement.books` holds exactly what it held before, and the model's price for a fixed fixture is byte-identical (`test-ten295-chart-books.py`).
- **Books, labels, groups, clocks** (writers: `refresh-odds-history.py`, `build-chart-books.py` every 15 min in `odds-capture-loop.sh`):

  | Label | Group | Source | Clock |
  |---|---|---|---|
  | Pinnacle +30s (Oddspapi) — stored key `Pinnacle +30s` | Sharp | Oddspapi `/v4/historical-odds` | book tick |
  | Bet105 | Sharp | Kibl `chart_bet105_history(card_key)` — for EVERY board card: its selected Bet105 fixture, else its only Bet105 fixture (two or more → none), never one the orientation guard dashed; same rows and naming as the price-history box, pre-match only | Kibl insert |
  | Superbet | Soft | odds-api.io via `chart_book_series()` | vendor updatedAt |
  | Betfair Exchange (recorded by us) | Soft | odds-api.io, back price, polled by us every 30 s | recorded by us |
  | any other `config.books` entry | Soft | odds-api.io | vendor updatedAt, labelled "<book> (odds-api.io)" |
  | Pinnacle (api-tennis) | Sharp | api-tennis `Pncl`, via `chart_apitennis_series()` (Wave 2) | seen by us every 5 min |
  | Betano, 1xBet, BetVictor, Betfair Sportsbook (api-tennis), Marathon, bet365 (api-tennis), Sbobet, William Hill | Soft | api-tennis `Betano`, `1xBet`, `BetVictor` (alias `Victor Chandler`), `Betfair`, `Marathon`, `bet365`, `Sbo`, `WilliamHill` (Wave 2) | seen by us every 5 min |
  | bet365 (Oddspapi, capture ended 26 Sep) | Soft | legacy `m.oddsMovement.books.bet365` | book tick; checkedAt = `capturedAt` |
  | any other legacy `books` key (e.g. `Pinnacle`) | by name | legacy, always shown as "<key> (Oddspapi)" | book tick |

- **Coverage (founder 2026-09-26, TEN-295: "compare all bookmakers side by side … fix it for every match"). Test: every configured book is attempted for every board card.** Found on Damm v Hurkacz: Oddspapi and odds-api.io both list "Damm Jr, Martin", and the join keyed on "jr" (27 Oddspapi mapping misses since 24 Sep). The chart JOINS use `chart_series.join_key` = `name_key` after stripping a generational suffix (Jr, Sr, II, III, IV), in the Oddspapi fixture join (`refresh-odds-history.orient`, also used by the fixture mapper) and the odds-api.io join. `ten225_names.name_key` itself — the card-state key the page mirrors — is unchanged. The recorder RPC returns singles of ANY league (a doubles pair "A / B" is excluded); the tier filter dropped the Laver Cup exhibition.
- **odds-api.io join to a card:** both surnames (`chart_series.join_key`), either orientation, card date ±1 day of the vendor start, unique on both sides (two board entries with one event key are one card). Ambiguous or none → skipped and counted in the log. p1/p2 follow the card. Pre-match only: a tick counts while the vendor says `pending` and before the event's first non-`pending` sighting on any book. A pair with a side below 1.01 or an overround over 20% is a suspended market and gives no point.
- **checkedAt** is never later than the source's own read: odds-api.io = the recorder's last HTTP 200 poll of that book; Bet105 = the Kibl poller's last OK sweep; Pinnacle +30s = the run's successful read. Capped at the event's first live sighting and at the line's start cut. It only moves forward.
- **Start cut (review 2026-09-26):** every chart line ends at the card's ACTUAL start — `odds-card-state` `startTs` — else the source's scheduled start (Oddspapi fixture `startTime`, odds-api.io `start_at`). Exception: **Bet105** has no scheduled fallback — it is cut at `startTs` only, exactly like the price-history box it mirrors. No point after it is ever written, held points included (`chart_series.card_start` / `put_chart(cut_at=)`). Test: a Pinnacle +30s tick, or an odds-api.io tick before the vendor's live flip, after the start is not in the chart. On a late start the scheduled fallback can drop real pre-start points — a missing point, never an in-play one.
- **Completed cards:** the 3-hourly Oddspapi leg captures a completed card only when it holds no movement at all (a card with the frozen bet365 series is not re-targeted, so no new fail-loud exits). The free 15-min sweep instead checks every completed, mapped board card ONCE for Pinnacle +30s (after the upcoming work, inside the same wall clock), cut at its start. A completed Bet105 card is read until one read lands at or after its start, then never again.
- **Verdicts (a checked book with no line):** written as `meta` without `books` — never a zero, never another book's price. **"Not priced" is claimed only when the source was checked AND matched this card** (review 2026-09-26: a failed join must never read "not priced" — Damm Jr v Hurkacz would have). Pinnacle +30s: a 404 on the joined fixture → not priced; the fixture mapper's miss → note "no Oddspapi fixture matched" (our join's verdict; re-checked once the mapper finds the fixture). odds-api.io books: every configured book on every card — joined event without that book → not priced; no recorded event joined → note "no recorded event matched"; a card dated before the recorder began (2026-09-26) → note "not recorded — our recording began 26 Sep". No successful check time → the page says "not checked yet". Bet105: a matched Kibl fixture with no pre-match rows → not priced; no Kibl Bet105 fixture resolved for the card and no stream rows → note "no Bet105 fixture matched", or "2+ Bet105 fixtures matched — ambiguous" when two or more unselected candidates exist. The pipeline ships a verdict-only chart in the shard.
- **api-tennis books — Wave 2 (founder 2026-09-26: TEN-295 comment d5bf3dda, cards 78ec4dd2 + 31e4beef; staged, installed only after the founder approves the 27 Sep 04:15Z reliability report).** Tests in `test-ten295-chart-books.py` section 7:
  - **Which books:** all 9 above, match winner (`Home/Away`) only; any other book api-tennis returns is not charted. **Joined by event key** (`match_key` = the card id's api-tennis event key), never by name. Home → the card's p1, Away → p2 (the pipeline builds both from the same feed).
  - **A book from two sources shows its source in its NAME — no two rows or chips ever read the same** (founder 2026-09-26, comment 5dafce2b). Test: on a card carrying every source, the row names are unique and none is a bare shared brand. "Pinnacle +30s (Oddspapi)" (book clock; the stored chart key stays `Pinnacle +30s`, renamed for display by `AODDS_ALIAS`, so the drops page and older shards keep working) vs "Pinnacle (api-tennis)" (our clock); "Betfair Exchange (recorded by us)" (no margin) vs "Betfair Sportsbook (api-tennis)" (~6.1% margin); "bet365 (api-tennis)" vs the legacy "bet365 (Oddspapi, capture ended 26 Sep)"; any other legacy Oddspapi key → "<key> (Oddspapi)".
  - **Our clock, "first seen" honesty:** a point is the first poll at which WE saw that pair, never when the book posted it. `meta.firstSeen` = the line's first point; the source line reads "api-tennis · seen by us every 5 min · first seen <day time>". **Nothing before 26 Sep 03:55Z** (`APITENNIS_SINCE`): the collector chain was down 22 Sep 12:42Z → 26 Sep 03:45Z. A card before that reads "not recorded — our recording began 26 Sep".
  - **Gaps are never drawn across** (measured 26 Sep: 134 pre-match removals that came back, on 34 matches, median 50 min, max 5 h). A `removed` row on either side, or a pair failing the price guards (a suspended market), opens a gap `[from, to)` in `meta.gaps`; it closes at the next poll with a quoted pair that passes the guards. A gap still open (`to` = null) = the book is not in api-tennis's feed now (we cannot tell whether the book pulled it or the feed dropped it — measured 26 Sep: Betano left the feed 3 times in 4.5 h on Zverev v De Minaur): the row reads "not in feed since HH:MM", no Now, never best. Any interval of > 15 min between two OK heartbeats (collector down) is a gap for every line already open. The page nulls every grid column inside a gap, keeps each gap edge as a column after the 30-column downsample, and draws one polyline per unbroken run (a one-column run beside a gap is a dot, never dropped); the Key Factors mini-chart never picks a book with a gap. A book out of its feed now is not counted in "X of 13 books priced".
  - **Pre-match only:** cut at the card's start (`startTs`, else the scheduled `date`+`time` read in api-tennis's **account zone, Europe/Berlin, DST-aware** — the same rule as the page's `cardStartMs()`; read as UTC the cut lands ~2 h into the match, a fixed +02:00 is 1 h off after the 25 Oct change) and at the event's first `event_live` row from ANY book.
  - **Collector (`tools/ten216-supabase-collector.mjs`):** a poll's quote state is committed only after its change rows landed (a failed insert is re-sent by the next poll, never lost); a 409 retries its chunk row by row. A run in which no poll succeeded, or whose last 3 polls failed, exits **4 — red**, and still hands off (only 2 and 3 end the chain).
  - **Outage alert** (founder 2026-09-26, comment 5dafce2b item 4; `ten216-collector-watchdog.sql`, pg_cron `ten216-collector-watchdog` every 10 min). Test: when neither a change row nor an OK heartbeat has landed for > 60 min (> 120 min until the first OK heartbeat exists — change rows alone go quiet for up to ~60 min), in season (off-season = 1–26 Dec UTC), one Telegram alert goes out, repeated every 3 h while open, then RECOVERED. Channel: the ops chat (Vault `ops_telegram_*`) when both secrets exist — **missing as of 26 Sep** — else the Superbet drop-bot chat (Vault `ten287_telegram_*`, measured delivering). Every send lands in `ten216_watch_log` with its channel and is resolved against pg_net (`sent` / `failed: …`); no secret → `unsent` + WARNING. The install is not wrapped in an error-swallowing handler.
  - **checkedAt** = the collector's last OK poll (`ten216_test_polls` heartbeat, one row per poll, written only after that poll's change rows landed; before the heartbeat exists, the latest change row — a true lower bound), capped at the cut.
  - **Verdicts:** event has rows but not this book → "not priced for this match"; no row at all for an event inside the collector window (today..+2 days) → "api-tennis lists no odds for this match"; beyond the window → "not checked yet".
- **Display** (`bsp-consult-dashboard.html` `buildOddsSection`, tests in `test-ten295-odds-chart.mjs`, which executes the real renderer):
  - Chart-line chips and the per-book table are grouped **Sharp** then **Soft**, each with a group header. The group of a configured book is fixed by `AODDS_CONFIG`, whatever a writer stored: **Sharp = Pinnacle +30s (Oddspapi), Pinnacle (api-tennis), Bet105; every other book Soft** (founder 2026-09-26, comment d5bf3dda).
  - **Every configured book has a row on every card, in the fixed order** Pinnacle +30s (Oddspapi), Pinnacle (api-tennis), Bet105 | Betano, 1xBet, BetVictor, Betfair Sportsbook (api-tennis), Marathon, bet365 (api-tennis), Sbobet, William Hill, Superbet, Betfair Exchange (recorded by us); legacy/other books follow. A book with no line keeps its slot and shows dashes and its verdict: the writer's note, else "not priced for this match" when the source was checked (a checkedAt), else "not checked yet". The subheading reads **"X of Y books priced"**, Y = the configured books (13; the legacy bet365 is not counted), X = those with a line. A card with no line at all keeps the reduced view and still gets this table.
  - Bet105's source line reads "Kibl feed (our Bet105 source) · time = when Kibl stored the price".
  - **The page's start is `cardStartMs(m)`** (founder 2026-09-26, comment 5dafce2b: "cards switch to started at the real start time") — `m.startTs`, else `date`+`time` in the account zone (Europe/Berlin, DST-aware). It cuts every drawn line, the Key Factors mini-chart and the upcoming/"no recent data" state. Test: a card at 14:00 (CEST) with a tick at 13:00Z draws no 13:00Z point, and an unfinished card past that instant is not "upcoming". Measured before the fix (26 Sep board): 15 in-play legacy bet365 points drawn on 4 finished cards; 0 of 37 stored closes and 0 of 1,366 card-state closes affected (closes cut on `startTs` / the Oddspapi UTC start / in-play onset, never on `date`+`time`).
  - **Default lines on** (founder card 78ec4dd2, "sharp_both"): Pinnacle +30s (Oddspapi) and Bet105 — whichever of the two has data; neither → the first Sharp line with data, else the first line with data. Every other line (the api-tennis Pinnacle included) starts off, toggleable.
  - A line is stepped only up to its own checkedAt (capped at the start), never to the grid's right edge.
  - An upcoming match whose book was last checked over 60 min ago shows **"no recent data"** in the row and the chip; its last price is not a Now (dash) and never wins the best-price highlight.
  - The footnote lists each shown source with its clock — never a single hard-coded vendor.

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
  - **Box, top to bottom:** header = the card's book + `● live` only while the stream is connected, writing and this page is subscribed to the card, else `last updated [time]` · **Closing odds** row first on completed cards (the card's existing Close) · price **changes** newest first, `DD.MM. HH:MM` in the page display zone (`newsTz`), bold price, change vs the previous price coloured with the Biggest-market-move classes (`.mc-drift.pos` up, `.neg` down) · gap rows `no data from – to` · `history recorded from [time]` when the recorded history starts more than one sweep (5 min) after the Open · **Opening odds** at the bottom (the card's existing Open, first sighting wins) with its book; its time is the card state's `openTs`, else the card's own `openingOdds.seenAt`, else a dash. A first history row at the Open's price is not a move and is not listed, whatever its time.
  - **Sources, per book and state** (founder 2026-09-24T23:09Z for bet365). Test: `PriceHistoryBox.cardData(m).source` in `test-ten270-price-history-box.mjs`.
    - **Bet105:** the `price_history(card_key)` RPC (poller archive + stream, deduped on side + Kibl time + price). Loaded on open, one card, cached for 60 s.
    - **bet365 upcoming** (no result, not live, and before `cardStartMs(m)`): `m.oddsMovement` as stored in the lazy odds shard `odds/{eventKey}.json`, every distinct price the 15-min capture sees at bet365's own tick times, with the source line `change times from bet365 · refreshed every 15 min` under the header. The box reads the shard itself, cached for 60 s (not the page's session memo). A shard that can't be read says `history unavailable — try again`; no shard or no series says `history not recorded yet`, never `no price change recorded`. An underway bet365 card (past its start, no result) is not upcoming: the shard isn't cut at the off.
    - **bet365 completed:** the post-match archive — the `bet365_history(card_key)` RPC over `bet365_mw_ticks`, with the SAME source line as upcoming, `change times from bet365 · refreshed every 15 min` (founder 2026-09-25). It never falls back to the shard. Tests in `test-ten270-price-history-box.mjs`: a completed bet365 card has source `archive` (never `shard`); an underway bet365 card reads neither; not archived (`stored` 0) or the database selects another book, or the card key is not fed by exactly one oddspapi fixture (`fixtures` ≠ 1) → `history not recorded for this book`; archived but no start → `start time unknown — history not shown`; a failed read → `history unavailable — try again`, never an empty history. A suspended tick (`active` false) or a price below 1.01 is never a row.
    - **bet365 archive rows end at the start in the database too:** `bet365_history` returns rows only when the card's selected book is bet365, exactly one oddspapi fixture feeds the card key, and `odds_card_state.start_ts` is known — and then only rows at or before it. Test: `schema_faults()` in `test-oddspapi-postmatch.py`.
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
