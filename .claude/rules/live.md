# Live page and match modal (founder brief 2026-11-25, locked design)

Applies to the Live page renderer — the last `<script>` block of `bsp-consult-dashboard.html` (`window.LivePage`, the
`#lvTab` / `#lvOverlay` CSS above it) — and its data layer `live-tab.js` (`window.LiveFeed`). Reference =
`design_handoff_live_final/Live.dc.html` (locked 2026-11-25; never published) + its `DECISIONS.md` (newest entry wins; the
HTML wins over both). Night only. Supersedes the TEN-417 build (10 Oct). **Test:** `test-live-page.mjs` runs the shipped
renderer on the shipped `live-tab.js` with real api-tennis rows and point logs (`tools/fixtures/ten417-live.json`); every
check also runs on a mutated copy and must go red. `tools/test-live-tab-feed.js` keeps the source guards.

## Data — every figure has a source, else a dash
- **Feed:** `live_snapshot` (live-poller, api-tennis `get_livescore`, every 10 s; Realtime push, 30 s poll fallback), read
  only while Live is the open page. Point log `live_pbp`, fetched for an open match (12 s cache).
- **Who is on the grid** (brief 2026-11-25): ATP and Challenger men's singles underway (`LiveFeed.isLiveTour`). Never ITF,
  WTA, doubles or juniors (Challenger kept, founder 2026-11-26). **Test:** `isLiveTour` keeps `Atp Singles` and
  `Challenger Men Singles`, drops the rest. The rail badge and the header In play count the same set.
- **Header = the shared page header** (`.sfh`, app-shell.md; founder 2026-11-26 "use what other pages have too", replacing
  the design's own summary row): "Live", one sentence, stats In play · Interrupted (amber above 0) · Events · Updated (=
  `live_snapshot.updated_at`, HH:MM:SS, `--text-soft`; a grey dash before the first snapshot). `test-ten403-header.mjs`.
- **Score / server / status / round:** the snapshot (`scores`, `event_game_result`, `event_serve`, `event_status`
  /interrupt|suspend/ = Interrupted, `tournament_round` words). Best-of: a Grand Slam main draw = 5, else 3. Surface:
  `tournament_key` → `tournament-surfaces.json`.
- **Pre price** = the Today's Matches card's price for the match: `odds-card-state` (`_ocsOf`), the card's one book, its
  close (last price before the real start), else its last pre-start Now; both sides or neither; the hover names the book and
  the time. **Test:** Pre = the card state's close, never its open.
- **Live price = Bet105 in-play, pushed** (founder 2026-11-26: "the one that updates the fastest and is in line with
  Bet105"). `kibl_live_ml` (latest row per player, the Kibl stream worker's) is SELECT-only for the browser and in
  `supabase_realtime`; `live_ml_state()` is the one read (on open and every `LP_READ_MS` 10 s): stream position, server
  clock, in-play fixtures with Kibl's names. Between reads each change is pushed, channel filtered to the grid's fixtures.
  A live match takes the ONE Kibl fixture whose two players both match by the stream join's name rule (`KiblJoin.same`
  = drops-page.js `kiblSame`), Kibl's start within 36 h of the match day; the lower participant id = Kibl's first-named
  player. **Test:** Bet105's price shows whatever the feed's delay behind Kibl and however long since a side moved
  (founder 2026-11-26: "better to show a price" — the live score runs behind too; this is not the arbitrage worker's 5 s
  rule). A market Bet105 has closed (Kibl market status other than open, or its 0.000 marker) reads **"Suspended"**, as
  on Bet105, in the card box and the header. Only a worker that has stopped writing (nothing processed for `LP_DEAD_MS`
  2 min) or no single matching fixture gives a dash, its hover saying why. Never the pre-match price shown as live.
  The moments' "before → after" stay a dash (the point log has no times to cut the price history at).
  `test-live-page.mjs` "in-play price"; `kibl-stream/test-live-ml.py` (no write grant, history never readable).
- **Medical timeout:** `mto-matches.json` (published every data run, ~10 min behind the detector). An open MTO = the amber
  "Medical timeout" chip, the moment, the chart sign. **Never a body part or a reason:** the chip's hover is player + where.
  A rain delay has no source (the feed says only "Interrupted"): no chip, no moment.
- **Players' averages** (Stats compare, Unusual): `surface-ratings.json` last 52 weeks, on the match's surface or all
  surfaces, only from 10+ matches (else a dash). The compare label follows the real surface ("clay-court average"); with no
  surface known it opens on the 52-week average. **Test:** a clay match never reads "hard-court".
