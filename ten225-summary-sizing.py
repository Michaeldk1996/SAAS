#!/usr/bin/env python3
"""SUPERSEDED — do not run phase B. Use ten225-density-from-bucket.py instead.

Phase A (the /v4/fixtures level sweep) was replaced by ten225-fixture-index.py,
which caches the same sweep to disk so it is not re-spent.

Phase B (density via direct /v4/historical-odds calls) is the reason this file
is superseded: it shares the rate-limited key with the raw-archive job and
LOSES to it. Measured 2026-09-17 while archive run 35194415114 was pulling:
3 fixtures in 9 minutes, all the rest of the time in 429 backoff — and every
one of those retries stole throughput from the one job racing irreversible
data loss (oddspapi prunes the pre-start tail within weeks). Running it again
would cost real, unrecoverable series to re-measure something that is now free.

ten225-density-from-bucket.py counts the same thing from payloads the archive
has already written to object storage: zero odds-API calls, no contention, and
n grows on its own every archive run.

Kept only because its docstring records how the grain maps onto the payload.

TEN-225 — size the SUMMARY table Michael ruled for on 2026-09-17T07:33Z.

His ruling replaced the per-tick load with a collapsed table:

  "Do NOT load every pre-start tick into Postgres. Instead create a summary
   table, e.g. oddspapi_line_summary - one row per fixture + book + market +
   side + line: open_price, open_ts, close_price, close_ts, close_lag_minutes,
   pre_start_tick_count, first_tick_ts, last_pre_start_tick_ts, source
   (oddspapi-raw | bet365-history), close_reliable (bool).
   Markets: match winner, games handicap, total games, set betting.
   Levels: all (ATP, Slams, Challenger, ITF, Davis Cup).
   Full tick series stays in the raw bucket only.
   Before loading: project rows per fixture and GB per year for this table.
   Stop and report only if it passes 25% of the 8 GB database per year."

WHY THE EARLIER PROJECTION CANNOT BE REUSED
-------------------------------------------
The A.2 projection (doc `decay-and-scope`, 7.97 GB/yr for four families at all
levels) counted one row per TICK. This table is one row per SERIES, and carries
`pre_start_tick_count` precisely because the ticks are collapsed into it. The
row count is therefore a different quantity and has to be measured, not scaled:
a series holding 40 ticks contributes 40 rows to the old shape and 1 to this
one, and that ratio is not uniform across market families.

WHAT A "SERIES" IS IN THE PAYLOAD
---------------------------------
`line` is not a field — oddspapi encodes the line IN the marketId (measured on
TEN-225; every market object has exactly one key, `outcomes`). So the founder's
grain fixture + book + market + side + line maps onto the payload as the leaf
tick list at

    bookmakers[book].markets[marketId].outcomes[outcome].players[player]

and one such leaf carrying >= 1 PRE-START tick is exactly one summary row.
Leaves whose only ticks are in-play contribute no row: this table is the Open /
Close serving index and in-play stays in the bucket.

A.2's per-level fixture counts leaned on a tour-scoped cache that holds ZERO
ITF, so ITF was projected off a single 6-day window and was the softest number
in that report. This run re-sweeps /v4/fixtures across the full retention
window, so every level including ITF is counted the same way.

MEASURED, NOT ASSUMED
---------------------
Rows/fixture and fixtures/yr are measured here. Bytes/row is NOT guessed in
this script: it is measured against the real Postgres instance by
`ten225-rowsize-probe.sql` (Actions only — the Supabase service key is a
GitHub secret and is deliberately absent locally). This script emits the row
counts and prints GB/yr for a range of candidate row costs so the two halves
can be joined without either being approximated.

COST
----
/v4/historical-odds is free. /v4/fixtures is metered; the sweep is ~31 units
and the script refuses to start past 80% of request_limit (standing rule).
The raw-archive job may be pulling concurrently — oddspapi rate-limits to
~1 call/5s per key, so 429s are expected and are a RATE limit, not a budget
limit. Backoff is deliberately generous so this probe does not starve that
job, which is the one racing irreversible data loss.

Stdlib only. Secrets are never printed.
"""
import collections
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = 'https://api.oddspapi.io'
SPORT_TENNIS = 12
OUT = os.path.join(HERE, 'ten225-summary-sizing.json')
CATALOGUE = os.path.join(HERE, '.oddspapi-markets.json')

