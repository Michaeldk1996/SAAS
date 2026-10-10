# Live page (founder step 11, TEN-417, 2026-10-10)

Applies to the Live page renderer — the last `<script>` block of `bsp-consult-dashboard.html` (`#lvTab`, `renderVals` /
`render`, the `.lvcard` / `.hbcell` CSS above it) — and its data layer `live-tab.js` (`window.LiveFeed`). Reference =
`OFFICIAL VERSION 1.html` → Live, night, 1512px; design file `Live.dc.html` (the 2026-10-08 sheet refresh; its raw hexes
are legacy, read through `tokens.json → legacyColourMap`). Night only. Header = the shared 35b `.sfh` (`app-shell.md`).
Where the reference's runtime colour conversion and the design file disagree, the design file + the founder's TEN-417
text win (point chips, score-tile fills, the inner-tone tracks). **Test:** `test-ten417-live.mjs` executes the shipped
renderer on the shipped `live-tab.js` with a real-feed fixture (`tools/fixtures/ten417-live.json`);
`tools/test-ten417-mutants.js` (44 mutants, 0 may survive). `tools/test-live-tab-feed.js` keeps the TEN-190 source guards.

## Data
- **Feed:** `live_snapshot` (Supabase), written by the `live-poller` Edge Function from api-tennis `get_livescore` every
  **10 s** (pg_cron; measured 10.0 s between writes, 9 Oct). The page reads it by Realtime push (a push triggers one
  PostgREST read; 25 s re-sync), falling back to a 30 s poll; only while Live is the open page. The point log
  (`live_pbp`) is read only while a sheet is open (12 s TTL). Every figure on the card and the sheet comes from these two
  rows or from `holdbreak.json`; nothing is generated. **No sample / seeded data, no disclaimer footer.**
- **Who is on the grid:** ATP singles (`event_type_type` /atp/ + /single/) that the vendor flags underway
  (`event_live = "1"`, no `event_winner`, status not Finished / Retired / Walk Over / Abandoned / Cancelled).
- **Status:** `event_status` matching /interrupt|suspend/ = **Interrupted** (amber); every other underway status
  ("Set 1" … "Set 5") = **Live**. A decided match leaves the grid on the next snapshot (≤ 10 s) and an open sheet on it
  closes; it reaches Matches → Completed through `matches.json` on the next pipeline publish, not through this page.
- **Header:** In play = live matches (not interrupted); Interrupted = the interrupted ones (`--amber` above 0, grey at
  0); Events = distinct `tournament_name` on the grid; **Updated = `live_snapshot.updated_at`** (the feed's own last
  refresh) as HH:MM:SS in the member zone (`stennisfy.tz`, else the browser zone; hover = full date-time), never the
  clock; before the first snapshot every figure is a grey "—". Nothing in play = the empty state ("Nothing in play" 15 /
  700 + "Matches appear here the moment the first point is played." 13 grey, card tone, radius 14, 9px grey dot).
- **Names:** a player = `newsPlayerName(key, feed name)` (the Player Profile / H2H / Match analysis / News name of his
  key, else the feed's api-tennis spelling). Event = `sfEventName(tournament_name)` (the canonical event table) + " · " +
  the feed's round words ("Shanghai Masters · 1/32-finals"); the sheet line adds "ATP · ".
- **Ratings + Stats** come from the feed's own box score (`statistics`, periods `match`, `set1` … — per set as the feed
  publishes it): Serve / Return rating = `house-ratings.js` on that box score (TEN-327); Dominance ratio = return points
  won % ÷ (100 − service points won %); Ratio W/UE = winners ÷ unforced errors (match to date), with W/P and UE/P over
  total points. Ratings always read the match to date. Winners / UE all 0 over 10+ points = not tracked → "—". No
  Pressure points row (no feed stat). A missing value = grey "—", no bar; a zero = "0", no bar; a rate over 0 attempts
  = "—". Stats scopes = MATCH + every SET n the feed has rows for; no rows anywhere = no Stats tab and no rating cards.
