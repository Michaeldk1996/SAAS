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


# resolve_start()'s 6-tuple, spelled out so the payload tests stay readable.
def OD(ts):
    """A clean oddspapi start: accepted trueStartTime, no flip, no conflict."""
    return (ts, 'oddspapi', None, False, None, None)


NOSTART = (None, 'none', None, False, None, None)


def FLIP(ts, gap):
    """A start that fell through to the live-flip lower bound."""
    return (ts, 'api-tennis-live', None, False, None, gap)


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
rows, st = L.summarise_payload(payload(m), 'idTEST', OD(START), START + DAY, CAT)
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
rows2, _ = L.summarise_payload(payload(m2), 'idTEST', OD(START), START + DAY, CAT)
r2 = rows2[0]
check('in-play tick is not the close', r2['close_price'] == 1.44)
check('in-play tick is not counted pre-start', r2['pre_start_tick_count'] == 1)

# A leaf that only ever traded in-play is not an Open/Close series at all.
m3 = mk('121', '121', [tick(+600, 1.10), tick(+1200, 1.02)])
rows3, st3 = L.summarise_payload(payload(m3), 'idTEST', OD(START), START + DAY, CAT)
check('in-play-only leaf produces NO row', rows3 == [] and st3['inplay_only_leaf'] == 1)

# Unreliable close: Open kept, close nulled, diagnostics kept.
rows4, _ = L.summarise_payload(payload(mk('121', '121',
                               [tick(-7200, 1.50), tick(-3600, 1.44)])),
                               'idTEST', OD(START), START + 120 * DAY, CAT)
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
                                 'idTEST', NOSTART, START + DAY, CAT)
r5 = rows5[0]
check('no start -> a row is still emitted with the Open', r5['open_price'] == 1.50)
check('no start -> start_ts_source is "none"', r5['start_ts_source'] == 'none')
check('no start -> close is NULL', r5['close_price'] is None)
check('no start -> pre_start_tick_count is NULL, not a guess',
      r5['pre_start_tick_count'] is None)
check('no start -> counted', st5['no_start_open_only'] == 1)

# An outcome the catalogue does not know must not be labelled with its raw id.
rows6, st6 = L.summarise_payload(payload(mk('121', '77777', [tick(-100, 1.5)])),
                                 'idTEST', OD(START), START + DAY, CAT)
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
    IDX_OLD = {'idOLD': {'cat': 'ATP', 'trueStart': L.iso(START),
                         'trueEnd': L.iso(START + 7200),
                         'startSched': L.iso(START)}}
    r_old, s_old, gen_old = L.summarise_history(old, CAT, IDX_OLD, {})
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
    IDX_NEW = {'idNEW': {'cat': 'ATP', 'trueStart': L.iso(START),
                         'trueEnd': L.iso(START + 7200),
                         'startSched': L.iso(START)}}
    r_new, _, _ = L.summarise_history(new, CAT, IDX_NEW, {})
    check('a 2-day-old month DOES yield a reliable close',
          r_new[0]['close_reliable'] is True and r_new[0]['close_price'] == 1.44)
    check('open and close are the ends of the series, not the same point',
          r_new[0]['open_price'] == 1.5 and r_new[0]['close_price'] == 1.44)

# ---------------------------------------------------------- resolve_start
# Michael's trueStartTime ruling, 2026-09-17T10:02Z, option (a).
#
# The fixtures below are pinned in ABSOLUTE units (5 h / 7 h against a 6 h rule,
# 3 min / 20 min against a 5 min rule) rather than derived from GATE_SECONDS and
# CONFLICT_MIN. That is the lesson the close-window tests learned the hard way:
# a fixture built FROM the constant moves with the constant and a mutation that
# widens the gate to 99 h passes every "just inside / just outside" pair.
print('\nresolve_start — Michael ruling 2026-09-17T10:02Z (6h gate, 5min conflict)')

H = 3600.0
SCHED = START
TRUE = START + 120.0            # started 2 min late: utterly normal

