# MARKET SIZE — Hash-ID Filter Fix · Validation Report (TEN-8)

**Founder follow-up item 1: "HASH-ID FILTER — DO THIS FIRST."**
The Market Size block was absent on exactly the biggest matches (de Minaur–
Tsitsipas, Majchrzak–Paul, Mannarino–Tien, Fils–Jodar). This report answers the
two investigation questions, documents the fix, and gives the end-to-end
evidence. **No merge to main without approval — this is the pre-merge gate.**

---

## The bug, in one line

`fetch-market-size.js` selected board matches with
`id.startsWith('upcoming-') || id.startsWith('past-')`. The marquee/live cards
do **not** carry those prefixes — they carry a bare 32-hex odds-feed hash — so
they were silently dropped before a single venue was queried.

---

## Q1 — Where each id scheme comes from, and which builder assigns which

The board carries **three id shapes**, all assigned in `bsp-pipeline.js`:

| Builder | Line | id it assigns | Source | Example |
|---|---|---|---|---|
| `buildMatchObject` | `bsp-pipeline.js:1649` (`id: oddsEvent.id`) | **bare 32-hex hash** (no prefix) | **the odds feed** — the id is the odds provider's own event id, passed through verbatim | `cc2bdc2041cd08f06f6ea0a6f20b0b9b` (de Minaur vs Tsitsipas) |
| `buildUpcomingMatchObject` | `bsp-pipeline.js:2570` | `upcoming-${fixture.event_key}` | api-tennis fixture | `upcoming-12149562` |
| `buildPastMatchObject` | `bsp-pipeline.js:2396` | `past-${fixture.event_key}` | api-tennis fixture | `past-12149557` |

