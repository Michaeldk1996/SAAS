#!/usr/bin/env python3
"""
Odds refresher for the BSP Consult dashboard — oddspapi.io layer.

The primary pipeline's odds feed (The Odds API) has no ATP 250 coverage, and
API-Tennis's get_odds is thin and lags some tournaments (notably Umag). This
script fills the gap using oddspapi.io, which carries the full ATP 250 draws.

It patches ONLY the odds fields of upcoming matches already in matches.json
(m.odds and m.bestOdds). Scores, stats, weather — everything else the pipeline
and the score refresher wrote — is left untouched. It never invents a line: a
match with no returned odds keeps whatever it already had, and any upcoming
match left without odds is reported explicitly at the end.

    python3 refresh-odds.py

Stdlib only. Reads ODDSPAPI_KEY from .env. Idempotent, safe to re-run.

Request budget (free tier = 250 requests / MONTH):
  1 fixtures call + one bulk odds call per bookmaker in BOOKS = 1 + len(BOOKS)
  per run. With BOOKS = 3 that's 4 requests/run; scheduled twice a day that is
  ~240/month, which fits inside the free quota with a little headroom. Lower the
  schedule frequency or trim BOOKS if the quota gets tight.
"""
import json, os, sys, time, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
MATCHES = os.path.join(HERE, 'matches.json')
BASE = 'https://api.oddspapi.io'
SPORT_TENNIS = 12
MARKET_WINNER = '121'          # oddspapi match-winner (moneyline) market id
OUTCOME_P1, OUTCOME_P2 = '121', '122'   # 121 = fixture participant1, 122 = participant2

# Bookmakers to merge, in headline-preference order. Pinnacle is the sharp
# reference (covers Bastad/Gstaad); bet365 and 1xbet fill Umag, which Pinnacle
# does not carry. bestOdds is the highest price across whichever of these quote
# a given match.
BOOKS = ('pinnacle', 'bet365', '1xbet')
BOOK_LABELS = {'pinnacle': 'Pinnacle', 'bet365': 'bet365', '1xbet': '1xBet'}
RATE_SLEEP = 1.8               # oddspapi rate-limits ~1.6s between calls


