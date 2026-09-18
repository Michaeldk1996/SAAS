#!/usr/bin/env python3
"""TEN-225 / TEN-232 — offline harness for the Kibl card path.

No network, no Supabase, no Kibl. Runs as a fail-closed gate BEFORE the filler
touches the instance.

WHAT IS LOCKED HERE — five things, each of which reaches a rendered price if it
is wrong:

  1. THE OPEN RULE. Only a row Kibl itself flagged `is_opener` can be an Open.
     Our earliest sighting is not the book's opener, and the whole point of the
     Kibl source is that its opener is a real one.
  2. THE CLOSE CUTOFF. Strictly before the resolved start, and the resolved start
     is never Kibl's scheduled_start. This is the in-play-price-as-close trap.
  3. THE 21-DAY LIMB IS INAPPLICABLE HERE, and the replacement is the LAG limb,
     not "no test". The failure this guards is the opposite of the usual one:
     transplanting judge_close() would mark every correct close unreliable and
     report zero coverage on a green run.
  4. THE BOOK-PRIORITY SELECTION. Lowest rank wins, per match_key — never per
     fixture_id, which the three sources do not share.
  5. NAME-KEY DRIFT. ten225_names.name_key must agree with the live
     line-summary loader's name_key over the corpus that found the original bug.

MUTATION CONTROL — 8 run, 8 CAUGHT, control green before and after. Re-run
after editing any of the three files, with `python3 -B`:

  a. open_of() accepts any row, not just is_opener          RED (open rule)
  b. close_of() uses <= instead of <                        RED (in-play close)
  d. judge_close_live() drops the lag test                  RED (stale close)
  e. select_winners() keys on fixture_id, not match_key     RED (no demotion)
  f. select_winners() selects rows with no match_key        RED (unjoinable row)
  g. side_label() maps side_id 2 -> '1'                     RED (orientation)
  h. name_key() takes the longest token, not the last       RED (matcher drift)
  i. split_kibl_fixture_name() accepts doubles              RED (wrong card)

A harness that has never been shown to fail proves nothing, which is why the
list is the record of an actual run and not a plan.
"""
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
# STALE-BYTECODE GUARD — macOS caches .pyc outside the repo keyed on
# (mtime, size); a same-size restore inside one second serves the MUTANT's
# bytecode and the harness reports a FALSE PASS.
sys.dont_write_bytecode = True

K = types.ModuleType('K')
K.__file__ = os.path.join(HERE, 'ten225-kibl-card-state.py')
sys.argv = ['K']
exec(compile(open(K.__file__).read(), K.__file__, 'exec'), K.__dict__)

import ten225_names as N  # noqa: E402

FAILED = []


def check(name, cond, detail=''):
    if cond:
        print(f'  ok   {name}')
    else:
        print(f'  FAIL {name} {detail}')
        FAILED.append(name)


def obs(price, inserted_on, opener=False, observed_at='2026-09-18T00:00:00Z',
        **kw):
    d = {'price_decimal': price, 'inserted_on': inserted_on,
         'is_opener': opener, 'observed_at': observed_at,
         'market_type_id': 1, 'segment_id': 1, 'betting_type_id': 1,
         'is_live': False, 'side_id': 2, 'fixture_participant_id': 1,
         'max_limit': 0.0}
    d.update(kw)
    return d


T = '2026-09-18T%02d:%02d:00Z'


# --------------------------------------------------------------- market filter
print('is_match_winner — the three ids, not one')
check('moneyline / full game / prematch passes', K.is_match_winner(obs(2.0, T % (1, 0))))
check('a SET-segment moneyline is rejected (pricing a set winner as the match '
      'winner renders as a perfectly plausible number)',
      not K.is_match_winner(obs(2.0, T % (1, 0), segment_id=5)))
check('a spread is rejected', not K.is_match_winner(obs(2.0, T % (1, 0), market_type_id=2)))
check('a live row is rejected even at betting_type 1',
      not K.is_match_winner(obs(2.0, T % (1, 0), is_live=True)))
check('live fluid (betting_type 3, the id the swagger gets wrong) is rejected',
      not K.is_match_winner(obs(2.0, T % (1, 0), betting_type_id=3)))


# ------------------------------------------------------------------- the Open
print('\nopen_of — only the book\'s own opener')
o = [obs(2.5, T % (9, 0)), obs(2.2, T % (8, 0), opener=True), obs(2.4, T % (10, 0))]
p, ts, why = K.open_of(o)
check('the is_opener row wins, whatever we saw first', p == 2.2, p)
check('...stamped with ITS inserted_on', ts == T % (8, 0), ts)
check('...and no reason', why is None)

