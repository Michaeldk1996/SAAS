#!/usr/bin/env python3
"""TEN-225 — is Kibl's side_id 1/2 the same pair of players everyone else's is?

WHY THIS FILE EXISTS
--------------------
`ten225-kibl-card-state.py:side_label()` ASSERTS that Kibl's `side_id` 1 is the
first player named in the fixture string and 2 the second. Nothing measured it.
An orientation that is silently reversed does not crash and does not dash — it
renders the favourite's price on the underdog, which is the single worst failure
this product can have, because every number on the card stays plausible.

Founder ruling 2026-09-18 item 1: *"do not render any Kibl price until this is
verified ... verify today using upcoming fixtures, not finished ones ... add a
permanent guard: if a Kibl fixture's favourite disagrees with an independent
source on the same match, dash it and log it, rather than display."*

So this module does two jobs from ONE rule, which is why it is a module and not
two copies of a comparison:

  1. `agreement()` — the REPORT. Agreement %, n, and every disagreement with
     both payloads.
  2. `verdicts()` — the PERMANENT GUARD the card builder consults per fixture.

⚠️ COMPARE PLAYERS, NEVER SLOTS
-------------------------------
The first version of this control (`orientation_agreement()` in the card
builder) compared Kibl's side '1' against oddspapi's side '1' directly. That is
wrong, and today's board proves it rather than merely suggesting it: Kibl names
one fixture `6112 Dhakshineswar Suresh vs Soonwoo Kwon` while our board names
the same match `S. Kwon` vs `D. Suresh` — **the two feeds order the players
oppositely**. `match_key()` sorts its two name keys precisely so that ordering
cannot leak into identity, which means a slot-vs-slot comparison is not testing
Kibl's convention at all; it is testing whether two feeds happened to agree on
an order they were never obliged to share.

Every comparison here therefore resolves each source's favourite to a
`name_key` and compares NAMES. A reversed Kibl convention then collapses
agreement toward 0%, and a mere ordering difference between feeds costs nothing.

NOT CIRCULAR
------------
Kibl's favourite is computed under OUR assumed mapping; each independent
source's favourite is computed from ITS own orientation, which nothing in the
Kibl path touches. The board's `p1`/`p2` come from api-tennis fixtures and its
prices from api-tennis books or from oddspapi bet365 — no Kibl value reaches
`matches.json`, which has nothing member-visible from this path at all.

NEAR-EVEN MATCHES CARRY NO SIGNAL
---------------------------------
A match priced 1.90 / 1.95 tells you nothing about orientation: both mappings
predict roughly the same thing, and counting it dilutes the rate toward 50%
whichever way the convention runs. Only matches where BOTH sources separate the
players by at least `MIN_GAP_PP` implied-probability points are counted, and the
skipped ones are reported rather than dropped silently.

Stdlib only. No network, no secrets, no I/O — every function here is pure, so
the harness can drive it on hand-built payloads including the reversed-universe
control.
"""
import collections

from ten225_names import match_key as mk_of, name_key, split_kibl_fixture_name

# Implied-probability points. Below this the match is not separated enough to
# carry orientation signal either way.
MIN_GAP_PP = 5.0

# Standing rule: flag anything below this.
MIN_N = 30

# The independent price sources carried on a board match, in the order they are
# preferred for the report's "best" column. Each is (field, source, book-or-None
# meaning "the payload names its own book").
#
# `bet365Now` and `openingOdds` are oddspapi bet365; `odds` is the api-tennis
# best-book price. All three are oriented to the board's OWN p1/p2 and none of
# them can see a Kibl row.
BOARD_SOURCES = (
    ('bet365Now', 'oddspapi', 'bet365'),
    ('openingOdds', 'oddspapi', 'bet365'),
    ('odds', 'api-tennis', None),
)


def implied_gap_pp(price_a, price_b):
    """(1/a - 1/b) in probability POINTS, or None if either price is unusable.

    The difference is taken WITHIN one book, so the book's overround cancels in
    the sign — which is all this control reads. A decimal price of 1.0 or less
    is not a price; it is a placeholder, and treating it as one would mint a
    huge false gap.
    """
    try:
        a, b = float(price_a), float(price_b)
    except (TypeError, ValueError):
        return None
    if a <= 1.0 or b <= 1.0:
        return None
    return (1.0 / a - 1.0 / b) * 100.0


def favourite(prices):
    """{name_key: decimal price} -> (favourite_key, gap_pp) or (None, reason).

    Exactly two priced sides are required. The favourite is the LOWER price, as
    the founder specified. `gap_pp` is always positive and measures how far the
    favourite is clear of the other side.
    """
    usable = {k: v for k, v in (prices or {}).items()
              if k and v is not None}
    if len(usable) != 2:
        return None, 'not_two_sides'
    (ka, pa), (kb, pb) = sorted(usable.items())
    gap = implied_gap_pp(pa, pb)
    if gap is None:
        return None, 'unusable_price'
    if gap == 0:
        return None, 'tied_price'
    # gap > 0 means ka carries the HIGHER implied probability, i.e. the lower
    # decimal price, i.e. ka is the favourite.
    return (ka if gap > 0 else kb), abs(gap)


