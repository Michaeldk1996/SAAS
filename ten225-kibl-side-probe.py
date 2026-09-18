#!/usr/bin/env python3
"""TEN-225 — what IS a Kibl side_id, actually?

Run 35295003126 measured the shape that makes this script necessary:

    side_id shapes per priced fixture: {'2+3': 25}

Every one of the 25 priced fixtures carries side_id 2 and side_id 3. **side_id 1
never appears.** Our shipped `side_label()` maps 1 -> player 1 and 2 -> player 2
and drops everything else, so on today's data it writes every Kibl price into
side '2' and dashes the other half of a two-way market as "unknown side".

That is not a mapping that is merely unverified. It is a mapping whose first
branch is unreachable and whose reject branch is holding one of the two
participants. So the question is no longer "is 1 -> player 1 correct" but
"which participant is 2, and which is 3".

`kibl_line_observations` already stores `participant_id`, `fixture_participant_id`
and the whole `raw_object`, and the DDL audit confirmed none of them is NULL.
If the raw payload names its participant, the mapping is answerable from data we
already hold, with no vendor call and no guess.

REPORT ONLY. Writes nothing, changes no price. Reads SUPABASE_URL /
SUPABASE_SECRET_KEY. Stdlib only. Secrets never printed.
"""
import argparse
import collections
import json
import os
import sys
import types
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'ten225-kibl-side-probe.json')

K = types.ModuleType('K')
K.__file__ = os.path.join(HERE, 'ten225-kibl-card-state.py')
_argv, sys.argv = sys.argv, ['K']
exec(compile(open(K.__file__).read(), K.__file__, 'exec'), K.__dict__)
sys.argv = _argv

from ten225_names import name_key  # noqa: E402

# Keys worth hunting for inside raw_object. The live payload is not the swagger's
# (measured repeatedly on this feed), so the search is by NAME ACROSS THE WHOLE
# OBJECT rather than at a documented path — and every key found is reported, not
# just the first, because picking one silently is how the wrong one gets adopted.
NAME_HINTS = ('participant', 'name', 'team', 'player', 'competitor', 'side',
              'home', 'away', 'abbr', 'short')


