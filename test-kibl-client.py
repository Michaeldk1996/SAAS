#!/usr/bin/env python3
"""Offline tests for kibl_client — run before anything touches the network.

These lock the three properties whose failure is SILENT, i.e. produces a
plausible number rather than an error:

  1. `is_current` defaults true server-side, so the three-state read must issue
     two calls with the flag set explicitly both ways. A single call, or a call
     that lets the flag default, silently archives the current price only.
  2. Python's str(True) is "True"; the API parses "true". A boolean serialised
     wrong is not rejected — it is ignored, and the call returns the default.
  3. Rows arriving in a different envelope must not read as "zero markets".

No credentials, no network.
"""

import sys
import kibl_client
from kibl_client import KiblClient, state_of, decode_jwt_claims, redact_claims

FAILS = []


def check(name, cond, detail=""):
    if cond:
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name} {detail}")
        FAILS.append(name)


class FakeClient(KiblClient):
    """A client whose only real behaviour is the query-shaping under test."""

    def __init__(self, responses):
        self.responses = responses
        self.seen = []
        self.calls = 0
        self.bytes_down = 0
        self.call_log = []
        self.id_claims = {}
        self.access_claims = {}

    def get(self, path, params=None, retries=3):
        params = {k: v for k, v in (params or {}).items() if v is not None}
        for k, v in list(params.items()):
            if isinstance(v, bool):
                params[k] = "true" if v else "false"
        self.seen.append((path, dict(params)))
        self.calls += 1
        payload = self.responses.pop(0) if self.responses else []
        meta = {"path": path, "params": dict(params), "status": 200,
                "bytes": 0, "seconds": 0, "rate_headers": {}}
        self.call_log.append(meta)
        return payload, meta


def row(uid, **kw):
    base = {"uuid": uid, "market_id": 1, "fixture_participant_id": 1,
            "market_type_id": 1, "segment_id": 1, "side_id": 1, "point": 0,
            "alt_id": 0, "is_opener": False, "is_previous": False,
            "is_current": False, "inserted_on": "2026-09-18T00:00:00Z"}
    base.update(kw)
    return base


print("0. /info/markets refuses to be called without feed_source_id")
# MEASURED: without feed_source_id the live API answers HTTP 200 with no
# `result` key and the text "minimum of 1 feed_source_id needed". That reads as
# "this account has no odds at all" — it is the single most expensive way this
# integration can fail silently, so the client refuses to issue the call.
guard = FakeClient([[]])
try:
    guard.markets(league_id="19")
    check("bare markets() call rejected", False, "no ValueError raised")
except ValueError as e:
    check("bare markets() call rejected", "feed_source_id" in str(e))
try:
    guard.markets_all_states(league_id="19")
    check("three-state call rejected too", False, "no ValueError raised")
except ValueError:
    check("three-state call rejected too", True)
check("no call was issued for either", guard.calls == 0, guard.calls)
ok_guard = FakeClient([[], []])
ok_guard.markets_all_states(league_id="19", feed_source_id=43)
check("with feed_source_id it proceeds", ok_guard.calls == 2, ok_guard.calls)
check("feed_source_id reaches the wire",
      all(p.get("feed_source_id") == 43 for _, p in ok_guard.seen), ok_guard.seen)

print("1. the all-states read pulls on the is_opener axis, NOT the is_current axis")
# MEASURED by comparing row SETS, not counts — the counts are identical under
# contradictory filters, so counting cannot tell these apart:
#   unfiltered      -> current prices (+ openers for lines that have not moved)
#   is_opener=true  -> opening prices; 78 of 108 rows DIFFER from unfiltered
#   is_current true == is_current false, jaccard 1.0 -> the flag does nothing
# An earlier version of this client merged is_current=true with is_current=false.
# That pulls the SAME rows twice and never retrieves a single opener — a
# full-looking archive with no opening prices in it.
cur = [{"participants": [row("c1", is_current=True)]}]
opn = [{"participants": [row("o1", is_opener=True)]}]
fc = FakeClient([cur, opn])
rows, metas = fc.markets_all_states(league_id="19", feed_source_id=43)
sent = [p for _, p in fc.seen]
check("two calls issued", len(sent) == 2, sent)
check("first call is unfiltered by state",
      "is_opener" not in sent[0] and "is_current" not in sent[0], sent[0])
check("second call sets is_opener", sent[1].get("is_opener") == "true", sent[1])
check("is_current is NEVER sent — it does nothing and implies a false model",
      all("is_current" not in p for p in sent), sent)
