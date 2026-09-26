#!/usr/bin/env python3
"""TEN-295 (TEN-287 Wave 1, founder 2026-09-26 card 89e3671d) — the chart's Bet105 and
odds-api.io lines.

    python3 build-chart-books.py

Runs in odds-capture-loop.sh right after the Oddspapi sweep, every 15 min, and writes
m.oddsMovement.chart (never m.oddsMovement.books — see chart_series.py):

  * Bet105 (sharp, clock "Kibl insert") — the SAME rows the price-history box shows for
    the card: `price_history(card_key)` (poller archive + stream), pre-match only
    (rows after odds-card-state's startTs are dropped), prices >= 1.01, deduped on
    (time, price). Only cards whose selected book is Bet105 have them.
  * odds-api.io books (soft) — `chart_book_series()` (chart-books-rpc.sql) over the
    recorder in ten287_rec. The book list is ten287_rec.config.books, so a slot swap
    (e.g. to Bet365) needs no code change: an unlisted book is labelled
    "<book> (odds-api.io)". Betfair Exchange is labelled "Betfair Exchange (recorded by
    us)" — the vendor keeps no history for it, we record it every 30 s (founder answer 3).

Join of an odds-api.io event to a board card (spec B2): both surnames (last token,
accent-folded: ten225_names.name_key), either orientation, card date within ±1 day of
the vendor's start, and UNIQUE on both sides — an event that fits two cards, or a card
that fits two events, joins nothing. Every skip is counted in the log, never guessed.
p1/p2 always follow the CARD.

checkedAt (the dashboard's "no recent data" clock) is never later than the source's own
read: odds-api.io books = the recorder's last HTTP 200 poll of that book; Bet105 = the
Kibl poller's last OK sweep; both capped at now, and at the event's first live sighting
(a pre-match line cannot have been checked after the off).

Reads SUPABASE_URL / SUPABASE_SECRET_KEY. Stdlib only. Exit 0 on a partial failure (it
runs 4x an hour; a red run that often hides real signals) — every failure is logged.
"""
import json, os, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import chart_series as cs                       # noqa: E402
from ten225_names import name_key, match_key    # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
MATCHES = os.path.join(HERE, 'matches.json')
CARD_STATE = os.path.join(HERE, 'odds-card-state.json')

JOIN_DAYS = 1
RPC_BACK_DAYS = 4
RPC_AHEAD_DAYS = 10
# Wall clock for the per-card Bet105 reads, inside the loop's 15-min tick (the sweep
# before it is budgeted at 480 s).
BET105_BUDGET_S = float(os.environ.get('BET105_BUDGET_S', '180'))

BET105 = 'Bet105'
BET105_META = {'source': 'Kibl', 'group': 'sharp', 'clock': 'Kibl insert'}
# odds-api.io book -> (chart label, clock). Anything not listed: "<book> (odds-api.io)".
ODDS_API_LABELS = {
    'Superbet': ('Superbet', 'vendor updatedAt'),
    'Betfair Exchange': ('Betfair Exchange (recorded by us)', 'recorded by us'),
    'Bet365': ('Bet365 (odds-api.io)', 'vendor updatedAt'),
}


def odds_api_label(book):
    return ODDS_API_LABELS.get(book, (f'{book} (odds-api.io)', 'vendor updatedAt'))


