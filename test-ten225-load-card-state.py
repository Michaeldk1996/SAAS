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
print("qualifies_as_now — Michael's Now definition")

# A fixture that has NOT started: the only shape that earns a Now.
ok, basis = C.qualifies_as_now(None, NOW + 3 * HOUR, NOW)
check('an upcoming fixture qualifies', ok is True)
check('...and reports the basis', basis == 'fixture-not-started', basis)

# THE TRAP, stated as its own assertion. A fixture with a resolved start has
# begun, so the freshest pre-start price we hold is its CLOSE. The first version
# of this rule promoted exactly this case and reported "Now 92.0%" on run
# 35214569618 — 26,277 rows of relabelled closing prices.
started = NOW - 6 * HOUR
ok2, basis2 = C.qualifies_as_now(started, started, NOW)
check('a STARTED fixture does NOT qualify — this is the assertion that keeps a '
      'three-month-old close off a card labelled "Now"', ok2 is False)
check('...and carries no basis', basis2 is None)
check('a fixture that started ONE SECOND ago already does not qualify',
      C.qualifies_as_now(NOW - 1, NOW - 1, NOW)[0] is False)
check('a resolved start OUTRANKS a future schedule (a delayed fixture that has '
      'actually begun has no Now)',
      C.qualifies_as_now(NOW - HOUR, NOW + HOUR, NOW)[0] is False)

# Direction and margin on the schedule test.
check('scheduled one second in the PAST does not qualify',
      C.qualifies_as_now(None, NOW - 1, NOW)[0] is False)
check('scheduled EXACTLY now does not qualify (strict >)',
      C.qualifies_as_now(None, NOW, NOW)[0] is False)
check('scheduled one second in the future does',
      C.qualifies_as_now(None, NOW + 1, NOW)[0] is True)

# Unknowable -> dash. Never zero, never the open, never the close.
check('no start and no schedule -> does NOT qualify',
      C.qualifies_as_now(None, None, NOW)[0] is False)

# ---------------------------------------------------------------- card_rows
print('\ncard_rows — projection, and the Now it is allowed to carry')


def srow(**kw):
    base = {'fixture_id': 'idA', 'book': 'bet365', 'market': 'match winner',
            'side': '1', 'line': None, 'open_price': 1.5,
            'open_ts': '2026-09-17T08:00:00Z', 'close_price': 1.44,
            'close_ts': '2026-09-17T11:00:00Z',
            'start_ts': '2026-09-17T11:30:00Z',
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
    [srow(start_ts=None, last_tick_is_prestart=None,
          close_price=None, close_ts=None)],
    {'idA': {'scheduled_start': C.iso(NOW + 3 * HOUR)}}, NOW)
check('an upcoming fixture DOES carry a Now', up[0]['now_price'] == 1.02)
check('...stamped with the tick\'s own timestamp',
      up[0]['now_ts'] == '2026-09-17T13:00:00Z')
check('...and the basis is reported for the Part 4 trace',
      up[0]['now_basis'] == 'fixture-not-started')
check('an upcoming fixture with no reliable close dashes the close',
      up[0]['close_price'] is None)

# A non-match-winner row must never reach this table in this step.
_, sst = C.card_rows([srow(market='total games')], {}, NOW)

# TEN-253 ruling 2 — the within-60 flag and the OLDER close (founder 2026-09-23)
check('a summary close (only ever written when reliable) is flagged within-60',
      fin[0]['close_within_60'] is True, fin[0].get('close_within_60'))
_o, _ost = C.card_rows([srow(close_price=None, close_ts=None, close_reliable=False,
                             last_tick_price=1.52, last_tick_ts='2026-09-17T09:00:00Z',
                             last_tick_is_prestart=True)], {}, NOW)
check('a nulled close with a PROVEN pre-start last tick shows that tick as an OLDER close',
      _o[0]['close_price'] == 1.52 and _o[0]['close_ts'] == '2026-09-17T09:00:00Z', _o[0])
check('...flagged close_within_60 = FALSE, so no number is computed from it',
      _o[0]['close_within_60'] is False)
_n, _ = C.card_rows([srow(close_price=None, close_ts=None, close_reliable=False,
                          last_tick_is_prestart=False)], {}, NOW)
check('a last tick NOT proven pre-start is never shown as a close (in-play is not a close)',
      _n[0]['close_price'] is None and _n[0]['close_within_60'] is None)
_z, _ = C.card_rows([srow(close_price=None, close_ts=None, close_reliable=False,
                          last_tick_price=0.0, last_tick_is_prestart=True)], {}, NOW)
