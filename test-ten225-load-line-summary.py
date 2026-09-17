#!/usr/bin/env python3
"""TEN-225 — offline harness for ten225-load-line-summary.py.

No network, no Supabase, no odds-API call. Runs in the workflow BEFORE the
loader touches the instance, so a broken rule fails the job instead of writing
wrong rows into a new table.

WHAT IS ACTUALLY LOCKED HERE
----------------------------
Every assertion is written against an expectation derived independently of the
code under test. The first draft of this file got that wrong and the mutation
control caught it: the close-window tests built their fixtures FROM
`RELIABLE_DAYS`/`RELIABLE_LAG_MIN`, so the fixtures moved with the constant and
a mutation widening the lag window to 99999 minutes passed all of them. Those
relative boundary checks are kept (they prove the comparison is the right way
round) but the ruled numbers are now ALSO pinned in absolute units — 30 min
reliable / 90 min not, 10 days reliable / 30 days not — which only a 60-minute
and 21-day rule satisfies.

MUTATION CONTROL — this harness is verified to fail. Nine mutations were run
against the loader and all nine were caught: lag window -> 99999 and -> 120,
age window -> 30d and -> 999d, dropping the /v4/markets.handicap join, giving
match winner the catalogue's 0.0 line, taking the close from in-play ticks,
not nulling an unreliable close, and accepting a fixture archived before its
start. Re-run that control after editing either file.

The grain test is the one that matters most: two Game Handicap markets differ
ONLY by their marketId, and it is the /v4/markets.handicap join that turns them
into two rows. Without it they collapse to one key and silently overwrite each
other under UNIQUE NULLS NOT DISTINCT. That is a data-loss bug that no amount
of reading the loader would surface.

The grain test is the one that matters most: two Game Handicap markets differ
ONLY by their marketId, and it is the /v4/markets.handicap join that turns them
into two rows. Without it they collapse to one key and silently overwrite each
other under UNIQUE NULLS NOT DISTINCT. That is a data-loss bug that no amount
of reading the loader would surface.
"""
import importlib.util
import json
import os
import sys
import tempfile
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    'loader', os.path.join(HERE, 'ten225-load-line-summary.py'))
L = importlib.util.module_from_spec(spec)
sys.argv = ['loader']
spec.loader.exec_module(L)

FAILED = []


def check(name, cond, detail=''):
    if cond:
        print(f'  ok   {name}')
    else:
        print(f'  FAIL {name} {detail}')
        FAILED.append(name)


DAY = 86400.0
START = datetime(2026, 9, 10, 12, 0, tzinfo=timezone.utc).timestamp()

# A catalogue shaped exactly like the committed one, with two Game Handicap
# markets that differ only in their handicap.
CAT = {
    '121':   {'name': 'Winner', 'handicap': 0.0,
              'outcomes': {'121': '1', '122': '2'}},
    '12149': {'name': 'Game Handicap', 'handicap': -10.0,
              'outcomes': {'12149': '1', '12150': '2'}},
    '12151': {'name': 'Game Handicap', 'handicap': -9.5,
              'outcomes': {'12151': '1', '12152': '2'}},
    '12300': {'name': 'Total Games Over Under', 'handicap': 22.5,
              'outcomes': {'12300': 'Over', '12301': 'Under'}},
    '9999':  {'name': 'Total Aces', 'handicap': 0.0,
              'outcomes': {'9999': 'Over'}},
}


def tick(offset_s, price):
    return {'createdAt': L.iso(START + offset_s), 'price': price,
            'limit': None, 'active': True, 'exchangeMeta': None}


def payload(markets):
    return {'fixtureId': 'idTEST', 'bookmakers': {'bet365': {'markets': markets}}}


def mk(mid, oid, ticks):
    return {mid: {'outcomes': {oid: {'players': {'0': ticks}}}}}


# ---------------------------------------------------------------- judge_close
print('judge_close — Michael ruling 2 (21 days AND lag <= 60 min)')

# Boundary on the LAG, with the archive age held comfortably inside.
arch = START + 1 * DAY
ok_in, lag_in = L.judge_close(START, START - (L.RELIABLE_LAG_MIN - 1) * 60, arch)
ok_out, lag_out = L.judge_close(START, START - (L.RELIABLE_LAG_MIN + 1) * 60, arch)
check('lag just inside the window is reliable', ok_in is True, f'lag={lag_in}')
check('lag just outside the window is NOT reliable', ok_out is False, f'lag={lag_out}')
check('lag is returned even when the close is rejected', lag_out is not None)
check('lag sign is start-minus-close (positive before the start)',
      lag_in > 0 and abs(lag_in - (L.RELIABLE_LAG_MIN - 1)) < 1e-6, f'{lag_in}')

# The three checks above derive their fixtures FROM RELIABLE_LAG_MIN, so they
# move with it and pass on any value — a mutation setting the window to 99999
# survived them. These pin the ruled number in absolute minutes instead: a
# close 30 min before the start is reliable, one 90 min before is not, and
# only a 60-minute window satisfies both.
ok_30, _ = L.judge_close(START, START - 30 * 60, arch)
ok_90, _ = L.judge_close(START, START - 90 * 60, arch)
check('a close 30 min before the start is reliable (ruled window is 60)',
      ok_30 is True)
