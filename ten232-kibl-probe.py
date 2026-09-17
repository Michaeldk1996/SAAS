#!/usr/bin/env python3
"""TEN-232 first tests (a-d) — run BEFORE the archive is built.

Founder's four questions, in his order:

  a. What is this account ACTUALLY entitled to (leagues, betting types, market
     types, segments, is_main, feed_source_id)? A restricted account returns
     HTTP 200 with fewer rows and never a 403, so entitlement is established
     two ways that can disagree: the Cognito token's own claims, and empirical
     row counts per filter. Both are reported.
  b. Does /info/markets start_time/end_time reach BACKWARDS to finished
     fixtures? If so, how far, and is the series complete or only three states?
     This decides how much history is recoverable rather than lost forever.
  c. Bet105-SPECIFIC coverage (not the all-books aggregate) for ATP, Challenger
     and ITF Men: % of fixtures priced, which markets, lines per fixture.
  d. Is the is_current default trap actually defeated by the two-call merge?

Report only. Writes ten232-kibl-probe.json (machine) and TEN232-KIBL-PROBE.md
(the founder's report). Nothing is archived, nothing is published, no site
surface is touched.

Standing rules honoured: never fabricate or approximate; a figure we could not
measure is written as "-", not guessed; every figure carries its n.
"""

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
from collections import Counter, defaultdict

from kibl_client import (
    KiblClient, TENNIS_LEAGUES_MEN, TENNIS_LEAGUES_WOMEN,
    redact_claims, state_of, MIN_INTERVAL_S,
)

OUT_JSON = "ten232-kibl-probe.json"
OUT_MD = "TEN232-KIBL-PROBE.md"

DASH = "-"


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def commit_hash():
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                              capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return DASH


# --------------------------------------------------------------- test a

