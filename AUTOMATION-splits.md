# Career-splits daily automation (TEN-8, Plan A)

Career splits (the Career / Last-52-weeks splits behind the Player Profile's Draw
record, Key insights and the H2H page) are the **one** dataset that cannot be refreshed by the
GitHub Actions pipeline. It is sourced from Tennis Abstract, which serves this
machine's residential IP (HTTP 200) but blocks every datacenter IP (HTTP 403),
so `pipeline.yml` running on GitHub's runners cannot fetch it. The only
CI-reachable substitute, TML-Database, is tour-only and shrinks every player's
career record (Borges 156 vs 515 live, Alcaraz 345 vs 464) — it fails the
zero-regression requirement.

**Plan A** keeps the proven TA builder and schedules it in the operator
environment (this machine) instead, so the refresh is automatic and daily
without depending on anyone running it by hand.

## What is published (TEN-391, founder 2026-10-07)

- `career-splits/<profileKey>.json` — ONE file per player; the page fetches a
  player's file only when his profile or the H2H page shows him.
- `career-splits-tour.json` — build metadata, `coverage.missing` (why each
  profile has no file) and `pooled` (slim rows for tour-wide readers only).
- **No rank cap.** Every profile a reader can open is built; a player gets no
  file only when Tennis Abstract has no tour-level data for him (or no page
  that passes the identity check). "Splits not built for this player yet"
  shows only when his file returns 404. The single `career-splits.json` and the
  old `250 400` caps are retired.
- Checked by `tools/test-ten391-splits-shards.js` and `test-pp2-reconcile.js` "fix 7".

## Pieces

| Piece | Location | Role |
|---|---|---|
| Builder | `tools/build-career-splits.js` | Rebuilds `career-splits/` + `career-splits-tour.json` (+ the `splits-matches/` drawer files) from TA, no rank cap (cell-exact vs TA). |
| Refresh job | `tools/refresh-career-splits.sh` | Rebuild → regression-guard (file count) → commit+push `career-splits/`, `career-splits-tour.json`, `splits-matches*` → dispatch pipeline. |
| Bootstrap | `~/.bsp-splits-cron/bootstrap.sh` | Ensures a clean clone of `main`, then runs the refresh job. |
| Schedule | `~/Library/LaunchAgents/com.bspconsult.career-splits.plist` | launchd, once per day. Catches up on the next wake if the Mac was asleep at the scheduled time. |
| Log | `~/.bsp-splits-cron/refresh.log` | Every run appends start/coverage/publish lines here. |

## Safety

- **Isolated clone.** The job runs in `~/.bsp-splits-cron/SAAS`, never the
  founder's working tree (which is usually dirty on a feature branch).
- **Regression guard.** If player coverage (the number of files in
  `career-splits/`) drops more than 5% vs the currently published set (e.g. a TA outage starves the fetch), the job refuses to push.
- **Race-safe push.** The splits commit is rebased onto the latest `main`
  right before pushing, with retries, so it never clobbers the scores/odds bots.
- **No-op when unchanged.** If TA has no new matches, nothing is committed.

## Manual run / operator commands

```sh
# Run the whole thing now (same path launchd uses):
bash ~/.bsp-splits-cron/bootstrap.sh

# Force a full re-fetch (ignore the 20h page cache):
SPLITS_CACHE_TTL_HOURS=0 bash ~/.bsp-splits-cron/bootstrap.sh

# Watch the log / check the schedule:
tail -f ~/.bsp-splits-cron/refresh.log
launchctl list | grep career-splits
```

To move it into GitHub Actions later (Plan B) you would accept tour-only career
numbers; that trade-off was declined, which is why this exists.
