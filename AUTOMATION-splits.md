# Career-splits daily automation (TEN-8, Plan A)

`career-splits.json` (the 22-column Career / Last-52-weeks serve & return splits
in the Player Profile tab) is the **one** dataset that cannot be refreshed by the
GitHub Actions pipeline. It is sourced from Tennis Abstract, which serves this
machine's residential IP (HTTP 200) but blocks every datacenter IP (HTTP 403),
so `pipeline.yml` running on GitHub's runners cannot fetch it. The only
CI-reachable substitute, TML-Database, is tour-only and shrinks every player's
career record (Borges 156 vs 515 live, Alcaraz 345 vs 464) — it fails the
zero-regression requirement.

**Plan A** keeps the proven TA builder and schedules it in the operator
environment (this machine) instead, so the refresh is automatic and daily
without depending on anyone running it by hand.

## Pieces

| Piece | Location | Role |
|---|---|---|
| Builder | `tools/build-career-splits.js` | Rebuilds `career-splits.json` from TA (unchanged, proven, cell-exact vs TA). |
| Refresh job | `tools/refresh-career-splits.sh` | Rebuild → regression-guard → commit+push `career-splits.json` → dispatch pipeline. |
| Bootstrap | `~/.bsp-splits-cron/bootstrap.sh` | Ensures a clean clone of `main`, then runs the refresh job. |
| Schedule | `~/Library/LaunchAgents/com.bspconsult.career-splits.plist` | launchd, once per day. Catches up on the next wake if the Mac was asleep at the scheduled time. |
| Log | `~/.bsp-splits-cron/refresh.log` | Every run appends start/coverage/publish lines here. |

## Safety

- **Isolated clone.** The job runs in `~/.bsp-splits-cron/SAAS`, never the
  founder's working tree (which is usually dirty on a feature branch).
- **Regression guard.** If player coverage drops more than 5% vs the currently
  published file (e.g. a TA outage starves the fetch), the job refuses to push.
- **Race-safe push.** The single-file commit is rebased onto the latest `main`
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