p, ts, why = K.open_of([obs(2.5, T % (9, 0)), obs(2.4, T % (10, 0))])
check('NO opener row -> no Open. Our earliest sighting is not the book\'s '
      'opener and stamping it "Open" would be the approximation the standing '
      'rules forbid', p is None and ts is None)
check('...with the reason carried', why == 'no_opener_row', why)

p, _, why = K.open_of([obs(2.2, T % (8, 0), opener=True),
                       obs(2.9, T % (8, 0), opener=True)])
check('two openers at ONE instant disagreeing on price drops on ambiguity',
      p is None and why == 'ambiguous_opener', why)

p, _, _ = K.open_of([obs(2.2, T % (8, 0), opener=True),
                     obs(2.9, T % (9, 0), opener=True)])
check('two openers at different instants -> the EARLIER (first sighting wins '
      'forever)', p == 2.2, p)

p, _, why = K.open_of([obs(2.2, None, opener=True)])
check('an opener with no timestamp is not an Open — a price without its time is '
      'unrenderable and the schema CHECK would reject it anyway',
      p is None and why == 'no_opener_row', why)


# -------------------------------------------------------------------- the Now
print('\nnewest_of — freshest by VENDOR time, not by our sweep')
n = K.newest_of([obs(2.5, T % (9, 0), observed_at=T % (23, 0)),
                 obs(2.1, T % (11, 0), observed_at=T % (12, 0))])
check('the newer inserted_on wins even though we saw the other one later — '
      'ordering on observed_at would make a re-sighting look like a new price',
      n['price_decimal'] == 2.1, n['price_decimal'])
check('no usable row -> None', K.newest_of([obs(None, T % (9, 0))]) is None)
check('a row with no inserted_on is not the newest',
      K.newest_of([obs(2.5, T % (9, 0)), obs(9.9, None)])['price_decimal'] == 2.5)

print('\nthe Now rule is the SHARED one, not a second copy')
check('qualifies_as_now comes from the oddspapi filler',
      K.qualifies_as_now is not None)
NOWT = 1789000000.0
check('a started fixture has no Now', K.qualifies_as_now(NOWT - 100, NOWT - 100, NOWT)[0] is False)
check('an upcoming fixture does', K.qualifies_as_now(None, NOWT + 3600, NOWT)[0] is True)


# ------------------------------------------------------------------ the Close
print('\nclose_of — strictly before the RESOLVED start')
start = K.epoch(T % (12, 0))
lst = [obs(2.5, T % (9, 0)), obs(2.3, T % (11, 30)), obs(1.9, T % (12, 30))]
c = K.close_of(lst, start)
check('the last pre-start price wins', c['price_decimal'] == 2.3, c['price_decimal'])
check('the in-play price at 12:30 is excluded by start time',
      c['inserted_on'] == T % (11, 30))

check('a price inserted AT the start instant is NOT pre-start (strict <)',
      K.close_of([obs(2.3, T % (12, 0))], start) is None)
check('NO start -> NO close. Kibl publishes only a scheduled time and the '
      'standing rule forbids the schedule as a cutoff',
      K.close_of(lst, None) is None)
check('every price after the start -> no close',
      K.close_of([obs(1.9, T % (13, 0))], start) is None)


print('\njudge_close_live — the LAG limb applies, the 21-day DECAY limb does not')
r, lag = K.judge_close_live(start, K.epoch(T % (11, 30)))
check('a close 30 min before the start is reliable', r is True, (r, lag))
check('...and the lag is reported', abs(lag - 30.0) < 1e-6, lag)
r, lag = K.judge_close_live(start, K.epoch(T % (10, 0)))
check('a close 120 min before the start is NOT (ruled lag limit is 60)',
      r is False and abs(lag - 120.0) < 1e-6, (r, lag))
r, _ = K.judge_close_live(start, K.epoch(T % (11, 0)))
check('exactly 60 min is reliable (the boundary is <=, in absolute units)', r is True)
check('the constant is the loader\'s own, not a local copy',
      K.RELIABLE_LAG_MIN == 60.0, K.RELIABLE_LAG_MIN)

# THE ASSERTION THAT IS THE WHOLE POINT OF THIS FUNCTION EXISTING. A close
# captured BEFORE its start is the normal, best case for a live-swept feed, and
# judge_close()'s decay limb scores exactly that case as unreliable.
r, _ = K.judge_close_live(start, K.epoch(T % (11, 30)), 'oddspapi', None)
check('a close CAPTURED BEFORE the start stays reliable — transplanting the '
      '21-day decay limb would have made every correct Kibl close unreliable '
      'and reported zero coverage on a green run', r is True)
