#!/usr/bin/env python3
"""TEN-287 — near-start sampler: Betfair Exchange + Superbet snapshots every 5 min. READ-ONLY.

Same rules as ten287-probe.py: key from the ODDS_API_IO_KEY secret, never printed; REST only;
selection never changed; output ENCRYPTED to tools/ten287-pub.pem. Writes out/samples.jsonl as
it goes (one line per snapshot) so a timeout still leaves every finished snapshot for the upload.
"""
import json, os, secrets, subprocess, sys, time
from datetime import datetime, timedelta, timezone

sys.argv = sys.argv[:1]
import importlib.util
spec = importlib.util.spec_from_file_location("p", os.path.join(os.path.dirname(__file__), "ten287-probe.py"))
src = open(spec.origin).read().split("now = datetime.now(timezone.utc)")[0]  # helpers only, not the probe body
ns = {"__name__": "ten287_helpers"}
exec(compile(src, spec.origin, "exec"), ns)
get, iso, remaining, budget_ok, OUT = ns["get"], ns["iso"], ns["remaining"], ns["budget_ok"], ns["OUT"]
KEY = ns["KEY"]

BOOKS = ["Betfair Exchange", "Superbet"]
END = time.time() + int(os.environ.get("TEN287_MINUTES", "335")) * 60
STEP = 300
os.makedirs("out", exist_ok=True)
log = open("out/samples.jsonl", "w")


def seal():
    log.flush()
    blob = open("out/samples.jsonl").read()
    assert KEY not in blob, "key leaked into output"
    pw = secrets.token_hex(32)
    subprocess.run(["openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-salt", "-in", "out/samples.jsonl",
                    "-out", "out/samples.enc", "-pass", "stdin"], input=pw.encode(), check=True)
    subprocess.run(["openssl", "pkeyutl", "-encrypt", "-pubin", "-inkey", "tools/ten287-pub.pem",
                    "-out", "out/spass.enc"], input=pw.encode(), check=True)


ids, ev_meta, last_events = [], {}, 0
n = 0
while time.time() < END:
    t0 = time.time()
    if t0 - last_events > 3600 or not ids:
        s, h, b = get("/events", sport="tennis", limit=5000,
                      **{"from": iso(datetime.now(timezone.utc) - timedelta(hours=4)),
                         "to": iso(datetime.now(timezone.utc) + timedelta(hours=30))})
        if isinstance(b, list):
            ids = sorted(e["id"] for e in b if e.get("status") in ("pending", "live"))
            ev_meta = {str(e["id"]): {k: e.get(k) for k in ("home", "away", "date", "status", "league")} for e in b}
            last_events = t0
    snap = {"at": iso(datetime.now(timezone.utc)), "events": {}, "errors": []}
    for i in range(0, len(ids), 10):
        if not budget_ok(): snap["errors"].append("budget"); break
        s, h, b = get("/odds/multi", eventIds=",".join(str(x) for x in ids[i:i + 10]), bookmakers=",".join(BOOKS))
        if isinstance(b, list):
            for e in b:
                bm = e.get("bookmakers") or {}
                if bm:
                    snap["events"][str(e["id"])] = {"status": e.get("status"), "date": e.get("date"), "bm": bm}
        else:
            snap["errors"].append({"status": s})
    s, h, b = get("/dropping-odds", sport="tennis", limit=200)
    snap["dropping"] = b if isinstance(b, list) else {"status": s}
    if n == 0: snap["meta"] = ev_meta
    elif t0 - last_events < STEP: snap["meta"] = ev_meta
    log.write(json.dumps(snap) + "\n"); log.flush()
    n += 1
    print("snap", n, snap["at"], "events", len(snap["events"]), "remaining", remaining(), flush=True)
    if n % 6 == 0: seal()
    time.sleep(max(0, STEP - (time.time() - t0)))
seal()
print("ok", n)
