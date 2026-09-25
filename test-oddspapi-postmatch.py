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
 13. dispatcher alarm SQL, never-overwrite-Vault, verify red on unsent alerts, read-only heartbeat-check
 11. completeness: the first 20 saved fixtures get ONE +24 h re-pull into _meta/verify/
 12. the daily archive yields the key: waits for it, pauses 60 s on a 429, never exits
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
REAL_GH_GET = raw.gh_get          # before any fake is installed

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
        self.other_runs = []      # extra odds-now runs: {'status', 'updated_at'}
        self.gh_body = None       # a malformed GitHub body, returned as-is
        self.upload_err = None    # e.g. (500, 'boom') for bucket uploads outside _meta/

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
            if self.upload_err and not p.startswith('_meta/postmatch-'):
                return None, self.upload_err
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
                return None, (400, '{"statusCode":"404","error":"not_found","message":"Object not found"}')
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
        if method == 'GET' and path == f'/storage/v1/bucket/{raw.BUCKET}':
            return {'name': raw.BUCKET, 'public': False}, None
        raise AssertionError(f'unexpected Supabase call {method} {path}')

    def gh_get(self, path):
        """GitHub REST: the in-progress odds-now runs, and main's commits."""
        self.gh_calls = getattr(self, 'gh_calls', 0) + 1
        if self.gh_err:
            return None, self.gh_err
        if '/actions/workflows/' in path:
            assert 'status=' not in path, 'the gate must see queued/pending/completed runs too'
            if self.gh_body is not None:
                return self.gh_body, None
            runs = [{'status': 'in_progress', 'run_started_at': raw.iso(self.loop_start)}] \
                if self.loop_start else []
            return {'workflow_runs': runs + self.other_runs}, None
        commits = [{'commit': {'message': 'chore(scores): refresh scores [skip ci]',
                               'committer': {'date': raw.iso(self.t)}}}]
        if self.capture_at and self.t >= self.capture_at:
            commits.append({'commit': {'message': 'chore(odds): capture tick 4 (free) [skip ci]',
                                       'committer': {'date': raw.iso(self.capture_at)}}})
        return commits, None

    def install(self):
        raw.forget_idle()
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

def gate(t, **kw):
    w = World(t)
    for k, v in kw.items():
        setattr(w, k, v)
    w.install()
    return raw.loop_idle(t)[0]


Q7 = datetime(2026, 9, 24, 10, 7, 0, tzinfo=timezone.utc)
ago = lambda s: raw.iso(Q7 - timedelta(seconds=s))                  # noqa: E731
check('CONTROL: nothing running, nothing queued, last run long done -> idle',
      gate(Q7, other_runs=[{'status': 'completed', 'updated_at': ago(3600)}]))
for st in ('queued', 'pending', 'waiting', 'requested'):
    check(f'no run iterating but a {st} successor -> busy (it uses the key on start)',
          not gate(Q7, other_runs=[{'status': st}]))
check('a run completed 60 s ago -> busy (successor may be starting)',
      not gate(Q7, other_runs=[{'status': 'completed', 'updated_at': ago(60)}]))
check('a run completed 5 min ago -> not busy on that account',
      gate(Q7, other_runs=[{'status': 'completed', 'updated_at': ago(300)}]))
check('a pending successor BEHIND an iterating run does not block once the iteration committed',
      gate(Q7, loop_start=Q7 - timedelta(hours=2), capture_at=Q7 - timedelta(minutes=5),
           other_runs=[{'status': 'pending'}]))
check('an iterating run in its end phase (>= 314 min old) -> busy even after its capture commit',
      not gate(Q7, loop_start=Q7 - timedelta(minutes=320), capture_at=Q7 - timedelta(minutes=5)))
check('...and the same run at 300 min -> idle after its capture commit',
      gate(Q7, loop_start=Q7 - timedelta(minutes=300), capture_at=Q7 - timedelta(minutes=5)))
for body in ([], {'workflow_runs': None}, {'workflow_runs': [None]}, 'html'):
    check(f'a malformed GitHub body ({type(body).__name__}) -> busy, no crash',
          not gate(Q7, gh_body=body))


import http.client
_urlopen = raw.urllib.request.urlopen
for exc in (ConnectionResetError('reset by peer'), http.client.IncompleteRead(b'partial'),
            OSError('network down')):
    def _raise(*a, _e=exc, **k):
        raise _e
    raw.urllib.request.urlopen = _raise
    try:
        got = REAL_GH_GET('/repos/x/y')
        ok = got[0] is None and type(exc).__name__ in str(got[1])
    except Exception as e:                    # noqa: BLE001 — the failure this guards
        ok, got = False, repr(e)
    finally:
        raw.urllib.request.urlopen = _urlopen
    check(f'gh_get() turns {type(exc).__name__} into an error answer, never a crash', ok, got)

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

