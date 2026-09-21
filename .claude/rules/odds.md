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

**Oddspapi — bet365 only. The only ageable Open/Close.**
5,000 requests/month, hard. ~53 units/day, ~44% at reset. Metered leg runs every 30 min.
Pinnacle and Bet105 are **not entitled** here — they 403 and still bill.
*Which bet365:* oddspapi's unqualified bet365, distinct from the nine country variants it lists separately (NJ, AR, BR, DE, ES, FR, GR, IT, NL). Which physical site it scrapes is unknown; oddspapi does not say. api-tennis's bet365 is the same book — 94.5% identical, n=820.

**api-tennis — Ultra, 2M requests/day. Fallback books + stored close.**
No timestamps on any price. Refreshes at least every 30 min (vendor-confirmed). 17 books claimed, 8 usually absent.
Their stored "last odds before start" **is** a usable Close: bet365 agrees with our trusted close to 0.06pp on ATP (n=199) and 0.08pp on Challenger (n=205); every other book sits 0.80–1.48pp away.
Wired as a **dash-filler only** — bet365 only, ATP and Challenger, never overriding an ageable close, labelled no-timestamp/no-lag-check. WTA and team events excluded.

**Tennis-Data.co.uk** — Pinnacle closes, ATP main tour, pre-2026.

---

## Book names

Vendor-confirmed abbreviations: `Sbo` = SBOBET, `Pncl` = Pinnacle, `Victor Chandler` = BetVictor.
Expand at **display only**; identity tests use `canon()`, never the display name.

**Always normalise before comparing across sources.** A literal match once reported WilliamHill (244 fixtures) and Pncl as absent books.

---

## Book ladder

Named order — not coverage:

> bet365 > Superbet > Betano > Unibet > William Hill > Betfair > 1xBet > Pinnacle

SBOBET, Marathon and BetVictor rank **below every unlisted book** — SBOBET carries the widest margin measured (11.61%) and must never win a card on coverage alone.
bwin is out. Bet105 and Sports411 are unlisted (rank 500).

---

## Card rules

- **One book per fixture.** Open, Now and Close all come from the same book. A higher-priority book appearing later takes over **all three**, using its own first tick as Open. Never mix books within a fixture.
- **Book name on hover, never on the card face.** Tooltip carries book, that cell's price, when the book last moved it, and when we last saw it — `bet365 · 1.22 since 01:08 · seen 09:15`.
- **UPCOMING and UNDERWAY:** Open + Now. **COMPLETED:** Open + Close. A Close column never appears on an unfinished match.
- **Decimals:** 3 below 1.10, but only where the third is non-zero — `1.012` stays, `1.020` reads `1.02`.
- **Header shows the oldest price on the board**, never the newest.
- **Biggest Market Move filters to movers only** — 0% and unpriced cards leave the view entirely.
- **No scoreline row on an upcoming card** unless the feed actually said something (live score, suspension, Retired/Walkover). No UNDERWAY chip, no INTERRUPTED chip — they break card symmetry and duplicate the score line.

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

`close_reliable` needs `close_lag ≤ 60 min` **and** flip gap `≤ 300 s`. The 21-day archive-age limb does **not** apply to Kibl — it has no history, so every Kibl close is captured live, which is what the rule wants.

One-sided reliable close = dash on both sides.

---

## Known open issues

- **api-tennis coverage collapse**, two events, ruled not our fault: 12 Sep books 13 → 9 with Superbet and Unibet to zero; 16 Sep broad fall, bet365 191 → 4 priced fixtures. SBOBET is the only book rising. Question to api-tennis drafted.
- **Davis Cup:** no book prices most rubbers (bet365 0 of 32 on api-tennis, 6.7% historically on oddspapi). Those dashes are a tier fact, not a defect.
- **Deploy leg** is ~26 min median, tick-only — now the binding term on freshness.
