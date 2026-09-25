#!/usr/bin/env python3
"""TEN-287 — odds-api.io Betfair Exchange + Superbet probe (tennis). READ-ONLY.

Runs only in GitHub Actions with the key from the ODDS_API_IO_KEY secret. Never
prints the key or a URL containing it. REST only (no WebSocket). Never changes the
bookmaker selection (GET /bookmakers/selected only). out/probe.json is ENCRYPTED to
tools/ten287-pub.pem before upload (this repo is public); the log carries counts only.
"""
import gzip, json, os, secrets, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

BASE = "https://api.odds-api.io/v3"
KEY = os.environ.get("ODDS_API_IO_KEY", "").strip().strip('"').strip("'").strip()
if KEY.lower().startswith("apikey="): KEY = KEY[7:]
if not KEY:
    print("ODDS_API_IO_KEY missing"); sys.exit(2)

OUT = {"calls": [], "phases": {}}
STOP_REMAINING = 1500
WANT = ["Betfair Exchange", "Superbet"]


def get(path, **params):
    assert not path.startswith("/ws")
    q = dict(params); q["apiKey"] = KEY
    req = urllib.request.Request(BASE + path + "?" + urllib.parse.urlencode(q, safe=","),
                                 headers={"User-Agent": "ten287-probe", "Accept-Encoding": "identity"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            status = r.status; hdr = {k.lower(): v for k, v in r.headers.items()}; raw = r.read()
    except urllib.error.HTTPError as e:
        status = e.code; hdr = {k.lower(): v for k, v in e.headers.items()}; raw = e.read()
    except Exception as e:  # never echo the URL
        OUT["calls"].append({"path": path, "error": type(e).__name__}); return None, {}, None
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    try:
        body = json.loads(raw.decode("utf-8"))
    except Exception:
        body = {"_nonjson": raw[:300].decode("utf-8", "replace")}
    OUT["calls"].append({"path": path, "params": dict(params), "status": status,
                         "ms": int((time.time() - t0) * 1000),
                         "hdr": {k: v for k, v in hdr.items() if k.startswith("x-")}})
    return status, hdr, body


def remaining():
    for c in reversed(OUT["calls"]):
        v = c.get("hdr", {}).get("x-ratelimit-remaining")
        if v is not None:
            try: return int(v)
            except ValueError: return None
    return None


def budget_ok():
    r = remaining(); return r is None or r > STOP_REMAINING


def iso(dt): return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def events(**kw):
    allev, skip = [], 0
    while True:
        s, h, b = get("/events", sport="tennis", limit=5000, skip=skip, **kw)
        if s != 200 or not isinstance(b, list): return s, allev, b
        allev += b
        if len(b) < 5000: return s, allev, None
        skip += 5000


now = datetime.now(timezone.utc)
OUT["startedAt"] = iso(now)

# 1. selection (read-only GET)
s, h, b = get("/bookmakers/selected")
OUT["phases"]["selected"] = {"status": s, "body": b}
print("1 selected", s, b.get("bookmakers") if isinstance(b, dict) else "-")
sel = (b or {}).get("bookmakers") if isinstance(b, dict) else None
OURS = [x for x in WANT if sel and x in sel]

# bookmaker metadata (unmetered)
s, h, books = get("/bookmakers")
OUT["phases"]["bookmaker_meta"] = [x for x in books if isinstance(x, dict) and x.get("name") in WANT] if isinstance(books, list) else {"status": s, "body": books}

# 2. events: calendar day 26 Sep (UTC, wide) for the baseline; upcoming window for odds
s, evday, err = events(**{"from": "2026-09-25T18:00:00Z", "to": "2026-09-27T06:00:00Z"})
OUT["phases"]["events_day"] = {"status": s, "n": len(evday), "err": err, "events": evday}
s, evup, err = events(**{"from": iso(now - timedelta(hours=4)), "to": iso(now + timedelta(hours=48))})
OUT["phases"]["events_upcoming"] = {"status": s, "n": len(evup), "err": err, "events": evup}
print("2 events day", len(evday), "upcoming", len(evup))
perbook = {}
for bk in WANT:
    s, h, b = get("/events", sport="tennis", bookmaker=bk, limit=5000,
                  **{"from": "2026-09-25T18:00:00Z", "to": iso(now + timedelta(hours=48))})
    perbook[bk] = {"status": s, "ids": [e.get("id") for e in b] if isinstance(b, list) else None,
                   "err": None if isinstance(b, list) else b}
OUT["phases"]["events_by_book"] = perbook
print("2 per-book listing", {k: (v["status"], len(v["ids"]) if v["ids"] is not None else "-") for k, v in perbook.items()})

# odds snapshots: all pending/live events (both books, markets omitted), raw bodies kept
ids = sorted({e["id"] for e in evday + evup if e.get("status") in ("pending", "live")})
OUT["phases"]["odds_event_ids"] = ids


def snapshot(tag, idlist, books):
    got, errs = {}, []
    for i in range(0, len(idlist), 10):
        if not budget_ok(): errs.append({"stopped_at_budget": i}); break
        s, h, b = get("/odds/multi", eventIds=",".join(str(x) for x in idlist[i:i + 10]), bookmakers=",".join(books))
        if isinstance(b, list):
            for ev in b: got[str(ev.get("id"))] = ev
        else:
            errs.append({"i": i, "status": s, "body": b})
    OUT["phases"]["snap_" + tag] = {"at": iso(datetime.now(timezone.utc)), "n_requested": len(idlist),
                                     "events": got, "errors": errs}
    return got


snap0 = snapshot("t0", ids, OURS or WANT)
print("3 snapshot t0 requested", len(ids), "returned", len(snap0))

# 3b. single-event /odds raw (full response, all fields) for 3 BFE-priced events
bfe_ids = [k for k, v in snap0.items() if (v.get("bookmakers") or {}).get("Betfair Exchange")]
sb_ids = [k for k, v in snap0.items() if (v.get("bookmakers") or {}).get("Superbet")]
print("3 priced: BFE", len(bfe_ids), "Superbet", len(sb_ids))
single = []
for eid in bfe_ids[:3]:
    s, h, b = get("/odds", eventId=eid, bookmakers="Betfair Exchange")
    single.append({"eventId": eid, "status": s, "body": b})
OUT["phases"]["odds_single_bfe"] = single

# 5. movements
mov = {}
for bk, pool, n in (("Betfair Exchange", bfe_ids, 25), ("Superbet", sb_ids, 10)):
    res = []
    for eid in pool[:n]:
        if not budget_ok(): break
        s, h, b = get("/odds/movements", eventId=eid, bookmaker=bk, market="ML")
        res.append({"eventId": eid, "status": s, "body": b})
    mov[bk] = res
OUT["phases"]["movements"] = mov
print("5 movements", {bk: [r["status"] for r in v] for bk, v in mov.items()})

# dropping-odds (REST), two pages to see the shape and any book field
s, h, b = get("/dropping-odds", sport="tennis", limit=200)
OUT["phases"]["dropping_odds"] = {"status": s, "hdr": {k: v for k, v in h.items() if k.startswith("x-")}, "body": b}
s, h, b = get("/dropping-odds", sport="tennis", limit=200, bookmaker="Betfair Exchange")
OUT["phases"]["dropping_odds_bfe_param"] = {"status": s, "hdr": {k: v for k, v in h.items() if k.startswith("x-")}, "body": b}
print("8 dropping-odds", OUT["phases"]["dropping_odds"]["status"], "with bookmaker param", s)

# delta endpoint per book
upd = {}
for bk in OURS or WANT:
    s, h, b = get("/odds/updated", since=int(time.time()) - 60, bookmaker=bk, sport="tennis")
    upd[bk] = {"status": s, "n": len(b) if isinstance(b, list) else None,
               "sample": b[:3] if isinstance(b, list) else b}
OUT["phases"]["odds_updated"] = upd

# 4. liquidity movement: two more BFE snapshots, 5 min apart
for tag in ("t5", "t10"):
    time.sleep(300)
    snapshot(tag, bfe_ids, ["Betfair Exchange"])
    print("4 snapshot", tag, "done; remaining", remaining())

OUT["finishedAt"] = iso(datetime.now(timezone.utc))
OUT["n_calls"] = len(OUT["calls"])
print("calls", OUT["n_calls"], "remaining", remaining())
os.makedirs("out", exist_ok=True)
blob = json.dumps(OUT)
assert KEY not in blob, "key leaked into output"
open("out/probe.json", "w").write(blob)
pw = secrets.token_hex(32)
subprocess.run(["openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-salt", "-in", "out/probe.json", "-out", "out/probe.enc",
                "-pass", "stdin"], input=pw.encode(), check=True)
subprocess.run(["openssl", "pkeyutl", "-encrypt", "-pubin", "-inkey", "tools/ten287-pub.pem", "-out", "out/pass.enc"],
               input=pw.encode(), check=True)
os.remove("out/probe.json")
print("ok")
