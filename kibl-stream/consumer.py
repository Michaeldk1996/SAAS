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
import logging
import os
import random
import ssl
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sweep_bridge import (  # noqa: E402
    INSERT_CHUNK, OBS_REFRESH_COLS, TABLE_OBS, TENNIS_LEAGUES_MEN,
    market_participants, row_key_of, to_summary, unrecognised_envelope,
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

# ⚠️ OPEN QUESTION FOR THE FOUNDER — `raw_object` IS NULL ON EVERY STREAMED ROW,
# AND THAT INTERACTS BADLY WITH FIRST-SIGHTING-WINS.
#
# The sweep uploads the raw blob FIRST and dies if it cannot ("a summary row
# without its raw object is a number we cannot re-derive"), then stamps the
# pointer on every row. A streamed row has no blob behind it, so the column is
# NULL. Because both writers share `on_conflict=row_key,ignore-duplicates`,
# first sighting wins — so a price the STREAM sees first beats the sweep's later
# row carrying the pointer. **Successful dedupe therefore means `raw_object` is
# permanently NULL for exactly the rows the stream adds**, which is most of what
# it adds. The doubling bug would be fixed into a smaller, quieter one.
#
# Three ways out, none of them mine to pick: have the worker upload its own blob
# per message (cost: one object per message); write a sentinel like
# `stream://<beat>` so the NULL is at least explained; or accept it and document
# that stream-first rows are not re-derivable. REPORTED, NOT DECIDED — nothing
# is deployed, so nothing is at stake until launch.


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


class _RedactingFilter(logging.Filter):
    """Scrub secrets out of records this module never formatted.

    ⚠️ `redact()` IS A TEXT FUNCTION OVER OUR OWN f-STRINGS. It cannot see what
    pika logs. pika's module loggers are unconfigured here, so they fall through
    to `logging.lastResort` and write to stderr verbatim — and the content that
    matters is RabbitMQ's own close text, `ACCESS_REFUSED - access to vhost 'X'
    refused for user 'Y'`, which we redact when it arrives as an exception and
    would not when pika logs the same close itself. On Fly there is no GitHub
    masking and the logs are retained.

    Installed on the ROOT logger, so it covers pika and anything else added
    later rather than a list of logger names that will go stale.
    """

    def __init__(self, secrets):
        super().__init__()
        self.secrets = [s for s in secrets if s]

    def filter(self, record):
        try:
            record.msg = redact(record.getMessage(), self.secrets)
            record.args = ()
        except Exception:  # noqa: BLE001 — a logging filter must never raise
            record.msg = "[log record suppressed: could not be redacted safely]"
            record.args = ()
        return True


def install_log_redaction(secrets):
    """Attach the filter to the root logger AND to a real handler.

    A Filter on a logger only runs for records logged THROUGH that logger, and
    `lastResort` bypasses handlers entirely — so a root handler is added here to
    make sure every record has somewhere redacted to go.
    """
    handler = logging.StreamHandler()
    handler.addFilter(_RedactingFilter(secrets))
    root = logging.getLogger()
    root.addFilter(_RedactingFilter(secrets))
    root.addHandler(handler)
    root.setLevel(logging.WARNING)
    return handler


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
    """Unwrap whatever the broker sent into PARTICIPANT rows, or None if unreadable.

    ⚠️ THE UNWRAP IS THE SWEEP'S, NOT OURS. `market_participants()` knows two
    things a hand-rolled unwrap does not: Kibl uses **seven** envelope keys
    (`result, data, results, items, records, markets, fixtures`), and the rows
    under them may be FIXTURE-LEVEL WRAPPERS that have to be descended through
    (`participants` / `markets`) to reach the priced records. A record counts as
    a participant only when it carries both `market_type_id` and `side_id`.

    MEASURED against a hand-rolled version on
    `{result:[{fixture_id, participants:[2 priced rows]}]}`: the sweep yields
    **2** rows, the hand-rolled version yielded **1** row summarising the
    wrapper — `market_id`, `side_id` and `price_decimal` all `None`, a row_key
    the sweep can never produce — and reported it a success. Both real prices
    were lost, silently. An envelope keyed `markets` yielded 0 and was counted
    unreadable.

    Returns:
      None  — we cannot read this shape at all (count it, never guess)
      []    — a recognised envelope carrying no participants (a real answer)
      [...] — the participant rows, exactly as the sweep would have built them
    """
    # A BARE PARTICIPANT ROW is the one shape the sweep never meets and the
    # stream might: REST always wraps, and the broker's envelope is undocumented
    # for us. Recognised by the two fields that DEFINE a participant, the same
    # test market_participants() applies — not by "has any key field", which
    # would also swallow a fixture-level wrapper and put us straight back into
    # the failure above.
    if isinstance(payload, dict) and "market_type_id" in payload and "side_id" in payload:
        return [payload]
    if unrecognised_envelope(payload):
        return None
    return market_participants(payload)


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
    if not raw:
        # A RECOGNISED envelope carrying no participants. Counted apart from
        # `unreadable`, because the two mean opposite things: this one says the
        # vendor sent us a well-formed message with nothing priced in it, and
        # `unreadable` says we could not parse what they sent. Merging them
        # would hide a schema change inside a quiet market.
        st["no_participants"] = st.get("no_participants", 0) + 1
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
        if r.get("fixture_id") is None:
            # ⚠️ DROPPED, AND COUNTED — because the COLUMN IS `NOT NULL`
            # (ten232-kibl-schema.sql: `fixture_id bigint not null`). Keying
            # such a row works fine; STORING it does not. Left in the batch it
            # would 23502 the whole POST and take every good row in the message
            # down with it, while `unreadable` stayed at 0 and the heartbeat
            # showed 0 rows written — a silent, total loss dressed as a quiet
            # market. A row we cannot store is a finding, not a row.
            st["null_fixture_id"] = st.get("null_fixture_id", 0) + 1
            continue
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


def env_secrets(env, conn=None):
    """Everything that must never reach a log line, from BOTH credential sets.

    ⚠️ THE SUPABASE PROJECT REF IS IN HERE ON PURPOSE. `SUPABASE_URL` is a
    secret, but the moment we parse a hostname out of it ourselves, GitHub's
    masking no longer covers that string — and on Fly nothing masks anything.
    An `ssl.SSLCertVerificationError` stringifies as "hostname 'abc123.supabase.co'
    doesn't match…", and a scheme-less URL raises ValueError carrying the whole
    thing. Both were reaching stdout unredacted.
    """
    out = []
    if conn:
        out += [conn.get("password"), conn.get("user"), conn.get("vhost"),
                conn.get("host"), conn.get("queue")]
    url = (env.get("SUPABASE_URL") or "").strip()
    if url:
        out.append(url)
        host = urllib.parse.urlparse(url).hostname or ""
        if host:
            out += [host, host.split(".")[0]]
    for k in ("SUPABASE_SECRET_KEY", "GH_DISPATCH_TOKEN"):
        if env.get(k):
            out.append(env[k].strip())
    return [s for s in out if s]


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
            # Redacted HERE, not at the call site: this string can carry the
            # Supabase host (cert-mismatch, scheme-less URL) and every caller
            # would otherwise have to remember.
            return code, redact(e, env_secrets(env))


def insert_rows(env, rows, log, chunk=INSERT_CHUNK):
    """Two passes and a chunk — the SAME shape `archive-kibl.insert_rows` uses.

    PASS 1 · ignore-duplicates on `row_key`, the same conflict target the sweep
    uses, so a row seen by both writers is stored once and first-sighting-wins
    holds across them. `return=representation` is what makes the count REAL:
    PostgREST returns only the rows it actually inserted, so `rows_written` on
    the heartbeat is measured rather than assumed. The first cut sent
    `return=minimal` and returned `len(rows)` — it counted rows ATTEMPTED and
    called them written, which on a duplicate-heavy stream is exactly the number
    that would make a broken writer look busy.

    PASS 2 · bump `last_seen_at` (founder item A, 2026-09-18). ⚠️ THE FIRST CUT
    OMITTED THIS ENTIRELY, so every stream re-sighting of a price already stored
    was a no-op on the observation clock — and re-sighting stored prices is most
    of what a stream does. It is a SECOND statement, not a wider upsert, because
    merge-duplicates overwrites every column it is sent: one merged pass would
    rewrite `observed_at`, the price and the flags on every message, turning an
    append-only archive of an unrefetchable feed into a last-write-wins one.

    CHUNKED, because one POST per message means one bad row loses every good row
    beside it. A failed pass 2 is counted as a failure, not as cosmetic: it means
    the observation clock stopped advancing, on a worker reporting green.
    """
    new = 0
    for i in range(0, len(rows), chunk):
        part = rows[i:i + chunk]
        status, text = sb_request(
            env, "POST", f"/rest/v1/{TABLE_OBS}?on_conflict=row_key", part,
            prefer="resolution=ignore-duplicates,return=representation")
        if status not in (200, 201, 204):
            log(f"::warning::stream insert chunk {i // chunk} failed: "
                f"{status} {text[:300]}")
            continue
        try:
            new += len(json.loads(text)) if text.strip() else 0
        except ValueError:
            new += 0
        seen = [{k: r[k] for k in OBS_REFRESH_COLS if k in r} for r in part]
        status2, text2 = sb_request(
            env, "POST", f"/rest/v1/{TABLE_OBS}?on_conflict=row_key", seen,
            prefer="resolution=merge-duplicates,return=minimal")
        if status2 not in (200, 201, 204):
            log(f"::warning::last_seen_at refresh chunk {i // chunk} failed: "
                f"{status2} {text2[:200]} — the observation clock did NOT advance "
                f"for {len(part)} row(s)")
    return new


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
        log(f"::warning::snapshot dispatch failed: {redact(e, env_secrets(env))}")


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

    # ALL SIX plus the Supabase set. The first cut omitted `host` and `queue`,
    # so a pika exception naming the broker logged in the clear on Fly.
    secrets = env_secrets(env, conn)
    # Installed BEFORE pika is imported, so nothing it logs at import or connect
    # time can reach stderr unfiltered.
    install_log_redaction(secrets)
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
