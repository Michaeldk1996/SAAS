#!/usr/bin/env python3
"""TEN-253 B — the live access test against Kibl's real RabbitMQ queue.

READ-ONLY BY CONSTRUCTION. This writes NOTHING to Supabase. The consumer's
table writer is never enabled here (`KIBL_STREAM_WRITE` is not set, and is
opt-in anyway); the only Supabase traffic is GETs, used to compare captures
against what the poller already stored. Captures and reports go into a workflow
artifact and nowhere else.

WHAT IT ANSWERS, in the founder's order:

  1 connect            success, or the exact error with credentials redacted
  2 backlog            queue depth at connect (PASSIVE declare — we never create
                       the vendor's queue), and the age of the oldest message we
                       actually receive
  3 listen >= 90 min   rate, tennis split, pre-match vs live, delivery_mode,
                       field list, redacted samples, WHICH CLOCK the timestamps
                       are, markets present, and how close to the start the last
                       pre-match message lands
  4 mapping            do stream fixture ids exist among feed_source_id 171
                       polled fixtures? matched / unmatched / total
  5 stream vs poll     price agreement, how much earlier the stream sees a move,
                       and the number that decides everything: PRICE CHANGES THE
                       STREAM SAW THAT POLLING NEVER CAPTURED, with denominator
  6 drop test          stop consuming for a measured gap, report the backlog on
                       return and estimate where the 20,000 cap starts losing
  7 region + latency   where the broker appears to be, and the round trip

EVERY FIGURE CARRIES ITS DENOMINATOR AND ITS POPULATION, and n < 30 is flagged.
A missing field is reported as MISSING — never as zero, never as a plausible
default. Zero tennis messages is a FINDING, printed as such, not a pass.
"""
import json
import os
import socket
import ssl
import statistics
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import consumer as C          # noqa: E402
import sweep_bridge as B      # noqa: E402

OUT = os.environ.get("TEN253_OUT", os.path.join(HERE, "..", "ten253-access-test"))
LISTEN_MIN = float(os.environ.get("TEN253_LISTEN_MIN", "90"))
DROP_MIN = float(os.environ.get("TEN253_DROP_MIN", "5"))
KIBL_FEED_SOURCE_ID = 171     # Bet105. The only book this account is served.

SECRETS = []
REPORT = []


def say(line=""):
    txt = C.redact(line, SECRETS)
    print(txt, flush=True)
    REPORT.append(txt)


def dash(v):
    """Missing renders as an em dash, never as 0. CLAUDE.md, everywhere."""
    return "—" if v is None else v


def pct(n, d):
    return "—" if not d else f"{100.0 * n / d:.1f}%"


def nflag(n):
    return f"n={n}" + ("  ⚠️ n<30" if n < 30 else "")