def walk(o, path=''):
    """Every (path, scalar) in a nested payload."""
    if isinstance(o, dict):
        for k, v in o.items():
            yield from walk(v, f'{path}.{k}')
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from walk(v, f'{path}[{i}]')
    else:
        yield path, o


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--days-back', type=int, default=3)
    a = ap.parse_args()

    url, key = K.creds()
    as_of = datetime.now(timezone.utc).timestamp()

    fx, err = K.fetch_all(url, key, 'kibl_fixtures',
                          'fixture_id,name,player1_name,player2_name,'
                          'scheduled_start,match_key,league_id')
    if err:
        print(f'::error::reading kibl_fixtures failed ({err})')
        return 1
    fx_by_id = {f['fixture_id']: f for f in fx}
    print(f'kibl_fixtures: {len(fx)}')

    obs, err = K.fetch_all(
        url, key, 'kibl_line_observations',
        'fixture_id,side_id,participant_id,fixture_participant_id,market_id,'
        'price_decimal,is_opener,inserted_on,raw_object',
        f'&market_type_id=eq.{K.MARKET_TYPE_ID}&segment_id=eq.{K.SEGMENT_ID}'
        f'&betting_type_id=eq.{K.BETTING_TYPE_ID}'
        f'&observed_at=gte.{K.iso(as_of - a.days_back * 86400)}',
        order='fixture_id.asc,inserted_on.asc')
    if err:
        print(f'::error::reading kibl_line_observations failed ({err})')
        return 1
    print(f'match-winner observations: {len(obs)}')
    if not obs:
        print('::error::no observations in the window — this run answers '
              'nothing. Refusing to report an empty probe as a result.')
        return 1

    result = {'generatedAt': K.iso(as_of), 'observations': len(obs)}

    # ---------------------------------------------------- 1. the side_id census
    sid = collections.Counter(o.get('side_id') for o in obs)
    print(f'\nside_id census over {len(obs)} match-winner rows: {dict(sid)}')
    result['sideIdCensus'] = {str(k): v for k, v in sid.items()}

    per_fx = collections.defaultdict(set)
    for o in obs:
        per_fx[o['fixture_id']].add(o.get('side_id'))
    shapes = collections.Counter(
        '+'.join(str(x) for x in sorted(s, key=lambda v: (v is None, v)))
        for s in per_fx.values())
    print(f'side_id shape per fixture ({len(per_fx)} fixtures): {dict(shapes)}')
    result['shapes'] = dict(shapes)

    # ------------------------------------- 2. does side_id track a participant?
    # The decisive question. If (fixture, side_id) -> exactly one participant_id
    # then side_id IS a stable participant slot and only the LABELLING is open.
    # If it is one-to-many, side_id is not a participant axis at all.
    pairs = collections.defaultdict(set)
    for o in obs:
        pairs[(o['fixture_id'], o.get('side_id'))].add(o.get('participant_id'))
    multi = {k: sorted(v) for k, v in pairs.items() if len(v) > 1}
    print(f'\n(fixture, side_id) -> participant_id: '
          f'{len(pairs)} pairs, {len(multi)} with MORE THAN ONE participant')
    result['sideToParticipant'] = {
        'pairs': len(pairs), 'ambiguous': len(multi),
        'stable': not multi,
        'examples': [{'fixture_id': k[0], 'side_id': k[1], 'participants': v}
                     for k, v in list(multi.items())[:10]]}
    if multi:
        print('::warning::side_id does NOT pin a participant on '
              f'{len(multi)} (fixture, side) pairs — it cannot be a player axis')
    else:
        print('side_id pins exactly one participant_id per fixture — it IS a '
              'stable participant slot; what is open is which player it names')

    # participant_id per fixture: two distinct ids is a two-way market seen
    # correctly, whatever the side_id values happen to be.
    ppf = collections.defaultdict(set)
    for o in obs:
        ppf[o['fixture_id']].add(o.get('participant_id'))
    n_two = sum(1 for v in ppf.values() if len(v) == 2)
    print(f'fixtures with exactly TWO distinct participant_ids: '
          f'{n_two} of {len(ppf)}')
    result['twoParticipantFixtures'] = {'n': n_two, 'of': len(ppf)}

    # ------------------------------------------- 3. does raw_object name them?
    keys = collections.Counter()
    samples = collections.defaultdict(list)
    for o in obs:
        raw = o.get('raw_object')
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except ValueError:
                continue
        if not isinstance(raw, (dict, list)):
            continue
        for path, val in walk(raw):
            leaf = path.rsplit('.', 1)[-1].lower()
            if isinstance(val, str) and val.strip() and any(
                    h in leaf for h in NAME_HINTS):
                keys[path] += 1
                if len(samples[path]) < 4:
                    samples[path].append(
                        {'fixture_id': o['fixture_id'],
                         'side_id': o.get('side_id'),
                         'participant_id': o.get('participant_id'),
                         'value': val[:80]})
    print(f'\nraw_object string fields whose key looks name-like: {len(keys)}')
    for p, n in keys.most_common(15):
        print(f'  {p}  n={n}  e.g. {[s["value"] for s in samples[p]][:2]}')
    result['rawNameFields'] = {p: {'n': n, 'samples': samples[p]}
                               for p, n in keys.most_common(25)}

    # ------------------- 4. can any of those fields be matched to our two names?
    # A field only resolves the mapping if its value keys to ONE of the fixture's
    # two players. A field that matches both, or neither, tells us nothing.
    resolving = {}
    for path in keys:
        hit = miss = 0
        agree_side = collections.Counter()
        for s in samples[path]:
            f = fx_by_id.get(s['fixture_id'])
            if not f:
                continue
            k1, k2 = name_key(f.get('player1_name')), name_key(f.get('player2_name'))
            kv = name_key(s['value'])
            if kv and kv == k1:
                hit += 1
                agree_side[f"side{s['side_id']}->player1"] += 1
            elif kv and kv == k2:
                hit += 1
                agree_side[f"side{s['side_id']}->player2"] += 1
            else:
                miss += 1
        if hit:
            resolving[path] = {'matched': hit, 'unmatched': miss,
                               'mapping': dict(agree_side)}
    if resolving:
        print('\nFIELDS THAT RESOLVE TO ONE OF THE FIXTURE\'S TWO PLAYERS:')
        for p, r in resolving.items():
            print(f'  {p}: {r}')
    else:
        print('\nNo raw_object field resolves to either fixture player by name '
              'key — the mapping is NOT answerable from the stored payload, and '
              'this run says so rather than guessing.')
    result['resolvingFields'] = resolving

    # ----------------------------------------------- 5. one fully-dumped fixture
    # A census answers "what shape"; a single complete example answers "what IS
    # it", and it is what a question to Bet105 can quote.
    target = next((f for f, s in per_fx.items() if len(s) >= 2), None)
    if target is not None:
        rows = [o for o in obs if o['fixture_id'] == target]
        f = fx_by_id.get(target, {})
        print(f'\nfixture {target}: {f.get("name")!r} '
              f'(p1={f.get("player1_name")!r} p2={f.get("player2_name")!r})')
        for o in rows[:12]:
            print(f'  side_id={o.get("side_id")} '
                  f'participant_id={o.get("participant_id")} '
                  f'fixture_participant_id={o.get("fixture_participant_id")} '
                  f'price={o.get("price_decimal")} opener={o.get("is_opener")} '
                  f'at={o.get("inserted_on")}')
        result['exampleFixture'] = {
            'fixture_id': target, 'fixture': f.get('name'),
            'player1_name': f.get('player1_name'),
            'player2_name': f.get('player2_name'),
            'rows': [{k: o.get(k) for k in
                      ('side_id', 'participant_id', 'fixture_participant_id',
                       'price_decimal', 'is_opener', 'inserted_on')}
                     for o in rows[:25]],
            'rawObjectSample': rows[0].get('raw_object')}

    json.dump(result, open(OUT, 'w'), indent=1, default=str)
    print(f'\nwrote {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
