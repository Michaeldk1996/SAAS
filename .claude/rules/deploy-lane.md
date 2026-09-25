# Deploy lane — first come, first served; held only while deploying

Applies to every agent or session that pushes code to `main`: Paperclip runs
(CEO, Claude Code Operator — whatever git name they commit under, including
`bsp-ceo-bot`), odds/Kibl task runs, and interactive Claude Code sessions.
Founder rulings TEN-273, 2026-09-25 (items 2 and 3, the 00:55Z ruling and the 02:05Z
cap ruling). They supersede the TEN-261 45-min renewable lease.

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
   - **Rebased:** after `git fetch origin`, every commit in `<sha>..origin/main` must
     be a **data-bot commit**. All three must hold:
     - `[skip ci]` is in its **subject**;
     - its author is a data bot (`DATA_BOT_AUTHORS`: the bot authors of the last 30
       days of `[skip ci]` commits on main);
     - **every file it touches is a file a data bot really writes** (`DATA_FILES` /
       `DATA_DIRS` in `tools/deploy-lane.mjs`). The list comes from the files touched
       by bot `[skip ci]` commits over 90 days, cross-checked against the `git add` and
       commit-back lines of the bot workflows and launchd scripts. Hand-curated files
       the code reads (`court-speed-map.json`, `tournament-surfaces.json`,
       `player-atp-aliases.json`, anything config/schema-like) are **not** data. Code
       files, `package*.json`, `.github/` and `tools/` never are. Agents have committed
       code under bot identities with `[skip ci]` in the title (TEN-232).

     One missing code commit means you are not rebased.
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
     output lists what is missing. If you were not yet waiting, nothing is recorded; if
     you were, you keep your place and the output gives your position (step 3).
   - Every claim logs your position and minutes waited in the history.
   - **No exit 0 → no push.**
3. **Leaving the queue.**
   - **Dead waiters:** a waiter whose run is confirmed ended on the board (`cancelled`,
     `failed`, `succeeded`, `timed_out`, `error`) is dropped the next time someone
     behind it claims (`waiter-dropped-dead`, with the evidence).
   - **Silent waiters:** any waiter that has not run `claim` for **15 min**
     (`WAITER_STALE_MIN`) is dropped (`waiter-dropped-stale`), **alive or not**. A
     claimant that stopped claiming is no longer a live claimant. You poll every ≤ 5 min.
   - **Not ready still counts.** A claim that returns **exit 7** (you are re-preparing:
     rebasing, re-running `ci-suite.sh`) keeps your place, **reports your position**
     and is logged (`waiting-not-ready`), as long as you keep calling `claim`.
   - **Batched in:** if the holder landed your commit in its batch, you leave the queue.
     The notice tells you to `release` if you have nothing more to push.
   - **By choice:** `release` removes you from the queue.
4. **Every land goes through `tools/deploy-batch.mjs`. You hold the lane from there
   until "live SHA confirmed is mine", then it is released.**
   - Land with `node tools/deploy-batch.mjs --ticket TEN-123 --sha <the sha you claimed with>`.
     It handles the solo case, pushes only the claimed, suite-green sha, and records
     your `readBack` sha and the push time on your claim.
   - **A raw `git push` is outside the contract.** This tool cannot technically stop it:
     it bypasses the receipt check, the clobber re-check and the pipeline-aware hold.
   - Then, in your poll loop, run
     `node tools/deploy-lane.mjs confirm-live --ticket TEN-123 --sha <readBack>`. It
     accepts only your claimed sha or the `readBack` sha deploy-batch recorded; any
     other sha → exit 1.
   - It checks the **site first** (`tools/check-live-build.sh <sha>`):
     - on exit 0 it **releases the lane** (`released-live-confirmed`) and exits 0, even
       if the hold rules below would have released you at that moment. A confirmed
       deploy is never reported as a forced release;
     - on exit 1 (not live yet) or 2 (undetermined) the hold rules run. If you still
       hold the lane it exits 3; if they released you, exit 1 with the reason.
   - `check-live-build.sh` has no cache-bust option. CDN lag (Pages `max-age` 600 s) is
     covered by the read-back grace in step 6.
   - `readBack` equals your sha when your commit was pushed as is (holder alone, already
     on top of `origin/main`). Otherwise it was cherry-picked, and only `readBack` is on main.
   - **All verification after that runs without the lane.** If verification finds a
     fix, the fix gets ready and claims again, at the back of the queue like anyone else.
   - **A new sha while you hold the lane:** before your push, `claim` with a new ready
     sha updates the claim, and you keep the lane. **After your push**, a new sha is
     refused (`pushed-confirm-first`, exit 1). Confirm the pushed commit first
     (`confirm-live` releases the lane), then claim the new sha at the back of the
     queue. If the pushed build never goes live, `release` and investigate; the cap
     frees the lane anyway.