def test_a_entitlement(c, now):
    """What this account can actually see."""
    out = {"token_claims": {}, "reference": {}, "empirical": {}, "restrictions": []}

    # 1. The token's own claims. Entitlement lives in Cognito user attributes,
    #    so if it is expressed anywhere declaratively, it is here.
    out["token_claims"]["id_token"] = redact_claims(c.id_claims)
    out["token_claims"]["access_token"] = redact_claims(c.access_claims)
    custom = {k: v for k, v in {**c.id_claims, **c.access_claims}.items()
              if k.startswith("custom:") or k.startswith("kibl")}
    out["token_claims"]["custom_attributes"] = custom or {}

    # 2. Reference tables. These are the enumerations the archive has to encode,
    #    and a short table here is itself an entitlement restriction.
    for name, path, params in [
        ("sports", "/reference/sports", None),
        ("sportsbooks", "/reference/sportsbooks", None),
        ("leagues", "/reference/leagues", None),
        ("betting_types", "/reference/betting-types", None),
        ("market_types", "/reference/market-types", None),
        ("segments", "/reference/segments", None),
        ("fixture_types", "/reference/fixture-types", None),
        ("feed_types", "/reference/feed-types", None),
    ]:
        payload, meta = c.get(path, params)
        rows = c.rows(payload)
        out["reference"][name] = {"status": meta["status"], "n": len(rows),
                                  "rows": rows if len(rows) <= 400 else rows[:400],
                                  "truncated": len(rows) > 400}

    # Bet105's feed_source_id — needed by every later measurement, so resolved
    # here and echoed loudly rather than assumed.
    books = out["reference"]["sportsbooks"]["rows"]
    bet105 = [b for b in books
              if "105" in json.dumps(b).lower() or "bet105" in json.dumps(b).lower()]
    out["bet105_candidates"] = bet105
    out["bet105_feed_source_id"] = (
        bet105[0].get("feed_source_id") if len(bet105) == 1 and isinstance(bet105[0], dict)
        else None
    )

    # Tennis sport id, resolved from the table rather than hard-coded.
    tennis = [s for s in out["reference"]["sports"]["rows"]
              if isinstance(s, dict) and "tennis" in str(s.get("name", "")).lower()]
    out["tennis_sport"] = tennis
    out["tennis_sport_id"] = tennis[0].get("sport_id") if len(tennis) == 1 else None

    # 3. Empirical league entitlement. A league we are not entitled to returns
    #    200 with zero rows — indistinguishable from a league with no fixtures
    #    today, which is why the window is wide and the ambiguity is reported.
    start, end = now - dt.timedelta(days=3), now + dt.timedelta(days=7)
    league_counts = {}
    for lid, label in {**TENNIS_LEAGUES_MEN, **TENNIS_LEAGUES_WOMEN}.items():
        payload, meta = c.get("/info/fixtures",
                              {"league_id": lid, "start_time": iso(start),
                               "end_time": iso(end)})
        rows = c.rows(payload)
        league_counts[lid] = {"label": label, "status": meta["status"],
                              "fixtures": len(rows) if meta["status"] == 200 else None,
                              "in_archive_scope": lid in TENNIS_LEAGUES_MEN}
    out["empirical"]["leagues"] = league_counts

    # 4. betting_type_id. The spec says 1=Prematch, 2=Live, but tennis live is
    #    3 (Live Fluid) and uses 2 for nothing at all — asking for the wrong id
    #    returns 200 and zero rows, which reads as "no live coverage".
    men = ",".join(str(k) for k in TENNIS_LEAGUES_MEN)
    bt = {}
    for bid in (1, 2, 3):
        payload, meta = c.get("/info/markets",
                              {"league_id": men, "betting_type_id": bid,
                               "start_time": iso(now - dt.timedelta(hours=12)),
                               "end_time": iso(now + dt.timedelta(days=2))})
        parts = c.market_participants(payload)
        bt[bid] = {"status": meta["status"], "rows": len(parts), "bytes": meta["bytes"]}
    out["empirical"]["betting_types"] = bt

    # 5. is_main. A main-only entitlement silently halves line coverage; the
    #    alternates are exactly what the founder asked to archive.
    ismain = {}
    for flag in (None, True, False):
        payload, meta = c.get("/info/markets",
                              {"league_id": men, "is_main": flag,
                               "start_time": iso(now), "end_time": iso(now + dt.timedelta(days=2))})
        parts = c.market_participants(payload)
        ismain["omitted" if flag is None else str(flag).lower()] = {
            "status": meta["status"], "rows": len(parts),
            "distinct_alt_ids": sorted({p.get("alt_id") for p in parts if p.get("alt_id") is not None}),
            "is_main_values": sorted({bool(p.get("is_main")) for p in parts}),
        }
    out["empirical"]["is_main"] = ismain

    # 6. Which books do we actually receive? If the answer is one, the account
    #    is feed-source restricted to Bet105 and the "all books" figures in the
    #    public coverage CSVs do not apply to us at all.
    payload, meta = c.get("/info/markets",
                          {"league_id": men, "start_time": iso(now),
                           "end_time": iso(now + dt.timedelta(days=3))})
    parts = c.market_participants(payload)
    out["empirical"]["feed_sources_seen"] = {
        "status": meta["status"], "rows": len(parts),
        "counts": dict(Counter(p.get("feed_source_id") for p in parts).most_common()),
    }
    out["empirical"]["market_types_seen"] = dict(
        Counter(p.get("market_type_id") for p in parts).most_common())
    out["empirical"]["segments_seen"] = dict(
        Counter(p.get("segment_id") for p in parts).most_common())

    # Restrictions, stated rather than implied.
    for lid, rec in league_counts.items():
        if rec["status"] != 200:
            out["restrictions"].append(f"league {lid} ({rec['label']}): HTTP {rec['status']}")
    if len({k for k, v in bt.items() if v["rows"]}) == 0:
        out["restrictions"].append("no markets returned for ANY betting_type_id")
    return out


# --------------------------------------------------------------- test b

