#!/usr/bin/env python3
"""
Hourly score refresher for the BSP Consult dashboard.

The full pipeline (bsp-pipeline.js) is heavy — it fetches H2H, yearly records,
tournament history and weather per match, so it isn't something to run every
hour. But scores go stale fast: a match that is upcoming when the pipeline runs
finishes a couple of hours later, and the dashboard then shows "Score pending"
until the next full run.

This script does the one cheap thing that needs to happen often: it pulls the
current fixtures from API-Tennis and patches ONLY the score/live fields of the
matches already in matches.json (finalScore, live, liveStatus, liveScore,
liveGameScore, liveServer). Everything else the pipeline wrote is left intact.

It is meant to run on a schedule (hourly cron/launchd). It never invents a
score — a match without a real, returned result simply keeps whatever it had.

    python3 refresh-scores.py

Uses only the standard library. Reads API_TENNIS_KEY from .env (same as the
pipeline). Idempotent and safe to run repeatedly.
"""
import json, os, sys, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
MATCHES = os.path.join(HERE, 'matches.json')
API_BASE = 'https://api.api-tennis.com/tennis/'
FINISHED = ('Finished', 'Retired', 'Walk Over')
# Preferred single bookmaker for the headline (m.odds) line, in order.
BOOKMAKER_PREF = ('bet365', 'Betano', '1xBet', 'Pinnacle', 'Marathonbet',
                  'Unibet', '888sport', 'William Hill', 'Betfair')


