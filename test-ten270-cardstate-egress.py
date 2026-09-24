#!/usr/bin/env python3
"""TEN-270 egress — the Kibl card job reads and writes only what changed.

Drives the REAL ten225-kibl-card-state.py (run_selection, read_card_state,
fetch_ref_cached, main) against a fake PostgREST installed at
urllib.request.urlopen — the one seam every request in that file goes through
(L.sb for GET/POST, sb_count for HEAD). The fake applies the query's own
select / filters / order / limit / offset, caps pages at 1,000 like the real
one, returns Content-Range on a counted HEAD, merges upserts on the grain, and
stamps updated_at / loaded_at with ITS OWN clock the way the new triggers do.
So a fake that is wrong in shape fails the real code, not a copy of it.

LOCKED
  a. the post-write recount is ONE counted HEAD, not a paged read
  b. the selection write-back sends only rows whose is_selected changed,
     each whole, never updated_at
  c. a matching probe serves oddspapi_fixtures / line_summary from the
     snapshot; a changed count or newest stamp re-reads them
  d. odds_card_state: snapshot + delta == a full read; a deselection arrives
     via the delta; a count mismatch forces a full read; the high-water mark is
     the SERVER's max updated_at, never the runner clock

MUTATION CONTROL — each reverts one change in a copy of the module and must
turn its test red. Run by this file on every invocation; see the bottom.
"""
import json
import os
import shutil
import sys
import tempfile
import types
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, 'ten225-kibl-card-state.py')
SRC = open(SCRIPT).read()


def load(src=SRC):
    M = types.ModuleType('K')
    M.__file__ = SCRIPT
    argv, sys.argv = sys.argv, ['K']
    try:
        exec(compile(src, SCRIPT, 'exec'), M.__dict__)
    finally:
        sys.argv = argv
    return M


# ------------------------------------------------------------ the fake server

def _iso(ep):
    return datetime.fromtimestamp(ep, timezone.utc).isoformat()   # +00:00, µs


def _ep(v):
    return datetime.fromisoformat(str(v).replace('Z', '+00:00')).timestamp()


TS_COLS = {'updated_at', 'loaded_at'}
GRAIN = ('fixture_id', 'book', 'market', 'side', 'line')
TOUCH = {'odds_card_state': 'updated_at', 'oddspapi_line_summary': 'loaded_at'}


