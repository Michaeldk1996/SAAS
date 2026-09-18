#!/usr/bin/env python3
"""TEN-225 — the free api-tennis arm of the side-mapping cross-check.

WHY THIS EXISTS
---------------
The ship gate stalled at 2 checked fixtures and 0 lopsided ones, and run
35297627315 measured why. Over a FULL SEVEN-DAY window Kibl serves 72 men's
fixtures and prices 25 of them:

    league  19 ATP          3 fixtures,   8 market rows
    league 537 Challenger  27 fixtures, 252 market rows
    league 962 ITF Men     42 fixtures,   0 market rows

Widening the horizon from 3 days to 7 added nothing (73 -> 72 fixtures), so the
blocker is not the poll cadence and not our name matcher — `why_unpaired()` put
all 23 unpaired fixtures in `not_on_board` and zero in `surname_on_board`. Kibl
prices CHALLENGER matches; our board's priced upcoming set is Davis Cup and ATP.
The two universes barely intersect, so no amount of polling either side closes
the gap.

api-tennis does intersect both. MEASURED 2026-09-18 on date 2026-09-18:
220 fixtures, 122 with Home/Away prices, spread across every tier —
Challenger Men 17, ITF Men 32, ATP 28, Teams (Davis Cup) 12. Three of the four
unpaired Kibl fixtures sampled by hand carry prices here, two of them lopsided.

It is the RIGHT source under the founder's item 1 as well as the available one:
"prefer Kibl and free endpoints wherever oddspapi is not specifically required."
get_odds is bulk-by-date on the api-tennis key and spends ZERO oddspapi units.

⚠️ THIS ARM HAS ITS OWN ORIENTATION ASSUMPTION, AND IT WAS TESTED BEFORE USE
---------------------------------------------------------------------------
`Home` is assumed to be `event_first_player`. That is exactly the shape of
assumption that produced the Kibl side_id defect, and using an unvalidated
orientation to referee another unvalidated orientation would prove nothing at
all — it would just move the guess one file to the left.

So it was measured against bet365 first, on matches where the two overlap and
the market is separated enough to read (2026-09-17..19, gap >= 5pp):

    agree 9, disagree 0, n 9

Nine is not a large sample and it is not claimed to be one. It is a DIFFERENT
claim from the gate's: the gate asks whether Kibl's mapping is right, and this
asks whether the referee is pointed the right way round. `validate_home_away()`
re-runs that check on every job so it cannot rot silently, and the caller is
expected to refuse the arm if it ever disagrees.

Stdlib only. The key is read by the caller and never printed.
"""
import json
import urllib.parse
import urllib.request

BASE = 'https://api.api-tennis.com/tennis/'

# The only market this step reads. Founder's locked scope is match winner.
MARKET = 'Home/Away'


def _call(method, key, timeout=90, **params):
    """One api-tennis call -> (result, error). Never raises, never logs the key.

    Returns the error as a STRING rather than swallowing it: an arm that fails
    silently would shrink the evidence set and read as "Kibl has no referee",
    which is the same symptom as genuine non-coverage and has a different cause.
    """
    q = urllib.parse.urlencode({'method': method, 'APIkey': key, **params})
    try:
        with urllib.request.urlopen(f'{BASE}?{q}', timeout=timeout) as r:
            payload = json.loads(r.read())
    except Exception as e:  # transport, HTTP, or unparseable body
        # str(e) on urllib carries the URL on some paths, and the URL carries
        # the key. Only the exception TYPE is ever surfaced.
        return None, f'{method}: {type(e).__name__}'
    if not payload.get('success'):
        return None, f'{method}: success={payload.get("success")}'
    return payload.get('result'), None


def fixtures_and_odds(key, day):
    """One day -> [{p1, p2, day, tier, prices: {p1: price, p2: price}}].

    Two calls per day, both free. Fixtures and odds are joined on `event_key`;
    a fixture with no odds entry is simply absent rather than carried with a
    null price, because a match nobody prices is not evidence of anything.

    Where several books quote a side, the SHORTEST price is taken for that
    side. Founder 2e forbids comparing price levels across books and nothing
    here does — only the direction survives, and taking the best price on each
    side is the reading least likely to invent a favourite out of one book's
    margin.
    """
    fx, err = _call('get_fixtures', key, date_start=day, date_stop=day)
    if err:
        return [], err
    od, err = _call('get_odds', key, date_start=day, date_stop=day)
    if err:
        return [], err
    od = od if isinstance(od, dict) else {}

    out = []
    for f in (fx or []):
        if not isinstance(f, dict):
            continue
        ha = (od.get(str(f.get('event_key'))) or {}).get(MARKET) or {}
        home, away = ha.get('Home') or {}, ha.get('Away') or {}
        if not (home and away):
            continue
        # ASSUMPTION UNDER TEST — see the header. Home is event_first_player.
        p1 = f.get('event_first_player')
        p2 = f.get('event_second_player')
        hp, ap = _best(home), _best(away)
        if not (p1 and p2 and hp and ap):
            continue
        out.append({'p1': p1, 'p2': p2, 'day': day,
                    'tier': f.get('event_type_type'),
                    'event_key': f.get('event_key'),
                    'books': {'home': sorted(home), 'away': sorted(away)},
                    'prices': {p1: hp, p2: ap}})
    return out, None


def _best(side):
    """The shortest quoted decimal price on one side, or None."""
    vals = []
    for v in (side or {}).values():
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        if f > 1.0:
            vals.append(f)
    return min(vals) if vals else None
