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
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'odds-card-state.json')
MATCHES = os.path.join(HERE, 'matches.json')

sys.path.insert(0, HERE)
from ten225_names import match_key as mk_of, name_key  # noqa: E402

MARKET = 'match winner'
# Days either side of the board's own date span that still get published. See
# board_window() for why this is not zero and why it is much wider than the gap
# it has to cover.
WINDOW_MARGIN_DAYS = 7
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
    """A number as a float, or None. Never 0.0 as a stand-in for ABSENT.

    PostgREST serialises `numeric` as a STRING. float('') raises and
    float(None) raises, so both are caught here rather than at the call site —
    a numeric that arrived as '' has to dash, not crash the publish.

    A genuine 0 is PRESERVED here, because this also coerces `open_limit`, where
    a zero stake limit is a real fact about a market and not a missing value.
    Prices go through _px() below, which is stricter for a measured reason.
    """
    if v is None or v == '':
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _px(v):
    """A PRICE as a float, or None. A zero or negative price is ABSENT.

    ── MEASURED, AND IT WAS LIVE ───────────────────────────────────────────────
    Deployed odds-card-state.json, generatedAt 2026-09-18T05:17:40Z: two
    published side-rows carried `now: 0` — 2026-09-18|kwon|suresh, both sides,
    book sports411 — on a fixture that was on THAT DAY'S BOARD.

    Downstream every reader tests `!= null`, and `0 != null` is true. So the zero
    rendered as the price 0.00 on the card face, handed the FAV chip to the other
    player off a 0/0 line, and scored a fabricated -100% move that takes the top
    of the Biggest-market-move sort and headlines its tile. A feed zero means
    "this market is not priced", which is a dash — the standing rule, verbatim.

    Split from _f() rather than tightening it: _f also coerces `open_limit`,
    where 0 is a real limit and not an absence, and one function cannot hold both
    rules. Decimal odds are strictly greater than 1, so `> 0` is a floor far
    below anything real and cannot reject a genuine price.

    The renderer carries its own guard (`_ocsSanePx` in the dashboard) because
    fixing the publisher does not un-ship a file already deployed with zeros in
    it, and because a guard at one end is a guard someone forgets at the other.
    """
    f = _f(v)
    return f if (f is not None and f > 0) else None


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


def build(rows, oddspapi_fx, kibl_fx, board_fx, window=(None, None)):
    """Selected odds_card_state rows -> the published by-key map.

    Pure: every input is a plain dict, so the harness can drive it without a
    network or a database. Returns (by_key, stats).
    """
    st = collections.Counter()
    grouped = collections.defaultdict(list)
    lo, hi = window

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
        # Outside the renderable window (see board_window). Counted, never
        # silently dropped: "12,768 archived matches withheld" is a fact the
        # report has to state, because it is the difference between "we have no
        # price" and "we have a price no surface can reach".
        if lo and not (lo <= mkey[:10] <= hi):
            st['skip_outside_board_window'] += 1
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
                'open': _px(r.get('open_price')), 'openTs': r.get('open_ts'),
                'openLimit': _f(r.get('open_limit')),
                'now': _px(r.get('now_price')), 'nowTs': r.get('now_ts'),
                'close': _px(r.get('close_price')), 'closeTs': r.get('close_ts'),
            }
            # TEN-253 ruling 2 — "Store a flag on every Close: within 60 minutes,
            # yes or no." Travels WITH the close so no surface can compute a
            # number from a close without seeing it. Emitted only beside a close;
            # a close with no stored flag predates the flag and passed the old
            # 60-minute rule, which is the only way a close was ever stored then.
            if sides[nk]['close'] is not None:
                sides[nk]['closeW60'] = r.get('close_within_60') is not False
            # ── BOTH CLOCKS (founder ruling 2026-09-18 09:33Z, items 1 + 3) ──
            # `openTs`/`nowTs` are the PRICE's clock; these two are OURS. The
            # page needs both: one answers "how stale is the line", the other
            # "how stale is our copy", and the hover now prints them side by
            # side. Emitted ONLY when present — an absent key is the dash, and
            # a NULL written as a key would make every row look like it carried
            # a clock it does not have. This also keeps the payload off the 602
            # oddspapi rows that genuinely have no observation clock.
            for k, col in (('openObs', 'open_observed_at'),
                           ('nowObs', 'now_observed_at')):
                if r.get(col):
                    sides[nk][k] = r[col]
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
                s.pop('closeW60', None)
            st['close_voided_one_sided'] += 1

        r0 = rs[0]
        entry = {
            'book': r0.get('book'),
            'source': r0.get('source'),
            'tsKind': r0.get('ts_kind'),
            'startTsSource': r0.get('start_ts_source'),
            'sides': sides,
        }
        # WHOSE clock closeTs is. On Kibl it is OUR last sighting capped at the
        # start (TEN-253 Fix 1), not Kibl's insert time, so it must not borrow
        # the row's 'vendor-insert' label.
        if any(s['close'] is not None for s in sides.values()):
            entry['closeTsKind'] = 'sighting' if r0.get('source') == 'kibl' else r0.get('ts_kind')
        # The actual start the close was cut at, so the hover can say "last
        # seen X min before start" from the same instant the rule used.
        if r0.get('start_ts') and any(s['close'] is not None for s in sides.values()):
            entry['startTs'] = r0['start_ts']
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
            st['with_close_both_within60' if all(s.get('closeW60') for s in sides.values())
               else 'with_close_both_older'] += 1
        st[f'src_{r0.get("source")}'] += 1
        st[f'book_{r0.get("book")}'] += 1

    return by_key, st


