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

# Written and owned by refresh-odds.py's fixture_map(); READ-ONLY here. It is the
# only zero-quota route from one of our matches to an oddspapi fixtureId, which
# is what lets --first-appearance sweep every 15 minutes without billing.
FIXTURE_MAP_FILE = os.path.join(HERE, 'odds-fixture-map.json')
HIST_SLEEP = 5.5        # /v4/historical-odds cools down at ~1 call / 5s
MAX_RETRY = 4          # 429 backoff attempts before giving up on a call

# TEN-179 item 5, founder ruling 2026-09-11: "Widen the free sweep to all upcoming
# fixtures. It's unmetered and its last tick is identical to the metered price, so this
# is free freshness."
#
# The constraint is PACING, not money. /v4/historical-odds costs nothing but cools down
# at ~1 call / 5s, and the sweep has to finish well inside a 15-minute tick or it collides
# with the next one. 480s of calling against a 900s tick leaves the commit, push and the
# stale-NOW monitor comfortable headroom.
#
# When the board is bigger than the budget the sweep CUTS, and it says what it cut — a
# silent truncation reads as "we covered everything" when we did not. The cut is taken
# from the far end: already-opened fixtures are ordered by start-time proximity and the
# most distant are dropped, while every UNOPENED fixture is swept regardless of budget.
# Unopened is the original mission (an unpinned OPEN is unrecoverable once the market
# has moved); a distant fixture's NOW going one tick stale is recoverable by definition.
SWEEP_BUDGET_S = float(os.environ.get('SWEEP_BUDGET_S', '480'))

# --first-appearance exit code for "this leg is guaranteed free and it billed"
# (founder ruling 2026-09-11, item 4). A DISTINCT code, not a generic 1: the loop
# has to tell "the sweep failed" (retry next tick, job stays green — it runs 96
# times a day and a red run four times an hour is how a real signal gets ignored)
# apart from "the sweep spent money it cannot spend" (stand the leg down, fail the
# job). 9 is outside the range bash gives to signals and outside ci-commit-push.sh's
# 0/1/3 contract, so it can never be produced by accident.
BILLED_RC = 9

# Strike marker for the two-sweep confirmation below. UNTRACKED on purpose: the REDO
# path in ci-commit-push.sh does `git reset --hard`, which leaves untracked files alone,
# so a strike survives a push race. A fresh runner starts with no strike, which fails
# SAFE (one extra tick of delay) rather than toward a spurious red.
BILLED_STRIKE_FILE = os.path.join(HERE, '.first-appearance-billed-strike')


