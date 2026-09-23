#!/usr/bin/env python3
"""TEN-253 A — the Kibl / Bet105 RabbitMQ consumer, in Python.

FOUNDER 2026-09-23: "Worker language: Python. Port kibl-stream/ from Node." and
"Do not deploy the always-on worker. Launch waits for Michael's go after he
reads the report." Nothing here runs anywhere yet. With no credentials in the
environment it prints what it would have done and exits 0, so a misfire cannot
become a half-connected worker nobody notices.

WHAT THE PORT BUYS, BEYOND THE LANGUAGE. The Node worker carried ~120 lines
(`py_str.mjs`) whose only job was to make JavaScript's `String()` agree with
Python's `str()` on None/True/2.0, because the row key is a `str()`-joined
string. In Python that layer does not exist: the key comes from the sweep's own
function, imported. See sweep_bridge.py — which also documents the bug that
apparatus was guarding one layer below the one that was broken.

THE FOUR RULES IT IS BUILT TO, each with the reason it exists:

  (b) SAME TABLES, NEW WRITER. Rows go through the sweep's own `to_summary()`
      and the sweep's own `row_key_of()`, on the same `on_conflict=row_key`
      / `resolution=ignore-duplicates` target. Not a matching implementation —
      the same function object.

  (d) THE SWEEP IS THE BACKSTOP. This supplements it. There is deliberately no
      code here that stands the poller down, throttles it or unschedules it — a
      stream that can silence the poller turns one outage into two. Asserted by
      a test, because a promise in a comment is not a constraint.

  (a) RECONNECT WITH BACKOFF, AND A REST SNAPSHOT ON RECONNECT. Kibl serves no
      history, so anything posted while we were disconnected is unrecoverable
      from the broker unless the queue is durable. Every reconnect therefore
      logs the GAP — start, end, duration — and dispatches the EXISTING sweep.
      The gap is logged whether or not the snapshot finds anything: "we were
      blind for four minutes" is the finding; "we found three rows" is not.

  (c) A HEARTBEAT EVERY 60s. The founder named the failure exactly: "A
      connected worker receiving nothing looks exactly like a quiet market, and
      that is the failure that gets missed." The counts are SINCE THE LAST BEAT,
      never cumulative — a cumulative counter keeps climbing for as long as the
      process has ever worked, so it cannot answer "is the channel delivering
      right now", which is the entire question.

CREDENTIALS. Six separate parameters, never an AMQP URL. The password contains
`%` and `!`; `%` is the percent-encoding introducer, so an un-encoded password
in a URL is silently mangled or rejected by the parser and the failure surfaces
as an authentication error that looks like a wrong password. Passing the six
fields to `pika.ConnectionParameters` removes the parser from the path
altogether. `redact()` below scrubs them from every line this module can emit,
including exception text.
"""
import json
import os
import random
import ssl
import sys
import time
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sweep_bridge import (  # noqa: E402
    KEY_FIELDS, TABLE_OBS, TENNIS_LEAGUES_MEN, row_key_of, to_summary,
)

TABLE_HEARTBEAT = "kibl_stream_heartbeat"
HEARTBEAT_EVERY_S = 60.0

# Reconnect backoff. Capped at 60s: this is a favour-basis feed and a worker
# that retries a refusing broker every second is how the favour ends. Jittered
# because a deterministic ladder synchronises reconnect storms across every
# consumer on the broker after a restart, ours included.
BACKOFF_S = (1.0, 2.0, 5.0, 10.0, 30.0, 60.0)

# The stream's provenance marker in `sweep_id`. NOT a borrowed sweep id: a
# stream row belongs to no sweep, and attributing it to the last one would
# credit a pull that never saw this price. Readable in the table forever.
STREAM_SWEEP_ID = "stream"


def utcnow():
    return datetime.now(timezone.utc)


def iso(ts):
    return ts.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


# ─────────────────────────────────────────────────────────────────────────────
# Credential hygiene
# ─────────────────────────────────────────────────────────────────────────────

def redact(text, secrets):
    """Replace every secret with a fixed marker, longest first.

    Longest-first matters: if the username is a substring of the password,
    redacting the short one first leaves a recognisable fragment of the long one
    behind. Applied to EXCEPTION TEXT as well as log lines — pika puts the
    connection parameters into some of its error strings, and an error path is
    exactly where nobody is reading carefully.
    """
    out = str(text)
    for s in sorted({s for s in secrets if s}, key=len, reverse=True):
        out = out.replace(s, "[redacted]")
    return out