w = World(T0 + timedelta(minutes=30))
w.objects[raw.PM_STATE_KEY] = ST
w.state_err = (400, '{"statusCode":"404","error":"Bucket not found","message":"Bucket not found"}')
code, beat = run(w, M, FM, ocs())
check('"Bucket not found" is not "no state yet": stop, nothing written',
      code == 1 and not w.calls and w.objects[raw.PM_STATE_KEY] == ST, (code, w.calls))

print('8d. a failed upload keeps the defer and 404 records')
w = World(T0 + timedelta(minutes=30))
w.objects[raw.PM_STATE_KEY] = json.dumps({'seen': {'13': '2026-09-24T09:00:00Z'},
                                          'deferred': {'id13': 2},
                                          'notFound': {'id13': {'n': 1}}}).encode()
w.hist['id13'] = [(CLOSED, None)]
w.upload_err = (500, 'internal')
code, beat = run(w, M, FM, ocs())
st = state_of(w)
check('upload 500: counted failed, deferred and notFound records survive',
      beat['counts'].get('failed') == 1 and st['deferred'].get('id13') == 2
      and st['notFound'].get('id13', {}).get('n') == 1, (beat['counts'], st.get('deferred'), st.get('notFound')))

print('8f. GitHub read load: "idle" is cached until the next quarter hour, dropped on a 429')
M3c = [card(str(30 + i), *PAIRS[i]) for i in range(3)]
FM3c = fmap(*[(str(30 + i), f'id3{i}', 'same', *PAIRS[i]) for i in range(3)])
ST3 = json.dumps({'seen': {str(30 + i): '2026-09-24T09:00:00Z' for i in range(3)}}).encode()
w = World(datetime(2026, 9, 24, 10, 6, 0, tzinfo=timezone.utc))
w.objects[raw.PM_STATE_KEY] = ST3
w.loop_start = datetime(2026, 9, 24, 8, 0, tzinfo=timezone.utc)
w.capture_at = datetime(2026, 9, 24, 10, 2, 0, tzinfo=timezone.utc)
for i in range(3):
    w.hist[f'id3{i}'] = [(CLOSED, None)]
_, beat = run(w, M3c, FM3c, ocs())
check('3 pulls after the capture commit: GitHub read ONCE (runs + commits = 2 requests), not per call',
      beat['counts'].get('saved') == 3 and w.gh_calls == 2, (w.gh_calls, beat['counts']))
w = World(datetime(2026, 9, 24, 10, 6, 0, tzinfo=timezone.utc))
w.install()
w.loop_start = datetime(2026, 9, 24, 8, 0, tzinfo=timezone.utc)
w.capture_at = datetime(2026, 9, 24, 10, 2, 0, tzinfo=timezone.utc)
raw.loop_idle(w.t)
w.t = datetime(2026, 9, 24, 10, 16, 0, tzinfo=timezone.utc)                   # next quarter, no new commit
check('the cache ends at the next quarter boundary: busy again until that iteration commits',
      raw.loop_idle(w.t)[0] is False)
w = World(datetime(2026, 9, 24, 10, 6, 0, tzinfo=timezone.utc))
w.install()
w.loop_start = datetime(2026, 9, 24, 10, 8, 0, tzinfo=timezone.utc) - timedelta(minutes=raw.LOOP_END_PHASE_MIN)
w.capture_at = datetime(2026, 9, 24, 10, 2, 0, tzinfo=timezone.utc)
raw.loop_idle(w.t)
w.t = datetime(2026, 9, 24, 10, 9, 0, tzinfo=timezone.utc)                    # run entered its end phase
check('the cache ends early when the run enters its end phase', raw.loop_idle(w.t)[0] is False)
w = World(datetime(2026, 9, 24, 10, 6, 0, tzinfo=timezone.utc))
w.objects[raw.PM_STATE_KEY] = ST3
w.loop_start = datetime(2026, 9, 24, 8, 0, tzinfo=timezone.utc)
w.capture_at = datetime(2026, 9, 24, 10, 2, 0, tzinfo=timezone.utc)
w.hist['id30'] = [(None, 429)]
run(w, M3c, FM3c, ocs())
check('a 429 drops the cached "idle": the next gate check reads GitHub afresh (2 reads, not 1)',
      w.gh_calls == 4, w.gh_calls)

print('8e. exactly one trigger: the pg_cron pinger, applied by the schema action; no schedule:')
WF_DIR = os.path.join(HERE, '.github', 'workflows')
APPLIER = 'ten270-stream-now.yml'


