# Deploy lane — a claim with an expiry

Applies to every agent or session that pushes code to `main`: Paperclip runs
(CEO, Claude Code Operator — whatever git name they commit under, including
`bsp-ceo-bot`), odds/Kibl task runs, and interactive Claude Code sessions.
Founder ruling TEN-261, 2026-09-23. It replaces the old step "check whether
another agent is mid-deploy; post that you are taking the lane".

**Why.** The lane used to be a sentence in an issue comment. On 2026-09-23 TEN-253's
run `07fff3f5` claimed it at 06:50Z, pushed, and was cancelled at 07:06Z. Nothing expired
the claim, nothing could tell a live holder from a dead one, and TEN-260 waited behind it
with no signal.

**The lane is a record, not a comment.** `tools/deploy-lane.mjs` keeps it in
`~/.stennisfy/deploy-lane.json`. Every checkout and worktree on this Mac shares the file.
It holds the owner (ticket + run id), when the lane was taken, and when it expires. Keep
posting on your issue as well, so the founder can see it, but the tool's answer is what
counts.

---

## The rule — each step is a test you can apply

1. **Claim before you push.** `node tools/deploy-lane.mjs claim --ticket TEN-123` →
   **exit 0** means you hold the lane. The claim expires **45 min** after it is taken.
   **No exit 0 → no push.**
2. **Renew while working.** Run `node tools/deploy-lane.mjs renew --ticket TEN-123`
   at least every **15 min** while you hold the lane. That includes inside any loop that
   polls for your build to go live. A renewal only works from the run that owns the claim,
   and that run must be active on the board, so a crashed run can't renew and its claim
   lapses on its own.
3. **Release when the live read is done.** `node tools/deploy-lane.mjs release --ticket TEN-123`.
4. **Exit 3: held and not expired. Wait.** Re-run `claim` at least every 5 min. Each call
   records that you are still waiting.
5. **Taking an expired claim — the tool does it, only when all three hold:**
   - the owner's run is confirmed ended on the board (`cancelled`, `failed`, `succeeded`, `timed_out`, `error`);
   - a notice with the evidence has been posted on the owner's ticket;
   - `tools/clobber-check.sh` passes against current `origin/main`. Pass
     `--base <your merge-base> --files <every file your commit writes>`. Without them the
     takeover is refused (**exit 5**).
6. **Exit 4: expired, but the owner is alive or can't be confirmed dead. Do NOT take it.**
   The tool reports this to the founder once, on your ticket. An unreachable board is not
   proof of death.
7. **Never wait silently.** At every `claim` after 30 min of waiting, the tool posts a
   report on your ticket: who holds the lane, since when, and whether that run is alive.
   It repeats every 30 min while you wait.

**Exceptions, inline:**
- **Same ticket, new run.** If a new run on the ticket that holds the lane finds the old
  run ended **and the claim hasn't expired**, it inherits the claim. A Paperclip session
  reset is not a new task. Once the claim has expired, it goes through step 5 like anyone
  else. If the old run is still alive, it waits.
- **Sessions outside Paperclip** (no `PAPERCLIP_RUN_ID`, e.g. the founder's own
  terminal) claim as `session:<ticket>`. Their liveness can't be checked, so an expired
  session claim is **never** taken automatically: the waiter gets exit 4 and the founder
  decides. A session's own waiter reports go to its terminal (stderr), not to a ticket.
- **GitHub Actions and launchd data bots are NOT covered yet.** They commit data with
  `[skip ci]` every 5–15 min, and the ruling on them is pending on TEN-261. Don't treat
  their commits as a held lane, and don't make them wait on one.

**Exit codes:** 0 you hold the lane · 1 not the owner / run not active · 2 usage ·
3 wait · 4 expired, owner alive: reported, do not take · 5 takeover refused (clobber check
or notice failed) · 6 error (store unreadable, lock timeout). Only 0 lets you push.

**Timings.** 45 / 15 / 30 min are the founder's defaults. Measured 2026-09-23:
- push → live 19.3 and 21.9 min (two observations);
- Pages publishes every 9.9 min median (p90 13.2, max 21.2, 60 deploys);
- the pre-push suite takes ~6 min;
- a healthy lane is ≈ 30–55 min end to end. Renewals carry a live owner through that; the
  45 min only caps how long a dead owner can block.

Change the numbers in `tools/deploy-lane.mjs` and here together, only on a founder
ruling. Tests: `test-ten261-deploy-lane.mjs`.
