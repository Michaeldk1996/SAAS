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

# --- the interrupt contract ---------------------------------------------------
# GitHub sends SIGTERM and then hard-kills. We do not start new API work on the
# way out; we just make sure what is already on disk reaches main.
on_signal() {
  STOPPING=1
  echo "::notice::Signal received at iteration $ITER — flushing captured state before exit."
  ./ci-commit-push.sh "chore(odds): flush capture on interrupt [skip ci]" $STATE_FILES || true
  exit 0
}
trap on_signal TERM INT

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
ts = [t['at'] for t in store['ticks'] if t.get('outcome') != 'redo']
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

  python3 refresh-odds-history.py --first-appearance || \
    echo "::warning::first-appearance sweep exited non-zero at iteration $ITER."

  if [ "$METERED_DUE" -eq 1 ]; then
    MODE="free+metered"
    if python3 refresh-odds.py; then
      METERED_DUE=0
    else
      # Leave METERED_DUE set so the NOW leg retries at the next 15-minute tick
      # instead of waiting a full hour. refresh-odds.py never blind-retries a
      # 4xx itself (a 400 and a 429 both bill), so this is the only retry, and
      # it is paced an interval apart.
      echo "::warning::NOW refresh failed at iteration $ITER — retrying next tick."
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

  record_cadence "$MODE" "captured"
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
    python3 refresh-odds-history.py --first-appearance || true
    # 'captured', not 'redo': the reset above discarded the tick recorded before the
    # push, so this replay is the ONLY tick this iteration will ever have. Labelling it
    # 'redo' excluded it from the gap population and made a real capture read as a
    # missed slot. '+redo' keeps the race visible in the audit trail.
    record_cadence "${MODE}+redo" "captured"
    ./ci-commit-push.sh "chore(odds): capture tick ${ITER} (recomputed) [skip ci]" $STATE_FILES || \
      echo "::warning::Recomputed iteration $ITER still could not be pushed; next tick will carry it."
  fi

  [ $(( ITER % METERED_EVERY )) -eq 0 ] && METERED_DUE=1

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
