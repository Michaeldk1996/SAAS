#!/usr/bin/env python3
"""bet105-line-prices — every mutation named in test-line-prices.py, applied to a copy of line_prices.py; the harness
must go RED on each (a mutant that survives is a check that does not bite). Run from the repo root."""
import os
import subprocess
import sys
import tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = open(os.path.join(ROOT, 'line_prices.py')).read()
MUTANTS = {
    'SWAP_SIDES': ("'keys': {2: str(p1 if first_is_2 else p2), 3: str(p2 if first_is_2 else p1)}",
                   "'keys': {2: str(p2 if first_is_2 else p1), 3: str(p1 if first_is_2 else p2)}"),
    'NO_SUSPEND': ("        elif e['status_id'] != 1 or e['price'] is None or e['price'] < MIN_PRICE:",
                   "        elif False:"),
    'SWAP_OU': ("TOTAL_SIDES = {7: 'over', 6: 'under'}", "TOTAL_SIDES = {6: 'over', 7: 'under'}"),
    'NO_GUARD_D': ("        elif not e['price'] > w['price']:", "        elif False:"),
    'NO_COHERENCE': ("        if not (COHERENCE[0] <= over <= COHERENCE[1]):", "        if False:"),
    'NO_LADDER': ("            if not rising_ok(x['price'], y['price']):", "            if False:"),
    'NO_STARTED': ("        if m.get('status') not in AT_NOT_STARTED or e.get('is_live'):", "        if False:"),
    'JOIN_ONE_SURNAME': ("            straight = _same_player(n2, a) and _same_player(n3, b)", "            straight = _same_player(n2, a) or _same_player(n3, b)"),
    'LAST_TOKEN_ONLY': ("    if kk in ta:\n        sur = kk\n    elif ka in tk:", "    if kk == ka:\n        sur = kk\n    elif False:"),
    'ANY_INITIAL_BLOCKS': ("    return not gk or not ga or bool(gk & ga)", "    return not gk or not ga or gk == ga"),
    'NO_COLLAPSE': ("        if k in best:", "        if False:"),
    'PAIR_BY_ABS': ("                key = (e['event_key'], mk) + tuple(sorted([(str(e['side']), e['line']), (next(iter(others)), -e['line'])]))",
                    "                key = (e['event_key'], mk, abs(e['line']))"),
    'OPEN_ANY_LINE': ("        same_line = op is not None and (mk in ('ml', 'ml1') or _num(op.get('point')) == line)",
                      "        same_line = op is not None"),
}
bad = []
with tempfile.TemporaryDirectory() as td:
    for name, (a, b) in MUTANTS.items():
        if SRC.count(a) != 1:
            print(f'  ANCHOR {name}: x{SRC.count(a)}'); bad.append(name); continue
        p = os.path.join(td, f'lp_{name}.py')
        open(p, 'w').write(SRC.replace(a, b))
        r = subprocess.run([sys.executable, os.path.join(ROOT, 'test-line-prices.py')], env=dict(os.environ, LP_FILE=p),
                           capture_output=True, text=True, cwd=ROOT)
        red = r.returncode != 0
        print(f'  {"caught  " if red else "SURVIVED"} {name}')
        if not red:
            bad.append(name)
r = subprocess.run([sys.executable, os.path.join(ROOT, 'test-line-prices.py')], capture_output=True, text=True, cwd=ROOT)
if r.returncode != 0:
    print('  the harness is red on the UNMUTATED module — mutants are meaningless'); sys.exit(1)
print(f'mutants: {len(MUTANTS) - len(bad)} caught, {len(bad)} survived')
sys.exit(1 if bad else 0)
