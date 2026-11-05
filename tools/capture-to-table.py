#!/usr/bin/env python3
"""capture-to-table.py — architecture program stage 4, phase A (2026-11-05).

After a capture tick has written matches.json, copy what that tick knows about each card's captured series into the
append-only capture tables (capture-tables.sql):

  capture_tick  every [tick time, price] point of oddsMovement.chart.books[LABEL].p1 / .p2
  capture_read  oddsMovement.chart.meta[LABEL].checkedAt (our read of the source)
  capture_card  the card's identity (players, keys, date, round, qualifying flag, event, result)

Exactly the fields build-captured-pinnacle.js's absorb() reads from each matches.json snapshot, so the captured closes
can be rebuilt from the tables alone (tools/captured-diff.mjs compares the two). Insert-only:
`ON CONFLICT DO NOTHING` (PostgREST resolution=ignore-duplicates); a point already held adds nothing.

Never fails the capture tick: any error prints a ::warning:: and exits 0 (the tick's own commit is the record until the
tables take over). No Oddspapi call; Supabase only.

    python3 tools/capture-to-table.py [matches.json] [--dry-run]
Env: SUPABASE_URL, SUPABASE_SECRET_KEY.
"""
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request

LABELS = ('Pinnacle +30s',)
CHUNK = 1000


def ek_of(m):
    ek = re.sub(r'^[a-z]+-', '', str((m or {}).get('id') or ''))
    return int(ek) if ek.isdigit() else None


def key_of(v):
    """An api-tennis player key as the board carries it (an integer); anything else is no key."""
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    return int(v) if isinstance(v, str) and v.isdigit() else None


def rows_of(matches):
    """matches.json cards → (ticks, reads, cards) row lists, de-duplicated."""
    ticks, reads, cards = {}, {}, {}
    for m in matches or []:
        ek = ek_of(m)
        if ek is None:
            continue
        chart = ((m.get('oddsMovement') or {}).get('chart') or {})
        books, meta = chart.get('books') or {}, chart.get('meta') or {}
        has = False
        for label in LABELS:
            s = books.get(label) or {}
            for side in ('p1', 'p2'):
                for x in s.get(side) or []:
                    if not isinstance(x, (list, tuple)) or len(x) < 2 or x[0] in (None, '') or x[1] is None:
                        continue
                    try:
                        price = float(x[1])
                    except (TypeError, ValueError):
                        continue
                    if price <= 0:
                        continue
                    ticks[(ek, label, side, str(x[0]))] = {'event_key': ek, 'label': label, 'side': side,
                                                           'tick_ts': str(x[0]), 'price': price}
                    has = True
            ck = (meta.get(label) or {}).get('checkedAt')
            if ck:
                reads[(ek, label, str(ck))] = {'event_key': ek, 'label': label, 'checked_at': str(ck)}
                has = True
        if not has:
            continue
        fs = m.get('finalScore') or {}
        card = {
            'p1': m.get('p1'), 'p2': m.get('p2'),
            'p1_key': key_of(m.get('p1Key')), 'p2_key': key_of(m.get('p2Key')),
            'card_date': m.get('date'), 'round': m.get('tournamentRound'),
            'qualifying': m.get('qualifying') if isinstance(m.get('qualifying'), bool) else None,
            'event': m.get('tour'),
            'winner': fs.get('winner') if fs.get('winner') in ('p1', 'p2') else None,
        }
        fp = hashlib.sha1(json.dumps(card, sort_keys=True).encode()).hexdigest()
        cards[(ek, fp)] = {'event_key': ek, 'fp': fp, **card}
    return list(ticks.values()), list(reads.values()), list(cards.values())


def post(base, key, table, conflict, rows):
    n = 0
    for i in range(0, len(rows), CHUNK):
        body = json.dumps(rows[i:i + CHUNK]).encode()
        req = urllib.request.Request(f'{base}/rest/v1/{table}?on_conflict={conflict}', data=body, method='POST', headers={
            'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json',
            'Prefer': 'resolution=ignore-duplicates,return=minimal'})
        with urllib.request.urlopen(req, timeout=60) as r:
            if r.status not in (200, 201, 204):
                raise RuntimeError(f'{table}: HTTP {r.status}')
        n += len(rows[i:i + CHUNK])
    return n


def main(argv):
    path = next((a for a in argv if not a.startswith('--')), 'matches.json')
    dry = '--dry-run' in argv
    try:
        doc = json.load(open(path))
    except Exception as e:  # noqa: BLE001
        print(f'::warning title=capture-to-table::could not read {path}: {e}')
        return 0
    matches = doc if isinstance(doc, list) else (doc.get('matches') or [])
    ticks, reads, cards = rows_of(matches)
    print(f'capture-to-table: {len(ticks)} tick(s), {len(reads)} read(s), {len(cards)} card(s) from {len(matches)} board card(s)')
    if dry:
        return 0
    base, key = (os.environ.get('SUPABASE_URL') or '').rstrip('/'), os.environ.get('SUPABASE_SECRET_KEY') or ''
    if not base or not key:
        print('::warning title=capture-to-table::no Supabase credentials — nothing written')
        return 0
    try:
        post(base, key, 'capture_tick', 'event_key,label,side,tick_ts', ticks)
        post(base, key, 'capture_read', 'event_key,label,checked_at', reads)
        post(base, key, 'capture_card', 'event_key,fp', cards)
        print('capture-to-table: written (points already held add nothing)')
    except (urllib.error.URLError, RuntimeError, OSError) as e:
        detail = e.read().decode()[:300] if isinstance(e, urllib.error.HTTPError) else str(e)
        print(f'::warning title=capture-to-table::write failed ({detail}) — the tick\'s matches.json commit stays the record')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
