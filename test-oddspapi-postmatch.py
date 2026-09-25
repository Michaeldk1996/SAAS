#!/usr/bin/env python3
"""TEN-270 — the post-match bet365 archive (`archive-oddspapi-raw.py postmatch`).

Offline: no network, no quota, no Supabase. The REAL module runs end to end —
postmatch(), sb_upload(), sb_list()/held_path(), meter() — against injected
fakes of its two I/O primitives with the SAME return shapes as the real ones:

  api_get(path, params, key, raw=...)  -> (bytes | parsed JSON, None) | (None, HTTP code)
  sb_request(method, path, url, key, body, headers) -> (parsed JSON | raw bytes, None)
                                                     | (None, (HTTP code, text))

Guards (each is killed by a mutant of its rule; see the TEN-270 report):
  1. only a card with a RESULT is a target (past- id AND a finalScore)
  2. nothing is pulled until PM_WAIT_MIN after the job first saw the result
  3. a fixture the bucket holds is never pulled again (the object is the checkpoint)
  4. an open market (last match-winner tick active) is deferred, not saved
  5. the FIRST 429 stops the run with exit 0 (no retry)
  6. a 404 is recorded under _meta/ and given up after PM_MAX_404 runs
  7. zero billable calls: only /v4/historical-odds and /v4/account are called
  8. the key is used only inside the loop-free window of each quarter hour
  8b. ...and only once the odds loop's current iteration is over (loop_idle)
  8c. an unreadable state object stops the run without overwriting it
  9. ticks land in CARD orientation, one row per change, in the schema's columns
 10. the schema: RLS on, no grant/policy on the table, RPC cut at the start
"""

import contextlib
import gzip
import io
import importlib.util
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
MOD = os.environ.get('POSTMATCH_MODULE') or os.path.join(HERE, 'archive-oddspapi-raw.py')
SCHEMA = os.environ.get('POSTMATCH_SCHEMA') or os.path.join(HERE, 'kibl-stream', 'now-schema.sql')
spec = importlib.util.spec_from_file_location('raw_pm', MOD)
raw = importlib.util.module_from_spec(spec)
sys.path.insert(0, HERE)
spec.loader.exec_module(raw)

FAILED = []


def check(name, ok, detail=''):
    print(f'  {"ok  " if ok else "FAIL"} {name}' + ('' if ok else f' — {detail}'))
    if not ok:
        FAILED.append(name)


