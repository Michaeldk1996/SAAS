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

# ---------------------------------------------------------------- the ship gate
#
# Founder ruling 2026-09-18 item 2. n >= 30 is NOT the bar for this decision, and
# the reason is not impatience — it is that the sample we can reach is small and
# most of it is uninformative. The bar is evidence, not volume:
#
#   2a  >= 10 fixtures priced by Kibl AND an independent source
#   2b  >= 6 of those LOPSIDED
#   2c  ZERO disagreements inside the lopsided group
#
# LOPSIDED, as the founder defined it — either limb is sufficient:
LOPSIDED_MAX_PRICE = 1.40     # favourite priced at or under 1.40, OR
LOPSIDED_MIN_GAP_PP = 25.0    # implied-probability gap of 25 points or more

MIN_CHECKED = 10              # 2a
MIN_LOPSIDED = 6              # 2b

# ⚠️ WHY THE NEAR-EVEN GROUP CANNOT CARRY THE VERDICT
# A match priced 1.90 / 1.95 is invisible to this test in BOTH directions. Swap
# the two sides and every number on the card still looks right, so an agreement
# there is not evidence the mapping is correct; and Kibl is a SHARP book while
# bet365 and api-tennis are soft, so the two genuinely disagree about which side
# of a coin-flip is favourite without anything being wrong. Counting near-even
# fixtures therefore adds noise to the numerator and the denominator alike.
# Founder 2c: a near-even disagreement is NOTED, not blocking; a lopsided one
# stops the ship.
#
# ⚠️ AND WHY THIS TEST NEVER LOOKS AT PRICE LEVELS
# Founder 2e: sharp-vs-soft divergence is expected and is not a fault. Nothing
# here compares a Kibl price to a bet365 price, or a margin to a margin. The
# only quantity crossing the book boundary is WHICH PLAYER IS CHEAPER — a
# direction, not a value.

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


def favourite_price(prices):
    """The FAVOURITE's decimal price out of a two-sided payload, or None.

    The '<= 1.40' limb of the lopsided test reads this. It is deliberately the
    minimum of the pair rather than "the price on the side we named favourite":
    if the two ever disagreed the mapping would be broken in a way this control
    could not see, and the smaller number is the one the founder's rule names.
    """
    usable = []
    for v in (prices or {}).values():
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        if f > 1.0:
            usable.append(f)
    return min(usable) if len(usable) == 2 else None


def is_lopsided(prices, gap_pp):
    """Founder 2b: favourite price <= 1.40 OR implied gap >= 25 points.

    Either limb is sufficient. They are not redundant: a 1.35 favourite in a
    heavily-margined book can sit under 25 points of gap, and a 1.55 favourite
    in a tight one can clear it.

    Returns (bool, which_limb) so the report can say WHY a fixture counted —
    "6 lopsided" with no reasons is a number nobody can check.
    """
    fp = favourite_price(prices)
    by_price = fp is not None and fp <= LOPSIDED_MAX_PRICE
    by_gap = gap_pp is not None and gap_pp >= LOPSIDED_MIN_GAP_PP
    if by_price and by_gap:
        return True, 'price+gap'
    if by_price:
        return True, 'price'
    if by_gap:
        return True, 'gap'
    return False, None


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

