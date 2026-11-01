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


def check(label, ok, detail=""):
    print(f"  {'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        FAILS.append(label)
        if detail:
            print(f"       {detail}")


def with_runs(runs, token="t", me="", started=None):
    """Run the decision against a stubbed run list.

    started: {run id: True | False | None} — what run_started() answers for a
    cancelled run (default True: it ran, then was cancelled).
    """
    os.environ["GITHUB_TOKEN"] = token
    os.environ["GITHUB_RUN_ID"] = me
    real, real_st = sc.recent_conclusions, sc.run_started
    sc.recent_conclusions = lambda _t, limit=10: list(runs)
    sc.run_started = lambda _t, rid: (started or {}).get(rid, True)
    try:
        return sc.breaker_should_trip()
    finally:
        sc.recent_conclusions, sc.run_started = real, real_st


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
# CONTROL: a run that started and was then cancelled, or timed out, is non-zero
# too and must count.
check("a started-then-cancelled run counts as a failure",
      with_runs(rl(("cancelled", "t"), ("timed_out", "t")))[0] is True)

print("2b. a run cancelled while QUEUED never ran and is not judged (pinger task, 29 Oct)")
C = ("cancelled", "2026-10-29T10:00:00Z")
runs = rl(C, C, S, F)          # newest first: two queued cancellations, then a success
trip, why = with_runs(runs, started={100: False, 101: False})
check("this run + two queued cancellations + a success does not trip  "
      "[mutant: cancelled counted as failure]", trip is False, why)
check("and the log names the passed-over runs", "cancelled while queued" in why, why)
trip, why = with_runs(rl(C, F, C, F), started={100: False, 102: False})
check("queued cancellations are passed over, the real failures behind them still trip",
      trip is True, why)
trip, why = with_runs(rl(C, C, S), started={100: None, 101: None})
check("a cancelled run whose jobs are unreadable is not judged (fails safe)",
      trip is False and "jobs unreadable" in why, why)
check("a skipped run is not judged",
      with_runs(rl(("skipped", "t"), ("skipped", "t"), S))[0] is False)

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

print("6. the backoff survives a dropped connection (27 Oct 19:02Z: HTTP 544); it never unschedules")
import io
import json
import urllib.error


class FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def fake_api(answers):
    """urlopen stand-in: pops one answer per call — an int is an HTTP error code, a list is a JSON result."""
    sent = []

    def urlopen(req, timeout=None):
        sent.append(json.loads(req.data.decode())["query"])
        a = answers.pop(0)
        if isinstance(a, int):
            raise urllib.error.HTTPError(req.full_url, a, "x", {}, io.BytesIO(
                b'{"message":"Failed to run sql query: Connection terminated due to connection timeout"}'))
        return FakeResp(json.dumps(a).encode())
    return urlopen, sent


def trip(answers):
    real = sc.urllib.request.urlopen
    sc.urllib.request.urlopen, sent = fake_api(answers)
    sleeps = []
    try:
        try:
            return sc.trip_breaker("ref", "tok", sleep=sleeps.append), sleeps, sent
        except SystemExit:
            return None, sleeps, sent
    finally:
        sc.urllib.request.urlopen = real


msg, sleeps, sent = trip([544, 544, [{"jobname": sc.JOB, "altered": True}], [{"schedule": sc.BACKOFF, "active": True}]])
check("two 544s then success → backed off, and says so  [mutant: attempts=1]",
      msg is not None and "backed off" in msg and len(sleeps) == 2, f"{msg} {sleeps}")
check("it alters by jobid from cron.job, by its own name only, to the backoff cadence",
      "cron.alter_job(j.jobid" in sent[-2] and f"'{sc.JOB}'" in sent[-2] and sc.FOREIGN_JOB not in sent[-2] and sc.BACKOFF in sent[-2])
check("it NEVER unschedules (stage 1: breakers back off + alert)", not any("unschedule" in q for q in sent), sent)
msg, sleeps, sent = trip([[], []])
check("an already-absent pinger is said out loud ('not in cron.job'), no swallowed exception",
      msg is not None and "not in cron.job" in msg, msg)
msg, sleeps, sent = trip([[{"jobname": sc.JOB, "altered": True}], [{"schedule": sc.SCHEDULE, "active": True}]])
check("a schedule that did not change on read-back fails loudly", msg is None)
msg, sleeps, sent = trip([400])
check("an SQL error (400) is not retried", msg is None and sleeps == [], sleeps)
msg, sleeps, sent = trip([544, 544, 544, 544])
check("four 544s in a row give up loudly (non-zero), after 3 waits", msg is None and len(sleeps) == 3, sleeps)
check("the backoff is slower than the floor, never off", sc.BACKOFF == "*/30 * * * *" and sc.BACKOFF != sc.SCHEDULE)

def restore(answers):
    real = sc.urllib.request.urlopen
    sc.urllib.request.urlopen, sent = fake_api(answers)
    try:
        try:
            return sc.restore_cadence("ref", "tok", sleep=lambda s: None), sent
        except SystemExit:
            return "DIED", sent
    finally:
        sc.urllib.request.urlopen = real

line, sent = restore([[{"schedule": sc.BACKOFF}], [{"altered": True}], [{"schedule": sc.SCHEDULE}]])
check("a green run after a backoff restores */5 and says RECOVERED", line and "RECOVERED" in line and sc.SCHEDULE in sent[1], line)
line, sent = restore([[{"schedule": sc.SCHEDULE}]])
check("a pinger already on */5: nothing to do, one read only", line is None and len(sent) == 1, sent)
line, sent = restore([[{"schedule": sc.BACKOFF}], [{"altered": True}], [{"schedule": sc.BACKOFF}]])
check("a restore that did not take fails loudly", line == "DIED", line)
wf = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".github/workflows/ten232-kibl-archive.yml")).read()
check("the workflow alerts the pipeline chat on a trip and restores on a green run",
      "ACTION: breaker" in wf and "ACTION: restore" in wf and "TELEGRAM_PIPELINE_CHAT_ID" in wf)

print()
if FAILS:
    print(f"FAILED {len(FAILS)}: {FAILS}")
    sys.exit(1)
print("all TEN-232 breaker tests passed")
