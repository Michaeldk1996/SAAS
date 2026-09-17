#!/usr/bin/env python3
"""TEN-225 Part 1, item 1 — the RAW oddspapi archive.

Michael's ruling (2026-09-17, TEN-225 gate):

  "START THE RAW ARCHIVE NOW — do not wait on the Postgres scope. Create the
   private Supabase Storage bucket and an Actions job that saves the full
   gzipped /v4/historical-odds payload for every tennis fixture: all levels
   (ATP, Slams, Challenger, ITF, Davis Cup), all markets, every tick (pre-start
   and in-play). Order: fixtures that started in the last 7 days first, then
   every fixture within 24h of finishing from now on, then the June/July
   backfill. Do NOT filter on hasOdds. Alert if the daily job misses 24h."

WHAT THIS IS NOT
----------------
This is a NEW, additive dataset in object storage. It does not touch, blend
with, or supersede anything that exists:
  * bet365-history/         — the REDUCED match-winner shards (TEN-179 item 1)
  * odds/{eventKey}.json    — the per-match lazy shards the Odds tab reads
  * matches.json            — owned by refresh-odds-history.py
  * any Supabase table, policy or pg_cron job
Nothing reads this bucket. It exists so that the dense series, which oddspapi
prunes on their side within weeks, is OURS before it is gone.

WHY RAW AND WHY NOW
-------------------
bet365-history/ stores a reduced, match-winner-only projection. Every other
market and every in-play tick in those payloads was discarded at write time and
is now unrecoverable for old fixtures. The Postgres scope decision (which
markets, which levels) is still open; a raw object archive makes that decision
reversible, because any future schema can be rebuilt from the bytes. Waiting
for the schema would lose another week of dense series permanently.

THE OBJECT IS THE CHECKPOINT
----------------------------
A fixture already in the bucket is never refetched — not as an optimisation but
because a re-pull can only return a WORSE copy (see the decay measurement on
TEN-225). There is no separate state file that can drift from what we hold.

COST
----
/v4/historical-odds is free and unmetered; it is rate-limited to ~1 call / 5s
and concurrency does not help (4 parallel calls returned one 200 and three
429s when measured on 2026-09-10). The only metered call is /v4/fixtures
discovery, ~31 units for a full 180-day sweep. The job refuses to start if the
meter is at or above 80% of the request limit.

USAGE
-----
  python3 archive-oddspapi-raw.py discover            # ~31 metered units
  python3 archive-oddspapi-raw.py archive --max-seconds 18000
  python3 archive-oddspapi-raw.py report              # bucket size, no odds API

Stdlib only. Reads ODDSPAPI_KEY, SUPABASE_URL, SUPABASE_SECRET_KEY from the
environment (or .env for the odds key). Secrets are never printed.
"""

import argparse
import gzip
import io
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

BUCKET = 'oddspapi-raw'
META_PREFIX = '_meta'
HEARTBEAT_KEY = f'{META_PREFIX}/last-run.json'

# Discovery cache lives outside any published directory. Unlike the
# bet365-history target list this one is NOT tier-filtered: all levels.
TARGETS = os.path.join(HERE, '.oddspapi-raw-targets.json.gz')

HIST_SLEEP = 5.5          # ~1 call / 5s, measured; concurrency does not help
MAX_RETRY = 4
FIXTURES_SLEEP = 2.5
WINDOW_DAYS = 6
RETENTION_DAYS = 180      # /v4/historical-odds 404s past ~180d (measured)
QUOTA_CEILING = 0.80      # standing rule: stop at 80% of request_limit
PRIORITY_DAYS = 7         # "fixtures that started in the last 7 days first"
SETTLE_HOURS = 24         # do not pull a fixture until 24h past its start
HEARTBEAT_MAX_AGE_H = 24  # "Alert if the daily job misses 24h"


# ------------------------------------------------------------------ credentials

