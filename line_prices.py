"""bet105 line prices from Kibl — pure functions (founder brief 2026-10-24, bet105-line-prices Part 2).

Kibl (Bet105, feed_source_id 171) is the ONLY line-price source. This module joins Kibl fixtures to api-tennis (master
for fixtures, names, results — Kibl never supplies a name to the site), normalises every price to

    (event_key, market, side = api-tennis player key | 'over' | 'under', signed line, book, price, ...)

and runs the fail-closed guards. Home / away and Kibl's side ids never leave this module. I/O lives in
build-line-prices.py; tests in test-line-prices.py.

MARKETS (Kibl market_type_id / segment_id, measured 2026-10-24 on the live feed — see the market-inventory report):
  ml   1/1   match winner (needed for guard d)        gh   2/1   games handicap, full ladder with alternates
  ml1  1/22  set 1 winner                             sh   2/54  set handicap ±1.5
  tg   3/1   total games                              ts   3/54  total sets 2.5 = deciding set
ORIENTATION (measured): a spread row is ONE participant's own line — participant_side_id is the participant (2/3, the
fixture's participants[].side_id) and `point` is HIS line (side 2 point = −side 3 point on 315 of 315 pairs). Totals:
side_id 7 = Over, 6 = Under (the 7-side price rises with the line on 131 of 131 steps).
"""
import collections
import math

from ten225_names import name_key, given_initial

BOOK = 'bet105'
MARKETS = {(1, 1): 'ml', (1, 22): 'ml1', (2, 1): 'gh', (2, 54): 'sh', (3, 1): 'tg', (3, 54): 'ts'}
PLAYER_MARKETS = ('ml', 'ml1', 'gh', 'sh')
TOTAL_SIDES = {7: 'over', 6: 'under'}
COHERENCE = (1.00, 1.20)        # guard (b): 1/p1 + 1/p2, same book, same line
GUARD_D_MIN = 2.0               # guard (d) applies to −lines with |line| >= 2 (not a strict law at |line| <= 1.5)
MIN_PRICE = 1.01                # odds.md price floor: strictly below 1.01 is suppressed
JOIN_WINDOW_S = 36 * 3600       # Kibl start vs api-tennis start (pinarch's join window)
AT_TYPES = {'Atp Singles': 'ATP', 'Challenger Men Singles': 'CH', 'Itf Men Singles': 'ITF'}
AT_NOT_STARTED = ('', '1', None)


def _num(v):
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _ts(s):
    from datetime import datetime
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace('Z', '+00:00')).timestamp()
    except ValueError:
        return None


def at_start_ts(f):
    """api-tennis fixture (fetched with timezone=UTC) -> UTC epoch of its scheduled start, or None."""
    d, t = f.get('event_date'), f.get('event_time')
    if not d:
        return None
    return _ts(f'{d}T{t or "12:00"}:00+00:00')


