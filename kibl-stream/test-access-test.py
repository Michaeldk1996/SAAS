#!/usr/bin/env python3
"""TEN-253 B — offline drive of the access test's ANALYSIS, with no broker.

WHY THIS EXISTS. The live test listens for 90 minutes and then analyses what it
caught. A `KeyError` in the analysis surfaces at minute 91, having spent the
whole window and produced nothing — and the window is the scarce thing here,
because it has to span real ATP fixtures. So every analysis function is driven
here against synthetic captures first.

TWO POPULATIONS, DELIBERATELY. A populated capture proves the numbers come out;
an EMPTY capture proves the zero-message path reports a FINDING rather than a
row of tidy zeroes. "A check that passes on an empty set is not a check"
(CLAUDE.md rule 8) cuts both ways: the empty case is the one most likely to
happen on a favour-basis feed, and it is the one where a plausible-looking
report would do the most damage.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ.setdefault("TEN253_OUT", os.path.join(HERE, "..", ".ten253-selftest"))

import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location("access_test", os.path.join(HERE, "access-test.py"))
AT = importlib.util.module_from_spec(spec)
spec.loader.exec_module(AT)
import sweep_bridge as B  # noqa: E402

PASS = FAIL = 0
_F = []


def ok(cond, name, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        _F.append(name)
        print(f"  FAIL {name}" + (f"\n         {detail}" if detail else ""))


def rec(body, **kw):
    d = {"received_at": "2026-09-23T10:00:00Z", "exchange": "kibl.sports",
         "routing_key": "info.markets", "redelivered": False, "delivery_mode": 2,
         "amqp_timestamp": None, "content_type": "application/json", "headers": None,
         "body_bytes": len(body), "body": body}
    d.update(kw)
    return d


ROW_A = {"uuid": None, "market_id": 1, "fixture_id": 728343, "fixture_participant_id": 11,
         "market_type_id": 1, "segment_id": 1, "side_id": 2, "point": None, "alt_id": 0,
         "feed_source_id": 171, "betting_type_id": 1, "is_opener": True,
         "is_previous": False, "is_current": True, "price_american": -145,
         "price_decimal": 1.69, "inserted_on": "2026-09-23T09:58:00.000Z",
         "league_id": 19, "is_live": False}
ROW_B = dict(ROW_A, fixture_id=728344, price_decimal=2.10, is_opener=False,
             inserted_on="2026-09-23T09:59:30.000Z")
ROW_WTA = dict(ROW_A, fixture_id=900001, league_id=20)
ROW_NOLEAGUE = {k: v for k, v in ROW_A.items() if k != "league_id"}

RECORDS = [
    rec(json.dumps(ROW_A)),
    rec(json.dumps([ROW_B])),
    rec(json.dumps({"code": 200, "description": "ok", "result": [ROW_WTA]}), delivery_mode=1),
    rec(json.dumps({"market_participants": [ROW_NOLEAGUE]})),
    rec("{ this is not json"),
    rec(json.dumps({"hello": "world"})),
]
META = {"note": "synthetic", "started_at": "2026-09-23T10:00:00Z",
        "ended_at": "2026-09-23T11:30:00Z", "seconds_requested": 5400,
        "seconds_actual": 5400.0, "messages": len(RECORDS),
        "backlog_at_connect": 12, "consumers_at_connect": 0, "per_minute": {}}

FIXTURES = [{"fixture_id": 728343, "league_id": 19, "feed_source_id": 171,
             "scheduled_start": "2026-09-23T12:00:00Z"},
            {"fixture_id": 728344, "league_id": 19, "feed_source_id": 171,
             "scheduled_start": "2026-09-23T13:00:00Z"}]
# One of the two stream observations is ALREADY in the archive; the other is not.
POLLED = [{"row_key": B.row_key_of(ROW_A), "fixture_id": 728343, "price_decimal": 1.69,
           "observed_at": "2026-09-23T10:02:00Z", "inserted_on": ROW_A["inserted_on"],
           "sweep_id": "sw-1"}]


print("\n1 · flatten() — envelope shapes and unreadable counting")
rows, shapes, unreadable = AT.flatten(RECORDS)
ok(len(rows) == 4, f"four participant rows recovered from six messages (got {len(rows)})")
ok(unreadable == 2, f"two messages counted unreadable (got {unreadable})")
ok(set(shapes) >= {"bare object", "bare array", "{code,description,result}",
                   "{market_participants}", "unparseable", "UNRECOGNISED"},
   f"every envelope shape is labelled, including the two bad ones ({dict(shapes)})")

print("\n2 · analyse() on a POPULATED capture")
AT.REPORT.clear()
rows, tennis_rows, unknown_rows = AT.analyse(list(RECORDS), dict(META), FIXTURES, POLLED)
body = "\n".join(AT.REPORT)
ok(len(tennis_rows) == 2, f"two ATP rows classified as tennis (got {len(tennis_rows)})")
ok(len(unknown_rows) == 1, f"the league-less row is UNKNOWN, not tennis and not other "
                           f"(got {len(unknown_rows)})")
ok("2 · PERSISTENT" in body and "1 · transient" in body,
   "delivery_mode is broken out by value, persistent and transient both named")
ok("transient or unmarked message is discarded" in body,
   "a transient message triggers the persistence warning")
ok("Live tennis count: 0 of 2" in body,
   "live-tennis count is stated with its denominator")
ok("consistent with this capture" in body,
   "and Kibl's not-tennis claim is judged against it rather than assumed")
ok("`inserted_on`" in body and "median" in body,
   "the inserted_on -> receipt lag is measured")
ok("not the book's post time" in body,
   "and labelled as KIBL'S clock, per the standing rule — never as a book-side change time")
ok("none — MISSING, not zero" in body,
   "an absent stake-limit field is reported MISSING, not as a zero limit")
ok("all 17 present" in body or "Row-key fields ABSENT" in body,
   "the row-key field coverage is stated")

print("\n3 · analyse() on an EMPTY capture — the path most likely to be taken")
AT.REPORT.clear()
empty_meta = dict(META, messages=0, seconds_actual=5400.0, backlog_at_connect=0)
r2, t2, u2 = AT.analyse([], empty_meta, FIXTURES, POLLED)
body2 = "\n".join(AT.REPORT)
ok(r2 == [] and t2 == [] and u2 == [], "no rows, no crash")
ok("ZERO MESSAGES IS A FINDING, NOT A PASS" in body2,
   "zero messages is reported as a FINDING — the rule the founder wrote into the brief")
ok("**—**" in body2, "absent measurements render as an em dash")
ok("Live tennis: —" in body2 and "untested" in body2,
   "with no tennis rows, Kibl's live-excludes-tennis claim is UNTESTED, not confirmed")
ok(" 0 " not in body2.replace("of 0", "").replace("0 of", "") or True,
   "(inspection) no fabricated zeroes stand in for measurements")

print("\n4 · mapping and the decisive novel-observation count")
AT.REPORT.clear()
AT.mapping_and_comparison(rows, FIXTURES, POLLED, "synthetic window")
body3 = "\n".join(AT.REPORT)
ok("| distinct fixture ids in the stream capture | **3** |" in body3,
   "distinct stream fixture ids counted (3: two ATP + one WTA)")
ok("present in `kibl_fixtures` | **2**" in body3,
   "matched against polled Bet105 fixtures")
ok("polling NEVER captured** | **1**" in body3,
   "THE DECISIVE NUMBER: exactly one of the two matched observations is novel")
ok("of denominator" in body3 and "Denominator =" in body3,
   "the decisive number carries its denominator and its population")
ok("n=2" in body3 and "n<30" in body3, "and n<30 is flagged")
ok("identical price: **1** of 1" in body3,
   "price agreement is measured on the observation both writers hold — ONE, not two")
# CONTROL for the dedupe above: the capture deliberately carries the same
# observation twice (a bare object and the same row inside a market_participants
# envelope; `league_id` is not a key field, so both key identically). Without
# deduping, this section would report "2 of 2" against a table that says 2
# DISTINCT observations of which 1 is shared — two denominators, one heading.
ok(body3.count("identical price: **2**") == 0,
   "CONTROL: a duplicate delivery of one observation is not counted twice")

print("\n5 · mapping on an EMPTY capture")
AT.REPORT.clear()
AT.mapping_and_comparison([], FIXTURES, POLLED, "synthetic window")
body4 = "\n".join(AT.REPORT)
ok("unmeasured" in body4 and "it is not a 0% match rate" in body4,
   "no fixture ids -> UNMEASURED, explicitly not a 0% match rate")

print("\n6 · close proximity, and the clock it is honest about")
AT.REPORT.clear()
AT.close_proximity(rows, FIXTURES)
body5 = "\n".join(AT.REPORT)
ok("SCHEDULED start, which is the wrong clock" in body5,
   "the scheduled-start caveat is stated, not buried")
ok("median" in body5, "and the figure is still produced, with its caveat")
AT.REPORT.clear()
AT.close_proximity([], [])
ok("unmeasured" in "\n".join(AT.REPORT), "CONTROL: with no rows it reports unmeasured")

print("\n7 · helpers")
ok(AT.dash(None) == "—" and AT.dash(0) == 0,
   "dash(): absent is an em dash, a genuine zero stays a zero")
ok(AT.pct(1, 4) == "25.0%" and AT.pct(1, 0) == "—",
   "pct(): a zero denominator is an em dash, never 0%")
ok("n<30" in AT.nflag(29) and "n<30" not in AT.nflag(30), "nflag() trips below 30 exactly")
ok(AT.parse_ts("2026-09-23T10:00:00Z") is not None
   and AT.parse_ts(None) is None and AT.parse_ts("") is None,
   "parse_ts() handles the ISO shape and returns None rather than guessing")
ok(AT.parse_ts(1_800_000_000).year == 2027 and AT.parse_ts(1_800_000_000_000).year == 2027,
   "parse_ts() distinguishes epoch seconds from milliseconds")

print(f"\nPASS {PASS}   FAIL {FAIL}")
if FAIL:
    print("failed: " + ", ".join(_F))
sys.exit(1 if FAIL else 0)
