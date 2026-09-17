#!/usr/bin/env python3
"""TEN-225 — rows/fixture and GB/year for oddspapi_line_summary, measured from
the raw bucket. ZERO odds-API calls.

Michael's ruling (2026-09-17T07:33Z):

  "Do NOT load every pre-start tick into Postgres. Instead create a summary
   table, e.g. oddspapi_line_summary - one row per fixture + book + market +
   side + line ... Markets: match winner, games handicap, total games, set
   betting. Levels: all. Full tick series stays in the raw bucket only.
   Before loading: project rows per fixture and GB per year for this table.
   Stop and report only if it passes 25% of the 8 GB database per year."

WHY THE A.2 PROJECTION CANNOT BE REUSED
---------------------------------------
A.2 (doc `decay-and-scope`, 7.97 GB/yr for four families at all levels) counted
one row per TICK. This grain is one row per SERIES, and the table carries
`pre_start_tick_count` precisely because the ticks collapse into it. A series
holding 80 ticks is 80 rows in the old shape and 1 in this one, and that ratio
is not uniform across families. Different quantity, so: measured again.

WHAT A "SERIES" IS IN THE PAYLOAD
---------------------------------
`line` is not a field — oddspapi encodes the line IN the marketId (measured on
TEN-225: every market object has exactly one key, `outcomes`). So the grain
fixture + book + market + side + line maps onto the payload as the leaf tick
list at

    bookmakers[book].markets[marketId].outcomes[outcome].players[player]

and one such leaf carrying >= 1 PRE-START tick is exactly one summary row.
A leaf whose only ticks are in-play contributes NO row: this table is the
Open/Close serving index and in-play stays in the bucket. Leaves are counted,
never estimated from a byte count.

WHY THE BUCKET AND NOT THE API
------------------------------
The first attempt called /v4/historical-odds directly and lost the rate-limit
race against the raw-archive job, which holds the same key: 3 fixtures in 9
minutes on 429 backoff, while slowing the one job racing irreversible data
loss. The archive is already writing these exact payloads to the bucket, so the
measurement is free, contends with nothing, and n GROWS on its own every time
the archive runs. Re-run it whenever a bigger n is wanted.

Levels come from .ten225-fixture-index.json.gz (ten225-fixture-index.py),
because the archived object is the raw payload and carries no fixture metadata.
Level matters: the bucket fills newest-first, so its own level mix is this
fortnight's calendar, not the year's, and the per-year figure has to be
reweighted by the 180-day level mix or ATP is understated ~25x by the
post-US-Open dead week.

Reads SUPABASE_URL / SUPABASE_SECRET_KEY (Actions only — they are deliberately
not in the local .env). Stdlib only. Secrets are never printed.
"""
import collections
import gzip
import io
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
OUT = os.path.join(HERE, 'ten225-density-from-bucket.json')

DB_GB = 8.0
BUDGET_FRACTION = 0.25          # "25% of the 8 GB database per year"
MIN_N = 30                      # standing rule: flag anything below this

# MEASURED on this instance by ten225-rowsize-probe.sql via the Management API,
# run 35196074100 (Postgres 17.6, 2026-09-17):
#   v1, schema exactly as ruled (text book/market/side): 255.9 B/row
#   v2, same information with coded narrow keys        : 163.1 B/row
# TEN-216's 377.7 B/row is NOT reused: it was measured on the per-tick shape,
# and a threshold does not transfer between measurements.
ROW_BYTES = {'v1_text_as_ruled': 255.9, 'v2_coded_narrow': 163.1}

# The four families Michael named, by /v4/markets catalogue name. Slams sit
# inside categoryName "ATP" so they need no separate entry.
KEEP_FAMILIES = {
    'Winner':                 'match winner',
    'Game Handicap':          'games handicap',
    'Total Games Over Under': 'total games',
    'Correct Score':          'set betting',
}

# Levels that 404 on /v4/historical-odds across the board (19/19 in the item-0
# sample). Counted in the fixture universe but they yield no odds and therefore
# no summary rows, so including them in the projection would inflate it.
NO_ODDS_LEVELS = ('UTR Men', 'UTR Women', 'Juniors', 'Wheelchairs',
                  'Wheelchairs Juniors', 'Legends', 'Exhibition')