# ------------------------------------------------------------------- the fakes
class World:
    """oddspapi + Supabase Storage + PostgREST, answering like the real ones."""

    def __init__(self, t0):
        self.t = t0
        self.objects = {}         # bucket path -> bytes
        self.hist = {}            # fixtureId -> list of (body|None, err) answered in turn
        self.calls = []           # (path, fixtureId, time)
        self.sleeps = []
        self.rows = []
        self.meter = 1000
        self.hidden = set()       # objects a listing misses (another writer, mid-race)
        self.lists = 0            # storage list calls
        self.state_err = None     # e.g. (500, 'boom'): the state object cannot be read
        self.loop_start = None    # an odds-now run in progress since this time
        self.capture_at = None    # ...whose capture commit lands on main at this time
        self.gh_err = None

    def now(self):
        return self.t

    def sleep(self, s):
        self.sleeps.append(s)
        self.t += timedelta(seconds=s)

    def api_get(self, path, params, key, timeout=180, raw=False):
        self.calls.append((path, params.get('fixtureId'), self.t))
        self.t += timedelta(seconds=4)            # transfer time, measured 3.8-7.6 s
        if path == '/v4/account':
            return {'subscriptions': [{'is_active': True, 'request_count': self.meter,
                                       'request_limit': 5000, 'plan': 'normal',
                                       'bookmakers': {'bet365': {}}}]}, None
        if path == '/v4/historical-odds':
            q = self.hist.get(params['fixtureId']) or [(None, 404)]
            body, err = q.pop(0) if len(q) > 1 else q[0]
            if body is not None and not raw:
                return json.loads(body.decode('utf-8')), None
            return body, err
        self.meter += 1                           # anything else BILLS
        return {'data': []}, None

    def sb_request(self, method, path, url, key, body=None, headers=None, timeout=180):
        pre = f'/storage/v1/object/{raw.BUCKET}/'
        if method == 'POST' and path == f'/storage/v1/object/list/{raw.BUCKET}':
            self.lists += 1
            prefix, search = body['prefix'], body.get('search') or ''
            names = sorted(p[len(prefix):] for p in self.objects
                           if p.startswith(prefix) and p not in self.hidden)
            if prefix == '':
                names = sorted({p.split('/')[0] for p in self.objects})
            rows = [{'name': n, 'metadata': {'size': 1}} for n in names
                    if '/' not in n and search in n]
            return rows[body.get('offset', 0):body.get('offset', 0) + body['limit']], None
        if method == 'POST' and path.startswith(pre):
            p = path[len(pre):]
            if p in self.objects and (headers or {}).get('x-upsert') != 'true':
                return None, (400, '{"statusCode":"409","error":"Duplicate",'
                                   '"message":"The resource already exists"}')
            self.objects[p] = body
            return {'Key': p}, None
        if method == 'GET' and path.startswith(pre):
            p = path[len(pre):]
            if p == raw.PM_STATE_KEY and self.state_err:
                return None, self.state_err
            if p not in self.objects:
                return None, (400, '{"error":"not_found"}')
            blob = self.objects[p]
            try:                                   # sb_request's own decode rule
                return json.loads(blob.decode('utf-8')), None
            except ValueError:
                return blob, None
        if method == 'POST' and path.startswith(f'/rest/v1/{raw.TICKS_TABLE}'):
            assert 'on_conflict=card_key,side,at,price' in path
            seen = {(r['card_key'], r['side'], r['at'], r['price']) for r in self.rows}
            for r in body:
                if (r['card_key'], r['side'], r['at'], r['price']) not in seen:
                    self.rows.append(r)
            return b'', None
        raise AssertionError(f'unexpected Supabase call {method} {path}')

    def gh_get(self, path):
        """GitHub REST: the in-progress odds-now runs, and main's commits."""
        if self.gh_err:
            return None, self.gh_err
        if '/actions/workflows/' in path:
            runs = [{'run_started_at': raw.iso(self.loop_start)}] if self.loop_start else []
            return {'workflow_runs': runs}, None
        commits = [{'commit': {'message': 'chore(scores): refresh scores [skip ci]',
                               'committer': {'date': raw.iso(self.t)}}}]
        if self.capture_at and self.t >= self.capture_at:
            commits.append({'commit': {'message': 'chore(odds): capture tick 4 (free) [skip ci]',
                                       'committer': {'date': raw.iso(self.capture_at)}}})
        return commits, None

    def install(self):
        raw.gh_get = self.gh_get
        raw.api_get = self.api_get
        raw.sb_request = self.sb_request
        raw._now = self.now
        raw._sleep = self.sleep


def ticks(series):
    return [{'createdAt': a, 'price': p, 'limit': None, 'active': act, 'exchangeMeta': None}
            for a, p, act in series]


def payload(s1, s2, book='bet365'):
    return json.dumps({'fixtureId': 'x', 'bookmakers': {book: {'markets': {'121': {'outcomes': {
        '121': {'players': {'0': ticks(s1)}}, '122': {'players': {'0': ticks(s2)}}}}}}}}).encode()


CLOSED = payload([('2026-09-24T06:00:00Z', 1.50, True), ('2026-09-24T07:00:00Z', 1.45, True),
                  ('2026-09-24T07:30:00Z', 1.45, True),            # same price: not a change
                  ('2026-09-24T09:00:00Z', 1.20, True), ('2026-09-24T10:00:00Z', 1.01, False)],
                 [('2026-09-24T06:00:00Z', 2.60, True), ('2026-09-24T09:00:00Z', 4.00, True),
                  ('2026-09-24T10:00:00Z', 0, False)])
OPEN = payload([('2026-09-24T06:00:00Z', 1.50, True), ('2026-09-24T10:00:00Z', 1.40, True)],
               [('2026-09-24T06:00:00Z', 2.60, True), ('2026-09-24T10:00:00Z', 2.90, True)])


