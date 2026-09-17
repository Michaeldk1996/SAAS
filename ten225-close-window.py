#!/usr/bin/env python3
"""TEN-225 — "what would a longer archive-age window recover?" (founder comment
2026-09-17T22:31Z, SEPARATE NOT BLOCKING). Report only; retunes nothing.

The question has two halves and they have different answers, so they are
measured separately rather than collapsed into one recovery number:

  BACKWARD - what a 30d or 45d window would recover from the fixtures we
             ALREADY HOLD. Computed offline from bet365-history capture stamps.
             Archive age is a property of WHEN WE PULLED and cannot be improved
             retroactively, so this half is arithmetic, not a projection.

  FORWARD  - what a 30d or 45d window would ADMIT on fixtures the running
             oddspapi archive reaches at that age, and whether the Close it
             would carry is any good. Measured by pulling /v4/historical-odds
             NOW for fixtures whose TRUE age today falls in each band, and
             computing close_lag from the series that comes back. This is a
             real measurement at the real age, not an interpolation between
             the 3-week and 2-month decay bands.

close_lag = minutes from the last pre-start tick to the start. Start time per
the locked definition: trueStartTime first; the scheduled time is NEVER used as
a start, so a fixture with no trueStart is excluded from the lag measurement and
counted separately rather than silently anchored to the wrong instant.

Cost: /v4/historical-odds is free and rate-limited to ~1 call / 5 s. No
/v4/fixtures call - the committed 180-day index supplies the fixture universe.
"""
import collections
import gzip
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(HERE, '.ten225-fixture-index.json.gz')
HIST_DIR = os.path.join(HERE, 'bet365-history')
OUT = os.path.join(HERE, 'ten225-close-window.json')

BASE = 'https://api.oddspapi.io/v4'
HIST_SLEEP = 5.0
CLOSE_LAG_LIMIT_MIN = 60.0
BANDS = [(0.0, 21.0), (21.0, 30.0), (30.0, 45.0)]
PER_BAND = 45          # target n per band; >= 30 so the figure is not flagged
NO_ODDS_LEVELS = ('UTR Men', 'UTR Women', 'Juniors', 'Wheelchairs',
                  'Wheelchairs Juniors', 'Legends', 'Exhibition')