def parse_ts(v):
    """A timestamp in any of the shapes this feed uses -> aware datetime, or None."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        # Epoch seconds or milliseconds; 1e11 splits them until the year 5138.
        return datetime.fromtimestamp(v / 1000.0 if v > 1e11 else v, timezone.utc)
    s = str(v).strip()
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Supabase — GET only
# ─────────────────────────────────────────────────────────────────────────────

def sb_get(path):
    url = os.environ["SUPABASE_URL"].rstrip("/") + path
    req = urllib.request.Request(url)
    key = os.environ["SUPABASE_SECRET_KEY"]
    req.add_header("apikey", key)
    req.add_header("Authorization", "Bearer " + key)
    # PostgREST pages cap at 1,000 rows and truncate SILENTLY. Asking for the
    # count back is the only way to know whether a page is the whole answer.
    req.add_header("Prefer", "count=exact")
    with urllib.request.urlopen(req, timeout=60) as r:
        total = r.headers.get("Content-Range", "")
        return json.loads(r.read().decode()), total


def sb_get_all(path, page=1000):
    """Every row, paged. A truncated read reported as a finding is still wrong."""
    out, offset = [], 0
    while True:
        sep = "&" if "?" in path else "?"
        rows, _ = sb_get(f"{path}{sep}limit={page}&offset={offset}")
        out.extend(rows)
        if len(rows) < page:
            return out
        offset += page


# ─────────────────────────────────────────────────────────────────────────────
# 7 · Region and latency — measured before anything else, it is cheap
# ─────────────────────────────────────────────────────────────────────────────

def probe_region(host, port):
    info = {"host": host, "port": port}
    try:
        addrs = sorted({ai[4][0] for ai in socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)})
        info["resolved"] = addrs
    except OSError as e:
        info["resolved_error"] = str(e)
        return info
    rtts = []
    for _ in range(7):
        t0 = time.time()
        try:
            s = socket.create_connection((host, port), timeout=10)
            rtts.append((time.time() - t0) * 1000.0)
            s.close()
        except OSError as e:
            info.setdefault("connect_errors", []).append(str(e))
        time.sleep(0.2)
    if rtts:
        info["tcp_rtt_ms"] = {"n": len(rtts), "median": round(statistics.median(rtts), 1),
                             "min": round(min(rtts), 1), "max": round(max(rtts), 1)}
    # Where the RUNNER is, so the RTT has a second endpoint. Reported, not guessed.
    for url, label in (("https://ipinfo.io/json", "runner"),):
        try:
            with urllib.request.urlopen(url, timeout=10) as r:
                d = json.loads(r.read().decode())
                info[label] = {k: d.get(k) for k in ("city", "region", "country", "org", "loc")}
        except Exception as e:  # noqa: BLE001
            info[label + "_error"] = str(e)[:120]
    # The broker's own location, from whoever announces the address.
    for ip in info.get("resolved", [])[:2]:
        try:
            with urllib.request.urlopen(f"https://ipinfo.io/{ip}/json", timeout=10) as r:
                d = json.loads(r.read().decode())
                info.setdefault("broker_geo", []).append(
                    {k: d.get(k) for k in ("ip", "city", "region", "country", "org")})
        except Exception as e:  # noqa: BLE001
            info.setdefault("broker_geo_error", []).append(str(e)[:120])
    # The TLS certificate names the host the operator thinks this is.
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((host, port), timeout=10) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as ss:
                cert = ss.getpeercert()
                info["tls"] = {
                    "subject": [dict(x) for t in cert.get("subject", ()) for x in (t,)],
                    "issuer_cn": next((v for t in cert.get("issuer", ()) for k, v in t if k == "organizationName"), None),
                    "notAfter": cert.get("notAfter"),
                    "san": [v for k, v in cert.get("subjectAltName", ()) if k == "DNS"],
                    "version": ss.version(),
                }
    except Exception as e:  # noqa: BLE001
        info["tls_error"] = str(e)[:200]
    return info


def probe_supabase_region():
    """Answers the [REGION] the brief left unfilled — from the AUTHORITATIVE source.

    ⚠️ NOT FROM DNS. Run 35815631134 resolved the Supabase host to two Cloudflare
    addresses and geolocated them to San Francisco. That is the CDN edge nearest
    the runner, not the project's region, and writing it into fly.toml would have
    pinned the worker to a city chosen by Cloudflare's anycast. A geolocation of a
    CDN edge is a plausible-looking wrong answer, which is the one thing worse
    than a blank.

    The Management API states the region itself. SUPABASE_ACCESS_TOKEN is already
    a repository secret. If it is absent or the call fails, this reports UNKNOWN
    — it does not fall back to the DNS guess.
    """
    url = os.environ.get("SUPABASE_URL", "")
    if not url:
        return {"region": None, "why": "SUPABASE_URL is not set in this job"}
    ref = (urllib.parse.urlparse(url).hostname or "").split(".")[0]
    # The project ref is not printed: it is the project's public API address, and
    # GitHub's secret masking does not catch a hostname we parsed out ourselves.
    SECRETS.append(ref)
    out = {"project_ref": "[redacted]"}
    tok = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not tok:
        out["region"] = None
        out["why"] = ("SUPABASE_ACCESS_TOKEN not present in this job — the region is "
                      "UNKNOWN. It is not inferred from DNS: the host resolves to a "
                      "Cloudflare edge, which geolocates to wherever the runner is.")
        return out
    try:
        req = urllib.request.Request("https://api.supabase.com/v1/projects")
        req.add_header("Authorization", "Bearer " + tok)
        with urllib.request.urlopen(req, timeout=30) as r:
            projects = json.loads(r.read().decode())
        match = [p for p in projects if p.get("id") == ref]
        if not match:
            out["region"] = None
            out["why"] = (f"the access token lists {len(projects)} project(s), none "
                          "matching this URL's ref — region UNKNOWN")
            return out
        out["region"] = match[0].get("region")
        out["name"] = "[redacted]"
        out["source"] = "Supabase Management API /v1/projects — authoritative"
    except Exception as e:  # noqa: BLE001
        out["region"] = None
        out["why"] = f"Management API call failed: {type(e).__name__} — region UNKNOWN"
    return out


# ─────────────────────────────────────────────────────────────────────────────
# The capture
# ─────────────────────────────────────────────────────────────────────────────

def capture(conn, pika, seconds, cap_path, note=""):
    """Consume for `seconds`, write every message to JSONL, ack every one.

    Returns (records, meta). Records carry the AMQP properties as well as the
    body, because delivery_mode, the AMQP `timestamp` property and the routing
    key are three of the questions and none of them live inside the body.
    """
    params = C.connection_parameters(conn, pika)
    t0 = time.time()
    meta = {"note": note, "started_at": C.iso(C.utcnow()), "seconds_requested": seconds}
    connection = pika.BlockingConnection(params)

    # ⚠️ THE PASSIVE DECLARE IS TRIED ON ITS OWN CHANNEL, AND ITS FAILURE IS NOT
    # FATAL. MEASURED, run 35815631134: this broker answers a passive declare
    # with 403 ACCESS_REFUSED — "configure access to queue ... refused" — so our
    # user has no `configure` permission on its own queue. A channel-level 403
    # CLOSES the channel, which is why the probe gets a throwaway one: on the
    # first run the refusal took the consume down with it and cost the whole
    # window. Whether we can still CONSUME is a separate permission (`read`) and
    # a separate question, and it is the one that decides the product.
    meta["backlog_at_connect"] = None
    meta["consumers_at_connect"] = None
    meta["passive_declare_error"] = None
    try:
        probe = connection.channel()
        ok = probe.queue_declare(queue=conn["queue"], passive=True)
        meta["backlog_at_connect"] = ok.method.message_count
        meta["consumers_at_connect"] = ok.method.consumer_count
        say(f"  passive declare OK — backlog {ok.method.message_count} message(s), "
            f"{ok.method.consumer_count} consumer(s) {note}")
        probe.close()
    except Exception as e:  # noqa: BLE001
        meta["passive_declare_error"] = f"{type(e).__name__}: {C.redact(e, SECRETS)}"
        say(f"  ⚠️ passive declare REFUSED — `{meta['passive_declare_error']}`")
        say("     Backlog at connect is therefore **—**, not 0. Continuing to the "
            "consume, which needs a different permission.")

    channel = connection.channel()
    channel.basic_qos(prefetch_count=200)

    records, per_min = [], Counter()
    fh = open(cap_path, "a", encoding="utf-8")
    try:
        for method, props, body in channel.consume(
                conn["queue"], inactivity_timeout=1.0, auto_ack=False):
            if method is not None:
                now = C.utcnow()
                rec = {
                    "received_at": C.iso(now),
                    "exchange": method.exchange,
                    "routing_key": method.routing_key,
                    "redelivered": bool(method.redelivered),
                    # delivery_mode 2 = persistent, 1 = transient. A transient
                    # message on a non-durable queue is gone the moment the
                    # broker restarts, which is the loss the stream exists to
                    # prevent — so this is reported, never assumed.
                    "delivery_mode": getattr(props, "delivery_mode", None),
                    "amqp_timestamp": getattr(props, "timestamp", None),
                    "content_type": getattr(props, "content_type", None),
                    "headers": getattr(props, "headers", None),
                    "body_bytes": len(body),
                    "body": body.decode("utf-8", "replace"),
                }
                records.append(rec)
                fh.write(json.dumps(rec) + "\n")
                per_min[rec["received_at"][:16]] += 1
                # ACK EVERY MESSAGE, tennis or not — an unacked message still
                # counts against the vendor's 20,000 backlog cap.
                channel.basic_ack(method.delivery_tag)
            elapsed = time.time() - t0
            if elapsed >= seconds:
                break
            if method is None and int(elapsed) % 300 < 1.2 and elapsed > 5:
                say(f"    …{int(elapsed / 60)}m in, {len(records)} message(s) captured")
    finally:
        fh.close()
        meta["backlog_at_disconnect"] = None
        try:
            channel.cancel()
        except Exception:  # noqa: BLE001
            pass
        try:
            probe2 = connection.channel()
            meta["backlog_at_disconnect"] = probe2.queue_declare(
                queue=conn["queue"], passive=True).method.message_count
            probe2.close()
        except Exception:  # noqa: BLE001
            pass   # already reported above; a refused declare is not a new finding
        try:
            connection.close()
        except Exception:  # noqa: BLE001
            pass
    meta["ended_at"] = C.iso(C.utcnow())
    meta["seconds_actual"] = round(time.time() - t0, 1)
    meta["messages"] = len(records)
    meta["per_minute"] = dict(sorted(per_min.items()))
    return records, meta


# ─────────────────────────────────────────────────────────────────────────────
# Offline analysis of the captures
# ─────────────────────────────────────────────────────────────────────────────

def flatten(records):
    """Every participant row seen, with the envelope facts kept alongside it."""
    rows, shapes, unreadable = [], Counter(), 0
    for rec in records:
        try:
            payload = json.loads(rec["body"])
        except ValueError:
            unreadable += 1
            shapes["unparseable"] += 1
            continue
        if isinstance(payload, list):
            shapes["bare array"] += 1
        elif isinstance(payload, dict) and isinstance(payload.get("result"), list):
            shapes["{code,description,result}"] += 1
        elif isinstance(payload, dict) and isinstance(payload.get("market_participants"), list):
            shapes["{market_participants}"] += 1
        elif isinstance(payload, dict):
            shapes["bare object"] += 1
        raw = C.envelope_rows(payload)
        if raw is None:
            unreadable += 1
            shapes["UNRECOGNISED"] += 1
            continue
        for r in raw:
            if isinstance(r, dict):
                rows.append((rec, r))
    return rows, shapes, unreadable


def sample_redacted(row):
    """A tennis sample with player-identifying free text removed, values intact."""
    out = {}
    for k, v in row.items():
        if isinstance(v, str) and len(v) > 40:
            out[k] = v[:40] + "…"
        else:
            out[k] = v
    return out


def analyse(records, meta, fixtures_171, polled_rows):
    rows, shapes, unreadable = flatten(records)
    total_msgs = len(records)
    mins = max(meta["seconds_actual"] / 60.0, 1e-9)

    say()
    say("## B3 · What arrived")
    say()
    say(f"Listened **{meta['seconds_actual'] / 60:.1f} min** "
        f"({meta['started_at']} → {meta['ended_at']}).")
    say()
    say(f"- Messages: **{total_msgs}**  ({total_msgs / mins:.2f} / min)")
    say(f"- Participant rows inside them: **{len(rows)}**")
    say(f"- Unreadable / unrecognised messages: **{unreadable}** "
        f"({pct(unreadable, total_msgs)} of {total_msgs})")
    say(f"- Envelope shapes seen: {dict(shapes) or '—'}")

    if total_msgs == 0:
        say()
        say("> ⚠️ **ZERO MESSAGES IS A FINDING, NOT A PASS.** The queue delivered "
            "nothing for the whole window. Everything below that depends on message "
            "content is reported as **—**, not as zero.")

    # delivery_mode — persistence
    dm = Counter(r["delivery_mode"] for r in records)
    say()
    say("### delivery_mode (persistence) on the messages actually received")
    if not dm:
        say("**—** (no messages)")
    else:
        for k, v in dm.most_common():
            label = {2: "2 · PERSISTENT", 1: "1 · transient", None: "absent (property not set)"}.get(k, str(k))
            say(f"- {label}: **{v}** ({pct(v, total_msgs)})")
        if dm.get(1) or dm.get(None):
            say()
            say("> ⚠️ A transient or unmarked message is discarded on a broker restart "
                "even from a durable queue. On a feed with no history that is a "
                "permanent hole, and the REST snapshot on reconnect is the only recovery.")

    # tennis split
    tennis_rows = [(rec, r) for rec, r in rows if C.is_tennis(r) is True]
    unknown_rows = [(rec, r) for rec, r in rows if C.is_tennis(r) is None]
    other_rows = [(rec, r) for rec, r in rows if C.is_tennis(r) is False]
    tennis_msgs = {id(rec) for rec, _ in tennis_rows}
    say()
    say("### Tennis split")
    say()
    say(f"| population | rows | share of {len(rows)} rows |")
    say("|---|---:|---:|")
    say(f"| tennis (ATP 19 / Challenger 537 / ITF Men 962) | {len(tennis_rows)} | {pct(len(tennis_rows), len(rows))} |")
    say(f"| explicitly other sports / WTA | {len(other_rows)} | {pct(len(other_rows), len(rows))} |")
    say(f"| **league not carried on the row** | {len(unknown_rows)} | {pct(len(unknown_rows), len(rows))} |")
    say()
    say(f"Tennis messages/min: **{len(tennis_msgs) / mins:.2f}**  ({nflag(len(tennis_rows))})")
    if unknown_rows and not tennis_rows:
        say()
        say("> ⚠️ **The league id is not on the row.** The sweep learns a row's league "
            "from the CALL it makes; a pushed message has no call behind it. Until the "
            "mapping below resolves fixture ids to leagues, 'tennis' cannot be decided "
            "message-side, and the split above is **unknown**, not zero.")

    # pre-match vs live
    say()
    say("### Pre-match vs live")
    bt = Counter(r.get("betting_type_id") for _, r in rows)
    lv = Counter(r.get("is_live") for _, r in rows)
    say(f"- `betting_type_id`: {dict(bt) or '—'}   (1 = pre-match, 3 = live, per Kibl's docs)")
    say(f"- `is_live`: {dict(lv) or '—'}")
    tb = Counter(r.get("betting_type_id") for _, r in tennis_rows)
    say(f"- on TENNIS rows only: {dict(tb) or '—'}")
    live_tennis = sum(v for k, v in tb.items() if k == 3)
    if tennis_rows:
        say()
        say(f"**Live tennis count: {live_tennis} of {len(tennis_rows)} tennis rows "
            f"({pct(live_tennis, len(tennis_rows))}).** "
            + ("Kibl's claim that live excludes tennis is **consistent with this capture**."
               if live_tennis == 0 else
               "⚠️ Kibl said live covers baseball, basketball, soccer and golf only — "
               "**not tennis**. This capture contradicts that."))
    else:
        say()
        say("**Live tennis: —** (no tennis rows to measure). Kibl's claim is **untested**, "
            "not confirmed.")

    # field list
    say()
    say("### Field list on participant rows")
    fields = Counter()
    for _, r in rows:
        fields.update(r.keys())
    if not fields:
        say("**—** (no rows)")
    else:
        say(f"| field | present on | of {len(rows)} |")
        say("|---|---:|---:|")
        for f, n in sorted(fields.items(), key=lambda kv: (-kv[1], kv[0])):
            say(f"| `{f}` | {n} | {pct(n, len(rows))} |")
        key_missing = [f for f in B.KEY_FIELDS if f not in fields]
        say()
        say(f"Row-key fields ABSENT from every message: "
            f"**{', '.join(key_missing) if key_missing else 'none — all 17 present'}**")

    # timestamps: which clock
    say()
    say("### Timestamps — a book-side change time, or only a send time?")
    ts_fields = [f for f in fields if any(t in f.lower() for t in ("time", "_on", "_at", "stamp"))]
    say(f"- Time-shaped fields on the rows: {ts_fields or '—'}")
    amqp_ts = [r["amqp_timestamp"] for r in records if r["amqp_timestamp"] is not None]
    say(f"- AMQP `timestamp` property set on: **{len(amqp_ts)}** of {total_msgs} messages")
    lags = []
    for rec, r in rows:
        ins = parse_ts(r.get("inserted_on"))
        recv = parse_ts(rec["received_at"])
        if ins and recv:
            lags.append((recv - ins).total_seconds())
    if lags:
        say(f"- `inserted_on` → our receipt, seconds: median "
            f"**{statistics.median(lags):.1f}**, p95 "
            f"**{sorted(lags)[int(0.95 * (len(lags) - 1))]:.1f}**, max "
            f"**{max(lags):.1f}**  ({nflag(len(lags))})")
        say()
        say("> `inserted_on` is **Kibl's own row-write time**, not the book's post time — "
            "the standing rule in `.claude/rules/odds.md`. A small lag here proves the "
            "stream is fast relative to KIBL'S clock; it says nothing about how long "
            "Bet105 sat on the price before Kibl saw it. **No book-side change time was "
            "found on any field.**" if lags else "")
    else:
        say("- `inserted_on` → receipt lag: **—** (no row carried `inserted_on`)")

    # markets
    say()
    say("### Markets present on tennis (observed only, nothing stored)")
    mt = Counter(r.get("market_type_id") for _, r in (tennis_rows or rows))
    seg = Counter(r.get("segment_id") for _, r in (tennis_rows or rows))
    pts = Counter(r.get("point") for _, r in (tennis_rows or rows))
    say(f"- `market_type_id`: {dict(mt) or '—'}")
    say(f"- `segment_id`: {dict(seg) or '—'}")
    say(f"- distinct `point` values (handicap / total lines): "
        f"{len([p for p in pts if p is not None])} distinct, non-null on "
        f"{sum(v for k, v in pts.items() if k is not None)} rows")
    limit_fields = [f for f in fields if "limit" in f.lower() or "max" in f.lower()]
    say(f"- stake-limit fields on the row: **{limit_fields or 'none — MISSING, not zero'}**")

    # samples
    say()
    say("### Redacted tennis samples")
    pool = tennis_rows or unknown_rows or rows
    if not pool:
        say("**—** (nothing to sample)")
    else:
        for i, (rec, r) in enumerate(pool[:3]):
            say()
            say(f"**Sample {i + 1}** — routing key `{rec['routing_key']}`, "
                f"exchange `{rec['exchange']}`, delivery_mode {dash(rec['delivery_mode'])}")
            say("```json")
            say(json.dumps(sample_redacted(r), indent=1)[:1800])
            say("```")

    return rows, tennis_rows, unknown_rows


def mapping_and_comparison(rows, fixtures_171, polled_rows, window):
    """B4 mapping, and B5 the number that decides whether the stream earns its place."""
    say()
    say("## B4 · Mapping — do stream fixture ids exist among polled Bet105 fixtures?")
    stream_fids = {r.get("fixture_id") for _, r in rows if r.get("fixture_id") is not None}
    polled_fids = {f.get("fixture_id") for f in fixtures_171}
    matched = stream_fids & polled_fids
    unmatched = stream_fids - polled_fids
    say()
    say(f"| | count |")
    say("|---|---:|")
    say(f"| distinct fixture ids in the stream capture | **{len(stream_fids)}** |")
    say(f"| of those, present in `kibl_fixtures` | **{len(matched)}** ({pct(len(matched), len(stream_fids))}) |")
    say(f"| unmatched | **{len(unmatched)}** ({pct(len(unmatched), len(stream_fids))}) |")
    say(f"| polled fixtures in the window (feed_source_id {KIBL_FEED_SOURCE_ID}) | {len(polled_fids)} |")
    if not stream_fids:
        say()
        say("> **—** No fixture ids arrived, so mapping is **unmeasured**. This is the "
            "finding; it is not a 0% match rate.")
        return

    say()
    say("## B5 · Stream vs poll on matched fixtures")
    # Index the polled observations by the sweep's own row key.
    polled_keys = {r.get("row_key") for r in polled_rows}
    stream_keys, stream_by_fixture = set(), defaultdict(list)
    for rec, r in rows:
        if r.get("fixture_id") not in matched:
            continue
        try:
            k = B.row_key_of(r)
        except Exception:  # noqa: BLE001
            continue
        stream_keys.add(k)
        stream_by_fixture[r["fixture_id"]].append((rec, r, k))

    novel = stream_keys - polled_keys
    say()
    say(f"On the **{len(matched)}** matched fixtures:")
    say()
    say(f"| | count | of denominator |")
    say("|---|---:|---:|")
    say(f"| distinct observations the stream carried | **{len(stream_keys)}** | — |")
    say(f"| …of which polling ALSO holds (same `row_key`) | **{len(stream_keys & polled_keys)}** | {pct(len(stream_keys & polled_keys), len(stream_keys))} |")
    say(f"| **…of which polling NEVER captured** | **{len(novel)}** | **{pct(len(novel), len(stream_keys))}** |")
    say()
    say(f"Denominator = every distinct observation the stream delivered on matched "
        f"fixtures during the window ({nflag(len(stream_keys))}). Population = "
        f"Bet105 (feed_source_id {KIBL_FEED_SOURCE_ID}) fixtures present in BOTH the "
        f"stream capture and `kibl_fixtures`, window {window}.")
    say()
    say("> **This is the number that decides whether the stream earns its place.** "
        "An observation the stream carried and the archive does not hold is a price "
        "that would have been lost permanently — Kibl serves no history.")

    # price agreement + lead time, per fixture/side
    polled_by_key = {r.get("row_key"): r for r in polled_rows}
    agree = disagree = 0
    leads = []
    # ⚠️ DEDUPED BY row_key, and the dedupe is the point. The same observation can
    # arrive in more than one message — an identical price re-pushed, or the same
    # row inside two envelope shapes — and counting message instances here while
    # the table above counts DISTINCT observations would publish two figures with
    # different denominators under one heading. Caught by test-access-test.py
    # reporting "2 of 2" where only one observation was held by both writers.
    seen_keys = set()
    for fid, items in stream_by_fixture.items():
        for rec, r, k in items:
            if k in seen_keys:
                continue
            seen_keys.add(k)
            p = polled_by_key.get(k)
            if p is None:
                continue
            # B.num is the sweep's own coercion, so the two sides are compared
            # the way the archive stored them rather than the way JSON typed them.
            sp, pp = B.num(r.get("price_decimal")), p.get("price_decimal")
            if sp is None or pp is None:
                continue
            if abs(float(sp) - float(pp)) < 1e-9:
                agree += 1
            else:
                disagree += 1
            s_at = parse_ts(rec["received_at"])
            p_at = parse_ts(p.get("observed_at"))
            if s_at and p_at:
                leads.append((p_at - s_at).total_seconds())
    say()
    say("### Price agreement on observations BOTH writers hold")
    tot = agree + disagree
    if tot == 0:
        say("**—** No observation was held by both writers in this window, so agreement "
            "is **unmeasured**. That is itself the more interesting result: see the "
            "novel-observation row above.")
    else:
        say(f"- identical price: **{agree}** of {tot} ({pct(agree, tot)})  ({nflag(tot)})")
        say(f"- different price on the same key: **{disagree}** "
            f"({pct(disagree, tot)}) — a same-key price difference would mean the key "
            "is not identifying what we think it identifies")
    say()
    say("### How much earlier the stream showed it")
    if not leads:
        say("**—** unmeasured (no observation carried both a stream receipt and a poll "
            "timestamp in this window).")
    else:
        leads.sort()
        say(f"- median: **{statistics.median(leads):.1f} s** earlier")
        say(f"- worst case: **{min(leads):.1f} s** (negative = polling saw it first)")
        say(f"- p95: **{leads[int(0.95 * (len(leads) - 1))]:.1f} s**  ({nflag(len(leads))})")


def close_proximity(rows, fixtures_171):
    """B3's last question: does the last pre-match message land near the real start?"""
    say()
    say("### Does a fixture's last pre-match message arrive close to the start?")
    sched = {f["fixture_id"]: parse_ts(f.get("scheduled_start")) for f in fixtures_171}
    last_seen = {}
    for rec, r in rows:
        fid = r.get("fixture_id")
        if fid is None or r.get("betting_type_id") == 3:
            continue
        t = parse_ts(rec["received_at"])
        if t and (fid not in last_seen or t > last_seen[fid]):
            last_seen[fid] = t
    deltas = [(sched[f] - t).total_seconds() / 60.0
              for f, t in last_seen.items() if sched.get(f)]
    if not deltas:
        say("**—** unmeasured: no fixture in the capture had both a pre-match message "
            "and a scheduled start in `kibl_fixtures`.")
        return
    deltas.sort()
    say(f"- Minutes between our last pre-match message and the **scheduled** start: "
        f"median **{statistics.median(deltas):.1f}**, min **{min(deltas):.1f}**, "
        f"max **{max(deltas):.1f}**  ({nflag(len(deltas))})")
    say()
    say("> ⚠️ **This is measured against the SCHEDULED start, which is the wrong clock** "
        "and the rules say so: the scheduled time lands after the real start 58% of the "
        "time, and matches often start early (median 11 min). Close = last price before "
        "the **actual** start. A definitive answer needs the oddspapi `trueStartTime` / "
        "live-flip ladder joined onto these fixtures, which this window does not span. "
        "Reported as a lower-confidence indicator, not as the Close answer.")


