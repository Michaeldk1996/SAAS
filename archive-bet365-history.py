#!/usr/bin/env python3
"""Bet365 historical-odds archive — per-month shards, reduced series.

TEN-179 item 1. Built to the founder's ruling on gate 2334e509 (2026-09-10):

  q1 -> o1  Structure B, REDUCED: per-month shards, open + close + 22 points.
  q2 -> a1  Run the FULL backfill across the whole retention window, accepting
            that everything older than ~4 weeks comes back as thin residue.
  q3 -> b1  Keep the export's BIGGEST MARKET MOVE heading (no code here).

WHAT THIS IS NOT
----------------
This is a NEW, additive dataset. It does not touch, blend with, or supersede:
  * odds-archive/*.csv      — the Pinnacle 2010-2025 archive on the Database page
  * odds/{eventKey}.json    — the per-match lazy shards the Odds tab reads
  * matches.json            — owned by refresh-odds-history.py
Nothing on the board reads bet365-history/ today. It is written here, published
to Pages on demand, and read by a later change. It is deliberately kept off every
startup path: no index is fetched at boot, so it cannot regress the payload
budget that matches.json already dominates.

WHY REDUCED, AND WHY WE NEVER RE-PULL
-------------------------------------
Measured 2026-09-10 over 90 fixtures / 6 windows / 3 tiers: oddspapi keeps the
dense ~3-minute series only ~4 weeks, then prunes to a thin open/close residue —
a ~20x drop in stored bytes. The dense data for older fixtures is ALREADY GONE on
their side and cannot be recovered. Two consequences drive this design:

  1. Archive eagerly. A fixture captured today is the best copy that will ever
     exist; next month's copy is strictly worse.
  2. NEVER re-pull a fixture we already hold. A re-pull can only downgrade it.
     The shard itself is therefore the checkpoint — there is no separate state
     file that can drift out of sync with what we actually have on disk.

COST
----
/v4/historical-odds is FREE and does not increment the meter — re-verified this
run, 100 -> 100 across ~20 calls including several 429s, so even its rate-limit
rejections are unbilled. The only metered call is /v4/fixtures discovery, ~30
units for a full sweep. The binding constraint is not quota, it is PACING.

Measured 2026-09-10, not assumed:
  * There is NO market filter. markets= / marketIds= / market= are all ignored
    and the full ~1-4.5 MB, 119-market payload ships every time. Wall time per
    call is therefore transfer-bound (3.8-7.6s observed), not sleep-bound.
  * The limit is ~1 successful call per ~5s. Eight zero-sleep sequential calls
    returned 200,429,429,429,200,429,429,429.
  * CONCURRENCY DOES NOT HELP: 4 parallel calls returned one 200 and three 429s.
    Do not "optimise" this with a thread pool; it buys nothing and wastes calls.
So HIST_SLEEP stays at 5.5s and the full scope really is ~20+ hours of pacing.
That is why backfill is resumable and time-budgeted rather than one long run.

USAGE
-----
  python3 archive-bet365-history.py discover            # ~30 metered units
  python3 archive-bet365-history.py backfill --max-seconds 18000
  python3 archive-bet365-history.py nightly             # ~1-2 metered units
  python3 archive-bet365-history.py verify              # no network, no quota

Stdlib only. Reads ODDSPAPI_KEY from .env or the environment.
"""

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
OUT_DIR = os.path.join(HERE, 'bet365-history')
INDEX = os.path.join(OUT_DIR, 'index.json')
# The discovery cache lives OUTSIDE the published directory on purpose: the
# pipeline copies bet365-history/ wholesale into _site, and `cp -r` takes
# dotfiles with it. Keeping it at the repo root means the shards directory
# contains only things we are happy to serve.
TARGETS = os.path.join(HERE, '.bet365-history-targets.json.gz')

BASE = 'https://api.oddspapi.io'
SPORT_TENNIS = 12
MARKET_WINNER = '121'
OUTCOME_P1, OUTCOME_P2 = '121', '122'     # 121 = participant1, 122 = participant2
BOOK = 'bet365'                            # the ONLY entitled book; see note below

# A batch containing any non-entitled book 403s IN FULL, entitled books included
# (measured on TEN-180). Never widen this tuple without re-checking /v4/account.

