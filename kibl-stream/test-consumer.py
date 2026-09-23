#!/usr/bin/env python3
"""TEN-253 A — offline tests for the Python stream consumer.

No broker, no database, no network. Named `test-consumer.py` with a HYPHEN, not
an underscore: tools/test-every-suite-is-wired.js matches `^test-.*\\.(mjs|js|py)$`,
so `test_consumer.py` would be invisible to the guard — a suite the wiring check
cannot see is exactly the hole that check exists to close, and naming it the
other way would have opened a new one while closing the old.

EVERY ASSERTION HERE HAS A CONTROL. A check that passes on an empty set is not a
check (CLAUDE.md rule 8), and the corpus test in particular is the kind that can
pass while testing nothing — so it is mutated, and the mutation must be caught.
"""
import ast
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import consumer as C            # noqa: E402
import sweep_bridge as B        # noqa: E402

PASS = FAIL = 0
_FAILURES = []


def ok(cond, name, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        _FAILURES.append(name)
        print(f"  FAIL {name}" + (f"\n         {detail}" if detail else ""))


def section(t):
    print(f"\n{t}")


# ─────────────────────────────────────────────────────────────────────────────
section("1 · The row key — the stream and the sweep must agree, byte for byte")
# The ruling this port exists to satisfy: import the sweep's function, do not
# reimplement it. So the test is not "do two implementations agree" (they are
# one implementation now) but the stricter, more useful question: does a raw
# BROKER MESSAGE, taken all the way through the stream's message path, land on
# the key the sweep would have written for the same row?
# ─────────────────────────────────────────────────────────────────────────────

corpus_path = os.path.join(HERE, "key-corpus.json")
ok(os.path.exists(corpus_path), "the key corpus exists (generated from the REAL sweep function)",
   f"missing {corpus_path}; run python3 kibl-stream/gen-key-corpus.py")
corpus = json.load(open(corpus_path)) if os.path.exists(corpus_path) else []
ok(len(corpus) == 9, f"the corpus carries its 9 cases (got {len(corpus)})")

agree = disagree = 0
for i, case in enumerate(corpus):
    row = json.loads(case["row_json"])
    # The stream's path: raw message text -> to_summary -> row_key.
    stats = {}
    rows = C.rows_from_message(case["row_json"], "2026-09-23T00:00:00Z", stats)
    # The sweep's path: the same dict -> row_key_of.
    want = B.row_key_of(row)
    got = rows[0]["row_key"] if rows else None
    if got == want:
        agree += 1
    else:
        disagree += 1
        print(f"         case {i}: want {want} got {got}")
ok(disagree == 0 and agree == 9,
   f"all 9 corpus messages key identically through the stream and the sweep ({agree}/9)")

# And the stored corpus key — produced by the real Python function at corpus
# generation time, not by anything running now — still hashes to the same thing.
stored_ok = sum(
    1 for case in corpus
    if B.row_key_of(json.loads(case["row_json"]))
    == "nk_" + hashlib.sha1(case["key"].encode()).hexdigest())
ok(stored_ok == len(corpus),
   f"the stored corpus keys still hash to the live row_key ({stored_ok}/{len(corpus)})")

# ── MUTATION CONTROL ────────────────────────────────────────────────────────
# Without this the block above passes whether or not it is comparing anything.
caught = 0
for case in corpus:
    row = json.loads(case["row_json"])
    mutated = dict(row)
    mutated["price_decimal"] = 9.99 if row.get("price_decimal") != 9.99 else 8.88
    if B.row_key_of(mutated) != B.row_key_of(row):
        caught += 1
ok(caught == len(corpus),
   f"MUTATION CONTROL: changing the price changes the key on every case ({caught}/{len(corpus)})")

# ── THE ONE RESIDUAL KEY RISK, CHARACTERISED RATHER THAN ASSUMED AWAY ───────
# The Python port deletes the LANGUAGE mismatch (str() vs String()). It does NOT
# delete the VENDOR-SHAPE mismatch: Python's json.loads keys an integer lexeme
# `2` and a float lexeme `2.0` to different strings, because str(2) != str(2.0).
# If the REST sweep receives 2.0 and the stream receives 2 for the same price,
# the two writers still produce different keys — and that is a question about
# Kibl's serialiser, which part B answers by comparing captured stream messages
# against captured REST rows. Pinned here so that if someone later "fixes" it by
# coercing types, this test tells them what they changed and why it mattered.
k_int = B.row_key_of(json.loads('{"fixture_id":1,"price_decimal":2}'))
k_flt = B.row_key_of(json.loads('{"fixture_id":1,"price_decimal":2.0}'))
ok(k_int != k_flt,
   "CHARACTERISED: an integer lexeme and a float lexeme still key differently "
   "(a vendor-shape risk, not a language one — part B measures it)")

# ─────────────────────────────────────────────────────────────────────────────
section("2 · Credentials — six fields, never a URL, never in a log line")
# ─────────────────────────────────────────────────────────────────────────────

PW = "p%40ss!w%rd!"      # a real-shaped password: contains both % and !
env = {"KIBL_RMQ_HOST": " rabbitmq.kibl.io\n", "KIBL_RMQ_PORT": "5671",
       "KIBL_RMQ_VHOST": "/", "KIBL_RMQ_USER": "gg29", "KIBL_RMQ_PASS": PW + "\n",
       "KIBL_RMQ_QUEUE": "gg29.get.info.markets"}
conn, missing = C.read_conn_env(env)
ok(missing == [], f"all six fields read (missing: {missing})")
ok(conn["host"] == "rabbitmq.kibl.io", "whitespace and newlines are stripped from the host")
ok(conn["password"] == PW, "the password survives stripping byte-identically, % and ! included")

_, missing2 = C.read_conn_env({"KIBL_RMQ_HOST": "h", "KIBL_RMQ_PORT": "5671"})
ok(missing2 == ["password", "queue", "user", "vhost"],
   f"CONTROL: a partial environment names exactly what is absent (got {missing2})")


class _FakePika:
    """Records what the real pika would have been handed. No connection made."""
    class PlainCredentials:
        def __init__(self, u, p): self.username, self.password = u, p

    class SSLOptions:
        def __init__(self, ctx, server_hostname=None):
            self.context, self.server_hostname = ctx, server_hostname

    class ConnectionParameters:
        def __init__(self, **kw): self.kw = kw


params = C.connection_parameters(conn, _FakePika)
ok(params.kw["host"] == "rabbitmq.kibl.io" and params.kw["port"] == 5671,
   "host and port are passed as separate parameters, port as an int")
ok(params.kw["virtual_host"] == "/", "vhost is passed as a parameter")
ok(params.kw["credentials"].password == PW,
   "THE PASSWORD REACHES PlainCredentials UNENCODED AND UNMANGLED — "
   "no URL parser ever sees the % ")
ok(params.kw["ssl_options"].server_hostname == "rabbitmq.kibl.io",
   "TLS is on, with SNI set to the broker host (a bare context would fail verification)")

# The brief's alternative, refused: "If you must use a URL anyway, encode it and
# add a test proving a password with % connects." We do not build a URL, so the
# stronger statement is available — prove the URL never exists.
src = open(os.path.join(HERE, "consumer.py")).read()
src_nocomments = re.sub(r"#.*", "", re.sub(r'"""(?:.|\n)*?"""', "", src))
ok("amqp://" not in src_nocomments and "amqps://" not in src_nocomments,
   "no AMQP URL is constructed anywhere in executable code")
ok("amqp" in src.lower(), "CONTROL: the scan is looking at a file that does mention AMQP")

red = C.redact(f"ACCESS_REFUSED for user {conn['user']} pass {PW} on vhost /",
               [conn["password"], conn["user"], conn["vhost"]])
ok(PW not in red and "gg29" not in red,
   f"redact() removes the password AND the username from error text — {red}")
# Longest-first control. If a short secret is a PREFIX of a long one — which is
# exactly the username/password relationship this guards — a shortest-first pass
# redacts the prefix, destroys the match for the long one, and leaves its tail in
# the log. "pass" inside "password" leaks "word".
ok(C.redact("password", ["pass", "password"]) == "[redacted]",
   f'CONTROL: redact() takes the LONGEST secret first — shortest-first would leak '
   f'"word" (got {C.redact("password", ["pass", "password"])!r})')

# ─────────────────────────────────────────────────────────────────────────────
section("3 · Message handling — four shapes accepted, the fifth counted")
# ─────────────────────────────────────────────────────────────────────────────

AT = "2026-09-23T00:00:00Z"
ROW = {"fixture_id": 728343, "price_decimal": 1.69, "feed_source_id": 171,
       "league_id": 19, "inserted_on": "2026-09-23T00:00:00.000Z"}

for name, text, want in [
    ("a bare row", json.dumps(ROW), 1),
    ("a bare array", json.dumps([ROW, ROW]), 2),
    ("the REST envelope {code,description,result}",
     json.dumps({"code": 200, "description": "ok", "result": [ROW]}), 1),
    ("the market_participants shape", json.dumps({"market_participants": [ROW]}), 1),
]:
    st = {}
    ok(len(C.rows_from_message(text, AT, st)) == want, f"accepts {name}")

st = {}
ok(C.rows_from_message("not json at all", AT, st) == [] and st.get("unreadable") == 1,
   "unparseable text is COUNTED, not raised — one bad message cannot stop the others")
st = {}
ok(C.rows_from_message(json.dumps({"hello": "world"}), AT, st) == [] and st.get("unreadable") == 1,
   "an unrecognised object is counted as unreadable rather than guessed at")

st = {}
rows = C.rows_from_message(json.dumps(ROW), AT, st)
ok(rows[0]["sweep_id"] == "stream",
   "a streamed row is stamped sweep_id='stream', never a borrowed sweep id")
ok(rows[0]["last_seen_at"] == AT and rows[0]["observed_at"] == AT,
   "the row carries both clocks, as to_summary() sets them")
ok(set(rows[0]) == set(B.to_summary(ROW, AT, 19, "stream", None)),
   "the streamed row has EXACTLY the sweep's column set — same function, so it cannot drift")

# ─────────────────────────────────────────────────────────────────────────────
section("4 · Tennis filtering — ATP only, and 'unknown' is not 'no'")
# ─────────────────────────────────────────────────────────────────────────────

ok(C.is_tennis({"league_id": 19}) is True, "ATP (19) is tennis")
ok(C.is_tennis({"league_id": 537}) is True, "Challenger (537) is tennis")
ok(C.is_tennis({"league_id": 962}) is True, "ITF Men (962) is tennis")
ok(C.is_tennis({"league_id": 20}) is False, "WTA (20) is NOT kept — CLAUDE.md rule 7, ATP only")
ok(C.is_tennis({"league_id": 999}) is False, "CONTROL: an unrelated league is rejected")
ok(C.is_tennis({"fixture_id": 1}) is None, "a row with no league at all is UNKNOWN, not False")

st = {}
kept = C.rows_from_message(json.dumps({"fixture_id": 9, "price_decimal": 1.5}), AT, st)
ok(len(kept) == 1 and st.get("league_unknown") == 1,
   "an unknown-league row is KEPT and counted — dropping it would lose a price silently")
st = {}
dropped = C.rows_from_message(json.dumps({"fixture_id": 9, "league_id": 20}), AT, st)
ok(dropped == [] and st.get("non_tennis") == 1,
   "a known non-tennis row is dropped and counted (so the 20k cap is never approached)")

# ─────────────────────────────────────────────────────────────────────────────
section("5 · Liveness — the third branch is the one that matters")
# ─────────────────────────────────────────────────────────────────────────────

NOW = 1_800_000_000_000
state = {"connected": True, "since_last_beat": 7, "rows_since_last_beat": 3,
         "unreadable_since_last_beat": 0, "last_message_at_ms": NOW - 5_000,
         "reconnects": 2, "last_gap_seconds": 240, "version": "0.2.0"}
hb = C.heartbeat_row(state, NOW)
ok(hb["messages_since_last_beat"] == 7 and hb["last_message_age_s"] == 5,
   "the heartbeat reports per-beat counts and the age of the last message")
ok(hb["last_gap_seconds"] == 240,
   "the heartbeat carries how long the worker was last blind — on a feed with no "
   "history, that number IS the loss")
ok(hb["id"] == 1, "singleton row: the question is 'is it alive NOW', not a history")

ok(C.liveness_alert(hb, expect_near_start=False, now_ms=NOW) is None,
   "a healthy worker raises nothing")
stale = C.liveness_alert(hb, now_ms=NOW + 200_000)
ok(stale is not None and "not running" in stale,
   "no heartbeat past the threshold -> the worker is not running")
down = C.liveness_alert(dict(hb, connected=False), now_ms=NOW)
ok(down is not None and "NOT connected" in down, "running but disconnected is reported")

# THE THIRD BRANCH, and its control. Same heartbeat, same silence, two answers —
# the only difference is whether a fixture is inside the dense band.
silent = dict(hb, last_message_age_s=900)
ok(C.liveness_alert(silent, expect_near_start=True, now_ms=NOW) is not None,
   "connected + silent 900s + a fixture in the dense band -> ALERTED")
ok(C.liveness_alert(silent, expect_near_start=False, now_ms=NOW) is None,
   "CONTROL: the same silence with no fixture near a start is a quiet market, not an alert")
never = dict(hb, last_message_age_s=None)
ok(C.liveness_alert(never, expect_near_start=True, now_ms=NOW) is not None,
   "a worker that has NEVER received a message is caught by the same branch "
   "(a mis-bound queue looks exactly like a quiet Sunday)")

gap = C.gap_record(NOW - 240_000, NOW)
ok(gap["duration_seconds"] == 240 and gap["start"].endswith("Z") and gap["end"].endswith("Z"),
   "a gap records start, end AND duration")

# ─────────────────────────────────────────────────────────────────────────────
section("6 · Reconnect backoff — jittered, ladder-shaped, hard-capped")
# ─────────────────────────────────────────────────────────────────────────────

ok(C.backoff_for(0, lambda: 0.5) == 1.0, "attempt 0 is the 1s rung with zero jitter")
ok(C.backoff_for(5, lambda: 0.5) == 60.0, "attempt 5 is the 60s rung")
ok(C.backoff_for(99, lambda: 0.5) == 60.0, "CAPPED: attempt 99 is still 60s, never more")
ok(all(C.backoff_for(a, lambda: 1.0) <= 60.0 for a in range(0, 50)),
   "maximum jitter can never push any rung above the 60s cap")
ok(all(C.backoff_for(a, lambda: 0.0) >= 0.25 for a in range(0, 50)),
   "minimum jitter can never push any rung below 0.25s")
lo, hi = C.backoff_for(4, lambda: 0.0), C.backoff_for(4, lambda: 1.0)
ok(lo < 30.0 < hi, f"the 30s rung is genuinely JITTERED, not fixed ({lo} .. {hi})")

# ─────────────────────────────────────────────────────────────────────────────
section("7 · (d) Nothing here can stand the poller down")
# ─────────────────────────────────────────────────────────────────────────────
# Comments are stripped first: this file's own prose, and the consumer's,
# contain the words 'disable' and 'throttle' in the sentence PROMISING not to.

banned = ("disable", "throttle", "unschedule", "cancel_workflow", "delete_workflow", "PUT ")
hits = [w for w in banned if w in src_nocomments]
ok(hits == [], f"no disabling/throttling verb survives in executable code (found {hits})")
ok(any(w in src for w in banned),
   "CONTROL: the scan is reading a file whose COMMENTS do contain those words")

# Adjacent string literals are folded first: the dispatch URL is split across two
# source lines, so a regex run on the raw text finds `actions/workflows/` followed
# by a quote and reports NO workflow — a guard that would have passed by seeing
# nothing. Folding makes it read what the interpreter reads.
folded = re.sub(r'"\s*\n\s*"', "", src_nocomments)
yml = sorted(set(re.findall(r"([A-Za-z0-9_.-]+\.yml)", folded)))
ok(yml == ["ten232-kibl-archive.yml"],
   f"the ONLY workflow this worker names anywhere is the sweep's own (found {yml})")
ok("actions/workflows/ten232-kibl-archive.yml/dispatches" in folded,
   "and it reaches it by DISPATCH (the additive verb), not by any other route")
ok('"mode": "sweep"' in src_nocomments or "'mode': 'sweep'" in src_nocomments,
   "and it asks for one EXTRA sweep — an additive call, with no parameter that can slow the regular one")
ok(".yml/disable" not in src and "workflows/pipeline" not in src_nocomments,
   "no path toward the pipeline workflow at all")

# ─────────────────────────────────────────────────────────────────────────────
section("8 · The writer is OPT-IN, so a read-only test cannot write by accident")
# ─────────────────────────────────────────────────────────────────────────────

ok("KIBL_STREAM_WRITE\") == \"1\"" in src or 'KIBL_STREAM_WRITE") == "1"' in src,
   "the writer turns on only for KIBL_STREAM_WRITE=1 — the safe state is the default state")
rc = C.main(env={}, log=lambda *a: None)
ok(rc == 0, "with no credentials the worker exits 0 and connects to nothing")
rc = C.main(env={"KIBL_RMQ_HOST": "h"}, log=lambda *a: None)
ok(rc == 0, "CONTROL: a PARTIAL credential set also exits 0 rather than half-connecting")

# ─────────────────────────────────────────────────────────────────────────────
section("9 · The sweep import is safe — loading it cannot start it")
# ─────────────────────────────────────────────────────────────────────────────
# sweep_bridge.py loads archive-kibl.py by path. If someone adds module-level
# work to the sweep, this import runs it — on a worker, in production. Caught
# here instead.

tree = ast.parse(open(B.SWEEP_PATH).read())
impure = []
for n in tree.body:
    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef,
                      ast.Import, ast.ImportFrom, ast.Expr, ast.If)):
        continue
    if isinstance(n, (ast.Assign, ast.AnnAssign)):
        v = n.value
        if isinstance(v, ast.Constant) or (
            isinstance(v, (ast.Tuple, ast.List, ast.Dict, ast.Set, ast.UnaryOp))
        ):
            continue
    impure.append(f"L{n.lineno}")