check('a close 90 min before the start is NOT reliable (ruled window is 60)',
      ok_90 is False)

# Boundary on the ARCHIVE AGE, with the lag held comfortably inside.
close = START - 60          # one minute before the start
ok_young, _ = L.judge_close(START, close, START + (L.RELIABLE_DAYS - 1) * DAY)
ok_old, lag_old = L.judge_close(START, close, START + (L.RELIABLE_DAYS + 1) * DAY)
check('archived just inside 21 days is reliable', ok_young is True)
check('archived just outside 21 days is NOT reliable', ok_old is False)
check('lag survives an age rejection (ruling 4 needs it to retune)',
      lag_old is not None)

# Same trap on the age side: pin 21 days in absolute days, not in multiples of
# the constant. A mutation to 30 days would slip past a 120-day test alone.
ok_10d, _ = L.judge_close(START, close, START + 10 * DAY)
ok_30d, _ = L.judge_close(START, close, START + 30 * DAY)
check('archived 10 days after the start is reliable (ruled window is 21)',
      ok_10d is True)
check('archived 30 days after the start is NOT reliable (ruled window is 21)',
      ok_30d is False)

# The Mar-May bet365-history case, stated as a real age rather than a constant.
ok_may, _ = L.judge_close(START, close, START + 120 * DAY)
check('a 4-month-old capture is NOT reliable (Mar-May copies)', ok_may is False)

# Archived BEFORE the start: the series is still open, so there is no close.
ok_pre, _ = L.judge_close(START, close, START - 2 * DAY)
check('archived before the start is NOT reliable', ok_pre is False)

# Unknowables.
check('no start -> not reliable, no lag', L.judge_close(None, close, arch) == (False, None))
check('no close -> not reliable, no lag', L.judge_close(START, None, arch) == (False, None))
check('no archived_at -> not reliable but lag still computed',
      L.judge_close(START, close, None)[0] is False
      and L.judge_close(START, close, None)[1] is not None)

# --------------------------------------------------------- summarise_payload
print('\nsummarise_payload — grain, line join, keep-list, in-play')

m = {}
m.update(mk('121', '121', [tick(-7200, 1.50), tick(-3600, 1.44), tick(-600, 1.40)]))
m.update(mk('12149', '12149', [tick(-5000, 1.90), tick(-700, 1.95)]))
m.update(mk('12151', '12151', [tick(-5000, 2.10), tick(-700, 2.05)]))
m.update(mk('12300', '12300', [tick(-4000, 1.83)]))
m.update(mk('9999', '9999', [tick(-4000, 1.83)]))          # out of keep-list
rows, st = L.summarise_payload(payload(m), 'idTEST', START, START + DAY, CAT)
by = {(r['market'], r['side'], r['line']): r for r in rows}

check('out-of-keeplist family produces no row',
      st['out_of_keeplist'] == 1 and not any(r['market'] == 'Total Aces' for r in rows))
check('match winner line is NULL, never the catalogue 0.0',
      ('match winner', '1', None) in by)
check('two Game Handicap lines are TWO rows, not one',
      ('games handicap', '1', -10.0) in by and ('games handicap', '1', -9.5) in by,
      f'got {sorted(k for k in by if k[0] == "games handicap")}')
check('the ruled grain is unique across the payload',
      len({(r['fixture_id'], r['book'], r['market'], r['side'], r['line'])
           for r in rows}) == len(rows))
check('total games carries its line',
      ('total games', 'Over', 22.5) in by,
      f'got {sorted(k for k in by if k[0] == "total games")}')
check('side is the outcome NAME, not the id', ('match winner', '1', None) in by)

# .get, not [] — a missing key here is a FAIL to be reported alongside the rest,
# not a traceback that hides every check after it.
mw = by.get(('match winner', '1', None)) or {}
check('open is the FIRST tick', mw.get('open_price') == 1.50)
check('close is the LAST pre-start tick', mw.get('close_price') == 1.40)
check('pre_start_tick_count counts pre-start ticks only', mw.get('pre_start_tick_count') == 3)
check('first_tick_ts == open_ts by construction', mw.get('first_tick_ts') == mw.get('open_ts'))
check('start_ts_source is oddspapi when a true start exists',
      mw.get('start_ts_source') == 'oddspapi')
check('close_reliable true inside both windows', mw.get('close_reliable') is True)

# In-play ticks must not become the close.
m2 = mk('121', '121', [tick(-3600, 1.44), tick(+600, 1.10), tick(+1200, 1.02)])
rows2, _ = L.summarise_payload(payload(m2), 'idTEST', START, START + DAY, CAT)
r2 = rows2[0]
check('in-play tick is not the close', r2['close_price'] == 1.44)
check('in-play tick is not counted pre-start', r2['pre_start_tick_count'] == 1)