class Resp:
    def __init__(self, body=b'', headers=None):
        self._b, self.headers = body, dict(headers or {})

    def read(self):
        return self._b

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakePG:
    """A small PostgREST over in-memory tables, with a server clock."""

    def __init__(self, tables, clock):
        self.t = {k: [dict(r) for r in v] for k, v in tables.items()}
        self.clock = clock          # server epoch; advanced by the test
        self.log = []               # (method, table, params, n_rows_returned)
        self.posts = []             # (table, payload rows)

    def tick(self, s=1.0):
        self.clock += s

    def _filter(self, rows, params):
        for k, v in params:
            if k in ('select', 'order', 'limit', 'offset', 'on_conflict'):
                continue
            op, _, val = v.partition('.')
            if k in TS_COLS:
                key = lambda r: _ep(r[k]) if r.get(k) else None   # noqa: E731
                val = _ep(val)
            else:
                key = lambda r: None if r.get(k) is None else str(r.get(k))  # noqa: E731
            if op == 'eq':
                rows = [r for r in rows if key(r) == val]
            elif op == 'neq':
                rows = [r for r in rows if key(r) != val]
            elif op in ('gt', 'gte'):
                rows = [r for r in rows if key(r) is not None and
                        (key(r) > val if op == 'gt' else key(r) >= val)]
            else:
                raise AssertionError(f'fake PostgREST: unsupported filter {k}={v}')
        return rows

    @staticmethod
    def _order(rows, spec):
        for part in reversed(spec.split(',')):
            bits = part.split('.')
            col, desc = bits[0], 'desc' in bits[1:]
            nf = ('nullsfirst' in bits) or (desc and 'nullslast' not in bits)
            present = [r for r in rows if r.get(col) is not None]
            nulls = [r for r in rows if r.get(col) is None]
            present.sort(key=lambda r: r[col], reverse=desc)
            rows = nulls + present if nf else present + nulls
        return rows

    def urlopen(self, req, timeout=None):
        u = urllib.parse.urlsplit(req.full_url)
        table = u.path.split('/rest/v1/', 1)[1]
        params = urllib.parse.parse_qsl(u.query, keep_blank_values=True)
        p = dict(params)
        method = req.get_method()
        rows = self.t.setdefault(table, [])
        if method == 'POST':
            return self._upsert(table, rows, p, json.loads(req.data.decode()))
        got = self._filter(rows, params)
        if method == 'HEAD':
            hdrs = {k.lower(): v for k, v in req.header_items()}
            assert 'count=exact' in hdrs.get('prefer', ''), 'HEAD without a count'
            self.log.append(('HEAD', table, p, 0))
            return Resp(b'', {'Content-Range': f'0-0/{len(got)}' if got else '*/0'})
        if 'order' in p:
            got = self._order(got, p['order'])
        off, lim = int(p.get('offset', 0)), min(int(p.get('limit', 1000)), 1000)
        got = got[off:off + lim]
        cols = p['select'].split(',')
        out = [{c: r.get(c) for c in cols} for r in got]
        self.log.append(('GET', table, p, len(out)))
        return Resp(json.dumps(out).encode())

    def _upsert(self, table, rows, p, payload):
        self.posts.append((table, payload))
        keycols = p['on_conflict'].split(',')
        idx = {tuple(r.get(c) for c in keycols): r for r in rows}
        touch = TOUCH.get(table)
        now = _iso(self.clock)
        for new in payload:
            k = tuple(new.get(c) for c in keycols)
            old = idx.get(k)
            if old is None:
                r = dict(new)
                if touch:
                    r[touch] = now
                rows.append(r)
                idx[k] = r
            elif any(old.get(c) != v for c, v in new.items() if c != touch):
                old.update(new)
                if touch:
                    old[touch] = now          # the BEFORE UPDATE trigger
        self.log.append(('POST', table, p, len(payload)))
        return Resp(b'')

    # Direct writes by "another writer" — same trigger semantics.
    def update(self, table, pred, **changes):
        for r in self.t[table]:
            if pred(r):
                r.update(changes)
                r[TOUCH[table]] = _iso(self.clock)

    def since(self, mark):
        return self.log[mark:]


# ------------------------------------------------------------------- fixtures

SERVER_T0 = datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp()   # far from the runner clock
OLD = SERVER_T0 - 86400
COLS_ALL = ('fixture_id,id_space,book,market,side,line,match_key,book_rank,'
            'is_selected,ts_kind,source,label,start_ts,start_ts_source,'
            'start_reject_reason,open_price,open_ts,open_limit,now_price,now_ts,'
            'close_price,close_ts,close_within_60').split(',')


def card(fid, book, rank, source, side, mkey, sel, now=1.8, stamp=SERVER_T0):
    r = {c: None for c in COLS_ALL}
    r.update(fixture_id=fid, id_space=source, book=book, market='match winner',
             side=side, line=None, match_key=mkey, book_rank=rank,
             is_selected=sel, ts_kind='vendor-insert', source=source,
             start_ts_source='none', open_price=now, open_ts='2026-09-24T08:00:00+00:00',
             now_price=now, now_ts='2026-09-24T09:00:00+00:00',
             updated_at=_iso(stamp))
    return r


def card_table():
    rows = []
    # A: kibl (rank 1) freshly reset to unselected by the filler; the oddspapi
    #    rows (rank 2) currently selected. Selection must flip all four.
    rows += [card('k1', 'bet105', 1, 'kibl', s, 'A', False, now=p) for s, p in (('1', 1.5), ('2', 2.6))]
    rows += [card('o1', 'bet365', 2, 'oddspapi', s, 'A', True, now=p) for s, p in (('1', 1.5), ('2', 2.6))]
    # B: oddspapi only, already selected — unchanged.
    rows += [card('o2', 'bet365', 2, 'oddspapi', s, 'B', True, now=p, stamp=OLD)
             for s, p in (('1', 1.4), ('2', 2.9))]
    # 2,500 rows no pass can select (no match_key), already unselected — so
    # the table spans three PostgREST pages and "unchanged" is the bulk.
    # Stamped a day before the A rows, so the A rows set the mark and the
    # overlap window holds only them.
    rows += [card(f'z{i:05d}', 'bet365', 2, 'oddspapi', '1', None, False, stamp=OLD)
             for i in range(2500)]
    return rows


