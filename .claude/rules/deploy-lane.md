# Deploy lane — first come, first served; held only while deploying

Applies to every agent or session that pushes code to `main`: Paperclip runs
(CEO, Claude Code Operator — whatever git name they commit under, including
`bsp-ceo-bot`), odds/Kibl task runs, and interactive Claude Code sessions.
Founder rulings TEN-273, 2026-09-25 (items 2 and 3, and the 00:55Z ruling). They
supersede the TEN-261 45-min renewable lease and the earlier 30-min auto-release.

**Why.**
- TEN-261 made the lane a record after TEN-253's run `07fff3f5` was cancelled mid-poll
  on 2026-09-23 while holding a lane that was only a comment.
- A renewable lease then let a live holder keep the lane through its suite, review and
  rebase, so all of that now happens before the claim.
- The claims themselves were a race. TEN-273 waited from 23:41Z, and TEN-270 took the
  lane at 00:07Z because it polled first. Now the longest-waiting live claimant gets
  the lane.
- The lane is released the moment your commit is confirmed live. Verifying, watching
  and reading logs happen without it.

**The lane is a record, not a comment.** `tools/deploy-lane.mjs` keeps it in
`~/.stennisfy/deploy-lane.json`. Every checkout and worktree on this Mac shares the file.
Keep posting on your issue so the founder can see it, but the tool's answer is what counts.

---

## The rule — each step is a test you can apply

1. **Get the commit ready before you claim. All three must hold:**
   - **Suite green:** `tools/ci-suite.sh <sha>` exits 0. It runs `npm test` on exactly
     that sha in a fresh `git clone --depth 100`, and only on exit 0 does it write
     `~/.stennisfy/suite-receipts/<sha>.json`. Nothing else writes receipts.
   - **Rebased:** after `git fetch origin`, every commit in `<sha>..origin/main` has
     `[skip ci]` in its **subject** (a data bot). One missing code commit means you are
     not rebased.
   - **Reviewed:** the review is done. `--reviewed` is your attestation, and the claim
     records it.
2. **Claim, and keep claiming until it is your turn:**
   `node tools/deploy-lane.mjs claim --ticket TEN-123 --sha <sha> --reviewed`.
   - Your first ready claim puts you in the **waiter queue** with your wait-start time.
   - A free lane goes **only to the head of the queue**, the longest-waiting claimant
     still in it. It does not go to whoever polls first.
   - **Exit 3** means not your turn. The output gives your `position`, your `waitedMin`
     and who is `ahead`. Re-run `claim` at least every 5 min.
   - **Exit 0** means you hold the lane. **Exit 7** means the commit is not ready: the
     output lists what is missing, and the store is not touched.
   - Every claim logs your position and minutes waited in the history.
   - **No exit 0 → no push.**
3. **Leaving the queue.**
   - **Dead waiters:** a waiter whose run is confirmed ended on the board (`cancelled`,
     `failed`, `succeeded`, `timed_out`, `error`) is dropped the next time someone
     behind it claims (`waiter-dropped-dead`, with the evidence).
   - **Silent session waiters:** a session waiter that has not run `claim` for **15 min**
     (`WAITER_STALE_MIN`) is dropped (`waiter-dropped-stale`). So is a Paperclip waiter
     the board cannot vouch for.
   - **Live Paperclip waiters:** a waiter whose run the board shows as alive keeps its
     place however long it waits.
   - **By choice:** `release` removes you from the queue.
4. **You hold the lane from push to "live SHA confirmed is mine", then it is released.**
   - Push (or `tools/deploy-batch.mjs`, below), then in your poll loop run
     `node tools/deploy-lane.mjs confirm-live --ticket TEN-123 --sha <the sha you pushed>`.
   - It runs `tools/check-live-build.sh <sha>`:
     - on exit 0 it **releases the lane** (`released-live-confirmed`) and exits 0;
     - on exit 1 (not live yet) or 2 (undetermined) it keeps holding and exits 3. Poll again.
   - **All verification after that runs without the lane.** If verification finds a
     fix, the fix gets ready and claims again, joining the queue at the back like anyone
     else.
   - Landed with `deploy-batch.mjs`? Confirm the **`readBack` sha it prints**. It equals
     your sha when your commit was pushed as is (holder alone, already on top of
     `origin/main`); otherwise your commit was cherry-picked and only the printed sha is
     on main.
