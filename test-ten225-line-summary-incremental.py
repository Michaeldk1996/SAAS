#!/usr/bin/env python3
"""hotlines-mtb-and-loader, Fix 2 — the incremental, chunked bucket load of
ten225-load-line-summary.py, driven end to end through main() against an
in-memory Supabase (storage list/download, PostgREST read/upsert). No network.

What it proves, and the mutation that turns each check red:
  1. a run with every object already loaded and unchanged downloads NOTHING
     (control: the pre-fix loader downloads every object on every run — run this
     file with LLS_FILE pointing at it and check 1 fails)       mutant: drop the
     `prev.get('fingerprint') != fp` skip in plan_objects
  2. an object reloads when its START input moves (a later trueStart)      mutant:
     drop `start` from object_fingerprint
  3. a state row is written only for an object whose rows landed           mutant:
     upsert state before the chunk's rows
  4. the bet365-history pass never overwrites a key a bucket object owns, on a run
     that reloaded the object AND on one that skipped it                   mutant:
     drop the bucket_keys filter, or the state row_keys merge
  5. the deadline stops between chunks, keeps what was committed, exits 1 and the
     next run loads only the rest                                          mutant:
     `return 0` when remaining > 0
  6. an unreadable object state is not "nothing loaded": exit 1, nothing written
"""
import gzip
import json
import os
import sys
import tempfile
import types
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
SRC = os.environ.get('LLS_FILE') or os.path.join(HERE, 'ten225-load-line-summary.py')
FAILED = []


def check(name, cond, detail=''):
    print(f'  {"ok  " if cond else "FAIL"} {name}' + ('' if cond else f' {detail}'))
    if not cond:
        FAILED.append(name)


def load():
    L = types.ModuleType('L')
    L.__file__ = SRC
    sys.argv = ['L']
    exec(compile(open(SRC).read(), SRC, 'exec'), L.__dict__)
    return L


START = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc).timestamp()
CAT = {'121': {'name': 'Winner', 'handicap': 0.0, 'outcomes': {'121': '1', '122': '2'}},
       '12175': {'name': 'Game Handicap', 'handicap': -3.5, 'outcomes': {'12175': '1', '12176': '2'}}}


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def tick(off, price):
    return {'createdAt': iso(START + off), 'price': price, 'limit': 500.0, 'active': True, 'exchangeMeta': None}


def payload(fid, book):
    ml = {'outcomes': {'121': {'players': {'0': [tick(-7200, 1.50), tick(-120, 1.44)]}},
                       '122': {'players': {'0': [tick(-7200, 2.60), tick(-120, 2.80)]}}}}
    gh = {'outcomes': {'12175': {'players': {'0': [tick(-7200, 2.20), tick(-120, 2.30)]}},
                       '12176': {'players': {'0': [tick(-7200, 1.66), tick(-120, 1.62)]}}}}
    return {'fixtureId': fid, 'bookmakers': {book: {'markets': {'121': ml, '12175': gh}}}}


class FakeSB:
    """Bucket objects + tables. Counts downloads; can fail the state read."""
    def __init__(self, objects):
        self.objects = objects             # path -> (payload, created_at)
        self.tables = {'oddspapi_line_summary': {}, 'oddspapi_line_summary_objects': {}}
        self.downloads = 0
        self.fail_state_read = False
        self.order = []                    # (table, n) in upsert order

    def install(self, L):
        fake = self

        def sb_list(url, key, prefix, limit=1000):
            if prefix == '':
                months = sorted({p.split('/')[0] for p in fake.objects})
                return [{'name': m} for m in months], True
            return [{'name': p.split('/', 1)[1], 'created_at': fake.objects[p][1]}
                    for p in sorted(fake.objects) if p.startswith(prefix)], True

        def sb_download(url, key, path):
            fake.downloads += 1
            return fake.objects[path][0], None

        def upsert(url, key, table, rows, conflict):
            cols = conflict.split(',')
            t = fake.tables.setdefault(table, {})
            for r in rows:
                t[tuple(r.get(c) for c in cols)] = dict(r)
            fake.order.append((table, len(rows)))
            return len(rows), None

        def sb_json(path, url, key):
            if 'oddspapi_line_summary_objects' in path:
                if fake.fail_state_read:
                    return None, (500, 'boom')
                import urllib.parse as up
                q = up.parse_qs(path.split('?', 1)[1])
                rows = sorted(fake.tables['oddspapi_line_summary_objects'].values(), key=lambda r: r['object_path'])
                off, lim = int(q['offset'][0]), int(q['limit'][0])
                return [{k: r[k] for k in ('object_path', 'fingerprint', 'row_keys')} for r in rows[off:off + lim]], None
            return [], None                 # fetch_existing: no stored rows needed here

        L.sb_list, L.sb_download, L.upsert, L.sb_json = sb_list, sb_download, upsert, sb_json
        L.fetch_flips = lambda url, key, page=1000: ([], None)


def run(L, fake, td, idx, extra=()):
    fake.install(L)
    L.INDEX = os.path.join(td, 'idx.json.gz')
    with gzip.open(L.INDEX, 'wt') as fh:
        json.dump({'fixtures': idx, 'spanDays': 180}, fh)
    L.CATALOGUE = os.path.join(td, 'cat.json.gz')
    with gzip.open(L.CATALOGUE, 'wt') as fh:
        json.dump(CAT, fh)
    L.HISTORY_DIR = os.path.join(td, 'hist')
    L.OUT = os.path.join(td, 'out.json')
    os.environ['SUPABASE_URL'], os.environ['SUPABASE_SECRET_KEY'] = 'https://x.supabase.co', 'k'
    sys.argv = ['L', '--bucket', '--history'] + list(extra)
    fake.downloads = 0
    fake.order = []
    return L.main()