def ref_tables():
    fx = [{'fixture_id': f'f{i:05d}', 'player1': 'A. X', 'player2': 'B. Y',
           'scheduled_start': '2026-09-20T10:00:00+00:00', 'true_start': None,
           'category_name': 'ATP', 'updated_at': _iso(SERVER_T0)} for i in range(1500)]
    ls = [{'fixture_id': f'f{i:05d}', 'book': 'bet365', 'market': m, 'side': s,
           'line': None, 'open_price': 1.9, 'open_ts': '2026-09-20T08:00:00+00:00',
           'close_price': None, 'start_ts': None, 'start_ts_source': 'none',
           'start_reject_reason': None, 'flip_gap_seconds': None,
           'loaded_at': _iso(SERVER_T0)}
          for i in range(700) for s in ('1', '2')
          for m in ('match winner', 'total games')]
    return {'oddspapi_fixtures': fx, 'oddspapi_line_summary': ls}


def install(M, pg, cache):
    urllib.request.urlopen = pg.urlopen
    M.CACHE_DIR = cache


def grain(r):
    return tuple(r.get(c) for c in GRAIN)


def canon(rows, strip=()):
    return sorted(({k: v for k, v in r.items() if k not in strip} for r in rows),
                  key=lambda r: tuple('' if v is None else str(v) for v in grain(r)))


FX_COLS = 'fixture_id,player1,player2,scheduled_start,true_start,category_name'
LS_COLS = ('fixture_id,market,side,open_price,open_ts,close_price,'
           'start_ts,start_ts_source,start_reject_reason,flip_gap_seconds')
LS_EXTRA = '&market=eq.match%20winner'


# ---------------------------------------------------------------------- tests

def t_a_recount_is_one_head(M, ok):
    cache = tempfile.mkdtemp()
    pg = FakePG({'odds_card_state': card_table()}, SERVER_T0 + 60)
    install(M, pg, cache)
    st, err = M.run_selection('https://x', 'k')
    ok(err is None, 'a: selection pass succeeds', err)
    last_post = max(i for i, e in enumerate(pg.log) if e[0] == 'POST')
    after = pg.log[last_post + 1:]
    ok([e[:2] for e in after] == [('HEAD', 'odds_card_state')],
       'a: after the write-back, exactly ONE request — a counted HEAD, no paged read',
       [e[:2] for e in after])
    # Same semantics: an upsert that INSERTS instead of merging must still fail.
    pg2 = FakePG({'odds_card_state': card_table()}, SERVER_T0 + 60)
    real = pg2._upsert

    def dup(table, rows, p, payload):
        p = dict(p, on_conflict='fixture_id,book,market,side,line,is_selected')
        return real(table, rows, p, payload)
    pg2._upsert = dup
    install(M, pg2, tempfile.mkdtemp())
    st2, err2 = M.run_selection('https://x', 'k')
    ok(err2 is not None and 'row count' in str(err2),
       'a: a write-back that grows the table is still refused (count != n_before)', err2)
    shutil.rmtree(cache, ignore_errors=True)


def t_b_writes_only_changed(M, ok):
    pg = FakePG({'odds_card_state': card_table()}, SERVER_T0 + 60)
    install(M, pg, tempfile.mkdtemp())
    st, err = M.run_selection('https://x', 'k')
    sent = [r for t, rows in pg.posts if t == 'odds_card_state' for r in rows]
    ok(sorted(grain(r) for r in sent) == sorted(
        [('k1', 'bet105', 'match winner', s, None) for s in '12'] +
        [('o1', 'bet365', 'match winner', s, None) for s in '12']),
       'b: only the 4 rows whose is_selected flipped are sent (of 2,506)',
       f'{len(sent)} sent')
    ok(all(set(r) == set(COLS_ALL) for r in sent),
       'b: each is sent WHOLE (every selection column) and without updated_at')
    ok(st.get('written') == 4, 'b: the pass counts what it wrote', st.get('written'))
    sel = {grain(r): r['is_selected'] for r in pg.t['odds_card_state']}
    ok(sel[('k1', 'bet105', 'match winner', '1', None)] is True
       and sel[('o1', 'bet365', 'match winner', '1', None)] is False
       and sel[('o2', 'bet365', 'match winner', '1', None)] is True,
       'b: the server ends in the selected state (kibl in, bet365 out on A; B kept)')
    # A second pass over the settled table writes nothing at all.
    n = len(pg.posts)
    M.run_selection('https://x', 'k')
    ok(len(pg.posts) == n, 'b: a settled table -> zero rows written', len(pg.posts) - n)


