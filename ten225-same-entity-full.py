#!/usr/bin/env python3
"""TEN-225 item I(2) DECISIVE — api-tennis bet365 vs oddspapi's FULL tick series.

Founder 2026-09-19: "Confirm at n >= 30 on same-instant pairs. a. MEASURE THE
LAG IN MINUTES on the 36.8%... b. Explain the 1.3% genuine disagreement — show
me the cases."

WHY THIS SCRIPT EXISTS SEPARATELY FROM ten225-same-entity.py.

  That script reconstructs oddspapi's tick series from `bet365Now` as WE
  observed it — and the metered bet365 leg runs HOURLY. Every tick between two
  of our reads is invisible to it. An api-tennis price matching one of those
  unseen ticks therefore cannot be recognised as LAGGING and is counted as
  DISAGREE instead. Its 4.4% disagreement is an UPPER bound and its 1.1% lag a
  LOWER bound, which is not what the founder asked for.

  /v4/historical-odds returns the COMPLETE tick series — every createdAt, every
  price — and is FREE (it never bills; measured repeatedly on this issue). So
  the sampling hole can be removed entirely at no cost. That is the only honest
  way to separate "stale" from "genuinely different", which is the whole
  question in (b).

THE JOIN: odds-fixture-map.json `byKey` maps our api-tennis event key to
oddspapi's fixtureId. The union across git history is used rather than the
current file, because a mapping that has since aged out of the live map is
still a correct mapping for an observation made while it was there.

Pacing is the repo's own 5.5 s /v4/historical-odds cooldown, with the same 429
backoff, so this cannot starve the archive that shares the key.
"""
import json
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

REPO = '/Users/Michael/bsp-consult-project'
BASE = 'https://api.oddspapi.io'
HIST_SLEEP = 5.5
SINCE = '7 days ago'


def sh(*a):
    return subprocess.run(a, cwd=REPO, capture_output=True, text=True).stdout