def test_b_backward_reach(c, now, bet105_id):
    """Does start_time/end_time reach backwards to finished fixtures?

    This is the question that decides whether any history is recoverable. Two
    things are separated deliberately: a FIXTURE surviving in /info/fixtures is
    not the same as its MARKETS surviving in /info/markets, and only the second
    is worth anything to us.
    """
    men = ",".join(str(k) for k in TENNIS_LEAGUES_MEN)
    offsets = [1, 2, 3, 5, 7, 14, 30, 60, 90, 180, 365]
    windows = []
    for d in offsets:
        w_end = now - dt.timedelta(days=d)
        w_start = w_end - dt.timedelta(days=1)
        fx_payload, fx_meta = c.get("/info/fixtures",
                                    {"league_id": men, "start_time": iso(w_start),
                                     "end_time": iso(w_end)})
        fixtures = c.rows(fx_payload)
        rec = {
            "days_back": d, "window": [iso(w_start), iso(w_end)],
            "fixtures_status": fx_meta["status"],
            "fixtures": len(fixtures) if fx_meta["status"] == 200 else None,
        }
        # Markets for the same window, all three states, so "markets survive"
        # and "only the current price survives" are told apart.
        rows, metas = c.markets_three_state(
            league_id=men, start_time=iso(w_start), end_time=iso(w_end),
            feed_source_id=bet105_id)
        ok = all(m["status"] == 200 for m in metas)
        states = Counter(state_of(r) for r in rows)
        rec.update({
            "markets_status": [m["status"] for m in metas],
            "market_rows": len(rows) if ok else None,
            "states": dict(states) if ok else None,
            "fixtures_with_markets": len({r.get("fixture_id") for r in rows}) if ok else None,
            "distinct_inserted_on": len({r.get("inserted_on") for r in rows}) if ok else None,
            "bytes": sum(m["bytes"] for m in metas),
        })
        windows.append(rec)
        # Stop walking backwards once two consecutive windows are empty of both
        # fixtures and markets: further calls would measure the same nothing.
        if len(windows) >= 2 and all(
                (w["fixtures"] or 0) == 0 and (w["market_rows"] or 0) == 0
                for w in windows[-2:]):
            break

    reachable = [w["days_back"] for w in windows if (w["market_rows"] or 0) > 0]
    return {
        "windows": windows,
        "max_days_back_with_markets": max(reachable) if reachable else None,
        "max_days_back_with_fixtures": max(
            [w["days_back"] for w in windows if (w["fixtures"] or 0) > 0], default=None),
        "stopped_early": len(windows) < len(offsets),
    }


# --------------------------------------------------------------- test c

def test_c_bet105_coverage(c, now, bet105_id, horizon_days=3):
    """Bet105-specific pre-match coverage per men's league."""
    start, end = now, now + dt.timedelta(days=horizon_days)
    per_league = {}
    for lid, label in TENNIS_LEAGUES_MEN.items():
        fx_payload, fx_meta = c.get("/info/fixtures",
                                    {"league_id": lid, "start_time": iso(start),
                                     "end_time": iso(end)})
        fixtures = c.rows(fx_payload)
        fixture_ids = {f.get("fixture_id") for f in fixtures if isinstance(f, dict)}

        rows, metas = c.markets_three_state(
            league_id=lid, betting_type_id=1,
            start_time=iso(start), end_time=iso(end), feed_source_id=bet105_id)
        ok = all(m["status"] == 200 for m in metas)

        priced = {r.get("fixture_id") for r in rows}
        # Market presence matrix: (market_type_id, segment_id) -> fixtures priced.
        matrix = defaultdict(set)
        lines_per_fixture = defaultdict(set)
        sides_per_market = defaultdict(set)
        for r in rows:
            key = f"{r.get('market_type_id')}/{r.get('segment_id')}"
            matrix[key].add(r.get("fixture_id"))
            lines_per_fixture[r.get("fixture_id")].add(
                (r.get("market_type_id"), r.get("segment_id"), r.get("point"), r.get("alt_id")))
            sides_per_market[(r.get("fixture_id"), r.get("market_type_id"),
                              r.get("segment_id"), r.get("point"), r.get("alt_id"))].add(
                r.get("side_id"))

        n_fix = len(fixture_ids)
        both_sides = [k for k, v in sides_per_market.items() if len(v) >= 2]
        per_league[lid] = {
            "label": label,
            "fixtures_status": fx_meta["status"],
            "n_fixtures": n_fix,
            "markets_ok": ok,
            "n_fixtures_priced": len(priced & fixture_ids) if ok else None,
            "pct_priced": (round(100.0 * len(priced & fixture_ids) / n_fix, 1)
                           if ok and n_fix else None),
            "market_rows": len(rows) if ok else None,
            "presence": ({k: len(v) for k, v in sorted(matrix.items())} if ok else None),
            "lines_per_fixture_mean": (
                round(sum(len(v) for v in lines_per_fixture.values()) / len(lines_per_fixture), 1)
                if ok and lines_per_fixture else None),
            "lines_per_fixture_max": (
                max((len(v) for v in lines_per_fixture.values()), default=0) if ok else None),
            "both_sides_quoted_pct": (
                round(100.0 * len(both_sides) / len(sides_per_market), 1)
                if ok and sides_per_market else None),
            "distinct_points": (
                sorted({r.get("point") for r in rows if r.get("point") is not None})[:40]
                if ok else None),
            "states": dict(Counter(state_of(r) for r in rows)) if ok else None,
        }
    return {"horizon_days": horizon_days, "window": [iso(start), iso(end)],
            "per_league": per_league}