def read_conn_env(env=None):
    """The six connection fields, read individually. Never assembled into a URL.

    `.strip()` on every one: a trailing newline on a GitHub Actions secret has
    already broken one integration on this repo (BetsAPI), and an invisible
    character in a vhost or a password fails as "access refused", which reads as
    a credential problem rather than a whitespace problem.
    """
    env = os.environ if env is None else env
    got = {
        "host": (env.get("KIBL_RMQ_HOST") or "").strip(),
        "port": (env.get("KIBL_RMQ_PORT") or "").strip(),
        "vhost": (env.get("KIBL_RMQ_VHOST") or "").strip(),
        "user": (env.get("KIBL_RMQ_USER") or "").strip(),
        "password": (env.get("KIBL_RMQ_PASS") or "").strip(),
        "queue": (env.get("KIBL_RMQ_QUEUE") or "").strip(),
    }
    missing = sorted(k for k, v in got.items() if not v)
    return got, missing


# ─────────────────────────────────────────────────────────────────────────────
# Pure functions. Everything here is testable with no broker and no database.
# ─────────────────────────────────────────────────────────────────────────────

def backoff_for(attempt, rnd=random.random):
    """Jittered backoff for reconnect attempt `attempt` (0-based), seconds."""
    base = BACKOFF_S[min(attempt, len(BACKOFF_S) - 1)]
    jitter = base * 0.2 * (rnd() * 2 - 1)      # +/-20%
    return max(0.25, min(BACKOFF_S[-1], round(base + jitter, 3)))


def envelope_rows(payload):
    """Unwrap whatever the broker sent into a list of participant rows, or None.

    Kibl's REST envelope is {code, description, result: [...]}. The STREAM's
    envelope is not documented for us, so a bare row, a bare array and the
    `market_participants` shape are all accepted, and anything else returns None
    to be COUNTED rather than guessed at. Part B reports which of these the real
    queue actually uses; until then, tolerating four shapes and counting the
    fifth is honest and guessing is not.
    """
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("result", "market_participants"):
            if isinstance(payload.get(key), list):
                return payload[key]
        # A BARE ROW is recognised by CARRYING THE KEY FIELDS, not by having a
        # non-null fixture_id. ⚠️ The retired Node consumer tested
        # `payload.fixture_id != null`, which rejects a row whose fixture_id is
        # null — and the sweep keys that row perfectly well. Caught by corpus
        # case 1 (every field None) arriving as `unreadable` instead of a row:
        # a message the sweep would have stored, silently counted as garbage.
        if any(f in payload for f in KEY_FIELDS):
            return [payload]
    return None


def league_of(row):
    """The league id on a row, or None if the row does not carry one.

    ⚠️ RETURNS None RATHER THAN A DEFAULT. The sweep learns a row's league from
    the CALL it made (`_league_id`, injected by the caller); a pushed message has
    no such call behind it. Whether the stream carries a league at all is a part-B
    question, and `is_tennis()` below treats None as "unknown", never as "not
    tennis" — misclassifying a tennis row as non-tennis loses a price silently,
    which is the one outcome worse than storing a row we did not need.
    """
    for f in ("_league_id", "league_id", "leagueId"):
        v = row.get(f)
        if v is not None:
            try:
                return int(v)
            except (TypeError, ValueError):
                return None
    return None


def is_tennis(row):
    """True / False / None(unknown). ATP, Challenger and ITF Men only.

    ATP-only per CLAUDE.md rule 7 (no WTA anywhere). The league ids come from
    kibl_client.TENNIS_LEAGUES_MEN, not from a list retyped here.
    """
    lid = league_of(row)
    if lid is None:
        return None
    return lid in TENNIS_LEAGUES_MEN