- **Break/Hold:** `holdbreak.json` (build-holdbreak.js, nightly): 24-month window, all surfaces (the Live page passes
  'all'), rows = the server's service-game ordinal within the set (Game 1-2 = his 1st service game … 6th+ folded),
  sets S1–S5. Cell colour = the sign of the gap to the player's own global for that bucket, **neutral within ±3
  inclusive** (founder TEN-417 R1: green from +4, red from −4), taken from the same rounded gap that is printed under the
  rate ("+4 pts", true minus), so colour and figure never disagree. Tooltip: "Game 1-2 · Set 1" / rate · count / "at
  global · −3 pts vs this bucket's global 84%" — the word follows the SAME band as the colour (founder R2): "at global"
  within ±3, "above global" from +4, "below global" from −4; "· small sample" on n 5–9. n 5–9 smaller + greyed, n < 5 raw "a/b", n = 0 "—", unreachable sets "—" with the S head dimmed.
  *Exception:* Player Profile shares the engine and keeps its own U3 boundary (±3 coloured) until the founder rules it.
- **1st serve percentage** has no count in the feed: its count is first serves in (the 1st-serve points played) over all
  service points (1st + 2nd), same period — "76% (19/25)", "65.5% (19/29)"; one decimal, whole only when exact.

## Point log (the feed's quirks)
- The feed closes a tiebreak set with an extra "Set N" game row scored **7 – 6** with `serve_lost` on the tiebreak's
  loser. That row is the tiebreak, never a break: hidden when the tiebreak's point rows are logged, never LOST SERVE,
  never plotted in Momentum. **Test:** "a 7–6 row with no tiebreak rows logged".
- Point lists are garbled: after the real sequence the feed repeats a tail of it (40:15 → 30:15 → 40:15, A:40 → 40:15).
  **Every chip must be reachable from the one before it** (from 0:0; one point to either side; 40:40 → A:40 / 40:A;
  advantage → 40:40) — founder TEN-417 R1. Kept = the longest reachable prefix; if that does not end on the winner's game
  point (A, or 40 with the other below 40), the rest is walked keeping only reachable chips until it does (measured, 749
  decided Shanghai games: 731 by the prefix, 16 by the walk, 2 never — shown, nothing lifted). The **lifted chip**
  (`--selected` + `--edge-16`, white 700) is the last kept chip = the score before the game-winning point. Momentum reads
  the same last chip; never a game point → smallest bar, no label; a game that reached deuce → "AD". **Every game opens
  on a 0:0 chip** (founder R2, the reference; not tiebreak rows, not a log that joins mid-game).
- **BP** (founder R2): a BP chip follows exactly the scores where the RECEIVER is one point from the game — he is on 40
  with the server on 30 or less, or on advantage (0:40 / 15:40 / 30:40 / 40:A for him, mirrored). **Never on 40:40.**
  Read off the chip's score and the row's server, not the feed's `break_point` flag (it lands one score early, on the
  deuce before the receiver's advantage). **Test:** "R1 fix 7 + R2" walks every decided game of both fixture logs: 0:0
  first, every chip reachable, BP exactly where the rule says, none on 40:40, lifted chip = the winner's game point.