old_r, _ = K.L.judge_close(start, K.epoch(T % (11, 30)),
                           K.epoch(T % (10, 0)))  # archived before the start
check('...and the oddspapi rule really does reject it, so this is a real '
      'difference and not a paraphrase', old_r is False)

# Founder ruling 2026-09-18 item 2: *"Document the exemption in the code so
# nobody reinstates it."* The behaviour is locked above; this locks the REASON
# staying attached to it, because the next person to read judge_close_live()
# without it will see an inconsistency and "fix" it.
import inspect as _i  # noqa: E402
_jcl = _i.getsource(K.judge_close_live)
check('the decay exemption is recorded in the code as a RULING, not as an '
      'open question — a note saying "not ruled here" invites reinstatement',
      'DO NOT REINSTATE' in _jcl and 'Founder ruling 2026-09-18 item 2' in _jcl)
check('...and it says the exemption is source-specific, so nobody harmonises '
      'the two judges', 'does not generalise' in _jcl)
check('the oddspapi judge KEEPS its 21-day window — the exemption must not have '
      'leaked across', 'DECAY_DAYS' in _i.getsource(K.L.judge_close)
      or '21' in _i.getsource(K.L.judge_close))

r, _ = K.judge_close_live(start, K.epoch(T % (11, 30)), 'api-tennis-live', None)
check('a live-flip start with an UNKNOWN gap is not a pass', r is False)
r, _ = K.judge_close_live(start, K.epoch(T % (11, 30)), 'api-tennis-live', 301.0)
check('a live-flip gap of 301 s fails (ruled max 300)', r is False)
r, _ = K.judge_close_live(start, K.epoch(T % (11, 30)), 'api-tennis-live', 299.0)
check('a live-flip gap of 299 s passes', r is True)
r, _ = K.judge_close_live(None, K.epoch(T % (11, 30)))
check('no start -> not reliable', r is False)


# ------------------------------------------------------------------ the sides
print('\nside_labels_for — side_id is 2/3 on this feed, and 1 never appears')


def sobs(sid, fpid, **kw):
    return dict(obs(2.0, T % (9, 0), side_id=sid,
                    fixture_participant_id=fpid), **kw)


# The real shape, from run 35295326133: census {2: 3617, 3: 3620}, every one of
# 1,795 fixtures is '2+3', and the ids run consecutively.
REAL = [sobs(2, 1029618), sobs(3, 1029619)]
check('the old one-argument side_label is GONE — it mapped side_id 1, which '
      'does not exist on this feed, and dropped side 3, which is a player',
      not hasattr(K, 'side_label'))
check('side_id 2 and 3 become our sides 1 and 2',
      K.side_labels_for(REAL) == {2: '1', 3: '2'}, K.side_labels_for(REAL))
check('the ORDER comes from fixture_participant_id, not from the side_id '
      'number — so a fixture that ever arrives 3-then-2 still orients by the '
      'participant',
      K.side_labels_for([sobs(2, 1029619), sobs(3, 1029618)]) == {3: '1', 2: '2'})
check('a one-sided fixture is undecidable, not half-rendered — this is the '
      'defect that made Open read 100% of one side',
      K.side_labels_for([sobs(2, 1029618)]) == {})
check('three sides on one fixture is undecidable',
      K.side_labels_for([sobs(2, 1), sobs(3, 2), sobs(4, 3)]) == {})
check('a side_id pinning TWO participants is undecidable rather than resolved '
      'by majority — a majority here renders a real price on a side we cannot '
      'name', K.side_labels_for([sobs(2, 1), sobs(2, 9), sobs(3, 2)]) == {})
check('a missing fixture_participant_id cannot orient',
      K.side_labels_for([sobs(2, None), sobs(3, None)]) == {})
check('a missing side_id cannot orient',
      K.side_labels_for([sobs(None, 1), sobs(3, 2)]) == {})
check('legacy 1+2 fixtures, if the feed ever sends them, still orient by '
      'participant order rather than being rejected for not being 2+3',
      K.side_labels_for([sobs(1, 500), sobs(2, 501)]) == {1: '1', 2: '2'})

# ⚠️ A COLUMN THE LOGIC READS MUST BE IN THE SELECT LIST. Run 35295569715
# omitted fixture_participant_id from the observations query, so every one of
# the 25 priced fixtures came back with it NULL, side_labels_for() called them
# all undecidable, and the run produced 0 card rows. It failed in the SAFE
# direction — a dash, not a wrong price — but nothing connected the empty
# coverage to the missing column.
#
# Asserted on the CONSTANT, never on getsource(main): the first version of this
# check read the source text and matched the word inside the very comment that
# explains why the column matters, so it passed with the column removed. A
# mutation control is the only reason that was caught.
_cols = set(K.OBS_COLUMNS.split(','))
for _c in ('side_id', 'fixture_participant_id', 'price_decimal', 'inserted_on',
           'observed_at', 'is_opener'):
    check(f'the observations select list requests {_c}, which the rules read',
          _c in _cols, sorted(_cols))