def _billed_strike(record=None, clear=False):
    """Read/set/clear the 'the free leg billed' strike. Returns True if a PRIOR strike
    existed. Never raises — a marker problem must not break a capture."""
    try:
        had = os.path.exists(BILLED_STRIKE_FILE)
        if clear:
            if had:
                os.remove(BILLED_STRIKE_FILE)
            return had
        if record is not None:
            with open(BILLED_STRIKE_FILE, 'w') as fh:
                fh.write(f'{datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")} {record}\n')
        return had
    except Exception as e:
        print(f'::warning::Could not maintain the billed-strike marker ({e}).')
        return False

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
    """Write matches.json ATOMICALLY — temp file alongside, fsync, then rename.

    `open(path, 'w')` truncates immediately, so a process killed mid-`json.dump` leaves a
    TRUNCATED matches.json on disk. That was survivable when this ran a couple of times a
    day. It is not now: the capture loop writes this file ~22 times per 5h30m window, is
    designed to be interrupted (SIGTERM on cancel / redeploy / job timeout), and its
    signal trap deliberately commits and pushes whatever is on disk on the way out — so a
    half-written file would reach main and then break every consumer that json.loads it
    (refresh-odds.py, bsp-pipeline.js, the published board).

    os.replace() is atomic on POSIX: a reader sees either the whole old file or the whole
    new one, never a partial. Same discipline bsp-pipeline.js already applies via
    writeJsonAtomic() — this is the Python side of the repo catching up.
    """
    tmp = f'{MATCHES}.tmp'
    with open(tmp, 'w') as fh:
        json.dump(matches, fh, indent=2, ensure_ascii=False)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, MATCHES)


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

    def observed_at(m):
        return _parse(((m.get('bet365Now') or {}).get('observedAt')))

    prior, prior_now = {}, {}
    for cm in committed:
        if has_movement(cm):
            for k in match_keys(cm):
                prior.setdefault(k, cm)
        # TEN-179 — the free-sweep NOW ROLLBACK, founder ruling 2026-09-11 ("fold in the
        # free-sweep NOW rollback at the same time").
        #
        # THE DEFECT: this function returns the LIVE (published) board and write_matches()
        # then writes it over the committed file. The published board is one pipeline
        # cycle behind — ~55 min at the delivered `*/15` rate, plus ~5 min of CDN — so the
        # bet365Now that refresh-odds.py wrote locally on the hourly metered leg was being
        # REPLACED by the older published copy. oddsMovement was carried forward here;
        # bet365Now never was. The metered read therefore had a lifetime of one sweep.
        #
        # Pre-existing (main() runs 3-hourly and has always done this) but item 5 widens
        # the sweep to every upcoming fixture, which removes the "0 targets" early return
        # that was masking it and makes it fire 4x/hour on a full board.
        #
        # The fix is MONOTONIC BY CONSTRUCTION: carry forward only when the committed
        # observation is strictly NEWER. It can never replace a fresher value with a
        # staler one in either direction, and it invents nothing — the price and both
        # timestamps travel together, untouched.
        if cm.get('bet365Now') and observed_at(cm):
            for k in match_keys(cm):
                prior_now.setdefault(k, cm)

    carried = now_kept = 0
    seen = set()
    for m in live:
        for k in match_keys(m):
            seen.add(k)
        if not has_movement(m):
            pm = next((prior[k] for k in match_keys(m) if k in prior), None)
            if pm:
                m['oddsMovement'] = pm['oddsMovement']
                carried += 1
        # Completed cards are excluded: bsp-pipeline.js deletes bet365Now on a finished
        # match (it renders open -> close), so carrying one forward here would resurrect
        # a leg the board has deliberately dropped.
        if not m.get('finalScore'):
            pn = next((prior_now[k] for k in match_keys(m) if k in prior_now), None)
            if pn:
                live_obs, committed_obs = observed_at(m), observed_at(pn)
                if live_obs is None or committed_obs > live_obs:
                    m['bet365Now'] = pn['bet365Now']
                    now_kept += 1

    cutoff = (datetime.now(timezone.utc) - timedelta(days=RETAIN_DAYS)).strftime('%Y-%m-%d')
    retained = [cm for cm in committed
                if has_movement(cm)
                and (cm.get('date') or '') >= cutoff
                and not any(k in seen for k in match_keys(cm))]

    print(f'Seeded from the live board: {len(live)} match(es) '
          f'(committed file held {len(committed)}); carried movement forward on '
          f'{carried}; kept the fresher committed bet365Now on {now_kept} (the '
          f'published board is a pipeline cycle behind); retained {len(retained)} '
          f'committed-only match(es) newer than {cutoff}.')
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
    newly_opened = set()    # ids of matches whose bet365 series THIS run created
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
        had_series = bool((m.get('oddsMovement') or {}).get('books'))
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
            # Only a series this run CREATED is a first sighting. Re-capturing a fixture
            # we have held for days and stamping firstSeenAt = now would make
            # bsp-pipeline.js resolve its OPEN to the last quote at or before NOW — i.e.
            # the current price. Same gate as first_appearance(); without it here, this
            # 3-hourly run silently undid the sweep's gate within one cycle.
            if not had_series:
                newly_opened.add(id(m))
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

    alerts = open_monitor(targets, joined, now_iso, newly_opened=newly_opened)

    quota_after = log_quota(key, 'after run')
    report_consumption(quota_before, quota_after, hist_calls)
    # TEN-179 item 2 — the runway verdict and, when it bites, the outbound alert.
    # This replaces the 80%-of-cap ::warning:: that used to live in log_quota().
    if bsp_alerts:
        bsp_alerts.alert_quota(
            key, cadence_note=f'This capture runs every {CAPTURE_INTERVAL_H}h; the '
                              f'card refresh (odds-now.yml) runs hourly.',
            by='odds-history')

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


