#!/usr/bin/env python3
"""TEN-179 item 4 (founder ruling 2026-09-11) — a zero-quota leg that bills FAILS.

    "The zero-quota guarantee goes red. An annotation in a green run is exactly what
     nobody read for nine days. Any spend on a leg guaranteed to cost nothing fails
     the run loudly."

Loads the SHIPPED refresh-odds-history.py (its main() is __main__-guarded, so importing
it is defs-only — the same trick refresh-odds.py uses) and drives first_appearance()
with a stubbed meter. Asserts the exit code, because the exit code is the only thing
that turns a GitHub run red.
"""
import importlib.util, json, os, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

spec = importlib.util.spec_from_file_location('hist', os.path.join(ROOT, 'refresh-odds-history.py'))
hist = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hist)

FAILED = []


def run_case(name, meter_before, meter_after, expect_rc):
    tmp = tempfile.mkdtemp()
    # An empty fixture-map makes the sweep do no network work at all: it returns
    # before any historical-odds call. The meter comparison is what we are testing,
    # so it is stubbed directly rather than provoked.
    matches_p = os.path.join(tmp, 'matches.json')
    json.dump([], open(matches_p, 'w'))
    fmap_p = os.path.join(tmp, 'odds-fixture-map.json')
    json.dump({'schema': 'odds-fixture-map/1',
               'byKey': {'k': {'fixtureId': 'fx1', 'orient': 'same',
                               'startTime': '2026-09-12T00:00:00.000Z'}}}, open(fmap_p, 'w'))

    reads = iter([meter_before, meter_after])
    saved = (hist.read_key, hist.log_quota, hist.MATCHES, hist.FIXTURE_MAP_FILE,
             hist.seed_from_live, hist.write_matches, hist.open_monitor, hist.bsp_alerts)
    sent = []
    try:
        hist.read_key = lambda: 'stub-key'
        hist.log_quota = lambda key, when: next(reads)
        hist.MATCHES = matches_p
        hist.FIXTURE_MAP_FILE = fmap_p
        # One already-open fixture: it is skipped as a target (it has books), so the
        # sweep reaches the meter comparison having made zero calls.
        hist.seed_from_live = lambda _raw: [
            {'id': 'm1', 'date': '2026-09-12', 'p1': 'A', 'p2': 'B',
             'oddsMovement': {'books': {'bet365': {'p1': [['2026-09-11T00:00:00Z', 2.0]], 'p2': []}}}}]
        hist.write_matches = lambda _m: None
        hist.open_monitor = lambda *a, **k: []

        class Alerts:
            @staticmethod
            def send(msg, **kw):
                sent.append((msg, kw))
        hist.bsp_alerts = Alerts

        rc = hist.first_appearance()
    finally:
        (hist.read_key, hist.log_quota, hist.MATCHES, hist.FIXTURE_MAP_FILE,
         hist.seed_from_live, hist.write_matches, hist.open_monitor, hist.bsp_alerts) = saved

    ok = rc == expect_rc
    print(f'  {"ok  " if ok else "FAIL"} {name}: meter {meter_before}->{meter_after} '
          f'=> rc {rc} (expected {expect_rc}), {len(sent)} alert(s)')
    if not ok:
        FAILED.append(name)
    return rc, sent


print('TEN-179 item 4 — zero-quota guarantee fails the run')

# The guarantee holds: free stays free, rc 0, nothing alerted.
_, sent_ok = run_case('meter unchanged -> rc 0', 218, 218, 0)
if sent_ok:
    print('  FAIL a healthy sweep must not alert')
    FAILED.append('healthy-no-alert')

# The guarantee breaks: the leg billed. Must be BILLED_RC, and must alert.
rc, sent_bad = run_case('meter moved -> rc 9 (BILLED_RC)', 218, 219, hist.BILLED_RC)
if not sent_bad:
    print('  FAIL a billed sweep must raise an ops alert')
    FAILED.append('billed-alerts')
else:
    print(f'  ok   alert raised: {sent_bad[0][0].splitlines()[0]}')
    if sent_bad[0][1].get('channel') != 'ops':
        print('  FAIL alert must go to the ops channel')
        FAILED.append('billed-channel')

if hist.BILLED_RC == 0:
    print('  FAIL BILLED_RC must be non-zero or the run cannot go red')
    FAILED.append('billed-rc-nonzero')

print(f'\n{2 - len(set(FAILED) & {"meter unchanged -> rc 0", "meter moved -> rc 9 (BILLED_RC)"})}/2 '
      f'cases passed; {len(FAILED)} assertion(s) failed.')
sys.exit(1 if FAILED else 0)