def key():
    for line in open(os.path.join(HERE, '.env')):
        if line.startswith('ODDSPAPI_KEY='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")
    return os.environ.get('ODDSPAPI_KEY')


K = key()


def api(path, params):
    p = dict(params)
    p['apiKey'] = K
    url = BASE + path + '?' + urllib.parse.urlencode(p)
    req = urllib.request.Request(url, headers={'User-Agent': 'BSP-Consult-Dashboard/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode()), None
    except urllib.error.HTTPError as e:
        return None, e.code
    except Exception as e:                                    # noqa: BLE001
        return None, str(e)


def epoch(ts):
    if ts is None or ts == '':
        return None
    if isinstance(ts, (int, float)):
        return float(ts)
    try:
        return datetime.fromisoformat(str(ts).replace('Z', '+00:00')).timestamp()
    except (ValueError, TypeError):
        return None


# ------------------------------------------------------------------ backward
def backward():
    """Exact, offline: how many held fixtures each window admits."""
    rows = []
    for m in sorted(os.listdir(HIST_DIR)) if os.path.isdir(HIST_DIR) else []:
        if not m.endswith('.json') or m == 'index.json':
            continue
        doc = json.load(open(os.path.join(HIST_DIR, m)))
        gen = epoch(doc.get('generatedAt'))
        if not gen:
            continue
        for fid, fx in (doc.get('fixtures') or {}).items():
            start = fx.get('start')
            if not start:
                continue
            lags = []
            for side in ('s1', 's2'):
                pre = [t for t, _p in (fx.get(side) or []) if t is not None and t <= start]
                if pre:
                    lags.append((start - max(pre)) / 60.0)
            rows.append({'month': m[:-5], 'age_d': (gen - start) / 86400.0,
                         # a fixture is only as good as its WORST side: both
                         # legs have to be servable or the card shows a dash
                         'lag_min': max(lags) if len(lags) == 2 else None})
    held = len(rows)
    ages = sorted(r['age_d'] for r in rows)
    out = {'held_n': held,
           'age_min_d': round(ages[0], 2) if ages else None,
           'age_max_d': round(ages[-1], 2) if ages else None,
           'windows': {}}
    base = None
    for lim in (21.0, 30.0, 45.0):
        adm = [r for r in rows if r['age_d'] <= lim]
        rel = [r for r in adm if r['lag_min'] is not None and r['lag_min'] <= CLOSE_LAG_LIMIT_MIN]
        if base is None:
            base = len(rel)
        out['windows'][f'{int(lim)}d'] = {
            'admitted_n': len(adm), 'reliable_n': len(rel),
            'additional_vs_21d': len(rel) - base,
            'lag_median_min': round(statistics.median([r['lag_min'] for r in rel]), 3) if rel else None,
        }
    # the age histogram is the WHY behind the recovery number
    bins = [(0, 13), (13, 21), (21, 30), (30, 45), (45, 90), (90, 126), (126, 999)]
    out['age_histogram'] = {f'{lo}-{hi}d': sum(1 for r in rows if lo <= r['age_d'] < hi)
                            for lo, hi in bins}
    return out


# ------------------------------------------------------------------- forward
def forward():
    idx = json.load(gzip.open(INDEX))['fixtures']
    now = datetime.now(timezone.utc).timestamp()
    pool = collections.defaultdict(list)
    for fid, v in idx.items():
        if (v.get('cat') or '') in NO_ODDS_LEVELS:
            continue
        ts = epoch(v.get('trueStart'))
        if not ts:
            continue                       # never anchor a lag to a scheduled time
        age = (now - ts) / 86400.0
        for lo, hi in BANDS:
            if lo <= age < hi:
                pool[f'{int(lo)}-{int(hi)}d'].append((fid, v, age))
                break
    res = {}
    for band, items in pool.items():
        # deterministic, spread across the band rather than clustered at one
        # edge: sort by age and take an even stride.
        items.sort(key=lambda t: t[2])
        step = max(1, len(items) // PER_BAND)
        sample = items[::step][:PER_BAND]
        rows = []
        for fid, meta, age in sample:
            d, err = api('/historical-odds', {'fixtureId': fid})
            row = {'fixture': fid, 'cat': meta.get('cat'), 'age_d': round(age, 2),
                   'err': err}
            anchor = epoch(meta.get('trueStart'))
            lags, firsts = [], []
            for bname, blk in ((d or {}).get('bookmakers') or {}).items():
                if bname.lower() != 'bet365':
                    continue
                for mid, mk in ((blk or {}).get('markets') or {}).items():
                    for oid, oc in ((mk or {}).get('outcomes') or {}).items():
                        for pkey, plist in ((oc or {}).get('players') or {}).items():
                            ts = [epoch((p or {}).get('createdAt'))
                                  for p in (plist if isinstance(plist, list) else [])
                                  if isinstance(p, dict)]
                            ts = [t for t in ts if t]
                            if not ts:
                                continue
                            firsts.append(min(ts))
                            pre = [t for t in ts if t <= anchor]
                            if pre:
                                lags.append((anchor - max(pre)) / 60.0)
            row['series_n'] = len(firsts)
            # worst side wins: the card needs BOTH legs servable
            row['lag_min'] = round(max(lags), 3) if lags else None
            row['open_lead_h'] = round((anchor - min(firsts)) / 3600.0, 3) if firsts else None
            rows.append(row)
            time.sleep(HIST_SLEEP)
        lags = [r['lag_min'] for r in rows if r['lag_min'] is not None]
        res[band] = {
            'pool_n': len(items), 'sampled_n': len(rows),
            'with_bet365_series_n': sum(1 for r in rows if r['series_n']),
            'with_close_n': len(lags),
            'lag_le_60min_n': sum(1 for l in lags if l <= 60),
            'lag_le_15min_n': sum(1 for l in lags if l <= 15),
            'lag_median_min': round(statistics.median(lags), 2) if lags else None,
            'lag_p25_min': round(statistics.quantiles(lags, n=4)[0], 2) if len(lags) >= 4 else None,
            'lag_p75_min': round(statistics.quantiles(lags, n=4)[2], 2) if len(lags) >= 4 else None,
            'lag_min_min': round(min(lags), 2) if lags else None,
            'lag_max_min': round(max(lags), 2) if lags else None,
            'flag_small_n': len(rows) < 30,
            'rows': rows,
        }
    return res


def main():
    what = sys.argv[1] if len(sys.argv) > 1 else 'all'
    out = {}
    if os.path.exists(OUT):
        try:
            out = json.load(open(OUT))
        except Exception:
            out = {}
    out['generatedAt'] = datetime.now(timezone.utc).isoformat()
    if what in ('all', 'backward'):
        out['backward'] = backward()
    if what in ('all', 'forward'):
        out['forward'] = forward()
    json.dump(out, open(OUT, 'w'), indent=1)
    print('wrote', OUT, [k for k in out if k != 'generatedAt'])


if __name__ == '__main__':
    sys.exit(main())
