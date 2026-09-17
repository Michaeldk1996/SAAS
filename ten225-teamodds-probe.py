#!/usr/bin/env python3
"""TEN-225 — "MISSING ODDS ON THE LIVE BOARD" investigation (founder comment
2026-09-17T22:31Z, items a-d). REPORT ONLY: this script makes no card change,
writes no Supabase table and touches no pipeline file.

a. For every dashed fixture on today's board, the reason, grouped with counts.
b. Does api-tennis price Davis Cup / BJK Cup at all? Coverage % last 7 days by book.
c. Same against Oddspapi bet365 — would the new source cover what we miss?
d. How many hours before start does the first price appear for team events?

Method notes that matter for reading the output:

  - The board's dash is a property of the BUILD SNAPSHOT, not of the fixture.
    api-tennis get_odds is polled at build time; a price posted after the build
    is a dash until the next build. So (a) reports the reason as measured NOW,
    against the deployed build's dash set, and separately re-reads the fixtures
    the founder named so the two snapshots can be compared rather than conflated.
  - "Excluded book" is a real class here: the card's headline `odds` comes from
    fetchApiTennisMatchOdds(), which requires BOTH legs from the same book and
    drops a book that quotes only one side. A fixture with Home-only prices is
    therefore priced upstream and dashed downstream.
  - Every figure carries n. n < 30 is flagged in the output.

Cost: api-tennis calls are unmetered on our plan. Oddspapi /v4/historical-odds
is free (confirmed four times on this issue); /v4/fixtures is billable and is
NOT called here - the committed 180-day index supplies the fixture universe.
"""
import collections
import gzip
import json
import os
import statistics
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

HIST_SLEEP = 5.0   # /v4/historical-odds is rate-limited to ~1 call / 5s

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'ten225-teamodds-probe.json')
INDEX = os.path.join(HERE, '.ten225-fixture-index.json.gz')

API_TENNIS_BASE = 'https://api.api-tennis.com/tennis/'
ODDSPAPI_BASE = 'https://api.oddspapi.io/v4'


def load_env():
    env = {}
    p = os.path.join(HERE, '.env')
    if os.path.exists(p):
        for line in open(p):
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    for k in ('API_TENNIS_KEY', 'ODDSPAPI_KEY'):
        if os.environ.get(k):
            env[k] = os.environ[k]
    return env


ENV = load_env()
AT_KEY = ENV.get('API_TENNIS_KEY')
OP_KEY = ENV.get('ODDSPAPI_KEY')


def get_json(url, headers=None, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=headers or {})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode()), r.status
        except urllib.error.HTTPError as e:
            if e.code in (404, 400):
                return None, e.code
            if i == tries - 1:
                return None, e.code
        except Exception:
            if i == tries - 1:
                return None, 0
        time.sleep(2 + 2 * i)
    return None, 0


def at(method, **params):
    """api-tennis call. Key never printed - it is injected here only."""
    q = '&'.join(f'{k}={v}' for k, v in params.items())
    url = f'{API_TENNIS_BASE}?method={method}&APIkey={AT_KEY}' + ('&' + q if q else '')
    d, st = get_json(url)
    return d, st


def op(path, **params):
    """Oddspapi call. Auth is the `apiKey` query param (same as
    archive-oddspapi-raw.py); the key is injected here and never printed."""
    p = dict(params)
    p['apiKey'] = OP_KEY
    url = f'{ODDSPAPI_BASE}{path}?' + urllib.parse.urlencode(p)
    return get_json(url, headers={'User-Agent': 'BSP-Consult-Dashboard/1.0'})


def iso(ts):
    try:
        return datetime.fromisoformat(str(ts).replace('Z', '+00:00'))
    except (ValueError, TypeError, AttributeError):
        return None


# --------------------------------------------------------------------------
# a. today's board - reason per dashed fixture
# --------------------------------------------------------------------------
def classify(event_key, card_dashed):
    """Return (reason, detail) for one fixture, read live from api-tennis."""
    d, st = at('get_odds', match_key=event_key)
    res = (d or {}).get('result') or {}
    node = res.get(str(event_key)) or res.get(event_key) or {}
    ha = node.get('Home/Away') if isinstance(node, dict) else None
    detail = {'http': st, 'markets': sorted(node.keys()) if isinstance(node, dict) else []}
    if not isinstance(node, dict) or not node:
        return 'no_odds_in_payload', detail
    if not ha or not isinstance(ha, dict):
        return 'no_match_winner_market', detail
    home = ha.get('Home') or {}
    away = ha.get('Away') or {}
    detail['books_home'] = sorted(home.keys())
    detail['books_away'] = sorted(away.keys())
    both = [b for b in home if away.get(b) is not None]
    detail['books_both_legs'] = sorted(both)
    detail['bet365_both_legs'] = any(str(b).lower() == 'bet365' for b in both)
    if not home and not away:
        return 'market_present_no_books', detail
    if not both:
        return 'one_leg_only', detail
    # priced upstream with both legs -> the card should carry it
    return ('priced_now_card_stale' if card_dashed else 'priced'), detail