def read_key():
    env = os.path.join(HERE, '.env')
    if os.path.exists(env):
        for line in open(env):
            line = line.strip()
            if line.startswith('API_TENNIS_KEY='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    return os.environ.get('API_TENNIS_KEY')


def get_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'BSP-Consult-Dashboard/1.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def format_set_score(score_first, score_second):
    """Mirror of bsp-pipeline.js formatSetScore: games with optional loser
    tiebreak in parentheses. Scores come as e.g. "6" or "7.5" (7 games,
    tiebreak 5). Returns {p1, p2, display} oriented to first/second, or None."""
    if score_first is None or score_second is None:
        return None
    gf, _, tbf = str(score_first).partition('.')
    gs, _, tbs = str(score_second).partition('.')
    try:
        p1, p2 = int(gf), int(gs)
    except ValueError:
        return None
    tb = ''
    loser_tb = tbf if p1 < p2 else tbs
    if (tbf or tbs) and loser_tb:
        tb = f'({loser_tb})'
    return {'p1': p1, 'p2': p2, 'display': f'{p1}-{p2}{tb}'}


def build_final_score(fixture, p1_is_first):
    """Same output shape as the pipeline's buildFinalScore, but oriented to the
    match's own p1/p2 (via p1_is_first) so it's correct no matter which side the
    fixture lists first. Returns None when there's no usable scores array."""
    scores = fixture.get('scores')
    if not isinstance(scores, list) or not scores:
        return None
    ordered = sorted(scores, key=lambda s: int(s.get('score_set', 0)))
    sets = []
    for s in ordered:
        a, b = s.get('score_first'), s.get('score_second')
        first, second = (a, b) if p1_is_first else (b, a)
        fs = format_set_score(first, second)
        if fs is None:
            return None
        sets.append(fs)
    p1_sets = sum(1 for s in sets if s['p1'] > s['p2'])
    p2_sets = sum(1 for s in sets if s['p2'] > s['p1'])
    winner_side = fixture.get('event_winner')  # 'First Player' | 'Second Player'
    if winner_side == 'First Player':
        winner = 'p1' if p1_is_first else 'p2'
    elif winner_side == 'Second Player':
        winner = 'p2' if p1_is_first else 'p1'
    else:
        winner = None
    return {
        'display': ', '.join(s['display'] for s in sets),
        'sets': [{'p1': s['p1'], 'p2': s['p2']} for s in sets],
        'p1Sets': p1_sets,
        'p2Sets': p2_sets,
        'winner': winner,
    }


def build_live_score(fixture, p1_is_first):
    scores = fixture.get('scores')
    if not isinstance(scores, list) or not scores:
        return None
    out = []
    for s in scores:
        a, b = s.get('score_first'), s.get('score_second')
        try:
            out.append({
                'set': int(s.get('score_set', 0)),
                'p1': int(a if p1_is_first else b),
                'p2': int(b if p1_is_first else a),
            })
        except (TypeError, ValueError):
            return None
    return out


def to_price(v):
    """Parse a decimal odds string like '1.33' -> 1.33; reject non-odds."""
    try:
        p = float(str(v).strip())
    except (TypeError, ValueError):
        return None
    return p if p > 1 else None


def parse_home_away(block, p1_is_first):
    """block = result[str(event_key)] from get_odds. Returns (odds, bestOdds)
    oriented to the match's own p1/p2, or (None, None) if there's no usable
    Home/Away market. Home = event_first_player. Same field shapes the pipeline
    writes: odds={p1,p2,bookmaker}; bestOdds={p1:{price,bookmaker},p2:{...}}."""
    market = block.get('Home/Away') if isinstance(block, dict) else None
    if not isinstance(market, dict):
        return None, None
    home_books, away_books = {}, {}
    for side, target in (('Home', home_books), ('Away', away_books)):
        books = market.get(side)
        if not isinstance(books, dict):
            continue
        for bm, price in books.items():
            pr = to_price(price)
            if pr:
                target[bm] = pr
    if not home_books or not away_books:
        return None, None
    # p1 gets the Home book when the fixture lists p1 first, else the Away book.
    p1_books, p2_books = (home_books, away_books) if p1_is_first else (away_books, home_books)
    # bestOdds: the highest price offered on each side, with its bookmaker.
    p1_bm = max(p1_books, key=p1_books.get)
    p2_bm = max(p2_books, key=p2_books.get)
    best = {'p1': {'price': p1_books[p1_bm], 'bookmaker': p1_bm},
            'p2': {'price': p2_books[p2_bm], 'bookmaker': p2_bm}}
    # odds: one bookmaker quoting BOTH sides (preferred list, else any shared).
    both = next((b for b in BOOKMAKER_PREF if b in p1_books and b in p2_books), None)
    if both is None:
        both = next((b for b in p1_books if b in p2_books), None)
    if both:
        odds = {'p1': p1_books[both], 'p2': p2_books[both], 'bookmaker': both}
    else:
        odds = {'p1': best['p1']['price'], 'p2': best['p2']['price'], 'bookmaker': p1_bm}
    return odds, best


def fetch_odds(key, event_key, p1_is_first):
    """Pull odds for one fixture via API-Tennis get_odds and orient to p1/p2."""
    url = f'{API_BASE}?method=get_odds&APIkey={key}&match_key={event_key}'
    try:
        data = get_json(url)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
        return None, None
    result = data.get('result') if isinstance(data, dict) else None
    if not isinstance(result, dict):
        return None, None
    block = result.get(str(event_key))
    if not isinstance(block, dict):
        return None, None
    return parse_home_away(block, p1_is_first)


def main():
    key = read_key()
    if not key:
        print('ERROR: API_TENNIS_KEY not found (.env or environment).', file=sys.stderr)
        sys.exit(1)

    matches = json.load(open(MATCHES))
    dated = [m for m in matches if m.get('date')]
    if not dated:
        print('No dated matches in matches.json — nothing to refresh.')
        return

    start = min(m['date'] for m in dated)
    stop = max(m['date'] for m in dated)

    url = (f'{API_BASE}?method=get_fixtures&APIkey={key}'
           f'&date_start={start}&date_stop={stop}&event_type_key=265')
    try:
        fixtures = get_json(url).get('result') or []
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        print(f'ERROR: fixtures fetch failed ({e}).', file=sys.stderr)
        sys.exit(1)

    # Index fixtures by (date, unordered player-key pair) for a robust join.
    index = {}
    for f in fixtures:
        fk, sk = f.get('first_player_key'), f.get('second_player_key')
        if fk is None or sk is None:
            continue
        index[(f.get('event_date'), frozenset({str(fk), str(sk)}))] = f

    finals = lives = unchanged = odds_added = 0
    for m in matches:
        p1k, p2k = m.get('p1Key'), m.get('p2Key')
        if p1k is None or p2k is None:
            continue
        f = index.get((m.get('date'), frozenset({str(p1k), str(p2k)})))
        if not f:
            continue
        p1_is_first = str(f.get('first_player_key')) == str(p1k)

        # Odds enrichment: upcoming matches with no real odds yet get lines from
        # API-Tennis get_odds (covers the ATP 250s the primary odds feed omits).
        cur = m.get('odds') or {}
        if (not (cur.get('p1') and cur.get('p2'))
                and f.get('event_status') not in FINISHED
                and f.get('event_live') != '1'
                and f.get('event_key') is not None):
            odds, best = fetch_odds(key, f.get('event_key'), p1_is_first)
            if odds:
                m['odds'] = odds
                m['bestOdds'] = best
                odds_added += 1

        if f.get('event_live') == '1':
            m['live'] = True
            m['liveStatus'] = f.get('event_status')
            m['liveScore'] = build_live_score(f, p1_is_first)
            m['liveGameScore'] = f.get('event_game_result') or None
            serve = f.get('event_serve')
            m['liveServer'] = ('p1' if serve == ('First Player' if p1_is_first else 'Second Player')
                               else 'p2' if serve == ('Second Player' if p1_is_first else 'First Player')
                               else None)
            m['finalScore'] = None
            lives += 1
        elif f.get('event_status') in FINISHED:
            fs = build_final_score(f, p1_is_first)
            if fs:
                m['finalScore'] = fs
                m['live'] = False
                m['liveStatus'] = m['liveScore'] = m['liveGameScore'] = m['liveServer'] = None
                finals += 1
            else:
                unchanged += 1
        else:
            unchanged += 1

    with open(MATCHES, 'w') as fh:
        json.dump(matches, fh, indent=2, ensure_ascii=False)

    print(f'Refreshed matches.json: {finals} final scores, {lives} live, '
          f'{odds_added} odds added, '
          f'{unchanged} without a returned result (left as-is).')


if __name__ == '__main__':
    main()
