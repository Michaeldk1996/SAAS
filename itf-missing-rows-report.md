# Played ITF rows missing from career-history: diagnosis

Read 2026-10-22, about 23:30Z. Report only: nothing is wired or landed.

Sources:
- 21 Oct deployed shards (snapshot `~/.paperclip-walkover/live/ch`)
- Today's deployed shards (`live4/`)
- The committed profile cache (`17a9c5564`)
- The Tennis Explorer store
- The pinned Sackmann copy
- **Six read-only api-tennis calls**, made exactly as the pipeline makes them: `get_fixtures`, `player_key`, five-year window

## Answer

**Nothing in our code dropped these rows.** api-tennis re-imported these events:
- 5 of the 6 now return `event_winner: null` (status still "Finished", or "Retired"), under new tournament names.
- The pipeline never guesses a winner (`bsp-pipeline.js:822`, `if (!f.event_winner) continue;`), so the row isn't written.
- The rows surfaced now because the v16 profile bump forced every profile to be rebuilt on 22 Oct around 17:30Z. That rebuild refetched fixtures the old cached profiles had captured while the vendor still had a winner.

## The four checks you asked for

**1 · Tennis Explorer empty or non-standard score, and ruling 6: no.**
- 8133 has no Tennis Explorer layer at all.
- 10873 and 9217 have TE rows with normal scores: Quan 6-3 2-6 6-4, Kimhi 6-0 6-4.
- Ruling 6 only touches TE rows with an empty score, so it never saw these.
- Neither overlay excludes them: 10873 has 0 exclusions before and after.

**2 · Sackmann Futures coverage: covered for 2022 and 2024, not for 2026. Not involved.**
- `atp_matches_futures_2022.csv` holds Vallejo v Kimhi (M15 Cancun, 19 Sep).
- `atp_matches_futures_2024.csv` holds Aguilar v Browning (M15 Santo Domingo, 18 Nov).
- The pinned copy ends in 2024, so Irvine 2026 isn't in it.
- The Sackmann confirmation step only runs on TE empty-score rows, so it couldn't drop any of these.

**3 · TEN-449 / the 17 Oct juniors rule: not matched.**
- All six are `Itf Men Singles` events with M15/M25 names. The juniors rule (by event type) and the te-join junior test (`isJuniorRow`) both pass them.
- No set repair touches them.
- 9217's overlay excluded 19 junior rows before and 0 now. Those juniors are now filtered at the pipeline (TEN-444), which is a separate change.

**4 · Field by field, the 21 Oct deployed row versus now:**

| Key | Date | Event (21 Oct row) | Round | Opponent | 21 Oct row | Sets | Row now | api-tennis now: status · winner · result · event name |
|---|---|---|---|---|---|---|---|---|
| 8133 | 2024-11-20 | M15 Santo Domingo 3 | R32 | T. Browning | 2-1 W | 6-4 4-6 6-3 | absent | Finished · **null** · 1-2 · "ITF M15 Santo Domingo 6 Men" |
| 10873 | 2026-06-19 | M15 Irvine | QF | R. Quan | 2-1 W | 6-3 2-6 6-4 | absent | Finished · First Player · 2-1 · "M15 Irvine" (complete again; see below) |
| 9217 | 2022-09-20 | M15 Cancun 15 | R32 | O. Kimhi | 2-0 W | 6-0 6-4 | absent | Finished · **null** · 0-2 · "ITF M15 Cancun 19 Men" |
| 2481 | 2022-07-12 | M25 Nur-Sultan 3 | R32 | S. Imai | 1-2 L | 2-6 7-6 4-6 | absent | Finished · **null** · 1-2 · "ITF M25 Nur-Sultan 4 Men" |
| 3702 | 2022-09-20 | M15 Cancun 15 | R32 | Y. Rahman | 1-0 W (ret.) | 7-6 3-1 | absent | Retired · **null** · 0-1 · "ITF M15 Cancun 19 Men" |
| 9687 | 2022-09-20 | M15 Cancun 15 | R32 | K. Ogura | 2-0 W | 6-3 6-3 | absent | Finished · **null** · 0-2 · "ITF M15 Cancun 19 Men" |

**10873.** Its profile was rebuilt at 17:35Z on 22 Oct. The cached build lists the Irvine R32 and R16 under "M15 Irvine, CA" and has no QF: at that moment the vendor returned the event in a different state. Today the same request returns the QF complete, so this row comes back the next time 10873's profile is rebuilt (14-day TTL, or sooner if he plays on the board). Not verified until then.

## How many rows: all 730 players, 170,634 feed rows on 21 Oct

Feed rows on 21 Oct, matched now by event key:

| Outcome | Rows | Why |
|---|---|---|
| Still present | 170,165 | |
| Gone: junior events | 426 | TEN-444 (17 Oct), applied when the v16 rebuild refreshed these players |
| Gone: women's events on one men's key (31666) | 37 | TEN-446 (17 Oct), the same way |
| **Gone: vendor record degraded** | **6** | The table above (6 player-side rows, 6 matches) |
| Gone: anything else | 0 | |

## Fix proposal (not wired)

**Derive the winner from the vendor's own final result when it drops `event_winner` on a finished match.**
- Status `Finished`, `event_winner` null, and `event_final_result` "a - b" with a ≠ b, consistent with the set scores the record carries: the winner is the side with more sets. That reads the scoreline; it doesn't guess.
- A `Retired` or `Walk Over` record with no winner stays dropped. A retirement's sets don't say who retired: Rahman v Kimhi's 0-1 can't be read.
- This would restore 4 of the 6: 8133, 9217, 2481, 9687. 3702 stays out (retired). 10873 heals on its own.
- **Test that fails without it:** a `Finished` fixture with `event_winner: null`, result "0 - 2" and sets 0-6 4-6 must give a row won by the second player in `playerMatchHistory`, `buildAllTierYearly` and `recentFormFromFixtures` alike. A `Retired` twin must give no row. On today's code the first assertion fails (no row).
- **Also worth asking api-tennis** why re-imported ITF events lose `event_winner`. Their date-range endpoint still returned "Second Player" for 8133's match on 22 Oct, so the two endpoints disagree.