def trigger_faults(pm_yml, applier, other_texts):
    """Founder 2026-09-25: dispatcher only. The post-match workflow has no
    `schedule:`, the schema action applies the pinger SQL, and nothing else does
    (a second applier would be a second, unreviewed install path)."""
    faults = []
    if re.search(r'^\s*schedule:', pm_yml, re.M):
        faults.append('the workflow still has a schedule: (two triggers)')
    if 'open("oddspapi-postmatch-pinger.sql")' not in applier:
        faults.append('the schema action does not apply the pinger (no trigger)')
    if any('oddspapi-postmatch-pinger' in t for t in other_texts):
        faults.append('the pinger is applied from a second place')
    return faults


PM_YML = open(os.path.join(WF_DIR, 'oddspapi-postmatch.yml'), encoding='utf-8').read()
APPLIER_YML = open(os.environ.get('POSTMATCH_APPLIER') or os.path.join(WF_DIR, APPLIER), encoding='utf-8').read()
OTHERS = [open(os.path.join(WF_DIR, f), encoding='utf-8').read() for f in sorted(os.listdir(WF_DIR))
          if f.endswith(('.yml', '.yaml')) and f not in ('oddspapi-postmatch.yml', APPLIER)]
MIG = os.path.join(HERE, 'supabase', 'migrations')
OTHERS += [open(os.path.join(MIG, f), encoding='utf-8').read() for f in sorted(os.listdir(MIG))] \
    if os.path.isdir(MIG) else []
check('the pinger is the one trigger: no schedule:, applied by the schema action only',
      trigger_faults(PM_YML, APPLIER_YML, OTHERS) == [], trigger_faults(PM_YML, APPLIER_YML, OTHERS))
check('CONTROL: a schedule: put back is caught',
      trigger_faults(PM_YML.replace('on:\n', "on:\n  schedule:\n    - cron: '7,22,37,52 * * * *'\n", 1),
                     APPLIER_YML, OTHERS) != [])
check('CONTROL: the schema action no longer applying the pinger is caught',
      trigger_faults(PM_YML, APPLIER_YML.replace('open("oddspapi-postmatch-pinger.sql")', 'open("x.sql")'),
                     OTHERS) != [])
def applier_faults(text):
    """The PAT store and the pinger apply run AFTER the schema is applied, so their
    failures are warnings (odds.md): they must never feed `bad` (which fails the run)."""
    i = text.find('POSTMATCH_DISPATCH_PAT") or "")')
    j = text.find('if act in ("schema", "verify"):', i)
    block = text[i:j] if i >= 0 and j > i else ''
    faults = [] if block else ['post-match block not found']
    if 'bad.append' in block:
        faults.append('a post-match failure fails the schema run')
    if block.count('::warning::') < 2:
        faults.append('the PAT store and the pinger apply do not both warn')
    return faults


check('PAT store / pinger apply failures are warnings, not failures', applier_faults(APPLIER_YML) == [],
      applier_faults(APPLIER_YML))
check('CONTROL: a pinger failure fed to `bad` is caught', applier_faults(APPLIER_YML.replace(
    'print(f"::warning::oddspapi-postmatch-pinger.sql not applied (HTTP {st})")',
    'bad.append("pinger")')) != [])
check('the pinger reads the vault secret by the ruled name, the applier stores it under that name',
      "name = 'gh_postmatch_dispatch_pat'" in open(os.environ.get('POSTMATCH_PINGER') or os.path.join(HERE, 'oddspapi-postmatch-pinger.sql')).read()
      and "'gh_postmatch_dispatch_pat'" in APPLIER_YML)


def pinger_faults(text):
    """Fail-safe rules for the pinger SQL, on its text."""
    t = re.sub(r'--[^\n]*', '', text)
    faults = []
    if not re.search(r'do \$outer\$.*exception when others then\s+raise warning.*end\s+\$outer\$;', t, re.S):
        faults.append('not wrapped in a DO block that turns any failure into a warning')
    if not re.search(r'if pat is null or length\(trim\(pat\)\) = 0 then\s+(insert[^;]*;\s+)?raise warning[^;]*;\s+return', t):
        faults.append('a missing secret does not skip (and log) before the dispatch')
    if "'select public.postmatch_dispatch()'" not in t:
        faults.append('the job does not go through the fail-safe function')
    if 'revoke all on function public.postmatch_dispatch() from anon, authenticated' not in t:
        faults.append('the dispatch function is callable by the page key')
    return faults


