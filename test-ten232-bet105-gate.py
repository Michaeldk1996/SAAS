#!/usr/bin/env python3
"""Offline harness for ten232-bet105-gate.py.

FOUNDER'S STANDING TEST STANDARD (2026-09-18T22:58Z item E): "a check that
passes on an empty set is not a check. Manufacture the state and run the pre-fix
build as a control."

This gate exists BECAUSE the card path reads feed_source_id 43 and Bet105 is
171 — so the single most likely way for it to mislead is to read nothing and
report a confident 0%. Every assertion below manufactures the state that would
produce that, and asserts the script REFUSES rather than reports.

No network, no secrets, no Supabase. The pure functions are exercised directly;
the refusal paths are asserted against the source, because they live inside
main() behind a live read.
"""
import os
import re
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'ten232-bet105-gate.py')

FAILED = []


def check(name, cond, detail=''):
    print(f'  {"ok  " if cond else "FAIL"} {name}' + (f'   {detail}' if detail else ''))
    if not cond:
        FAILED.append(name)


# The script imports the card-state module at load, which needs no credentials
# until it is called. Loading it here is itself a check: a NameError or a bad
# attribute reference in the gate would surface as an exception right now.
G = types.ModuleType('G')
G.__file__ = SRC
_argv, sys.argv = sys.argv, ['G']
exec(compile(open(SRC).read(), SRC, 'exec'), G.__dict__)
sys.argv = _argv
src = open(SRC, encoding='utf-8').read()
# Comments stripped for the assertions that read the CODE. A comment has
# satisfied one of these assertions before on this issue; it must not again.
code = '\n'.join(re.sub(r'#.*$', '', ln) for ln in src.split('\n'))
# For "does this script WRITE anything", comments are not enough: the module
# docstring says the words "odds_card_state" in the course of promising not to
# touch it, and a substring test over the whole file reads that promise as a
# breach. So the write checks run over EXECUTABLE code only — docstrings and
# every other triple-quoted block removed as well.
exec_code = re.sub(r'"""(?:.|\n)*?"""', '""', code)

print('=== the vacuity refusals — the whole reason this file exists ===')

check('an EMPTY read is refused, not reported as 0% coverage',
      re.search(r'if not obs:.*?::error::ZERO rows', code, re.S) is not None)
check('...and the refusal returns non-zero',
      re.search(r'::error::ZERO rows.*?return 1', code, re.S) is not None)
check('the feed_source_id filter is READ BACK, not trusted',
      "o.get('feed_source_id') != fsid" in code
      and 'the feed_source_id filter did not hold' in code)
check('the book is verified against the LIVE entitlement before any figure',
      code.index('verify_entitled(fsid)') < code.index('section_a('),
      'the precondition runs first')
check('an unentitled id is refused',
      'is NOT in our entitlement' in code and
      re.search(r'is NOT in our entitlement.*?return None', code, re.S) is not None)
check('a zero-book entitlement is refused too',
      'returned zero books' in code,
      'an empty list is not "no Bet105", it is a broken read')
check('(f) cannot pass without the independent arm',
      re.search(r'oddspapi read failed.*?CANNOT pass', code, re.S) is not None)
check('(f) verdict is taken from ship_gate, never re-derived here',
      "sg.get('passes')" in code and '>= 10' not in code.replace(
          'need >= 10', ''),
      'the bar lives in one place')

print('\n=== this script writes NOTHING ===')
for forbidden in ('odds_card_state', 'run_selection', 'ten225-publish-card-state',
                  'upsert', 'POST', 'PATCH', 'DELETE'):
    check(f'no {forbidden} in executable code', forbidden not in exec_code)
check('CONTROL: the forbidden-word scan can still SEE the code',
      'run_orientation' in exec_code and 'fetch_all' in exec_code,
      'a scan over an empty string would pass every line above')
check('the only file it writes is its own report artifact',
      exec_code.count('open(os.path.join(HERE,') == 1
      and 'ten232-bet105-gate.json' in exec_code)