def rows_from_message(body_text, observed_at, stats=None, raw_object=None):
    """One AMQP message -> the rows the sweep would have written for it.

    Returns [] rather than raising on a shape we do not recognise. A stream is
    not request/response: an exception here would kill the consumer and stop
    every OTHER message too. An unreadable message is counted instead, and the
    count rides on the heartbeat where it can be seen — `unreadable` climbing
    while `rows` stays flat is a vendor schema change, and it looks nothing like
    a quiet market.

    Rows are shaped by the sweep's own `to_summary()`, so a streamed row and a
    swept row of the same price are the same row, not two rows that resemble
    each other.
    """
    st = {} if stats is None else stats
    try:
        payload = json.loads(body_text)
    except (ValueError, TypeError):
        st["unreadable"] = st.get("unreadable", 0) + 1
        return []
    raw = envelope_rows(payload)
    if raw is None:
        st["unreadable"] = st.get("unreadable", 0) + 1
        return []

    out = []
    for r in raw:
        if not isinstance(r, dict):
            st["unreadable"] = st.get("unreadable", 0) + 1
            continue
        tennis = is_tennis(r)
        if tennis is False:
            st["non_tennis"] = st.get("non_tennis", 0) + 1
            continue
        if tennis is None:
            # Kept, and counted separately. See league_of(): unknown is not a
            # synonym for no, and the count is what tells us which it was.
            st["league_unknown"] = st.get("league_unknown", 0) + 1
        out.append(to_summary(r, observed_at, league_of(r), STREAM_SWEEP_ID, raw_object))
    st["rows"] = st.get("rows", 0) + len(out)
    return out


def heartbeat_row(state, now_ms):
    """The singleton heartbeat row. Pure, so liveness is testable without a broker."""
    last = state.get("last_message_at_ms")
    return {
        "id": 1,
        "beat_at": iso(datetime.fromtimestamp(now_ms / 1000.0, timezone.utc)),
        "connected": bool(state.get("connected")),
        # SINCE THE LAST BEAT, not since boot.
        "messages_since_last_beat": int(state.get("since_last_beat") or 0),
        "rows_written_since_last_beat": int(state.get("rows_since_last_beat") or 0),
        "unreadable_since_last_beat": int(state.get("unreadable_since_last_beat") or 0),
        "last_message_age_s": None if last is None else int(round((now_ms - last) / 1000.0)),
        "reconnects_total": int(state.get("reconnects") or 0),
        # How long the worker was last blind. On a feed with no history that
        # number IS the loss, so an alert can say how much was missed rather
        # than only that something was.
        "last_gap_seconds": state.get("last_gap_seconds"),
        "worker_version": state.get("version") or "dev",
    }


def liveness_alert(hb, stale_beat_s=180, silent_s=600, expect_near_start=False, now_ms=None):
    """Is the worker in a state a human should be told about? -> None, or a reason.

    THE POINT OF THIS FUNCTION IS THE THIRD BRANCH. A disconnected worker is
    obvious. A connected worker delivering nothing is the one that gets missed,
    and it is indistinguishable from a quiet market UNLESS compared against a
    market that should not be quiet. `expect_near_start` is that comparison: it
    is true when a fixture is inside the dense band, i.e. exactly when silence
    is not a plausible market state.
    """
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    beat_age = (now_ms - _parse_ms(hb["beat_at"])) / 1000.0
    if beat_age > stale_beat_s:
        return (f"no heartbeat for {round(beat_age)}s (threshold {stale_beat_s}s) "
                "— the worker is not running")
    if not hb.get("connected"):
        return "the worker is running but NOT connected to the broker"
    if expect_near_start and hb.get("last_message_age_s") is None:
        return "connected but has NEVER received a message, with a fixture inside the dense band"
    if expect_near_start and hb["last_message_age_s"] > silent_s:
        return (f"connected but silent for {hb['last_message_age_s']}s while a fixture is "
                "inside the dense band — a live channel delivering nothing looks exactly "
                "like a quiet market")
    return None


def _parse_ms(s):
    return int(datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp() * 1000)


def gap_record(down_ms, up_ms):
    """start / end / duration for a blind window, so a gap is reportable not merely felt."""
    return {
        "start": iso(datetime.fromtimestamp(down_ms / 1000.0, timezone.utc)),
        "end": iso(datetime.fromtimestamp(up_ms / 1000.0, timezone.utc)),
        "duration_seconds": int(round((up_ms - down_ms) / 1000.0)),
    }


# ─────────────────────────────────────────────────────────────────────────────
# The runtime. Everything above is pure and tested; everything below needs a
# broker, and is deliberately the thin part.
# ─────────────────────────────────────────────────────────────────────────────

