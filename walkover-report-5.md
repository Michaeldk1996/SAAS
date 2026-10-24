# Walkovers: close-out checks (spot-check, two-key players, lane cap)

Read 2026-10-24, 01:50–02:30Z. Sources:
- The deployed site: 730 career-history shards, 52 career-record overlays, `player-profiles.json`.
- `bet365-history/` and the fixture index on main.
- The lane log, `~/.stennisfy/deploy-lane-history.jsonl`.

Nothing in this file is wired.

## 1 · Spot-check of the capture jump (4,804 → 7,422)

**Population.** The captures the fixed builder matches on the deployed store, minus those the pre-fix builder matched on the last good run's board (22 Oct 23:30Z, with its 84 form shards):
- 7,422 captures in all, 2,619 of them newly matched.
- 14 more were matched both before and after, but to different keys.

**Random sample (20, fixed seed): 0 wrong.**
- 16 are corroborated by a career row between exactly those two players on that date (±1 day).
- In 4, neither player is profiled. There's no career row to check against, and such a capture can't display: both the page and the Database join a capture on exact keys.

**Whole population, all 2,619:**

| Outcome | Captures |
|---|---|
| Corroborated by a career row between the two players | 2,067 (463 of them settled on evidence for a shared name) |
| Neither player profiled | 534 |
| Profiled player, no row that day | 4 |
| **A profiled player's row that day names someone else** | **14** |

**The 14 found** (stop-and-report, 24 Oct):
- **10 are wrong matches:** the player is right, but the key is the other of his two api-tennis keys.
  - Rodríguez Rodríguez: 8372 vs J. A. Rodriguez 9221 (×5)
  - Dedura-Palomero: 55858 vs 100332 (×2)
  - Kohlmann de Freitas: 65476 vs 63483 (×2)
  - Silva: 7227 vs J. D. Silva 69090 (×1)
- **4 are uncorroborated:** our row that day shows another opponent.

None of the 14 reached a page or a Database figure. Both join on exact keys: 0 Database rows, 0 career-row joins.

**The 14 whose keys changed:** all moved, with the fix, to the key a career row corroborates. Before it, none had a corroborating row. The fix corrected those.

**Fix (founder-approved, in this batch).** `capturedBet365`: when either player has a career-history shard, keep the capture only if one of them has a row against the other within ±1 day. With no profiled player, it's kept as before.

| | Before the fix | After |
|---|---|---|
| Wrong matches | 14 | **0** |
| Corroborated | 2,067 | **2,067** |
| No profiled player | 534 | **534** |
| Database captured-Bet365 rows | 4,672 | **4,672** |
| Captures | 7,422 | 7,390 |

The 32 dropped captures are the 14, the 4, and 14 the pre-fix code also matched without a confirming row. Test: `test-stable-roster` CONTROL 4 (Ribeiro v Rodríguez Rodríguez, filed under 9221, must not keep 8372).

## 2 · Players with more than one api-tennis key (report only)

**Method.** Keys are linked when they carry an identical spelling, in profiles or as an opponent in any career-history row. A link is kept only when the two keys never played on the same day; a same-day pair is two people.
- 333 groups share a spelling. 14 are namesakes (both played the same day).
- That leaves **319 one-person candidates**. **63** include a profiled key, the key the site reads; **2** have two profiled keys (Mrva 38850/31143, Xiao 38140/31666).
- A generic spelling (J. Lee, T. Zhang, I. Ivanov, C. Cruz) can still be two people who never met on one day, so treat these as candidates, not proof.

**Split.** The profiled player's own feed rows (career-history) are what Form, Calendar, Court speed and H2H read.

| Matches filed under the unprofiled key of a group with a profiled key | 187 |
|---|---|
| Also in the profiled player's own feed rows | **0** |
| Missing from his Form / Calendar / H2H | **all 187** |
| Matched by a Tennis Explorer overlay row within ±3 days (probably the same match; loose test, unverified) | 157 |
| In neither the feed rows nor the overlay | 30 |

Largest splits (matches filed under the unread key):
- **Galán** 1735 / 34000: 65
- **Fonseca** 40058 / 10509: 5
- **S. Jong** 39928 / 12848 / 29088: 5
- **J. Lee** 5568 / 38308: 5
- Prado Angelo 21704 / 26499, Maloney 37922 / 28098, Barrios Vera 396 / 37553, Pow 53787 / 9374, Cina 38264 / 29153: 4 each
- The rest 1–3 each

The Database's Tennis-Data rows join by name through the identity gate, not by api-tennis key, so these splits don't touch Database figures. Nothing is fixed here; it may belong to the Identity session.

**Also found.** td-identity's `merged` map (its "one person, two keys" rule) holds 396 entries, and some are plainly different people. For example, 753 P. Pohjola is merged into 1335 K. Jacquet from one observation (Kicker v Pohjola, Tampere SF, 18 Jul 2021; Jacquet played Castelnuovo there that day). It shouldn't be used as a two-key list. Worth the Identity session's look.

## 3 · Lane cap (report only; nothing changed)

**What happened (lane log).**
- [WALKOVER-GATE] claimed at 01:01:24Z and pushed at 01:01:33Z. The pipeline run that built and published it, `40048535671`, ran 01:10–01:40:37Z.
- The lane took **run `40048494762`** as "the owner's run". That run started a job and was then cancelled by the pipeline's concurrency queue. Being cancelled, it earned no grace.
- At 40 minutes from the claim (01:41:30Z) the lane released as `cap-40min-no-run`, eleven minutes before the real run's grace would have ended.
- TEN-AVATARS then claimed, because the queue is first-come (TEN-AVATARS joined 01:38:06Z, IDHOLD 01:39:24Z). The founder's landing order is not in the lane.

The suite itself runs before the claim, so the cap only has to cover push → live. The fault is which run counts, plus an order the lane can't see.

**Proposal** (file: `tools/deploy-lane.mjs`, with `MAX_HOLD_MIN = 40` at line 99 and the owner-run selection; rule text in `.claude/rules/deploy-lane.md` (iv)):
1. **The owner's run is the first pipeline run containing the pushed SHA that was not cancelled.** A run cancelled by the concurrency queue says nothing about the deploy; skip to the next one. This alone would have kept the lane to about 01:52Z.
2. **The cap counts from `pushedAt`, not `takenAt`,** and pauses while a run containing the push is queued or running. That's (ii) as written, applied to the right run.
3. **An optional order in the lane.** `claim --after <tag>` refuses a claim while the named tag isn't on main, so the founder's order is enforced rather than remembered: TEN-AVATARS would have waited for [IDHOLD].