# ------------------------------------------------------------------ the sources

def kibl_favourites(fixtures, prices_by_fixture):
    """Kibl fixtures -> {match_key: record}, the favourite under OUR mapping.

    `prices_by_fixture` is {fixture_id: {'1': price, '2': price}} — whatever the
    caller has decided represents that side (the card builder passes Open, which
    is the price the founder's rule names).

    side '1' -> the fixture string's FIRST player, side '2' -> the second. That
    is the assertion under test, so it is applied here and nowhere else.

    DROPS ON AMBIGUITY: two Kibl fixtures keying to one match means we cannot
    say which priced which, and a guessed pairing would be reported as evidence.
    """
    by_key, ambiguous, st = {}, set(), collections.Counter()
    for fx in fixtures:
        fid = fx.get('fixture_id')
        p1 = fx.get('player1_name')
        p2 = fx.get('player2_name')
        if not (p1 and p2):
            # Fall back to the one-string fixture name. `player1_name` being
            # empty is exactly the failure shape that hid for a day on
            # oddspapi_fixtures, so this path is counted, not assumed absent.
            p1, p2 = split_kibl_fixture_name(fx.get('name'))
            if p1 and p2:
                st['kibl_name_split_fallback'] += 1
        day = (fx.get('scheduled_start') or '')[:10]
        k = mk_of(day, p1, p2)
        if not k:
            st['kibl_unkeyable'] += 1
            continue
        prices = prices_by_fixture.get(fid) or {}
        fav, gap = favourite({name_key(p1): prices.get('1'),
                              name_key(p2): prices.get('2')})
        if fav is None:
            st[f'kibl_{gap}'] += 1
            continue
        if k in by_key:
            ambiguous.add(k)
        by_key[k] = {'match_key': k, 'fixture_id': fid, 'fav': fav,
                     'gap_pp': gap, 'day': day,
                     'p1': p1, 'p2': p2,
                     'prices': {p1: prices.get('1'), p2: prices.get('2')}}
    for k in ambiguous:
        by_key.pop(k, None)
        st['kibl_ambiguous_dropped'] += 1
    st['kibl_usable'] = len(by_key)
    return by_key, st


def board_favourites(matches):
    """matches.json -> {match_key: {source_label: record}} for every priced side.

    One board match can contribute up to three independent readings (api-tennis
    best book, oddspapi bet365 now, oddspapi bet365 open). They are kept SEPARATE
    rather than collapsed to one, so a disagreement is attributable to a source
    instead of to "the board".
    """
    out, ambiguous, st = {}, set(), collections.Counter()
    for m in matches or []:
        day = (m.get('date') or '')[:10]
        p1, p2 = m.get('p1'), m.get('p2')
        k = mk_of(day, p1, p2)
        if not k:
            st['board_unkeyable'] += 1
            continue
        if k in out:
            ambiguous.add(k)
        k1, k2 = name_key(p1), name_key(p2)
        readings = {}
        for field, source, fixed_book in BOARD_SOURCES:
            payload = m.get(field)
            if not isinstance(payload, dict):
                continue
            fav, gap = favourite({k1: payload.get('p1'), k2: payload.get('p2')})
            if fav is None:
                st[f'board_{field}_{gap}'] += 1
                continue
            readings[f'{source}:{field}'] = {
                'source': source,
                'field': field,
                'book': fixed_book or payload.get('bookmaker'),
                'fav': fav, 'gap_pp': gap,
                'prices': {p1: payload.get('p1'), p2: payload.get('p2')},
                'at': payload.get('at') or payload.get('seenAt'),
            }
            st[f'board_reading_{source}'] += 1
        if readings:
            out[k] = {'match_key': k, 'id': m.get('id'), 'day': day,
                      'p1': p1, 'p2': p2, 'tour': m.get('tour'),
                      'readings': readings}
        else:
            st['board_no_usable_price'] += 1
    for k in ambiguous:
        out.pop(k, None)
        st['board_ambiguous_dropped'] += 1
    st['board_usable'] = len(out)
    return out, st


