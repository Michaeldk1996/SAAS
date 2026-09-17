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

        out.append({
            'fixture_id': r['fixture_id'],
            'id_space': 'oddspapi',
            'book': r.get('book') or BOOK,
            'market': MARKET,
            'side': r['side'],
            'line': None,
            'open_price': r.get('open_price'),
            'open_ts': r.get('open_ts'),
            'open_limit': r.get('open_limit'),
            'now_price': r.get('last_tick_price') if now_ok else None,
            'now_ts': r.get('last_tick_ts') if now_ok else None,
            'close_price': r.get('close_price'),
            'close_ts': r.get('close_ts'),
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
                'open_price': float(price),
                'open_ts': iso(seen),
                'open_limit': None,
                # No Now on the fallback in this step: matches.json's `odds`
                # block is whatever book was best, not necessarily bet365, and
                # substituting it would be a cross-book blend.
                'now_price': None, 'now_ts': None,
                'close_price': None, 'close_ts': None,
                'start_ts': None,
                'start_ts_source': 'none',
                'start_reject_reason': None,
                'source': 'api-tennis',
                'label': 'last seen',
                'now_basis': None,
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
                              'fixture_id,category_name,scheduled_start,status')
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
    else:
        print('::warning::matches.json absent — no api-tennis fallback this run.')

    all_rows = rows + fb
    result['counts'] = {'oddspapi': len(rows), 'apiTennis': len(fb),
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