5. **What you push must be what the suite passed, plus data-bot commits and nothing
   else.** Data bots commit every minute, so the pushed tree can differ from the
   suite-tested tree **only by `[skip ci]` data-bot commits**, and the clobber check is
   re-run against those commits before the push. If a code commit lands in between,
   rebase, get a new receipt and claim again.
6. **A holder whose run has ended is released on the next `claim`.**
   - The tool records the evidence (`released-dead-owner`) and posts a best-effort
     notice on the holder's ticket.
   - The lane then goes to the head of the queue, not necessarily to the caller.
   - `unknown` liveness (board unreachable, or a `session:` holder) is **not** dead.
7. **Total-hold cap: `MAX_HOLD_MIN`, measured from `takenAt`. Its number is not set yet.**
   - The founder has not given the number, so it is `null` and **no cap is wired**.
   - Once set, `renew` and `claim` can never extend a hold past it. At the cap the tool:
     - releases the lane;
     - puts the holder back in the queue **at the back**, with a fresh wait-start;
     - logs `cap-released`;
     - posts an alert on the holder's ticket (best-effort; a failed alert never blocks).
   - `renew` answers "do I still hold it?": exit 0 while you do, exit 1 when you don't.
8. **Never wait silently.** At every `claim` after 30 min of waiting, the tool posts a
   report on your ticket: who holds the lane, since when, whether that run is alive,
   and your position. It repeats every 30 min while you wait.

## Combining ready commits (one build for several)

- **The ready queue is not the waiter queue.** `ready` offers your commit to the
  current holder's batch. It does **not** put you in line for the lane; only `claim`
  does. Run both if you want both.
- **Ready but not holding the lane?** Queue your commit with
  `node tools/deploy-lane.mjs ready --ticket TEN-123 --sha <sha> --reviewed`. It uses the
  same gate as `claim`: exit 0 means queued, exit 7 means not ready. Re-running it
  replaces your earlier entry. `status --ticket TEN-123` shows the queue and, once your
  commit has landed, its `landedAs`.
- **An entry leaves the queue** when it lands; when you run
  `deploy-lane.mjs unready --ticket TEN-123` (exit 0 withdrawn, 1 nothing queued) or
  `release`; **60 min** after it was queued (`READY_TTL_MIN`); or, at batch time, when
  its run has ended (best-effort notice, never landed, because nobody would do the
  read-back).
- **Holding the lane with other runs queued?** A granted `claim` lists them as `batch`.
  Land with `node tools/deploy-batch.mjs --ticket TEN-123 --sha <sha>` instead of a
  plain push. The tool:
  - refuses with exit 1 unless you hold the lane, `--sha` **is the sha on your claim**
    and that sha still has a green suite receipt. It also refuses a merge commit in
    `merge-base..sha` ("rebase, don't merge") and your commit failing its own clobber
    check against its merge-base;
  - checks each queued entry exactly as a solo land would be checked. An entry that
    fails is skipped, stays queued and is marked with a `status` and the reason:
    `merge` (contains a merge commit), `not-rebased` (a code commit has landed since
    it was queued), `clobber` (its own clobber check against its merge-base fails),
    `conflict` (does not cherry-pick onto the batch);
  - puts your commit first, as is if it already sits on top of `origin/main`, otherwise
    cherry-picked; then cherry-picks each remaining entry in `readyAt` order;
  - on the combined tree, runs `tools/clobber-check.sh` against the `origin/main` it
    started from, then `tools/ci-suite.sh`;
  - makes one push. If the push is rejected because data bots landed, it replays onto
    the new tip, re-runs the clobber check and retries once;
  - marks each included entry `landedAs` and posts a notice on its issue. An entry
    leaves the queue only if both its run and its sha match: a newer commit queued
    during the batch stays queued;
  - prints your `readBack` sha (JSON field and a `READ-BACK:` line on stderr).
