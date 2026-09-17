#!/usr/bin/env python3
"""Offline unit tests for oddspapi_budget.py (TEN-225 ruling 6b/6c).

No network, no quota, no Supabase. Every assertion here drives the real
decision function with a stubbed meter and a stubbed ledger and checks the
DECISION, not the source text — delete the rule and the test goes red.

The gate has five ways to say no and one way to say yes, and getting any of
them backwards spends money or kills the board:

  1. Daily cap (6b): at or past 150 units spent today, billable work stops.
  2. Would-exceed (6b): a plan that crosses the cap is stopped BEFORE the spend,
     not after — the meter only tells us afterwards.
  3. Single-run ask (6c): a plan over 50 units exits non-zero and spends nothing.
  4. No meter: we never spend units we cannot count.
  5. Ledger down: the daily cap cannot be evaluated, so only the bounded
     fallback floor is allowed; anything bigger stops.
  And: a normal 1-unit production run is allowed, or the gate has bricked the
  live board rather than protected it.

RUNNING THIS LOCALLY ON THIS MAC: `sys.pycache_prefix` is set to
~/Library/Caches/com.apple.python, so the .pyc lives OUTSIDE the repo and
`python3 -B` does not help — it only stops the write, not the read. Editing
oddspapi_budget.py and re-running can silently execute the previous bytecode
(it cost ~15 minutes on 2026-09-18: the source read `METER_RETRIES = 3` while
the loop ran with 1). Clear
~/Library/Caches/com.apple.python/<abs-path-to-worktree> between mutation runs.
CI is unaffected; ubuntu-latest has no pycache prefix.

Two boundary rules that are easy to get wrong are pinned explicitly:
  * the day baseline is the LAST reading of an earlier day, not the first of
    today (otherwise today's own first spend vanishes from the count);
  * a meter lower than the baseline means the billing period rolled over, so the
    baseline drops to 0 rather than producing a negative spend.
"""

import importlib.util
import json
import os
import sys

spec = importlib.util.spec_from_file_location(
    'budget', os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           'oddspapi_budget.py'))
budget = importlib.util.module_from_spec(spec)
spec.loader.exec_module(budget)

# run_gate() below swaps read_meter out for a stub, so the real one is captured
# here — test 11 drives the genuine retry loop, not the stub that replaced it.
REAL_READ_METER = budget.read_meter

FAILED = []


def check(name, got, want):
    if got == want:
        print(f'  ok   {name}')
    else:
        print(f'  FAIL {name}: got {got!r}, want {want!r}')
        FAILED.append(name)


class Args:
    def __init__(self, job='t', plan=1, run_id='r1', observe=False):
        self.job, self.plan, self.run_id, self.observe = job, plan, run_id, observe


def run_gate(meter, ledger, plan, limit=5000, observe=False):
    """Drive preflight() with a stubbed meter and ledger.

    Returns (exit_code_or_'exit1', outputs_dict). Outputs are captured from the
    GITHUB_OUTPUT file the real function writes, so what is asserted is what a
    workflow would actually read.
    """
    out = os.path.join(os.environ.get('TMPDIR', '/tmp'), '.budget-test-output')
    if os.path.exists(out):
        os.remove(out)
    os.environ['GITHUB_OUTPUT'] = out

    budget.read_meter = lambda key: (meter, limit, '2026-10-10T00:37:53+00:00')
    budget.read_odds_key = lambda: 'stub'
    budget.ledger_rows = lambda day_from, day_to=None: (
        (None, 'stubbed down') if ledger is None else (ledger, None))
    written = []
    budget.ledger_write = lambda row: (written.append(row), (None, None))[1]

    try:
        code = budget.preflight(Args(plan=plan, observe=observe))
    except SystemExit as e:
        code = f'exit{e.code}'
    kv = {}
    if os.path.exists(out):
        for line in open(out):
            if '=' in line:
                k, v = line.rstrip('\n').split('=', 1)
                kv[k] = v
    return code, kv, written