def open_monitor(targets, joined, now_iso, newly_opened=None):
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

        alerts, measured, unknown_sighting = [], 0, 0
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
                    #
                    # `newly_opened` gates the stamp (TEN-179 item 5). When the caller
                    # passes it, only a fixture whose series THIS call created may claim
                    # "first seen now". Without that gate, re-sweeping a fixture we have
                    # held for days but which has no monitor record would stamp
                    # firstSeenAt = now, and bsp-pipeline.js would then resolve its OPEN
                    # to the last quote at or before NOW — i.e. the current price. A
                    # fixture with no record and no fresh sighting keeps no firstSeenAt
                    # at all, which is the pipeline's explicit, counted series[0]
                    # fallback: honest about what we do not know.
                    may_stamp = newly_opened is None or id(m) in newly_opened
                    if 'firstSeenAt' not in rec:
                        if not may_stamp:
                            fixtures[fid] = {**rec, 'p1': m.get('p1'), 'p2': m.get('p2'),
                                             'tour': m.get('tour'), 'date': m.get('date'),
                                             'startTime': j.get('startTime'),
                                             'openAt': min(pts),
                                             'postingLeadH': round(
                                                 (start - open_at).total_seconds() / 3600.0, 2),
                                             'captureLagH': None,
                                             'firstSightingUnknown': True,
                                             'alerted': rec.get('alerted', False)}
                            # NOT `measured` — this is the fixture we explicitly declined
                            # to measure. Counting it would report a captureLag sample we
                            # deliberately refused to invent.
                            unknown_sighting += 1
                            continue
                        rec['firstSeenAt'] = now_iso
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
              f'this run, {unknown_sighting} with a series but no recorded first sighting '
              f'(OPEN falls back to series[0] — never stamped as a sighting), '
              f'{len(alerts)} alerting. Posting lead so far: {lead_txt}.')

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