def card(ek, p1, p2, done=True, score='6-4 6-4', day='2026-09-24'):
    return {'id': f'{"past" if done else "upcoming"}-{ek}', 'date': day, 'p1': p1, 'p2': p2,
            'finalScore': score if done else None}


def fmap(*recs):
    return {'byKey': {ek: {'fixtureId': fid, 'orient': o, 'p1': p1, 'p2': p2,
                           'startTime': '2026-09-24T08:00:00.000Z'} for ek, fid, o, p1, p2 in recs}}


def ocs(*keys):
    return {'byKey': {k: {'book': 'bet365'} for k in keys}}


T0 = datetime(2026, 9, 24, 10, 7, 0, tzinfo=timezone.utc)   # a :07 slot
URL, KEY = 'https://example.invalid', 'k'


def run(w, matches, fm, oc):
    w.install()
    w.log = io.StringIO()
    with contextlib.redirect_stdout(w.log):     # the run's own summary; kept off the test log
        return raw.postmatch('odds-key', URL, KEY, matches, fm, oc)


def state_of(w):
    return json.loads(w.objects[raw.PM_STATE_KEY].decode())


def hist_calls(w):
    return [c for c in w.calls if c[0] == '/v4/historical-odds']


# ---------------------------------------------------------------------- tests
print('1. only a card with a result is a target')
w = World(T0)
M = [card('1', 'J. Sinner', 'C. Alcaraz'),
     card('2', 'A. Zverev', 'T. Fritz', done=False),
     card('3', 'D. Medvedev', 'A. Rublev', score=None)]          # past-, interrupted
FM = fmap(('1', 'id1', 'same', 'J. Sinner', 'C. Alcaraz'), ('2', 'id2', 'same', 'A. Zverev', 'T. Fritz'),
          ('3', 'id3', 'same', 'D. Medvedev', 'A. Rublev'))
_, beat = run(w, M, FM, ocs())
check('one finished card of three', beat['counts'].get('finished') == 1, beat['counts'])
check('only the finished card is remembered as seen', sorted(state_of(w)['seen']) == ['1'],
      state_of(w)['seen'])

print('2. the wait after the result')
check('first sighting: nothing pulled, counted as waiting',
      not hist_calls(w) and beat['counts'].get('waiting') == 1, (w.calls, beat['counts']))
w.hist['id1'] = [(CLOSED, None)]
w.t = T0 + timedelta(minutes=15)                                  # the :22 slot, 15 min later
_, beat = run(w, M, FM, ocs())
check('15 min after the sighting: still waiting', not hist_calls(w), w.calls)
w.t = T0 + timedelta(minutes=30)                                  # the :37 slot
code, beat = run(w, M, FM, ocs())
check(f'{raw.PM_WAIT_MIN} min after the sighting: pulled and saved',
      [c[1] for c in hist_calls(w)] == ['id1'] and beat['counts'].get('saved') == 1, beat)
path = raw.object_path({'fixtureId': 'id1', 'startTime': '2026-09-24T08:00:00.000Z'})
check('saved at the canonical month path, gzipped raw bytes',
      path == '2026-09/id1.json.gz' and gzip.decompress(w.objects[path]) == CLOSED, sorted(w.objects))
check('exit 0', code == 0)

print('3. the bucket is the checkpoint — the daily run and this one never pull a held fixture')
have, _, ok = raw.held_objects(URL, KEY)
check('the daily run\'s held_objects() sees the post-match object (and not _meta)',
      ok and have == {'id1'}, have)
q, _, _ = raw.build_queue([{'fixtureId': 'id1', 'startTime': '2026-09-20T08:00:00Z'}], have,
                          T0 + timedelta(days=2))
check('the daily build_queue() skips it', q == [], q)
n = len(w.calls)
w.t += timedelta(minutes=15)
run(w, M, FM, ocs())
check('a later post-match run makes no oddspapi call for it', len(w.calls) == n, w.calls[n:])