def t_c_reference_cache(M, ok):
    cache = tempfile.mkdtemp()
    pg = FakePG(ref_tables(), SERVER_T0 + 60)
    install(M, pg, cache)

    def both():
        a = M.fetch_ref_cached('https://x', 'k', 'oddspapi_fixtures', FX_COLS, '',
                               'fixture_id.asc', 'updated_at')
        b = M.fetch_ref_cached('https://x', 'k', 'oddspapi_line_summary', LS_COLS,
                               LS_EXTRA, M.SUMMARY_ORDER, 'loaded_at')
        return a, b

    def paged(entries):
        return [e for e in entries if e[0] == 'GET' and e[2].get('limit') == '1000']

    m0 = len(pg.log)
    (fx1, e1, how1), (ls1, e2, how2) = both()
    ok(how1 == how2 == 'full' and not e1 and not e2 and len(fx1) == 1500 and len(ls1) == 1400,
       'c: first run — no snapshot, both tables read in full', (how1, how2, len(fx1), len(ls1)))
    m1 = len(pg.log)
    (fx2, _, how1), (ls2, _, how2) = both()
    ok(how1 == how2 == 'cached' and not paged(pg.since(m1)),
       'c: matching probe -> NO paged read of either table', [e[:2] for e in paged(pg.since(m1))])
    ok(len(pg.since(m1)) == 4, 'c: the probe is 4 tiny requests (2 HEAD + 2 single-row)',
       [(e[0], e[1], e[2].get('limit')) for e in pg.since(m1)])
    ok(fx2 == fx1 and ls2 == ls1, 'c: the snapshot returns the same rows')
    # A daily-loader UPDATE of one match-winner row: count unchanged, newest
    # loaded_at moves (the new trigger) -> re-read, new value visible.
    pg.tick(3600)
    pg.update('oddspapi_line_summary',
              lambda r: r['fixture_id'] == 'f00003' and r['market'] == 'match winner'
              and r['side'] == '1', close_price=1.77)
    m2 = len(pg.log)
    (fx3, _, how1), (ls3, _, how2) = both()
    ok(how1 == 'cached' and how2 == 'full',
       'c: a changed line_summary stamp re-reads THAT table only', (how1, how2))
    ok(any(r['fixture_id'] == 'f00003' and r['side'] == '1' and r['close_price'] == 1.77
           for r in ls3), 'c: ...and the re-read carries the change')
    # A new fixture: count moves -> re-read.
    pg.t['oddspapi_fixtures'].append(dict(pg.t['oddspapi_fixtures'][0], fixture_id='f99999'))
    (fx4, _, how1), _x = both()
    ok(how1 == 'full' and len(fx4) == 1501, 'c: a changed count re-reads oddspapi_fixtures',
       (how1, len(fx4)))
    # Past 24 h the snapshot is not trusted even on a matching probe.
    (fx5, _, how1), _x = M.fetch_ref_cached(
        'https://x', 'k', 'oddspapi_fixtures', FX_COLS, '', 'fixture_id.asc',
        'updated_at', now_s=__import__('time').time() + 25 * 3600), None
    ok(how1 == 'full', 'c: a snapshot older than 24 h is re-read', how1)
    shutil.rmtree(cache, ignore_errors=True)