PINGER = open(os.environ.get('POSTMATCH_PINGER') or os.path.join(HERE, 'oddspapi-postmatch-pinger.sql'), encoding='utf-8').read()
check('the pinger SQL is fail-safe', pinger_faults(PINGER) == [], pinger_faults(PINGER))
for name, (a, b) in {
        'the outer exception handler removed': ("exception when others then\n  raise warning 'TEN-270 post-match pinger NOT installed: % (%)', sqlerrm, sqlstate;\n", ''),
        'the missing-secret skip removed': ("      return 'skipped: vault secret gh_postmatch_dispatch_pat missing';\n", ''),
        'the job calls net.http_post directly': ("'select public.postmatch_dispatch()'", "'select net.http_post(1)'"),
        'anon may call the dispatch': ('  revoke all on function public.postmatch_dispatch() from anon, authenticated;\n', ''),
}.items():
    check(f'CONTROL: pinger check catches "{name}"', a in PINGER and pinger_faults(PINGER.replace(a, b)) != [],
          f'anchor present={a in PINGER}')

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

print('11. completeness: first 20 pulls vs a +24 h re-pull held outside the archive')
LETTERS = 'abcdefghijklmnopqrstuvwxyz'
NAMES = [(f'A. P{LETTERS[i]}x', f'B. Q{LETTERS[i]}y') for i in range(21)]
M21 = [card(str(100 + i), *NAMES[i]) for i in range(21)]
FM21 = fmap(*[(str(100 + i), f'v{i:02d}', 'same', *NAMES[i]) for i in range(21)])
LATE = payload([('2026-09-24T06:00:00Z', 1.50, True), ('2026-09-24T07:00:00Z', 1.45, True),
                ('2026-09-24T07:30:00Z', 1.45, True), ('2026-09-24T07:45:00Z', 1.30, True),  # pre-start, late only
                ('2026-09-24T09:00:00Z', 1.20, True), ('2026-09-24T10:00:00Z', 1.01, False)],
               [('2026-09-24T06:00:00Z', 2.60, True), ('2026-09-24T09:00:00Z', 4.00, True),
                ('2026-09-24T09:30:00Z', 4.50, True),                                        # in-play, late only
                ('2026-09-24T10:00:00Z', 0, False)])
keys21 = [raw._names().match_key('2026-09-24', a, b) for a, b in NAMES]
OCS21 = {'byKey': {k: {'book': 'bet105', 'startTs': '2026-09-24T08:00:00+00:00'} for k in keys21}}
w = World(datetime(2026, 9, 24, 10, 5, 0, tzinfo=timezone.utc))
w.objects[raw.PM_STATE_KEY] = json.dumps({'seen': {str(100 + i): '2026-09-24T09:00:00Z'
                                                   for i in range(21)}}).encode()
for i in range(21):
    w.hist[f'v{i:02d}'] = [(CLOSED, None), (LATE, None)]
w.install()
with contextlib.redirect_stdout(io.StringIO()):
    _, beat = raw.postmatch('k', URL, KEY, M21, FM21, OCS21)
st = state_of(w)
check('21 fixtures saved, exactly the first 20 enrolled for a re-pull',
      beat['counts'].get('saved') == 21 and len(st['verify']) == 20 and 'v20' not in st['verify'],
      (beat['counts'], sorted(st['verify'])))
canon = {p: b for p, b in w.objects.items() if p.startswith('2026-09/')}
w.t = datetime(2026, 9, 25, 10, 5, 0, tzinfo=timezone.utc) - timedelta(minutes=30)   # < 24 h after the pull
n0 = len(hist_calls(w))
_, beat = run(w, M21, FM21, OCS21)
check('before 24 h: no re-pull', len(hist_calls(w)) == n0, len(hist_calls(w)) - n0)
w.t = datetime(2026, 9, 25, 10, 20, 0, tzinfo=timezone.utc)
w.hist['v00'] = [(None, 429)]
_, beat = run(w, M21, FM21, OCS21)
check('a re-pull obeys the 429 rule: the first 429 stops the run',
      beat['stoppedBy'] == '429' and [c[1] for c in hist_calls(w)][n0:] == ['v00'], hist_calls(w)[n0:])
w.hist['v00'] = [(LATE, None)]
w.t = datetime(2026, 9, 25, 10, 35, 0, tzinfo=timezone.utc)
w.loop_start = datetime(2026, 9, 25, 8, 0, tzinfo=timezone.utc)                    # iterating, no commit
n1 = len(hist_calls(w))
_, beat = run(w, M21, FM21, OCS21)
check('a re-pull obeys the loop gate: none while an iteration is running', len(hist_calls(w)) == n1)
w.loop_start = None
w.t = datetime(2026, 9, 25, 10, 50, 0, tzinfo=timezone.utc)
_, beat = run(w, M21, FM21, OCS21)
st = state_of(w)
check('all 20 re-pulled once, into _meta/verify/', beat['counts'].get('verified') == 20
      and all(f'{raw.PM_VERIFY_PREFIX}/v{i:02d}.json.gz' in w.objects for i in range(20))
      and f'{raw.PM_VERIFY_PREFIX}/v20.json.gz' not in w.objects, beat['counts'])