# ── Supabase ──────────────────────────────────────────────────────────────────
def rpc(name, args, timeout=60):
    url = (os.environ.get('SUPABASE_URL') or '').rstrip('/')
    key = os.environ.get('SUPABASE_SECRET_KEY') or ''
    if not url or not key:
        raise RuntimeError('SUPABASE_URL / SUPABASE_SECRET_KEY not set')
    req = urllib.request.Request(f'{url}/rest/v1/rpc/{name}', method='POST',
                                 data=json.dumps(args).encode(),
                                 headers={'Authorization': f'Bearer {key}', 'apikey': key,
                                          'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


# ── pure logic (tested in test-ten295-chart-books.py) ────────────────────────
def _dt(v):
    t = cs.ts_iso(v)
    return datetime.fromisoformat(t[:-1] + '+00:00') if t else None


def _min_iso(*vals):
    xs = [cs.ts_iso(v) for v in vals if v]
    xs = [x for x in xs if x]
    return min(xs) if xs else None


def bet105_series(payload, card, start_ts=None):
    """price_history payload -> {'p1': [...], 'p2': [...]} in card orientation.

    Mirrors price-history-box.js sideRows(): stream rows carry the side as a surname
    key; poller rows carry '1'/'2', named through the fixture's own player names. Rows
    after the card's startTs are dropped (the box's model() cut), then same-price
    re-inserts collapse."""
    if not payload:
        return {'p1': [], 'p2': []}
    fx = {}
    for f in payload.get('fixtures') or []:
        if f:
            fx[str(f.get('fixture_id'))] = {'1': name_key(f.get('player1') or ''),
                                            '2': name_key(f.get('player2') or '')}
    cut = cs.ts_iso(start_ts) if start_ts else None
    out = {}
    for who in ('p1', 'p2'):
        key = name_key(card.get(who) or '')
        pts = []
        if key:
            for r in payload.get('stream') or []:
                if r and r.get('side') == key:
                    pts.append([r.get('at'), r.get('price')])
            for r in payload.get('poller') or []:
                names = r and fx.get(str(r.get('fixture_id')))
                if names and names.get(str(r.get('side'))) == key:
                    pts.append([r.get('at'), r.get('price')])
        pts = cs.clean_points(pts)
        if cut:
            pts = [p for p in pts if p[0] <= cut]
        out[who] = cs.changes_only(pts)
    return out


def event_key(m):
    """The api-tennis event key inside the board id ('upcoming-123' -> '123'); a bare
    hash id is its own key (bsp-pipeline.js eventKeyOf)."""
    i = str(m.get('id') or '').find('-')
    return str(m.get('id') or '')[i + 1:] if i >= 0 else str(m.get('id') or '') or str(id(m))


def join_events(cards, events):
    """Unique both-surname join, either orientation, card date ±JOIN_DAYS of the
    vendor start. Returns ({id(card): (event, 'same'|'swap')}, counts)."""
    counts = {'events': len(events), 'joined': 0, 'no_card': 0, 'ambiguous_event': 0,
              'ambiguous_card': 0, 'unkeyable': 0}
    by_pair = {}
    for c in cards:
        k1, k2 = name_key(c.get('p1') or ''), name_key(c.get('p2') or '')
        if not (k1 and k2) or k1 == k2 or not c.get('date'):
            continue
        by_pair.setdefault(frozenset((k1, k2)), []).append(c)
    ev_cards = {}
    for e in events:
        h, a = name_key(e.get('home') or ''), name_key(e.get('away') or '')
        start = _dt(e.get('start_at'))
        if not (h and a) or h == a or start is None:
            counts['unkeyable'] += 1
            continue
        cands = []
        for c in by_pair.get(frozenset((h, a)), []):
            try:
                cd = datetime.strptime(c['date'][:10], '%Y-%m-%d').date()
            except ValueError:
                continue
            if abs((cd - start.date()).days) <= JOIN_DAYS:
                cands.append(c)
        if not cands:
            counts['no_card'] += 1
            continue
        # Two board entries of ONE match (the upcoming-/past- pair while a fixture
        # resolves) share an event key; they are one card, not an ambiguity.
        if len({event_key(c) for c in cands}) > 1:
            counts['ambiguous_event'] += 1
            continue
        ev_cards[e['event_id']] = (e, cands)
    per_card = {}
    for eid, (e, cands) in ev_cards.items():
        per_card.setdefault(event_key(cands[0]), []).append((e, cands))
    joined = {}
    for ek, lst in per_card.items():
        if len(lst) > 1:
            counts['ambiguous_card'] += len(lst)
            continue
        e, cands = lst[0]
        h = name_key(e.get('home') or '')
        for c in cands:
            joined[id(c)] = (e, 'same' if name_key(c.get('p1') or '') == h else 'swap')
        counts['joined'] += 1
    return joined, counts


def event_series(rows, orient):
    """RPC rows [[at, home, away], ...] -> card-oriented {'p1','p2'}. The pair is the
    unit: a row with a side below 1.01 or an overround over 20% is a suspended market
    (odds.md price guards) and gives neither side a point."""
    p1, p2 = [], []
    for r in rows or []:
        if not isinstance(r, (list, tuple)) or len(r) < 3:
            continue
        t = cs.ts_iso(r[0])
        try:
            h, a = float(r[1]), float(r[2])
        except (TypeError, ValueError):
            continue
        if t is None or not (h >= cs.PRICE_FLOOR and a >= cs.PRICE_FLOOR):
            continue
        if 1.0 / h + 1.0 / a > 1.20:
            continue
        if orient == 'swap':
            h, a = a, h
        p1.append([t, h])
        p2.append([t, a])
    return {'p1': cs.changes_only(cs.clean_points(p1)), 'p2': cs.changes_only(cs.clean_points(p2))}


def apply_odds_api(cards, payload, now, card_state=None):
    """Write every joined event's books onto its card. Returns the log counts."""
    joined, counts = join_events(cards, payload.get('events') or [])
    polled = payload.get('polled_ok_at') or {}
    lines = {}
    for c in cards:
        hit = joined.get(id(c))
        if not hit:
            continue
        e, orient = hit
        for book, rows in (e.get('books') or {}).items():
            label, clock = odds_api_label(book)
            ser = event_series(rows, orient)
            if not (ser['p1'] or ser['p2']):
                continue
            checked = _min_iso(now, polled.get(book), e.get('live_from'))
            if polled.get(book) is None:
                checked = None      # no recorded poll: never claim a check
            # Cut at the card's actual start, else the vendor's scheduled one: the vendor's
            # live flip lags the off by ~14-16 min (review 2026-09-26).
            cs.put_chart(c, label, ser, {'source': 'odds-api.io', 'group': 'soft',
                                         'clock': clock, 'checkedAt': checked},
                         cut_at=cs.card_start(c, card_state, e.get('start_at')))
            lines[label] = lines.get(label, 0) + 1
    counts['lines'] = lines
    return counts


def bet105_cards(cards, card_state):
    """Cards whose SELECTED book is Bet105 (odds-card-state), with their card key and
    startTs. A completed card is refreshed until a read lands after its finish."""
    out = []
    by_key = (card_state or {}).get('byKey') or {}
    for c in cards:
        k = match_key(c.get('date') or '', c.get('p1') or '', c.get('p2') or '')
        ent = by_key.get(k) if k else None
        if not ent or str(ent.get('book') or '').lower() != 'bet105':
            continue
        if c.get('finalScore'):
            # Done once a read has landed at or after the start (checkedAt is capped at
            # startTs, so it can never pass the finish — review 2026-09-26), or after the
            # finish when no start is recorded.
            held = (((c.get('oddsMovement') or {}).get('chart') or {}).get('meta') or {}).get(BET105) or {}
            done_at = cs.ts_iso(ent.get('startTs')) or cs.ts_iso(c.get('finishedAt'))
            if held.get('checkedAt') and (done_at is None or held['checkedAt'] >= done_at):
                continue
        out.append((c, k, ent.get('startTs')))
    return out


def write_matches(matches):
    tmp = f'{MATCHES}.tmp'
    with open(tmp, 'w') as fh:
        json.dump(matches, fh, indent=2, ensure_ascii=False)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, MATCHES)


def main():
    now = cs.now_iso()
    matches = json.load(open(MATCHES))
    cards = [m for m in matches if m.get('date') and m.get('p1') and m.get('p2')]
    try:
        card_state = json.load(open(CARD_STATE))
    except Exception as e:
        print(f'::warning::{os.path.basename(CARD_STATE)} unreadable ({e}) — no Bet105 lines this tick.')
        card_state = {}

    # 1) odds-api.io books + the heartbeats, one call.
    series_payload = None
    try:
        t0 = datetime.now(timezone.utc)
        series_payload = rpc('chart_book_series', {
            'p_from': (t0 - timedelta(days=RPC_BACK_DAYS)).isoformat(),
            'p_to': (t0 + timedelta(days=RPC_AHEAD_DAYS)).isoformat()})
    except Exception as e:
        print(f'::warning::chart_book_series failed ({type(e).__name__}: {e}) — no odds-api.io '
              f'lines this tick; held lines keep their old checkedAt and read "no recent data" '
              f'once it ages.')
    if series_payload:
        c = apply_odds_api(cards, series_payload, now, card_state)
        print(f'odds-api.io: books {series_payload.get("books")}; {c["events"]} recorded '
              f'event(s): {c["joined"]} joined, {c["no_card"]} with no board card, '
              f'{c["ambiguous_event"]} matching 2+ cards, {c["ambiguous_card"]} competing for one '
              f'card, {c["unkeyable"]} unkeyable (all skipped, never guessed). Lines written: '
              f'{c["lines"] or "none"}. Recorder polls OK at {series_payload.get("polled_ok_at")}.')

    # 2) Bet105, per card, the price-history box's own rows.
    kibl_ok = (series_payload or {}).get('kibl_sweep_ok_at')
    targets = bet105_cards(cards, card_state)
    wrote = empty = failed = cut = 0
    t_start = time.monotonic()
    # Upcoming cards first, so a budget cut only ever defers a completed card's re-read.
    targets.sort(key=lambda t: bool(t[0].get('finalScore')))
    for i, (c, key, start_ts) in enumerate(targets):
        if time.monotonic() - t_start > BET105_BUDGET_S:
            cut = len(targets) - i
            print(f'::warning::Bet105 budget {BET105_BUDGET_S:.0f}s spent — {cut} card(s) wait one tick '
                  f'(their held lines keep their checkedAt).')
            break
        try:
            payload = rpc('price_history', {'p_card_key': key}, timeout=30)
        except Exception as e:
            failed += 1
            print(f'::warning::price_history failed for {key} ({type(e).__name__}).')
            continue
        ser = bet105_series(payload, c, start_ts)
        checked = _min_iso(now, kibl_ok, start_ts) if kibl_ok else None
        if cs.put_chart(c, BET105, ser if (ser['p1'] or ser['p2']) else None,
                        dict(BET105_META, checkedAt=checked), cut_at=start_ts):
            wrote += 1
        else:
            empty += 1
    print(f'Bet105: {len(targets)} card(s) with Bet105 selected: {wrote} with a line, {empty} with '
          f'no pre-match rows, {failed} read failure(s), {cut} deferred by the budget. Kibl poller OK at {kibl_ok or "unknown"}.')

    write_matches(matches)
    return 0


if __name__ == '__main__':
    sys.exit(main())
