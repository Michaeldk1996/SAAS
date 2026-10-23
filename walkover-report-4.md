# Walkovers & retirements: rulings 1–2 and reports 1–3

Read 2026-10-22, 22:00–23:00Z. Figures come from the deployed site unless a line says otherwise.

## Ruling 1 · Walkover rows are never Database evidence: done

- Written into `.claude/rules/odds.md` as a rule with its test, cross-referenced in `pipeline-records.md`. The reason is in `BUILD-NOTES.md`.
- The hold comment in `tools/started-evidence.js` now cites the rule.
- The test in `tools/test-started-priced.js` (Dee v Gee) goes red if a career walkover row is read: 3 fails with the skip line removed.
- No archive-gate override is pending. Code behaviour is unchanged.

## Ruling 2 · Compare events counts each match once

The "All matches" curve and its legend summed both sides of every match (`f + d`). It now adds `(f + d) / 2` per match, the design's `yieldOf`.

All-matches end units on the deployed Database store, unfiltered, before → after:

| Event | Matches | Before | After |
|---|---|---|---|
| Australian Open | 2,055 | −457u | −228u |
| French Open | 2,072 | −357u | −178u |
| Wimbledon | 1,949 | −227u | −113u |
| US Open | 2,022 | −200u | −100u |

- Favourites and Underdogs are unchanged.
- Test: `test-ten399-b.mjs` "counts each match once" recomputes the end value from the rows. On the pre-fix page it fails: −457u against −229u counted once (that run used the repo's committed copy of the store).
- The rule is in `database.md`.
- **Deployed verification:** landed as `9d712fa3a`, live (the live build contains it). The deployed dashboard carries `(f+d)/2`. On the deployed page and data, `test-ten399-b` "counts each match once" passes and the end units match the table. Four Player checks in that suite fail only when fed the deployed data: `dbApproxHover is not defined` in the harness, not the page. The same page passes 8/8 on the repo's committed data.

## Report 1 · Retirement counts reconciled

### Why 1,282 and 1,309 are not comparable

- **1,282** (pre-implementation report) counts **profile-ledger rows**: retired rows on 477 players' Calendar spine that carried units.
- **1,309** (my last report) counts **Market edge shard rows**: retired rows across 407 shards. That population is different: it includes players outside the 477, and rows the profile spine never joins.

Below, the same population on both sides: the 477 players and their ledger rows, matched row by row on player, date and opponent.

| Same 477 players, profile ledger rows with units before the change | Stand | Void | No set scores | Total |
|---|---|---|---|---|
| Pre-implementation prediction (21 Oct snapshot, first-set rule) | 1,083 | 186 | 13 | 1,282 |
| Deployed now (ruling-4 module, settlement from the builder) | 1,061 | 178 | 43 | 1,282 |

Row by row, the 1,282 move as follows:

| Movement | Rows | What happened |
|---|---|---|
| Predicted stand → stands | 1,061 | As predicted |
| Predicted void → void | 178 | As predicted (Pinnacle 177, bet365 1) |
| Predicted no-score → no-score | 13 | As predicted |
| **Predicted stand → no set scores** | **22** | **Defect, see below** |
| **Predicted void → no set scores** | **8** | **Defect, see below** (Pinnacle 7, bet365 1) |

186 void → 178 = −8, and 13 no-score → 43 = +30. Both movements come from the same **30 rows**. In each one, the career row **does** hold the first set (the profile's own join finds it). But the Market edge builder takes its first-set evidence from `started-evidence.json`, and that join missed it. The builder then settled the row "no set scores", with no units.

Each row's cause, from an instrumented run of `started-evidence.js` on the deployed career store. That run reproduces CI: 688 / 121 / 1,032 against CI's 688 / 121 / 1,034.

| Cause | Rows (player-sides) | Matches |
|---|---|---|
| **No Tennis-Data row.** 2026 matches priced from our own Pinnacle archive (`pinnacle-history` / `pinnacle-approx`). started-evidence reads only `odds-archive/`. | 8 | Mannarino v Basilashvili, Shanghai 7 Oct 2026 (2) · Gaston v Sinner, AO 20 Jan 2026 (2) · Auger-Aliassime v Ruud 14 Oct 2026 (2) · Gea v Davidovich Fokina 15 Oct 2026 (2) |
| **Two candidate rows.** The −16..+3 day window also reaches an earlier meeting of the same pair (e.g. Cincinnati two weeks before the US Open), so the join refuses to pick. | 7 | Gasquet v Kokkinakis, US Open 2015 (2) · Fognini v Robredo, Shanghai 2013 · Gasquet v Llodra, Cincinnati 2008 · Copil v Cilic, US Open 2018 · Lajovic v Ramos-Viñolas, Rio 2016 (2) |
| **Archive row one day "after" the match.** The archive dates the event start (Monday). Tennis-Data dates a Sunday first round the day before, and the join never accepts an archive row dated after. | 5 | Bonzi v Medvedev, RG 2017 (2) · Giron v Dimitrov, RG 2021 (2) · Paire v Tomic, Rome 2016 |
| **The sources disagree on the winner.** Tennis-Data's winner is our career row's loser, so by the 18 Oct rule the join refuses. | 6 | Berrettini v Zverev, Turin 2021 (2) · Humbert v Moutet, Rome 2025 (2) · Kecmanovic v Bu, Shanghai 2023 (2) |
| **Opponent name not joined.** The other player's Tennis-Data name resolves to no key, so the row can't be matched. | 4 | Fognini v Bogomolov, AO 2014 · Goffin v Del Potro, Rome 2018 · Coric v Del Potro, Shanghai 2018 · Ferrero v Nishikori, Auckland 2009 |

**Not fixed.** The first three causes are join limits that a narrower first-set lookup could lift. The fourth (sources disagree) arguably should stay a dash. **This needs your go-ahead** (see the end).

### Ledger totals, same 477 players, every row with units

| Book | Before (21 Oct) | After (deployed) | Change | Ruling 4 removed | Everything else |
|---|---|---|---|---|---|
| Pinnacle | **−571.93u** (43,520 rows) | **−612.56u** (43,310 rows) | −40.63u | −38.32u, 219 rows: 177 void (+30.66u), 13 no-score (+1.36u), 22 stand→no-score (+7.30u), 7 void→no-score (−1.00u) | −2.31u, +9 rows: new priced matches since 21 Oct |
| bet365 | **−37.30u** (703 rows) | **−38.70u** (701 rows) | −1.40u | −1.40u, 2 rows: 1 void (+2.40u), 1 void→no-score (−1.00u) | 0 |

- The pre-implementation report printed Pinnacle as −572.93u over 43,521 rows. The rerun of the same snapshot gives −571.93u over 43,520. It reads Market edge shards fetched 5 h later, and one row of −1.00u differs between the two fetches.
- Predicted Pinnacle after: −603.95u. The extra −8.61u is the 22 stand→no-score rows (−7.30u) plus the new matches (−2.31u), less the 1.00u snapshot row.
- bet365 lands exactly on the prediction (−38.70u).

## Report 2 · Outage prevention (proposal only, nothing wired)

**What went wrong.** All three gates judge what a full pipeline run builds:
- the archive gate (counts after the private Pinnacle archive export)
- the pre-publish reconcile (the built `_site`)
- the roster floor (a full profile build against api-tennis and the run's caches)

The pre-merge suite runs against the deployed store, or skips when the store is absent. So a change that alters what the pipeline builds is first judged in production, after merge. Two things then turned a red check into a 12-hour outage:
- a failed run saves no convergence cache, so it can't recover;
- each fix had to wait out a 40-minute suite while other lands raced it.

**Proposal, in order of value:**

1. **A dry-run of the full pipeline before land.**
   - A `pipeline-dryrun` workflow runs `pipeline.yml`'s build steps on the candidate SHA. Every fail-closed gate stays on: archive gate, built-store reconcile, H2H reconcile, price guard, roster floor.
   - Everything that writes stays off: deploy, commit-backs, cache saves, archive writes, Telegram.
   - It needs its own concurrency group, so it never queues behind or cancels production.
   - Metered sources are excluded: no oddspapi leg, no Kibl writes. Rule 14 applies: the probe must never trip a circuit breaker.
   - `deploy-lane.mjs claim` requires a green dry-run receipt for the SHA whenever the change touches a builder or a gate. That includes `bsp-pipeline.js`, `te-join.js`, `career-backfill.js`, `build-*.js`, `tools/started-evidence.js` and the gate scripts. Other changes keep today's path.
   - Cost: about 30–45 min of Actions time per such land, and api-tennis calls (well inside the 2M/day).
   - Rule 11 is respected: it publishes nothing and chains nothing.
2. **Gates runnable on a stored build.** Each green production run uploads its `_site` and the gate inputs (`started-evidence.json`, `database-yield-master.json`, the counts) as a short-lived Actions artifact. `ci-suite.sh` fetches the latest one and runs the reconcile and floor checks against the candidate's builders where they can run locally. That is what I did by hand on 22 Oct (mirror + injected rows). It is cheaper than (1), but it can't rebuild what needs the private archive.
3. **A failed run never wedges.** Save the convergence caches (profile cache, tournament history) on failure as well, with a separate key, so a red run still makes progress. The floor still fails closed; only the cache survives.
4. **A schema-bump checklist, enforced by a test.** A `PROFILE_SCHEMA_VERSION` change must ship with a simulated convergence: the cache composition walked through every pass, the floor verdict for each run, and the number of runs to converge.
5. **Fix-forward priority in the lane.** A land whose ticket is marked `pipeline-red` jumps the queue, and other code lands wait until it is live. This would have saved the three refused claims on 22 Oct.

My recommendation is (1) plus (3). Together they would have caught all three 22 Oct failures before merge and made any miss recoverable.

## Report 3 · Profile convergence after v16

- **Count:** the deployed `player-index.json` meta reads written **731** against **731** last published. The pre-v16 committed cache (`ebe233981`, 22 Oct 00:40Z) held 731 profiles. All **731 of 731** have a deployed `profiles/{key}.json` (HTTP 200).
- **No player is missing.**
- **Converged (verified after the rollover):** the 00:00Z run on 23 Oct hydrated the committed cache as `[v16:731]`, and the floor passed with its ratio active again: "PASS [pass] — 731 >= 657". The 7 stale entries are gone.