print('3b. a copy the listing missed (another writer, mid-race) is never overwritten')
w = World(T0 + timedelta(minutes=30))
M = [card('12', 'J. Sinner', 'C. Alcaraz')]
FM = fmap(('12', 'id12', 'same', 'J. Sinner', 'C. Alcaraz'))
w.objects[raw.PM_STATE_KEY] = json.dumps({'seen': {'12': '2026-09-24T09:00:00Z'}}).encode()
w.objects['2026-09/id12.json.gz'] = b'THE DAILY RUN\'S COPY'
w.hidden.add('2026-09/id12.json.gz')
w.hist['id12'] = [(CLOSED, None)]
_, beat = run(w, M, FM, ocs())
check('upload refuses to overwrite: the held copy is untouched, counted alreadyHeld',
      w.objects['2026-09/id12.json.gz'] == b'THE DAILY RUN\'S COPY'
      and beat['counts'].get('alreadyHeld') == 1, beat['counts'])
HELD_COPY = payload([('2026-09-24T06:00:00Z', 1.70, True), ('2026-09-24T10:00:00Z', 1.60, False)],
                    [('2026-09-24T06:00:00Z', 2.20, True), ('2026-09-24T10:00:00Z', 2.30, False)])
w = World(T0 + timedelta(minutes=30))
w.objects[raw.PM_STATE_KEY] = json.dumps({'seen': {'12': '2026-09-24T09:00:00Z'}}).encode()
w.objects['2026-09/id12.json.gz'] = gzip.compress(HELD_COPY)
w.hidden.add('2026-09/id12.json.gz')
w.hist['id12'] = [(CLOSED, None)]
_, beat = run(w, M, FM, ocs('2026-09-24|alcaraz|sinner'))
check('on a duplicate, the bet365 ticks come from the HELD object, not the unsaved pull',
      sorted(r['price'] for r in w.rows) == [1.6, 1.7, 2.2, 2.3], sorted(r['price'] for r in w.rows))

print('3c. held is judged across EVERY month folder, and remembered')
w = World(T0 + timedelta(minutes=30))
w.objects[raw.PM_STATE_KEY] = json.dumps({'seen': {'12': '2026-09-24T09:00:00Z'}}).encode()
w.objects['2026-07/id12.json.gz'] = gzip.compress(CLOSED)      # far from its startTime month
w.objects['2026-08/other.json.gz'] = b'x'
w.hist['id12'] = [(CLOSED, None)]
_, beat = run(w, M, FM, ocs())
check('a copy in a month far from startTime still counts as held: no pull',
      not hist_calls(w) and beat['counts'].get('held') == 1, (w.calls, beat['counts']))
n_lists = w.lists
w.t += timedelta(minutes=15)
_, beat = run(w, M, FM, ocs())
check('the next run takes held from the state: zero storage listings',
      w.lists == n_lists and beat['counts'].get('heldFromState') == 1, (w.lists - n_lists, beat['counts']))

print('4. the market must be closed: last match-winner tick active=False')
w = World(T0)
M = [card('4', 'J. Sinner', 'C. Alcaraz')]
FM = fmap(('4', 'id4', 'same', 'J. Sinner', 'C. Alcaraz'))
w.hist['id4'] = [(OPEN, None), (CLOSED, None)]
run(w, M, FM, ocs())                                              # first sighting
w.t += timedelta(minutes=30)
_, beat = run(w, M, FM, ocs())
check('open market: deferred, nothing written to the bucket',
      beat['counts'].get('deferredOpenMarket') == 1 and not any(p.startswith('2026-') for p in w.objects),
      (beat['counts'], sorted(w.objects)))
w.t += timedelta(minutes=15)
_, beat = run(w, M, FM, ocs())
check('next run, market closed: saved', beat['counts'].get('saved') == 1, beat['counts'])
check('market_closed() needs BOTH sides inactive',
      not raw.market_closed(raw.mw_ticks(json.loads(payload(
          [('2026-09-24T10:00:00Z', 1.2, False)], [('2026-09-24T10:00:00Z', 4.0, True)])))))

print('5. the FIRST 429 stops the run (exit 0), no retry')
w = World(T0 + timedelta(minutes=30))
M = [card('5', 'J. Sinner', 'C. Alcaraz'), card('6', 'A. Zverev', 'T. Fritz')]
FM = fmap(('5', 'id5', 'same', 'J. Sinner', 'C. Alcaraz'), ('6', 'id6', 'same', 'A. Zverev', 'T. Fritz'))
w.objects[raw.PM_STATE_KEY] = json.dumps({'seen': {'5': '2026-09-24T09:00:00Z',
                                                   '6': '2026-09-24T09:00:00Z'}}).encode()
