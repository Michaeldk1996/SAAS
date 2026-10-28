#!/usr/bin/env python3
"""Founder brief 2026-10-28 (line-summary capture): the same-day load of the post-start Pinnacle +30 payloads, and the
fail-closed gate. Drives ten225-load-line-summary.py main() against an in-memory Supabase (the Pinnacle archive's raw
rows, the object state, the summary table). No network.

Each check names the mutation that turns it red:
  1. a fixture the 180d index does not list yet (today's match) is cut at the live flip of the event key the post-start
     pull joined it to, and its close is kept       mutant: drop the event-key fallback in raw_flip (no start -> no close)
  2. the cut is the flip's last-not-live poll, never a later tick: a tick after it is not the close
  3. a fixture a bucket object already loaded is never overwritten from here (the bucket wins)   mutant: drop the
     in_bucket skip
  4. an unchanged payload is not fetched again; a newer pull of the same fixture is            mutant: drop the
     fingerprint skip
  5. an unreadable payload turns the run red and gets no state row                             mutant: drop the exit
  6. a raw row that carries no Pinnacle +30 book, or a back-fill pull, is never loaded
  7. the gate: an empty run, a store older than 36 h, an unreadable store or a missing report is red; 35 h is not
  8. the loader itself never names the archive table (only the GET-only reader may — the archive guard's allow-list)
"""
import gzip
import importlib.util
import json
import os
import sys
import tempfile
import types
from datetime import datetime, timedelta, timezone

sys.dont_write_bytecode = True
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'ten225-load-line-summary.py')
FAILED = []


def check(name, cond, detail=''):
    print(f'  {"ok  " if cond else "FAIL"} {name}' + ('' if cond else f'  [{detail}]'))
    if not cond:
        FAILED.append(name)


def load():
    L = types.ModuleType('L')
    L.__file__ = SRC
    sys.argv = ['L']
    exec(compile(open(SRC).read(), SRC, 'exec'), L.__dict__)
    return L


NOW = datetime.now(timezone.utc).replace(microsecond=0)
START = (NOW - timedelta(hours=2)).timestamp()        # the match started two hours ago
CAT = {'121': {'name': 'Winner', 'handicap': 0.0, 'outcomes': {'121': '1', '122': '2'}},
       '12175': {'name': 'Game Handicap', 'handicap': -3.5, 'outcomes': {'12175': '1', '12176': '2'}}}


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def tick(off, price):
    return {'createdAt': iso(START + off), 'price': price, 'limit': 500.0, 'active': True, 'exchangeMeta': None}


def payload(fid):
    # handicap: 2.20 two hours out, 2.30 two minutes before the start, 2.90 one minute AFTER it (in play)
    gh = {'outcomes': {'12175': {'players': {'0': [tick(-7200, 2.20), tick(-120, 2.30), tick(60, 2.90)]}},
                       '12176': {'players': {'0': [tick(-7200, 1.66), tick(-120, 1.62), tick(60, 1.40)]}}}}
    return {'fixtureId': fid, 'bookmakers': {'pinnacle+30': {'markets': {'12175': gh}}}}


def hexgz(obj):
    return '\\x' + gzip.compress(json.dumps(obj).encode()).hex()


class Fake:
    def __init__(self):
        self.raw = {}             # id -> row (with payload_gz)
        self.tables = {'oddspapi_line_summary': {}, 'oddspapi_line_summary_objects': {}}
        self.fetches = 0
        self.flips = []

    def install(self, L):
        f = self
        import urllib.parse as up

        def sb_json(path, url, key):
            q = up.parse_qs(path.split('?', 1)[1])
            if path.startswith('/rest/v1/oddspapi_archive_raw'):
                if 'payload_gz' in q['select'][0]:
                    f.fetches += 1
                    rid = int(q['id'][0].split('.', 1)[1])
                    r = f.raw[rid]
                    return [{'id': rid, 'payload_gz': r['payload_gz']}], None
                assert q['source'][0] == 'eq.oddspapi /v4/historical-odds', q
                trig = q['meta->>trigger'][0]
                assert trig.startswith('in.(') and trig.endswith(')'), trig
                ok_t = set(trig[4:-1].split(','))
                rows = sorted((r for r in f.raw.values() if r['meta'].get('trigger') in ok_t), key=lambda r: r['id'])
                off, lim = int(q['offset'][0]), int(q['limit'][0])
                return [{k: r[k] for k in ('id', 'fixture_id', 'pulled_at', 'books', 'meta')} for r in rows[off:off + lim]], None
            if 'oddspapi_line_summary_objects' in path:
                rows = sorted(f.tables['oddspapi_line_summary_objects'].values(), key=lambda r: r['object_path'])
                off, lim = int(q['offset'][0]), int(q['limit'][0])
                cols = q['select'][0].split(',')        # only what the loader asks for, as PostgREST does
                return [{k: r.get(k) for k in cols} for r in rows[off:off + lim]], None
            return [], None

        def upsert(url, key, table, rows, conflict):
            cols = conflict.split(',')
            t = f.tables.setdefault(table, {})
            for r in rows:
                t[tuple(r.get(c) for c in cols)] = dict(r)
            return len(rows), None

        L.sb_json, L.upsert = sb_json, upsert
        L.fetch_flips = lambda url, key, page=1000: (list(f.flips), None)


