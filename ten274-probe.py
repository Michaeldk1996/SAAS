#!/usr/bin/env python3
"""TEN-274 — read-only Kibl capability probe (REST only).

Report, don't build. This script:
  * NEVER connects to RabbitMQ. The live Now worker (Fly, kibl-stream) is the
    one consumer of our single named queue; a second consumer would be served
    round-robin and take messages away from the live Now feature.
  * NEVER writes to Supabase. Supabase is read with GET only, to measure the
    stream's own latency (kibl_now_history) and card-row write rate.
  * Calls Kibl REST at <= 1 call / 1.25 s (kibl_client pacing), live poll at
    POLL_S (default 3 s, Kibl's own recommended /info/markets cadence).

Output: $TEN274_OUT/{inventory.json, live-obs.jsonl.gz, supabase.json, report.json}
"""
import collections
import gzip
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kibl_client import KiblClient  # noqa: E402

OUT = os.environ.get("TEN274_OUT", "ten274-out")
POLL_MIN = float(os.environ.get("TEN274_POLL_MIN", "60"))
POLL_S = float(os.environ.get("TEN274_POLL_S", "3"))
FSID = 171          # Bet105, the one book on our entitlement (re-read below)
ATP = 19
os.makedirs(OUT, exist_ok=True)


def now():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def pts(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None


def vendor_msg(p):
    if isinstance(p, dict) and ("description" in p or "code" in p) and not isinstance(p.get("result"), list):
        return f"{p.get('code')}: {str(p.get('description'))[:160]}"
    return None


def sample(rows, n=3):
    return rows[:n]


def keyset(rows):
    ks = collections.Counter()
    for r in rows:
        if isinstance(r, dict):
            ks.update(r.keys())
    return dict(ks)


c = KiblClient(verbose=True)
c.authenticate()
inv = {"started_utc": iso(now()), "calls": {}}


def call(label, path, params=None, keep=5):
    p, meta = c.get(path, params or {})
    rows = KiblClient.rows(p)
    inv["calls"][label] = {"path": path, "params": params or {}, "status": meta.get("status"),
                           "bytes": meta.get("bytes"), "rows": len(rows),
                           "vendor_msg": vendor_msg(p), "keys": keyset(rows),
                           "sample": sample(rows, keep), "rate_headers": meta.get("rate_headers")}
    return p, rows


# ── A. vocabularies + entitlement ────────────────────────────────────────────
for lab, path in [("sportsbooks", "/reference/sportsbooks"), ("market_types", "/reference/market-types"),
                  ("segments", "/reference/segments"), ("betting_types", "/reference/betting-types"),
                  ("market_statuses", "/reference/market-statuses"), ("fixture_types", "/reference/fixture-types"),
                  ("feed_types", "/reference/feed-types"), ("sports", "/reference/sports")]:
    call(lab, path, keep=500)
call("periods_tennis", "/reference/periods", {"sport_id": 5}, keep=200)
_, leagues = call("leagues", "/reference/leagues", keep=0)
inv["calls"]["leagues"]["sample"] = [l for l in leagues if isinstance(l, dict) and l.get("sport_id") == 5]
books = inv["calls"]["sportsbooks"]["sample"]
fsids = sorted({b.get("feed_source_id") for b in books if isinstance(b, dict) and b.get("feed_source_id")})
inv["entitled_feed_source_ids"] = fsids

# ── B. today's ATP fixtures + every market on them ──────────────────────────
t0 = now()
day0 = t0.replace(hour=0, minute=0, second=0, microsecond=0)
win_s, win_e = day0 - timedelta(hours=12), day0 + timedelta(days=1)
_, fx = call("fixtures_atp", "/info/fixtures", {"league_id": ATP, "start_time": iso(win_s), "end_time": iso(win_e)}, keep=500)
fixtures = {f["fixture_id"]: f for f in fx if isinstance(f, dict) and f.get("fixture_id")}
call("fixtures_states_atp", "/info/fixtures-states", {"league_id": ATP}, keep=50)
call("fixtures_states_bare", "/info/fixtures-states", {}, keep=10)
call("markets_last_updated", "/info/markets-last-updated", {}, keep=50)
call("markets_alerts_atp", "/info/markets-alerts", {"league_id": ATP, "feed_source_id": FSID}, keep=50)
call("outcomes_bare", "/info/outcomes", {}, keep=10)
some_fid = next(iter(fixtures), None)
if some_fid:
    call("outcomes_fixture", "/info/outcomes", {"fixture_id": some_fid}, keep=50)
    call("segments_scores_fixture", "/info/fixtures-segments-scores", {"fixture_id": some_fid}, keep=50)
    call("mapping_donbest_fixture", "/mapping/donbest", {"fixture_id": some_fid}, keep=20)
    call("mapping_espn_fixture", "/mapping/espn", {"fixture_id": some_fid}, keep=20)
call("mapping_donbest_league", "/mapping/donbest", {"league_id": ATP}, keep=20)

inventory_rows = []
for lab, extra in [("mk_all", {}), ("mk_opener", {"is_opener": True}), ("mk_bt3", {"betting_type_id": 3}),
                   ("mk_bt2", {"betting_type_id": 2}), ("mk_live", {"is_live": True}),
                   ("mk_nonmain", {"is_main": False})]:
    p, meta = c.markets(feed_source_id=FSID, league_id=ATP, start_time=iso(win_s), end_time=iso(win_e), **extra)
    rows = KiblClient.market_participants(p)
    inv["calls"][lab] = {"status": meta.get("status"), "rows": len(rows), "vendor_msg": vendor_msg(p),
                         "keys": keyset(rows), "sample": sample(rows, 3)}
    for r in rows:
        r["_pull"] = lab
    inventory_rows += rows
# No window: does it return in-play fixtures that a start window would miss?
p, meta = c.markets(feed_source_id=FSID, league_id=ATP)
rows = KiblClient.market_participants(p)
inv["calls"]["mk_nowindow"] = {"status": meta.get("status"), "rows": len(rows), "vendor_msg": vendor_msg(p)}
for r in rows:
    r["_pull"] = "mk_nowindow"
inventory_rows += rows
with gzip.open(os.path.join(OUT, "inventory-rows.jsonl.gz"), "wt") as fh:
    for r in inventory_rows:
        fh.write(json.dumps(r) + "\n")
inv["fixtures"] = {str(k): v for k, v in fixtures.items()}
json.dump(inv, open(os.path.join(OUT, "inventory.json"), "w"), indent=1, default=str)
print(f"[inventory] fixtures={len(fixtures)} market rows={len(inventory_rows)}")

# ── C. Supabase read-only: stream latency + card-row write rate ─────────────
sb = {}
SB_URL, SB_KEY = os.environ.get("SUPABASE_URL", "").strip().rstrip("/"), os.environ.get("SUPABASE_SECRET_KEY", "").strip()


def sb_get(path):
    req = urllib.request.Request(SB_URL + path, headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:300]


if SB_URL and SB_KEY:
    since = iso(t0 - timedelta(hours=24))
    sb["history"] = sb_get(f"/rest/v1/kibl_now_history?select=kibl_inserted_on,received_at,source,card_key,side_key,price"
                           f"&received_at=gte.{since}&order=received_at.desc&limit=20000")
    sb["heartbeat_1"] = sb_get("/rest/v1/kibl_now_price?kind=eq.heartbeat&select=written_at,note")
    sb["cards"] = sb_get("/rest/v1/kibl_now_card?select=*&limit=500")
json.dump(sb, open(os.path.join(OUT, "supabase.json"), "w"), default=str)

# ── D. live poll: every change Kibl shows on in-play ATP rows ────────────────
obs_path = os.path.join(OUT, "live-obs.jsonl.gz")
seen = {}
polls = []
end = time.time() + POLL_MIN * 60
with gzip.open(obs_path, "wt") as fh:
    while time.time() < end:
        t_req = time.time()
        p, meta = c.markets(feed_source_id=FSID, league_id=ATP, betting_type_id=3)
        t_rcv = now()
        rows = KiblClient.market_participants(p)
        polls.append({"t": iso(t_rcv), "status": meta.get("status"), "rows": len(rows),
                      "secs": meta.get("seconds"), "vendor_msg": vendor_msg(p) if not rows else None})
        new = 0
        for r in rows:
            k = (r.get("fixture_id"), r.get("market_type_id"), r.get("segment_id"), r.get("fixture_participant_id"),
                 r.get("side_id"), r.get("point"), r.get("alt_id"), r.get("betting_type_id"), r.get("inserted_on"),
                 r.get("price_decimal"), r.get("market_status_id"), r.get("is_current"))
            if k in seen:
                continue
            seen[k] = 1
            new += 1
            r["_observed_at"] = iso(t_rcv)
            fh.write(json.dumps(r) + "\n")
        polls[-1]["new"] = new
        if len(polls) % 20 == 0:
            print(f"[poll] {len(polls)} rows={len(rows)} new={new} distinct={len(seen)}")
        if len(polls) == 1 or len(polls) % 200 == 0:
            if SB_URL and SB_KEY:
                sb.setdefault("heartbeats", []).append(sb_get("/rest/v1/kibl_now_price?kind=eq.heartbeat&select=written_at,note"))
        wait = POLL_S - (time.time() - t_req)
        if wait > 0:
            time.sleep(wait)

# second pass of fixtures-states / fixtures for the live window
call("fixtures_states_atp_end", "/info/fixtures-states", {"league_id": ATP}, keep=50)
call("fixtures_atp_end", "/info/fixtures", {"league_id": ATP, "start_time": iso(win_s), "end_time": iso(win_e)}, keep=500)
if SB_URL and SB_KEY:
    sb["heartbeat_2"] = sb_get("/rest/v1/kibl_now_price?kind=eq.heartbeat&select=written_at,note")
json.dump(sb, open(os.path.join(OUT, "supabase.json"), "w"), default=str)
inv["polls"] = polls
inv["kibl_calls_total"] = c.calls
inv["kibl_bytes_total"] = c.bytes_down
inv["rate_headers_seen"] = sorted({json.dumps(m.get("rate_headers")) for m in c.call_log if m.get("rate_headers")})
inv["ended_utc"] = iso(now())
json.dump(inv, open(os.path.join(OUT, "inventory.json"), "w"), indent=1, default=str)
print(f"[done] polls={len(polls)} distinct live observations={len(seen)} calls={c.calls}")
