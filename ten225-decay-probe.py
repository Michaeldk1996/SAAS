#!/usr/bin/env python3
"""TEN-225 item 3 — the DECAY question.

Michael: "For fixtures ~3 weeks, ~2 months and ~4 months old: are the surviving
pre-start ticks the FIRST and LAST pre-start prices (so Open and Close stay
exact), or an arbitrary subset?"

Method. Fixture metadata for every tennis fixture in the 180-day window is
already cached (.bet365-history-targets.json.gz, 16,709 fixtures, swept
2026-09-12). Draw an age-stratified sample, pull /v4/historical-odds FRESH
today, and measure two things per side-series that need no reference copy:

  lead_h      hours between the FIRST surviving pre-start tick and the start
  close_lag_h hours between the START and the LAST surviving pre-start tick

A fresh fixture's last pre-start tick lands minutes before the first ball. If
decay preserved the endpoints, close_lag_h would stay near zero at every age.
If it climbs, the Close is being pruned away and is NOT recoverable at backfill
time. The control band (0-4 days) is measured in the SAME run so the comparison
is not against a number from another day.

/v4/historical-odds is free and unmetered; the cost here is pacing only.
"""
import gzip, json, os, statistics, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = 'https://api.oddspapi.io'
BOOK = 'bet365'
MARKET_WINNER = '121'
SLEEP = 5.5
MAX_RETRY = 4
TARGET_PER_BAND = 30
OVERSAMPLE = 3.0
OUT = os.path.join(HERE, 'ten225-decay-probe.json')

BANDS = [
    ('control_0-4d',   0,   4),
    ('~3 weeks',      18,  25),
    ('~2 months',     55,  70),
    ('~4 months',    115, 135),
]

def read_key():
    for line in open(os.path.join(HERE, '.env')):
        if line.startswith('ODDSPAPI_KEY='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")
    return os.environ.get('ODDSPAPI_KEY')

def api_get(path, params, key, timeout=180):
    p = dict(params); p['apiKey'] = key
    url = BASE + path + '?' + urllib.parse.urlencode(p)
    req = urllib.request.Request(url, headers={'User-Agent': 'BSP-Consult-Dashboard/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r), None
    except urllib.error.HTTPError as e:
        return None, e.code
    except Exception as e:
        return None, str(e)

def hist(fid, key):
    for a in range(MAX_RETRY):
        d, e = api_get('/v4/historical-odds', {'fixtureId': fid, 'bookmakers': BOOK}, key)
        if e == 429:
            time.sleep(SLEEP * (a + 2)); continue
        return d, e
    return None, 429

def epoch(ts):
    if not ts: return None
    try: return datetime.fromisoformat(str(ts).replace('Z', '+00:00')).timestamp()
    except ValueError: return None

def start_of(fx):
    return epoch(fx.get('trueStartTime')) or epoch(fx.get('startTime'))

def series(payload, oc):
    blk = ((payload or {}).get('bookmakers') or {}).get(BOOK)
    if not isinstance(blk, dict): return None
    mkt = (blk.get('markets') or {}).get(MARKET_WINNER)
    if not isinstance(mkt, dict): return None
    raw = (((mkt.get('outcomes') or {}).get(oc) or {}).get('players') or {}).get('0') or []
    pts = []
    for p in raw:
        ts, price = p.get('createdAt'), p.get('price')
        t = epoch(ts)
        if t is not None and price is not None:
            pts.append((t, float(price)))
    pts.sort()
    return pts

def main():
    key = read_key()
    now = datetime.now(timezone.utc).timestamp()
    fx = json.load(gzip.open(os.path.join(HERE, '.bet365-history-targets.json.gz')))['fixtures']
    # Deterministic, reproducible draw: sort by fixtureId inside each band and
    # take a fixed stride. No Math.random equivalent, so a re-run repeats it.
    pools = {}
    for f in fx:
        s = start_of(f)
        if s is None or s > now: continue
        age = (now - s) / 86400.0
        for lab, lo, hi in BANDS:
            if lo <= age < hi:
                pools.setdefault(lab, []).append((f, age))
    results, calls = {}, 0
    for lab, lo, hi in BANDS:
        pool = sorted(pools.get(lab, []), key=lambda t: t[0]['fixtureId'])
        want = int(TARGET_PER_BAND * OVERSAMPLE)
        stride = max(1, len(pool) // want) if pool else 1
        pick = pool[::stride][:want]
        rows, skipped = [], {}
        print(f'\n=== {lab}  pool={len(pool)}  sampling up to {len(pick)} ===', flush=True)
        for f, age in pick:
            if len([r for r in rows if r['side'] == 'p1']) >= TARGET_PER_BAND:
                break
            d, err = hist(f['fixtureId'], key); calls += 1
            time.sleep(SLEEP)
            if d is None:
                skipped[f'http-{err}'] = skipped.get(f'http-{err}', 0) + 1; continue
            st = start_of(f)
            got = False
            for side, oc in (('p1', '121'), ('p2', '122')):
                pts = series(d, oc)
                if pts is None:
                    skipped['no-bet365-or-market'] = skipped.get('no-bet365-or-market', 0) + 1
                    break
                pre = [p for p in pts if p[0] <= st]
                if not pre:
                    skipped['no-prestart-ticks'] = skipped.get('no-prestart-ticks', 0) + 1
                    continue
                rows.append(dict(fid=f['fixtureId'], side=side, age=age, cat=f.get('categoryName'),
                                 n_pre=len(pre), n_total=len(pts),
                                 lead_h=(st - pre[0][0]) / 3600.0,
                                 close_lag_h=(st - pre[-1][0]) / 3600.0,
                                 open_price=pre[0][1], close_price=pre[-1][1]))
                got = True
            if got:
                print(f"  {f['fixtureId']} age={age:5.1f}d {f.get('categoryName'):<12} "
                      f"n_pre={rows[-1]['n_pre']:3d} lead={rows[-1]['lead_h']:7.2f}h "
                      f"close_lag={rows[-1]['close_lag_h']:7.2f}h", flush=True)
        results[lab] = dict(rows=rows, skipped=skipped, pool=len(pool), attempted=len(pick))
    json.dump({'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
               'calls': calls, 'bands': results}, open(OUT, 'w'), indent=1)
    print(f'\n\n=== SUMMARY ({calls} free /v4/historical-odds calls) ===')
    print(f"{'band':>14} {'n series':>9} {'med n_pre':>10} {'med lead h':>11} "
          f"{'med close_lag h':>16} {'close_lag<0.5h %':>17} {'n_pre==1 %':>11}")
    for lab, _, _ in BANDS:
        rows = results[lab]['rows']
        if not rows:
            print(f'{lab:>14} {0:>9}   (no usable series)'); continue
        m = lambda k: statistics.median([r[k] for r in rows])
        near = 100.0 * sum(1 for r in rows if r['close_lag_h'] < 0.5) / len(rows)
        one = 100.0 * sum(1 for r in rows if r['n_pre'] == 1) / len(rows)
        flag = '  <-- n<30' if len(rows) < 30 else ''
        print(f"{lab:>14} {len(rows):>9} {m('n_pre'):>10.0f} {m('lead_h'):>11.2f} "
              f"{m('close_lag_h'):>16.2f} {near:>17.1f} {one:>11.1f}{flag}")
        print(f"{'':>14} skipped: {results[lab]['skipped']}")

if __name__ == '__main__':
    main()
