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
import types
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# STALE-BYTECODE GUARD — measured 2026-09-17, and it produced a FALSE PASS.
# macOS system python3.9 sets sys.pycache_prefix to ~/Library/Caches/com.apple.python,
# so a module loaded by path is cached OUTSIDE the repo where no `git clean` or
# `rm -rf __pycache__` ever reaches it. The validator is (mtime, size), and a
# mutation test that restores a same-size file inside the same second gets the
# MUTANT's bytecode back while the source on disk reads correct. That is the
# worst possible failure mode for a harness whose whole job is to bite.
# exec()ing the source text bypasses the bytecode path entirely.
sys.dont_write_bytecode = True
a = types.ModuleType('a')
a.__file__ = os.path.join(HERE, 'archive-bet365-history.py')
sys.argv = ['a']
exec(compile(open(a.__file__).read(), a.__file__, 'exec'), a.__dict__)

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
       all(p[0] <= e['cutTs'] for p in e['s1'] + e['s2']))
    ck('in-play points counted, not silently dropped', e['inplay'] == 4, e['inplay'])
    ck('n1 is the TRUE pre-start count before reduction', e['n1'] == 3, e['n1'])

print('\n=== build_entry: misses are reasons, never guesses ===')
ck('no bet365 block', a.build_entry({'bookmakers': {}}, FX)[1] == 'no-bet365-block')
ck('no market 121', a.build_entry(
    {'bookmakers': {'bet365': {'markets': {'999': {}}}}}, FX)[1] == 'no-market-121')
ck('empty series', a.build_entry(payload([], []), FX)[1] == 'empty-series')
ck('market posted only after first ball -> no-prematch-points',
   a.build_entry(payload(inplay, inplay), FX)[1] == 'no-prematch-points')

# ------------------------------------------- TRIPWIRE: ruling 2026-09-17T10:45Z
# item 2 — "It must never collapse trueStartTime and startTime into one field or
# cut Close at a scheduled time."
#
# The fixture below is the whole point: a REAL scheduled slot at 12:00 and NO
# trueStartTime. Under the old `trueStartTime or startTime` helper this cut the
# series at 12:00 and handed the 11:59 price out as a close. The measured size of
# that population was 466 of 12,995 joinable fixtures, 3.59% (2026-09-17).
print('\n=== TRIPWIRE: no observed start -> no close claim (ruling 10:45Z item 2) ===')
NO_TRUE = {**FX, 'trueStartTime': None}          # scheduled 12:00 survives

ck('close_cutoff() returns the observed start and NOTHING else',
   a.close_cutoff(FX) == '2026-09-01T12:00:00Z')
ck('close_cutoff() is None when trueStartTime is absent, even with a schedule',
   a.close_cutoff(NO_TRUE) is None, a.close_cutoff(NO_TRUE))
ck('close_cutoff() never returns the scheduled slot',
   a.close_cutoff({'startTime': '2026-09-01T12:00:00Z'}) is None)

ns, why_ns = a.build_entry(payload(pre + inplay, pre + inplay), NO_TRUE)
ck('an entry is still written (the Open does not depend on a cutoff)',
   ns is not None, why_ns)
if ns:
    ck('cut is marked "none" so no reader may treat the tail as a close',
       ns['cut'] == 'none', ns['cut'])
    ck('cutTs is null', ns['cutTs'] is None)
    ck('n1/n2 are null, not a count against a scheduled cut',
       ns['n1'] is None and ns['n2'] is None)
    ck('the Open survives and is still the first real point (3.0)',
       ns['s1'][0][1] == 3.0, ns['s1'][0])
    # The trap the old code fell into, asserted directly.
    ck('the series is NOT cut at the scheduled 12:00 (in-play points retained '
       'for a later re-cut, and visibly so)',
       ns['s1'][-1][1] == 1.06, ns['s1'][-1])
    ck('the collapsed `start` field is GONE from the entry',
       'start' not in ns, sorted(ns))
    ck('trueStart / trueEnd / startSched are three separate fields',
       ns['trueStart'] is None and ns['startSched'] is not None
       and 'trueEnd' in ns, {k: ns.get(k) for k in
                             ('trueStart', 'trueEnd', 'startSched')})

# ...and the same three fields on a normal, fully-timed fixture.
FULL = {**FX, 'trueStartTime': '2026-09-01T12:05:00Z',
        'trueEndTime': '2026-09-01T14:00:00Z'}
