# Market Signal block — data-layer feasibility

**Ticket:** TEN-8 · Market Signal block · research only
**Branch:** `research/market-signal` (push, no merge, no touch to `main`)
**Author:** CEO (claude_local) · **Date:** 2026-07-28
**Scope:** feasibility findings only. No pipeline/config/build changes in this branch. No implementation code.

All coverage, price, and shape claims below were pulled from **live endpoints on 2026-07-28**, not from
training memory. Every pricing/limit/coverage claim carries a source URL. Where I could not verify something,
it says **"Unknown — could not verify"** rather than a guessed number.

> **Environment note (affects how this was gathered, and local dev later).** The founder's network resolves
> `*.polymarket.com`, `*.kalshi.com`, and `*.betfair.com` to a single ISP block IP (`202.169.44.80`, connection
> refused) — an ISP-level gambling-domain DNS block. `the-odds-api.com` and GitHub resolve normally. I bypassed
> it by resolving the real IPs over DoH (`https://1.1.1.1/dns-query`) and connecting with `curl --resolve`.
> **This block is local to the founder's network only.** The pipeline runs in GitHub Actions (US/cloud runners),
> which are not behind this block, so production collection is unaffected. Local dev/testing from the founder's
> network will need the same DoH workaround or a VPN.

---

## 0. COVERAGE GATE — answered first, as ordered

**Result: the gate PASSES, and it does so in the _opposite_ direction to the stated expectation.**

The expectation in the ticket was "both venues carry tournament-winner and Slam markets only, near-zero per-match
ATP coverage." **That is not what the live board shows.** Both Polymarket and Kalshi carry deep, liquid,
per-match head-to-head ATP markets for exactly the tournaments on today's board — including the specific match
named in the ticket.

### The named match exists as a tradeable H2H on both venues

- **Kalshi:** event `KXATPMATCH-26JUL27HUMMAR` — **"Humbert vs Martin (Jul 27)"**, ATP Los Cabos/Washington
  week, binary Yes/No per competitor. (Source: `GET https://api.elections.kalshi.com/trade-api/v2/events?series_ticker=KXATPMATCH&status=open`)
- **Polymarket:** the Washington event set (`Mubadala Citi DC Open`) is fully present as per-match H2H;
  Humbert/Martin sits in the same tournament block. (Source: `GET https://gamma-api.polymarket.com/events?closed=false&tag_slug=tennis`)

### Measured coverage, live board, 2026-07-28

The two ATP **tour-level** events running this week are **Washington (Mubadala Citi DC Open, ATP 500)** and
**Los Cabos (ATP 250)**. Both are near-completely covered on both venues:

| Venue | Per-match ATP H2H markets live now | Depth signal | Named match present |
|---|---|---|---|
| **Polymarket** (Gamma) | 78 total "X vs Y" tennis match-events; **13** for Washington (ATP 500), **4** for Los Cabos (ATP 250), plus Challengers (Bonn, Vancouver, Liberec, Samsun) and ITF M15/M25 | order-book `liquidity` up to **$203K** on a single Washington match (de Minaur vs Tsitsipas) | ✅ |
| **Kalshi** (`KXATPMATCH`) | **17 open match-events (34 binary markets)**, all Washington + Los Cabos R32 | **every one has open interest > 0**; total OI ≈ **$600K**, max side ≈ **$95K** | ✅ (`Humbert vs Martin`) |