# ----------------------------------------------------------------------------------------------- 1. fixture join
def join_fixtures(kibl_fixtures, at_fixtures):
    """Kibl fixture -> {event_key, keys: {kibl_side_id: api-tennis player key}, start_ts, date, tier, status}.

    Both surnames must match (either orientation), the starts within JOIN_WINDOW_S, exactly ONE api-tennis candidate,
    and no api-tennis fixture claimed by two Kibl fixtures. A pair whose two players share a surname is unkeyable.
    Given initials, when both feeds carry one, must agree. Anything else is unmatched and gets no prices.
    Returns (mapping, stats)."""
    st = collections.Counter()
    cands = []
    for f in at_fixtures or ():
        if f.get('event_type_type') not in AT_TYPES:
            continue
        a, b = f.get('event_first_player') or '', f.get('event_second_player') or ''
        if '/' in a or '/' in b:
            continue
        ka, kb = name_key(a), name_key(b)
        if not ka or not kb or ka == kb:
            continue
        cands.append((f, ka, kb, at_start_ts(f)))
    claim = collections.defaultdict(list)
    out = {}
    for kf in kibl_fixtures or ():
        parts = {p.get('side_id'): p.get('name') for p in (kf.get('participants') or []) if p.get('side_id') in (2, 3)}
        if len(parts) != 2:
            st['unmatched_no_two_participants'] += 1
            continue
        n2, n3 = parts[2] or '', parts[3] or ''
        if '/' in n2 or '/' in n3:
            st['skipped_doubles'] += 1
            continue
        k2, k3 = name_key(n2), name_key(n3)
        if not k2 or not k3 or k2 == k3:
            st['unmatched_unkeyable'] += 1
            continue
        ks = _ts(kf.get('start_time'))
        hits = []
        for f, ka, kb, at_ts in cands:
            if {ka, kb} != {k2, k3}:
                continue
            if ks is not None and at_ts is not None and abs(ks - at_ts) > JOIN_WINDOW_S:
                continue
            first_is_2 = ka == k2
            i_at = (given_initial(f.get('event_first_player')), given_initial(f.get('event_second_player')))
            i_kb = (given_initial(n2), given_initial(n3)) if first_is_2 else (given_initial(n3), given_initial(n2))
            if any(x and y and x != y for x, y in zip(i_at, i_kb)):
                continue
            hits.append((f, first_is_2))
        if len(hits) != 1:
            st['unmatched_none' if not hits else 'unmatched_ambiguous'] += 1
            continue
        f, first_is_2 = hits[0]
        p1, p2 = f.get('first_player_key'), f.get('second_player_key')
        if p1 is None or p2 is None:
            st['unmatched_no_player_key'] += 1
            continue
        ek = int(f['event_key'])
        claim[ek].append(kf['fixture_id'])
        out[kf['fixture_id']] = {
            'event_key': ek, 'keys': {2: str(p1 if first_is_2 else p2), 3: str(p2 if first_is_2 else p1)},
            'p1Key': str(p1), 'p2Key': str(p2), 'start_ts': at_start_ts(f), 'date': f.get('event_date'),
            'tier': AT_TYPES[f['event_type_type']], 'status': f.get('event_status'), 'kibl_fixture': kf['fixture_id']}
    for ek, fids in claim.items():
        if len(fids) > 1:
            for fid in fids:
                out.pop(fid, None)
            st['unmatched_claimed_twice'] += len(fids)
    st['matched'] = len(out)
    return out, st


# ------------------------------------------------------------------------------------------------ 2. normalise
def normalise(rows, mapping):
    """Kibl participant rows (both states, deduped) -> one entry per priced slot:
    {event_key, market, side, line, alt_id, price, status_id, open_price, open_ts, is_opener, max_limit, inserted_on}.
    A slot = (fixture, market, alt_id, side). Its CURRENT price is its newest row; the opening price is its opener row
    only when the opener is on the SAME line (an alternate slot whose line moved has no open for its new line)."""
    st = collections.Counter()
    slots = collections.defaultdict(list)
    for r in rows or ():
        mk = MARKETS.get((r.get('market_type_id'), r.get('segment_id')))
        if mk is None:
            st['market_not_used'] += 1
            continue
        m = mapping.get(r.get('fixture_id'))
        if m is None:
            st['fixture_unmatched'] += 1
            continue
        if mk in PLAYER_MARKETS:
            side = m['keys'].get(r.get('participant_side_id'))
        else:
            side = TOTAL_SIDES.get(r.get('side_id'))
        if side is None:
            st['side_unknown'] += 1
            continue
        slots[(m['event_key'], mk, r.get('alt_id') or 0, side)].append(r)
    out = []
    for (ek, mk, alt, side), rs in slots.items():
        rs = sorted(rs, key=lambda x: (x.get('inserted_on') or '', 0 if x.get('is_opener') else 1))
        cur = rs[-1]
        line = None if mk in ('ml', 'ml1') else _num(cur.get('point'))
        if mk in ('gh', 'sh', 'tg', 'ts') and line is None:
            st['no_line'] += 1
            continue
        if mk in ('tg', 'ts') and line == 0.0:
            st['total_placeholder_line_0'] += 1      # a suspended total carries point 0 and price 0: not a line
            continue
        op = next((x for x in rs if x.get('is_opener')), None)
        same_line = op is not None and (mk in ('ml', 'ml1') or _num(op.get('point')) == line)
        out.append({'event_key': ek, 'market': mk, 'side': side, 'line': line, 'alt_id': alt,
                    'price': _num(cur.get('price_decimal')), 'status_id': cur.get('market_status_id'),
                    'open_price': (lambda v: v if v is not None and v >= MIN_PRICE else None)(_num(op.get('price_decimal'))) if same_line else None,
                    'open_ts': op.get('inserted_on') if same_line else None,
                    'is_opener': bool(cur.get('is_opener')), 'max_limit': _num(cur.get('max_limit')),
                    'inserted_on': cur.get('inserted_on'), 'is_live': bool(cur.get('is_live'))})
    # Two alternate slots can sit on the SAME line (measured 2026-10-24, run 40115201276: the upsert refused a batch that
    # carried one key twice). A line is one price: keep the newest Kibl insert per (event, market, side, line), counted.
    best = {}
    for e in out:
        k = (e['event_key'], e['market'], e['side'], e['line'])
        if k in best:
            st['same_line_slots_collapsed'] += 1
            if (e['inserted_on'] or '') <= (best[k]['inserted_on'] or ''):
                continue
        best[k] = e
    out = list(best.values())
    st['slots'] = len(out)
    return out, st