def krow(mkey, side, price):
    return {'match_key': mkey, 'side': side, 'open_price': price,
            'market': 'match winner', 'line': None, 'book_rank': 1,
            'now_price': None, 'close_price': None, 'is_selected': False,
            'source': 'kibl'}


# The comparison itself is locked in test-ten225-orientation.py (33 checks, 6
# mutation controls), because it is pure. What is locked HERE is the wiring: the
# card path must actually CONSULT it and must actually DASH on a disagreement.
check('the old slot-to-slot control is GONE, not merely unused — two copies of '
      'an orientation rule is how one of them drifts into shipping',
      not hasattr(K, 'orientation_agreement'))

ORI_FX = [{'fixture_id': 7, 'player1_name': 'Alexander Zverev',
           'player2_name': 'Carlos Alcaraz', 'name': '7 Alexander Zverev vs Carlos Alcaraz',
           'scheduled_start': '2026-09-18T12:00:00.000Z'}]
# oddspapi names the SAME match in the OPPOSITE order — the case that made the
# slot comparison wrong. Its p1 is Alcaraz; Kibl's side 1 is Zverev.
ORI_IDX = {'2026-09-18|alcaraz|zverev': {
    'player1': 'Alcaraz, Carlos', 'player2': 'Zverev, Alexander',
    'sides': {'1': {'open_price': 1.40}, '2': {'open_price': 3.00}}}}
BOARD = [{'id': 'm1', 'date': '2026-09-18', 'p1': 'C. Alcaraz', 'p2': 'A. Zverev',
          'odds': {'p1': 1.45, 'p2': 2.80, 'bookmaker': 'Betano'}}]


def ori(k_side1, k_side2, board=BOARD, idx=ORI_IDX):
    rows = [dict(krow('2026-09-18|alcaraz|zverev', '1', k_side1), fixture_id='7'),
            dict(krow('2026-09-18|alcaraz|zverev', '2', k_side2), fixture_id='7')]
    rep, dashed = K.run_orientation(rows, ORI_FX, idx, board)
    return rows, rep, dashed


# Kibl side 1 = Zverev. Alcaraz is the favourite on both independent sources, so
# a CORRECT mapping prices side 2 (Alcaraz) shorter.
rows_ok, agree, dash_ok = ori(3.00, 1.40)
check('a correct mapping agrees with BOTH independent sources, across two feeds '
      'that name the match in opposite orders',
      agree['n'] == 1 and agree['agree'] == 1 and agree['passes'], agree)
check('...and nothing is dashed', dash_ok == set())
check('the upcoming-fixture arm is live: the BOARD is counted as an independent '
      'source, not just oddspapi',
      'api-tennis:odds' in agree['bySource'], agree['bySource'])

rows_flip, flip, dash_flip = ori(1.40, 3.00)
check('a REVERSED convention is caught', flip['n'] == 1 and flip['disagree'] == 1
      and not flip['passes'], flip)
check('...and the guard DASHES it rather than displaying it (founder ruling '
      '2026-09-18 item 1)', dash_flip == {'2026-09-18|alcaraz|zverev'})
K.apply_orientation_guard(rows_flip, dash_flip, __import__('collections').Counter())
check('every price on a dashed row is None — not just Open',
      all(r['open_price'] is None and r['now_price'] is None
          and r['close_price'] is None for r in rows_flip), rows_flip)
check('...and the row is LABELLED so the dash is auditable rather than silent',
      all(r['label'] == 'orientation-disagreement' for r in rows_flip))
check('a dashed row is then not selectable, so it steps aside for bet365 '
      'instead of hiding it behind a rank-1 blank',
      K.select_winners(rows_flip)[1]['empty_row'] == 2)

even = ori(1.98, 1.96, board=[dict(BOARD[0],
                                   odds={'p1': 1.97, 'p2': 1.97})],
           idx={'2026-09-18|alcaraz|zverev': dict(
               ORI_IDX['2026-09-18|alcaraz|zverev'],
               sides={'1': {'open_price': 1.97}, '2': {'open_price': 1.97}})})[1]
check('a near-even match carries no orientation signal and is skipped, not '
      'counted as 50%', even['n'] == 0 and even['uncheckedTotal'] == 1, even)