def key():
    for line in open(f'{REPO}/.env'):
        if line.startswith('ODDSPAPI_KEY='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")
    raise SystemExit('::error::ODDSPAPI_KEY not found')


def api_get(path, params, k):
    p = dict(params)
    p['apiKey'] = k
    req = urllib.request.Request(BASE + path + '?' + urllib.parse.urlencode(p),
                                 headers={'User-Agent': 'BSP-Consult-Dashboard/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.load(r), None
    except urllib.error.HTTPError as e:
        return None, e.code
    except Exception as e:
        return None, str(e)


def parse(ts):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).replace('Z', '+00:00'))
    except Exception:
        return None


def trunc2(x):
    """api-tennis truncates to 2dp. Truncate the oddspapi side identically or a
    3-decimal oddspapi price reads as a disagreement when it is the same quote
    through a narrower pipe."""
    return None if x is None else int(float(x) * 100) / 100.0


def main():
    k = key()

    # ---- the id map, unioned over history -------------------------------
    maps = {}
    for h in sh('git', 'log', 'origin/main', '--since=12 days ago', '--format=%H',
                '--', 'odds-fixture-map.json').split():
        raw = sh('git', 'show', f'{h}:odds-fixture-map.json')
        if not raw.strip():
            continue
        try:
            d = json.loads(raw)
        except Exception:
            continue
        for ek, v in (d.get('byKey') or {}).items():
            if v.get('fixtureId'):
                maps.setdefault(ek, v['fixtureId'])

    # ---- api-tennis bet365 observations from matches.json history -------
    commits = [l.split() for l in sh('git', 'log', 'origin/main', f'--since={SINCE}',
                                     '--format=%H %cI', '--', 'matches.json'
                                     ).strip().splitlines()]
    obs = set()
    for h, t in commits:
        raw = sh('git', 'show', f'{h}:matches.json')
        if not raw.strip():
            continue
        try:
            d = json.loads(raw)
        except Exception:
            continue
        ms = d['matches'] if isinstance(d, dict) and 'matches' in d else d
        if not isinstance(ms, list):
            continue
        ct = parse(t)
        for m in ms:
            fid = m.get('id')
            if not fid:
                continue
            o = m.get('odds') or {}
            if str(o.get('bookmaker', '')).lower() == 'bet365' and o.get('p1') and o.get('p2'):
                obs.add((fid, ct, o['p1'], o['p2']))
            bo = m.get('bestOdds') or {}
            # both sides must name bet365: bestOdds is a best-ACROSS-books merge,
            # so a mixed pair would be a price no single book ever quoted.
            if (isinstance(bo.get('p1'), dict) and isinstance(bo.get('p2'), dict)
                    and str(bo['p1'].get('bookmaker', '')).lower() == 'bet365'
                    and str(bo['p2'].get('bookmaker', '')).lower() == 'bet365'
                    and bo['p1'].get('price') and bo['p2'].get('price')):
                obs.add((fid, ct, bo['p1']['price'], bo['p2']['price']))
            for book, v in (m.get('bookOpens') or {}).items():
                if book.lower() == 'bet365' and v.get('p1') and v.get('p2'):
                    tt = parse(v.get('seenAt'))
                    if tt:
                        obs.add((fid, tt, v['p1'], v['p2']))

    byfix = defaultdict(list)
    for fid, t, p1, p2 in obs:
        if t:
            byfix[fid].append((t, p1, p2))
    targets = [f for f in byfix if f.split('-')[-1] in maps]
    print(f'api-tennis bet365 observations: {len(obs)} over {len(byfix)} fixture(s); '
          f'{len(targets)} fixture(s) map to an oddspapi id')

    # ---- pull the FULL series, free -------------------------------------
    IDENT, LAG, DIS, nofix = [], [], [], 0
    for i, fid in enumerate(sorted(targets), 1):
        data, err = api_get('/v4/historical-odds',
                            {'fixtureId': maps[fid.split('-')[-1]],
                             'bookmakers': 'bet365'}, k)
        time.sleep(HIST_SLEEP)
        if err == 429:
            time.sleep(HIST_SLEEP * 3)
            data, err = api_get('/v4/historical-odds',
                                {'fixtureId': maps[fid.split('-')[-1]],
                                 'bookmakers': 'bet365'}, k)
            time.sleep(HIST_SLEEP)
        if err or not data:
            nofix += 1
            continue

        # Walk to the match-winner series for each side. The payload nests
        # bookmaker -> market -> outcome -> ticks; shapes have drifted on this
        # issue before, so this searches rather than assuming a fixed path.
        ticks = defaultdict(list)          # outcome label -> [(dt, price)]

        def walk(node, label=None):
            if isinstance(node, dict):
                if 'createdAt' in node and 'price' in node:
                    dt = parse(node['createdAt'])
                    if dt and label and node.get('price'):
                        ticks[label].append((dt, node['price']))
                    return
                for kk, vv in node.items():
                    walk(vv, kk if isinstance(vv, (list, dict)) and not
                         (isinstance(vv, dict) and 'createdAt' in vv) else label)
            elif isinstance(node, list):
                for vv in node:
                    walk(vv, label)

        walk(data)
        sides = [v for v in ticks.values() if len(v) >= 1]
        if len(sides) < 2:
            nofix += 1
            continue
        sides.sort(key=lambda s: -len(s))
        s1, s2 = sorted(sides[0]), sorted(sides[1])

        def at(series, t):
            past = [p for tt, p in series if tt <= t]
            return past[-1] if past else None

        # the union of real change instants, for the backward walk
        pts = sorted({tt for tt, _ in s1} | {tt for tt, _ in s2})
        for t, p1, p2 in sorted(byfix[fid]):
            cur = (at(s1, t), at(s2, t))
            if cur[0] is None or cur[1] is None:
                continue
            want = {(trunc2(p1), trunc2(p2)), (trunc2(p2), trunc2(p1))}
            if (trunc2(cur[0]), trunc2(cur[1])) in want:
                IDENT.append((fid, t))
                continue
            hit = None
            for tt in reversed([x for x in pts if x <= t]):
                pp = (at(s1, tt), at(s2, tt))
                if pp[0] is not None and (trunc2(pp[0]), trunc2(pp[1])) in want:
                    hit = tt
                    break
            if hit:
                LAG.append((fid, t, (t - hit).total_seconds() / 60.0))
            else:
                DIS.append((fid, t, cur, (p1, p2)))
        if i % 15 == 0:
            print(f'  ...{i}/{len(targets)} fixtures pulled')

    n = len(IDENT) + len(LAG) + len(DIS)
    print(f'\n=== SAME-ENTITY vs the FULL oddspapi tick series (n={n}) ===')
    print(f'    fixtures with no usable series returned: {nofix}')
    if not n:
        print('  ::warning:: ZERO observations were classified. Nothing was '
              'assessed — this is NOT evidence either way. Do not read a verdict.')
        return 0
    for name, c in (('IDENTICAL to the tick current at that instant', len(IDENT)),
                    ('LAGGING  (matches a real EARLIER tick)', len(LAG)),
                    ('DISAGREE (matches NO tick in the full series)', len(DIS))):
        print(f'  {name:48} {c:>5}  {100.0*c/n:5.1f}%')
    print(f'  {"total":48} {n:>5}' + ('  ⚠️ n<30' if n < 30 else ''))

    if LAG:
        v = sorted(x[2] for x in LAG)
        p95 = v[min(len(v) - 1, int(round(0.95 * (len(v) - 1))))]
        print(f'\n(a) LAG in MINUTES: median {v[len(v)//2]:.1f}  p95 {p95:.1f}  '
              f'max {v[-1]:.1f}  n={len(v)}' + ('  ⚠️ n<30' if len(v) < 30 else ''))
    if DIS:
        print(f'\n(b) DISAGREEMENTS — every case (n={len(DIS)}):')
        for fid, t, cur, got in DIS[:30]:
            print(f'    {fid:22} {t.isoformat()}  oddspapi {cur[0]}/{cur[1]}'
                  f'   api-tennis {got[0]}/{got[1]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
