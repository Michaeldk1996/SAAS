#!/usr/bin/env python3
# TEN-65 part 2 — standalone player-ue-db.json: the clean-error gate's backing store.
#
# The clean-error / Solid-Baseliner gate is `unforcedRate <= 16.0% AND chartedMatches >= 10`.
# The metric is the api-tennis Winners/Unforced-errors aggregate that bsp-pipeline.js's
# aggregatePlayerWue() computes as profile.wue = {winnersRate, unforcedRate, ratio, matches, source}
# (rates as fractions of Total-Points-Won). The archetype stat-inputs corpus already carries the
# same metric per roster player as whole-match winnerRate / unforcedRate (per-100-points), keyed to
# each player's charted-match count, so this DB is a 0-API-read projection of it onto the wue schema.
#
# Emits BOTH scalings so either consumer works:
#   unforcedRate/winnersRate  -> per-100-points (matches stat-inputs + the "<=16.0" gate literal)
#   unforcedFrac/winnersFrac  -> fraction of points (matches aggregatePlayerWue's profile.wue)
import csv, json, os

WS  = os.environ.get("PAPERCLIP_WORKSPACE_CWD", ".")
SRC = os.path.join(WS, "archetype-stat-inputs.csv")
SUP = os.path.join(WS, "archetype-sr-supplement.json")
KEYS= "/Users/Michael/bsp-consult-project/player-profiles.json"
OUT = os.path.join(WS, "player-ue-db.json")

UE_GATE, CHARTED_GATE = 16.0, 10

def f(x):
    x=(x or "").strip()
    try: return float(x)
    except: return None

# name -> api player_key (for join to the live feed / pipeline)
keymap={}
try:
    for k,v in json.load(open(KEYS))["players"].items():
        if v.get("name"): keymap[v["name"]]=k
except Exception: pass

sup = json.load(open(SUP)) if os.path.exists(SUP) else {}

db={}
rows=list(csv.DictReader(open(SRC)))
for r in rows:
    nm=r["player"]; ue=f(r["unforcedRate"]); wr=f(r["winnerRate"]); ch=f(r["chartedMatches"])
    src="api-tennis (stat-inputs corpus)"
    entry={
        "player": nm, "pool": r["pool"], "rank": r["rank"],
        "playerKey": keymap.get(nm),
        "unforcedRate": ue, "winnersRate": wr,
        "unforcedFrac": (round(ue/100,4) if ue is not None else None),
        "winnersFrac":  (round(wr/100,4) if wr is not None else None),
        "ratio": (round(wr/ue,3) if (wr is not None and ue) else None),
        "chartedMatches": int(ch) if ch is not None else None,
        "cleanError": bool(ue is not None and ue<=UE_GATE and ch is not None and ch>=CHARTED_GATE),
        "source": src if ue is not None else None,
    }
    db[nm]=entry

# Supplement note: the 4 charted-only players already carry UE/winners in stat-inputs
# (their gap was serve/return, not W/UE); annotate that serve/return was filled via api-tennis.
for nm in sup:
    if nm in db:
        db[nm]["serveReturnSupplemented"]=True

players=sorted(db.values(), key=lambda e:(e["pool"]!="Tour", e["pool"], int(e["rank"]) if str(e["rank"]).isdigit() else 9999))
tour=[e for e in players if e["pool"]=="Tour"]
chall=[e for e in players if e["pool"]=="Challenger"]
out={
    "_meta": {
        "purpose": "clean-error / Solid-Baseliner gate backing store (TEN-65)",
        "gate": f"unforcedRate <= {UE_GATE} AND chartedMatches >= {CHARTED_GATE}",
        "metric": "api-tennis Winners/Unforced errors over Total Points Won (aggregatePlayerWue schema)",
        "scalings": {"unforcedRate/winnersRate": "per-100-points (gate scale)",
                     "unforcedFrac/winnersFrac": "fraction of points (profile.wue scale)"},
        "counts": {
            "players": len(players),
            "withUE": sum(1 for e in players if e["unforcedRate"] is not None),
            "cleanError_Tour": sum(1 for e in tour if e["cleanError"]),
            "cleanError_Challenger": sum(1 for e in chall if e["cleanError"]),
        },
        "goForward": "canonical source is bsp-pipeline.js aggregatePlayerWue (profile.wue), emitted per daily profile build; this file is a full-roster projection of the archetype stat-inputs corpus.",
    },
    "players": {e["player"]: e for e in players},
}
json.dump(out, open(OUT,"w"), indent=1)
print("WROTE", OUT)
print(json.dumps(out["_meta"]["counts"], indent=1))
print("\nclean-error Tour names:", ", ".join(e["player"] for e in tour if e["cleanError"]))
