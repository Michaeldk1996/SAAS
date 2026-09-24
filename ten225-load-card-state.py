#!/usr/bin/env python3
"""TEN-225 PART 2 — fill odds_card_state (match winner) from the archive.

Michael's spec: "Filled for match winner from the archive, api-tennis fallback
where Oddspapi has nothing."

ZERO odds-API calls and zero new polling. Everything here is a projection of
what Parts 1 and 1b already stored:

    oddspapi_line_summary   -> Open, Close, start provenance, the freshest tick
    oddspapi_fixtures       -> level, players, scheduled start, status
    matches.json (committed)-> the api-tennis fallback sighting

WHAT THIS TABLE IS FOR, AND WHY IT IS NOT JUST A VIEW
-----------------------------------------------------
line_summary is the BUILD-TIME index over one source, at series grain, keyed to
oddspapi's own ids. odds_card_state is the READ-TIME answer to "what does this
card show": one row per thing a surface renders, already resolved ACROSS both
sources. The resolution is the work — see the Now rule below, which is not
expressible as a column on either input.

THE NOW RULE — the one genuinely subtle decision in this file
--------------------------------------------------------------
Michael: "Now = freshest Oddspapi price already available to us, with its
timestamp." The freshest tick we hold is `last_tick_*` on the summary row. But
that tick is only a NOW for a fixture that has not started:

  * a fixture with a resolved start has already begun, and the freshest
    pre-start price we hold for it IS ITS CLOSE. Rendering that as "Now" would
    put a three-month-old closing price on a card under a live-sounding label;
  * a fixture whose scheduled start is still in the future cannot have an
    in-play tick at all, so its freshest tick is a genuine Now.

See qualifies_as_now() for the version of this rule that was wrong, why it
reported 92% coverage, and why that number was the symptom rather than the
reassurance.

Neither test satisfied -> now_price is NULL and the card dashes. Missing is a
dash, never zero, never the open, never a price from another book.

Reads SUPABASE_URL / SUPABASE_SECRET_KEY (Actions only). Stdlib only. Secrets
are never printed.
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
OUT = os.path.join(HERE, 'ten225-load-card-state.json')
EXPORT = os.path.join(HERE, 'odds-card-state.json')

MARKET = 'match winner'
BOOK = 'bet365'
BATCH = 500
PAGE = 1000                 # PostgREST caps a page here; asking for more truncates
MIN_N = 30                  # standing rule: flag anything below this

# Import the loader's shared helpers rather than restating its rules. exec of the
# source text, not importlib: macOS python caches bytecode outside the repo and a
# same-size restore can serve stale code (see the stale-bytecode guard note in
# the test harnesses).
import types
L = types.ModuleType('L')
L.__file__ = os.path.join(HERE, 'ten225-load-line-summary.py')
_argv, sys.argv = sys.argv, ['L']
exec(compile(open(L.__file__).read(), L.__file__, 'exec'), L.__dict__)
sys.argv = _argv

epoch, iso, sb, creds = L.epoch, L.iso, L.sb, L.creds

from ten225_names import match_key as mk_of  # noqa: E402
import ten225_names as NAMES  # noqa: E402

# Book priority (founder ruling 2026-09-18T00:18Z): 1 kibl/Sports411, 2 bet365
# via oddspapi, 3 api-tennis. This file fills ranks 2 and 3; rank 1 is filled by
# ten225-kibl-card-state.py, which also owns the selection pass. Neither filler
# sets is_selected — "am I the best source for this match" is not a question a
# filler that can only see its own source is able to answer.
RANK_ODDSPAPI = 2
RANK_APITENNIS = 3
# TEN-225 ruling 4a (founder, 2026-09-18) — every OTHER book api-tennis quotes,
# below bet365-via-api-tennis. It sits at the bottom ON PURPOSE: these books are
# takeover CANDIDATES, not a promotion. They only ever win a fixture where the
# higher-ranked book has an Open and no Now, and then only because the selection
# pass's completeness tier says so — never on rank. Ranked as one number rather
# than per book because "Pinnacle/Bet105 add later without schema changes" means
# a new book must not need a new constant.
RANK_OTHER_BOOK = 4


# ------------------------------------------------------------------- the rules

def qualifies_as_now(start_ts, sched_ts, as_of):
    """Michael's Now definition -> may this stored tick be rendered as "Now"?

    Returns (ok, basis) where basis names WHICH test passed, so the Part 4 report
    can say how each Now was justified rather than just how many there are.

    A Now is only meaningful for a fixture that HAS NOT STARTED. That is the
    whole rule, and the first version of this function got it wrong in a way
    worth recording, because the number looked healthy:

      The first draft also promoted any tick the archive had proved pre-start
      (`last_tick_is_prestart IS TRUE`). On run 35214569618 that produced "Now
      92.0%" across 26,277 rows and read like excellent coverage. It was not.
      That flag is true precisely when we hold a resolved start and our freshest
      tick is BEFORE it — which, on a finished fixture, means the freshest price
      we hold IS THE CLOSE. The rule was relabelling three-month-old closing
      prices as "Now". A high number, uniformly wrong.

    So the test is the fixture's own state, not the tick's position:
      * a resolved start_ts means the match has started -> there is no Now, the
        card shows Close;
      * otherwise, a scheduled start in the future means every tick we hold is
        necessarily pre-match -> the freshest one is a real Now.

    Reading the scheduled time here is not a breach of "never use the scheduled
    time". That rule forbids the schedule as a CUTOFF — the instant a Close is
    pinned to. Here it decides SCOPE: "is this fixture still in the future".
    Being wrong costs a Now a few minutes stale on a match just starting; being
    wrong about a cutoff pins an in-play price as a close forever. Same split as
    close_cutoff() vs completeness_ref() in the archive.

    An in-play match gets no Now either. We hold no in-play price for it (the
    summary is pre-start by construction) and the freshest pre-start price we do
    hold is its close. Dash is the honest answer; "Now" would be a lie with a
    plausible number attached.
    """
    if start_ts is not None:
        return False, None
    if sched_ts is not None and as_of is not None and sched_ts > as_of:
        return True, 'fixture-not-started'
    return False, None


def _real_px(v):
    """A price a book would take (>= 1.01, the ruled floor), else None."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f >= 1.01 else None


