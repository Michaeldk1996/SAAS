#!/usr/bin/env python3
"""bet105 line prices — the 15-minute pull (founder brief 2026-10-24, bet105-line-prices Part 2). Actions-only:
reads KIBL_USERNAME / KIBL_PASSWORD (KIBL_CLIENT_ID optional), API_TENNIS_KEY, SUPABASE_URL / SUPABASE_SECRET_KEY.
Never prints a credential.

  1. Kibl: /reference/sportsbooks (the entitled book), then per men's league (ATP 19, Challenger 537, ITF Men 962)
     /info/fixtures + /info/markets in both states (current + opener), pre-match (betting_type_id 1).
  2. api-tennis get_fixtures (timezone=UTC), yesterday .. +2 days: the event keys, player keys and live status.
  3. line_prices.join_fixtures / normalise / apply_guards.
  4. Supabase: a line_price_ticks row for every key whose price or status changed (append-only), then upsert
     line_prices_current.
  5. line-prices/<date>.json, one per event date (yesterday .. +2), written atomically; older shards removed.
Fail closed: a Kibl or api-tennis read that fails, or a Kibl pull that comes back EMPTY, exits 1 and writes no shard —
the published shards then age past the page's 30-minute staleness rule and dash; nothing stale is ever re-stamped.
"""
import collections
import glob
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

import line_prices as LP

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, 'line-prices')
LEAGUES = (19, 537, 962)
KEEP_DAYS_BACK = 1
CHUNK = 500


def iso(d):
    return d.strftime('%Y-%m-%dT%H:%M:%SZ')


