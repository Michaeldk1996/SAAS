# Pre-match drops page and its endpoint (TEN-294)

Founder rulings of 2026-09-26: path B′ (TEN-293 doc `refresh-speed`), the design approval, and the
answers on card 37612d3d (TEN-294 doc `design`). Suite: `test-ten294-drops.mjs`.

- **The page's data comes from the separate `stennisfy-drops` Fly app.**
  **Test:** every host the drops page fetches data from is `stennisfy-drops.fly.dev`, which is not `*.github.io`, not `kibl-stream`, and not Supabase.
  `kibl-stream/fly.toml` has no `[http_service]` and no `[[services]]` block.
  *Exception:* none. A faster path for Challenger/ITF is the Kibl "Now" worker (point 8), not a second endpoint.

- **A row is an alert the live Telegram drop bot already wrote.**
  **Test:** every row id resolves to one `ten280_bot.alerts` (Bet105) or `ten287_bot.alerts` (Superbet) row with `mode = 'live'`.
  Nothing on the page re-detects a drop. The drop rules are therefore the bots' rules: ≥5% against the price 10 min earlier, no floor, a 30-min cooldown per match (per book), ML pre-match men's singles.
  *A new book* joins when its bot writes an `alerts` table of the same shape, as one more branch in `drops_api.snapshot()`.
  **An odds-api.io book joins by config** (founder 2026-11-05, Napoleon Sports BE): `ten287_bot` scans every book in
  `ten287_bot.config.books` (`tools/ten287-books.sql`; the book must also be in `ten287_rec.config.books`), one alert per
  book (the cooldown is per book, so Superbet and Napoleon dropping together are two alerts), each headed with its book
  ("🟢 NAPOLEON SPORTS BE DROP"); the feed and the page read `a.book`, so its rows appear with no page change.
  **Test:** `tools/test-ten287-books-sql.py` (control: the single-book tick never alerts Napoleon). Measured 4 Nov 12:45Z –
  5 Nov 05:00Z on 397 matches both books price: 174 Superbet / 173 Napoleon 5% drops, 140 within 10 min of each other
  (median Napoleon 30 s later, 90 within 60 s — our polls are 30 s apart); same price at the same moment 33%, Napoleon
  lower 42%, higher 25%.

- **"Dropped to" and "Latest" are two fields, each with its own clock.**
  "Dropped to" is the alert's price. "Latest" is the side's latest *pre-match* price, read with the bot loader's own filters and side mapping (per alert, on indexes; calling the loader itself full-scans the Kibl tables).
  **Test:** a row's "Latest" is never labelled as, or substituted for, "Dropped to", and a missing value renders "—".
  **"Now" on a started or finished row = that book's own last recorded snapshot before the start** (founder card 939259c6, 2026-10-11), never the Today's Matches card's Close and never an alert price. **Test:** for a cut row, "now" equals the last Bet105 / Superbet tick recorded before `liveAt` (else the scheduled start). ⚠️ Known gap: the endpoint reads Bet105 from sweep rows + the stream's *current* price only, never `kibl_now_history`, so on a cut row it falls back to the last alert price (Hurkacz 2.50 vs the true 2.49; Carabelli 7.63 vs 7.33) — fix tracked separately (TEN-429).