def card_rows(summary_rows, fixtures, as_of):
    """line_summary match-winner rows -> odds_card_state rows.

    One row per fixture + book + market + side, which is already the grain the
    summary is keyed at for match winner (line is NULL there), so this is a
    projection and not an aggregation. A duplicate key would mean the summary
    itself had two rows at one grain, which its own UNIQUE constraint forbids.
    """
    out, st = [], collections.Counter()
    for r in summary_rows:
        if r.get('market') != MARKET:
            st['not_match_winner'] += 1
            continue
        fx = fixtures.get(r['fixture_id']) or {}
        sched = epoch(fx.get('scheduled_start'))
        now_ok, basis = qualifies_as_now(epoch(r.get('start_ts')), sched, as_of)
        if now_ok:
            st[f'now_{basis}'] += 1
        elif r.get('last_tick_price') is not None:
            st['now_withheld_not_prematch'] += 1
        else:
            st['now_absent'] += 1

        if r.get('open_price') is None:
            st['no_open'] += 1
        if r.get('close_price') is None:
            st['no_close'] += 1

        # TEN-253 ruling 2 (founder 2026-09-23) — THE CLOSE DISPLAY RULE.
        # "Show the last real price seen before the actual start, even when it's
        # older than 60 minutes ... Store a flag on every Close." The summary
        # NULLS close_price unless close_reliable (60-min lag, 21-day decay), so
        # a summary close is by construction within-60. Where it was nulled but
        # the book's freshest tick is proven pre-start, that tick IS the last
        # price we hold before the off: shown, flagged NOT within-60, so no
        # number is ever computed from it. last_tick_is_prestart is true only
        # against a RESOLVED start, which the close-needs-start CHECK requires.
        close_px, close_ts, close_w60 = r.get('close_price'), r.get('close_ts'), None
        if close_px is not None:
            close_w60 = True
        elif (r.get('last_tick_is_prestart') is True and r.get('start_ts')
              and _real_px(r.get('last_tick_price')) is not None and r.get('last_tick_ts')):
            close_px, close_ts, close_w60 = r['last_tick_price'], r['last_tick_ts'], False
            st['close_older_shown'] += 1

        # The cross-feed join key. Built from the fixture's own day and both
        # player names with the SAME name_key() every other pairing on TEN-225
        # uses. NULL when the fixture is unkeyable (a missing name, or two
        # players who key to one surname) — and a NULL key means the selection
        # pass can never select the row, which is the dash the standing rules
        # ask for rather than a guessed pairing.
        day = (fx.get('true_start') or fx.get('scheduled_start') or '')[:10]
        key = mk_of(day, fx.get('player1'), fx.get('player2'))
        st['match_key' if key else 'no_match_key'] += 1

        out.append({
            'fixture_id': r['fixture_id'],
            'id_space': 'oddspapi',
            'book': r.get('book') or BOOK,
            'market': MARKET,
            'side': r['side'],
            'line': None,
            'match_key': key,
            'book_rank': RANK_ODDSPAPI,
            # An oddspapi tick time is the BOOK's own tick as the vendor reports
            # it, not a row-write stamp — a different thing from kibl's
            # inserted_on and never to be compared with it unlabelled.
            'ts_kind': 'book-tick',
            'open_price': r.get('open_price'),
            'open_ts': r.get('open_ts'),
            'open_limit': r.get('open_limit'),
            # NULL on this path, and it is a real gap rather than an oversight:
            # oddspapi_line_summary summarises the BOOK's tick series and has
            # never carried the time we fetched it, so there is no observation
            # clock to write. Readers fall back to the tick clock, which is
            # sound here for the reason the sighting path is not — two ticks at
            # two instants are two observations BY THE BOOK, evidence in their
            # own right. Reported as a named NULL column (ladder item J).
            'open_observed_at': None,
            'now_price': r.get('last_tick_price') if now_ok else None,
            'now_ts': r.get('last_tick_ts') if now_ok else None,
            'now_observed_at': None,
            'close_price': close_px,
            'close_ts': close_ts,
            'close_within_60': close_w60,
            'start_ts': r.get('start_ts'),
            'start_ts_source': r.get('start_ts_source') or 'none',
            'start_reject_reason': r.get('start_reject_reason'),
            'source': 'oddspapi',
            'label': None,
            'now_basis': basis,
        })
        st['rows'] += 1
    return out, st


