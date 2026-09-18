#!/usr/bin/env python3
"""TEN-232 Part 1 — Kibl / Bet105 pre-match line archive.

ARCHIVE FIRST. Kibl has no history endpoint and no export endpoint across all
71 paths. It keeps the OPENING price and the CURRENT price per line and nothing
between them — measured, not assumed: `is_previous` never appears on a row and
`is_current` is ignored as a filter, so the documented three-state model is two
states in practice. Every price between open and current is discarded on their
side the moment a new one lands. A sweep we do not run is not data we collect
later; it is data nobody has.

Scope (founder ruling 2026-09-17):
  - men's leagues only: ATP 19, Challenger 537, ITF Men 962. WTA, WTA-125K and
    ITF Women are reported if we are entitled to them, and NOT archived.
  - pre-match only (betting_type_id=1). Live is measured before it is archived —
    and measured 0 rows for this account on both live betting types.
  - is_main unrestricted, so alternates would be captured if any existed. For
    the book we are actually served, alt_id is 0 on every row: no alternates, no
    Sets/Spread set handicap. The pull does not assume that, so the day they
    appear we capture them.

Storage follows TEN-225: raw gzipped payload per sweep in the private Supabase
bucket `kibl-raw` (source of truth, rebuildable), summary rows in Postgres with
RLS on and zero policies (queryable projection).

Append-only, first-write-wins: an observation already held is never overwritten,
because the held one is the one that cannot be re-fetched. Raw object names carry
the observation time, so a re-run adds a capture rather than replacing one.

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

from kibl_client import (KiblClient, TENNIS_LEAGUES_MEN, state_of,
                         observation_key)
from ten225_names import match_key, split_kibl_fixture_name

BUCKET = "kibl-raw"
TABLE_OBS = "kibl_line_observations"
TABLE_SWEEPS = "kibl_sweeps"
TABLE_FIXTURES = "kibl_fixtures"
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
    """Stable dedupe key — the hash of the shared observation identity.

    Uses `observation_key()` so the archive's notion of a duplicate is the SAME
    function as the two-call merge's. Two different field lists for one job is
    how a row gets deduped in one place and kept in the other.
    """
    return "nk_" + hashlib.sha1(observation_key(row).encode()).hexdigest()


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
        # `state` is a convenience label with a lossy precedence: a row that is
        # BOTH the opener and the current price (a line that has not moved —
        # 30 of 108 in the measured pull, 28%) labels as 'opener'. A downstream
        # "current price" query filtering state='current' would miss every one
        # of them. The raw booleans are therefore persisted alongside it, and
        # they, not the label, are the source of truth.
        "state": state_of(row),
        "is_opener": row.get("is_opener"),
        "is_previous": row.get("is_previous"),
        "is_current": row.get("is_current"),
        "is_live": row.get("is_live"),
        "price_american": row.get("price_american"),
        "price_decimal": num(row.get("price_decimal")),
        "price_fraction": row.get("price_fraction"),
        "sweep_id": sweep_id,
        "raw_object": raw_object,
    }


def fixture_row(f, observed_at, sweep_id):
    """One /info/fixtures record -> a kibl_fixtures row, or None.

    None when there is no fixture_id. Everything else — an unparseable name, a
    missing start — is STORED with NULLs rather than dropped, because the raw
    record is evidence: a fixture we cannot pair today is the thing the name
    normaliser report has to count, and a dropped row cannot be counted.
    """
    fid = f.get("fixture_id")
    if fid is None:
        return None
    p1, p2 = split_kibl_fixture_name(f.get("name"))
    sched = f.get("start_time")
    return {
        "fixture_id": fid,
        "league_id": f.get("league_id"),
        "sport_id": f.get("sport_id"),
        "fixture_type_id": f.get("fixture_type_id"),
        "feed_source_id": f.get("feed_source_id"),
        # Kibl's SCHEDULED time. Never a Close cutoff — see the schema comment.
        "scheduled_start": sched,
        "name": f.get("name"),
        "player1_name": p1,
        "player2_name": p2,
        "match_key": match_key(sched or "", p1, p2),
        "first_seen_at": observed_at,
        "last_seen_at": observed_at,
        "first_sweep_id": sweep_id,
        "last_sweep_id": sweep_id,
    }


def upsert_fixtures(url, key, rows):
    """Upsert fixtures, preserving first_seen_at.

    PostgREST's merge-duplicates overwrites EVERY column it is sent, so sending
    first_seen_at on an update would reset it to now on every sweep — and
    first_seen_at is the denominator of the opening-time measurement. The
    two-pass shape below is what keeps it: pass 1 inserts brand-new fixtures
    only (ignore-duplicates, so an existing row is untouched), pass 2 updates
    the columns that are allowed to move on the rows that already existed.

    ⚠️ PASS 2 DEPENDS ON first_seen_at HAVING A DEFAULT. Postgres runs NOT NULL
    and CHECK against the PROPOSED insert tuple before it resolves ON CONFLICT,
    so omitting a NOT NULL column fails 23502 on every row even when every row
    is an update. Measured on run 35292346974: the whole refresh chunk 400'd and
    scheduled_start / name silently stopped refreshing on a green sweep. The
    schema now carries `default now()` on both timestamps for exactly this.

    Returns (n_new, n_failed).
    """
    new = 0
    failed = 0
    MOVES = ("fixture_id", "league_id", "sport_id", "fixture_type_id",
             "feed_source_id", "scheduled_start", "name", "player1_name",
             "player2_name", "match_key", "last_seen_at", "last_sweep_id")
    for i in range(0, len(rows), INSERT_CHUNK):
        chunk = rows[i:i + INSERT_CHUNK]
        got, err = sb_request(
            "POST", f"/rest/v1/{TABLE_FIXTURES}?on_conflict=fixture_id", url, key,
            body=chunk,
            headers={"Prefer": "resolution=ignore-duplicates,return=representation"})
        if got is None:
            failed += len(chunk)
            print(f"::warning::fixture insert chunk {i // INSERT_CHUNK} failed: {err}")
            continue
        new += len(got) if isinstance(got, list) else 0
        # Pass 2: refresh the movable columns on every row in the chunk. A
        # fixture can be rescheduled or renamed and the newest statement wins;
        # first_seen_at / first_sweep_id are simply not in the payload.
        moved = [{k: r[k] for k in MOVES if k in r} for r in chunk]
        _, err2 = sb_request(
            "POST", f"/rest/v1/{TABLE_FIXTURES}?on_conflict=fixture_id", url, key,
            body=moved, headers={"Prefer": "resolution=merge-duplicates"})
        if err2:
            # A failed refresh is NOT cosmetic: it means a rescheduled fixture
            # keeps its old start and a renamed one keeps its old players, on a
            # sweep that otherwise reports green. Counted as a failure so the
            # sweep row says so.
            failed += len(chunk)
            print(f"::warning::fixture refresh chunk {i // INSERT_CHUNK} failed: {err2}")
    return new, failed


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

def _emit_output(name, value):
    """Write a step output when running under Actions; a no-op locally."""
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    try:
        with open(path, "a") as fh:
            fh.write(f"{name}={value}\n")
    except OSError as e:  # noqa: BLE001
        print(f"::warning::could not write step output {name}: {e}")


BASELINE_MIN = 15.0     # founder ruling 2026-09-18 item 2: "Sweep 15 min baseline"
NEAR_START_MIN = 5.0    # "...5 min from T-60 to start"
NEAR_START_WINDOW_MIN = 60.0


def should_sweep(minutes_since_last, minutes_to_next_start):
    """The cadence rule, as a function -> (sweep?, why).

    Founder ruling 2026-09-18 item 2: 15-minute baseline, 5-minute from T-60 to
    the start. The decision lives HERE and not in a cron expression for two
    reasons: cron cannot see when a fixture starts, and a rule in code can be
    tested and counted. The workflow fires often; this decides whether a firing
    does any work.

    NEVER SKIPS ON MISSING INFORMATION. An unknown time since the last sweep
    (first run, or the sweeps table unreadable) sweeps — for a feed whose prices
    cannot be re-fetched, the cost of a redundant sweep is one API call and the
    cost of a skipped one is a price nobody has. `minutes_to_next_start` being
    None only means no fixture is near, which is the baseline case, not a reason
    to skip.
    """
    if minutes_since_last is None:
        return True, 'no-previous-sweep'
    near = (minutes_to_next_start is not None
            and 0.0 <= minutes_to_next_start <= NEAR_START_WINDOW_MIN)
    floor = NEAR_START_MIN if near else BASELINE_MIN
    if minutes_since_last + 1e-9 >= floor:
        return True, ('near-start' if near else 'baseline')
    return False, (f'too soon: {minutes_since_last:.1f} min since the last '
                   f'sweep, floor is {floor:.0f} '
                   f'({"near-start" if near else "baseline"})')


def cadence_inputs(url, key, now):
    """(minutes since the last sweep, minutes to the next start) — or Nones.

    Both reads fail OPEN to None, which should_sweep() treats as "sweep".
    """
    since = None
    rows, err = sb_request(
        "GET", f"/rest/v1/{TABLE_SWEEPS}?select=started_at&order=started_at.desc&limit=1",
        url, key)
    if err:
        print(f"::warning::cadence: could not read the last sweep ({err}); sweeping")
    elif isinstance(rows, list) and rows and rows[0].get("started_at"):
        try:
            last = dt.datetime.fromisoformat(
                rows[0]["started_at"].replace("Z", "+00:00")).replace(tzinfo=None)
            since = (now - last).total_seconds() / 60.0
        except ValueError:
            print("::warning::cadence: unparseable started_at; sweeping")

    to_start = None
    hi = now + dt.timedelta(minutes=NEAR_START_WINDOW_MIN)
    rows, err = sb_request(
        "GET",
        f"/rest/v1/{TABLE_FIXTURES}?select=scheduled_start"
        f"&scheduled_start=gte.{iso(now)}&scheduled_start=lte.{iso(hi)}"
        f"&order=scheduled_start.asc&limit=1",
        url, key)
    if err:
        print(f"::warning::cadence: could not read upcoming fixtures ({err})")
    elif isinstance(rows, list) and rows and rows[0].get("scheduled_start"):
        try:
            nxt = dt.datetime.fromisoformat(
                rows[0]["scheduled_start"].replace("Z", "+00:00")).replace(tzinfo=None)
            to_start = (nxt - now).total_seconds() / 60.0
        except ValueError:
            pass
    return since, to_start


def sweep(args):
    url, key = supabase_creds()
    ensure_bucket(url, key)

    started = now_utc()
    if getattr(args, "cadence_gate", False):
        since, to_start = cadence_inputs(url, key, started)
        go, why = should_sweep(since, to_start)
        print(f"cadence: {since if since is None else round(since, 1)} min since "
              f"the last sweep, next start in "
              f"{to_start if to_start is None else round(to_start, 1)} min -> "
              f"{'SWEEP' if go else 'SKIP'} ({why})")
        # Tell the workflow whether this firing did anything, so the downstream
        # card-state step does not re-read the whole card table twelve times an
        # hour to project an archive that did not move.
        _emit_output("swept", "true" if go else "false")
        if not go:
            return 0
    c = KiblClient()
    c.authenticate()
    return run_window(c, url, key, started,
                      started - dt.timedelta(hours=args.lookback_hours),
                      started + dt.timedelta(days=args.horizon_days),
                      args.betting_type_id,
                      sweep_id=started.strftime("%Y%m%dT%H%M%SZ"))


def backfill(args):
    """One-time recovery of the history that is still reachable.

    MEASURED 2026-09-17: /info/markets start_time/end_time DO reach backwards to
    finished fixtures — rows at 1/2/3/5/7/14/30 days back (356 at 30d) and zero
    at 60/90/180/365. So the reach is AT LEAST 30 days and the cutoff is
    somewhere in (30, 60]; it was not bisected. That window slides forward every
    day, so this is not history that waits for us: a day not backfilled now is a
    day that leaves the window and never comes back.

    What a finished fixture returns is NOT established. The backward-reach test
    ran before the state model was corrected: it pulled on the is_current axis,
    which does nothing, so `is_opener` was never sent for a historical window and
    "no openers survive" was never measured. This job does send it, so the answer
    comes out of the captured state mix rather than out of an assumption. Do not
    describe the result as closing-price-only until those counts say so.
    """
    url, key = supabase_creds()
    ensure_bucket(url, key)
    c = KiblClient()
    c.authenticate()
    now = now_utc()
    worst = 0
    for d in range(args.from_days, args.to_days - 1, -1):
        w_start, w_end = now - dt.timedelta(days=d), now - dt.timedelta(days=d - 1)
        print(f"\n--- backfill day -{d} ({iso(w_start)} .. {iso(w_end)}) ---")
        # allow_empty: a day genuinely outside the reachable window returns zero
        # rows, and that is the measurement, not a failure.
        # The run timestamp is in the sweep_id so a re-run records a NEW attempt
        # rather than overwriting the earlier one. A day re-run after it has slid
        # out of the reachable window returns zero, and that zero must not
        # replace the 356 rows a previous run captured for the same day.
        worst = max(worst, run_window(c, url, key, now, w_start, w_end,
                                      args.betting_type_id,
                                      sweep_id=f"bf{w_start:%Y%m%d}-{now:%Y%m%dT%H%M%SZ}",
                                      allow_empty=True))
    return worst


def run_window(c, url, key, started, win_start, win_end, betting_type_id,
               sweep_id, allow_empty=False):
    """Pull one time window across every men's league and archive it."""
    leagues = sorted(TENNIS_LEAGUES_MEN)

    # /info/markets REQUIRES feed_source_id: without it the API answers HTTP 200
    # with no `result` key, which reads as "this account has no odds". The value
    # is the account's entitled book list, read from the API rather than
    # hard-coded, so a change in entitlement shows up as more data rather than as
    # a silent miss.
    books, _ = c.get("/reference/sportsbooks")
    book_rows = [b for b in c.rows(books) if isinstance(b, dict)]
    feed_source_id = ",".join(str(b["feed_source_id"]) for b in book_rows
                              if b.get("feed_source_id") is not None)
    if not feed_source_id:
        die("no feed_source_id from /reference/sportsbooks; every market call "
            "would come back as an empty envelope")
    print(f"feed_source_id={feed_source_id} "
          f"(entitled books: {[b.get('name') for b in book_rows]})")

    # Snapshot the client's counters: one KiblClient is reused across every day
    # of a backfill, so its running totals would report day 35 as ~35x its real
    # cost. The sweep row records what THIS window spent.
    calls_before, bytes_before = c.calls, c.bytes_down

    fixtures_all = []
    rows_all = []
    all_fixture_ids = set()
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
        all_fixture_ids.update(f.get("fixture_id") for f in fixtures
                               if isinstance(f, dict) and f.get("fixture_id") is not None)

        # is_main is deliberately NOT sent: omitting it is what would return
        # alternates as well as main lines. (Measured: this book returns alt_id=0
        # only, so there are no alternates to get — but the pull does not assume
        # that, so the day they appear we capture them.)
        rows, metas = c.markets_all_states(
            league_id=lid, betting_type_id=betting_type_id,
            feed_source_id=feed_source_id,
            start_time=iso(win_start), end_time=iso(win_end))
        if not all(m["status"] == 200 for m in metas):
            ok = False
            print(f"::warning::markets league {lid}: {[m['status'] for m in metas]}")
            continue
        for r in rows:
            r["_league_id"] = lid
        rows_all.extend(rows)
        print(f"  league {lid}: {len(fixtures)} fixtures, {len(rows)} market rows")

    observed_at = iso(now_utc())
    # The object name carries the OBSERVATION time, not just the window, so a
    # re-run can never overwrite an earlier capture. sb_upload sends x-upsert,
    # and a deterministic per-day name would let a backfill re-run — after that
    # day has slid out of the ~30-day reachable window — replace a full raw
    # object with an empty one. That is the opposite of append-only, and with
    # allow_empty the run would still report green.
    raw_object = f"{win_start:%Y/%m/%d}/{sweep_id}-{observed_at.replace(':', '')}.json.gz"
    blob = gzip.compress(json.dumps({
        "sweep_id": sweep_id,
        "observed_at": observed_at,
        "window": [iso(win_start), iso(win_end)],
        "leagues": leagues,
        "betting_type_id": betting_type_id,
        "feed_source_id": feed_source_id,
        "entitled_books": book_rows,
        "note": ("two-state merge: unfiltered (current) + is_opener (opening). "
                 "is_current is ignored by the API and is never sent. is_main "
                 "omitted so alternates would be included if any existed."),
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

    # TEN-225: project the fixture list into a queryable table. The blob already
    # holds it, but the card path needs the player names to pair a Kibl fixture
    # to our board and it cannot read a gzipped object per fixture. Deduped on
    # fixture_id within the window — the same fixture appears in one league only,
    # but a window re-run inside one sweep would otherwise send it twice and
    # PostgREST rejects a payload with two rows on one conflict target.
    fx_rows = {}
    for f in fixtures_all:
        if isinstance(f, dict):
            row = fixture_row(f, observed_at, sweep_id)
            if row is not None:
                fx_rows[row["fixture_id"]] = row
    fx_new, fx_failed = upsert_fixtures(url, key, list(fx_rows.values()))
    unpaired = sum(1 for r in fx_rows.values() if not r["match_key"])
    print(f"fixtures: {len(fx_rows)} seen, {fx_new} new, {fx_failed} failed, "
          f"{unpaired} with no match_key "
          f"({unpaired / max(1, len(fx_rows)):.1%} unpairable)")

    # Intersected with the window's fixture list, and None excluded: an
    # unintersected count can exceed fixtures_seen and reads as >100% coverage.
    priced = len({r.get("fixture_id") for r in rows_all
                  if r.get("fixture_id") is not None} & all_fixture_ids)
    sweep_row = {
        "sweep_id": sweep_id,
        "started_at": iso(started),
        "finished_at": iso(now_utc()),
        "leagues": ",".join(str(x) for x in leagues),
        "fixtures_seen": len(fixtures_all),
        "fixtures_priced": priced,
        "rows_seen": len(rows_all),
        "rows_new": n_new,
        "api_calls": c.calls - calls_before,
        "bytes_down": c.bytes_down - bytes_before,
        "raw_object": raw_object,
        "raw_bytes": len(blob),
        "ok": ok and n_failed == 0 and fx_failed == 0,
        "note": (None if (ok and n_failed == 0 and fx_failed == 0)
                 else f"{n_failed} summary rows and {fx_failed} fixture rows "
                      f"failed to insert"),
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
    # A sweep that captured nothing must not report green: the whole point of the
    # job is that a missed sweep is unrecoverable, so silence is the failure.
    # A BACKFILL day outside the reachable window is a different thing — zero
    # there is the measurement, so allow_empty says which of the two this is.
    if len(rows_all) == 0 and not allow_empty:
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
    s.add_argument("--cadence-gate", action="store_true",
                   help="apply the 15-min baseline / 5-min-from-T-60 rule and "
                        "skip this firing if it is too soon")
    s.set_defaults(func=sweep)

    b = sub.add_parser("backfill")
    b.add_argument("--from-days", type=int, default=35,
                   help="oldest day to attempt; reachability measured at ~30 days")
    b.add_argument("--to-days", type=int, default=1)
    b.add_argument("--betting-type-id", type=int, default=1)
    b.set_defaults(func=backfill)

    r = sub.add_parser("report")
    r.add_argument("--days", type=int, default=2)
    r.set_defaults(func=report)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
