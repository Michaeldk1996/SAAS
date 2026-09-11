#!/usr/bin/env bash
# The odds capture loop — TEN-179 item 1, founder authorised 2026-09-11.
#
# WHY THIS EXISTS
# ---------------
# We wrote `cron: '0 * * * *'` and measured what GitHub actually delivered:
# 3 of 11 slots, 27%, with 2.6-2.7h gaps. `odds-history.yml` at `0 */3 * * *`
# delivered ~5/day against 8. That gap — not the write path, not the pipeline
# guard — is what made a NOW price sit 76 minutes behind a bet365 move.
#
# A shorter cron does not fix it; GitHub throttles short-interval schedules
# first. The fix is to stop needing one cron delivery per capture. ONE delivery
# starts this loop, and the loop then captures on its own internal clock for
# the rest of its window.
#
# WHAT IT RUNS, AND AT WHAT COST
# ------------------------------
# Every INTERVAL_MIN (15):  refresh-odds-history.py --first-appearance
#     ZERO metered units. /v4/historical-odds is free. This is TEN-179 item 3 —
#     catch a fixture's bet365 market within 15 minutes of it opening. The
#     script measures the meter either side and errors if that ever stops
#     being free.
#
# Every METERED_EVERY-th (4th, i.e. 60 min):  refresh-odds.py
#     ~2 billable /v4/odds-by-tournaments units. This is the NOW leg, and its
#     cadence is DELIBERATELY UNCHANGED — flat hourly is the founder's ruling
#     (option (a), 2026-09-10) and this loop is here to make hourly actually
#     mean hourly, not to spend more. 86% of bet365's pre-match movement is
#     >6h out, so sprinting buys resolution where nothing moves.
#
# INTERRUPTS
# ----------
# Every iteration commits and pushes before it sleeps, so a kill — redeploy,
# timeout, cancelled run, runner eviction — costs at most the one iteration in
# flight. SIGTERM/SIGINT are trapped and flush whatever is on disk first.
# Nothing is ever held to the end of the job.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

INTERVAL_MIN="${INTERVAL_MIN:-15}"
METERED_EVERY="${METERED_EVERY:-4}"      # 4 x 15min = the approved flat hour
LOOP_MINUTES="${LOOP_MINUTES:-330}"      # 5h30m; the job timeout is 350, Actions caps a job at 360
CADENCE_FILE="odds-capture-cadence.json"
STALENESS_FILE="odds-now-staleness.json"
STATE_FILES="matches.json odds-fixture-map.json odds-quota-history.json alert-state.json odds-open-monitor.json $CADENCE_FILE $STALENESS_FILE"

DEADLINE=$(( $(date -u +%s) + LOOP_MINUTES * 60 ))
RUN_TAG="${GITHUB_RUN_ID:-local}/${GITHUB_RUN_ATTEMPT:-1}"
ITER=0
METERED_DUE=1                            # the first iteration always refreshes NOW
STOPPING=0
FREE_BILLED=0                            # set by a BILLED_RC(9) from the free sweep; see below

# --- item 4: this checkout's own version ------------------------------------
# actions/checkout@v4 runs ONCE and the loop then runs for up to 350 minutes, so a fix
# merged to main is NOT in force until the loop restarts. Worse, the versions skew:
# bash holds an open fd on THIS file and `git reset --hard` replaces it by rename (new
# inode), so the driver runs its original bytes for the whole window — while the Python
# helpers are invoked as `python3 <file>` and are re-read every tick. A push race
# therefore yields OLD DRIVER + NEW PYTHON, which is the one combination where the new
# sweep returns rc 9 (BILLED) and the old driver's `|| echo ::warning::` swallows it.
# Detection without consequence, in a green run. See driver_moved() below.
BOOT_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
DRIVER_FILES="odds-capture-loop.sh ci-commit-push.sh refresh-odds.py \
refresh-odds-history.py metered-spend-guard.py check-now-staleness.py bsp_alerts.py"

