#!/usr/bin/env python3
"""Offline tests for fetch_by_fixtures() in ten225-kibl-card-state.py (card-job-lock, 2026-10-28).

The card-state step timed out (57014) reading kibl_line_observations with OFFSET
paging over every market. The batched read must return exactly what the builder
used before, in the same order, and must retry a timed-out page before failing.
Each check names the mutation that turns it red.
"""
import json
import os
import re
import sys
import types
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
K = types.ModuleType('K')
K.__file__ = os.path.join(HERE, 'ten225-kibl-card-state.py')
sys.argv = ['K']
exec(compile(open(K.__file__).read(), K.__file__, 'exec'), K.__dict__)

FAILS = []


def check(label, ok, detail=''):
    print(f"  {'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        FAILS.append(label)
        if detail:
            print(f'       {detail}')


# A table: 250 fixtures; fixture 7 has 2,350 rows (forces paging inside one batch); rows arrive shuffled.
ROWS = []
for fid in range(1, 251):
    n = 2350 if fid == 7 else (fid % 4)
    for j in range(n):
        ROWS.append({'fixture_id': fid, 'inserted_on': f'2026-10-{1 + j % 27:02d}T00:{j % 60:02d}:00+00:00', 'j': j})
ROWS.append({'fixture_id': 9999, 'inserted_on': '2026-10-01T00:00:00+00:00', 'j': 0})   # no kibl_fixtures row
ROWS.reverse()


class FakeRest:
    """PostgREST stand-in for select / fixture_id=in. / order fixture_id,inserted_on / limit / offset."""

    def __init__(self, fail_first=0, fail_always=False):
        self.calls, self.fail_first, self.fail_always = [], fail_first, fail_always

    def __call__(self, method, path, url, key):
        self.calls.append(path)
        if self.fail_always or self.fail_first > 0:
            self.fail_first -= 1
            return None, (500, '{"code":"57014","message":"canceling statement due to statement timeout"}')
        q = urllib.parse.parse_qs(path.split('?', 1)[1])
        ids = {int(x) for x in re.match(r'in\.\((.*)\)', q['fixture_id'][0]).group(1).split(',')}
        got = sorted((r for r in ROWS if r['fixture_id'] in ids), key=lambda r: (r['fixture_id'], r['inserted_on']))
        off, lim = int(q['offset'][0]), int(q['limit'][0])
        return json.dumps(got[off:off + lim]).encode(), None


FIX = list(range(250, 0, -1)) + [None]          # kibl_fixtures order is arbitrary; a null id is skipped
want = sorted((r for r in ROWS if r['fixture_id'] != 9999), key=lambda r: (r['fixture_id'], r['inserted_on']))

print('1. same rows, same order as the OFFSET read over the fixtures the builder iterates')
api = FakeRest()
rows, err = K.fetch_by_fixtures('u', 'k', 'kibl_line_observations', 'fixture_id', '&x=eq.1', FIX,
                                order='fixture_id.asc,inserted_on.asc', _sb=api, sleep=lambda s: None)
check('no error', err is None, err)
check(f'all {len(want)} rows  [mutant: stop after the first page of a batch]', len(rows) == len(want), len(rows))
check('in (fixture_id, inserted_on) order  [mutant: unsorted ids]', rows == want)
check('every request is fixture-keyed and carries the caller\'s filter and order  [mutant: drop the in-list]',
      all('fixture_id=in.(' in c and '&x=eq.1' in c and 'order=fixture_id.asc,inserted_on.asc' in c for c in api.calls))
check(f'batches of {K.FIXTURE_BATCH} ids: 3 batches, fixture 7 pages 3x',
      sum('offset=0' in c for c in api.calls) == 3 and len(api.calls) == 5, len(api.calls))

print('2. a timed-out page is retried, then fails loudly')
sleeps = []
api = FakeRest(fail_first=2)
rows, err = K.fetch_by_fixtures('u', 'k', 't', 'c', '', FIX, _sb=api, sleep=sleeps.append)
check('two 57014s then success → complete result after 2 waits  [mutant: READ_RETRIES=1]',
      err is None and len(rows) == len(want) and len(sleeps) == 2, f'{err} {len(rows)} {sleeps}')
api = FakeRest(fail_always=True)
rows, err = K.fetch_by_fixtures('u', 'k', 't', 'c', '', FIX, _sb=api, sleep=lambda s: None)
check('a page that never answers returns the error (the step fails, never a short read)',
      err is not None and '57014' in str(err) and len(api.calls) == K.READ_RETRIES)

print('3. a timed-out card-state write is sent again from the first unwritten row')


class FakeUpsert:
    """L.upsert stand-in: writes in BATCH chunks; the listed call numbers time out after `ok_rows` rows."""

    def __init__(self, fail_calls=(), ok_rows=0):
        self.calls, self.fail_calls, self.ok_rows, self.stored = 0, set(fail_calls), ok_rows, {}

    def __call__(self, url, key, table, rows, conflict):
        self.calls += 1
        if self.calls in self.fail_calls:
            for r in rows[:self.ok_rows]:
                self.stored[r['k']] = r
            return self.ok_rows, (500, '{"code":"57014","message":"canceling statement due to statement timeout"}')
        for r in rows:
            self.stored[r['k']] = r
        return len(rows), None


CARD_ROWS = [{'k': i} for i in range(1200)]
real_upsert, real_payloads = K.L.upsert, K.kibl_payloads
K.kibl_payloads = lambda rows, keep=False: [rows]
try:
    sleeps, fake = [], FakeUpsert(fail_calls={1}, ok_rows=500)
    K.L.upsert = fake
    n, err = K.upsert_kibl_rows('u', 'k', CARD_ROWS, sleep=sleeps.append)
    check('a timeout after 500 rows, then success → all 1200 written once each  [mutant: WRITE_RETRIES=1]',
          err is None and n == 1200 and len(fake.stored) == 1200 and len(sleeps) == 1, f'{n} {err} {sleeps}')
    sleeps, fake = [], FakeUpsert(fail_calls={1, 2}, ok_rows=0)
    K.L.upsert = fake
    n, err = K.upsert_kibl_rows('u', 'k', CARD_ROWS, sleep=sleeps.append)
    check('two timeouts at row 0, then success (the 29 Oct 20:52Z failure)  [control: the pre-fix writer stops at row 0]',
          err is None and n == 1200 and sleeps == [10, 20], f'{n} {err} {sleeps}')
    fake = FakeUpsert(fail_calls={1, 2, 3, 4}, ok_rows=0)
    K.L.upsert = fake
    n, err = K.upsert_kibl_rows('u', 'k', CARD_ROWS, sleep=lambda s: None)
    check('a write that never lands returns the error (the step fails, never a silent short write)',
          err is not None and '57014' in str(err) and n == 0 and fake.calls == K.WRITE_RETRIES)
finally:
    K.L.upsert, K.kibl_payloads = real_upsert, real_payloads

print('4. the wiring')
src = open(K.__file__).read()
reads = re.findall(r"(fetch_\w+)\(\s*url, key, 'kibl_line_observations'", src)
check("both kibl_line_observations reads go through fetch_by_fixtures  [control: the pre-fix builder used fetch_all]",
      reads == ['fetch_by_fixtures', 'fetch_by_fixtures'], reads)
pkg = json.load(open(os.path.join(HERE, 'package.json')))['scripts']['test']
wf = open(os.path.join(HERE, '.github/workflows/ten232-kibl-archive.yml')).read()
check('wired into npm test and the workflow\'s offline tests',
      'test-ten232-obs-read.py' in pkg and 'python3 -B test-ten232-obs-read.py' in wf)

print()
if FAILS:
    print(f'FAILED {len(FAILS)}: {FAILS}')
    sys.exit(1)
print('all card-job-lock observation-read tests passed')
