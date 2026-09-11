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

CADENCE — founder ruling 2026-09-10, TEN-179 item 1: option (a), FLAT HOURLY.
`.github/workflows/odds-now.yml` runs this every hour. The measurement that
settled it: 86% of bet365's pre-match price movement happens more than 6h before
start and only 7% inside the last hour, so a near-kickoff cadence boost buys
resolution in the window where almost nothing moves. Flat is the right shape.

Request budget (paid plan since 2026-09-10 = 5,000 requests / MONTH). Both
endpoints below are BILLABLE; /v4/account is not.

  * /v4/odds-by-tournaments — 1 unit per call, HARD-CAPPED AT 5 tournamentIds.
    Measured 2026-09-10: 6 ids -> HTTP 400 INVALID_PARAMETER "Please provide a
    maximum of 5 tournament IDs", and THE 400 STILL BILLS (meter 182->183->184
    across two 400s). This script used to pass every matched id in one call, so
    on any normal day (mean 8.1 tournaments, peak 13) it spent a unit and
    returned nothing. Ids are chunked at CHUNK_TIDS now — never raise it.
  * /v4/fixtures — 1 unit, and only needed to resolve fixtureId + tournamentId.
    Calling it hourly would cost 720 units/month to re-learn a mapping that
    barely changes, so the mapping is cached in odds-fixture-map.json and the
    call is made only when something is genuinely unresolved (see fixture_map()).