- **Match status is api-tennis's, never a vendor's `pending`** (founder comment bef04c62 + card 518c56f0, 2026-09-26; supersedes the "Started" badge). Evidence: TEN-297 doc `status-feasibility` (Superbet: 21 of 27 alerts with a live time fired after the match went live).
  **Test:** every row carries `status` ∈ `not_started | in_play | finished | unknown`, from:
  - **`liveAt`** = our 10-second live poller's first live sighting (`live_flip_log`), joined on both players — the surname (accents, hyphens and a Jr/II suffix ignored) and a shared given-name initial whenever both names carry given names ("Adolfo Daniel Vallejo" = "D. Vallejo") — a start within 24 h, and exactly one candidate; a row refused on initials gets the match through its group;
  - **in play** = on the current live board (`live_snapshot`), or went live and api-tennis `get_fixtures` by `event_key` is not terminal;
  - **finished** = api-tennis `event_status` is `Finished`, `Retired` or `Walk Over` (the status word wins over `event_live`);
  - **not started** = no live sighting and the start has not passed, or api-tennis shows it not started; **unknown** = no single api-tennis fixture, or Cancelled/Postponed (labelled, never passed off as a status).
  - **One match, one status:** rows of the same two players with starts within 24 h share the best-evidenced status (a live sighting beats a schedule), so one match never reads two ways.
  - api-tennis is asked in UTC (`timezone=UTC`; its default zone moves with daylight saving); by-day lists (the start's day, plus a neighbour within 6 h of midnight) are fetched one day per call in the background; a fixture joined from a list is re-asked by `event_key` until terminal; empty or failed answers are cached 10 min.
  - Repeat alerts of one selection × book share its latest pre-cut price.
- **The list is upcoming matches only** (TEN-427 r2, founder comment 20de43fe, 2026-10-11; supersedes card 518c56f0 Q1's three views Upcoming · In play · Completed — the reference has no Matches control). A row leaves the list at its scheduled start — the Today's Matches card's start when matched (`cardStartMs`), else the vendor's — or earlier when the feed marks it live (`liveAt`, `in_play`, `finished`, or a `cutAt`). A row with no start is not listed. There is no Matches control, no In play / Completed count and no "Status unknown" badge: an `unknown` row whose start is still ahead is just an upcoming row. **Test:** `test-drops-v2.mjs` "selections" (a started match is not listed).
- **A row's prices stop at the live start** (Q2 = a; endpoint). **Test:** every price the endpoint serves for a started or finished row was recorded before `liveAt`. With no `liveAt`, the feed stops at the scheduled time once it has passed: api-tennis's when a fixture is joined (the vendor's only when earlier by ≤ 3 h), else the vendor's; this includes **unknown** rows. That is the scheduled time's only permitted use (founder ruling 2026-10-26): conservative only — reject a price or stop collecting / showing; it never creates a start, cuts a close or labels a start. A row with no recorded price before the cut is not served. No in-play price is ever a pre-match figure; nothing is invented after the cut. (The page lists no cut row since the r2 ruling; the cut still bounds every chart.)
- **The endpoint holds 72 h** (Q4 = b): alerts and their lines from the last 72 h.
- **The 🔵 POLYMARKET DROP bot** (founder 2026-11-01; `tools/poly-drop-bot.sql`, schema `poly_bot`, pg_cron `poly-drop-bot` every 30 s,
  installed by `poly-drops.yml`). Same rules as Bet105 / Superbet: ≥ 5% vs the price 10 min earlier, 30-min cooldown per match, ML,
  pre-match men's singles, ATP only (the `drops_scope` trigger), cut at the live start (`drops_live.cuts_287`). Reads the shared
  odds-api.io recorder (`ten287_rec`, book `Polymarket`); posts to the drop chat (the Superbet bot's Vault names). Polymarket only:
  - **Liquidity** = odds-api.io `depthHome` / `depthAway` = **dollars** at the best back price (measured 1 Nov: Halys 348 = 589.78
    shares × $0.59 on Polymarket's own book). **An alert needs ≥ `poly_bot.config.min_depth` ($100, founder lean, one row; NULL =
    none) before AND after the drop**; a missing depth is not enough.
  - **Traded on match** = Polymarket's Gamma API event `volume` (every market on the match), written by the pipeline
    (`tools/polymarket-volume.mjs` → `poly_bot.volume`); joined on both surnames + initials and a start within 36 h, exactly one
    candidate, else "—".
  - **Match-winner liquidity** = Polymarket's `liquidity` for the match-winner market only (its whole order book, every price,
    both sides; founder 2026-11-01 "just that market"), same join, "—" without one.
  - Not on the Dropping Odds rows (`drops_api` reads the Bet105 / Superbet alerts only); the price box shows Polymarket's line
    because it lists every recorder book, under its own group **"Prediction market"** (founder 2026-11-01; `bookCls` →
    `prediction`, after Sharp and Soft), never Sharp or Soft. On the cards' Market Signal it is named "Polymarket".
  **Test:** `tools/test-poly-drop-bot-sql.py` (real throwaway Postgres; CONTROL: no minimum → the $50 drop alerts).
- **The 🟣 KALSHI DROP bot** (founder 2026-11-01; `tools/kalshi-drop-bot.sql`, schemas `kalshi_rec` + `kalshi_bot`, pg_cron
  `kalshi-recorder` + `kalshi-drop-bot` every 30 s, installed by `kalshi-drops.yml`). Source: Kalshi's **public** API (no key):
  series `KXATPMATCH` (ATP match winner, main draw + qualifying; one market per player). Same rules as the Polymarket bot:
  ≥ 5% drop of the decimal price **1 ÷ yes_ask** vs 10 min earlier, 30-min cooldown per match, ≥ `kalshi_bot.config.min_depth`
  ($100) at the price before AND after (dollars = contracts offered × price), ATP only (`drops_scope`). **Live cut** = the earlier
  of our live-flip sighting (exactly one, both surnames + initials) and the matched api-tennis fixture's scheduled start
  (`kalshi_bot.match_fx`) — the schedule only ever stops a feed early. **Kalshi's own occurrence / expiration times are listing
  placeholders, never a start** (measured 1 Nov 2026: every 2-Nov Paris match read 1 Nov 13:00Z); the fixture start is used for
  the cut, the ATP scope and the arbitrage join. Traded = both markets' contracts (live, $1 each); match-winner liquidity = the whole book of both
  markets (Σ price × contracts, every resting bid) from `tools/kalshi-volume.mjs`. Telegram: the drop chat. Not on the Odds tab
  or the Dropping Odds page (Kalshi is not an odds-api.io recorder book). **Test:** `tools/test-kalshi-drop-bot-sql.py`.
- **Arbitrage + divergence engine** (founder 2026-11-01; `tools/arb-engine.sql`, schema `arb`, pg_cron `arb-engine` every 30 s,
  installed by `arb-engine.yml`). **Fair price = Pinnacle's, read as Bet105 with the margin removed** (founder): p = (1/a)/(1/a+1/b).
  Sources, each joined to ONE api-tennis `Atp Singles` fixture (`drops_scope.fixture`, both surnames + initials, start within
  24 h, exactly one both ways): Bet105 (`kibl_now_card`, live while the worker heartbeat <= 180 s), the soft books in `arb.config.soft_books`
  (Superbet + Napoleon Sports BE, founder 2026-11-05; a book outside the list is never read) and Polymarket (`ten287_rec`, live
  while that book answered within 3 min), Kalshi (`kalshi_rec`, same). The api-tennis bookmaker collector
  (`ten216_test_odds_changes`) last wrote on 30 Sep 2026 and is not a source. **Fees**: Kalshi taker 0.07·q·(1−q) (series
  fee_type quadratic_with_maker_fees, multiplier 1); Polymarket taker rate·q·(1−q) (Polymarket's docs: fee = C × feeRate × p × (1 − p); Sports
  0.05, makers free); books none; both in `arb.config`. **DIVERGENCE** = a source's after-fee price >= `div_min` (5%)
  above fair; **ARB** = back each player at a different source with locked-in profit >= `arb_min` (1%) after fees, best pair
  per match, stakes by 1/e. A prediction-market leg needs >= `min_liq` ($100) at the price. **Retirement mismatch is
  flagged, never excluded** (founder): a prediction market (pays the player who advances once a ball is played) against a
  bookmaker. Telegram ⚖️ ARB / 📐 DIVERGENCE to the arbitrage chat, one per match + kind + source(s) per 30 min. No page: the Dropping Odds
  → Arbitrage view (`arb-page.js`) was retired by the founder on 2026-11-23; `arb_now()` stays for the engine and alerts.
  **Test:** `tools/test-arb-engine-sql.py`.
  **No alert on a withdrawn match, any kind** (founder 2026-11-03: four ⚖️ ARB of +26% on Davidovich Fokina v Kouame after
  the withdrawal, off a frozen Polymarket book): the fixture spine carries api-tennis's `event_status` / `event_winner`
  (`drops-scope-fixtures.mjs`, every pipeline run) and `arb.fixture_closed` (walkover, retired, cancelled, postponed,
  abandoned, finished, awarded, default, withdrawn, suspended, interrupted, or any winner) takes the match out of prices,
  divergences and arbs; the live alert also needs the board's own status open. A pre-match arb above `arb_max` (10%) is a
  settlement artefact and is never offered. Kalshi's price time = when we saw it (its `updated_time` read 15:00 for a 09:38
  price). **Test:** `tools/test-arb-engine-sql.py` ("walkover", "arb_max").
  **The page reads the stored result** (`arb.snap`, written by every tick) while it is ≤ 10 min old (founder 2026-11-03),
  recomputed only after that. **A failed Telegram send is re-sent once** while ≤ 15 min old, any kind (`arb.alerts.retries`).
- **Our Polymarket recorder** (founder 2026-11-04: free the odds-api.io slot for Napoleon Sports BE). `tools/poly-recorder.sql`
  + the live worker: every ATP / Challenger Polymarket match on the public CLOB websocket → `public.poly_rec_push` every 15 s
  → `ten287_rec.events` / `ticks` in the odds-api.io recorder's shape (back = 1 / best ask, depth = shares × ask in dollars,
  event = 900 000 000 000 + the Polymarket id, tier from the one api-tennis fixture both players join, one `requests` row
  per push as the engine's liveness test). A tick on a price change, a ≥ 20 % move in the dollars at it, or every 5 min.
  Label `polyrec.config.book`: 'Polymarket CLOB' during the parallel run (`arb-engine.yml` mode `poly-compare`), then
  `poly-switch` makes it 'Polymarket' and drops it from `ten287_rec.config.books` in one transaction. **Test:**
  `tools/test-poly-recorder-sql.py`, `recRows` in `tools/test-live-arb-recorder.mjs`.
- **Live arbitrage with bookmakers** (founder 2026-11-08: "implement the live arbitrage for bet105 and the prediction markets,
  then napoleongames with bet105 and prediction markets"). The live worker also reads the odds-api.io WebSocket (secret
  `ODDS_API_IO_KEY`; the account's selected books = Bet105 + Napoleon Sports BE, match winner, tennis). ATP singles events from
  `GET /events` (league `ATP - …`, never Doubles / Challenger / WTA / UTR) join a Kalshi / Polymarket match by both names,
  either way round, starts within 36 h, exactly one each way; a new match is seeded once from `/odds/multi`, then the stream
  keeps it. A `deleted` / `no_markets` message removes that price at once; a 1.00 placeholder or a book over 101% is no price;
  a closed socket clears every price, then reconnects (2 s doubling to 30 s, `lastSeq`) and reseeds. Every direction with a
  bookmaker leg is checked after fees (Bet105 × Kalshi / Polymarket, Napoleon × Kalshi / Polymarket, Bet105 × Napoleon);
  Kalshi × Polymarket keeps its own path. A bookmaker publishes no stake limit: it never caps the size, the $100-to-lock-in
  rule applies only to a gap with a prediction-market leg, and a bookmaker-only gap posts with its split. Every live row
  carries `legs[]` (venue, price, after-fee, stake, share, clock, link); ⚡ prints a 🔗 per leg and a retirement warning when a
  bookmaker is in it; the page reads the same legs. **Test:** `tools/test-live-arb-recorder.mjs` (feed, join, directions),
  `tools/test-arb-engine-sql.py` (bookmaker gaps post, cooldown, message, arb_now).
- **Live arbitrage, Kalshi × Polymarket** (founder 2026-11-02, "Let's go!"; ATP tour only). `tools/live-arb-recorder.mjs`,
  run by `live-arb.yml` (main only, 350-min runs, an hourly start keeps one queued so the next starts as the current ends):
  Polymarket's public CLOB websocket (every book change) + Kalshi's public `KXATPMATCH` list every 2 s (YES ask + size; the
  opponent's NO ask as the other way in, never sized). Only the current Polymarket socket reacts to a close (a replaced one is ignored); a dropped feed
  clears its books, so no gap is ever read off a dead feed; a match whose two Polymarket asks sum under 0.98 is not read
  (an inconsistent book). **Kalshi's websocket** (founder 2026-11-03): with the repo secrets `KALSHI_API_KEY_ID` +
  `KALSHI_PRIVATE_KEY` the worker reads Kalshi's `orderbook_delta` feed (RSA-PSS signed headers) — YES ask = 1 − best NO bid,
  NO ask = 1 − best YES bid, each sized — and polls the list only every 30 s for new matches; without them, or while the
  feed is down, the 2-s polling stands. **Thresholds ruled** (founder 2026-11-03, "Yes"): 1% after fees, $100 to lock in,
  10 min per match + direction. **Only when there is time to place both bets** (founder 2026-11-03): the worker reads the live
  score board (`live_snapshot`, the Live page's 10-s feed; ≤ 30 s old, the pair joined to exactly one ATP singles fixture by
  both names) and an alert needs the game at 0–0 — `set` (a new set, the set break), `changeover` (odd games played: players
  sit) or `game` (even: a new game, the serve changes) — never a point under way, a tiebreak (6–6), a stale or unmatched
  board, or a board status that is not "Set N". **Test:** `boardPhase` in `tools/test-live-arb-recorder.mjs`. **Stakes in dollars** (founder 2026-11-04): ⚡ shows the stake per leg (contracts × each leg's
  cost with its fee), the total, the payout (contracts × $1, whoever wins) and the profit; ⚖️ shows the same at the largest
  total the prediction-market leg's book takes at its price (`arb.max_total`: liq × price / eff over its share), or per $1,000
  when both legs are bookmakers (limits unknown). Tiebreak sets read "7–6(5)" (`setText`). **Euros** (founder 2026-11-04): every amount reads
  "€… ($…)" at the ECB reference rate (`arb.fx`, api.frankfurter.app via pg_net from `arb.tick()`, at most every 6 h); a rate
  older than 4 days is not used and the amount stays in dollars. **Chats** (founder 2026-11-05, replacing 2026-11-04's split): ⚡ LIVE
  ARB, ⚖️ ARB and 📐 DIVERGENCE all go to the arbitrage group "Arbritage Bot" (Vault `arb_telegram_chat_id`); the drop bot
  posts them; no arbitrage chat stored → the drop chat (`arb.send(text, kind)`). A pair joins on both names, exactly one candidate each way; Kalshi
  Challengers (`KXATPCHALLENGERMATCH`) are never read. Gap = back one player on each market for < $1 after both taker fees
  (the engine's 0.07·q(1−q) / 0.05·p(1−p)). Every 5 s the positive gaps + a heartbeat go to `public.arb_live_push`
  (service role). **Test:** a gap posts ⚡ LIVE ARB (arbitrage chat, the engine's `arb.send`) only when edge ≥ `config.live_min`
  (1%), ≥ `min_liq` ($100) to lock in, the match has started (Polymarket `live` or its start passed; before the start the
  30-s engine covers it) and the Kalshi event is `KXATPMATCH-`, once per match + direction per `live_cooldown` (10 min).
  `arb_now()` carries `live` only while the last push is ≤ `live_hb_max` (90 s) old; otherwise the page draws no live
  section (no feed-status text). Bet105's in-play prices come from the Kibl stream (rule below). **Test:** `tools/test-live-arb-recorder.mjs`, `tools/test-arb-engine-sql.py`
  ("LIVE").
- **No Bet105 leg while the Kibl stream is behind** (founder 2026-11-12, "Pause and fix", after both 11 Nov live signals
  were false: the Fly worker read Kibl up to ~2 min late). Bet105's in-play prices come only from the Fly worker
  (`kibl-stream/now_worker.py` → `kibl_live_ml`), which writes off its consume loop and keeps one stream-position row there
  (`fixture_id` 0, `fixture_participant_id` 0: `kibl_inserted_on` = the newest Kibl time read, `received_at` = when the worker
  read it), written at least every second after the price history. **Test:** a gap with a Bet105 leg is refused twice
  unless that row is ≤ 5 s old and `received_at − kibl_inserted_on` ≤ 5 s — in the recorder (`kiblStreamCheck`:
  no in-play Bet105 price at all) and in `arb_live_push` (`arb.config.live_stream_lag` 5 s, `live_fresh` 5 s);
  `tools/test-live-arb-recorder.mjs` ("Kibl in-play: only while the stream worker is current"), `tools/test-arb-engine-sql.py` (four refusals + control),
  `kibl-stream/test-live-ml.py` (position row, no database call in the loop). Pause switch: `arb.config.live_min` 1000
  (normal 1). Measured after the deploy (12 Nov 02:27–04:00Z): position lag 0.02–1.0 s, history ≤ 1.1 s a minute.
- **NoVig: not built** (founder 2026-11-01 "try NoVig as possible"): its prices and book need a signed key from a NoVig account
  (`docs.novig.com`, Ed25519 / P-256); the only keyless route lists market types (ATP: MONEY, SPREAD, TOTAL). Two ways in: a
  NoVig account key, or NoVig as an odds-api.io slot (odds-api.io lists "NoVig", active).
- **The Telegram drop bots stop at the live start too** (TEN-299, founder comment 8585095a, 2026-09-27; installed from `tools/ten299-live-cut.sql` by the drops workflow).
  **Test:** each bot's `load_ticks` removes every tick at or after its match's cut, and each bot's `scan` evaluates nothing at or after the cut. So no alert fires on a started or finished match, and every drop is measured against a pre-match price. A backtest of the last 24 h holds 0 alerts at or after a cut (`ten299_after_cut`).
  The cut is the live sighting, joined as the endpoint joins; when ambiguous, the vendor's scheduled start. A match with no sighting is not cut (the vendor start is not a live signal).
  ⚠️ The bots' branches (`ten280-probe`, `ten287-probe`) still carry the pre-TEN-299 `load_ticks`/`scan`: a re-install from them reverts this until the drops workflow runs again.

- **One database read per cadence, fanned out from memory.**
  **Test:** any number of requests on any route triggers zero database reads.
  Reads run every 30 s (the bots' tick), aligned to 3 s after the Bet105 bot's run: never less than 10 s apart and never more than 33 s.

- **Stale data is never presented as current.**
  **Test:** `generatedAt` advances only on a successful read. The page shows it only as the header's **Updated** stat (HH:MM, data time, never the fetch time). Past 5 min — or when the endpoint cannot be reached — the page shows the v2 banner (below) and dims the rows; Updated keeps the last read's HH:MM in `stennisfy.tz`.
  Before the first good read, `/drops.json` answers 503, never an empty list.
  *Exception to CLAUDE.md's "no infrastructure warning" non-negotiable* (founder, card 79e9db02 Q3, 2026-09-26; wording = the v2 export, founder brief 2026-11-23): this one banner, worded exactly as the export draws it — red dot, "Feed disconnected", "Showing prices as of HH:MM. New moves appear once the feed reconnects.", Reconnect (a refetch). Nothing else on the page names a feed, bot or service. Source-by-source health lives in `/status.json` and the watchdog.

- **The read is bounded on the database, not only in the app** (founder 2026-10-30, after the 29–30 Oct overload).
  **Test:** role `drops_reader` carries `statement_timeout = '20s'`, below the app's 25 s `query_timeout`, so the server stops a slow read before the app abandons it. The app's own startup option did not bound the reads: they ran 17–19 min each, five at a time, the last stretch blocked writing to a dead socket, which no timeout cancels. `drops_api.lines` does each pass once: materialized fixture/event keys, `lastSeen` in one grouped pass, no per-book or per-selection re-scans. Output stayed md5-identical at 24/48/72 h; measured 7.5 s → 0.8 s. `ten294-drops.yml` dispatched = SQL only, never a Fly deploy (`test-ten294-drops.mjs` "overload 2026-10-30").
- **The database link is verified TLS or nothing.** The Fly app verifies the pooler against the bundled Supabase Root 2021 CA and refuses to start without it.
  **Test:** the connection URL carries no `ssl*` parameter (in node-postgres one overrides the CA silently). Failures are public only as a code, never the driver's text.

- **A stall reaches the founder by Telegram**, in the same chat as the drop alerts. The watchdog runs outside the Fly app, in pg_cron.
  **Test:** it alerts when the endpoint is unreachable 3 times in a row, when data is more than 5 min old, or when any source is past its limit. An alert counts as delivered only once confirmed *sent*.

- **Access is open while the product is in search and development** (founder, card 37612d3d).
  CORS allows exactly `https://michaeldk1996.github.io`. CORS is not access control.
  *Revisit before members:* the gate would verify the Firebase ID token on the Fly app, which needs no database read.

## The Dropping Odds page — final design on the v2 model (handoff `design_handoff_dropping_odds_final_2026-11-27`, LOCKED; founder rulings 2026-11-23 and 2026-11-28)

Supersedes every earlier page ruling (TEN-294 export, the TEN-301 price-move box, TEN-427 step 14, the 23 Nov v2 layout).
Source = `site/Dropping Odds v2.dc.html` of the final handoff (template + `renderVals`); the file wins over its README and
README over the decisions file. **The desktop page and the price history box are the file's own markup**: its template is
compiled into `drops-page.js` (`dcDesk`, `dcDrawer`, generated by `dc/compile.mjs` — every literal colour mapped to a
token, `--do2-*` / `--do3-*` in `tokens.css`; hover styles to generated classes) and filled by its logic ported onto the
real feed (`pageVals`, `drawerVals`). The phone keeps the v2 layout (the final days changed desktop only, README §7). Page
files `drops-page.js`, `drops-page.css`. Suite `test-drops-v2.mjs` (a frozen slice of the real feed,
`tools/fixtures/drops-v2.json`) + `tools/test-drops-v2-mutants.js` (0 may survive).

- **One card per selection (a player to win a match), built from the endpoint's `lines`.** A line is one match side with
  each book's change-only series for that side and the opponent; a side with its own line takes it, else its opponent
  line's `other`. Match meta (tier, start, status) = the match's newest alert row. **Test:** one card per selection; both
  sides of a match; nothing at or after the live start; upcoming only (the r2 rule above).
- **The roster = books the page has a source for**: Sharp Pinnacle (Oddspapi `pinnacle+30`, from a board-matched card's
  TEN-295 chart shard — ATP only; never spliced) and Bet105 (Kibl); Soft Superbet and Napoleon Sports BE (odds-api.io);
  Prediction markets Polymarket and Kalshi (founder 2026-11-28: "link it" — our own recorders; a market the endpoint does
  not carry for a selection reads "No line"). More books join as sources arrive (founder 2026-11-28). A book not seen for
  24 h is not quoting. **Test:** the roster is exactly those six; the design's other books never ship.
- **Every figure is computed at render from the two prices printed beside it** (the file's `rd` / `calc`, on 2 dp prices,
  half away from zero): drop % = (first − now) / first, implied = 100 / price, pts = implied now − implied first. The first
  price is the first one Stennisfy recorded, never claimed as the opening line: the subtitle reads "Prices that have
  shortened since we first recorded them." (founder 2026-11-28, over the file's "since they opened"). **Sharp = Pinnacle;
  where Pinnacle has no line, Bet105 without its margin** (founder 2026-11-23; 2026-11-28: "Bet105 is Pinnacle with a
  margin"): each Bet105 tick paired with the other side's last Bet105 price at or before it, fair = 1 + own / other; every
  place it shows names it ("Sharp · Bet105 (no margin)", the legend, a chart note); Bet105 is then not offered as the
  compared line; best now and the Bet105 bookmaker row stay the quoted price. Soft = the average of the soft books with two
  prices; prediction markets are never soft or sharp, only their own line, row and the best price. **Test:** the README's
  2.12 → 1.46 = 31.1%, +21.3 pts; own 2.10 / other 1.80 → 2.1667; never the soft figure in the sharp slot.
- **Meaningful only and the Sharp move chip** (the file's `isMean`): the sharp reading — Pinnacle, or Bet105 without its
  margin (founder 2026-11-28) — moved 5 pts implied or more ("Strong sharp move"), or 2 pts or more with at least half of
  the soft books following ("Sharp move"). The chip's title names the source. **Test:** both thresholds, the soft-follow
  condition, a Bet105 no-margin move counts.
- **Sorting** (founder 2026-11-27, the soft-drop fix): Biggest sharp drop = every sharp reading first by its drop, the
  rest by their soft drop; **Biggest soft drop = the soft reading only: drops largest first, then no move, then rises
  (smallest first), then no soft reading** — a missing reading never ranks above a rise; Drops in = Drop % or Pts implied
  (switching resets the sort to the drop); Latest move; Starting soonest. Min drop reads the soft reading under the soft
  sort, else either. **Test:** the soft order on the frozen feed (fails on the pre-fix build), the soft filter.
- **Missing is a dash plus its reason** ("No sharp line", "No line", "One price", "No move"), never a zero.
- **Header** = the file's card: Drops · Biggest (in pts under Drops in = Pts implied) · Updated = the read's
  `generatedAt` HH:MM in `stennisfy.tz`, "—" before the first good read. No count line under the tabs (README §3).
- **Prediction markets in the lines** (founder 2026-11-28, "link it"): `drops_api.lines()` (`tools/ten294-drops-lines.sql`)
  joins our Polymarket CLOB recorder's events (`ten287_rec` events from 9e11, label `polyrec.config.book`, kept out of the
  odds-api.io match lookup so they never make a match ambiguous) and Kalshi's per-player markets (`kalshi_rec`: price = 1 /
  yes ask, open markets only) to each selection, exactly one candidate each, pre-match. Installed with
  `ten294-drops.yml` steps=lines: the install and a `snapshot(72)` timing check in one transaction, rolled back past 10 s.
  **Test:** `test-ten294-drops.mjs` "prediction markets in the pop-up lines".
- **"Biggest moves of the past days" (the archive)** (founder 2026-11-28, design `Dropping Odds Archive.dc.html`): one
  record per selection the drop bots flagged (a selection in `lines(72)`) once its api-tennis match is decided (Finished or
  Retired with a winner; a walkover never). `drops_archive.collect()` (pg_cron `drops-archive-collect`, :07 / :37) stores its
  recorded series cut before the verified start (`live_flip_log_current`), insert-only, 90 days (`tools/drops-archive.sql`);
  the endpoint's `/archive.json` computes the figures (`stennisfy-drops/archive.mjs`) and adds each match's set score from
  api-tennis. Sharp = Bet105 without its margin (the store holds no Pinnacle; founder 2026-11-28 "Bet105 is Pinnacle with a
  margin"), named so wherever the file says Pinnacle. **A close only at a verified start**: without one the Closed cell is a
  dash and the drop reads to the last recorded price. A rise is not a move (only drops are listed). Yield = 1u at the price
  right after the biggest sharp move, shown from 5 moves. Opened from the header link; back and Escape return.
  **Test:** `tools/test-drops-archive.mjs` (the reader; Bet105 no-margin = the page's rule point for point), `tools/test-drops-archive-sql.py`
  (real Postgres: cut, insert-only, decided only, one fixture, 90 days, reader-only), `test-drops-v2.mjs` "archive".
- **Price history box:** three tiles (Sharp, Soft, Best price now) with their Opening rows (price · day time recorded), the
  chart, the bookmaker tables (Sharp · Soft · Prediction markets: Opened · Now · Drop). **The chart draws straight lines
  between recorded prices** (founder 2026-11-28, replacing TEN-301's step line): last 24 h, a price recorded before the
  window enters at the left edge on the line to the next recorded price, the last price runs on to now; two dots per line
  (first recorded — only when inside the window — and now); legend pills hide / show a line without rescaling; the hover
  readout (desktop) flips left past 60%; the axis never under 1.00. Escape closes an open menu first, then the box;
  "Match analysis" opens the board card's Match analysis and is absent without one (and on the phone).
- **Colour:** the file's colours through tokens; red only on drop figures, the meter and the struck first price; blue
  only on the sharp line and links; amber only on the prediction market line.
- **Feed disconnected** (> 5 min since `generatedAt`, or unreachable): the file's banner — red dot, "Feed disconnected",
  "Showing prices as of HH:MM. New moves appear once the feed reconnects.", Reconnect (the CLAUDE.md exception).
- **Retired:** the Drops / Arbitrage view (founder 2026-11-23).
- **Phone (under 820px):** the v2 build (title, disconnected card, search, Filters / Sort sheet, explainer, market chips,
  cards); the box is the file's bottom sheet. Not built: the file's mobile top bar / bottom nav (the site shell), the
  ILLUSTRATIVE chip, the green "LIVE · updated" line.
- **No placeholder ever ships:** no demo player, price, book or time from the file; no `randomuser.me`.