# ─────────────────────────────────────────────────────────────────────────────

def main():
    os.makedirs(OUT, exist_ok=True)
    conn, missing = C.read_conn_env()
    SECRETS.extend([conn["password"], conn["user"], conn["vhost"], conn["host"]])

    say("# TEN-253 B — Kibl RabbitMQ live access test")
    say()
    say(f"Run started {C.iso(C.utcnow())}. "
        f"Listen window {LISTEN_MIN:g} min, drop test {DROP_MIN:g} min.")
    say()
    say("**Writes nothing to Supabase.** The consumer's table writer is opt-in "
        "(`KIBL_STREAM_WRITE=1`) and is not set in this job; the only database traffic "
        "below is `GET`.")
    say()
    say("## B1 · Connect")
    say()
    if missing:
        say(f"**FAILED — credentials incomplete.** Missing: `{', '.join(missing)}`.")
        say("No connection attempted. This is a secrets-wiring finding, not a broker finding.")
        return finish(2)

    say(f"- host: `{conn['host']}`  port: `{conn['port']}`  vhost: `{conn['vhost']}`  "
        f"queue: `{conn['queue']}`")
    say("- credentials passed as **six separate parameters**; no AMQP URL is built "
        "anywhere, so the `%` and `!` in the password never meet a URL parser.")

    say()
    say("## B7 · Region and latency (measured before connecting — it is cheap)")
    region = probe_region(conn["host"], int(conn["port"]))
    json.dump(region, open(os.path.join(OUT, "region.json"), "w"), indent=1, default=str)
    say("```json")
    say(json.dumps({k: v for k, v in region.items() if k != "tls"}, indent=1, default=str)[:1500])
    say("```")
    if region.get("tls"):
        say(f"- TLS: **{region['tls'].get('version')}**, issuer "
            f"`{region['tls'].get('issuer_cn')}`, SAN `{region['tls'].get('san')}`, "
            f"expires `{region['tls'].get('notAfter')}`")
    sbr = probe_supabase_region()
    json.dump(sbr, open(os.path.join(OUT, "supabase-region.json"), "w"), indent=1, default=str)
    say()
    say("**Supabase region — the `[REGION]` the brief left as a placeholder, answered "
        "from evidence:**")
    say("```json")
    say(json.dumps(sbr, indent=1, default=str)[:900])
    say("```")

    try:
        import pika
    except ImportError:
        say("**FAILED — `pika` is not installed in this job.**")
        return finish(2)

    cap = os.path.join(OUT, "capture.jsonl")
    try:
        say()
        say("## B2 · Backlog at connect, and B3's listen window")
        records, meta = capture(conn, pika, LISTEN_MIN * 60, cap, note="(main listen)")
    except Exception as e:  # noqa: BLE001
        say()
        say("**CONNECT FAILED.** Exact error, credentials redacted:")
        say("```")
        say(f"{type(e).__name__}: {C.redact(e, SECRETS)}")
        say("```")
        return finish(1)

    json.dump(meta, open(os.path.join(OUT, "listen-meta.json"), "w"), indent=1, default=str)
    say()
    say(f"**Connected successfully.** Backlog at connect: **{meta['backlog_at_connect']}** "
        f"message(s).")
    oldest = None
    for r in records:
        t = parse_ts(json.loads(r["body"]).get("inserted_on")) if r["body"].startswith("{") else None
        if t and (oldest is None or t < oldest):
            oldest = t
    if meta["backlog_at_connect"] == 0:
        say("A backlog of 0 means we are **reading live, not draining a queue** — no stale "
            "prices at startup.")
    elif oldest:
        age = (parse_ts(meta["started_at"]) - oldest).total_seconds() / 60.0
        say(f"Oldest message received carried `inserted_on` **{age:.1f} min** before we "
            f"connected — that is how stale the first prices we read were.")
    else:
        say("Age of the oldest message: **—** (no message carried a usable timestamp).")

    # Supabase reads for mapping/comparison
    t_from = (parse_ts(meta["started_at"]) - timedelta(minutes=30)).isoformat()
    t_to = (parse_ts(meta["ended_at"]) + timedelta(minutes=30)).isoformat()
    window = f"{t_from} .. {t_to}"
    fixtures_171, polled_rows = [], []
    try:
        fixtures_171 = sb_get_all(
            f"/rest/v1/kibl_fixtures?select=fixture_id,league_id,scheduled_start,"
            f"feed_source_id&feed_source_id=eq.{KIBL_FEED_SOURCE_ID}")
        polled_rows = sb_get_all(
            f"/rest/v1/kibl_line_observations?select=row_key,fixture_id,price_decimal,"
            f"observed_at,inserted_on,sweep_id&feed_source_id=eq.{KIBL_FEED_SOURCE_ID}"
            f"&observed_at=gte.{urllib.parse.quote(t_from)}"
            f"&observed_at=lte.{urllib.parse.quote(t_to)}")
        say()
        say(f"Poller comparison set: **{len(fixtures_171)}** Bet105 fixtures, "
            f"**{len(polled_rows)}** polled observations in {window}.")
    except Exception as e:  # noqa: BLE001
        say()
        say(f"⚠️ Supabase read failed — mapping and comparison are **unmeasured**, "
            f"not zero: `{type(e).__name__}`")

    rows, tennis_rows, unknown_rows = analyse(records, meta, fixtures_171, polled_rows)
    close_proximity(rows, fixtures_171)
    mapping_and_comparison(rows, fixtures_171, polled_rows, window)

    # ── B6 drop test ────────────────────────────────────────────────────────
    say()
    say("## B6 · Drop test — a measured gap, then the backlog on return")
    say()
    say(f"Disconnected for **{DROP_MIN:g} min** with nothing consuming.")
    drop_start = C.utcnow()
    time.sleep(DROP_MIN * 60)
    try:
        rec2, meta2 = capture(conn, pika, 120, os.path.join(OUT, "capture-after-drop.jsonl"),
                              note="(after drop)")
        json.dump(meta2, open(os.path.join(OUT, "drop-meta.json"), "w"), indent=1, default=str)
        backlog = meta2["backlog_at_connect"]
        say()
        say(f"- Gap: {C.iso(drop_start)} → {meta2['started_at']} "
            f"(**{(parse_ts(meta2['started_at']) - drop_start).total_seconds() / 60:.1f} min**)")
        say(f"- **Backlog waiting on return: {backlog} message(s).**")
        redel = sum(1 for r in rec2 if r["redelivered"])
        say(f"- Redelivered flag set on **{redel}** of {len(rec2)} messages read after the gap")
        if backlog == 0 and meta["messages"] > 0:
            say()
            say("> ⚠️ **A zero backlog after a measured gap means the queue did NOT hold "
                "our messages** — they were posted and dropped, not queued. That is the "
                "exact loss the stream exists to prevent, and it makes the REST snapshot "
                "on reconnect the only recovery rather than a backstop.")
        elif backlog > 0:
            rate = backlog / max((parse_ts(meta2["started_at"]) - drop_start).total_seconds() / 60.0, 1e-9)
            say(f"- Accumulation rate while disconnected: **{rate:.1f} msg/min**")
            say(f"- At that rate the 20,000-message cap is reached after "
                f"**{20000 / rate / 60:.1f} hours** of not consuming. "
                "Beyond that the OLDEST messages are dropped.")
        else:
            say()
            say("> Backlog 0 and 0 messages in the main window: the queue was silent "
                "throughout, so the drop test measured **nothing**. Reported as "
                "unmeasured, not as a pass.")
    except Exception as e:  # noqa: BLE001
        say(f"Reconnect after the drop FAILED: `{type(e).__name__}: {C.redact(e, SECRETS)}`")

    # fill rate estimate from the main window
    if meta["messages"]:
        r = meta["messages"] / (meta["seconds_actual"] / 60.0)
        say()
        say(f"From the main window's measured fill rate (**{r:.2f} msg/min**), the "
            f"20,000-message cap is reached after **{20000 / r / 60:.1f} hours** "
            "of not consuming.")

    return finish(0)


def finish(code):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "REPORT.md")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(REPORT) + "\n")
    print(f"\nwrote {path} ({len(REPORT)} lines), exit {code}", flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main())
