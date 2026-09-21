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

print('\n— a 0.000 close is a suspension marker, not a price, and not a MOVE —')
# The real shape: both sides zero, seconds before the start, with a real open.
# Counted as a price, `open != close` is true and the book scores as having
# moved — which is how the first run of this report read 98.5%.
susp = [
    {'match_key': 'z1', 'book': 'bet105', 'side': '1', 'market': 'match winner',
     'open_price': 1.50, 'close_price': 0.0, 'close_ts': '2026-09-20T20:44:16Z',
     'start_ts': '2026-09-20T20:45:05Z'},
    {'match_key': 'z1', 'book': 'bet105', 'side': '2', 'market': 'match winner',
     'open_price': 2.60, 'close_price': 0.0, 'close_ts': '2026-09-20T20:44:16Z',
     'start_ts': '2026-09-20T20:45:05Z'},
    # one genuinely unmoved fixture, so "moved" has something to be 0 against
    {'match_key': 'z2', 'book': 'bet105', 'side': '1', 'market': 'match winner',
     'open_price': 1.50, 'close_price': 1.50},
    {'match_key': 'z2', 'book': 'bet105', 'side': '2', 'market': 'match winner',
     'open_price': 2.60, 'close_price': 2.60},
]
patch_fetch({'odds_card_state': susp})
txt, _ = run(M.section_accuracy, 'u', 'k', 10)
check('the zeros are named as a suspension marker, with their share',
      'suspension marker' in txt and '0.000' in txt)
check('the move rate EXCLUDES them — 0 of 2, not 2 of 4',
      'moved on 0 of 2 sides (0.0%)' in txt,
      'a zeroed close must not score as the book moving')
check('the close count excludes them too',
      'bet105 rows carrying a close: **2**' in txt)
check('it says explicitly that (b) and (c) were computed with them absent',
      'computed with these rows treated as ABSENT' in txt)
check('it states the board is unaffected rather than implying a live defect',
      'no `0.00` has ever been published' in txt)

# CONTROL: without zeros, no suspension section and the real move IS counted.
patch_fetch({'odds_card_state': [
    {'match_key': 'z3', 'book': 'bet105', 'side': '1', 'market': 'match winner',
     'open_price': 1.50, 'close_price': 1.60},
    {'match_key': 'z3', 'book': 'bet105', 'side': '2', 'market': 'match winner',
     'open_price': 2.60, 'close_price': 2.40},
]})
ctl, _ = run(M.section_accuracy, 'u', 'k', 10)
check('CONTROL: clean data prints no suspension section',
      'suspension marker' not in ctl)
check('CONTROL: a real move is still counted as a move',
      'moved on 2 of 2 sides (100.0%)' in ctl)

check('normalise_prices reports what it dropped rather than dropping silently',
      M.normalise_prices([{'book': 'b', 'close_price': 0.0}])[1]
      == {('b', 'close_price'): 1})
check('...and leaves a real price alone',
      M.normalise_prices([{'book': 'b', 'close_price': 1.5}])[0][0]['close_price'] == 1.5)

print('\n— the overlap census runs BEFORE the examples, and substitution is flagged —')
# Real shape of the data on 2026-09-21: bet105 prices Challenger, the bet365
# series we hold prices ATP/Davis Cup, and the two share NOTHING. "No worked
# examples" must therefore read as a finding about coverage, not as an empty
# table the reader has to interpret.
disjoint = [
    {'match_key': 'c1', 'book': 'bet105', 'side': '1', 'market': 'match winner',
     'open_price': 1.5, 'close_price': 1.6},
    {'match_key': 'c1', 'book': 'bet105', 'side': '2', 'market': 'match winner',
     'open_price': 2.6, 'close_price': 2.4},
    {'match_key': 'c2', 'book': 'bet365', 'side': '1', 'market': 'match winner',
     'close_price': 1.9},
    {'match_key': 'c2', 'book': 'bet365', 'side': '2', 'market': 'match winner',
     'close_price': 1.9},
]
patch_fetch({'odds_card_state': disjoint})
txt, _ = run(M.section_accuracy, 'u', 'k', 10)
check('zero bet105/bet365 overlap is named as the finding it is',
      'do not price a single fixture in common' in txt)
check('...and says the validation cannot be made rather than showing a zero',
      'cannot be validated against bet365 on price' in txt)
check('the census is printed before the example result, so the reader meets '
      'the cause before the empty answer',
      'overlap census' in txt
      and txt.index('overlap census') < txt.index('No fixture carries a bet105 close'))
check('with nothing to pair at all, it names what would fix it',
      'api-tennis' in txt and 'oddspapi archive to the Challenger tier' in txt)

