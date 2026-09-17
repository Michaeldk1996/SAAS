#!/usr/bin/env python3
"""TEN-225 — load oddspapi_line_summary (and oddspapi_fixtures) from the raw
bucket and from bet365-history/. ZERO odds-API calls.

RULINGS THIS FILE IMPLEMENTS
----------------------------
Michael, 2026-09-17T07:33Z (scope):
  "one row per fixture + book + market + side + line ... Markets: match winner,
   games handicap, total games, set betting. Levels: all. Full tick series stays
   in the raw bucket only."
Michael, 2026-09-17T07:33Z (ruling 2, close_reliable):
  "true only if the fixture was archived within 21 days of its start AND
   close_lag_minutes <= 60. Otherwise close_price = null (dash on the site).
   Open is kept."
Michael, 2026-09-17T08:07Z (gate 0ef55f38):
  key  -> UNIQUE NULLS NOT DISTINCT
  close window -> 21 days (the stated rule), NOT the <=3d reading.

WHY NO API CALLS
----------------
The raw-archive job holds the same rate-limited oddspapi key for hours. A second
client calling /v4/historical-odds loses that race (measured: 3 fixtures in 9
minutes on 429 backoff) while slowing the one job racing irreversible retention
loss. Everything here reads the bucket the archive already wrote, plus the
committed bet365-history/ files. Re-run it after any archive run and n grows.

THE PAYLOAD -> ROW MAPPING, MEASURED NOT ASSUMED
------------------------------------------------
Verified against a live /v4/historical-odds payload (fixture id1200390774640370,
2026-09-17): the leaf tick list sits at

    bookmakers[book].markets[marketId].outcomes[outcomeId].players[playerKey]

and a tick has exactly five keys: createdAt, price, limit, active, exchangeMeta.
There is no `line` field anywhere — the line is encoded in the marketId, so
`line` is recovered by joining marketId -> /v4/markets.handicap. `side` is the
outcome NAME from the same join ('1', '2', 'Over', 'Under', '2:1', ...).

ONE LEAF WITH >= 1 PRE-START TICK IS EXACTLY ONE ROW. A leaf whose only ticks
are in-play contributes NO row: this table is the Open/Close serving index and
in-play stays in the bucket. That is the same rule the sizing measurement was
taken under, so the table bills the number that cleared the gate.

Reads SUPABASE_URL / SUPABASE_SECRET_KEY (Actions only; deliberately not in the
local .env). Stdlib only. Secrets are never printed.
"""
import argparse
import collections
import gzip
import json
import os
import statistics
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BUCKET = 'oddspapi-raw'
META_PREFIX = '_meta'
INDEX = os.path.join(HERE, '.ten225-fixture-index.json.gz')
CATALOGUE = os.path.join(HERE, '.oddspapi-tennis-markets.json.gz')
HISTORY_DIR = os.path.join(HERE, 'bet365-history')
OUT = os.path.join(HERE, 'ten225-load-line-summary.json')

BOOK_HISTORY = 'bet365'
RELIABLE_DAYS = 21          # Michael's ruling 2, confirmed on gate 0ef55f38
RELIABLE_LAG_MIN = 60.0     # Michael's ruling 2
BATCH = 500
MIN_N = 30                  # standing rule: flag anything below this

# The four ruled families, by /v4/markets catalogue name. Slams sit inside
# categoryName "ATP" so they need no separate entry. Set handicap is absent
# from the keep-list because bet365 does not carry it (0 of 26 fixtures,
# measured on the item-0 markets check) — a column that can never fill.
KEEP_FAMILIES = {
    'Winner':                 'match winner',
    'Game Handicap':          'games handicap',
    'Total Games Over Under': 'total games',
    'Correct Score':          'set betting',
}
# Match winner has no line. Storing the catalogue's 0.0 handicap there would be
# a fabricated value in a KEY column, so it is explicitly NULL.
NO_LINE_FAMILIES = {'match winner', 'set betting'}


# --------------------------------------------------------------------- helpers
def creds():
    url = (os.environ.get('SUPABASE_URL') or '').rstrip('/')
    key = os.environ.get('SUPABASE_SECRET_KEY') or ''
    if not url or not key:
        print('::error::SUPABASE_URL / SUPABASE_SECRET_KEY are not both set. '
              'This script runs in Actions, where those secrets live.')
        sys.exit(1)
    return url, key