- Tiebreak rows: one per point (the feed's `player_served`); the point's winner is the row's own word (`serve_lost` set
  = the server lost it), so a dropped row cannot flip it; LOST SERVE on a mini-break. **SP / MP** on the leader's side
  when he has ≥ target − 1 points and leads (target 7; 10 in a Grand Slam's deciding set); MP when that set wins him
  the match. Best-of: a Grand Slam main draw = 5, everything else (Slam qualifying included) = 3; it only dims sets the
  format cannot reach, picks MP and the tiebreak target — never a printed figure.

## Display
- Grid `repeat(auto-fill, minmax(430px, 1fr))`, gap 12, cards top-aligned. Card = `--card`, no outline (1px transparent
  edge in `.lvcard`, so the hover `--edge-16` fires — supersedes TEN-190 D1), radius 14. Head 10×16 on `--line`: event
  11.5 grey; status mono 9.5 / 700 / 0.12em ("SET 3", white, 5px dot pulsing 1.6s) or Hanken caps 10.5 / 800
  "INTERRUPTED" in `--amber`, no pulse. S1…Sn 26px mono 9 + PTS 40px (caps label). Rows 9×16 / 11: initials avatar 30,
  name 14 / 700, lime serve dot 8 **only while live** (founder R1: none on an interrupted card, as on the sheet); sets
  mono 15 (won white 700, lost grey 500, current white 700); PTS white 700.
- **No photos anywhere (override):** initials avatars (`fhIni`) — `--inner`, 1px `--edge-10`, white 700 (30 / 42 / 30).
- Sheet: scrim `--backdrop` + blur 3 from `--sf-side`; sheet `--card` + `--edge-10`, radius 16, max-width 940,
  max-height 88vh, `--shadow-modal`, body scrolls under the fixed head. Backdrop click, ✕ and Esc close it; a rail click
  closes it (sfOverlayClosers). Opening a card resets to **Ratings · Match · Set 1 · Hold**.
- Head: caps status 10.5 / 700 + 6px dot ("Live · Set N" white, "Interrupted · Set N" amber) over the event line 12 grey.
  Players: avatar 42, name 16 / 700, caps sub "N sets · serving" (serving only on the server while live), lime dot.
  Score tile `--inner`, radius 12: heads mono 9 (current set white 700), cells mono 16 in 26px — won 8% white fill /
  white 700, lost 2.5% / grey 500, current 5% + 18% ring / white 700; PTS 44px on an 8% white rule.
- Segmented controls (tabs, scope, set, HOLD / BREAK) = track `--inner`, padding 3; selected `--selected` +
  `--edge-16`, white; idle grey. Words are Hanken caps (MATCH, HOLD), "SET n" mono 10.
- Ratings: 4 framed cards (`--card` + `--edge-6`, radius 12) in `auto-fit, minmax(min(100%,340px),1fr)`; figures mono
  24, lead white 700 / trail `--text-soft` 500; bars two 6% tracks, lead `--bar` / trail `--bar-2`, each drawn inward
  from the centre at **that player's share of the pair, A ÷ (A + B) of the half** on every row — rates, counts,
  ratings, ratios (founder TEN-417 R1, SUPERSEDES TEN-263's `fhStatBarWidth` on Live): 76% v 65.5% → 53.7 / 46.3; 3 v 2
  → 60 / 40; 52 v 102 → 33.8 / 66.2; a zero draws nothing (0 v 1 → none / the whole half); one side missing → no bar on
  either side. Momentum card: one column per set (width = games plotted), bar height
  = margin, A up `--viz-lead` / B down `--viz-second`, break = `--neg` outline, set label "Set n · a–b" (current white).
- Chips: LOST SERVE / BP / SP / MP = Hanken caps 10.5 / 800 (red only for LOST SERVE and BP). Tooltips (ⓘ, heat cells)
  `--card` + `--edge-10`, radius 10 / 9, `--shadow-menu`.
- **Colour (founder TEN-417):** blue = bar fills only; green / red = heatmap gap, LOST SERVE, BP, break outline; amber
  = Interrupted only (header count, card status, sheet status); lime = the serve dot only. No blue text, rings or
  fills elsewhere; no surface colours. **Test:** "Colour".
- **Rail badge = header In play** (founder TEN-417 R1): one predicate, `LiveFeed.isInterrupted` (live-tab.js); the
  payload's `inPlay` feeds both the header and the rail badge (`app-shell.md`), and `LiveFeed.liveCount()` (the
  off-page read) counts the same. **Test:** "R1 fix 1" through the real live-tab.js fetch → publish path.
