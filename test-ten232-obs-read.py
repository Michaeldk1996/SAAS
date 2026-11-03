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

print("4. the publisher's read of odds_card_state retries a timed-out page")
import io, urllib.error  # noqa: E402
P = types.ModuleType('P')
P.__file__ = os.path.join(HERE, 'ten225-publish-card-state.py')
exec(compile(open(P.__file__).read(), P.__file__, 'exec'), P.__dict__)


class Resp:
    def __init__(self, rows):
        self.body = json.dumps(rows).encode()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self.body


def opener_for(script):
    """script: list of ('ok', n_rows) or ('err', code); one entry per request."""
    seen = []

    def op(req, timeout=None):
        off = int(urllib.parse.parse_qs(urllib.parse.urlsplit(req.full_url).query)['offset'][0])
        kind, v = script[len(seen)]
        seen.append(off)
        if kind == 'err':
            raise urllib.error.HTTPError(req.full_url, v, 'x', {}, io.BytesIO(b'{"code":"57014"}'))
        return Resp([{'i': off + k} for k in range(v)])
    return op, seen


op, seen = opener_for([('ok', 1000), ('err', 500), ('ok', 1000), ('ok', 7)])
waits = []
rows = P.fetch_all('https://x', 'k', 'odds_card_state', 'a', sleep=waits.append, opener=op)
check('a 57014 on page 2, then success → 2007 rows, each once, page 2 asked again from offset 1000  [mutant: READ_RETRIES=1]',
      [r['i'] for r in rows] == list(range(2007)) and seen == [0, 1000, 1000, 2000] and waits == [10], (seen, waits))
op, seen = opener_for([('err', 500)] * P.READ_RETRIES)
try:
    P.fetch_all('https://x', 'k', 'odds_card_state', 'a', sleep=lambda s: None, opener=op)
    exited = False
except SystemExit as e:
    exited = e.code == 1
check('a page that never answers fails the step (exit 1), never a short read',
      exited and len(seen) == P.READ_RETRIES, seen)
op, seen = opener_for([('err', 401)])
try:
    P.fetch_all('https://x', 'k', 'odds_card_state', 'a', sleep=lambda s: None, opener=op)
    exited = False
except SystemExit as e:
    exited = e.code == 1
check('a 4xx fails at once, no retry  [mutant: retry everything]', exited and len(seen) == 1, seen)

print('5. the wiring')
src = open(K.__file__).read()
reads = re.findall(r"(fetch_\w+)\(\s*url, key, 'kibl_line_observations'", src)
check("the kibl_line_observations reads: the incremental since-read (fetch_since, last_seen_at index) and the two "
      "fixture-batched full reads (fetch_by_fixtures)  [control: the pre-fix builder used fetch_all]",
      reads == ['fetch_since', 'fetch_by_fixtures', 'fetch_by_fixtures'], reads)
pkg = json.load(open(os.path.join(HERE, 'package.json')))['scripts']['test']
wf = open(os.path.join(HERE, '.github/workflows/ten232-kibl-archive.yml')).read()
check('wired into npm test and the workflow\'s offline tests',
      'test-ten232-obs-read.py' in pkg and 'python3 -B test-ten232-obs-read.py' in wf)

print('6. read_observations: incremental = full (architecture program stage 3)')
import tempfile, copy
from datetime import datetime, timezone


def T(s):
    return datetime.fromtimestamp(s, timezone.utc).isoformat()


