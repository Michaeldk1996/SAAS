#!/usr/bin/env python3
"""Harness for ten232-bet105-capability.py.

FOUNDER'S TEST STANDARD: "a check that passes on an empty set is not a check.
Manufacture the state and run the pre-fix build as a control."

The capability report is a document the founder will make a ladder ruling from.
Its whole value rests on one property: that it says `—` and names the gap when
it has nothing to measure, and NEVER prints a zero or an average that looks
like a finding. So this harness manufactures the empty states — no rows, no
book, no pairs, unreadable table — and asserts the refusal fires, by EXECUTING
the real functions rather than grepping the file for the word "dash".

It also asserts the script cannot write: this thing reads a partner's odds data
and a writer that crept in here would be discovered by its damage.
"""
import collections
import io
import json
import os
import re
import sys
import types
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'ten232-bet105-capability.py')
FAILED = []


def check(name, cond, detail=''):
    print(f'  {"ok    " if cond else "FAIL  "}{name}' + (f'   {detail}' if detail else ''))
    if not cond:
        FAILED.append(name)


# ── load the module without running main() ──────────────────────────────────
code = open(SRC, encoding='utf-8').read()
M = types.ModuleType('CAP')
M.__file__ = SRC
_argv, sys.argv = sys.argv, ['CAP']
exec(compile(code, SRC, 'exec'), M.__dict__)
sys.argv = _argv


print('— the script cannot write —')
# ⚠️ Strip docstrings AND comments before this check. The module docstring
# contains the words it is looking for, so a naive scan of the raw source
# reports a writer that does not exist — a false RED, which erodes the harness
# exactly as fast as a false green.
no_str = re.sub(r'("""(?:.|\n)*?"""|\'\'\'(?:.|\n)*?\'\'\')', '', code)
exec_code = re.sub(r'#.*', '', no_str)
for token in (r"'POST'", r'"POST"', r'upsert', r'DELETE', r'PATCH',
              r'os\.remove', r'open\([^)]*,\s*[\'"][wa]'):
    check(f'no /{token}/ in executable code',
          not re.search(token, exec_code), f'{len(re.findall(token, exec_code))} hit(s)')


print('\n— arithmetic: missing is a dash, never zero —')
check('implied(None) is None, not 0', M.implied(None) is None)
check('implied(0) is None — a zero price is not a 100% chance', M.implied(0) is None)
check('implied(2.0) == 50 points', abs(M.implied(2.0) - 50.0) < 1e-9)
check('num(None) renders the dash', M.num(None) == M.DASH)
check('pct(k, 0) renders the dash, not 0%', M.pct(3, 0) == M.DASH)
check('pct(0, 100) renders 0.0% — a real zero IS reported',
      M.pct(0, 100) == '0.0%')
check('dist([]) renders the dash and says n=0', M.DASH in M.dist([]))
check('n_flag flags below 30', '⚠️' in M.n_flag(29) and '⚠️' not in M.n_flag(30))


print('\n— overround —')
one = {'1': {'close_price': 2.0}, '2': {'close_price': 2.0}}
check('a fair two-sided book is 1.0', abs(M.overround(one, ['1', '2']) - 1.0) < 1e-9)
check('one side only returns None, not a half-overround',
      M.overround({'1': {'close_price': 2.0}}, ['1']) is None)
check('a null price returns None rather than skipping the side',
      M.overround({'1': {'close_price': None}, '2': {'close_price': 2.0}},
                  ['1', '2']) is None)


# ── the manufactured empty states ───────────────────────────────────────────
def run(fn, *a, **kw):
    buf = io.StringIO()
    with redirect_stdout(buf):
        out = fn(*a, **kw)
    return buf.getvalue(), out


def patch_fetch(rows_by_table, err=None):
    def fake(url, key, table, cols, extra='', page=1000, cap=400000):
        if err:
            return [], err
        return list(rows_by_table.get(table, [])), None
    M.fetch_all = fake


_real_fetch = M.fetch_all

print('\n— §accuracy refuses on an empty set rather than averaging one —')

patch_fetch({}, err='connection reset')
txt, out = run(M.section_accuracy, 'u', 'k', 10)
check('an unreadable table raises ::error:: and returns None',
      '::error::' in txt and out is None)
check('...and names the failure instead of printing a table',
      'nothing in this section is reported' in txt)

patch_fetch({'odds_card_state': []})
txt, out = run(M.section_accuracy, 'u', 'k', 10)
check('zero rows refuses and says the read found nothing',
      out is None and 'not a measurement of bet105' in txt)

