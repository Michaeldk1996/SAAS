#!/usr/bin/env python3
"""TEN-280 / TEN-282 Parts C + D — rotation scan of the account's selected books
(expected Stake + Unibet) and an outright / tournament-winner feasibility check.

READ-ONLY, REST only. Never opens the WebSocket, never changes the bookmaker
selection, never prints the key. out/rot.json is ENCRYPTED to tools/ten280-pub.pem
before upload; the log carries counts and statuses only.
"""
import gzip, json, os, subprocess, sys, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

BASE = "https://api.odds-api.io/v3"
KEY = os.environ.get("ODDS_API_IO_KEY", "")
if not KEY:
    print("ODDS_API_IO_KEY missing"); sys.exit(2)
OUT = {"calls": [], "phases": {}, "probe_at": datetime.now(timezone.utc).isoformat()}


def get(path, **params):
    assert not path.startswith("/ws") and not path.endswith("/select")  # GET only; never the selection PUT
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
    OUT["calls"].append({"path": path, "params": {k: v for k, v in params.items()}, "status": status,
                         "hdr": {k: v for k, v in hdr.items() if k.startswith("x-ratelimit")}})
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

now = datetime.now(timezone.utc)
day0 = now.replace(hour=0, minute=0, second=0, microsecond=0)

# --- C: every tennis event from today 00:00Z to +72h (all tiers/genders kept raw; tier split offline)
s, ev = get("/events", sport="tennis", limit=5000, **{"from": iso(day0 - timedelta(hours=12)), "to": iso(now + timedelta(hours=72))})
evs = ev if isinstance(ev, list) else []
OUT["phases"]["events"] = {"status": s, "n": len(evs), "body": evs}
m = [e for e in evs if mens(e["league"]["name"])]
print("events", s, len(evs), "mens singles", len(m))

if BOOKS:
    open_ids = [e["id"] for e in m if e.get("status") in ("pending", "live")]
    odds = {}
    for i in range(0, len(open_ids), 10):
        s, b = get("/odds/multi", eventIds=",".join(str(x) for x in open_ids[i:i + 10]), bookmakers=",".join(BOOKS))
        if isinstance(b, list):
            for x in b: odds[str(x["id"])] = x
        else:
            odds["_err_%d" % i] = {"status": s, "body": b}
    OUT["phases"]["open_odds"] = odds
    done = [e["id"] for e in m if e.get("status") == "settled" and e.get("date", "") >= iso(day0)]
    hist = {}
    for eid in done:
        s, b = get("/historical/odds", eventId=eid, bookmakers=",".join(BOOKS))
        hist[str(eid)] = {"status": s, "body": b}
    OUT["phases"]["settled_today_hist"] = hist
    print("open odds", len([k for k in odds if not k.startswith("_")]), "settled today", len(hist))

    mov = {}
    for bk in BOOKS:
        res = []
        pri = [k for k, v in odds.items() if not k.startswith("_") and (v.get("bookmakers") or {}).get(bk)]
        for eid in pri[:10]:
            s, b = get("/odds/movements", eventId=eid, bookmaker=bk, market="ML")
            res.append({"eventId": eid, "status": s, "body": b})
        mov[bk] = res
    OUT["phases"]["movements"] = mov
    print("movements", {bk: [r["status"] for r in v] for bk, v in mov.items()})

# --- D: outrights. Catalogue (no auth), leagues, event search, any non-match event.
s, cat = get("/markets", sport="tennis")
OUT["phases"]["markets_catalogue"] = {"status": s, "body": cat}
s, lg = get("/leagues", sport="tennis")
OUT["phases"]["leagues"] = {"status": s, "body": lg}
srch = {}
for term in ("Chengdu", "Hangzhou", "Outright", "Winner", "Laver Cup"):
    s, b = get("/events/search", query=term)
    srch[term] = {"status": s, "body": b}
OUT["phases"]["search"] = srch
# odds on every Chengdu/Hangzhou event (any market the books carry, no market filter)
ch = [e["id"] for e in evs if any(t in e["league"]["name"] for t in ("Chengdu", "Hangzhou"))]
for term in ("Chengdu", "Hangzhou"):
    b = srch[term]["body"]
    for e in (b if isinstance(b, list) else []):
        if e.get("id") not in ch: ch.append(e["id"])
cho = {}
if BOOKS:
    for i in range(0, len(ch), 10):
        s, b = get("/odds/multi", eventIds=",".join(str(x) for x in ch[i:i + 10]), bookmakers=",".join(BOOKS))
        if isinstance(b, list):
            for x in b: cho[str(x["id"])] = x
        else:
            cho["_err_%d" % i] = {"status": s, "body": b}
OUT["phases"]["chengdu_hangzhou_odds"] = cho
print("outright checks: leagues", OUT["phases"]["leagues"]["status"], "search", {k: v["status"] for k, v in srch.items()},
      "ch/hz events", len(ch))
print("ratelimit", OUT["calls"][-1].get("hdr", {}))

os.makedirs("out", exist_ok=True)
json.dump(OUT, open("out/rot.json", "w"))
assert KEY not in open("out/rot.json").read()
pw = os.urandom(32).hex()
subprocess.run(["openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-salt", "-in", "out/rot.json", "-out", "out/rot.enc",
                "-pass", "pass:" + pw], check=True)
subprocess.run(["openssl", "pkeyutl", "-encrypt", "-pubin", "-inkey", "tools/ten280-pub.pem", "-out", "out/rot-pass.enc"],
               input=pw.encode(), check=True)
os.remove("out/rot.json")
print("ok")
