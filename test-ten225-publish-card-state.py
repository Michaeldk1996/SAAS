#!/usr/bin/env python3
"""Offline harness for ten225-publish-card-state.py.

No network, no database, no secrets. Every case below is a shape that has
already gone wrong somewhere on this issue, or a founder rule that would
otherwise live only in a renderer where it can be forgotten.

Run with -B. macOS caches bytecode OUTSIDE the repo, and a cached .pyc has
served stale code and reported a false pass on this codebase before.
"""
import json
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

P = types.ModuleType('P')
P.__file__ = os.path.join(HERE, 'ten225-publish-card-state.py')
_argv, sys.argv = sys.argv, ['P']
exec(compile(open(P.__file__).read(), P.__file__, 'exec'), P.__dict__)
sys.argv = _argv

from ten225_names import match_key as mk_of  # noqa: E402

FAILED = []


def check(name, cond, detail=''):
    if cond:
        print(f'  ok   {name}')
    else:
        print(f'  FAIL {name} {detail}')
        FAILED.append(name)


# The two fixture tables, in the shape PostgREST returns them (numeric as str).
ODDSPAPI_FX = {
    'id1': {'player1': 'Zverev, Alexander', 'player2': 'Van de Zandschulp, Botic'},
    'id2': {'player1': 'Sinner, Jannik', 'player2': 'Alcaraz, Carlos'},
    'id3': {'player1': 'Fearnley, Jacob', 'player2': 'Norrie, Cameron'},
}
KIBL_FX = {
    '900': {'player1_name': 'Dhakshineswar Suresh', 'player2_name': 'Soonwoo Kwon'},
}
BOARD_FX = {
    'at77': {'p1': 'B. Van De Zandschulp', 'p2': 'A. Zverev'},
}

DAY = '2026-09-17'


def row(**kw):
    r = {'market': 'match winner', 'is_selected': True, 'line': None,
         'id_space': 'oddspapi', 'book': 'bet365', 'source': 'oddspapi',
         'ts_kind': 'book-tick', 'start_ts_source': 'oddspapi', 'label': None,
         'open_price': None, 'open_ts': None, 'open_limit': None,
         'now_price': None, 'now_ts': None,
         'close_price': None, 'close_ts': None}
    r.update(kw)
    return r


def pair(fid, mkey, o1, o2, **kw):
    """Both sides of one fixture, side '1' = player1."""
    a = row(fixture_id=fid, match_key=mkey, side='1',
            open_price=o1, open_ts=f'{DAY}T09:00:00Z', **kw)
    b = row(fixture_id=fid, match_key=mkey, side='2',
            open_price=o2, open_ts=f'{DAY}T09:00:00Z', **kw)
    return [a, b]


print('TEN-225 publish — side identity')
K2 = mk_of(DAY, 'Sinner, Jannik', 'Alcaraz, Carlos')
by, st = P.build(pair('id2', K2, 1.80, 2.05), ODDSPAPI_FX, KIBL_FX, BOARD_FX)
check('one match published', len(by) == 1, by)
e = by.get(K2, {})
check("side '1' price lands on player1's surname key",
      e.get('sides', {}).get('sinner', {}).get('open') == 1.80, e)
check("side '2' price lands on player2's surname key",
      e.get('sides', {}).get('alcaraz', {}).get('open') == 2.05, e)

# THE MUTATION THAT MATTERS. If the publisher keyed sides by '1'/'2' instead of
# by surname, this test would pass identically — so it is driven the only way
# that can tell the two apart: swap the FEED's ordering and assert each price
# still follows its own player. A '1'/'2' publisher puts 1.80 on Alcaraz here.
SWAPPED = {'id2': {'player1': 'Alcaraz, Carlos', 'player2': 'Sinner, Jannik'}}
by2, _ = P.build(pair('id2', K2, 1.80, 2.05), SWAPPED, KIBL_FX, BOARD_FX)
s2 = by2.get(K2, {}).get('sides', {})
check('feed order swapped -> prices follow the player, not the slot',
      s2.get('alcaraz', {}).get('open') == 1.80
      and s2.get('sinner', {}).get('open') == 2.05, s2)

