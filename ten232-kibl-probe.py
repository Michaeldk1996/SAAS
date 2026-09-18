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
    # /reference/sportsbooks returns exactly the books this account is entitled
    # to, so the list IS the entitlement. Every book is reported by name: the
    # founder's premise is that we are receiving Bet105, and whether that is the
    # book we actually get is his call to make on the evidence, not ours to
    # assume from the ticket title.
    def book_name(b):
        if not isinstance(b, dict):
            return ""
        return " ".join(str(b.get(f) or "") for f in ("name", "abrv", "tag",
                                                      "display_name", "short_name")).lower()
    out["entitled_books"] = [b for b in books if isinstance(b, dict)]
    out["entitled_feed_source_ids"] = [b.get("feed_source_id") for b in out["entitled_books"]]
    bet105 = [b for b in out["entitled_books"] if "105" in book_name(b)]
    out["bet105_candidates"] = bet105
    out["bet105_feed_source_id"] = (
        bet105[0].get("feed_source_id") if len(bet105) == 1 else None)
    # What every market call must carry. Without it the API returns HTTP 200
    # with no result and it reads as zero coverage.
    out["feed_source_for_calls"] = ",".join(
        str(x) for x in out["entitled_feed_source_ids"] if x is not None) or None

    # Tennis sport id, resolved from the table rather than hard-coded.
    tennis = [s for s in out["reference"]["sports"]["rows"]
              if isinstance(s, dict) and "tennis" in str(s.get("name", "")).lower()]
    out["tennis_sport"] = tennis
    out["tennis_sport_id"] = tennis[0].get("sport_id") if len(tennis) == 1 else None

    # Kibl's own freshness view, per league. This is the cleanest statement of
    # which tennis leagues actually receive prices for us, independent of
    # whether any fixture happens to be on today: a league absent from this list
    # is a league nobody is pricing to us, not a quiet day.
    payload, meta = c.get("/info/markets-last-updated",
                          {"sport_id": out["tennis_sport_id"]})
    out["tennis_freshness"] = {"status": meta["status"],
                               "rows": [r for r in c.rows(payload) if isinstance(r, dict)]}

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
    fs_all = out["feed_source_for_calls"]
    bt = {}
    for bid in (1, 2, 3):
        payload, meta = c.markets(league_id=men, betting_type_id=bid,
                                  feed_source_id=fs_all,
                                  start_time=iso(now - dt.timedelta(hours=12)),
                                  end_time=iso(now + dt.timedelta(days=2)))
        parts = c.market_participants(payload)
        bt[bid] = {"status": meta["status"], "rows": len(parts), "bytes": meta["bytes"]}
    out["empirical"]["betting_types"] = bt

    # 5. is_main. A main-only entitlement silently halves line coverage; the
    #    alternates are exactly what the founder asked to archive.
    ismain = {}
    for flag in (None, True, False):
        payload, meta = c.markets(league_id=men, is_main=flag, feed_source_id=fs_all,
                                  start_time=iso(now),
                                  end_time=iso(now + dt.timedelta(days=2)))
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
    payload, meta = c.markets(league_id=men, feed_source_id=fs_all,
                              start_time=iso(now),
                              end_time=iso(now + dt.timedelta(days=3)))
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

def test_b_backward_reach(c, now, feed_source_id):
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
        rows, metas = c.markets_all_states(
            league_id=men, start_time=iso(w_start), end_time=iso(w_end),
            feed_source_id=feed_source_id)
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

def test_c_bet105_coverage(c, now, feed_source_id, horizon_days=3):
    """Pre-match coverage per men's league, for our entitled book."""
    start, end = now, now + dt.timedelta(days=horizon_days)
    per_league = {}
    for lid, label in TENNIS_LEAGUES_MEN.items():
        fx_payload, fx_meta = c.get("/info/fixtures",
                                    {"league_id": lid, "start_time": iso(start),
                                     "end_time": iso(end)})
        fixtures = c.rows(fx_payload)
        fixture_ids = {f.get("fixture_id") for f in fixtures if isinstance(f, dict)}

        rows, metas = c.markets_all_states(
            league_id=lid, betting_type_id=1,
            start_time=iso(start), end_time=iso(end), feed_source_id=feed_source_id)
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