check('n below 30 is flagged (standing rule)', agree['belowMinN'] is True)
check('an unreadable board does not fail OPEN — it must cost the cross-check '
      'its arm, never ship an unverified price quietly',
      K.run_orientation([dict(krow("2026-09-18|alcaraz|zverev", '1', 3.0),
                              fixture_id='7'),
                         dict(krow("2026-09-18|alcaraz|zverev", '2', 1.4),
                              fixture_id='7')],
                        ORI_FX, {}, [])[0]['passes'] is False)


# ------------------------------------------------------- book-priority selection
print('\nselect_winners — one book per match, lowest rank wins')


def srow(mkey, rank, source, side='1', fixture='f', price=2.0):
    return {'match_key': mkey, 'book_rank': rank, 'source': source,
            'market': 'match winner', 'side': side, 'line': None,
            'fixture_id': fixture, 'open_price': price, 'now_price': None,
            'close_price': None, 'is_selected': False}


rows = [srow('d|a|b', 2, 'oddspapi', fixture='op1'),
        srow('d|a|b', 1, 'kibl', fixture='kb1'),
        srow('d|a|b', 3, 'api-tennis', fixture='at1')]
rows, st = K.select_winners(rows)
sel = [r for r in rows if r['is_selected']]
check('exactly one row is selected', len(sel) == 1, len(sel))
check('...and it is the kibl one — a higher-priority book that appears later '
      'takes over all three values', sel[0]['source'] == 'kibl', sel[0]['source'])
check('the other two are demoted, across DIFFERENT fixture_ids — selection on '
      'fixture_id could never have seen them as one match',
      st['demoted'] == 2, dict(st))

rows, st = K.select_winners([srow('d|a|b', 2, 'oddspapi'),
                            srow('d|a|b', 3, 'api-tennis')])
sel = [r for r in rows if r['is_selected']]
check('with no kibl row, bet365 wins', len(sel) == 1 and sel[0]['source'] == 'oddspapi')

rows, st = K.select_winners([srow(None, 1, 'kibl')])
check('a row with NO match_key is never selected: it cannot be shown to be a '
      'duplicate and cannot be joined to a board match',
      not any(r['is_selected'] for r in rows) and st['no_match_key'] == 1)

empty = srow('d|a|b', 1, 'kibl', price=None)
rows, st = K.select_winners([empty, srow('d|a|b', 2, 'oddspapi')])
sel = [r for r in rows if r['is_selected']]
check('an EMPTY rank-1 row does not hide a populated rank-2 one — this is how a '
      'priority change makes a working card go blank',
      len(sel) == 1 and sel[0]['source'] == 'oddspapi', [r['source'] for r in sel])

rows, st = K.select_winners([srow('d|a|b', 1, 'kibl', fixture='k1'),
                             srow('d|a|b', 1, 'kibl', fixture='k2')])
check('two rows of ONE rank on one line drop on ambiguity rather than coin-toss',
      not any(r['is_selected'] for r in rows) and st['rank_tie_dropped'] == 1,
      dict(st))

rows, _ = K.select_winners([srow('d|a|b', 1, 'kibl', side='1'),
                            srow('d|a|b', 1, 'kibl', side='2')])
check('the two SIDES of one match are independent lines, both selected',
      sum(1 for r in rows if r['is_selected']) == 2)


# ------------------------------------------------------------- names & pairing
print('\nten225_names — the shared key, and the drift guard')
check('Zverev across the two orderings',
      N.name_key('Zverev, Alexander') == N.name_key('A. Zverev') == 'zverev')
check('multi-part surname reorder survives',
      N.name_key('Van de Zandschulp, Botic')
      == N.name_key('B. Van De Zandschulp') == 'zandschulp')
check('accents are stripped before comparison',
      N.name_key('Muller, Alexandre') == N.name_key('A. Müller') == 'muller')

CORPUS = ['Zverev, Alexander', 'A. Zverev', 'Van de Zandschulp, Botic',
          'B. Van De Zandschulp', 'A. Müller', 'Muller, Alexandre',
          'Soonwoo Kwon', 'Dhakshineswar Suresh', 'T. Al Azmeh', '', None,
          'X', 'de Minaur, Alex', 'A. de Minaur']
check('ten225_names.name_key agrees with the LIVE line-summary loader over the '
      'corpus that found the original bug — two copies of one rule is how a '
      'matcher drifts',
      all(N.name_key(x) == K.L.name_key(x) for x in CORPUS),
      [(x, N.name_key(x), K.L.name_key(x)) for x in CORPUS
       if N.name_key(x) != K.L.name_key(x)])

print('\nsplit_kibl_fixture_name')
check('rotation number stripped, both players returned',
      N.split_kibl_fixture_name('6112 Dhakshineswar Suresh vs Soonwoo Kwon')
      == ('Dhakshineswar Suresh', 'Soonwoo Kwon'))