def first_appearance():
    """TEN-179 item 3 (founder authorised 2026-09-11) — the 15-minute,
    ZERO-QUOTA sweep for fixtures whose bet365 market has not opened yet.

        python3 refresh-odds-history.py --first-appearance

    Why a separate mode rather than just running main() every 15 minutes:
    main() opens with an unconditional billable /v4/fixtures call. At 15-minute
    resolution that is 96 units/day = ~2,900/month against a 5,000 cap — 58% of
    the whole subscription spent on discovery. The founder's ruling was
    explicitly "zero quota", so this mode NEVER calls /v4/fixtures. It resolves
    fixtureId from odds-fixture-map.json, the cache that refresh-odds.py's
    hourly metered run already maintains, and simply skips anything that cache
    cannot answer — the next hourly run maps it.

    Everything this mode calls is free: /v4/historical-odds (unmetered, see
    report_consumption) and /v4/account (unmetered). It PROVES that rather than
    asserting it, by reading the meter either side and failing loudly on any
    delta.

    Target population = upcoming, dated fixtures that carry NO bet365 series
    yet. That is precisely the set whose OPEN is still unpinned. Re-sweeping a
    fixture that already has a series buys nothing for OPEN (it is pinned) and
    costs 5.5s of pacing each, so the sweep stays small and fast even on a full
    board.

    This mode NEVER exits non-zero on "no price posted yet" — it runs 4x an
    hour, and a red workflow four times an hour is how a real signal gets
    ignored (37 unread red runs, Sep 2-10).
    """
    key = read_key()
    if not key:
        print('ERROR: ODDSPAPI_KEY not found (.env or environment).', file=sys.stderr)
        return 1

    quota_before = log_quota(key, 'before first-appearance sweep')
    now = datetime.now(timezone.utc)
    now_iso = now.strftime('%Y-%m-%dT%H:%M:%SZ')

    def settle(n_calls):
        """Close out the run by CHECKING the zero-quota guarantee, on every exit path.

        Founder ruling 2026-09-11 item 4. This used to live only at the bottom of the
        function, so the early "nothing to sweep" return below skipped it entirely —
        and that is the one path on which the ONLY calls made are the two /v4/account
        meter reads. If those ever started billing, the leg most likely to be taken
        (a quiet board sweeps nothing) was also the one path that could never notice.
        The guarantee is now unconditional.
        """
        b, a = quota_before, log_quota(key, 'after first-appearance sweep')
        if not (isinstance(a, int) and isinstance(b, int)):
            return 0                     # meter unreadable; report_consumption already warned
        if a == b:
            print(f'Quota: meter unchanged at {a} across {n_calls} historical-odds '
                  f'call(s) — the sweep is free, as measured.')
            _billed_strike(clear=True)
            return 0

        # TWO STRIKES, and not out of timidity — the meter is a GLOBAL counter and our
        # window is not exclusive. odds-history.yml (cron `0 */3`, concurrency group
        # `bsp-odds-history`) and bet365-archive.yml each spend a /v4/fixtures unit and
        # run in DIFFERENT concurrency groups from this loop, so either can bill inside
        # the seconds-to-minutes between our two meter reads. On a 20-target board the
        # sweep windows cover ~12% of the day against 8 odds-history runs — on the order
        # of one false red PER DAY, which is exactly the cry-wolf failure this ruling
        # exists to end (37 unread red runs, Sep 2-10).
        #
        # A concurrent job's spend is a one-off; an endpoint that has genuinely started
        # billing repeats on EVERY sweep. So confirm across two consecutive sweeps. The
        # false-alarm rate then needs two independent coincidences 15 minutes apart, and
        # detection is delayed by one tick — 15 minutes, against a monthly cap.
        #
        # The strike marker is deliberately UNTRACKED: ci-commit-push.sh's REDO path does
        # `git reset --hard`, which does not touch untracked files, so a strike survives a
        # push race. A new runner starts with no strike, which fails SAFE (one extra tick
        # of delay), never toward a spurious red.
        if not _billed_strike(record=a - b):
            print(f'::warning::First-appearance sweep saw the meter move {b} -> {a} '
                  f'({a - b} unit(s)) on a leg that must be free. A concurrent job '
                  f'(odds-history.yml, bet365-archive.yml) can bill inside our meter '
                  f'window, so this is NOT failing the run yet — it fails on the next '
                  f'sweep if the delta repeats.', file=sys.stderr)
            return 0

        # Confirmed on two consecutive sweeps. BILLED_RC makes odds-capture-loop.sh stand
        # the leg down and fail the job. The captures already written are kept — they are
        # real, and they have been paid for.
        print(f'::error::First-appearance sweep was supposed to be free but the '
              f'meter moved {b} -> {a} ({a - b} unit(s)). At 15-minute cadence that '
              f'is {(a - b) * 96} units/day. Something in this path now bills.',
              file=sys.stderr)
        if bsp_alerts:
            bsp_alerts.send(
                f'🛑 Zero-quota guarantee BROKEN — the 15-minute first-appearance '
                f'sweep billed {a - b} unit(s) (meter {b} → {a}).\n\n'
                f'At 96 sweeps/day that is {(a - b) * 96} units/day against a 5,000 '
                f'monthly cap. The sweep has been stood down for the rest of this '
                f'loop window and the run is failing. Nothing is capturing opens at '
                f'15 minutes until this is diagnosed.',
                channel='ops', dedupe_key='first-appearance-billed', cooldown_h=1.0)
        _billed_strike(clear=True)       # the alarm has fired; don't re-fire on the stale strike
        return BILLED_RC


    matches = seed_from_live(json.load(open(MATCHES)))

    try:
        fmap = (json.load(open(FIXTURE_MAP_FILE)) or {}).get('byKey') or {}
    except Exception as e:
        print(f'::warning::No usable {os.path.basename(FIXTURE_MAP_FILE)} ({e}) — this '
              f'sweep has no zero-quota way to resolve a fixtureId. Nothing captured; '
              f'the hourly metered run will rebuild the cache.')
        # settle(), not a bare return: quota_before has ALREADY made its /v4/account
        # call by this point, so this path must assert the guarantee like every other.
        # It is also the path taken right after a `git reset --hard` onto a base that
        # predates odds-fixture-map.json, so it is not rare.
        return settle(0)

    # --- target selection (item 5: unopened FIRST, then refresh within budget) ---
    unopened, already_open, unmapped = [], [], []
    for m in matches:
        if m.get('finalScore') or not m.get('date'):
            continue
        rec = fmap.get(event_key(m)) or {}
        if not rec.get('fixtureId'):
            unmapped.append(m)
            continue
        if (m.get('oddsMovement') or {}).get('books'):
            already_open.append((m, rec))   # OPEN pinned; swept now for NOW freshness
        else:
            unopened.append((m, rec))       # OPEN unpinned — the time-critical set

    def starts_at(pair):
        return _parse((pair[1] or {}).get('startTime')) or datetime.max.replace(
            tzinfo=timezone.utc)

    # Drop fixtures whose start instant has passed. They are underway, not upcoming:
    # open_monitor ignores them (`hours_out <= 0`), their OPEN is long pinned, and the
    # pipeline's NOW pick on a started-but-unsettled match takes the last quote at or
    # before *now*, which on a started match can be an IN-PLAY tick. Sorting "soonest
    # first" put them at the head of the queue, so they were the one group the budget
    # cut could never reach.
    underway = [pr for pr in already_open if starts_at(pr) <= now]
    already_open = [pr for pr in already_open if starts_at(pr) > now]
    already_open.sort(key=starts_at)        # soonest first; the cut falls at the far end
    per_fixture_s = max(HIST_SLEEP * len(BOOKS), 0.001)   # never divide by zero
    room = max(0, int(SWEEP_BUDGET_S / per_fixture_s) - len(unopened))
    refresh, dropped = already_open[:room], already_open[room:]
    targets = unopened + refresh

    if not targets:
        print(f'First-appearance sweep: 0 fixture(s) resolvable from cache '
              f'({len(unmapped)} awaiting the hourly mapping run). 0 quota units.')
        return settle(0)

    est_s = len(targets) * per_fixture_s
    print(f'First-appearance sweep: {len(unopened)} unopened + {len(refresh)} already-open '
          f'(NOW refresh) = {len(targets)} fixture(s), ~{est_s:.0f}s of pacing against a '
          f'{SWEEP_BUDGET_S:.0f}s budget; {len(underway)} underway fixture(s) excluded '
          f'(started — their NOW would be an in-play tick).')
    if dropped and SWEEP_BUDGET_S > 0:
        # Never a silent cap. A truncated sweep that reports a clean total is how a
        # coverage gap gets mistaken for coverage.
        print(f'::warning::Sweep budget cut {len(dropped)} already-open fixture(s) from '
              f'this tick — the most distant by start time. Their OPEN is already pinned '
              f'and unaffected; their NOW waits for the hourly metered leg. Furthest '
              f'kept: {(starts_at(refresh[-1]).strftime("%Y-%m-%dT%H:%MZ") if refresh else "none")}. '
              f'Raise SWEEP_BUDGET_S or shorten the tick if this persists.')
    # SWEEP_BUDGET_S == 0 is the REDO replay's deliberate "unopened only" signal, not an
    # overrun — don't warn about it every push race.
    if SWEEP_BUDGET_S > 0 and len(unopened) * per_fixture_s > SWEEP_BUDGET_S:
        print(f'::warning::The unopened set alone needs ~{len(unopened) * per_fixture_s:.0f}s, '
              f'over the {SWEEP_BUDGET_S:.0f}s budget. It is swept anyway — an unpinned OPEN '
              f'is unrecoverable once the market moves — but this tick will overrun.')

    joined, captured, refreshed, opened = {}, 0, 0, []
    newly_opened = set()
    book_hits = {b: 0 for b in BOOKS}
    # The budget above is a NOMINAL estimate — it assumes one call per book at
    # HIST_SLEEP. It is not a bound: hist_get() backs off on a 429 with
    # `HIST_SLEEP * (attempt + 2)` up to MAX_RETRY, so a single fixture can cost
    # 5.5 + 5.5*(2+3+4+5) = 82.5s, and a rate-limited run could take 15x the estimate
    # and overrun the 15-minute tick entirely. So the budget is also enforced as a real
    # wall clock: stop STARTING new fixtures once it is spent. The loop recomputes its
    # sleep to the next wall-clock boundary, so an overrun costs a tick rather than
    # drifting the whole schedule — but an unbounded sweep would still stall the commit,
    # the push and the stale-NOW monitor behind it.
    started = time.monotonic()
    budget_cut = 0
    for idx, (m, rec) in enumerate(targets):
        if time.monotonic() - started > SWEEP_BUDGET_S and not (
                idx < len(unopened)):
            # Unopened fixtures (the first slice of `targets`) are never abandoned —
            # an unpinned OPEN is unrecoverable once the market moves. Only the
            # NOW-refresh tail is cut, and it is counted, not dropped silently.
            budget_cut = len(targets) - idx
            print(f'::warning::Sweep wall clock exceeded {SWEEP_BUDGET_S:.0f}s after '
                  f'{idx} fixture(s) — almost certainly /v4/historical-odds 429 backoff. '
                  f'{budget_cut} already-open fixture(s) abandoned this tick; their OPEN '
                  f'is pinned and unaffected, their NOW waits one tick.')
            break
        swap = rec.get('orient') == 'swap'
        joined[id(m)] = {'fixtureId': rec['fixtureId'], 'orient': rec.get('orient'),
                         'startTime': rec.get('startTime')}
        had_series = bool((m.get('oddsMovement') or {}).get('books'))
        books_out = {}
        for b in BOOKS:
            time.sleep(HIST_SLEEP)
            data, herr = hist_get(rec['fixtureId'], (b,), key)
            if data is None:
                # 404 here is the normal answer for a market that has not opened.
                # It is a miss, not a transport failure — do not shout about it.
                if herr != 404:
                    print(f'::warning::historical-odds {b} failed for {m.get("id")} '
                          f'(fixture {rec["fixtureId"]}): HTTP {herr}.')
                continue
            _absorb(data, b, swap, books_out, book_hits)

        if not books_out:
            # Nothing observed. Leave whatever we already hold EXACTLY as it is — in
            # particular do not advance capturedAt, which would claim an observation
            # that did not happen, and do not blank an existing series on a 404.
            continue

        if had_series:
            # MERGE, never replace. oddspapi prunes historical density with age, so a
            # refetched series can be SHORTER at the old end than the one we hold — and
            # the OPEN pin is "the last bet365 quote at or before firstSeenAt", which
            # lives at exactly that end. Replacing wholesale would silently move the
            # open to a later, worse price. Union on timestamp, keep both ends.
            m['oddsMovement'] = _merge_movement(m['oddsMovement'], books_out, now_iso)
            refreshed += 1
        else:
            m['oddsMovement'] = {'market': 'Match Winner', 'capturedAt': now_iso,
                                 'startTime': rec.get('startTime'),
                                 'fixtureId': rec['fixtureId'], 'books': books_out}
            captured += 1
            newly_opened.add(id(m))
            opened.append(m)

    write_matches(matches)

    # open_monitor() stamps firstSeenAt — the instant WE first held a price for
    # this fixture. That field is the whole point of sweeping at 15 minutes: it
    # is the only record of how close our first sighting got to the market's
    # posting instant, and it is frozen on first write so it stays a prospective
    # measurement. Feeding this sweep into it is what shrinks captureLagH.
    #
    # `newly_opened` is NOT optional now that item 5 re-sweeps already-open fixtures.
    # firstSeenAt is set with `rec.setdefault(...)`, so a fixture that has carried a
    # series for days but has NO monitor record — every fixture captured before the
    # monitor existed — would be stamped firstSeenAt = NOW. bsp-pipeline.js resolves
    # OPEN as "the last bet365 quote at or before firstSeenAt", so that stamp would
    # resolve the open to the CURRENT price. Deriving an open from the current price is
    # precisely what the founder's standing rule forbids. Only fixtures whose series
    # this call actually created may claim a first sighting.
    open_monitor([m for m, _ in targets], joined, now_iso, newly_opened=newly_opened)

    for m in opened:
        ser = ((m.get('oddsMovement') or {}).get('books') or {}).get('bet365') or {}
        pts = [p[0] for side in ('p1', 'p2') for p in (ser.get(side) or []) if p]
        first = min(pts) if pts else None
        lag = _parse(first)
        lag_txt = (f'{(now - lag).total_seconds() / 60.0:.1f} min after bet365\'s first '
                   f'quote') if lag else 'lag unknown'
        print(f'  OPENED {m.get("date")} {m.get("tour")}: {m.get("p1")} v {m.get("p2")} '
              f'— first sighted {lag_txt}.')

    print(f'First-appearance sweep: {captured} newly-opened fixture(s) captured and '
          f'{refreshed} already-open fixture(s) refreshed, of {len(targets)} targeted in '
          f'{time.monotonic() - started:.0f}s; {len(unmapped)} not yet in the fixture '
          f'cache; {len(dropped)} pre-cut by budget, {budget_cut} cut by the wall clock.')

    # log_quota returns the raw request_count int (not the subscription dict) —
    # it is the same reading report_consumption() takes either side of main().
    # The COUNT ACTUALLY MADE, not the count targeted — the wall-clock cut can abandon
    # the tail, and a settle() line claiming calls we never made is the kind of log that
    # gets quoted back later as a measurement.
    return settle(len(targets) - budget_cut)


