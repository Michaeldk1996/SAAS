#!/usr/bin/env python3
"""hotlines-mtb-and-loader — ten225-fixture-index.py refresh: an incremental sweep MERGES into the committed index.
No network: api_get is stubbed. Each check names the mutation that turns it red.
  1. a new fixture is added                                     mutant: merge returns `held` unchanged
  2. a held fixture's missing trueStart / trueEnd is filled     mutant: never fill
  3. a held value that disagrees is KEPT and counted             mutant: overwrite (`if ov in (None,'')` dropped)
  4. nothing held is pruned (pinarch's 13–30 Apr window)         mutant: start from `swept` instead of `held`
  5. --days 12 sweeps 2 six-day slices = 2 metered units          mutant: ignore --days (31 slices)
  6. a failed slice still writes what was read, and exits 1     mutant: `return 0` on slice errors
  7. no meter read -> nothing spent, nothing written             (fail closed, unchanged rule)
"""
import gzip
import json
import os
import sys
import tempfile
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
SRC = os.environ.get('FXI_FILE') or os.path.join(HERE, 'ten225-fixture-index.py')
FAILED = []


def check(name, cond, detail=''):
    print(f'  {"ok  " if cond else "FAIL"} {name}' + ('' if cond else f' {detail}'))
    if not cond:
        FAILED.append(name)


def load():
    M = types.ModuleType('M')
    M.__file__ = SRC
    exec(compile(open(SRC).read(), SRC, 'exec'), M.__dict__)
    return M


M = load()
HELD = {
    'idOLD': {'cat': 'ATP', 'startSched': '2026-04-14T10:00:00.000Z', 'trueStart': '2026-04-14T10:05:00.000Z',
              'trueEnd': '2026-04-14T11:40:00.000Z', 'p1': 'A', 'p2': 'B', 'tourn': 'Barcelona'},
    'idGAP': {'cat': 'ATP', 'startSched': '2026-09-16T10:00:00.000Z', 'trueStart': None, 'trueEnd': None,
              'p1': 'C', 'p2': 'D', 'tourn': 'X'},
    'idHELD': {'cat': 'ATP', 'startSched': '2026-09-15T10:00:00.000Z', 'trueStart': '2026-09-15T10:02:00.000Z',
               'trueEnd': '2026-09-15T11:30:00.000Z', 'p1': 'E', 'p2': 'F', 'tourn': 'Y'},
}
SWEPT = {
    'idGAP': {'cat': 'ATP', 'startSched': '2026-09-16T10:00:00.000Z', 'trueStart': '2026-09-16T10:09:00.000Z',
              'trueEnd': '2026-09-16T12:00:00.000Z', 'p1': 'C', 'p2': 'D', 'tourn': 'X'},
    'idHELD': {'cat': 'ATP', 'startSched': '2026-09-15T10:00:00.000Z', 'trueStart': '2026-09-15T09:58:00.000Z',
               'trueEnd': '2026-09-15T11:30:00.000Z', 'p1': 'E', 'p2': 'F', 'tourn': 'Y'},
    'idNEW': {'cat': 'Challenger', 'startSched': '2026-10-20T09:00:00.000Z', 'trueStart': '2026-10-20T09:11:00.000Z',
              'trueEnd': '2026-10-20T10:40:00.000Z', 'p1': 'G', 'p2': 'H', 'tourn': 'Z'},
}
print('merge_index')
merged, st = M.merge_index(HELD, SWEPT)
check('1. a new fixture is added', 'idNEW' in merged and st['added'] == 1, st)
check('2. a held fixture\'s missing trueStart/trueEnd is filled',
      merged['idGAP']['trueStart'] == '2026-09-16T10:09:00.000Z' and merged['idGAP']['trueEnd'] and st['filled'] == 1, merged['idGAP'])
check('3. a held value that disagrees is kept and counted',
      merged['idHELD']['trueStart'] == '2026-09-15T10:02:00.000Z' and st['kept_disagreeing_trueStart'] == 1, (merged['idHELD'], st))
check('4. nothing held is pruned', set(HELD) <= set(merged) and merged['idOLD'] == HELD['idOLD'])
check('   the inputs are not mutated', HELD['idGAP']['trueStart'] is None)

print('\nmain() — stubbed /v4/fixtures and /v4/account')
with tempfile.TemporaryDirectory() as td:
    def run(days, fail_slice=None, meter_ok=True):
        M2 = load()
        M2.OUT = os.path.join(td, 'idx.json.gz')
        M2.SLEEP = 0
        M2.read_key = lambda: 'k'
        calls = []

        def api_get(path, params, key, timeout=180):
            calls.append((path, dict(params)))
            if path == '/v4/account':
                return ({'subscriptions': [{'is_active': True, 'request_count': 1600, 'request_limit': 5000}]}
                        if meter_ok else None), (None if meter_ok else 500)
            n = sum(1 for c in calls if c[0] == '/v4/fixtures')
            if fail_slice and n == fail_slice:
                return None, 503
            return [{'fixtureId': f'idS{n}', 'categoryName': 'ATP', 'startTime': params['from'],
                     'trueStartTime': params['from'], 'trueEndTime': None,
                     'participant1Name': 'P', 'participant2Name': 'Q', 'tournamentName': 'T'}], None
        M2.api_get = api_get
        sys.argv = ['fxi', '--days', str(days)]
        rc = M2.main()
        return rc, calls

    with gzip.open(os.path.join(td, 'idx.json.gz'), 'wt') as fh:
        json.dump({'generatedAt': '2026-09-17T10:16:03Z', 'spanDays': 180, 'fixtures': HELD}, fh)
    rc, calls = run(12)
    fx = [c for c in calls if c[0] == '/v4/fixtures']
    check('5. --days 12 sweeps 2 slices (2 metered units)', rc == 0 and len(fx) == 2, (rc, len(fx)))
    out = json.load(gzip.open(os.path.join(td, 'idx.json.gz'), 'rt'))
    check('   the written index holds every held fixture plus the swept ones',
          set(HELD) <= set(out['fixtures']) and len(out['fixtures']) == len(HELD) + 2, len(out['fixtures']))
    check('   firstSweepAt keeps the original 17 Sep read', out.get('firstSweepAt') == '2026-09-17T10:16:03Z', out.get('firstSweepAt'))
    check('   lastSweep records days and units', out.get('lastSweep', {}).get('days') == 12 and out['lastSweep']['units'] == 2,
          out.get('lastSweep'))
    n_before = len(out['fixtures'])
    rc, calls = run(12, fail_slice=1)
    out = json.load(gzip.open(os.path.join(td, 'idx.json.gz'), 'rt'))
    check('6. a failed slice exits 1 and still keeps everything held', rc == 1 and len(out['fixtures']) >= n_before, (rc, len(out['fixtures'])))
    before = open(os.path.join(td, 'idx.json.gz'), 'rb').read()
    rc, calls = run(12, meter_ok=False)
    check('7. no meter read: exit 1, no metered call, file untouched',
          rc == 1 and not any(c[0] == '/v4/fixtures' for c in calls)
          and open(os.path.join(td, 'idx.json.gz'), 'rb').read() == before, rc)

print('\n' + ('all checks passed' if not FAILED else f'{len(FAILED)} FAILED: {FAILED}'))
sys.exit(1 if FAILED else 0)
