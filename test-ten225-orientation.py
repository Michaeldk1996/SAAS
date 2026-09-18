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

# =====================================================================
# FOUNDER RULING 2026-09-18 item 2 — the ship gate
#
# The bar changed from "n >= 30" to an EVIDENCE bar: >= 10 checked, >= 6 of them
# lopsided, zero disagreements among the lopsided ones. A near-even disagreement
# is noted and does not block. Everything below locks that the gate cannot pass
# by accident — which is the only property that matters, because item 6 turns a
# pass straight into a deploy with no human in between.
# =====================================================================

# Twenty surnames, so every synthetic fixture keys to its own match.
_NAMES = ('Alcaraz Sinner Medvedev Rublev Zverev Ruud Fritz Tsitsipas Hurkacz '
          'Rune Dimitrov Paul Shelton Tiafoe Khachanov Humbert Musetti Cerundolo '
          'Griekspoor Machac Lehecka Struff Baez Norrie Etcheverry Tabilo '
          'Jarry Mannarino Bublik Nakashima').split()


def synth(n_lopsided, n_near, reversed_universe=False, flip=()):
    """Build (fixtures, prices, ids, board) for n fixtures with known groups.

    `flip` is a set of indices whose BOARD prices are reversed — i.e. the
    independent source names the other player as favourite. That is how a
    disagreement is injected into a chosen group, rather than by reversing Kibl
    globally and hoping it lands where the test needs it.

    Lopsided fixtures are priced 1.25 / 4.00 (both limbs). Near-even ones are
    priced 1.57 / 2.32 — TODAY'S REAL Kwon/Suresh prices, not 1.85 / 1.95.
    That is not cosmetic: at 1.85 / 1.95 the gap is 2.8pp, which is below
    MIN_GAP_PP, so those fixtures are `unchecked` and never reach either group.
    There are THREE buckets, not two —

        gap <  5pp   unchecked, carries no signal at all
        gap >= 5pp, not lopsided     near-even: checked, NOTED, not blocking
        price <= 1.40 or gap >= 25pp lopsided:  checked, BLOCKING

    — and a synthetic payload that conflates the first two silently tests the
    gate on a sample half the size it claims. (This harness caught exactly that
    on its first run: 2a read `actual: 5` out of a 13-fixture payload.)
    """
    fx, prices, ids, board = [], {}, {}, []
    for i in range(n_lopsided + n_near):
        a, b = _NAMES[2 * i], _NAMES[2 * i + 1]
        lop = i < n_lopsided
        # `a` is the favourite in every fixture, lopsided or not.
        pa, pb = (1.25, 4.00) if lop else (1.57, 2.32)
        fid = 7000 + i
        fx.append({'fixture_id': fid, 'player1_name': a, 'player2_name': b,
                   'name': f'{fid} {a} vs {b}',
                   'scheduled_start': '2026-09-18T07:00:00.000Z'})
        # Kibl side 1 = first-named = `a`. Reversing the universe puts the
        # favourite's price on side 2 while the names stay put.
        prices[fid] = ({'1': pb, '2': pa} if reversed_universe
                       else {'1': pa, '2': pb})
        ids[fid] = {'1': 1000000 + 2 * i, '2': 1000001 + 2 * i}
        # The board names the SAME two players in the OPPOSITE order, as the
        # real feeds do — so a slot comparison would misread every one of these.
        bp1, bp2 = (pa, pb) if i in flip else (pb, pa)
        board.append({'id': f'm{i}', 'date': '2026-09-18', 'p1': b, 'p2': a,
                      'odds': {'p1': bp1, 'p2': bp2, 'bookmaker': 'Betano'}})
    return fx, prices, ids, board


def gate_of(n_lop, n_near, reversed_universe=False, flip=()):
    fx, prices, ids, board = synth(n_lop, n_near, reversed_universe, flip)
    ki, _ = O.kibl_favourites(fx, prices, ids)
    bi, _ = O.board_favourites(board)
    return O.ship_gate(O.verdicts(ki, {k: v['readings'] for k, v in bi.items()}))


print()
print('LOPSIDED — the two limbs, and that they are not the same limb')
check('the price limb fires on a 1.40 favourite (the boundary is inclusive)',
      O.is_lopsided({'a': 1.40, 'b': 3.0}, 1.0)[0])
check('and not on 1.41 by price alone',
      O.is_lopsided({'a': 1.41, 'b': 1.44}, 1.0) == (False, None))