def t_d_incremental(M, ok):
    cache = tempfile.mkdtemp()
    pg = FakePG({'odds_card_state': card_table()}, SERVER_T0 + 60)
    install(M, pg, cache)
    cols = ','.join(COLS_ALL)

    def truth():
        return canon(pg.t['odds_card_state'])

    rows, err, info = M.read_card_state('https://x', 'k', cols)
    ok(info['mode'] == 'full' and canon(rows) == truth(),
       'd: no snapshot -> full read equal to the table', info['mode'])
    # Server clock is 2026-01-01; the runner clock is today. The mark must be
    # the server's own newest stamp.
    ok(info['hwm'] == max(r['updated_at'] for r in pg.t['odds_card_state']),
       'd: the high-water mark is the SERVER max(updated_at)', info['hwm'])

    # Another writer changes prices on 3 rows and DESELECTS one.
    pg.tick(300)
    pg.update('odds_card_state', lambda r: r['fixture_id'] == 'z00007', now_price=3.3)
    pg.update('odds_card_state', lambda r: r['fixture_id'] == 'o2' and r['side'] == '1',
              is_selected=False)
    pg.update('odds_card_state', lambda r: r['fixture_id'] == 'k1', now_price=1.45)
    m = len(pg.log)
    rows, err, info = M.read_card_state('https://x', 'k', cols)
    gets = [e for e in pg.since(m) if e[0] == 'GET']
    ok(info['mode'] == 'delta', 'd: snapshot present + counts agree -> delta read', info)
    ok(canon(rows) == truth(), 'd: snapshot + delta == a full read, row for row')
    # 4 changed + the 2 unchanged o1 rows that share the old mark and so sit
    # inside the overlap window. Not 2,506.
    ok(sum(e[3] for e in gets) == 6,
       'd: the delta moved only the 4 changed rows + 2 inside the overlap',
       sum(e[3] for e in gets))
    ok(all('updated_at' in e[2] and e[2]['updated_at'].startswith('gt.') for e in gets),
       'd: every delta GET is filtered on updated_at')
    since = _ep(gets[0][2]['updated_at'][3:])
    ok(abs(since - (SERVER_T0 + 0 - M.DELTA_OVERLAP_S)) < 2,
       'd: the delta starts at the previous SERVER mark minus the overlap',
       gets[0][2]['updated_at'])
    got = {grain(r): r for r in rows}
    ok(got[('o2', 'bet365', 'match winner', '1', None)]['is_selected'] is False,
       'd: a deselection by another writer arrives via the delta')

    # A delete (no stamp to find) -> count mismatch -> full read.
    pg.t['odds_card_state'] = [r for r in pg.t['odds_card_state'] if r['fixture_id'] != 'z00100']
    rows, err, info = M.read_card_state('https://x', 'k', cols)
    ok(info['mode'] == 'full' and canon(rows) == truth(),
       'd: a count mismatch forces a FULL read, equal to the table', info['mode'])

    # 24 h after the last full read -> full, whatever the counts say.
    rows, err, info = M.read_card_state('https://x', 'k', cols,
                                        now_s=__import__('time').time() + 25 * 3600)
    ok(info['mode'] == 'full', 'd: 24 h after the last full read -> full', info['mode'])

    # And the pass end to end on a delta: same selection as on a full read.
    pg.tick(60)
    st, err = M.run_selection('https://x', 'k')
    ok(err is None and st.get('read_mode') == 'delta',
       'd: run_selection runs on the delta path', (err, st.get('read_mode')))
    shutil.rmtree(cache, ignore_errors=True)


def t_main_wires_the_cache(M, ok):
    """main() itself reads the reference tables through the cache."""
    cache = tempfile.mkdtemp()
    t = ref_tables()
    t.update({'kibl_fixtures': [{'fixture_id': 1, 'league_id': 537,
                                 'scheduled_start': '2026-09-24T10:00:00+00:00',
                                 'name': 'A X vs B Y', 'player1_name': 'A X',
                                 'player2_name': 'B Y', 'match_key': None,
                                 'first_seen_at': '2026-09-23T10:00:00+00:00'}],
              'kibl_line_observations': [], 'live_flip_log': [],
              'odds_card_state': card_table()[:10]})
    pg = FakePG(t, SERVER_T0 + 60)
    install(M, pg, cache)
    M.OUT = os.path.join(cache, 'out.json')
    os.environ.setdefault('SUPABASE_URL', 'https://x')
    os.environ.setdefault('SUPABASE_SECRET_KEY', 'k')
    os.environ.pop('API_TENNIS_KEY', None)
    argv, sys.argv = sys.argv, ['K', '--dry-run']
    out = open(os.devnull, 'w')
    so, sys.stdout = sys.stdout, out
    try:
        M.main()
        m = len(pg.log)
        M.main()
    finally:
        sys.stdout, sys.argv = so, argv
    paged = {e[1] for e in pg.since(m) if e[0] == 'GET' and e[2].get('limit') == '1000'}
    ok('oddspapi_fixtures' not in paged and 'oddspapi_line_summary' not in paged,
       'main: a second run with an unchanged probe pages NEITHER reference table',
       sorted(paged))
    shutil.rmtree(cache, ignore_errors=True)