5. **What you push must be what the suite passed, plus data-bot commits and nothing
   else.**
   - The pushed tree can differ from the suite-tested tree **only by `[skip ci]`
     data-bot commits**, and the clobber check is re-run against them.
   - **If a code commit lands after your claim,** your claimed sha is no longer the
     tested tree. `release`, rebase, run `tools/ci-suite.sh` again and claim again;
     `deploy-batch.mjs` refuses to push over it.
6. **How long you may hold the lane** (founder, 2026-09-25 02:05Z). The hold and its
   40-min clock start at your **claim**, so the clobber check, `deploy-batch.mjs` (and a
   batch's combined suite) and the push all run inside it. Checked on every `claim`,
   `status`, `renew` and `confirm-live`:
   - (i) **your run is dead** → released at once, reason `owner-dead`;
   - (ii) **your pipeline run is in progress** → you keep the lane, even past 40 min; a
     healthy deploy is never cut off. After that run **completes successfully** you keep
     it for another **12 min** (`READBACK_GRACE_MIN` = Pages `max-age` 600 s + 2 min), so
     your read-back can see it. A failed or cancelled run gets no grace;
   - (iii) **your pipeline run has sat queued for more than 10 min**
     (`PIPELINE_QUEUED_MAX_MIN`) → released, reason `pipeline-queued-10min`;
   - (iv) **40 min since the claim** (`MAX_HOLD_MIN`, from `takenAt`) **and none of the
     above** → released, reason `cap-40min-no-run`.

   Definitions and details:
   - **"Your pipeline run"** is the **first** `pipeline.yml` run whose first **job**
     started at or after your push time. A run with no started job has not started:
     live GitHub stamps `run_started_at` = `created_at` on every run, including the
     roughly 21% cancelled while still queued. `pushedAt` is captured by `deploy-batch.mjs` just before the push,
     because a run re-points to the tip of main when it starts. It is recorded on the
     claim once seen. **Only it extends the hold; later ticks never do.**
   - **"Queued"** means created at or after your push and not yet started.
   - **[AWAITING THE FOUNDER'S CONFIRMATION] Healthy queueing** (`HEALTHY_QUEUE_PAUSES_CLOCK`,
     shipped on; one line flips it back to the ruling's literal text). The
     pipeline group allows one running and one pending run, so your run can sit pending
     behind a tick that started before your push. While such a tick is in progress,
     your deploy is moving: no (iii), and it counts as in progress for (iv). The 10-min
     queued clock only runs while nothing is in progress. Set the flag to `false` to
     restore the ruling's literal text.
   - **One failed GitHub read** reuses the last known state of your run if it is at
     most **5 min** old (`PIPELINE_STALE_OK_MIN`), and **only to keep the lane**: run in
     progress, or read-back grace. Saved state never causes a release. The queued rule
     is skipped on it, leaving just the plain 40-min cap. A single 502 does not cut off
     a run seen in progress 3 min ago.
   - **GitHub unreachable beyond that = unknown**, and unknown **never** extends a hold:
     rule (iv) applies as if no run were in progress. A grace already earned from a
     recorded successful run still applies.
   - `renew` and `claim` never extend anything. `renew` answers "do I still hold it?"
     (exit 0 yes, exit 1 no, with the reason).
   - **A forced release:**
     - puts you back in the queue at the back **only if you had not pushed** and your
       run is alive. A holder whose push is out has nothing to wait for; the notice
       says so and gives the read-back command;
     - logs the reason;
     - posts on your ticket;
     - **dispatches the freshness alarm's channel**: a `pipeline-watchdog.yml` run with
       `lane_alert` = the reason text (with `%`, CR and LF escaped), which goes red.
     Notice and alarm go out after the store lock is released, and are best-effort: a
     failure is logged and never keeps the lane held.
   - **Nothing inside the store lock touches the network.** Liveness, pipeline runs and
     the GitHub token are fetched before it (one shared liveness deadline; at most 3
     jobs calls), and notices and alarms are sent after it.
7. **Never wait silently.** At every `claim` after 30 min of waiting, the tool posts a
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
  `deploy-batch.mjs` (the one way to land) combines them. The tool:
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
- **Batched in?** Your commit landed under a new sha (`landedAs`, also in the notice),
  and you left the lane queue. Do your live read-back, without the lane, with
  `tools/check-live-build.sh <landedAs>`. If you have nothing more to push, `release`
  to withdraw anything else you queued.

## Cutover

- **The drop-in job:** run `bash tools/odds-archive-dropin.sh --install` right after the
  merge. The installed launchd copy calls `claim` without `--sha`, which now exits 2, so
  until reinstalled it fails closed. Its failed marker then blocks retries of that
  workbook until the file is saved again.
- **Old tool still in use:** a worktree that has not rebased onto this version runs the
  old TEN-261 tool against the same store. That tool can renew (extend) its own claim by
  45 min at a time, claim without the ready gate, take a free lane out of turn (it
  ignores the waiter queue), and take over a claim it sees as expired. The new tool
  treats that claim as a legacy lease (below). The store is shared on purpose, so there
  is no version gate: one could split the lane in two. Each worktree is safe once it
  rebases.
- **A claim written by the old tool** (no version marker, a lease `expiresAt`) is shown
  as a **legacy lease**, never as a hold cap. Its expiry is honoured **once**, even if
  an old tool renews it later, and then it is freed (reason `legacy-lease-expired`).

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
  - a session **holder** is freed by `release`, `confirm-live` or the hold rules (6).
    It can never be confirmed dead, so a dead session holder is freed at 40 min
    unless its own pipeline run is in progress (or in its read-back grace). The old
    rule — session claims never taken automatically, the founder decides — is gone;
  - a session **waiter** is dropped after 15 min without a `claim`, like every waiter;
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
| 1 | Not the holder, the claim was already released, or `confirm-live` got a sha that is neither your claimed sha nor your `readBack` |
| 2 | Usage error (e.g. `claim` without `--sha`) |
| 3 | Wait: not your turn, or held (`confirm-live`: not live yet, still holding) |
| 6 | Error (store unreadable, lock timeout) — never a hold |
| 7 | Not ready — see `missing` |

Only 0 lets you push. Codes 4 and 5 (TEN-261) are retired; no path returns them.

**Timings.**
- **Constants:**
  - `MAX_HOLD_MIN`: 40 (from `takenAt`; extended only while your pipeline run is in progress);
  - `PIPELINE_QUEUED_MAX_MIN`: 10;
  - `WAITER_STALE_MIN`: 15 (all waiters);
  - `READBACK_GRACE_MIN`: 12;
  - `HEALTHY_QUEUE_PAUSES_CLOCK`: true (proposal, pending the founder);
  - `WAIT_REPORT_MIN`: 30;
  - `READY_TTL_MIN`: 60.
- **Measured 2026-09-23:** push → live 19.3 and 21.9 min; Pages publishes every 9.9 min
  median (p90 13.2).
- **What the lane covers.** Your own suite (~6 min) and review run before the claim. A
  solo land holds the lane for the clobber check, the push and the wait until
  `confirm-live` succeeds (≈ 20–26 min). In batch mode, the combined tree's `ci-suite`
  (~6 min) also runs inside the lane.
- **Measured for the cap** (TEN-273 Part A report): claim → live of the first push, over
  19 holds, median 24.6, p95 40.8, max 61.7 min. That long tail is why the 40-min cap
  extends while the owner's pipeline run is in progress.
- **The cost of first-come-first-served:** a free lane waits until its head waiter's
  next poll (at most ~5 min).

Change the numbers only on a founder ruling, in the tool and here together. Tests:
`test-ten261-deploy-lane.mjs`, `test-ten273-deploy-batch.mjs`, `tools/test-ten273-lane-alert.js`.