# --------------------------------------------------------------- test d

def test_d_is_current_trap(c, now, bet105_id):
    """Prove the two-call merge actually returns all three states.

    A read cannot prove this — the three counts have to be produced by three
    different calls and compared, because the failure mode is that the default
    call looks complete.
    """
    men = ",".join(str(k) for k in TENNIS_LEAGUES_MEN)
    base = {"league_id": men, "betting_type_id": 1,
            "start_time": iso(now), "end_time": iso(now + dt.timedelta(days=2)),
            "feed_source_id": bet105_id}

    variants = {}
    for name, extra in [
        ("default_no_flag", {}),
        ("is_current_true", {"is_current": True}),
        ("is_current_false", {"is_current": False}),
        ("is_opener_true", {"is_opener": True}),
    ]:
        payload, meta = c.get("/info/markets", {**base, **extra})
        parts = c.market_participants(payload)
        variants[name] = {
            "status": meta["status"], "rows": len(parts),
            "states": dict(Counter(state_of(p) for p in parts)),
        }

    merged, metas = c.markets_three_state(**base)
    merged_states = Counter(state_of(r) for r in merged)
    default_rows = variants["default_no_flag"]["rows"]

    return {
        "variants": variants,
        "merged_rows": len(merged),
        "merged_states": dict(merged_states),
        "merge_calls_ok": all(m["status"] == 200 for m in metas),
        # The trap is CONFIRMED if the default call is missing states the merge
        # recovers. It is REFUTED only if the default already carries all three.
        "trap_confirmed": bool(
            merged_states.get("opener", 0) + merged_states.get("previous", 0) > 0
            and len(variants["default_no_flag"]["states"]) < len(merged_states)),
        "rows_lost_by_default": (len(merged) - default_rows) if default_rows is not None else None,
    }


# --------------------------------------------------------------- report

def fmt(v, suffix=""):
    if v is None or v == "":
        return DASH
    return f"{v}{suffix}"


