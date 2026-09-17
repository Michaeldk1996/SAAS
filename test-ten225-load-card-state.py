#!/usr/bin/env python3
"""TEN-225 Part 2 — offline harness for ten225-load-card-state.py.

No network, no Supabase. Runs as a fail-closed gate BEFORE the filler touches
the instance, so a wrong Now rule fails the job instead of putting a settled
in-play price on a card.

WHAT IS LOCKED HERE
-------------------
Two decisions, both of which reach a rendered surface if they are wrong:

  * THE NOW RULE. A stored tick may be rendered as "Now" only when it can be
    shown pre-match. The failure mode is specific and ugly: a finished fixture's
    freshest tick is a SETTLED price (1.02 on the winner), and promoting it puts
    a post-match number on a live card.
  * FALLBACK ELIGIBILITY. api-tennis is used ONLY where oddspapi has nothing at
    all for that match, and only for a bet365 open with a real first-sighting
    timestamp. Every other case dashes rather than blending books.

MUTATION CONTROL — verified to fail. Six mutations were run and all six caught:
Now rule always-true, Now rule dropping the not-started limb, `>` weakened to
`>=` on the schedule test, fallback ignoring `covered`, fallback accepting a
non-bet365 book, and fallback accepting an open with no timestamp. Re-run that
control after editing either file (with `python3 -B`).
"""
import os
import sys
import types
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
# STALE-BYTECODE GUARD — see the note in test-ten225-load-line-summary.py. macOS
# caches .pyc outside the repo keyed on (mtime, size); a same-size restore inside
# one second serves the MUTANT's bytecode and the harness reports a FALSE PASS.
sys.dont_write_bytecode = True
C = types.ModuleType('C')
C.__file__ = os.path.join(HERE, 'ten225-load-card-state.py')
sys.argv = ['C']
exec(compile(open(C.__file__).read(), C.__file__, 'exec'), C.__dict__)

FAILED = []


def check(name, cond, detail=''):
    if cond:
        print(f'  ok   {name}')
    else:
        print(f'  FAIL {name} {detail}')
        FAILED.append(name)


HOUR = 3600.0
NOW = datetime(2026, 9, 17, 12, 0, tzinfo=timezone.utc).timestamp()


# ------------------------------------------------------------- the Now rule
print('qualifies_as_now — Michael\'s Now definition')

ok, basis = C.qualifies_as_now(True, None, NOW)
check('a tick the archive PROVED pre-start qualifies', ok is True)
check('...and reports the strong basis', basis == 'prestart-tick', basis)

# The trap. A finished fixture: the archive resolved a start and the freshest
# tick is AFTER it, i.e. a settled in-play price.
ok2, basis2 = C.qualifies_as_now(False, NOW - 6 * HOUR, NOW)
check('a FINISHED fixture\'s settled tick does NOT qualify — this is the '
      'assertion that keeps a post-match 1.02 off a live card', ok2 is False)
check('...and carries no basis', basis2 is None)

# An upcoming fixture: no resolved start yet, so the flag is NULL, but the
# fixture is in the future and every tick we hold is necessarily pre-match.
ok3, basis3 = C.qualifies_as_now(None, NOW + 3 * HOUR, NOW)
check('an UPCOMING fixture qualifies on the not-started limb', ok3 is True)
check('...and reports which limb justified it',
      basis3 == 'fixture-not-started', basis3)

# Direction matters, and the margin is safe in one direction only.
check('a fixture scheduled one second in the PAST does not qualify',
      C.qualifies_as_now(None, NOW - 1, NOW)[0] is False)
check('a fixture scheduled EXACTLY now does not qualify (strict >)',
      C.qualifies_as_now(None, NOW, NOW)[0] is False)
check('a fixture scheduled one second in the future does',
      C.qualifies_as_now(None, NOW + 1, NOW)[0] is True)

# Unknowable -> dash. Never zero, never the open.
check('no flag and no schedule -> does NOT qualify',
      C.qualifies_as_now(None, None, NOW)[0] is False)
check('flag false and no schedule -> does NOT qualify',
      C.qualifies_as_now(False, None, NOW)[0] is False)
# The strong test outranks a stale schedule rather than being overridden by it.
check('a proven pre-start tick qualifies even on a past-scheduled fixture',
      C.qualifies_as_now(True, NOW - 6 * HOUR, NOW)[0] is True)


# ---------------------------------------------------------------- card_rows
print('\ncard_rows — projection, and the Now it is allowed to carry')


def srow(**kw):
    base = {'fixture_id': 'idA', 'book': 'bet365', 'market': 'match winner',
            'side': '1', 'line': None, 'open_price': 1.5,
            'open_ts': '2026-09-17T08:00:00Z', 'close_price': 1.44,
            'close_ts': '2026-09-17T11:00:00Z', 'start_ts': None,
            'start_ts_source': 'oddspapi', 'start_reject_reason': None,
            'last_tick_price': 1.02, 'last_tick_ts': '2026-09-17T13:00:00Z',
            'last_tick_is_prestart': False, 'close_reliable': True}
    base.update(kw)
    return base