class Table:
    """kibl_line_observations + kibl_sweeps as the sweep writes them: rows inserted once, then only state and
    last_seen_at move; a sweep's rows carry its start time and become visible when it commits."""
    def __init__(self):
        self.rows, self.sweeps = {}, []

    def sweep(self, start, commit, rows):
        self.sweeps.append({'started_at': T(start), 'finished_at': T(commit), 'commit': commit, 'rows': rows})

    def visible(self, at):
        out = {}
        for sw in sorted(self.sweeps, key=lambda x: x['commit']):
            for r in sw['rows']:
                if r.get('_c', sw['commit']) > at:      # a sweep inserts in chunks: a row can land before it finishes
                    continue
                old = out.get(r['row_key'])
                if old is None:
                    out[r['row_key']] = {k: v for k, v in dict(r, last_seen_at=sw['started_at']).items() if k != '_c'}
                else:                    # a re-sighting: state + last_seen_at only
                    old.update(state=r.get('state', old.get('state')), last_seen_at=sw['started_at'])
        return out

    def sb(self, at):
        def call(method, path, url, key):
            q = urllib.parse.urlparse(path)
            args = urllib.parse.parse_qs(q.query)
            if 'kibl_sweeps' in q.path:
                lo = args['finished_at'][0][len('gte.'):]
                done = [s for s in self.sweeps if s['commit'] <= at and s['finished_at'] >= lo]
                done.sort(key=lambda s: s['started_at'])
                return json.dumps([{'started_at': s['started_at']} for s in done[:1]]).encode(), None
            rows = list(self.visible(at).values())
            for k in ('observed_at', 'last_seen_at'):
                if k in args:
                    rows = [r for r in rows if r[k] >= args[k][0][len('gte.'):]]
            if 'fixture_id' in args:
                ids = {int(x) for x in args['fixture_id'][0][len('in.('):-1].split(',')}
                rows = [r for r in rows if r['fixture_id'] in ids]
            order = args['order'][0]
            rows.sort(key=(lambda r: (r['last_seen_at'], r['row_key'])) if order.startswith('last_seen_at')
                      else (lambda r: (r['fixture_id'], r['inserted_on'])))
            lim, off = int(args['limit'][0]), int(args['offset'][0])
            return json.dumps(rows[off:off + lim]).encode(), None
        return call


def row(k, fid, obs, price, ins=None):
    return {'row_key': k, 'fixture_id': fid, 'observed_at': T(obs), 'inserted_on': T(ins or obs),
            'price_decimal': price, 'state': 'current', 'feed_source_id': K.VERIFIED_FEED_SOURCE_ID}


def scenario(MOD, steps):
    """Run the builder's read at each `at` in steps, incremental vs full; returns the mismatches."""
    K0 = MOD
    K0.CACHE_DIR = tempfile.mkdtemp()
    bad = []
    for at, tab in steps:
        cutoff = at - 45 * 86400
        inc, err, info = K0.read_observations('u', 'k', '&x=1', range(1, 30), cutoff, now_s=at, incremental=True,
                                              _sb=tab.sb(at), sleep=lambda s: None)
        full, err2, _ = K0.read_observations('u', 'k', '&x=1', range(1, 30), cutoff, now_s=at, incremental=False,
                                             _sb=tab.sb(at), sleep=lambda s: None)
        strip = lambda rs: [{k: v for k, v in r.items()} for r in rs]
        if err or err2 or strip(inc) != strip(full):
            bad.append((at, info, len(inc), len(full)))
    return bad


H = 3600
t0 = 1_800_000_000
tab = Table()
tab.sweep(t0, t0 + 120, [row(f'a{i}', 1 + i % 20, t0, 2.0 + i / 100) for i in range(60)])
tab.sweep(t0 + 600, t0 + 700, [row('a1', 2, t0, 2.01), row('n1', 3, t0 + 600, 1.8)])                    # re-sight + new
# a slow sweep: starts before the second read, commits after it (its rows carry the EARLIER start)
tab.sweep(t0 + 1100, t0 + 1500, [row('late', 4, t0 + 1100, 3.3), dict(row('a2', 3, t0, 2.02), state='old')])
# a sweep longer than the margin: starts 2 h before the third read, finishes after the second
tab.sweep(t0 + 2000 - 2 * H, t0 + 2100, [row('long', 5, t0 + 2000 - 2 * H, 4.4)])
tab.sweep(t0 + 2500, t0 + 2600, [row('a3', 4, t0, 2.03), row('n2', 6, t0 + 2500, 1.5)])
# a sweep still RUNNING at the read: started before the previous read, one chunk committed after it, not finished
tab.sweep(t0 + 1700, t0 + 3500, [dict(row('chunk', 7, t0 + 1700, 5.5), _c=t0 + 1900)])
steps = [(t0 + 300, tab), (t0 + 1200, tab), (t0 + 1800, tab), (t0 + 3000, tab), (t0 + 3000 + 25 * H, tab)]
bad = scenario(K, steps)
check('incremental reads = the full read at every step (late commit, long sweep, re-sightings, new rows, state '
      'change, the daily full read)', not bad, bad)

