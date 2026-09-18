#!/usr/bin/env python3
"""TEN-225 Part 3 — publish odds_card_state to the static site.

WHY THIS FILE EXISTS
--------------------
`odds_card_state` is a Postgres table with RLS on and zero policies. The product
is a static GitHub-Pages app. There is no read path between the two and there is
not going to be one: giving a browser a key that can read this table is a bigger
change than any surface here justifies, and an anon policy on an odds table held
under a partner grant is not a thing to add as a side effect of wiring a column.

So the page reads a FILE. This job is the only writer of that file. It runs in
Actions (where the service key lives), projects the selected rows into the
smallest shape three surfaces can render, and commits it.

WHAT IT PUBLISHES, AND WHAT IT REFUSES TO
-----------------------------------------
Published: `is_selected` match-winner rows only. `is_selected` is set by the
selection pass and defaults FALSE, so a row no pass has judged publishes
nothing. That is the safe direction — the alternative is a page rendering a
book the selection pass would have rejected.

Keyed by `match_key` (day + both surname keys, sorted) because that is the only
identifier the three feeds share. The board does not know an oddspapi fixture id
or a Kibl fixture id and never will.

Sides are keyed by SURNAME KEY, not by '1'/'2'. The board's p1/p2 ordering is
api-tennis's, the row's side ordering is the pricing feed's, and those are not
the same ordering — a published '1'/'2' would make every render a bet on two
feeds agreeing about who is listed first. A surname key cannot be swapped.

FOUNDER RULES ENCODED HERE (2026-09-18), not left to the renderer:
  * One book per fixture, all three values from that book, no mixing. Enforced
    by dropping a match whose selected rows disagree about the book, and
    counting it — not by picking one.
  * "One-sided reliable close = dash on both sides." Enforced here, so a
    renderer cannot forget it and no surface can show a half-close.
  * Missing is a dash, never zero. Absent keys in the JSON; the renderer dashes.
  * Book name and Open timestamp travel WITH the price, in the same object, so
    a surface cannot render one without the other.

Reads SUPABASE_URL / SUPABASE_SECRET_KEY. Stdlib only. Secrets never printed.
"""
import argparse
import collections
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'odds-card-state.json')
MATCHES = os.path.join(HERE, 'matches.json')

sys.path.insert(0, HERE)
from ten225_names import match_key as mk_of, name_key  # noqa: E402

MARKET = 'match winner'
PAGE = 1000                 # PostgREST caps a page here; asking for more truncates
MIN_N = 30                  # standing rule: flag anything below this


# ------------------------------------------------------------------ plumbing
def creds():
    url = (os.environ.get('SUPABASE_URL') or '').rstrip('/')
    key = os.environ.get('SUPABASE_SECRET_KEY') or ''
    if not url or not key:
        print('::error::SUPABASE_URL / SUPABASE_SECRET_KEY are not both set. '
              'This script runs in Actions, where those secrets live.')
        sys.exit(1)
    return url, key


def fetch_all(url, key, table, cols, extra=''):
    """Read a table, paged.

    PostgREST caps a page at 1,000 rows however many you ask for, so the page
    size is pinned AT the cap and the walk stops only on a SHORT page. A
    previous rebuild on this codebase was silently truncated by trusting one
    unpaged read; asking for more than 1,000 makes `len(rows) < PAGE` true on
    the first full page and stops the walk at 1,000, which is the same bug
    wearing a bigger number.
    """
    out, offset = [], 0
    while True:
        q = f'/rest/v1/{table}?select={urllib.parse.quote(cols)}{extra}' \
            f'&limit={PAGE}&offset={offset}'
        req = urllib.request.Request(
            url + q, method='GET',
            headers={'Authorization': f'Bearer {key}', 'apikey': key})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                rows = json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            print(f'::error::{table} read failed ({e.code}): '
                  f'{e.read()[:300].decode("utf-8", "replace")}')
            sys.exit(1)
        out.extend(rows)
        if len(rows) < PAGE:
            return out
        offset += PAGE


def _f(v):
    """A price as a float, or None. Never 0.0 as a stand-in for absent.

    PostgREST serialises `numeric` as a STRING. float('') raises and
    float(None) raises, so both are caught here rather than at the call site —
    a numeric that arrived as '' has to dash, not crash the publish.
    """
    if v is None or v == '':
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f