w.hist['id5'] = [(None, 429), (CLOSED, None)]
w.hist['id6'] = [(CLOSED, None)]
code, beat = run(w, M, FM, ocs())
check('stopped on the first 429: no retry, the next fixture is not tried',
      [c[1] for c in hist_calls(w)] == ['id5'] and beat['stoppedBy'] == '429'
      and beat['counts'].get('notTried') == 1, (hist_calls(w), beat))
check('exit 0 on a 429', code == 0)
check('the 429 is counted in the heartbeat', beat['http429'] == 1
      and json.loads(w.objects[raw.PM_HEARTBEAT_KEY].decode())['http429'] == 1, beat)
w.t += timedelta(minutes=15)
_, beat = run(w, M, FM, ocs())
check('the next run resumes and saves both', beat['counts'].get('saved') == 2, beat['counts'])

print('6. a 404 is recorded and given up after PM_MAX_404 runs')
w = World(T0 + timedelta(minutes=30))
M = [card('7', 'J. Sinner', 'C. Alcaraz')]
FM = fmap(('7', 'id7', 'same', 'J. Sinner', 'C. Alcaraz'))
w.objects[raw.PM_STATE_KEY] = json.dumps({'seen': {'7': '2026-09-24T09:00:00Z'}}).encode()
for i in range(raw.PM_MAX_404 + 2):
    run(w, M, FM, ocs())
    w.t += timedelta(minutes=15)
check('recorded under _meta/', state_of(w)['notFound']['id7']['n'] == raw.PM_MAX_404,
      state_of(w).get('notFound'))
check(f'{raw.PM_MAX_404} calls, then never again', len(hist_calls(w)) == raw.PM_MAX_404,
      len(hist_calls(w)))
check('state lives under _meta/', raw.PM_STATE_KEY.startswith('_meta/')
      and raw.PM_HEARTBEAT_KEY.startswith('_meta/'))

print('7. zero billable calls')
paths = set()
for scenario in range(3):
    w = World(T0 + timedelta(minutes=30))
    M = [card('8', 'J. Sinner', 'C. Alcaraz'), card('9', 'A. Zverev', 'T. Fritz')]
    FM = fmap(('8', 'id8', 'same', 'J. Sinner', 'C. Alcaraz'), ('9', 'id9', 'swap', 'T. Fritz', 'A. Zverev'))
    w.objects[raw.PM_STATE_KEY] = json.dumps({'seen': {'8': '2026-09-24T09:00:00Z',
                                                       '9': '2026-09-24T09:00:00Z'}}).encode()
    w.hist['id8'] = [[(CLOSED, None)], [(None, 404)], [(None, 429)]][scenario]
    w.hist['id9'] = [(CLOSED, None)]
    _, beat = run(w, M, FM, ocs('2026-09-24|alcaraz|sinner'))
    paths |= {c[0] for c in w.calls}
    check(f'scenario {scenario}: the meter did not move across the run',
          beat['meterBefore'] is not None and beat['meterDelta'] == 0, beat)
check('only the two free endpoints were called', paths == {'/v4/historical-odds', '/v4/account'}, paths)
try:
    raw.free_get('/v4/fixtures', {}, 'k')
    refused = False
except raw.BillableCall:
    refused = True
check('free_get() refuses a billable endpoint', refused)

print('8. the key is used only inside the loop-free window')
w = World(datetime(2026, 9, 24, 10, 1, 30, tzinfo=timezone.utc))   # the loop is ticking
M = [card('10', 'J. Sinner', 'C. Alcaraz')]
FM = fmap(('10', 'id10', 'same', 'J. Sinner', 'C. Alcaraz'))
w.objects[raw.PM_STATE_KEY] = json.dumps({'seen': {'10': '2026-09-24T09:00:00Z'}}).encode()
w.hist['id10'] = [(CLOSED, None)]
_, beat = run(w, M, FM, ocs())
first = w.calls[0][2] if w.calls else None
check('a run delivered at :01:30 makes its first call no earlier than :05',
      first is not None and raw.in_window(first) and beat['counts'].get('saved') == 1, (first, beat))