TODAY = budget.datetime.now(budget.timezone.utc).strftime('%Y-%m-%d')
YDAY = (budget.datetime.now(budget.timezone.utc)
        - budget.timedelta(days=1)).strftime('%Y-%m-%d')


def row(day, meter, phase='post', job='j', run='x'):
    return {'day': day, 'job': job, 'run_id': run, 'phase': phase,
            'meter': meter, 'planned': None, 'decision': None, 'reason': None,
            'created_at': f'{day}T00:00:00Z'}


print('1. the daily cap stops billable work at 150 (ruling 6b)')
# Yesterday closed at 1000; the meter reads 1150 -> exactly 150 spent today.
code, kv, _ = run_gate(1150, [row(YDAY, 1000)], plan=1)
check('at the cap: allowed', kv.get('allowed'), 'false')
check('at the cap: reason', kv.get('reason'), 'daily-cap')
check('at the cap: spent_today', kv.get('spent_today'), '150')
check('at the cap: exit code is 0, not a job failure', code, 0)

print('2. a plan that would cross the cap is stopped before it spends')
# 110 spent today leaves 40 of the 150; a 41-unit plan crosses it. The plan is
# deliberately under the 50-unit ask threshold so this tests the CAP and not
# rule 6c, which is checked first and would otherwise mask it.
code, kv, _ = run_gate(1110, [row(YDAY, 1000)], plan=41)
check('would-exceed: allowed', kv.get('allowed'), 'false')
check('would-exceed: reason', kv.get('reason'), 'would-exceed-daily-cap')
check('would-exceed: 110 already spent', kv.get('spent_today'), '110')
check('would-exceed: 40 remain', kv.get('remaining_today'), '40')
# ...and 40 exactly is allowed, so the boundary is <=, not <.
check('exactly the remainder is allowed',
      run_gate(1110, [row(YDAY, 1000)], plan=40)[1].get('allowed'), 'true')
# ...and the same plan is fine when the day is young.
code, kv, _ = run_gate(1000, [row(YDAY, 1000)], plan=50)
check('same plan allowed on a fresh day', kv.get('allowed'), 'true')
check('fresh day: 150 remain', kv.get('remaining_today'), '150')

print('3. a single run planning more than 50 units stops and asks (ruling 6c)')
code, kv, written = run_gate(1000, [row(YDAY, 1000)], plan=51)
check('over-ask: exits non-zero', code, 'exit1')
check('over-ask: allowed', kv.get('allowed'), 'false')
check('over-ask: reason', kv.get('reason'), 'over-single-run-limit')
check('over-ask: nothing was recorded as spendable', written, [])
check('exactly 50 is NOT over the threshold',
      run_gate(1000, [row(YDAY, 1000)], plan=50)[1].get('allowed'), 'true')

print('4. no meter means no billable call at all')
code, kv, written = run_gate(None, [row(YDAY, 1000)], plan=1)
check('no meter: exits non-zero', code, 'exit1')
check('no meter: allowed', kv.get('allowed'), 'false')
check('no meter: reason', kv.get('reason'), 'no-meter')

print('5. ledger down: bounded floor only')
code, kv, _ = run_gate(1000, None, plan=budget.FALLBACK_FLOOR)
check('at the floor: allowed', kv.get('allowed'), 'true')
check('at the floor: reason names the missing counter',
      kv.get('reason'), 'ledger-down-under-floor')
code, kv, _ = run_gate(1000, None, plan=budget.FALLBACK_FLOOR + 1)
check('over the floor: exits non-zero', code, 'exit1')
check('over the floor: allowed', kv.get('allowed'), 'false')
check('over the floor: reason', kv.get('reason'), 'ledger-down')

print('6. the normal production run is still allowed')
code, kv, _ = run_gate(707, [row(YDAY, 700)], plan=1)
check('1-unit job allowed', kv.get('allowed'), 'true')
check('1-unit job: 7 spent today', kv.get('spent_today'), '7')