ef, _ = a.build_entry(payload(pre + inplay, pre + inplay), FULL)
ck('a fully-timed fixture keeps all three timestamps distinct',
   ef['trueStart'] != ef['startSched'] and ef['trueEnd'] > ef['trueStart'],
   {k: ef.get(k) for k in ('trueStart', 'trueEnd', 'startSched')})
ck('its cut is the trueStart, not the schedule',
   ef['cut'] == 'trueStart' and ef['cutTs'] == ef['trueStart'])
ck('the schema is bumped so readers can branch on it',
   a.SCHEMA == 'bet365-history/2', a.SCHEMA)

# completeness_ref IS allowed the scheduled fallback — and must stay a separate
# function, or the defect walks straight back in.
ck('completeness_ref() may fall back to the schedule (scheduling, not evidence)',
   a.completeness_ref(NO_TRUE) == '2026-09-01T12:00:00Z')
ck('completeness_ref and close_cutoff are NOT the same function',
   a.completeness_ref is not a.close_cutoff)

# ---------------------------------------------------------------------- scope
print('\n=== tier / completeness gating ===')
ck('ATP in scope', a.tier_of({'categoryName': 'ATP'}) == 'ATP')
ck('Challenger in scope', a.tier_of({'categoryName': 'Challenger'}) == 'Challenger')
ck('WTA 125K in scope by prefix', a.tier_of({'categoryName': 'WTA 125K'}) == 'WTA 125K')
ck('ITF Men in scope (founder ruling 2026-09-24)', a.tier_of({'categoryName': 'ITF Men'}) == 'ITF Men')
ck('Davis Cup in scope (founder ruling 2026-09-24)', a.tier_of({'categoryName': 'Davis Cup'}) == 'Davis Cup')
ck('ITF Women excluded', a.tier_of({'categoryName': 'ITF Women'}) is None)
ck('Billie Jean King Cup excluded', a.tier_of({'categoryName': 'Billie Jean King Cup'}) is None)
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

# ------------------------------------------ the shard label must not lie
# A shard is appended to for months and a fixture is never re-pulled, so a file
# written before the ruling keeps /1 entries forever while gaining /2 entries
# beside them. Stamping the whole file '/2' because the WRITER is new would be a
# lie in the one field a reader trusts to decide how to read the entries — and a
# /2 entry with cut:'none' read as /1 hands its uncut in-play tail out as a close.
print('\n=== shard schema label describes the CONTENTS, not the writer ===')
ck('a file of pre-ruling entries stays /1',
   a.shard_schema({'a': {'s1': []}, 'b': {'s1': []}}) == 'bet365-history/1',
   a.shard_schema({'a': {'s1': []}}))
ck('a file of post-ruling entries is /2',
   a.shard_schema({'a': {'cut': 'trueStart'}, 'b': {'cut': 'none'}})
   == 'bet365-history/2')
ck('a MIXED file is labelled /1+2, not silently promoted to /2',
   a.shard_schema({'a': {'cut': 'trueStart'}, 'b': {'s1': []}})
   == 'bet365-history/1+2',
   a.shard_schema({'a': {'cut': 'trueStart'}, 'b': {'s1': []}}))
ck('an empty file takes the current writer schema',
   a.shard_schema({}) == a.SCHEMA)
ck('cut:"none" still counts as a /2 entry (the FIELD is the marker, not its value)',
   a.shard_schema({'a': {'cut': 'none'}}) == 'bet365-history/2')

# save_shard must actually apply it, or the function above is decoration.
import json as _json, tempfile as _tmp, os as _os
_d = _tmp.mkdtemp()
_old_dir, a.OUT_DIR = a.OUT_DIR, _d
try:
    a.save_shard('2026-09', {'schema': 'bet365-history/1', 'month': '2026-09',
                             'fixtures': {'x': {'cut': 'trueStart'},
                                          'y': {'s1': []}}, 'misses': {}})
    _w = _json.load(open(_os.path.join(_d, '2026-09.json')))
    ck('save_shard REWRITES a stale /1 label on a file that now holds /2 entries',
       _w['schema'] == 'bet365-history/1+2', _w['schema'])
finally:
    a.OUT_DIR = _old_dir

print('\n' + ('ALL PASS' if not FAILS else f'{len(FAILS)} FAILURE(S): {FAILS}'))
sys.exit(1 if FAILS else 0)
