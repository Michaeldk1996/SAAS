#!/usr/bin/env python3
"""TEN-225 — which DDL columns has NOTHING ever written?

Founder ruling 2026-09-18 item 4: *"Good catch on player1/player2 never being
written. Report whether any OTHER column in our DDL is unpopulated in the same
way — same failure shape, silent on a green run."*

THE FAILURE SHAPE
-----------------
`oddspapi_fixtures.player1` and `player2` were in the DDL from day one and no
writer ever populated them. Nothing failed. The pairing that needed them simply
found nothing, the orientation control ran at n=0, every Kibl Close dashed — and
every run stayed GREEN, because "no pair" and "no names to pair with" produce
byte-identical output. A column that is 100% NULL is the one defect that cannot
raise, so it has to be ASKED FOR.

WHAT COUNTS AS A FINDING
------------------------
Three tiers, because they are not equally interesting and lumping them together
is how a real finding gets lost in a list of nullable-by-design columns:

  EMPTY_TABLE  the table has no rows at all. Says nothing about its columns, and
               is reported separately so a zero cannot be read as "all columns
               fine" OR as "every column broken".
  NEVER_WRITTEN a column with rows above it and 0 non-NULL values. This is the
               player1/player2 shape.
  SPARSE       below SPARSE_PCT non-NULL. Not a defect — a Close that has not
               happened yet is legitimately NULL — but it is where a
               half-wired column hides, so it is listed and left for a human.

A column with a NOT NULL constraint cannot be in NEVER_WRITTEN while rows exist,
so those are skipped and counted rather than queried: the answer is structural.

HOW THE COUNTS ARE TAKEN
------------------------
PostgREST's `Prefer: count=exact` with `limit=0`, read off the Content-Range
header. Two requests per column (total rows, non-NULL rows) and NO row bodies —
paging 26,000 rows per column to count them would be the same answer at a
hundred times the cost. ⚠️ This deliberately does NOT use the shared `sb()`
helper, which returns the body and discards the headers the count lives in.

Reads SUPABASE_URL / SUPABASE_SECRET_KEY. Stdlib only. Secrets never printed.
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'ten225-ddl-null-audit.json')

# Below this share of non-NULL values a column is worth a human look. Not a
# defect threshold — a reporting one.
SPARSE_PCT = 1.0

SCHEMA_FILES = ('ten225-card-state-schema.sql', 'ten225-line-summary-schema.sql',
                'ten232-kibl-schema.sql', 'ten225-budget-schema.sql')

# `create table [if not exists] <name> (` ... up to the matching close.
_CREATE = re.compile(r'create\s+table\s+(?:if\s+not\s+exists\s+)?'
                     r'(?:public\.)?([a-z_][a-z0-9_]*)\s*\(', re.I)
# A column line: leading identifier then a type. Constraint lines are excluded
# by keyword rather than by shape, because `primary key (a, b)` and a column
# called `primary_thing` are the same shape.
_NOT_A_COLUMN = ('primary', 'unique', 'foreign', 'constraint', 'check',
                 'exclude', 'like', 'partition')


def strip_comments(sql):
    """Remove `-- ...` and `/* ... */` from the WHOLE text before parsing.

    Not per-line during the walk: these schema files carry long comment blocks
    BETWEEN columns, and comma-splitting first leaves a chunk whose first token
    is an English word. A first version did exactly that and reported columns
    named `and`, `so`, `never` and `silently` — prose parsed as DDL. It would
    have queried those, got 400s, and filed them as "unreadable".
    """
    sql = re.sub(r'/\*.*?\*/', ' ', sql, flags=re.S)
    return re.sub(r'--[^\n]*', '', sql)


def columns_of(sql):
    """DDL text -> {table: [(column, is_not_null), ...]}.

    Parsed rather than read from information_schema on purpose: the question is
    whether OUR DECLARED SCHEMA is fully populated. A column dropped from the
    live instance but still in the committed DDL is itself a finding, and asking
    the instance for its own column list could never surface it.
    """
    sql = strip_comments(sql)
    out = {}
    for m in _CREATE.finditer(sql):
        table = m.group(1).lower()
        depth, i = 1, m.end()
        while i < len(sql) and depth:
            if sql[i] == '(':
                depth += 1
            elif sql[i] == ')':
                depth -= 1
            i += 1
        body = sql[m.end():i - 1]
        # Split on commas at depth 0 only — `numeric(10,2)` is one column.
        parts, depth, cur = [], 0, ''
        for ch in body:
            if ch == '(':
                depth += 1
            elif ch == ')':
                depth -= 1
            if ch == ',' and depth == 0:
                parts.append(cur)
                cur = ''
            else:
                cur += ch
        parts.append(cur)

        cols = []
        for p in parts:
            line = ' '.join(p.split())
            if not line:
                continue
            first = line.split()[0].strip('"').lower()
            if first in _NOT_A_COLUMN or not re.fullmatch(r'[a-z_][a-z0-9_]*', first):
                continue
            cols.append((first, bool(re.search(r'\bnot\s+null\b', line, re.I))))
        if cols:
            out.setdefault(table, [])
            seen = {c for c, _ in out[table]}
            out[table].extend([c for c in cols if c[0] not in seen])
    return out


def count(url, key, table, where=''):
    """Exact row count via the Content-Range header. -> (n, error)."""
    # `select=*`, never `select=1`: PostgREST reads the select list as COLUMN
    # NAMES, so `select=1` asks for a column called "1" and 400s with
    # `column <table>.1 does not exist`. Measured on run 35294709422, where it
    # made all 7 tables unreadable.
    path = f'/rest/v1/{table}?select=*&limit=0{where}'
    req = urllib.request.Request(
        url + path, method='GET',
        headers={'Authorization': f'Bearer {key}', 'apikey': key,
                 'Prefer': 'count=exact', 'Range-Unit': 'items'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            cr = r.headers.get('Content-Range') or ''
    except urllib.error.HTTPError as e:
        return None, (e.code, e.read()[:200].decode('utf-8', 'replace'))
    except Exception as e:                      # noqa: BLE001 — reported
        return None, (0, str(e))
    # '0-99/1234' or '*/1234'. A '*' total means the server declined to count,
    # which is NOT zero and must never be recorded as zero.
    total = cr.rsplit('/', 1)[-1] if '/' in cr else '*'
    if total in ('*', ''):
        return None, (0, f'no exact count in Content-Range {cr!r}')
    return int(total), None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tables', default='',
                    help='comma-separated subset; default = every table in the '
                         'committed DDL')
    a = ap.parse_args()

    url = os.environ.get('SUPABASE_URL', '').rstrip('/')
    key = os.environ.get('SUPABASE_SECRET_KEY', '')
    if not (url and key):
        print('::error::SUPABASE_URL / SUPABASE_SECRET_KEY are not set')
        return 1

    declared = {}
    for fn in SCHEMA_FILES:
        p = os.path.join(HERE, fn)
        if not os.path.exists(p):
            print(f'::warning::{fn} is missing from the checkout — its tables '
                  f'are NOT audited, and this run does not cover them')
            continue
        for t, cols in columns_of(open(p).read()).items():
            declared.setdefault(t, [])
            seen = {c for c, _ in declared[t]}
            declared[t].extend([c for c in cols if c[0] not in seen])

    wanted = [t.strip() for t in a.tables.split(',') if t.strip()]
    tables = sorted(t for t in declared if not wanted or t in wanted)
    print(f'auditing {len(tables)} tables / '
          f'{sum(len(declared[t]) for t in tables)} declared columns')

    result = {'sparsePct': SPARSE_PCT, 'tables': {},
              'neverWritten': [], 'sparse': [], 'emptyTables': [],
              'unreadable': []}

    for t in tables:
        total, err = count(url, key, t)
        if err:
            print(f'  {t}: UNREADABLE {err}')
            result['unreadable'].append({'table': t, 'error': str(err)})
            continue
        rec = {'rows': total, 'columns': {}}
        result['tables'][t] = rec
        if total == 0:
            # A zero-row table is not evidence about its columns either way.
            print(f'  {t}: 0 rows — columns NOT assessed (an empty table cannot '
                  f'distinguish "never written" from "nothing to write yet")')
            result['emptyTables'].append(t)
            continue

        for col, not_null in declared[t]:
            if not_null:
                rec['columns'][col] = {'notNull': True, 'skipped': True}
                continue
            n, cerr = count(url, key, t, f'&{urllib.parse.quote(col)}=not.is.null')
            if cerr:
                rec['columns'][col] = {'error': str(cerr)}
                result['unreadable'].append({'table': t, 'column': col,
                                             'error': str(cerr)})
                continue
            pct = 100.0 * n / total
            rec['columns'][col] = {'nonNull': n, 'pct': round(pct, 3)}
            if n == 0:
                result['neverWritten'].append(
                    {'table': t, 'column': col, 'rows': total})
            elif pct < SPARSE_PCT:
                result['sparse'].append({'table': t, 'column': col,
                                         'nonNull': n, 'rows': total,
                                         'pct': round(pct, 3)})
        nw = [c for c in result['neverWritten'] if c['table'] == t]
        print(f'  {t}: {total} rows, {len(declared[t])} columns, '
              f'{len(nw)} NEVER WRITTEN'
              + (f' -> {[c["column"] for c in nw]}' if nw else ''))

    print()
    # ⚠️ COVERAGE BEFORE VERDICT. Run 35294709422 printed "NEVER WRITTEN: none.
    # Every nullable column ... has at least one non-NULL value" while every one
    # of the 7 tables had 400'd and NOTHING had been read. That is this script's
    # own failure mode committed by the script itself: a clean zero reported as
    # a clean bill of health. The verdict is now gated on having assessed
    # something, and an unassessed run FAILS rather than reassures.
    assessed = sum(len([c for c in rec['columns'].values()
                        if 'nonNull' in c])
                   for rec in result['tables'].values())
    result['columnsAssessed'] = assessed
    result['tablesAssessed'] = len([t for t in result['tables']
                                    if result['tables'][t]['rows']])
    if not assessed:
        print(f'::error::NOTHING WAS ASSESSED — 0 columns read across '
              f'{len(tables)} tables. This run answers the question for no '
              f'column at all; it is NOT evidence that the DDL is clean.')
        json.dump(result, open(OUT, 'w'), indent=1)
        return 1
    print(f'assessed {assessed} nullable columns across '
          f'{result["tablesAssessed"]} non-empty tables')
    if result['neverWritten']:
        for c in result['neverWritten']:
            print(f'::warning::{c["table"]}.{c["column"]} is 100% NULL over '
                  f'{c["rows"]} rows — declared in the DDL, never written. This '
                  f'is the player1/player2 failure shape.')
    else:
        print(f'NEVER WRITTEN: none across the {assessed} columns actually '
              f'assessed. Columns skipped as NOT NULL, and any listed as '
              f'unreadable below, are NOT covered by that statement.')
    print(f'sparse (<{SPARSE_PCT}% non-NULL, reported not judged): '
          f'{[(c["table"], c["column"], c["pct"]) for c in result["sparse"]]}')
    if result['emptyTables']:
        print(f'empty tables (columns not assessed): {result["emptyTables"]}')
    if result['unreadable']:
        print(f'::warning::{len(result["unreadable"])} target(s) could not be '
              f'read; they are NOT covered by this run: '
              f'{result["unreadable"][:5]}')

    json.dump(result, open(OUT, 'w'), indent=1)
    print(f'wrote {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