def test_d_is_current_trap(c, now, feed_source_id):
    """Prove the two-call merge actually returns all three states.

    A read cannot prove this — the three counts have to be produced by three
    different calls and compared, because the failure mode is that the default
    call looks complete.
    """
    men = ",".join(str(k) for k in TENNIS_LEAGUES_MEN)
    base = {"league_id": men, "betting_type_id": 1,
            "start_time": iso(now), "end_time": iso(now + dt.timedelta(days=2)),
            "feed_source_id": feed_source_id}

    variants = {}
    for name, extra in [
        ("default_no_flag", {}),
        ("is_current_true", {"is_current": True}),
        ("is_current_false", {"is_current": False}),
        ("is_opener_true", {"is_opener": True}),
    ]:
        payload, meta = c.markets(**{**base, **extra})
        parts = c.market_participants(payload)
        variants[name] = {
            "status": meta["status"], "rows": len(parts),
            "states": dict(Counter(state_of(p) for p in parts)),
        }

    merged, metas = c.markets_all_states(**base)
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

def market_names(test_a):
    """id -> name lookups built from the live reference tables."""
    out = {"market": {}, "segment": {}, "book": {}}
    ref = (test_a or {}).get("reference") or {}
    for row in (ref.get("market_types") or {}).get("rows") or []:
        if isinstance(row, dict) and row.get("market_type_id") is not None:
            out["market"][str(row["market_type_id"])] = row.get("name") or row["market_type_id"]
    for row in (ref.get("segments") or {}).get("rows") or []:
        if isinstance(row, dict) and row.get("segment_id") is not None:
            out["segment"][str(row["segment_id"])] = row.get("name") or row["segment_id"]
    for row in (ref.get("sportsbooks") or {}).get("rows") or []:
        if isinstance(row, dict) and row.get("feed_source_id") is not None:
            out["book"][str(row["feed_source_id"])] = row.get("name") or row["feed_source_id"]
    return out


def fmt(v, suffix=""):
    if v is None or v == "":
        return DASH
    return f"{v}{suffix}"