# --- the interrupt contract ---------------------------------------------------
# GitHub sends SIGTERM and then hard-kills. We do not start new API work on the
# way out; we just make sure what is already on disk reaches main.
on_signal() {
  STOPPING=1
  echo "::notice::Signal received at iteration $ITER — flushing captured state before exit."
  ./ci-commit-push.sh "chore(odds): flush capture on interrupt [skip ci]" $STATE_FILES || true
  # A billed free leg has to redden the run on THIS path too. Otherwise the one
  # exit route that is guaranteed to be taken on every cancelled or timed-out job
  # is also the one route that swallows the alarm (founder ruling item 4).
  [ "$FREE_BILLED" -eq 1 ] && exit 1
  exit 0
}
trap on_signal TERM INT

driver_moved() {
  # Has any file this loop EXECUTES changed on origin/main since we checked out?
  # Deliberately the whole executable set, not just this script: running a new Python
  # helper under an old bash driver is the dangerous state, so the answer has to be
  # "one consistent version or restart", never "whichever files happened to update".
  [ "$BOOT_SHA" = "unknown" ] && return 1
  git fetch -q origin main 2>/dev/null || return 1
  # shellcheck disable=SC2086
  git diff --quiet "$BOOT_SHA" FETCH_HEAD -- $DRIVER_FILES 2>/dev/null
  local drc=$?
  # EXACTLY 1 means "they differ". 0 means identical; 128 (or anything else) means git
  # itself failed — a bad ref, a corrupt object, a half-fetched shallow repo. Reading a
  # git ERROR as "the driver moved" would dispatch a successor and stand down every
  # tick forever, and each restart clears the untracked billed-strike marker, so the
  # two-sweep billing detector could never reach its second strike.
  if [ "$drc" -eq 1 ]; then return 0; fi
  if [ "$drc" -ne 0 ]; then
    echo "::warning::driver_moved: git diff failed (rc $drc) — assuming the checkout is" \
         "current rather than restarting on an unreadable answer."
  fi
  return 1
}