- **Winners / Unforced errors / W/UE:** the feed's counts; all 0 on both sides over 10+ points = not tracked → a dash (under
  10 points an all-zero sheet can be real). A pair with one side unknown draws no bar on either side.
- **No source → a dash:** Net points won, Pressure points won (serve / return), the 52-week points per service game.

## Values (founder 2026-11-26: agreed) — `LIVE_CONST`
`HB_MIN_GAMES` 30 · `U_GAP` 15 / `U_N` 20 · `DOM_WINDOW_GAMES` 4 · `DOM_START_GAMES` 4 · `BIG_GAP` 15 · `HEAT_NEUTRAL` 3 ·
`LP_DEAD_MS` 2 min. `BP_SAVED_MAJOR` **2** lives in `live-moments.js` (shared with the poller). "Price moved, no break" is
dropped (founder 2026-11-26: not needed).

## Moments (card list, modal timeline, chart markers) — one source, the point log, one file (`live-moments.js`)
- One line per service game with a break point; the **named player did the thing** (the breaker, or the server who saved);
  the set / game score is the score **when that game started**. Labels: Broke serve · Broke, serving for set / match · Broke
  for the set · Saved a / two / three break points. Plus every medical timeout.
- **Card = major kinds only:** a break, 2+ break points saved in one game (founder 2026-11-26), a medical timeout. One
  saved break point never reaches the card. Latest 5, then "All moments in match view".
- **Every card lists its moments** (founder 2026-11-26, option B): the live poller runs `live-moments.js` (a byte-identical
  copy in `supabase/functions/live-poller/`) on each match's point log every tick and writes the major moments into the
  snapshot row (`stennisfy_moments`); the page decodes the full log with the same file once a match is opened. **Test:**
  the copies are identical; the feed's majors = the match view's majors on a real log; a card lists them with no log
  loaded. Majors only; the named side; the start-of-game score.

## Status chip and sort
- Chip priority: Match point · Set point · Break point (named for the player with the point) · Medical timeout (amber) ·
  Break up (more breaks than the opponent in the current set). "Key moments first" sorts by that priority, then order of
  play (scheduled start, then feed order).

## Momentum
- Dominance = player one's share of return points won ÷ player two's, each over his last 4 return games; Match scope starts
  after the first 4 completed games (hatched start + "i"); a picked set starts at Level at its first point, game ticks under
  it. Points lead = cumulative points from the first point. Tiebreak points count in Points lead only.

## Break/Hold
- `holdbreak.json`, last 24 months, all surfaces or the match's surface. A cell under 30 games = count only, no colour; no
  games = a dash; colour only beyond ±3 of the row's all-sets rate. **Best-of-3 and best-of-5 are never mixed:** the main
  grid pools both formats in sets 1–3, so `build-holdbreak.js` also writes `players[k].fmt[3|5]` (sets 1–3, by the
  match's best-of — `live-moments.js` `bestOf`; founder 2026-11-26) and the page reads only the match's own format there;
  a file without `fmt` keeps those cells a dash. Sets 4–5 are best-of-5 only. **Test:** `test-live-page.mjs` (a best-of-5
  match never shows best-of-3 games), `tools/test-holdbreak-format.js` (the builder, main grid unchanged, mutant).

## Points
- The locked Match Stats point by point, reused (`fhPbpSetModel` + `fhSheetPbpHtmlMa2`), fed the live point log as received;
  its BP marks are read off the score and the server (founder 2026-11-27, `modal-match-stats.md`).

## Look
- **Long names** (founder 2026-11-26): a name too long for the card column is cut with "…" and the full name on hover,
  as the design draws it — the one exception to CLAUDE.md "never truncated", on the Live page only. Key-moment labels
  likewise (measured 25 Nov: all 29 cut at a 300 px card; accepted).
- Every value is the prototype's inline style, colours through `tokens.css` (`--ma2-*`, `--lv-*`). One avatar (photo by
  player key over the prototype's initials), one filter track, one "i", one hover box, one heatmap cell. Only the live
  status dot pulses. The match modal's scrim starts at `--sf-side` (foundation R6.5), so the sheet centres in the content
  area. At ≤ 900 px the site rail stacks above the page (app-shell), unlike the prototype's fixed side rail.
- Loading = skeleton cards in the card geometry; a stale feed = one line "Live feed not updating · last update HH:MM:SS"
  (both DESIGN GAPs, for review).