check('a DOUBLES fixture returns (None, None) — pairing one on a singles match '
      'would put one pair\'s price on another match\'s card',
      N.split_kibl_fixture_name('101 A Smith/B Jones vs C Lee/D Park')
      == (None, None))
check('no separator -> (None, None)', N.split_kibl_fixture_name('Some Event') == (None, None))
check('two separators -> (None, None), we cannot tell which divides',
      N.split_kibl_fixture_name('A vs B vs C') == (None, None))
check('empty / None safe', N.split_kibl_fixture_name(None) == (None, None))
check('a name containing digits survives',
      N.split_kibl_fixture_name('Player 2000 vs Other One')[0] == 'Player 2000')

print('\nmatch_key')
check('order-independent', N.match_key('2026-09-18', 'A. Zverev', 'C. Alcaraz')
      == N.match_key('2026-09-18', 'C. Alcaraz', 'A. Zverev'))
check('carries the day', N.match_key('2026-09-18T10:00:00Z', 'A. Zverev', 'C. Alcaraz')
      == '2026-09-18|alcaraz|zverev')
check('two players keying to ONE surname -> None, not a half key',
      N.match_key('2026-09-18', 'A. Zverev', 'M. Zverev') is None)
check('a missing name -> None', N.match_key('2026-09-18', 'A. Zverev', '') is None)
check('a missing day -> None', N.match_key('', 'A. Zverev', 'C. Alcaraz') is None)

print('\nfind_start — the ladder is never re-derived here')
idx = {'2026-09-18|alcaraz|zverev': {'start_ts': 1.0, 'start_ts_source': 'oddspapi',
                                     'start_reject_reason': None, 'sides': {}}}
fx = {'scheduled_start': '2026-09-18T10:00:00Z', 'player1_name': 'Carlos Alcaraz',
      'player2_name': 'Alexander Zverev'}
rec, why = K.find_start(fx, idx)
check('a paired fixture gets the RESOLVED oddspapi start', rec is not None and why is None)
near_midnight = dict(fx, scheduled_start='2026-09-19T00:10:00Z')
rec2, _ = K.find_start(near_midnight, idx)
check('a fixture just after UTC midnight still pairs to the previous day',
      rec2 is not None)
rec3, why3 = K.find_start(dict(fx, player2_name='Nobody Here'), idx)
check('an unpaired fixture returns no start and says why',
      rec3 is None and why3 == 'no_oddspapi_pair', why3)
rec4, why4 = K.find_start({'scheduled_start': '2026-09-18T10:00:00Z',
                           'player1_name': 'A/B', 'player2_name': None}, idx)
check('an unkeyable fixture is named as such', rec4 is None and why4 == 'unpairable_name')


# ------------------------------------------------------- end-to-end build shape
print('\nbuild_rows — the assembled row')
fixtures = [{'fixture_id': 726877, 'scheduled_start': '2026-09-18T12:00:00Z',
             'player1_name': 'Carlos Alcaraz', 'player2_name': 'Alexander Zverev',
             'match_key': '2026-09-18|alcaraz|zverev', 'league_id': 19}]
# The REAL wire shape: side_id 2 and 3, ordered by fixture_participant_id.
# Written as the feed actually sends it, not as the schema once assumed, so the
# end-to-end test exercises the path today's data takes.
observations = {726877: [
    obs(1.50, T % (6, 0), opener=True, side_id=2, fixture_participant_id=1029618),
    obs(1.45, T % (11, 30), side_id=2, fixture_participant_id=1029618),
    obs(1.20, T % (12, 30), side_id=2, fixture_participant_id=1029618),  # in-play
    obs(2.60, T % (6, 0), opener=True, side_id=3, fixture_participant_id=1029619),
    obs(2.75, T % (11, 30), side_id=3, fixture_participant_id=1029619),
]}
index = {'2026-09-18|alcaraz|zverev': {
    'fixture_id': 'op1', 'start_ts': K.epoch(T % (12, 0)),
    'start_ts_source': 'oddspapi', 'start_reject_reason': None,
    'flip_gap_seconds': None, 'sides': {}}}
built, bst, _us, _sh = K.build_rows(fixtures, observations, index, K.epoch(T % (13, 0)))
check('two rows, one per side', len(built) == 2, len(built))
r1 = [r for r in built if r['side'] == '1'][0]
check('Open is the opener price', r1['open_price'] == 1.50, r1['open_price'])
check('Open ts is the opener\'s inserted_on', r1['open_ts'] == T % (6, 0))
check('Close is the last PRE-start price, not the 12:30 in-play one',
      r1['close_price'] == 1.45, r1['close_price'])