def run(L, fake, td, idx, mutate=None):
    fake.install(L)
    if mutate:
        mutate(L)
    L.INDEX = os.path.join(td, 'idx.json.gz')
    with gzip.open(L.INDEX, 'wt') as fh:
        json.dump({'fixtures': idx, 'spanDays': 180}, fh)
    L.CATALOGUE = os.path.join(td, 'cat.json.gz')
    with gzip.open(L.CATALOGUE, 'wt') as fh:
        json.dump(CAT, fh)
    L.OUT = os.path.join(td, 'out.json')
    os.environ['SUPABASE_URL'], os.environ['SUPABASE_SECRET_KEY'] = 'https://x.supabase.co', 'k'
    sys.argv = ['L', '--raw', '--raw-days', '3']
    fake.fetches = 0
    return L.main()


def raw_row(rid, fid, ek, books=('pinnacle+30',), pulled=None, trigger='post-start'):
    return {'id': rid, 'fixture_id': fid, 'pulled_at': pulled or iso(START + 900), 'books': list(books),
            'meta': {'eventKey': ek, 'trigger': trigger}, 'payload_gz': hexgz(payload(fid))}


def rows_of(fake, fid):
    return [r for k, r in fake.tables['oddspapi_line_summary'].items() if k[0] == fid]


