# Trading Report (founder step 13, TEN-421, 2026-10-10)

Applies to `trading-report.js` (rendered into `#tradingGrid`), its `[data-page="trading"]` CSS block in
`bsp-consult-dashboard.html`, and the splits it reads (`build-trading-splits.js` + `trading-sequence-metrics.js`).
Reference = `OFFICIAL VERSION 1.html` → Trading Report, night, 1512px; design file `Trading Report.dc.html` (its raw
hexes are legacy, read through the legacy map). Night only. Header = the shared 35b `.sfh` (`app-shell.md`). The
brief's (override) items beat the reference. **Test:** `test-ten421-trading.mjs` executes the shipped page on the
shipped `live-tab.js` and the dashboard's own Today's Matches / name / price / time helpers, fed a frozen live board
(`tools/fixtures/ten421-trading.json`, 10 Oct 2026 07:38Z, one Interrupted match, frozen clock);
`tools/test-ten421-mutants.js` (47 mutants, 0 may survive); `tools/test-trading-colour-directions.js` keeps the
TEN-151 / TEN-192 rulings that still stand.

## Slate and status
- **Pre-match = Today's Matches → Upcoming for the day** (Today or Tomorrow): `matchDayBucket(m)` (by date, member's
  calendar day — not the frozen `m.day`), finished out (`isFinishedMatch`: a match leaves on the first matches.json
  with its final score), sorted on `m.time` — exactly `getFiltered()` with no filters. A match the Live feed shows
  underway is a Live row, not a pre-match row, even before matches.json flags it. **Test:** "Data 2" (rows = the
  board's list in its order; a match flips when the feed shows it; a stale `m.day` does not move it).
- **Live = the Live page's grid:** `live_snapshot.board`, ATP singles underway (`LiveTab.isAtpSingles` /
  `isUnderway`), ordered by start (fixture date + time). Its card = today's unfinished match of the pair, else the most recent. **Interrupted** (`LiveFeed.isInterrupted`) counts as live and reads an amber
  `INT` pill (the 52px column has no room for the word; the row's title says "Interrupted"). Live is disabled on
  Tomorrow. A decided match leaves on the next snapshot (30 s poll).
- **Header:** title "Trading Report"; the sentence "… for the live read." with the reference's "Rows flip to LIVE as
  play starts." as the grey `.sfh__tail`. **Today / Tomorrow** = the day's **pre-match matches** (Today's Matches → Upcoming minus what the Live
  feed already shows in play — founder R2: Today and Live both count matches and never overlap, as in the reference's
  todayPre count). **Live** = In play =
  underway minus interrupted (the rail badge's and the Live header's count; 0 on Tomorrow). **Window** 24m / 52w.
  **Updated** = `build-info.json` `builtAt` (the deploy run that rebuilt the split files — the generator runs on every
  run) as HH:MM in `stennisfy.tz` (else the browser zone), `—` when the splits index did not load. Never the clock. The index and shards are not committed: a run whose
  generator fails publishes none, so the page gets a 404 and Updated reads `—` — a fresh `builtAt` never sits over
  stale splits. Every fetch has a 15 s ceiling; a failed index is fetched again on the next poll, a failed shard after 2 min.

