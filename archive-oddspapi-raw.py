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
  python3 archive-oddspapi-raw.py postmatch           # 0 metered units; see below

POSTMATCH (TEN-270, founder: "Find a way to archive it straight after the
game.") Every 15 min at :07/:22/:37/:52, pulls each FINISHED board match that
has an oddspapi fixtureId and no object yet, into the same canonical path, so
the daily `archive` run skips it. Free /v4/historical-odds + /v4/account only;
it stops on a 429 (the live price loop always wins the key). The match-winner
ticks of bet365 cards are projected into `bet365_mw_ticks` for the hover box.

Stdlib only. Reads ODDSPAPI_KEY, SUPABASE_URL, SUPABASE_SECRET_KEY from the
environment (or .env for the odds key). Secrets are never printed.
"""

import argparse
import collections
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


def meter(key, when, get=None):
    """Live meter read. /v4/account is itself unmetered."""
    data, err = (get or api_get)('/v4/account', {}, key)
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
              encoding='gzip', upsert=True):
    headers = {'Content-Type': content_type,
               'x-upsert': 'true' if upsert else 'false'}
    if encoding:
        headers['Content-Encoding'] = encoding
    _, err = sb_request('POST', f'/storage/v1/object/{BUCKET}/{path}', url, key,
                        body=blob, headers=headers)
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


# -------------------------------------------------------------------- postmatch
#
# TEN-270, founder rulings (verbatim):
#   "Find a way to archive it straight after the game."
#   "Separate 15-min job, offset so it never runs at the same minute as the odds
#    loop (e.g. :07, :22, :37, :52). On a 429 it backs off and retries next run;
#    the live price loop always wins the key."
#
# WHAT IT DOES. Targets = board cards with a RESULT (id `past-…` AND a
# finalScore), an oddspapi fixtureId in odds-fixture-map.json, no object in the
# bucket yet, and at least PM_WAIT_MIN since this job first saw the result. Each
# is pulled ONCE from /v4/historical-odds, accepted only when the last
# match-winner tick of both sides is active=False (the market closed at the
# end; a mid-match suspension is also inactive, which is why this is the second
# check behind the result, never the first), and written to the SAME canonical
# path object_path() gives the daily run — whose held_objects() then skips it.
#
# THE KEY. The odds loop ticks at :00/:15/:30/:45 (measured from its job logs:
# 110 of 110 iterations started within 60 s of the quarter hour; median 113 s,
# max 590 s long). GitHub delays scheduled runs, so the cron minute alone does
# not keep us off the loop: every call is also gated on the wall clock being
# inside PM_WINDOW minutes of the quarter hour, AND on the loop's own evidence
# that its current iteration is over (loop_idle(): no odds-now run in progress,
# or its end-of-iteration capture commit is on main since both the last quarter
# hour and the run's own start). The window alone is not enough: an iteration
# ran 590 s once. On the FIRST 429 the run stops (exit 0), no retry — the next
# run resumes. A 404 is recorded under _meta/ and given up after
# PM_MAX_404 runs, so a fixture oddspapi never serves is not retried forever.
#
# ZERO BILLABLE CALLS. free_get() refuses any path outside FREE_PATHS, and the
# /v4/account meter is read before and after the pulls into the job log.

SITE = 'https://michaeldk1996.github.io/SAAS/'
PM_STATE_KEY = f'{META_PREFIX}/postmatch-state.json'
PM_HEARTBEAT_KEY = f'{META_PREFIX}/postmatch-last-run.json'
PM_WAIT_MIN = 30          # minutes after this job first sees the result
PM_WINDOW = (5, 14)       # minutes into each quarter hour the key may be used
PM_MAX_RUN_S = 480        # the workflow's timeout is 10 min
PM_LOOP_POLL_S = 20       # while an odds-loop iteration is running, look again this often
GH_API = 'https://api.github.com'
GH_REPO = 'Michaeldk1996/SAAS'
LOOP_WORKFLOW = 'odds-now.yml'
LOOP_COMMIT_PREFIX = 'chore(odds): capture tick'   # the loop's end-of-iteration push
LOOP_WAITING = ('queued', 'pending', 'waiting', 'requested')   # a successor about to start
LOOP_COOLDOWN_S = 120     # a run that completed this recently: its successor may be starting
LOOP_END_PHASE_MIN = 314  # LOOP_MINUTES 330 minus one 15-min interval, minus 1: from here the
                          # loop may exit and the post step reads /v4/account (odds-now.yml)
PM_CALL_MARGIN_S = 30     # a call starts only if the window is still open this much later
PM_CALL_TIMEOUT_S = 60    # a 1-4.5 MB payload took 3.8-7.6 s (measured 2026-09-10)
PM_MAX_404 = 3            # runs that saw a 404 before the fixture is given up
PM_MAX_DEFER = 8          # runs with an open market before it is left to the daily run
PM_SEEN_KEEP_DAYS = 4
PM_LOADED_KEEP_DAYS = 14
FREE_PATHS = frozenset({'/v4/historical-odds', '/v4/account'})
MW_BOOK, MW_MARKET, MW_OUTCOMES = 'bet365', '121', ('121', '122')  # 121 = participant1
TICKS_TABLE = 'bet365_mw_ticks'
TICK_COLUMNS = ('card_key', 'side', 'price', 'at', 'active', 'fixture_id', 'player')

_now = lambda: datetime.now(timezone.utc)   # noqa: E731 — injectable in tests
_sleep = time.sleep
CALLS = {}                                   # oddspapi path -> calls this run


class BillableCall(RuntimeError):
    """A path outside FREE_PATHS was about to be called. Never caught."""


def free_get(path, params, key, raw=False):
    if path not in FREE_PATHS:
        raise BillableCall(f'{path} is not a free oddspapi endpoint; the post-match '
                           f'job makes zero billable calls.')
    CALLS[path] = CALLS.get(path, 0) + 1
    return api_get(path, params, key, timeout=PM_CALL_TIMEOUT_S, raw=raw)


def iso(d):
    return d.strftime('%Y-%m-%dT%H:%M:%SZ')


def quarter_s(now):
    return (now.minute % 15) * 60 + now.second


def in_window(now):
    return PM_WINDOW[0] * 60 <= quarter_s(now) < PM_WINDOW[1] * 60


def can_call(now):
    """A call may START only if the window is still open PM_CALL_MARGIN_S later."""
    return in_window(now) and in_window(now + timedelta(seconds=PM_CALL_MARGIN_S))


def wait_for_window(deadline):
    """True once the clock is inside PM_WINDOW; False if that is past the run's
    deadline. Never calls the key outside the window."""
    now = _now()
    if can_call(now):
        return True
    q = quarter_s(now)
    wait = (PM_WINDOW[0] * 60 - q) if q < PM_WINDOW[0] * 60 else (900 - q + PM_WINDOW[0] * 60)
    if now + timedelta(seconds=wait + 30) > deadline:
        return False
    print(f'waiting {wait}s for the odds loop to leave the key '
          f'(:{PM_WINDOW[0]:02d}-:{PM_WINDOW[1]:02d} of each quarter hour).', flush=True)
    _sleep(wait)
    return can_call(_now())


def postmatch_hist(fixture_id, key, counts):
    """One free /v4/historical-odds call, never retried: a 429 is returned as
    429 and the caller stops the run — the live loop always wins the key."""
    body, err = free_get('/v4/historical-odds', {'fixtureId': fixture_id}, key, raw=True)
    if err == 429:
        counts['http429'] += 1
    return body, err


# --------------------------------------------------------------- the loop gate
def gh_get(path):
    """GitHub REST read with the workflow's GITHUB_TOKEN. (data, None) | (None, err)."""
    tok = os.environ.get('GITHUB_TOKEN') or os.environ.get('GH_TOKEN') or ''
    h = {'Accept': 'application/vnd.github+json', 'User-Agent': 'BSP-Consult-Dashboard/1.0'}
    if tok:
        h['Authorization'] = f'Bearer {tok}'
    try:
        with urllib.request.urlopen(urllib.request.Request(GH_API + path, headers=h),
                                    timeout=30) as r:
            return json.loads(r.read().decode('utf-8')), None
    except urllib.error.HTTPError as e:
        return None, e.code
    except Exception as e:                                 # noqa: BLE001 — any blip = busy
        return None, f'{type(e).__name__}: {e}'


def loop_idle(now):
    """(idle?, why). The odds loop (odds-now.yml) runs one iteration per quarter
    hour and ends each with a push of `chore(odds): capture tick N`. Busy when:
    a run is queued/pending/waiting/requested and none is iterating (the
    successor uses the key as it starts); a run completed < LOOP_COOLDOWN_S ago;
    the iterating run is in its end phase (final iteration + post-step meter
    read); or its latest capture commit is not on main since both the last
    quarter-hour boundary and the run's own start (a restarted loop iterates at
    once, mid-quarter). A pending successor BEHIND an iterating run is only
    waiting and does not block. Anything unreadable counts as busy."""
    try:
        return _loop_idle(now)
    except Exception as e:                                 # noqa: BLE001 — odd body = busy
        return False, f'odds-now state unreadable ({type(e).__name__})'


def _loop_idle(now):
    runs, err = gh_get(f'/repos/{GH_REPO}/actions/workflows/{LOOP_WORKFLOW}/runs?per_page=10')
    if not isinstance(runs, dict) or not isinstance(runs.get('workflow_runs'), list):
        return False, f'odds-now runs unreadable ({err})'
    live = []
    for r in runs['workflow_runs']:
        st = r.get('status')
        if st == 'in_progress':
            live.append(parse_iso(r.get('run_started_at')))
        elif st == 'completed':
            done = parse_iso(r.get('updated_at'))
            if done is None or (now - done).total_seconds() < LOOP_COOLDOWN_S:
                return False, 'an odds-now run just completed; its successor may be starting'
    if not live:
        # No run iterating. A queued/pending successor starts any second and uses
        # the key at once (/v4/account pre-step, a metered NOW leg): busy.
        if any(r.get('status') in LOOP_WAITING for r in runs['workflow_runs']):
            return False, 'an odds-now run is queued to start'
        return True, 'no odds-now run in progress or queued'
    if any(t is None for t in live):
        return False, 'an odds-now run has no start time'
    if any((now - t).total_seconds() >= LOOP_END_PHASE_MIN * 60 for t in live):
        return False, 'the odds-now run is in its end phase (final iteration / post meter read)'
    commits, err = gh_get(f'/repos/{GH_REPO}/commits?sha=main&per_page=30')
    if commits is None:
        return False, f'main commits unreadable ({err})'
    ticks = [parse_iso(((c.get('commit') or {}).get('committer') or {}).get('date'))
             for c in commits if isinstance(c, dict)
             and str((c.get('commit') or {}).get('message') or '').startswith(LOOP_COMMIT_PREFIX)]
    ticks = [t for t in ticks if t]
    last = max(ticks) if ticks else None
    boundary = now.replace(minute=now.minute - now.minute % 15, second=0, microsecond=0)
    since = max([boundary] + live)
    if last and last >= since:
        return True, f'loop iteration done (capture commit {iso(last)})'
    return False, (f'odds-loop iteration in progress (no capture commit since {iso(since)}; '
                   f'last {iso(last) if last else "—"})')


def key_is_ours(deadline, counts):
    """Wait (inside the window) until the loop's iteration is over. False = stop."""
    while True:
        now = _now()
        if not can_call(now) or now > deadline:
            return False
        idle, why = loop_idle(now)
        if idle:
            return True
        counts['loopBusyChecks'] += 1
        print(f'key: {why}; looking again in {PM_LOOP_POLL_S}s.', flush=True)
        _sleep(PM_LOOP_POLL_S)


def _names():
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    import ten225_names
    return ten225_names


def event_key(m):
    parts = str(m.get('id') or '').split('-')
    return '-'.join(parts[1:]) if len(parts) > 1 else ''


def has_result(m):
    """The board's result signal: the id flipped upcoming- -> past- AND a final
    score is there. A past- card without one (interrupted) is not finished."""
    return str(m.get('id') or '').startswith('past-') and bool(m.get('finalScore'))


def merge_boards(*boards):
    """Union by event key; a copy WITH a result wins over one without."""
    out = {}
    for b in boards:
        for m in (b if isinstance(b, list) else (b or {}).get('matches') or []):
            ek = event_key(m)
            if ek and (ek not in out or (has_result(m) and not has_result(out[ek]))):
                out[ek] = m
    return list(out.values())


def card_orientation(rec, m):
    """'same' when oddspapi participant1 is the CARD's p1, 'swap' when it is the
    card's p2, None when the map and the card disagree on who is playing."""
    o = rec.get('orient')
    if o not in ('same', 'swap'):
        return None
    rp = (rec.get('p1'), rec.get('p2'))
    if not all(rp):
        return o
    if rp == (m.get('p1'), m.get('p2')):
        return o
    if rp == (m.get('p2'), m.get('p1')):
        return 'swap' if o == 'same' else 'same'
    return None


def select_targets(matches, fmap, ocs, state, now, counts):
    """Finished board cards -> post-match targets. Records first sightings."""
    names = _names()
    seen = state.setdefault('seen', {})
    nf = state.setdefault('notFound', {})
    by_key = (fmap or {}).get('byKey') or {}
    ocs_by = (ocs or {}).get('byKey') or {}
    out = []
    for m in matches:
        if not has_result(m):
            continue
        counts['finished'] += 1
        ek = event_key(m)
        seen.setdefault(ek, iso(now))
        rec = by_key.get(ek) or {}
        fid = rec.get('fixtureId')
        if not fid:
            counts['unmapped'] += 1
            continue
        ck = names.match_key((m.get('date') or '')[:10], m.get('p1'), m.get('p2'))
        if not ck:
            counts['noCardKey'] += 1
            continue
        if int((nf.get(fid) or {}).get('n') or 0) >= PM_MAX_404:
            counts['gaveUp404'] += 1
            continue
        first = parse_iso(seen[ek]) or now
        out.append({'eventKey': ek, 'fixtureId': fid, 'cardKey': ck,
                    'orient': card_orientation(rec, m), 'startTime': rec.get('startTime'),
                    'p1': m.get('p1'), 'p2': m.get('p2'),
                    'bet365Card': (ocs_by.get(ck) or {}).get('book') == 'bet365',
                    'seenAgeMin': (now - first).total_seconds() / 60.0})
    return out


def bucket_months(url, key):
    """Every top-level folder but _meta — the same set held_objects() walks —
    or None when the listing fails. Read once per run."""
    top, ok = sb_list(url, key, '')
    if not ok:
        return None
    return sorted(m.get('name') for m in top if m.get('name') and m.get('name') != META_PREFIX)


def held_path(url, key, fixture_id, months):
    """The object's path if ANY month folder holds this fixture, False if none
    does, None if that cannot be told (then the fixture is NOT pulled: a pull on
    an unknown answer could overwrite the checkpoint). One small search-filtered
    listing per folder, not a full walk of the bucket."""
    if months is None:
        return None
    want = f'{fixture_id}.json.gz'
    for mo in months:
        page, err = sb_request('POST', f'/storage/v1/object/list/{BUCKET}', url, key,
                               body={'prefix': f'{mo}/', 'search': fixture_id,
                                     'limit': 100, 'offset': 0,
                                     'sortBy': {'column': 'name', 'order': 'asc'}})
        if page is None or not isinstance(page, list) or len(page) >= 100:
            return None
        if any(r.get('name') == want for r in page):
            return f'{mo}/{want}'
    return False


def payload_of(blob):
    if isinstance(blob, dict):
        return blob
    if not isinstance(blob, (bytes, bytearray)):
        return None
    try:
        if blob[:2] == b'\x1f\x8b':
            blob = gzip.decompress(blob)
        return json.loads(blob.decode('utf-8'))
    except (OSError, ValueError):
        return None


def mw_ticks(payload):
    """bet365 match-winner ticks per outcome, oldest first, or None when the
    payload has no bet365 match-winner market."""
    mkt = ((((payload or {}).get('bookmakers') or {}).get(MW_BOOK) or {})
           .get('markets') or {}).get(MW_MARKET)
    if not isinstance(mkt, dict):
        return None
    outs = mkt.get('outcomes') or {}
    res = {}
    for oc in MW_OUTCOMES:
        ticks = [t for t in (((outs.get(oc) or {}).get('players') or {}).get('0') or [])
                 if isinstance(t, dict) and parse_iso(t.get('createdAt'))]
        res[oc] = sorted(ticks, key=lambda t: parse_iso(t['createdAt']))
    return res


def market_closed(ticks):
    """Both sides' LAST tick is active=False. Missing either side = not closed."""
    return bool(ticks) and all(ticks.get(oc) and ticks[oc][-1].get('active') is False
                               for oc in MW_OUTCOMES)


def tick_rows(ticks, target):
    """Rows for bet365_mw_ticks in CARD orientation, one per change: a tick is
    kept when its price or its active flag differs from the side's previous
    kept tick. Prices below 1.01 are not prices and are never stored."""
    if not ticks or target.get('orient') not in ('same', 'swap'):
        return []
    side_of = {'121': 'p1', '122': 'p2'} if target['orient'] == 'same' \
        else {'121': 'p2', '122': 'p1'}
    rows = []
    for oc in MW_OUTCOMES:
        side, prev = side_of[oc], None
        for t in ticks.get(oc) or []:
            try:
                price = round(float(t.get('price')), 3)
            except (TypeError, ValueError):
                continue
            if price < 1.01:
                continue
            active = t.get('active') if isinstance(t.get('active'), bool) else None
            if prev and prev == (price, active):
                continue
            prev = (price, active)
            rows.append({'card_key': target['cardKey'], 'side': side, 'price': price,
                         'at': iso(parse_iso(t['createdAt'])), 'active': active,
                         'fixture_id': target['fixtureId'], 'player': target[side]})
    return rows


def load_ticks(url, key, rows):
    for i in range(0, len(rows), 500):
        _, err = sb_request('POST', f'/rest/v1/{TICKS_TABLE}?on_conflict=card_key,side,at,price',
                            url, key, body=rows[i:i + 500],
                            headers={'Prefer': 'resolution=ignore-duplicates,return=minimal'})
        if err:
            return err
    return None


def project_ticks(url, key, target, payload, state, now, counts):
    """bet365 cards only: the archived payload -> bet365_mw_ticks."""
    if not target['bet365Card']:
        counts['ticksNotBet365Card'] += 1
        return
    if target['orient'] is None:
        counts['ticksOrientUnknown'] += 1
        return
    rows = tick_rows(mw_ticks(payload), target)
    err = load_ticks(url, key, rows) if rows else None
    if err:
        counts['ticksLoadFailed'] += 1
        print(f'::warning::{TICKS_TABLE} load failed for {target["cardKey"]}: {err[0]}')
        return
    counts['ticksCards'] += 1
    counts['ticksRows'] += len(rows)
    state.setdefault('loaded', {})[target['cardKey']] = {
        'fixtureId': target['fixtureId'], 'at': iso(now), 'rows': len(rows)}


def is_not_found(err):
    """Storage answers a missing object with 404, or 400 carrying statusCode 404."""
    code, text = (err or (None, ''))[:2]
    if code == 404:
        return True
    if code != 400:
        return False
    try:
        body = json.loads(text)
    except (TypeError, ValueError):
        return False
    return isinstance(body, dict) and str(body.get('statusCode')) == '404' \
        and 'bucket' not in str(body.get('message') or body.get('error') or '').lower()


def read_state(url, key):
    """The state object, {} when there is none yet, None when it cannot be read.
    Only a not-found means "no state": any other failure must not be read as an
    empty state, because the run would then overwrite the real one."""
    got, err = sb_download(url, key, PM_STATE_KEY)
    if got is None:
        return {} if is_not_found(err) else None
    st = payload_of(got)
    return st if isinstance(st, dict) else None


def prune_state(state, now):
    def fresh(ts, days):
        d = parse_iso(ts)
        return bool(d and now - d <= timedelta(days=days))
    state['seen'] = {k: v for k, v in (state.get('seen') or {}).items()
                     if fresh(v, PM_SEEN_KEEP_DAYS)}
    state['loaded'] = {k: v for k, v in (state.get('loaded') or {}).items()
                       if fresh((v or {}).get('at'), PM_LOADED_KEEP_DAYS)}
    state['held'] = {k: v for k, v in (state.get('held') or {}).items()
                     if fresh((v or {}).get('at'), PM_LOADED_KEEP_DAYS)}
    return state


def put_json(url, key, path, obj):
    return sb_upload(url, key, path, json.dumps(obj, indent=1, sort_keys=True).encode('utf-8'),
                     encoding=None)


def postmatch(odds_key, url, sb_key, matches, fmap, ocs):
    """One post-match run. Returns (exit code, heartbeat dict)."""
    CALLS.clear()
    started = _now()
    deadline = started + timedelta(seconds=PM_MAX_RUN_S)
    counts = collections.Counter()
    state = read_state(url, sb_key)
    if state is None:
        # Not "no state yet": the state exists and could not be read. Writing
        # now would replace it (first sightings, 404 record) with an empty one.
        print('::warning::post-match state unreadable (not a not-found) — stopping '
              'without writing anything; the next run retries.')
        return 1, {'stoppedBy': 'state-unreadable'}
    nf = state.setdefault('notFound', {})
    deferred = state.setdefault('deferred', {})
    loaded = state.setdefault('loaded', {})
    held_rec = state.setdefault('held', {})
    targets = select_targets(matches, fmap, ocs, state, started, counts)

    def project_from_bucket(t, path, when):
        got, _ = sb_download(url, sb_key, path)
        payload = payload_of(got)
        if payload is None:
            counts['heldUnreadable'] += 1
            return
        project_ticks(url, sb_key, t, payload, state, when, counts)

    # Pass 1 — bucket only, no oddspapi call: skip what is held, project the
    # ticks of held bet365 cards not yet in the table, collect the pull list.
    months = False                      # listed lazily, once per run
    pulls = []
    for t in targets:
        if (loaded.get(t['cardKey']) or {}).get('fixtureId') == t['fixtureId']:
            counts['alreadyLoaded'] += 1
            continue
        known = held_rec.get(t['fixtureId']) or {}
        if known.get('path'):
            held = known['path']        # recorded on an earlier run: no listing
            counts['heldFromState'] += 1
        else:
            if months is False:
                months = bucket_months(url, sb_key)
            held = held_path(url, sb_key, t['fixtureId'], months)
        if held is None:
            counts['heldUnknown'] += 1
            continue
        if held:
            counts['held'] += 1
            held_rec[t['fixtureId']] = {'path': held, 'cardKey': t['cardKey'], 'at': iso(started)}
            if t['bet365Card'] and t['orient']:
                project_from_bucket(t, held, started)
            continue
        if t['seenAgeMin'] < PM_WAIT_MIN:
            counts['waiting'] += 1
            continue
        if int(deferred.get(t['fixtureId']) or 0) >= PM_MAX_DEFER:
            counts['deferCapped'] += 1
            continue
        pulls.append(t)

    # Pass 2 — the key: inside the window, and only once the loop's iteration
    # is over (checked before the first call and again before every call).
    before = after = None
    stop = None
    if pulls and wait_for_window(deadline) and key_is_ours(deadline, counts):
        before, _ = meter(odds_key, 'before postmatch pulls', get=free_get)
    elif pulls:
        stop = 'window-or-loop'
    n = 0
    for t in pulls:
        if stop:
            counts['notTried'] += 1
            continue
        if n:
            _sleep(HIST_SLEEP)
        if not key_is_ours(deadline, counts):
            stop = 'window-or-loop'
            counts['notTried'] += 1
            continue
        n += 1
        fid = t['fixtureId']
        body, err = postmatch_hist(fid, odds_key, counts)
        if err == 429:
            stop = '429'
            counts['stoppedOn429'] += 1
            print(f'429 on {fid} — the live loop has the key; stopping, next run resumes.')
            continue
        if err == 404:
            r = nf.setdefault(fid, {'n': 0, 'first': iso(_now()), 'eventKey': t['eventKey']})
            r['n'] = int(r.get('n') or 0) + 1
            r['last'] = iso(_now())
            counts['http404'] += 1
            continue
        if body is None:
            counts['failed'] += 1
            counts[f'error-{err}'] += 1
            continue
        payload = payload_of(body)
        if payload is None:
            counts['failed'] += 1
            counts['unparseable'] += 1
            continue
        ticks = mw_ticks(payload)
        if ticks is not None and not market_closed(ticks):
            deferred[fid] = int(deferred.get(fid) or 0) + 1
            counts['deferredOpenMarket'] += 1
            continue
        if ticks is None:
            counts['noBet365Market'] += 1
        path = object_path({'fixtureId': fid, 'startTime': t['startTime'],
                            'trueStartTime': None})
        up = sb_upload(url, sb_key, path, gzip.compress(body, 6), upsert=False)
        duplicate = bool(up) and up[0] in (400, 409) and ('uplicate' in str(up[1]) or 'exists' in str(up[1]))
        if up and not duplicate:
            counts['failed'] += 1
            counts[f'upload-{up[0]}'] += 1
            continue                      # failed: the defer / 404 records stay
        deferred.pop(fid, None)
        nf.pop(fid, None)
        if duplicate:
            # Another writer got there first: the HELD object is the record, so
            # the ticks come from it, never from this unsaved pull.
            counts['alreadyHeld'] += 1
            held_rec[fid] = {'path': path, 'cardKey': t['cardKey'], 'at': iso(_now())}
            if t['bet365Card'] and t['orient']:
                project_from_bucket(t, path, _now())
            continue
        counts['saved'] += 1
        held_rec[fid] = {'path': path, 'cardKey': t['cardKey'], 'at': iso(_now())}
        project_ticks(url, sb_key, t, payload, state, _now(), counts)

    if before is not None and can_call(_now()) and loop_idle(_now())[0]:
        after, _ = meter(odds_key, 'after postmatch pulls', get=free_get)
    elif before is not None:
        print('meter after: not read — the window closed or the loop is running; '
              'the meter delta for this run is unknown (—).')
    delta = (after - before) if (before is not None and after is not None) else None
    if delta:
        print(f'::warning::the oddspapi meter moved by {delta} during this run. This job '
              f'called only {sorted(CALLS)} (free_get refuses anything else), so the '
              f'units belong to a concurrent job.')
    finished = _now()
    beat = {'startedAt': iso(started), 'finishedAt': iso(finished),
            'targets': len(targets), 'pullCandidates': len(pulls), 'pulled': n,
            'stoppedBy': stop, 'counts': dict(counts), 'http429': counts['http429'],
            'oddspapiCalls': dict(CALLS), 'meterBefore': before, 'meterAfter': after,
            'meterDelta': delta, 'waitMin': PM_WAIT_MIN, 'window': list(PM_WINDOW)}
    for path, obj in ((PM_STATE_KEY, prune_state(state, finished)), (PM_HEARTBEAT_KEY, beat)):
        err = put_json(url, sb_key, path, obj)
        if err:
            print(f'::warning::could not write {path}: {err[0]}')
    print('\n=== POSTMATCH RUN ===')
    print(json.dumps(beat, indent=1, sort_keys=True))
    return (1 if counts['failed'] and not counts['saved'] else 0), beat


def fetch_site_json(name, timeout=30):
    req = urllib.request.Request(SITE + name, headers={'User-Agent': 'BSP-Consult-Dashboard/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode('utf-8'))
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        print(f'::warning::live {name} unreadable ({e}); using the checkout copy only.')
        return None


def load_local_json(name):
    try:
        with open(os.path.join(HERE, name), encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def postmatch_main(odds_key):
    url, sb_key = supabase_creds()
    # The live board is the page members see; the checkout's copy is at most one
    # capture tick behind it and still holds cards the live board has dropped.
    matches = merge_boards(fetch_site_json('matches.json'), load_local_json('matches.json'))
    fmap = load_local_json('odds-fixture-map.json')
    ocs = fetch_site_json('odds-card-state.json') or load_local_json('odds-card-state.json')
    if not matches or not fmap:
        die('no board or no fixture map — nothing to target.')
    code, _ = postmatch(odds_key, url, sb_key, matches, fmap, ocs)
    return code


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['discover', 'archive', 'report', 'postmatch'])
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
    if a.cmd == 'postmatch':
        return postmatch_main(key)
    return archive(key, a.max_seconds)


if __name__ == '__main__':
    sys.exit(main())