HIST_SLEEP = 5.5          # ~1 call / 5s, measured; concurrency does not help
MAX_RETRY = 4
FIXTURES_SLEEP = 2.5      # /v4/fixtures is metered; pace it so a sweep can't 429

# Discovery window. oddspapi retention measured at ~176 days (2026-03-17/03-20).
# /v4/fixtures rejects a range >= 14 days (14d and 30d both 400), so sweep in
# 6-day windows — that is what the 30-unit figure is built from.
WINDOW_DAYS = 6
RETENTION_DAYS = 180

# Tiers we archive. ITF / UTR / Simulated Reality are excluded: Simulated Reality
# is synthetic junk, and ITF/UTR are outside anything the product prices.
TIERS = ('ATP', 'Challenger', 'WTA')      # 'WTA 125K' matched by prefix below

# Reduction: open + close + 22 interior points = 24 stored points per player.
KEEP_POINTS = 24

# A fixture is only archived once its series can no longer grow. Tennis matches
# effectively never exceed 6h, so a fixture with no trueEndTime is considered
# complete 6h after its start.
COMPLETE_AFTER_H = 6

SCHEMA = 'bet365-history/1'


# ---------------------------------------------------------------- api plumbing

def read_key():
    env = os.path.join(HERE, '.env')
    if os.path.exists(env):
        for line in open(env):
            line = line.strip()
            if line.startswith('ODDSPAPI_KEY='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    return os.environ.get('ODDSPAPI_KEY')


def api_get(path, params, key, timeout=120):
    p = dict(params)
    p['apiKey'] = key
    url = BASE + path + '?' + urllib.parse.urlencode(p)
    req = urllib.request.Request(url, headers={'User-Agent': 'BSP-Consult-Dashboard/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r), None
    except urllib.error.HTTPError as e:
        return None, e.code
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        return None, str(e)


def log_quota(key, when):
    """Print the live meter. /v4/account is itself unmetered, so this is free and
    is the only honest read on consumption."""
    data, err = api_get('/v4/account', {}, key)
    if data is None:
        print(f'WARNING: could not read the oddspapi meter {when} ({err}).', file=sys.stderr)
        return None
    subs = [s for s in (data.get('subscriptions') or []) if s.get('is_active')]
    if not subs:
        print(f'::warning::oddspapi reports NO active subscription {when}.')
        return None
    s = subs[0]
    used, limit = s.get('request_count'), s.get('request_limit')
    books = ', '.join(sorted((s.get('bookmakers') or {}).keys())) or 'none'
    print(f'oddspapi quota {when}: {used}/{limit} used ({s.get("plan")} plan; books: {books}).')
    return used


def hist_get(fixture_id, key):
    """One free /v4/historical-odds call with 429 backoff.

    A 429 here is a RATE limit, not a budget limit, and it does not bill — so
    backing off and retrying is genuinely free. Do not conflate this with the
    REQUEST_LIMIT_EXCEEDED 429 the metered endpoints return."""
    params = {'fixtureId': fixture_id, 'bookmakers': BOOK}
    for attempt in range(MAX_RETRY):
        data, err = api_get('/v4/historical-odds', params, key)
        if err == 429:
            time.sleep(HIST_SLEEP * (attempt + 2))
            continue
        return data, err
    return None, 429


# ------------------------------------------------------------------- time bits

def parse_iso(ts):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).replace('Z', '+00:00'))
    except ValueError:
        return None


def epoch(ts):
    d = parse_iso(ts)
    return int(d.timestamp()) if d else None


def tier_of(fx):
    cat = (fx.get('categoryName') or '').strip()
    if cat in TIERS or cat.startswith('WTA 125'):
        return cat
    return None


def fixture_start(fx):
    """The fixture's real UTC start. trueStartTime is the observed first ball and
    is preferred; startTime is the scheduled slot."""
    return fx.get('trueStartTime') or fx.get('startTime')


def is_complete(fx, now):
    if fx.get('trueEndTime'):
        return True
    st = parse_iso(fixture_start(fx))
    return bool(st and st + timedelta(hours=COMPLETE_AFTER_H) < now)


# ------------------------------------------------------------------- reduction

def compact(points):
    """Raw outcome points -> sorted [[epoch, price]], flat runs collapsed to their
    first and last occurrence. Drops anything without a timestamp or with a price
    <= 1 (an impossible decimal price)."""
    out = []
    for p in points or []:
        ts, pr = p.get('createdAt'), p.get('price')
        try:
            pr = float(pr)
        except (TypeError, ValueError):
            continue
        e = epoch(ts)
        if e is None or not pr or pr <= 1:
            continue
        out.append([e, round(pr, 3)])
    out.sort(key=lambda x: x[0])
    packed = []
    for e, pr in out:
        if len(packed) >= 2 and packed[-1][1] == pr and packed[-2][1] == pr:
            packed[-1] = [e, pr]          # extend the flat run's end
        else:
            packed.append([e, pr])
    return packed


def reduce_series(series, keep=KEEP_POINTS):
    """Open + close + evenly-spaced interior points, all of them REAL observed
    points. Nothing is interpolated, averaged or synthesised — the standing rule
    is that a missing price is a dash, never a derived value, and that applies
    just as much to a point we chose not to store.

    Spacing is even by INDEX over the compacted series rather than by time: the
    compaction has already stripped long flat runs, so index-even sampling keeps
    the movement structure, while time-even sampling would over-sample the quiet
    stretches that carry no information."""
    if not series:
        return None
    if len(series) <= keep:
        return series
    interior = keep - 2
    n = len(series)
    idx = {0, n - 1}
    for i in range(interior):
        idx.add(1 + round(i * (n - 3) / max(interior - 1, 1)))
    return [series[i] for i in sorted(idx)]


def build_entry(payload, fx):
    """One archive entry from a historical-odds payload, or (None, reason).

    The close is pinned to the last point AT OR BEFORE the fixture start. That is
    the TEN-124 ruling — an in-play price is never a closing price — and this is
    the reliable version of it, because the fixture record hands us a real UTC
    start rather than the tick-cadence proxy that silently pinned an in-play
    1.062 as Zverev-Darderi's close."""
    blk = ((payload or {}).get('bookmakers') or {}).get(BOOK)
    if not isinstance(blk, dict):
        return None, 'no-bet365-block'
    mkt = (blk.get('markets') or {}).get(MARKET_WINNER)
    if not isinstance(mkt, dict):
        return None, 'no-market-121'
    outs = mkt.get('outcomes') or {}

    def raw(oc):
        return (((outs.get(oc) or {}).get('players') or {}).get('0')) or []

    s1, s2 = compact(raw(OUTCOME_P1)), compact(raw(OUTCOME_P2))
    if not s1 and not s2:
        return None, 'empty-series'

    start = epoch(fixture_start(fx))
    if start is None:
        return None, 'no-start-time'

    pre1 = [p for p in s1 if p[0] <= start]
    pre2 = [p for p in s2 if p[0] <= start]
    if not pre1 and not pre2:
        # Market posted only after the first ball: there is no pre-match journey
        # to archive. Recorded as a miss so it is visible, not silently dropped.
        return None, 'no-prematch-points'

    dropped = (len(s1) - len(pre1)) + (len(s2) - len(pre2))
    entry = {
        'start': start,
        'cat': tier_of(fx) or (fx.get('categoryName') or ''),
        'tour': fx.get('tournamentName') or '',
        'p1': fx.get('participant1Name') or '',
        'p2': fx.get('participant2Name') or '',
        'n1': len(pre1),                 # true pre-start point counts BEFORE
        'n2': len(pre2),                 # reduction, so thin coverage stays visible
        'inplay': dropped,
        's1': reduce_series(pre1),
        's2': reduce_series(pre2),
    }
    return entry, None


# ---------------------------------------------------------------------- shards

def shard_path(month):
    return os.path.join(OUT_DIR, f'{month}.json')


def load_shard(month):
    p = shard_path(month)
    if not os.path.exists(p):
        return {'schema': SCHEMA, 'month': month, 'book': BOOK,
                'market': MARKET_WINNER, 'fixtures': {}, 'misses': {}}
    with open(p) as fh:
        s = json.load(fh)
    s.setdefault('fixtures', {})
    s.setdefault('misses', {})
    return s


def save_shard(month, shard):
    os.makedirs(OUT_DIR, exist_ok=True)
    shard['generatedAt'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    shard['count'] = len(shard['fixtures'])
    with open(shard_path(month), 'w') as fh:
        json.dump(shard, fh, separators=(',', ':'), ensure_ascii=False, sort_keys=True)


def month_of(fx):
    st = parse_iso(fixture_start(fx))
    return st.strftime('%Y-%m') if st else None


def known_ids():
    """Every fixtureId already resolved — archived OR recorded as a miss. This IS
    the resume checkpoint: it is read back off the shards themselves, so it can
    never drift from what we actually hold the way a side-car state file would."""
    seen = set()
    if not os.path.isdir(OUT_DIR):
        return seen
    for fn in sorted(os.listdir(OUT_DIR)):
        if not fn.endswith('.json') or fn == 'index.json':
            continue
        try:
            with open(os.path.join(OUT_DIR, fn)) as fh:
                s = json.load(fh)
        except (json.JSONDecodeError, OSError):
            continue
        seen.update(s.get('fixtures') or {})
        seen.update(s.get('misses') or {})
    return seen


def write_index():
    """Manifest of what exists. Deliberately small and NOT fetched at startup —
    a reader asks for it only when it actually wants the archive."""
    months, tot, miss, pts = [], 0, 0, 0
    for fn in sorted(os.listdir(OUT_DIR)):
        if not fn.endswith('.json') or fn in ('index.json',):
            continue
        with open(os.path.join(OUT_DIR, fn)) as fh:
            s = json.load(fh)
        f = s.get('fixtures') or {}
        m = s.get('misses') or {}
        p = sum(len(e.get('s1') or []) + len(e.get('s2') or []) for e in f.values())
        months.append({'month': s.get('month') or fn[:-5], 'fixtures': len(f),
                       'misses': len(m), 'points': p,
                       'bytes': os.path.getsize(os.path.join(OUT_DIR, fn))})
        tot += len(f)
        miss += len(m)
        pts += p
    idx = {
        'schema': SCHEMA,
        'book': BOOK,
        'market': MARKET_WINNER,
        'note': ('Reduced bet365 match-winner series: open + close + 22 interior '
                 'points, all real observed points, never interpolated. Timestamps '
                 'are epoch SECONDS (UTC). Close is pinned to the last point at or '
                 'before the fixture start — never an in-play price. n1/n2 are the '
                 'true pre-start point counts before reduction.'),
        'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'fixtures': tot,
        'misses': miss,
        'points': pts,
        'coverage': round(tot / (tot + miss), 4) if (tot + miss) else None,
        'months': months,
    }
    with open(INDEX, 'w') as fh:
        json.dump(idx, fh, indent=1, ensure_ascii=False)
    return idx


# ------------------------------------------------------------------- discovery

def discover(key, days=RETENTION_DAYS, cache=True):
    """Sweep /v4/fixtures across the retention window in 6-day slices.

    METERED: one unit per slice, ~30 for a full sweep. The result is cached so a
    resumed backfill chunk does not re-spend it.

    `cache=False` is what the nightly run uses. The nightly only sweeps the last
    few days, and writing THAT over the cache would silently replace the full
    backfill target list with a 4-day one — the backlog would then look finished
    while most of the window had never been pulled. The cache belongs to the
    backfill; the nightly just borrows the function."""
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)
    out, units, errs = {}, 0, 0
    cur = start
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
            kept = 0
            for f in rows:
                if not tier_of(f):
                    continue
                fid = f.get('fixtureId')
                if fid and fid not in out:
                    out[fid] = {k: f.get(k) for k in (
                        'fixtureId', 'startTime', 'trueStartTime', 'trueEndTime',
                        'categoryName', 'tournamentName',
                        'participant1Name', 'participant2Name')}
                    kept += 1
            print(f'  {cur:%Y-%m-%d}..{end:%Y-%m-%d}: {len(rows):5d} fixtures, {kept:4d} in scope')
        cur = end
        time.sleep(FIXTURES_SLEEP)

    if errs:
        print(f'::warning::{errs} of {units} discovery slices failed — the target '
              f'list is INCOMPLETE. Re-run discover to fill the gaps.')
    os.makedirs(OUT_DIR, exist_ok=True)
    if cache:
        # Never cache a partial sweep: a target list with holes in it would make
        # the backfill report "done" over fixtures it never saw.
        if errs:
            print('::warning::Not caching this target list — the sweep had '
                  'errors and would make the backfill look complete early.')
        else:
            with gzip.open(TARGETS, 'wt', encoding='utf-8') as fh:
                json.dump({'generatedAt': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
                           'days': days, 'units': units, 'errors': errs,
                           'fixtures': list(out.values())}, fh)
    print(f'\nDiscovered {len(out)} in-scope fixtures over {days} days '
          f'({units} metered unit(s), {errs} slice error(s)).')
    return list(out.values())


def load_targets():
    if not os.path.exists(TARGETS):
        return None
    with gzip.open(TARGETS, 'rt', encoding='utf-8') as fh:
        return json.load(fh).get('fixtures') or []


# -------------------------------------------------------------------- archiving

def archive(key, targets, max_seconds, label):
    """Pull + reduce + store, oldest first, stopping cleanly on the time budget.

    Oldest-first is deliberate: the oldest fixtures are closest to falling out of
    the 180-day retention window entirely, so they are the ones we can still lose.
    """
    now = datetime.now(timezone.utc)
    done = known_ids()
    todo = []
    for f in targets:
        fid = f.get('fixtureId')
        if not fid or fid in done:
            continue
        if not is_complete(f, now):
            continue                      # series can still grow; leave it
        if not month_of(f):
            continue
        todo.append(f)
    todo.sort(key=lambda f: fixture_start(f) or '')

    print(f'{label}: {len(targets)} target(s), {len(done)} already resolved, '
          f'{len(todo)} to pull. Budget {max_seconds}s at ~{HIST_SLEEP}s/call '
          f'(~{int(max_seconds // HIST_SLEEP)} calls).')

    t0 = time.time()
    shards, stats = {}, {'ok': 0, 'miss': 0, 'fail': 0, 'calls': 0, 'points': 0}
    reasons = {}
    stopped_early = False

    for f in todo:
        if time.time() - t0 > max_seconds:
            stopped_early = True
            break
        fid = f['fixtureId']
        month = month_of(f)
        if month not in shards:
            shards[month] = load_shard(month)

        time.sleep(HIST_SLEEP)
        stats['calls'] += 1
        data, err = hist_get(fid, key)
        if data is None:
            if err == 404:
                # 404 is oddspapi's "no history for this fixture" — a real,
                # permanent answer, not a failure to reach them. It must be
                # recorded as a MISS, otherwise these fixtures stay unresolved
                # and every future run re-pulls them forever. Measured at 5/56
                # (~9%) on the first live chunk, which matches the 91.1%
                # coverage sampled independently.
                shards[month]['misses'][fid] = 'http-404-no-history'
                stats['miss'] += 1
                reasons['http-404-no-history'] = reasons.get('http-404-no-history', 0) + 1
                continue
            # Any OTHER transport/HTTP failure is NOT a miss — recording it as
            # one would permanently skip a fixture we simply failed to reach.
            # Leave it unresolved so a later run retries it.
            stats['fail'] += 1
            reasons[f'http-{err}'] = reasons.get(f'http-{err}', 0) + 1
            continue

        entry, why = build_entry(data, f)
        if entry is None:
            shards[month]['misses'][fid] = why
            stats['miss'] += 1
            reasons[why] = reasons.get(why, 0) + 1
        else:
            shards[month]['fixtures'][fid] = entry
            stats['ok'] += 1
            stats['points'] += len(entry['s1'] or []) + len(entry['s2'] or [])

        if stats['calls'] % 100 == 0:
            for m, s in shards.items():
                save_shard(m, s)
            el = time.time() - t0
            print(f'  ... {stats["calls"]} calls, {stats["ok"]} archived, '
                  f'{stats["miss"]} miss, {stats["fail"]} fail, {el / 60:.1f} min')

    for m, s in shards.items():
        save_shard(m, s)

    remaining = len(todo) - stats['calls']
    print(f'\n{label} done: {stats["ok"]} archived, {stats["miss"]} miss, '
          f'{stats["fail"]} transport failure(s), {stats["calls"]} call(s), '
          f'{stats["points"]} stored point(s), {(time.time() - t0) / 60:.1f} min.')
    if reasons:
        print('  reasons: ' + ', '.join(f'{k}={v}' for k, v in sorted(reasons.items())))
    if stopped_early:
        print(f'::notice::Time budget reached with ~{remaining} fixture(s) still '
              f'to pull. This is normal — re-run to continue; the shards are the '
              f'checkpoint, so nothing is repeated.')
    return stats, remaining, stopped_early


# ------------------------------------------------------------------------ verify

def verify():
    """Offline integrity + shape check. No network, no quota."""
    if not os.path.isdir(OUT_DIR):
        print('No bet365-history/ directory yet.')
        return 1
    idx = write_index()
    bad = []
    total_bytes = 0
    for m in idx['months']:
        total_bytes += m['bytes']
        with open(shard_path(m['month'])) as fh:
            s = json.load(fh)
        for fid, e in (s.get('fixtures') or {}).items():
            for k in ('s1', 's2'):
                ser = e.get(k)
                if ser is None:
                    continue
                if len(ser) > KEEP_POINTS:
                    bad.append(f'{fid}.{k}: {len(ser)} points > {KEEP_POINTS}')
                ts = [p[0] for p in ser]
                if ts != sorted(ts):
                    bad.append(f'{fid}.{k}: timestamps out of order')
                if any(p[0] > e['start'] for p in ser):
                    bad.append(f'{fid}.{k}: point after fixture start (in-play close)')
                if any(not p[1] or p[1] <= 1 for p in ser):
                    bad.append(f'{fid}.{k}: impossible price <= 1')
    print(f'{idx["fixtures"]} fixture(s), {idx["misses"]} miss(es), '
          f'coverage {idx["coverage"]}, {idx["points"]} point(s), '
          f'{total_bytes / 1e6:.2f} MB raw across {len(idx["months"])} shard(s).')
    for m in idx['months']:
        print(f'  {m["month"]}: {m["fixtures"]:5d} fixtures, {m["misses"]:5d} miss, '
              f'{m["points"]:7d} pts, {m["bytes"] / 1e6:.2f} MB')
    if bad:
        print(f'::error::{len(bad)} integrity problem(s):')
        for b in bad[:20]:
            print('  ' + b)
        return 1
    print('Integrity: OK (point cap, ordering, no in-play close, no impossible price).')
    return 0


# -------------------------------------------------------------------------- main

def main():
    argv = sys.argv[1:]
    cmd = argv[0] if argv else 'verify'

    if cmd == 'verify':
        sys.exit(verify())

    key = read_key()
    if not key:
        print('ERROR: ODDSPAPI_KEY not found (.env or environment).', file=sys.stderr)
        sys.exit(1)

    def opt(name, default):
        return int(argv[argv.index(name) + 1]) if name in argv else default

    before = log_quota(key, 'before run')
    os.makedirs(OUT_DIR, exist_ok=True)

    if cmd == 'discover':
        discover(key, opt('--days', RETENTION_DAYS))

    elif cmd == 'backfill':
        targets = load_targets()
        forced = '--rediscover' in argv
        if targets is None or forced:
            print('Forced re-discovery.' if forced else
                  'No cached target list — running discovery first.')
            targets = discover(key, opt('--days', RETENTION_DAYS))
        stats, remaining, early = archive(
            key, targets, opt('--max-seconds', 18000), 'backfill')
        write_index()
        if early:
            # Signal "more to do" WITHOUT failing the run: a partial chunk is the
            # designed behaviour, and a red run here would be a false alarm that
            # trains everyone to ignore this workflow.
            print(f'::notice::BACKFILL_INCOMPLETE remaining~{remaining}')

    elif cmd == 'nightly':
        # Forward-only. Sweep just the last few days, so the metered cost is 1-2
        # units, and archive whatever has finished since the last run. Fixtures we
        # already hold are skipped by known_ids(), so this never re-pulls.
        targets = discover(key, opt('--days', 4), cache=False)
        archive(key, targets, opt('--max-seconds', 1800), 'nightly')
        write_index()

    else:
        print(__doc__)
        sys.exit(2)

    after = log_quota(key, 'after run')
    if before is not None and after is not None:
        print(f'oddspapi consumption THIS RUN: {after - before} billable unit(s) '
              f'(historical-odds and account reads bill 0). {after}/5000 used to date.')


if __name__ == '__main__':
    main()
