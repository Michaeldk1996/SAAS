#!/usr/bin/env python3
"""TEN-225 item D — the zero-quota guard must attribute spend before failing a run.

Founder item D: "odds-now.yml unhealthy — 0 successes in 10 runs, one hung 4.3h.
Writes landing by luck is not healthy. Report root cause, what a hung run costs
us, and fix it."

ROOT CAUSE, measured: every one of those failures was this guard, and not one
was the free leg billing. The guard read a GLOBAL account meter across a window
it does not own (~345 s covering ~59 calls) and attributed any movement in that
window to itself.

The fix is arithmetic, not a threshold tweak: if /v4/historical-odds had started
billing it would bill on EVERY call, so a delta far below our call count cannot
be ours. This file pins that rule from both sides, because a guard that never
fires is exactly as useless as one that always does — and the tempting bad fix
(delete the check, or raise the strike count again) passes only the first half.

Standing rule N: manufacture the state. Every case below builds the meter
readings it needs rather than waiting for a live sweep to misfire.
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

FAILED = []


def check(name, cond, detail=''):
    print(f"  {'ok  ' if cond else 'FAIL'} {name}" + (f'   {detail}' if detail else ''))
    if not cond:
        FAILED.append(name)


# The rule under test, read OUT OF THE SHIPPED FILE rather than restated here.
# A copy would keep passing after someone edited the real one, which is the
# whole failure this suite exists to prevent.
SRC = open(os.path.join(HERE, 'refresh-odds-history.py')).read()

print('TEN-225 item D — attribution before failure')
print('\n  — the rule is actually in the shipped file')
check('ATTRIBUTION_FLOOR exists in refresh-odds-history.py',
      'ATTRIBUTION_FLOOR' in SRC)
check('the predicate itself weighs the delta against the CALL COUNT',
      'ATTRIBUTION_FLOOR * max(n_calls, 1)' in SRC)
# Pinning the CALL SITE, not just the definition. A first cut asserted only that
# the formula existed somewhere in the file, and a mutation that bypassed it at
# the one place it is used passed the whole suite — the predicate was still
# defined, just no longer consulted.
check('...and settle() actually CONSULTS it before failing the run, so the rule '
      'cannot be left defined-but-unused',
      'if not _spend_is_ours(a - b, n_calls):' in SRC)
check('the unattributable branch returns 0 (green run), not BILLED_RC',
      '_unattributed_record(a - b, n_calls)\n            return 0' in SRC)
check('...and it is still RECORDED, so declining to fail is not the same as '
      'looking away',
      'def _unattributed_record(' in SRC)

# Load the module for its helpers. The predicate is then called FOR REAL below.
# An earlier cut of this file restated the rule as a local function, and two
# mutations of the shipped one — floor raised to 1.0, and the max(1,…) quiet-board
# limb deleted — both passed the whole suite. The rule now has exactly one
# definition and the tests call it.
import importlib.util
spec = importlib.util.spec_from_file_location(
    'roh_under_test', os.path.join(HERE, 'refresh-odds-history.py'))
roh = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(roh)
except SystemExit:
    pass

check('the shipped module exposes the predicate, so this suite can test the real '
      'rule rather than a copy of it',
      hasattr(roh, '_spend_is_ours') and hasattr(roh, 'ATTRIBUTION_FLOOR'))
attributable = roh._spend_is_ours

print('\n  — the six REAL failures must all come back green')
# Measured from runs 35197701386, 35229789789, 35272196203, 35297208263,
# 35316521545, 35342160371 — the actual deltas that failed the run, with the
# sweep size logged alongside them.
REAL = [(1, 59), (3, 59), (3, 59), (4, 59), (2, 59), (3, 59)]
for delta, n in REAL:
    check(f'delta {delta} over {n} free calls is NOT attributed to this leg',
          not attributable(delta, n))
check(f'all {len(REAL)} historical failures clear the new rule (n={len(REAL)})',
      not any(attributable(d, n) for d, n in REAL))

print('\n  — but a leg that HAS started billing must still be caught')
check('every call billing (59 of 59) IS attributed', attributable(59, 59))
check('half the calls billing (30 of 59) IS attributed', attributable(30, 59))
check('the floor sits at 29 of 59 — pinned exactly, so a later edit to '
      'ATTRIBUTION_FLOOR shows up here as a failure rather than as silence',
      attributable(29, 59) and not attributable(28, 59),
      'floor = 29')

print('\n  — the small-sweep edge, where the two rules are closest')
# This is where a magnitude rule is weakest: on a 1-call sweep, "our call
# billed" and "someone else spent a unit" are genuinely indistinguishable, and
# the rule must fail SAFE — toward catching it — rather than go quiet.
check('a 1-call sweep with a 1-unit delta IS attributed: on a sweep that small '
      'the guard must not be able to explain a real regression away',
      attributable(1, 1))
check('a 2-call sweep with a 1-unit delta is attributed too (floor is max(1,…))',
      attributable(1, 2))
check('a zero-call sweep with a 1-unit delta is still attributed, so the quiet '
      'board — the one path where only the two free meter reads happen — cannot '
      'become the path that never notices',
      attributable(1, 0))

print('\n  — the recorder accumulates rather than overwrites')
if hasattr(roh, '_unattributed_record'):
    with tempfile.TemporaryDirectory() as d:
        roh.UNATTRIBUTED_FILE = os.path.join(d, 'unattributed')
        roh._unattributed_record(3, 59)
        roh._unattributed_record(2, 59)
        with open(roh.UNATTRIBUTED_FILE) as fh:
            got = fh.read().split()
        check('two sweeps accumulate to 5 units over 118 calls across 2 sweeps, '
              'so a slow real leak shows as a rising total instead of as silence',
              got[:3] == ['5', '118', '2'], ' '.join(got))
        ratio = 5 / 118
        check('...and the ratio stays near zero for concurrent spend, which is '
              'the signal that separates it from this leg billing',
              ratio < 0.1, f'{ratio:.3f}')
else:
    check('refresh-odds-history.py exposes _unattributed_record for this test',
          False, 'module or helper missing')

print()
if FAILED:
    print(f'{len(FAILED)} FAILED: {FAILED}')
    sys.exit(1)
print('all checks passed')