def creds():
    url = (os.environ.get('SUPABASE_URL') or '').rstrip('/')
    key = os.environ.get('SUPABASE_SECRET_KEY') or ''
    if not url or not key:
        print('::error::SUPABASE_URL / SUPABASE_SECRET_KEY are not both set. '
              'This script runs in Actions, where those secrets live.')
        sys.exit(1)
    return url, key


def sb(method, path, url, key, body=None, headers=None, timeout=180):
    h = {'Authorization': f'Bearer {key}', 'apikey': key}
    h.update(headers or {})
    req = urllib.request.Request(url + path, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read(), None
    except urllib.error.HTTPError as e:
        return None, (e.code, e.read()[:200].decode('utf-8', 'replace'))
    except Exception as e:                      # noqa: BLE001 — reported
        return None, (0, str(e))


def sb_list(url, key, prefix, limit=1000):
    """Storage list is PAGED. A truncated listing would silently shrink n, so
    pages are walked to exhaustion and the caller is told if a page failed."""
    out, offset, ok = [], 0, True
    while True:
        body = json.dumps({'prefix': prefix, 'limit': limit, 'offset': offset,
                           'sortBy': {'column': 'name', 'order': 'asc'}}).encode()
        got, err = sb(
            'POST', f'/storage/v1/object/list/{BUCKET}', url, key, body=body,
            headers={'Content-Type': 'application/json'})
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


def epoch(ts):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).replace('Z', '+00:00')).timestamp()
    except (ValueError, TypeError):
        return None


def summarise(payload, start_ts):
    """One payload -> summary ROWS at Michael's grain, counted per family."""
    rows = collections.Counter()
    ticks = collections.Counter()
    books = set()
    inplay_only = 0
    other_families = collections.Counter()
    for book, blk in ((payload or {}).get('bookmakers') or {}).items():
        if not isinstance(blk, dict):
            continue
        books.add(book)
        for mid, m in (blk.get('markets') or {}).items():
            if not isinstance(m, dict):
                continue
            fam = KEEP_FAMILIES.get(CATALOGUE.get(str(mid), ''))
            if fam is None:
                other_families[CATALOGUE.get(str(mid), f'(id {mid})')] += 1
                continue
            for oc in (m.get('outcomes') or {}).values():
                for plist in ((oc or {}).get('players') or {}).values():
                    pre = any_tick = 0
                    for p in (plist or []):
                        t = epoch(p.get('createdAt'))
                        if t is None or p.get('price') is None:
                            continue
                        any_tick = 1
                        if start_ts is None or t <= start_ts:
                            pre += 1
                    if pre:
                        rows[fam] += 1
                        ticks[fam] += pre
                    elif any_tick:
                        inplay_only += 1
    return rows, ticks, books, inplay_only, other_families


CATALOGUE = {}