print('7. the 80% period ceiling still bites before the daily cap does')
code, kv, _ = run_gate(3999, [row(YDAY, 3990)], plan=2)
check('period ceiling: allowed', kv.get('allowed'), 'false')
check('period ceiling: reason', kv.get('reason'), 'period-ceiling')

print('8. the baseline is the last reading of an EARLIER day')
# Two readings today (20 and 90) and one yesterday (0). Taking today's first
# reading as the baseline would report 70 spent and hide the first 20.
budget.ledger_rows = lambda day_from, day_to=None: (
    [row(YDAY, 0), row(TODAY, 20), row(TODAY, 90)], None)
base, src = budget.baseline_for(TODAY, 120)
check('baseline comes from the prior day', base, 0)
check('baseline source', src, 'prior-day')
# With no prior day at all, today's first reading is the only honest floor.
budget.ledger_rows = lambda day_from, day_to=None: (
    [row(TODAY, 20), row(TODAY, 90)], None)
check('no prior day falls back to today\'s first',
      budget.baseline_for(TODAY, 120), (20, 'today-first'))

print('9. a meter below the baseline means the period rolled over')
budget.ledger_rows = lambda day_from, day_to=None: ([row(YDAY, 4800)], None)
check('period reset drops the baseline to 0',
      budget.baseline_for(TODAY, 12), (0, 'period-reset'))

print('10. observe mode records but never blocks — and never hides a spender')
# The board's price refresh must not die because another job ate the cap.
code, kv, written = run_gate(1150, [row(YDAY, 1000)], plan=3, observe=True)
check('observe: allowed even past the cap', kv.get('allowed'), 'true')
check('observe: reason', kv.get('reason'), 'observe-only')
check('observe: exit 0', code, 0)
check('observe: still writes one ledger row', len(written), 1)
check('observe: the row carries the real meter', written[0]['meter'], 1150)
check('observe: the row is marked, not disguised as an allow',
      written[0]['decision'], 'observe')

print('11. a 429 on the FREE meter endpoint is retried, not treated as no-meter')
# A no-meter result hard-stops every gated job, so one transient 429 on
# /v4/account would take the archive and the upcoming lane down for a tick.
calls = {'n': 0}


class _429(budget.urllib.error.HTTPError):
    def __init__(self):
        super().__init__('u', 429, 'Too Many Requests', {}, None)


def flaky_urlopen(req, timeout=None):
    calls['n'] += 1
    if calls['n'] < 3:
        raise _429()

    class R:
        def read(self):
            return json.dumps({'subscriptions': [
                {'is_active': True, 'request_count': 42, 'request_limit': 5000,
                 'valid_until': '2026-10-10T00:37:53+00:00'}]}).encode()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False
    return R()


_real_open, _real_sleep = budget.urllib.request.urlopen, budget.time.sleep
budget.urllib.request.urlopen = flaky_urlopen
budget.time.sleep = lambda s: None
check('meter survives two 429s', REAL_READ_METER('k')[0], 42)
check('and it took three attempts', calls['n'], 3)
# ...but it does not retry forever: past the budget it reports no meter.
calls['n'] = -99
check('a persistent 429 still yields no meter', REAL_READ_METER('k')[0], None)
budget.urllib.request.urlopen, budget.time.sleep = _real_open, _real_sleep

print('12. the free/billable split is the measured one, not a guess')
check('/v4/historical-odds is free', budget.is_billable('/v4/historical-odds'), False)
check('/v4/account is free', budget.is_billable('/v4/account'), False)
check('/v4/fixtures bills', budget.is_billable('/v4/fixtures'), True)
check('/v4/markets bills', budget.is_billable('/v4/markets'), True)
check('/v4/odds-by-tournaments bills', budget.is_billable('/v4/odds-by-tournaments'), True)
check('an unknown endpoint is treated as billable',
      budget.is_billable('/v4/something-new'), True)

print()
if FAILED:
    print(f'{len(FAILED)} FAILED: {FAILED}')
    sys.exit(1)
print('all tests passed')
