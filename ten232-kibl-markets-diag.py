#!/usr/bin/env python3
"""TEN-232 diagnostic — why does /info/markets return no `result` at all?

The first-tests run found a split that decides the whole ticket:

  /info/fixtures   200, hundreds of tennis fixtures, parsed fine
  /info/markets    200, 156 bytes, envelope WITHOUT a `result` key, every time,
                   for every league, every betting_type_id, every time window

and /reference/sportsbooks lists exactly ONE book — Sports411 (feed_source_id
43, tier "primary") — not Bet105.

Zero rows and no-result-key are different things, and "our account cannot see
markets" and "tennis has no markets" are different things again. This probe
separates them. The control that matters is the NON-TENNIS league: if markets
come back for NBA and not for tennis, the restriction is per-sport; if markets
come back for nothing at all, the account has fixtures-only entitlement and no
amount of tennis-side tuning will change it.

Raw bodies are printed in full — they are ~156 bytes and contain no credential.
Report only.
"""

import datetime as dt
import json
import sys
from collections import Counter

from kibl_client import KiblClient, TENNIS_LEAGUES_MEN

OUT = "ten232-kibl-markets-diag.json"


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def main():
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0, tzinfo=None)
    c = KiblClient()
    c.authenticate()
    res = {"started_utc": iso(now), "probes": []}

    def probe(label, path, params, keep_body=True):
        payload, meta = c.get(path, params)
        rec = {
            "label": label, "path": path, "params": params,
            "status": meta["status"], "bytes": meta["bytes"],
            "rows": len(c.rows(payload)),
            "envelope_keys": sorted(payload.keys()) if isinstance(payload, dict) else None,
            "has_result_key": isinstance(payload, dict) and "result" in payload,
            "description": payload.get("description") if isinstance(payload, dict) else None,
            "code_field": payload.get("code") if isinstance(payload, dict) else None,
        }
        # Small bodies are printed whole: the `description` field is the only
        # place the API explains itself, and guessing at it is how this kind of
        # thing gets misreported.
        if keep_body and meta["bytes"] <= 4000 and isinstance(payload, dict):
            rec["body"] = payload
        res["probes"].append(rec)
        print(f"  {label}: HTTP {meta['status']} {meta['bytes']}B "
              f"result_key={rec['has_result_key']} rows={rec['rows']} "
              f"desc={rec['description']!r}")
        return payload, rec

    # ---- 1. A real tennis fixture id, so "no fixture matched" is excluded.
    print("\n[1] pick real upcoming tennis fixtures")
    fixture_ids, sample_fx = [], []
    for lid in TENNIS_LEAGUES_MEN:
        payload, _ = c.get("/info/fixtures",
                           {"league_id": lid, "start_time": iso(now),
                            "end_time": iso(now + dt.timedelta(days=3))})
        rows = c.rows(payload)
        print(f"  league {lid}: {len(rows)} fixtures")
        for f in rows[:3]:
            if isinstance(f, dict) and f.get("fixture_id"):
                fixture_ids.append(f["fixture_id"])
                sample_fx.append({k: f.get(k) for k in
                                  ("fixture_id", "league_id", "start_time", "name",
                                   "feed_source_id", "fixture_type_id", "sport_id")})
    res["sample_fixtures"] = sample_fx
    res["fixture_feed_sources"] = dict(
        Counter(f.get("feed_source_id") for f in sample_fx))
    print(f"  collected {len(fixture_ids)} fixture ids; "
          f"fixture feed_source_id values: {res['fixture_feed_sources']}")

    # ---- 2. /info/markets every way it can be asked for tennis.
    print("\n[2] /info/markets — tennis, every filter shape")
    fid = fixture_ids[0] if fixture_ids else None
    fids = ",".join(str(x) for x in fixture_ids[:10])
    men = ",".join(str(k) for k in TENNIS_LEAGUES_MEN)
    win = {"start_time": iso(now - dt.timedelta(days=1)),
           "end_time": iso(now + dt.timedelta(days=3))}

    probe("no params at all", "/info/markets", {})
    if fid:
        probe("fixture_id only", "/info/markets", {"fixture_id": fid})
        probe("fixture_id + feed_source 43", "/info/markets",
              {"fixture_id": fid, "feed_source_id": 43})
        probe("fixture_id + is_current false", "/info/markets",
              {"fixture_id": fid, "is_current": False})
        probe("fixture_id batch of 10", "/info/markets", {"fixture_id": fids})
    probe("league only, no window", "/info/markets", {"league_id": men})
    probe("league + window", "/info/markets", {**win, "league_id": men})
    probe("league + window + feed_source 43", "/info/markets",
          {**win, "league_id": men, "feed_source_id": 43})
    probe("ATP alone, no window", "/info/markets", {"league_id": 19})
    probe("since_last_updated 7d", "/info/markets",
          {"league_id": men, "since_last_updated": iso(now - dt.timedelta(days=7))})

    # ---- 3. THE CONTROL. A non-tennis league, from Kibl's own quick start.
    # If markets return here, the restriction is per-sport. If they do not,
    # this account has no market entitlement at all and tennis is irrelevant.
    print("\n[3] CONTROL — non-tennis leagues (NBA 3, and the busiest league we can see)")
    probe("NBA league_id=3, no window", "/info/markets", {"league_id": 3})
    probe("NBA league_id=3 + window", "/info/markets", {**win, "league_id": 3})

    # Find whichever leagues actually have fixtures right now, across all sports,
    # so the control is not hostage to the NBA being out of season.
    lg_payload, _ = c.get("/reference/leagues")
    leagues = [l for l in c.rows(lg_payload) if isinstance(l, dict)]
    res["n_leagues_visible"] = len(leagues)
    busiest = []
    for lg in leagues:
        if lg.get("sport_id") in (1, 3, 4) and lg.get("league_id"):  # NFL, NBA, NHL
            busiest.append(lg)
    tried = 0
    for lg in busiest:
        if tried >= 4:
            break
        fx, _ = c.get("/info/fixtures", {"league_id": lg["league_id"], **win})
        n = len(c.rows(fx))
        if n == 0:
            continue
        tried += 1
        print(f"  control league {lg.get('name')} ({lg['league_id']}), {n} fixtures")
        p, rec = probe(f"markets for {lg.get('name')} ({lg['league_id']})",
                       "/info/markets", {**win, "league_id": lg["league_id"]})
        rec["control_fixtures"] = n
    res["control_leagues_tried"] = tried

    # ---- 4. Freshness endpoint — Kibl's own statement of what it holds.
    print("\n[4] /info/markets-last-updated — Kibl's own view of what it holds for us")
    probe("last-updated, all", "/info/markets-last-updated", {})
    probe("last-updated, tennis sport 5", "/info/markets-last-updated", {"sport_id": 5})
    probe("last-updated, men's leagues", "/info/markets-last-updated", {"league_id": men})
    probe("markets-alerts, men's leagues", "/info/markets-alerts", {"league_id": men})

    # ---- 5. Do we see any book other than Sports411 anywhere?
    print("\n[5] sportsbooks / feed types")
    sb, _ = probe("reference/sportsbooks (no filter)", "/reference/sportsbooks", {},
                  keep_body=False)
    books = [b for b in c.rows(sb) if isinstance(b, dict)]
    res["books"] = [{k: b.get(k) for k in
                     ("feed_source_id", "name", "tag", "feed_type_id", "metadata")}
                    for b in books]
    print(f"  books visible: {[(b.get('feed_source_id'), b.get('name')) for b in books]}")
    for ft in (1, 2, 3, 4, 5, 6):
        p, _ = c.get("/reference/sportsbooks", {"feed_type_id": ft})
        got = [b for b in c.rows(p) if isinstance(b, dict)]
        if got:
            print(f"  feed_type_id {ft}: {[(b.get('feed_source_id'), b.get('name')) for b in got]}")
            res.setdefault("books_by_feed_type", {})[ft] = [
                {"feed_source_id": b.get("feed_source_id"), "name": b.get("name")} for b in got]
    ftp, _ = c.get("/reference/feed-types")
    res["feed_types"] = [r for r in c.rows(ftp) if isinstance(r, dict)]

    res["calls"] = c.calls
    res["bytes_down"] = c.bytes_down
    res["call_log"] = c.call_log

    # Verdict, computed rather than asserted.
    mkt = [p for p in res["probes"] if p["path"] == "/info/markets"]
    tennis_rows = sum(p["rows"] for p in mkt if "control" not in p["label"]
                      and "NBA" not in p["label"])
    control = [p for p in mkt if "control" in p["label"] or "NBA" in p["label"]]
    control_rows = sum(p["rows"] for p in control)
    res["verdict"] = {
        "tennis_market_rows": tennis_rows,
        "control_market_rows": control_rows,
        "control_calls": len(control),
        "any_result_key_on_markets": any(p["has_result_key"] for p in mkt),
        "reading": (
            "markets work; tennis specifically returns none" if control_rows > 0 and tennis_rows == 0
            else "markets work for tennis too" if tennis_rows > 0
            else "NO market rows for ANY sport — account appears to have fixtures-only "
                 "entitlement, or markets require a grant we do not hold"),
    }
    with open(OUT, "w") as f:
        json.dump(res, f, indent=1, default=str)
    print("\nVERDICT:", json.dumps(res["verdict"], indent=1))
    print(f"\n[diag] {c.calls} calls, {c.bytes_down:,}B")
    return 0


if __name__ == "__main__":
    sys.exit(main())