w = World(datetime(2026, 9, 24, 10, 14, 50, tzinfo=timezone.utc))  # 10 s before the loop
w.objects[raw.PM_STATE_KEY] = json.dumps({'seen': {'10': '2026-09-24T09:00:00Z'}}).encode()
w.hist['id10'] = [(CLOSED, None)]
_, beat = run(w, M, FM, ocs())
check('every call inside the window (none at :00-:04 or :14-:15)',
      all(raw.in_window(c[2]) for c in w.calls), [c[2].strftime('%M:%S') for c in w.calls])
PAIRS = [('J. Sinner', 'C. Alcaraz'), ('A. Zverev', 'T. Fritz'), ('D. Medvedev', 'A. Rublev')]
M3 = [card(str(20 + i), *PAIRS[i]) for i in range(3)]
FM3 = fmap(*[(str(20 + i), f'id2{i}', 'same', *PAIRS[i]) for i in range(3)])
w = World(datetime(2026, 9, 24, 10, 13, 20, tzinfo=timezone.utc))  # inside, 40 s before :14
w.objects[raw.PM_STATE_KEY] = json.dumps({'seen': {str(20 + i): '2026-09-24T09:00:00Z'
                                                   for i in range(3)}}).encode()
for i in range(3):
    w.hist[f'id2{i}'] = [(CLOSED, None)]
_, beat = run(w, M3, FM3, ocs())
check('a run that reaches :14 mid-queue stops calling (the rest wait for the next run)',
      all(raw.in_window(c[2]) for c in w.calls) and beat['stoppedBy'] == 'window-or-loop'
      and beat['counts'].get('notTried') == 2, ([c[2].strftime('%M:%S') for c in w.calls], beat))
check('the window never overlaps the measured loop median (0-113 s into the quarter)',
      raw.PM_WINDOW[0] * 60 > 113 and raw.PM_WINDOW[1] <= 15)

print('8b. the loop gate: never while an odds-loop iteration is running')
M = [card('13', 'J. Sinner', 'C. Alcaraz')]
FM = fmap(('13', 'id13', 'same', 'J. Sinner', 'C. Alcaraz'))
ST = json.dumps({'seen': {'13': '2026-09-24T09:00:00Z'}}).encode()
w = World(datetime(2026, 9, 24, 10, 7, 0, tzinfo=timezone.utc))
w.objects[raw.PM_STATE_KEY] = ST
w.loop_start = datetime(2026, 9, 24, 6, 0, tzinfo=timezone.utc)
w.capture_at = datetime(2026, 9, 24, 10, 9, 30, tzinfo=timezone.utc)   # a 570 s iteration
w.hist['id13'] = [(CLOSED, None)]
_, beat = run(w, M, FM, ocs())
first = w.calls[0][2] if w.calls else None
check('an iteration still running at :07 holds the job off until its capture commit (:09:30)',
      first is not None and first >= w.capture_at and beat['counts'].get('saved') == 1, (first, beat['counts']))
w = World(datetime(2026, 9, 24, 10, 7, 0, tzinfo=timezone.utc))
w.objects[raw.PM_STATE_KEY] = ST
w.loop_start = datetime(2026, 9, 24, 6, 0, tzinfo=timezone.utc)       # never commits this quarter
w.hist['id13'] = [(CLOSED, None)]
_, beat = run(w, M, FM, ocs())
check('no capture commit this quarter: zero oddspapi calls, the run stops',
      not w.calls and beat['stoppedBy'] == 'window-or-loop', (w.calls, beat['stoppedBy']))
w = World(datetime(2026, 9, 24, 10, 8, 0, tzinfo=timezone.utc))
w.objects[raw.PM_STATE_KEY] = ST
w.capture_at = datetime(2026, 9, 24, 10, 2, 0, tzinfo=timezone.utc)
w.loop_start = datetime(2026, 9, 24, 10, 7, 30, tzinfo=timezone.utc)  # restarted: iterates at once
w.hist['id13'] = [(CLOSED, None)]
_, beat = run(w, M, FM, ocs())
check('a loop restarted mid-quarter after the last capture commit counts as running',
      not w.calls, [c[2].strftime('%M:%S') for c in w.calls])