check('a 0.000 last tick is not a price, so no older close',
      _z[0]['close_price'] is None)
_ns, _ = C.card_rows([srow(close_price=None, close_ts=None, close_reliable=False,
                           start_ts=None, last_tick_is_prestart=True)], {}, NOW)
check('no resolved start -> no older close (a close needs its start)',
      _ns[0]['close_price'] is None)
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


# ------------------------------------- the column names the filler ASKS FOR
# An earlier draft of the filler selected `level,start_sched` from
# oddspapi_fixtures. The real columns are `category_name` and `scheduled_start`,
# so PostgREST would have 400'd — and the filler's error path was fail-SOFT, so
# it would have run with an empty fixture map, silently disabling the
# not-started limb of the Now rule. Every upcoming match would have dashed its
# Now on a green run. A surface that is wholly empty for a structural reason is
# the failure mode that hides longest, which is why the path is now fail-loud
# AND why the names are checked against the DDL rather than against memory.
print('\ncolumn names — filler select vs the DDL')

import re as _re
_ddl = open(os.path.join(HERE, 'ten225-line-summary-schema.sql')).read()
_m = _re.search(r'CREATE TABLE IF NOT EXISTS oddspapi_fixtures\s*\((.*?)\n\);',
                _ddl, _re.S)
# DIGITS BELONG IN A COLUMN NAME. `[a-z_]+` silently omitted player1/player2
# from the DDL's column set, so this guard would have reported a filler asking
# for two real columns as asking for two that do not exist — a guard that is
# wrong in the FAIL direction gets edited away the first time it fires.
_cols = set(_re.findall(r'^\s{2}([a-z_0-9]+)\s+\w', _m.group(1), _re.M)) if _m else set()
_src = open(os.path.join(HERE, 'ten225-load-card-state.py')).read()
# The select is written as adjacent string literals across lines, so the
# fragments are joined before splitting. A regex that only matched a SINGLE
# literal read the first fragment plus a trailing empty token and failed this
# check on a correct filler — a guard that goes red for a formatting change
# teaches people to edit the guard.
_sel = _re.search(r"'oddspapi_fixtures',\s*((?:\s*'[a-z_0-9,]+')+)\)", _src)
_asked = set(''.join(_re.findall(r"'([a-z_0-9,]*)'", _sel.group(1) if _sel else ''))
             .split(','))

check('the DDL for oddspapi_fixtures was found', bool(_cols), f'cols={sorted(_cols)}')
check('the filler asks for columns that exist', _asked and _asked <= _cols,
      f'asked={sorted(_asked)} missing={sorted(_asked - _cols)}')
check('it asks for scheduled_start specifically (the not-started Now limb '
      'reads it, and a rename here silently empties every upcoming Now)',
      'scheduled_start' in _asked)
# And the field card_rows() actually reads must be one of them.
# Matched on the CALL, not on the word: the filler's comment names the old
# alias on purpose, to say why it is gone.
check('card_rows reads scheduled_start, not an index-side alias',
      "fx.get('scheduled_start')" in _src
      and "get('start_sched')" not in _src
      and "get('startSched')" not in _src)

# --------------------------------- TEN-225 ruling 4a: takeover candidates
print('\ntakeover_candidate_rows — ruling 4a, the book the fixture can switch TO')


def trow(**kw):
    """The founder's own example: bet365 opened it, Sbo prices it now."""
    m = {'id': 'evt9', 'date': '2026-09-18', 'p1': 'T. Skatov', 'p2': 'K. Samrej',
         'odds': {'p1': 1.40, 'p2': 2.61, 'bookmaker': 'Sbo'},
         'bestOdds': {'p1': {'price': 1.40, 'bookmaker': 'Sbo'},
                      'p2': {'price': 2.61, 'bookmaker': 'Sbo'}},
         'bookOpens': {'Sbo': {'p1': 1.38, 'p2': 2.70,
                               'seenAt': '2026-09-17T09:00:00Z'}}}
    m.update(kw)
    return m


tk, tst = C.takeover_candidate_rows([trow()], NOW)
check('a book with its own pinned Open yields two sides', len(tk) == 2, len(tk))
check('the Open is the PINNED first sighting, never today\'s price — using the '
      'current price would make every takeover a 0% move and rewrite itself '
      'every run',
      tk[0]['open_price'] == 1.38 and tk[1]['open_price'] == 2.70,
      [r['open_price'] for r in tk])
check('...with its own sighting timestamp',
      tk[0]['open_ts'] == '2026-09-17T09:00:00Z')
check('the Now is that SAME book\'s current pair',
      tk[0]['now_price'] == 1.40 and tk[1]['now_price'] == 2.61)
