#!/usr/bin/env python3
"""TEN-295 (TEN-287 Wave 1, founder 2026-09-26 card 89e3671d; Wave 2 comment d5bf3dda) —
the chart's Bet105, odds-api.io and api-tennis lines.

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
  * api-tennis books (Wave 2; Pinnacle sharp, the other 8 soft) — `chart_apitennis_series()`
    (chart-apitennis-rpc.sql) over the TEN-216 collector's change log, joined by EVENT KEY.
    Our clock ("seen by us every 5 min"), first point = first time WE saw the price, gaps
    where the book stopped quoting or the collector was down. See apply_apitennis().

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
# Our odds-api.io recorder (ten287_rec) went live 2026-09-26 00:00Z. A card played before
# that has no Superbet / Betfair Exchange line because we were not recording — never
# because the book did not price it (TEN-295 coverage pass).
RECORDING_SINCE = '2026-09-26'
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


# ── TEN-295 Wave 2 (founder 2026-09-26: comment d5bf3dda, cards 78ec4dd2 + 31e4beef) ──
# The 9 api-tennis books, match winner only, from the TEN-216 collector's change log
# (chart-apitennis-rpc.sql). Joined by EVENT KEY (card id = api-tennis event key), never by
# name. Home/Away = the card's p1/p2 (the pipeline builds both from the same feed).
# api-tennis name -> (chart label, group). Anything else api-tennis returns is not charted.
APITENNIS_BOOKS = {
    'Pncl': ('Pinnacle', 'sharp'),
    'Betano': ('Betano', 'soft'),
    '1xBet': ('1xBet', 'soft'),
    'BetVictor': ('BetVictor', 'soft'),
    'Betfair': ('Betfair Sportsbook', 'soft'),     # the SPORTSBOOK (~6.1% margin), not the Exchange
    'Marathon': ('Marathon', 'soft'),
    'bet365': ('bet365 (api-tennis)', 'soft'),
    'Sbo': ('Sbobet', 'soft'),
    'WilliamHill': ('William Hill', 'soft'),
}
# Vendor aliases (odds.md "Book names": `Victor Chandler` = BetVictor; the collector's rows
# carry "BetVictor" today).
APITENNIS_ALIASES = {'Victor Chandler': 'BetVictor'}
APITENNIS_CLOCK = 'seen by us every 5 min'
# Founder ruling: no backfill before 26 Sep 03:55Z. The collector chain was DOWN from
# 22 Sep 12:42Z (run cancelled) to its restart at 26 Sep 03:45Z, whose first poll (03:55:20Z)
# re-read every quote; nothing earlier is charted — an older row would carry a price across
# the 3.6 days nobody looked.
APITENNIS_SINCE = '2026-09-26T03:55:00.000Z'
# The collector polls get_odds for today .. today + WINDOW_DAYS (tools/ten216-supabase-collector.mjs).
APITENNIS_WINDOW_DAYS = 2


def _scheduled_start(m):
    """The card's scheduled start as a UTC instant. `date`/`time` are api-tennis's ACCOUNT wall
    clock, ~UTC+2 (bsp-pipeline.js closing cutoff; odds.md card-state key) — read as UTC the
    cut lands ~2 h into the match (review 2026-09-26: Cina v Muller stepped to 08:30Z on a
    06:30Z start). A late real start only drops real pre-start points; never adds in-play ones."""
    t = m.get('time') or ''
    return f"{m.get('date')}T{t[:5]}:00+02:00" if m.get('date') and len(t) >= 5 and t[2] == ':' else None


def apitennis_book_series(rows, cut=None, down=()):
    """One book's change rows [[at, selection, price, change_kind, event_live], ...] (time
    order) -> ({'p1','p2'}, gaps). Home -> p1, Away -> p2.

    A point is a PAIR, emitted at a poll where both sides are quoted and the pair passes the
    odds.md guards (both >= 1.01, overround <= 20%). A `removed` row on either side, or a pair
    failing the guards (a suspended market), opens a GAP, which closes at the next poll with a
    valid quoted pair: the page never draws across it. Rows
    after `cut` (the card's start) or at/after the first in-play row are dropped. `down`
    ([[from, to], ...]) = the collector was not polling: a gap for any line already open."""
    cut = cs.ts_iso(cut) if cut else None
    side = {'Home': None, 'Away': None}
    p1, p2, gaps = [], [], []
    open_gap = None
    started = False
    by_t = {}
    order = []
    for r in rows or []:
        t = cs.ts_iso(r[0])
        if t is None:
            continue
        if t not in by_t:
            by_t[t] = []
            order.append(t)
        by_t[t].append(r)
    for t in sorted(order):
        if cut and t > cut:
            break
        grp = by_t[t]
        if any(g[4] is True for g in grp):
            cut = t                           # first in-play row: the pre-match line ends here
            break
        for g in grp:
            sel = g[1]
            if sel not in side:
                continue
            if g[3] == 'removed':
                side[sel] = None
            else:
                try:
                    side[sel] = float(g[2])
                except (TypeError, ValueError):
                    side[sel] = None
        h, a = side['Home'], side['Away']
        if h is None or a is None:
            if started and open_gap is None:
                open_gap = t
            continue
        if not (h >= cs.PRICE_FLOOR and a >= cs.PRICE_FLOOR) or 1.0 / h + 1.0 / a > 1.20:
            # A suspended pair is not a price (odds.md price guards): the line stops here
            # rather than carrying the last good price across the suspension (review 2026-09-26).
            if started and open_gap is None:
                open_gap = t
            continue
        if open_gap is not None:
            gaps.append([open_gap, t])
            open_gap = None
        started = True
        p1.append([t, round(h, 3)])
        p2.append([t, round(a, 3)])
    if open_gap is not None:
        gaps.append([open_gap, None])
    ser = {'p1': cs.changes_only(cs.clean_points(p1)), 'p2': cs.changes_only(cs.clean_points(p2))}
    if ser['p1']:
        first = ser['p1'][0][0]
        for f, to in down or ():
            f, to = cs.ts_iso(f), cs.ts_iso(to)
            if f and to and to > first and (cut is None or f < cut):
                gaps.append([max(f, first), to])
    gaps = _merge_gaps(gaps)
    return ser, gaps


def _merge_gaps(gaps):
    out = []
    for f, to in sorted(gaps, key=lambda g: g[0]):
        if out and (out[-1][1] is None or f <= out[-1][1]):
            if out[-1][1] is not None and (to is None or to > out[-1][1]):
                out[-1][1] = to
            continue
        out.append([f, to])
    return out


def apply_apitennis(cards, payload, now, card_state=None):
    """Write the 9 api-tennis books onto every card. Returns log counts."""
    rows_by = {}
    for r in payload.get('rows') or []:
        if not isinstance(r, (list, tuple)) or len(r) < 7:
            continue
        book = APITENNIS_ALIASES.get(str(r[1]), str(r[1]))
        rows_by.setdefault(str(r[0]), {}).setdefault(book, []).append([r[2], r[3], r[4], r[5], r[6]])
    last_ok = cs.ts_iso(payload.get('last_ok_poll_at'))
    down = payload.get('down') or []
    today = now[:10]
    horizon = (datetime.fromisoformat(today) + timedelta(days=APITENNIS_WINDOW_DAYS)).strftime('%Y-%m-%d')
    lines, verdicts = {}, 0
    for c in cards:
        ek = event_key(c)
        books = rows_by.get(ek) or {}
        cut = cs.card_start(c, card_state, _scheduled_start(c))
        # api-tennis's own in-play flag, from ANY book of this event, also ends every line.
        live_at = [cs.ts_iso(r[0]) for rs in books.values() for r in rs if r[4] is True]
        cut = _min_iso(cut, *live_at) if live_at else cut
        checked = _min_iso(now, last_ok, cut) if last_ok else None
        for book, (label, group) in APITENNIS_BOOKS.items():
            meta = {'source': 'api-tennis', 'group': group, 'clock': APITENNIS_CLOCK, 'checkedAt': checked}
            ser, gaps = apitennis_book_series(books.get(book), cut, down)
            if ser['p1'] or ser['p2']:
                meta.update(gaps=gaps, firstSeen=ser['p1'][0][0] if ser['p1'] else ser['p2'][0][0])
                cs.put_chart(c, label, ser, meta, cut_at=cut)
                lines[label] = lines.get(label, 0) + 1
                continue
            # No line: say why, never guess (founder 2026-09-26: "not offered" needs evidence).
            if (c.get('date') or '9999') < APITENNIS_SINCE[:10] or (cut and cut < APITENNIS_SINCE):
                note = 'not recorded — our recording began 26 Sep'
            elif not books:
                # The collector polls get_odds for today .. +2 days; an event in that window
                # with no row at all is one api-tennis does not price.
                note = ('api-tennis lists no odds for this match'
                        if (c.get('date') or '') <= horizon and checked else None)
                if not note:
                    meta['checkedAt'] = None
            else:
                note = None               # the event was polled; this book never quoted it
            meta.update(note=note, gaps=None, firstSeen=None)
            cs.put_chart(c, label, None, meta, cut_at=cut)
            verdicts += 1
    return {'lines': lines, 'verdicts': verdicts, 'events': len(rows_by), 'last_ok': last_ok,
            'down': len(down)}


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
            fx[str(f.get('fixture_id'))] = {'1': cs.join_key(f.get('player1') or ''),
                                            '2': cs.join_key(f.get('player2') or '')}
    cut = cs.ts_iso(start_ts) if start_ts else None
    out = {}
    for who in ('p1', 'p2'):
        key = name_key(card.get(who) or '')          # the stream's side key (ocsNameKey)
        jkey = cs.join_key(card.get(who) or '')
        pts = []
        if key:
            for r in payload.get('stream') or []:
                if r and r.get('side') == key:
                    pts.append([r.get('at'), r.get('price')])
        if jkey:
            for r in payload.get('poller') or []:
                names = r and fx.get(str(r.get('fixture_id')))
                if names and names.get(str(r.get('side'))) == jkey:
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
        k1, k2 = cs.join_key(c.get('p1') or ''), cs.join_key(c.get('p2') or '')
        if not (k1 and k2) or k1 == k2 or not c.get('date'):
            continue
        by_pair.setdefault(frozenset((k1, k2)), []).append(c)
    ev_cards = {}
    for e in events:
        h, a = cs.join_key(e.get('home') or ''), cs.join_key(e.get('away') or '')
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
        h = cs.join_key(e.get('home') or '')
        for c in cands:
            joined[id(c)] = (e, 'same' if cs.join_key(c.get('p1') or '') == h else 'swap')
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
    # Every configured book gets a verdict on every card (founder 2026-09-26: "every
    # configured book gets a row on every card"): checked and no line -> meta only, which
    # the page renders as a dash + "not priced for this match", or — for a card played
    # before our recording began — "not recorded" (never "not priced": we did not look).
    #   * event joined, this book had nothing -> no note ("not priced for this match");
    #   * NO recorded event joined the card -> "no recorded event matched" — our join, not
    #     the book, is the open question (review 2026-09-26: a failed join must never read
    #     "not priced"; Damm Jr v Hurkacz would have);
    #   * no successful recorder poll yet -> no checkedAt -> the page says "not checked yet".
    none = 0
    for c in cards:
        for book in payload.get('books') or []:
            label, clock = odds_api_label(book)
            if cs.chart_series(c, label):
                continue
            checked = _min_iso(now, polled.get(book)) if polled.get(book) else None
            if (c.get('date') or '9999') < RECORDING_SINCE:
                note = f'not recorded — our recording began {RECORDING_SINCE[8:10]} Sep'
            elif id(c) not in joined:
                note = 'no recorded event matched'
            else:
                note = None
            cs.put_chart(c, label, None, {'source': 'odds-api.io', 'group': 'soft', 'clock': clock,
                                          'checkedAt': checked, 'note': note},
                         cut_at=cs.card_start(c, card_state, None))
            none += 1
    counts['lines'] = lines
    counts['checked_no_line'] = none
    return counts


def bet105_cards(cards, card_state):
    """EVERY board card with a card key, with its startTs from odds-card-state (TEN-295
    coverage pass: Bet105 was read only where it was the card's SELECTED book, which hid it
    on e.g. Cina v Muller; chart_bet105_history falls back to the card's one unselected
    Bet105 fixture). A completed card is re-read until a read lands at/after its start."""
    out = []
    by_key = (card_state or {}).get('byKey') or {}
    for c in cards:
        k = match_key(c.get('date') or '', c.get('p1') or '', c.get('p2') or '')
        if not k:
            continue
        ent = by_key.get(k) or {}
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
              f'{c["lines"] or "none"}; {c["checked_no_line"]} card x book verdicts with no line. '
              f'Recorder polls OK at {series_payload.get("polled_ok_at")}.')

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
            payload = rpc('chart_bet105_history', {'p_card_key': key}, timeout=30)
        except Exception as e:
            failed += 1
            print(f'::warning::chart_bet105_history failed for {key} ({type(e).__name__}).')
            continue
        ser = bet105_series(payload, c, start_ts)
        checked = _min_iso(now, kibl_ok, start_ts) if kibl_ok else None
        # No Kibl Bet105 fixture matched to this card (0 candidates, no stream rows): our
        # card-state join's verdict, never "not priced" (founder 2026-09-26: "not offered"
        # needs evidence). A matched fixture with no pre-match rows IS "not priced".
        # "Matched" = the RPC resolved a fixture (or the stream has rows for the card key).
        # Two or more unselected candidates resolve to none: ambiguous, said so (review
        # 2026-09-26).
        pl = payload or {}
        note = None
        if not pl.get('fixtures') and not pl.get('stream'):
            note = ('2+ Bet105 fixtures matched — ambiguous' if (pl.get('candidates') or 0) >= 2
                    else 'no Bet105 fixture matched')
        if cs.put_chart(c, BET105, ser if (ser['p1'] or ser['p2']) else None,
                        dict(BET105_META, checkedAt=checked, note=note),
                        cut_at=start_ts):
            wrote += 1
        else:
            empty += 1
    print(f'Bet105: {len(targets)} board card(s) read: {wrote} with a line, {empty} with '
          f'no pre-match rows, {failed} read failure(s), {cut} deferred by the budget. Kibl poller OK at {kibl_ok or "unknown"}.')

    # 3) The 9 api-tennis books (Wave 2), one call for every card, joined by event key.
    try:
        keys = sorted({event_key(c) for c in cards})
        at_payload = rpc('chart_apitennis_series', {'p_keys': keys, 'p_since': APITENNIS_SINCE})
    except Exception as e:
        at_payload = None
        print(f'::warning::chart_apitennis_series failed ({type(e).__name__}: {e}) — no api-tennis '
              f'lines this tick; held lines keep their checkedAt and read "no recent data" once it ages.')
    if at_payload:
        c = apply_apitennis(cards, at_payload, now, card_state)
        print(f'api-tennis: {c["events"]} board event(s) with match-winner rows; lines written: '
              f'{c["lines"] or "none"}; {c["verdicts"]} card x book verdicts with no line; last OK poll '
              f'{c["last_ok"]}; {c["down"]} collector-down gap(s).')

    write_matches(matches)
    return 0


if __name__ == '__main__':
    sys.exit(main())