w = World(datetime(2026, 9, 24, 10, 7, 0, tzinfo=timezone.utc))
w.objects[raw.PM_STATE_KEY] = ST
w.gh_err = 503
w.hist['id13'] = [(CLOSED, None)]
_, beat = run(w, M, FM, ocs())
check('GitHub unreadable: fail closed, zero oddspapi calls', not w.calls, w.calls)

print('8c. an unreadable state is never overwritten')
w = World(T0 + timedelta(minutes=30))
w.objects[raw.PM_STATE_KEY] = ST
w.state_err = (500, 'upstream timeout')
w.hist['id13'] = [(CLOSED, None)]
code, beat = run(w, M, FM, ocs())
check('state read fails (500): the run stops, no call, nothing written',
      code == 1 and not w.calls and w.objects[raw.PM_STATE_KEY] == ST
      and raw.PM_HEARTBEAT_KEY not in w.objects, (code, w.calls, sorted(w.objects)))
w = World(T0)
w.state_err = (400, '{"statusCode":"404","error":"not_found","message":"Object not found"}')
code, beat = run(w, M, FM, ocs())
check('state not found (first run): starts empty and writes it',
      code == 0 and raw.PM_STATE_KEY in w.objects, (code, sorted(w.objects)))

print('9. ticks in CARD orientation, one row per change, in the schema\'s columns')
w = World(T0 + timedelta(minutes=30))
M = [card('11', 'T. Fritz', 'A. Zverev')]
# oddspapi lists Zverev first: participant1 is the CARD's p2.
FM = fmap(('11', 'id11', 'swap', 'T. Fritz', 'A. Zverev'))
w.objects[raw.PM_STATE_KEY] = json.dumps({'seen': {'11': '2026-09-24T09:00:00Z'}}).encode()
w.hist['id11'] = [(CLOSED, None)]
_, beat = run(w, M, FM, ocs('2026-09-24|fritz|zverev'))
p2 = [(r['price'], r['at'][11:16]) for r in w.rows if r['side'] == 'p2']
p1 = [(r['price'], r['at'][11:16]) for r in w.rows if r['side'] == 'p1']
check('participant1 (Zverev) lands on the card\'s p2 side',
      p2 == [(1.5, '06:00'), (1.45, '07:00'), (1.2, '09:00'), (1.01, '10:00')], p2)
check('a price below 1.01 is never stored (the 0 on the closing tick)',
      p1 == [(2.6, '06:00'), (4.0, '09:00')], p1)
check('the rows carry the card key and the player', {r['card_key'] for r in w.rows}
      == {'2026-09-24|fritz|zverev'} and {r['player'] for r in w.rows if r['side'] == 'p2'} == {'A. Zverev'})
w2 = World(T0 + timedelta(minutes=30))
w2.objects[raw.PM_STATE_KEY] = json.dumps({'seen': {'11': '2026-09-24T09:00:00Z'}}).encode()
w2.hist['id11'] = [(CLOSED, None)]
_, beat = run(w2, M, FM, ocs())                                     # a Bet105 card
check('a card whose book is not bet365 gets the archive object but no tick rows',
      beat['counts'].get('saved') == 1 and not w2.rows, (beat['counts'], w2.rows))
# The held-object pass: a bet365 card the DAILY run archived is projected
# from the bucket, with no oddspapi call.
w3 = World(T0)
w3.objects['2026-09/id11.json.gz'] = gzip.compress(CLOSED)
_, beat = run(w3, M, FM, ocs('2026-09-24|fritz|zverev'))
check('held bet365 card: rows loaded from the bucket object, zero oddspapi calls',
      len(w3.rows) == 6 and not w3.calls, (len(w3.rows), w3.calls))
check('map names that disagree with the card give no orientation (no rows, never a guess)',
      raw.card_orientation({'orient': 'same', 'p1': 'X. Other', 'p2': 'A. Zverev'},
                           {'p1': 'T. Fritz', 'p2': 'A. Zverev'}) is None)