def connection_parameters(conn, pika):
    """Six fields -> pika parameters. TLS, and no URL anywhere in the path."""
    ctx = ssl.create_default_context()
    return pika.ConnectionParameters(
        host=conn["host"],
        port=int(conn["port"]),
        virtual_host=conn["vhost"],
        credentials=pika.PlainCredentials(conn["user"], conn["password"]),
        ssl_options=pika.SSLOptions(ctx, server_hostname=conn["host"]),
        # The AMQP-level heartbeat, distinct from our 60s database heartbeat:
        # this one lets the BROKER notice a half-open socket. Without it a dead
        # TCP connection looks to us exactly like a quiet queue, which is the
        # failure this whole worker is organised around.
        heartbeat=60,
        blocked_connection_timeout=300,
        connection_attempts=1,
    )


def sb_request(env, method, path, body=None, prefer=None):
    """One PostgREST call with the service key. Returns (status, text)."""
    url = env["SUPABASE_URL"].rstrip("/") + path
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", env["SUPABASE_SECRET_KEY"])
    req.add_header("Authorization", "Bearer " + env["SUPABASE_SECRET_KEY"])
    req.add_header("Content-Type", "application/json")
    if prefer:
        req.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        code = getattr(e, "code", 0)
        try:
            return code, e.read().decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            return code, str(e)


def insert_rows(env, rows, log):
    """ignore-duplicates on row_key: the SAME conflict target the sweep uses.

    A row seen by both writers is stored once and first-sighting-wins holds
    across them — which is true only because `row_key` here comes from the
    sweep's own `row_key_of()`. See sweep_bridge.py.
    """
    status, text = sb_request(
        env, "POST", f"/rest/v1/{TABLE_OBS}?on_conflict=row_key", rows,
        prefer="resolution=ignore-duplicates,return=minimal")
    if status not in (200, 201, 204):
        log(f"::warning::stream insert failed: {status} {text[:300]}")
        return 0
    return len(rows)


def write_heartbeat(env, hb, log):
    if not env.get("SUPABASE_URL"):
        return
    status, text = sb_request(
        env, "POST", f"/rest/v1/{TABLE_HEARTBEAT}?on_conflict=id", [hb],
        prefer="resolution=merge-duplicates,return=minimal")
    if status not in (200, 201, 204):
        log(f"::warning::heartbeat write failed: {status} {text[:200]}")


def snapshot_via_sweep(env, log):
    """(a) Fill a gap by DISPATCHING THE EXISTING SWEEP, not by pulling again here.

    A second implementation of the pull is a second thing to keep in step with
    the first, and the two would drift the first time either changed. This is
    also the ONLY outward call this worker makes toward the poller, and it is
    additive: it asks for one extra sweep. There is no parameter here that can
    slow, skip or unschedule the regular one — see test-consumer.py.
    """
    token = env.get("GH_DISPATCH_TOKEN")
    if not token:
        log("::warning::no GH_DISPATCH_TOKEN; the gap is logged but NOT backfilled")
        return
    req = urllib.request.Request(
        "https://api.github.com/repos/Michaeldk1996/SAAS/actions/workflows/"
        "ten232-kibl-archive.yml/dispatches",
        data=json.dumps({"ref": "main", "inputs": {"mode": "sweep"}}).encode(),
        method="POST")
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            log(f"snapshot: dispatched the existing sweep (mode=sweep) — HTTP {r.status}")
    except Exception as e:  # noqa: BLE001
        log(f"::warning::snapshot dispatch failed: {redact(e, [token])}")