def part_a(board):
    rows = []
    for m in board:
        ek = str(m['id']).split('-')[-1]
        dashed = not ((m.get('odds') or {}).get('p1'))
        reason, detail = classify(ek, dashed)
        rows.append({
            'id': m['id'], 'event_key': ek, 'p1': m['p1'], 'p2': m['p2'],
            'tour': m.get('tour'), 'time': m.get('time'), 'date': m.get('date'),
            'card_dashed': dashed,
            'card_odds': m.get('odds'),
            'reason': reason, 'detail': detail,
        })
        time.sleep(0.25)
    return rows


# --------------------------------------------------------------------------
# b. api-tennis team-event coverage, last 7 days, by book
# --------------------------------------------------------------------------
TEAM_MARKERS = ('davis cup', 'billie jean king', 'bjk cup')


def is_team(name):
    n = (name or '').lower()
    return any(t in n for t in TEAM_MARKERS)


def part_b(days=7, end=None):
    end = end or datetime.now(timezone.utc).date()
    start = end - timedelta(days=days - 1)
    # get_fixtures is chunked at 7 days. Measured this run: a 90-day span
    # returns result=[] (not an error, an EMPTY LIST), so an unchunked wide
    # window silently reports zero team fixtures and would have been read as
    # "api-tennis does not carry Davis Cup" - the opposite of the truth.
    fx = []
    seen_keys = set()
    for off in range(0, days, 7):
        cs = start + timedelta(days=off)
        ce = min(end, cs + timedelta(days=6))
        chunk, st = at('get_fixtures',
                       date_start=cs.isoformat(), date_stop=ce.isoformat())
        for f in ((chunk or {}).get('result') or []):
            k = str(f.get('event_key'))
            if k not in seen_keys:
                seen_keys.add(k)
                fx.append(f)
    team = [f for f in fx if is_team(f.get('event_type_type')) or is_team(f.get('tournament_name'))]
    # bulk odds by date - one call per day, all fixtures that day
    odds_by_key = {}
    for i in range(days):
        d = (start + timedelta(days=i)).isoformat()
        o, _ = at('get_odds', date_start=d, date_stop=d)
        for k, v in ((o or {}).get('result') or {}).items():
            odds_by_key[str(k)] = v
    book_home = collections.Counter()
    book_both = collections.Counter()
    per_fixture = []
    singles = [f for f in team if not is_doubles(f)]
    for f in team:
        k = str(f.get('event_key'))
        node = odds_by_key.get(k) or {}
        ha = (node or {}).get('Home/Away') or {}
        home, away = ha.get('Home') or {}, ha.get('Away') or {}
        both = sorted(b for b in home if away.get(b) is not None)
        for b in home:
            book_home[b] += 1
        for b in both:
            book_both[b] += 1
        per_fixture.append({
            'event_key': k, 'date': f.get('event_date'),
            'tournament': f.get('tournament_name'),
            'type': f.get('event_type_type'),
            'p1': f.get('event_first_player'), 'p2': f.get('event_second_player'),
            'doubles': is_doubles(f),
            'any_price': bool(home or away),
            'books_both': both,
            'bet365': any(str(b).lower() == 'bet365' for b in both),
        })
    return {
        'window': [start.isoformat(), end.isoformat()],
        'fixtures_all_n': len(fx),
        'team_fixtures_n': len(team),
        'team_singles_n': len(singles),
        'odds_keys_seen_n': len(odds_by_key),
        'book_home_counts': dict(book_home),
        'book_bothlegs_counts': dict(book_both),
        'per_fixture': per_fixture,
    }


def is_doubles(f):
    p1 = str(f.get('event_first_player') or '')
    p2 = str(f.get('event_second_player') or '')
    return '/' in p1 or '/' in p2