def _collapse_runs(points):
    """Keep the FIRST and LAST point of every run of identical prices; drop the interior.

    Without this the merge grows without bound. extract_series() already collapses runs
    on the way out of the API, but it REWRITES the run's end timestamp to the latest
    sighting of that price — so re-fetching the same unchanged market yields a slightly
    different timestamp each time, a union-on-timestamp never dedupes it, and the series
    accretes one extra point per side per sweep. At 96 sweeps a day on a fixture several
    days out that is hundreds of points in a file committed 96 times a day.

    Every surviving point is a REAL bet365 (instant, price) pair; nothing is interpolated,
    averaged or synthesised, and the run's first point — the instant bet365 actually moved
    to that price — is always kept, so the old end of the series (where OPEN lives) cannot
    move to a later quote. The interior points carry no information the two ends do not:
    they are repeat sightings of a price that did not change.

    NOTE for the founder: for a not-yet-pinned fixture whose first-sighting cut falls
    INSIDE such a run, the pinned open's `at` becomes the instant bet365 moved to that
    price rather than the last time we happened to see it. The PRICE is identical either
    way. Say the word and this becomes first-and-last-plus-the-cut instead.
    """
    out = []
    for i, pt in enumerate(points):
        prev_same = i > 0 and points[i - 1][1] == pt[1]
        next_same = i + 1 < len(points) and points[i + 1][1] == pt[1]
        if prev_same and next_same:
            continue                    # interior of a flat run
        out.append(pt)
    return out