def fallback_rows(matches, covered, as_of):
    """api-tennis fallback — ONLY where oddspapi has nothing for that match.

    Michael: "Fallback: api-tennis only when Oddspapi has nothing for that match.
    Open = first live sighting (first sighting wins forever, never backfilled
    from past-date queries) ... Stored with source = api-tennis, shown with label
    'last seen'."

    `covered` is the set of oddspapi-paired api-tennis event keys. A match in it
    is NOT eligible, however thin its oddspapi row is — "oddspapi has nothing"
    means no row, not a row we like less. Mixing the two sources on one card is
    the cross-book blend the standing rules forbid.

    The Open here is matches.json's `openingOdds`, which refresh-odds-history.py
    stamps with setdefault() on first sighting and never rewrites — that is what
    makes it a first sighting rather than something re-derived at build time.
    A row whose openingOdds came from anywhere else is skipped, not relabelled.
    """
    out, st = [], collections.Counter()
    for m in matches or []:
        key = str(m.get('id') or '')
        if not key:
            st['no_event_key'] += 1
            continue
        if key in covered:
            st['oddspapi_covered'] += 1
            continue
        op = m.get('openingOdds') or {}
        if (op.get('bookmaker') or '').lower() != BOOK:
            # Never a price from another book (standing rule).
            st['open_wrong_book'] += 1
            continue
        seen = epoch(op.get('seenAt'))
        if seen is None:
            st['open_no_timestamp'] += 1
            continue
        mkey = mk_of(m.get('date') or '', m.get('p1'), m.get('p2'))
        st['match_key' if mkey else 'no_match_key'] += 1
        for side, pkey in (('1', 'p1'), ('2', 'p2')):
            price = op.get(pkey)
            if price is None:
                st['open_side_missing'] += 1
                continue
            out.append({
                'fixture_id': key,
                'id_space': 'api-tennis',
                'book': BOOK,
                'market': MARKET,
                'side': side,
                'line': None,
                'match_key': mkey,
                'book_rank': RANK_APITENNIS,
                # A fallback Open is a SIGHTING — the first time we saw a price,
                # not a time the book published one. Labelled as such so it can
                # never be silently compared against a kibl or oddspapi stamp.
                'ts_kind': 'sighting',
                'open_price': float(price),
                'open_ts': iso(seen),
                'open_limit': None,
                # The Open here IS a sighting of ours, so its own stamp is also
                # our observation clock. Written to both so the column is
                # populated wherever the fact exists.
                'open_observed_at': iso(seen),
                # No Now on the fallback in this step: matches.json's `odds`
                # block is whatever book was best, not necessarily bet365, and
                # substituting it would be a cross-book blend.
                'now_price': None, 'now_ts': None, 'now_observed_at': None,
                'close_price': None, 'close_ts': None, 'close_within_60': None,
                'start_ts': None,
                'start_ts_source': 'none',
                'start_reject_reason': None,
                'source': 'api-tennis',
                'label': 'last seen',
                'now_basis': None,
            })
            st['rows'] += 1
    return out, st


