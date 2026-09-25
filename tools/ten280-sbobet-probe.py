#!/usr/bin/env python3
"""TEN-280 Part A — Sbobet tennis coverage on odds-api.io. READ-ONLY, REST only.

Step 0 uses the RAW ODDS_API_IO_KEY secret, no trimming: if it is not accepted the
run stops there. Never prints the key; never opens the WebSocket; never changes the
account's bookmaker selection. Output: out/probe.json (1-day artifact).
"""
import gzip, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

BASE = "https://api.odds-api.io/v3"
KEY = os.environ.get("ODDS_API_IO_KEY", "")
if not KEY:
    print("ODDS_API_IO_KEY missing"); sys.exit(2)
OUT = {"calls": [], "phases": {}}
STOP_REMAINING = 1500


def get(path, **params):
    assert not path.startswith("/ws")
    q = dict(params); q["apiKey"] = KEY
    url = BASE + path + "?" + urllib.parse.urlencode(q, safe=",")
    req = urllib.request.Request(url, headers={"User-Agent": "ten280-probe"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            status, hdr, raw = r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        status, hdr, raw = e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()
    except Exception as e:
        OUT["calls"].append({"path": path, "error": type(e).__name__}); return None, {}, None
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    try:
        body = json.loads(raw.decode("utf-8"))
    except Exception:
        body = {"_nonjson": raw[:200].decode("utf-8", "replace")}
    OUT["calls"].append({"path": path, "status": status,
                         "hdr": {k: v for k, v in hdr.items() if k.startswith("x-ratelimit")}})
    return status, hdr, body


def remaining():
    for c in reversed(OUT["calls"]):
        v = c.get("hdr", {}).get("x-ratelimit-remaining")
        if v is not None:
            return int(v)
    return None


def budget_ok():
    r = remaining(); return r is None or r > STOP_REMAINING


def iso(dt): return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def mens_singles(league):
    n = league or ""
    if "Doubles" in n: return None
    fam = n.split(" - ")[0]
    if fam == "ATP": return "ATP"
    if fam == "Challenger": return "Challenger"
    if "ITF Men" in n: return "ITF Men"
    return None


# 0. RAW key, no trim
s, h, b = get("/bookmakers/selected")
OUT["phases"]["raw_key"] = {"status": s, "body": b, "len": len(KEY), "has_outer_ws": KEY != KEY.strip()}
print("0 raw key", s, b if s == 200 else "(rejected)", "outer whitespace:", KEY != KEY.strip())
if s != 200:
    os.makedirs("out", exist_ok=True); json.dump(OUT, open("out/probe.json", "w")); sys.exit(0)
BOOKS = b.get("bookmakers") or []
SB = "Sbobet"
if SB not in BOOKS:
    print("Sbobet not selected on the account:", BOOKS)

# 1. baseline window events (24 Sep day, matched offline)
evs = []
s, h, b = get("/events", sport="tennis", limit=5000, **{"from": "2026-09-23T12:00:00Z", "to": "2026-09-25T12:00:00Z"})
if isinstance(b, list): evs = b
ms = [e for e in evs if mens_singles(e["league"]["name"])]
print("1 events window", len(evs), "mens singles", len(ms))

# 2. historical odds for the men's singles in that window, both selected books
hist = {}
for e in ms:
    if not budget_ok(): hist["_stopped"] = e["id"]; break
    s, h, b = get("/historical/odds", eventId=e["id"], bookmakers=",".join(BOOKS))
    if isinstance(b, dict) and "bookmakers" in b:
        hist[str(e["id"])] = {"status": s, "books": {bk: [{"name": m.get("name"), "n": len(m.get("odds") or []),
                                                          "updatedAt": m.get("updatedAt"), "odds": (m.get("odds") or [])[:3]}
                                                         for m in ms_] for bk, ms_ in (b.get("bookmakers") or {}).items()}}
    else:
        hist[str(e["id"])] = {"status": s, "err": b}
OUT["phases"]["baseline_events"] = [{"id": e["id"], "home": e["home"], "away": e["away"], "date": e["date"],
                                     "league": e["league"]["name"], "status": e.get("status")} for e in ms]
OUT["phases"]["historical_odds"] = hist
print("2 historical/odds", len(hist), "statuses", {k: v for k, v in
      __import__("collections").Counter(v.get("status") for v in hist.values() if isinstance(v, dict)).items()})

# 3. upcoming window, current odds
now = datetime.now(timezone.utc)
s, h, b = get("/events", sport="tennis", limit=5000, **{"from": iso(now - timedelta(hours=3)), "to": iso(now + timedelta(hours=72))})
up = [e for e in (b if isinstance(b, list) else []) if e.get("status") in ("pending", "live") and mens_singles(e["league"]["name"])]
odds = {}
ids = [e["id"] for e in up]
for i in range(0, len(ids), 10):
    s, h, b = get("/odds/multi", eventIds=",".join(str(x) for x in ids[i:i + 10]), bookmakers=",".join(BOOKS))
    if isinstance(b, list):
        for ev in b:
            odds[str(ev["id"])] = {bk: [{"name": m.get("name"), "n": len(m.get("odds") or []), "updatedAt": m.get("updatedAt"),
                                         "odds": (m.get("odds") or [])[:6]} for m in ms_]
                                   for bk, ms_ in (ev.get("bookmakers") or {}).items()}
    else:
        odds["_err_%d" % i] = {"status": s, "body": b}
OUT["phases"]["upcoming_events"] = [{"id": e["id"], "home": e["home"], "away": e["away"], "date": e["date"],
                                     "league": e["league"]["name"], "status": e.get("status")} for e in up]
OUT["phases"]["upcoming_odds"] = odds
print("3 upcoming mens singles", len(up), "odds rows", len([k for k in odds if not k.startswith("_")]))

# 4. Sbobet movements: ML on up to 25 priced events, plus up to 5 line markets
mov = []
pri = [k for k, v in odds.items() if not k.startswith("_") and any(m["name"] == "ML" for m in v.get(SB, []))]
for eid in pri[:25]:
    s, h, b = get("/odds/movements", eventId=eid, bookmaker=SB, market="ML")
    mov.append({"eventId": eid, "market": "ML", "status": s, "body": b})
lines = 0
for eid in pri:
    if lines >= 5: break
    for m in odds[eid].get(SB, []):
        if m["name"] in ("Spread (Games)", "Totals (Games)", "Spread", "Totals") and m["odds"] and m["odds"][0].get("hdp") is not None:
            s, h, b = get("/odds/movements", eventId=eid, bookmaker=SB, market=m["name"], marketLine=m["odds"][0]["hdp"])
            mov.append({"eventId": eid, "market": m["name"], "hdp": m["odds"][0]["hdp"], "status": s, "body": b})
            lines += 1; break
OUT["phases"]["sbobet_movements"] = mov
print("4 movements", [(x["market"], x["status"]) for x in mov])
print("ratelimit", OUT["calls"][-1].get("hdr"))
os.makedirs("out", exist_ok=True)
json.dump(OUT, open("out/probe.json", "w"))
assert KEY not in open("out/probe.json").read()
print("ok")
