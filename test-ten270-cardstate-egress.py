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
  b. the selection write-back sends grain + is_selected ALONE for only the
     rows whose value changed, in ONE ten270_set_selected call; a price a
     filler writes mid-pass survives it (review finding 2)
  g. that call is all-or-nothing: a change matching no row rolls back every
     deselect with it, so a card keeps its book; split only past the cap and
     never inside a card; a 404 is retried once (re-review item 1)
  c. a matching probe serves oddspapi_fixtures / line_summary from the
     snapshot; a changed count or newest stamp re-reads them
  d. odds_card_state: snapshot + delta == a full read; a deselection arrives
     via the delta; a count mismatch forces a full read; the high-water mark is
     the SERVER's max updated_at, never the runner clock
  e. a reference table stamped under 30 min ago is read in full and never
     cached — a batched load may still be landing (review finding 1)
  f. no touch trigger (missing, disabled, wrong function, or the catalog RPC
     absent) -> full read, nothing saved, any old snapshot dropped (finding 4)
  s. the DDL creates the exact trigger names the job checks for; the
     oddspapi_fixtures trigger keeps the old stamp on a no-op (finding 1)

MUTATION CONTROL — each reverts one change in a copy of the module and must
turn its test red. Run by this file on every invocation; see the bottom.
"""
import json
import os
import shutil
import sys
import tempfile
import types
import urllib.error
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
TOUCH = {'odds_card_state': 'updated_at', 'oddspapi_line_summary': 'loaded_at',
         'oddspapi_fixtures': 'updated_at'}
ALL_TRIGGERS = [{'tbl': t, 'trg': f'{t}_touch_{w}', 'fn': f'{t}_touch', 'enabled': True}
                for t in TOUCH for w in ('ins', 'upd')]


def _split_top(s):
    """Split a PostgREST logic-tree body on top-level commas (parens and
    double quotes respected)."""
    out, depth, q, cur, i = [], 0, False, '', 0
    while i < len(s):
        ch = s[i]
        if q and ch == '\\':
            cur += s[i:i + 2]
            i += 2
            continue
        if ch == '"':
            q = not q
        elif not q and ch == '(':
            depth += 1
        elif not q and ch == ')':
            depth -= 1
        if ch == ',' and depth == 0 and not q:
            out.append(cur)
            cur = ''
        else:
            cur += ch
        i += 1
    out.append(cur)
    return out


def _leaf(expr):
    col, op, val = expr.split('.', 2)
    if val.startswith('"'):
        val = val[1:-1].replace('\\"', '"').replace('\\\\', '\\')
    if op == 'is' and val == 'null':
        return lambda r: r.get(col) is None
    if op == 'eq':
        return lambda r: r.get(col) is not None and str(r.get(col)) == val
    raise AssertionError(f'fake PostgREST: unsupported leaf {expr}')


def _or_tree(tree):
    """`(and(a.eq."x",b.is.null),and(...))` -> predicate."""
    assert tree.startswith('(') and tree.endswith(')'), tree
    alts = []
    for part in _split_top(tree[1:-1]):
        assert part.startswith('and(') and part.endswith(')'), part
        leaves = [_leaf(x) for x in _split_top(part[4:-1])]
        alts.append(leaves)
    return lambda r: any(all(f(r) for f in leaves) for leaves in alts)


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
        self.patches = []           # (table, body, [grains matched])
        self.sets = []              # ten270_set_selected payloads, per call
        self.triggers = list(ALL_TRIGGERS)   # what the catalog RPC reports
        self.before_patch = None    # hook: a concurrent writer, run once

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
        if method == 'POST' and table == 'rpc/ten270_touch_triggers':
            self.log.append(('RPC', table, p, len(self.triggers or [])))
            if self.triggers is None:          # the function does not exist
                raise urllib.error.HTTPError(req.full_url, 404, 'Not Found', {},
                                             __import__('io').BytesIO(b'{"code":"PGRST202"}'))
            return Resp(json.dumps(self.triggers).encode())
        if method == 'POST' and table == 'rpc/ten270_set_selected':
            return self._set_selected(req, json.loads(req.data.decode())['p'])
        if method == 'POST':
            return self._upsert(table, rows, p, json.loads(req.data.decode()))
        if method == 'PATCH':
            return self._patch(table, rows, p, json.loads(req.data.decode()))
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

    def _set_selected(self, req, payload):
        """ten270_set_selected as the DDL writes it: deselects, then selects,
        each matching EXACTLY one row on the grain, in ONE transaction — any
        miss raises and nothing is kept."""
        if self.before_patch:
            hook, self.before_patch = self.before_patch, None
            hook()
        self.sets.append(payload)
        self.log.append(('RPC', 'rpc/ten270_set_selected', {}, len(payload)))
        rows = self.t['odds_card_state']
        saved = [dict(r) for r in rows]          # BEGIN
        n = 0
        for v in (False, True):
            for e in payload:
                assert set(e) == set(GRAIN) | {'is_selected'}, sorted(e)
                if e['is_selected'] is not v:
                    continue
                hit = [r for r in rows if grain(r) == grain(e)]
                if len(hit) != 1:                # RAISE -> ROLLBACK
                    rows[:] = saved
                    raise urllib.error.HTTPError(
                        req.full_url, 400, 'Bad Request', {}, __import__('io').BytesIO(
                            f'{{"code":"P0001","message":"matched {len(hit)} rows"}}'.encode()))
                if hit[0]['is_selected'] is not v:
                    hit[0]['is_selected'] = v
                    hit[0]['updated_at'] = _iso(self.clock)
                n += 1
        return Resp(json.dumps(n).encode())       # COMMIT

    def _patch(self, table, rows, p, body):
        if self.before_patch:
            hook, self.before_patch = self.before_patch, None
            hook()
            rows = self.t[table]
        pred = _or_tree(p['or'])
        hit = [r for r in rows if pred(r)]
        touch = TOUCH.get(table)
        for r in hit:
            if any(r.get(c) != v for c, v in body.items()):
                r.update(body)
                if touch:
                    r[touch] = _iso(self.clock)
        self.patches.append((table, body, [tuple(r.get(c) for c in GRAIN) for r in hit]))
        self.log.append(('PATCH', table, p, len(hit)))
        cols = p['select'].split(',')
        return Resp(json.dumps([{c: r.get(c) for c in cols} for r in hit]).encode())

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
    last_w = max(i for i, e in enumerate(pg.log) if e[0] in ('POST', 'PATCH')
                 or e[1] == 'rpc/ten270_set_selected')
    after = pg.log[last_w + 1:]
    ok([e[:2] for e in after] == [('HEAD', 'odds_card_state')],
       'a: after the write-back, exactly ONE request — a counted HEAD, no paged read',
       [e[:2] for e in after])
    # Same semantics: a table that GROWS under the pass must still fail.
    pg2 = FakePG({'odds_card_state': card_table()}, SERVER_T0 + 60)
    pg2.before_patch = lambda: pg2.t['odds_card_state'].append(
        card('new1', 'bet365', 2, 'oddspapi', '1', None, False))
    install(M, pg2, tempfile.mkdtemp())
    st2, err2 = M.run_selection('https://x', 'k')
    ok(err2 is not None and 'row count' in str(err2),
       'a: a write-back pass over a table that grew is still refused (count != n_before)', err2)
    shutil.rmtree(cache, ignore_errors=True)


def t_b_writes_only_changed(M, ok):
    pg = FakePG({'odds_card_state': card_table()}, SERVER_T0 + 60)
    install(M, pg, tempfile.mkdtemp())
    # A filler lands a fresher price on k1 BETWEEN this pass's read and its
    # write-back. The pass read 1.5; the server now holds 1.44.
    k1 = ('k1', 'bet105', 'match winner', '1', None)
    pg.before_patch = lambda: pg.update(
        'odds_card_state', lambda r: grain(r) == k1, now_price=1.44)
    st, err = M.run_selection('https://x', 'k')
    ok(err is None, 'b: selection pass succeeds', err)
    ok(len(pg.sets) == 1, 'b: ONE set_selected call for the whole run', len(pg.sets))
    sent = [grain(e) for call in pg.sets for e in call]
    ok(sorted(sent, key=str) == sorted(
        [('k1', 'bet105', 'match winner', s, None) for s in '12'] +
        [('o1', 'bet365', 'match winner', s, None) for s in '12'], key=str),
       'b: only the 4 rows whose is_selected flipped are written (of 2,506)',
       f'{len(sent)} written')
    ok(not [t for t, _ in pg.posts if t == 'odds_card_state'] and not pg.patches,
       'b: no upsert and no PATCH of odds_card_state — only the RPC',
       (len(pg.posts), len(pg.patches)))
    ok(all(set(e) == set(GRAIN) | {'is_selected'} for call in pg.sets for e in call),
       'b: each change is grain + is_selected ALONE — no price, no updated_at',
       [sorted(e) for call in pg.sets for e in call][:1])
    row = {grain(r): r for r in pg.t['odds_card_state']}
    ok(row[k1]['now_price'] == 1.44,
       'b: a fresher price written mid-pass SURVIVES the write-back (no stale price)',
       row[k1]['now_price'])
    ok(st.get('written') == 4, 'b: the pass counts what it wrote', st.get('written'))
    sel = {g: r['is_selected'] for g, r in row.items()}
    ok(sel[('k1', 'bet105', 'match winner', '1', None)] is True
       and sel[('o1', 'bet365', 'match winner', '1', None)] is False
       and sel[('o2', 'bet365', 'match winner', '1', None)] is True,
       'b: the server ends in the selected state (kibl in, bet365 out on A; B kept)')
    # A second pass over the settled table writes nothing at all.
    n = len(pg.sets)
    M.run_selection('https://x', 'k')
    ok(len(pg.sets) == n, 'b: a settled table -> no write call at all', len(pg.sets) - n)
    # A grain value that needs quoting (comma, dot, paren, quote) still
    # matches exactly one row.
    odd = 'k,1.(x)"y'
    t = card_table()
    for r in t:
        if r['fixture_id'] == 'k1':
            r['fixture_id'] = odd
    pg3 = FakePG({'odds_card_state': t}, SERVER_T0 + 60)
    install(M, pg3, tempfile.mkdtemp())
    st3, err3 = M.run_selection('https://x', 'k')
    ok(err3 is None and st3.get('written') == 4
       and all(r['is_selected'] for r in pg3.t['odds_card_state'] if r['fixture_id'] == odd),
       'b: a fixture_id with , . ( ) " is written exactly', err3)


def _sel(pg):
    return {grain(r): r['is_selected'] for r in pg.t['odds_card_state']}


def t_g_atomic(M, ok):
    """Re-review item 1: the card moves books in ONE transaction."""
    M.SET_SELECTED_RETRY_S = 0
    pg = FakePG({'odds_card_state': card_table()}, SERVER_T0 + 60)
    install(M, pg, tempfile.mkdtemp())
    before = _sel(pg)
    # The kibl side-2 row vanishes between the read and the write: the SELECT
    # half of card A's move cannot land.
    pg.before_patch = lambda: pg.t.__setitem__('odds_card_state', [
        r for r in pg.t['odds_card_state']
        if grain(r) != ('k1', 'bet105', 'match winner', '2', None)])
    st, err = M.run_selection('https://x', 'k')
    after = _sel(pg)
    ok(err is not None, 'g: a change that matches no row fails the write-back', err)
    ok(all(after[g] == before[g] for g in after),
       'g: ...and NOTHING was applied — the deselects rolled back with it')
    ok(after[('o1', 'bet365', 'match winner', '1', None)] is True,
       'g: card A still has a selected book (bet365), not a dash')
    # A 404 (schema cache not reloaded yet) is retried once, then succeeds.
    pg2 = FakePG({'odds_card_state': card_table()}, SERVER_T0 + 60)
    real, calls = pg2._set_selected, []

    def flaky(req, payload):
        calls.append(1)
        if len(calls) == 1:
            raise urllib.error.HTTPError(req.full_url, 404, 'Not Found', {},
                                         __import__('io').BytesIO(b'{}'))
        return real(req, payload)
    pg2._set_selected = flaky
    install(M, pg2, tempfile.mkdtemp())
    st2, err2 = M.run_selection('https://x', 'k')
    ok(err2 is None and len(calls) == 2 and st2.get('written') == 4,
       'g: a 404 is retried once and then written', (err2, len(calls)))
    # Chunking: only past the cap, and never inside a card.
    def ch(fid, book, side, mk, v):
        return (dict(card(fid, book, 1, 'kibl', side, mk, not v)), v)
    changes = ([ch('k1', 'bet105', s, 'A', True) for s in '12']
               + [ch('o1', 'bet365', s, 'A', False) for s in '12']
               + [ch('k2', 'bet105', s, 'C', True) for s in '12']
               + [ch('o3', 'bet365', s, 'C', False) for s in '12']
               + [ch('z1', 'bet365', '1', None, False)])
    ok(len(M._selection_calls(changes)) == 1,
       'g: under the cap -> ONE call', len(M._selection_calls(changes)))
    parts = M._selection_calls(changes, max_rows=3)
    cards = {'A': {i for i, part in enumerate(parts) for e in part if e['fixture_id'] in ('k1', 'o1')},
             'C': {i for i, part in enumerate(parts) for e in part if e['fixture_id'] in ('k2', 'o3')}}
    ok(len(parts) > 1 and all(len(v) == 1 for v in cards.values())
       and sum(len(p) for p in parts) == 9,
       'g: over the cap -> split, but both books of a card share one call',
       [[e['fixture_id'] for e in p] for p in parts])


def t_e_settling_not_cached(M, ok):
    """Finding 1: a reference table written in the last 30 min may be mid-load."""
    cache = tempfile.mkdtemp()
    pg = FakePG(ref_tables(), SERVER_T0 + 60)
    install(M, pg, cache)

    def fx(now_s):
        return M.fetch_ref_cached('https://x', 'k', 'oddspapi_fixtures', FX_COLS, '',
                                  'fixture_id.asc', 'updated_at', now_s=now_s)
    # Loader batch 1 of 3 has just landed (the trigger stamps the server clock).
    pg.update('oddspapi_fixtures', lambda r: r['fixture_id'] < 'f00500',
              category_name='ATP 250')
    _r, e1, h1 = fx(SERVER_T0 + 120)
    snap = M._load_snapshot(M.REF_SNAPSHOT) or {}
    ok(h1 == 'full' and not e1 and 'oddspapi_fixtures' not in (snap.get('tables') or {}),
       'e: newest stamp under 30 min old -> full read, NOTHING cached', h1)
    # Batches 2 and 3 land. The next run must see them, not a half-load.
    pg.tick(60)
    pg.update('oddspapi_fixtures', lambda r: r['fixture_id'] >= 'f00500',
              category_name='ATP 250')
    rows, _e, h2 = fx(SERVER_T0 + 300)
    ok(h2 == 'full' and all(r['category_name'] == 'ATP 250' for r in rows),
       'e: the run after the load completes sees every batch', h2)
    # Quiet for 30+ min -> cached from then on.
    fx(SERVER_T0 + 3 * 3600)
    _r, _e, h3 = fx(SERVER_T0 + 3 * 3600 + 300)
    ok(h3 == 'cached', 'e: a table quiet for 30+ min is cached again', h3)
    shutil.rmtree(cache, ignore_errors=True)


def t_f_no_trigger_no_cache(M, ok):
    """Finding 4: a missing trigger -> full reads, nothing saved, old dropped."""
    cols = ','.join(COLS_ALL)
    cache = tempfile.mkdtemp()
    pg = FakePG(dict(ref_tables(), odds_card_state=card_table()), SERVER_T0 + 60)
    install(M, pg, cache)
    # Warm both caches with the triggers present.
    M.read_card_state('https://x', 'k', cols)
    M.fetch_ref_cached('https://x', 'k', 'oddspapi_fixtures', FX_COLS, '',
                       'fixture_id.asc', 'updated_at')
    _r, _e, info = M.read_card_state('https://x', 'k', cols)
    ok(info['mode'] == 'delta', 'f: control — with triggers, the delta path runs', info['mode'])
    # The card trigger is dropped (disabled) and the fixtures one never installed.
    pg.triggers = [dict(t, enabled=(t['tbl'] != 'odds_card_state'))
                   for t in ALL_TRIGGERS if t['tbl'] != 'oddspapi_fixtures']
    _r, _e, info = M.read_card_state('https://x', 'k', cols)
    ok(info['mode'] == 'full', 'f: card trigger disabled -> full read', info['mode'])
    ok(not os.path.exists(os.path.join(cache, M.CARD_SNAPSHOT)),
       'f: ...and the card snapshot is dropped, none saved')
    _r, _e, h = M.fetch_ref_cached('https://x', 'k', 'oddspapi_fixtures', FX_COLS, '',
                                   'fixture_id.asc', 'updated_at')
    snap = M._load_snapshot(M.REF_SNAPSHOT) or {}
    ok(h == 'full' and 'oddspapi_fixtures' not in (snap.get('tables') or {}),
       'f: fixtures trigger missing -> full read, snapshot entry dropped', h)
    # The trigger comes back: the first run is a full read (nothing to merge).
    pg.triggers = list(ALL_TRIGGERS)
    _r, _e, info = M.read_card_state('https://x', 'k', cols)
    ok(info['mode'] == 'full', 'f: trigger back -> first read is full, not a stale delta',
       info['mode'])
    # The RPC itself missing (schema file not applied yet) = nothing guarded.
    pg.triggers = None
    ok(M.touch_guarded('https://x', 'k')[0] == set(),
       'f: trigger RPC 404 -> no table guarded')
    _r, _e, info = M.read_card_state('https://x', 'k', cols)
    ok(info['mode'] == 'full', 'f: ...and the card read is full', info['mode'])
    # A trigger calling the WRONG function does not count.
    pg.triggers = [dict(t, fn='something_else') if t['trg'] == 'odds_card_state_touch_upd'
                   else t for t in ALL_TRIGGERS]
    ok('odds_card_state' not in M.touch_guarded('https://x', 'k')[0],
       'f: a same-named trigger on another function is not a guard')
    shutil.rmtree(cache, ignore_errors=True)


SQL_LS_PATH = os.path.join(HERE, 'ten225-line-summary-schema.sql')
SQL_CS_PATH = os.path.join(HERE, 'ten225-card-state-schema.sql')
SQL = {'ls': open(SQL_LS_PATH).read(), 'cs': open(SQL_CS_PATH).read()}


def t_s_schema_names(M, ok):
    """The names touch_guarded() demands are the names the DDL creates, on the
    right tables, and the fixtures trigger ignores the loader's own stamp."""
    import re
    ls, cs = SQL['ls'], SQL['cs']
    for t, text in (('oddspapi_fixtures', ls), ('oddspapi_line_summary', ls),
                    ('odds_card_state', cs)):
        for w, ev in (('ins', 'INSERT'), ('upd', 'UPDATE')):
            pat = (rf'CREATE OR REPLACE TRIGGER {t}_touch_{w}\s+BEFORE {ev} ON {t}\s+'
                   rf'FOR EACH ROW\s+(WHEN \(.*?\)\s+)?EXECUTE FUNCTION {t}_touch\(\)')
            ok(re.search(pat, text, re.S) is not None,
               f's: {t}_touch_{w} is BEFORE {ev} ON {t} calling {t}_touch()')
    m = re.search(r'FUNCTION oddspapi_fixtures_touch\(\).*?END \$\$', ls, re.S)
    body = m.group(0) if m else ''
    ok("NEW.updated_at := now();" in body and 'NEW.updated_at := OLD.updated_at;' in body,
       's: fixtures touch stamps now() on change and KEEPS the old stamp on a no-op')
    ok(re.search(r'TRIGGER oddspapi_fixtures_touch_upd\s+BEFORE UPDATE ON oddspapi_fixtures\s+'
                 r'FOR EACH ROW EXECUTE', ls) is not None,
       's: the fixtures UPDATE trigger has no WHEN gate (the loader sends updated_at)')
    m = re.search(r'FUNCTION ten270_set_selected\(p jsonb\).*?END \$\$;', cs, re.S)
    fn = m.group(0) if m else ''
    ok('SECURITY DEFINER' in fn and 'SET search_path = pg_catalog, pg_temp' in fn,
       's: set_selected is SECURITY DEFINER with a pinned search_path')
    ok('UPDATE public.odds_card_state c' in fn and re.search(r'SET is_selected = v\s+WHERE', fn)
       and 'price' not in fn.split('UPDATE', 1)[-1].split('GET DIAGNOSTICS')[0],
       's: set_selected UPDATEs is_selected alone, on the qualified table')
    ok(re.search(r'IF n <> 1 THEN\s+RAISE EXCEPTION', fn) is not None,
       's: set_selected RAISES (rolls back) unless each change matched one row')
    ok('FOREACH v IN ARRAY ARRAY[false, true] LOOP' in fn,
       's: set_selected deselects before it selects')
    ok('REVOKE EXECUTE ON FUNCTION ten270_set_selected(jsonb) FROM PUBLIC;' in cs
       and 'REVOKE EXECUTE ON FUNCTION ten270_set_selected(jsonb) FROM anon, authenticated;' in cs
       and 'GRANT EXECUTE ON FUNCTION ten270_set_selected(jsonb) TO service_role;' in cs
       and M.SET_SELECTED_RPC.endswith('/ten270_set_selected'),
       's: set_selected is service_role only, and is the RPC the job calls')
    m = re.search(r'FUNCTION ten270_touch_triggers\(\).*?\$\$;', cs, re.S)
    ok(m is not None and 'SET search_path = pg_catalog, pg_temp' in m.group(0),
       's: touch_triggers pins its search_path')
    ok('ten270_touch_triggers' in cs and 'GRANT EXECUTE ON FUNCTION ten270_touch_triggers() '
       'TO service_role' in cs and M.TOUCH_RPC.endswith('/ten270_touch_triggers'),
       's: the catalog RPC exists in the card-state DDL and is the one the job calls')


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
    ok(len([e for e in pg.since(m1) if e[0] != 'RPC']) == 4,
       'c: the probe is 4 tiny requests (2 HEAD + 2 single-row)',
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
    ok(sum(1 for e in pg.since(m) if e[0] == 'RPC') == 1,
       'main: ONE trigger-catalog call per run, shared by every cache',
       sum(1 for e in pg.since(m) if e[0] == 'RPC'))
    shutil.rmtree(cache, ignore_errors=True)


TESTS = [t_a_recount_is_one_head, t_b_writes_only_changed, t_c_reference_cache,
         t_d_incremental, t_e_settling_not_cached, t_f_no_trigger_no_cache,
         t_g_atomic, t_s_schema_names, t_main_wires_the_cache]


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
    # Finding 2: the pre-review write-back — whole rows, snapshot prices and all.
    ('b', 'write back WHOLE rows by upsert (snapshot prices)',
     "        sent, uerr = set_selected(url, key, changed)\n",
     "        sent, uerr = L.upsert(url, key, 'odds_card_state', [\n"
     "            {f: r.get(f) for f in cols.split(',')} for r, _v in changed],\n"
     "            'fixture_id,book,market,side,line')\n"),
    ('b', 'price columns ride along in the RPC payload',
     "            dict({f: r.get(f) for f in CARD_GRAIN}, is_selected=bool(v)))",
     "            dict(r, is_selected=bool(v)))"),
    # Re-review item 1.
    ('g', 'deselect and select as two separate calls',
     "    for payload in _selection_calls(changes):\n",
     "    for payload in [[x for c in _selection_calls(changes) for x in c\n"
     "                     if x['is_selected'] is v] for v in (False, True)]:\n"),
    ('g', 'chunk by plain slicing (splits a card)',
     "    calls, cur = [], []\n",
     "    flat = [x for g in cards.values() for x in g]\n"
     "    return [flat[i:i + max_rows] for i in range(0, len(flat), max_rows)]\n"),
    ('g', 'no retry on a 404',
     "            if got is None and err and err[0] == 404 and attempt == 1:",
     "            if False:"),
    ('c', 'ignore the probe, always re-read',
     "    if (probe is not None and not settling and ent and ent.get('probe') == probe",
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
    # Finding 1.
    ('e', 'cache a table written minutes ago',
     "    settling = ne is not None and now_s - ne < REF_QUIET_S\n",
     "    settling = False\n"),
    # Finding 4.
    ('f', 'card delta without asking for the trigger',
     "    trig = 'odds_card_state' in _guarded(url, key, guarded)\n",
     "    trig = True\n"),
    ('f', 'reference cache without asking for the trigger',
     "    if table not in _guarded(url, key, guarded):\n",
     "    if False:\n"),
    ('f', 'any enabled trigger counts, whatever it calls',
     "            if r.get('enabled') is True and r.get('fn') == f'{t}_touch':\n",
     "            if r.get('enabled') is True:\n"),
    ('main', 'main reads oddspapi_fixtures directly again',
     "    ofx, err, _ = fetch_ref_cached(\n        url, key, 'oddspapi_fixtures',\n"
     "        'fixture_id,player1,player2,scheduled_start,true_start,category_name',\n"
     "        '', 'fixture_id.asc', 'updated_at', guarded=guarded)",
     "    ofx, err = fetch_all(url, key, 'oddspapi_fixtures',\n"
     "        'fixture_id,player1,player2,scheduled_start,true_start,category_name')"),
    ('main', 'each cache asks for the triggers itself',
     "        '', 'fixture_id.asc', 'updated_at', guarded=guarded)",
     "        '', 'fixture_id.asc', 'updated_at')"),
    # The DDL (finding 1's trigger and finding 4's names). 'sql:<file>' target.
    ('s', 'no UPDATE trigger on oddspapi_fixtures',
     "CREATE OR REPLACE TRIGGER oddspapi_fixtures_touch_upd\n", "-- dropped\n", 'ls'),
    ('s', 'fixtures no-op upsert takes the loader\'s stamp',
     "    NEW.updated_at := OLD.updated_at;\n", "    NULL;\n", 'ls'),
    ('s', 'fixtures UPDATE trigger gated by WHEN',
     "  BEFORE UPDATE ON oddspapi_fixtures\n  FOR EACH ROW EXECUTE",
     "  BEFORE UPDATE ON oddspapi_fixtures\n  FOR EACH ROW\n"
     "  WHEN ((to_jsonb(OLD) - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at'))\n"
     "  EXECUTE", 'ls'),
    ('s', 'set_selected selects before deselecting',
     "FOREACH v IN ARRAY ARRAY[false, true] LOOP", "FOREACH v IN ARRAY ARRAY[true, false] LOOP", 'cs'),
    ('s', 'set_selected tolerates a miss',
     "      IF n <> 1 THEN\n", "      IF n > 1 THEN\n", 'cs'),
    ('s', 'set_selected not SECURITY DEFINER',
     "  SECURITY DEFINER\n", "", 'cs'),
    ('s', 'set_selected executable by anon',
     "REVOKE EXECUTE ON FUNCTION ten270_set_selected(jsonb) FROM anon, authenticated;\n", "", 'cs'),
    ('s', 'touch_triggers search_path unpinned',
     "  LANGUAGE sql STABLE\n  SET search_path = pg_catalog, pg_temp\n", "  LANGUAGE sql STABLE\n", 'cs'),
]


if __name__ == '__main__':
    print('TEN-270 card-state egress — real functions, fake PostgREST')
    failed = run(load(), verbose=True)
    print(f'\ncontrol: {"GREEN" if not failed else f"{len(failed)} FAILED"}')
    print('\nmutation control (each must turn the suite red):')
    survivors = []
    for letter, what, old, new, *tgt in MUTANTS:
        text = SQL[tgt[0]] if tgt else SRC
        n = text.count(old)
        if n != 1:
            survivors.append(what)
            print(f'  SURVIVED {letter}: {what} — anchor found {n}x (vacuous)')
            continue
        if tgt:
            keep = SQL[tgt[0]]
            SQL[tgt[0]] = keep.replace(old, new)
            try:
                red = run(load(), verbose=False)
            finally:
                SQL[tgt[0]] = keep
        else:
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