# --------------------------------------------------------------------------------------------------- 3. guards
def _pairs(entries):
    """Two sides of one line, same book, keyed by the LINE (not Kibl's slot number, which two slots can share): a spread
    pairs a player's line with the other player's opposite line; a total pairs Over and Under at one line; a match / set
    winner pairs the two players."""
    players = collections.defaultdict(set)
    for e in entries:
        if e['market'] in PLAYER_MARKETS:
            players[e['event_key']].add(str(e['side']))
    g = collections.defaultdict(list)
    for e in entries:
        mk = e['market']
        if mk in ('gh', 'sh'):
            others = players[e['event_key']] - {str(e['side'])}
            if len(others) != 1:
                key = (e['event_key'], mk, 'unpaired', str(e['side']), e['line'])
            else:
                # the pair {(s, l), (o, −l)}, named the same way from either member
                key = (e['event_key'], mk) + tuple(sorted([(str(e['side']), e['line']), (next(iter(others)), -e['line'])]))
        elif mk in ('tg', 'ts'):
            key = (e['event_key'], mk, e['line'])
        else:
            key = (e['event_key'], mk)
        g[key].append(e)
    pairs = []
    for k, es in g.items():
        if len(es) != 2:
            pairs.append((es, None))
            continue
        a, b = es
        mk = k[1]
        if mk in ('gh', 'sh'):
            okp = a['side'] != b['side'] and a['line'] is not None and b['line'] is not None and abs(a['line'] + b['line']) < 1e-9
        elif mk in ('tg', 'ts'):
            okp = {a['side'], b['side']} == {'over', 'under'} and a['line'] == b['line']
        else:
            okp = a['side'] != b['side']
        pairs.append(((a, b), None) if okp else (es, 'not_a_pair'))
    return pairs