## Rows
- **Names** = `newsPlayerName(key, feed name)` (the Player Profile / H2H / Live name). **Country** = the index meta
  country through `SfCountryIoc` (3 letters, `—` unknown). **Event** = `sfEventName(raw)` only ("Shanghai Masters"; founder R1: no
  feed round words on line 2, the reference shows tag + event). **Rank** = the card's, else the
  index meta rank. Names wrap rather than truncate (player column 250, not the reference's 180); the ranked view's "v Opponent" wraps too. Only the event line clips.
- **Avatars (override):** initials (`fhIni`), `--inner`, 1px `--edge-10`, white 700, 32px. No photos.
- **Time** = `cardFmtStart` (the card's time, member zone); a live row takes its card's time when the match has today's card (founder R3), else the fixture's Berlin date + time read the same way. Note: the deployed matches.json leaves out matches while they are in play (they return with their final score), so an in-play match usually has no card — no price ("—") and the feed's time.
- **Price** = the player's Today's Matches card: `_mcNowPair(m)` (the card's Now and book ladder), 2 dp, book named as
  the card names it (`MC_BOOK_NAMES` → "Bet105", else `mxBookLabel`: "Pinnacle", "bet365"). **The column = the card face, exactly (founder R3):** no Now pair → `—`, including a match that has started and whose book has gone quiet (the card face prints `—` there too; its "last price before the off" lives only in the move view). A live row's card = today's unfinished card of the pair, else a card matches.json flags live — never another day's meeting. A live fixture without such a card → `—`. On 10 Oct 2026 every card was Bet105 (odds-card-state: 815 of 815 rows). **Book casing = the site house style**
  (TEN-384: "bet365", "Pinnacle", "Bet105"), not the brief's "Bet365" (founder card bafab40e).
- **Tag** = the tier the figures read (picked per surface, see Splits): TOUR (ATP main tour, qualifying included) or CHAL (Challenger, qualifying
  included) — one tag; tiers are never blended.

## Splits — source, count, denominator (all from api-tennis `get_fixtures`, one call per roster player)
Matches counted: `event_type_type` "Atp Singles" → tour, "Challenger Men Singles" → chal (qualifying included, no
event-name filter); status Finished / Retired / Walk Over, with at least one usable box-score row (so walkovers never
count; retirements do, a retirement win is a win). Window: 24 months (same date two years back) or 52 weeks (364
days, its own `tiers52w` buckets, never derived from the 24-month figures), both ending on the build date. Bucket =
the player's tier with more matches **on this match's surface** in the window (the all-surfaces count breaks a tie) ×
**the surface of this match** (never the all-surfaces
bucket); a surfaceless live row takes its surface from the fixture's tournament, else dashes. **n** = matches in that
bucket. "Box score" = `statistics` match period; "pbp" = `pointbypoint` games with tiebreak games and the 7–6
tiebreak summary game dropped; "sets" = `scores`.

| Key | Label | Counts | Out of | Source |
|---|---|---|---|---|
| sh | Service holds | service games held | service games played | box score |
| spw | Serve pts won | points won on serve | points served | box score |
| rpw | Return pts won | points won on return | return points played | box score |
| bps | Break pts saved | break points saved | break points faced | box score |
| bpw | Break pts won | break points converted | break-point chances | box score |
| oph | Opponent holds (inverted) | opponent's service games held | opponent's service games | box score |
| htws | Held to win set | service games held at 5–0…5–4 or 6–5 up | those service games | pbp |
| htss | Held to stay in set | service games held at 0–5…4–5 or 5–6 down | those service games | pbp |
| bofs | Broke opp. 1st game | matches where the player broke the opponent's first service game | matches with pbp | pbp |
| bfsg | Broken 1st game (inverted) | matches where the player was broken in their own first service game | matches with pbp | pbp |
| gfb | Got first break | matches where the player made the match's first break | matches with ≥ 1 break | pbp |
| babb | Break lead lost (inverted) | sets where the player broke and was broken back later in the set | sets where the player broke | pbp |
| bbk | Broken back (inverted) | the player's breaks followed by losing their next service game | breaks with another service game in the set | pbp |
| bbkb | Re-broke | sets where the player broke again after being broken back | sets where the player broke and was broken back | pbp |
| ls1ws2 | Won set 2 (after losing set 1) | won set 2 | lost set 1, set 2 decided | sets |
| ls1b1s2 | Broke 1st S2 (after losing set 1) | the player made set 2's first break | **every** match with set 1 lost and set 2 played (decided, in the pbp log) | sets + pbp |
| ls1o1s2 | Broken 1st S2 (after losing set 1, inverted) | the opponent made set 2's first break | the same matches | sets + pbp |
| ws1w2 | Won set 2 (after winning set 1) | won set 2 | won set 1, set 2 decided | sets |
| ws1wm | Won match (after winning set 1) | won the match | won set 1, match has a winner | sets |
| ws1b1s2 | Broke 1st S2 (after winning set 1) | the player made set 2's first break | **every** match with set 1 won and set 2 played (decided, in the pbp log) — founder card bafab40e | sets + pbp |
| wfs | Won set 1 | won set 1 | set 1 decided | sets |
| ws2 | Won set 2 | won set 2 | set 2 decided | sets |

The design file's BOFS and BFSG read alike; ours differ (BOFS = the player broke the opponent's first service game). Its BABB
("broken straight after breaking") is our bbk; our babb (a break lead lost anywhere later in the set) is labelled
"Break lead lost". Its BBKB ("broke straight back") is not computed; our bbkb is labelled "Re-broke". Its GFB is per
set; ours is per match. Its HTWS is per set; ours per service game served for the set. `ls1fb` (lost set 1 → won the
match) `ls1bf` and `bfs2aws1` (broke first, over set-2s with a break only) are computed but in no tab. **Founder R1:** Broke /
Broken 1st S2 share one denominator — every lost-set-1 match with set 2 played — so a set 2 with no break counts in
neither and they never add to 100 by construction (Tien, hard: 13/33 · 18/33). No other tab holds a complementary
pair. **Test:** each tooltip is one sentence and no two are alike (`test-trading-colour-directions.js`); "Splits"
checks both columns against the generator's keys, one denominator, and rows where they do not add to 100.

## Tabs, columns, cells
- Tabs, groups and highlights = the file's `TAB_GROUPS` / `HIGHLIGHT` (Key Stats: On serve SH SPW BPS · On return RPW
  BPW OPH; Lay Set Winner: After losing set 1 · After winning set 1 · All matches BPW; Scalping; Lay Break Up; Set
  Trading 2–0; Lay Serve Set/Match; Lay Set & Break). One grid: `52px 250px 56px 36px 8px repeat(var(--tr-n), 1fr)`.
- Cells (keep as built): `—` absent or total 0; total < 5 "won/total" small grey; < 10 % small grey + "won/total ·
  small n"; ≥ 10 % 15/700 in the tier colour. **Tier (founder R1, the site ±3 rule as on the Live / Profile
heatmap):** gap = the cell's printed % − the column's printed field % (both rounded); |gap| ≤ 3 amber, ≥ 4 green /
red, flipped on inverted metrics; the cell colour, the filter-menu counts and the filter all read that one gap. The
**field average = pooled won / pooled total over every player on the selected day, pre-match AND live** (founder R2:
  after Surface and Tournament; before Pre-match / Live, search and column filters; same window), so a player's colour
  does not change when his match flips to LIVE. Player n < 10 dims to grey **and is untiered** (founder R2: the filter-menu counts equal the cell colours, column by column — counted over the rows on screen after the search box, before the column filters). A cell under 10 is untiered and never
  passes an active filter. The footnote says all of this in one paragraph; no placeholder wording.
