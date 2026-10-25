#!/usr/bin/env python3
"""bet105-line-prices — line_prices.py (join, normalise, guards, projection), offline. Every check names the mutation
that turns it red; tools/test-line-prices-mutants.py applies each one to a copy of the module and requires a red run.
  W  wrong side: Medvedev −3 2.29 / Bublik +3 1.662 lands on the right player, whichever order api-tennis lists them
     (mutant SWAP_SIDES: keys {2: p2, 3: p1})
  S  suspended / price 0 -> dash, the shard carries no price, never 0      (mutant NO_SUSPEND: drop guard (a))
  O  Over / Under: side_id 7 = Over, 6 = Under                              (mutant SWAP_OU)
  D  guard (d): a −line (|line| >= 2) priced shorter than the player's match price dashes  (mutant NO_GUARD_D)
  B  guard (b): a pair whose sides do not add up dashes                      (mutant NO_COHERENCE)
  C  guard (c): a ladder out of order dashes                                 (mutant NO_LADDER)
  P  pre-match only: an api-tennis live / finished status dashes as started  (mutant NO_STARTED)
  J  join: both players, one candidate; disjoint initials block; else unmatched, LISTED  (mutant JOIN_ONE_SURNAME)
  K  name ruling 2026-10-25: extra given / middle names and extra surname parts never block — the 5 real unmatched
     spellings of 25 Oct 00:4xZ join, each in the right orientation    (mutants LAST_TOKEN_ONLY, ANY_INITIAL_BLOCKS)
  X  an opener on a different line is no opening price for this line       (mutant OPEN_ANY_LINE)
  U  two Kibl slots on the SAME line are one price, the newest (run 40115201276 upserted one key twice)
                                                                             (mutant NO_COLLAPSE)
  Q  a spread pairs (A, L) with (B, −L), never with (B, +L), when both directions are offered  (mutant PAIR_BY_ABS)
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
SRC = os.environ.get('LP_FILE') or os.path.join(HERE, 'line_prices.py')
spec = importlib.util.spec_from_file_location('line_prices_under_test', SRC)
LP = importlib.util.module_from_spec(spec)
spec.loader.exec_module(LP)
FAILED = []


def check(name, cond, detail=''):
    print(f'  {"ok  " if cond else "FAIL"} {name}' + ('' if cond else f'  {detail}'))
    if not cond:
        FAILED.append(name)


KFX = [{'fixture_id': 771905, 'start_time': '2026-10-24T13:00:00Z', 'name': 'Daniil Medvedev vs Alexander Bublik',
        'participants': [{'side_id': 2, 'name': 'Daniil Medvedev'}, {'side_id': 3, 'name': 'Alexander Bublik'}]}]


def at(first_is_medvedev=True, status=''):
    a = ('D. Medvedev', 1093) if first_is_medvedev else ('A. Bublik', 1895)
    b = ('A. Bublik', 1895) if first_is_medvedev else ('D. Medvedev', 1093)
    return [{'event_key': 12173801, 'event_date': '2026-10-24', 'event_time': '13:00', 'event_type_type': 'Atp Singles',
             'event_first_player': a[0], 'first_player_key': a[1], 'event_second_player': b[0], 'second_player_key': b[1],
             'event_status': status}]


def row(mt, seg, side, point, price, alt=0, psid=None, opener=False, status=1, ins='2026-10-24T11:05:06Z', maxl=3900.0):
    return {'fixture_id': 771905, 'market_type_id': mt, 'segment_id': seg, 'side_id': side,
            'participant_side_id': psid if psid is not None else (side if side in (2, 3) else 0), 'point': point,
            'price_decimal': price, 'alt_id': alt, 'is_opener': opener, 'market_status_id': status, 'inserted_on': ins,
            'max_limit': maxl, 'is_live': False}


BASE = [
    row(1, 1, 2, 0.0, 1.52), row(1, 1, 3, 0.0, 2.71),                                  # match winner
    row(2, 1, 2, -3.0, 2.29, alt=1), row(2, 1, 3, 3.0, 1.662, alt=1),                  # Medvedev −3 / Bublik +3
    row(2, 1, 2, -2.5, 2.01, alt=0), row(2, 1, 3, 2.5, 1.862, alt=0),
    row(2, 1, 2, -3.5, 2.48, alt=2), row(2, 1, 3, 3.5, 1.571, alt=2),
    row(3, 1, 7, 22.5, 1.66, alt=0), row(3, 1, 6, 22.5, 2.30, alt=0),                 # total games: 7 Over, 6 Under
    row(3, 54, 7, 2.5, 2.25), row(3, 54, 6, 2.5, 1.699),                               # deciding set
    row(1, 22, 2, 0.0, 1.61), row(1, 22, 3, 0.0, 2.44),                                # set 1
    row(2, 54, 2, -1.5, 2.48), row(2, 54, 3, 1.5, 1.571),                              # set handicap
]


def run(rows, at_fx=None):
    mapping, jst = LP.join_fixtures(KFX, at_fx if at_fx is not None else at())
    entries, _ = LP.normalise(rows, mapping)
    LP.apply_guards(entries, {m['event_key']: m for m in mapping.values()})
    return {(e['market'], str(e['side']), e['line']): e for e in entries}, mapping, jst


print('W  wrong side')
for order in (True, False):
    E, mapping, _ = run(BASE, at(order))
    mv, bb = E.get(('gh', '1093', -3.0)), E.get(('gh', '1895', 3.0))
    check(f'W  Medvedev −3 = 2.29, Bublik +3 = 1.662 (api-tennis lists {"Medvedev" if order else "Bublik"} first)',
          mv is not None and bb is not None and mv['price'] == 2.29 and bb['price'] == 1.662 and mv['status'] == 'ok' == bb['status'],
          (mv, bb))
    check('W  the swapped reading (Bublik −3) does not exist', ('gh', '1895', -3.0) not in E)
    check('W  de-vigged implied: both sides of the line, summing to 1',
          mv and abs(mv['implied'] + bb['implied'] - 1) < 1e-9 and abs(mv['implied'] - (1 / 2.29) / (1 / 2.29 + 1 / 1.662)) < 1e-9)

print('\nS  suspended / price 0')
rows = [r for r in BASE if not (r['market_type_id'] == 2 and r['alt_id'] == 0)] + [
    row(2, 1, 2, -2.5, 0.0, alt=0, status=2), row(2, 1, 3, 2.5, 0.0, alt=0, status=2)]
E, mapping, _ = run(rows)
e = E.get(('gh', '1093', -2.5))
check('S  a suspended, price-0 line is a dash (status suspended), both sides', e and e['status'] == 'suspended'
      and E[('gh', '1895', 2.5)]['status'] == 'suspended', e)
shard = LP.project(list(E.values()), mapping, '2026-10-24T12:00:00Z')['2026-10-24']
line = [l for l in shard['events']['12173801']['lines'] if l[0] == 'gh' and l[1] == '1093' and l[2] == -2.5][0]
check('S  the shard carries NO price for it (never 0) and no implied', line[3] is None and line[4] is None and line[5] == 'suspended', line)

print('\nO  over / under')
E, _, _ = run(BASE)
check('O  side_id 7 = Over 1.66, 6 = Under 2.30 at 22.5', E[('tg', 'over', 22.5)]['price'] == 1.66 and E[('tg', 'under', 22.5)]['price'] == 2.30)
check('O  deciding set = Over 2.5 sets 2.25', E[('ts', 'over', 2.5)]['price'] == 2.25 and E[('ts', 'over', 2.5)]['status'] == 'ok')

print('\nD  guard (d)')
rows = [r for r in BASE if not (r['market_type_id'] == 2 and r['segment_id'] == 1 and r['alt_id'] == 0)] + [
    row(2, 1, 2, -2.5, 1.45, alt=0), row(2, 1, 3, 2.5, 2.80, alt=0)]   # −2.5 at 1.45, shorter than his 1.52 match price
E, _, _ = run(rows)
check('D  Medvedev −2.5 at 1.45 < his match price 1.52 -> guard_d, both sides dash',
      E[('gh', '1093', -2.5)]['status'] == 'guard_d' and E[('gh', '1895', 2.5)]['status'] == 'guard_d', E[('gh', '1093', -2.5)])
check('D  not applied at |line| <= 1.5 (set handicap −1.5 stays ok)', E[('sh', '1093', -1.5)]['status'] == 'ok')
rows = [r for r in BASE if r['market_type_id'] != 1 or r['segment_id'] != 1]
E, _, _ = run(rows)
check('D  no match-winner price -> the −3.5 line cannot be checked -> dash', E[('gh', '1093', -3.5)]['status'] == 'guard_d_no_match_winner')

print('\nB  guard (b) pair coherence')
rows = [r for r in BASE if not (r['market_type_id'] == 3 and r['segment_id'] == 1)] + [
    row(3, 1, 7, 22.5, 1.20, alt=0), row(3, 1, 6, 22.5, 1.20, alt=0)]   # 1/1.2 + 1/1.2 = 1.667
E, _, _ = run(rows)
check('B  1/p1 + 1/p2 outside [1.00, 1.20] -> incoherent, both sides', E[('tg', 'over', 22.5)]['status'] == 'incoherent' == E[('tg', 'under', 22.5)]['status'])

print('\nC  guard (c) ladder')
rows = [r for r in BASE if not (r['market_type_id'] == 2 and r['segment_id'] == 1 and r['alt_id'] == 2)] + [
    row(2, 1, 2, -3.5, 1.95, alt=2), row(2, 1, 3, 3.5, 1.90, alt=2)]   # −3.5 shorter than −3 (2.29): out of order
E, _, _ = run(rows)
check('C  −3.5 priced shorter than −3 -> ladder, dashes', E[('gh', '1093', -3.5)]['status'] == 'ladder', E[('gh', '1093', -3.5)])

print('\nP  pre-match only')
E, _, _ = run(BASE, at(True, status='Set 1'))
check('P  api-tennis status "Set 1" -> every line started', all(e['status'] == 'started' for e in E.values()))
E, _, _ = run(BASE, at(True, status='1'))
check('P  api-tennis "1" (scheduled) is not started', E[('gh', '1093', -3.0)]['status'] == 'ok')

print('\nJ  join')
other = at()[0].copy(); other.update({'event_key': 999, 'event_first_player': 'D. Medvedev', 'event_second_player': 'A. Ruud', 'second_player_key': 7})
_, mapping, jst = run(BASE, [other])
check('J  one surname in common is no match', not mapping and jst['unmatched_none'] == 1, dict(jst))
twin = at()[0].copy(); twin['event_key'] = 12173802
_, mapping, jst = run(BASE, at() + [twin])
check('J  two api-tennis candidates -> ambiguous, no prices', not mapping and jst['unmatched_ambiguous'] == 1, dict(jst))
wrong_i = at()[0].copy(); wrong_i['event_first_player'] = 'M. Medvedev'
_, mapping, jst = run(BASE, [wrong_i])
check('J  disagreeing initials (M. Medvedev vs Daniil) -> no match', not mapping, dict(jst))
_, mapping, _ = run(BASE)
check('J  the match: event 12173801, side 2 = 1093 (Medvedev), side 3 = 1895', mapping and mapping[771905]['keys'] == {2: '1093', 3: '1895'})

check('J  every unmatched Kibl fixture is listed with its players and reason',
      all('reason' in u for u in LP.join_fixtures(KFX, [other])[1]['unmatched_list']) and LP.join_fixtures(KFX, [other])[1]['unmatched_list'][0]['players'] == ['Daniil Medvedev', 'Alexander Bublik'])

print('\nK  name ruling: the five real cases')
REAL = [  # Kibl side 2, side 3  |  api-tennis first, second  |  expected: side 2 is api-tennis FIRST?
    (('Daniel Merida', 'Daniil Medvedev'), ('D. Merida Aguilar', 'D. Medvedev'), True),
    (('Qian Sun', 'Mitsuki Wei Kang Leong'), ('W. K. Leong M.', 'Sun Qian'), False),
    (('Darwin Blanch', 'Jenson Brooksby'), ('J. Brooksby', 'Dar. Blanch'), False),
    (('Digvijay Pratap Singh', 'Karan Singh'), ('D. Singh', 'K. Singh'), True),
    (('Pedro Sakamoto', 'Joao Victor Couto Loureiro'), ('P. Sakamoto', 'V. C. Loureiro J.'), True),
]
for (n2, n3), (a, b), first in REAL:
    kf = [{'fixture_id': 1, 'start_time': '2026-10-25T10:00:00Z', 'participants': [{'side_id': 2, 'name': n2}, {'side_id': 3, 'name': n3}]}]
    af = [{'event_key': 5, 'event_date': '2026-10-25', 'event_time': '10:00', 'event_type_type': 'Itf Men Singles',
           'event_first_player': a, 'first_player_key': 'A', 'event_second_player': b, 'second_player_key': 'B', 'event_status': ''}]
    m, stt = LP.join_fixtures(kf, af)
    check(f'K  {n2} / {n3}  ~  {a} / {b}', 1 in m and m[1]['keys'] == ({2: 'A', 3: 'B'} if first else {2: 'B', 3: 'A'}), (m, stt.get('unmatched_list')))
check('K  a genuinely different given name still blocks (M. Medvedev vs Daniil)', not LP._same_player('Daniil Medvedev', 'M. Medvedev'))
check('K  a different player sharing one surname still blocks (D. Singh vs Karan Singh)', not LP._same_player('Karan Singh', 'D. Singh'))

print('\nX  opening price')
rows = BASE + [row(2, 1, 2, -2.5, 1.98, alt=1, opener=True, ins='2026-10-23T09:00:00Z'),
               row(2, 1, 3, 2.5, 1.85, alt=1, opener=True, ins='2026-10-23T09:00:00Z')]
E, _, _ = run(rows)
check('X  alt slot 1 opened at −2.5 and now sits at −3: no opening price for −3', E[('gh', '1093', -3.0)]['open_price'] is None, E[('gh', '1093', -3.0)])
rows = BASE + [row(2, 1, 2, -3.0, 2.20, alt=1, opener=True, ins='2026-10-23T09:00:00Z'),
               row(2, 1, 3, 3.0, 1.70, alt=1, opener=True, ins='2026-10-23T09:00:00Z')]
E, _, _ = run(rows)
check('X  an opener on the same line is its opening price', E[('gh', '1093', -3.0)]['open_price'] == 2.20 and E[('gh', '1093', -3.0)]['price'] == 2.29)

print('\nU  same line, two slots')
rows = BASE + [row(2, 1, 2, -2.5, 2.05, alt=3, ins='2026-10-24T11:20:00Z'), row(2, 1, 3, 2.5, 1.83, alt=3, ins='2026-10-24T11:20:00Z')]
mapping, _ = LP.join_fixtures(KFX, at())
ents, nst = LP.normalise(rows, mapping)
keys = [(e['market'], e['side'], e['line']) for e in ents]
check('U  one entry per (market, side, line) — no key twice', len(keys) == len(set(keys)), [k for k in keys if keys.count(k) > 1][:3])
LP.apply_guards(ents, {m['event_key']: m for m in mapping.values()})
E = {(e['market'], str(e['side']), e['line']): e for e in ents}
check('U  the newest slot wins: Medvedev −2.5 = 2.05 (11:20), paired, de-vigged', E[('gh', '1093', -2.5)]['price'] == 2.05
      and E[('gh', '1093', -2.5)]['status'] == 'ok' and abs(E[('gh', '1093', -2.5)]['implied'] - (1/2.05)/(1/2.05 + 1/1.83)) < 1e-9, E[('gh', '1093', -2.5)])
check('U  the collapse is counted', nst.get('same_line_slots_collapsed') == 2, dict(nst))

print('\nQ  both directions offered')
rows = BASE + [row(2, 1, 2, 3.0, 1.30, alt=5), row(2, 1, 3, -3.0, 3.60, alt=5)]   # Medvedev +3 / Bublik −3
E, _, _ = run(rows)
a, b = E[('gh', '1093', -3.0)], E[('gh', '1093', 3.0)]
check('Q  Medvedev −3 pairs with Bublik +3 (implied from 2.29 / 1.662)', a['status'] == 'ok' and abs(a['implied'] - (1/2.29)/(1/2.29 + 1/1.662)) < 1e-9, a)
check('Q  Medvedev +3 pairs with Bublik −3 (implied from 1.30 / 3.60)', b['status'] == 'ok' and abs(b['implied'] - (1/1.30)/(1/1.30 + 1/3.60)) < 1e-9, b)

print('\nshard')
E, mapping, _ = run(BASE)
sh = LP.project(list(E.values()), mapping, '2026-10-24T12:00:00Z')
ev = sh['2026-10-24']['events']['12173801']
check('shard: one date, the event with both player keys, fields named', ev['p1Key'] == '1093' and ev['p2Key'] == '1895'
      and sh['2026-10-24']['fields'][:6] == ['market', 'side', 'line', 'price', 'implied', 'status'] and sh['2026-10-24']['book'] == 'bet105')
check('shard: no home / away anywhere', 'home' not in json.dumps(sh).lower() and 'away' not in json.dumps(sh).lower())

print('\n' + ('all checks passed' if not FAILED else f'{len(FAILED)} FAILED: {FAILED}'))
sys.exit(1 if FAILED else 0)
