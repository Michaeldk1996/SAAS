#!/usr/bin/env python3
# Independent recompute of the four DNA axes for Sinner (2072) & Alcaraz (2382),
# last52 / All-surface, reading the SAME api-tennis cache directly. No shared code
# with the Node generator. Purpose: catch any arithmetic/parse divergence.
import json, os, glob, math
from datetime import datetime, timedelta

CACHE = "/Users/Michael/bsp-consult-project/apitennis-wue-cache"
TARGETS = {"2072": "Sinner", "2382": "Alcaraz"}
LAST52 = 364

def pick(rows, t, n):
    n = n.lower()
    for s in rows:
        if s.get("stat_type") == t and str(s.get("stat_name","")).lower() == n:
            return s
    return None

def num(v):
    try:
        f = float(v);  return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None

# gather each target's finished-265-singles matches with a match-period stat block
raw = {k: [] for k in TARGETS}   # list of (date, rows, isFirst, event_winner, scores)
for fp in glob.glob(os.path.join(CACHE, "265-*.json")):
    with open(fp) as fh:
        arr = json.load(fh)
    for f in arr:
        if "finished" not in str(f.get("event_status","")).lower(): continue
        ett = f.get("event_type_type","")
        if ett and "single" not in ett.lower(): continue
        stats = f.get("statistics")
        if not isinstance(stats, list) or not stats: continue
        mrows = [s for s in stats if s.get("stat_period") == "match"]
        if not mrows: continue
        p1, p2 = str(f.get("first_player_key")), str(f.get("second_player_key"))
        for pk, isFirst in ((p1, True), (p2, False)):
            if pk in TARGETS:
                raw[pk].append((f.get("event_date"), mrows, isFirst, f.get("event_winner"), f.get("scores")))

def agg_last52(entries):
    if not entries: return None
    latest = max(e[0] for e in entries)
    cutoff = (datetime.strptime(latest, "%Y-%m-%d") - timedelta(days=LAST52)).strftime("%Y-%m-%d")
    A = dict(m=0, firstInTot=0, firstWon=0, secondWon=0, secondTot=0, svcPWon=0, svpt=0,
             svGmWon=0, svGmTot=0, aces=0, dfs=0, retPWon=0, retPTot=0, ret1Won=0, ret1Tot=0,
             ret2Won=0, ret2Tot=0, retGmWon=0, retGmTot=0, bpConvWon=0, bpConvTot=0,
             bpSavedWon=0, bpSavedTot=0, tbPlayed=0, tbWon=0, decPlayed=0, decWon=0)
    for date, rows, isFirst, winner, scores in entries:
        if date < cutoff: continue
        r = [s for s in rows if str(s.get("player_key")) in TARGETS and
             str(s.get("player_key")) == (rows[0].get("player_key") if False else str(s.get("player_key")))]
        # filter to this player's rows explicitly
        pk = None
        for s in rows:
            pass
        # re-derive player key for this entry: the player whose isFirst matches
        # (we know pk from the outer loop, so recover via player_key on rows that match)
        # Simpler: this entry belongs to a target; find its rows by matching both keys present
        # We stored per (pk) already, so filter rows by the pk we are aggregating:
        my_pk = cur_pk
        pr = [s for s in rows if str(s.get("player_key")) == my_pk]
        if not pr: continue
        svcPW = pick(pr,"Points","Service Points Won")
        svt = num(svcPW["stat_total"]) if svcPW else None
        if not svt or svt <= 0: continue
        A["m"] += 1
        fS = pick(pr,"Service","1st Serve Points Won"); sS = pick(pr,"Service","2nd Serve Points Won")
        svcGW = pick(pr,"Games","Service Games Won"); retGW = pick(pr,"Games","Return Games Won")
        r1 = pick(pr,"Return","1st Return Points Won"); r2 = pick(pr,"Return","2nd Return Points Won")
        bpc = pick(pr,"Return","Break Points Converted"); bps = pick(pr,"Service","Break Points Saved")
        aces = pick(pr,"Service","Aces"); dfs = pick(pr,"Service","Double Faults")
        retPW = pick(pr,"Points","Return Points Won")
        def add(key, s, field):
            if s is not None:
                v = num(s.get(field))
                if v is not None: A[key] += v
        add("firstInTot", fS, "stat_total"); add("firstWon", fS, "stat_won")
        add("secondWon", sS, "stat_won");   add("secondTot", sS, "stat_total")
        add("svcPWon", svcPW, "stat_won");  A["svpt"] += svt
        add("svGmWon", svcGW, "stat_won");  add("svGmTot", svcGW, "stat_total")
        add("aces", aces, "stat_value");    add("dfs", dfs, "stat_value")
        add("retPWon", retPW, "stat_won");  add("retPTot", retPW, "stat_total")
        add("ret1Won", r1, "stat_won");     add("ret1Tot", r1, "stat_total")
        add("ret2Won", r2, "stat_won");     add("ret2Tot", r2, "stat_total")
        add("retGmWon", retGW, "stat_won"); add("retGmTot", retGW, "stat_total")
        add("bpConvWon", bpc, "stat_won");  add("bpConvTot", bpc, "stat_total")
        add("bpSavedWon", bps, "stat_won"); add("bpSavedTot", bps, "stat_total")
        # tiebreak / deciding from scores
        if isinstance(scores, list) and scores:
            sf = ss = 0
            for st in scores:
                a, b = num(st.get("score_first")), num(st.get("score_second"))
                if a is None or b is None: continue
                if a == 0 and b == 0: continue
                if a > b: sf += 1
                elif b > a: ss += 1
                fa, fb = math.floor(a), math.floor(b)
                if (fa == 7 and fb == 6) or (fa == 6 and fb == 7):
                    A["tbPlayed"] += 1
                    first_won_tb = a > b
                    if first_won_tb == isFirst: A["tbWon"] += 1
            wS, lS = max(sf, ss), min(sf, ss)
            deciding = (wS == 2 and lS == 1) or (wS == 3 and lS == 2)
            if deciding and winner in ("First Player", "Second Player"):
                A["decPlayed"] += 1
                if (winner == "First Player") == isFirst: A["decWon"] += 1
    return A

