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

### ✅ (4) Measured matcher failure rate — not the old 2–5% / 5–10% estimates
**Measured 0.0% (0 of 17)** on a same-time cross-venue slate. Method: the two live venue
inventories were matched against each other (every Kalshi event that also exists on
Polymarket *should* join; a failure is a pure matcher miss, with no board-slate staleness
confound). 17 Kalshi events → **17/17 confident 1:1 joins, 0 ambiguous, 0 gaps.**

This number is honest about how it was reached: an initial pass reported a **false 0%**
while silently missing two real matches. Both were caught by hand-verification and fixed:
- `Damm Jr vs Shelton` (Kalshi) ↔ `Martin Damm vs Ben Shelton` (Polymarket) — "Jr" had been
  treated as a surname token. Fix: strip generational suffixes (Jr/Sr/II/III/IV).
- `Shimabukuro vs Pacheco Mendez` (Kalshi) ↔ `Rodrigo Pacheco` (Polymarket) — Polymarket
  truncated the compound surname. Fix: accept a shared trailing surname token at the pair
  level (both players must still clear the bar; any ambiguity is dropped).

**Caveat, stated plainly:** n=17 is one slate on one day. 0% is a snapshot, not a permanent
guarantee. That is exactly why the split counter ships in the admin dashboard — the failure
rate is **measured continuously in production**, so if it drifts you see it, you don't guess.

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
