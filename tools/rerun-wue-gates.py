#!/usr/bin/env python3
# TEN-66 part 3 — re-run the W/UE-driven gates on the fuller api-tennis pool and
# report which player labels flip vs the Match-Charting-fed labels.
#
# What api-tennis CAN drive (whole-match W/UE, comparable denominator):
#   - Solid-Baseliner CLEAN-ERROR gate: unforcedRate <= 16.0 AND matches >= 10
#   - Attacking-Baseliner WINNER-VOLUME flag: whole-match winnerRate > tour mean 15.75
#   - W/UE ratio band (the Collignon-style defensive<->even flip)
# What it CANNOT (charting-only, reported as a boundary, NOT recomputed):
#   - the Attacking-Baseliner C score's 4+-rally winRate / W-UE|4+ components.
import csv, json, os

WS = os.environ.get("PAPERCLIP_WORKSPACE_CWD", ".")
REPO = "/Users/Michael/bsp-consult-project"
STATIN = os.path.join(WS, "archetype-stat-inputs.csv")
FINAL  = os.path.join(WS, "player-archetypes-final.csv")
UEDB   = os.path.join(WS, "player-ue-db.json")
HIST   = os.path.join(REPO, "player-wue-history.json")

UE_GATE, MATCH_GATE, WVOL_MEAN = 16.0, 10, 15.75

def f(x):
    x = (x or "").strip()
    try: return float(x)
    except: return None

# charting-fed metrics by (pool, name)
chart = {}
for r in csv.DictReader(open(STATIN)):
    chart[(r["pool"], r["player"])] = {
        "winnerRate": f(r["winnerRate"]), "unforcedRate": f(r["unforcedRate"]),
        "charted": f(r["chartedMatches"]), "rank": r["rank"],
    }

# current archetype label by (pool, name)
label = {}
for r in csv.DictReader(open(FINAL)):
    label[(r["pool"], r["player"])] = r.get("label", "")

# name -> playerKey bridge
key = {}
for nm, v in json.load(open(UEDB))["players"].items():
    if v.get("playerKey"): key[(v["pool"], nm)] = str(v["playerKey"])

hist = json.load(open(HIST))["players"]

def band(ratio):
    if ratio is None: return "n/a"
    if ratio < 0.90: return "defensive"
    if ratio <= 1.10: return "even"
    return "attacking"

rows, flips_clean, flips_wvol, flips_band, new_clean = [], [], [], [], []
tour_apiwr = []
for (pool, nm), c in chart.items():
    pk = key.get((pool, nm))
    h = hist.get(pk) if pk else None
    api_ue = h["unforcedRate"] if h else None
    api_wr = h["winnersRate"] if h else None
    api_n  = h["matches"] if h else 0
    api_ratio = h["ratio"] if h else None
    if pool == "Tour" and api_wr is not None and api_n >= MATCH_GATE:
        tour_apiwr.append(api_wr)

    # clean-error gate: charting vs api
    ce_chart = (c["unforcedRate"] is not None and c["unforcedRate"] <= UE_GATE
                and c["charted"] is not None and c["charted"] >= MATCH_GATE)
    ce_api = (api_ue is not None and api_ue <= UE_GATE and api_n >= MATCH_GATE)
    # winner-volume flag: charting vs api (fixed tour-mean reference 15.75)
    wv_chart = (c["winnerRate"] is not None and c["winnerRate"] > WVOL_MEAN)
    wv_api = (api_wr is not None and api_wr > WVOL_MEAN)
    # ratio band shift
    chart_ratio = (c["winnerRate"] / c["unforcedRate"]) if (c["winnerRate"] and c["unforcedRate"]) else None

    row = {
        "pool": pool, "rank": c["rank"], "player": nm, "label": label.get((pool, nm), ""),
        "ue_chart": c["unforcedRate"], "ue_api": api_ue,
        "wr_chart": c["winnerRate"], "wr_api": api_wr,
        "n_chart": c["charted"], "n_api": api_n,
        "ratio_chart": round(chart_ratio, 3) if chart_ratio else None, "ratio_api": api_ratio,
        "ce_chart": ce_chart, "ce_api": ce_api,
        "wv_chart": wv_chart, "wv_api": wv_api,
        "band_chart": band(chart_ratio), "band_api": band(api_ratio),
    }
    rows.append(row)
    if h and api_n > 0:
        if ce_chart != ce_api: flips_clean.append(row)
        if wv_chart != wv_api: flips_wvol.append(row)
        if band(chart_ratio) != band(api_ratio) and chart_ratio and api_ratio: flips_band.append(row)
        # challenger players who could NOT reach clean-error via charting (charted<10) but now can via api
        if pool == "Challenger" and ce_api and not ce_chart and (c["charted"] is None or c["charted"] < MATCH_GATE):
            new_clean.append(row)

covered = [r for r in rows if r["n_api"] and r["n_api"] > 0]
print(f"roster players: {len(rows)} | api-covered (>=1 usable match): {len(covered)} | api tour-mean winnerRate (n>=10): {round(sum(tour_apiwr)/len(tour_apiwr),2) if tour_apiwr else 'n/a'}")
print(f"clean-error flips: {len(flips_clean)} | winner-vol flips: {len(flips_wvol)} | ratio-band flips: {len(flips_band)} | NEW challenger clean-error (unreachable by charting): {len(new_clean)}")

def show(title, rs, cols):
    print(f"\n### {title} ({len(rs)})")
    for r in sorted(rs, key=lambda x: (x['pool'], float(x['rank']) if str(x['rank']).replace('.','').isdigit() else 9999)):
        print("  " + " | ".join(f"{k}={r[k]}" for k in cols))

show("CLEAN-ERROR gate flips (charting vs api)", flips_clean,
     ["pool","player","label","ue_chart","n_chart","ce_chart","ue_api","n_api","ce_api"])
show("WINNER-VOLUME flag flips (>15.75)", flips_wvol,
     ["pool","player","label","wr_chart","wr_api"])
show("W/UE RATIO-BAND flips", flips_band,
     ["pool","player","label","ratio_chart","band_chart","ratio_api","band_api","n_api"])
show("NEW Challenger clean-error (charting couldn't reach n>=10)", new_clean,
     ["player","ue_api","n_api"])

# dump a full comparison CSV for the deliverable
out = os.path.join(WS, "wue-gate-rerun-comparison.csv")
with open(out, "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
    w.writeheader()
    for r in sorted(rows, key=lambda x: (x['pool'], float(x['rank']) if str(x['rank']).replace('.','').isdigit() else 9999)):
        w.writerow(r)
print(f"\nWROTE {out}")