TESTS = [t_a_recount_is_one_head, t_b_writes_only_changed, t_c_reference_cache,
         t_d_incremental, t_main_wires_the_cache]


def run(M, verbose):
    failed = []

    def ok(cond, name, detail=''):
        if verbose:
            print(('  ok   ' if cond else '  FAIL ') + name
                  + ('' if cond or detail == '' else f'  [{detail}]'))
        if not cond:
            failed.append(name)
    real = urllib.request.urlopen
    so = sys.stdout
    try:
        for t in TESTS:
            if not verbose:
                sys.stdout = open(os.devnull, 'w')
            try:
                t(M, ok)
            except Exception as e:                  # noqa: BLE001 — a crash is a failure
                failed.append(f'{t.__name__} raised {type(e).__name__}: {e}')
                if verbose:
                    print(f'  FAIL {t.__name__} raised {type(e).__name__}: {e}')
            finally:
                sys.stdout = so
    finally:
        urllib.request.urlopen = real
    return failed


# One mutant per lock: each REVERTS one change. (anchor, replacement, the test
# letter that must go red).
MUTANTS = [
    ('a', 'recount by paging fixture_id back',
     "    n_after, rerr = sb_count(url, key, 'odds_card_state')\n",
     "    _r, rerr = fetch_all(url, key, 'odds_card_state', 'fixture_id')\n"
     "    n_after = len(_r)\n"),
    ('b', 'write back every row',
     "for r, w in zip(rows, was) if bool(r['is_selected']) != w]",
     "for r, w in zip(rows, was)]"),
    ('c', 'ignore the probe, always re-read',
     "    if (probe is not None and ent and ent.get('probe') == probe",
     "    if (False and ent and ent.get('probe') == probe"),
    ('d', 'high-water mark from the runner clock',
     "    hwm = max(stamps)[1] if stamps else None\n",
     "    hwm = iso(now_s)\n"),
    ('d', 'no count check on the merged set',
     "            if len(merged) != total:",
     "            if False:"),
    ('d', 'delta without the overlap window',
     "        since = iso(epoch(snap['hwm']) - DELTA_OVERLAP_S)",
     "        since = iso(epoch(snap['hwm']) + DELTA_OVERLAP_S)"),
    ('main', 'main reads oddspapi_fixtures directly again',
     "    ofx, err, _ = fetch_ref_cached(\n        url, key, 'oddspapi_fixtures',\n"
     "        'fixture_id,player1,player2,scheduled_start,true_start,category_name',\n"
     "        '', 'fixture_id.asc', 'updated_at')",
     "    ofx, err = fetch_all(url, key, 'oddspapi_fixtures',\n"
     "        'fixture_id,player1,player2,scheduled_start,true_start,category_name')"),
]


if __name__ == '__main__':
    print('TEN-270 card-state egress — real functions, fake PostgREST')
    failed = run(load(), verbose=True)
    print(f'\ncontrol: {"GREEN" if not failed else f"{len(failed)} FAILED"}')
    print('\nmutation control (each must turn the suite red):')
    survivors = []
    for letter, what, old, new in MUTANTS:
        n = SRC.count(old)
        if n != 1:
            survivors.append(what)
            print(f'  SURVIVED {letter}: {what} — anchor found {n}x (vacuous)')
            continue
        red = run(load(SRC.replace(old, new)), verbose=False)
        hit = [f for f in red if f.startswith(f'{letter}:') or f.startswith(f'{letter} ')
               or (letter == 'main' and f.startswith('main'))
               or f.startswith(f't_{letter}')]
        if hit:
            print(f'  CAUGHT   {letter}: {what}  ({len(red)} red, e.g. "{hit[0][:70]}")')
        else:
            survivors.append(what)
            print(f'  SURVIVED {letter}: {what}  red={red[:3]}')
    total = len(MUTANTS)
    print(f'\n{total - len(survivors)} of {total} mutants caught')
    if failed or survivors:
        sys.exit(1)
    print('all checks passed')
