#!/usr/bin/env python3
"""Offline unit tests for archive-oddspapi-raw.py (TEN-225 Part 1 item 1).

No network, no quota, no Supabase. These lock the four properties that would
otherwise corrupt the archive silently, and each one FAILS if the rule is
removed — they are not word-matches against the source.

  1. The settle window: a fixture less than 24h past its start is never pulled,
     because its payload is still growing.
  2. The founder's ORDER: everything that started in the last 7 days comes out
     of the queue before anything older. Getting this backwards means the
     densest, most perishable series are pulled last.
  3. The bucket is the checkpoint: a fixture already held is never re-queued.
     A re-pull can only return a worse copy (TEN-225 decay measurement).
  4. hasOdds is NOT a filter. It was false on 3,126 of 3,311 fixtures in the
     item-0 sample, so filtering on it would drop ~94% of the archive.
"""

import sys
from datetime import datetime, timedelta, timezone

import importlib.util
import os

spec = importlib.util.spec_from_file_location(
    'raw', os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        'archive-oddspapi-raw.py'))
raw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(raw)

NOW = datetime(2026, 9, 17, 12, 0, 0, tzinfo=timezone.utc)
FAILED = []


def check(name, got, want):
    if got == want:
        print(f'  ok   {name}')
    else:
        print(f'  FAIL {name}: got {got!r}, want {want!r}')
        FAILED.append(name)


def fx(fid, hours_ago, has_odds=True, cat='ATP'):
    st = NOW - timedelta(hours=hours_ago)
    return {'fixtureId': fid,
            'startTime': st.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'trueStartTime': st.strftime('%Y-%m-%dT%H:%M:%S.000Z'),
            'categoryName': cat, 'hasOdds': has_odds}


print('settle window')
# 2h and 23h past start are still live or just-finished; 25h is settled.
q, _, waiting = raw.build_queue([fx('a', 2), fx('b', 23), fx('c', 25)], set(), NOW)
check('inside 24h excluded', [f['fixtureId'] for f in q], ['c'])
check('waiting counted', waiting, 2)

print('founder ordering — last 7 days first')
# Deliberately fed oldest-first so a stable sort could not fake the answer.
targets = [fx('old-90d', 24 * 90), fx('old-30d', 24 * 30),
           fx('new-2d', 48), fx('new-6d', 24 * 6)]
q, priority, _ = raw.build_queue(targets, set(), NOW)
check('priority band is the last 7 days',
      sorted(f['fixtureId'] for f in priority), ['new-2d', 'new-6d'])
check('queue puts both recent fixtures ahead of both old ones',
      [f['fixtureId'] for f in q], ['new-2d', 'new-6d', 'old-30d', 'old-90d'])

print('the bucket is the checkpoint')
q, _, _ = raw.build_queue(targets, {'new-2d', 'old-30d'}, NOW)
check('held fixtures are never re-queued',
      [f['fixtureId'] for f in q], ['new-6d', 'old-90d'])
q, _, _ = raw.build_queue(targets, {f['fixtureId'] for f in targets}, NOW)
check('a fully-held target list queues nothing', q, [])

print('hasOdds is not a filter')
q, _, _ = raw.build_queue([fx('no-odds-flag', 48, has_odds=False),
                           fx('odds-flag', 48, has_odds=True)], set(), NOW)
check('hasOdds=False is kept',
      sorted(f['fixtureId'] for f in q), ['no-odds-flag', 'odds-flag'])

print('object path')
check('month comes from the true start',
      raw.object_path(fx('id999', 24 * 100)), '2026-06/id999.json.gz')
# A fixture with no usable start must not silently land in a real month.
check('unknown start is quarantined, not guessed',
      raw.object_path({'fixtureId': 'id000', 'startTime': None,
                       'trueStartTime': None}), 'unknown/id000.json.gz')

print('start_of prefers the observed first ball over the schedule')
sched = {'fixtureId': 'x', 'startTime': '2026-09-01T10:00:00Z',
         'trueStartTime': '2026-09-01T10:42:00Z'}
check('trueStartTime wins', raw.start_of(sched).minute, 42)
check('startTime is the fallback',
      raw.start_of({'fixtureId': 'x', 'startTime': '2026-09-01T10:00:00Z',
                    'trueStartTime': None}).minute, 0)

print()
if FAILED:
    print(f'{len(FAILED)} FAILED: {FAILED}')
    sys.exit(1)
print('all tests passed')
