# Pipeline — win/loss records: counting, walkovers, retirements

Applies to every W/L record built from the api-tennis archive in `bsp-pipeline.js` (`buildAllTierYearly`,
`playerMatchHistory`, `seasonSurfaceByTier`, `seasonRowFromFixtures`, `courtSpeedRecordFromFixtures`,
`recentFormFromFixtures`, `fetchPlayerCareerHistory`) and the surfaces that render them.
Restored from CLAUDE.md before 011e3e20 (2026-09-21 trim); TEN-312 N13, founder-approved 2026-09-28.
Where this file conflicts with `modal-analysis.md` (TEN-312, 2026-09-28), that file wins.

- **Records must match Flashscore — count qualifying matches (founder ruling 2026-08-04).** Every surface
  that shows a win/loss record computed from our api-tennis archive must follow the **same counting rules as
  Flashscore**: all decided professional singles at any level (ATP + Challenger + ITF) **and any round
  including qualifying**. Do **not** apply an `event_qualification`/main-draw gate on these surfaces — it
  made our numbers a strict subset of the public record (Buse 2024 read 36/22 vs Flashscore 47/28; the gap
  was entirely dropped qualifying + null-flagged rows). Applies to `buildAllTierYearly` (Record-by-season),
  its drill-down twin `playerMatchHistory`, `seasonSurfaceByTier` (current-season surface record),
  `recentFormFromFixtures` (which additionally tags qualifying rows `'Q'`), and `fetchPlayerCareerHistory`
  (Record-by-**tournament** — extended 2026-08-04 after the founder reinforced that *every* record/results
  surface must share the same Flashscore rules; qualifying rows are tagged `'Q'`, rank -1, so W/L totals
  grow but bestResult/titles are untouched). Scope note: provider-aggregate stats (career/surface win %) and
  Tennis-Abstract career splits are separate data sources and are *not* forced to this rule. Separate,
  unrelated cause: a player's Record-by-**tournament** can still read below the public record when the
  api-tennis archive is genuinely *missing* older editions (e.g. Zverev's pre-2023 Canada) — a data horizon,
  not this qualifying filter, and not closed by counting qualifying.
  *Newer exception (TEN-312 N7, 2026-09-28):* the Match analysis **Tournament tab** W–L is **main draw only**
  — qualifying rows are filtered out there. *Walkovers:* the Flashscore walkover convention no longer applies
  — see the next rule.
  **Test:** for any player on the board, the Record-by-season totals equal Flashscore's per-year Match Record
  (walkovers excluded, per the next rule), and their per-tournament W/L includes qualifying rounds; no
  qualifying/main-draw gate exists in any archive-record builder.

- **Walkovers — current rule (TEN-312 N2, founder 2026-09-28): a walkover is neither a win nor a loss, for
  either player, on every surface, the player profile included.** It is not a match played and never enters
  a W–L, a set count, a rate, a hot line or a price population; it may appear as a row only where the design
  lists results, marked "w/o", excluded from every count on that page. Canonical text:
  `modal-analysis.md` "Walkovers and retirements — every tab". This **replaces** the 2026-08-04 ruling "a
  pre-match walkover a player GAVE is NOT a loss" and its "a walkover RECEIVED is still a win" clause (the
  TEN-8 / Flashscore convention); that clause is superseded and must not be implemented. Carried over from
  the 2026-08-04 ruling because it does not conflict: detect a walkover on the feed's
  `event_status === 'Walk Over'`, **never** on an empty scoreline (a retirement the provider stored with no
  partial score would else be misread). Note: the shared predicate `isWalkoverGiven(f, won)` covers only the
  given side; the current rule needs the received side excluded too.

- **Retirements count as matches (founder ruling 2026-08-04, restated TEN-312 N2 2026-09-28).** An
  **in-match `Retired`** (he quit mid-match) is still a **loss** for the retiree and a win for the opponent,
  marked "ret."; its unfinished set is excluded from set tallies, deciding sets and games/sets lines (H2H
  rule e, `modal-form-h2h.md`). In **price** figures a retirement settles at the listed price everywhere (ruling A, 2026-09-28; see `modal-analysis.md` "Retirements in price figures").md`).
  **Test:** a `Retired` loss still adds 1 to lost; a `Walk Over` fixture adds 0 to won and 0 to lost for
  both players, on every record surface.