# Now give it a leg that is NOT the one the directive named.
sub = [
    {'match_key': 'c1', 'book': 'bet105', 'side': '1', 'market': 'match winner',
     'open_price': 1.5, 'close_price': 1.6},
    {'match_key': 'c1', 'book': 'bet105', 'side': '2', 'market': 'match winner',
     'open_price': 2.6, 'close_price': 2.4},
    {'match_key': 'c1', 'book': 'api-tennis', 'side': '1', 'market': 'match winner',
     'close_price': 1.62},
    {'match_key': 'c1', 'book': 'api-tennis', 'side': '2', 'market': 'match winner',
     'close_price': 2.38},
]
patch_fetch({'odds_card_state': sub})
txt, _ = run(M.section_accuracy, 'u', 'k', 10)
check('a substitute leg IS used rather than reporting nothing',
      'api-tennis` and' in txt or "`api-tennis`" in txt)
check('...and the substitution is FLAGGED, not done quietly',
      'not bet365' in txt and 'flagged rather than done quietly' in txt)
check('the aggregate names the substitute book on the figure',
      'median |Δ implied| against the api-tennis close' in txt)

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


print('\n— §markets: "Total" must not swallow "Team Total" —')


class FakeKibl:
    """The real reference vocabulary, so the exact tests are tested against the
    spellings the feed actually uses rather than the ones I hoped for."""
    calls = 0
    bytes_down = 0

    REF = {
        '/reference/market-types': [
            {'market_type_id': 1, 'name': 'Moneyline'},
            {'market_type_id': 2, 'name': 'Spread'},
            {'market_type_id': 3, 'name': 'Total'},
            {'market_type_id': 4, 'name': 'Team Total'},
        ],
        '/reference/segments': [
            {'segment_id': 1, 'name': 'Full Game'},
            {'segment_id': 2, 'name': 'Sets'},
            {'segment_id': 3, 'name': 'First Set'},
        ],
        '/reference/betting-types': [
            {'betting_type_id': 1, 'name': 'Prematch'},
            {'betting_type_id': 3, 'name': 'Live Fluid'},
        ],
    }

    def get(self, path, params=None):
        return {'data': self.REF.get(path, [])}, {'status': 200}

    @staticmethod
    def rows(payload):
        return (payload or {}).get('data', [])


def obs_row(mt_id, seg_id, fid, **kw):
    r = {'fixture_id': fid, 'league_id': 537, 'market_type_id': mt_id,
         'segment_id': seg_id, 'betting_type_id': 1, 'alt_id': None,
         'is_main': True, 'price_decimal': 1.9, 'side_id': 2,
         'point': None, 'is_opener': False, 'is_previous': False,
         'is_current': True, 'is_live': False, 'inserted_on': '2026-09-20T00:00:00Z'}
    r.update(kw)
    return r


mk_obs = ([obs_row(3, 1, 100 + i) for i in range(11)]        # Total × Full Game
          + [obs_row(4, 1, 200 + i) for i in range(13)]      # Team Total × Full Game
          + [obs_row(2, 2, 300 + i) for i in range(4)]       # Spread × Sets
          + [obs_row(3, 2, 400 + i) for i in range(2)])      # Total × Sets
patch_fetch({'kibl_line_observations': mk_obs,
             'kibl_fixtures': [{'fixture_id': r['fixture_id'], 'league_id': 537,
                                'scheduled_start': '2026-09-20T10:00:00Z'}
                               for r in mk_obs]})
txt, (o, names) = run(M.section_markets, 'u', 'k', FakeKibl())
check('"total games" counts ONLY Total × Full Game, not Team Total',
      '| total games (Total × Full Game) | YES | 11 |' in txt,
      'expected 11, not 24')
check('Team Total is reported as its own, DIFFERENT market',
      'Team Total × Full Game (games won by one player) | YES | 13 |' in txt)
check('SET HANDICAP is Spread × Sets exactly', 'SET HANDICAP** (Spread × Sets) | YES | 4 |' in txt)
check('TOTAL SETS is Total × Sets exactly', 'TOTAL SETS** (Total × Sets) | YES | 2 |' in txt)
check('every row is accounted for, so nothing hides behind a spelling',
      'Every one of the 30 archived rows is accounted for' in txt)

# CONTROL: a vocabulary this report does not know must be LOUD, not silent.
class OddSpelling(FakeKibl):
    REF = dict(FakeKibl.REF,
               **{'/reference/market-types': [{'market_type_id': 3,
                                               'name': 'Money Line'}]})


patch_fetch({'kibl_line_observations': [obs_row(3, 1, 500)],
             'kibl_fixtures': [{'fixture_id': 500, 'league_id': 537}]})
txt2, _ = run(M.section_markets, 'u', 'k', OddSpelling())
check('CONTROL: an unrecognised market spelling is named, not reported as "no"',
      'not covered by any row of the table above' in txt2 and 'Money Line' in txt2)

