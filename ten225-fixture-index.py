#!/usr/bin/env python3
"""TEN-225 — fixtureId -> level index, so density can be measured WITHOUT
spending a single odds-API call.

WHY THIS EXISTS
---------------
The summary-table projection needs rows/fixture per LEVEL, because the annual
fixture mix is not the mix of any given week (the 2026-09-11..17 window caught
4 ATP fixtures against a 180-day rate of 17.9/day — the post-US-Open dead week,
a 25x understatement if projected).

The first attempt measured density by calling /v4/historical-odds directly, and
it lost: the raw-archive job holds the same key and oddspapi rate-limits to
~1 call/5s, so the probe got 3 fixtures in 9 minutes on 429 backoff while
slowing down the one job that is racing irreversible data loss. Wrong trade.

The archive is already writing those exact payloads to the bucket. So density
is measured from bytes we own (ten225-density-from-bucket.py, runs in Actions
where the Supabase key lives) and the only thing missing there is the LEVEL of
each fixture, because the archived object is the raw historical-odds payload
and carries no fixture metadata. That is what this index supplies.

The archive's own `.oddspapi-raw-targets.json.gz` holds the same mapping, but
it is only committed at the END of a multi-hour run, so it cannot be relied on
mid-backfill. This is a standalone, re-runnable sweep.

COST: ~31 metered /v4/fixtures units. /v4/fixtures is NOT the rate-limited
endpoint (30 slices, 0 errors, ~4 min measured), so it does not contend with
the archive. Refuses to run past 80% of request_limit (standing rule).
"""
import collections
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = 'https://api.oddspapi.io'
SPORT_TENNIS = 12
OUT = os.path.join(HERE, '.ten225-fixture-index.json.gz')

QUOTA_CEILING = 0.80
RETENTION_DAYS = 180
WINDOW_DAYS = 6          # /v4/fixtures 400s past 6 days
SLEEP = 1.5


def read_key():
    p = os.path.join(HERE, '.env')
    if os.path.exists(p):
        for line in open(p):
            if line.strip().startswith('ODDSPAPI_KEY='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    return os.environ.get('ODDSPAPI_KEY')


def api_get(path, params, key, timeout=180):
    p = dict(params)
    p['apiKey'] = key
    url = BASE + path + '?' + urllib.parse.urlencode(p)
    req = urllib.request.Request(url, headers={'User-Agent': 'BSP-Consult-Dashboard/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r), None
    except urllib.error.HTTPError as e:
        return None, e.code
    except Exception as e:                      # noqa: BLE001 — reported
        return None, str(e)


def meter(key, when):
    d, err = api_get('/v4/account', {}, key)
    if d is None:
        print(f'  meter unreadable {when} ({err})')
        return None, None
    subs = [s for s in (d.get('subscriptions') or []) if s.get('is_active')]
    if not subs:
        print(f'  NO active subscription {when}')
        return None, None
    s = subs[0]
    print(f'  oddspapi meter {when}: {s.get("request_count")}/{s.get("request_limit")}')
    return s.get('request_count'), s.get('request_limit')


def main():
    key = read_key()
    if not key:
        print('::error::ODDSPAPI_KEY is not set.')
        return 1
    need = (RETENTION_DAYS // WINDOW_DAYS) + 2
    used, limit = meter(key, 'before')
    if used is None or not limit:
        print('::error::refusing to spend metered units without a meter read.')
        return 1
    if used + need > int(limit * QUOTA_CEILING):
        print(f'::error::needs ~{need} units; {used}/{limit} used, 80% ceiling '
              f'{int(limit*QUOTA_CEILING)}. Not starting.')
        return 1

    now = datetime.now(timezone.utc)
    cur = now - timedelta(days=RETENTION_DAYS)
    index, mix, units, errs = {}, collections.Counter(), 0, 0
    while cur < now:
        end = min(cur + timedelta(days=WINDOW_DAYS), now)
        data, err = api_get('/v4/fixtures', {
            'sportId': SPORT_TENNIS,
            'from': cur.strftime('%Y-%m-%dT00:00:00Z'),
            'to': end.strftime('%Y-%m-%dT00:00:00Z'),
        }, key)
        units += 1
        if data is None:
            errs += 1
            print(f'  {cur:%Y-%m-%d}..{end:%Y-%m-%d}: FAILED ({err})')
        else:
            rows = data if isinstance(data, list) else (data.get('data') or [])
            for f in rows:
                fid = f.get('fixtureId')
                cat = f.get('categoryName') or 'unknown'
                if not fid or fid in index:
                    continue
                # Synthetic categories are excluded here and everywhere else,
                # so the index and the projection agree by construction.
                if 'Simulated' in cat or 'Srl' in cat:
                    continue
                index[fid] = {
                    'cat': cat,
                    # `start` is the COLLAPSED convenience field and is the one
                    # thing here that can be a scheduled time. Michael's locked
                    # definition forbids the scheduled time as a start, so
                    # consumers must read trueStart / trueEnd / startSched
                    # separately and let resolve_start() decide. Kept only so
                    # existing callers do not silently change meaning.
                    'start': f.get('trueStartTime') or f.get('startTime'),
                    'startSched': f.get('startTime'),
                    'trueStart': f.get('trueStartTime'),
                    # Added 2026-09-17 for Michael's trueStartTime sanity gate:
                    # the ruled test is trueEnd - trueStart > 6h, and without
                    # the end time only the weaker early-start limb can run
                    # (it misses 70.6% of the impossible rows).
                    'trueEnd': f.get('trueEndTime'),
                    # Added for the live-flip cross-check: live_flip_log is
                    # keyed by api-tennis event_key, so pairing needs names.
                    'p1': f.get('participant1Name'),
                    'p2': f.get('participant2Name'),
                    'tourn': f.get('tournamentName'),
                }
                mix[cat] += 1
            print(f'  {cur:%Y-%m-%d}..{end:%Y-%m-%d}: {len(rows):5d} rows '
                  f'({len(index)} indexed)')
        cur = end
        time.sleep(SLEEP)

    if errs:
        print(f'::warning::{errs} of {units} slices FAILED — the index is '
              f'INCOMPLETE and any projection off it is a LOWER bound.')

    payload = {
        'generatedAt': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'spanDays': RETENTION_DAYS,
        'units': units,
        'sliceErrors': errs,
        'levelMix': dict(mix),
        'fixtures': index,
    }
    with gzip.open(OUT, 'wt', encoding='utf-8') as fh:
        json.dump(payload, fh)

    print(f'\n  {len(index)} non-synthetic tennis fixtures over {RETENTION_DAYS}d '
          f'({units} metered units, {errs} slice errors)')
    for k, v in mix.most_common():
        print(f'    {k:<28} {v:>7}  ({v/RETENTION_DAYS:>7.2f}/day -> '
              f'{v/RETENTION_DAYS*365:>8.0f}/yr)')
    meter(key, 'after')
    print(f'\nwrote {OUT} ({os.path.getsize(OUT)/1e6:.2f} MB gz)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
