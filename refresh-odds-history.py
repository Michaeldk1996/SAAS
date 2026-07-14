#!/usr/bin/env python3
"""
Odds-movement capturer for the BSP Consult dashboard — oddspapi.io history layer.

Where refresh-odds.py writes only the *current* price, this script captures each
bookmaker's full opening -> now price timeline for the match-winner market and
stores it on the match as `m.oddsMovement`. That timeline is what powers the
Odds tab's per-book sparklines and the dual-scale movement chart.

It uses oddspapi.io's /v4/historical-odds endpoint, which is free (does not draw
on the 250 req/month quota) but rate-limited to ~1 call / 5s. The only quota
call is the single /v4/fixtures lookup used to resolve fixtureIds + names.

    python3 refresh-odds-history.py

Stdlib only. Reads ODDSPAPI_KEY from .env. Idempotent, safe to re-run: it
rewrites `m.oddsMovement` for every match it can resolve and never invents a
line — a book with no returned series is simply omitted, and any upcoming match
left without movement is reported explicitly at the end. m.odds / m.bestOdds
(written by the other two refreshers) are left completely untouched.

Data honesty: every point stored is a real (createdAt, price) pair returned by
the API. No interpolation, no synthesised opening.
"""
import json, os, sys, time, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
MATCHES = os.path.join(HERE, 'matches.json')
BASE = 'https://api.oddspapi.io'
SPORT_TENNIS = 12
MARKET_WINNER = '121'                    # match-winner (moneyline) market id
OUTCOME_P1, OUTCOME_P2 = '121', '122'    # 121 = fixture participant1, 122 = participant2

# Books to capture, in headline-preference order. All six were verified to
# return real opening->now history for live ATP 250 fixtures on this API tier.
# marathonbet and other sharp books return RESTRICTED_ACCESS here and are left
# out on purpose rather than faked.
BOOKS = ('pinnacle', 'williamhill', '1xbet', 'betsson', 'betano', 'bet365')
BOOK_LABELS = {
    'pinnacle': 'Pinnacle', 'williamhill': 'William Hill', '1xbet': '1xBet',
    'betsson': 'Betsson', 'betano': 'Betano', 'bet365': 'bet365',
}
HIST_SLEEP = 5.5        # /v4/historical-odds cools down at ~1 call / 5s
BOOK_BATCH = 3         # endpoint accepts at most 3 bookmaker slugs per call
MAX_RETRY = 4          # 429 backoff attempts before giving up on a call