def takeover_candidate_rows(matches, as_of):
    """TEN-225 ruling 4a — one row per (fixture, OTHER book) with an Open of its own.

    Michael, 2026-09-18: "A fixture whose current book has an Open but no Now,
    while another book has both, switches ENTIRELY to that book, using its own
    first tick as Open. Skatov/Samrej is the live example (Open from
    bet365-via-api-tennis, Sbo prices it 1.40/2.61)."

    WHY THIS FUNCTION HAD TO EXIST AT ALL. The takeover could not fire because the
    alternative book was never in the table. `odds_card_state` held exactly three
    sources — Kibl/sports411, bet365 via oddspapi, bet365 via api-tennis — so on
    the founder's own example there was no Sbo row to switch TO. This writes them.

    THE OPEN IS `m.bookOpens[book]`, NOT THE CURRENT PRICE. bsp-pipeline.js pins a
    per-book first sighting write-once (pinBookOpens); this reads that pin and
    nothing else. Using today's price as the Open would produce a 0% open->now
    move on every takeover — a number that looks like data and says nothing — and
    would silently rewrite itself every run, which is the exact failure write-once
    exists to prevent.

    THE NOW IS THE SAME BOOK'S CURRENT PAIR, BOTH LEGS. `m.bestOdds` is a
    best-price-PER-SIDE merge across books, so it is accepted only when both sides
    name the SAME bookmaker — a genuine two-sided quote, not a merge. `m.odds` is
    single-book by construction. One book, both legs, or no row.

    NOT WRITTEN FOR A FIXTURE THAT HAS STARTED OR FINISHED: after the off there is
    no Now to be complete about, the selection tier is off, and a row here could
    only add noise. Upcoming only, which is where the ruling lives.

    THIS IS BUILT AHEAD OF ITS DATA. `m.bookOpens` starts empty and accrues
    forward — a first sighting not taken is not recoverable, so the capture cannot
    be backfilled and this function returns 0 rows until it has run. Reported with
    its counters rather than presented as a live behaviour change.
    """
    out, st = [], collections.Counter()
    for m in matches or []:
        key = str(m.get('id') or '')
        opens = m.get('bookOpens') or {}
        if not key or not opens:
            st['no_book_opens'] += 1
            continue
        if m.get('finalScore'):
            st['finished'] += 1
            continue
        # Current pair, per book, both legs from that one book.
        now_by_book = {}
        o = m.get('odds') or {}
        if o.get('bookmaker') and o.get('p1') and o.get('p2'):
            now_by_book[o['bookmaker']] = (float(o['p1']), float(o['p2']))
        bo = m.get('bestOdds') or {}
        b1, b2 = bo.get('p1') or {}, bo.get('p2') or {}
        if (b1.get('bookmaker') and b1['bookmaker'] == b2.get('bookmaker')
                and b1.get('price') and b2.get('price')):
            now_by_book[b1['bookmaker']] = (float(b1['price']), float(b2['price']))

        mkey = mk_of(m.get('date') or '', m.get('p1'), m.get('p2'))
        if not mkey:
            st['no_match_key'] += 1
            continue
        for book, op in opens.items():
            if (book or '').lower() == BOOK:
                # bet365 already has its own ranked row from fallback_rows; a
                # second one at rank 4 would be the same book twice on one
                # fixture, which the selection pass reads as an ambiguity and
                # drops — i.e. it would turn a working card blank.
                st['skip_bet365'] += 1
                continue
            if not (op and op.get('p1') and op.get('p2')):
                st['open_incomplete'] += 1
                continue
            seen = epoch(op.get('seenAt'))
            if seen is None:
                st['open_no_timestamp'] += 1
                continue
            nowpair = now_by_book.get(book)
            st['with_now' if nowpair else 'open_only'] += 1
            for side, idx in (('1', 0), ('2', 1)):
                out.append({
                    'fixture_id': f'{key}#{book}',
                    'id_space': 'api-tennis',
                    'book': book,
                    'market': MARKET,
                    'side': side,
                    'line': None,
                    'match_key': mkey,
                    'book_rank': RANK_OTHER_BOOK,
                    # A first sighting, not a book's own post time — api-tennis
                    # carries no tick time. Same label the bet365 fallback uses,
                    # for the same reason.
                    'ts_kind': 'sighting',
                    'open_price': float(op['p1'] if side == '1' else op['p2']),
                    'open_ts': iso(seen),
                    'open_limit': None,
                    # ── FOUNDER RULING 2026-09-18 09:33Z ITEM 3, SECOND SITE ──
                    # "Report whether the same one-row-two-fields shape exists
                    #  anywhere else in the publisher." It does, HERE, and in a
                    # worse form than the Kibl one the ruling names.
                    #
                    # `bookOpens[book]` is a write-once pin and `now_by_book` is
                    # the current pair off THE SAME api-tennis payload. On the
                    # first run after a book's open is pinned they are one
                    # sighting — but the two stamps DIFFER (open_ts = the pin's
                    # seenAt, now_ts = this run's clock), so unlike the Kibl case
                    # the renderer's equal-timestamps guard cannot see it and a
                    # manufactured "two observations" would pass, rendering 0%
                    # as an evidenced flat market on a fixture we have looked at
                    # exactly once.
                    #
                    # open_observed_at IS seenAt: api-tennis ships no tick time,
                    # so on this source our sighting is the only clock there is
                    # and ts_kind='sighting' already says so.
                    #
                    # now_observed_at is NULL, AND THAT IS THE FIX. `as_of` is
                    # when THIS SCRIPT RAN, not when the price in front of it was
                    # observed — matches.json carries no observation stamp for
                    # `odds`/`bestOdds`. Writing as_of there would assert a
                    # second look we did not take, which is the same false label
                    # one layer down. So the row says plainly that it has no
                    # observation clock for its Now, _measurablePair refuses to
                    # call a flat pair evidenced on a sighting row, and the card
                    # renders both prices with no delta — founder item 2,
                    # verbatim. A real MOVE still renders: two different prices
                    # are their own evidence and need no clock.
                    #
                    # This costs takeover rows the ability to ever show an
                    # evidenced 0%. Reported to the founder rather than papered
                    # over: the fix is one field in bsp-pipeline.js stamping the
                    # api-tennis book payload with its fetch instant (~2 KB on
                    # matches.json), and that is his call, not this file's.
                    'open_observed_at': iso(seen),
                    'now_price': (nowpair[idx] if nowpair else None),
                    'now_ts': (iso(as_of) if nowpair else None),
                    'now_observed_at': None,
                    'close_price': None, 'close_ts': None, 'close_within_60': None,
                    'start_ts': None,
                    'start_ts_source': 'none',
                    'start_reject_reason': None,
                    'source': 'api-tennis',
                    'label': 'last seen',
                    'now_basis': 'not-started' if nowpair else None,
                })
                st['rows'] += 1
    return out, st