check('the row names the book, and ranks BELOW bet365 — a takeover is won on '
      'completeness, never on rank',
      tk[0]['book'] == 'Sbo' and tk[0]['book_rank'] == C.RANK_OTHER_BOOK,
      (tk[0]['book'], tk[0]['book_rank']))
check('the fixture_id is namespaced per book — two books on one event key would '
      'otherwise collide on the table grain and upsert over each other',
      tk[0]['fixture_id'] == 'evt9#Sbo')

# bestOdds is a per-SIDE merge; a pair whose two sides name different books is
# not a quote from either of them.
mixed = C.takeover_candidate_rows([trow(
    odds={'p1': None, 'p2': None, 'bookmaker': None},
    bestOdds={'p1': {'price': 1.40, 'bookmaker': 'Sbo'},
              'p2': {'price': 2.61, 'bookmaker': 'Betano'}})], NOW)[0]
check('a CROSS-BOOK bestOdds pair yields an Open-only row, never a blended Now',
      len(mixed) == 2 and all(r['now_price'] is None for r in mixed),
      [r['now_price'] for r in mixed])

nb = C.takeover_candidate_rows([trow(bookOpens={})], NOW)[0]
check('no pinned per-book Open -> no row at all (this is why the rule fires 0 '
      'times until the capture has accrued)', nb == [])

b3 = C.takeover_candidate_rows([trow(bookOpens={
    'bet365': {'p1': 1.44, 'p2': 2.62, 'seenAt': '2026-09-17T09:00:00Z'}})], NOW)
check('bet365 is SKIPPED here — it already has its own ranked row, and two rows '
      'of one book on one fixture read as an ambiguity and blank the card',
      b3[0] == [] and b3[1]['skip_bet365'] == 1, dict(b3[1]))

fin = C.takeover_candidate_rows([trow(finalScore={'winner': 'p1'})], NOW)[0]
check('a FINISHED fixture gets no candidate row — after the off there is no Now '
      'to be complete about', fin == [])


# ─────────────────────────────────────────────────────────────────────────────
# TEN-257 — the rank CHECK must admit every book this loader writes.
#
# THE FAILURE THIS LOCKS. `odds_card_state_rank_ck` read
# `source = 'api-tennis' AND book_rank = 3`, while this loader writes its
# other-book rows (BetVictor and friends) at RANK_OTHER_BOOK = 4. Postgres
# rejected them with a 23514, the chunked upsert died mid-write, and the card
# fill ran ~1,116 rows short on five consecutive nightly runs from 2026-09-18
# before anyone noticed — because the job's other steps were green.
#
# ⚠️ NOT A GREP. The constraint text is PARSED into (source, operator, rank)
# clauses and EVALUATED over a truth table. A grep for ">= 3" would pass on a
# constraint that had been rewritten in any other shape, and would not notice
# the backfill below quietly undoing it.

import re as _re

_SCHEMA = open(os.path.join(HERE, 'ten225-card-state-schema.sql'), encoding='utf-8').read()
_CLAUSE = _re.compile(r"source\s*=\s*'([a-z-]+)'\s*AND\s*book_rank\s*(>=|<=|<>|=|>|<)\s*(\d+)")


def _rank_clauses(text):
    """Every (source, op, n) the rank CHECK admits, from the SQL itself."""
    return [(m.group(1), m.group(2), int(m.group(3))) for m in _CLAUSE.finditer(text)]


def _admits(clauses, source, rank):
    """Would the parsed CHECK accept this (source, book_rank)?"""
    ops = {'=': lambda a, b: a == b, '>=': lambda a, b: a >= b,
           '<=': lambda a, b: a <= b, '>': lambda a, b: a > b,
           '<': lambda a, b: a < b, '<>': lambda a, b: a != b}
    return any(s == source and ops[o](rank, n) for s, o, n in clauses)


def _rank_check_text(text):
    """Only the two `odds_card_state_rank_ck` CHECK bodies.

    ⚠️ SCOPED ON PURPOSE. Parsing the whole file also swallows the backfill
    UPDATEs, which carry `source = 'kibl' AND book_rank <> 1` — a `<>` clause
    that makes kibl look like it admits ranks 2 and 4. The first cut of this
    test did exactly that and reported four false failures.
    """
    out = []
    for m in _re.finditer(r'odds_card_state_rank_ck', text):
        tail = text[m.end():m.end() + 400]
        stop = min((i for i in (tail.find('));'), tail.find(')),')) if i != -1),
                   default=len(tail))
        out.append(tail[:stop])
    return out