fin, st = C.card_rows([srow()], {}, NOW)
check('one summary row -> one card row', len(fin) == 1)
check('a finished fixture\'s card carries NO Now',
      fin[0]['now_price'] is None and fin[0]['now_ts'] is None)
check('...and the withholding is COUNTED, not silent',
      st['now_withheld_not_prematch'] == 1, dict(st))
check('Open survives the Now being withheld', fin[0]['open_price'] == 1.5)
check('Close survives it too', fin[0]['close_price'] == 1.44)
check('the row is stamped source=oddspapi with no fallback label',
      fin[0]['source'] == 'oddspapi' and fin[0]['label'] is None)
check('id_space is recorded, not inferred from the id string',
      fin[0]['id_space'] == 'oddspapi')
check('match winner carries a NULL line, never the catalogue 0.0',
      fin[0]['line'] is None)

up, ust = C.card_rows(
    [srow(last_tick_is_prestart=None, close_price=None, close_ts=None)],
    {'idA': {'start_sched': C.iso(NOW + 3 * HOUR)}}, NOW)
check('an upcoming fixture DOES carry a Now', up[0]['now_price'] == 1.02)
check('...stamped with the tick\'s own timestamp',
      up[0]['now_ts'] == '2026-09-17T13:00:00Z')
check('...and the basis is reported for the Part 4 trace',
      up[0]['now_basis'] == 'fixture-not-started')
check('an upcoming fixture with no reliable close dashes the close',
      up[0]['close_price'] is None)

# A non-match-winner row must never reach this table in this step.
_, sst = C.card_rows([srow(market='total games')], {}, NOW)
check('a non-match-winner summary row is skipped and counted',
      sst['not_match_winner'] == 1 and sst['rows'] == 0)


# ------------------------------------------------------------ fallback_rows
print('\nfallback_rows — api-tennis ONLY where oddspapi has nothing')


def mrow(**kw):
    m = {'id': 'evt1', 'openingOdds': {'p1': 7, 'p2': 1.08,
                                       'bookmaker': 'bet365',
                                       'seenAt': '2026-09-16T19:00:30Z'}}
    m.update(kw)
    return m


fb, fst = C.fallback_rows([mrow()], set(), NOW)
check('an uncovered match yields two sides', len(fb) == 2)
check('both are stamped source=api-tennis', all(r['source'] == 'api-tennis' for r in fb))
check('both carry the ruled "last seen" label',
      all(r['label'] == 'last seen' for r in fb))
check('the Open is the first sighting, with its timestamp',
      fb[0]['open_price'] == 7.0 and fb[0]['open_ts'] == '2026-09-16T19:00:30Z')
check('id_space marks these as api-tennis event keys',
      all(r['id_space'] == 'api-tennis' for r in fb))
check('the fallback claims NO close (it has no start to cut at)',
      all(r['close_price'] is None for r in fb))
check('the fallback claims NO now (matches.json `odds` may be another book)',
      all(r['now_price'] is None for r in fb))
check('sides are 1 and 2', sorted(r['side'] for r in fb) == ['1', '2'])

# Eligibility: covered means covered, however thin the oddspapi row.
cov, cst = C.fallback_rows([mrow()], {'evt1'}, NOW)
check('a match oddspapi already covers is NOT given a fallback row',
      cov == [] and cst['oddspapi_covered'] == 1)

# Never a price from another book.
wb, wst = C.fallback_rows(
    [mrow(openingOdds={'p1': 7, 'p2': 1.08, 'bookmaker': '1xBet',
                       'seenAt': '2026-09-16T19:00:30Z'})], set(), NOW)
check('a non-bet365 open is REFUSED, not relabelled',
      wb == [] and wst['open_wrong_book'] == 1)

# A price with no timestamp is unrenderable — the design shows Open WITH its time.
nt, ntst = C.fallback_rows(
    [mrow(openingOdds={'p1': 7, 'p2': 1.08, 'bookmaker': 'bet365'})], set(), NOW)
check('an open with no sighting timestamp is refused',
      nt == [] and ntst['open_no_timestamp'] == 1)

# One side missing must not fabricate the other side's price.
os_, osst = C.fallback_rows(
    [mrow(openingOdds={'p1': 7, 'p2': None, 'bookmaker': 'bet365',
                       'seenAt': '2026-09-16T19:00:30Z'})], set(), NOW)
check('a one-sided open yields ONE row, never a mirrored second',
      len(os_) == 1 and osst['open_side_missing'] == 1)

print('\n' + ('all checks passed' if not FAILED
              else f'{len(FAILED)} FAILURE(S): {FAILED}'))
sys.exit(1 if FAILED else 0)