def build_markdown(res):
    L = []
    A = L.append
    A(f"# TEN-232 — Kibl / Bet105 first tests (a–d)")
    A("")
    A(f"- commit `{res['commit']}`")
    A(f"- run started `{res['started_utc']}` UTC")
    A(f"- API calls `{res['calls']}`, bytes down `{res['bytes_down']:,}`, "
      f"min interval `{MIN_INTERVAL_S}s` (conservative — Kibl documents no rate limit)")
    A("")
    A("Report only. Nothing archived, nothing published, no site surface touched.")
    A("")

    # --- a
    a = res.get("test_a") or {}
    A("## a. What this account is actually entitled to")
    A("")
    custom = a.get("token_claims", {}).get("custom_attributes") or {}
    A(f"**Cognito custom attributes on our token:** "
      f"{'`' + json.dumps(custom) + '`' if custom else 'none — entitlement is not expressed in the token'}")
    A("")
    A(f"**Bet105 feed_source_id:** `{fmt(a.get('bet105_feed_source_id'))}` "
      f"(candidates matched: {len(a.get('bet105_candidates') or [])})")
    A(f"**Tennis sport_id:** `{fmt(a.get('tennis_sport_id'))}`")
    A("")
    A("### Reference tables visible to us")
    A("")
    A("| table | HTTP | n |")
    A("|---|---|---|")
    for name, rec in (a.get("reference") or {}).items():
        A(f"| {name} | {rec['status']} | {rec['n']} |")
    A("")
    A("### Leagues — empirical (fixtures in a −3d/+7d window)")
    A("")
    A("| league_id | league | HTTP | fixtures | in archive scope |")
    A("|---|---|---|---|---|")
    for lid, rec in (a.get("empirical", {}).get("leagues") or {}).items():
        A(f"| {lid} | {rec['label']} | {rec['status']} | {fmt(rec['fixtures'])} | "
          f"{'yes' if rec['in_archive_scope'] else 'NO (reported, not archived)'} |")
    A("")
    A("### betting_type_id — which ids actually carry tennis rows")
    A("")
    A("| betting_type_id | HTTP | market rows |")
    A("|---|---|---|")
    for bid, rec in (a.get("empirical", {}).get("betting_types") or {}).items():
        label = {1: "Prematch", 2: "Live Stop-N-Go", 3: "Live Fluid"}.get(int(bid), "?")
        A(f"| {bid} ({label}) | {rec['status']} | {rec['rows']} |")
    A("")
    A("### is_main — do we receive alternates?")
    A("")
    A("| is_main | HTTP | rows | distinct alt_id |")
    A("|---|---|---|---|")
    for k, rec in (a.get("empirical", {}).get("is_main") or {}).items():
        A(f"| {k} | {rec['status']} | {rec['rows']} | {rec['distinct_alt_ids']} |")
    A("")
    fs = a.get("empirical", {}).get("feed_sources_seen") or {}
    A(f"### Feed sources actually received (n={fmt(fs.get('rows'))} rows)")
    A("")
    A(f"`{json.dumps(fs.get('counts') or {})}`")
    A("")
    if a.get("restrictions"):
        A("### Restrictions found")
        A("")
        for r in a["restrictions"]:
            A(f"- {r}")
        A("")

    # --- b
    b = res.get("test_b") or {}
    A("## b. Does the time window reach BACKWARDS to finished fixtures?")
    A("")
    A(f"**Furthest back with Bet105 market rows:** "
      f"`{fmt(b.get('max_days_back_with_markets'), ' days')}`  ")
    A(f"**Furthest back with fixtures (no prices):** "
      f"`{fmt(b.get('max_days_back_with_fixtures'), ' days')}`")
    A("")
    A("| days back | fixtures | market rows | opener | previous | current | fixtures priced | distinct inserted_on |")
    A("|---|---|---|---|---|---|---|---|")
    for w in b.get("windows", []):
        st = w.get("states") or {}
        A(f"| {w['days_back']} | {fmt(w.get('fixtures'))} | {fmt(w.get('market_rows'))} | "
          f"{fmt(st.get('opener'))} | {fmt(st.get('previous'))} | {fmt(st.get('current'))} | "
          f"{fmt(w.get('fixtures_with_markets'))} | {fmt(w.get('distinct_inserted_on'))} |")
    A("")
    A("`distinct inserted_on` is the series-depth test: three states per line means "
      "at most three distinct stamps per line. A number far above 3× the line count "
      "would be the only evidence a real tick series exists.")
    A("")

    # --- c
    c_ = res.get("test_c") or {}
    A("## c. Bet105-specific pre-match coverage (men's leagues)")
    A("")
    A(f"Window `{' → '.join(c_.get('window', [DASH, DASH]))}`, "
      f"betting_type_id=1 (Prematch), feed_source_id = Bet105 only.")
    A("")
    A("| league | fixtures (n) | priced | % priced | market rows | lines/fixture mean | max | both sides % |")
    A("|---|---|---|---|---|---|---|---|")
    for lid, rec in (c_.get("per_league") or {}).items():
        A(f"| {rec['label']} ({lid}) | {rec['n_fixtures']} | {fmt(rec['n_fixtures_priced'])} | "
          f"{fmt(rec['pct_priced'], '%')} | {fmt(rec['market_rows'])} | "
          f"{fmt(rec['lines_per_fixture_mean'])} | {fmt(rec['lines_per_fixture_max'])} | "
          f"{fmt(rec['both_sides_quoted_pct'], '%')} |")
    A("")
    A("### Market presence — fixtures carrying each market_type/segment")
    A("")
    for lid, rec in (c_.get("per_league") or {}).items():
        A(f"- **{rec['label']}**: `{json.dumps(rec.get('presence') or {})}`")
    A("")
    A("Read the keys as `market_type_id/segment_id`. The set handicap the founder "
      "asked about is Spread on the Sets segment; total sets is Total on Sets. "
      "Both are named against the reference tables in the JSON.")
    A("")

    # --- d
    d = res.get("test_d") or {}
    A("## d. Is the `is_current` default trap handled?")
    A("")
    A("| call | HTTP | rows | states returned |")
    A("|---|---|---|---|")
    for name, rec in (d.get("variants") or {}).items():
        A(f"| `{name}` | {rec['status']} | {rec['rows']} | `{json.dumps(rec['states'])}` |")
    A(f"| **two-call merge** | {'ok' if d.get('merge_calls_ok') else 'FAILED'} | "
      f"{fmt(d.get('merged_rows'))} | `{json.dumps(d.get('merged_states') or {})}` |")
    A("")
    A(f"**Trap confirmed:** `{d.get('trap_confirmed')}` — "
      f"rows the default call would have lost: `{fmt(d.get('rows_lost_by_default'))}`.")
    A("")
    A("The archive uses `markets_three_state()`, which is the two-call merge, and "
      "never a bare `/info/markets` pull.")
    A("")

    if res.get("errors"):
        A("## Errors")
        A("")
        for e in res["errors"]:
            A(f"- {e}")
        A("")
    A("## Rate-limit evidence")
    A("")
    rh = res.get("rate_headers_seen") or {}
    A(f"Headers observed across all {res['calls']} calls: "
      f"{'`' + json.dumps(rh) + '`' if rh else '**none** — no quota header, no 429, no Retry-After.'}")
    A("")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon-days", type=int, default=3)
    ap.add_argument("--skip", default="", help="comma-separated tests to skip: a,b,c,d")
    args = ap.parse_args()
    skip = {s.strip() for s in args.skip.split(",") if s.strip()}

    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0, tzinfo=None)
    res = {"commit": commit_hash(), "started_utc": iso(now), "errors": []}

    c = KiblClient()
    c.authenticate()

    if "a" not in skip:
        try:
            res["test_a"] = test_a_entitlement(c, now)
        except Exception as e:
            res["errors"].append(f"test a: {type(e).__name__}: {e}")

    bet105_id = (res.get("test_a") or {}).get("bet105_feed_source_id")
    res["bet105_feed_source_id_used"] = bet105_id
    if bet105_id is None:
        res["errors"].append(
            "Bet105 feed_source_id could not be resolved from /reference/sportsbooks; "
            "tests b/c/d ran WITHOUT a feed-source filter and therefore measure "
            "every book we receive, not Bet105 specifically.")

    for key, fn in [("test_b", lambda: test_b_backward_reach(c, now, bet105_id)),
                    ("test_c", lambda: test_c_bet105_coverage(c, now, bet105_id, args.horizon_days)),
                    ("test_d", lambda: test_d_is_current_trap(c, now, bet105_id))]:
        if key[-1] in skip:
            continue
        try:
            res[key] = fn()
        except Exception as e:
            res["errors"].append(f"{key}: {type(e).__name__}: {e}")

    res["calls"] = c.calls
    res["bytes_down"] = c.bytes_down
    res["call_log"] = c.call_log
    seen = {}
    for m in c.call_log:
        seen.update(m.get("rate_headers") or {})
    res["rate_headers_seen"] = seen

    with open(OUT_JSON, "w") as f:
        json.dump(res, f, indent=1, sort_keys=True, default=str)
    md = build_markdown(res)
    with open(OUT_MD, "w") as f:
        f.write(md)

    print(md)
    # A probe that silently did nothing must not read as a green run: fail the
    # step when no call succeeded, so the workflow's own status carries the truth.
    ok = sum(1 for m in c.call_log if m.get("status") == 200)
    print(f"\n[probe] {ok}/{c.calls} calls returned 200")
    if ok == 0:
        print("::error::probe made no successful call")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