# --- limb 1: trueEnd - trueStart > 6h
ok5 = L.resolve_start(TRUE, TRUE + 5 * H, SCHED, None, None)
bad7 = L.resolve_start(TRUE, TRUE + 7 * H, SCHED, None, None)
check('a 5-hour match is ACCEPTED', ok5[0] == TRUE and ok5[1] == 'oddspapi')
check('a 5-hour match carries no reject reason', ok5[2] is None)
check('a 7-hour match is REJECTED', bad7[0] is None)
check('a 7-hour match -> start_ts_source "none" when there is no flip',
      bad7[1] == 'none')
check('a 7-hour match -> reason implausible_duration',
      bad7[2] == 'implausible_duration')

# The measured real case: trueStart the day BEFORE, 22.5h implied duration.
svajda = L.resolve_start(START - 17.8 * H, START + 4.7 * H, START, None, None)
check('the measured Svajda/Altmaier row (22.5h implied) is REJECTED',
      svajda[0] is None and svajda[2] == 'implausible_duration')

# --- limb 2: trueEnd missing -> trueStart more than 6h BEFORE startTime
e5 = L.resolve_start(SCHED - 5 * H, None, SCHED, None, None)
e7 = L.resolve_start(SCHED - 7 * H, None, SCHED, None, None)
check('no trueEnd, 5h early, is ACCEPTED', e5[0] == SCHED - 5 * H)
check('no trueEnd, 7h early, is REJECTED', e7[0] is None)
check('no trueEnd, 7h early -> reason implausible_early_start',
      e7[2] == 'implausible_early_start')
# Direction matters: 7h LATE than scheduled is a delay, not an impossibility.
late = L.resolve_start(SCHED + 7 * H, None, SCHED, None, None)
check('a 7-hour rain DELAY is accepted, not rejected (sign is not symmetric)',
      late[0] == SCHED + 7 * H and late[2] is None)
# Michael's own note: being tens of minutes early is normal in this feed.
check('45 minutes early is accepted (p05 of the real distribution)',
      L.resolve_start(SCHED - 2700, None, SCHED, None, None)[0] is not None)

# --- the fall-through
FLIP_TS = START + 300.0
resc = L.resolve_start(TRUE, TRUE + 7 * H, SCHED, FLIP_TS, 12.0)
check('a REJECTED start falls through to the live-flip bound',
      resc[0] == FLIP_TS and resc[1] == 'api-tennis-live')
check('the fall-through KEEPS the reject reason on the row',
      resc[2] == 'implausible_duration')
check('the fall-through carries the flip gap', resc[5] == 12.0)
check('no trueStart and no flip -> dash, source none',
      L.resolve_start(None, None, SCHED, None, None)[:2] == (None, 'none'))
check('no trueStart but a flip -> the flip bound',
      L.resolve_start(None, None, SCHED, FLIP_TS, 9.0)[:2]
      == (FLIP_TS, 'api-tennis-live'))

# --- item 2: the cross-check
near = L.resolve_start(TRUE, TRUE + H, SCHED, TRUE - 180.0, 10.0)   # 3 min apart
check('3 minutes apart is NOT flagged', near[3] is False and near[4] is None)
check('3 minutes apart keeps the oddswapi start', near[0] == TRUE)

# flip EARLIER by 20 min -> the flip wins and the row is flagged
fe = L.resolve_start(TRUE, TRUE + H, SCHED, TRUE - 20 * 60, 10.0)
check('20 min apart, flip earlier -> the EARLIER (flip) is used',
      fe[0] == TRUE - 20 * 60 and fe[1] == 'api-tennis-live')
check('20 min apart -> start_conflict is flagged', fe[3] is True)
check('conflict_minutes is signed trueStart-minus-flip (+20 here)',
      abs(fe[4] - 20.0) < 1e-6, f'got {fe[4]}')

# oddspapi EARLIER by 20 min -> oddspapi wins, still flagged
oe = L.resolve_start(TRUE, TRUE + H, SCHED, TRUE + 20 * 60, 10.0)
check('20 min apart, oddspapi earlier -> the EARLIER (oddspapi) is used',
      oe[0] == TRUE and oe[1] == 'oddspapi')
check('20 min apart, oddspapi earlier -> still flagged', oe[3] is True)
check('conflict_minutes is negative when oddspapi is earlier',
      abs(oe[4] + 20.0) < 1e-6, f'got {oe[4]}')

