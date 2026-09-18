#!/usr/bin/env python3
"""Offline tests for the TEN-232 pinger circuit breaker — no network, no secrets.

The breaker unschedules a job that fires 288 times a day, so both of its failure
directions are expensive: trip too easily and the archive stops capturing a feed
that keeps no history; never trip and a broken sweep hammers the API all day.
The run list is stubbed here, so these run the decision and not the HTTP call.
"""

import importlib.util
import os
import sys

spec = importlib.util.spec_from_file_location("sweep_cron", "ten232-kibl-sweep-cron.py")
sc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sc)

FAILS = []


def check(label, ok):
    print(f"  {'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        FAILS.append(label)


def with_runs(runs, token="t", me=""):
    """Run the decision against a stubbed run list."""
    os.environ["GITHUB_TOKEN"] = token
    os.environ["GITHUB_RUN_ID"] = me
    real = sc.recent_conclusions
    sc.recent_conclusions = lambda _t, limit=10: list(runs)
    try:
        return sc.breaker_should_trip()
    finally:
        sc.recent_conclusions = real


F = ("failure", "2026-09-18T05:00:00Z")
S = ("success", "2026-09-18T05:00:00Z")


def rl(*cs, start=100):
    return [(start + i, c, t) for i, (c, t) in enumerate(cs)]


print("1. it trips on exactly three, counting the run that is failing now")
trip, why = with_runs(rl(F, F, F, S))
check("this run + two failed completed runs trips", trip is True)
print("   " + why.replace("\n", "\n   "))

print("2. it does not trip while anything in the window succeeded")
check("this run + one failure + one success does not trip",
      with_runs(rl(F, S, F))[0] is False)
check("this run + two successes does not trip", with_runs(rl(S, S, S))[0] is False)
# CONTROL: a cancelled or timed-out run is non-zero too and must count.
check("cancelled counts as a failure",
      with_runs(rl(("cancelled", "t"), ("timed_out", "t")))[0] is True)

print("3. it fails safe — an unknown answer keeps capturing")
check("no token does not trip", with_runs(rl(F, F, F), token="")[0] is False)


def boom(_t, limit=10):
    raise OSError("api down")


os.environ["GITHUB_TOKEN"] = "t"
real = sc.recent_conclusions
sc.recent_conclusions = boom
try:
    trip, why = sc.breaker_should_trip()
finally:
    sc.recent_conclusions = real
check("an unreadable run list does not trip", trip is False)
check("and it says why", "could not read the run list" in why)
check("too few runs does not trip", with_runs(rl(F))[0] is False)

print("4. the current run is never double-counted")
# The failing run can appear in the completed list on a re-read; counting it
# twice would trip on this run plus ONE other failure.
check("this run's own id is excluded from the fetched list",
      with_runs([(42, "failure", "t"), (7, "success", "t")], me="42")[0] is False)

print("5. the wiring the breaker depends on")
check("it acts on its own job, never TEN-141's",
      sc.JOB == "ten232-kibl-sweep-ping" and sc.FOREIGN_JOB == "ten141-pipeline-ping")
check("its vault secret is its own", sc.SECRET_NAME != sc.FOREIGN_SECRET)
check("the threshold is 3", sc.BREAKER_N == 3)
check("it dispatches the archive workflow", sc.WF == "ten232-kibl-archive.yml")
check("at the 5-minute floor the standing rules set", sc.SCHEDULE == "*/5 * * * *")

print()
if FAILS:
    print(f"FAILED {len(FAILS)}: {FAILS}")
    sys.exit(1)
print("all TEN-232 breaker tests passed")
