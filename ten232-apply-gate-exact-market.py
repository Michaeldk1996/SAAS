#!/usr/bin/env python3
"""TEN-232 — the gate's market-type test becomes EXACT, like its segment test.

The gate already learned this lesson once, on the SEGMENT half: matching `set`
as a substring folded "First Set" into "Sets" and inflated two headline answers.
The fix was applied to segments and NOT to market types, so `total` still
matched **Team Total** — a different product (games won by one player). On the
live archive that made "total — total games (full game)" report 25,366 rows when
the real figure is 11,707; the other 13,659 are Team Total.

The two set-level answers the founder actually rules on are UNAFFECTED: Kibl
returns no `Team Total x Sets` rows at all, so SET HANDICAP (4,447) and
TOTAL SETS (2,064) were right by absence rather than by the test. That is luck,
and this removes the luck.

Usage: python3 ten232-apply-gate-exact-market.py <repo-root>
"""
import os
import sys

EDITS = []
GATE = 'ten232-bet105-gate.py'

# The docstring terminator, built rather than written, so this file never has
# to nest one triple-quoted string inside another.
Q = '"' * 3


def edit(path, name, old, new):
    EDITS.append((path, name, old, new))


OLD_PRESENT = (
    "        common is exactly how a market gets claimed that the book does not sell.\n"
    "        " + Q + "\n"
    "        hit = 0\n"
    "        for (m, s, _b), n in combos.items():\n"
    "            mn = str(mt.get(m, '')).lower()\n"
    "            sn = str(sg.get(s, '')).lower().strip()\n"
    "            if any(x in mn for x in mnames) and sn in seg_exact:\n"
    "                hit += n\n"
    "        return hit"
)

NEW_PRESENT = (
    "        common is exactly how a market gets claimed that the book does not sell.\n"
    "\n"
    "        WARNING: AND SO IS THE MARKET TYPE, FOR THE SAME REASON, AFTER THE\n"
    "        SAME MISTAKE. The fix above was applied to the segment and not to\n"
    "        the market, so `total` went on matching **Team Total** — the games\n"
    "        won by ONE player, a different product from the total games in the\n"
    "        match. On the live archive that reported 'total games' as 25,366\n"
    "        rows when the real figure is 11,707; the other 13,659 were Team\n"
    "        Total.\n"
    "\n"
    "        The two set-level answers were NOT affected, because Kibl returns\n"
    "        no `Team Total x Sets` rows at all — they were right by absence\n"
    "        rather than by the test. Both halves are exact now, so neither\n"
    "        answer depends on which markets happen not to exist this month.\n"
    "        " + Q + "\n"
    "        hit = 0\n"
    "        for (m, s, _b), n in combos.items():\n"
    "            mn = str(mt.get(m, '')).lower().strip()\n"
    "            sn = str(sg.get(s, '')).lower().strip()\n"
    "            if mn in mnames and sn in seg_exact:\n"
    "                hit += n\n"
    "        return hit"
)

edit(GATE, 'present(): the market type is matched EXACTLY too',
     OLD_PRESENT, NEW_PRESENT)

edit(GATE, 'the asks name exact market types',
     """        ('match winner (moneyline, full game)', present(('moneyline', 'money line',
                                                         'winner'), {'full game'})),
        ('spread — games handicap (full game)', present(('spread', 'handicap'),
                                                        {'full game'})),
        ('total — total games (full game)',     present(('total',), {'full game'})),
        ('SET HANDICAP (spread on SETS)',       present(('spread', 'handicap'),
                                                        {'sets'})),
        ('TOTAL SETS (total on SETS)',          present(('total',), {'sets'})),
        ('  — not those: spread on FIRST SET (games hcp in set 1)',
         present(('spread', 'handicap'), {'first set'})),
        ('  — not those: total on FIRST SET (games in set 1)',
         present(('total',), {'first set'})),""",
     """        ('match winner (Moneyline x Full Game)', present({'moneyline'}, {'full game'})),
        ('games handicap (Spread x Full Game)',  present({'spread'}, {'full game'})),
        ('total games (Total x Full Game)',      present({'total'}, {'full game'})),
        ('SET HANDICAP (Spread x Sets)',         present({'spread'}, {'sets'})),
        ('TOTAL SETS (Total x Sets)',            present({'total'}, {'sets'})),
        ('  — a DIFFERENT market: Team Total x Full Game',
         present({'team total'}, {'full game'})),
        ('  — a DIFFERENT market: Spread x First Set (games hcp in set 1)',
         present({'spread'}, {'first set'})),
        ('  — a DIFFERENT market: Total x First Set (games in set 1)',
         present({'total'}, {'first set'})),""")

# The harness pinned the literal uppercase 'FIRST SET' from the old label. The
# property it is protecting — that the near-miss markets are printed BESIDE the
# real ones rather than hidden — is unchanged and still true; only the casing of
# the label moved. Asserting the property case-insensitively, and adding the
# Team Total near-miss to the same check, so the next relabel does not redden a
# gate for a reason that is not a regression.
edit('test-ten232-bet105-gate.py', 'the near-miss assertion checks the property, not the casing',
     """check('the First Set near-misses are printed beside them, not hidden',
      'FIRST SET' in src and "{'first set'}" in exec_code)""",
     """check('the near-miss markets are printed beside them, not hidden',
      'first set' in src.lower() and "{'first set'}" in exec_code
      and 'team total' in src.lower() and "{'team total'}" in exec_code,
      'First Set (a games market inside set 1) and Team Total (one player\\'s '
      'games) each share a word with a market the founder rules on')""")

edit('test-ten232-bet105-gate.py', 'and the market type is asserted exact too',
     """check('the set-level asks name the SETS segment explicitly',
      "{'sets'}" in exec_code)""",
     """check('the set-level asks name the SETS segment explicitly',
      "{'sets'}" in exec_code)
# The market half had the identical defect and it was fixed second: `total`
# matched **Team Total** and reported total games as 25,366 instead of 11,707.
check('the market type is matched EXACTLY too, not as a substring',
      'mn in mnames' in exec_code and 'any(x in mn for x in mnames)' not in exec_code,
      'a substring match folds Team Total into Total')""")

edit(GATE, 'the set-level verdict uses the exact test',
     """    if not present(('spread', 'handicap'), {'sets'}) and not present(('total',), {'sets'}):""",
     """    if not present({'spread'}, {'sets'}) and not present({'total'}, {'sets'}):""")


def apply(root):
    changed = 0
    for path, name, old, new in EDITS:
        full = os.path.join(root, path)
        src = open(full, encoding='utf-8').read()
        if src.count(new) >= 1:
            print(f'  no-op   {name}')
            continue
        n = src.count(old)
        if n != 1:
            print(f'::error::  {name}: anchor matched {n} times, expected 1')
            return 1
        open(full, 'w', encoding='utf-8').write(src.replace(old, new, 1))
        print(f'  applied {name}')
        changed += 1
    print(f'{changed} edit(s) applied')
    return 0


if __name__ == '__main__':
    raise SystemExit(apply(sys.argv[1] if len(sys.argv) > 1 else '.'))