print('TEN-225 publish — cross-feed name orderings key to the same match')
# oddspapi writes surname-first, api-tennis writes initial-first, kibl writes a
# single glued string. All three must reach one key or the board never pairs.
KZ = mk_of(DAY, 'Zverev, Alexander', 'Van de Zandschulp, Botic')
check('api-tennis ordering produces the same match_key',
      mk_of(DAY, 'B. Van De Zandschulp', 'A. Zverev') == KZ, KZ)
by3, _ = P.build(pair('id1', KZ, 1.44, 2.80), ODDSPAPI_FX, KIBL_FX, BOARD_FX)
check('multi-part surname keys to its last token',
      set(by3.get(KZ, {}).get('sides', {})) == {'zverev', 'zandschulp'},
      by3.get(KZ))

print('TEN-225 publish — founder rule 1b: one-sided close dashes BOTH sides')
rs = pair('id3', mk_of(DAY, 'Fearnley, Jacob', 'Norrie, Cameron'), 1.90, 1.90)
rs[0]['close_price'], rs[0]['close_ts'] = 1.72, f'{DAY}T12:00:00Z'
by4, st4 = P.build(rs, ODDSPAPI_FX, KIBL_FX, BOARD_FX)
sides4 = list(by4.values())[0]['sides'].values()
check('the recorded close is voided', all(s['close'] is None for s in sides4), list(sides4))
check('its timestamp is voided too',
      all(s['closeTs'] is None for s in sides4), list(sides4))
check('and the void is counted, not silent', st4['close_voided_one_sided'] == 1, st4)
check('the Open survives the void',
      all(s['open'] == 1.90 for s in sides4), list(sides4))

# The control. Without it "close is None" passes on a publisher that drops every
# close, and this harness would certify a surface that can never show one.
rs_both = pair('id3', mk_of(DAY, 'Fearnley, Jacob', 'Norrie, Cameron'), 1.90, 1.90)
for r, c in zip(rs_both, (1.72, 2.10)):
    r['close_price'], r['close_ts'] = c, f'{DAY}T12:00:00Z'
by5, st5 = P.build(rs_both, ODDSPAPI_FX, KIBL_FX, BOARD_FX)
sides5 = list(by5.values())[0]['sides']
check('CONTROL: a two-sided close survives',
      sides5['fearnley']['close'] == 1.72 and sides5['norrie']['close'] == 2.10, sides5)
check('CONTROL: nothing was voided', st5['close_voided_one_sided'] == 0, st5)

print('TEN-225 publish — one book per fixture')
mixed = pair('id2', K2, 1.80, 2.05)
mixed[1] = dict(mixed[1], book='sports411', source='kibl')
by6, st6 = P.build(mixed, ODDSPAPI_FX, KIBL_FX, BOARD_FX)
check('two books under one key publishes nothing', by6 == {}, by6)
check('and is counted as a drop', st6['drop_mixed_book'] == 1, st6)

print('TEN-225 publish — what must never reach the file')
unsel = [dict(r, is_selected=False) for r in pair('id2', K2, 1.80, 2.05)]
by7, st7 = P.build(unsel, ODDSPAPI_FX, KIBL_FX, BOARD_FX)
check('is_selected=false rows are excluded', by7 == {}, by7)
check('and counted', st7['skip_not_selected'] == 2, st7)

nokey = [dict(r, match_key=None) for r in pair('id2', K2, 1.80, 2.05)]
by8, st8 = P.build(nokey, ODDSPAPI_FX, KIBL_FX, BOARD_FX)
check('an unpairable row is excluded, never guessed', by8 == {}, by8)
check('and counted', st8['skip_no_match_key'] == 2, st8)