def rate(A):
    firstInPct = A["firstInTot"]/A["svpt"]*100
    firstWonPct = A["firstWon"]/A["firstInTot"]*100
    secondWonPct = A["secondWon"]/A["secondTot"]*100 if A["secondTot"] else 0
    holdPct = A["svGmWon"]/A["svGmTot"]*100
    acesPM = A["aces"]/A["m"]; dfPM = A["dfs"]/A["m"]
    serve = firstInPct+firstWonPct+secondWonPct+holdPct+acesPM-dfPM
    ret1 = A["ret1Won"]/A["ret1Tot"]*100; ret2 = A["ret2Won"]/A["ret2Tot"]*100
    retGm = A["retGmWon"]/A["retGmTot"]*100; bpConv = A["bpConvWon"]/A["bpConvTot"]*100
    ret = ret1+ret2+retGm+bpConv
    bpSaved = A["bpSavedWon"]/A["bpSavedTot"]*100
    tb = A["tbWon"]/A["tbPlayed"]*100 if A["tbPlayed"] else None
    dec = A["decWon"]/A["decPlayed"]*100 if A["decPlayed"] else None
    parts = [bpSaved, bpConv, tb, dec]; present = [p for p in parts if p is not None]
    up = sum(present) if len(present) >= 4 else (sum(present)/len(present)*4 if len(present) == 3 else None)
    svcPWonPct = A["svcPWon"]/A["svpt"]*100; retPWonPct = A["retPWon"]/A["retPTot"]*100
    dom = retPWonPct/(100-svcPWonPct)
    return dict(matches=A["m"], serve=round(serve,1), ret=round(ret,1),
                up=round(up,1) if up is not None else None, up_components=len(present),
                dom=round(dom,2))

for pk, nm in TARGETS.items():
    cur_pk = pk
    A = agg_last52(raw[pk])
    r = rate(A)
    print(f"[PY] {nm} ({pk}) last52 All: matches={r['matches']}  Serve={r['serve']}  "
          f"Return={r['ret']}  UnderPressure={r['up']} (comp={r['up_components']})  DominanceRatio={r['dom']}")