print('\n— §markets: an empty archive is not a book with no markets —')
patch_fetch({'kibl_line_observations': [], 'kibl_fixtures': []})
txt, (o, n) = run(M.section_markets, 'u', 'k', None)
check('zero archived rows refuses', o is None and 'zero archived bet105 rows' in txt)

print('\n— §rows: raw_object is a PATH; an unread blob concludes NOTHING —')
# The defect this replaces: the first cut iterated the raw_object STRING as if
# it were the vendor record, found no keys, printed an empty table, and then
# concluded "no field is named for a stake limit". A definitive negative drawn
# from a read that never happened.
_real_blob = M.kibl_blob
M.kibl_blob = lambda url, key, path: (None, 'storage 404')
patch_fetch({'kibl_line_observations': [
    {'raw_object': '2026/09/20/sweep-abc.json.gz', 'observed_at': 'x'}]})
txt, _ = run(M.section_rows, 'u', 'k', None)
check('an unreadable blob says so and reports nothing',
      'could not be read' in txt)
check('...and REFUSES to conclude the stake limit is absent',
      'nothing below claims the stake limit is absent' in txt)
check('...naming the difference between unread and missing',
      'an unread field and a missing field' in txt)
check('no empty field table is printed as if it were a census',
      '| field | present on |' not in txt or '— not read.' in txt)

# Now a blob that DOES download: the census must come from the vendor record.
BLOB = [
    {'feed_source_id': 171, 'price_decimal': 1.9, 'is_opener': True,
     'league_id': 537, 'point': None, 'alt_id': 0},
    {'feed_source_id': 171, 'price_decimal': 2.1, 'is_opener': False,
     'league_id': 537, 'point': -1.5, 'alt_id': 1},
    {'feed_source_id': 43, 'price_decimal': 3.0, 'is_opener': True,
     'league_id': 537, 'point': None, 'alt_id': 0},
]
M.kibl_blob = lambda url, key, path: (BLOB, None)
txt, _ = run(M.section_rows, 'u', 'k', None)
check('the census counts only THIS book\'s records out of the shared blob',
      'Census population: **2**' in txt, 'the blob holds 3; one is Sports411')
check('a field null on some rows reports a real percentage',
      '| `point` | 2 | 1 | 50.0% |' in txt)
check('the no-limit-field conclusion is now drawn from records actually read',
      'across all 2 records read' in txt)
check('...and invites the reader to check it against the key list',
      'can be verified rather than taken' in txt)
M.kibl_blob = _real_blob

print('\n— §live: zero live rows is reported as OUR SCOPE, not the book —')
txt, _ = run(M.section_live, [{'betting_type_id': 1, 'is_live': False,
                               'fixture_id': 1}], ({}, {}, {}))
check('says no live rows', 'No live rows at all' in txt)
check('names our pre-match-only scope as part of the reason',
      'PRE-MATCH only' in txt)
check('refuses to conclude the book has no in-play', 'unknown' in txt)
check('cadence is a dash, not 0', 'Cadence cannot be measured from zero rows' in txt)

print('\n— §endpoints: a 200 error envelope is a REASON, not an empty account —')


class ErrEnvelope:
    """Kibl answers a malformed call with HTTP 200 and {code, description}.
    Reported as "200/empty" that reads as "no data for us", which is a
    different and much more expensive conclusion."""
    calls = 0
    bytes_down = 0

    def get(self, path, params=None):
        if path == '/reference/sports':
            return {'data': [{'sport_id': 7, 'name': 'Tennis'}]}, {'status': 200}
        if path.startswith('/mapping/'):
            return ({'code': 'MISSING_PARAM',
                     'description': 'league_id is required',
                     'request_uuid': 'x', 'timestamp': 'y'}, {'status': 200})
        return {'data': [{'a': 1}]}, {'status': 200}

    @staticmethod
    def rows(payload):
        return (payload or {}).get('data', []) if isinstance(payload, dict) else []


txt, res = run(M.section_endpoints, ErrEnvelope())
check('the tennis sport_id is RESOLVED, not assumed', 'resolved from' in txt and '**7**' in txt)
check("the vendor's own reason is printed", 'league_id is required' in txt)
check('...and it is not turned into a capability verdict',
      'NOT the same as "we hold no mapping data"' in txt)
check('the verdict is unknown rather than unavailable',
      'honest verdict is **unknown**, not "unavailable"' in txt)
check('vendor_error reads the error envelope',
      M.vendor_error({'code': 'X', 'description': 'why'}) == 'X: why')
check('vendor_error returns None for a real payload, so it cannot cry wolf',
      M.vendor_error({'data': [1]}) is None)

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