def kibl_favourites(fixtures, prices_by_fixture, ids_by_fixture=None):
    """Kibl fixtures -> {match_key: record}, the favourite under OUR mapping.

    `prices_by_fixture` is {fixture_id: {'1': price, '2': price}} — whatever the
    caller has decided represents that side (the card builder passes Open, which
    is the price the founder's rule names).

    `ids_by_fixture` is the same shape carrying `fixture_participant_id`, and it
    is REPORTING, not logic — founder 2d asks for the Kibl participant ids on
    every line of the evidence so a claim about a player can be traced back to
    the row it came from. It is optional so the harness can drive the control
    without inventing ids.

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
        ids = (ids_by_fixture or {}).get(fid) or {}
        by_key[k] = {'match_key': k, 'fixture_id': fid, 'fav': fav,
                     'gap_pp': gap, 'day': day,
                     'p1': p1, 'p2': p2,
                     'participant_ids': {p1: ids.get('1'), p2: ids.get('2')},
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

        # Founder 2b. BOTH sides of the comparison must be lopsided for the
        # fixture to carry the verdict. Requiring it of Kibl alone would let a
        # mis-mapped Kibl reading certify its own evidence; requiring it of the
        # independent source alone would count a fixture whose Kibl prices are
        # too close together to point anywhere.
        k_lop, k_limb = is_lopsided(kr['prices'], kr['gap_pp'])
        lop_readings = {lbl: is_lopsided(r['prices'], r['gap_pp'])
                        for lbl, r in usable.items()}
        i_lop = any(v[0] for v in lop_readings.values())

        out[k] = {
            'verdict': 'disagree' if disagreeing else 'agree',
            'reason': None,
            'kibl': kr,
            'readings': usable,
            'disagreeing': sorted(disagreeing),
            'group': 'lopsided' if (k_lop and i_lop) else 'near-even',
            'lopsided': {
                'kibl': k_lop, 'kiblLimb': k_limb,
                'independent': i_lop,
                'byReading': {lbl: {'lopsided': v[0], 'limb': v[1]}
                              for lbl, v in lop_readings.items()},
            },
        }
    return out


# ------------------------------------------------------------------- ship gate

def ship_gate(verdict_map, min_checked=MIN_CHECKED, min_lopsided=MIN_LOPSIDED):
    """Founder ruling 2026-09-18 item 2a–2e, as a pass/fail with its evidence.

    This REPLACES n >= 30 for the side-mapping decision only. Everywhere else the
    standing rule stands, and `agreement()` still flags n < 30 — the two live
    side by side deliberately, so a reader can see both the founder's bar and
    the standing one rather than having the standing one quietly redefined.

    `passes` is False on an empty sample by construction: 0 >= 10 is false. A
    control that has checked nothing has not passed — the specific failure that
    put this whole gate in the founder's hands.

    Nothing here writes, dashes or ships. It reports, and item 6 turns a pass
    into a deploy.
    """
    checked = {k: v for k, v in verdict_map.items()
               if v['verdict'] in ('agree', 'disagree')}
    lop = {k: v for k, v in checked.items() if v['group'] == 'lopsided'}
    near = {k: v for k, v in checked.items() if v['group'] == 'near-even'}
    lop_dis = sorted(k for k, v in lop.items() if v['verdict'] == 'disagree')
    near_dis = sorted(k for k, v in near.items() if v['verdict'] == 'disagree')

    criteria = {
        '2a_fixtures_both_sources': {
            'required': f'>= {min_checked}', 'actual': len(checked),
            'pass': len(checked) >= min_checked},
        '2b_lopsided_fixtures': {
            'required': f'>= {min_lopsided}', 'actual': len(lop),
            'pass': len(lop) >= min_lopsided},
        '2c_lopsided_disagreements': {
            'required': '== 0', 'actual': len(lop_dis),
            'pass': not lop_dis},
    }
    return {
        'passes': all(c['pass'] for c in criteria.values()),
        'criteria': criteria,
        'thresholds': {'lopsidedMaxPrice': LOPSIDED_MAX_PRICE,
                       'lopsidedMinGapPP': LOPSIDED_MIN_GAP_PP,
                       'minGapPP': MIN_GAP_PP},
        # The two groups are reported separately, never pooled into one rate.
        'lopsided': {
            'n': len(lop),
            'agree': len(lop) - len(lop_dis),
            'disagree': len(lop_dis),
            'blocking': True,
            'disagreements': [_evidence(lop[k]) for k in lop_dis],
        },
        'nearEven': {
            'n': len(near),
            'agree': len(near) - len(near_dis),
            'disagree': len(near_dis),
            'blocking': False,
            'disagreements': [_evidence(near[k]) for k in near_dis],
        },
        # Founder 2d: every fixture individually, not a percentage.
        'fixtures': [_fixture_line(checked[k]) for k in sorted(checked)],
    }


def _fixture_line(v):
    """One readable row of the founder's 2d evidence table.

    Carries the Kibl participant ids, BOTH sides' Kibl prices, every independent
    source's prices, both implied gaps and the verdict. Prices are keyed by
    PLAYER NAME rather than by slot throughout, because the whole finding this
    gate exists to prevent is a slot that names the wrong player.
    """
    kr = v['kibl']
    best = max(v['readings'].items(), key=lambda kv: kv[1]['gap_pp'],
               default=(None, None))
    return {
        'match_key': kr['match_key'],
        'day': kr['day'],
        'group': v['group'],
        'verdict': v['verdict'],
        'kibl': {
            'fixture_id': kr['fixture_id'],
            'fixture': f"{kr['p1']} vs {kr['p2']}",
            'participant_ids': kr.get('participant_ids') or {},
            'prices': kr['prices'],
            'favourite': kr['fav'],
            'gap_pp': round(kr['gap_pp'], 2),
            'favourite_price': favourite_price(kr['prices']),
            'lopsided': v['lopsided']['kibl'],
            'limb': v['lopsided']['kiblLimb'],
        },
        'independent': {
            lbl: {'book': r.get('book'), 'prices': r['prices'],
                  'favourite': r['fav'], 'gap_pp': round(r['gap_pp'], 2),
                  'favourite_price': favourite_price(r['prices']),
                  'lopsided': v['lopsided']['byReading'][lbl]['lopsided'],
                  'limb': v['lopsided']['byReading'][lbl]['limb']}
            for lbl, r in v['readings'].items()},
        'bestIndependent': best[0],
        'agrees': v['verdict'] == 'agree',
    }


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
