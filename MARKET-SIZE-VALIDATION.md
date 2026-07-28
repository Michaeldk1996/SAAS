# MARKET SIZE — Validation Report (pre-merge)

**Branch:** `ten8-market-size` (off `main`, isolated worktree) · **TEN-8** · Captured 2026-07-28
**Gate:** No merge to main without founder approval. This report is the pre-merge evidence.

All numbers below are **measured against live venue data**, not estimated. Both venues
were pulled live via the DoH `--resolve` workaround (founder LAN DNS-poisons the hosts;
DoH returns the real IP, so the same path works in CI where DNS is clean).

---

## 1. Spec built exactly as approved

| Element | Built |
|---|---|
| Single `MARKET SIZE` header | yes |
| Basis = 24h notional at $1 settlement value | yes (`marketSize24h`) |
| Kalshi = sum of both legs' `volume_24h_fp` | yes — verified 2 legs/event, summed |
| Polymarket = `volume24hr` of the **moneyline** market | yes — `sportsMarketType=="moneyline"`, never the ~16 side-markets |
| Deepest-first sort restored | yes — venue with larger `marketSize24h` on top |
| Methodology line as worded | yes (see §5) |

**Your addition (both bases stored):** every shard carries, per venue, BOTH
`marketSize24h` (displayed) **and** `marketSizeAllTime` (data only) — Kalshi all-time =
sum of both legs' `volume_fp`, Polymarket all-time = the moneyline market's `volume`.
Cheap to store now, impossible to backfill later. All-time is written to the shard and to
`market-size-health.json` for the admin dashboard; it is never displayed on the board.

---

## 2. The four confirmations

### ✅ (1) Completed matches freeze the 24h figure at settlement and never re-query
**Confirmed by test.** A venue block gains `frozenAt` the first run its market is settled
(Kalshi legs off `active` / Polymarket moneyline `closed:true`). On every later run
`venueBlock()` returns the prior frozen block untouched. Test: seeded a shard with Kalshi
settled at a sentinel `$99,999.99`, re-ran live — Kalshi stayed `FROZEN-SENTINEL /
99,999.99` with its original `frozenAt`, while the **live** Polymarket leg refreshed to
`$45,247.98`. Freeze is **per venue**, not whole-shard.

The methodology line (§5) explicitly names both states: a settlement-frozen 24h window is
a different object than a live 24h window.

### ✅ (2) Missing-venue behaviour — as agreed
Both venues always hold their line when the block shows. A venue with no market (or a
market that fails the matcher) renders an **em dash** — never a substituted number. The
whole MARKET SIZE block **hides only when neither venue is present**. Verified: a synthetic
"ghost" match (no market on either venue) produced **no shard** (block hides); a real match
present on both produced both lines.

### ✅ (3) Split admin counters — "venue has no market" ≠ "matcher failed below threshold"
`market-size-health.json.counters` tracks, **per venue**, three disjoint buckets:
`matched`, `no_market` (no candidate market at all), and `matcher_failed` (a plausible
market exists but could not be confidently/uniquely joined). These are separate counts, as
required.

### ✅ (4) Matcher failure rate — measured against the real board, hand-verified

*(This replaces the earlier "0 of 17". That number was measured by cross-matching the two
venue inventories against **each other** — and both venues agree on each match's date, so
that method is structurally blind to a board-vs-venue date disagreement. Measuring against
the actual board, as required, exposed exactly such a failure. The old method is exactly the
kind of self-referential shortcut to avoid.)*

**The slate (named, whole, not curated).** The live production board `matches.json`, fetched
from the deployed Pages site on 2026-07-28. **38 ATP men's singles matches.** Tournaments:
**ATP Washington Open** and **ATP Los Cabos** (plus one completed **ATP Estoril** row). Dates
**2026-07-26 → 2026-07-29**. Every match on the board was included — nothing dropped to
flatter the number.

