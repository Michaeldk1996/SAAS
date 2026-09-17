#!/usr/bin/env python3
"""TEN-232 Part 1 — Kibl / Bet105 pre-match line archive.

ARCHIVE FIRST. Kibl has no history endpoint and no export endpoint across all
71 paths, and keeps exactly three states per line (opener / previous / current).
Everything between the opener and the current price is discarded on their side
the moment a new price lands. A sweep we do not run is not data we collect later
— it is data nobody has.

Scope (founder ruling 2026-09-17):
  - men's leagues only: ATP 19, Challenger 537, ITF Men 962. WTA, WTA-125K and
    ITF Women are reported if we are entitled to them, and NOT archived.
  - pre-match only (betting_type_id=1). Live is measured before it is archived.
  - is_main unrestricted: main lines AND alternates, including the Sets/Spread
    set handicap that bet365-on-oddspapi does not price.

Storage follows TEN-225: raw gzipped payload per sweep in the private Supabase
bucket `kibl-raw` (source of truth, rebuildable), summary rows in Postgres with
RLS on and zero policies (queryable projection).

Append-only, first-write-wins: an observation already held is never overwritten,
because the held one is the one that cannot be re-fetched.

Stdlib only. Reads KIBL_USERNAME, KIBL_PASSWORD, SUPABASE_URL,
SUPABASE_SECRET_KEY from the environment. Never prints any of them.
"""

import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request

from kibl_client import KiblClient, TENNIS_LEAGUES_MEN, state_of

BUCKET = "kibl-raw"
TABLE_OBS = "kibl_line_observations"
TABLE_SWEEPS = "kibl_sweeps"
HEARTBEAT_KEY = "_heartbeat.json.gz"
HEARTBEAT_MAX_AGE_H = 24.0
INSERT_CHUNK = 500


def die(msg):
    print(f"::error::{msg}")
    sys.exit(1)


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def now_utc():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0, tzinfo=None)


def supabase_creds():
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = (os.environ.get("SUPABASE_SECRET_KEY") or "").strip()
    if not url or not key:
        die("SUPABASE_URL / SUPABASE_SECRET_KEY are not both set.")
    return url, key


def sb_request(method, path, url, key, body=None, headers=None, timeout=180):
    h = {"Authorization": f"Bearer {key}", "apikey": key,
         "User-Agent": "BSP-Consult-Dashboard/1.0"}
    if headers:
        h.update(headers)
    data = body
    if isinstance(body, (dict, list)):
        data = json.dumps(body).encode("utf-8")
        h.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            try:
                return json.loads(raw.decode("utf-8")), None
            except ValueError:
                return raw, None
    except urllib.error.HTTPError as e:
        return None, (e.code, e.read()[:400].decode("utf-8", "replace"))
    except Exception as e:  # noqa: BLE001
        return None, (None, str(e))


def ensure_bucket(url, key):
    got, _ = sb_request("GET", f"/storage/v1/bucket/{BUCKET}", url, key)
    if got and isinstance(got, dict) and got.get("name"):
        if got.get("public"):
            die(f"Bucket {BUCKET} exists but is PUBLIC. Refusing to write to it.")
        return False
    made, err = sb_request("POST", "/storage/v1/bucket", url, key,
                           body={"id": BUCKET, "name": BUCKET, "public": False})
    if made is None:
        die(f"could not create bucket {BUCKET}: {err}")
    print(f"bucket {BUCKET}: CREATED (private).")
    return True


def sb_upload(url, key, path, blob):
    _, err = sb_request("POST", f"/storage/v1/object/{BUCKET}/{path}", url, key,
                        body=blob,
                        headers={"Content-Type": "application/json",
                                 "Content-Encoding": "gzip", "x-upsert": "true"})
    return err


def sb_list(url, key, prefix, limit=1000):
    out, offset = [], 0
    while True:
        page, err = sb_request("POST", f"/storage/v1/object/list/{BUCKET}", url, key,
                               body={"prefix": prefix, "limit": limit, "offset": offset,
                                     "sortBy": {"column": "name", "order": "asc"}})
        if page is None:
            print(f"::warning::list {prefix!r} failed: {err}")
            return out, False
        rows = page if isinstance(page, list) else []
        out.extend(rows)
        if len(rows) < limit:
            return out, True
        offset += limit


# --------------------------------------------------------------- row shaping

def row_key_of(row):
    """Stable dedupe key.

    Kibl's uuid is used when present. When it is absent the natural key is
    hashed instead — including the state flags and inserted_on, so two genuinely
    different observations of the same line never collapse into one row.
    """
    uid = row.get("uuid")
    if uid:
        return str(uid)
    natural = "|".join(str(row.get(f)) for f in (
        "market_id", "fixture_id", "fixture_participant_id", "market_type_id",
        "segment_id", "side_id", "point", "alt_id", "feed_source_id",
        "betting_type_id", "is_opener", "is_previous", "is_current",
        "price_american", "price_decimal", "inserted_on"))
    return "nk_" + hashlib.sha1(natural.encode()).hexdigest()


