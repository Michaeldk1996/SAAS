#!/usr/bin/env python3
"""TEN-270 egress (founder 2026-09-24T10:16Z): the publisher filters its reads
ON THE SERVER, and build() must publish exactly what the old full-table reads
published. A fake PostgREST applies the query's own filters to an in-memory
table, so the test fails if a filter is missing, wrong, or drops a row build()
would have kept."""
import importlib.util
import os
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('pub', os.path.join(HERE, 'ten225-publish-card-state.py'))
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)

PASS = FAIL = 0


def ok(c, name):
    global PASS, FAIL
    PASS, FAIL = (PASS + 1, FAIL) if c else (PASS, FAIL + 1)
    print(('  ok   ' if c else '  FAIL ') + name)


def row(fid, space, key, side, sel=True, market='match winner', price=1.5):
    return {'fixture_id': fid, 'id_space': space, 'book': 'bet105', 'market': market, 'side': side,
            'line': None, 'match_key': key, 'book_rank': 1, 'is_selected': sel, 'ts_kind': 'vendor-insert',
            'open_price': price, 'open_ts': '2026-09-20T10:00:00Z', 'open_limit': None,
            'open_observed_at': '2026-09-20T10:01:00Z', 'now_price': price, 'now_ts': '2026-09-24T08:00:00Z',
            'now_observed_at': '2026-09-24T08:01:00Z', 'close_price': None, 'close_ts': None,
            'close_within_60': None, 'start_ts': None, 'start_ts_source': None, 'start_reject_reason': None,
            'source': 'kibl', 'label': None}


A = ['alpha', 'bravo', 'charlie', 'delta', 'echo']
B = ['kilo', 'lima', 'mike', 'november', 'oscar']
CARDS = []
for i, (d, sp) in enumerate([('2026-09-24', 'kibl'), ('2026-09-25', 'oddspapi'), ('2026-09-10', 'kibl'),
                             ('2026-10-15', 'oddspapi'), ('2026-09-24', 'oddspapi')]):
    k = f'{d}|{A[i]}|{B[i]}'
    CARDS += [row(100 + i, sp, k, '1'), row(100 + i, sp, k, '2', price=2.5)]
CARDS += [row(200, 'kibl', '2026-09-24|ccc|ddd', '1', sel=False), row(201, 'kibl', '2026-09-24|eee|fff', '1', market='totals')]
TABLES = {
    'odds_card_state': CARDS,
    'oddspapi_fixtures': [{'fixture_id': 100 + i, 'player1': f'P. {A[i].title()}', 'player2': f'Q. {B[i].title()}',
                           'category_name': 'ATP', 'tournament_name': 'X'} for i in range(5)]
                         + [{'fixture_id': 900 + j, 'player1': 'x', 'player2': 'y', 'category_name': 'ITF',
                             'tournament_name': 'Z'} for j in range(400)],
    'kibl_fixtures': [{'fixture_id': 100 + i, 'player1_name': f'P. {A[i].title()}', 'player2_name': f'Q. {B[i].title()}',
                       'league_id': 19} for i in range(5)] + [{'fixture_id': 200, 'player1_name': 'a', 'player2_name': 'b', 'league_id': 1}],
}
CALLS = []


def fake_fetch(url, key, table, cols, extra=''):
    """A tiny PostgREST: eq / gte / lt / in filters, as the query states them."""
    CALLS.append((table, extra))
    out = list(TABLES[table])
    for part in [p for p in extra.split('&') if p]:
        col, _, cond = part.partition('=')
        if col in ('order', 'limit', 'offset'):
            continue
        op, _, val = cond.partition('.')
        val = urllib.parse.unquote(val)
        if op == 'eq':
            out = [r for r in out if str(r.get(col)).lower() == val.lower()]
        elif op == 'gte':
            out = [r for r in out if str(r.get(col)) >= val]
        elif op == 'lt':
            out = [r for r in out if str(r.get(col)) < val]
        elif op == 'in':
            vals = set(val.strip('()').split(','))
            out = [r for r in out if str(r.get(col)) in vals]
        else:
            raise AssertionError('unexpected filter ' + part)
    return out


window = ('2026-09-17', '2026-10-02')
board = {}
full = P.build(TABLES['odds_card_state'],
               {str(r['fixture_id']): r for r in TABLES['oddspapi_fixtures']},
               {str(r['fixture_id']): r for r in TABLES['kibl_fixtures']}, board, window)
rows, ofx, kfx = P.read_inputs('u', 'k', window, fetch=fake_fetch)
new = P.build(rows, ofx, kfx, board, window)
ok(new[0] == full[0] and len(new[0]) == 3,
   f'the filtered reads publish exactly what the full reads published ({len(new[0])} of {len(full[0])} matches)')
ok(len(rows) == 6, f'only selected match-winner rows inside the window are read (got {len(rows)} of {len(CARDS)})')
card_q = [e for t, e in CALLS if t == 'odds_card_state'][0]
for frag in ('is_selected=eq.true', 'match_key=gte.2026-09-17', 'match_key=lt.2026-10-03', 'order='):
    ok(frag in card_q, f'odds_card_state query carries {frag}')
fx_q = [e for t, e in CALLS if t == 'oddspapi_fixtures']
ok(fx_q and all('fixture_id=in.(' in e for e in fx_q), 'oddspapi_fixtures is read BY ID, never whole')
ok(len(ofx) == 2, f'only the fixtures the kept rows need (got {len(ofx)} of {len(TABLES["oddspapi_fixtures"])})')
CALLS.clear()
rows_all, _, _ = P.read_inputs('u', 'k', (None, None), fetch=fake_fetch)
ok('match_key=gte' not in CALLS[0][1] and len(rows_all) == 10,
   'an empty board reads every selected row (no window is guessed)')
big = [str(i) for i in range(P.ID_CHUNK * 2 + 5)]
TABLES['odds_card_state'] = [row(int(i), 'oddspapi', '2026-09-24|a|b', '1') for i in big]
CALLS.clear()
P.read_inputs('u', 'k', window, fetch=fake_fetch)
ok(len([1 for t, _ in CALLS if t == 'oddspapi_fixtures']) == 3, 'fixture ids are chunked (305 ids -> 3 GETs)')

print(f'\nPASS {PASS}   FAIL {FAIL}')
sys.exit(1 if FAIL else 0)