check('the canonical objects are untouched', all(w.objects[p] == b for p, b in canon.items()))
rep = json.loads(w.objects[raw.PM_VERIFY_REPORT].decode())
r = rep['fixtures']['v01']['result']
check('per side, pre-start / in-play split at the card start',
      (r['early']['121']['preStart'], r['early']['121']['inPlay'], r['late']['121']['preStart'],
       r['late']['122']['inPlay']) == (3, 2, 4, 3), r)
check('first and last tick time per copy', (r['early']['121']['first'], r['early']['121']['last'])
      == ('2026-09-24T06:00:00Z', '2026-09-24T10:00:00Z'), r['early']['121'])
check('every early tick is in the late copy; only-late ticks split 1 pre-start / 1 in-play',
      r['earlyAllInLate'] is True and r['onlyInLate'] == {'total': 2, 'preStart': 1, 'inPlay': 1}, r)
nostart = raw.compare_copies(json.loads(CLOSED), json.loads(LATE), None)
check('no start known: the split is a dash (None), never a guess',
      nostart['early']['121']['preStart'] is None and nostart['onlyInLate']['preStart'] is None, nostart)
lost = raw.compare_copies(json.loads(LATE), json.loads(CLOSED), '2026-09-24T08:00:00Z')
check('an early tick missing from the late copy reads earlyAllInLate = False', lost['earlyAllInLate'] is False)
w.t += timedelta(days=1)
n2 = len(hist_calls(w))
_, beat = run(w, M21, FM21, OCS21)
vw = World(T0)
vw.install()
vv = {'pulledAt': '2026-09-23T10:00:00Z', 'path': '2026-09/zz.json.gz', 'cardKey': 'k', 'done': False}
vw.upload_err = (500, 'internal')
c = __import__('collections').Counter()
for _ in range(raw.PM_MAX_404):
    raw.verify_one(URL, KEY, 'zz', vv, LATE, None, None, c)
check('a failed verify upload is a strike; 3 strikes = recorded failed, not retried',
      vv.get('errors') == raw.PM_MAX_404 and vv.get('done') is True and vv.get('result') is None
      and vv.get('lastError') == 'upload-500', vv)
vw.upload_err = None
vv2 = dict(vv, errors=0, done=False)
for _ in range(raw.PM_MAX_404):                                  # early copy missing -> unreadable
    raw.verify_one(URL, KEY, 'zz', vv2, LATE, None, None, c)
check('an unreadable early copy is a strike too (3-strike cap)',
      vv2.get('errors') == raw.PM_MAX_404 and vv2.get('done') is True
      and vv2.get('lastError') == 'early copy unreadable', vv2)
check('after 20: no more re-pulls, ever', len(hist_calls(w)) == n2, hist_calls(w)[n2:])
table = raw.verify_table(rep)
check('the read-only report prints one row per side per fixture and the tally',
      sum(1 for ln in table if ln.startswith('v')) == 40 and '20 of 20 enrolled fixture(s) compared' in table[-1],
      table[-1])

print('13. the dispatcher alarm, the Vault writes, verify and heartbeat-check (founder 2026-09-25T00:53Z)')
import textwrap
_WF = APPLIER_YML
_a = _WF.index("python3 - <<'PY'\n") + len("python3 - <<'PY'\n")
SCHEMA_SCRIPT = textwrap.dedent(_WF[_a:_WF.index("\n          PY\n", _a)])