def sb(method, path, url, key, body=None, headers=None, timeout=300):
    h = {'Authorization': f'Bearer {key}', 'apikey': key}
    h.update(headers or {})
    req = urllib.request.Request(url + path, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read(), None
    except urllib.error.HTTPError as e:
        return None, (e.code, e.read()[:400].decode('utf-8', 'replace'))
    except Exception as e:                      # noqa: BLE001 — reported
        return None, (0, str(e))


def sb_list(url, key, prefix, limit=1000):
    """Storage list is PAGED. A truncated listing silently shrinks n, so pages
    are walked to exhaustion and the caller is told when one failed."""
    out, offset, ok = [], 0, True
    while True:
        body = json.dumps({'prefix': prefix, 'limit': limit, 'offset': offset,
                           'sortBy': {'column': 'name', 'order': 'asc'}}).encode()
        got, err = sb('POST', f'/storage/v1/object/list/{BUCKET}', url, key,
                      body=body, headers={'Content-Type': 'application/json'})
        if got is None:
            print(f'::warning::listing {prefix!r} offset {offset} failed ({err}).')
            return out, False
        rows = json.loads(got.decode('utf-8'))
        out.extend(rows)
        if len(rows) < limit:
            return out, ok
        offset += limit


def sb_download(url, key, path):
    got, err = sb('GET', f'/storage/v1/object/{BUCKET}/'
                  + urllib.parse.quote(path), url, key)
    if got is None:
        return None, err
    try:
        return json.loads(gzip.decompress(got).decode('utf-8')), None
    except Exception as e:                      # noqa: BLE001 — reported
        return None, (0, f'unreadable: {e}')


def upsert(url, key, table, rows, conflict):
    """PostgREST upsert. merge-duplicates + on_conflict makes a re-run
    idempotent, which matters because this job is meant to be re-run after
    every archive tick."""
    sent = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        q = urllib.parse.urlencode({'on_conflict': conflict})
        got, err = sb('POST', f'/rest/v1/{table}?{q}', url, key,
                      body=json.dumps(chunk).encode(),
                      headers={'Content-Type': 'application/json',
                               'Prefer': 'resolution=merge-duplicates,return=minimal'})
        if got is None:
            print(f'::error::upsert into {table} failed at row {i} ({err})')
            return sent, err
        sent += len(chunk)
    return sent, None


def epoch(ts):
    if ts is None or ts == '':
        return None
    if isinstance(ts, (int, float)):
        return float(ts)
    try:
        return datetime.fromisoformat(str(ts).replace('Z', '+00:00')).timestamp()
    except (ValueError, TypeError):
        return None


def iso(ep):
    if ep is None:
        return None
    return datetime.fromtimestamp(ep, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def load_catalogue():
    if not os.path.exists(CATALOGUE):
        return None
    with gzip.open(CATALOGUE, 'rt', encoding='utf-8') as fh:
        return json.load(fh)


# ------------------------------------------------------------------- the rules
def judge_close(start_ts, close_ts, archived_at):
    """Michael's ruling 2, in one place so the loader and the tests share it.

    Returns (close_reliable, close_lag_minutes).

    close_lag_minutes is returned whenever it is computable, EVEN when the close
    is judged unreliable — it is the diagnostic Part 4 item 4 reports on, and
    ruling 4 keeps the 21-day window open to retuning, which needs the lag to
    have survived. Nulling the close is the caller's job.

    A fixture archived BEFORE its start is not "archived within 21 days of its
    start" in any useful sense: its series is still open, so whatever sits at
    the end of it is not a close. That is false, not reliable.
    """
    if start_ts is None or close_ts is None:
        return False, None
    lag_min = (start_ts - close_ts) / 60.0
    if archived_at is None:
        return False, lag_min
    age_days = (archived_at - start_ts) / 86400.0
    reliable = (0.0 <= age_days <= RELIABLE_DAYS) and (lag_min <= RELIABLE_LAG_MIN)
    return reliable, lag_min


def summarise_payload(payload, fixture_id, start_ts, archived_at, catalogue):
    """One raw /v4/historical-odds payload -> summary rows at the ruled grain.

    Returns (rows, stats). Rows are dicts ready for PostgREST.
    """
    rows = []
    st = collections.Counter()
    for book, blk in ((payload or {}).get('bookmakers') or {}).items():
        if not isinstance(blk, dict):
            continue
        for mid, m in (blk.get('markets') or {}).items():
            if not isinstance(m, dict):
                continue
            meta = catalogue.get(str(mid))
            if meta is None:
                st['market_not_in_catalogue'] += 1
                continue
            fam = KEEP_FAMILIES.get(meta.get('name'))
            if fam is None:
                st['out_of_keeplist'] += 1
                continue
            line = None if fam in NO_LINE_FAMILIES else meta.get('handicap')
            outcomes = meta.get('outcomes') or {}
            for oid, oc in (m.get('outcomes') or {}).items():
                name = outcomes.get(str(oid))
                if name is None:
                    # Storing the raw id as a side label would put a number
                    # where a '1'/'Over' belongs and quietly split the grain.
                    st['outcome_not_in_catalogue'] += 1
                    continue
                for pkey, plist in ((oc or {}).get('players') or {}).items():
                    ticks = []
                    for p in (plist or []):
                        t = epoch(p.get('createdAt'))
                        if t is None or p.get('price') is None:
                            st['tick_unusable'] += 1
                            continue
                        ticks.append((t, float(p['price'])))
                    if not ticks:
                        continue
                    ticks.sort()
                    side = name if str(pkey) == '0' else f'{name}#{pkey}'

                    pre = [t for t in ticks if start_ts is None or t[0] <= start_ts]
                    if start_ts is not None and not pre:
                        st['inplay_only_leaf'] += 1
                        continue

                    open_ts, open_price = ticks[0]
                    if start_ts is None:
                        # Never substitute the scheduled time — Michael's locked
                        # definition forbids it. Open is still exact (the first
                        # recorded tick is the first recorded tick); the close
                        # is simply not derivable until a start is known.
                        st['no_start_open_only'] += 1
                        rows.append(_row(
                            fixture_id, book, fam, side, line,
                            open_price, open_ts, None, None, None,
                            None, ticks[0][0], None, None, 'none',
                            'oddspapi-raw', archived_at, False))
                        continue

                    close_ts, close_price = pre[-1]
                    reliable, lag = judge_close(start_ts, close_ts, archived_at)
                    rows.append(_row(
                        fixture_id, book, fam, side, line,
                        open_price, open_ts,
                        close_price if reliable else None,
                        close_ts if reliable else None,
                        lag, len(pre), ticks[0][0], close_ts,
                        start_ts, 'oddspapi', 'oddspapi-raw', archived_at, reliable))
                    st['reliable_close' if reliable else 'close_nulled'] += 1
    return rows, st


def _row(fixture_id, book, market, side, line, open_price, open_ts,
         close_price, close_ts, lag, pre_count, first_ts, last_pre_ts,
         start_ts, start_src, source, archived_at, reliable):
    return {
        'fixture_id': fixture_id, 'book': book, 'market': market,
        'side': side, 'line': line,
        'open_price': open_price, 'open_ts': iso(open_ts),
        'close_price': close_price, 'close_ts': iso(close_ts),
        'close_lag_minutes': None if lag is None else round(lag, 3),
        'pre_start_tick_count': pre_count,
        'first_tick_ts': iso(first_ts),
        'last_pre_start_tick_ts': iso(last_pre_ts),
        'start_ts': iso(start_ts), 'start_ts_source': start_src,
        'source': source, 'archived_at': iso(archived_at),
        'close_reliable': reliable,
    }


def summarise_history(month_path, catalogue):
    """bet365-history/YYYY-MM.json -> summary rows.

    This archive is match winner ONLY (`market: 121`) and its s1/s2 series are
    pre-start by construction. `generatedAt` on the file is the capture time, so
    it is the archived_at that ruling 2's 21-day window is measured from — which
    is exactly why the Mar-May months fail it: they were generated 2026-09-10..12,
    four to six months after the fixtures they cover.
    """
    d = json.load(open(month_path))
    gen = epoch(d.get('generatedAt'))
    rows, st = [], collections.Counter()
    sides = {'s1': '1', 's2': '2'}
    for fid, f in (d.get('fixtures') or {}).items():
        start_ts = epoch(f.get('start'))
        for skey, side in sides.items():
            series = sorted((t, p) for t, p in (f.get(skey) or [])
                            if t is not None and p is not None)
            if not series:
                st['empty_series'] += 1
                continue
            open_ts, open_price = series[0]
            close_ts, close_price = series[-1]
            if start_ts is None:
                st['no_start'] += 1
                rows.append(_row(fid, BOOK_HISTORY, 'match winner', side, None,
                                 open_price, open_ts, None, None, None,
                                 None, open_ts, None, None, 'none',
                                 'bet365-history', gen, False))
                continue
            reliable, lag = judge_close(start_ts, close_ts, gen)
            rows.append(_row(fid, BOOK_HISTORY, 'match winner', side, None,
                             open_price, open_ts,
                             close_price if reliable else None,
                             close_ts if reliable else None,
                             lag, len(series), open_ts, close_ts,
                             start_ts, 'oddspapi', 'bet365-history', gen,
                             reliable))
            st['reliable_close' if reliable else 'close_nulled'] += 1
    return rows, st, gen


# ---------------------------------------------------------------------- driver
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--history', action='store_true',
                    help='load bet365-history/ (match winner, Mar-Sep 2026)')
    ap.add_argument('--bucket', action='store_true',
                    help='load the oddspapi-raw bucket (all four families)')
    ap.add_argument('--fixtures', action='store_true',
                    help='load oddspapi_fixtures from the 180d sweep index')
    ap.add_argument('--dry-run', action='store_true',
                    help='summarise and report, write nothing')
    ap.add_argument('--limit', type=int, default=0,
                    help='cap bucket objects processed (0 = all)')
    a = ap.parse_args()
    if not (a.history or a.bucket or a.fixtures):
        a.history = a.bucket = a.fixtures = True

    catalogue = load_catalogue()
    if catalogue is None:
        print(f'::error::{os.path.basename(CATALOGUE)} missing — the payload '
              f'carries only market ids, so neither the keep-list nor `line` '
              f'can be resolved.')
        return 1
    print(f'tennis markets catalogue: {len(catalogue)} ids (0 metered units)')

    url, key = ('', '')
    if not a.dry_run:
        url, key = creds()

    result = {
        'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'grain': 'fixture+book+market+side+line, >=1 pre-start tick',
        'closeRule': {'days': RELIABLE_DAYS, 'lagMinutes': RELIABLE_LAG_MIN,
                      'ruledBy': 'Michael 2026-09-17T08:07Z gate 0ef55f38'},
        'dryRun': a.dry_run,
    }

    # ------------------------------------------------------------- fixtures
    if a.fixtures:
        if not os.path.exists(INDEX):
            print(f'::error::{os.path.basename(INDEX)} missing — run '
                  f'ten225-fixture-index.py first.')
            return 1
        with gzip.open(INDEX, 'rt', encoding='utf-8') as fh:
            idx = json.load(fh)
        frows = []
        for fid, m in idx['fixtures'].items():
            frows.append({
                'fixture_id': fid,
                'category_name': m.get('cat'),
                'tournament_name': m.get('tourn'),
                'scheduled_start': m.get('startSched'),
                'true_start': m.get('trueStart'),
                'updated_at': result['generatedAt'],
            })
        no_true = sum(1 for r in frows if not r['true_start'])
        print(f'\noddspapi_fixtures: {len(frows)} fixtures from the '
              f'{idx["spanDays"]}d sweep; {no_true} ({no_true/max(len(frows),1):.2%}) '
              f'have NO trueStartTime')
        result['fixtures'] = {'rows': len(frows), 'noTrueStart': no_true,
                              'spanDays': idx['spanDays'],
                              'sliceErrors': idx.get('sliceErrors', 0)}
        if not a.dry_run:
            sent, err = upsert(url, key, 'oddspapi_fixtures', frows, 'fixture_id')
            print(f'  upserted {sent}/{len(frows)}' + (f' — FAILED {err}' if err else ''))
            result['fixtures']['upserted'] = sent
            if err:
                return 1

    all_rows = []

    # --------------------------------------------------------- bet365-history
    # Loaded BEFORE the bucket on purpose. Where a fixture is in both, the raw
    # payload is strictly richer (verified 12 -> 17 ticks on a paired fixture),
    # so the bucket pass must be the one that lands last and wins the upsert.
    if a.history:
        hist_rows, hst, gens = [], collections.Counter(), {}
        months = sorted(f for f in os.listdir(HISTORY_DIR)
                        if f.endswith('.json') and f != 'index.json')
        print(f'\nbet365-history: {len(months)} months {months}')
        for mf in months:
            r, s, gen = summarise_history(os.path.join(HISTORY_DIR, mf), catalogue)
            rel = sum(1 for x in r if x['close_reliable'])
            print(f'  {mf}: {len(r):5d} rows, generated {iso(gen)}, '
                  f'{rel} reliable close ({rel/max(len(r),1):.1%})')
            gens[mf] = {'rows': len(r), 'generatedAt': iso(gen), 'reliable': rel}
            hist_rows.extend(r)
            hst.update(s)
        print(f'  total {len(hist_rows)} rows; {dict(hst)}')
        result['history'] = {'rows': len(hist_rows), 'perMonth': gens,
                             'stats': dict(hst)}
        all_rows.extend(hist_rows)

    # ---------------------------------------------------------------- bucket
    if a.bucket:
        if a.dry_run:
            print('\nbucket: SKIPPED in --dry-run (it needs the Supabase key).')
        else:
            if not os.path.exists(INDEX):
                print('::error::fixture index missing; it supplies the start times.')
                return 1
            with gzip.open(INDEX, 'rt', encoding='utf-8') as fh:
                fx_index = json.load(fh)['fixtures']
            months, ok = sb_list(url, key, '')
            objects = []
            for m in months:
                name = m.get('name')
                if not name or name == META_PREFIX:
                    continue
                rows_, ok2 = sb_list(url, key, f'{name}/')
                ok = ok and ok2
                for r in rows_:
                    n = r.get('name') or ''
                    if n.endswith('.json.gz'):
                        objects.append((f'{name}/{n}', n[:-len('.json.gz')],
                                        r.get('created_at')))
            if a.limit:
                objects = objects[:a.limit]
            print(f'\nbucket {BUCKET}: {len(objects)} objects '
                  f'(listing complete: {ok})')
            if not ok:
                print('::warning::bucket listing INCOMPLETE — counts are a '
                      'LOWER bound.')

            brows, bst = [], collections.Counter()
            unindexed = unreadable = norow = 0
            for path, fid, created in objects:
                payload, err = sb_download(url, key, path)
                if payload is None:
                    unreadable += 1
                    continue
                meta = fx_index.get(fid) or {}
                if not meta:
                    unindexed += 1
                start_ts = epoch(meta.get('trueStart'))
                r, s = summarise_payload(payload, fid, start_ts,
                                         epoch(created), catalogue)
                bst.update(s)
                if not r:
                    norow += 1
                brows.extend(r)
            rel = sum(1 for x in brows if x['close_reliable'])
            print(f'  {len(brows)} rows from {len(objects)} objects; '
                  f'{unindexed} not in the 180d index, {unreadable} unreadable, '
                  f'{norow} with no keep-list pre-start series')
            print(f'  {rel} reliable close ({rel/max(len(brows),1):.1%}); {dict(bst)}')
            fam = collections.Counter(x['market'] for x in brows)
            for k, v in fam.most_common():
                print(f'    {k:<16} {v:>7} rows')
            result['bucket'] = {
                'objects': len(objects), 'listingComplete': ok,
                'rows': len(brows), 'unindexed': unindexed,
                'unreadable': unreadable, 'noKeeplistSeries': norow,
                'reliableClose': rel, 'byFamily': dict(fam), 'stats': dict(bst)}
            all_rows.extend(brows)

    # ----------------------------------------------------------------- write
    print(f'\ntotal summary rows: {len(all_rows)}')
    if all_rows:
        lags = [x['close_lag_minutes'] for x in all_rows
                if x['close_lag_minutes'] is not None]
        if lags:
            flag = f'  <-- n<{MIN_N}' if len(lags) < MIN_N else ''
            print(f'close lag (all rows with a computable lag, n={len(lags)}): '
                  f'median {statistics.median(lags):.1f} min, '
                  f'min {min(lags):.1f}, max {max(lags):.1f}{flag}')
            result['closeLag'] = {'n': len(lags),
                                  'medianMinutes': statistics.median(lags),
                                  'minMinutes': min(lags), 'maxMinutes': max(lags)}
    if not a.dry_run and all_rows:
        sent, err = upsert(url, key, 'oddspapi_line_summary', all_rows,
                           'fixture_id,book,market,side,line')
        print(f'upserted {sent}/{len(all_rows)} summary rows'
              + (f' — FAILED {err}' if err else ''))
        result['upserted'] = sent
        if err:
            result['error'] = str(err)
            json.dump(result, open(OUT, 'w'), indent=1)
            return 1

    json.dump(result, open(OUT, 'w'), indent=1)
    print(f'wrote {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
