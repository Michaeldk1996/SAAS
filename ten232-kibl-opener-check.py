#!/usr/bin/env python3
"""TEN-232 — are the three state flags real, or an echo of the request?

The first tests turned up an anomaly that decides whether the archive can
capture an opener at all:

  /info/markets ...                  -> 108 rows, states {current: 78, opener: 30}
  /info/markets ... is_current=true  -> 108 rows, SAME mix
  /info/markets ... is_current=false -> 108 rows, SAME mix
  /info/markets ... is_opener=true   -> 108 rows, states {opener: 108}

Identical counts under contradictory filters. Two readings, and they have
opposite consequences:

  (A) The filters are ignored, and `is_opener=true` also REWRITES the flag on
      the way out. Then the state labels are an echo of the request, the 30
      "openers" in the unfiltered call are the only real ones, and any archive
      that trusts a flag from a filtered pull is storing a fiction.

  (B) The filters work and the row SETS genuinely differ — the same cardinality
      is a coincidence of one opener and one current per line.

Counting cannot separate these. Comparing row identity can, so that is what
this does: pull both ways, key every row by its natural identity, and diff the
sets. Report only.
"""

import datetime as dt
import json
import sys
from collections import Counter

from kibl_client import KiblClient, TENNIS_LEAGUES_MEN, state_of

OUT = "ten232-kibl-opener-check.json"


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def ident(r):
    """Identity of a price WITHOUT its state flags.

    Deliberately excludes is_opener/is_previous/is_current: the question is
    whether the same underlying prices come back under both filters, and keying
    on the flags would assume the answer.
    """
    return (r.get("market_id"), r.get("fixture_id"), r.get("fixture_participant_id"),
            r.get("market_type_id"), r.get("segment_id"), r.get("side_id"),
            r.get("point"), r.get("alt_id"), r.get("price_american"),
            r.get("inserted_on"))


def main():
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0, tzinfo=None)
    c = KiblClient()
    c.authenticate()

    books, _ = c.get("/reference/sportsbooks")
    fs = ",".join(str(b["feed_source_id"]) for b in c.rows(books)
                  if isinstance(b, dict) and b.get("feed_source_id") is not None)
    men = ",".join(str(k) for k in TENNIS_LEAGUES_MEN)
    base = {"league_id": men, "feed_source_id": fs, "betting_type_id": 1,
            "start_time": iso(now), "end_time": iso(now + dt.timedelta(days=2))}
    res = {"started_utc": iso(now), "feed_source_id": fs, "base_params": base,
           "variants": {}}

    sets = {}
    for name, extra in [("unfiltered", {}),
                        ("is_opener_true", {"is_opener": True}),
                        ("is_opener_false", {"is_opener": False}),
                        ("is_current_true", {"is_current": True}),
                        ("is_current_false", {"is_current": False})]:
        payload, meta = c.markets(**{**base, **extra})
        rows = c.market_participants(payload)
        idents = {ident(r) for r in rows}
        sets[name] = {"idents": idents,
                      "flag_by_ident": {ident(r): state_of(r) for r in rows}}
        res["variants"][name] = {
            "status": meta["status"], "rows": len(rows),
            "distinct_idents": len(idents),
            "states": dict(Counter(state_of(r) for r in rows)),
            "distinct_market_ids": len({r.get("market_id") for r in rows}),
            "distinct_fixtures": len({r.get("fixture_id") for r in rows}),
        }
        print(f"  {name}: {len(rows)} rows, {len(idents)} distinct idents, "
              f"{res['variants'][name]['states']}")

    u = sets["unfiltered"]["idents"]
    o = sets["is_opener_true"]["idents"]
    res["comparison"] = {
        "unfiltered_n": len(u),
        "opener_true_n": len(o),
        "identical_sets": u == o,
        "in_opener_not_unfiltered": len(o - u),
        "in_unfiltered_not_opener": len(u - o),
        "jaccard": (round(len(u & o) / len(u | o), 4) if (u | o) else None),
    }

    # The decisive comparison: for prices present in BOTH pulls, did the state
    # label change between them? A label that moves with the request is not a
    # property of the price.
    flipped = []
    for key in (u & o):
        a = sets["unfiltered"]["flag_by_ident"][key]
        b = sets["is_opener_true"]["flag_by_ident"][key]
        if a != b:
            flipped.append({"unfiltered": a, "opener_true": b})
    res["comparison"]["shared_rows"] = len(u & o)
    res["comparison"]["label_flipped_on_shared_rows"] = len(flipped)
    res["comparison"]["flip_examples"] = flipped[:10]
    res["comparison"]["flip_pairs"] = dict(
        Counter(f"{f['unfiltered']}->{f['opener_true']}" for f in flipped))

    if res["comparison"]["identical_sets"] and flipped:
        verdict = ("ECHO — the same prices come back under both filters and the "
                   "state label FLIPS to match the request. State flags from a "
                   "filtered pull are not a property of the price. Only an "
                   "unfiltered pull's flags can be trusted.")
    elif res["comparison"]["identical_sets"] and not flipped:
        verdict = ("filters are ignored and labels are stable — the same rows and "
                   "the same labels come back regardless of the filter.")
    else:
        verdict = ("filters genuinely select different row sets; the matching "
                   "counts were coincidence.")
    res["verdict"] = verdict

    # Same question for is_current, since that is the flag the archive keys on.
    ct, cf = sets["is_current_true"]["idents"], sets["is_current_false"]["idents"]
    res["is_current_comparison"] = {
        "true_n": len(ct), "false_n": len(cf), "identical_sets": ct == cf,
        "jaccard": (round(len(ct & cf) / len(ct | cf), 4) if (ct | cf) else None),
        "label_flipped": sum(
            1 for k in (ct & cf)
            if sets["is_current_true"]["flag_by_ident"][k]
            != sets["is_current_false"]["flag_by_ident"][k]),
    }

    res["calls"] = c.calls
    res["call_log"] = c.call_log
    with open(OUT, "w") as f:
        json.dump(res, f, indent=1, default=str)
    print("\nVERDICT:", verdict)
    print(json.dumps(res["comparison"], indent=1))
    print("is_current:", json.dumps(res["is_current_comparison"], indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
