#!/usr/bin/env python3
"""TEN-225 — offline harness for the Kibl side-mapping control.

No network, no Supabase, no Kibl. Every function under test is pure, so the
whole control can be driven on hand-built payloads — including the one payload
that matters most and that live data can never supply on demand: a universe in
which Kibl's convention IS reversed.

WHAT IS LOCKED HERE

  1. THE CONTROL CAN FAIL. A reversed-universe payload must produce
     rate = 0.0 and passes = False. This is the assertion the first version of
     this check did not have, and its absence is why an n=0 run read as green.
  2. PLAYERS, NOT SLOTS. Two feeds that name the same match in opposite order
     must still AGREE. Today's board carries exactly this case — Kibl writes
     `Suresh vs Kwon`, our board writes `S. Kwon` / `D. Suresh` — so a
     slot-to-slot comparison would report a disagreement that does not exist and
     dash a correct price.
  3. n = 0 IS NOT A PASS. rate is None and passes is False on an empty sample.
  4. NEAR-EVEN MATCHES ARE SKIPPED AND COUNTED, on either side of the
     comparison, with the two reasons distinguished.
  5. ONE DISSENTER IS ENOUGH. The guard is "disagrees with AN independent
     source", not "with most of them".
  6. AMBIGUITY DROPS. Two fixtures keying to one match are not evidence.

MUTATION CONTROL — 6 run, 6 CAUGHT, control green before and after. Re-run with
`python3 -B`:

  a. favourite() returns the HIGHER price                   RED (2, 4 fail)
  b. verdicts() compares slots instead of name keys         RED (reversed-order)
  c. agreement() reports rate 1.0 at n=0                    RED (n=0 is a pass)
  d. verdicts() requires a MAJORITY to disagree             RED (one dissenter)
  e. MIN_GAP_PP lowered to 0 (near-even matches counted)    RED (skip counts)
  f. kibl_favourites() keeps an ambiguous match_key         RED (ambiguity)
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# STALE-BYTECODE GUARD — macOS caches .pyc outside the repo keyed on
# (mtime, size); a same-size restore inside one second serves the MUTANT's
# bytecode and the harness reports a FALSE PASS.
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)

import ten225_orientation as O  # noqa: E402

FAILED = []


def check(name, cond, detail=''):
    if cond:
        print(f'  ok   {name}')
    else:
        print(f'  FAIL {name} {detail}')
        FAILED.append(name)


# ----------------------------------------------------------------- the payloads
# One real match, taken from today's board and today's Kibl sweep, because a
# synthetic pair cannot reproduce the ordering difference that matters.
#
#   kibl  : '6112 Dhakshineswar Suresh vs Soonwoo Kwon'   -> side 1 = Suresh
#   board : p1 'S. Kwon' / p2 'D. Suresh'                 -> p1 = Kwon
#
# Board prices Kwon 1.57 / Suresh 2.32, so KWON is the favourite. A correct Kibl
# mapping therefore prices side 2 lower than side 1.
KIBL_FX = [{'fixture_id': 6112, 'player1_name': 'Dhakshineswar Suresh',
            'player2_name': 'Soonwoo Kwon',
            'name': '6112 Dhakshineswar Suresh vs Soonwoo Kwon',
            'scheduled_start': '2026-09-18T07:00:00.000Z'}]
KIBL_CORRECT = {6112: {'1': 2.32, '2': 1.57}}     # Kwon (side 2) favourite
KIBL_REVERSED = {6112: {'1': 1.57, '2': 2.32}}    # the reversed universe

BOARD = [{'id': 'upcoming-12163910', 'date': '2026-09-18',
          'p1': 'S. Kwon', 'p2': 'D. Suresh', 'tour': 'ATP Davis Cup',
          'odds': {'p1': 1.57, 'p2': 2.32, 'bookmaker': 'Betano'},
          'bet365Now': {'p1': 1.5, 'p2': 2.37, 'bookmaker': 'bet365',
                        'at': '2026-09-17T16:46:14.105Z'},
          'openingOdds': {'p1': 1.5, 'p2': 2.37, 'bookmaker': 'bet365',
                          'at': '2026-09-17T13:11:18.290Z'}}]


def run(kibl_prices, board=BOARD):
    ki, _ = O.kibl_favourites(KIBL_FX, kibl_prices)
    bi, _ = O.board_favourites(board)
    indep = {k: v['readings'] for k, v in bi.items()}
    return O.agreement(O.verdicts(ki, indep))


# ---------------------------------------------------------------- implied_gap_pp
print('implied_gap_pp — the sign is the whole signal')
check('the shorter price carries the higher implied probability',
      O.implied_gap_pp(1.57, 2.32) > 0)
check('and the sign flips with the argument order',
      O.implied_gap_pp(2.32, 1.57) < 0)
check('a decimal price of 1.0 is a placeholder, not a price',
      O.implied_gap_pp(1.0, 2.0) is None)
check('so is a non-numeric one', O.implied_gap_pp(None, 2.0) is None)
check('the overround cancels: scaling BOTH sides of a book does not flip the '
      'sign', (O.implied_gap_pp(1.57, 2.32) > 0)
      == (O.implied_gap_pp(1.57 * 1.05, 2.32 * 1.05) > 0))

print()
print('favourite — the LOWER price, resolved to a player')
check('names the shorter-priced player',
      O.favourite({'kwon': 1.57, 'suresh': 2.32})[0] == 'kwon')
check('...and does not depend on dict order',
      O.favourite({'suresh': 2.32, 'kwon': 1.57})[0] == 'kwon')
check('one side priced is not a market', O.favourite({'kwon': 1.57})[1] == 'not_two_sides')
check('a tie names nobody', O.favourite({'a': 2.0, 'b': 2.0})[1] == 'tied_price')
check('the gap is reported positive whichever side wins',
      O.favourite({'kwon': 1.57, 'suresh': 2.32})[1] > 0
      and O.favourite({'suresh': 1.57, 'kwon': 2.32})[1] > 0)

# ------------------------------------------------------- 1 + 2, the two big ones
print()
print('THE CONTROL CAN FAIL — the reversed universe')
good, bad = run(KIBL_CORRECT), run(KIBL_REVERSED)
check('a correct mapping agrees with every independent reading',
      good['rate'] == 1.0 and good['passes'] and good['disagree'] == 0,
      good)
check('a REVERSED mapping collapses to 0%, not to 50% — the control is not a '
      'coin toss', bad['rate'] == 0.0 and bad['n'] == good['n'], bad)
check('...and it does NOT pass', not bad['passes'])
# Indexed defensively: under a mutation this list can be EMPTY, and a harness
# that dies with IndexError before printing its summary reads as a crash rather
# than as the catch it actually is. (Measured: mutation b did exactly that.)
_d = (bad['disagreements'] or [None])[0]
check('the disagreement carries both payloads, keyed by player name, not by '
      'slot',
      bool(_d)
      and _d['kibl']['prices'].get('Dhakshineswar Suresh') == 1.57
      and 'S. Kwon' in str(_d['independent']), _d)
check('every independent source is named in the disagreement, not just the '
      'first', bool(_d) and len(_d['disagreeing']) == 3,
      _d['disagreeing'] if _d else None)

print()
print('PLAYERS, NOT SLOTS — the two feeds name this match in opposite order')
check('Kibl side 1 is Suresh and the board p1 is Kwon — the payload is '
      'genuinely reversed, so the two checks below are not vacuous',
      O.name_key(KIBL_FX[0]['player1_name']) == 'suresh'
      and O.name_key(BOARD[0]['p1']) == 'kwon')
check('...and the correct mapping still AGREES, because the comparison is on '
      'names', good['disagree'] == 0 and good['n'] >= 1)
check('both feeds key to the same match', list(
    O.kibl_favourites(KIBL_FX, KIBL_CORRECT)[0]) == list(
    O.board_favourites(BOARD)[0]))

# --------------------------------------------------------------- 3, n = 0
print()
print('n = 0 IS NOT A PASS')
empty = O.agreement({})
check('rate is None on an empty sample, never 1.0', empty['rate'] is None, empty)
check('...and passes is False', not empty['passes'])
check('n=0 is also flagged below the minimum', empty['belowMinN'])
unchecked = run(KIBL_CORRECT, board=[])
check('a Kibl match with no independent price is unchecked, not agreed',
      unchecked['n'] == 0 and unchecked['uncheckedTotal'] == 1
      and unchecked['unchecked'].get('no_independent_price') == 1, unchecked)
check('...and that still does not pass', not unchecked['passes'])

# ------------------------------------------------------- 4, near-even both sides
print()
print('NEAR-EVEN MATCHES CARRY NO SIGNAL — skipped, counted, and distinguished')
near_kibl = run({6112: {'1': 1.95, '2': 1.90}})
check('a near-even KIBL price is unchecked with its own reason',
      near_kibl['unchecked'].get('kibl_near_even') == 1, near_kibl['unchecked'])
near_board = run(KIBL_CORRECT, board=[dict(
    BOARD[0], odds={'p1': 1.95, 'p2': 1.90, 'bookmaker': 'Betano'},
    bet365Now={'p1': 1.95, 'p2': 1.90, 'bookmaker': 'bet365'},
    openingOdds={'p1': 1.95, 'p2': 1.90, 'bookmaker': 'bet365'})])
check('a near-even INDEPENDENT price is unchecked with a DIFFERENT reason — '
      'one counter that cannot say which costs a round trip to diagnose',
      near_board['unchecked'].get('independent_near_even') == 1,
      near_board['unchecked'])
check('the two reasons are never conflated',
      set(near_kibl['unchecked']) != set(near_board['unchecked']))

# ---------------------------------------------------- 5, one dissenter is enough
print()
print('ONE DISSENTER IS ENOUGH — the guard is not a vote')
split = [dict(BOARD[0],
              odds={'p1': 1.57, 'p2': 2.32, 'bookmaker': 'Betano'},
              bet365Now={'p1': 1.5, 'p2': 2.37, 'bookmaker': 'bet365'},
              # one source names the other player
              openingOdds={'p1': 2.37, 'p2': 1.5, 'bookmaker': 'bet365'})]
s = run(KIBL_CORRECT, board=split)
check('two agreeing sources do not outvote one disagreeing source',
      s['disagree'] == 1 and s['agree'] == 0, s)
check('the per-source breakdown attributes it, so the dissenter is nameable',
      s['bySource']['oddspapi:openingOdds']['disagree'] == 1
      and s['bySource']['api-tennis:odds']['agree'] == 1, s['bySource'])

# ------------------------------------------------------------- 6, ambiguity
print()
print('AMBIGUITY IS NOT EVIDENCE')
dup = KIBL_FX + [dict(KIBL_FX[0], fixture_id=9999)]
ki, st = O.kibl_favourites(dup, {6112: {'1': 2.32, '2': 1.57},
                                 9999: {'1': 2.32, '2': 1.57}})
check('two Kibl fixtures on one match_key drop BOTH, rather than picking one',
      ki == {} and st['kibl_ambiguous_dropped'] == 1, dict(st))
dupb, bst = O.board_favourites(BOARD + [dict(BOARD[0], id='dupe')])
check('...and the same on the board side', dupb == {} and bst['board_ambiguous_dropped'] == 1,
      dict(bst))

print()
print('NAME FALLBACK — the failure shape that hid for a day')
noname = [{'fixture_id': 6112, 'player1_name': None, 'player2_name': None,
           'name': '6112 Dhakshineswar Suresh vs Soonwoo Kwon',
           'scheduled_start': '2026-09-18T07:00:00.000Z'}]
ki2, st2 = O.kibl_favourites(noname, KIBL_CORRECT)
check('empty player columns fall back to the fixture STRING and say so — an '
      'empty column and an absent pairing must never look identical',
      len(ki2) == 1 and st2['kibl_name_split_fallback'] == 1, dict(st2))
check('a doubles fixture keys to nothing rather than half a pair',
      O.kibl_favourites([{'fixture_id': 1, 'name': 'A/B vs C/D',
                          'scheduled_start': '2026-09-18T07:00:00.000Z'}],
                        {1: {'1': 1.5, '2': 2.5}})[0] == {})

print()
if FAILED:
    print(f'{len(FAILED)} FAILED: {FAILED}')
    sys.exit(1)
print('all checks passed')