def board_window(matches, margin_days=WINDOW_MARGIN_DAYS):
    """The day range the board can actually render, widened by a margin.

    WHY THIS EXISTS, MEASURED. The first real run published all 12,843 archived
    matches: a 4,950,429-byte file, fetched on every page load and again on
    every 3-minute refresh, to answer questions about 75 matches. matches.json
    is a ~3-day rolling window, so 12,768 of those entries could not reach a
    card however long you looked — the page has no fixture to hang them on.
    Publishing them is pure payload, and payload is this app's known bottleneck.

    So the file is cut to the board's own span plus a margin. The margin is not
    cosmetic: matches.json and this file are written by different jobs minutes
    apart, and a board that rolls onto a new day between the two must not find
    its Opens missing. It is deliberately much wider than that gap.

    Returns (lo, hi) as 'YYYY-MM-DD', or (None, None) when the board is empty —
    in which case nothing is withheld, because a window computed from no data
    would be a guess.
    """
    days = sorted({(m.get('date') or '')[:10] for m in matches or [] if m.get('date')})
    if not days:
        return None, None
    lo = (datetime.fromisoformat(days[0]) - timedelta(days=margin_days)).date().isoformat()
    hi = (datetime.fromisoformat(days[-1]) + timedelta(days=margin_days)).date().isoformat()
    return lo, hi


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
        'is_selected,ts_kind,open_price,open_ts,open_limit,open_observed_at,'
        'now_price,now_ts,now_observed_at,'
        'close_price,close_ts,close_within_60,start_ts,start_ts_source,start_reject_reason,'
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
    window = board_window(matches)

    by_key, st = build(rows, oddspapi_fx, kibl_fx, board_fx, window)
    cov = board_coverage(matches, by_key)

    doc = {
        'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'market': MARKET,
        # The window is published WITH the data so a reader can tell "no price"
        # from "outside the file's range" without reading this script.
        'windowFrom': window[0], 'windowTo': window[1],
        'matches': len(by_key),
        'byKey': by_key,
    }
    with open(args.out, 'w') as fh:
        json.dump(doc, fh, separators=(',', ':'), sort_keys=True)
        fh.write('\n')

    size = os.path.getsize(args.out)
    print(f'## TEN-225 Part 3 — published {os.path.basename(args.out)}')
    print(f'rows read       {len(rows)}')
    print(f'window          {window[0]} .. {window[1]}  '
          f'(board span +/- {WINDOW_MARGIN_DAYS}d)')
    print(f'matches written {len(by_key)}   ({size:,} bytes)')
    if size > 1_000_000:
        print(f'::warning::odds-card-state.json is {size:,} bytes — this file is '
              'fetched on every page load and every refresh; payload is this '
              "app's known bottleneck")
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