check('the gap limb fires without the price limb — a 1.45 favourite in a tight '
      'book clears 25 points while never reaching 1.40',
      O.is_lopsided({'a': 1.45, 'b': 3.20}, O.implied_gap_pp(1.45, 3.20))
      == (True, 'gap'))
check('the price limb fires without the gap limb — a 1.35 favourite in a '
      'heavily-margined book sits under 25 points',
      O.is_lopsided({'a': 1.35, 'b': 2.00}, O.implied_gap_pp(1.35, 2.00))
      == (True, 'price'))
check('the gap limb boundary is inclusive — exactly 25.0 points counts',
      O.is_lopsided({'a': 1.60, 'b': 2.67}, 25.0) == (True, 'gap'))
check('...and 24.9 does not', O.is_lopsided({'a': 1.60, 'b': 2.67}, 24.9)
      == (False, None))
check('favourite_price is the LOWER of the pair, not the named side',
      O.favourite_price({'a': 2.32, 'b': 1.57}) == 1.57)
check('one side priced is not a market, so there is no favourite price',
      O.favourite_price({'a': 1.57}) is None)

print()
print('THE REAL BOARD MATCH IS NEAR-EVEN — the split is not decorative')
# Kwon 1.57 / Suresh 2.32: 20.6pp, favourite 1.57. Under the founder's
# definition this fixture cannot carry the verdict, and if the split were
# mis-implemented it would land in the blocking group and read as evidence.
_real = O.is_lopsided({'S. Kwon': 1.57, 'D. Suresh': 2.32},
                      O.implied_gap_pp(1.57, 2.32))
check('today\'s Suresh/Kwon fixture is NEAR-EVEN, not lopsided',
      _real == (False, None), _real)

print()
print('THE GATE CANNOT PASS BY ACCIDENT')
check('n = 0 does not pass — 0 >= 10 is false, and this is the exact failure '
      'that put this gate in the founder\'s hands',
      O.ship_gate({})['passes'] is False)
g_small = gate_of(6, 3)          # 9 checked, 6 lopsided
check('9 checked fixtures fail 2a even with 6 lopsided',
      not g_small['passes']
      and not g_small['criteria']['2a_fixtures_both_sources']['pass']
      and g_small['criteria']['2b_lopsided_fixtures']['pass'], g_small['criteria'])
g_thin = gate_of(5, 8)           # 13 checked, 5 lopsided
check('13 checked fixtures fail 2b with only 5 lopsided — volume does not '
      'substitute for separation',
      not g_thin['passes']
      and g_thin['criteria']['2a_fixtures_both_sources']['pass']
      and not g_thin['criteria']['2b_lopsided_fixtures']['pass'],
      g_thin['criteria'])
g_ok = gate_of(6, 4)             # 10 checked, 6 lopsided, no disagreement
check('exactly 10 checked and exactly 6 lopsided with no disagreement PASSES — '
      'the boundary is inclusive on both',
      g_ok['passes'] and g_ok['lopsided']['n'] == 6
      and g_ok['nearEven']['n'] == 4, g_ok['criteria'])

print()
print('2e — ONE BOOK ALONE CANNOT PROMOTE A FIXTURE INTO THE BLOCKING GROUP')
# Founder 2e: Kibl is SHARP and bet365/api-tennis are SOFT, so the two books
# separating a match differently is expected and is never a fault. A fixture is
# only lopsided when BOTH sides of the comparison say so. If either alone could
# promote it, one book's margin would decide which evidence is allowed to stop
# a deploy — and the 'or' version of this rule passes every other test in this
# file, so nothing else here would catch it.


def one_sided(kibl_px, board_px):
    """Kibl and the board price the SAME match with different separation."""
    fx = [{'fixture_id': 8001, 'player1_name': 'Alcaraz',
           'player2_name': 'Sinner', 'name': '8001 Alcaraz vs Sinner',
           'scheduled_start': '2026-09-18T07:00:00.000Z'}]
    ki, _ = O.kibl_favourites(fx, {8001: kibl_px})
    bi, _ = O.board_favourites([{'id': 'x', 'date': '2026-09-18',
                                 'p1': 'Sinner', 'p2': 'Alcaraz',
                                 'odds': {**board_px, 'bookmaker': 'Betano'}}])
    v = O.verdicts(ki, {k: r['readings'] for k, r in bi.items()})
    return list(v.values())[0]