QUOTA_CEILING = 0.80
RETENTION_DAYS = 180
WINDOW_DAYS = 6           # /v4/fixtures 400s past 6 days
FIXTURES_SLEEP = 1.5

HIST_SLEEP = 8.0          # polite second client while the archive job runs
MAX_RETRY = 6
PER_LEVEL = 30            # n >= 30 per level: the standing rule
AGE_LO, AGE_HI = 4.0, 9.0  # undecayed window per the decay measurement
TIME_CAP_S = 5400

DB_GB = 8.0
BUDGET_FRACTION = 0.25    # "25% of the 8 GB database per year"

# Levels that can plausibly carry bet365 odds. UTR / Juniors / Wheelchair 404
# on /v4/historical-odds across the board (19/19 in the item-0 sample).
SAMPLE_LEVELS = ('ATP', 'Challenger', 'ITF Men', 'ITF Women', 'WTA',
                 'WTA 125K', 'Davis Cup')

# The four families Michael named, by catalogue name. Slams are inside
# categoryName "ATP", so they need no separate entry.
KEEP_FAMILIES = {
    'match winner':   'Winner',
    'games handicap': 'Game Handicap',
    'total games':    'Total Games Over Under',
    'set betting':    'Correct Score',
}
NAME_TO_FAMILY = {v: k for k, v in KEEP_FAMILIES.items()}


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
    except Exception as e:                      # noqa: BLE001 - reported, not raised
        return None, str(e)


def hist_get(fid, key):
    """Free call. A 429 is the shared rate limit with the archive job."""
    for attempt in range(MAX_RETRY):
        d, err = api_get('/v4/historical-odds', {'fixtureId': fid}, key)
        if err == 429:
            time.sleep(HIST_SLEEP * (attempt + 2))
            continue
        return d, err
    return None, 429


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
    u, l = s.get('request_count'), s.get('request_limit')
    books = ', '.join(sorted((s.get('bookmakers') or {}).keys())) or 'none'
    print(f'  oddspapi meter {when}: {u}/{l} ({s.get("plan")}; books: {books})')
    return u, l


def epoch(ts):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).replace('Z', '+00:00')).timestamp()
    except (ValueError, TypeError):
        return None


def catalogue():
    """marketId -> market name. The payload carries no names, only ids."""
    if not os.path.exists(CATALOGUE):
        print('::error::markets catalogue missing; run the scope probe first.')
        sys.exit(1)
    cat = json.load(open(CATALOGUE))
    print(f'  markets catalogue: {len(cat)} ids (cached, 0 metered units)')
    return cat


