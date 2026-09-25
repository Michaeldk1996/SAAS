#!/usr/bin/env python3
"""TEN-270 date-key ruling (founder 2026-09-24T10:16Z): the card-state key's
DATE is the board card's date. Cases are the real ones found in the 30-day scan
(16 of 142 carded matches keyed to the wrong day, 2026-09-18..24)."""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ten225_names as N  # noqa: E402

PASS = FAIL = 0


def ok(c, name):
    global PASS, FAIL
    PASS, FAIL = (PASS + 1, FAIL) if c else (PASS, FAIL + 1)
    print(('  ok   ' if c else '  FAIL ') + name)


BOARD = [
    {'date': '2026-09-26', 'time': '04:00', 'p1': 'D. Medvedev', 'p2': 'V. Royer'},
    {'date': '2026-09-26', 'time': '04:00', 'p1': 'K. Jacquet', 'p2': 'T. M. Etcheverry'},
    {'date': '2026-09-20', 'time': '01:15', 'p1': 'L. Draxl', 'p2': 'M. Halys'},
    {'date': '2026-09-18', 'time': '07:15', 'p1': 'S. Kwon', 'p2': 'R. Suresh'},
    {'date': '2026-09-24', 'time': '04:00', 'p1': 'J. Cui', 'p2': 'D. Vallejo'},
    # the same pair twice within 2 days: never guess between them
    {'date': '2026-09-21', 'time': '12:00', 'p1': 'A. Twin', 'p2': 'B. Pair'},
    {'date': '2026-09-22', 'time': '12:00', 'p1': 'A. Twin', 'p2': 'B. Pair'},
]
IDX = N.board_pair_index(BOARD)
CASES = [
    ('2026-09-25|medvedev|royer', '2026-09-26|medvedev|royer', 'rekeyed', 'Kibl provisional listing a day early (Medvedev-Royer)'),
    ('2026-09-25|etcheverry|jacquet', '2026-09-26|etcheverry|jacquet', 'rekeyed', 'Jacquet-Etcheverry'),
    ('2026-09-19|draxl|halys', '2026-09-20|draxl|halys', 'rekeyed', 'UTC day of a 01:15 UTC+2 card (Draxl-Halys)'),
    ('2026-09-19|kwon|suresh', '2026-09-18|kwon|suresh', 'rekeyed', 'a day LATE (+1, Kwon-Suresh)'),
    ('2026-09-24|cui|vallejo', '2026-09-24|cui|vallejo', 'same', 'an already-right key is untouched'),
    ('2026-09-24|nobody|onboard', '2026-09-24|nobody|onboard', 'no_card', 'no board card: the vendor key is kept'),
    ('2026-09-20|medvedev|royer', '2026-09-20|medvedev|royer', 'no_card', 'the pair 6 days away is NOT this card (+/-2 d only)'),
    ('2026-09-21|pair|twin', '2026-09-21|pair|twin', 'same', 'two cards, key already one of them: kept'),
    ('2026-09-23|pair|twin', '2026-09-23|pair|twin', 'ambiguous', 'two candidate cards: never guessed'),
]
for key, want, verdict, name in CASES:
    got, v = N.board_key_for(key, IDX)
    ok(got == want and v == verdict, f'{name}: {key} -> {got} ({v})')

rows = [{'match_key': c[0]} for c in CASES]
import collections  # noqa: E402
st = collections.Counter()
N.rekey_rows_to_board(rows, BOARD, st)
ok(st['rekey_rekeyed'] == 4 and st['rekey_ambiguous'] == 1 and st['rekey_no_card'] == 2 and st['rekey_same'] == 2,
   f'every verdict is counted ({dict(st)})')
ok(all(r['match_key'] == c[1] for r, c in zip(rows, CASES)), 'rows are re-keyed in place')

# Review round 3, finding 3: a provisional and a real listing of ONE book
# (two fixture ids) must never be merged onto one key — the selection pass would
# drop the group and blank the card. The real listing already on the card's key
# stays; the provisional one keeps its vendor key.
st2 = collections.Counter()
two = [{'fixture_id': 1, 'book': 'bet105', 'match_key': '2026-09-26|medvedev|royer'},
       {'fixture_id': 2, 'book': 'bet105', 'match_key': '2026-09-25|medvedev|royer'},
       {'fixture_id': 3, 'book': 'bet365', 'match_key': '2026-09-25|etcheverry|jacquet'}]
N.rekey_rows_to_board(two, BOARD, st2)
ok([r['match_key'] for r in two] == ['2026-09-26|medvedev|royer', '2026-09-25|medvedev|royer',
                                     '2026-09-26|etcheverry|jacquet'],
   f'two fixtures of one book are never merged onto one key; other books unaffected ({dict(st2)})')