# THE SAFETY PROPERTY, stated as its own assertion: the chosen cutoff is never
# later than either candidate, so it can only miss pre-start ticks.
for a_, b_ in ((TRUE, TRUE - 20 * 60), (TRUE, TRUE + 20 * 60),
               (TRUE, TRUE - 3 * 60)):
    got = L.resolve_start(a_, a_ + H, SCHED, b_, 10.0)[0]
    check(f'cutoff <= both candidates ({int((a_-b_)/60)} min apart)',
          got <= a_ + 1e-9 and got <= max(a_, b_) + 1e-9, f'got {got}')

# --- item 3: a live-flip Close needs gap_seconds <= 300 ON TOP of the rest
arch2 = START + 1 * DAY
good_lag = START - 30 * 60          # 30 min before start: inside the 60 min rule
r_od, _ = L.judge_close(START, good_lag, arch2, 'oddspapi', None)
r_f_ok, _ = L.judge_close(START, good_lag, arch2, 'api-tennis-live', 120.0)
r_f_wide, _ = L.judge_close(START, good_lag, arch2, 'api-tennis-live', 600.0)
r_f_none, _ = L.judge_close(START, good_lag, arch2, 'api-tennis-live', None)
check('oddspapi close with a good lag is reliable', r_od is True)
check('live-flip close with a 120 s gap is reliable', r_f_ok is True)
check('live-flip close with a 600 s gap is NOT reliable', r_f_wide is False)
check('live-flip close with an UNKNOWN gap is NOT reliable (absence != pass)',
      r_f_none is False)
check('the gap rule pins 300 s absolutely (a 301 s gap fails)',
      L.judge_close(START, good_lag, arch2, 'api-tennis-live', 301.0)[0] is False)
check('...and a 299 s gap passes',
      L.judge_close(START, good_lag, arch2, 'api-tennis-live', 299.0)[0] is True)
# The gap rule must not rescue a close that fails the LAG rule.
check('a wide lag is still rejected even with a tiny flip gap',
      L.judge_close(START, START - 90 * 60, arch2, 'api-tennis-live', 5.0)[0]
      is False)

# --- a flip-sourced row end to end
rows_f, _ = L.summarise_payload(
    payload(mk('121', '121', [tick(-7200, 1.50), tick(-60, 1.44)])),
    'idTEST', FLIP(START, 45.0), START + DAY, CAT)
rf = rows_f[0]
check('flip-sourced row is labelled start_ts_source=api-tennis-live',
      rf['start_ts_source'] == 'api-tennis-live')
check('flip-sourced row carries flip_gap_seconds', rf['flip_gap_seconds'] == 45.0)
check('flip-sourced row with a 45 s gap keeps its close',
      rf['close_reliable'] is True and rf['close_price'] == 1.44)

rows_fw, _ = L.summarise_payload(
    payload(mk('121', '121', [tick(-7200, 1.50), tick(-60, 1.44)])),
    'idTEST', FLIP(START, 900.0), START + DAY, CAT)
check('flip-sourced row with a 900 s gap DASHES the close but keeps Open',
      rows_fw[0]['close_price'] is None and rows_fw[0]['open_price'] == 1.50)

# --- the reject reason reaches the row even when there is no start at all
rows_r, _ = L.summarise_payload(
    payload(mk('121', '121', [tick(-7200, 1.50)])), 'idTEST',
    (None, 'none', 'implausible_duration', False, None, None),
    START + DAY, CAT)
check('a dashed row carries WHY it dashed',
      rows_r[0]['start_reject_reason'] == 'implausible_duration')
check('a dashed row still keeps its Open', rows_r[0]['open_price'] == 1.50)

# ------------------------------------------- the scheduled-time regression
# archive-bet365-history.py collapses `trueStartTime or startTime` into one
# `start` field, so the month files bake in the SCHEDULED time whenever
# trueStartTime is absent (466 of 12,995 joinable fixtures, 3.59%, measured
# 2026-09-17). Michael's locked definition forbids the scheduled time as a
# start. This locks the loader onto the INDEX instead of that field.
print('\nsummarise_history — the scheduled-time start must not be used')

