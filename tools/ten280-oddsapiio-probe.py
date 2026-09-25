#!/usr/bin/env python3
"""TEN-280 — odds-api.io REST feasibility probe (tennis). READ-ONLY.

Runs only in GitHub Actions with the key from the ODDS_API_IO_KEY secret.
Never prints the key or a URL containing it. Never opens the WebSocket
(the 7-day WS trial is held deliberately). Never changes bookmaker selection.
Writes out/probe.json (uploaded as a 1-day artifact); the log carries counts
and rate-limit headers only.
"""
import json, os, sys, time, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timedelta, timezone

BASE = "https://api.odds-api.io/v3"
KEY = os.environ.get("ODDS_API_IO_KEY", "")
if not KEY:
    print("ODDS_API_IO_KEY missing"); sys.exit(2)
# Shape diagnostic only (run 1 was 401 on every keyed call). Never the value.
_raw = KEY
_clean = KEY.strip().strip('"').strip("'").strip()
if _clean.lower().startswith("apikey="): _clean = _clean[7:]
_cls = ("hex" if all(c in "0123456789abcdefABCDEF" for c in _clean) else
        "hex+dash" if all(c in "0123456789abcdefABCDEF-" for c in _clean) else
        "alnum" if _clean.isalnum() else "other")
print("key shape: len", len(_raw), "clean_len", len(_clean), "changed_by_clean", _raw != _clean,
      "inner_whitespace", any(c.isspace() for c in _clean), "class", _cls)
KEY = _clean
assert "/ws" not in BASE

OUT = {"calls": [], "phases": {}}
STOP_REMAINING = 1500  # never spend the hour below this


def get(path, **params):
    assert not path.startswith("/ws")
    q = dict(params); q["apiKey"] = KEY
    url = BASE + path + "?" + urllib.parse.urlencode(q, safe=",")
    req = urllib.request.Request(url, headers={"User-Agent": "ten280-probe", "Accept-Encoding": "identity"})
    t0 = time.time()
    status, hdr, body = None, {}, None
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            status = r.status; hdr = {k.lower(): v for k, v in r.headers.items()}; raw = r.read()
    except urllib.error.HTTPError as e:
        status = e.code; hdr = {k.lower(): v for k, v in e.headers.items()}; raw = e.read()
    except Exception as e:  # never echo the URL
        OUT["calls"].append({"path": path, "error": type(e).__name__}); return None, {}, None
    if raw[:2] == b"\x1f\x8b":  # vendor gzips every response regardless of Accept-Encoding
        import gzip
        raw = gzip.decompress(raw)
    try:
        body = json.loads(raw.decode("utf-8"))
    except Exception:
        body = {"_nonjson": raw[:200].decode("utf-8", "replace")}
    keep = {k: v for k, v in hdr.items() if k.startswith("x-")}
    rec = {"path": path, "params": {k: v for k, v in params.items()}, "status": status,
           "ms": int((time.time() - t0) * 1000), "hdr": keep}
    OUT["calls"].append(rec)
    return status, hdr, body


def remaining():
    for c in reversed(OUT["calls"]):
        v = c.get("hdr", {}).get("x-ratelimit-remaining")
        if v is not None:
            try: return int(v)
            except ValueError: return None
    return None


def budget_ok():
    r = remaining()
    return r is None or r > STOP_REMAINING


def iso(dt): return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


now = datetime.now(timezone.utc)
OUT["startedAt"] = iso(now)

# A. account book selection (read-only GET)
s, h, b = get("/bookmakers/selected")
OUT["phases"]["selected"] = {"status": s, "body": b}
first = OUT["calls"][-1]["hdr"] if OUT["calls"] else {}
print("A selected", s, "ratelimit", {k: v for k, v in first.items() if "ratelimit" in k})
if s == 401:
    print("key rejected (401) after cleaning; body:", b)
    os.makedirs("out", exist_ok=True)
    json.dump(OUT, open("out/probe.json", "w")); sys.exit(0)

# B. leagues
s, h, b = get("/leagues", sport="tennis", all="true")
OUT["phases"]["leagues_all"] = {"status": s, "body": b}
s2, h2, b2 = get("/leagues", sport="tennis")
OUT["phases"]["leagues_active"] = {"status": s2, "body": b2}
print("B leagues all", s, len(b) if isinstance(b, list) else "-", "active", s2, len(b2) if isinstance(b2, list) else "-")


def events(**kw):
    allev, skip = [], 0
    while True:
        s, h, b = get("/events", sport="tennis", limit=5000, skip=skip, **kw)
        if s != 200 or not isinstance(b, list):
            return s, allev, b
        allev += b
        if len(b) < 5000: return s, allev, None
        skip += 5000


# C. events: the 24 Sep baseline window (wide, matched by name offline) + upcoming window
s, ev24, err = events(**{"from": "2026-09-23T12:00:00Z", "to": "2026-09-25T12:00:00Z"})
OUT["phases"]["events_2324_window"] = {"status": s, "n": len(ev24), "err": err, "events": ev24}
s, evup, err = events(**{"from": iso(now - timedelta(hours=3)), "to": iso(now + timedelta(hours=72))})
OUT["phases"]["events_upcoming"] = {"status": s, "n": len(evup), "err": err, "events": evup}
print("C events 23-25 window", len(ev24), "upcoming", len(evup))