def mutant(a, b):
    src = open(K.__file__).read()
    assert a in src, 'mutant anchor gone: ' + a
    M = types.ModuleType('M'); M.__file__ = K.__file__
    exec(compile(src.replace(a, b), K.__file__, 'exec'), M.__dict__)
    return M

# on its own: a sweep still RUNNING at the read — started before the previous read, a chunk committed after it, the
# sweep not finished (so kibl_sweeps cannot move the bound): only the margin catches it
tab2 = Table()
tab2.sweep(t0, t0 + 120, [row(f'b{i}', 1 + i % 9, t0, 2.0) for i in range(20)])
tab2.sweep(t0 + 1700, t0 + 4000, [dict(row('chunk', 7, t0 + 1700, 5.5), _c=t0 + 1900)])
steps2 = [(t0 + 300, tab2), (t0 + 1800, tab2), (t0 + 2400, tab2)]
check('a sweep still running at the read: incremental = full', not scenario(K, steps2), scenario(K, steps2))
check('MUTANT caught: no sweep margin (a running sweep\'s early chunk is lost)',
      bool(scenario(mutant("bound = prev_read - OBS_SWEEP_MARGIN_S", "bound = prev_read"), steps2)))
check('MUTANT caught: a long sweep that finished since the last read does not move the bound',
      bool(scenario(mutant("bound = min(bound, _ts(first[0]['started_at']) - 60)", "pass"), steps)))
check('MUTANT caught: read_at taken AFTER the read (rows committed during it are skipped)',
      bool(scenario(mutant("'read_at': now_s,", "'read_at': now_s + 900,"), steps)))

# the daily full read and the failure fallback
K.CACHE_DIR = tempfile.mkdtemp()
_, _, i1 = K.read_observations('u', 'k', '&x=1', range(1, 30), 0, now_s=t0 + 300, incremental=True, _sb=tab.sb(t0 + 300))
_, _, i2 = K.read_observations('u', 'k', '&x=1', range(1, 30), 0, now_s=t0 + 1200, incremental=True, _sb=tab.sb(t0 + 1200))
_, _, i3 = K.read_observations('u', 'k', '&x=1', range(1, 30), 0, now_s=t0 + 25 * H, incremental=True, _sb=tab.sb(t0 + 25 * H))
_, _, i4 = K.read_observations('u', 'k', '&y=2', range(1, 30), 0, now_s=t0 + 25 * H + 60, incremental=True, _sb=tab.sb(t0 + 25 * H))
check('modes: first read full, next incremental, a day later full again, a changed filter full',
      (i1['mode'], i2['mode'], i3['mode'], i4['mode'], i4['why']) == ('full', 'incremental', 'full', 'full', 'filter changed'),
      (i1, i2, i3, i4))
real = tab.sb(t0 + 1500)
def flaky(method, path, url, key):
    if 'last_seen_at=gte' in path:
        return None, (500, 'statement timeout')
    return real(method, path, url, key)
rows, err, i5 = K.read_observations('u', 'k', '&y=2', range(1, 30), 0, now_s=t0 + 1500, incremental=True, _sb=flaky,
                                    sleep=lambda s: None)
check('a since-read that keeps failing falls back to the full read (never a stale snapshot)',
      err is None and i5['mode'] == 'full' and 'since-read failed' in i5['why'] and len(rows) == len(tab.visible(t0 + 1500)),
      i5)
cut = K.read_observations('u', 'k', '&x=1', range(1, 30), t0 + 500, now_s=t0 + 3000, incremental=False, _sb=tab.sb(t0 + 3000))[0]
check('the observed_at window holds: no row observed before the cutoff', all(r['observed_at'] >= T(t0 + 500) for r in cut) and cut)

print()
if FAILS:
    print(f'FAILED {len(FAILS)}: {FAILS}')
    sys.exit(1)
print('all card-job-lock observation-read tests passed')
