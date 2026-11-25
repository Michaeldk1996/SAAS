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
  WTA, doubles or juniors. **Test:** `isLiveTour` keeps `Atp Singles` and `Challenger Men Singles`, drops the rest. The rail
  badge and the header In play count the same set.
- **Score / server / status / round:** the snapshot (`scores`, `event_game_result`, `event_serve`, `event_status`
  /interrupt|suspend/ = Interrupted, `tournament_round` words). Best-of: a Grand Slam main draw = 5, else 3. Surface:
  `tournament_key` → `tournament-surfaces.json`.
- **Pre price** = the Today's Matches card's price for the match: `odds-card-state` (`_ocsOf`), the card's one book, its
  close (last price before the real start), else its last pre-start Now; both sides or neither; the hover names the book and
  the time. **Test:** Pre = the card state's close, never its open.
- **Live price:** no in-play price is readable from the browser yet (`kibl_live_ml` is service-key only). The price boxes
  and every "before → after" read a dash until the source is ruled. Never the pre-match price shown as live.
- **Medical timeout:** `mto-matches.json` (published every data run, ~10 min behind the detector). An open MTO = the amber
  "Medical timeout" chip, the moment, the chart sign. **Never a body part or a reason:** the chip's hover is player + where.
  A rain delay has no source (the feed says only "Interrupted"): no chip, no moment.
- **Players' averages** (Stats compare, Unusual): `surface-ratings.json` last 52 weeks, on the match's surface or all
  surfaces, only from 10+ matches (else a dash). The compare label follows the real surface ("clay-court average"); with no
  surface known it opens on the 52-week average. **Test:** a clay match never reads "hard-court".
- **No source → a dash:** Winners, Unforced errors, W/UE, Net points won, Pressure points won (serve / return), the 52-week
  points per service game.

## Named placeholders (founder sets the final values) — `LIVE_CONST`
`HB_MIN_GAMES` 30 · `U_GAP` 15 / `U_N` 20 · `BP_SAVED_MAJOR` 3 · `DOM_WINDOW_GAMES` 4 · `DOM_START_GAMES` 4 · `BIG_GAP` 15 ·
`HEAT_NEUTRAL` 3 · `PRICE_MOVE_NO_BREAK` null (no threshold ruled; "Price moved, no break" is not built).

## Moments (card list, modal timeline, chart markers) — one source, the point log
- One line per service game with a break point; the **named player did the thing** (the breaker, or the server who saved);
  the set / game score is the score **when that game started**. Labels: Broke serve · Broke, serving for set / match · Broke
  for the set · Saved a / two / three break points. Plus every medical timeout.
- **Card = major kinds only:** a break, 3+ break points saved in one game, a medical timeout. One saved break point never
  reaches the card. Latest 5, then "All moments in match view".
- A card shows its moments only once that match's point log has loaded (fetching every live match's log is new polling,
  not built until ruled). **Test:** majors only; the named side; the start-of-game score.

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
  games = a dash; colour only beyond ±3 of the row's all-sets rate. **Best-of-3 and best-of-5 are never mixed:** the rollup
  pools both formats in sets 1–3, so those cells are a dash (`HB_FORMAT_SPLIT` false) until `build-holdbreak.js` writes a
  format key. **Test:** sets 1–3 dash; set 4 under 30 = count only.

## Points
- The locked Match Stats point by point, reused (`fhPbpSetModel` + `fhSheetPbpHtmlMa2`), fed the live point log as received.

## Look
- Every value is the prototype's inline style, colours through `tokens.css` (`--ma2-*`, `--lv-*`). One avatar (photo by
  player key over the prototype's initials), one filter track, one "i", one hover box, one heatmap cell. Only the live
  status dot pulses. The match modal's scrim starts at `--sf-side` (foundation R6.5), so the sheet centres in the content
  area. At ≤ 900 px the site rail stacks above the page (app-shell), unlike the prototype's fixed side rail.
- Loading = skeleton cards in the card geometry; a stale feed = one line "Live feed not updating · last update HH:MM:SS"
  (both DESIGN GAPs, for review).