check("both states merged", len(rows) == 2, len(rows))
check("states labelled",
      sorted(state_of(r) for r in rows) == ["current", "opener"],
      sorted(state_of(r) for r in rows))

print("2. a single unfiltered read cannot see the opener — that is the real trap")
single = FakeClient([cur])
payload, _ = single.get("/info/markets", {"league_id": "19"})
only_current = single.market_participants(payload)
check("unfiltered read returns the current price only", len(only_current) == 1,
      len(only_current))
check("the merge strictly dominates it", len(rows) > len(only_current))
check("and it contains an opener the single read did not",
      any(state_of(r) == "opener" for r in rows)
      and not any(state_of(r) == "opener" for r in only_current))

print("3. duplicate rows across the two calls collapse, distinct rows do not")
dupe = FakeClient([[{"participants": [row("x", is_current=True)]}],
                   [{"participants": [row("x", is_current=True)]}]])
r2, _ = dupe.markets_all_states(league_id="19", feed_source_id=43)
check("same uuid seen twice counts once", len(r2) == 1, len(r2))

nouuid_a = row(None, is_current=True); nouuid_a.pop("uuid")
nouuid_b = row(None, is_opener=True, inserted_on="2026-09-17T00:00:00Z"); nouuid_b.pop("uuid")
nokey = FakeClient([[{"participants": [nouuid_a]}], [{"participants": [nouuid_b]}]])
r3, _ = nokey.markets_all_states(league_id="19", feed_source_id=43)
check("rows without a uuid fall back to the natural key, not collapsed",
      len(r3) == 2, len(r3))

print("3b. uuid must never act as an override in the dedupe key")
# MEASURED: `uuid` is null on every live row, so a uuid-first key is dead code
# that has never run against real data. The danger is the day Kibl populates it
# PER LINE rather than per observation: a uuid-first key would then be constant
# for that line, the opener would overwrite the current price in the merge, and
# the archive's ignore-duplicates insert would silently discard every later
# price while rows_new read as a quiet market.
from kibl_client import observation_key
same_uuid_current = row("LINE-1", is_current=True, price_american=-120,
                        inserted_on="2026-09-18T10:00:00Z")
same_uuid_opener = row("LINE-1", is_opener=True, price_american=-105,
                       inserted_on="2026-09-18T09:00:00Z")
check("same uuid, different price/state -> DIFFERENT keys",
      observation_key(same_uuid_current) != observation_key(same_uuid_opener))
uu = FakeClient([[{"participants": [same_uuid_current]}],
                 [{"participants": [same_uuid_opener]}]])
r_uu, _ = uu.markets_all_states(league_id="19", feed_source_id=43)
check("so the merge keeps both, not one", len(r_uu) == 2, len(r_uu))
check("a genuinely identical observation still collapses",
      observation_key(dict(same_uuid_current)) == observation_key(same_uuid_current))
# The live shape: uuid null, so the rest of the key does all the work.
live_a = row(None, is_current=True, price_american=-120); live_a["uuid"] = None
live_b = row(None, is_current=True, price_american=-130); live_b["uuid"] = None
check("uuid=null rows keyed by price, not collapsed",
      observation_key(live_a) != observation_key(live_b))

print("4. envelope shapes")
# REGRESSION: the live envelope is {api_key, code, description, request_uuid,
# result: [...], timestamp}. The first live run did not know `result`, wrapped
# the envelope as a single row, and reported n=1 for every reference table and
# zero markets everywhere — a wrong parser that reads exactly like an empty
# account. Both halves are locked: `result` is parsed, and an envelope we do
# NOT recognise returns [] plus a flag, never a bogus row of 1.
live = {"api_key": "get_reference_info_by_genres:sports", "code": 200,
        "description": "api success", "request_uuid": "x", "timestamp": 1,
        "result": [{"sport_id": 5, "name": "Tennis"}, {"sport_id": 1}]}
check("live `result` envelope parsed", len(KiblClient.rows(live)) == 2,
      len(KiblClient.rows(live)))
check("live envelope is not flagged unrecognised",
      KiblClient.unrecognised_envelope(live) is False)
check("bare list", len(KiblClient.rows([1, 2, 3])) == 3)
check("dict wrapping under data", len(KiblClient.rows({"data": [1, 2]})) == 2)
check("None is empty, not an error", KiblClient.rows(None) == [])
mystery = {"code": 200, "payload_v2": {"rows": [1, 2]}}
check("unknown envelope yields [], NOT [envelope]", KiblClient.rows(mystery) == [],
      KiblClient.rows(mystery))
