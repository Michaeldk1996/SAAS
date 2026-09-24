#!/usr/bin/env python3
"""TEN-270 — offline tests for the Now worker's decisions (NowEngine). No broker,
no database, no network. Each rule is pinned by a case that fails if it breaks."""
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import now_worker as W  # noqa: E402

PASS = FAIL = 0
_F = []


def ok(cond, name):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        _F.append(name)
        print(f"  FAIL {name}")


NOW = datetime(2026, 9, 24, 4, 0, tzinfo=timezone.utc)
CARDS = [
    {"date": "2026-09-24", "time": "07:00", "p1": "C. Ugo Carabelli", "p2": "N. Borges", "tourBadge": "ATP"},
    {"date": "2026-09-24", "time": "08:30", "p1": "A. Rublev", "p2": "T. Machac", "tourBadge": "ATP"},
]
FX = {1: {"name": "Nuno Borges vs Camilo Ugo Carabelli", "scheduled_start": "2026-09-24T02:00:00Z"},
      2: {"name": "Andrey Rublev vs Tomas Machac", "scheduled_start": "2026-09-24T06:30:00Z"}}


def row(fid, fp, price, ins, **kw):
    r = {"fixture_id": fid, "fixture_participant_id": fp, "market_type_id": 1, "segment_id": 1,
         "betting_type_id": 1, "is_live": False, "is_current": True, "is_opener": False,
         "price_decimal": price, "inserted_on": ins, "feed_source_id": 171, "market_id": 9,
         "uuid": None, "side_id": 2 if fp % 2 else 3, "point": 0.0, "alt_id": 0,
         "is_previous": False, "price_american": 100}
    r.update(kw)
    return r


def eng():
    e = W.NowEngine("bet105", "Bet105", 171)
    e.set_fixtures(FX)
    e.set_cards(CARDS, NOW)
    return e


print("\n1 · join and sides")
e = eng()
ok(set(e.by_fixture) == {1, 2}, "both cards join under ruling 1 (fixture 1 listed 5 h early)")
w = e.accept(row(1, 101, 1.20, "2026-09-24T03:00:00Z"), "r")
ok(w == [] and e.count["held_side_unplaced"] == 1,
   "one side seen: HELD, not guessed (Kibl's side order needs both participant ids)")
w = e.accept(row(1, 102, 4.80, "2026-09-24T03:00:01Z"), "r")
now = {r["side_key"]: r["price"] for k, r in w if k == "now"}
ok(now == {"borges": 1.20, "carabelli": 4.80},
   f"both sides written, keyed by SURNAME, placed by name not position (got {now})")
ok(all(r["card_key"] == "2026-09-24|borges|carabelli" for _, r in w),
   "card_key is the page's ocsKeyOf key")
ok(all(r["book"] == "bet105" and r["book_name"] == "Bet105" for _, r in w),
   "every write names the book")

print("\n2 · newer-only Now, full history")
w = e.accept(row(1, 101, 1.15, "2026-09-24T03:10:00Z"), "r")
ok([k for k, _ in w] == ["hist", "now"], "a newer price moves Now and is kept in history")
w = e.accept(row(1, 101, 1.30, "2026-09-24T02:00:00Z", market_id=8), "r", source="seed")
ok([k for k, _ in w] == ["hist"],
   "an OLDER price (e.g. a seed racing a stream change) is history only; Now does not move back")

print("\n3 · pre-match only, real prices only, one book")
for name, r, reason in (
        ("in-play row", row(1, 101, 1.05, "2026-09-24T03:20:00Z", betting_type_id=3, is_live=True), "skip_inplay"),
        ("is_live true on a bt-1 row", row(1, 101, 1.05, "2026-09-24T03:20:00Z", is_live=True), "skip_inplay"),
        ("set-winner (segment 2)", row(1, 101, 1.05, "2026-09-24T03:20:00Z", segment_id=2), "skip_not_match_winner"),
        ("0.000 suspension marker", row(1, 101, 0.0, "2026-09-24T03:20:00Z"), "skip_not_a_price"),
        ("another book", row(1, 101, 1.05, "2026-09-24T03:20:00Z", feed_source_id=43), "skip_other_book"),
        ("unmatched fixture", row(99, 991, 1.05, "2026-09-24T03:20:00Z"), "drop_unmatched")):
    before = e.count[reason]
    ok(e.accept(r, "r") == [] and e.count[reason] == before + 1, f"{name} -> dropped and counted as {reason}")

print("\n4 · Closing point")
live = [dict(CARDS[0], live=True), CARDS[1]]
e.set_cards(live, NOW)
ok(e.accept(row(1, 101, 1.10, "2026-09-24T05:10:00Z"), "r") == []
   and e.count["skip_past_closing_point"] >= 1,
   "once our board marks the card live, Now stops updating")