# Alcaraz is the favourite in every payload below; only the SEPARATION moves.
_k_only = one_sided({'1': 1.25, '2': 4.00}, {'p1': 2.32, 'p2': 1.57})
check('lopsided on Kibl but near-even on the board is NEAR-EVEN — the sharp '
      'book does not get to promote it on its own',
      _k_only['group'] == 'near-even' and _k_only['verdict'] == 'agree',
      _k_only['lopsided'])
_b_only = one_sided({'1': 2.32, '2': 1.57}, {'p1': 4.00, 'p2': 1.25})
check('...and neither does the soft book',
      _b_only['group'] == 'near-even', _b_only['lopsided'])
_both = one_sided({'1': 1.25, '2': 4.00}, {'p1': 4.00, 'p2': 1.25})
check('both lopsided IS lopsided — the rule is an AND, not a veto',
      _both['group'] == 'lopsided', _both['lopsided'])

print()
print('2c — WHICH GROUP A DISAGREEMENT LANDS IN DECIDES WHETHER IT BLOCKS')
g_near_dis = gate_of(6, 4, flip=(7,))     # index 7 is a near-even fixture
check('a near-even disagreement is NOTED and does not stop the ship',
      g_near_dis['passes'] and g_near_dis['nearEven']['disagree'] == 1
      and g_near_dis['lopsided']['disagree'] == 0
      and g_near_dis['nearEven']['blocking'] is False,
      {'near': g_near_dis['nearEven']['disagree'],
       'lop': g_near_dis['lopsided']['disagree']})
g_lop_dis = gate_of(6, 4, flip=(0,))      # index 0 is a lopsided fixture
check('ONE lopsided disagreement stops it, even with 2a and 2b satisfied',
      not g_lop_dis['passes']
      and g_lop_dis['lopsided']['disagree'] == 1
      and not g_lop_dis['criteria']['2c_lopsided_disagreements']['pass']
      and g_lop_dis['criteria']['2a_fixtures_both_sources']['pass'],
      g_lop_dis['criteria'])
check('...and it is reported with BOTH payloads, not as a count',
      bool(g_lop_dis['lopsided']['disagreements'])
      and 'prices' in g_lop_dis['lopsided']['disagreements'][0]['kibl'],
      g_lop_dis['lopsided']['disagreements'][:1])

print()
print('THE REVERSED UNIVERSE STILL FAILS UNDER THE NEW BAR')
g_rev = gate_of(6, 4, reversed_universe=True)
check('reversing Kibl fails the gate — every lopsided fixture disagrees',
      not g_rev['passes'] and g_rev['lopsided']['disagree'] == 6
      and g_rev['lopsided']['agree'] == 0, g_rev['lopsided'])
check('and the near-even fixtures ALSO reverse but are reported separately, '
      'never pooled into one rate',
      g_rev['nearEven']['n'] == 4 and g_rev['lopsided']['n'] == 6)

print()
print('2d — EVERY FIXTURE INDIVIDUALLY, WITH ITS PARTICIPANT IDS')
f0 = g_ok['fixtures'][0]
check('the gate reports one line per CHECKED fixture, not a percentage',
      len(g_ok['fixtures']) == 10)
check('each line carries the verdict, the group and both gaps',
      {'verdict', 'group', 'kibl', 'independent'} <= set(f0)
      and 'gap_pp' in f0['kibl'], f0)
check('participant ids are keyed by PLAYER NAME, so an id can never be printed '
      'beside the other player\'s price',
      set(f0['kibl']['participant_ids']) == set(f0['kibl']['prices']),
      f0['kibl'])
_ids = f0['kibl']['participant_ids']
_pxs = f0['kibl']['prices']
_fav = min(_pxs, key=lambda k: _pxs[k])
check('the favourite\'s id travels with the favourite\'s price through the '
      'feeds\' opposite orderings',
      _ids[_fav] is not None and _ids[_fav] != _ids[
          [k for k in _pxs if k != _fav][0]], _ids)
check('a gate driven WITHOUT ids still reports the fixture rather than '
      'crashing — the ids are evidence, not logic',
      bool(O.kibl_favourites(*synth(1, 0)[:2])[0]))

print()
if FAILED:
    print(f'{len(FAILED)} FAILED: {FAILED}')
    sys.exit(1)
print('all checks passed')