with tempfile.TemporaryDirectory() as td:
    L = load()
    fake = Fake()
    fake.raw[1] = raw_row(1, 'idT', 777)                    # today's match: not in the index
    fake.raw[2] = raw_row(2, 'idB', 778)                    # a fixture the bucket already loaded
    fake.raw[3] = raw_row(3, 'idX', 779, books=('bet365',))  # another book's payload
    fake.raw[5] = raw_row(5, 'idF', 780, trigger='backfill') # a back-fill pull (weeks after its match)
    fake.flips = [{'event_key': 777, 'last_not_live_seen_at': iso(START - 30), 'gap_seconds': 60,
                   'first_player': 'A. Aa', 'second_player': 'B. Bb', 'event_date': iso(START)[:10]},
                  {'event_key': 778, 'last_not_live_seen_at': iso(START - 30), 'gap_seconds': 60,
                   'first_player': 'C. Cc', 'second_player': 'D. Dd', 'event_date': iso(START)[:10]}]
    # a bucket object's state row, as the bucket load writes it (the fixture is in the path; no fixture_id needed)
    fake.tables['oddspapi_line_summary_objects'][('2026-10/idB.json.gz',)] = {
        'object_path': '2026-10/idB.json.gz', 'fingerprint': 'x', 'row_keys': []}

    print('run 1 — a same-day payload, cut at the event key\'s live flip')
    rc = run(L, fake, td, {})
    check('run 1 exits 0', rc == 0, rc)
    t = [r for r in rows_of(fake, 'idT') if r['market'] == 'games handicap']
    check('1. today\'s fixture (not in the index) gets rows', len(t) == 2, len(t))
    check('1. its start is the live flip, source api-tennis-live',
          t and all(r['start_ts'] == iso(START - 30) and r['start_ts_source'] == 'api-tennis-live' for r in t),
          [(r['start_ts'], r['start_ts_source']) for r in t])
    side1 = [r for r in t if r['side'] == '1']
    check('1. the close is kept (reliable) at the last pre-start price', side1 and side1[0]['close_reliable']
          and side1[0]['close_price'] == 2.30, side1 and (side1[0]['close_price'], side1[0]['close_reliable']))
    check('2. an in-play tick (2.90, after the flip) is never the close', side1 and side1[0]['close_price'] != 2.90)
    check('3. a fixture a bucket object owns is never written from the archive', not rows_of(fake, 'idB'))
    check('6. a payload without Pinnacle +30 is never loaded', not rows_of(fake, 'idX'))
    check('6. a back-fill pull is never loaded (only post-start / backlog / re-cut pulls)', not rows_of(fake, 'idF'))
    st = fake.tables['oddspapi_line_summary_objects']
    check('run 1 writes a state row for the loaded payload only', ('archive-raw/1',) in st and ('archive-raw/2',) not in st,
          sorted(st))
    out = json.load(open(os.path.join(td, 'out.json')))
    check('the report counts the captured rows for the gate', out.get('captureRows') == len(rows_of(fake, 'idT')),
          out.get('captureRows'))

    print('\nrun 2 — nothing changed: nothing is fetched; a newer pull of the same fixture is')
    rc = run(L, fake, td, {})
    check('4. run 2 fetches no payload', rc == 0 and fake.fetches == 0, (rc, fake.fetches))
    fake.raw[4] = raw_row(4, 'idT', 777, pulled=iso(START + 2700))
    rc = run(L, fake, td, {})
    check('4. a newer pull of the fixture is fetched (once)', rc == 0 and fake.fetches == 1, (rc, fake.fetches))

    print('\nrun 3 — mutant: no event-key fallback -> no start, no close')
    fake3 = Fake()
    fake3.raw[1] = raw_row(1, 'idT', 777)
    fake3.flips = fake.flips
    rc = run(L, fake3, td, {}, mutate=lambda M: setattr(M, 'raw_flip', lambda fid, ek, fl, by: {}))
    t3 = [r for r in rows_of(fake3, 'idT') if r['side'] == '1']
    check('1. (control) without the fallback the close is a dash — so check 1 measures the fallback',
          t3 and t3[0]['close_price'] is None, t3 and t3[0]['close_price'])
    L = load()

    print('\nrun 4 — an unreadable payload')
    fake4 = Fake()
    fake4.raw[1] = dict(raw_row(1, 'idT', 777), payload_gz='\\x1f8b00')
    fake4.flips = fake.flips
    rc = run(L, fake4, td, {})
    check('5. an unreadable payload exits 1', rc == 1, rc)
    check('5. and gets no state row', not fake4.tables['oddspapi_line_summary_objects'], fake4.tables['oddspapi_line_summary_objects'])

print('\nthe gate')
spec = importlib.util.spec_from_file_location('gate', os.path.join(ROOT, 'tools', 'line-summary-gate.py'))
G = importlib.util.module_from_spec(spec)
spec.loader.exec_module(G)
now = datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)
check('7. a run that captured 0 rows is red', not G.judge(0, '2026-10-28T10:00:00Z', now, 1, 36)[0])
check('7. a store whose newest row started 37 h ago is red', not G.judge(5, '2026-10-26T23:00:00Z', now, 1, 36)[0])
check('7. 35 h is not', G.judge(5, '2026-10-27T01:00:00Z', now, 1, 36)[0])
check('7. no readable row is red', not G.judge(5, None, now, 1, 36)[0])
check('7. no loader report is red', not G.judge(None, '2026-10-28T10:00:00Z', now, 1, 36)[0])
check('7. the hourly gate (min 0) passes an hour that captured nothing while the store is fresh',
      G.judge(0, '2026-10-28T10:00:00Z', now, 0, 36)[0])

print('\nthe archive guard')
check('8. the loader never names the archive table', 'oddspapi_archive_raw' not in open(SRC).read())
reader = open(os.path.join(ROOT, 'tools', 'line_summary_archive.py')).read()
check('8. the reader only reads (no POST / PATCH / PUT / DELETE, no upsert)',
      not any(w in reader for w in ("'POST'", "'PATCH'", "'PUT'", "'DELETE'", 'merge-duplicates', 'upsert(')))

print('\nall checks passed' if not FAILED else f'\n{len(FAILED)} FAILED')
sys.exit(1 if FAILED else 0)