def read_key():
    env = os.path.join(HERE, '.env')
    if os.path.exists(env):
        for line in open(env):
            line = line.strip()
            if line.startswith('ODDSPAPI_KEY='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    return os.environ.get('ODDSPAPI_KEY')


def api_get(path, params, key):
    """GET path?params. Returns (json, None) on 200, (None, status_or_err) else."""
    params = dict(params)
    params['apiKey'] = key
    url = BASE + path + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'User-Agent': 'BSP-Consult-Dashboard/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r), None
    except urllib.error.HTTPError as e:
        return None, e.code
    except (urllib.error.URLError, TimeoutError) as e:
        return None, str(e)


def hist_get(fixture_id, books, key):
    """One /v4/historical-odds call for up to BOOK_BATCH books, with 429 backoff.
    Returns (json, None) or (None, status)."""
    params = {'fixtureId': fixture_id, 'bookmakers': ','.join(books)}
    for attempt in range(MAX_RETRY):
        data, err = api_get('/v4/historical-odds', params, key)
        if err == 429:                      # cooling down — wait longer and retry
            time.sleep(HIST_SLEEP * (attempt + 2))
            continue
        return data, err
    return None, 429


def norm(name):
    return ''.join(c for c in (name or '').lower() if c.isalpha())


def surname_od(name):
    """oddspapi names are 'Lastname, Firstname' — take the part before the comma."""
    base = name.split(',')[0] if ',' in (name or '') else (name or '')
    return norm(base)


def orient(match, od_p1_name, od_p2_name):
    """'same' if match.p1 lines up with participant1, 'swap' if with participant2,
    else None. Requires BOTH players to match so a wrong fixture can't slip in."""
    o1, o2 = surname_od(od_p1_name), surname_od(od_p2_name)
    if len(o1) < 3 or len(o2) < 3:
        return None
    m1, m2 = norm(match.get('p1')), norm(match.get('p2'))
    if o1 and o1 in m1 and o2 and o2 in m2:
        return 'same'
    if o1 and o1 in m2 and o2 and o2 in m1:
        return 'swap'
    return None


def extract_series(book_block):
    """From one bookmaker's history block pull the winner-market timelines as
    (p1_series, p2_series) where each series is a sorted list of [iso_ts, price].
    Drops non-positive / <=1 prices and any point missing a timestamp."""
    mkt = (book_block.get('markets') or {}).get(MARKET_WINNER)
    if not isinstance(mkt, dict):
        return None, None
    outs = mkt.get('outcomes') or {}

    def series(oc):
        pts = (((outs.get(oc) or {}).get('players') or {}).get('0')) or []
        out = []
        for p in pts:
            ts = p.get('createdAt')
            pr = p.get('price')
            try:
                pr = float(pr)
            except (TypeError, ValueError):
                continue
            if ts and pr and pr > 1:
                out.append([ts, round(pr, 3)])
        out.sort(key=lambda x: x[0])
        # collapse consecutive identical prices to keep the series compact while
        # preserving the first + last occurrence of each level (real points only)
        compact = []
        for ts, pr in out:
            if compact and compact[-1][1] == pr and len(compact) >= 2 and compact[-2][1] == pr:
                compact[-1] = [ts, pr]     # extend the run's end timestamp
            else:
                compact.append([ts, pr])
        return compact or None

    return series(OUTCOME_P1), series(OUTCOME_P2)


def main():
    key = read_key()
    if not key:
        print('ERROR: ODDSPAPI_KEY not found (.env or environment).', file=sys.stderr)
        sys.exit(1)

    matches = json.load(open(MATCHES))
    # Targets = every dated match we still need movement for. Upcoming matches are
    # (re)captured every run so their lines stay live. A completed match's opening
    # -> closing timeline is frozen the moment it finishes, so we capture it ONCE
    # (only when it has no movement yet) and let the pipeline preserve it forever
    # after that. This is what makes completed matches render the same per-book
    # breakdown + movement chart as upcoming ones instead of the reduced view.
    def has_movement(m):
        om = m.get('oddsMovement') or {}
        return bool(om.get('books'))

    targets = []
    for m in matches:
        if not m.get('date'):
            continue
        if m.get('finalScore'):
            if not has_movement(m):
                targets.append(m)          # completed & missing -> capture once
        else:
            targets.append(m)              # upcoming -> always refresh
    if not targets:
        print('No dated matches need movement capture — nothing to do.')
        return

    start = min(m['date'] for m in targets)
    stop = max(m['date'] for m in targets)
    frm = f'{start}T00:00:00Z'
    to = (datetime.strptime(stop, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%dT00:00:00Z')

    # 1) fixtures (1 quota unit): names + fixtureId for the whole window.
    fixtures, err = api_get('/v4/fixtures', {'sportId': SPORT_TENNIS, 'from': frm, 'to': to}, key)
    if fixtures is None:
        print(f'ERROR: fixtures fetch failed ({err}).', file=sys.stderr)
        sys.exit(1)
    fixtures = fixtures if isinstance(fixtures, list) else (fixtures.get('data') or [])

    # join oddspapi fixtures to our target matches by date + both surnames
    joined = {}   # id(m) -> {fixtureId, orient}
    for m in targets:
        for f in fixtures:
            if (f.get('startTime') or '')[:10] != m['date']:
                continue
            ori = orient(m, f.get('participant1Name'), f.get('participant2Name'))
            if not ori:
                continue
            joined[id(m)] = {'fixtureId': f.get('fixtureId'), 'orient': ori}
            break

    if not joined:
        print('No oddspapi fixtures matched our target matches by name/date — '
              'left matches.json untouched.')
        return

    # 2) per-fixture historical odds, books in batches of BOOK_BATCH.
    captured = 0
    total_points = 0
    book_hits = {b: 0 for b in BOOKS}
    gap_no_history = []     # fixture resolved but no book returned a series
    now_iso = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

    for m in targets:
        j = joined.get(id(m))
        if not j:
            gap_no_history.append(m)
            continue
        fx = j['fixtureId']
        swap = j['orient'] == 'swap'
        books_out = {}

        for i in range(0, len(BOOKS), BOOK_BATCH):
            batch = BOOKS[i:i + BOOK_BATCH]
            time.sleep(HIST_SLEEP)
            data, herr = hist_get(fx, batch, key)
            if data is None:
                # a whole batch failed (e.g. 400 from one bad slug): retry the
                # books one at a time so good books still land and restricted
                # ones are skipped cleanly.
                for b in batch:
                    time.sleep(HIST_SLEEP)
                    d1, e1 = hist_get(fx, (b,), key)
                    if d1 is not None:
                        _absorb(d1, b, swap, books_out, book_hits)
                continue
            blocks = (data.get('bookmakers') or {}) if isinstance(data, dict) else {}
            for b in batch:
                if b in blocks:
                    _absorb(data, b, swap, books_out, book_hits)

        if books_out:
            pts = sum(len(s) for bk in books_out.values() for s in bk.values() if s)
            total_points += pts
            m['oddsMovement'] = {
                'market': 'Match Winner',
                'capturedAt': now_iso,
                'books': books_out,
            }
            captured += 1
        else:
            gap_no_history.append(m)

    with open(MATCHES, 'w') as fh:
        json.dump(matches, fh, indent=2, ensure_ascii=False)

    cov = ', '.join(f'{BOOK_LABELS[b]}:{book_hits[b]}' for b in BOOKS)
    print(f'oddspapi history capture: {captured} match(es) with movement, '
          f'{total_points} price points total.')
    print(f'Book coverage (matches with a series) [{cov}].')
    if gap_no_history:
        print(f'GAP (no per-book history returned): {len(gap_no_history)} match(es):')
        for m in gap_no_history:
            print(f'  - {m.get("date")} {m.get("tour")}: {m.get("p1")} vs {m.get("p2")}')


def _absorb(data, book, swap, books_out, book_hits):
    """Pull one book's oriented p1/p2 series from a historical-odds payload into
    books_out keyed by the display label."""
    blk = (data.get('bookmakers') or {}).get(book)
    if not isinstance(blk, dict):
        return
    s1, s2 = extract_series(blk)
    if swap:
        s1, s2 = s2, s1
    if s1 or s2:
        books_out[BOOK_LABELS[book]] = {'p1': s1, 'p2': s2}
        book_hits[book] += 1


if __name__ == '__main__':
    main()