def oddspapi_favourites(odds_index):
    """The existing oddspapi pairing index -> {match_key: reading}.

    ⚠️ The index's `sides` are keyed '1'/'2' against ODDSPAPI's OWN player order,
    which is not necessarily Kibl's — so the caller must pass the fixture's
    player names alongside, and the favourite is resolved to a NAME here. This is
    the bug in the first version of the control: it compared slot to slot.
    """
    out = {}
    for k, rec in (odds_index or {}).items():
        p1, p2 = rec.get('player1'), rec.get('player2')
        if not (p1 and p2):
            continue
        sides = rec.get('sides') or {}
        fav, gap = favourite({
            name_key(p1): (sides.get('1') or {}).get('open_price'),
            name_key(p2): (sides.get('2') or {}).get('open_price'),
        })
        if fav is None:
            continue
        out[k] = {'source': 'oddspapi', 'field': 'line_summary_open',
                  'book': 'bet365', 'fav': fav, 'gap_pp': gap,
                  'prices': {p1: (sides.get('1') or {}).get('open_price'),
                             p2: (sides.get('2') or {}).get('open_price')}}
    return out


# --------------------------------------------------------------- the comparison

def verdicts(kibl_index, independent, min_gap_pp=MIN_GAP_PP):
    """{match_key: 'agree' | 'disagree' | 'unchecked'} plus the evidence.

    `independent` is {match_key: {label: reading}} — every reading available for
    that match from every source that is not Kibl.

    A match is `disagree` if ANY independent reading that is separated enough to
    carry signal names a different favourite. One dissenting source is enough:
    the founder's guard is "if a Kibl fixture's favourite disagrees with an
    independent source ... dash it", not "if a majority disagrees".

    `unchecked` covers both "no independent price" and "nothing separated enough
    to read" — the two are distinguished in `reason`, because a run that reports
    a bare zero cannot say which of them it hit.
    """
    out = {}
    for k, kr in kibl_index.items():
        readings = (independent.get(k) or {})
        if not readings:
            out[k] = {'verdict': 'unchecked', 'reason': 'no_independent_price',
                      'kibl': kr, 'readings': {}}
            continue
        if kr['gap_pp'] < min_gap_pp:
            out[k] = {'verdict': 'unchecked', 'reason': 'kibl_near_even',
                      'kibl': kr, 'readings': readings}
            continue
        usable = {lbl: r for lbl, r in readings.items()
                  if r['gap_pp'] >= min_gap_pp}
        if not usable:
            out[k] = {'verdict': 'unchecked', 'reason': 'independent_near_even',
                      'kibl': kr, 'readings': readings}
            continue
        disagreeing = {lbl: r for lbl, r in usable.items()
                       if r['fav'] != kr['fav']}
        out[k] = {
            'verdict': 'disagree' if disagreeing else 'agree',
            'reason': None,
            'kibl': kr,
            'readings': usable,
            'disagreeing': sorted(disagreeing),
        }
    return out


def agreement(verdict_map, min_n=MIN_N):
    """The reportable summary. REPORT ONLY — it never changes a price.

    `rate` is None at n=0 rather than 1.0. A control that has checked nothing has
    not passed; reporting 100% for an empty sample is how the first version of
    this check shipped a green run on n=0.
    """
    agree = [k for k, v in verdict_map.items() if v['verdict'] == 'agree']
    disagree = [k for k, v in verdict_map.items() if v['verdict'] == 'disagree']
    unchecked = collections.Counter(
        v['reason'] for v in verdict_map.values()
        if v['verdict'] == 'unchecked')
    n = len(agree) + len(disagree)

    by_source = collections.defaultdict(lambda: {'agree': 0, 'disagree': 0})
    for v in verdict_map.values():
        if v['verdict'] == 'unchecked':
            continue
        for lbl, r in v['readings'].items():
            bucket = 'agree' if r['fav'] == v['kibl']['fav'] else 'disagree'
            by_source[lbl][bucket] += 1

    return {
        'n': n,
        'agree': len(agree),
        'disagree': len(disagree),
        'rate': (len(agree) / n) if n else None,
        'belowMinN': n < min_n,
        'passes': bool(n) and not disagree,
        'minGapPP': MIN_GAP_PP,
        'unchecked': dict(unchecked),
        'uncheckedTotal': sum(unchecked.values()),
        'bySource': {k: dict(v) for k, v in by_source.items()},
        'disagreements': [_evidence(verdict_map[k]) for k in sorted(disagree)],
    }


def _evidence(v):
    """A disagreement with BOTH payloads, as the founder asked — not a count.

    Prices are carried as {player name: price} rather than as a slot pair, so
    the report reads as an accusation about players and can be checked by eye
    against the site.
    """
    return {
        'match_key': v['kibl']['match_key'],
        'kibl': {'fixture_id': v['kibl']['fixture_id'],
                 'fixture': f"{v['kibl']['p1']} vs {v['kibl']['p2']}",
                 'favourite': v['kibl']['fav'],
                 'gap_pp': round(v['kibl']['gap_pp'], 2),
                 'prices': v['kibl']['prices']},
        'independent': {
            lbl: {'book': r.get('book'), 'favourite': r['fav'],
                  'gap_pp': round(r['gap_pp'], 2), 'prices': r['prices']}
            for lbl, r in v['readings'].items()},
        'disagreeing': v['disagreeing'],
    }