check("unknown envelope is flagged so it cannot pass as an empty account",
      KiblClient.unrecognised_envelope(mystery) is True)
check("flat participant rows pass through",
      len(KiblClient.market_participants([{"market_type_id": 1, "side_id": 1}])) == 1)
check("nested participants flattened",
      len(KiblClient.market_participants(
          [{"participants": [{"market_type_id": 1, "side_id": 1},
                             {"market_type_id": 1, "side_id": 2}]}])) == 2)
check("participants under the live result envelope",
      len(KiblClient.market_participants(
          {"result": [{"participants": [{"market_type_id": 1, "side_id": 1}]}]})) == 1)
check("fixture -> markets -> participants nesting descended",
      len(KiblClient.market_participants(
          {"result": [{"markets": [{"participants": [
              {"market_type_id": 2, "side_id": 1},
              {"market_type_id": 2, "side_id": 2}]}]}]})) == 2)

print("5. state_of precedence")
check("opener wins over current",
      state_of({"is_opener": True, "is_current": True}) == "opener")
check("previous before current",
      state_of({"is_previous": True, "is_current": True}) == "previous")
check("unflagged is named, not silently dropped",
      state_of({}) == "unflagged")

print("6. credentials are stripped and never echoed")
import os
os.environ["KIBL_TEST_SECRET"] = "  value-with-space \n"
check("trailing newline stripped",
      kibl_client._secret("KIBL_TEST_SECRET") == "value-with-space")
check("published client id used as the default when unset",
      kibl_client._secret("KIBL_NOT_SET_AT_ALL", kibl_client.DEFAULT_CLIENT_ID)
      == kibl_client.DEFAULT_CLIENT_ID)

claims = {"sub": "abc-123", "email": "a@b.c", "custom:league_id": "19,537,962",
          "exp": 123, "long": "x" * 500}
red = redact_claims(claims)
check("PII claims redacted", red["sub"] == "<redacted>" and red["email"] == "<redacted>")
check("entitlement claims preserved verbatim", red["custom:league_id"] == "19,537,962")
check("oversized claim not dumped", "redacted" in red["long"])
check("malformed jwt returns {} rather than raising", decode_jwt_claims("nope") == {})

print("7. documented caps and men's-only scope are encoded, not remembered")
check("league cap 15", kibl_client.MAX_LEAGUE_IDS == 15)
check("feed-source cap 10", kibl_client.MAX_FEED_SOURCE_IDS == 10)
check("men's leagues are ATP/Challenger/ITF-M",
      set(kibl_client.TENNIS_LEAGUES_MEN) == {19, 537, 962})
check("women's leagues held separately and out of archive scope",
      set(kibl_client.TENNIS_LEAGUES_MEN) & set(kibl_client.TENNIS_LEAGUES_WOMEN) == set())
check("pacing is conservative by default", kibl_client.MIN_INTERVAL_S >= 1.0)

print("\nRetry-After (founder item 1, 2026-09-21: 'watch for 429/Retry-After')")
_ra = kibl_client.retry_after_seconds
check("no header -> our own ladder, so a feed that never sends one is unaffected",
      _ra({}, 5.0) == 5.0)
check("a delta-seconds header is honoured", _ra({'retry-after': '30'}, 5.0) == 30.0)
check("a header ASKING US TO COME BACK SOONER does not speed us up",
      _ra({'retry-after': '1'}, 5.0) == 5.0)
check("an HTTP-date form falls back rather than trusting a remote clock",
      _ra({'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT'}, 5.0) == 5.0)
check("garbage falls back", _ra({'retry-after': 'soon'}, 5.0) == 5.0)
check("a hostile value cannot park the job for the window",
      _ra({'retry-after': '99999'}, 5.0) == 120.0)
check("None headers are tolerated", _ra(None, 5.0) == 5.0)
# The header was already being captured into meta['rate_headers'] and never
# read. If that capture ever goes, this parser has nothing to parse.
import inspect as _insp_ra  # noqa: E402
check("the 429 branch actually CALLS the parser — a parser nothing calls is "
      "a comment",
      'retry_after_seconds(hdrs' in _insp_ra.getsource(kibl_client.KiblClient.get))

print()
if FAILS:
    print(f"FAILED {len(FAILS)}: {FAILS}")
    sys.exit(1)
print("all offline tests passed")