# -------------------------------------------------------------------- plumbing

def fetch_page(url, key, table, cols, extra=''):
    out, offset = [], 0
    while True:
        got, err = sb('GET', f'/rest/v1/{table}?select={cols}{extra}'
                             f'&order=fixture_id.asc&limit={PAGE}&offset={offset}',
                      url, key)
        if got is None:
            return out, err
        rows = json.loads(got.decode('utf-8'))
        out.extend(rows)
        if len(rows) < PAGE:
            return out, None
        offset += PAGE


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    url, key = creds()
    as_of = datetime.now(timezone.utc).timestamp()
    result = {'generatedAt': iso(as_of), 'market': MARKET}

    cols = ('fixture_id,book,market,side,line,open_price,open_ts,open_limit,close_price,'
            'close_ts,start_ts,start_ts_source,start_reject_reason,'
            'last_tick_price,last_tick_ts,last_tick_is_prestart,close_reliable')
    summary, err = fetch_page(url, key, 'oddspapi_line_summary', cols,
                              f'&market=eq.{urllib.parse.quote(MARKET)}')
    if err:
        print(f'::error::reading oddspapi_line_summary failed ({err})')
        return 1
    print(f'oddspapi_line_summary: {len(summary)} match-winner rows')

    # NOTE the column names are the TABLE's, not the index's: category_name /
    # scheduled_start / true_start. An earlier draft of this file asked for
    # `level,start_sched` and would have 400'd.
    fx_rows, err = fetch_page(url, key, 'oddspapi_fixtures',
                              'fixture_id,category_name,scheduled_start,'
                              'true_start,player1,player2,status')
    if err:
        # FAIL LOUD. Continuing here would run the fill with an empty fixture
        # map, which does not error — it silently disables the not-started limb
        # of the Now rule, so every upcoming match dashes its Now and the run
        # still reports success. A surface that is wholly empty for a structural
        # reason is the failure mode that hides longest.
        print(f'::error::reading oddspapi_fixtures failed ({err}). Refusing to '
              'fill: without it the not-started Now test cannot run and every '
              'upcoming Now would silently dash on a green run.')
        return 1
    fixtures = {r['fixture_id']: r for r in fx_rows}
    print(f'oddspapi_fixtures: {len(fixtures)} fixtures')

    rows, st = card_rows(summary, fixtures, as_of)
    print(f'oddspapi card rows: {len(rows)}  {dict(st)}')

    # api-tennis fallback, only where oddspapi has nothing.
    fb, fst = [], collections.Counter()
    mpath = os.path.join(HERE, 'matches.json')
    if os.path.exists(mpath):
        d = json.load(open(mpath))
        matches = d.get('matches') if isinstance(d, dict) else d
        covered = {r['fixture_id'] for r in rows}
        fb, fst = fallback_rows(matches, covered, as_of)
        print(f'api-tennis fallback rows: {len(fb)}  {dict(fst)}')
        # TEN-225 ruling 4a — takeover candidates. NOT gated on `covered`: the
        # whole point is to give the selection pass an alternative to a book that
        # HAS an oddspapi row and no Now. The "api-tennis only where oddspapi has
        # nothing" rule governs the FALLBACK; this is a different mechanism, and
        # the ruling that authorises it says so explicitly.
        tk, tkst = takeover_candidate_rows(matches, as_of)
        print(f'takeover candidate rows (ruling 4a): {len(tk)}  {dict(tkst)}')
        # TEN-270 date-key ruling (founder 2026-09-24T10:16Z): an oddspapi key is
        # dated by the fixture's own start; the card's date wins when exactly
        # one board card carries the pair within +/-2 days.
        rk = collections.Counter()
        NAMES.rekey_rows_to_board(rows, matches, rk)
        print(f'date key -> board card (oddspapi rows): {dict(sorted(rk.items()))}')
        result['rekey'] = dict(rk)
        if not tk:
            print('  NOTE: 0 rows. m.bookOpens is pinned write-once by '
                  'bsp-pipeline.js and accrues FORWARD ONLY — a first sighting '
                  'not taken is not recoverable, so this stays 0 until the '
                  'pipeline has run with the capture in place.')
    else:
        print('::warning::matches.json absent — no api-tennis fallback this run.')
        tk, tkst = [], collections.Counter()

    all_rows = rows + fb + tk
    result['counts'] = {'oddspapi': len(rows), 'apiTennis': len(fb),
                        'takeoverCandidates': len(tk),
                        'total': len(all_rows),
                        'oddspapiStats': dict(st), 'fallbackStats': dict(fst)}

    # Coverage, recomputed from THIS run's rows (standing rule), with n.
    have_open = sum(1 for r in all_rows if r['open_price'] is not None)
    have_close = sum(1 for r in all_rows if r['close_price'] is not None)
    have_now = sum(1 for r in all_rows if r['now_price'] is not None)
    n = max(len(all_rows), 1)
    print(f'coverage (n={len(all_rows)} rows): Open {have_open} '
          f'({have_open/n:.1%}), Close {have_close} ({have_close/n:.1%}), '
          f'Now {have_now} ({have_now/n:.1%})'
          + (f'  <-- n<{MIN_N}' if len(all_rows) < MIN_N else ''))
    result['coverage'] = {'n': len(all_rows), 'open': have_open,
                          'close': have_close, 'now': have_now}

    if not a.dry_run and all_rows:
        # now_basis is a report field, not a column on the table.
        payload = [{k: v for k, v in r.items() if k != 'now_basis'}
                   for r in all_rows]
        sent, uerr = L.upsert(url, key, 'odds_card_state', payload,
                              'fixture_id,book,market,side,line')
        print(f'upserted {sent}/{len(payload)} card rows'
              + (f' — FAILED {uerr}' if uerr else ''))
        result['upserted'] = sent
        if uerr:
            result['error'] = str(uerr)
            json.dump(result, open(OUT, 'w'), indent=1)
            return 1

    json.dump(result, open(OUT, 'w'), indent=1)
    print(f'wrote {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