unknown = pair('id_not_in_any_table', K2, 1.80, 2.05)
by9, st9 = P.build(unknown, ODDSPAPI_FX, KIBL_FX, BOARD_FX)
check('a price we cannot attribute to a player is dropped', by9 == {}, by9)
check('and counted', st9['drop_unresolved_side'] == 1, st9)

# A row whose fixture names disagree with its own match_key: publishing it would
# put a real price under a key no card will ever look up, or worse, under one
# that belongs to a different match.
wrongkey = pair('id2', mk_of(DAY, 'Fearnley, Jacob', 'Norrie, Cameron'), 1.80, 2.05)
by10, st10 = P.build(wrongkey, ODDSPAPI_FX, KIBL_FX, BOARD_FX)
check('sides that contradict the match_key are dropped', by10 == {}, by10)
check('and counted', st10['drop_side_key_mismatch'] == 1, st10)

print('TEN-225 publish — missing is a dash, never zero')
check('_f(None) is None, not 0.0', P._f(None) is None)
check("_f('') is None, not 0.0", P._f('') is None)
check("_f of a PostgREST numeric string parses", P._f('1.80') == 1.80)
check('_f(0) stays 0 (a real zero limit is not absence)', P._f(0) == 0.0)

print('TEN-225 publish — kibl id space')
KK = mk_of(DAY, 'Dhakshineswar Suresh', 'Soonwoo Kwon')
kr = pair('900', KK, 2.40, 1.55, id_space='kibl', book='sports411',
          source='kibl', ts_kind='vendor-insert')
by11, _ = P.build(kr, ODDSPAPI_FX, KIBL_FX, BOARD_FX)
ke = by11.get(KK, {})
check('a kibl fixture resolves its two sides',
      ke.get('sides', {}).get('suresh', {}).get('open') == 2.40
      and ke.get('sides', {}).get('kwon', {}).get('open') == 1.55, ke)
check('and carries its own book, not bet365', ke.get('book') == 'sports411', ke)
check('and is labelled vendor-insert time', ke.get('tsKind') == 'vendor-insert', ke)

print('TEN-225 publish — the api-tennis fallback carries its label')
at = pair('at77', mk_of(DAY, 'B. Van De Zandschulp', 'A. Zverev'), 2.80, 1.44,
          id_space='api-tennis', source='api-tennis', ts_kind='sighting',
          label='last seen', start_ts_source='none')
by12, _ = P.build(at, ODDSPAPI_FX, KIBL_FX, BOARD_FX)
e12 = list(by12.values())[0]
check("the fallback publishes label 'last seen'", e12.get('label') == 'last seen', e12)
check('a non-fallback row publishes no label', 'label' not in e, e)

print('TEN-225 publish — board coverage counts the board, not the archive')
board = [
    {'id': 'at77', 'date': DAY, 'p1': 'A. Zverev', 'p2': 'B. Van De Zandschulp'},
    {'id': 'x1', 'date': DAY, 'p1': 'J. Sinner', 'p2': 'C. Alcaraz',
     'finalScore': {'winner': 'p1'}},
    {'id': 'x2', 'date': DAY, 'p1': 'N. Djokovic', 'p2': 'D. Medvedev'},
]
allby = {}
allby.update(by3)   # zverev / zandschulp, open both sides
allby.update(by5)   # fearnley / norrie — not on this board
allby.update(by)    # sinner / alcaraz, open both sides
cov = P.board_coverage(board, allby)
check('an upcoming board match is matched across name orderings',
      cov['board_upcoming_covered'] == 1, cov)
check('a completed board match is counted in its own bucket',
      cov['board_completed_covered'] == 1, cov)
check('an uncovered board match is counted, not ignored',
      cov['board_upcoming_uncovered'] == 1, cov)
check('an archive match that is not on the board adds no coverage',
      cov['board_upcoming_covered'] + cov['board_completed_covered'] == 2, cov)

print()
if FAILED:
    print(f'FAILED {len(FAILED)}: {", ".join(FAILED)}')
    sys.exit(1)
print('all publish-projection assertions pass')