def read_odds_key():
    env = os.path.join(HERE, '.env')
    if os.path.exists(env):
        for line in open(env):
            if line.strip().startswith('ODDSPAPI_KEY='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    return os.environ.get('ODDSPAPI_KEY')


def supabase_creds():
    url = (os.environ.get('SUPABASE_URL') or '').rstrip('/')
    key = os.environ.get('SUPABASE_SECRET_KEY') or ''
    if not url or not key:
        die('SUPABASE_URL / SUPABASE_SECRET_KEY are not both set.')
    return url, key


def die(msg):
    print(f'::error::{msg}', file=sys.stderr)
    sys.exit(1)


# ----------------------------------------------------------------- oddspapi api

def api_get(path, params, key, timeout=180, raw=False):
    p = dict(params)
    p['apiKey'] = key
    url = BASE + path + '?' + urllib.parse.urlencode(p)
    req = urllib.request.Request(url, headers={'User-Agent': 'BSP-Consult-Dashboard/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            return (body if raw else json.loads(body.decode('utf-8'))), None
    except urllib.error.HTTPError as e:
        return None, e.code
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        return None, str(e)


def meter(key, when):
    """Live meter read. /v4/account is itself unmetered."""
    data, err = api_get('/v4/account', {}, key)
    if data is None:
        print(f'::warning::could not read the oddspapi meter {when} ({err}).')
        return None, None
    subs = [s for s in (data.get('subscriptions') or []) if s.get('is_active')]
    if not subs:
        print(f'::warning::oddspapi reports NO active subscription {when}.')
        return None, None
    s = subs[0]
    used, limit = s.get('request_count'), s.get('request_limit')
    books = ', '.join(sorted((s.get('bookmakers') or {}).keys())) or 'none'
    print(f'oddspapi meter {when}: {used}/{limit} ({s.get("plan")} plan; books: {books}).')
    return used, limit


def guard_quota(key, need):
    """Refuse to spend metered units past 80% of the limit."""
    used, limit = meter(key, 'before discovery')
    if used is None or not limit:
        die('Refusing to spend metered units without a meter read.')
    ceiling = int(limit * QUOTA_CEILING)
    if used + need > ceiling:
        die(f'Discovery needs ~{need} metered units; {used}/{limit} used and the '
            f'80% ceiling is {ceiling}. Not starting.')
    return used, limit


def hist_get(fixture_id, key):
    """One free /v4/historical-odds call, FULL payload, every market, every tick.

    No `bookmakers` filter: the key is entitled to bet365 today, and hard-coding
    the book here would silently drop any book a future plan adds.
    A 429 is a RATE limit, not a budget limit, and does not bill."""
    for attempt in range(MAX_RETRY):
        body, err = api_get('/v4/historical-odds', {'fixtureId': fixture_id},
                            key, raw=True)
        if err == 429:
            time.sleep(HIST_SLEEP * (attempt + 2))
            continue
        return body, err
    return None, 429


# ---------------------------------------------------------------- supabase api

def sb_request(method, path, url, key, body=None, headers=None, timeout=180):
    h = {'Authorization': f'Bearer {key}', 'apikey': key,
         'User-Agent': 'BSP-Consult-Dashboard/1.0'}
    if headers:
        h.update(headers)
    data = body
    if isinstance(body, (dict, list)):
        data = json.dumps(body).encode('utf-8')
        h.setdefault('Content-Type', 'application/json')
    req = urllib.request.Request(url + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            try:
                return json.loads(raw.decode('utf-8')), None
            except ValueError:
                return raw, None
    except urllib.error.HTTPError as e:
        return None, (e.code, e.read()[:400].decode('utf-8', 'replace'))
    except Exception as e:                                # noqa: BLE001
        return None, (None, str(e))


def ensure_bucket(url, key):
    """Create the PRIVATE bucket if it is not there. Idempotent."""
    got, err = sb_request('GET', f'/storage/v1/bucket/{BUCKET}', url, key)
    if got and isinstance(got, dict) and got.get('name'):
        if got.get('public'):
            die(f'Bucket {BUCKET} exists but is PUBLIC. Refusing to write to it.')
        print(f'bucket {BUCKET}: already exists (public={got.get("public")}).')
        return False
    made, err = sb_request('POST', '/storage/v1/bucket', url, key,
                           body={'id': BUCKET, 'name': BUCKET, 'public': False})
    if made is None:
        die(f'could not create bucket {BUCKET}: {err}')
    print(f'bucket {BUCKET}: CREATED (private).')
    return True


def sb_list(url, key, prefix, limit=1000):
    """Every object under a prefix, paginated. Returns [{name, metadata{size}}]."""
    out, offset = [], 0
    while True:
        page, err = sb_request('POST', f'/storage/v1/object/list/{BUCKET}', url, key,
                               body={'prefix': prefix, 'limit': limit, 'offset': offset,
                                     'sortBy': {'column': 'name', 'order': 'asc'}})
        if page is None:
            print(f'::warning::list {prefix!r} failed: {err}')
            return out, False
        rows = page if isinstance(page, list) else []
        out.extend(rows)
        if len(rows) < limit:
            return out, True
        offset += limit


def sb_upload(url, key, path, blob, content_type='application/json',
              encoding='gzip'):
    _, err = sb_request('POST', f'/storage/v1/object/{BUCKET}/{path}', url, key,
                        body=blob,
                        headers={'Content-Type': content_type,
                                 'Content-Encoding': encoding,
                                 'x-upsert': 'true'})
    return err


def sb_download(url, key, path):
    got, err = sb_request('GET', f'/storage/v1/object/{BUCKET}/{path}', url, key)
    return got, err


# ------------------------------------------------------------------- time bits

def parse_iso(ts):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).replace('Z', '+00:00'))
    except ValueError:
        return None


def start_of(fx):
    """Real UTC start. trueStartTime is the observed first ball; startTime is the
    schedule and is only a fallback. Never used as a Close anchor here — this
    archive stores raw bytes and leaves that ruling to the reader."""
    return parse_iso(fx.get('trueStartTime')) or parse_iso(fx.get('startTime'))


def month_of(fx):
    d = start_of(fx)
    return d.strftime('%Y-%m') if d else 'unknown'


def object_path(fx):
    return f'{month_of(fx)}/{fx["fixtureId"]}.json.gz'


# -------------------------------------------------------------------- discovery

def discover(key, days=RETENTION_DAYS):
    """Sweep /v4/fixtures across the retention window. ALL LEVELS — no tier
    filter, no hasOdds filter (hasOdds was false on 3,126 of 3,311 fixtures in
    the item-0 sample, so filtering on it would drop 94% of the archive)."""
    guard_quota(key, need=(days // WINDOW_DAYS) + 2)
    now = datetime.now(timezone.utc)
    cur = now - timedelta(days=days)
    out, units, errs = {}, 0, 0
    by_cat = {}
    while cur < now + timedelta(days=1):
        end = min(cur + timedelta(days=WINDOW_DAYS), now + timedelta(days=1))
        data, err = api_get('/v4/fixtures', {
            'sportId': SPORT_TENNIS,
            'from': cur.strftime('%Y-%m-%dT00:00:00Z'),
            'to': end.strftime('%Y-%m-%dT00:00:00Z'),
        }, key)
        units += 1
        if data is None:
            errs += 1
            print(f'::warning::fixtures sweep {cur:%Y-%m-%d}..{end:%Y-%m-%d} failed ({err}).')
        else:
            rows = data if isinstance(data, list) else (data.get('data') or [])
            for f in rows:
                fid = f.get('fixtureId')
                if not fid or fid in out:
                    continue
                out[fid] = {k: f.get(k) for k in (
                    'fixtureId', 'startTime', 'trueStartTime', 'trueEndTime',
                    'categoryName', 'tournamentName', 'participant1Name',
                    'participant2Name', 'hasOdds', 'status')}
                cat = f.get('categoryName') or '(none)'
                by_cat[cat] = by_cat.get(cat, 0) + 1
            print(f'  {cur:%Y-%m-%d}..{end:%Y-%m-%d}: {len(rows):5d} fixtures')
        cur = end
        time.sleep(FIXTURES_SLEEP)

    if errs:
        print(f'::warning::{errs} of {units} discovery slices failed — the target '
              f'list is INCOMPLETE. Not caching it.')
    else:
        with gzip.open(TARGETS, 'wt', encoding='utf-8') as fh:
            json.dump({'generatedAt': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
                       'days': days, 'units': units, 'errors': errs,
                       'byCategory': by_cat,
                       'fixtures': list(out.values())}, fh)
    print(f'\nDiscovered {len(out)} tennis fixtures over {days} days '
          f'({units} metered unit(s), {errs} slice error(s)).')
    print('By level: ' + ', '.join(f'{k}={v}' for k, v in
                                   sorted(by_cat.items(), key=lambda kv: -kv[1])))
    meter(key, 'after discovery')
    return list(out.values())


def load_targets():
    if not os.path.exists(TARGETS):
        return None
    with gzip.open(TARGETS, 'rt', encoding='utf-8') as fh:
        return json.load(fh).get('fixtures') or []


# --------------------------------------------------------------------- ordering

def order_targets(targets, now):
    """Michael's order: last 7 days first, then everything else newest-first
    (which is where the June/July hole sits). A fixture is only pulled once it
    is at least SETTLE_HOURS past its start, so the payload is complete."""
    ready, waiting = [], 0
    for f in targets:
        st = start_of(f)
        if st is None:
            continue
        age_h = (now - st).total_seconds() / 3600.0
        if age_h < SETTLE_HOURS:
            waiting += 1
            continue
        ready.append((age_h, f))
    priority = sorted((r for r in ready if r[0] <= PRIORITY_DAYS * 24),
                      key=lambda r: r[0])
    rest = sorted((r for r in ready if r[0] > PRIORITY_DAYS * 24),
                  key=lambda r: r[0])
    return [f for _, f in priority], [f for _, f in rest], waiting


def build_queue(targets, have, now):
    """The pull list: ordered, settled, and with everything already in the
    bucket removed. `have` is the set of fixtureIds the bucket holds — a
    fixture in it is NEVER re-pulled, because a re-pull can only return a worse
    copy than the one we already have."""
    priority, rest, waiting = order_targets(targets, now)
    queue = [f for f in priority + rest if f['fixtureId'] not in have]
    return queue, priority, waiting


# ---------------------------------------------------------------------- archive

def held_objects(url, key):
    """Every fixtureId already in the bucket, plus total bytes per month."""
    have, sizes = set(), {}
    months, ok_all = sb_list(url, key, '')
    for m in months:
        name = m.get('name')
        if not name or name == META_PREFIX:
            continue
        rows, ok = sb_list(url, key, f'{name}/')
        ok_all = ok_all and ok
        for r in rows:
            n = r.get('name') or ''
            if not n.endswith('.json.gz'):
                continue
            have.add(n[:-len('.json.gz')])
            sizes[name] = sizes.get(name, 0) + int(
                ((r.get('metadata') or {}).get('size')) or 0)
    return have, sizes, ok_all


def check_heartbeat(url, key, now):
    got, err = sb_download(url, key, HEARTBEAT_KEY)
    if got is None or not isinstance(got, dict):
        print('::warning::no heartbeat object yet — first run, or it was lost.')
        return
    last = parse_iso(got.get('finishedAt'))
    if last is None:
        print('::warning::heartbeat object present but unreadable.')
        return
    age_h = (now - last).total_seconds() / 3600.0
    line = f'last successful run {age_h:.1f}h ago ({got.get("finishedAt")}).'
    if age_h > HEARTBEAT_MAX_AGE_H:
        print(f'::error::ARCHIVE GAP — {line} The daily job missed its 24h window; '
              f'dense series for anything that fell out of retention in that gap '
              f'is gone and cannot be recovered.')
    else:
        print(f'heartbeat: {line}')


def write_heartbeat(url, key, now, stats):
    body = dict(stats)
    body['finishedAt'] = now.strftime('%Y-%m-%dT%H:%M:%SZ')
    blob = gzip.compress(json.dumps(body, indent=1).encode('utf-8'))
    err = sb_upload(url, key, HEARTBEAT_KEY, blob)
    if err:
        print(f'::warning::could not write the heartbeat object: {err}')


def archive(odds_key, max_seconds):
    url, sb_key = supabase_creds()
    now = datetime.now(timezone.utc)
    ensure_bucket(url, sb_key)
    check_heartbeat(url, sb_key, now)

    targets = load_targets()
    if targets is None:
        die('No discovery cache. Run `discover` first.')

    have, sizes, listed_ok = held_objects(url, sb_key)
    if not listed_ok:
        die('Bucket listing was incomplete — refusing to run, because an '
            'incomplete "already held" set would re-pull and DOWNGRADE fixtures '
            'we already hold.')
    print(f'bucket holds {len(have)} fixtures, '
          f'{sum(sizes.values())/1e6:.1f} MB across {len(sizes)} months.')

    queue, priority, waiting = build_queue(targets, have, now)
    print(f'targets: {len(targets)} discovered, {waiting} still inside the '
          f'{SETTLE_HOURS}h settle window, {len(priority)} in the last '
          f'{PRIORITY_DAYS}d, {len(queue)} to pull this run (budget '
          f'{max_seconds}s).')

    t0 = time.time()
    saved = failed = empty = 0
    errors = {}
    bytes_raw = bytes_gz = 0
    for f in queue:
        if time.time() - t0 > max_seconds:
            print(f'time budget spent after {saved} saved; the rest resumes next run.')
            break
        body, err = hist_get(f['fixtureId'], odds_key)
        time.sleep(HIST_SLEEP)
        if body is None:
            failed += 1
            errors[str(err)] = errors.get(str(err), 0) + 1
            continue
        # An empty-but-valid payload is still recorded: it is the honest answer
        # for that fixture and stops us pulling it forever. Never a fabricated
        # price, never a zero.
        try:
            parsed = json.loads(body.decode('utf-8'))
        except ValueError:
            failed += 1
            errors['unparseable'] = errors.get('unparseable', 0) + 1
            continue
        if not (parsed or {}).get('bookmakers'):
            empty += 1
        blob = gzip.compress(body, 6)
        bytes_raw += len(body)
        bytes_gz += len(blob)
        up_err = sb_upload(url, sb_key, object_path(f), blob)
        if up_err:
            failed += 1
            errors[f'upload-{up_err[0]}'] = errors.get(f'upload-{up_err[0]}', 0) + 1
            continue
        saved += 1
        if saved % 25 == 0:
            print(f'  {saved} saved, {failed} failed, {empty} with no bookmaker '
                  f'block, {bytes_gz/1e6:.1f} MB gz written '
                  f'({time.time()-t0:.0f}s elapsed).', flush=True)

    have2, sizes2, _ = held_objects(url, sb_key)
    stats = {
        'savedThisRun': saved, 'failedThisRun': failed,
        'noBookmakerBlock': empty, 'errors': errors,
        'bytesRawThisRun': bytes_raw, 'bytesGzThisRun': bytes_gz,
        'bucketFixtures': len(have2), 'bucketBytes': sum(sizes2.values()),
        'bucketByMonth': sizes2, 'queueRemaining': max(0, len(queue) - saved - failed),
    }
    write_heartbeat(url, sb_key, datetime.now(timezone.utc), stats)
    print('\n=== RUN SUMMARY ===')
    print(json.dumps(stats, indent=1, sort_keys=True))
    if saved:
        print(f'compression: {bytes_raw/1e6:.1f} MB raw -> {bytes_gz/1e6:.1f} MB gz '
              f'({bytes_gz/max(1,bytes_raw)*100:.1f}%), '
              f'{bytes_gz/saved/1024:.1f} KB gz per fixture (n={saved}).')
    # Loud, non-zero exit when the run did real work but mostly failed. Exit 1
    # is NOT a stand-down (TEN-216 ruling) — the next scheduled run resumes.
    if saved == 0 and failed > 0:
        die(f'{failed} pulls and 0 saves this run: {errors}')
    return 0


def report():
    url, key = supabase_creds()
    have, sizes, ok = held_objects(url, key)
    total = sum(sizes.values())
    print(f'bucket {BUCKET}: {len(have)} fixtures, {total/1e6:.1f} MB '
          f'(listing complete: {ok}).')
    for m in sorted(sizes):
        print(f'  {m}: {sizes[m]/1e6:8.2f} MB')
    if have:
        print(f'mean {total/len(have)/1024:.1f} KB gz per fixture (n={len(have)}).')
    got, _ = sb_download(url, key, HEARTBEAT_KEY)
    if isinstance(got, dict):
        print('\nlast run: ' + json.dumps(got, indent=1, sort_keys=True))
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['discover', 'archive', 'report'])
    ap.add_argument('--max-seconds', type=int, default=18000)
    ap.add_argument('--days', type=int, default=RETENTION_DAYS)
    a = ap.parse_args()

    if a.cmd == 'report':
        return report()

    key = read_odds_key()
    if not key:
        die('ODDSPAPI_KEY is not set.')
    if a.cmd == 'discover':
        discover(key, a.days)
        return 0
    return archive(key, a.max_seconds)


if __name__ == '__main__':
    sys.exit(main())
