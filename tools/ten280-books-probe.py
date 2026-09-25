#!/usr/bin/env python3
"""TEN-280 point 9 — the account's books (expected Bet365 + Polymarket) on odds-api.io.

READ-ONLY, REST only. Never opens the WebSocket, never changes the bookmaker
selection, never prints the key. out/books.json is ENCRYPTED to tools/ten280-pub.pem
before upload; the log carries counts and statuses only.
"""
import gzip, json, os, subprocess, sys, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

BASE = "https://api.odds-api.io/v3"
KEY = os.environ.get("ODDS_API_IO_KEY", "")
if not KEY:
    print("ODDS_API_IO_KEY missing"); sys.exit(2)
OUT = {"calls": [], "phases": {}}


def get(path, **params):
    assert not path.startswith("/ws")
    q = dict(params); q["apiKey"] = KEY
    req = urllib.request.Request(BASE + path + "?" + urllib.parse.urlencode(q, safe=","),
                                 headers={"User-Agent": "ten280-probe"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            status, hdr, raw = r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        status, hdr, raw = e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()
    except Exception as e:
        OUT["calls"].append({"path": path, "error": type(e).__name__}); return None, None
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    try:
        body = json.loads(raw.decode("utf-8"))
    except Exception:
        body = {"_nonjson": raw[:200].decode("utf-8", "replace")}
    OUT["calls"].append({"path": path, "status": status,
                         "hdr": {k: v for k, v in hdr.items() if k.startswith("x-")}})
    return status, body


def mens(league):
    n = league or ""
    if "Doubles" in n: return None
    f = n.split(" - ")[0]
    return "ATP" if f == "ATP" else "Challenger" if f == "Challenger" else "ITF Men" if "ITF Men" in n else None


def iso(dt): return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


s, sel = get("/bookmakers/selected")
OUT["phases"]["selected"] = {"status": s, "body": sel}
print("selected", s, sel)
BOOKS = (sel or {}).get("bookmakers") or []

if BOOKS:
    s, ev = get("/events", sport="tennis", limit=5000, **{"from": "2026-09-23T12:00:00Z", "to": "2026-09-25T12:00:00Z"})
    base = [e for e in (ev if isinstance(ev, list) else []) if mens(e["league"]["name"])]
    hist = {}
    for e in base:
        s, b = get("/historical/odds", eventId=e["id"], bookmakers=",".join(BOOKS))
        hist[str(e["id"])] = {"status": s, "body": b}
    OUT["phases"]["baseline_events"] = base
    OUT["phases"]["historical_odds"] = hist
    print("baseline mens singles", len(base), "historical", len(hist))

    now = datetime.now(timezone.utc)
    s, ev = get("/events", sport="tennis", limit=5000, **{"from": iso(now - timedelta(hours=3)), "to": iso(now + timedelta(hours=72))})
    up = [e for e in (ev if isinstance(ev, list) else []) if e.get("status") in ("pending", "live") and mens(e["league"]["name"])]
    odds = {}
    ids = [e["id"] for e in up]
    for i in range(0, len(ids), 10):
        s, b = get("/odds/multi", eventIds=",".join(str(x) for x in ids[i:i + 10]), bookmakers=",".join(BOOKS))
        if isinstance(b, list):
            for x in b:
                odds[str(x["id"])] = x
        else:
            odds["_err_%d" % i] = {"status": s, "body": b}
    OUT["phases"]["upcoming_events"] = up
    OUT["phases"]["upcoming_odds"] = odds
    print("upcoming mens singles", len(up), "odds", len([k for k in odds if not k.startswith("_")]))

    mov = {}
    for bk in BOOKS:
        res = []
        pri = [k for k, v in odds.items() if not k.startswith("_") and any(m.get("name") == "ML" for m in (v.get("bookmakers") or {}).get(bk, []))]
        for eid in pri[:30]:
            s, b = get("/odds/movements", eventId=eid, bookmaker=bk, market="ML")
            res.append({"eventId": eid, "window": "upcoming", "status": s, "body": b})
        bpri = [k for k, v in hist.items() if isinstance(v["body"], dict) and any(m.get("name") == "ML" for m in (v["body"].get("bookmakers") or {}).get(bk, []))]
        for eid in bpri[:15]:
            s, b = get("/odds/movements", eventId=eid, bookmaker=bk, market="ML")
            res.append({"eventId": eid, "window": "baseline", "status": s, "body": b})
        mov[bk] = res
    OUT["phases"]["movements"] = mov
    print("movements", {bk: [r["status"] for r in v] for bk, v in mov.items()})
    print("ratelimit", OUT["calls"][-1].get("hdr", {}))

os.makedirs("out", exist_ok=True)
json.dump(OUT, open("out/books.json", "w"))
assert KEY not in open("out/books.json").read()
pw = os.urandom(32).hex()
subprocess.run(["openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-salt", "-in", "out/books.json", "-out", "out/books.enc",
                "-pass", "pass:" + pw], check=True)
subprocess.run(["openssl", "pkeyutl", "-encrypt", "-pubin", "-inkey", "tools/ten280-pub.pem", "-out", "out/books-pass.enc"],
               input=pw.encode(), check=True)
os.remove("out/books.json")
print("ok")