# The one that matters most: rows exist, but NONE of them are bet105. Every
# count below would legitimately compute, and every one would be a zero that
# reads as "bet105 is bad" rather than "bet105 is absent".
patch_fetch({'odds_card_state': [
    {'match_key': 'k1', 'book': 'bet365', 'side': '1', 'market': 'match winner',
     'open_price': 2.0, 'close_price': 2.1},
    {'match_key': 'k1', 'book': 'bet365', 'side': '2', 'market': 'match winner',
     'open_price': 1.9, 'close_price': 1.8},
]})
txt, out = run(M.section_accuracy, 'u', 'k', 10)
check('rows present but NO bet105 row: refuses rather than printing zeros',
      out is None and 'No bet105 rows in odds_card_state' in txt)
check('...and says why the zeros were withheld',
      'average over an empty set' in txt)

print('\n— §accuracy reports the pairs it does have, and dashes the rest —')
rows = [
    # k1: both books close on both sides -> a worked example
    {'match_key': 'k1', 'book': 'bet105', 'side': '1', 'market': 'match winner',
     'open_price': 1.50, 'close_price': 1.60, 'open_ts': '2026-09-20T00:00:00Z',
     'close_ts': '2026-09-20T09:00:00Z', 'start_ts': '2026-09-20T10:00:00Z'},
    {'match_key': 'k1', 'book': 'bet105', 'side': '2', 'market': 'match winner',
     'open_price': 2.60, 'close_price': 2.40, 'open_ts': '2026-09-20T00:00:00Z',
     'close_ts': '2026-09-20T09:00:00Z', 'start_ts': '2026-09-20T10:00:00Z'},
    {'match_key': 'k1', 'book': 'bet365', 'side': '1', 'market': 'match winner',
     'open_price': 1.55, 'close_price': 1.57, 'close_ts': '2026-09-20T09:30:00Z'},
    {'match_key': 'k1', 'book': 'bet365', 'side': '2', 'market': 'match winner',
     'open_price': 2.50, 'close_price': 2.45, 'close_ts': '2026-09-20T09:30:00Z'},
    # k2: bet105 only -> must NOT contribute a gap of 0
    {'match_key': 'k2', 'book': 'bet105', 'side': '1', 'market': 'match winner',
     'open_price': 1.10, 'close_price': 1.10},
    {'match_key': 'k2', 'book': 'bet105', 'side': '2', 'market': 'match winner',
     'open_price': 7.00, 'close_price': 7.00},
]
patch_fetch({'odds_card_state': rows})
txt, out = run(M.section_accuracy, 'u', 'k', 10)
check('a fixture priced by one book only contributes no Δ',
      'n=2 ' in txt or 'n=2\n' in txt or 'n=2)' in txt,
      'the Δ population is the 2 paired sides, not all 4 bet105 sides')
check('the unpaired fixture is still counted in the bet105 close total',
      '**4**' in txt or '4**' in txt)
check('the move-rate verdict is printed', 'a sharp book should move more' in txt)
check('the vendor-insert caveat rides with the move-rate verdict',
      'VENDOR-INSERT' in txt and 'biased AGAINST bet105' in txt)

print('\n— the REFEREE is checked too: an impossible bet365 close is named —')
ref = [
    {'match_key': 'r1', 'book': 'bet105', 'side': '1', 'market': 'match winner',
     'open_price': 1.50, 'close_price': 1.60},
    {'match_key': 'r1', 'book': 'bet105', 'side': '2', 'market': 'match winner',
     'open_price': 2.60, 'close_price': 2.40},
    # bet365 closing at 1.00 pays nothing. Its implied probability is 100 pts,
    # so it drags the median gap up while looking like a bet105 problem.
    {'match_key': 'r1', 'book': 'bet365', 'side': '1', 'market': 'match winner',
     'close_price': 1.00},
    {'match_key': 'r1', 'book': 'bet365', 'side': '2', 'market': 'match winner',
     'close_price': 1.00},
    {'match_key': 'r2', 'book': 'bet105', 'side': '1', 'market': 'match winner',
     'close_price': 1.60},
    {'match_key': 'r2', 'book': 'bet365', 'side': '1', 'market': 'match winner',
     'close_price': 1.62},
]
patch_fetch({'odds_card_state': ref})
txt, _ = run(M.section_accuracy, 'u', 'k', 10)
check('an impossible bet365 close is named as a REFEREE defect',
      'defect in the REFEREE' in txt and 'r1' in txt)
check('the median is reported both with and without it',
      'Excluding them the median is' in txt)