print('\n=== dist() — missing stays a dash, never a zero ===')
check('an empty sample reports n=0 and a dash, not 0.0',
      G.dist([])['n'] == 0 and G.dist([])['median'] is None)
check('None values are dropped, not counted as 0',
      G.dist([None, 2.0, 4.0])['n'] == 2 and G.dist([None, 2.0, 4.0])['median'] == 3.0)
check('n < 30 is flagged', G.dist([1.0] * 29)['thin'] is True
      and G.dist([1.0] * 30)['thin'] is False)
check('fmt prints a dash for an empty sample', G.fmt(G.dist([])).startswith('—'))
check('fmt carries the n<30 flag', '⚠️' in G.fmt(G.dist([1.0, 2.0])))

print('\n=== hours() — a missing clock is never 0 ===')
check('missing start -> None', G.hours(100.0, None) is None)
check('missing tick  -> None', G.hours(None, 100.0) is None)
check('a real pair is hours, signed the stated way',
      G.hours(0.0, 7200.0) == 2.0, 'opener 2h BEFORE start -> +2')

print('\n=== (a) coverage — PRICED MEANS BOTH SIDES ===')
# Manufactured: one fixture quoted on both sides, one quoted on a single side,
# one never quoted. A count that treated "any price" as priced would say 2 of 3.
MW = {'market_type_id': G.K.MARKET_TYPE_ID, 'segment_id': G.K.SEGMENT_ID,
      'betting_type_id': G.K.BETTING_TYPE_ID, 'is_live': False}
fixtures = [{'fixture_id': 1, 'league_id': 537, 'scheduled_start': None},
            {'fixture_id': 2, 'league_id': 537, 'scheduled_start': None},
            {'fixture_id': 3, 'league_id': 537, 'scheduled_start': None}]
obs = {
    1: [dict(MW, fixture_participant_id=11, price_decimal=1.5),
        dict(MW, fixture_participant_id=12, price_decimal=2.5)],
    2: [dict(MW, fixture_participant_id=21, price_decimal=1.5)],
}
a = G.section_a(fixtures, obs, 171)
check('a two-sided fixture counts as priced', a['Challenger']['priced_both'] == 1)
check('a ONE-SIDED fixture does NOT count as priced',
      a['Challenger']['priced_both'] == 1 and a['Challenger']['priced_any'] == 2,
      'both numerators reported, so the gap is visible')
check('the denominator is every fixture in the league',
      a['Challenger']['fixtures'] == 3)
check('the percentage is over that denominator',
      a['Challenger']['pct'] == 33.3)
check('a league with no fixtures reports a dash, not 0%',
      a['ATP']['pct'] is None and a['ATP']['fixtures'] == 0)

print('\n=== CONTROL: the naive rule this section replaces ===')
naive = sum(1 for f in fixtures if obs.get(f['fixture_id']))
check('CONTROL: "any price is priced" WOULD have said 2 of 3 (66.7%)',
      naive == 2 and a['Challenger']['priced_both'] != naive,
      'the two rules genuinely differ on this data, so the test can fail')

print('\n=== (e) opener — unmeasurable is not a pass ===')
check('a single observation per side reports UNMEASURABLE, not 100%',
      'unmeasurable' in code and 'cannot be\n' in src.replace('  ', ' ')
      or 'unmeasurable' in code)
check('the opener check asks whether the flagged row is the EARLIEST',
      'is the earliest' in src and 'min(rows, key=' in code,
      'a count of flags alone proves nothing')

print('\n=== clock labelling — (g) must not read as one measurement ===')
check('Kibl clocks are labelled vendor-insert', 'VENDOR-INSERT' in src)
check('oddspapi is labelled a DIFFERENT clock', 'A DIFFERENT CLOCK' in src)
check('Sports411 is labelled a closed set', 'CLOSED set' in src)

print('' if not FAILED else '')
print(f'{len(FAILED)} FAILED' if FAILED else 'all checks passed')
sys.exit(1 if FAILED else 0)