def apply_guards(entries, mapping_by_event):
    """Every entry gets `status` ('ok' or the dash reason) and `implied` (de-vigged, ok pairs only). Fail closed: a
    pair's two sides share one verdict — a guard that fails on either side dashes both."""
    for e in entries:
        e['status'], e['implied'] = 'ok', None
        m = mapping_by_event.get(e['event_key']) or {}
        if m.get('status') not in AT_NOT_STARTED or e.get('is_live'):
            e['status'] = 'started'
        elif e['status_id'] != 1 or e['price'] is None or e['price'] < MIN_PRICE:
            e['status'] = 'suspended'                                    # (a) never a 0 price
    pairs = _pairs(entries)
    for es, why in pairs:
        if why or len(es) != 2:
            for e in es:
                if e['status'] == 'ok':
                    e['status'] = 'one_sided' if len(es) == 1 else 'not_a_pair'
            continue
        a, b = es
        if a['status'] != 'ok' or b['status'] != 'ok':
            bad = a['status'] if a['status'] != 'ok' else b['status']
            a['status'] = b['status'] = bad
            continue
        over = 1 / a['price'] + 1 / b['price']
        if not (COHERENCE[0] <= over <= COHERENCE[1]):                  # (b)
            a['status'] = b['status'] = 'incoherent'
    # (c) ladder monotonicity within the book, per (event, market, side), over the lines still ok
    lad = collections.defaultdict(list)
    for e in entries:
        if e['status'] == 'ok' and e['market'] in ('gh', 'sh', 'tg', 'ts'):
            lad[(e['event_key'], e['market'], e['side'])].append(e)
    for (ek, mk, side), es in lad.items():
        es.sort(key=lambda e: e['line'])
        # a player's line rising = more games given to him = shorter price; Over: a higher line = longer; Under: shorter
        rising_ok = (lambda p, q: q >= p) if side == 'over' else (lambda p, q: q <= p)
        for x, y in zip(es, es[1:]):
            if not rising_ok(x['price'], y['price']):
                x['status'] = y['status'] = 'ladder'
    # (d) a player's −line (|line| >= 2) must be priced LONGER than his own match-winner price
    ml = {(e['event_key'], e['side']): e for e in entries if e['market'] == 'ml'}
    for e in entries:
        if e['status'] != 'ok' or e['market'] != 'gh' or e['line'] is None or e['line'] > -GUARD_D_MIN:
            continue
        w = ml.get((e['event_key'], e['side']))
        if w is None or w['status'] != 'ok':
            e['status'] = 'guard_d_no_match_winner'
        elif not e['price'] > w['price']:
            e['status'] = 'guard_d'
    # propagate (c)/(d) to the pair, then de-vig the ok pairs
    for es, why in pairs:
        if why or len(es) != 2:
            continue
        a, b = es
        if a['status'] != b['status']:
            bad = a['status'] if a['status'] != 'ok' else b['status']
            a['status'] = b['status'] = bad
        if a['status'] == 'ok':
            ia, ib = 1 / a['price'], 1 / b['price']
            a['implied'], b['implied'] = ia / (ia + ib), ib / (ia + ib)
    return entries


# ------------------------------------------------------------------------------------------------ 4. projection
SHARD_FIELDS = ['market', 'side', 'line', 'price', 'implied', 'status', 'open', 'openTs', 'maxLimit', 'insertedOn']


def project(entries, mapping, seen_at):
    """-> {date: shard}. A shard carries every line of every matched event that day, dashed lines included with their
    reason (the hover ladder lists what is offered; coverage is measured from it)."""
    by_ev = collections.defaultdict(list)
    for e in entries:
        by_ev[e['event_key']].append(e)
    ev_meta = {m['event_key']: m for m in mapping.values()}
    shards = collections.defaultdict(lambda: {'v': 1, 'book': BOOK, 'source': 'Kibl (Bet105, feed_source_id 171)',
                                              'clock': 'Kibl insert time, never book-post time',
                                              'seenAt': seen_at, 'fields': SHARD_FIELDS, 'events': {}})
    for ek, m in ev_meta.items():
        es = sorted(by_ev.get(ek, []), key=lambda e: (e['market'], str(e['side']), e['line'] if e['line'] is not None else 0))
        shards[m['date']]['events'][str(ek)] = {
            'p1Key': m['p1Key'], 'p2Key': m['p2Key'], 'tier': m['tier'], 'kiblFixture': m['kibl_fixture'],
            'lines': [[e['market'], e['side'], e['line'], e['price'] if e['status'] != 'suspended' else None,
                       round(e['implied'], 4) if e['implied'] is not None else None, e['status'],
                       e['open_price'], e['open_ts'], e['max_limit'], e['inserted_on']] for e in es]}
    return dict(shards)