with tempfile.TemporaryDirectory() as td:
    mf = os.path.join(td, '2026-09.json')
    # The file says the match started at START. The index says there is NO
    # trueStartTime — so START can only have come from the scheduled slot.
    json.dump({'book': 'bet365', 'market': 121,
               'generatedAt': L.iso(START + 2 * DAY),
               'fixtures': {'idSCHED': {'start': int(START), 'cat': 'ATP',
                                        's1': [[int(START - 7200), 1.5],
                                               [int(START - 60), 1.44]]}}},
              open(mf, 'w'))
    idx_nostart = {'idSCHED': {'cat': 'ATP', 'trueStart': None, 'trueEnd': None,
                               'startSched': L.iso(START)}}
    r_s, s_s, _ = L.summarise_history(mf, CAT, idx_nostart, {})
    check('a fixture with no trueStart gets NO close, even though the month '
          'file carries a usable `start`',
          r_s[0]['close_price'] is None and r_s[0]['close_reliable'] is False)
    check('...and is labelled start_ts_source "none", not "oddspapi"',
          r_s[0]['start_ts_source'] == 'none')
    check('...and keeps its Open', r_s[0]['open_price'] == 1.5)

    # Same file, but now a live flip exists -> the close comes back, labelled.
    flips = {'idSCHED': (START, 30.0)}
    r_f2, _, _ = L.summarise_history(mf, CAT, idx_nostart, flips)
    check('with a live-flip bound the close is recovered',
          r_f2[0]['close_price'] == 1.44)
    check('...labelled api-tennis-live, not oddspapi',
          r_f2[0]['start_ts_source'] == 'api-tennis-live')

    # THE IN-PLAY-CLOSE TRAP. bet365-history's series is pre-start only by the
    # OLD start. Under a corrected or earlier start (a rejected trueStartTime
    # falling through to the flip, or the cross-check picking the earlier of
    # two) the tail of the series can sit AFTER the real start — so the close
    # must be re-cut, never taken as series[-1]. The mutation control found this
    # unlocked: replacing the re-cut with `list(series)` passed every other
    # assertion in this file.
    ip = os.path.join(td, '2026-09b.json')
    json.dump({'book': 'bet365', 'market': 121,
               'generatedAt': L.iso(START + 2 * DAY),
               'fixtures': {'idIP': {'start': int(START + 3600), 'cat': 'ATP',
                                     's1': [[int(START - 7200), 1.50],
                                            [int(START - 60), 1.44],
                                            [int(START + 600), 1.10]]}}},
              open(ip, 'w'))
    idx_ip = {'idIP': {'cat': 'ATP', 'trueStart': None, 'trueEnd': None,
                       'startSched': L.iso(START + 3600)}}
    r_ip, s_ip, _ = L.summarise_history(ip, CAT, idx_ip, {'idIP': (START, 30.0)})
    check('the close is re-cut at the REAL start, not taken as series[-1]',
          r_ip[0]['close_price'] == 1.44, f'got {r_ip[0]["close_price"]}')
    check('...so the 1.10 in-play price never becomes a Close',
          r_ip[0]['close_price'] != 1.10)
    check('pre_start_tick_count counts the RE-CUT series (2, not 3)',
          r_ip[0]['pre_start_tick_count'] == 2,
          f'got {r_ip[0]["pre_start_tick_count"]}')

    # And when the corrected start precedes EVERY tick, there is no close at
    # all — Open is kept and the row says so, rather than inventing one.
    allip = os.path.join(td, '2026-09c.json')
    json.dump({'book': 'bet365', 'market': 121,
               'generatedAt': L.iso(START + 2 * DAY),
               'fixtures': {'idAllIP': {'start': int(START + DAY), 'cat': 'ATP',
                                        's1': [[int(START + 600), 1.10],
                                               [int(START + 900), 1.05]]}}},
              open(allip, 'w'))
    idx_aip = {'idAllIP': {'cat': 'ATP', 'trueStart': None, 'trueEnd': None,
                           'startSched': L.iso(START + DAY)}}
    r_aip, s_aip, _ = L.summarise_history(allip, CAT, idx_aip,
                                          {'idAllIP': (START, 30.0)})
    check('a series that is entirely in-play yields NO close',
          r_aip[0]['close_price'] is None and r_aip[0]['close_reliable'] is False)
    check('...but still keeps the Open', r_aip[0]['open_price'] == 1.10)
    check('...and counts zero pre-start ticks, not NULL',
          r_aip[0]['pre_start_tick_count'] == 0)
    check('...and is counted as no_pre_start_tick', s_aip['no_pre_start_tick'] == 1)