Sample of Kalshi's live `KXATPMATCH` slate (verbatim event titles): `de Minaur vs Tsitsipas`, `Majchrzak vs
Paul`, `Nakashima vs Etcheverry`, `Damm Jr vs Shelton`, `Giron vs Hewitt`, `Humbert vs Martin`, `Svajda vs
Mensik`, `Fils vs Jodar`, `Mannarino vs Tien`, `Kwon vs Gea`, `Mayo vs Duckworth`, `Brooksby vs Moutet`,
`Shapovalov vs Hijikata`, `Zheng vs Landaluce`.

**Conclusion for the gate:** the design's three Market Money rows are **not** at risk of being empty 90% of the
time. On ATP tour matches, Polymarket and Kalshi are effectively at parity with the bookmaker feed. The row that
is at risk is **Betfair — and for a licensing reason, not a coverage reason** (see §1 and the verdicts).

Because the answer is good, I proceeded to Q1–Q6 rather than stopping.

---

## 1. SOURCES (auth, approval, cost, rate limits, response shape, licensing)

### 1a. Polymarket — Gamma Markets API

- **Auth:** none for market-data reads. Every `GET` below was made **unauthenticated** and returned 200.
  Wallet signing is only needed to place orders (irrelevant — we only read). (Source: https://docs.polymarket.com/developers/gamma-markets-api/overview)
- **Approval / signup:** none required to read.
- **Cost:** free.
- **Rate limits:** IP-based via Cloudflare, **15,000 req / 10s** general; throttled (delayed) not rejected when
  exceeded. (Source: https://docs.polymarket.com/api-reference/rate-limits) — trivially within a 15-min cron.
- **Real trimmed response** (`GET /events?closed=false&tag_slug=tennis`, one market inside the de Minaur vs
  Tsitsipas event):

  ```json
  {
    "title": "Mubadala Citi DC Open: Alex de Minaur vs Stefanos Tsitsipas",
    "liquidity": "203145.3836", "volume24hr": 45552.44, "volume": 59109.56,
    "markets": [{
      "question": "Set 1 Winner: Minaur vs Tsitsipas",
      "outcomes": "[\"Minaur\", \"Tsitsipas\"]",
      "outcomePrices": "[\"0.525\", \"0.475\"]",
      "liquidity": "19222.88", "bestBid": 0.52, "bestAsk": 0.53, "lastTradePrice": 0.57,
      "clobTokenIds": "[\"3435...\", \"8171...\"]"
    }]
  }
  ```
  Note: `outcomes` / `outcomePrices` arrive as JSON **strings**, not arrays — parse twice.
- **Licensing / redistribution:** **Unknown — could not verify.** I did not find an explicit clause in the
  Gamma docs granting or forbidding third-party display of Gamma price data. Polymarket is an offshore prediction
  market that blocks US persons and is DNS-blocked as gambling in some jurisdictions (see env note). For a paid
  UK/EU-facing analytics product **displaying** (not brokering) public market prices this is lower-risk than
  Betfair, but it needs a 30-minute legal/ToS read before commercial launch. Flagging as an open item, not a
  confirmed blocker.

### 1b. Kalshi — Trade API v2

- **Auth:** public `GET` market data works **unauthenticated** (every call below returned 200 with no key).
  Authenticated requests use an **RSA key pair** (`Generate API Key` returns a private key once) and are metered
  by token buckets; only needed for trading, not for our read-only display. (Sources:
  https://docs.kalshi.com/api-reference/api-keys/generate-api-key , https://docs.kalshi.com/getting_started/rate_limits)
- **Approval / signup:** none for public reads.
- **Cost:** free for reads.
- **Rate limits:** token-bucket, tiered (Basic → Advanced → … → Prestige). Most requests cost **10 tokens**;
  Read and Write are **separate buckets**; `429` on exhaustion with **no `Retry-After` header** (apply
  exponential backoff). Exact Basic per-second read budget is published as a JSX table I could not cleanly
  extract — **exact Basic number: Unknown, verify via `GET /account/api_limits`** — but a handful of reads every
  15 minutes is nowhere near any tier's budget. (Source: https://docs.kalshi.com/getting_started/rate_limits)
- **Real trimmed response** (`GET /markets?series_ticker=KXATPMATCH&status=open`, one side):

  ```json
  {
    "ticker": "KXATPMATCH-26JUL28KWONGEA-KWON",
    "event_ticker": "KXATPMATCH-26JUL28KWONGEA",
    "title": "Will Soonwoo Kwon win the Kwon vs Gea: Round Of 32 match?",
    "no_sub_title": "Soonwoo Kwon",
    "last_price_dollars": "0.5400", "no_bid_dollars": "0.4600", "no_ask_dollars": "0.4700",
    "open_interest_fp": "1295.35", "liquidity_dollars": "0.0000",
    "close_time": "2026-08-12T02:10:00Z", "result": "",
    "custom_strike": { "tennis_competitor": "bd89b008-4a3e-4ecc-9b82-867e6ddf750f" },
    "rules_primary": "If Soonwoo Kwon wins the Kwon vs Gea ... 2026 ATP Los Cabos Round Of 32 ..."
  }
  ```
  Note two markets per match (one per competitor); `open_interest_fp` and `*_dollars` are the fixed-point USD
  fields. `liquidity_dollars` (resting book depth) is frequently `0` even when open interest is four figures —
  see §4.
- **Licensing / redistribution:** **Unknown — could not verify** a specific data-redistribution clause.
  Kalshi is a **CFTC-regulated US exchange**, which is cleaner optics than Polymarket for a betting-analytics
  brand, but the ToS should still get a legal read before commercial launch. Not a confirmed blocker.

### 1c. Betfair Exchange — **LICENSING BLOCKER (loud flag)**

Betfair's tennis **coverage** is the deepest exchange market in the world and is not in question. I could not
query it live (auth requires a KYC account + certificate login I will not create), but coverage is not the
deciding factor here — **licensing is, and it blocks us.**

- **Auth:** a **KYC-verified Betfair account is mandatory** — "Without a Betfair account, you cannot proceed with
  licensing." Then a self-signed certificate login → session token (SSOID) + App Key on every request.
  (Source: https://support.developer.betfair.com/hc/en-us/articles/360002464152-Which-API-Licence-Do-I-Require)
- **Cost:** personal **Live App Key = £499 one-off, non-refundable**, debited from your Betfair balance; and
  **"Read-only access via the Live App Key isn't permitted"** — the personal key is for betting, not for a
  data-display product. (Source: https://support.developer.betfair.com/hc/en-us/articles/115003864531)
- **Redistribution to paying members — the blocker.** Displaying Betfair exchange prices to third parties is
  explicitly a **commercial** use requiring one of:
  - **Odds Publisher License** — "We are a Betfair Affiliate & want to publish Betfair odds on our website" —
    and the same page states **"we are no longer accepting new UK-based affiliates."**
  - **Betting Operator / Company Data License** — contact-sales, bespoke, paid.
  - **Software Vendor License** — for distributing a betting app to Betfair customers.

  (Source: https://support.developer.betfair.com/hc/en-us/articles/360002464152-Which-API-Licence-Do-I-Require)

  A paid SaaS showing Betfair prices to members is squarely commercial redistribution. The self-serve routes are
  closed (UK affiliate applications shut) or read-prohibited (personal key), and the commercial data license is a
  contact-sales, paid arrangement. **Per the ground rule "do not sign up for anything paid," I stop here and
  report: Betfair is blocked on licensing until a commercial Betfair Data License is negotiated.**

---

## 2. MATCHING — reuse the existing join, do not design from scratch

There is **no single matcher**; the pipeline already runs three surname-based joins, and the live-board one is
the relevant precedent. Findings (file:line against `origin/main`; the working tree is 231 commits behind but the
quoted functions are byte-identical to `origin/main`):

### Existing approach

**A. Live board — `the-odds-api` → api-tennis fixtures** (`bsp-pipeline.js:1633`, `findApiTennisFixture`):
matches on **surname pair only, order-independent, with NO date and NO tournament guard**.

```js
function findApiTennisFixture(oddsEvent, apiTennisFixtures) {
  const p1Last = lastName(oddsEvent.home_team);   // lastName = last whitespace token, lowercased
  const p2Last = lastName(oddsEvent.away_team);
  return apiTennisFixtures.find(f =>
    (lastName(f.event_first_player) === p1Last && lastName(f.event_second_player) === p2Last) ||
    (lastName(f.event_first_player) === p2Last && lastName(f.event_second_player) === p1Last));
}
```
`normalizeName` (`bsp-pipeline.js:115`) lowercases and strips everything non-`a-z`, which **deletes accented
characters** (no NFD normalization). On a miss it **silently** `return match` (stays "coming soon") — **no
unmatched counter, no warn, no failure-rate logged anywhere for this join** (`bsp-pipeline.js:1733`).

**B. Odds refresh — oddspapi (Pinnacle/bet365/1xbet) → `matches.json`** (`refresh-odds.py`, `orient()`): joins on
**date + BOTH surnames**, handles `"Lastname, Firstname"`, uses substring containment, keeps accents
(`str.isalpha()`), and **requires both surnames to match or it drops the fixture** (returns `None`). This one
**does log gaps**: `GAP (no line yet …)` and `GAP (not on oddspapi …)` with per-match lists and book coverage
(`refresh-odds.py:229–241`). The history capturer keys on the **api-tennis event key first**, then id, then
date+names (`refresh-odds-history.py:159`).

**C. Odds archive → profiles** (`build-odds-performance.js:343`, `resolve()`): the most robust — **NFD accent
strip**, `surname|initials` key, both name orders, surname-prefix fallback that **drops on ambiguity**, and a
`minMatches` confidence gate. This is the pattern to copy, not matcher A.

### Does it generalise to the new venues?

- **Kalshi:** cleanest of all. Each event carries `event_ticker` = `KXATPMATCH-<DDMMMYY><P1><P2>` and a
  per-competitor `no_sub_title` with the **full player name** (`"Soonwoo Kwon"`), plus `rules_primary` naming the
  tournament and round. So we can match on **date + both surnames + tournament**, which is *stronger* than
  matcher A. Expected failure: **low, ~2–5%**, driven by transliteration variants (e.g. `-ic`/`-ić`, `Kwon` vs
  `Soonwoo Kwon` ordering) — solved by copying matcher C's NFD strip + surname|initials.
- **Polymarket:** event `title` is `"<Tournament>: <First Last> vs <First Last>"` and markets carry
  `outcomes: ["<Surname>", "<Surname>"]`. Tournament is embedded in the title, so again **date + both surnames +
  tournament** is available. Expected failure: **moderate, ~5–10%**, higher than Kalshi because (a) Polymarket
  mixes ATP/Challenger/ITF/WTA under the same tennis tag (must filter tournament tier to avoid an ITF "Martin"
  colliding with an ATP "Martin"), and (b) set/game sub-markets share the event and must be filtered to the
  match-winner market. Both are handled by tournament-scoping the join, which matcher A does **not** currently do.

### Confidence threshold (standing rule: a mismatched market is worse than a missing one)

Adopt matcher C's discipline, not matcher A's silent-first-hit:
- Require **both surnames** to match (NFD-normalised) **AND** same **match date** **AND** same **tournament**
  (from the title/rules). Below that, **drop the row** (render em dash) rather than display.
- On surname collision within a tournament (two players share a surname), require an initial match; if still
  ambiguous, **drop** — never guess. This mirrors `build-odds-performance.js` `ambiguous → null`.
- Add the failure counter matcher A lacks: log unmatched venue markets per run so we can observe the real failure
  rate, which today we do **not** record anywhere for the live-board join.

---

## 3. MISSING VENUES — recommendation tied to measured coverage

**Recommendation: em dash (`—`) for a single missing/low-confidence venue row; keep the row and keep the
section. Hide the whole Market Signal section only if _zero_ venues have a confident market.**

Justification, tied to §0 numbers (not preference): on ATP tour matches, Polymarket and Kalshi coverage is
near-complete (13/13 Washington, both venues carry Los Cabos, Kalshi 34/34 markets with OI). A missing venue is
therefore the **exception**, so the honest UI is to show the venues we have and em-dash the one we don't — the em
dash is already the house convention. Hiding rows below a venue-count threshold would hide information that is
almost always present. The one row that will be em-dashed **routinely** is **Betfair**, because it is licensing-
blocked, not because the match is absent — which is the correct visual outcome: "we don't show this," not "this
doesn't exist."

Edge case where the whole section should hide: a match so early/obscure that **no** venue has a confident market
(e.g. deep qualifying). That is rare on the ATP tour board and is the only justified section-hide trigger.

---

## 4. LIQUIDITY SEMANTICS — one "LIQUIDITY" column is **misleading as-is**

The three venues' numbers are **three different quantities**:

| Venue | Field | What it actually is | Units |
|---|---|---|---|
| Betfair Exchange | `totalMatched` (listMarketBook) | **cumulative £ matched** on the market to date | £, traded |
| Polymarket | `liquidity` (Gamma) | **resting order-book depth** available now (distinct from `volume24hr`) | USD, resting |
| Kalshi | `open_interest_fp` | **open interest** — contracts currently outstanding × $1 notional | USD, outstanding |

These are not the same concept. Betfair's number is *cumulative traded volume*, Polymarket's is *live book
depth*, Kalshi's is *open interest*. Worse, Kalshi's own book-depth field (`liquidity_dollars`) is frequently
**`0` even when open interest is four figures** (verified: `KWONGEA-KWON` had `liquidity_dollars:0` but
`open_interest_fp:1295`), so for Kalshi the only meaningful "size" number is open interest, which is a *different*
concept from Polymarket's book-depth `liquidity`.

Putting all three under one column literally labelled **LIQUIDITY**, and **sorting the rows by that raw number**
(a design lock), sorts apples against oranges — a Betfair cumulative-traded figure will almost always dwarf a
Polymarket resting-depth figure, so the sort would systematically rank Betfair first for a reason that has
nothing to do with which market is deepest *right now*.

**Proposed fix (keeps the locked design, adds honesty):** keep the single column and the GBP formatting, but
(a) attach a **per-venue tooltip** stating the exact metric ("Betfair: total matched · Polymarket: order-book
depth · Kalshi: open interest"), and (b) if a strictly comparable sort is wanted, normalise all three to
**resting book depth** where available and fall back to open interest for Kalshi — but document that fallback in
the tooltip. If a tooltip is not acceptable, the honest alternative is a neutral column header ("MARKET SIZE")
rather than "LIQUIDITY," since only Polymarket's number is liquidity in the strict sense. Minimum acceptable:
the tooltip. Shipping the bare "LIQUIDITY" label across three different metrics is the misleading option.

---

## 5. REFRESH — 15-min cron is fine; Completed snapshot must freeze at settlement

- **Upcoming cadence:** the existing **15-minute cron is more than adequate** and infeasibility is not a concern.
  Both venues are read-only public `GET`s: Polymarket allows 15,000 req/10s (IP), Kalshi's token bucket covers a
  handful of reads every 15 min at any tier. A full board refresh is a few dozen requests — orders of magnitude
  under both limits. **No rate limit makes 15-min infeasible.**
- **Completed snapshot — freeze at settlement, never re-query.** Confirmed this is both correct and necessary:
  - Kalshi markets carry `close_time` / `result`; once `result` is set the market is resolved. Post-settlement,
    open interest unwinds and a closed market can return resolved/empty state — re-querying would *change* the
    displayed number after the fact.
  - Polymarket markets flip `closed:true` on resolution; `liquidity`/`volume24hr` continue to move as positions
    unwind.

  Therefore: at match settlement, snapshot the **final** price + size figures once, persist them, and **never
  re-query that market**. This also matches the locked "Market Signal · final" completed label — "final" must
  mean frozen. (This is the same discipline already used for settled odds elsewhere in the pipeline.)

---

## 6. FX — daily ECB rate, cached, carry-forward on failure

- **Source:** **Frankfurter** (`https://api.frankfurter.dev/v1/latest?base=USD&symbols=GBP`) — European Central
  Bank reference rates, **free, no API key**. Verified live: `{"base":"USD","date":"2026-07-27","rates":{"GBP":0.75094}}`.