def build_markdown(res):
    L = []
    A = L.append
    A(f"# TEN-232 — Kibl / Sports411 first tests (a–d)")
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
    A("### Which book are we actually receiving?")
    A("")
    books = a.get("entitled_books") or []
    A(f"`/reference/sportsbooks` returns **{len(books)}** book(s) — that list IS the "
      f"entitlement, and it is the only book any market call can ask for:")
    A("")
    if books:
        A("| feed_source_id | name | tag | feed_type_id | metadata |")
        A("|---|---|---|---|---|")
        for b in books:
            A(f"| {fmt(b.get('feed_source_id'))} | {fmt(b.get('name'))} | "
              f"{fmt(b.get('tag'))} | {fmt(b.get('feed_type_id'))} | "
              f"`{json.dumps(b.get('metadata') or {})}` |")
    else:
        A("- none returned")
    A("")
    if not (a.get("bet105_candidates") or []):
        A("**No book named Bet105 is visible to this account.** Every figure in this "
          "report is therefore a measurement of the book above, not of Bet105 — "
          "unless that book IS Bet105's pricing feed under another name, which only "
          "Bet105 can confirm. Flagged, not assumed.")
    else:
        A(f"**Bet105 matched:** feed_source_id `{fmt(a.get('bet105_feed_source_id'))}`.")
    A("")
    A(f"**feed_source_id sent on every market call:** `{fmt(a.get('feed_source_for_calls'))}`  ")
    A(f"**Tennis sport_id:** `{fmt(a.get('tennis_sport_id'))}`")
    A("")
    A("> **Undocumented hard requirement, measured 2026-09-17.** `/info/markets` "
      "*requires* `feed_source_id`. Without it the API returns **HTTP 200** with "
      "`\"description\": \"minimum of 1 feed_source_id needed\"`, no `result` key and "
      "no error status — for every league, every sport and every time window. The "
      "swagger marks the parameter `required: false`. This is a fail-open: it reads "
      "exactly like an account with no odds entitlement. The client now refuses to "
      "issue a market call without it.")
    A("")
    fr = a.get("tennis_freshness") or {}
    frows = fr.get("rows") or []
    A(f"### Tennis leagues actually receiving prices (`/info/markets-last-updated`, n={len(frows)})")
    A("")
    if frows:
        A("| league_id | betting_type_id | book | last update | minutes ago |")
        A("|---|---|---|---|---|")
        for r in sorted(frows, key=lambda x: (x.get("league_id") or 0)):
            A(f"| {fmt(r.get('league_id'))} | {fmt(r.get('betting_type_id'))} | "
              f"{fmt(r.get('name'))} | {fmt(r.get('updated_on'))} | {fmt(r.get('minutes_ago'))} |")
        A("")
        A("A men's league absent from this table is a league nobody is pricing to us "
          "— not a quiet day.")
    else:
        A("- none returned")
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
    bnames = market_names(a)["book"]
    A(f"### Books actually received (n={fmt(fs.get('rows'))} market rows, all men's leagues)")
    A("")
    counts = fs.get("counts") or {}
    if counts:
        A("| feed_source_id | book | rows |")
        A("|---|---|---|")
        for fsid, n in counts.items():
            A(f"| {fsid} | {bnames.get(str(fsid), DASH)} | {n} |")
    else:
        A("no market rows returned")
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
    A(f"**Furthest back with market rows:** "
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
    A("## c. Pre-match coverage for our entitled book (men's leagues)")
    A("")
    A(f"Window `{' → '.join(c_.get('window', [DASH, DASH]))}`, "
      f"betting_type_id=1 (Prematch), feed_source_id = "
      f"`{fmt(res.get('feed_source_id_used'))}` — see section a for which book that is.")
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
    # Named against the live reference tables rather than left as raw ids: the
    # founder's questions are about set handicap and total sets by name, and an
    # id-only table cannot be checked by eye.
    names = market_names(a)
    for lid, rec in (c_.get("per_league") or {}).items():
        A(f"**{rec['label']}**")
        A("")
        pres = rec.get("presence")
        if not pres:
            A("- no market rows returned for this league in the window")
            A("")
            continue
        A("| market | segment | fixtures carrying it |")
        A("|---|---|---|")
        for k, n in sorted(pres.items(), key=lambda kv: -kv[1]):
            mt, sg = k.split("/", 1)
            A(f"| {names['market'].get(mt, mt)} | {names['segment'].get(sg, sg)} | {n} |")
        A("")
    A("Set handicap is Spread on the Sets segment; total sets is Total on Sets. "
      "Raw `market_type_id/segment_id` keys are in the JSON.")
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
    A("The archive uses `markets_all_states()`, which is the two-call merge, and "
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

    # Every /info/markets call MUST carry feed_source_id or the API answers 200
    # with no result. The value used is the account's entitled book list, and it
    # is named in the report so nobody has to assume which book was measured.
    feed_source_id = (res.get("test_a") or {}).get("feed_source_for_calls")
    res["feed_source_id_used"] = feed_source_id
    res["entitled_books"] = (res.get("test_a") or {}).get("entitled_books")
    if not feed_source_id:
        res["errors"].append(
            "No feed_source_id could be resolved from /reference/sportsbooks, so "
            "tests b/c/d could not run at all: /info/markets returns HTTP 200 with "
            "no result unless at least one feed_source_id is supplied.")

    for key, fn in [("test_b", lambda: test_b_backward_reach(c, now, feed_source_id)),
                    ("test_c", lambda: test_c_bet105_coverage(c, now, feed_source_id, args.horizon_days)),
                    ("test_d", lambda: test_d_is_current_trap(c, now, feed_source_id))]:
        if key[-1] in skip or not feed_source_id:
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
    # Named explicitly: a 200 we could not parse is not a measurement of zero.
    res["unrecognised_envelopes"] = [
        {"path": m["path"], "keys": m["unrecognised_envelope"]}
        for m in c.call_log if m.get("unrecognised_envelope")]
    if res["unrecognised_envelopes"]:
        res["errors"].append(
            f"{len(res['unrecognised_envelopes'])} call(s) returned 200 with an "
            f"envelope this parser does not recognise — every zero below them is "
            f"unmeasured, not empty.")

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