def num(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def to_summary(row, observed_at, league_id, sweep_id, raw_object):
    return {
        "row_key": row_key_of(row),
        "observed_at": observed_at,
        "inserted_on": row.get("inserted_on"),
        "inserted_on_epoch": row.get("inserted_on_epoch"),
        "fixture_id": row.get("fixture_id"),
        "league_id": league_id,
        "feed_source_id": row.get("feed_source_id"),
        "market_type_id": row.get("market_type_id"),
        "segment_id": row.get("segment_id"),
        "side_id": row.get("side_id"),
        "participant_id": row.get("participant_id"),
        "fixture_participant_id": row.get("fixture_participant_id"),
        "market_id": row.get("market_id"),
        "point": num(row.get("point")),
        "alt_id": row.get("alt_id"),
        "is_main": row.get("is_main"),
        "betting_type_id": row.get("betting_type_id"),
        "market_status_id": row.get("market_status_id"),
        "state": state_of(row),
        "price_american": row.get("price_american"),
        "price_decimal": num(row.get("price_decimal")),
        "price_fraction": row.get("price_fraction"),
        "sweep_id": sweep_id,
        "raw_object": raw_object,
    }


def insert_rows(url, key, rows):
    """Upsert, ignoring duplicates. Returns (n_new, n_failed).

    `return=representation` is what makes n_new real: PostgREST hands back only
    the rows it actually inserted, so the count is measured rather than assumed.
    """
    new = 0
    failed = 0
    for i in range(0, len(rows), INSERT_CHUNK):
        chunk = rows[i:i + INSERT_CHUNK]
        got, err = sb_request(
            "POST", f"/rest/v1/{TABLE_OBS}?on_conflict=row_key", url, key,
            body=chunk,
            headers={"Prefer": "resolution=ignore-duplicates,return=representation"})
        if got is None:
            failed += len(chunk)
            print(f"::warning::insert chunk {i // INSERT_CHUNK} failed: {err}")
            continue
        new += len(got) if isinstance(got, list) else 0
    return new, failed


# --------------------------------------------------------------------- sweep

def sweep(args):
    url, key = supabase_creds()
    ensure_bucket(url, key)

    started = now_utc()
    sweep_id = started.strftime("%Y%m%dT%H%M%SZ")
    leagues = sorted(TENNIS_LEAGUES_MEN)
    win_start = started - dt.timedelta(hours=args.lookback_hours)
    win_end = started + dt.timedelta(days=args.horizon_days)

    c = KiblClient()
    c.authenticate()

    fixtures_all = []
    rows_all = []
    ok = True
    for lid in leagues:
        fx_payload, fx_meta = c.get("/info/fixtures",
                                    {"league_id": lid, "start_time": iso(win_start),
                                     "end_time": iso(win_end)})
        if fx_meta["status"] != 200:
            ok = False
            print(f"::warning::fixtures league {lid}: HTTP {fx_meta['status']}")
            continue
        fixtures = c.rows(fx_payload)
        for f in fixtures:
            if isinstance(f, dict):
                f.setdefault("league_id", lid)
        fixtures_all.extend(fixtures)

        # is_main is deliberately NOT sent: omitting it is what returns main
        # lines AND alternates. feed_source_id is deliberately NOT sent either —
        # we archive every book this account receives, and which books those are
        # is a measured fact in the sweep, not an assumption.
        rows, metas = c.markets_three_state(
            league_id=lid, betting_type_id=args.betting_type_id,
            start_time=iso(win_start), end_time=iso(win_end))
        if not all(m["status"] == 200 for m in metas):
            ok = False
            print(f"::warning::markets league {lid}: {[m['status'] for m in metas]}")
            continue
        for r in rows:
            r["_league_id"] = lid
        rows_all.extend(rows)

    observed_at = iso(now_utc())
    raw_object = f"{started:%Y/%m/%d}/{sweep_id}.json.gz"
    blob = gzip.compress(json.dumps({
        "sweep_id": sweep_id,
        "observed_at": observed_at,
        "window": [iso(win_start), iso(win_end)],
        "leagues": leagues,
        "betting_type_id": args.betting_type_id,
        "note": ("three-state merge (is_current true+false); is_main omitted so "
                 "alternates are included; no feed_source filter"),
        "fixtures": fixtures_all,
        "market_participants": rows_all,
    }, default=str).encode("utf-8"))

    # The bucket write comes FIRST and its failure fails the sweep. The raw
    # payload is the only artefact that can rebuild everything else; a summary
    # row without its raw object is a number we cannot re-derive.
    err = sb_upload(url, key, raw_object, blob)
    if err:
        die(f"raw upload failed ({raw_object}): {err}")
    print(f"raw: {raw_object} {len(blob):,}B gz")

    summary = [to_summary(r, observed_at, r.get("_league_id"), sweep_id, raw_object)
               for r in rows_all]
    n_new, n_failed = insert_rows(url, key, summary)

    priced = len({r.get("fixture_id") for r in rows_all})
    sweep_row = {
        "sweep_id": sweep_id,
        "started_at": iso(started),
        "finished_at": iso(now_utc()),
        "leagues": ",".join(str(x) for x in leagues),
        "fixtures_seen": len(fixtures_all),
        "fixtures_priced": priced,
        "rows_seen": len(rows_all),
        "rows_new": n_new,
        "api_calls": c.calls,
        "bytes_down": c.bytes_down,
        "raw_object": raw_object,
        "raw_bytes": len(blob),
        "ok": ok and n_failed == 0,
        "note": None if (ok and n_failed == 0) else f"{n_failed} summary rows failed to insert",
    }
    _, err = sb_request("POST", f"/rest/v1/{TABLE_SWEEPS}?on_conflict=sweep_id",
                        url, key, body=[sweep_row],
                        headers={"Prefer": "resolution=merge-duplicates"})
    if err:
        print(f"::warning::sweep row insert failed: {err}")

    blob_hb = gzip.compress(json.dumps(
        {**sweep_row, "finishedAt": sweep_row["finished_at"]}, indent=1).encode())
    if sb_upload(url, key, HEARTBEAT_KEY, blob_hb):
        print("::warning::could not write the heartbeat object")

    print(json.dumps(sweep_row, indent=1))
    # A sweep that captured nothing must not report green: the whole point of
    # the job is that a missed sweep is unrecoverable, so silence is the failure.
    if len(rows_all) == 0:
        print("::error::sweep captured zero market rows")
        return 1
    return 0 if sweep_row["ok"] else 1


# -------------------------------------------------------------------- report

def report(args):
    url, key = supabase_creds()
    now = now_utc()

    objs, complete = sb_list(url, key, "")
    total_bytes = 0
    for o in objs:
        md = o.get("metadata") or {}
        total_bytes += int(md.get("size") or 0)
    # Nested prefixes are not returned by a single list call, so walk the
    # date prefixes rather than reporting a partial figure as a total.
    day_objs = []
    for day in range(args.days):
        d = now - dt.timedelta(days=day)
        rows, _ = sb_list(url, key, f"{d:%Y/%m/%d}/")
        for r in rows:
            md = r.get("metadata") or {}
            day_objs.append((f"{d:%Y/%m/%d}/{r.get('name')}", int(md.get("size") or 0)))
    day_bytes = sum(s for _, s in day_objs)

    sweeps, err = sb_request(
        "GET",
        f"/rest/v1/{TABLE_SWEEPS}?select=*&order=started_at.desc&limit=200",
        url, key)
    sweeps = sweeps if isinstance(sweeps, list) else []

    cnt, _ = sb_request("GET", f"/rest/v1/{TABLE_OBS}?select=row_key&limit=1", url, key,
                        headers={"Prefer": "count=exact", "Range": "0-0"})

    print(f"kibl-raw: {len(day_objs)} objects over the last {args.days} day(s), "
          f"{day_bytes / 1e6:.2f} MB gz")
    if day_objs:
        per_day = day_bytes / max(1, args.days)
        print(f"projected: {per_day * 365 / 1e9:.3f} GB/year at the observed rate "
              f"(n={len(day_objs)} objects)")
    ok = [s for s in sweeps if s.get("ok")]
    print(f"sweeps recorded: {len(sweeps)}, ok: {len(ok)}")
    if sweeps:
        last = sweeps[0]
        print(f"last sweep {last.get('sweep_id')}: fixtures {last.get('fixtures_seen')}, "
              f"priced {last.get('fixtures_priced')}, rows {last.get('rows_seen')}, "
              f"new {last.get('rows_new')}, calls {last.get('api_calls')}")
        newest = last.get("started_at")
        # The change rate across consecutive sweeps is what justifies a cadence.
        # Reported, not decided: the founder rules on the cadence.
        rates = [s.get("rows_new") for s in sweeps[:24] if s.get("rows_new") is not None]
        if rates:
            print(f"rows_new over the last {len(rates)} sweeps: "
                  f"min {min(rates)}, median {sorted(rates)[len(rates) // 2]}, max {max(rates)}")
        print(f"newest sweep started {newest}")
    if not complete:
        print("::warning::bucket listing was incomplete; sizes above are a floor")
    return 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("sweep")
    s.add_argument("--horizon-days", type=int, default=3,
                   help="how far forward to sweep fixtures")
    s.add_argument("--lookback-hours", type=int, default=6,
                   help="how far back, to catch fixtures that just started")
    s.add_argument("--betting-type-id", type=int, default=1,
                   help="1=Prematch. Live is 3 for tennis, not 2 — measured before archived.")
    s.set_defaults(func=sweep)

    r = sub.add_parser("report")
    r.add_argument("--days", type=int, default=2)
    r.set_defaults(func=report)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