# A leaf that only ever traded in-play is not an Open/Close series at all.
m3 = mk('121', '121', [tick(+600, 1.10), tick(+1200, 1.02)])
rows3, st3 = L.summarise_payload(payload(m3), 'idTEST', START, START + DAY, CAT)
check('in-play-only leaf produces NO row', rows3 == [] and st3['inplay_only_leaf'] == 1)

# Unreliable close: Open kept, close nulled, diagnostics kept.
rows4, _ = L.summarise_payload(payload(mk('121', '121',
                               [tick(-7200, 1.50), tick(-3600, 1.44)])),
                               'idTEST', START, START + 120 * DAY, CAT)
r4 = rows4[0]
check('unreliable close -> close_price NULL', r4['close_price'] is None)
check('unreliable close -> close_ts NULL', r4['close_ts'] is None)
check('unreliable close -> Open is KEPT', r4['open_price'] == 1.50)
check('unreliable close -> last_pre_start_tick_ts survives',
      r4['last_pre_start_tick_ts'] is not None)
check('unreliable close -> close_lag_minutes survives',
      r4['close_lag_minutes'] is not None)

# No trueStartTime (40.15% of the sweep): Open only, never the scheduled time.
rows5, st5 = L.summarise_payload(payload(mk('121', '121',
                                 [tick(-7200, 1.50), tick(+600, 1.10)])),
                                 'idTEST', None, START + DAY, CAT)
r5 = rows5[0]
check('no start -> a row is still emitted with the Open', r5['open_price'] == 1.50)
check('no start -> start_ts_source is "none"', r5['start_ts_source'] == 'none')
check('no start -> close is NULL', r5['close_price'] is None)
check('no start -> pre_start_tick_count is NULL, not a guess',
      r5['pre_start_tick_count'] is None)
check('no start -> counted', st5['no_start_open_only'] == 1)

# An outcome the catalogue does not know must not be labelled with its raw id.
rows6, st6 = L.summarise_payload(payload(mk('121', '77777', [tick(-100, 1.5)])),
                                 'idTEST', START, START + DAY, CAT)
check('unknown outcome id is dropped and counted, never used as a side label',
      rows6 == [] and st6['outcome_not_in_catalogue'] == 1)

# --------------------------------------------------------- summarise_history
print('\nsummarise_history — bet365-history months')

with tempfile.TemporaryDirectory() as td:
    # Generated 4 months after the fixture: fails the 21-day rule.
    old = os.path.join(td, '2026-05.json')
    json.dump({'book': 'bet365', 'market': 121,
               'generatedAt': L.iso(START + 120 * DAY),
               'fixtures': {'idOLD': {'start': int(START), 'cat': 'ATP',
                                      's1': [[int(START - 7200), 1.5],
                                             [int(START - 60), 1.44]],
                                      's2': [[int(START - 7200), 2.6]]}}},
              open(old, 'w'))
    r_old, s_old, gen_old = L.summarise_history(old, CAT)
    check('a 4-month-old month yields NO reliable close',
          all(not r['close_reliable'] for r in r_old))
    check('...but keeps every Open',
          sorted(r['open_price'] for r in r_old) == [1.5, 2.6])
    check('both sides become rows', len(r_old) == 2)
    check('history rows are labelled source=bet365-history',
          all(r['source'] == 'bet365-history' for r in r_old))
    check('history rows carry a NULL line (match winner)',
          all(r['line'] is None for r in r_old))

    # Generated 2 days after the fixture: passes.
    new = os.path.join(td, '2026-09.json')
    json.dump({'book': 'bet365', 'market': 121,
               'generatedAt': L.iso(START + 2 * DAY),
               'fixtures': {'idNEW': {'start': int(START), 'cat': 'ATP',
                                      's1': [[int(START - 7200), 1.5],
                                             [int(START - 60), 1.44]]}}},
              open(new, 'w'))
    r_new, _, _ = L.summarise_history(new, CAT)
    check('a 2-day-old month DOES yield a reliable close',
          r_new[0]['close_reliable'] is True and r_new[0]['close_price'] == 1.44)
    check('open and close are the ends of the series, not the same point',
          r_new[0]['open_price'] == 1.5 and r_new[0]['close_price'] == 1.44)

# ------------------------------------------------------- catalogue integrity
print('\ncommitted catalogue')
cat = L.load_catalogue()
check('committed tennis catalogue loads', cat is not None)
if cat:
    fams = {}
    for meta in cat.values():
        f = L.KEEP_FAMILIES.get(meta.get('name'))
        if f:
            fams.setdefault(f, set()).add(meta.get('handicap'))
    check('all four ruled families are present in the catalogue',
          set(fams) == set(L.KEEP_FAMILIES.values()),
          f'got {sorted(fams)}')
    check('games handicap carries MANY distinct lines (the join is load-bearing)',
          len(fams.get('games handicap', ())) > 10,
          f'{len(fams.get("games handicap", ()))} distinct')
    check('match winner market 121 has outcomes 1 and 2',
          sorted((cat.get('121') or {}).get('outcomes', {}).values()) == ['1', '2'])

print(f'\n{"FAILED: " + ", ".join(FAILED) if FAILED else "all checks passed"}')
sys.exit(1 if FAILED else 0)