- **Live vs cached:** the ECB publishes **once per business day (~16:00 CET)**; there is no intraday rate.
  Fetching once per day and caching is correct — fetching every 15 min would return the same daily value. On
  weekends/holidays the ECB does not publish, so the last business-day rate carries.
- **On fetch failure:** **carry the last-good cached rate; never fail the pipeline over FX, and never fabricate a
  rate.** A one-day-stale GBP conversion on a display figure is harmless; a missing or invented rate is not.
- **Converted-notional disclosure:** Polymarket and Kalshi are **USD-denominated**, so their GBP liquidity is
  *converted notional*, whereas Betfair's is natively £. This is **worth surfacing quietly** — a small tooltip
  ("converted from USD at daily ECB rate") on the USD-sourced rows — because a member comparing a native-£ figure
  to a converted-from-USD figure should know one of them moves with the exchange rate. Low priority, but honest.

---

## FIXED-BY-DESIGN items — no conflict found

Nothing in the data layer conflicts with the locked design rules. For the record, mapped to live data:
- **Sort Market Money by liquidity numeric, deepest first** — feasible, but see §4: sort on a *normalised* metric,
  not raw cross-venue numbers, or the sort is misleading.
- **Single-currency GBP, converted at display, K→999K then M** — feasible via §6 FX; format from the numeric USD
  value, convert, then format.
