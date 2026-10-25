#!/usr/bin/env python3
"""bet105 line prices on the stream — every mutation named in kibl-stream/test-line-engine.py, applied to a copy of
kibl-stream/line_engine.py; the harness must go RED on each (a mutant that survives is a check that does not bite).
Run from the repo root."""
import os
import subprocess
import sys
import tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = open(os.path.join(ROOT, 'kibl-stream', 'line_engine.py')).read()
TEST = os.path.join(ROOT, 'kibl-stream', 'test-line-engine.py')
MUTANTS = {
    'NO_SEED_GATE': ("            if fid in self.seeded or fid in self.started:", "            if True:"),
    'GUARDS_SKIPPED': ("        LP.apply_guards(entries, {m[\"event_key\"]: m})\n",
                       "        [e.update(status='ok', implied=None) for e in entries]\n"),
    'TICK_EVERY_CHANGE': ("        if w is None or not _same(w.get(\"price\"), new[\"price\"]) or w.get(\"status\") != new[\"status\"]:",
                          "        if True:"),
    'NO_WITHDRAW': ("            if k[0] != m[\"event_key\"] or k in seen or w.get(\"status\") == WITHDRAWN:",
                    "            if True:"),
    'NO_CLOSE': ("        if row.get(\"is_live\"):\n", "        if False:\n"),
    'DRY_WRITES': ("        if not self.write:\n            self.count[\"would_write_current\"]",
                   "        if False:\n            self.count[\"would_write_current\"]"),
    'FORGET_ON_FAIL': ("            self.write_ok = False\n", "            self.write_ok = False\n            self.written.update(upd)\n"),
    'NO_READ_BACK': ("        for r in rows or ():\n            self.written[row_key(r)]", "        for r in ():\n            self.written[row_key(r)]"),
}
bad = []
with tempfile.TemporaryDirectory() as td:
    for name, (a, b) in MUTANTS.items():
        if SRC.count(a) != 1:
            print(f'  ANCHOR {name}: x{SRC.count(a)}'); bad.append(name); continue
        p = os.path.join(td, f'le_{name}.py')
        open(p, 'w').write(SRC.replace(a, b))
        r = subprocess.run([sys.executable, TEST], env=dict(os.environ, LE_FILE=p), capture_output=True, text=True, cwd=ROOT)
        red = r.returncode != 0
        print(f'  {"caught  " if red else "SURVIVED"} {name}')
        if not red:
            bad.append(name)
r = subprocess.run([sys.executable, TEST], capture_output=True, text=True, cwd=ROOT)
if r.returncode != 0:
    print('  the harness is red on the UNMUTATED module — mutants are meaningless'); sys.exit(1)
print(f'mutants: {len(MUTANTS) - len(bad)} caught, {len(bad)} survived')
sys.exit(1 if bad else 0)
