#!/usr/bin/env python3
"""TEN-287 — odds-api.io historical/closing-lines probe (tennis). READ-ONLY.

Same rules as ten287-probe.py: key from the ODDS_API_IO_KEY secret, never printed; REST only; the
bookmaker selection is never changed; output ENCRYPTED to tools/ten287-pub.pem.
Question: what does odds-api.io call a "closing" price, which books does it return for, and how does
it line up with the Superbet movement series and the scheduled start.
"""
import json, os, secrets, subprocess, sys

spec = os.path.join(os.path.dirname(__file__), "ten287-probe.py")
src = open(spec).read().split("now = datetime.now(timezone.utc)")[0]
ns = {"__name__": "ten287_helpers"}
exec(compile(src, spec, "exec"), ns)
get, OUT, KEY = ns["get"], ns["OUT"], ns["KEY"]

BOOKS = "Betfair Exchange,Superbet,Bet365,Sbobet,Pinnacle"

# /historical/events requires a league (measured: 400 "Missing league parameter"); one per tier, slugs from probe run 36198963732
LEAGUES = ["atp-chengdu-china", "challenger-san-diego-2-usa", "tennis-itf-men-pardubice-r16"]
ev, OUT["phases"]["hist_events"] = [], {}
for lg in LEAGUES:
    s, h, b = get("/historical/events", sport="tennis", league=lg, **{"from": "2026-09-20T00:00:00Z", "to": "2026-09-26T00:00:00Z"})
    OUT["phases"]["hist_events"][lg] = {"status": s, "n": len(b) if isinstance(b, list) else None,
                                        "sample": b[:2] if isinstance(b, list) else b}
    if isinstance(b, list): ev += b
    print("historical/events", lg, s, len(b) if isinstance(b, list) else b)


def tier(e):
    n = ((e.get("league") or {}).get("name") or "")
    if "/" in (e.get("home") or ""): return None
    return "ATP" if n.startswith("ATP - ") else "Challenger" if n.startswith("Challenger - ") else "ITF Men" if "ITF Men" in n else None


picks, leagues = {}, {}
for e in (ev if isinstance(ev, list) else []):
    t = tier(e)
    if t and len(picks.setdefault(t, [])) < 3:
        picks[t].append(e)
        leagues.setdefault(t, (e.get("league") or {}).get("slug"))
OUT["phases"]["picks"] = {t: [{k: e.get(k) for k in ("id", "home", "away", "date", "status", "league")} for e in v] for t, v in picks.items()}

ho = []
for t, v in picks.items():
    for e in v:
        s, h, b = get("/historical/odds", eventId=e["id"], bookmakers=BOOKS, markets="ML")
        ho.append({"tier": t, "eventId": e["id"], "date": e.get("date"), "status": s, "body": b})
        s2, h2, b2 = get("/odds/movements", eventId=e["id"], bookmaker="Superbet", market="ML")
        ho[-1]["superbet_movements"] = {"status": s2, "body": b2}
OUT["phases"]["historical_odds"] = ho
print("historical/odds", [(x["tier"], x["status"]) for x in ho])

sl = ",".join(LEAGUES)
s, h, b = get("/historical/closing-lines", sport="tennis", leagues=sl, markets="ML", bookmakers=BOOKS,
              limit=100, **{"from": "2026-09-23T00:00:00Z", "to": "2026-09-25T23:59:59Z"})
OUT["phases"]["closing_lines"] = {"status": s, "leagues": sl, "hdr": {k: v for k, v in h.items() if k.startswith("x-")},
                                  "n": len(b) if isinstance(b, list) else None, "body": b}
print("historical/closing-lines", s, len(b) if isinstance(b, list) else b)

os.makedirs("out", exist_ok=True)
blob = json.dumps(OUT)
assert KEY not in blob, "key leaked into output"
open("out/hist.json", "w").write(blob)
pw = secrets.token_hex(32)
subprocess.run(["openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-salt", "-in", "out/hist.json", "-out", "out/hist.enc",
                "-pass", "stdin"], input=pw.encode(), check=True)
subprocess.run(["openssl", "pkeyutl", "-encrypt", "-pubin", "-inkey", "tools/ten287-pub.pem", "-out", "out/hpass.enc"],
               input=pw.encode(), check=True)
os.remove("out/hist.json")
print("ok")
