#!/usr/bin/env python3
"""
Odds-movement capturer for the BSP Consult dashboard — oddspapi.io history layer.

Where refresh-odds.py writes only the *current* price, this script captures each
bookmaker's full opening -> now price timeline for the match-winner market and
stores it on the match as `m.oddsMovement`. That timeline is what powers the
Odds tab's per-book sparklines and the dual-scale movement chart.

It uses oddspapi.io's /v4/historical-odds endpoint, which is free (it never
increments the request counter — verified against the live /v4/account meter)
but rate-limited to ~1 call / 5s. The only quota call is the single /v4/fixtures
lookup used to resolve fixtureIds + names, i.e. exactly ONE unit per run.

bet365 is the ONLY book the subscription entitles us to, and a mixed request
403s in full — see the BOOKS note below. The meter is printed before and after
every run so real consumption is visible in the Actions log rather than inferred.

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

try:
    import bsp_alerts            # the single outbound alert path (TEN-179 item 4)
except Exception as _e:          # never let the notifier break the capture
    bsp_alerts = None
    print(f'WARNING: bsp_alerts unavailable ({_e}); alerts will only reach this log.',
          file=sys.stderr)

HERE = os.path.dirname(os.path.abspath(__file__))
MATCHES = os.path.join(HERE, 'matches.json')
BASE = 'https://api.oddspapi.io'
SPORT_TENNIS = 12
MARKET_WINNER = '121'                    # match-winner (moneyline) market id
OUTCOME_P1, OUTCOME_P2 = '121', '122'    # 121 = fixture participant1, 122 = participant2

# Books to capture. THE SUBSCRIPTION ENTITLES US TO bet365 AND NOTHING ELSE.
#
# This used to request six books in batches of three, which silently threw away
# the one book we are entitled to. Measured against the live API on 2026-09-10
# (fixture id1200259173992426):
#
#   bookmakers=pinnacle,williamhill,1xbet  -> HTTP 403 RESTRICTED_ACCESS
#   bookmakers=betsson,betano,bet365       -> HTTP 403 RESTRICTED_ACCESS
#                                             "Restricted bookmakers: betsson, betano"
#   bookmakers=bet365                      -> HTTP 200, 2,482,491 B of real series
#
# A batch containing ANY non-entitled book 403s in FULL — bet365's data is
# discarded along with it. Batching is not merely useless here, it IS the
# failure. One book, one call, no batching. Do not add a book back until the
# subscription carries it (/v4/account -> subscriptions[].bookmakers).
BOOKS = ('bet365',)
BOOK_LABELS = {'bet365': 'bet365'}

# --- TEN-179 item 3: the open-monitor (founder authorised 2026-09-10) --------
# A fixture whose bet365 market has genuinely opened but which we never captured
# loses its OPEN for good — the card dashes forever and the drift figure is not
# recoverable. The whole point of this capturer is to prevent exactly that, and
# until now nothing watched for it.
#
# The threshold: every one of the 9 settled fixtures we hold a full series for had
# its bet365 market posted 27.7-46.2h before start, so at T-24h a fixture with no
# series is outside the entire observed posting distribution — 0/9 false positives
# on the evidence we have. That sample is small and retrospective, which is why
# every run also APPENDS a prospective posting-lead measurement to the monitor file
# below; the threshold is refined off that, not off the 9.
OPEN_MONITOR_HOURS = 24.0
OPEN_MONITOR_FILE = os.path.join(HERE, 'odds-open-monitor.json')
HIST_SLEEP = 5.5        # /v4/historical-odds cools down at ~1 call / 5s
MAX_RETRY = 4          # 429 backoff attempts before giving up on a call

# --- Quota accounting (TEN-179 item 2) ---------------------------------------
# Discovery-only spend: exactly ONE metered call per run, the /v4/fixtures lookup.
# Everything else this script touches (/v4/historical-odds, /v4/account) is free.
# MEASURED 2026-09-10 on a 4-fixture board: meter 59 -> 60 across 1 fixtures call,
# 3 historical-odds calls and 2 account reads. These two constants only drive the
# log line in report_consumption(); they never gate a call, so a cadence change in
# odds-history.yml that forgets them makes the projection wrong, not the capture.
CAPTURE_INTERVAL_H = 3          # must track the cron in .github/workflows/odds-history.yml
EXPECTED_UNITS_PER_RUN = 1      # the single /v4/fixtures discovery call

# --- Join tolerance (TEN-179 item 3) -----------------------------------------
# Our board dates a match in the api-tennis ACCOUNT timezone; oddspapi startTime
# is UTC. Joining on an exact date string drops every match that falls on the
# other side of midnight for one of the two — measured 7/8 joined, the casualty
# being Shelton-Tsitsipas: board 2026-09-07 01:15, oddspapi 2026-09-06T23:15Z.
#
# The fix is NOT a wider date net; that would eventually mis-join two fixtures
# with the same two players on adjacent days. Instead: build the candidate set
# from a +/-1 day window AND a both-surnames orientation match, then pick the
# candidate NEAREST IN TIME to our start converted to UTC.
#
# JOIN_TOLERANCE_H is a sanity gate on that nearest pick, not the disambiguator.
# Measured over the 8 settled matches on 2026-09-10, the residual between our
# UTC-converted start and the fixture's startTime was 0-5 minutes (the board
# carries a rounded scheduled time). Two same-pair fixtures on adjacent days sit
# ~24h apart, so any bound well under 12h cannot reach the wrong day. 6h is ~72x
# the observed residual — loose enough to absorb a rescheduled or rain-delayed
# nominal start, tight enough that the wrong day stays unreachable.
JOIN_WINDOW_DAYS = 1
JOIN_TOLERANCE_H = 6.0
# A median needs a population. Calibrating on one or two samples is circular —
# the measured offset is that sample's own delta, so its residual is 0 by
# construction and the tolerance gate can never reject it. Below this many
# samples we assume no offset and let the gate do the work: a correctly joined
# match is ~2h out (well inside the gate), a wrong-day one is ~24h out (well
# outside it), so the gate separates them without any calibration at all.
MIN_CALIB_SAMPLES = 3

# The committed matches.json is written back only by the refreshers, so its
# match SET never advances on its own — the main pipeline rebuilds today's board
# and publishes it to Pages without ever committing it. Left alone the capture
# freezes on whatever fixtures were last committed by hand and reports success
# forever while capturing nothing. So take the live board as the fixture list.
LIVE_MATCHES_URL = 'https://michaeldk1996.github.io/SAAS/matches.json'
RETAIN_DAYS = 3        # keep committed-only matches this recent so nothing in flight is dropped


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


def log_quota(key, when):
    """Print the live oddspapi meter. /v4/account is itself unmetered, so this
    costs nothing and is the only honest read on consumption — the founder asked
    for actual usage logged every run rather than inferred from the code's own
    call arithmetic."""
    data, err = api_get('/v4/account', {}, key)
    if data is None:
        print(f'WARNING: could not read the oddspapi quota meter {when} ({err}).',
              file=sys.stderr)
        return None
    subs = [s for s in (data.get('subscriptions') or []) if s.get('is_active')]
    if not subs:
        print(f'::warning::oddspapi reports NO active subscription {when}.')
        return None
    s = subs[0]
    used, limit = s.get('request_count'), s.get('request_limit')
    books = ', '.join(sorted((s.get('bookmakers') or {}).keys())) or 'none'
    print(f'oddspapi quota {when}: {used}/{limit} request(s) used '
          f'({s.get("plan")} plan, valid until {str(s.get("valid_until"))[:10]}; '
          f'entitled books: {books}).')
    # The old 80%-of-cap ::warning:: lived here. It fired every run through the
    # Sep 2-10 outage into a log nobody opens, which is why the founder replaced
    # it (TEN-179 item 2) with a RUNWAY threshold routed to Telegram. Percentage
    # is the wrong unit: the same 80% is 15 days of notice at one cadence and
    # under 6 at another. bsp_alerts.alert_quota() now owns this decision — see
    # the end of main(). Nothing is duplicated here on purpose: two alarms for
    # one condition is how a channel gets muted.
    return used


def report_consumption(before, after, hist_calls):
    """TEN-179 item 2 (founder 2026-09-10): report the REAL per-run spend and the
    projection it implies, rather than restating the code's own call arithmetic.

    `before`/`after` are live /v4/account readings, so the delta is measured, not
    asserted. The design target is ONE unit per run — the single /v4/fixtures
    discovery call. /v4/historical-odds and /v4/account are both unmetered, which
    is why `hist_calls` can run into the dozens without moving the meter; printing
    it next to a delta of 1 is what makes that visible instead of assumed.
    """
    if before is None or after is None:
        print('::warning::Could not measure this run\'s quota delta (a meter read '
              'failed). Per-run consumption is unverified for this run.')
        return
    delta = after - before
    runs_per_month = 24 * 30 // CAPTURE_INTERVAL_H
    print(f'oddspapi consumption THIS RUN: {delta} billable unit(s) '
          f'({hist_calls} historical-odds call(s) and 2 account reads billed 0). '
          f'At the workflow\'s every-{CAPTURE_INTERVAL_H}h cadence that projects to '
          f'~{delta * runs_per_month}/month against {after}/5000 used to date.')
    if delta > EXPECTED_UNITS_PER_RUN:
        print(f'::warning::This run spent {delta} units, above the '
              f'{EXPECTED_UNITS_PER_RUN}-unit discovery-only design '
              f'(~{delta * runs_per_month}/month vs the intended '
              f'~{EXPECTED_UNITS_PER_RUN * runs_per_month}/month). Something is '
              f'calling a metered endpoint beyond the single /v4/fixtures lookup.')


def hist_get(fixture_id, books, key):
    """One /v4/historical-odds call for the given book(s), with 429 backoff.
    Callers pass exactly one book — see BOOKS. Returns (json, None) or
    (None, status)."""
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


def surname_board(name):
    """Our board names are '<initial>. <Surname>' — take the trailing token(s).

    Used only for the SHORT-surname path in orient(). Compound surnames keep their
    spaces on our board ('B. Van De Zandschulp'), so everything after the leading
    'X.' initial is the surname; that is what has to match a 2-letter oddspapi
    surname exactly rather than as a substring.
    """
    parts = (name or '').split()
    if parts and parts[0].endswith('.'):
        parts = parts[1:]
    return norm(' '.join(parts))


def orient(match, od_p1_name, od_p2_name):
    """'same' if match.p1 lines up with participant1, 'swap' if with participant2,
    else None. Requires BOTH players to match so a wrong fixture can't slip in.

    TEN-179 item 3 (2026-09-10): a surname shorter than 3 letters used to abort the
    whole orientation, so a fixture with a 2-letter surname could NEVER be joined and
    its open/close were lost with no diagnosis beyond "no fixture matched both
    surnames". Caught on a live capture test: 'Wu, Tung-Lin' v 'Castelnuovo, Luca'
    went unjoined purely because 'wu' is two letters. On the ATP board that costs
    Wu Yibing and Li Tu; on Challenger/ITF, where the Series page also draws, it is
    routine.

    The 3-letter floor exists for a real reason and is NOT simply lowered: `in` is a
    substring test against the whole normalised board name, so a 2-letter token
    matches promiscuously ('li' sits inside 'Molinari', 'Elias', 'Lisnard'). The fix
    keeps the permissive substring test for ordinary surnames and requires a SHORT
    surname to equal our board's surname token exactly, which cannot false-positive.
    """
    o1, o2 = surname_od(od_p1_name), surname_od(od_p2_name)
    if not o1 or not o2:
        return None

    def hit(od_surname, board_name):
        if len(od_surname) >= 3:
            return od_surname in norm(board_name)
        return od_surname == surname_board(board_name)

    if hit(o1, match.get('p1')) and hit(o2, match.get('p2')):
        return 'same'
    if hit(o1, match.get('p2')) and hit(o2, match.get('p1')):
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


def write_matches(matches):
    with open(MATCHES, 'w') as fh:
        json.dump(matches, fh, indent=2, ensure_ascii=False)


def match_keys(m):
    """Join keys for one match, most stable first.

    The event key is the only one that survives a match finishing. `id` carries an
    `upcoming-`/`past-` prefix that flips at that moment, and the feed also
    RE-DATES a fixture as it resolves — both observed live on 2026-07-16, where
    `upcoming-12146136` dated 07-15 became `past-12146136` dated 07-16. With only
    the id and date+names keys BOTH joins miss, so the finished match does not
    inherit the timeline captured while it was still upcoming — and since closing
    odds can only ever be derived from a pre-match series, they are then lost for
    good. That is the exact failure this capturer exists to prevent, so it joins
    on the event key first.
    """
    keys = []
    ek = event_key(m)
    if ek:
        keys.append(f"ek:{ek}")
    if m.get('id') is not None:
        keys.append(f"id:{m['id']}")
    keys.append(f"np:{m.get('date')}|{norm(m.get('p1'))}|{norm(m.get('p2'))}")
    return keys


def board_start_naive(m):
    """Our board's nominal start as a tz-naive-but-UTC-stamped datetime.

    m['date'] + m['time'] are api-tennis ACCOUNT-timezone wall clock, NOT UTC.
    This returns them stamped as UTC so the caller can subtract the measured
    account offset; on its own it is deliberately NOT a real instant.
    """
    t = m.get('time') or ''
    if not (m.get('date') and isinstance(t, str) and len(t) >= 5 and t[2] == ':'):
        return None
    try:
        return datetime.strptime(f"{m['date']} {t[:5]}", '%Y-%m-%d %H:%M').replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def fixture_start(f):
    try:
        return datetime.fromisoformat((f.get('startTime') or '').replace('Z', '+00:00'))
    except ValueError:
        return None


def join_fixtures(targets, fixtures, calibrate_from=None):
    """Join our matches to oddspapi fixtures. Returns (joined, unjoined).

    Two-stage, so a widened date net can never by itself pick a wrong fixture:

      1. CANDIDATES — both surnames must orient against the fixture's two
         participants (unchanged, and the strong constraint), and the fixture's
         UTC date must sit within JOIN_WINDOW_DAYS of our board date.
      2. DISAMBIGUATE — convert our start to UTC using the account offset
         MEASURED THIS RUN (below) and take the nearest candidate in time,
         rejecting anything beyond JOIN_TOLERANCE_H.

    The account offset is calibrated from the unambiguous joins in this very run
    rather than hardcoded, so it follows DST and any account-timezone change on
    its own. With no unambiguous join to learn from it falls back to 0 and the
    tolerance gate does the work.

    `calibrate_from` is the population the offset is MEASURED on, and it must be
    wider than `targets`. Calibrating on the targets alone is circular: with a
    single target the median is that target's own delta, the residual is 0 by
    construction, and the tolerance gate can never fire — so a lone match sitting
    10h from its only candidate would be joined anyway. That is not hypothetical;
    it is the ordinary late-night steady state, when every settled match is
    already captured and the only target is tomorrow's unopened final. Measuring
    across the whole seeded board keeps the median honest no matter how few
    matches actually need capturing this run.
    """
    def candidates_for(m):
        out = []
        if not m.get('date'):
            return out
        for f in fixtures:
            fs = fixture_start(f)
            if fs is None:
                continue
            if abs((fs.date() - datetime.strptime(m['date'], '%Y-%m-%d').date()).days) > JOIN_WINDOW_DAYS:
                continue
            ori = orient(m, f.get('participant1Name'), f.get('participant2Name'))
            if ori:
                out.append((f, fs, ori))
        return out

    by_match = [(m, candidates_for(m)) for m in targets if m.get('date')]

    # --- calibrate the account offset off the single-candidate joins ---
    calib = by_match if calibrate_from is None else \
        [(m, candidates_for(m)) for m in calibrate_from if m.get('date')]
    deltas = []
    for m, cands in calib:
        if len(cands) != 1:
            continue
        bs = board_start_naive(m)
        if bs is None:
            continue
        deltas.append((bs - cands[0][1]).total_seconds() / 3600.0)
    if len(deltas) >= MIN_CALIB_SAMPLES:
        deltas.sort()
        offset_h = deltas[len(deltas) // 2]          # median
        print(f'Account-timezone offset measured this run: {offset_h:+.2f}h '
              f'(median of {len(deltas)} unambiguous join(s) across the board, '
              f'range {min(deltas):+.2f}..{max(deltas):+.2f}).')
    else:
        offset_h = 0.0
        print(f'Account-timezone offset NOT calibrated: only {len(deltas)} '
              f'unambiguous join(s) available, below the {MIN_CALIB_SAMPLES} needed '
              f'for an honest median. Assuming +0.00h and letting the '
              f'+/-{JOIN_TOLERANCE_H}h tolerance gate do the work.')

    joined, unjoined = {}, []
    for m, cands in by_match:
        if not cands:
            unjoined.append((m, 'no fixture matched both surnames within '
                                f'+/-{JOIN_WINDOW_DAYS}d', None))
            continue
        bs = board_start_naive(m)
        if bs is None:
            # No usable clock on our side. A single candidate is still safe —
            # both surnames matched inside the window — so take it; more than
            # one is genuinely ambiguous and must not be guessed.
            if len(cands) == 1:
                f, fs, ori = cands[0]
                joined[id(m)] = {'fixtureId': f.get('fixtureId'), 'orient': ori,
                                 'startTime': f.get('startTime'), 'deltaH': None}
            else:
                unjoined.append((m, f'{len(cands)} candidates and no usable '
                                    'board time to disambiguate', None))
            continue
        ours = bs - timedelta(hours=offset_h)
        f, fs, ori = min(cands, key=lambda c: abs((ours - c[1]).total_seconds()))
        delta_h = (ours - fs).total_seconds() / 3600.0
        if abs(delta_h) > JOIN_TOLERANCE_H:
            unjoined.append((m, f'nearest candidate is {delta_h:+.2f}h away, '
                                f'beyond the +/-{JOIN_TOLERANCE_H}h tolerance',
                             f.get('startTime')))
            continue
        joined[id(m)] = {'fixtureId': f.get('fixtureId'), 'orient': ori,
                         'startTime': f.get('startTime'), 'deltaH': delta_h}
    return joined, unjoined


def event_key(m):
    """The api-tennis event key inside our id: '{upcoming|past}-<eventKey>'."""
    parts = str(m.get('id') or '').split('-')
    return '-'.join(parts[1:]) if len(parts) > 1 else ''


def seed_from_live(committed):
    """Return the fixture list to capture against: the live board, with any
    movement we already hold carried forward, plus committed-only matches from
    the last RETAIN_DAYS so a match still in flight is never dropped.

    Fail-soft on purpose — if Pages is unreachable this falls back to the
    committed list, i.e. exactly the old behaviour, rather than skipping a run.
    """
    try:
        req = urllib.request.Request(
            LIVE_MATCHES_URL, headers={'User-Agent': 'BSP-Consult-Dashboard/1.0'})
        with urllib.request.urlopen(req, timeout=60) as r:
            live = json.load(r)
        if not isinstance(live, list) or not live:
            raise ValueError(f'live matches.json is not a non-empty list ({type(live).__name__})')
    except Exception as e:
        print(f'WARNING: could not read the live board ({e}); '
              f'falling back to the committed matches.json.', file=sys.stderr)
        return committed

    def has_movement(m):
        return bool((m.get('oddsMovement') or {}).get('books'))

    prior = {}
    for cm in committed:
        if not has_movement(cm):
            continue
        for k in match_keys(cm):
            prior.setdefault(k, cm)

    carried = 0
    seen = set()
    for m in live:
        for k in match_keys(m):
            seen.add(k)
        if has_movement(m):
            continue
        pm = next((prior[k] for k in match_keys(m) if k in prior), None)
        if pm:
            m['oddsMovement'] = pm['oddsMovement']
            carried += 1

    cutoff = (datetime.now(timezone.utc) - timedelta(days=RETAIN_DAYS)).strftime('%Y-%m-%d')
    retained = [cm for cm in committed
                if has_movement(cm)
                and (cm.get('date') or '') >= cutoff
                and not any(k in seen for k in match_keys(cm))]

    print(f'Seeded from the live board: {len(live)} match(es) '
          f'(committed file held {len(committed)}); carried movement forward on '
          f'{carried}; retained {len(retained)} committed-only match(es) '
          f'newer than {cutoff}.')
    return live + retained


def main():
    key = read_key()
    if not key:
        print('ERROR: ODDSPAPI_KEY not found (.env or environment).', file=sys.stderr)
        sys.exit(1)

    quota_before = log_quota(key, 'before run')

    matches = seed_from_live(json.load(open(MATCHES)))
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
        write_matches(matches)
        return

    start = min(m['date'] for m in targets)
    stop = max(m['date'] for m in targets)
    # Widen the fixture window by a day on each side: our board dates in the
    # account timezone, so a match on our first/last day can legitimately carry a
    # UTC startTime on the day outside it. Without this the +/-1d join window has
    # nothing to reach for at the edges. Still exactly ONE quota unit.
    frm = (datetime.strptime(start, '%Y-%m-%d') - timedelta(days=JOIN_WINDOW_DAYS)).strftime('%Y-%m-%dT00:00:00Z')
    to = (datetime.strptime(stop, '%Y-%m-%d') + timedelta(days=JOIN_WINDOW_DAYS + 1)).strftime('%Y-%m-%dT00:00:00Z')

    # 1) fixtures (1 quota unit): names + fixtureId + startTime for the window.
    fixtures, err = api_get('/v4/fixtures', {'sportId': SPORT_TENNIS, 'from': frm, 'to': to}, key)
    if fixtures is None:
        print(f'::error::oddspapi fixtures fetch failed ({err}) — no odds captured this run.',
              file=sys.stderr)
        sys.exit(1)
    fixtures = fixtures if isinstance(fixtures, list) else (fixtures.get('data') or [])

    # 2) join, timezone-aware (see join_fixtures).
    joined, unjoined = join_fixtures(targets, fixtures, calibrate_from=matches)

    # Every match the join could not resolve is REPORTED with both timestamps —
    # never silently dropped. This is the class of failure that hid the
    # timezone bug: a match simply vanished from the capture with no trace.
    for m, why, fx_start in unjoined:
        bs = board_start_naive(m)
        print(f'::warning::UNJOINED {m.get("id")} {m.get("p1")} vs {m.get("p2")} — {why}. '
              f'board={m.get("date")} {m.get("time")} (naive {bs.isoformat() if bs else "n/a"}), '
              f'oddspapi={fx_start or "no candidate"}.')

    if not joined:
        print('::error::No oddspapi fixture joined any of the '
              f'{len(targets)} target match(es) — zero odds captured this run.',
              file=sys.stderr)
        write_matches(matches)
        sys.exit(1)

    # 3) per-fixture historical odds — one call, one book, no batching.
    captured = 0
    total_points = 0
    hist_calls = 0            # free calls, counted only for the consumption log
    book_hits = {b: 0 for b in BOOKS}
    gap_no_history = []     # fixture resolved but the book returned no series
    now_iso = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

    for m in targets:
        j = joined.get(id(m))
        if not j:
            continue            # already reported as unjoined above
        fx = j['fixtureId']
        swap = j['orient'] == 'swap'
        books_out = {}

        for b in BOOKS:
            time.sleep(HIST_SLEEP)
            hist_calls += 1
            data, herr = hist_get(fx, (b,), key)
            if data is None:
                print(f'::warning::historical-odds {b} failed for {m.get("id")} '
                      f'({m.get("p1")} vs {m.get("p2")}, fixture {fx}): HTTP {herr}.')
                continue
            _absorb(data, b, swap, books_out, book_hits)

        if books_out:
            pts = sum(len(s) for bk in books_out.values() for s in bk.values() if s)
            total_points += pts
            m['oddsMovement'] = {
                'market': 'Match Winner',
                'capturedAt': now_iso,
                # The fixture's real UTC start instant, carried so the pipeline's
                # closing cutoff has a PROVEN pre-first-ball reference instead of
                # inferring one from bet365's own tick cadence. See the TEN-179
                # note in bsp-pipeline.js. Stripped into the odds shard along with
                # the rest of oddsMovement, so it never reaches the client.
                'startTime': j.get('startTime'),
                # TEN-179 item 1: the oddspapi fixtureId, so the pipeline can join this
                # match to bet365-history/YYYY-MM.json and pin the EARLIER of the archived
                # open and this capture's first point. Same book, same endpoint — the two
                # only differ when the live capture first reached the fixture after its
                # market opened. Stripped with the rest of oddsMovement; never sent to the
                # client.
                'fixtureId': fx,
                'books': books_out,
            }
            captured += 1
        else:
            gap_no_history.append(m)

    write_matches(matches)

    cov = ', '.join(f'{BOOK_LABELS[b]}:{book_hits[b]}' for b in BOOKS)
    print(f'oddspapi history capture: {captured} match(es) with movement, '
          f'{total_points} price points total.')
    print(f'Book coverage (matches with a series) [{cov}].')
    print(f'Join: {len(joined)}/{len(targets)} target match(es) resolved to an '
          f'oddspapi fixture; {len(unjoined)} unjoined (listed above).')
    # A joined fixture with no bet365 series splits into two very different
    # cases, and conflating them would make this workflow permanently red:
    #   - COMPLETED: the timeline is frozen and we just lost its open/close for
    #     good. A real, unrecoverable shortfall.
    #   - UPCOMING: bet365 simply has not posted a price yet (a next-day final
    #     404s until the market opens). Entirely normal; the next run picks it up.
    gap_settled = [m for m in gap_no_history if m.get('finalScore')]
    gap_upcoming = [m for m in gap_no_history if not m.get('finalScore')]
    if gap_settled:
        print(f'GAP (COMPLETED, joined but no bet365 history — open/close lost): '
              f'{len(gap_settled)} match(es):')
        for m in gap_settled:
            print(f'  - {m.get("date")} {m.get("tour")}: {m.get("p1")} vs {m.get("p2")}')
    if gap_upcoming:
        print(f'Pending (upcoming, no bet365 price posted yet — normal, will retry): '
              f'{len(gap_upcoming)} match(es):')
        for m in gap_upcoming:
            print(f'  - {m.get("date")} {m.get("tour")}: {m.get("p1")} vs {m.get("p2")}')

    alerts = open_monitor(targets, joined, now_iso)

    quota_after = log_quota(key, 'after run')
    report_consumption(quota_before, quota_after, hist_calls)
    # TEN-179 item 2 — the runway verdict and, when it bites, the outbound alert.
    # This replaces the 80%-of-cap ::warning:: that used to live in log_quota().
    if bsp_alerts:
        bsp_alerts.alert_quota(
            key, cadence_note=f'This capture runs every {CAPTURE_INTERVAL_H}h; the '
                              f'card refresh (odds-now.yml) runs hourly.')

    # --- Fail loudly (TEN-179 item 2) ----------------------------------------
    # The old code wrote nothing and still exited 0, so the Actions run went
    # green while the board starved. Anything captured is written and committed
    # first (the workflow's commit step runs on failure too), then the RUN is
    # failed so a shortfall can never be reported as success.
    #
    # "Zero captured" is deliberately NOT the failure condition on its own. In
    # steady state — every settled match already captured, tomorrow's market not
    # yet open — a run legitimately captures nothing, and failing on that would
    # make this workflow red most nights. A permanently-red workflow hides the
    # real signal, which is the exact defect being fixed here. So the trigger is
    # a shortfall we actually care about:
    #
    #   unjoined     — a match we could not resolve to a fixture at all.
    #   gap_settled  — a COMPLETED match with no bet365 history: its open/close
    #                  are frozen and now permanently lost.
    #
    # Both are unrecoverable. An upcoming match with no price yet is neither.
    if unjoined or gap_settled:
        print(f'::error::Capture shortfall: {captured}/{len(targets)} match(es) got '
              f'movement — {len(unjoined)} unjoined, {len(gap_settled)} completed '
              f'match(es) joined but with no bet365 history (their open/close are '
              f'lost for good). Anything captured WAS written and committed; this '
              f'run is failed so the shortfall is not reported as success.',
              file=sys.stderr)
        sys.exit(1 if not captured else 2)
    if not captured:
        if gap_upcoming:
            print(f'::notice::Captured 0 of {len(targets)} target match(es): every '
                  f'remaining target is an upcoming match with no bet365 price '
                  f'posted yet. Nothing was capturable — not a failure.')
        else:
            print(f'::error::Captured movement on 0 of {len(targets)} target '
                  f'match(es) and nothing explains it. The odds on the live site '
                  f'will not advance.', file=sys.stderr)
            sys.exit(1)


def _parse(ts):
    """ISO-8601 (with or without Z) -> aware UTC datetime, or None."""
    if not isinstance(ts, str) or not ts:
        return None
    try:
        d = datetime.fromisoformat(ts.replace('Z', '+00:00'))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def open_monitor(targets, joined, now_iso):
    """TEN-179 item 3 — watch for upcoming fixtures inside T-OPEN_MONITOR_HOURS that
    still carry no bet365 opening price, and record the real posting-to-capture lag
    prospectively so the threshold can be refined off live data instead of the 9
    retrospective fixtures it was set from.

    Returns the list of alerting fixtures. Never raises: a monitor that can break the
    capture it is monitoring is worse than no monitor, so every step is guarded and a
    failure degrades to a warning.
    """
    try:
        now = _parse(now_iso) or datetime.now(timezone.utc)
        try:
            store = json.load(open(OPEN_MONITOR_FILE))
            if not isinstance(store, dict) or not isinstance(store.get('fixtures'), dict):
                raise ValueError('unexpected shape')
        except Exception:
            store = {'schema': 'odds-open-monitor/1', 'thresholdHours': OPEN_MONITOR_HOURS,
                     'fixtures': {}}
        store['thresholdHours'] = OPEN_MONITOR_HOURS
        store['updatedAt'] = now_iso
        fixtures = store['fixtures']

        alerts, measured = [], 0
        for m in targets:
            if m.get('finalScore'):
                continue                      # a settled fixture's open is already decided
            j = joined.get(id(m))
            if not j:
                continue                      # already reported through the unjoined path
            start = _parse(j.get('startTime'))
            if not start:
                continue                      # no proven start instant -> no honest T-24h
            hours_out = (start - now).total_seconds() / 3600.0
            if hours_out <= 0:
                continue                      # underway or past; not an opening question

            books = (m.get('oddsMovement') or {}).get('books') or {}
            ser = books.get('bet365') or {}
            pts = [p[0] for side in ('p1', 'p2') for p in (ser.get(side) or []) if p]
            fid = str(j.get('fixtureId'))
            rec = fixtures.get(fid) or {}

            if pts:
                open_at = _parse(min(pts))
                if open_at:
                    # postingLeadH is a property of the MARKET (start - first quote).
                    # captureLagH is a property of OUR pipeline (first run that saw it
                    # - first quote) and is frozen on first sight, which is what makes
                    # it a prospective measurement rather than a re-derived one.
                    rec.setdefault('firstSeenAt', now_iso)
                    first_seen = _parse(rec['firstSeenAt']) or now
                    rec.update({
                        'p1': m.get('p1'), 'p2': m.get('p2'), 'tour': m.get('tour'),
                        'date': m.get('date'), 'startTime': j.get('startTime'),
                        'openAt': min(pts),
                        'postingLeadH': round((start - open_at).total_seconds() / 3600.0, 2),
                        'captureLagH': round((first_seen - open_at).total_seconds() / 3600.0, 2),
                        'alerted': rec.get('alerted', False),
                    })
                    fixtures[fid] = rec
                    measured += 1
            elif hours_out <= OPEN_MONITOR_HOURS:
                rec.update({'p1': m.get('p1'), 'p2': m.get('p2'), 'tour': m.get('tour'),
                            'date': m.get('date'), 'startTime': j.get('startTime'),
                            'openAt': None, 'postingLeadH': None, 'captureLagH': None,
                            'alerted': True, 'alertedAt': rec.get('alertedAt', now_iso),
                            'hoursOutAtAlert': rec.get('hoursOutAtAlert', round(hours_out, 2))})
                fixtures[fid] = rec
                alerts.append((m, hours_out))

        with open(OPEN_MONITOR_FILE, 'w') as fh:
            json.dump(store, fh, indent=2, ensure_ascii=False, sort_keys=True)

        leads = sorted(r['postingLeadH'] for r in fixtures.values()
                       if isinstance(r.get('postingLeadH'), (int, float)))
        lead_txt = (f'{leads[0]:.1f}-{leads[-1]:.1f}h over {len(leads)} fixture(s), '
                    f'median {leads[len(leads) // 2]:.1f}h') if leads else 'no measurements yet'
        print(f'Open-monitor (T-{OPEN_MONITOR_HOURS:.0f}h): {measured} fixture(s) measured '
              f'this run, {len(alerts)} alerting. Posting lead so far: {lead_txt}.')

        for m, hours_out in alerts:
            print(f'::warning::No bet365 opening price for {m.get("p1")} v {m.get("p2")} '
                  f'({m.get("tour")}, {m.get("date")}) with {hours_out:.1f}h to start — '
                  f'inside the T-{OPEN_MONITOR_HOURS:.0f}h threshold. Every measured '
                  f'bet365 market posted earlier than this, so its OPEN is at risk.')
        if alerts:
            print(f'::error::Open-monitor: {len(alerts)} upcoming fixture(s) are inside '
                  f'T-{OPEN_MONITOR_HOURS:.0f}h with no bet365 opening price captured. '
                  f'Their open (and therefore their drift figure) will be lost if the '
                  f'market has already posted. Listed above; details in '
                  f'{os.path.basename(OPEN_MONITOR_FILE)}.', file=sys.stderr)
            # TEN-179 item 4 — this monitor used to MEASURE and not NOTIFY, which
            # the founder identified as the actual defect: "a warning that lands
            # somewhere unread is not a warning". One outbound send, operational
            # channel, deduped per fixture so a standing gap does not re-fire every
            # 3 hours for the whole day before the match.
            if bsp_alerts:
                lines = '\n'.join(
                    f'• {m.get("p1")} v {m.get("p2")} ({m.get("tour")}, '
                    f'{m.get("date")}) — {h:.1f}h to start'
                    for m, h in alerts[:12])
                more = f'\n…and {len(alerts) - 12} more' if len(alerts) > 12 else ''
                bsp_alerts.send(
                    f'⚠️ Missing bet365 OPEN — {len(alerts)} fixture(s) inside '
                    f'T-{OPEN_MONITOR_HOURS:.0f}h\n\n{lines}{more}\n\n'
                    f'Every bet365 market we have measured posted 27.7–46.2h before '
                    f'start, so these are outside the whole observed distribution. '
                    f'If the market has already opened, their OPEN — and the drift '
                    f'figure on the card — is lost for good.',
                    channel='ops',
                    dedupe_key='open-monitor:' + ','.join(
                        sorted(str(joined.get(id(m), {}).get('fixtureId'))
                               for m, _ in alerts)),
                    cooldown_h=12.0)
        return alerts
    except Exception as e:                      # never let the monitor break the capture
        print(f'::warning::Open-monitor failed ({e}) — capture itself was unaffected.')
        return []


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