The hash-id cards are precisely the matches with live odds — the marquee cards —
because they are built **from** the odds feed. That is why "biggest matches" and
"missing Market Size" lined up perfectly. On the live board right now: 37 matches
= 25 prefixed + **12 hash-id** (all of today's 07-28 slate, plus two 07-29).

## Q2 — Does anything ELSE filter on the id prefix? (the "bigger finding")

**Directly on the prefix string, no** — `fetch-market-size.js` was the only place
that did `startsWith('upcoming'/'past')`. So Market Size was the only feature
gated on the literal prefix.

**But the same blind spot exists one layer down, and it is the bigger finding.**
Both the pipeline and the dashboard derive a shard "event key" by *stripping the
prefix* — and both did it with `split('-')` logic that returns an **empty string**
for a hyphen-less hash id:

- `bsp-pipeline.js:3094` `eventKeyOf(m)` → `parts.length > 1 ? parts.slice(1)… : ''`
- `bsp-consult-dashboard.html:4943` `eventKeyOfMatch(m)` → same shape

Consequences for hash-id (marquee) matches:

1. **Odds-movement shards** — `extractOddsShards` (`bsp-pipeline.js:3106,3111`)
   computes `ek = eventKeyOf(m)` and `if (!ek) continue`. For a hash id `ek === ''`,
   so **no odds-movement shard is ever written for a marquee match.** The Odds tab
   timeline chart is silently unavailable on exactly the live cards. (The live
   `odds-index.json` is currently empty, consistent with this — worth its own look.)
2. **Point-by-point** — `pbpEventKey` (`:4864`) returns `null` for a hash id
   (`/^\d+$/` fails on hex), so the point-by-point tab can't key a marquee match.
   Lower impact: pbp is finished-matches-only, and marquee cards are usually live.

**Recommendation (separate ticket, not this PR):** fix the *write* side —
`bsp-pipeline.js:3094 eventKeyOf` — to the same hyphen-tolerant form, so marquee
matches get odds-movement shards too. That is a change to a live core feature's
data generation and deserves its own validation run; I did **not** fold it in here.
This PR fixes the read side of `eventKeyOfMatch` (safe — see below), which is
enough for Market Size and is a no-op for odds today.

---

## The fix (2 files, minimal)

**1. `fetch-market-size.js`** — filter on the *shape of a real match*, not the id
prefix:
```js
const matches = slate.filter((m) => m && m.id != null && m.p1 && m.p2);
```
The fetcher's own `eventKeyOf` (`:310`, `indexOf('-')`-based) already returns the
whole id when there is no hyphen, so a hash-id match is written to
`market/<hash>.json` correctly — no change needed there.

**2. `bsp-consult-dashboard.html:4943 eventKeyOfMatch`** — align the *read* key to
the writer: strip the prefix if present, else use the whole id (`indexOf('-')`).
This is what lets the dashboard find `market/<hash>.json`.

**Why editing the shared `eventKeyOfMatch` is safe for the Odds tab:**
`loadOddsShard` is index-gated (`bsp-consult-dashboard.html:4964`,
`idx.has(ek)`). A hash id is not in `odds-index.json` (the pipeline never wrote
one), so the lookup returns `null` — identical to the old empty-string path. No
odds regression; prefixed ids are unaffected (event keys are numeric, no internal
hyphens, so both derivations agree).

---

## Evidence

### A. Filter now includes the marquee matches (deterministic, no network)
Against the **live** `matches.json` (37 matches):
```
OLD filter selected: 25   NEW filter selected: 37
NEWLY INCLUDED (were silently skipped): 12  — all hash-id, all today's slate:
  + cc2bdc…  Alex de Minaur vs Stefanos Tsitsipas   2026-07-28
  + 296715…  Kamil Majchrzak vs Tommy Paul          2026-07-28
  + 30f032…  Adrian Mannarino vs Learner Tien       2026-07-28
  + b09766…  Arthur Fils vs Rafael Jodar            2026-07-28
  + (…8 more)
any selected missing p1/p2? false   (no junk admitted)
```

### B. End-to-end run against the live venues (DoH path)
```
kalshi events=17  polymarket singles=351
wrote 22 shards   matcher_failed: 0 (both venues)
both_present=18  neither_present=15
hash-id (marquee) shards written: 11 / 12
```
Every marquee match the founder named now resolves on both venues:
```
Alex de Minaur vs Stefanos Tsitsipas  |  Kalshi $154K   Polymarket $45K
Kamil Majchrzak vs Tommy Paul         |  Kalshi $156K   Polymarket $21K
Adrian Mannarino vs Learner Tien      |  Kalshi $32K    Polymarket $8K
Arthur Fils vs Rafael Jodar           |  Kalshi $45K    Polymarket $3K
```
(No fabricated data: the 12th hash-id match hit `neither_present` — genuinely no
market on either venue — and correctly writes no shard.)

---

## Item 2 answers (Polymarket) — folded in, no code change here

- **Hard timeout — YES.** `REQUEST_TIMEOUT_MS = 15000` (**15 s per request**),
  enforced in `getJson` via `req.on('timeout', () => { req.destroy(); reject… })`
  (`fetch-market-size.js:51,174`). A *slow* request is abandoned at 15 s, so it is
  skipped, not blocking — the founder's exact concern is covered for slow as well
  as failed requests.
- **Worst-case Polymarket wall time is bounded:** the inventory loop is ≤ 8 pages
  sequential (`offset 0…700`, `:232`), so ≤ 8 × 15 s = **120 s** even if every page
  hangs. Kalshi runs in parallel (`Promise.all`, `:364`). The whole step is
  best-effort (`|| true`) under a **30-min job cap** (`pipeline.yml:47`); there is
  no per-step `timeout-minutes`, but the per-request cap already bounds it.
- **Can the Gamma query be scoped to our board?** Not to our exact matches:
  `/events` filters on `tag_slug`, `closed`, `active`, `limit/offset` — there is no
  per-player/per-match server-side filter and no field-selection, which is why one
  number per match costs ~6 MB. **Noting and moving on** per instruction. A cheap
  reduction lever (add `active=true`, drop outrights earlier) is possible but is a
  code change for the item-2 follow-up, not this PR.

## Los Cabos date check (item: "one quick check, then close")
Confirmed: Los Cabos R1 fixtures on the board carry **correct match dates**
(2026-07-28 / 2026-07-29 — real match days; today is 07-28). The 30-hour Pinnacle
display gate reads `m.date`, which is right. The venues' 07-26 is a
market-open/venue-metadata date, exactly as the founder surmised. **Closing the
date item — no bug, no further investigation.**

---

**Gate:** staged on branch `ten8-market-size-hashid` off `origin/main`. Awaiting
approval before merge. Standing rules honoured: no fabricated data, validation
before merge, no merge to main without sign-off.