def _merge_movement(existing, books_new, now_iso):
    """Union a freshly-fetched bet365 series into the one we already hold.

    TEN-179 item 5. Re-sweeping an already-open fixture is what makes NOW move for free,
    but it must not be allowed to SHORTEN the series. Two reasons:

      - oddspapi prunes historical density with age. The old end of the series is where
        the OPEN lives, and the pin is "the last bet365 quote at or before firstSeenAt".
        A wholesale replace would move the open to a later, worse price — deriving an
        open from a newer price, which the founder's standing rule forbids outright.
      - A partial response (one book 200, another 404) must not blank the other book.

    Union on timestamp, keep the earliest ends, never interpolate, never synthesise a
    point. Every value that survives is a real bet365 quote from a real instant.
    """
    out = dict(existing or {})
    books = dict(out.get('books') or {})
    for label, series_new in (books_new or {}).items():
        old = books.get(label) or {}
        merged = {}
        for side in ('p1', 'p2'):
            by_ts = {}
            for pt in (old.get(side) or []):
                if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                    by_ts[pt[0]] = list(pt)
            for pt in (series_new.get(side) or []):
                if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                    by_ts[pt[0]] = list(pt)     # same instant, same quote — a no-op
            merged[side] = _collapse_runs([by_ts[k] for k in sorted(by_ts)])
        books[label] = merged
    out['books'] = books
    out['market'] = out.get('market') or 'Match Winner'
    out['capturedAt'] = now_iso                 # we really did observe, just now
    return out


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
    if '--first-appearance' in sys.argv:
        sys.exit(first_appearance())
    main()
