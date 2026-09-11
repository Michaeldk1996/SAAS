#!/usr/bin/env python3
"""The metered spend guard — TEN-179 item 3, founder authorised 2026-09-11.

    python3 metered-spend-guard.py            # exit 0 = ALLOW, exit 10 = SKIP

THE PROBLEM IT SOLVES

The founder saw three metered runs inside one hour against an approved flat-hourly
cadence. That was not one bug. `METERED_DUE` is set in FOUR places in
odds-capture-loop.sh and cleared in exactly ONE (a successful refresh-odds.py), and
three of the four are defects:

  1. The REDO re-arm. On a push race the metered call ALREADY SUCCEEDED and ALREADY
     BILLED — what failed was `git push`. ci-commit-push.sh then does
     `git reset --hard FETCH_HEAD`, discarding the paid-for result, and the next tick
     re-buys it 15 minutes later.
  2. Every loop restart spends immediately (`METERED_DUE=1` at init). The concurrency
     group keeps a pending successor that starts the instant the current loop ends, so
     a restart 5 minutes after the last metered run spends again at once.
  3. The retry is not bill-aware, and this is the worst one. A non-zero refresh-odds.py
     leaves METERED_DUE set, so it retries every 15 minutes — but A 400 BILLS (measured:
     meter 182 -> 183 -> 184 across two 400s). A persistent 4xx therefore bills
     4x/hour = 96 units/day, quietly, against a 5,000/month cap.

WHY A GUARD AND NOT A LOCK

There is nothing to lock against: the `bsp-odds-now` concurrency group already
guarantees exactly one running loop. The defect is that the loop FORGETS WHAT IT HAS
ALREADY PAID FOR, across two different kinds of reset. So it is made to remember.

TWO STORES, BECAUSE THERE ARE TWO RESETS

  (a) .metered-spend-marker — UNTRACKED. `git reset --hard` does not touch untracked
      files, so it survives the REDO path. Covers cause 1, and carries the measured
      meter delta, which is what makes cause 3's retry bill-aware.
  (b) odds-quota-history.json — COMMITTED, and already stamps {at, used} per run. A
      fresh runner has no marker but does have this. Covers cause 2. Only samples
      tagged `by: 'metered-now'` count; refresh-odds-history.py's 3-hourly main()
      writes into the same file and must not suppress an hourly leg that never ran.

The floor is `max(a, b)`, so the guard is right on every combination of the two.

BILL-AWARE RETRY

A completed attempt whose measured delta is ZERO cost nothing — a transport failure,
a DNS blip, a timeout before the first request. That retries IMMEDIATELY; holding it
for an hour would be the opposite failure. Anything else — an attempt still marked
`attempted` (the process died before it could measure), or a measured delta above zero
— is treated as this hour's spend.

FAIL OPEN, DELIBERATELY

Every unreadable or absent store means ALLOW. A guard that fails closed turns a
corrupt JSON file into a silently-frozen NOW price, which is the failure this whole
workstream exists to end. The conservative direction here is toward capturing, not
toward saving a unit — the cost of one extra unit is 1/5000 of a month; the cost of a
frozen board is the product.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
MARKER = os.path.join(HERE, '.metered-spend-marker')
QUOTA_HISTORY = os.path.join(HERE, 'odds-quota-history.json')

# 55, not 60. The loop ticks on 15-minute wall-clock boundaries, so consecutive
# metered legs land 60 minutes apart to the second and a 60-minute gate would race
# its own scheduler and defer every other hour. 55 leaves 5 minutes of slack and
# still makes 4x/hour impossible.
MIN_GAP_MIN = float(os.environ.get('METERED_MIN_GAP_MIN', '55'))

SKIP_RC = 10        # outside bash's signal range and outside ci-commit-push's 0/1/3


def _parse(ts):
    if not isinstance(ts, str) or not ts:
        return None
    try:
        d = datetime.fromisoformat(ts.replace('Z', '+00:00'))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _from_marker():
    """(instant, why) of the last attempt that must count as a spend, or (None, why)."""
    try:
        rec = json.load(open(MARKER))
    except FileNotFoundError:
        return None, 'no in-job marker'
    except Exception as e:
        return None, f'marker unreadable ({e})'

    at = _parse(rec.get('at'))
    if at is None:
        return None, 'marker carries no usable timestamp'

    status, delta = rec.get('status'), rec.get('delta')
    if status != 'complete':
        return at, 'in-job marker: an attempt whose outcome was never measured (a 400 bills)'
    if not isinstance(delta, int):
        return at, 'in-job marker: completed, meter delta unreadable'
    if delta <= 0:
        return None, (f'in-job marker: last attempt measured {delta} unit(s) — it cost '
                      f'nothing, so a retry is free')
    return at, f'in-job marker: last attempt billed {delta} unit(s)'


def _from_quota_history():
    try:
        hist = json.load(open(QUOTA_HISTORY))
        samples = hist.get('samples') or []
    except Exception as e:
        return None, f'quota history unreadable ({e})'
    mine = [s for s in samples if s.get('by') == 'metered-now' and _parse(s.get('at'))]
    if not mine:
        return None, 'quota history holds no tagged metered-now sample yet'
    at = max(_parse(s['at']) for s in mine)
    return at, 'committed quota history: last tagged metered-now reading'


def main():
    now = datetime.now(timezone.utc)
    marker_at, marker_why = _from_marker()
    hist_at, hist_why = _from_quota_history()

    candidates = [(t, w) for t, w in ((marker_at, marker_why), (hist_at, hist_why)) if t]
    if not candidates:
        print(f'Spend guard: ALLOW — no record of a recent metered spend '
              f'({marker_why}; {hist_why}).')
        return 0

    last_at, why = max(candidates, key=lambda c: c[0])
    elapsed_min = (now - last_at).total_seconds() / 60.0
    if elapsed_min >= MIN_GAP_MIN:
        print(f'Spend guard: ALLOW — {elapsed_min:.1f} min since the last metered spend '
              f'({why}, {last_at.strftime("%H:%M:%SZ")}); floor is {MIN_GAP_MIN:.0f} min.')
        return 0

    due_at = last_at + timedelta(minutes=MIN_GAP_MIN)
    print(f'::notice::Spend guard: SKIP — only {elapsed_min:.1f} min since the last '
          f'metered spend ({why}, {last_at.strftime("%H:%M:%SZ")}). Flat-hourly is the '
          f'approved cadence; the NOW leg stays armed and runs at '
          f'{due_at.strftime("%H:%M:%SZ")}.')
    return SKIP_RC


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:                       # fail OPEN — see the module docstring
        print(f'::warning::Spend guard failed ({e}) — allowing the metered leg. A guard '
              f'that fails closed freezes the board over a bookkeeping error.')
        sys.exit(0)