check('Now is withheld on a started fixture', r1['now_price'] is None)
check('ts_kind says vendor-insert — founder: "Every Kibl timestamp is '
      'vendor-insert time, not book-post time. Label it that way in the data."',
      r1['ts_kind'] == 'vendor-insert')
check('book is the book we are actually served', r1['book'] == 'sports411', r1['book'])
check('book_rank is 1 (kibl is PRIMARY as of 2026-09-18)', r1['book_rank'] == 1)
check('a filler never selects its own row', r1['is_selected'] is False)
check('the stake limit is NULL, not the feed\'s 0.0 "not provided"',
      r1['open_limit'] is None)
check('start provenance is carried', r1['start_ts_source'] == 'oddspapi')

# An UPCOMING fixture: Now lives, Close dashes.
up = [{'fixture_id': 9, 'scheduled_start': '2026-09-19T12:00:00Z',
       'player1_name': 'Carlos Alcaraz', 'player2_name': 'Alexander Zverev',
       'match_key': '2026-09-19|alcaraz|zverev', 'league_id': 19}]
ub, _, _us2, _sh2 = K.build_rows(
    up, {9: [obs(1.50, T % (6, 0), opener=True, side_id=2,
                 fixture_participant_id=1),
             obs(1.44, T % (9, 0), side_id=2, fixture_participant_id=1),
             obs(2.60, T % (6, 0), opener=True, side_id=3,
                 fixture_participant_id=2)]},
    {}, K.epoch(T % (7, 0)))
check('an upcoming fixture gets a Now', ub[0]['now_price'] == 1.44, ub[0]['now_price'])
check('...stamped with the vendor time', ub[0]['now_ts'] == T % (9, 0))
check('...and NO Close, because it has no resolved start',
      ub[0]['close_price'] is None and ub[0]['close_ts'] is None)
check('...and its Open survives regardless', ub[0]['open_price'] == 1.50)

# ------------------------------------------------------------- sweep cadence
print('\nshould_sweep — founder ruling: 15 min baseline, 5 min from T-60')
A = types.ModuleType('A')
A.__file__ = os.path.join(HERE, 'archive-kibl.py')
sys.argv = ['A']
exec(compile(open(A.__file__).read(), A.__file__, 'exec'), A.__dict__)

check('14 min into the baseline: skip', A.should_sweep(14.0, None)[0] is False)
check('15 min into the baseline: sweep', A.should_sweep(15.0, None)[0] is True)
check('...and it says which floor applied', A.should_sweep(15.0, None)[1] == 'baseline')
check('6 min out with a fixture 30 min from starting: sweep',
      A.should_sweep(6.0, 30.0) == (True, 'near-start'))
check('4 min out with a fixture 30 min from starting: skip',
      A.should_sweep(4.0, 30.0)[0] is False)
check('a fixture 61 min away is NOT near-start, so the baseline applies',
      A.should_sweep(6.0, 61.0)[0] is False)
check('a fixture exactly 60 min away IS near-start (absolute boundary)',
      A.should_sweep(6.0, 60.0)[0] is True)
check('NO previous sweep -> sweep. For a feed whose prices cannot be '
      're-fetched, a redundant sweep costs one call and a skipped one costs a '
      'price nobody has', A.should_sweep(None, None) == (True, 'no-previous-sweep'))
check('a fixture that already started does not force the 5-min floor',
      A.should_sweep(6.0, -10.0)[0] is False)

print('\nfixture_row / upsert_fixtures — first_seen_at is never rewritten')
fr = A.fixture_row({'fixture_id': 1, 'league_id': 19, 'sport_id': 5,
                    'start_time': '2026-09-18T05:00:00.000Z',
                    'name': '6112 Dhakshineswar Suresh vs Soonwoo Kwon'},
                   '2026-09-18T00:00:00Z', 'sw1')
check('players parsed off the one-string name',
      (fr['player1_name'], fr['player2_name'])
      == ('Dhakshineswar Suresh', 'Soonwoo Kwon'))
check('match_key built from the scheduled DAY and both surnames',
      fr['match_key'] == '2026-09-18|kwon|suresh', fr['match_key'])
check('kibl start_time is stored as scheduled_start — the name is the guard '
      'against a future reader using it as a Close cutoff',
      fr['scheduled_start'] == '2026-09-18T05:00:00.000Z'
      and 'start_time' not in fr)
check('a doubles fixture is STORED with NULL players, not dropped — the name '
      'normaliser report has to count what it could not pair',
      A.fixture_row({'fixture_id': 2, 'name': 'A/B vs C/D',
                     'start_time': '2026-09-18T05:00:00.000Z'},
                    '2026-09-18T00:00:00Z', 'sw1')['match_key'] is None)