def read_key():
    env = os.path.join(HERE, '.env')
    if os.path.exists(env):
        for line in open(env):
            line = line.strip()
            if line.startswith('ODDSPAPI_KEY='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    return os.environ.get('ODDSPAPI_KEY')


def api_get(path, params, key):
    params = dict(params)
    params['apiKey'] = key
    url = BASE + path + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'User-Agent': 'BSP-Consult-Dashboard/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r), None
    except urllib.error.HTTPError as e:
        # 404 here means "this bookmaker has no fixtures for these tournaments",
        # which is a normal coverage gap, not a failure.
        return None, e.code
    except (urllib.error.URLError, TimeoutError) as e:
        return None, str(e)


def norm(name):
    return ''.join(c for c in (name or '').lower() if c.isalpha())


def surname_od(name):
    """oddspapi names are 'Lastname, Firstname' — take the part before the comma."""
    base = name.split(',')[0] if ',' in (name or '') else (name or '')
    return norm(base)


def orient(match, od_p1_name, od_p2_name):
    """Return 'same' if match.p1 lines up with oddspapi participant1, 'swap' if
    it lines up with participant2, or None if the pair doesn't match. Requires
    BOTH players to match so a wrong fixture can't sneak through."""
    o1, o2 = surname_od(od_p1_name), surname_od(od_p2_name)
    if len(o1) < 3 or len(o2) < 3:
        return None
    m1, m2 = norm(match.get('p1')), norm(match.get('p2'))
    if o1 and o1 in m1 and o2 and o2 in m2:
        return 'same'
    if o1 and o1 in m2 and o2 and o2 in m1:
        return 'swap'
    return None


def extract_winner_line(bookmaker_block):
    """From one fixture's per-bookmaker odds block, pull the match-winner prices
    as (participant1_price, participant2_price), or (None, None)."""
    mkt = (bookmaker_block.get('markets') or {}).get(MARKET_WINNER)
    if not isinstance(mkt, dict):
        return None, None
    outs = mkt.get('outcomes') or {}
    def price(oc):
        return (((outs.get(oc) or {}).get('players') or {}).get('0') or {}).get('price')
    p1 = price(OUTCOME_P1)
    p2 = price(OUTCOME_P2)
    try:
        p1 = float(p1) if p1 else None
        p2 = float(p2) if p2 else None
    except (TypeError, ValueError):
        return None, None
    return (p1 if p1 and p1 > 1 else None), (p2 if p2 and p2 > 1 else None)


def main():
    key = read_key()
    if not key:
        print('ERROR: ODDSPAPI_KEY not found (.env or environment).', file=sys.stderr)
        sys.exit(1)

    matches = json.load(open(MATCHES))
    upcoming = [m for m in matches if not m.get('finalScore') and m.get('date')]
    if not upcoming:
        print('No upcoming dated matches — nothing to refresh.')
        return

    start = min(m['date'] for m in upcoming)
    stop = max(m['date'] for m in upcoming)
    frm = f'{start}T00:00:00Z'
    to = (datetime.strptime(stop, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%dT00:00:00Z')

    # 1) fixtures: names + fixtureId + tournamentId for the whole window.
    fixtures, err = api_get('/v4/fixtures', {'sportId': SPORT_TENNIS, 'from': frm, 'to': to}, key)
    if fixtures is None:
        print(f'ERROR: fixtures fetch failed ({err}).', file=sys.stderr)
        sys.exit(1)
    fixtures = fixtures if isinstance(fixtures, list) else (fixtures.get('data') or [])

    # Join oddspapi fixtures to our upcoming matches by date + both surnames.
    # Records: match id -> {fixtureId, tournamentId, orient}
    joined = {}
    matched_tids = set()
    for m in upcoming:
        for f in fixtures:
            if (f.get('startTime') or '')[:10] != m['date']:
                continue
            ori = orient(m, f.get('participant1Name'), f.get('participant2Name'))
            if not ori:
                continue
            joined[id(m)] = {'fixtureId': f.get('fixtureId'),
                             'tournamentId': f.get('tournamentId'),
                             'orient': ori}
            if f.get('tournamentId') is not None:
                matched_tids.add(f.get('tournamentId'))
            break

    if not matched_tids:
        print('No oddspapi fixtures matched our upcoming matches by name/date — '
              'left matches.json untouched.')
        return

    # 2) bulk odds per bookmaker for exactly the tournaments we need.
    tids = ','.join(str(t) for t in sorted(matched_tids))
    # oddsByFixture[fixtureId][book] = (participant1_price, participant2_price)
    odds_by_fixture = {}
    book_cov = {}
    for book in BOOKS:
        time.sleep(RATE_SLEEP)
        data, err = api_get('/v4/odds-by-tournaments',
                            {'tournamentIds': tids, 'bookmaker': book,
                             'marketId': MARKET_WINNER, 'oddsFormat': 'decimal'}, key)
        if data is None:
            book_cov[book] = 0  # 404 => this book covers none of these tournaments
            continue
        items = data if isinstance(data, list) else (data.get('data') or [])
        n = 0
        for s in items:
            fx = s.get('fixtureId')
            blk = (s.get('bookmakerOdds') or {}).get(book)
            if not fx or not isinstance(blk, dict):
                continue
            p1, p2 = extract_winner_line(blk)
            if p1 and p2:
                odds_by_fixture.setdefault(fx, {})[book] = (p1, p2)
                n += 1
        book_cov[book] = n

    # 3) apply to matches. Merge across books: bestOdds = max per side; headline
    #    odds = first preferred book quoting BOTH sides.
    updated = 0
    gap_no_fixture = []   # not present in oddspapi at all (draw not posted there)
    gap_no_line = []      # fixture exists but no book has posted a price yet
    for m in upcoming:
        has_own = (m.get('odds') or {}).get('p1') and (m.get('odds') or {}).get('p2')
        j = joined.get(id(m))
        book_lines = odds_by_fixture.get(j['fixtureId']) if j else None
        if not book_lines:
            if not has_own:
                (gap_no_line if j else gap_no_fixture).append(m)
            continue
        swap = j['orient'] == 'swap'
        # per-book (p1_price, p2_price) oriented to OUR p1/p2
        oriented = {}
        for book, (a, b) in book_lines.items():
            oriented[book] = (b, a) if swap else (a, b)
        # bestOdds: highest price on each side with its book
        best_p1 = max(((pr, bk) for bk, (pr, _) in oriented.items() if pr), default=None)
        best_p2 = max(((pr, bk) for bk, (_, pr) in oriented.items() if pr), default=None)
        if not best_p1 or not best_p2:
            if not has_own:
                gap_no_line.append(m)
            continue
        # headline: first preferred book quoting both sides, else best-line books
        head = next((bk for bk in BOOKS if bk in oriented and oriented[bk][0] and oriented[bk][1]), None)
        if head:
            hp1, hp2 = oriented[head]
            m['odds'] = {'p1': hp1, 'p2': hp2, 'bookmaker': BOOK_LABELS.get(head, head)}
        else:
            m['odds'] = {'p1': best_p1[0], 'p2': best_p2[0],
                         'bookmaker': BOOK_LABELS.get(best_p1[1], best_p1[1])}
        m['bestOdds'] = {
            'p1': {'price': best_p1[0], 'bookmaker': BOOK_LABELS.get(best_p1[1], best_p1[1])},
            'p2': {'price': best_p2[0], 'bookmaker': BOOK_LABELS.get(best_p2[1], best_p2[1])},
        }
        updated += 1

    with open(MATCHES, 'w') as fh:
        json.dump(matches, fh, indent=2, ensure_ascii=False)

    cov = ', '.join(f'{b}:{book_cov.get(b, 0)}' for b in BOOKS)
    print(f'oddspapi odds refresh: {updated} match(es) updated across '
          f'{len(matched_tids)} tournament(s). Book coverage [{cov}].')
    if gap_no_line:
        print(f'GAP (no line yet — fixture on oddspapi but no book has posted '
              f'odds): {len(gap_no_line)} match(es):')
        for m in gap_no_line:
            print(f'  - {m.get("date")} {m.get("tour")}: {m.get("p1")} vs {m.get("p2")}')
    if gap_no_fixture:
        print(f'GAP (not on oddspapi — draw not published there): '
              f'{len(gap_no_fixture)} match(es):')
        for m in gap_no_fixture:
            print(f'  - {m.get("date")} {m.get("tour")}: {m.get("p1")} vs {m.get("p2")}')


if __name__ == '__main__':
    main()