ok(st2['rekey_fixture_collision'] == 1, 'the undone move is counted as rekey_fixture_collision')
one_book_two_sides = [{'fixture_id': 7, 'book': 'bet105', 'match_key': '2026-09-19|draxl|halys', 'side': s}
                      for s in ('1', '2')]
N.rekey_rows_to_board(one_book_two_sides, BOARD)
ok(all(r['match_key'] == '2026-09-20|draxl|halys' for r in one_book_two_sides),
   'the two SIDE rows of one fixture are one owner, not a collision')

# Founder ruling 2026-09-24: restore the two past Results Opens. Their cards
# have left the board, so a committed memory maps vendor key -> card key.
mem = N.load_card_key_memory()
ok(mem == {'2026-09-19|kwon|suresh': '2026-09-18|kwon|suresh',
           '2026-09-18|aliassime|halys': '2026-09-19|aliassime|halys'},
   'the committed memory holds exactly the two ruled restores')
st3 = collections.Counter()
past = [{'fixture_id': 11, 'book': 'sports411', 'match_key': '2026-09-19|kwon|suresh'},
        {'fixture_id': 12, 'book': 'bet105', 'match_key': '2026-09-18|aliassime|halys'},
        {'fixture_id': 13, 'book': 'bet105', 'match_key': '2026-09-17|other|pair'}]
N.rekey_rows_to_board(past, [], st3, memory=mem)
ok([r['match_key'] for r in past] == ['2026-09-18|kwon|suresh', '2026-09-19|aliassime|halys', '2026-09-17|other|pair']
   and st3['rekey_restored'] == 2, f'both restored with no board card; nothing else changes ({dict(st3)})')
ok(past[0]['book'] == 'sports411', 'a restore never relabels the book (Sports411 stays Sports411)')
for f in ('ten225-kibl-card-state.py', 'ten225-load-card-state.py'):
    ok('memory=NAMES.load_card_key_memory()' in open(os.path.join(HERE, f)).read(),
       f'{f} passes the committed memory to the re-key')

# The page's own key function (sliced from the shipped HTML, run in node) must
# produce the same key as the re-keyed card state for every board card.
html = open(os.path.join(HERE, 'bsp-consult-dashboard.html'), encoding='utf-8').read()


def slice_fn(name):
    i = html.index(f'function {name}(')
    d, j = 0, html.index('{', i)
    while True:
        if html[j] == '{':
            d += 1
        elif html[j] == '}':
            d -= 1
            if d == 0:
                return html[i:j + 1]
        j += 1


js = '\n'.join(slice_fn(n) for n in ('ocsNfd', 'ocsNameKey', 'ocsMatchKey', 'ocsKeyOf'))
js += f'\nconsole.log(JSON.stringify({json.dumps(BOARD)}.map(ocsKeyOf)));'
page = json.loads(subprocess.run(['node', '-e', js], capture_output=True, text=True, check=True).stdout)
py = [N.match_key(m['date'], m['p1'], m['p2']) for m in BOARD]
ok(page == py, f'the page key (ocsKeyOf) equals the card-state key for all {len(BOARD)} board cards')
ok(all(N.board_key_for(k, IDX)[0] in page for k in ('2026-09-25|medvedev|royer', '2026-09-19|draxl|halys')),
   'a re-keyed row is found by the page lookup')

# Wiring: both card-state writers re-key BEFORE their upsert (a helper nobody
# calls fixes nothing). Checked on the source order, labelled as such.
for f in ('ten225-kibl-card-state.py', 'ten225-load-card-state.py'):
    src = open(os.path.join(HERE, f), encoding='utf-8').read()
    src = src[src.index('def main('):]      # the run order; run_selection's own write-back comes later
    # The Kibl writer upserts through upsert_kibl_rows() since TEN-275.
    i = src.find('NAMES.rekey_rows_to_board(')
    j = min([k for k in (src.find("L.upsert(url, key, 'odds_card_state'"),
                         src.find('upsert_kibl_rows(url, key, rows')) if k >= 0], default=-1)
    ok(0 < i < j, f'{f} re-keys to the board card before it upserts odds_card_state')
# Review round 3, finding 4: a run with no board must not write vendor keys over
# the stored card-dated keys (source-order check, labelled as such).
src = open(os.path.join(HERE, 'ten225-kibl-card-state.py'), encoding='utf-8').read()
ok('keep_stored_key = not matches' in src and "not (keep_stored_key and k == 'match_key')" in src,
   'ten225-kibl-card-state.py leaves match_key out of the upsert when matches.json is unreadable')

print(f'\nPASS {PASS}   FAIL {FAIL}')
sys.exit(1 if FAIL else 0)