def sweep(key):
    """Full-retention /v4/fixtures sweep: the level mix AND the sample pool.

    All levels, no hasOdds filter. Synthetic categories (Simulated / Srl) are
    excluded everywhere, here and in the projection."""
    need = (RETENTION_DAYS // WINDOW_DAYS) + 2
    used, limit = meter(key, 'before the sweep')
    if used is None or not limit:
        print('::error::refusing to spend metered units without a meter read.')
        sys.exit(1)
    ceiling = int(limit * QUOTA_CEILING)
    if used + need > ceiling:
        print(f'::error::sweep needs ~{need} units; {used}/{limit} used, '
              f'80% ceiling {ceiling}. Not starting.')
        sys.exit(1)

    now = datetime.now(timezone.utc)
    cur = now - timedelta(days=RETENTION_DAYS)
    mix, pool, seen, units, errs = collections.Counter(), collections.defaultdict(list), set(), 0, 0
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
            fresh = 0
            for f in rows:
                fid = f.get('fixtureId')
                cat = f.get('categoryName') or 'unknown'
                if not fid or fid in seen:
                    continue
                if 'Simulated' in cat or 'Srl' in cat:
                    continue
                seen.add(fid)
                mix[cat] += 1
                fresh += 1
                st = epoch(f.get('trueStartTime')) or epoch(f.get('startTime'))
                if st is None:
                    continue
                age = (now.timestamp() - st) / 86400.0
                if AGE_LO <= age <= AGE_HI:
                    pool[cat].append({'fid': fid, 'start': st,
                                      'tourn': f.get('tournamentName')})
            print(f'  {cur:%Y-%m-%d}..{end:%Y-%m-%d}: {len(rows):5d} rows, {fresh:5d} new')
        cur = end
        time.sleep(FIXTURES_SLEEP)

    span_days = RETENTION_DAYS
    print(f'\n  {sum(mix.values())} non-synthetic tennis fixtures over {span_days}d '
          f'({units} metered units, {errs} slice errors)')
    for k, v in mix.most_common(20):
        print(f'    {k:<28} {v:>7}  ({v/span_days:>7.2f}/day -> {v/span_days*365:>8.0f}/yr)')
    meter(key, 'after the sweep')
    return mix, pool, span_days, units, errs


def series_of(payload, start_ts, names):
    """Collapse one payload into summary ROWS at Michael's grain.

    Returns per-family counts of leaves with >= 1 pre-start tick, the pre-start
    tick total, and the books seen."""
    out = collections.Counter()
    ticks = collections.Counter()
    books = set()
    inplay_only = 0
    for book, blk in ((payload or {}).get('bookmakers') or {}).items():
        if not isinstance(blk, dict):
            continue
        books.add(book)
        for mid, m in (blk.get('markets') or {}).items():
            if not isinstance(m, dict):
                continue
            fam = NAME_TO_FAMILY.get(names.get(str(mid), ''))
            if fam is None:
                continue
            for oc in (m.get('outcomes') or {}).values():
                for plist in ((oc or {}).get('players') or {}).values():
                    pre = 0
                    any_tick = False
                    for p in (plist or []):
                        t = epoch(p.get('createdAt'))
                        if t is None or p.get('price') is None:
                            continue
                        any_tick = True
                        if t <= start_ts:
                            pre += 1
                    if pre:
                        out[fam] += 1          # one summary row
                        ticks[fam] += pre
                    elif any_tick:
                        inplay_only += 1
    return out, ticks, books, inplay_only


def main():
    key = read_key()
    if not key:
        print('::error::ODDSPAPI_KEY is not set.')
        return 1
    t0 = time.time()
    now = datetime.now(timezone.utc)
    result = {'generatedAt': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
              'grain': 'fixture+book+market+side+line, >=1 pre-start tick',
              'families': list(KEEP_FAMILIES)}

    print('=== A. level mix + sample pool: /v4/fixtures, full 180d retention, all levels ===')
    mix, pool, span_days, units, errs = sweep(key)
    result['levelMix'] = dict(mix)
    result['spanDays'] = span_days
    result['sweepUnits'] = units
    result['sweepErrors'] = errs
    if errs:
        print(f'::warning::{errs} slice(s) failed — the level mix is INCOMPLETE '
              f'and the per-year projection is a LOWER bound.')

    print(f'\n=== B. summary rows per fixture, {PER_LEVEL}/level, fixtures aged '
          f'{AGE_LO:.0f}-{AGE_HI:.0f}d (free calls) ===')
    names = catalogue()
    per_level, skipped, calls, books_all = {}, collections.Counter(), 0, set()
    for cat in sorted([c for c in pool if c in SAMPLE_LEVELS], key=lambda c: -mix[c]):
        cands = sorted(pool[cat], key=lambda r: str(r['fid']))
        step = max(1, len(cands) // PER_LEVEL)
        picks = cands[::step][:PER_LEVEL]
        rows = []
        for fx in picks:
            if time.time() - t0 > TIME_CAP_S:
                print('::warning::time cap hit — remaining levels not sampled.')
                break
            d, e = hist_get(fx['fid'], key)
            calls += 1
            time.sleep(HIST_SLEEP)
            if d is None:
                skipped[f'{cat}:http-{e}'] += 1
                continue
            fam, tk, books, ip_only = series_of(d, fx['start'], names)
            books_all |= books
            total = sum(fam.values())
            if total == 0:
                skipped[f'{cat}:no-keeplist-prestart'] += 1
                continue
            rows.append({'fid': fx['fid'], 'tourn': fx['tourn'],
                         'rows': total, 'byFamily': dict(fam),
                         'preTicks': sum(tk.values()),
                         'inplayOnlyLeaves': ip_only})
            print(f'  {cat:<12} {fx["fid"]} rows={total:>4} '
                  f'(mw={fam["match winner"]:>3} gh={fam["games handicap"]:>3} '
                  f'tg={fam["total games"]:>3} sb={fam["set betting"]:>3}) '
                  f'preTicks={sum(tk.values()):>5}', flush=True)
        if rows:
            r = [x['rows'] for x in rows]
            per_level[cat] = {
                'n': len(rows),
                'median_rows': statistics.median(r),
                'mean_rows': sum(r) / len(r),
                'min_rows': min(r), 'max_rows': max(r),
                'median_mw_rows': statistics.median(
                    [x['byFamily'].get('match winner', 0) for x in rows]),
                'median_preTicks': statistics.median([x['preTicks'] for x in rows]),
                'poolSize': len(cands),
                'rowsDetail': rows,
            }
            json.dump(result | {'perLevel': per_level, 'skipped': dict(skipped),
                                'histCalls': calls, 'booksSeen': sorted(books_all)},
                      open(OUT, 'w'), indent=1)
    result['perLevel'] = per_level
    result['skipped'] = dict(skipped)
    result['histCalls'] = calls
    result['booksSeen'] = sorted(books_all)

    print('\n  per level (summary ROWS per fixture, four families, pre-start only):')
    for cat, v in sorted(per_level.items(), key=lambda kv: -mix[kv[0]]):
        flag = '  <-- n<30' if v['n'] < 30 else ''
        print(f'    {cat:<12} n={v["n"]:<3} median rows={v["median_rows"]:>6.1f} '
              f'(min {v["min_rows"]}, max {v["max_rows"]}) '
              f'mw-only={v["median_mw_rows"]:>5.1f} '
              f'median preTicks={v["median_preTicks"]:>6.0f} '
              f'collapse={v["median_preTicks"]/max(v["median_rows"],1):>5.1f}x{flag}')

    print('\n=== C. rows per year — measured counts, row cost joined separately ===')
    line_gb = DB_GB * BUDGET_FRACTION
    rows_yr_all = rows_yr_mw = 0.0
    covered, uncovered = [], []
    for cat, n in mix.most_common():
        fx_yr = n / span_days * 365.0
        v = per_level.get(cat)
        if not v:
            uncovered.append((cat, fx_yr))
            continue
        covered.append((cat, fx_yr, v))
        rows_yr_all += fx_yr * v['median_rows']
        rows_yr_mw += fx_yr * v['median_mw_rows']
    print(f'  {"level":<12} {"fixtures/yr":>12} {"rows/fx":>9} {"rows/yr (4 fam)":>17} '
          f'{"rows/yr (mw only)":>19}')
    for cat, fx_yr, v in covered:
        print(f'  {cat:<12} {fx_yr:>12.0f} {v["median_rows"]:>9.1f} '
              f'{fx_yr*v["median_rows"]:>17,.0f} {fx_yr*v["median_mw_rows"]:>19,.0f}')
    if uncovered:
        print('\n  levels counted in the mix but NOT sampled for density '
              '(excluded from the projection, so it is a LOWER bound):')
        for cat, fx_yr in uncovered:
            print(f'    {cat:<28} {fx_yr:>9.0f} fixtures/yr')
    result['rowsPerYear'] = {'fourFamilies': rows_yr_all, 'matchWinnerOnly': rows_yr_mw}
    result['uncoveredLevels'] = [{'level': c, 'fixturesPerYear': f} for c, f in uncovered]
    result['lineGB'] = line_gb

    print(f'\n  TOTAL rows/yr, four families : {rows_yr_all:>14,.0f}')
    print(f'  TOTAL rows/yr, match winner  : {rows_yr_mw:>14,.0f}')
    print(f'\n  GB/yr against candidate row costs (line = {line_gb:.2f} GB/yr):')
    print(f'  {"B/row":>8} {"4 families":>12} {"":>4} {"mw only":>10}')
    for b in (200, 300, 377.7, 450, 600, 800):
        g4 = rows_yr_all * b / 1e9
        gm = rows_yr_mw * b / 1e9
        print(f'  {b:>8} {g4:>12.3f} {"OVER" if g4 > line_gb else "ok":>4} '
              f'{gm:>10.3f} {"OVER" if gm > line_gb else "ok"}')
    print('\n  Row cost is MEASURED separately against the real instance by '
          'ten225-rowsize-probe.sql; no figure above is the answer on its own.')

    json.dump(result, open(OUT, 'w'), indent=1)
    print(f'\nwrote {OUT}  ({calls} free historical-odds calls, '
          f'{units} metered units, {time.time()-t0:.0f}s)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