# -------------------------------------------------------------------- shaping
def side_names(row, oddspapi_fx, kibl_fx, board_fx):
    """This row's fixture -> (player1_name, player2_name), or (None, None).

    Side '1' is the fixture's FIRST-named player and side '2' the second, in
    every one of the three id spaces — for kibl that is the adjudicated result
    of the side-mapping gate (lower fixture_participant_id = first-named), which
    passed 19/10/0 before this file was allowed to read it.
    """
    fid, space = str(row.get('fixture_id') or ''), row.get('id_space')
    if space == 'oddspapi':
        fx = oddspapi_fx.get(fid) or {}
        return fx.get('player1'), fx.get('player2')
    if space == 'kibl':
        fx = kibl_fx.get(fid) or {}
        return fx.get('player1_name'), fx.get('player2_name')
    if space == 'api-tennis':
        fx = board_fx.get(fid) or {}
        return fx.get('p1'), fx.get('p2')
    return None, None


def build(rows, oddspapi_fx, kibl_fx, board_fx):
    """Selected odds_card_state rows -> the published by-key map.

    Pure: every input is a plain dict, so the harness can drive it without a
    network or a database. Returns (by_key, stats).
    """
    st = collections.Counter()
    grouped = collections.defaultdict(list)

    for r in rows:
        if r.get('market') != MARKET:
            st['skip_not_match_winner'] += 1
            continue
        if not r.get('is_selected'):
            st['skip_not_selected'] += 1
            continue
        mkey = r.get('match_key')
        if not mkey:
            # Unpairable. This is the dash the standing rules ask for: a row we
            # cannot key is a row we cannot put on the right card.
            st['skip_no_match_key'] += 1
            continue
        grouped[mkey].append(r)

    by_key = {}
    for mkey, rs in sorted(grouped.items()):
        books = {r.get('book') for r in rs}
        if len(books) > 1:
            # "One book per fixture, all three values from that book, no
            # mixing." Two books under one key means the selection pass and
            # this projection disagree about identity; publishing either would
            # be a guess. Drop the match and say so.
            st['drop_mixed_book'] += 1
            continue
        sources = {r.get('source') for r in rs}
        if len(sources) > 1:
            st['drop_mixed_source'] += 1
            continue

        sides = {}
        bad = False
        for r in rs:
            p1, p2 = side_names(r, oddspapi_fx, kibl_fx, board_fx)
            who = p1 if str(r.get('side')) == '1' else p2 if str(r.get('side')) == '2' else None
            nk = name_key(who) if who else None
            if not nk:
                # We hold a price but cannot say whose it is. Never guess a side.
                st['drop_unresolved_side'] += 1
                bad = True
                break
            if nk in sides:
                st['drop_duplicate_side'] += 1
                bad = True
                break
            sides[nk] = {
                'open': _f(r.get('open_price')), 'openTs': r.get('open_ts'),
                'openLimit': _f(r.get('open_limit')),
                'now': _f(r.get('now_price')), 'nowTs': r.get('now_ts'),
                'close': _f(r.get('close_price')), 'closeTs': r.get('close_ts'),
            }
        if bad or not sides:
            continue

        # The two surname keys the match_key itself declares. A published side
        # that is not one of them would land on nobody's card, or worse, on
        # somebody else's.
        declared = set(mkey.split('|')[1:])
        if set(sides) != declared:
            st['drop_side_key_mismatch'] += 1
            continue

        # FOUNDER RULE (2026-09-18, 1b): "One-sided reliable close = dash on
        # both sides." A close on one player without the other's is not half a
        # market, it is an unusable one — the delta, the upset test and the
        # implied split all need the pair. Enforced HERE so no renderer can
        # forget it, and counted so the report can say how often it bites.
        if any(s['close'] is None for s in sides.values()) \
           and any(s['close'] is not None for s in sides.values()):
            for s in sides.values():
                s['close'] = None
                s['closeTs'] = None
            st['close_voided_one_sided'] += 1

        r0 = rs[0]
        entry = {
            'book': r0.get('book'),
            'source': r0.get('source'),
            'tsKind': r0.get('ts_kind'),
            'startTsSource': r0.get('start_ts_source'),
            'sides': sides,
        }
        if r0.get('label'):
            entry['label'] = r0['label']
        by_key[mkey] = entry

        st['matches'] += 1
        if all(s['open'] is not None for s in sides.values()):
            st['with_open_both'] += 1
        if all(s['now'] is not None for s in sides.values()):
            st['with_now_both'] += 1
        if all(s['close'] is not None for s in sides.values()):
            st['with_close_both'] += 1
        st[f'src_{r0.get("source")}'] += 1

    return by_key, st