check('no fixture_id -> no row', A.fixture_row({'name': 'A vs B'}, 'x', 'y') is None)
import inspect as _inspect  # noqa: E402
_moves = _inspect.getsource(A.upsert_fixtures)
check('first_seen_at is NOT in the refresh column list — sending it would reset '
      'the denominator of the opening-time measurement on every sweep',
      "'first_seen_at'" not in _moves.split('MOVES =')[1].split(')')[0])
check('...and last_seen_at IS', '"last_seen_at"' in _moves.split('MOVES =')[1].split(')')[0])
# Postgres runs NOT NULL / CHECK against the PROPOSED insert tuple before it
# resolves ON CONFLICT, so a column deliberately left OUT of an upsert payload
# must have a default or every row 400s — even when every row is an update.
# Measured on run 35292346974. Asserted against the DDL, not remembered.
_ddl = open(os.path.join(HERE, 'ten232-kibl-schema.sql')).read()
check('kibl_fixtures.first_seen_at has a DEFAULT — without it the refresh pass '
      'that omits it fails 23502 on every row and the fixture never updates, '
      'on a green sweep',
      'first_seen_at     timestamptz not null default now()' in _ddl)
check('...and the idempotent ALTER carries it too, for the table that already '
      'exists', 'alter column first_seen_at set default now()' in _ddl)

print()
print('WHY UNPAIRED — three different fixes hide behind one count')
# `no_independent_price: 23` is the number that stalled the ship gate, and it
# reads identically whether our matcher is dropping the pairing, the board
# carries the match and prices nothing, or Kibl covers a match we do not carry.
# Those need a code fix, an odds feed, and nothing at all respectively.
_up_matches = [
    # (a) on the board AND priced -> it paired, so it must appear in no bucket
    {'date': '2026-09-18', 'p1': 'S. Kwon', 'p2': 'D. Suresh',
     'odds': {'p1': 1.5, 'p2': 2.37}},
    # (b) on the board, no price at all -> board_unpriced
    {'date': '2026-09-18', 'p1': 'J. Sinner', 'p2': 'C. Alcaraz'},
    # (c) Rune is on the board that day, but against someone else
    {'date': '2026-09-18', 'p1': 'H. Rune', 'p2': 'F. Cerundolo',
     'odds': {'p1': 1.3, 'p2': 3.5}},
]
_up_kibl = {
    '2026-09-18|kwon|suresh': {'fixture_id': 1, 'p1': 'D. Suresh', 'p2': 'S. Kwon'},
    '2026-09-18|alcaraz|sinner': {'fixture_id': 2, 'p1': 'J. Sinner',
                                  'p2': 'C. Alcaraz'},
    '2026-09-18|medvedev|rune': {'fixture_id': 3, 'p1': 'H. Rune',
                                 'p2': 'D. Medvedev'},
    '2026-09-18|fritz|paul': {'fixture_id': 4, 'p1': 'T. Paul', 'p2': 'T. Fritz'},
}
_b = K.why_unpaired(_up_kibl, {'2026-09-18|kwon|suresh': {'src': {}}}, _up_matches)
check('a fixture that DID pair appears in no bucket',
      all('kwon' not in r['match_key'] for v in _b.values() for r in v), _b)
check('the board carries the match and prices nothing -> board_unpriced, which '
      'is an odds gap and not a matcher fault',
      [r['fixture_id'] for r in _b.get('board_unpriced', [])] == [2], _b)
check('one surname on the board that day -> the MATCHER is the suspect',
      [r['fixture_id'] for r in _b.get('surname_on_board', [])] == [3], _b)
check('neither surname on the board -> we simply do not carry it',
      [r['fixture_id'] for r in _b.get('not_on_board', [])] == [4], _b)
check('the buckets partition the unpaired set exactly once — a fixture counted '
      'twice would inflate whichever diagnosis is read first',
      sum(len(v) for v in _b.values()) == 3, _b)
check('an unreadable board does NOT read as a matcher fault',
      len(K.why_unpaired(_up_kibl, {}, [])['not_on_board']) == 4
      and 'surname_on_board' not in K.why_unpaired(_up_kibl, {}, []))

print()
if FAILED:
    print(f'{len(FAILED)} FAILED: {FAILED}')
    sys.exit(1)
print('all checks passed')

# ---------------------------------------------------------------------------
# MUTATION CONTROL RESULT — filled in by the run that ships this file. A harness
# that has never been shown to fail is a harness that proves nothing.
# ---------------------------------------------------------------------------