def sb(method, path, body=None, headers=None):
    url, key = os.environ['SUPABASE_URL'].rstrip('/'), os.environ['SUPABASE_SECRET_KEY']
    h = {'Authorization': f'Bearer {key}', 'apikey': key, 'Content-Type': 'application/json'}
    h.update(headers or {})
    req = urllib.request.Request(url + path, data=None if body is None else json.dumps(body).encode(), method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read()
            return (json.loads(raw) if raw else None), None
    except urllib.error.HTTPError as e:
        return None, f'HTTP {e.code} {e.read()[:300].decode("utf-8", "replace")}'
    except Exception as e:  # noqa: BLE001 — reported
        return None, type(e).__name__


def read_current(event_keys):
    out = {}
    eks = sorted(set(event_keys))
    for i in range(0, len(eks), 100):
        offset = 0
        while True:
            q = urllib.parse.urlencode({'select': 'event_key,market,side,line,book,price,status',
                                        'event_key': f'in.({",".join(str(e) for e in eks[i:i + 100])})',
                                        'order': 'event_key.asc,market.asc,side.asc,line.asc', 'limit': 1000, 'offset': offset})
            got, err = sb('GET', f'/rest/v1/line_prices_current?{q}')
            if err:
                return None, err
            for r in got:
                out[(int(r['event_key']), r['market'], r['side'], LP._num(r['line']), r['book'])] = r
            if len(got) < 1000:
                break
            offset += 1000
    return out, None


def write_rows(table, rows, prefer, conflict=None):
    q = '?' + urllib.parse.urlencode({'on_conflict': conflict}) if conflict else ''
    for i in range(0, len(rows), CHUNK):
        _, err = sb('POST', f'/rest/v1/{table}{q}', rows[i:i + CHUNK], {'Prefer': prefer})
        if err:
            return err
    return None


def main():
    now = datetime.now(timezone.utc)
    seen_at = iso(now)
    from kibl_client import KiblClient
    c = KiblClient(verbose=False)
    books, meta = c.get('/reference/sportsbooks')
    rows_b = [b for b in c.rows(books) if isinstance(b, dict)]
    fsid = ','.join(str(b['feed_source_id']) for b in rows_b if b.get('feed_source_id') is not None)
    if meta.get('status') != 200 or not fsid:
        print(f'::error::Kibl /reference/sportsbooks: HTTP {meta.get("status")}, books {[b.get("name") for b in rows_b]} — no pull.')
        return 1
    print(f'Kibl book(s): {[b.get("name") for b in rows_b]} (feed_source_id {fsid})')
    w0, w1 = iso(now - timedelta(hours=3)), iso(now + timedelta(hours=60))
    kfx, krows = [], []
    for lid in LEAGUES:
        fx, fm = c.get('/info/fixtures', {'league_id': lid, 'start_time': w0, 'end_time': w1})
        if fm.get('status') != 200:
            print(f'::error::Kibl fixtures league {lid}: HTTP {fm.get("status")} — no pull.')
            return 1
        kfx += [f for f in c.rows(fx) if isinstance(f, dict)]
        rows, metas = c.markets_all_states(league_id=lid, betting_type_id=1, feed_source_id=fsid, start_time=w0, end_time=w1)
        if not all(m.get('status') == 200 for m in metas):
            print(f'::error::Kibl markets league {lid}: {[m.get("status") for m in metas]} — no pull.')
            return 1
        krows += rows
        print(f'  league {lid}: {len(c.rows(fx))} fixtures, {len(rows)} market rows')
    print(f'Kibl: {c.calls} calls, {c.bytes_down:,} bytes this refresh')
    if not krows:
        print('::error::Kibl returned EMPTY: 0 market rows across ATP, Challenger and ITF Men — no shard written.')
        return 1

    key = os.environ.get('API_TENNIS_KEY') or ''
    at = []
    d0, d1 = (now - timedelta(days=1)).strftime('%Y-%m-%d'), (now + timedelta(days=2)).strftime('%Y-%m-%d')
    u = 'https://api.api-tennis.com/tennis/?' + urllib.parse.urlencode({'method': 'get_fixtures', 'APIkey': key,
                                                                       'date_start': d0, 'date_stop': d1, 'timezone': 'UTC'})
    try:
        with urllib.request.urlopen(u, timeout=120) as r:
            at = json.load(r).get('result') or []
    except Exception as e:  # noqa: BLE001 — reported, never the URL (it carries the key)
        print(f'::error::api-tennis get_fixtures failed ({type(e).__name__}) — no shard written.')
        return 1
    if not at:
        print('::error::api-tennis returned EMPTY fixtures — nothing to join to; no shard written.')
        return 1

    mapping, jst = LP.join_fixtures(kfx, at)
    singles = sum(1 for f in kfx if '/' not in str(f.get('name') or ''))
    print(f'join: {dict(jst)} (Kibl fixtures {len(kfx)}, singles {singles})')
    entries, nst = LP.normalise(krows, mapping)
    by_ev = {m['event_key']: m for m in mapping.values()}
    LP.apply_guards(entries, by_ev)
    status = collections.Counter((e['market'], e['status']) for e in entries)
    print(f'normalise: {dict(nst)}')
    print('status by market: ' + json.dumps({f'{k[0]}:{k[1]}': v for k, v in sorted(status.items())}))

    prev, err = read_current([e['event_key'] for e in entries])
    if prev is None:
        print(f'::error::line_prices_current unreadable ({err}) — no write, no shard.')
        return 1
    cur_rows, ticks = [], []
    for e in entries:
        k = (e['event_key'], e['market'], str(e['side']), e['line'], LP.BOOK)
        price = e['price'] if e['status'] != 'suspended' else None
        row = {'event_key': e['event_key'], 'market': e['market'], 'side': str(e['side']), 'line': e['line'], 'book': LP.BOOK,
               'price': price, 'implied': e['implied'], 'status': e['status'], 'open_price': e['open_price'],
               'open_ts': e['open_ts'], 'max_limit': e['max_limit'], 'inserted_on': e['inserted_on'], 'seen_at': seen_at,
               'start_ts': iso(datetime.fromtimestamp(by_ev[e['event_key']]['start_ts'], timezone.utc)) if by_ev[e['event_key']].get('start_ts') else None,
               'kibl_fixture': by_ev[e['event_key']]['kibl_fixture'], 'alt_id': e['alt_id']}
        cur_rows.append(row)
        p = prev.get(k)
        if p is None or LP._num(p.get('price')) != price or p.get('status') != e['status']:
            ticks.append({'event_key': e['event_key'], 'market': e['market'], 'side': str(e['side']), 'line': e['line'],
                          'book': LP.BOOK, 'price': price, 'status': e['status'], 'is_opener': e['is_opener'],
                          'max_limit': e['max_limit'], 'inserted_on': e['inserted_on'], 'seen_at': seen_at})
    err = write_rows('line_price_ticks', ticks, 'resolution=ignore-duplicates,return=minimal',
                     'event_key,market,side,line,book,inserted_on,price,status')
    if err:
        print(f'::error::line_price_ticks insert failed ({err}) — current not updated, no shard.')
        return 1
    err = write_rows('line_prices_current', cur_rows, 'resolution=merge-duplicates,return=minimal', 'event_key,market,side,line,book')
    if err:
        print(f'::error::line_prices_current upsert failed ({err}) — no shard.')
        return 1
    print(f'supabase: {len(ticks)} tick(s) appended (changed or new), {len(cur_rows)} current row(s) upserted')

    shards = LP.project(entries, mapping, seen_at)
    os.makedirs(OUT_DIR, exist_ok=True)
    keep = {(now + timedelta(days=d)).strftime('%Y-%m-%d') for d in range(-KEEP_DAYS_BACK, 3)}
    wrote = []
    for day in sorted(keep):
        # a kept day with no matched event gets an EMPTY shard (honest), never yesterday's events re-stamped
        shard = shards.get(day) or LP.project([], {}, seen_at).get(day) or {
            'v': 1, 'book': LP.BOOK, 'source': 'Kibl (Bet105, feed_source_id 171)',
            'clock': 'Kibl insert time, never book-post time', 'seenAt': seen_at, 'fields': LP.SHARD_FIELDS, 'events': {}}
        shard['unmatched'] = {k: v for k, v in jst.items() if k.startswith('unmatched')}
        path = os.path.join(OUT_DIR, f'{day}.json')
        with open(path + '.tmp', 'w') as fh:
            json.dump(shard, fh, separators=(',', ':'))
        os.replace(path + '.tmp', path)
        wrote.append(f'{day} ({len(shard["events"])} events)')
    for p in glob.glob(os.path.join(OUT_DIR, '*.json')):
        if os.path.basename(p)[:-5] not in keep:
            os.remove(p)
    print(f'shards: {", ".join(sorted(wrote)) or "none"}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
