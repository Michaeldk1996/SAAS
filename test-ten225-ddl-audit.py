#!/usr/bin/env python3
"""TEN-225 — offline harness for the DDL never-written audit.

No network. Locks the three things that made the FIRST run of this script
worthless, all of which it found by running rather than by review:

  1. COVERAGE BEFORE VERDICT. Run 35294709422 printed "NEVER WRITTEN: none.
     Every nullable column in the audited DDL has at least one non-NULL value"
     while all 7 tables had 400'd and nothing had been read. The script whose
     entire purpose is catching a clean zero reported one itself. An unassessed
     run must FAIL, not reassure.
  2. `select=*`, NEVER `select=1`. PostgREST reads the select list as column
     NAMES, so `select=1` asks for a column called "1" and 400s on every table.
  3. DDL PARSING STOPS AT PROSE. These schema files carry long comment blocks
     between columns; comma-splitting before stripping comments yielded columns
     named `and`, `so`, `never` and `silently`, which would have been queried,
     400'd, and filed as "unreadable" rather than as a parser bug.

MUTATION CONTROL — 3 run, 3 CAUGHT, control green before and after:
  a. count() goes back to select=1                        RED (2)
  b. the empty-assessment guard is removed                RED (1)
  c. strip_comments() becomes a no-op                     RED (3)
"""
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True

A = types.ModuleType('A')
A.__file__ = os.path.join(HERE, 'ten225-ddl-null-audit.py')
sys.argv = ['A']
exec(compile(open(A.__file__).read(), A.__file__, 'exec'), A.__dict__)

FAILED = []


def check(name, cond, detail=''):
    if cond:
        print(f'  ok   {name}')
    else:
        print(f'  FAIL {name} {detail}')
        FAILED.append(name)


import inspect  # noqa: E402

# ------------------------------------------------------------------ 2, select=*
print('count() — the select list is COLUMN NAMES, not an expression')
src = inspect.getsource(A.count)
check('select=* is used', 'select=*' in src)
check('select=1 is NOT — it asks for a column literally named "1" and 400s on '
      'every table (measured, run 35294709422)', 'select=1&' not in src)
check('the count is read from Content-Range, not from a row body',
      'Content-Range' in src)
check("a '*' total is not recorded as zero — the server declining to count is "
      'not an empty table', "in ('*', '')" in src)

# --------------------------------------------------- 1, coverage before verdict
print()
print('COVERAGE BEFORE VERDICT — the script must not commit its own defect')
msrc = inspect.getsource(A.main)
check('the run FAILS when nothing was assessed, rather than reporting a clean '
      'bill of health', 'NOTHING WAS ASSESSED' in msrc and 'return 1' in msrc)
check('the guard is on columns actually READ, not on tables attempted — '
      'attempting 7 tables and reading 0 columns is the exact failure',
      "'nonNull' in c" in msrc)
check('the clean verdict names its own denominator, so it can never be read as '
      'covering skipped or unreadable columns',
      'actually' in msrc and 'are NOT covered by that statement' in msrc)

# ------------------------------------------------------- 3, parsing stops at prose
print()
print('DDL PARSING — prose is not a column')
PROSE = '''
create table if not exists demo (
  fixture_id   bigint not null,
  -- This is a long comment block that runs across several lines, and it
  -- mentions words like never and silently and so, which a naive split on
  -- commas would happily read as column names.
  player1      text,
  /* a block comment, with a comma, in it */
  player2      text,
  price        numeric(10,2),
  primary key (fixture_id),
  unique (player1, player2),
  constraint demo_ck check (price > 0)
);
'''
cols = A.columns_of(PROSE)['demo']
names = [c for c, _ in cols]
check('only real columns are returned',
      names == ['fixture_id', 'player1', 'player2', 'price'], names)
check('no prose leaked in', not ({'never', 'silently', 'so', 'and'} & set(names)))
check('numeric(10,2) is ONE column, not two — the comma split must respect '
      'parentheses', names.count('price') == 1)
check('table constraints are not columns',
      not ({'primary', 'unique', 'constraint'} & set(names)))
check('NOT NULL is detected, so a structurally-impossible query is skipped '
      'rather than issued', dict(cols)['fixture_id'] is True)
check('...and a nullable column is not mislabelled', dict(cols)['player1'] is False)

print()
print('the real schema files parse to real columns')
for fn in A.SCHEMA_FILES:
    p = os.path.join(HERE, fn)
    if not os.path.exists(p):
        check(f'{fn} present', False, 'missing')
        continue
    for t, cols in A.columns_of(open(p).read()).items():
        bad = [c for c, _ in cols if len(c) < 2 or c in (
            'and', 'so', 'the', 'not', 'with', 'from', 'never', 'silently',
            'which', 'because', 'per', 'on', 'now', 'even', 'then', 'exactly',
            'always', 'option', 'pinned', 'sorted', 'flagged')]
        check(f'{t}: {len(cols)} columns, none of them prose', not bad, bad)

print()
if FAILED:
    print(f'{len(FAILED)} FAILED: {FAILED}')
    sys.exit(1)
print('all checks passed')
