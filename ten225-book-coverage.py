#!/usr/bin/env python3
"""TEN-225 item H — what each api-tennis book ACTUALLY covers, by level, with n.

Founder 2026-09-19: "H: Superbet's actual coverage by level, with n. It is in
api-tennis's list but has not appeared on any board you have measured — if it is
near zero, say so before I build the ladder around it. My priority order:
bet365, Superbet, Betano, Unibet, William Hill, bwin, Betfair, 1xBet, Pinnacle."

METHOD. get_odds is queried BULK-BY-DATE (one call per day, all fixtures, all
books) and joined to get_fixtures on the same day for the level. Both are free
on the Ultra plan, so the window is chosen for statistical honesty rather than
for cost: a single day would put every figure below n=30 and could not carry a
ladder decision.

A book "covers" a fixture only when it prices BOTH sides of Home/Away. A
one-sided quote cannot produce a card, so counting it as coverage would
overstate exactly the number the ladder is built on.

⚠️ This measures the ROSTER api-tennis returns for these dates, not what the
vendor's book list claims. A book on the vendor's list of 17 that never appears
here is absent in fact, whatever the list says.
"""
import json
import sys
import time
import urllib.request
import datetime as DT
from collections import defaultdict

REPO = '/Users/Michael/bsp-consult-project'
BASE = 'https://api.api-tennis.com/tennis/'
# The founder's priority order, so the report answers in his terms rather than
# in descending-coverage order, which would bury the books he named.
PRIORITY = ['bet365', 'Superbet', 'Betano', 'Unibet', 'William Hill', 'bwin',
            'Betfair', '1xBet', 'Pinnacle']
# TEN-225 item 6 — book-name normalisation is a SHARED standard, not a habit
# repeated per script. `book_names.canon` is the one definition; see that module
# for the WilliamHill case that caused it.
from book_names import canon, display as _display


def key():
    for line in open(f'{REPO}/.env'):
        if line.startswith('API_TENNIS_KEY='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")
    raise SystemExit('::error::API_TENNIS_KEY not found')


def get(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=90) as r:
                return json.load(r)
        except Exception:
            time.sleep(3 * (attempt + 1))
    return None


def main():
    k = key()
    days = [(DT.date.today() + DT.timedelta(days=d)).isoformat()
            for d in range(-7, 3)]

    level_of, books_on = {}, defaultdict(set)
    seen_days = 0
    for day in days:
        fx = get(f'{BASE}?method=get_fixtures&APIkey={k}&date_start={day}&date_stop={day}')
        od = get(f'{BASE}?method=get_odds&APIkey={k}&date_start={day}&date_stop={day}')
        if not fx or not od:
            print(f'  ::warning:: {day}: a call failed; that day is EXCLUDED rather '
                  'than counted as zero coverage')
            continue
        seen_days += 1
        for f in (fx.get('result') or []):
            ek = str(f.get('event_key'))
            lvl = f.get('event_type_type') or f.get('tournament_name') or 'unknown'
            if ek:
                level_of[ek] = lvl
        for ek, mk in (od.get('result') or {}).items():
            hw = mk.get('Home/Away') or {}
            home = {b for b, v in (hw.get('Home') or {}).items() if v}
            away = {b for b, v in (hw.get('Away') or {}).items() if v}
            # BOTH sides, or it cannot price a card.
            for b in (home & away):
                books_on[str(ek)].add(_display(b))

    print(f'window: {days[0]} -> {days[-1]}  ({seen_days} of {len(days)} days usable)')
    priced = {ek for ek, bs in books_on.items() if bs}
    print(f'fixtures with at least one two-sided quote: {len(priced)}')
    joined = {ek for ek in priced if ek in level_of}
    print(f'  of those, joined to a level: {len(joined)}'
          + ('  ⚠️ the unjoined remainder is excluded from the level table below'
             if len(joined) < len(priced) else ''))
    if not priced:
        print('  ::warning:: ZERO priced fixtures in the whole window. Nothing was '
              'assessed — this is NOT "no book covers anything".')
        return 0

    # ---------------- the founder's priority list, answered in his order -----
    print(f'\n=== PRIORITY-LIST COVERAGE over {len(priced)} priced fixtures ===')
    print(f"  {'#':>2} {'book':14} {'fixtures':>9} {'coverage':>9}")
    allbooks = defaultdict(int)
    for ek, bs in books_on.items():
        for b in bs:
            allbooks[b] += 1
    bycanon = defaultdict(int)
    for b, n in allbooks.items():
        bycanon[canon(b)] += n
    for i, b in enumerate(PRIORITY, 1):
        n = bycanon.get(canon(b), 0)
        pct = 100.0 * n / len(priced)
        note = '   <- ABSENT from the feed on every day measured' if n == 0 else ''
        print(f'  {i:>2} {b:14} {n:>9} {pct:>8.1f}%{note}')

    print('\n=== EVERY book the feed actually returned ===')
    print(f"  {'book':14} {'fixtures':>9} {'coverage':>9}")
    for b, n in sorted(allbooks.items(), key=lambda x: -x[1]):
        star = ('  (on the priority list)'
                if canon(b) in {canon(x) for x in PRIORITY} else '')
        print(f'  {b:14} {n:>9} {100.0*n/len(priced):>8.1f}%{star}')

    # ---------------- by level ----------------------------------------------
    bylvl = defaultdict(lambda: defaultdict(int))
    lvl_n = defaultdict(int)
    for ek in joined:
        lvl = level_of[ek]
        lvl_n[lvl] += 1
        for b in books_on[ek]:
            bylvl[lvl][b] += 1
    print('\n=== BY LEVEL — priority books only ===')
    for lvl in sorted(lvl_n, key=lambda x: -lvl_n[x]):
        n = lvl_n[lvl]
        flag = '  ⚠️ n<30' if n < 30 else ''
        cells = []
        for b in PRIORITY:
            c = sum(v for kk, v in bylvl[lvl].items() if canon(kk) == canon(b))
            if c:
                cells.append(f'{b} {100.0*c/n:.0f}%')
        print(f'  {lvl:28} n={n:<5}{flag}  ' + (', '.join(cells) or 'NONE of the '
              'priority books price this level'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