def run_schema_step(action, env_extra=None, answers=None, script=None):
    """Execute the workflow's own Schema/verify step with fake I/O. `answers`
    maps a SQL substring to (status, body). Returns (sql statements, stdout, exit)."""
    stmts, calls = [], []

    def fake_sql(q):
        stmts.append(q)
        for key, ans in (answers or {}).items():
            if key in q:
                return ans
        return 200, '[]'

    def fake_call(u, method='GET', body=None, key=None, bearer=None, prefer=None):
        calls.append((method, u))
        return 200, '[]'

    src = (script or SCHEMA_SCRIPT).replace('def call(', 'def _real_call(').replace('def sql(', 'def _real_sql(')
    env = {'ACTION': action, 'MAX_EVENTS': '', 'SUPABASE_URL': 'https://abcdefgh.supabase.co',
           'SUPABASE_SECRET_KEY': 'sk', 'SUPABASE_PUBLISHABLE_KEY': 'pk', 'SUPABASE_ACCESS_TOKEN': 'at'}
    env.update(env_extra or {})
    saved = {k: os.environ.get(k) for k in list(env) + ['POSTMATCH_DISPATCH_PAT', 'TELEGRAM_BOT_TOKEN',
                                                        'TELEGRAM_OPS_CHAT_ID']}
    for k in ('POSTMATCH_DISPATCH_PAT', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_OPS_CHAT_ID'):
        os.environ.pop(k, None)
    os.environ.update(env)
    out, code, cwd = io.StringIO(), 0, os.getcwd()
    try:
        os.chdir(HERE)
        with contextlib.redirect_stdout(out):
            try:
                exec(compile(src, 'schema-step', 'exec'), {'call': fake_call, 'sql': fake_sql, '__name__': '__wf__'})
            except SystemExit as e:
                code = e.code or 0
    finally:
        os.chdir(cwd)
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    return stmts, out.getvalue(), code, calls


def vault_writes(stmts):
    w = re.compile(r'(delete\s+from|update|insert\s+into)\s+vault\.secrets|vault\.(create|update)_secret', re.I)
    return [q for q in stmts if w.search(q)]


stmts, out, _, _ = run_schema_step('schema')
check('no POSTMATCH_DISPATCH_PAT / Telegram repo secret: the schema action never deletes or overwrites Vault',
      vault_writes(stmts) == [] and any('postmatch_dispatch()' in q for q in stmts), vault_writes(stmts))
SECRET_VALUES = {'POSTMATCH_DISPATCH_PAT': 'github_pat_TESTVALUE', 'TELEGRAM_BOT_TOKEN': '123:TESTBOT',
                 'TELEGRAM_OPS_CHAT_ID': '-100777'}
stmts, out, _, _ = run_schema_step('schema', SECRET_VALUES)
names = [n for n in ('gh_postmatch_dispatch_pat', 'ops_telegram_bot_token', 'ops_telegram_chat_id')
         if any(f"vault.create_secret(" in q and f"'{n}'" in q for q in stmts)]
check('with the repo secrets present: all three are stored under their Vault names',
      names == ['gh_postmatch_dispatch_pat', 'ops_telegram_bot_token', 'ops_telegram_chat_id'], names)
check('...and no secret value is ever printed', not any(v in out for v in SECRET_VALUES.values()))
stmts, out, code, _ = run_schema_step('schema', SECRET_VALUES, {'vault.create_secret': (500, 'boom')})
check('a failed Vault store is a ::warning::, never an ::error:: about it',
      out.count('::warning::') >= 3 and 'not stored' not in ''.join(
          ln for ln in out.splitlines() if ln.startswith('::error::')), out[-400:])
assert SCHEMA_SCRIPT.count('    if pat:\n') == 1
mutant = SCHEMA_SCRIPT.replace('    if pat:\n', '    if True:\n', 1)
stmts, out, _, _ = run_schema_step('schema', script=mutant)
check('CONTROL: a schema step that writes the PAT without the repo secret is caught',
      vault_writes(stmts) != [])
UNSENT = json.dumps([{'at': '2026-09-25T01:27:00Z', 'condition': 'dispatch_http', 'kind': 'alert',
                      'message': 'ALERT - ...', 'delivered': 'unsent: telegram secret missing in vault',
                      'telegram_http': None}])
stmts, out, code, _ = run_schema_step('verify', answers={'from public.postmatch_alert_log': (200, UNSENT)})
check('verify: an unsent alert is printed and turns the run red',
      code == 1 and 'NEVER REACHED TELEGRAM' in out and 'post-match alert(s) unsent' in out, out[-300:])
stmts, out, code, _ = run_schema_step('verify')
check('verify: no unsent alert -> not red on that account', 'post-match alert(s) unsent' not in out)
check('verify prints the last 5 dispatches, the checker runs and open alerts',
      all(k in out for k in ('last 5 dispatches', 'checker job', 'open alerts')))
stmts, out, code, calls = run_schema_step('heartbeat-check')
mut = re.compile(r'\b(insert|update|delete|create|drop|alter|grant|revoke|truncate)\b', re.I)
check('heartbeat-check is read-only: every statement is a SELECT, every other call a GET',
      stmts and all(q.lstrip().lower().startswith('select') and not mut.search(q) for q in stmts)
      and all(m == 'GET' for m, _ in calls), (stmts[:2], calls[:2]))
check('heartbeat-check prints (i), (ii) and (iii), a dash where not derivable',
      all(k in out for k in ('(i-a)', '(i-b)', '(ii)', '(iii)', '+468')) and ' - ' in out, out[-400:])


def alarm_faults(text):
    t = re.sub(r'--[^\n]*', '', text)
    faults = []
    hosts = set(re.findall(r"'https://([^/']+)/", t))
    if hosts != {'api.github.com', 'api.telegram.org'}:
        faults.append(f'unexpected hosts {sorted(hosts)}')
    for m in re.finditer(r"url := '([^']*)'", t):
        if 'api.telegram.org' in m.group(1) and not m.group(1).startswith('https://api.telegram.org/bot'):
            faults.append('telegram url shape')
    if not re.search(r"url := 'https://api\.github\.com/repos/Michaeldk1996/SAAS/actions/workflows/oddspapi-postmatch\.yml/dispatches'", t):
        faults.append('dispatch url is not the post-match workflow on api.github.com')
    if not re.search(r"url := 'https://api\.telegram\.org/bot' \|\| trim\(tok\) \|\| '/sendMessage'", t):
        faults.append('telegram url is not api.telegram.org/bot<token>/sendMessage')
    if 'insert into public.postmatch_dispatch_log (request_id) values (req)' not in t:
        faults.append('dispatch ids are not recorded')
    if 'left join net._http_response r on r.id = d.request_id' not in t:
        faults.append('the checker does not read only our request ids')
    if "status_code not between 200 and 299" not in t or "interval '45 minutes'" not in t:
        faults.append('non-2xx / 45-min conditions missing')
    if not re.search(r"'dispatch_error',\s+exists \(select 1 from ours where timed_out or error_msg is not null", t):
        faults.append('pg_net timeout/error condition missing')
    if not re.search(r"'dispatch_http'::text as condition,\s+exists \(select 1 from ours where status_code is not null\s+and status_code not between 200 and 299\)", t):
        faults.append('non-2xx dispatch condition missing')
    if "interval '6 hours'" not in t or "'RECOVERED - " not in t:
        faults.append('6 h dedupe or recovered message missing')
    if not re.search(r"delivered\)\s+values \(p_condition, p_kind, p_text, 'unsent: [^']*'\);\s+raise warning", t):
        faults.append('a missing telegram secret is not recorded + warned')
    cron = dict(re.findall(r"cron\.schedule\('([^']+)', '([^']+)'", t))
    d, c = cron.get('ten270-oddspapi-postmatch-ping'), cron.get('ten270-oddspapi-postmatch-check')
    if not d or not c or set(d.split()[0].split(',')) & set(c.split()[0].split(',')):
        faults.append('checker not scheduled on minutes offset from the dispatcher')
    return faults


check('the alarm SQL keeps every rule', alarm_faults(PINGER) == [], alarm_faults(PINGER))
for name, (a, b) in {
        'a third host': ("'https://api.telegram.org/bot'", "'https://evil.example.org/bot'"),
        'dispatch ids not recorded': ('    insert into public.postmatch_dispatch_log (request_id) values (req);\n', ''),
        'no 6 h dedupe': ("interval '6 hours'", "interval '0 hours'"),
        'unsent alert not recorded': ("values (p_condition, p_kind, p_text, 'unsent: telegram secret missing in vault');",
                                      "values (p_condition, p_kind, p_text, 'sent');"),
        'checker at the dispatch minutes': ("'12,27,42,57 * * * *'", "'7,22,37,52 * * * *'"),
}.items():
    check(f'CONTROL: alarm check catches "{name}"', a in PINGER and alarm_faults(PINGER.replace(a, b)) != [],
          f'anchor present={a in PINGER}')
print('12. the daily archive yields the key (founder 2026-09-25)')
os.environ.setdefault('SUPABASE_URL', URL)
os.environ.setdefault('SUPABASE_SECRET_KEY', KEY)
DAILY = [{'fixtureId': f'd{i}', 'startTime': '2026-09-20T08:00:00Z', 'trueStartTime': '2026-09-20T08:00:00Z'}
         for i in range(3)]


def daily(w, max_seconds=3000):
    w.install()
    raw.load_targets = lambda: [dict(f) for f in DAILY]
    w.log = io.StringIO()
    with contextlib.redirect_stdout(w.log):
        code = raw.archive('odds-key', max_seconds)
    beat = json.loads(gzip.decompress(w.objects[raw.HEARTBEAT_KEY]).decode())
    return code, beat


w = World(datetime(2026, 9, 24, 10, 7, 0, tzinfo=timezone.utc))
w.loop_start = datetime(2026, 9, 24, 6, 0, tzinfo=timezone.utc)
w.capture_at = datetime(2026, 9, 24, 10, 9, 30, tzinfo=timezone.utc)
for f in DAILY:
    w.hist[f['fixtureId']] = [(CLOSED, None)]
code, beat = daily(w)
first = hist_calls(w)[0][2] if hist_calls(w) else None
check('an iteration still running: the daily run waits for its capture commit, then pulls',
      first is not None and first >= w.capture_at and beat['savedThisRun'] == 3, (first, beat))
check('...and reports the wait in its heartbeat', beat['keyWaitSeconds'] >= 140, beat.get('keyWaitSeconds'))
check('the daily run keeps its ordering and never-re-pull rule (same queue as build_queue)',
      [c[1] for c in hist_calls(w)] == ['d0', 'd1', 'd2'])
w = World(datetime(2026, 9, 24, 10, 6, 0, tzinfo=timezone.utc))
for f in DAILY:
    w.hist[f['fixtureId']] = [(CLOSED, None)]
w.hist['d0'] = [(None, 429), (CLOSED, None)]
code, beat = daily(w)
check('a 429: pause 60 s, the same fixture again, the run goes on (all 3 saved)',
      beat['savedThisRun'] == 3 and beat['http429'] == 1 and raw.DAILY_429_PAUSE_S in w.sleeps
      and code == 0, (beat, w.sleeps))
w = World(datetime(2026, 9, 24, 10, 7, 0, tzinfo=timezone.utc))
w.loop_start = datetime(2026, 9, 24, 6, 0, tzinfo=timezone.utc)      # never commits
for f in DAILY:
    w.hist[f['fixtureId']] = [(CLOSED, None)]
try:
    code, beat = daily(w, max_seconds=300)
    ok = code == 0 and not hist_calls(w) and beat['keyWaitSeconds'] >= 280
except SystemExit as e:
    ok, beat = False, f'exited {e.code}'
check('the key never frees: the budget runs out waiting, no call, no exit', ok, beat)
w = World(datetime(2026, 9, 24, 10, 0, 30, tzinfo=timezone.utc))
for f in DAILY:
    w.hist[f['fixtureId']] = [(CLOSED, None)]
code, beat = daily(w)
check('the daily run also keeps to :05-:14 of the quarter hour',
      all(raw.in_window(c[2]) for c in w.calls if c[0] == '/v4/historical-odds') and beat['savedThisRun'] == 3,
      [c[2].strftime('%M:%S') for c in w.calls])
check('default yield mode is window', raw.DAILY_YIELD_MODE == 'window' and beat['keyYieldMode'] == 'window')
raw.DAILY_YIELD_MODE = 'gate'
try:
    w = World(datetime(2026, 9, 24, 10, 0, 30, tzinfo=timezone.utc))          # outside the window, loop idle
    for f in DAILY:
        w.hist[f['fixtureId']] = [(CLOSED, None)]
    code, beat = daily(w)
    first = hist_calls(w)[0][2] if hist_calls(w) else None
    check('gate mode: no window — an idle loop at :00:30 lets the daily run pull at once',
          first is not None and not raw.in_window(first) and beat['savedThisRun'] == 3
          and beat['keyYieldMode'] == 'gate', (first, beat.get('savedThisRun')))
    w = World(datetime(2026, 9, 24, 10, 0, 30, tzinfo=timezone.utc))
    w.loop_start = datetime(2026, 9, 24, 6, 0, tzinfo=timezone.utc)
    w.capture_at = datetime(2026, 9, 24, 10, 2, 0, tzinfo=timezone.utc)
    for f in DAILY:
        w.hist[f['fixtureId']] = [(CLOSED, None)]
    code, beat = daily(w)
    first = hist_calls(w)[0][2] if hist_calls(w) else None
    check('gate mode: still waits for the running iteration\'s capture commit (10:02)',
          first is not None and first >= w.capture_at and beat['savedThisRun'] == 3, first)
finally:
    raw.DAILY_YIELD_MODE = 'window'
dw = World(datetime(2026, 9, 24, 10, 6, 0, tzinfo=timezone.utc))
seen_timeout = []
def _api(path, params, key, timeout=180, raw_=False, **kw):
    seen_timeout.append(timeout)
    return CLOSED, None
dw.install()
raw.api_get = lambda path, params, key, timeout=180, raw=False: _api(path, params, key, timeout)
raw.daily_hist_get('d0', 'k', dw.t.timestamp() + 600, __import__('collections').Counter())
check('the daily pull passes the post-match call timeout', seen_timeout == [raw.PM_CALL_TIMEOUT_S], seen_timeout)

print()
if FAILED:
    print(f'{len(FAILED)} FAILED: {FAILED}')
    sys.exit(1)
print('all tests passed')