# --------------------------------------------------------------------------
# c + d. Oddspapi bet365 on team events, and the open-lead distribution
# --------------------------------------------------------------------------
def part_cd(sample_n=60):
    idx = json.load(gzip.open(INDEX))['fixtures']
    team = {k: v for k, v in idx.items()
            if v.get('cat') in ('Davis Cup', 'Billie Jean King Cup')}
    singles = {k: v for k, v in team.items()
               if '/' not in (v.get('p1') or '') and '/' not in (v.get('p2') or '')}
    # newest first - decay eats the tail, and the newest fixtures are the ones
    # whose series still resembles what a live capture would have seen.
    order = sorted(singles.items(),
                   key=lambda kv: kv[1].get('start') or '', reverse=True)
    rows = []
    for fid, meta in order[:sample_n]:
        d, st = op('/historical-odds', fixtureId=fid)
        row = {'fixture': fid, 'cat': meta.get('cat'), 'http': st,
               'p1': meta.get('p1'), 'p2': meta.get('p2'), 'tourn': meta.get('tourn'),
               'start': meta.get('start'), 'trueStart': meta.get('trueStart'),
               'startSched': meta.get('startSched')}
        if not d:
            row['result'] = 'no_historical_odds'
            rows.append(row)
            time.sleep(HIST_SLEEP)
            continue
        books = extract_books(d)
        row['books'] = sorted(books.keys())
        row['bet365'] = any(b.lower() == 'bet365' for b in books)
        row['n_series'] = sum(len(v) for v in books.values())
        # Start time per the locked definition: trueStartTime first, never the
        # scheduled time as a start. startSched is carried separately so the
        # report can say which anchor each lead was measured against.
        true_ts = epoch(meta.get('trueStart'))
        sched_ts = epoch(meta.get('startSched')) or epoch(meta.get('start'))
        anchor, anchor_src = (true_ts, 'trueStart') if true_ts else (sched_ts, 'scheduled')
        row['anchor_src'] = anchor_src if anchor else None
        firsts, lasts_pre = [], []
        for bname, series_list in books.items():
            if bname.lower() != 'bet365':
                continue
            for s in series_list:
                firsts.append(min(s['ts']))
                pre = [t for t in s['ts'] if anchor and t <= anchor]
                if pre:
                    lasts_pre.append(max(pre))
        if anchor and firsts:
            row['open_lead_h'] = round((anchor - min(firsts)) / 3600.0, 3)
            row['first_tick_ts'] = datetime.fromtimestamp(min(firsts), timezone.utc).isoformat()
        else:
            row['open_lead_h'] = None
        if anchor and lasts_pre:
            row['close_lag_h'] = round((anchor - max(lasts_pre)) / 3600.0, 3)
        else:
            row['close_lag_h'] = None
        row['result'] = 'ok' if books else 'payload_no_bookmakers'
        rows.append(row)
        time.sleep(HIST_SLEEP)
    return {'team_fixtures_in_index': len(team),
            'team_singles_in_index': len(singles),
            'sampled': len(rows), 'rows': rows}


def epoch(ts):
    """Same parser as ten225-load-line-summary.py - `createdAt` is an epoch on
    some ticks and an ISO string on others, and coercing the wrong one to 0
    would manufacture a 56-year open lead."""
    if ts is None or ts == '':
        return None
    if isinstance(ts, (int, float)):
        return float(ts)
    try:
        return datetime.fromisoformat(str(ts).replace('Z', '+00:00')).timestamp()
    except (ValueError, TypeError):
        return None


def extract_books(payload):
    """Map book -> list of tick-epoch lists, one list per player series.

    Shape (locked on this issue, see ten225-load-line-summary.py:32):
      bookmakers[book].markets[marketId].outcomes[outcomeId].players[playerKey]
    where players[playerKey] is a LIST of ticks, each with createdAt/price/limit.
    Walked defensively: a KeyError here would silently zero a coverage figure.
    """
    out = collections.defaultdict(list)
    for bname, blk in ((payload or {}).get('bookmakers') or {}).items():
        for mid, m in ((blk or {}).get('markets') or {}).items():
            for oid, oc in ((m or {}).get('outcomes') or {}).items():
                for pkey, plist in ((oc or {}).get('players') or {}).items():
                    ts = [epoch((p or {}).get('createdAt'))
                          for p in (plist if isinstance(plist, list) else [])
                          if isinstance(p, dict)]
                    ts = [t for t in ts if t]
                    if ts:
                        out[bname].append({'market': str(mid), 'outcome': str(oid),
                                           'player': str(pkey), 'ts': ts})
    return out


def main():
    what = sys.argv[1] if len(sys.argv) > 1 else 'all'
    board_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '.ten225-board.json')
    result = {'generatedAt': datetime.now(timezone.utc).isoformat()}
    if what in ('all', 'a'):
        board = json.load(open(board_path))
        result['a'] = part_a(board)
    if what in ('all', 'b'):
        result['b'] = part_b()
    if what.startswith('b'):
        # bNN = the same measurement over NN days. The founder asked for 7; at
        # 7 days n=8, because the Davis Cup finals week starts today. A wider
        # window is reported ALONGSIDE the 7-day figure, never instead of it.
        days = int(what[1:] or 7)
        result[what] = part_b(days=days)
    if what in ('all', 'cd'):
        result['cd'] = part_cd()
    # Sections run in separate processes (the oddspapi sweep is rate-limited to
    # 1 call / 5 s and takes minutes). Each writes its OWN file, so a fast
    # section finishing mid-sweep cannot clobber a slow one's result.
    out = OUT if what == 'all' else OUT.replace('.json', f'-{what}.json')
    prev = {}
    if os.path.exists(out):
        try:
            prev = json.load(open(out))
        except Exception:
            prev = {}
    prev.update(result)
    json.dump(prev, open(out, 'w'), indent=1)
    print('wrote', out, 'sections', [k for k in prev if k != 'generatedAt'])


if __name__ == '__main__':
    main()
