#!/usr/bin/env python3
"""odds-history: a feed placeholder start never votes in the account offset.

Run 41187901779 (2026-10-31 09:14Z) failed 0/21: the 17 Paris first-round cards
were all listed at 2026-11-02 10:00, a day off oddspapi's fixtures. They
outvoted the real cards, the median offset read +24.00h, and the four real
semi-finals that day (true offset +1h) landed 23h from their fixtures and went
unjoined. This rebuilds that board and runs the real join_fixtures on it.

Each check is also run against the pre-fix behaviour (PLACEHOLDER_BLOCK_MIN
out of reach): it must reproduce the +24h failure, so the test is not vacuous.
"""
import contextlib, importlib.util, io, os, re, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
spec = importlib.util.spec_from_file_location('hist', os.path.join(HERE, 'refresh-odds-history.py'))
hist = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hist)

fails = 0


def check(cond, msg):
    global fails
    print(('  PASS  ' if cond else '  FAIL  ') + msg)
    if not cond:
        fails += 1


# Real semi-finals 31 Oct (board = account clock, oddspapi = UTC, true offset +1h).
REAL = [('V. Vacherot', 'T. Fritz', 'ATP Basel', '15:00', '14:00'),
        ('D. Medvedev', 'C. Alcaraz', 'ATP Vienna', '15:00', '14:00'),
        ('J. Lehecka', 'J-L. Struff', 'ATP Basel', '17:00', '16:00'),
        ('A. Zverev', 'A. De Minaur', 'ATP Vienna', '16:30', '15:30')]
# The Paris first round as the feed posted it: every card 2026-11-02 10:00.
PARIS = [('I. Buse', 'Z. Bergs'), ('A. Davidovich Fokina', 'M. Kouame'), ('N. Djokovic', 'V. Vacherot'),
         ('Q. Halys', 'A. Fery'), ('U. Humbert', 'B. Van De Zandschulp'), ('D. Merida Aguilar', 'A. Blockx'),
         ('A. Michelsen', 'J. Lehecka'), ('L. Musetti', 'H. Hurkacz'), ('B. Nakashima', 'M. Berrettini'),
         ('C. Norrie', 'M. Arnaldi'), ('T. Paul', 'H. Rune'), ('A. Rinderknech', 'F. Cerundolo'),
         ('A. Rublev', 'T. M. Etcheverry'), ('D. Shapovalov', 'K. Khachanov'), ('A. Tabilo', 'R. Jodar'),
         ('S. Tsitsipas', 'L. Tien'), ('L. van Assche', 'M. Navone')]


def od(name):                     # 'N. Djokovic' -> 'Djokovic, N'  (oddspapi's "Surname, Given")
    given, _, sur = name.partition('. ')
    return f'{sur}, {given}'


def board():
    cards, fx = [], []
    for i, (a, b, tour, t, utc) in enumerate(REAL):
        cards.append({'id': f'upcoming-r{i}', 'p1': a, 'p2': b, 'tour': tour, 'date': '2026-10-31', 'time': t})
        fx.append({'fixtureId': f'real{i}', 'participant1Name': od(a), 'participant2Name': od(b),
                   'startTime': f'2026-10-31T{utc}:00.000Z'})
    for i, (a, b) in enumerate(PARIS):
        cards.append({'id': f'upcoming-p{i}', 'p1': a, 'p2': b, 'tour': 'ATP Paris', 'tournamentKey': 2133,
                      'date': '2026-11-02', 'time': '10:00'})
        fx.append({'fixtureId': f'paris{i}', 'participant1Name': od(a), 'participant2Name': od(b),
                   'startTime': '2026-11-01T10:00:00.000Z'})
    return cards, fx


def run():
    cards, fx = board()
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        joined, unjoined = hist.join_fixtures(cards, fx, calibrate_from=cards)
    m = re.search(r'offset measured this run: ([+-][\d.]+)h', out.getvalue())
    return cards, joined, unjoined, (float(m.group(1)) if m else None)


def outcome():
    cards, joined, unjoined, off = run()
    real = [c for c in cards if c['id'].startswith('upcoming-r')]
    paris = [c for c in cards if c['id'].startswith('upcoming-p')]
    return {
        'offset': off,
        'real_joined': sum(id(c) in joined for c in real),
        'real_right': sum(joined.get(id(c), {}).get('fixtureId') == f"real{c['id'][-1]}" for c in real),
        'paris_joined': sum(id(c) in joined for c in paris),
        'paris_right': sum(joined.get(id(c), {}).get('fixtureId') == f"paris{c['id'][len('upcoming-p'):]}" for c in paris),
        'unjoined': len(unjoined),
    }


print('odds-history: placeholder starts do not vote in the account offset')
new = outcome()
check(new['offset'] == 1.0, f"offset measured on the real cards only: +1.00h (got {new['offset']})")
check(new['real_joined'] == 4 and new['real_right'] == 4, f"the 4 real semi-finals join their own fixtures ({new['real_right']}/4)")
check(new['paris_joined'] == 17 and new['paris_right'] == 17,
      f"the 17 placeholder Paris cards join on both surnames, one candidate each ({new['paris_right']}/17)")
check(new['unjoined'] == 0, f"nothing unjoined, so no capture shortfall (got {new['unjoined']})")

cards, _ = board()
ph = hist.placeholder_starts(cards)
check(len(ph) == 17 and all(c['id'].startswith('upcoming-p') for c in cards if id(c) in ph),
      'placeholder_starts: exactly the 17-card Paris block')
four = [{'id': f'x{i}', 'tour': 'ATP Paris', 'date': '2026-11-03', 'time': '11:00'} for i in range(4)]
check(not hist.placeholder_starts(four), f'a block of {hist.PLACEHOLDER_BLOCK_MIN - 1} same-time cards is a real order of play and still votes')

# A placeholder card with two candidates in the window is ambiguous: never guessed from its fake time.
cards, fx = board()
fx.append(dict(fx[len(REAL)], fixtureId='paris0-dup', startTime='2026-11-02T10:00:00.000Z'))
with contextlib.redirect_stdout(io.StringIO()):
    joined, unjoined = hist.join_fixtures(cards, fx, calibrate_from=cards)
p0 = next(c for c in cards if c['id'] == 'upcoming-p0')
why = next((w for m, w, _ in unjoined if m is p0), '')
check(id(p0) not in joined and 'placeholder start' in why,
      f'a placeholder card with two candidates stays unjoined, never guessed by its placeholder time ({why!r})')

# CONTROL: the pre-fix behaviour reproduces the 31 Oct failure.
saved = hist.PLACEHOLDER_BLOCK_MIN
hist.PLACEHOLDER_BLOCK_MIN = 10 ** 9
try:
    old = outcome()
finally:
    hist.PLACEHOLDER_BLOCK_MIN = saved
check(old['offset'] == 24.0 and old['real_joined'] == 0,
      f"CONTROL pre-fix: offset +24.00h and 0/4 real semi-finals joined (got {old['offset']}, {old['real_joined']}/4)")

print(f'odds-history placeholder offset: {"all passed" if not fails else f"{fails} failed"}')
sys.exit(1 if fails else 0)
