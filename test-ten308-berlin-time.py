#!/usr/bin/env python3
"""TEN-308 — the Python api-tennis sites read event_date/event_time as the Europe/Berlin
wall clock through the tz database (zoneinfo), never UTC and never a fixed +2.

Same cases as tools/test-ten308-berlin-time.js: a match on each side of the 25 Oct 2026
change and inside that day's 01:00-02:59 window. Each fails on the code it replaced:
refresh-scores read UTC (fails all), card_join and ten225-369-trace a fixed +2 (fail the
CET side), and the control below proves the cases discriminate.

    python3 test-ten308-berlin-time.py
"""
import importlib.util
import os
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'kibl-stream'))


def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, rel))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


CASES = [  # Berlin date, Berlin time, true UTC instant, what
    ('2026-10-24', '14:00', '2026-10-24T12:00:00+00:00', 'CEST side (24 Oct)'),
    ('2026-10-26', '14:00', '2026-10-26T13:00:00+00:00', 'CET side (26 Oct)'),
    ('2026-10-25', '01:30', '2026-10-24T23:30:00+00:00', '25 Oct 01:30 (CEST)'),
    ('2026-10-25', '02:30', '2026-10-25T00:30:00+00:00', '25 Oct 02:30 (repeated hour -> earlier)'),
    ('2026-10-26', '00:30', '2026-10-25T23:30:00+00:00', '26 Oct 00:30 (previous UTC day)'),
]
passed = failed = 0


def check(name, fn):
    global passed, failed
    try:
        fn()
        passed += 1
        print(f'  PASS  {name}')
    except Exception as e:  # noqa: BLE001
        failed += 1
        print(f'  FAIL  {name} :: {type(e).__name__}: {e}')


def iso_ms(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat() if ms is not None else None


def eq(got, want):
    assert got == want, f'{got!r} != {want!r}'


def control():
    old_utc = lambda d, t: datetime.fromisoformat(f'{d}T{t}:00+00:00').isoformat()  # noqa: E731
    old_plus2 = lambda d, t: (datetime.fromisoformat(f'{d}T{t}:00')  # noqa: E731
                              .replace(tzinfo=timezone(timedelta(hours=2))).astimezone(timezone.utc).isoformat())
    for name, f in (('utc', old_utc), ('+2', old_plus2)):
        assert any(f(d, t) != want for d, t, want, _ in CASES), f'old {name} reading passes every case'


print('TEN-308 · Python api-tennis sites on the Berlin wall clock\n')
check('control: the cases fail the old UTC and fixed +2 readings', control)

RS = load('refresh_scores', 'refresh-scores.py')
for d, t, want, what in CASES:
    check(f'refresh-scores _start_ms: {what}', lambda d=d, t=t, want=want: eq(iso_ms(RS._start_ms({'date': d, 'time': t})), want))
    check(f'refresh-scores _fixture_ms: {what}',
          lambda d=d, t=t, want=want: eq(iso_ms(RS._fixture_ms({'event_date': d, 'event_time': t})), want))
check('refresh-scores _start_ms: startTs still wins; no time still None', lambda: (
    eq(iso_ms(RS._start_ms({'date': '2026-10-26', 'time': '14:00', 'startTs': '2026-10-26T09:00:00Z'})), '2026-10-26T09:00:00+00:00'),
    eq(RS._start_ms({'date': '2026-10-26', 'time': ''}), None)))

CJ = load('card_join', 'kibl-stream/card_join.py')
for d, t, want, what in CASES:
    check(f'card_join card_start_utc: {what}', lambda d=d, t=t, want=want: eq(CJ.card_start_utc({'date': d, 'time': t}).isoformat(), want))

check('card_join card_start_utc: a startTs (UTC instant) wins over date/time', lambda: eq(
    CJ.card_start_utc({'date': '2026-10-26', 'time': '14:00', 'startTs': '2026-10-26T14:00:00Z'}).isoformat(), '2026-10-26T14:00:00+00:00'))

TR = load('ten225_369_trace', 'ten225-369-trace.py')
for d, t, want, what in CASES:
    check(f'ten225-369-trace apitennis_utc: {what}', lambda d=d, t=t, want=want: eq(TR.apitennis_utc(d, t).isoformat(), want))

print(f'\nRESULT: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