request_successor() {
  # Queue a fresh run BEFORE standing down, so exiting early can never open a capture
  # gap. The concurrency group holds it pending until this job ends, then starts it on
  # a clean checkout. Without this the loop would exit and wait for a delivered cron
  # slot — and Actions delivers ~27% of an hourly schedule, so "restarts shortly" could
  # mean 2h40m of no captures. Requires `actions: write` on the job.
  [ -n "${GITHUB_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ] || return 1
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/workflows/odds-now.yml/dispatches" \
    -d "{\"ref\":\"${GITHUB_REF_NAME:-main}\"}" 2>/dev/null) || return 1
  [ "$code" = "204" ]
}

record_cadence() {
  # The whole reason for this loop is that the CONFIGURED cadence was not the
  # DELIVERED one. So the loop records what it actually did, in the repo, and
  # the delivered rate is read off that rather than off the cron expression.
  # Rolling window, capped — this file must never become a payload problem.
  python3 - "$CADENCE_FILE" "$RUN_TAG" "$ITER" "$1" "$2" <<'PY'
import json, os, sys
from datetime import datetime, timezone
path, run, it, mode, outcome = sys.argv[1:6]
try:
    store = json.load(open(path))
    assert isinstance(store.get('ticks'), list)
except Exception:
    store = {'schema': 'odds-capture-cadence/1', 'ticks': []}
store['ticks'].append({'at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                       'run': run, 'iter': int(it), 'mode': mode, 'outcome': outcome})
store['ticks'] = store['ticks'][-400:]          # ~4 days at 96/day
# Gaps are measured over CAPTURE ticks only.
#
# CORRECTED 2026-09-11 (clean-context review). The original reasoning here was that a
# 'redo' tick is the same iteration replayed seconds later, so counting it would insert
# a ~0-min gap and flatter the median. That is backwards, because of what happens in
# between: on a push race ci-commit-push.sh does `git reset --hard FETCH_HEAD`, which
# reverts THIS FILE to origin/main's copy — and the 'captured' tick written moments
# earlier existed only in the local commit that was just discarded. So the raced
# iteration contributes NO tick at all, and excluding the replay as well made a slot in
# which a capture genuinely happened read as a 30-minute gap instead of 15. The one
# number this whole exercise exists to produce was being pessimised, not flattered.
#
# The replay is therefore recorded as 'captured' (it is the only surviving tick for that
# iteration, so there is nothing to double-count) with '+redo' in `mode` for the audit
# trail. This filter stays as the backstop for any tick still labelled 'redo'.
# TIGHTENED 2026-09-11 (clean-context review): this was `!= 'redo'`, an ALLOW-BY-DEFAULT
# filter, so any new outcome value counted as a capture. It now counts only 'captured',
# which is what the note below claims to measure. The concrete case: once the free leg is
# stood down for billing, the loop keeps ticking every 15 min with nothing being swept —
# under the old filter those ticks reported a healthy 15.0-min median while zero
# first-appearance captures were happening. A metric that flatters itself in exactly the
# failure mode it exists to surface is worse than no metric.
ts = [t['at'] for t in store['ticks'] if t.get('outcome') == 'captured']
gaps = []
for a, b in zip(ts, ts[1:]):
    try:
        da = datetime.strptime(a, '%Y-%m-%dT%H:%M:%SZ')
        db = datetime.strptime(b, '%Y-%m-%dT%H:%M:%SZ')
        gaps.append((db - da).total_seconds() / 60.0)
    except Exception:
        pass
if gaps:
    gaps_sorted = sorted(gaps)
    store['observed'] = {
        'ticks': len(ts), 'spanHours': round(sum(gaps) / 60.0, 2),
        'medianGapMin': round(gaps_sorted[len(gaps_sorted) // 2], 1),
        'maxGapMin': round(max(gaps), 1),
        'note': 'Measured gap between consecutive captures. Compare against the '
                'configured interval; the difference IS the delivery shortfall.',
    }
json.dump(store, open(path, 'w'), indent=2, sort_keys=True)
print(f"cadence: {len(ts)} tick(s) recorded; "
      f"median gap {store.get('observed', {}).get('medianGapMin', 'n/a')} min, "
      f"max {store.get('observed', {}).get('maxGapMin', 'n/a')} min.")
PY
}

echo "Odds capture loop starting. run=$RUN_TAG interval=${INTERVAL_MIN}m " \
     "metered-every=${METERED_EVERY} window=${LOOP_MINUTES}m " \
     "deadline=$(date -u -d "@$DEADLINE" +%H:%M:%SZ 2>/dev/null || date -u -r "$DEADLINE" +%H:%M:%SZ)"

while [ "$STOPPING" -eq 0 ]; do
  NOW=$(date -u +%s)
  # Stop starting new iterations once the remaining window cannot hold one. An
  # iteration that gets cut in half wastes its API calls for nothing.
  [ $(( DEADLINE - NOW )) -lt $(( INTERVAL_MIN * 60 )) ] && break

  ITER=$(( ITER + 1 ))
  MODE="free"
  echo "--- iteration $ITER at $(date -u +%H:%M:%SZ) ---"

  # FOUNDER RULING 2026-09-11 item 4 — "any spend on a leg guaranteed to cost
  # nothing fails the run loudly". BILLED_RC (9) means the sweep measured a meter
  # delta on a leg that is supposed to be free. That is not a retryable failure:
  # at 96 sweeps/day, retrying is how a monthly cap gets blown while the job stays
  # green. Stand the leg down for the rest of the window and remember to exit
  # non-zero, so the RUN is red rather than carrying an annotation nobody reads.
  # Any OTHER non-zero stays a warning — this leg runs four times an hour and
  # "bet365 has not posted a price yet" must never redden a run.
  if [ "$FREE_BILLED" -eq 0 ]; then
    python3 refresh-odds-history.py --first-appearance
    FRC=$?
    if [ "$FRC" -eq 9 ]; then
      FREE_BILLED=1
      echo "::error::first-appearance sweep BILLED at iteration $ITER. The zero-quota" \
           "leg is stood down for the rest of this window and this run will fail."
    elif [ "$FRC" -ne 0 ]; then
      echo "::warning::first-appearance sweep exited non-zero ($FRC) at iteration $ITER."
    fi
  fi

  # FOUNDER RULING 2026-09-11 item 3 — "Fix the metered re-spend, all three causes.
  # Spend guard, not a lock." METERED_DUE is set in four places here and cleared in
  # one, so the arming logic alone cannot hold a flat-hourly cadence: a REDO re-arm
  # re-buys an already-billed call, every loop restart spends at once, and a failing
  # run retries every 15 minutes even though a 400 bills. The guard is the single
  # place that answers "have we already paid for this hour?", reading an untracked
  # in-job marker (survives `git reset --hard`) and the committed quota history
  # (survives a new runner). It never cancels the leg — it defers it, so METERED_DUE
  # stays armed and the refresh lands as soon as the hour is genuinely up.
  if [ "$METERED_DUE" -eq 1 ]; then
    python3 metered-spend-guard.py
    GRC=$?
    # ONLY rc 10 means SKIP. Every other non-zero — 127 (no python3), 2 (the script is
    # missing, which is what a `git reset --hard` onto a base that predates it leaves
    # behind), 126 — means the guard could not run, and the guard's own contract is to
    # FAIL OPEN. Treating "cannot run" as "already paid" would freeze the NOW price for
    # the rest of the window over a bookkeeping error, which is the exact failure the
    # guard exists to prevent.
    if [ "$GRC" -ne 0 ] && [ "$GRC" -ne 10 ]; then
      echo "::warning::Spend guard could not run (rc $GRC) — allowing the metered leg." \
           "A guard that fails closed freezes the board."
      GRC=0
    fi
    if [ "$GRC" -eq 0 ]; then
      MODE="free+metered"
      if python3 refresh-odds.py; then
        METERED_DUE=0
      else
        # Leave METERED_DUE set so the NOW leg retries at the next 15-minute tick
        # instead of waiting a full hour — but the retry is now BILL-AWARE. The guard
        # lets it through immediately only if refresh-odds.py measured a meter delta
        # of zero (a transport failure that cost nothing); if the failed attempt did
        # bill, or died before it could measure, that attempt WAS the hour's spend and
        # the guard holds the retry. This is the path that would otherwise burn
        # 96 units/day on a persistent 4xx.
        echo "::warning::NOW refresh failed at iteration $ITER — the spend guard decides" \
             "whether the next tick retries or waits out the hour."
      fi
    else
      MODE="free+metered-deferred"
      echo "::notice::Metered NOW leg deferred to a later tick by the spend guard;" \
           "METERED_DUE stays armed."
    fi
  fi

  # Stale-NOW monitor (founder ruling 2026-09-11, 120-minute window). Runs BEFORE the
  # commit so this tick's measurement ships in this tick's commit rather than trailing
  # one behind. It reads the PUBLISHED board over the network — deliberately not the
  # file we just wrote — because capture staleness and publish staleness are different
  # stages and the visitor sees the sum. Costs no oddspapi quota.
  #
  # Known and accepted limit: a monitor living inside the loop cannot report on a loop
  # that is not running. That case is covered from the other end — the supervisor tick
  # restarts a dead loop, and the restart's first iteration measures a board that has
  # been sitting unrefreshed, so the alarm fires then. Late by at most one delivered
  # cron slot, never absent.
  python3 check-now-staleness.py || \
    echo "::warning::Stale-NOW monitor exited non-zero at iteration $ITER."

  # The outcome must describe what actually happened, not what the iteration intended.
  # With the free leg stood down nothing is being swept, and a tick that still claimed
  # 'captured' would hold the delivered-cadence median at a healthy 15.0 min while the
  # capture it measures had stopped entirely.
  OUTCOME="captured"
  [ "$FREE_BILLED" -eq 1 ] && { MODE="stood-down"; OUTCOME="skipped"; }
  record_cadence "$MODE" "$OUTCOME"
  ./ci-commit-push.sh "chore(odds): capture tick ${ITER} (${MODE}) [skip ci]" $STATE_FILES
  RC=$?
  if [ "$RC" -eq 3 ]; then
    # A concurrent writer (scores.yml runs every 10 min and writes matches.json
    # too) beat us to main and the replay conflicted. ci-commit-push has reset
    # us onto origin/main, so recompute from that base. Only the FREE sweep is
    # repeated — re-running the metered one here would spend quota to fix a git
    # race. METERED_DUE is re-armed instead, so the NOW leg lands one tick later.
    echo "::warning::Recomputing iteration $ITER on the new base after a push race."
    [ "$MODE" = "free+metered" ] && METERED_DUE=1
    # Same stand-down as above: once the free leg has been proven to bill, it does
    # not get re-run on a git race either.
    if [ "$FREE_BILLED" -eq 0 ]; then
      # SWEEP_BUDGET_S=0 on the replay. The REDO exists to recover the free CAPTURE that
      # the reset discarded — an unpinned OPEN is unrecoverable — not to redo the NOW
      # refresh, which the next tick does 15 minutes later anyway. A zero budget leaves
      # every UNOPENED fixture swept (they are never cut) and drops the already-open
      # refresh tail, so the replay costs seconds instead of a second full sweep.
      SWEEP_BUDGET_S=0 python3 refresh-odds-history.py --first-appearance
      [ $? -eq 9 ] && FREE_BILLED=1
    fi
    # 'captured', not 'redo': the reset above discarded the tick recorded before the
    # push, so this replay is the ONLY tick this iteration will ever have. Labelling it
    # 'redo' excluded it from the gap population and made a real capture read as a
    # missed slot. '+redo' keeps the race visible in the audit trail.
    record_cadence "${MODE}+redo" "captured"
    ./ci-commit-push.sh "chore(odds): capture tick ${ITER} (recomputed) [skip ci]" $STATE_FILES || \
      echo "::warning::Recomputed iteration $ITER still could not be pushed; next tick will carry it."
  fi

  [ $(( ITER % METERED_EVERY )) -eq 0 ] && METERED_DUE=1

  # FOUNDER RULING 2026-09-11 item 4 — stand down when this checkout goes stale.
  # Everything this iteration captured is already committed and pushed above, so
  # exiting here costs nothing and turns "a shipped fix waits up to 5h30m and may land
  # half-applied as old-driver + new-Python" into "in force within one tick, whole".
  # The successor is REQUESTED FIRST: if it cannot be queued we stay on the old code
  # rather than risk a gap, because a stale-but-running loop beats no loop.
  if driver_moved; then
    if request_successor; then
      echo "::notice::A driver file changed on origin/main since this checkout" \
           "($BOOT_SHA). Everything captured is committed. Standing down at iteration" \
           "$ITER so the queued successor picks up one consistent version."
      break
    else
      echo "::warning::A driver file changed on origin/main since this checkout, but a" \
           "successor run could not be queued (needs GITHUB_TOKEN and actions:write)." \
           "Continuing on the old checkout — a stale loop beats a capture gap."
    fi
  fi

  # Sleep to the next wall-clock INTERVAL_MIN boundary, so ticks land on :00
  # :15 :30 :45 no matter how long the work took. A fixed `sleep 900` would let
  # each iteration's runtime drift the schedule later and later.
  NOW=$(date -u +%s)
  STEP=$(( INTERVAL_MIN * 60 ))
  SLEEP=$(( STEP - NOW % STEP ))
  [ $(( NOW + SLEEP )) -ge "$DEADLINE" ] && break
  echo "Sleeping ${SLEEP}s to the next ${INTERVAL_MIN}-minute boundary."
  # Backgrounded + `wait`, NOT a plain `sleep`. bash defers a trapped signal
  # until the running foreground command finishes, so a plain `sleep 900` would
  # leave a cancelled job sitting on its captures for up to 15 minutes before
  # the flush trap ran — and GitHub hard-kills long before that. `wait` is
  # interruptible, so SIGTERM reaches on_signal immediately.
  sleep "$SLEEP" &
  wait $! || true
done

echo "Odds capture loop finished after $ITER iteration(s). Everything captured was " \
     "committed as it happened; the queued next tick takes over from here."

# Founder ruling 2026-09-11 item 4. The exit code is the ONLY thing that turns the
# run red, and red is the whole point: a zero-quota leg that started billing is a
# cap-burning defect, and it spent nine days as an unread annotation last time.
# Deliberately LAST — everything captured has already been committed and pushed by
# the loop above, so failing here costs no data, only a green tick we have not earned.
if [ "$FREE_BILLED" -eq 1 ]; then
  echo "::error::The first-appearance sweep billed oddspapi quota on a leg that is" \
       "guaranteed free. It was stood down for the rest of this window. Failing the" \
       "run: see the meter delta logged above."
  exit 1
fi