# D. per-book tennis event listing (documented filter: only events with odds from that book)
s, h, books = get("/bookmakers")
active = [x["name"] for x in books if x.get("active")] if isinstance(books, list) else []
perbook = {}
for name in active:
    if not budget_ok(): perbook["_stopped_at_budget"] = name; break
    s, h, b = get("/events", sport="tennis", bookmaker=name, limit=5000,
                  **{"from": iso(now - timedelta(hours=3)), "to": iso(now + timedelta(hours=72))})
    perbook[name] = {"status": s, "ids": [e.get("id") for e in b] if isinstance(b, list) else None,
                     "err": None if isinstance(b, list) else b}
OUT["phases"]["events_by_book"] = perbook
print("D per-book listing", len(perbook), "books; remaining", remaining())

# E. odds for our two books, markets omitted, all upcoming/live events
OURS = ["Betfair Exchange", "Superbet"]
ids = [e["id"] for e in evup if e.get("status") in ("pending", "live")]
odds = {}
for i in range(0, len(ids), 10):
    if not budget_ok(): odds["_stopped_at_budget"] = i; break
    chunk = ids[i:i + 10]
    s, h, b = get("/odds/multi", eventIds=",".join(str(x) for x in chunk), bookmakers=",".join(OURS))
    if isinstance(b, list):
        for ev in b:
            bm = ev.get("bookmakers") or {}
            odds[str(ev.get("id"))] = {bk: [{"name": m.get("name"), "updatedAt": m.get("updatedAt"),
                                             "n": len(m.get("odds") or []), "odds": m.get("odds")}
                                            for m in (bm.get(bk) or [])] for bk in bm}
    else:
        odds["_err_%d" % i] = {"status": s, "body": b}
OUT["phases"]["odds_ours"] = {"n_events_requested": len(ids), "odds": odds}
print("E odds/multi events", len(ids), "returned", len([k for k in odds if not k.startswith("_")]))

# F. markets omitted vs named (same event, same book)
probe_ev = [k for k, v in odds.items() if not k.startswith("_") and any(v.get(b) for b in OURS)][:3]
ftest = []
for eid in probe_ev:
    s1, _, b1 = get("/odds", eventId=eid, bookmakers=",".join(OURS))
    s2, _, b2 = get("/odds", eventId=eid, bookmakers=",".join(OURS), markets="ML")
    def names(b):
        if not isinstance(b, dict): return b
        return {bk: [m.get("name") for m in ms] for bk, ms in (b.get("bookmakers") or {}).items()}
    ftest.append({"eventId": eid, "omitted": {"status": s1, "markets": names(b1)},
                  "ML_only": {"status": s2, "markets": names(b2)}})
OUT["phases"]["markets_omitted_test"] = ftest
print("F markets test", len(ftest))

# G. movements, both books, ML on up to 25 priced events each
mov = {}
for bk in OURS:
    pri = [k for k, v in odds.items() if not k.startswith("_") and any(m["name"] == "ML" for m in v.get(bk, []))][:25]
    res = []
    for eid in pri:
        if not budget_ok(): break
        s, h, b = get("/odds/movements", eventId=eid, bookmaker=bk, market="ML")
        res.append({"eventId": eid, "status": s, "body": b})
    mov[bk] = {"n_priced_ML": len([k for k, v in odds.items() if not k.startswith("_") and any(m["name"] == "ML" for m in v.get(bk, []))]),
               "sampled": len(pri), "results": res}
OUT["phases"]["movements"] = mov
print("G movements", {bk: [r["status"] for r in v["results"]][:25] for bk, v in mov.items()})

# H. dropping odds (REST)
s, h, b = get("/dropping-odds", sport="tennis", limit=200)
OUT["phases"]["dropping_odds"] = {"status": s, "hdr": {k: v for k, v in h.items() if k.startswith("x-")}, "body": b}
print("H dropping-odds", s, len(b) if isinstance(b, list) else (list(b)[:8] if isinstance(b, dict) else "-"))

# I. delta endpoint, one call per book
upd = {}
for bk in OURS:
    s, h, b = get("/odds/updated", since=int(time.time()) - 60, bookmaker=bk, sport="tennis")
    upd[bk] = {"status": s, "hdr": {k: v for k, v in h.items() if k.startswith("x-")},
               "n": len(b) if isinstance(b, list) else None, "err": None if isinstance(b, list) else b}
OUT["phases"]["odds_updated"] = upd
print("I odds/updated", {k: (v["status"], v["n"]) for k, v in upd.items()})

OUT["finishedAt"] = iso(datetime.now(timezone.utc))
OUT["n_calls"] = len(OUT["calls"])
last = OUT["calls"][-1]["hdr"] if OUT["calls"] else {}
print("calls", OUT["n_calls"], "last ratelimit", {k: v for k, v in last.items() if "ratelimit" in k})
os.makedirs("out", exist_ok=True)
with open("out/probe.json", "w") as f:
    json.dump(OUT, f)
blob = open("out/probe.json").read()
assert KEY not in blob, "key leaked into output"
print("ok")
