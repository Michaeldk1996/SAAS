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


print("1. the three-state read issues both is_current values explicitly")
cur = [{"participants": [row("c1", is_current=True)]}]
old = [{"participants": [row("o1", is_opener=True), row("p1", is_previous=True)]}]
fc = FakeClient([cur, old])
rows, metas = fc.markets_three_state(league_id="19")
flags = [p.get("is_current") for _, p in fc.seen]
check("two calls issued", len(fc.seen) == 2, fc.seen)
check("both flag values sent explicitly", set(flags) == {"true", "false"}, flags)
check("flag serialised lowercase, not Python-cased",
      all(f in ("true", "false") for f in flags), flags)
check("all three states merged", len(rows) == 3, len(rows))
check("states labelled",
      sorted(state_of(r) for r in rows) == ["current", "opener", "previous"],
      sorted(state_of(r) for r in rows))

print("2. a default (single-call) read loses the opener and previous — the trap")
single = FakeClient([cur])
payload, _ = single.get("/info/markets", {"league_id": "19"})
only_current = single.market_participants(payload)
check("default read returns 1 of the 3 states", len(only_current) == 1, len(only_current))
check("the merge strictly dominates it", len(rows) > len(only_current))

print("3. duplicate rows across the two calls collapse, distinct rows do not")
dupe = FakeClient([[{"participants": [row("x", is_current=True)]}],
                   [{"participants": [row("x", is_current=True)]}]])
r2, _ = dupe.markets_three_state(league_id="19")
check("same uuid seen twice counts once", len(r2) == 1, len(r2))

nouuid_a = row(None, is_current=True); nouuid_a.pop("uuid")
nouuid_b = row(None, is_opener=True, inserted_on="2026-09-17T00:00:00Z"); nouuid_b.pop("uuid")
nokey = FakeClient([[{"participants": [nouuid_a]}], [{"participants": [nouuid_b]}]])
r3, _ = nokey.markets_three_state(league_id="19")
check("rows without a uuid fall back to the natural key, not collapsed",
      len(r3) == 2, len(r3))

print("4. envelope shapes")
check("bare list", len(KiblClient.rows([1, 2, 3])) == 3)
check("dict wrapping under data", len(KiblClient.rows({"data": [1, 2]})) == 2)
check("None is empty, not an error", KiblClient.rows(None) == [])
check("flat participant rows pass through",
      len(KiblClient.market_participants([{"market_type_id": 1}])) == 1)
check("nested participants flattened",
      len(KiblClient.market_participants([{"participants": [{"a": 1}, {"b": 2}]}])) == 2)

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

print()
if FAILS:
    print(f"FAILED {len(FAILS)}: {FAILS}")
    sys.exit(1)
print("all offline tests passed")