def meta(t):
    return {'cat': 'ATP', 'trueStart': iso(t), 'trueEnd': iso(t + 7200), 'startSched': iso(t), 'p1': 'A', 'p2': 'B'}


with tempfile.TemporaryDirectory() as td:
    os.makedirs(os.path.join(td, 'hist'))
    # bet365-history: idA (also in the bucket, as bet365) and idH (history only).
    json.dump({'book': 'bet365', 'market': 121, 'generatedAt': iso(START + 3600),
               'fixtures': {'idA': {'start': int(START), 'cat': 'ATP', 's1': [[int(START - 9000), 1.55]], 's2': [[int(START - 9000), 2.50]]},
                            'idH': {'start': int(START), 'cat': 'ATP', 's1': [[int(START - 9000), 1.70]], 's2': [[int(START - 9000), 2.10]]}}},
              open(os.path.join(td, 'hist', '2026-10.json'), 'w'))
    objs = {f'2026-10/id{c}.json.gz': (payload(f'id{c}', 'bet365' if c == 'A' else 'pinnacle+30'), iso(START + 3600))
            for c in 'ABCDE'}
    idx = {f'id{c}': meta(START) for c in 'ABCDEH'}
    L = load()
    has_state = hasattr(L, 'OBJECT_STATE_TABLE')
    fake = FakeSB(objs)

    print('run 1 — empty object state: every object loads')
    rc = run(L, fake, td, idx)
    check('run 1 exits 0', rc == 0, rc)
    check('run 1 downloads all 5 objects', fake.downloads == 5, fake.downloads)
    st = fake.tables.get('oddspapi_line_summary_objects', {})
    check('run 1 writes one state row per loaded object', len(st) == 5, len(st))
    ls = fake.tables['oddspapi_line_summary']
    a_ml = [r for k, r in ls.items() if k[0] == 'idA' and k[2] == 'match winner']
    check('idA match winner rows are the BUCKET\'s (history held back — bucket wins)',
          a_ml and all(r['source'] != 'bet365-history' for r in a_ml), [r['source'] for r in a_ml])
    check('idH (history only) still loads from history',
          any(k[0] == 'idH' and r['source'] == 'bet365-history' for k, r in ls.items()))
    if has_state:
        first_state_i = next(i for i, (t, _) in enumerate(fake.order) if t == 'oddspapi_line_summary_objects')
        first_rows_i = next(i for i, (t, _) in enumerate(fake.order) if t == 'oddspapi_line_summary')
        check('a chunk\'s state is written AFTER its rows', first_rows_i < first_state_i, fake.order)

    print('\nrun 2 — nothing changed: nothing downloads (check 1; the pre-fix loader fails it)')
    for r in a_ml:                                   # mark the bucket rows to see an overwrite
        r['source'] = 'MARK-bucket'
    rc = run(L, fake, td, idx)
    check('run 2 exits 0', rc == 0, rc)
    check('run 2 downloads 0 objects', fake.downloads == 0, fake.downloads)
    a_ml2 = [r for k, r in ls.items() if k[0] == 'idA' and k[2] == 'match winner']
    check('run 2: history still never overwrites the bucket-owned key (from the state row_keys)',
          all(r['source'] == 'MARK-bucket' for r in a_ml2), [r['source'] for r in a_ml2])

    print('\nrun 3 — idC\'s trueStart moved: only idC reloads')
    idx3 = dict(idx, idC=meta(START - 600))
    rc = run(L, fake, td, idx3)
    check('run 3 exits 0', rc == 0, rc)
    check('run 3 downloads exactly 1 object', fake.downloads == 1, fake.downloads)

    print('\nrun 4 — deadline: chunks of 1, clock past the deadline after the first chunk')
    fake4 = FakeSB(objs)
    if has_state:
        L.CHUNK_OBJECTS = 1
        clock = {'t': 0.0}

        def mono():
            clock['t'] += 1000.0                         # each read of the clock = 1000 s later
            return clock['t']
        L.time.monotonic = mono
    rc = run(L, fake4, td, idx, ['--deadline-min', '30'])
    check('run 4 exits 1 (an unfinished load never reads green)', rc == 1, rc)
    n4 = len(fake4.tables.get('oddspapi_line_summary_objects', {}))
    check('run 4 committed at least one chunk and not all', 0 < n4 < 5, n4)
    if has_state:
        import time as _t
        L.time.monotonic = _t.monotonic
        L.CHUNK_OBJECTS = 300
    rc = run(L, fake4, td, idx)
    check('run 5 loads only the rest and exits 0', rc == 0 and fake4.downloads == 5 - n4, (rc, fake4.downloads, n4))

    print('\nrun 6 — object state unreadable')
    fake6 = FakeSB(objs)
    fake6.fail_state_read = True
    rc = run(L, fake6, td, idx)
    check('run 6 exits 1', rc == 1, rc)
    check('run 6 writes nothing', not fake6.tables['oddspapi_line_summary'] and fake6.downloads == 0,
          (len(fake6.tables['oddspapi_line_summary']), fake6.downloads))

print('\n' + ('all checks passed' if not FAILED else f'{len(FAILED)} FAILED: {FAILED}'))
sys.exit(1 if FAILED else 0)