_bodies = [b for b in _rank_check_text(_SCHEMA) if _rank_clauses(b)]
check('the rank CHECK is defined in at least two places '
      '(the CREATE TABLE and the idempotent ALTER)',
      len(_bodies) >= 2, f'found {len(_bodies)}')

# ⚠️ AND THEY MUST AGREE. The table is created by one of these and migrated by
# the other. Widen one and forget the other and a fresh database and a migrated
# one enforce different rules — which shows up as "works on my instance".
_sets = {tuple(sorted(_rank_clauses(b))) for b in _bodies}
check('every rank CHECK definition in the schema states the SAME rule',
      len(_sets) == 1, f'{len(_sets)} distinct rule(s): {_sets}')
_clauses = [c for b in _bodies for c in _rank_clauses(b)]
check('the rank CHECK was parsed out of the schema at all (not a silent zero)',
      len(_clauses) >= 6, f'found {len(_clauses)} clause(s)')
# CONTROL: the scoping is load-bearing — the unscoped parse really is wrong.
check('CONTROL: an UNSCOPED parse wrongly admits kibl at rank 4 '
      '(it swallows the backfill\'s `<> 1`), so the scoping above is not cosmetic',
      _admits(_rank_clauses(_SCHEMA), 'kibl', 4))

# The truth table. Each row is (source, rank, must_be_admitted).
for _src, _rank, _want in [
    ('kibl', 1, True), ('kibl', 2, False), ('kibl', 4, False),
    ('oddspapi', 2, True), ('oddspapi', 1, False), ('oddspapi', 3, False),
    ('api-tennis', 3, True),
    ('api-tennis', 4, True),      # ← the row that was being rejected
    ('api-tennis', 5, True),      # a fourth book later must not need a migration
    ('api-tennis', 2, False),     # and it still may NOT promote itself
    ('api-tennis', 1, False),
]:
    _got = _admits(_clauses, _src, _rank)
    check(f'rank CHECK: {_src} at book_rank {_rank} is '
          f'{"admitted" if _want else "REJECTED"}',
          _got == _want, f'got admitted={_got}')

# The constraint must admit exactly what this loader writes — schema and code
# checked against each other rather than each against my memory of the other.
for _name, _rank, _src in [('RANK_ODDSPAPI', C.RANK_ODDSPAPI, 'oddspapi'),
                           ('RANK_APITENNIS', C.RANK_APITENNIS, 'api-tennis'),
                           ('RANK_OTHER_BOOK', C.RANK_OTHER_BOOK, 'api-tennis')]:
    check(f'the loader writes {_name}={_rank} on {_src}, and the CHECK admits it',
          _admits(_clauses, _src, _rank))

# ⚠️ THE BACKFILL MUST NOT FLATTEN THE TIER IT JUST ADMITTED.
# `UPDATE ... SET book_rank = 3 WHERE source = 'api-tennis' AND book_rank <> 3`
# coerces every rank-4 row back to 3 on EVERY schema apply. The constraint would
# look correct and the ordering would silently collapse to one tier.
_backfill = _re.search(
    r"UPDATE odds_card_state SET book_rank = 3\s+WHERE source = 'api-tennis'\s+AND book_rank ([^;]+);",
    _SCHEMA)
check('the api-tennis rank backfill was found in the schema', _backfill is not None)
if _backfill:
    _cond = _backfill.group(1).strip()
    check('the api-tennis backfill does NOT coerce every non-3 rank '
          '(that would undo the widened constraint on every apply)',
          '<> 3' not in _cond, f'condition is `{_cond}`')
    check('…it coerces only the legacy 99 default',
          _cond == '= 99', f'condition is `{_cond}`')

# ── MUTATION CONTROLS — prove the checks above can actually fail ─────────────
_narrow = _rank_clauses(_SCHEMA.replace("source = 'api-tennis' AND book_rank >= 3",
                                        "source = 'api-tennis' AND book_rank = 3"))
check('CONTROL: reverting the CHECK to `= 3` rejects the rank-4 row again',
      not _admits(_narrow, 'api-tennis', 4))
check('CONTROL: …while still admitting rank 3, so the mutation is surgical',
      _admits(_narrow, 'api-tennis', 3))
_loose = _rank_clauses("source = 'api-tennis' AND book_rank >= 1")
check('CONTROL: a CHECK loose enough to let api-tennis claim rank 1 is caught',
      _admits(_loose, 'api-tennis', 1))


print('\n' + ('all checks passed' if not FAILED
              else f'{len(FAILED)} FAILURE(S): {FAILED}'))
sys.exit(1 if FAILED else 0)
