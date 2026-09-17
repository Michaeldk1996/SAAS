#!/usr/bin/env python3
"""TEN-225 item 3, part 2 — the PAIRED decay test and the missing control.

The first probe (ten225-decay-probe.py) measured close_lag_h across age bands
from a single fresh pull. It showed the tail collapsing with age, but two things
were missing:

  1. The control band (0-4d) came back pool=0. The cached fixture list was swept
     2026-09-12, so it contains nothing younger than that. There was no
     same-run "this is what an undecayed series looks like" baseline.

  2. Michael asked to compare against bet365-history/. That archive turns out to
     have been GENERATED 2026-09-10..12 — so its March/April/May months were
     themselves pulled at 4-6 months of age. They are decayed copies, not
     reference copies, and comparing today's pull against them would measure one
     week of drift, not decay from live.

But bet365-history/2026-09.json IS a reference copy: 181 of its fixtures were
captured within 3 days of their start. Their stored open/close are the real
first and last pre-start points (index.json: "Close is pinned to the last point
at or before the fixture start"), and n1/n2 are the TRUE pre-start counts before
reduction. So that file supplies both missing pieces:

  CONTROL   — archive close_lag/lead computed from the stored timestamps, at
              capture age <=3d. Costs zero API calls.
  PAIRED    — re-pull the same fixtures today (now aged 5-8d) and compare
              open price+ts, close price+ts and pre-start count against the
              reference. Same fixture, two known ages: real decay, not a
              cross-sectional inference.

/v4/historical-odds is free and unmetered; cost here is pacing only.
"""
import gzip, json, os, statistics, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = 'https://api.oddspapi.io'
BOOK = 'bet365'
SLEEP = 5.5
MAX_RETRY = 4
CAPTURE_AGE_MAX = 3.0      # only fixtures the archive caught within 3d of start
TARGET = 40
OUT = os.path.join(HERE, 'ten225-decay-paired.json')


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


def series(payload, oc):
    blk = ((payload or {}).get('bookmakers') or {}).get(BOOK)
    if not isinstance(blk, dict): return None
    mkt = (blk.get('markets') or {}).get('121')
    if not isinstance(mkt, dict): return None
    raw = (((mkt.get('outcomes') or {}).get(oc) or {}).get('players') or {}).get('0') or []
    pts = []
    for p in raw:
        t, price = epoch(p.get('createdAt')), p.get('price')
        if t is not None and price is not None:
            pts.append((t, float(price)))
    pts.sort()
    return pts


