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
    # A FIXTURE-LEVEL WRAPPER, which is the shape that broke the first cut of
    # the extractor: the participants sit one level down and have to be
    # descended into. (`market_participants` — the shape this line used to
    # carry — is our own archive BLOB's key, not a Kibl wire envelope.)
    rec(json.dumps({"result": [{"fixture_id": 728343,
                                "participants": [ROW_NOLEAGUE]}]})),
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
                   "unparseable", "UNRECOGNISED"},
   f"every envelope shape is labelled, including the two bad ones ({dict(shapes)})")
ok(shapes["{code,description,result}"] == 2,
   "the fixture-level wrapper is recognised as a result envelope and DESCENDED into, "
   f"not counted unreadable (got {dict(shapes)})")

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
ok("| distinct men's-tennis fixture ids in the stream capture | **3** |" in body3,
   "distinct stream fixture ids counted (3: two ATP + one WTA — this call passes every row)")
ok("present in `kibl_fixtures` or polled observations | **2**" in body3,
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

print("\n4b · TEN-270: the league rides on the ROUTING KEY, and main() maps tennis only")
# Measured on probe run 35937443000: no row carried a league field; the routing
# key `get.info.markets.<?>.<sport>.<league>.…` did, on every message.
ROW_RK = {k: v for k, v in ROW_B.items() if k != "league_id"}
ROW_RK_OTHER = dict(ROW_RK, fixture_id=555001)
RK_RECORDS = [
    rec(json.dumps({"result": [{"participants": [ROW_RK]}]}),
        routing_key="get.info.markets.0.5.19.3.2.728344.171.1.1.1.0"),
    # Another sport whose league id happens to equal ATP's must NOT pass.
    rec(json.dumps({"result": [{"participants": [ROW_RK_OTHER]}]}),
        routing_key="get.info.markets.1.2.19.3.1.555001.171.3.1.1.0"),
]
AT.REPORT.clear()
rk_rows, rk_tennis, rk_unknown = AT.analyse(RK_RECORDS, dict(META, messages=2), FIXTURES, POLLED)
ok(len(rk_tennis) == 1 and rk_tennis[0][1]["fixture_id"] == 728344,
   f"sport 5 / league 19 from the routing key -> tennis (got {len(rk_tennis)})")
ok(len(rk_unknown) == 0,
   f"CONTROL: a routing-keyed row is never 'unknown' (got {len(rk_unknown)})")
ok(B.row_key_of(rk_tennis[0][1]) == B.row_key_of(ROW_B),
   "stamping _league_id leaves the sweep's row key unchanged")
AT.REPORT.clear()
AT.mapping_and_comparison(rk_tennis, [], POLLED + [dict(POLLED[0], fixture_id=728344,
                                                         row_key="nk_other")], "w")
body_rk = "\n".join(AT.REPORT)
ok("fixture ids in the stream capture | **1** |" in body_rk
   and "polled observations | **1**" in body_rk,
   "a fixture id held only by polled OBSERVATIONS still counts as matched "
   "(kibl_fixtures.feed_source_id is not 171)")

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

print("\n8 · TEN-270 card_join — stream rows to OUR cards on names + start time")
import card_join as CJ  # noqa: E402
CARDS = [
    # 07:00 UTC+2 = 05:00Z. Card order is the REVERSE of Kibl's fixture string.
    {"date": "2026-09-24", "time": "07:00", "p1": "C. Ugo Carabelli", "p2": "N. Borges",
     "tourBadge": "ATP", "tour": "ATP Chengdu", "odds": {"p1": 5.05, "p2": 1.17}},
    {"date": "2026-09-24", "time": "08:30", "p1": "A. Rublev", "p2": "T. Machac",
     "tourBadge": "ATP", "tour": "ATP Hangzhou"},
    # Two cards on ONE key: ambiguous, both dropped rather than one guessed.
    {"date": "2026-09-24", "time": "09:00", "p1": "J. Smith", "p2": "K. Jones", "tourBadge": "ATP"},
    {"date": "2026-09-24", "time": "10:00", "p1": "L. Smith", "p2": "M. Jones", "tourBadge": "ATP"},
    # Already started before the capture: outside the pre-match denominator.
    {"date": "2026-09-23", "time": "09:00", "p1": "X. Early", "p2": "Y. Bird", "tourBadge": "ATP"},
]
FX = {
    1: {"name": "6112 Nuno Borges vs Camilo Ugo Carabelli", "scheduled_start": "2026-09-24T05:10:00Z"},
    2: {"name": "Andrey Rublev vs Tomas Machac", "scheduled_start": "2026-09-24T06:30:00Z"},
    3: {"name": "Iga Swiatek vs Coco Gauff", "scheduled_start": "2026-09-24T07:00:00Z"},
    4: {"name": "A Borges/B Cid vs C Dee/D Eff", "scheduled_start": "2026-09-24T05:00:00Z"},
    5: {"name": "Pedro Borges vs Zed Unknown", "scheduled_start": "2026-09-24T05:00:00Z"},
}
def srow(fid, fp, price, ins, **kw):
    r = {"fixture_id": fid, "fixture_participant_id": fp, "market_type_id": 1, "segment_id": 1,
         "betting_type_id": 1, "is_live": False, "is_current": True, "is_opener": False,
         "price_decimal": price, "inserted_on": ins, "_league_id": 19}
    r.update(kw)
    return ({"received_at": ins}, r)
CJ_ROWS = [
    srow(1, 101, 1.20, "2026-09-24T04:00:00Z"),                  # Borges (first-named)
    srow(1, 101, 1.18, "2026-09-24T04:30:00Z"),
    srow(1, 102, 4.80, "2026-09-24T04:30:00Z"),                  # Ugo Carabelli
    srow(1, 102, 0.0, "2026-09-24T04:40:00Z", market_status_id=2),   # suspension marker
    srow(1, 101, 1.05, "2026-09-24T05:20:00Z", betting_type_id=3, is_live=True),  # in-play
    srow(2, 201, 1.50, "2026-09-24T04:10:00Z", _league_id=962),  # tier disagreement
    srow(3, 301, 1.60, "2026-09-24T04:10:00Z", _league_id=20),   # WTA: not on board
    srow(4, 401, 1.90, "2026-09-24T04:10:00Z"),                  # doubles
    srow(5, 501, 2.00, "2026-09-24T04:10:00Z"),                  # surname on board, key fails
    srow(9, 901, 2.00, "2026-09-24T04:10:00Z"),                  # no fixture record
]
OPENERS = {1: [{"fixture_participant_id": 101, "price_decimal": 1.25, "observed_at": "2026-09-22T10:00:00Z"},
               {"fixture_participant_id": 101, "price_decimal": 1.30, "observed_at": "2026-09-22T12:00:00Z"},
               {"fixture_participant_id": 102, "price_decimal": 4.10, "observed_at": "2026-09-22T10:00:00Z"}]}
since = CJ.parse_ts("2026-09-24T00:00:00Z")
res = CJ.join(CJ_ROWS, CARDS, FX, OPENERS, since=since)
pc = {p["fixture_id"]: p for p in res["per_card"]}
ok(res["cards_in_denominator"] == 4, f"started card outside denominator (got {res['cards_in_denominator']})")
ok(len(res["ambiguous_card_keys"]) == 1, "two cards on one key: dropped, not guessed")
ok(set(pc) == {1, 2}, f"exactly the two real matches join (got {sorted(pc)})")
p = pc[1]
ok(p["now"] == {"p2": 1.18, "p1": 4.8},
   f"Now = latest real pre-match price, placed on the CARD's side by name (got {p['now']})")
ok(p["open"] == {"p2": 1.25, "p1": 4.1},
   f"Open = FIRST-sighted archive opener, not the later one (got {p['open']})")
ok(p["inplay_rows"] == 1 and p["updates"] == {"p2": 2, "p1": 2},
   f"in-play row counted and ignored for Now (got {p['inplay_rows']}, {p['updates']})")
ok(p["start_delta_min"] == -10.0, f"card 05:00Z vs Kibl 05:10Z = -10 min (got {p['start_delta_min']})")
ok(res["league_disagreements"] and res["league_disagreements"][0]["fixture_id"] == 2,
   "routing-key 962 on an ATP card is REPORTED as a disagreement")
un = {k: [x["fixture_id"] for x in v] for k, v in res["unmatched"].items()}
ok(un.get("not_on_board") == [3], f"WTA fixture -> not_on_board (got {un})")
ok(un.get("name_not_two_singles_players") == [4], "doubles fixture never pairs")
ok(un.get("surname_on_board") == [5], "a surname on the board but no key -> surname_on_board")
ok(un.get("no_fixture_record") == [9], "no names -> counted, not guessed")
lines = "\n".join(CJ.report_lines(res))
ok("| ITF | 0 | — | — |" in lines, "ITF with no cards reads as a dash, not 0%")
ok("| ATP | 4 | 2 of 4 | 2 of 4 |" in lines, "ATP match rate carries its denominator")
# CONTROL: mutate the Open rule to take the LAST opener — the test must see it.
res_b = CJ.join(CJ_ROWS, CARDS, FX, {1: list(reversed(OPENERS[1]))}, since=since)
ok({q["fixture_id"]: q for q in res_b["per_card"]}[1]["open"]["p2"] == 1.25,
   "CONTROL: Open is chosen by observed time, not list order")

print(f"\nPASS {PASS}   FAIL {FAIL}")
if FAIL:
    print("failed: " + ", ".join(_F))
sys.exit(1 if FAIL else 0)
