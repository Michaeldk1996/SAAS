# Deploy lane — held only while deploying

Applies to every agent or session that pushes code to `main`: Paperclip runs
(CEO, Claude Code Operator — whatever git name they commit under, including
`bsp-ceo-bot`), odds/Kibl task runs, and interactive Claude Code sessions.
Founder ruling TEN-273, 2026-09-25 (items 2 and 3). It supersedes the TEN-261
45-min renewable lease wherever the two conflict.

**Why.** TEN-261 made the lane a record with an expiry after TEN-253's run `07fff3f5`
was cancelled mid-poll on 2026-09-23 while holding a lane that was only a comment.
But a renewable lease let a live holder keep the lane through its suite, review and
rebase. None of that work needs the lane, and everyone else waited behind it. Now
you do that work first, claim only when the commit is ready, and the lane frees itself
after 30 min.

**The lane is a record, not a comment.** `tools/deploy-lane.mjs` keeps it in
`~/.stennisfy/deploy-lane.json`. Every checkout and worktree on this Mac shares the file.
Keep posting on your issue so the founder can see it, but the tool's answer is what counts.

---

## The rule — each step is a test you can apply

1. **Get the commit ready before you claim. All three must hold:**
   - **Suite green:** `tools/ci-suite.sh <sha>` exits 0. It runs `npm test` on exactly
     that sha in a fresh `git clone --depth 100`, and only on exit 0 does it write
     `~/.stennisfy/suite-receipts/<sha>.json`. Nothing else writes receipts.
   - **Rebased:** after `git fetch origin`, every commit in `<sha>..origin/main` is a
     data-bot `[skip ci]` commit. One missing code commit means you are not rebased.
   - **Reviewed:** the review is done. `--reviewed` is your attestation, and the claim
     records it.
2. **Claim:** `node tools/deploy-lane.mjs claim --ticket TEN-123 --sha <sha> --reviewed`.
   **Exit 0** means you hold the lane. **Exit 7** means the commit is not ready; the
   output lists what is missing, and the store is not touched. **No exit 0 → no push.**
3. **The hold is 30 min, and nothing extends it.** `expiresAt = takenAt + 30 min`.
   `renew` only answers "do I still hold it?": exit 0 while you do, exit 1 after the
   cap or if you are not the owner. Calling `claim` again does not extend it either.
   Any `claim`, `status`, `renew` or `release` at or after `expiresAt` releases the
   claim and posts a notice on your ticket. If the notice fails, the lane is still released.
4. **Push, then release when your live read-back is done:**
   `node tools/deploy-lane.mjs release --ticket TEN-123`. **The read-back is mandatory
   even if the cap has already released the lane.** `tools/check-live-build.sh <sha>`
   tests containment, so a later push does not invalidate it (see CLAUDE.md,
   "Deploying — one lane at a time").
5. **A claim whose owner run has ended is released on the next `claim`.** The owner
   counts as ended when the board shows `cancelled`, `failed`, `succeeded`,
   `timed_out` or `error`. The tool records the evidence in the history
   (`released-dead-owner`), posts a best-effort notice on the owner's ticket, and gives
   you the lane. This happens at minute 1, not minute 30.
6. **Exit 3 means the lane is held by a run that is alive, or whose state is
   `unknown`. Wait.** Re-run `claim` at least every 5 min. `unknown` (board
   unreachable, or the owner is a `session:`) is **not** dead: only the 30-min cap
   frees that claim.
7. **Never wait silently.** At every `claim` after 30 min of waiting, the tool posts a
   report on your ticket: who holds the lane, since when, and whether that run is alive.
   It repeats every 30 min while you wait.

## Combining ready commits (one build for several)

- **Ready but not holding the lane?** Queue your commit with
  `node tools/deploy-lane.mjs ready --ticket TEN-123 --sha <sha> --reviewed`. It uses the
  same gate as `claim`: exit 0 means queued, exit 7 means not ready. Re-running it
  replaces your earlier entry. `status --ticket TEN-123` shows the queue and, once your
  commit has landed, its `landedAs`.