e.set_cards(CARDS, NOW)
ok(e.accept(row(1, 101, 1.10, "2026-09-24T05:11:00Z"), "r") == [],
   "and stays stopped even if a later board refresh drops the flag")
e2 = eng()
late = datetime(2026, 9, 24, 7, 30, tzinfo=timezone.utc)   # past the 07:00 UTC+2 slot
e2.set_cards(CARDS, late)
ok(1 in e2.by_fixture,
   "the SCHEDULED time is not the Closing point — a card past its slot but not live keeps updating")

print("\n4b · review fixes")
e3 = eng()
e3.accept(row(1, 101, 1.20, "2026-09-24T03:00:00Z"), "r"); e3.accept(row(1, 102, 4.8, "2026-09-24T03:00:00Z"), "r")
before = e3.count["skip_not_current"]
ok(e3.accept(row(1, 101, 1.50, "2026-09-24T03:30:00Z", is_current=False, is_previous=True), "r") == []
   and e3.count["skip_not_current"] == before + 1, "a superseded (is_current false) row is never a Now")
w1 = e3.accept(row(1, 101, 1.19, "2026-09-24T03:31:00Z", market_id=11), "r")
w2 = e3.accept(row(1, 101, 1.17, "2026-09-24T03:32:00Z", market_id=12), "r")
nowr, histr = W.dedupe(w1 + w2 + w2)
ok(len(nowr) == 1 and nowr[0]["price"] == 1.17 and len(histr) == 2,
   f"one batch -> one Now row per side (newest) and history deduped by row_key (got {len(nowr)}, {len(histr)})")
newest = [r for k, r in w2 if k == "now"][0]
older = [r for k, r in w1 if k == "now"][0]
ok(e3.still_latest(newest) and not e3.still_latest(older),
   "a failed write is retried only while it is still the newest for its side")
ok(len(W.dedupe([("now", dict(newest, kibl_inserted_on="2026-09-24T10:00:00Z")),
                 ("now", dict(newest, kibl_inserted_on="2026-09-24T10:00:00.500000Z", price=1.33))])[0]) == 1
   and W.dedupe([("now", dict(newest, kibl_inserted_on="2026-09-24T10:00:00Z")),
                 ("now", dict(newest, kibl_inserted_on="2026-09-24T10:00:00.500000Z", price=1.33))])[0][0]["price"] == 1.33,
   "dedupe compares parsed times: 10:00:00.5 beats 10:00:00 (as text it would not)")
calls = []
C_real = W.C.sb_request
W.C.sb_request = lambda *a, **k: (calls.append(1) or (503, "down"))
failed = W.flush({"SUPABASE_URL": "x", "SUPABASE_SECRET_KEY": "y"}, w2, lambda *_: None, True, e3)
W.C.sb_request = C_real
ok(len(failed) == 2 and e3.write_ok is False and e3.heartbeat(NOW, True)["note"]["write_ok"] is False,
   "a failed write is returned for retry and the heartbeat says writes are not landing")

print("\n4c · secrets survive transport")
import base64
nasty = 'p@ss"w#rd$%!\\ \'q=1'
envx = {"KIBL_PASSWORD_B64": base64.b64encode(nasty.encode()).decode(), "KIBL_PASSWORD": "mangled", "OTHER": "x"}
ok(W.decode_b64_env(envx) == ["KIBL_PASSWORD"] and envx["KIBL_PASSWORD"] == nasty,
   "NAME_B64 decodes over a mangled NAME, byte for byte, with quotes/#/$/%/!/backslash/=")
envy = {"KIBL_USERNAME_B64": "!!not base64!!", "KIBL_USERNAME": "stale", "FOO_B64": base64.b64encode(b"x").decode(), "FOO": "keep"}
ok(W.decode_b64_env(envy) == [] and W.decode_b64_env.failed == ["KIBL_USERNAME"] and envy["FOO"] == "keep",
   "an undecodable value is reported by NAME, and an unrelated FOO_B64 never overwrites FOO")
ok(W.broker_rtt_ms("127.0.0.1", "not-a-port", 1) is None, "a bad port is a dash, not a crash")

print("\n5 · heartbeat")
hb = e.heartbeat(NOW, True)
ok(hb["kind"] == "heartbeat" and hb["price"] is None and hb["card_key"] == "__stream__",
   "heartbeat is a non-price row the page filters out of Realtime")

print(f"\nPASS {PASS}   FAIL {FAIL}")
if FAIL:
    print("failed: " + ", ".join(_F))
sys.exit(1 if FAIL else 0)
