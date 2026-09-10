#!/usr/bin/env python3
"""Offline tests for archive-bet365-history.py. No network, no quota.

Run:  python3 test-archive-bet365-history.py

These lock the two properties that would be expensive to get wrong and cheap to
regress silently:

  * REDUCTION NEVER INVENTS A POINT. Every stored point is a real observed one.
    The standing rule is that a missing price is a dash and never a derived
    value; an interpolated midpoint in the archive would break that rule in a
    place nobody would think to look.
  * THE CLOSE IS PRE-MATCH. TEN-124 pins the close to the last price before the
    first ball. An in-play price silently pinned as a close is exactly the bug
    that put 1.062 on Zverev-Darderi, so it gets a test rather than a comment.
"""

import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('arch', os.path.join(HERE, 'archive-bet365-history.py'))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)

FAILS = []


def ck(name, cond, extra=''):
    print(('  PASS  ' if cond else '  FAIL  ') + name + (f'   [{extra}]' if extra and not cond else ''))
    if not cond:
        FAILS.append(name)


def pt(ts, price):
    return {'createdAt': ts, 'price': price}


# ------------------------------------------------------------------ reduction
print('=== reduce_series ===')
ck('None -> None', a.reduce_series(None) is None)
ck('empty -> None', a.reduce_series([]) is None)
short = [[i, 2.0] for i in range(5)]
ck('short series returned untouched', a.reduce_series(short) == short)
ck('exactly KEEP_POINTS untouched', len(a.reduce_series([[i, 2.0] for i in range(a.KEEP_POINTS)])) == a.KEEP_POINTS)

big = [[i, 1.5 + i * 0.01] for i in range(505)]
r = a.reduce_series(big)
ck('505 reduced to <= KEEP_POINTS', len(r) <= a.KEEP_POINTS, len(r))
ck('open preserved exactly', r[0] == big[0], r[0])
ck('close preserved exactly', r[-1] == big[-1], r[-1])
ck('NO INTERPOLATION - every point is a real observed point', all(p in big for p in r))
ck('timestamps strictly increasing', [p[0] for p in r] == sorted(set(p[0] for p in r)))
ck('KEEP_POINTS+1 reduced', len(a.reduce_series([[i, 2.0] for i in range(a.KEEP_POINTS + 1)])) <= a.KEEP_POINTS)

# ------------------------------------------------------------------- compaction
print('\n=== compact ===')
flat = [pt('2026-09-01T00:00:00Z', 2.0), pt('2026-09-01T00:03:00Z', 2.0),
        pt('2026-09-01T00:06:00Z', 2.0), pt('2026-09-01T00:09:00Z', 2.0),
        pt('2026-09-01T00:12:00Z', 2.5)]
c = a.compact(flat)
ck('flat run collapses to first+last, movement kept', len(c) == 3, c)
ck('collapsed run keeps the run END timestamp', c[1][0] == a.epoch('2026-09-01T00:09:00Z'), c)
ck('drops impossible price <= 1 (suspended marker)', a.compact([pt('2026-09-01T00:00:00Z', 1.0)]) == [])
ck('drops missing timestamp', a.compact([pt(None, 2.0)]) == [])
ck('drops non-numeric price', a.compact([pt('2026-09-01T00:00:00Z', 'x')]) == [])
ck('sorts out-of-order input', [p[1] for p in a.compact(
    [pt('2026-09-01T00:06:00Z', 2.0), pt('2026-09-01T00:00:00Z', 3.0)])] == [3.0, 2.0])

# ------------------------------------------------------------------ build_entry
print('\n=== build_entry: the close must be PRE-MATCH ===')
FX = {'fixtureId': 'f1', 'startTime': '2026-09-01T12:00:00Z',
      'trueStartTime': '2026-09-01T12:00:00Z', 'categoryName': 'ATP',
      'tournamentName': 'T', 'participant1Name': 'A', 'participant2Name': 'B'}


def payload(p1pts, p2pts):
    return {'bookmakers': {'bet365': {'markets': {'121': {'outcomes': {
        '121': {'players': {'0': p1pts}},
        '122': {'players': {'0': p2pts}}}}}}}}


pre = [pt('2026-09-01T09:00:00Z', 3.0), pt('2026-09-01T10:00:00Z', 3.5),
       pt('2026-09-01T11:59:00Z', 4.0)]
inplay = [pt('2026-09-01T12:30:00Z', 1.2), pt('2026-09-01T13:00:00Z', 1.06)]
e, why = a.build_entry(payload(pre + inplay, pre + inplay), FX)
ck('entry built', e is not None, why)
if e:
    ck('close is the last PRE-START price (4.0), not the in-play 1.06',
       e['s1'][-1][1] == 4.0, e['s1'][-1])
    ck('open is the first pre-start price (3.0)', e['s1'][0][1] == 3.0, e['s1'][0])
    ck('no stored point is after the first ball',
       all(p[0] <= e['start'] for p in e['s1'] + e['s2']))
    ck('in-play points counted, not silently dropped', e['inplay'] == 4, e['inplay'])
    ck('n1 is the TRUE pre-start count before reduction', e['n1'] == 3, e['n1'])

print('\n=== build_entry: misses are reasons, never guesses ===')
ck('no bet365 block', a.build_entry({'bookmakers': {}}, FX)[1] == 'no-bet365-block')
ck('no market 121', a.build_entry(
    {'bookmakers': {'bet365': {'markets': {'999': {}}}}}, FX)[1] == 'no-market-121')
ck('empty series', a.build_entry(payload([], []), FX)[1] == 'empty-series')
ck('market posted only after first ball -> no-prematch-points',
   a.build_entry(payload(inplay, inplay), FX)[1] == 'no-prematch-points')
ck('fixture with no start time is a miss, not an in-play close',
   a.build_entry(payload(pre, pre), {**FX, 'startTime': None, 'trueStartTime': None})[1] == 'no-start-time')

# ---------------------------------------------------------------------- scope
print('\n=== tier / completeness gating ===')
ck('ATP in scope', a.tier_of({'categoryName': 'ATP'}) == 'ATP')
ck('Challenger in scope', a.tier_of({'categoryName': 'Challenger'}) == 'Challenger')
ck('WTA 125K in scope by prefix', a.tier_of({'categoryName': 'WTA 125K'}) == 'WTA 125K')
ck('ITF Men excluded', a.tier_of({'categoryName': 'ITF Men'}) is None)
ck('UTR Men excluded', a.tier_of({'categoryName': 'UTR Men'}) is None)
ck('Simulated Reality excluded (synthetic junk)',
   a.tier_of({'categoryName': 'Simulated Reality'}) is None)

from datetime import datetime, timedelta, timezone
NOW = datetime(2026, 9, 10, tzinfo=timezone.utc)
ck('finished fixture (trueEndTime) is complete',
   a.is_complete({'trueEndTime': 'x', 'startTime': '2026-09-09T12:00:00Z'}, NOW))
ck('fixture started 8h ago is complete',
   a.is_complete({'startTime': (NOW - timedelta(hours=8)).isoformat()}, NOW))
ck('fixture started 1h ago is NOT complete (series can still grow)',
   not a.is_complete({'startTime': (NOW - timedelta(hours=1)).isoformat()}, NOW))
ck('future fixture is NOT complete',
   not a.is_complete({'startTime': (NOW + timedelta(hours=5)).isoformat()}, NOW))

print('\n' + ('ALL PASS' if not FAILS else f'{len(FAILS)} FAILURE(S): {FAILS}'))
sys.exit(1 if FAILS else 0)