patch_fetch({'odds_card_state': rows})
clean_txt, _ = run(M.section_accuracy, 'u', 'k', 10)
check('CONTROL: a clean referee produces no such warning',
      'defect in the REFEREE' not in clean_txt)
check('...and the median is still reported on the clean set',
      'median |Δ implied|' in clean_txt)

print('\n— §accuracy (d) names a wrong close rather than averaging it —')
bad = list(rows) + [
    {'match_key': 'k3', 'book': 'bet105', 'side': '1', 'market': 'match winner',
     'close_price': 1.00, 'close_ts': '2026-09-01T00:00:00Z',
     'start_ts': '2026-09-20T10:00:00Z'},
    {'match_key': 'k3', 'book': 'bet105', 'side': '2', 'market': 'match winner',
     'close_price': 1.01, 'close_ts': '2026-09-01T00:00:00Z',
     'start_ts': '2026-09-20T10:00:00Z'},
    # k4 is a SEPARATE defect and needs its own fixture: 1/2.5 + 1/3.0 = 0.733,
    # a book paying out more than it takes in. The k3 pair above reads as the
    # opposite defect (1/1.00 + 1/1.01 = 1.99, a 99% margin), which is why
    # asserting both on one fixture would have been asserting neither.
    {'match_key': 'k4', 'book': 'bet105', 'side': '1', 'market': 'match winner',
     'close_price': 2.50, 'close_ts': '2026-09-20T09:00:00Z',
     'start_ts': '2026-09-20T10:00:00Z'},
    {'match_key': 'k4', 'book': 'bet105', 'side': '2', 'market': 'match winner',
     'close_price': 3.00, 'close_ts': '2026-09-20T09:00:00Z',
     'start_ts': '2026-09-20T10:00:00Z'},
]
patch_fetch({'odds_card_state': bad})
txt, out = run(M.section_accuracy, 'u', 'k', 10)
check('an impossible price (1.00) is named with its match_key',
      'k3' in txt and 'impossible' in txt)
check('a sub-1.00 overround is named too, on its own fixture',
      'overround < 1.00' in txt and 'k4' in txt)
check('...and the opposite defect is filed separately, not merged with it',
      'overround > 1.50' in txt)
check('a close captured >24h before the start is named as stale',
      'stale' in txt)

# CONTROL: the same tests must NOT fire on clean data, or "named" means nothing.
patch_fetch({'odds_card_state': rows})
txt, out = run(M.section_accuracy, 'u', 'k', 10)
check('CONTROL: clean data trips none of the four tests',
      'No bet105 close trips any of the four tests' in txt)
check('...and the tests are still listed, so the absence is readable',
      'two-sided overround < 1.00' in txt)


print('\n— §markets: an empty archive is not a book with no markets —')
patch_fetch({'kibl_line_observations': [], 'kibl_fixtures': []})
txt, (o, n) = run(M.section_markets, 'u', 'k', None)
check('zero archived rows refuses', o is None and 'zero archived bet105 rows' in txt)

print('\n— §live: zero live rows is reported as OUR SCOPE, not the book —')
txt, _ = run(M.section_live, [{'betting_type_id': 1, 'is_live': False,
                               'fixture_id': 1}], ({}, {}, {}))
check('says no live rows', 'No live rows at all' in txt)
check('names our pre-match-only scope as part of the reason',
      'PRE-MATCH only' in txt)
check('refuses to conclude the book has no in-play', 'unknown' in txt)
check('cadence is a dash, not 0', 'Cadence cannot be measured from zero rows' in txt)

print('\n— §stream is labelled as unmeasured —')
txt, _ = run(M.section_stream, {})
check('the docs-not-measured banner is present',
      'READ OFF THE DOCUMENTATION, NOT MEASURED' in txt)
check('the durable-queue question is raised as the key one',
      'durable' in txt and 'unknown' in txt)
check('the measured floor dashes when there is no card state',
      M.DASH in txt)

print('\n— §limits confirms both standing limits —')
txt, _ = run(M.section_limits, [{'inserted_on': 'x'}], {})
check('no history endpoint is confirmed', 'No history endpoint' in txt)
check('kibl insert time is confirmed', 'Kibl insert time' in txt)
check('the silent-entitlement caveat is stated',
      'HTTP 200 with rows missing' in txt)

M.fetch_all = _real_fetch

print()
print(f'{len(FAILED)} assertion(s) failed.' if FAILED else '0 assertion(s) failed.')
if FAILED:
    for f in FAILED:
        print(f'  ::error::{f}')
raise SystemExit(1 if FAILED else 0)