# ------------------------------------------------------------- pair_flips
print('\npair_flips — NFD strip, surname key, drop on ambiguity')

IDX_P = {
    'idA': {'cat': 'ATP', 'trueStart': '2026-09-10T12:00:00Z',
            'startSched': '2026-09-10T12:00:00Z',
            'p1': 'Zverev, Alexander', 'p2': 'Alcaraz, Carlos'},
    'idB': {'cat': 'ATP', 'trueStart': '2026-09-10T14:00:00Z',
            'startSched': '2026-09-10T14:00:00Z',
            'p1': 'Muller, Alexandre', 'p2': 'Medvedev, Daniil'},
}


def flip_row(d, p1, p2, lnl, gap=10.0):
    return {'event_date': d, 'first_player': p1, 'second_player': p2,
            'last_not_live_seen_at': lnl, 'gap_seconds': gap}


pf, pst = L.pair_flips(IDX_P, [
    flip_row('2026-09-10', 'A. Zverev', 'C. Alcaraz', '2026-09-10T12:01:00Z'),
])
check('a name-order-different, initial-only flip pairs', pf.get('idA') is not None)
check('the paired value is the lower bound, not first_live',
      pf['idA'][0] == L.epoch('2026-09-10T12:01:00Z'))

pf2, _ = L.pair_flips(IDX_P, [
    flip_row('2026-09-10', 'Alexandre Müller', 'Daniil Medvedev',
             '2026-09-10T14:01:00Z'),
])
check('an ACCENTED name pairs after the NFD strip (Müller -> muller)',
      pf2.get('idB') is not None)

# Ambiguity on the oddspapi side: two fixtures, same players, same day.
IDX_AMB = dict(IDX_P)
IDX_AMB['idA2'] = dict(IDX_P['idA'])
pf3, pst3 = L.pair_flips(IDX_AMB, [
    flip_row('2026-09-10', 'A. Zverev', 'C. Alcaraz', '2026-09-10T12:01:00Z'),
])
check('two fixtures with the same players on one day pair to NEITHER',
      'idA' not in pf3 and 'idA2' not in pf3)
check('...and the drop is counted', pst3['dropped_ambiguous'] == 1)

# Ambiguity on the flip side: two flips claiming one fixture.
pf4, pst4 = L.pair_flips(IDX_P, [
    flip_row('2026-09-10', 'A. Zverev', 'C. Alcaraz', '2026-09-10T12:01:00Z'),
    flip_row('2026-09-10', 'Alexander Zverev', 'Carlos Alcaraz',
             '2026-09-10T12:05:00Z'),
])
check('two flips claiming one fixture pair to NEITHER', 'idA' not in pf4)

pf5, pst5 = L.pair_flips(IDX_P, [
    flip_row('2026-09-10', 'N. Djokovic', 'J. Sinner', '2026-09-10T12:01:00Z'),
])
check('a flip with no matching fixture is unpaired and counted',
      pf5 == {} and pst5['flip_unpaired'] == 1)

# Near-midnight: the flip is logged on the next calendar day.
pf6, _ = L.pair_flips(
    {'idM': {'cat': 'ATP', 'trueStart': '2026-09-10T23:50:00Z',
             'startSched': '2026-09-10T23:50:00Z',
             'p1': 'Zverev, Alexander', 'p2': 'Alcaraz, Carlos'}},
    [flip_row('2026-09-11', 'A. Zverev', 'C. Alcaraz', '2026-09-10T23:51:00Z')])
check('a flip logged on the neighbouring day still pairs', pf6.get('idM') is not None)

check('a flip with no lower bound is unusable, never paired as now()',
      L.pair_flips(IDX_P, [flip_row('2026-09-10', 'A. Zverev', 'C. Alcaraz',
                                    None)])[1]['flip_unusable'] == 1)

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