- **Bars: Player A `#6aaeff` vs neutral remainder** — matches `outcomePrices` (Polymarket) / `last_price_dollars`
  (Kalshi) directly; Player A = first-named, per `export/README.md`.
- **Sharp Estimates NOT sorted, fixed venue order (Pinnacle, Stennisfy)** — unaffected; those flow from the
  existing the-odds-api/oddspapi feed, no new source needed.
- **Completed label "Market Signal · final"** — supported by §5 freeze-at-settlement.

---

## PER-VENUE VERDICT

| Venue | Verdict | One-line reasoning |
|---|---|---|
| **Kalshi** | **SHIP** | Verified live per-match ATP H2H incl. the exact named match, open-interest depth ($600K across the slate), free public no-auth read API, CFTC-regulated (cleanest optics). Only open item: a quick ToS read on data redistribution. |
| **Polymarket** | **SHIP** | Verified live per-match ATP H2H with real order-book liquidity (up to $203K/match), free public no-auth read API. Open items: verify ToS on commercial data display, and note offshore/geo-restricted optics. |
| **Betfair Exchange** | **BLOCKED** | Not coverage — licensing. Displaying exchange prices to paying members is commercial redistribution requiring an Odds Publisher License (new UK affiliates closed) or a bespoke paid Data License; the £499 personal key forbids read-only use. Blocked until a commercial Betfair Data License is negotiated. |

### Recommended venue count: **2 (Kalshi + Polymarket)** for launch

This lands exactly where the ticket asked ("rather ship two venues that work than three where one is usually
empty") — but the reason to drop the third is **licensing, not thin coverage**. Both shipped venues have strong,
verified per-match ATP coverage, so the "Market Money" group is meaningful at two rows; Betfair renders as an em
dash (§3) until/unless a commercial Betfair data license is secured, at which point it slots into the existing
third row with no design change. The "Sharp Estimates" group (Pinnacle/Stennisfy) is unaffected.

### Open items for the founder to decide (not blockers to the report)
1. **Betfair:** authorise pursuing a commercial Betfair Data License (contact-sales, paid), or ship 2 venues and
   leave the Betfair row em-dashed. My recommendation: ship 2, revisit Betfair only if a member clearly wants it.
2. **ToS legal read** on Kalshi + Polymarket data redistribution before *commercial* launch (R&D display is lower
   risk). Neither showed a confirmed blocker; neither was fully cleared.
3. **§4 liquidity label:** confirm the per-venue tooltip (my recommendation) vs a neutral "MARKET SIZE" header.