def main(env=None, log=print, run_forever=True):
    env = dict(os.environ) if env is None else dict(env)
    conn, missing = read_conn_env(env)
    if missing:
        # NOT an error. "Do not deploy the always-on worker" is the standing
        # instruction, so no credentials is the expected state and it must exit
        # clean rather than crash-loop a host.
        log(f"KIBL_RMQ_* not fully set (missing: {', '.join(missing)}) — nothing to connect to.")
        log("This worker is BUILT AND NOT DEPLOYED, by instruction (TEN-253).")
        log("Launch waits for the founder's go after he reads the readiness report.")
        return 0

    secrets = [conn["password"], conn["user"], conn["vhost"]]
    import pika  # imported late so the no-credentials path needs no dependency

    write_enabled = env.get("KIBL_STREAM_WRITE") == "1"
    # OPT-IN, not opt-out. The access test must write nothing to Supabase, and a
    # writer that is on by default is one forgotten flag away from a live write
    # during a read-only experiment. The safe state is the default state.
    if not write_enabled:
        log("writer DISABLED (KIBL_STREAM_WRITE != 1) — observations will be counted, not stored")

    state = {
        "connected": False, "since_last_beat": 0, "rows_since_last_beat": 0,
        "unreadable_since_last_beat": 0, "last_message_at_ms": None,
        "reconnects": 0, "last_gap_seconds": None,
        "version": env.get("WORKER_VERSION", "dev"),
    }
    attempt, down_at_ms, last_beat = 0, None, time.time()

    while True:
        try:
            params = connection_parameters(conn, pika)
            connection = pika.BlockingConnection(params)
            # ⚠️ THE PASSIVE DECLARE GETS ITS OWN THROWAWAY CHANNEL, AND ITS
            # FAILURE IS NOT FATAL. MEASURED against the real broker on
            # 2026-09-23 (run 35815631134): it answers with
            #   403 ACCESS_REFUSED — configure access to queue ... refused
            # so this account has no `configure` permission on its own queue. A
            # channel-level 403 CLOSES the channel, so declaring on the consuming
            # channel takes the consume down with it — an entitlement gap the
            # worker cannot influence would have become a permanent crash-loop.
            #
            # Passive, never active: we do not declare the vendor's queue into
            # existence. A queue that is not there is a finding about
            # entitlement, not something to paper over by creating an empty one
            # that will never be bound.
            depth = None
            try:
                probe = connection.channel()
                ok = probe.queue_declare(queue=conn["queue"], passive=True)
                depth = ok.method.message_count
                log(f"connected; queue has {depth} message(s) waiting and "
                    f"{ok.method.consumer_count} consumer(s)")
                probe.close()
            except Exception as e:  # noqa: BLE001
                log(f"connected; queue depth UNAVAILABLE (passive declare refused: "
                    f"{redact(e, secrets)[:160]}) — consuming anyway")
            channel = connection.channel()

            if down_at_ms is not None:
                gap = gap_record(down_at_ms, int(time.time() * 1000))
                state["last_gap_seconds"] = gap["duration_seconds"]
                state["reconnects"] += 1
                log(f"::warning::stream gap {json.dumps(gap)} — taking a REST snapshot")
                snapshot_via_sweep(env, log)
                down_at_ms = None

            state["connected"] = True
            attempt = 0
            # prefetch 50: manual ack, so unacked messages hold the flow. Small
            # enough that a stall cannot silently accumulate 20k unacked messages
            # against the vendor's cap, large enough not to round-trip per message.
            channel.basic_qos(prefetch_count=50)

            for method, _props, body in channel.consume(
                    conn["queue"], inactivity_timeout=1.0, auto_ack=False):
                now = time.time()
                if method is not None:
                    stats = {}
                    rows = rows_from_message(
                        body.decode("utf-8", "replace"), iso(utcnow()), stats)
                    state["since_last_beat"] += 1
                    state["last_message_at_ms"] = int(now * 1000)
                    state["unreadable_since_last_beat"] += stats.get("unreadable", 0)
                    if rows and write_enabled:
                        state["rows_since_last_beat"] += insert_rows(env, rows, log)
                    # ACK EVERY MESSAGE, tennis or not. Filtering happens on our
                    # side AFTER the ack: an unacked non-tennis message still
                    # counts against the vendor's 20,000-message backlog cap, so
                    # "only ack what we keep" is how a pre-match tennis feed gets
                    # dropped by a basketball flood we declined to acknowledge.
                    channel.basic_ack(method.delivery_tag)

                if now - last_beat >= HEARTBEAT_EVERY_S:
                    hb = heartbeat_row(state, int(now * 1000))
                    log("heartbeat " + json.dumps(hb))
                    if write_enabled:
                        write_heartbeat(env, hb, log)
                    state["since_last_beat"] = 0
                    state["rows_since_last_beat"] = 0
                    state["unreadable_since_last_beat"] = 0
                    last_beat = now
                if not run_forever:
                    channel.cancel()
                    connection.close()
                    return 0
        except KeyboardInterrupt:
            return 0
        except Exception as e:  # noqa: BLE001
            state["connected"] = False
            if down_at_ms is None:
                down_at_ms = int(time.time() * 1000)
            wait = backoff_for(attempt)
            attempt += 1
            log(f"::warning::broker connection lost ({redact(e, secrets)[:200]}); "
                f"retrying in {wait}s")
            if not run_forever:
                return 1
            time.sleep(wait)


if __name__ == "__main__":
    sys.exit(main())