sql = open(SCHEMA, encoding='utf-8').read()


def table_columns(text):
    m = re.search(r'create table if not exists public\.bet365_mw_ticks \((.*?)\n\);', text, re.S)
    if not m:
        return set()
    return {ln.strip().split()[0] for ln in m.group(1).splitlines()
            if ln.strip() and not ln.strip().startswith(('--', 'constraint', 'primary', 'unique'))}


check('every column the loader writes exists in the table',
      set(raw.TICK_COLUMNS) <= table_columns(sql) and set(w.rows[0]) == set(raw.TICK_COLUMNS),
      (raw.TICK_COLUMNS, table_columns(sql)))

print('10. the schema (bet365_mw_ticks + bet365_history)')


def schema_faults(text):
    """Every rule the table and the RPC must keep, evaluated on the SQL text."""
    t = re.sub(r'--[^\n]*', '', text).lower()
    t = re.sub(r'\s+', ' ', t)
    faults = []
    if 'alter table public.bet365_mw_ticks enable row level security' not in t:
        faults.append('RLS not enabled on bet365_mw_ticks')
    if 'revoke all on public.bet365_mw_ticks from anon, authenticated' not in t:
        faults.append('anon/authenticated not revoked on bet365_mw_ticks')
    if re.search(r'grant [a-z, ]+ on (table )?public\.bet365_mw_ticks', t):
        faults.append('a grant on bet365_mw_ticks')
    if re.search(r'create policy [^;]* on public\.bet365_mw_ticks', t):
        faults.append('a policy on bet365_mw_ticks')
    if not re.search(r'unique \(card_key, side, at, price\)', t):
        faults.append('no unique (card_key, side, at, price)')
    fn = re.search(r'create or replace function public\.bet365_history\(p_card_key text\)(.*?)\$fn\$;', t)
    body = fn.group(1) if fn else ''
    if 'security definer' not in body or 'set search_path = public, pg_temp' not in body:
        faults.append('RPC not security definer with a pinned search_path')
    if not re.search(r"ocs\.book = 'bet365'.*ocs\.is_selected", body):
        faults.append('RPC does not require the card\'s selected book to be bet365')
    if not re.search(r't\.at <= sel\.start_ts', body):
        faults.append('RPC does not cut the history at the card\'s start')
    if 'sel.start_ts is not null' not in body:
        faults.append('RPC returns rows when the start is unknown')
    if not re.search(r'limit \d+', body):
        faults.append('RPC rows are not capped')
    if 'revoke all on function public.bet365_history(text) from public' not in t:
        faults.append('EXECUTE not revoked from public')
    if "'fixtures'," not in body:
        faults.append('RPC does not return the fixture count')
    if 'grant execute on function public.bet365_history(text) to anon, authenticated' not in t:
        faults.append('EXECUTE not granted to anon, authenticated')
    return faults


check('the shipped schema keeps every rule', schema_faults(sql) == [], schema_faults(sql))
MUTANTS = {
    'RLS line removed': ('alter table public.bet365_mw_ticks enable row level security;', ''),
    'a select grant added': ('revoke all on public.bet365_mw_ticks from anon, authenticated;',
                             'revoke all on public.bet365_mw_ticks from anon, authenticated;\n'
                             'grant select on public.bet365_mw_ticks to anon;'),
    'a read policy added': ('revoke all on public.bet365_mw_ticks from anon, authenticated;',
                            'revoke all on public.bet365_mw_ticks from anon, authenticated;\n'
                            'create policy "r" on public.bet365_mw_ticks for select to anon using (true);'),
    'start cut removed': ('and t.at <= sel.start_ts', ''),
    'unknown start admitted': ('and sel.start_ts is not null', ''),
    'selected-book guard removed': ("and ocs.book = 'bet365'", ''),
}
for name, (a, b) in MUTANTS.items():
    present = a in sql
    check(f'CONTROL: the schema check catches "{name}"',
          present and schema_faults(sql.replace(a, b)) != [], f'anchor present={present}')

print()
if FAILED:
    print(f'{len(FAILED)} FAILED: {FAILED}')
    sys.exit(1)
print('all tests passed')