- Behaviour (keep as built): column click = best first → worst first → match pairs; tab switch resets the sort;
  filters held per tab per column; Escape / document click close menus; day switch resets Surface and sort; search =
  case-insensitive substring before sorting. The Tournament drop-down lists the slate's events (canonical names)
  after "All tournaments" and filters the rows (and the field).

## Display (night)
- Cards (control bar, table head, rows, empty state) = `--card` + `--top-light`, no outline, radius 16. Dividers:
  `--edge-6` between matches, white 3% between the two players of a match.
- Segmented controls (Pre-match / Live, Today / Tomorrow, 52 weeks / 24 months — the reference's order, 24 months the
  default — the seven tabs) = darker track
  (`--inner`, padding 3, radius 10; selected `--selected` + 1px `--edge-16`, white 700; idle grey 600; disabled grey
  at 45%, no edge). Drop-downs = site filter menu (`--card` + `--edge-10`, radius 10, padding 4, `--shadow-menu`,
  rows 12.5 with `--inner` hover, selected `--selected` + white ✓, max-height 252), small chevron; Surface is text only.
  Search = `--inner`, no edge, radius 9, `--edge-16` on focus, no ring.
- Head: group bands caps grey over a 6% rule; column labels Hanken caps 10.5/700/0.10em grey, the sorted label + arrow
  white; "field N%" mono 10 grey centred; funnel white when its filter is on; highlighted columns = `--wash-5`.
- Status pill (override): LIVE = mono 9/700 caps white on `--selected`; PRE = grey on `--inner`; INT = amber on
  `--inner`; radius 5, no edge. Tour tag = `--inner`, radius 4, mono 8.5/700 caps grey, no edge.
- **Colour:** figures = field tiers (green above, amber within 3 pts, red below; the filter dots the same); odds, n,
  names, time white; sub-lines grey; "Clear" = `--link`, underline on hover; names white, underline on hover (they
  open the profile). No blue fills, rings or outlines; no surface colours; amber only on the tier and INT. **Test:**
  "Colour".

## Pro gating
Trading Report is Pro-locked in the rail (`sfPlanLocks`), but navigation is not gated (`app-shell.md`): a Free user who
opens it from the rail or a link sees the full page. The reference shows no Free teaser, so there is none.