def board_index(matches):
    """matches.json -> {event key: the match}, for the api-tennis side names."""
    out = {}
    for m in matches or []:
        mid = str(m.get('id') or '')
        if mid:
            out[mid] = m
    return out


def board_coverage(matches, by_key):
    """How many of OUR board's matches this file actually fills.

    The number that matters and the one that is easiest not to print. The
    archive can hold thousands of rows and still touch nothing a member sees:
    Kibl prices Challengers, our priced board is Davis Cup and ATP, and the two
    barely intersect. So coverage is measured against the board, per state.
    """
    st = collections.Counter()
    for m in matches or []:
        k = mk_of(m.get('date') or '', m.get('p1'), m.get('p2'))
        bucket = 'completed' if m.get('finalScore') else 'upcoming'
        st[f'board_{bucket}'] += 1
        if not k:
            st[f'board_{bucket}_unkeyable'] += 1
            continue
        e = by_key.get(k)
        if not e:
            st[f'board_{bucket}_uncovered'] += 1
            continue
        st[f'board_{bucket}_covered'] += 1
        sides = e['sides'].values()
        if all(s['open'] is not None for s in sides):
            st[f'board_{bucket}_open'] += 1
        if all(s['now'] is not None for s in sides):
            st[f'board_{bucket}_now'] += 1
        if all(s['close'] is not None for s in sides):
            st[f'board_{bucket}_close'] += 1
    return st


# ----------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()

    url, key = creds()
    rows = fetch_all(
        url, key, 'odds_card_state',
        'fixture_id,id_space,book,market,side,line,match_key,book_rank,'
        'is_selected,ts_kind,open_price,open_ts,open_limit,now_price,now_ts,'
        'close_price,close_ts,start_ts,start_ts_source,start_reject_reason,'
        'source,label',
        extra=f'&market=eq.{urllib.parse.quote(MARKET)}')
    oddspapi_fx = {str(r['fixture_id']): r for r in fetch_all(
        url, key, 'oddspapi_fixtures',
        'fixture_id,player1,player2,category_name,tournament_name')}
    kibl_fx = {str(r['fixture_id']): r for r in fetch_all(
        url, key, 'kibl_fixtures',
        'fixture_id,player1_name,player2_name,league_id')}

    matches = []
    if os.path.exists(MATCHES):
        with open(MATCHES) as fh:
            matches = json.load(fh)
    board_fx = board_index(matches)

    by_key, st = build(rows, oddspapi_fx, kibl_fx, board_fx)
    cov = board_coverage(matches, by_key)

    doc = {
        'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'market': MARKET,
        'matches': len(by_key),
        'byKey': by_key,
    }
    with open(args.out, 'w') as fh:
        json.dump(doc, fh, separators=(',', ':'), sort_keys=True)
        fh.write('\n')

    size = os.path.getsize(args.out)
    print(f'## TEN-225 Part 3 — published {os.path.basename(args.out)}')
    print(f'rows read       {len(rows)}')
    print(f'matches written {len(by_key)}   ({size:,} bytes)')
    print('')
    print('projection')
    for k in sorted(st):
        print(f'  {k:<28} {st[k]}')
    print('')
    print('board coverage (what a member actually sees)')
    for k in sorted(cov):
        print(f'  {k:<28} {cov[k]}')
    for bucket in ('upcoming', 'completed'):
        n = cov[f'board_{bucket}']
        if 0 < n < MIN_N:
            print(f'::warning::board_{bucket} n={n} is below {MIN_N} '
                  '(standing rule: flag n < 30)')
    if not by_key:
        # Not an error: an empty archive projection is a real answer and the
        # file still has to exist so the page's fetch does not 404. But it must
        # never pass silently as "wired".
        print('::warning::published 0 matches — every surface will dash')
    return 0


if __name__ == '__main__':
    sys.exit(main())