No blind retries: a 429 and a 400 both bill, so a retry loop on either is a way
to burn the quota faster while fixing nothing.
"""
import importlib.util
import json, os, sys, time, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
MATCHES = os.path.join(HERE, 'matches.json')
BASE = 'https://api.oddspapi.io'
SPORT_TENNIS = 12
MARKET_WINNER = '121'          # oddspapi match-winner (moneyline) market id
OUTCOME_P1, OUTCOME_P2 = '121', '122'   # 121 = fixture participant1, 122 = participant2

# Bookmakers to merge. bet365 ONLY — it is the single book the subscription
# entitles us to (/v4/account -> subscriptions[].bookmakers). pinnacle and 1xbet
# were removed on 2026-09-10 (TEN-179 item 1): both returned 403
# RESTRICTED_ACCESS on every call while still costing a BILLABLE
# /v4/odds-by-tournaments unit each, so two thirds of this script's quota spend
# bought nothing. Per-run cost drops from 4 units to 2.
#
# bestOdds is therefore a single-book figure right now, not a cross-book best.
# Do not re-add a book until the subscription actually carries it.
BOOKS = ('bet365',)
BOOK_LABELS = {'bet365': 'bet365'}
RATE_SLEEP = 1.8               # oddspapi rate-limits ~1.6s between calls

# HARD API LIMIT, measured — not a tuning knob. See the module docstring.
CHUNK_TIDS = 5

# The fixtureId <-> our-match mapping, cached so the billable /v4/fixtures call
# is made only when it can actually teach us something new. A MISS is cached too,
# with a shorter life: a match that is not on oddspapi yet (draw not published)
# would otherwise force a fixtures call every single hour forever.
FIXTURE_MAP_FILE = os.path.join(HERE, 'odds-fixture-map.json')
MAP_HIT_TTL_H = 36.0           # a resolved fixtureId does not change
MAP_MISS_TTL_H = 4.0           # re-ask this often for a draw that has not posted

_spec = importlib.util.spec_from_file_location(
    'bsp_odds_history', os.path.join(HERE, 'refresh-odds-history.py'))
_hist = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_hist)          # defs only; its main() is __main__-guarded
import bsp_alerts


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


# The name-orientation and date-join logic used to be duplicated here in an older
# form that ABORTED on any surname shorter than three letters — so Wu, Li and Tu
# could never be joined at all. That bug was fixed once, in refresh-odds-history.py,
# along with the timezone-aware nearest-candidate disambiguation. Keeping a second
# copy here is how the fixed version and the broken version end up side by side, so
# this file now imports `_hist.orient` / `_hist.join_fixtures` and holds no join of
# its own. See fixture_map().


def extract_winner_line(bookmaker_block):
    """From one fixture's per-bookmaker odds block, pull the match-winner line as
    ((p1_price, p1_changedAt), (p2_price, p2_changedAt)).

    `changedAt` is the instant BET365 last moved that price — not the instant we
    fetched it. Measured 2026-09-10 on three live Challenger fixtures, this
    endpoint's price and `changedAt` are IDENTICAL to the last tick of the same
    fixture's free /v4/historical-odds series (2.10/1.667 @ 2026-09-08T10:41:21.449Z,
    and two more). So the card's NOW and the alert detector's NOW are the same
    number from the same book by construction and can never disagree — the two
    endpoints differ in delivery cost, not in content.
    """
    mkt = (bookmaker_block.get('markets') or {}).get(MARKET_WINNER)
    if not isinstance(mkt, dict):
        return (None, None), (None, None)
    outs = mkt.get('outcomes') or {}

    def leg(oc):
        v = (((outs.get(oc) or {}).get('players') or {}).get('0') or {})
        try:
            pr = float(v.get('price')) if v.get('price') else None
        except (TypeError, ValueError):
            pr = None
        return (pr if pr and pr > 1 else None), v.get('changedAt')

    return leg(OUTCOME_P1), leg(OUTCOME_P2)


def _load_map():
    try:
        mp = json.load(open(FIXTURE_MAP_FILE))
        if isinstance(mp, dict) and isinstance(mp.get('byKey'), dict):
            return mp
    except Exception:
        pass
    return {'schema': 'odds-fixture-map/1', 'byKey': {}}


def _fresh(rec, now):
    """Is this cached mapping still usable? A hit lives longer than a miss."""
    at = _hist._parse((rec or {}).get('mappedAt'))
    if at is None:
        return False
    ttl = MAP_HIT_TTL_H if rec.get('fixtureId') else MAP_MISS_TTL_H
    return (now - at).total_seconds() / 3600.0 < ttl


def fixture_map(upcoming, matches, key, now):
    """Resolve every upcoming match to (fixtureId, tournamentId, orient), spending
    a billable /v4/fixtures call ONLY when the cache cannot answer.

    At a flat-hourly cadence a fixtures call every run would be 720 units/month
    to re-derive a mapping that changes when a draw is published — roughly twice
    a day. Caching it is the difference between the founder's approved ~38% of
    cap and ~63%. The cache is keyed on the api-tennis event key, which is the
    only id that survives a match finishing (`id` flips upcoming- -> past-).

    Returns (byMatchObjectId, mapDict, fixtures_call_spent).
    """
    mp = _load_map()
    by_key = mp['byKey']
    stale = [m for m in upcoming
             if not _fresh(by_key.get(_hist.event_key(m)), now)]

    spent = 0
    if stale:
        start = min(m['date'] for m in stale)
        stop = max(m['date'] for m in stale)
        # +/-1 day: our board dates in the api-tennis ACCOUNT timezone and
        # oddspapi startTime is UTC, so an edge-day match legitimately falls
        # outside a naive window. Same reasoning as refresh-odds-history.py.
        frm = (datetime.strptime(start, '%Y-%m-%d') - timedelta(days=1)).strftime('%Y-%m-%dT00:00:00Z')
        to = (datetime.strptime(stop, '%Y-%m-%d') + timedelta(days=2)).strftime('%Y-%m-%dT00:00:00Z')
        print(f'{len(stale)} of {len(upcoming)} upcoming match(es) have no fresh '
              f'fixture mapping — spending 1 unit on /v4/fixtures ({frm[:10]}..{to[:10]}).')
        fixtures, err = api_get('/v4/fixtures',
                                {'sportId': SPORT_TENNIS, 'from': frm, 'to': to}, key)
        spent = 1
        if fixtures is None:
            print(f'::error::oddspapi fixtures fetch failed ({err}) — falling back to '
                  f'the cached mapping only. No blind retry: a 4xx bills.', file=sys.stderr)
        else:
            fixtures = fixtures if isinstance(fixtures, list) else (fixtures.get('data') or [])
            tid_by_fx = {f.get('fixtureId'): f.get('tournamentId') for f in fixtures}
            # Reuse the history capturer's timezone-aware join rather than a second
            # implementation of the same subtle logic. Calibrate across the WHOLE
            # board, not just the stale subset — a median measured on one match is
            # that match's own delta and its tolerance gate can never fire.
            joined, unjoined = _hist.join_fixtures(stale, fixtures, calibrate_from=matches)
            now_iso = now.strftime('%Y-%m-%dT%H:%M:%SZ')
            for m in stale:
                ek = _hist.event_key(m)
                if not ek:
                    continue
                j = joined.get(id(m))
                if j:
                    by_key[ek] = {'fixtureId': j['fixtureId'],
                                  'tournamentId': tid_by_fx.get(j['fixtureId']),
                                  'orient': j['orient'], 'startTime': j.get('startTime'),
                                  'p1': m.get('p1'), 'p2': m.get('p2'),
                                  'mappedAt': now_iso}
                else:
                    # Cache the MISS so an unpublished draw does not force a
                    # billable call every hour. Reported, never silent.
                    by_key[ek] = {'fixtureId': None, 'tournamentId': None,
                                  'orient': None, 'startTime': None,
                                  'p1': m.get('p1'), 'p2': m.get('p2'),
                                  'mappedAt': now_iso}
            for m, why, fx_start in unjoined:
                print(f'::warning::UNMAPPED {m.get("id")} {m.get("p1")} vs '
                      f'{m.get("p2")} — {why}.')
            mp['updatedAt'] = now_iso
            try:
                with open(FIXTURE_MAP_FILE, 'w') as fh:
                    json.dump(mp, fh, indent=2, ensure_ascii=False, sort_keys=True)
            except Exception as e:
                print(f'::warning::Could not persist the fixture map ({e}) — next run '
                      f'will spend another /v4/fixtures unit.')
    else:
        print(f'Fixture mapping served entirely from cache for all {len(upcoming)} '
              f'upcoming match(es) — 0 units spent on /v4/fixtures this run.')

    out = {}
    for m in upcoming:
        rec = by_key.get(_hist.event_key(m))
        if rec and rec.get('fixtureId'):
            out[id(m)] = rec
    return out, mp, spent


def main():
    key = read_key()
    if not key:
        print('ERROR: ODDSPAPI_KEY not found (.env or environment).', file=sys.stderr)
        sys.exit(1)

    now = datetime.now(timezone.utc)
    now_iso = now.strftime('%Y-%m-%dT%H:%M:%SZ')
    quota_before = bsp_alerts.active_subscription(key)
    used_before = (quota_before or {}).get('request_count')

    matches = json.load(open(MATCHES))
    upcoming = [m for m in matches if not m.get('finalScore') and m.get('date')]
    if not upcoming:
        print('No upcoming dated matches — nothing to refresh.')
        return

    joined, _mp, spent = fixture_map(upcoming, matches, key, now)
    matched_tids = sorted({r['tournamentId'] for r in joined.values()
                           if r.get('tournamentId') is not None})
    if not matched_tids:
        print('::warning::No upcoming match resolved to an oddspapi tournament — '
              'left matches.json untouched, no odds call made.')
        return

    # --- bulk odds, chunked at the API's hard 5-id cap -----------------------
    # oddsByFixture[fixtureId][book] = ((p1_price, p1_at), (p2_price, p2_at))
    odds_by_fixture = {}
    book_cov = {b: 0 for b in BOOKS}
    calls = 0
    for book in BOOKS:
        for i in range(0, len(matched_tids), CHUNK_TIDS):
            chunk = matched_tids[i:i + CHUNK_TIDS]
            time.sleep(RATE_SLEEP)
            data, err = api_get('/v4/odds-by-tournaments',
                                {'tournamentIds': ','.join(str(t) for t in chunk),
                                 'bookmaker': book, 'marketId': MARKET_WINNER,
                                 'oddsFormat': 'decimal'}, key)
            calls += 1
            if data is None:
                # 404 = this book covers none of these tournaments (a real answer,
                # not a transport failure). Anything else is worth saying out loud.
                if err == 404:
                    print(f'  {book} chunk {chunk}: 404 — no bet365 market for these '
                          f'tournaments.')
                else:
                    print(f'::warning::{book} chunk {chunk}: HTTP {err}. Not retried '
                          f'— a 429 and a 400 both bill.')
                continue
            items = data if isinstance(data, list) else (data.get('data') or [])
            for s in items:
                fx = s.get('fixtureId')
                blk = (s.get('bookmakerOdds') or {}).get(book)
                if not fx or not isinstance(blk, dict):
                    continue
                a, b = extract_winner_line(blk)
                if a[0] and b[0]:
                    odds_by_fixture.setdefault(fx, {})[book] = (a, b)
                    book_cov[book] += 1

    # --- apply -------------------------------------------------------------
    # bet365 is the only entitled book, so "merge across books" is a single-book
    # pick. m.odds and m.bestOdds keep their existing shape; m.bet365Now is the
    # NOW leg the Upcoming card reads, and it is written ONLY when bet365 quotes
    # BOTH sides — half a card is worse than a dash (TEN-124).
    updated = now_written = 0
    gap_no_fixture, gap_no_line = [], []
    for m in upcoming:
        has_own = (m.get('odds') or {}).get('p1') and (m.get('odds') or {}).get('p2')
        j = joined.get(id(m))
        book_lines = odds_by_fixture.get(j['fixtureId']) if j else None
        if not book_lines:
            if not has_own:
                (gap_no_line if j else gap_no_fixture).append(m)
            continue
        swap = j['orient'] == 'swap'
        oriented = {}
        for book, (a, b) in book_lines.items():
            oriented[book] = (b, a) if swap else (a, b)

        head = next((bk for bk in BOOKS
                     if bk in oriented and oriented[bk][0][0] and oriented[bk][1][0]), None)
        if not head:
            if not has_own:
                gap_no_line.append(m)
            continue
        (hp1, at1), (hp2, at2) = oriented[head]
        label = BOOK_LABELS.get(head, head)
        m['odds'] = {'p1': hp1, 'p2': hp2, 'bookmaker': label}
        m['bestOdds'] = {'p1': {'price': hp1, 'bookmaker': label},
                         'p2': {'price': hp2, 'bookmaker': label}}
        if head == 'bet365':
            # `at` is bet365's OWN last-change instant for the later-moving leg —
            # the same value the free historical series carries. `observedAt` is
            # when WE looked, and is what bsp-pipeline.js compares against
            # oddsMovement.capturedAt to decide which of the two bet365 reads is
            # the more recent observation. Two different questions, two fields.
            at = max([t for t in (at1, at2) if t], default=None) or now_iso
            m['bet365Now'] = {'p1': hp1, 'p2': hp2, 'bookmaker': label,
                              'at': at, 'observedAt': now_iso, 'src': 'live'}
            now_written += 1
        updated += 1

    # Atomic write — full reasoning on write_matches() in refresh-odds-history.py. Short
    # version: open(...,'w') truncates immediately, the capture loop is built to be
    # interrupted, and its SIGTERM trap commits whatever is on disk — so a non-atomic
    # write here can push a truncated matches.json to main.
    _tmp = f'{MATCHES}.tmp'
    with open(_tmp, 'w') as fh:
        json.dump(matches, fh, indent=2, ensure_ascii=False)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(_tmp, MATCHES)

    cov = ', '.join(f'{b}:{book_cov.get(b, 0)}' for b in BOOKS)
    print(f'oddspapi odds refresh: {updated} match(es) updated ({now_written} with a '
          f'bet365 NOW leg) across {len(matched_tids)} tournament(s) in '
          f'{calls} billable odds call(s). Book coverage [{cov}].')
    if gap_no_line:
        print(f'GAP (no bet365 line yet — fixture on oddspapi, no price posted): '
              f'{len(gap_no_line)} match(es):')
        for m in gap_no_line:
            print(f'  - {m.get("date")} {m.get("tour")}: {m.get("p1")} vs {m.get("p2")}')
    if gap_no_fixture:
        print(f'GAP (not on oddspapi — draw not published there): '
              f'{len(gap_no_fixture)} match(es):')
        for m in gap_no_fixture:
            print(f'  - {m.get("date")} {m.get("tour")}: {m.get("p1")} vs {m.get("p2")}')

    # --- measured spend + the runway alert -----------------------------------
    st = bsp_alerts.alert_quota(
        key, cadence_note='Cadence is flat hourly (odds-now.yml), the approved option (a).')
    if st and isinstance(used_before, int):
        delta = st['used'] - used_before
        expected = spent + calls
        print(f'oddspapi consumption THIS RUN: {delta} billable unit(s) measured '
              f'({spent} fixtures + {calls} odds call(s) expected = {expected}). '
              f'At flat-hourly that projects to ~{delta * 720}/month.')
        if delta > expected:
            print(f'::warning::This run spent {delta} units against an expected '
                  f'{expected}. Something is calling a metered endpoint beyond the '
                  f'accounted ones.')


if __name__ == '__main__':
    main()