def main():
    global CATALOGUE
    cat_path = os.path.join(HERE, '.oddspapi-markets.json')
    if not os.path.exists(cat_path):
        print('::error::.oddspapi-markets.json missing — the payload carries no '
              'market names, only ids, so the keep-list cannot be applied.')
        return 1
    CATALOGUE = json.load(open(cat_path))
    if not os.path.exists(INDEX):
        print(f'::error::{os.path.basename(INDEX)} missing — run '
              f'ten225-fixture-index.py first (it supplies fixtureId -> level).')
        return 1
    with gzip.open(INDEX, 'rt', encoding='utf-8') as fh:
        idx = json.load(fh)
    fx_index = idx['fixtures']
    mix = idx['levelMix']
    span = idx['spanDays']
    print(f'fixture index: {len(fx_index)} fixtures, {len(mix)} levels, '
          f'{span}d span (generated {idx["generatedAt"]})')
    if idx.get('sliceErrors'):
        print(f'::warning::the fixture index had {idx["sliceErrors"]} failed '
              f'slices — per-year figures below are a LOWER bound.')

    url, key = creds()

    # ---- walk the bucket
    months, ok = sb_list(url, key, '')
    objects = []
    for m in months:
        name = m.get('name')
        if not name or name == META_PREFIX:
            continue
        rows, ok2 = sb_list(url, key, f'{name}/')
        ok = ok and ok2
        for r in rows:
            n = r.get('name') or ''
            if n.endswith('.json.gz'):
                objects.append((f'{name}/{n}', n[:-len('.json.gz')],
                                int(((r.get('metadata') or {}).get('size')) or 0)))
    print(f'bucket {BUCKET}: {len(objects)} objects '
          f'(listing complete: {ok})')
    if not ok:
        print('::warning::bucket listing INCOMPLETE — n below is a lower bound.')
    if not objects:
        print('::error::bucket is empty; nothing to measure yet.')
        return 1

    # ---- measure every object we hold
    per_level = collections.defaultdict(list)
    unindexed = empty = unreadable = 0
    books_all = set()
    other = collections.Counter()
    gz_bytes = collections.defaultdict(list)
    for path, fid, size in objects:
        meta = fx_index.get(fid)
        if meta is None:
            unindexed += 1
            continue
        payload, err = sb_download(url, key, path)
        if payload is None:
            unreadable += 1
            continue
        start = epoch(meta.get('start'))
        rows, ticks, books, ip_only, oth = summarise(payload, start)
        books_all |= books
        other.update(oth)
        total = sum(rows.values())
        if total == 0:
            empty += 1
            # An honest zero: the fixture is held and has no keep-list
            # pre-start series. It contributes 0 rows, so it STAYS in the
            # denominator — dropping it would inflate rows/fixture.
        cat = meta.get('cat') or 'unknown'
        per_level[cat].append({
            'fid': fid, 'rows': total, 'byFamily': dict(rows),
            'preTicks': sum(ticks.values()), 'inplayOnlyLeaves': ip_only,
            'noStart': start is None, 'tourn': meta.get('tourn'),
        })
        gz_bytes[cat].append(size)

    print(f'\nmeasured {sum(len(v) for v in per_level.values())} fixtures; '
          f'{unindexed} not in the index (outside the 180d sweep), '
          f'{unreadable} unreadable, {empty} with no keep-list pre-start series')
    print(f'books seen: {sorted(books_all) or "none"}')
    if other:
        print(f'market families present but OUT of the keep-list '
              f'(top 8 of {len(other)}): '
              + ', '.join(f'{k}' for k, _ in other.most_common(8)))

    # ---- per level
    print(f'\n{"level":<14} {"n":>4} {"rows/fx med":>12} {"mean":>8} {"min":>5} '
          f'{"max":>6} {"mw med":>7} {"preTicks":>9} {"collapse":>9} {"KB gz":>7}')
    dens = {}
    for cat, rs in sorted(per_level.items(), key=lambda kv: -len(kv[1])):
        r = [x['rows'] for x in rs]
        mw = [x['byFamily'].get('match winner', 0) for x in rs]
        pt = [x['preTicks'] for x in rs]
        med = statistics.median(r)
        dens[cat] = {
            'n': len(rs), 'median_rows': med, 'mean_rows': sum(r) / len(r),
            'min_rows': min(r), 'max_rows': max(r),
            'median_mw_rows': statistics.median(mw),
            'median_preTicks': statistics.median(pt),
            'median_kb_gz': statistics.median(gz_bytes[cat]) / 1024,
            'zeroRowFixtures': sum(1 for x in r if x == 0),
        }
        flag = f'  <-- n<{MIN_N}' if len(rs) < MIN_N else ''
        print(f'{cat:<14} {len(rs):>4} {med:>12.1f} {sum(r)/len(r):>8.1f} '
              f'{min(r):>5} {max(r):>6} {statistics.median(mw):>7.1f} '
              f'{statistics.median(pt):>9.0f} '
              f'{statistics.median(pt)/max(med,1):>8.1f}x '
              f'{statistics.median(gz_bytes[cat])/1024:>7.1f}{flag}')

    # ---- projection, reweighted by the 180-day level mix
    print(f'\n=== PROJECTION — rows/yr, reweighted by the {span}d level mix ===')
    line_gb = DB_GB * BUDGET_FRACTION
    rows_yr = rows_yr_mw = 0.0
    gz_yr = 0.0
    unmeasured = []
    print(f'{"level":<14} {"fixtures/yr":>12} {"rows/fx":>9} {"rows/yr":>14} '
          f'{"mw rows/yr":>13}')
    for cat, n in sorted(mix.items(), key=lambda kv: -kv[1]):
        fx_yr = n / span * 365.0
        if cat in NO_ODDS_LEVELS:
            continue
        d = dens.get(cat)
        if not d:
            unmeasured.append((cat, fx_yr))
            continue
        rows_yr += fx_yr * d['median_rows']
        rows_yr_mw += fx_yr * d['median_mw_rows']
        gz_yr += fx_yr * d['median_kb_gz'] * 1024
        print(f'{cat:<14} {fx_yr:>12,.0f} {d["median_rows"]:>9.1f} '
              f'{fx_yr*d["median_rows"]:>14,.0f} '
              f'{fx_yr*d["median_mw_rows"]:>13,.0f}')

    if unmeasured:
        print(f'\nlevels in the mix with NO fixture in the bucket yet '
              f'(excluded -> the totals are a LOWER bound):')
        for cat, fx_yr in sorted(unmeasured, key=lambda t: -t[1]):
            print(f'  {cat:<28} {fx_yr:>9,.0f} fixtures/yr')
    print(f'\nlevels excluded as no-odds (404 on historical-odds, 19/19 sampled): '
          + ', '.join(NO_ODDS_LEVELS))

    print(f'\n{"":<22}{"rows/yr":>14}  {"GB/yr @255.9":>13} {"GB/yr @163.1":>13}')
    for label, ry in (('four families', rows_yr), ('match winner only', rows_yr_mw)):
        g1 = ry * ROW_BYTES['v1_text_as_ruled'] / 1e9
        g2 = ry * ROW_BYTES['v2_coded_narrow'] / 1e9
        print(f'{label:<22}{ry:>14,.0f}  {g1:>12.3f}{"!" if g1 > line_gb else " "} '
              f'{g2:>12.3f}{"!" if g2 > line_gb else " "}')
    print(f'\nline = {BUDGET_FRACTION:.0%} of {DB_GB:.0f} GB = {line_gb:.2f} GB/yr'
          f'   ("!" marks OVER)')
    print(f'raw bucket, same mix: {gz_yr/1e9:.2f} GB/yr of gzipped objects '
          f'(object storage, separate from the database allowance)')

    result = {
        'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'grain': 'fixture+book+market+side+line, >=1 pre-start tick',
        'families': sorted(KEEP_FAMILIES.values()),
        'rowBytesMeasured': ROW_BYTES,
        'bucketObjects': len(objects),
        'listingComplete': ok,
        'measured': sum(len(v) for v in per_level.values()),
        'unindexed': unindexed, 'unreadable': unreadable,
        'zeroKeeplistFixtures': empty,
        'booksSeen': sorted(books_all),
        'perLevel': dens,
        'levelMix': mix, 'spanDays': span,
        'rowsPerYear': {'fourFamilies': rows_yr, 'matchWinnerOnly': rows_yr_mw},
        'gbPerYear': {
            'fourFamilies_v1': rows_yr * ROW_BYTES['v1_text_as_ruled'] / 1e9,
            'fourFamilies_v2': rows_yr * ROW_BYTES['v2_coded_narrow'] / 1e9,
            'matchWinnerOnly_v1': rows_yr_mw * ROW_BYTES['v1_text_as_ruled'] / 1e9,
            'matchWinnerOnly_v2': rows_yr_mw * ROW_BYTES['v2_coded_narrow'] / 1e9,
        },
        'bucketGbPerYear': gz_yr / 1e9,
        'lineGB': line_gb,
        'unmeasuredLevels': [{'level': c, 'fixturesPerYear': f}
                             for c, f in unmeasured],
        'perLevelDetail': {k: v for k, v in per_level.items()},
    }
    json.dump(result, open(OUT, 'w'), indent=1)
    print(f'\nwrote {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