**Ground truth: hand-verified, 100% (not a sample, not the matcher's own score).** Kalshi's
inventory is 17 events — I read all 17 by hand. Polymarket's inventory is 356 markets — I
filtered by surname to the candidates for each board match and read them by hand. For **all
38 matches × 2 venues = 76 venue decisions**, I determined by hand (a) whether a market
truly exists on that venue and (b) where the matcher matched, whether it matched the *right*
market. Correctness was **not** inferred from the matcher's confidence.

**Failure defined three ways — only the last two count:**

| Venue | Markets that actually exist (denominator) | ✅ matched correctly | ✗ **missed** (market exists, we returned absent) | ✗ **wrong match** (attached to a different match) | no-market (correct, not a failure) |
|---|---|---|---|---|---|
| **Kalshi** | **17** | 12 events (14 board rows) | **5** | **0** | rest |
| **Polymarket** | **21** | 16 matches (18 board rows) | **5** | **0** | rest |

- **Kalshi matcher failure rate = 5 / 17 = 29.4%.** Polymarket = **5 / 21 = 23.8%.**
- **Wrong matches — the category that actually hurts — = 0 of 76.** Every same-surname trap
  on the slate was correctly rejected by the opponent + uniqueness guards: Tabilo (vs
  Griekspoor on the board / vs Atmane on the venue), the two Svajdas (Trevor vs Zachary), two
  Kouame matches (vs Dimitrov / vs Winter), two Tomic matches, two Vukic matches, two
  Michelsen matches, Musetti appearing in two matches. **Name-matching made 0 errors**,
  including the hard ones (`de Minaur`, `Pacheco Mendez`, `Damm Jr.`, full-name-vs-initial).
- **All 10 misses (5 matches × both venues) share ONE cause.** The five Los Cabos R1 matches
  (Brooksby–Moutet, Shapovalov–Hijikata, Svrcina–Walton, Zheng–Landaluce, Shimabukuro–Pacheco
  Mendez) are dated **2026-07-29 on the board** but **2026-07-26 on both venues** — a 3-day
  gap that the old ±2-day date **pre-filter** turned into an absent. Both venues independently
  agree on 07-26; the market unquestionably exists (exact player pairs). These are genuine
  *misses*, not coverage gaps.

**One board-data edge, disclosed (not charged to the matcher):** the board carries a
duplicate row `Ugo Humbert vs Andrej Martin` next to the real `Ugo Humbert vs Andres Martin`;
both venues list only Andres. The matcher joined the (correct) Humbert–Martin market to both
rows. The market is right; the spurious row is an upstream board-dedup issue. Flagged for the
board-data owner, not counted as a matcher failure.

**Fix applied and re-measured on the identical live slate.** `matchVenue` now matches on
names first and uses the date window only to break *multiple*-candidate ties, instead of as a
hard pre-filter (a player pair is unique within a tournament, so a unique name match is safe
to take even when board/venue dates disagree). Re-measured:
**Kalshi misses 5 → 0, Polymarket misses 5 → 0, wrong matches 0 → 0, ambiguous 0 → 0.** Only
those 5 rows changed; each joined to its obviously-correct market (e.g. `Brooksby v Moutet →
KXATPMATCH-26JUL26BROMOU / PM 3109591`). Post-fix failure rate on this slate: **0 / 17
Kalshi, 0 / 21 Polymarket** — now honestly earned, with denominator and hand-verification
attached, not a self-graded 0.

**Caveat, plainly:** this is one slate on one day (38 matches). 0% post-fix is a snapshot, not
a guarantee — which is why the split counter (matched / no_market / matcher_failed) still
ships to the admin dashboard so the rate is measured continuously in production, not guessed.

### ⚠️ Coverage finding (separate from matcher accuracy) — needs a decision before merge
The fetcher's slate filter (`fetch-market-size.js`, ~L367) processes only ids starting
`upcoming-` / `past-`. The current live board carries **today's marquee Washington matches
under bare-hash ids**, which the filter skips — including the highest-volume markets on the
slate: **de Minaur–Tsitsipas ($153K Kalshi / $45K PM), Majchrzak–Paul ($150K), Mannarino–Tien,
Fils–Jodar, Giron–Hewitt, Nakashima–Etcheverry, Svajda–Mensik, Humbert–Martin.** Both venues
carry these markets and the matcher joins them correctly (verified above), so the block would
be **absent on exactly the matches a bettor cares most about.** This is a slate-filter / board
dual-representation question, **not** a matcher error, and I did not change the filter blind —
it may be intentional (eventKey scheme / dedup with the odds pipeline). **Decision needed:**
widen the filter to cover hash-id board matches, or confirm those are rendered elsewhere.

---

## 3. Data contract (verified live)

Shard `./market/<eventKey>.json`, gated by `./market-index.json` (flat eventKey array,
same 404-avoidance pattern as `odds-index.json`):

```json
{"eventKey":"...","matchId":"...","p1":"...","p2":"...","tour":"...","date":"...",
 "venues":{
   "kalshi":    {"present":true,"matched":true,"marketSize24h":153263.05,"marketSizeAllTime":193092.2,"ref":"KX...","settled":false},
   "polymarket":{"present":true,"matched":true,"marketSize24h":45247.98,"marketSizeAllTime":57854.48,"ref":"3109536","settled":false}}}
```
Missing venue: `{"present":false,"matched":false,"reason":"no_market"|"matcher_failed"}`.
Settled venue additionally carries `"frozenAt":"<iso>"`.

Live example (de Minaur vs Tsitsipas): Kalshi **$153K** 24h / $193K all-time (both legs
summed); Polymarket **$45K** 24h / $58K all-time (moneyline). On these active markets the
24h/all-time ratio is ~0.78–0.79 — i.e. young markets where 24h ≈ most of lifetime volume.
Your failure-mode concern (a mature market whose small 24h understates true depth) shows up
as a **low** ratio; the divergence data to detect it is captured per match in the health
file, and I'll report the distribution once it has run against the live board for a few days.

---

## 4. Refresh & persistence

- Wired into the existing **15-min pipeline cron** (`pipeline.yml`), after `matches.json` is
  built, as a **best-effort** step (`|| true`) — a venue outage cannot break the pipeline; the
  previous run's committed shards remain and are re-copied, and settled markets stay frozen.
- Site assembly copies `market-index.json`, `market/`, and `market-size-health.json` into
  `_site` explicitly (the repo is not the doc root — uncopied files 404 silently).

---

## 5. Methodology line (no cross-venue equivalence language)

> Market size is each venue's 24-hour traded volume at $1 settlement value — Kalshi as the
> sum of both players' contracts, Polymarket as the moneyline market. Venues are shown
> independently and not treated as equivalent. For completed matches the figure is frozen at
> settlement, a different window than a live 24-hour figure.

---

## 6. Open items before merge (honest)

1. **Venue reachability from GitHub Actions egress** — the fetcher works locally via DoH; I
   have not yet confirmed Kalshi/Polymarket accept GH Actions IPs (Kalshi is US-regulated;
   Polymarket geoblocks US *trading* though its data API is generally open). This is the one
   open technical risk. To be verified with a CI dry-run before merge; the best-effort guard
   means a block degrades gracefully (no shards) rather than breaking the pipeline.
2. **Admin all-time-vs-24h surfacing** — the data is ready in `market-size-health.json`
   (split counters + per-match divergence). The admin dashboard itself lives on a **separate
   branch/track** (admin), outside the TEN-8 write boundary. I did not reach across tracks to
   edit it. Say the word and I'll either wire it on the admin branch or hand the health-file
   contract to whoever owns that track.
3. **Dashboard display panel** — built and reviewed on this branch. Renders in the Edge
   Model "Fair price & value" section as a sibling to Sharp Estimates: `MARKET SIZE` header,
   up to two venue lines sorted deepest-first (present above missing), em dash for a
   missing/unmatched venue, `· final` marker on a settlement-frozen figure, 24h basis only,
   the methodology sentence as caption + tooltip. Rides a lazy, index-gated, memoised shard
   load cloned from the odds-movement pattern (fetched at most once per match, degrades
   silently if the index 404s), with a late-repaint guarded on the open match id. The
   currency formatter passes all nine spec cases including the `$1000K→$1M` promotion edge.
   **Not yet done: a live browser render against real shards** — the block is verified by
   unit-checking its logic, not yet by driving the dashboard end-to-end. That end-to-end
   render is part of the pre-merge CI dry-run in item 1.

Standing rules held: no fabricated data, validation report before merge (this), no merge to
main without your approval. Directional flow remains the separate follow-up; the leg finding
(per-book aggregation, no mirroring) carries across to it.