- **If anything on the combined tree fails (clobber check, suite, a code commit landing
  mid-batch), it falls back to one by one.** Only your own commit lands, as a normal
  land: it must still be rebased and pass the clobber check against its merge-base.
  The other entries stay queued, and the summary says why.
- **Batched in?** Your commit landed under a new sha (`landedAs`, also in the notice).
  Do your live read-back, without the lane, with `tools/check-live-build.sh <landedAs>`.
- **Old tool still in use.** Until every checkout and worktree runs this version of
  `deploy-lane.mjs`, an old copy can still renew (extend) a claim and claim without the
  ready gate. The store is shared on purpose, so do not add a version gate: it could
  split the lane in two.

**Exceptions, inline:**
- **Same ticket, new run.**
  - **No silent inheritance of a hold** (founder ruling TEN-261, kept). A new run on the
    ticket that holds the lane may not renew, release or push under the old run's
    claim; `renew` and `release` from it exit 1. If the old run has ended, its claim is
    released and the lane goes to the head of the queue. The new run gets it only when
    that head is the new run (then it is logged `re-claimed`, with a RE-CLAIMED notice).
  - **A waiting place is inherited, narrowly.** A new run inherits the ticket's
    wait-start only if the old run is **dead** and the new run claims **within 15 min**
    of the old run's last claim. Otherwise it joins at the back.
  - Why this is fair: the ticket's work never stopped waiting; Paperclip only cycled
    its run. The dead-run proof stops one ticket holding two places. The window stops
    a ticket that went quiet from jumping back in.
- **Sessions outside Paperclip** (no `PAPERCLIP_RUN_ID`, e.g. the founder's own
  terminal) claim as `session:<ticket>`. Their liveness can't be checked:
  - a session **holder** is freed only by `release`, `confirm-live` or the cap. With the
    cap pending, a dead session holder needs a human `release`;
  - a session **waiter** is dropped after 15 min without a `claim`;
  - a session's waiter reports go to its terminal (stderr), not to a ticket.
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
| 0 | You hold the lane (`ready`: queued; `confirm-live`: live, lane released) |
| 1 | Not the holder, or the claim was already released |
| 2 | Usage error (e.g. `claim` without `--sha`) |
| 3 | Wait: not your turn, or held (`confirm-live`: not live yet, still holding) |
| 6 | Error (store unreadable, lock timeout) — never a hold |
| 7 | Not ready — see `missing` |

Only 0 lets you push. Codes 4 and 5 (TEN-261) are retired; no path returns them.

**Timings.**
- **Constants:**
  - `MAX_HOLD_MIN` (total-hold cap): **pending a founder number**; `null` = not wired;
  - `WAITER_STALE_MIN`: 15;
  - `WAIT_REPORT_MIN`: 30;
  - `READY_TTL_MIN`: 60.
- **Measured 2026-09-23:** push → live 19.3 and 21.9 min; Pages publishes every 9.9 min
  median (p90 13.2).
- **What the lane covers.** Your own suite (~6 min) and review run before the claim. A
  solo land holds the lane for the clobber check, the push and the wait until
  `confirm-live` succeeds (≈ 20–26 min). In batch mode, the combined tree's `ci-suite`
  (~6 min) also runs inside the lane. The cap, once set, should allow for this.
- **The cost of first-come-first-served:** a free lane waits until its head waiter's
  next poll (at most ~5 min).

Change the numbers only on a founder ruling, in the tool and here together. Tests:
`test-ten261-deploy-lane.mjs`, `test-ten273-deploy-batch.mjs`.