ok(impure == [],
   f"archive-kibl.py runs nothing but constant assignment at import (impure: {impure})")
ok(B.row_key_of is B.sweep.row_key_of,
   "the bridge exposes the sweep's ACTUAL function object, not a copy of it")
ok(B.observation_key.__module__ in ("kibl_client", "kibl_sweep"),
   f"observation_key is the client's own (module: {B.observation_key.__module__})")

# KEY_FIELDS is read out of the sweep's source with ast. An AST read is a guess
# about code until something EXECUTES it against the real function — so give each
# field a unique value and require the real key to contain those values in that
# order. A wrong name, a missing name or a reordering all fail here.
probe = {f: f"<{f}>" for f in B.KEY_FIELDS}
ok(B.observation_key(probe) == "|".join(f"<{f}>" for f in B.KEY_FIELDS),
   f"KEY_FIELDS matches what observation_key() really joins, in order "
   f"({len(B.KEY_FIELDS)} fields)")
# CONTROL: the check above is only meaningful if a wrong list would fail it.
wrong = tuple(reversed(B.KEY_FIELDS))
ok(B.observation_key({f: f"<{f}>" for f in wrong}) != "|".join(f"<{f}>" for f in wrong),
   "CONTROL: a REVERSED field list does not reproduce the key")

# ─────────────────────────────────────────────────────────────────────────────
print(f"\nPASS {PASS}   FAIL {FAIL}")
if FAIL:
    print("failed: " + ", ".join(_FAILURES))
sys.exit(1 if FAIL else 0)