def main():
    key = read_key()
    now = datetime.now(timezone.utc).timestamp()
    d = json.load(open(os.path.join(HERE, 'bet365-history/2026-09.json')))
    gen = epoch(d['generatedAt'])

    # ---- CONTROL: read the reference straight off the archive. No API calls. ----
    ref = []
    for fid, f in d['fixtures'].items():
        st = f.get('start')
        if not st: continue
        cap_age = (gen - st) / 86400.0
        if not (0 <= cap_age <= CAPTURE_AGE_MAX): continue
        for side, sk, nk in (('p1', 's1', 'n1'), ('p2', 's2', 'n2')):
            s = f.get(sk)
            if not s: continue
            pre = [p for p in s if p[0] <= st]
            if not pre: continue
            ref.append(dict(fid=fid, side=side, cat=f.get('cat'), start=st,
                            cap_age=cap_age, n_pre_true=f.get(nk),
                            lead_h=(st - pre[0][0]) / 3600.0,
                            close_lag_h=(st - pre[-1][0]) / 3600.0,
                            open_price=pre[0][1], open_ts=pre[0][0],
                            close_price=pre[-1][1], close_ts=pre[-1][0]))

    lag = sorted(r['close_lag_h'] for r in ref)
    lead = sorted(r['lead_h'] for r in ref)
    print(f'=== CONTROL (archive, captured <= {CAPTURE_AGE_MAX}d after start) ===')
    print(f'  n series = {len(lag)}   fixtures = {len({r["fid"] for r in ref})}')
    print(f'  close_lag_h  median {statistics.median(lag):.3f}  '
          f'p75 {lag[(3*len(lag))//4]:.3f}  max {lag[-1]:.3f}')
    print(f'  lead_h       median {statistics.median(lead):.3f}')
    for thr in (0.25, 1, 2, 6):
        c = sum(1 for v in lag if v <= thr)
        print(f'  close_lag <= {thr}h : {c}/{len(lag)} ({100*c/len(lag):.0f}%)')

    # ---- PAIRED: re-pull the same fixtures today. ----
    byfid = {}
    for r in ref: byfid.setdefault(r['fid'], []).append(r)
    # deterministic draw, densest reference series first (most to lose)
    order = sorted(byfid, key=lambda k: (-max(x['n_pre_true'] or 0 for x in byfid[k]), k))
    pick = order[:TARGET]
    print(f'\n=== PAIRED re-pull of {len(pick)} fixtures (free calls) ===', flush=True)

    out, skipped, calls = [], {}, 0
    for fid in pick:
        payload, err = hist(fid, key); calls += 1
        time.sleep(SLEEP)
        if payload is None:
            skipped[f'http-{err}'] = skipped.get(f'http-{err}', 0) + 1
            print(f'  {fid} SKIP http-{err}', flush=True); continue
        for r in byfid[fid]:
            pts = series(payload, '121' if r['side'] == 'p1' else '122')
            if pts is None:
                skipped['no-bet365-or-market'] = skipped.get('no-bet365-or-market', 0) + 1
                continue
            st = r['start']
            pre = [p for p in pts if p[0] <= st]
            if not pre:
                skipped['no-prestart-ticks'] = skipped.get('no-prestart-ticks', 0) + 1
                out.append(dict(r, gone=True)); continue
            out.append(dict(r, gone=False,
                            now_age=(now - st) / 86400.0,
                            n_pre_now=len(pre), n_total_now=len(pts),
                            open_price_now=pre[0][1], open_ts_now=pre[0][0],
                            close_price_now=pre[-1][1], close_ts_now=pre[-1][0],
                            lead_h_now=(st - pre[0][0]) / 3600.0,
                            close_lag_h_now=(st - pre[-1][0]) / 3600.0,
                            open_same=abs(pre[0][1] - r['open_price']) < 1e-9
                                      and abs(pre[0][0] - r['open_ts']) < 1,
                            close_same=abs(pre[-1][1] - r['close_price']) < 1e-9
                                       and abs(pre[-1][0] - r['close_ts']) < 1))
        p = out[-1]
        if not p.get('gone'):
            print(f"  {fid} age {p['now_age']:.1f}d  n_pre {p['n_pre_true']}->{p['n_pre_now']}  "
                  f"open {'SAME' if p['open_same'] else 'MOVED'}  "
                  f"close {'SAME' if p['close_same'] else 'MOVED'}", flush=True)

    live = [r for r in out if not r.get('gone')]
    json.dump({'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
               'calls': calls, 'captureAgeMax': CAPTURE_AGE_MAX,
               'control': ref, 'paired': out, 'skipped': skipped},
              open(OUT, 'w'), indent=1)

    print(f'\n=== PAIRED RESULT ({calls} free calls) ===')
    if live:
        os_ = sum(1 for r in live if r['open_same'])
        cs = sum(1 for r in live if r['close_same'])
        print(f'  series compared        {len(live)}' + ('  <-- n<30' if len(live) < 30 else ''))
        print(f'  Open identical         {os_}/{len(live)} ({100*os_/len(live):.0f}%)')
        print(f'  Close identical        {cs}/{len(live)} ({100*cs/len(live):.0f}%)')
        kept = [r['n_pre_now'] / r['n_pre_true'] for r in live if r['n_pre_true']]
        print(f'  pre-start ticks kept   median {100*statistics.median(kept):.0f}%')
        print(f"  close_lag_h  ref median {statistics.median([r['close_lag_h'] for r in live]):.3f}"
              f"  -> now median {statistics.median([r['close_lag_h_now'] for r in live]):.3f}")
        print(f"  lead_h       ref median {statistics.median([r['lead_h'] for r in live]):.3f}"
              f"  -> now median {statistics.median([r['lead_h_now'] for r in live]):.3f}")
    print(f'  series that vanished   {sum(1 for r in out if r.get("gone"))}')
    print(f'  skipped: {skipped}')


if __name__ == '__main__':
    main()