- **Holding the lane with other runs queued?** A granted `claim` lists them as `batch`.
  Land with `node tools/deploy-batch.mjs --ticket TEN-123 --sha <sha>` instead of a
  plain push. The tool:
  - refuses with exit 1 unless you hold the lane;
  - cherry-picks your commits, then each queued entry's in `readyAt` order, onto
    `origin/main`. An entry that conflicts is skipped, stays queued and is marked
    `conflict` with the reason;
  - on the combined tree, runs `tools/clobber-check.sh` against the `origin/main` it
    started from, then `tools/ci-suite.sh`;
  - makes one push. If the push is rejected because data bots landed, it replays onto
    the new tip, re-runs the clobber check and retries once;
  - marks each included entry `landedAs` and posts a notice on its issue.
- **If anything on the combined tree fails (clobber check, suite, a code commit landing
  mid-batch), it falls back to one by one.** Only your own commit lands, as a normal
  land: it must still be rebased and pass the clobber check against its merge-base.
  The other entries stay queued, and the summary says why.
- **Batched in?** Your commit landed under a new sha (`landedAs`, also in the notice).
  Do your live read-back with `tools/check-live-build.sh <landedAs>`.

**Exceptions, inline:**
- **Same ticket, new run: no silent inheritance** (founder ruling TEN-261, kept). A new
  run on the ticket that holds the lane may not renew, release or push under the old
  run's claim; `renew` and `release` from it exit 1. It runs `claim`. If the old run is
  alive, the new run waits (exit 3). If the old run has ended, its claim is released
  and the new run claims **fresh**: its own run id, a new 30 min, and a RE-CLAIMED
  notice on the ticket.
- **Sessions outside Paperclip** (no `PAPERCLIP_RUN_ID`, e.g. the founder's own
  terminal) claim as `session:<ticket>`. Their liveness can't be checked, so a session
  claim is freed only by `release` or the 30-min cap. A session's waiter reports go to
  its terminal (stderr), not to a ticket.
- **Data bots are exempt** (founder ruling, 2026-09-23). These are the GitHub Actions
  and launchd jobs that commit data with `[skip ci]`: Kibl archive, scores, pipeline
  commit-backs, odds, the daily/weekly refreshes, and the styles/splits/entry-lists
  launchd jobs. They never take the lane and never wait on one. Their commits are also
  why "rebased" allows `[skip ci]` commits ahead of you. What protects code from them
  is the clobber check. Every code push still runs `tools/clobber-check.sh` against
  current `origin/main`, data-only commits included. If one of them moved a file your
  commit writes, stop and rebase.

**Exit codes (`deploy-lane.mjs`):**

| Code | Meaning |
|---|---|
| 0 | You hold the lane (for `ready`: queued) |
| 1 | Not the owner, or the claim was already released |
| 2 | Usage error (e.g. `claim` without `--sha`) |
| 3 | Wait |
| 6 | Error (store unreadable, lock timeout) — never a hold |
| 7 | Not ready — see `missing` |

Only 0 lets you push. Codes 4 and 5 (TEN-261) are retired; no path returns them.

**Timings.** The 30-min cap is `MAX_HOLD_MIN`, the one constant in
`tools/deploy-lane.mjs`; the waiter report interval is `WAIT_REPORT_MIN` (30). Measured
2026-09-23: push → live 19.3 and 21.9 min; Pages publishes every 9.9 min median (p90
13.2). The suite (~6 min) and the review now run before the claim, so the lane covers
only the push and the wait for the build to go live. If the cap releases the lane before
your build is live, your read-back is still yours to do. Change the numbers only on a
founder ruling, in the tool and here together. Tests: `test-ten261-deploy-lane.mjs`,
`test-ten273-deploy-batch.mjs`.
