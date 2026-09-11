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

# FOUNDER RULING 2026-09-11 (TEN-179 item 2): 4.0 -> 1.0.
#
# What this number actually bounds. `--first-appearance` can only sweep a fixture the
# map can resolve, and the map is written ONLY here, on the hourly metered run. So a
# fixture cached as a MISS is invisible to the 15-minute sweep for the whole TTL, and
# first-sighting lag is bounded by `TTL + metered interval + sweep interval`, not by
# the sweep interval. 4.0h meant <=5h15m; 1.0h means <=2h15m.
#
# What it costs. fixture_map() makes at most ONE /v4/fixtures call per RUN covering the
# whole date window — not one per missing fixture — so the ceiling is set by the number
# of runs (hourly => 24/day), not by the miss count. Worst case <=24 extra units/day,
# ~1,680/month on today's board (33.6% of the 5,000 cap) and ~2,400 on a full 8-tournament
# board (48.0%). Both are ceilings assuming a miss stands 24/7; missAudit below measures
# the real figure.
#
# 1.0 is also the FLOOR that means anything: the map has no other writer, so it cannot
# be refreshed faster than the hourly run and any TTL below 1h is dead code.
MAP_MISS_TTL_H = 1.0           # re-ask this often for a draw that has not posted
MISS_AUDIT_KEEP = 400          # rolling per-run audit records inside the map file

# --- the metered spend marker (TEN-179 item 3) -------------------------------
# UNTRACKED on purpose. ci-commit-push.sh's REDO path does `git reset --hard`, which
# leaves untracked files alone — so a record of "this hour is already paid for" survives
# a push race, which is the whole point. odds-capture-loop.sh reads it through
# metered-spend-guard.py before deciding to run this script again.
SPEND_MARKER_FILE = os.path.join(HERE, '.metered-spend-marker')

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


def _why_stale(rec, now):
    """Classify why a mapping needs re-asking. This is the instrument behind the
    founder's follow-up on item 2: "report how often the TTL actually bites — I want
    the real number rather than the ceiling."

    Three causes, and only one of them is the TTL:
      unmapped    — never in the cache at all. Would force a call at ANY TTL.
      miss-expired — cached as a MISS and MAP_MISS_TTL_H elapsed. THIS is the TTL biting.
      hit-expired  — a resolved fixtureId aged past MAP_HIT_TTL_H (36h).
    """
    if not rec or not _hist._parse(rec.get('mappedAt')):
        return 'unmapped'
    return 'miss-expired' if not rec.get('fixtureId') else 'hit-expired'


def _mark_spend(**fields):
    """Merge fields into the untracked metered-spend marker. Never raises — a marker
    problem must not break a capture, and the guard fails OPEN (allows the spend) when
    it cannot read one."""
    try:
        rec = {}
        if os.path.exists(SPEND_MARKER_FILE):
            try:
                rec = json.load(open(SPEND_MARKER_FILE)) or {}
            except Exception:
                rec = {}
        rec.update(fields)
        tmp = f'{SPEND_MARKER_FILE}.tmp'
        with open(tmp, 'w') as fh:
            json.dump(rec, fh, indent=2, sort_keys=True)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, SPEND_MARKER_FILE)
    except Exception as e:
        print(f'::warning::Could not maintain the metered-spend marker ({e}).')


def _settle_spend_marker(key):
    """Close out a marker left in 'attempted' state, on EVERY exit path including an
    unhandled exception.

    An attempt whose outcome we never measured must count as BILLED, because that is the
    conservative reading: a 400 and a 429 both bill (meter 182->183->184 measured across
    two 400s). Leaving it 'attempted' is what makes the guard hold for 55 minutes rather
    than re-buying a call we may already have paid for. /v4/account is free, so the one
    extra read this costs on a crashed run is not itself a spend.
    """
    try:
        rec = json.load(open(SPEND_MARKER_FILE))
        if rec.get('status') != 'attempted':
            return
    except Exception:
        return
    sub = bsp_alerts.active_subscription(key) if key else None
    used = (sub or {}).get('request_count')
    before = rec.get('usedBefore')
    if isinstance(used, int) and isinstance(before, int):
        _mark_spend(status='complete', usedAfter=used, delta=used - before,
                    settledBy='exit-path')
    else:
        # Meter unreadable — leave it 'attempted'. The guard reads that as billed.
        print('::warning::Metered spend marker left unsettled (meter unreadable); the '
              'spend guard will treat this hour as already paid for.')


def _record_miss_audit(mp, now_iso, n_upcoming, causes, spent, open_misses):
    """Append this run's mapping-cache decision to the map file's rolling audit.

    Answers the founder's follow-up with a measurement rather than a ceiling:

      runs                 — the denominator. Every hourly run, spending or not.
      spentRuns            — runs that made a /v4/fixtures call at all.
      ttlBitRuns           — runs where an expired MISS was the ONLY reason for it.
                             THIS is what MAP_MISS_TTL_H costs, in runs.
      ttlBitShare          — ttlBitRuns / runs. Multiply by 24 for units/day.
      missResolutionHoursP50/Max — how long a miss stood before oddspapi listed it.
                             THIS is what the TTL buys: a miss that resolves inside
                             an hour is caught ~1h15m sooner at TTL 1.0 than at 4.0.
    """
    try:
        audit = mp.get('missAudit')
        if not isinstance(audit, dict) or not isinstance(audit.get('runs'), list):
            audit = {'runs': []}
        ttl_bit = bool(causes.get('miss-expired')
                       and not causes.get('unmapped')
                       and not causes.get('hit-expired'))
        audit['runs'].append({
            'at': now_iso, 'upcoming': n_upcoming, 'stale': sum(causes.values()),
            'unmapped': causes.get('unmapped', 0),
            'missExpired': causes.get('miss-expired', 0),
            'hitExpired': causes.get('hit-expired', 0),
            'openMisses': open_misses, 'fixturesUnitsSpent': spent,
            'ttlBit': ttl_bit,
        })
        audit['runs'] = audit['runs'][-MISS_AUDIT_KEEP:]

        runs = audit['runs']
        spent_runs = sum(1 for r in runs if r.get('fixturesUnitsSpent'))
        bit_runs = sum(1 for r in runs if r.get('ttlBit'))

        # The projection was `24 * bit_runs / len(runs)`, which silently ASSUMED exactly
        # 24 runs a day. It is not 24: the bill-aware retry lets this script run up to
        # 4x an hour on a failing tick, and every loop restart adds one. Measuring what
        # the TTL costs per day while assuming the run rate would understate the one
        # number the founder asked to be real rather than a ceiling. Derive the rate
        # from the records' own timestamps instead.
        stamps = sorted(t for t in (_hist._parse(r.get('at')) for r in runs) if t)
        span_days = ((stamps[-1] - stamps[0]).total_seconds() / 86400.0) if len(stamps) > 1 else 0.0
        runs_per_day = (len(stamps) / span_days) if span_days > 0.02 else None
        held = sorted(v for v in (rec.get('missHeldH') for rec in mp['byKey'].values())
                      if isinstance(v, (int, float)))
        audit['observed'] = {
            'ttlHours': MAP_MISS_TTL_H, 'runs': len(runs),
            'spentRuns': spent_runs, 'ttlBitRuns': bit_runs,
            'ttlBitShare': round(bit_runs / len(runs), 3) if runs else None,
            'measuredRunsPerDay': round(runs_per_day, 1) if runs_per_day else None,
            'observedSpanDays': round(span_days, 2),
            # None until the window is wide enough to measure a run rate. A projection
            # off an assumed cadence is a ceiling wearing a measurement's clothes.
            'projectedTtlUnitsPerDay': (round(runs_per_day * bit_runs / len(runs), 1)
                                        if runs_per_day and runs else None),
            'missResolutionsMeasured': len(held),
            'missResolutionHoursP50': held[len(held) // 2] if held else None,
            'missResolutionHoursMax': held[-1] if held else None,
            'note': 'ttlBitRuns counts runs where an expired MISS was the ONLY reason a '
                    'billable /v4/fixtures call was made. projectedTtlUnitsPerDay uses '
                    'the MEASURED run rate (measuredRunsPerDay), not an assumed 24/day; '
                    'it is null until observedSpanDays is wide enough to measure one. '
                    'Compare it against the <=24/day ceiling the TTL was chosen against. '
                    'openMisses counts only fixtures still on the board.',
        }
        mp['missAudit'] = audit
        o = audit['observed']
        proj = (f'~{o["projectedTtlUnitsPerDay"]} units/day at a measured '
                f'{o["measuredRunsPerDay"]} runs/day, against a <=24 ceiling'
                if o['projectedTtlUnitsPerDay'] is not None
                else f'units/day not yet measurable ({o["observedSpanDays"]}d of records)')
        print(f'Fixture-map miss audit: {o["ttlBitRuns"]}/{o["runs"]} run(s) spent a '
              f'/v4/fixtures unit solely because a MISS aged past {MAP_MISS_TTL_H}h '
              f'({proj}); {open_misses} miss(es) open on the current board; '
              f'{o["missResolutionsMeasured"]} resolution(s) measured, median '
              f'{o["missResolutionHoursP50"]}h.')
    except Exception as e:
        print(f'::warning::Could not record the fixture-map miss audit ({e}) — the '
              f'mapping itself is unaffected.')


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
    # Hoisted. The miss audit below runs on EVERY path — including the cache-hit path
    # that spends nothing, which is the steady state the cache exists to produce — so
    # `now_iso` cannot live inside the branch that makes the billable call. It did, and
    # the result was an UnboundLocalError that killed the whole metered leg while the
    # loop kept ticking green (caught by the clean-context review, reproduced).
    now_iso = now.strftime('%Y-%m-%dT%H:%M:%SZ')
    stale = [m for m in upcoming
             if not _fresh(by_key.get(_hist.event_key(m)), now)]

    # --- item 2 instrumentation: how often does the TTL actually bite? ---------
    # Reported as a ceiling until now ("<=24 units/day"). The founder asked for the
    # real number. `ttlBit` counts the runs in which a MISS going stale is the ONLY
    # reason a /v4/fixtures call was spent — i.e. the runs the TTL genuinely bought.
    causes = {'unmapped': 0, 'miss-expired': 0, 'hit-expired': 0}
    for m in stale:
        causes[_why_stale(by_key.get(_hist.event_key(m)), now)] += 1
    # Only misses for matches STILL on the board. by_key is never pruned, so counting
    # every null record it has ever held would grow monotonically and include matches
    # that finished days ago — "N misses currently open" has to mean currently.
    upcoming_keys = {_hist.event_key(m) for m in upcoming}
    open_misses = sum(1 for k, r in by_key.items()
                      if k in upcoming_keys and not r.get('fixtureId'))

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
            for m in stale:
                ek = _hist.event_key(m)
                if not ek:
                    continue
                prev = by_key.get(ek) or {}
                j = joined.get(id(m))
                if j:
                    rec = {'fixtureId': j['fixtureId'],
                           'tournamentId': tid_by_fx.get(j['fixtureId']),
                           'orient': j['orient'], 'startTime': j.get('startTime'),
                           'p1': m.get('p1'), 'p2': m.get('p2'),
                           'mappedAt': now_iso}
                    # How long this fixture sat unresolvable before oddspapi listed it.
                    # This is the BENEFIT side of the TTL: a miss that resolves in 40
                    # minutes is caught 1h15m sooner at TTL 1.0 than at 4.0; one that
                    # takes 30h is caught at the same moment either way.
                    if prev.get('missSince'):
                        rec['missSince'] = prev['missSince']
                        rec['missRuns'] = int(prev.get('missRuns') or 0)
                        held = _hist._parse(prev['missSince'])
                        if held:
                            rec['missHeldH'] = round((now - held).total_seconds() / 3600.0, 2)
                    by_key[ek] = rec
                else:
                    # Cache the MISS so an unpublished draw does not force a
                    # billable call every hour. Reported, never silent.
                    by_key[ek] = {'fixtureId': None, 'tournamentId': None,
                                  'orient': None, 'startTime': None,
                                  'p1': m.get('p1'), 'p2': m.get('p2'),
                                  'mappedAt': now_iso,
                                  'missSince': prev.get('missSince') or now_iso,
                                  'missRuns': int(prev.get('missRuns') or 0) + 1}
            for m, why, fx_start in unjoined:
                print(f'::warning::UNMAPPED {m.get("id")} {m.get("p1")} vs '
                      f'{m.get("p2")} — {why}.')
            mp['updatedAt'] = now_iso
    else:
        print(f'Fixture mapping served entirely from cache for all {len(upcoming)} '
              f'upcoming match(es) — 0 units spent on /v4/fixtures this run.')

    # --- persist the map + the miss audit, on BOTH branches --------------------
    # The audit has to record the runs that spent NOTHING too, or "how often does the
    # TTL bite" is measured only over the runs where it bit — which is 100% by
    # construction. Denominator and numerator come from the same population.
    _record_miss_audit(mp, now_iso, len(upcoming), causes, spent, open_misses)
    try:
        with open(FIXTURE_MAP_FILE, 'w') as fh:
            json.dump(mp, fh, indent=2, ensure_ascii=False, sort_keys=True)
    except Exception as e:
        print(f'::warning::Could not persist the fixture map ({e}) — next run '
              f'will spend another /v4/fixtures unit.')

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

    # TEN-179 item 3 — arm the spend marker BEFORE the first billable call, not after.
    # fixture_map() can spend a /v4/fixtures unit, and a run that dies between here and
    # the settle below must still be read as "this hour is paid for". Recording the
    # attempt first is what makes the guard conservative on every crash path.
    _mark_spend(at=now_iso, usedBefore=used_before, status='attempted', delta=None,
                run=os.environ.get('GITHUB_RUN_ID', 'local'))

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
    # `by` tags the sample as OURS. odds-quota-history.json is the spend guard's
    # repo-side floor for a FRESH runner that has no untracked marker, and
    # refresh-odds-history.py's 3-hourly main() writes samples into the same file.
    # Without the tag the guard would read that run's sample as an hourly NOW spend
    # and suppress a leg that had not actually run.
    st = bsp_alerts.alert_quota(
        key, cadence_note='Cadence is flat hourly (odds-now.yml), the approved option (a).',
        by='metered-now')
    if st and isinstance(used_before, int):
        delta = st['used'] - used_before
        expected = spent + calls
        _mark_spend(status='complete', usedAfter=st['used'], delta=delta,
                    settledBy='main')
        print(f'oddspapi consumption THIS RUN: {delta} billable unit(s) measured '
              f'({spent} fixtures + {calls} odds call(s) expected = {expected}). '
              f'At flat-hourly that projects to ~{delta * 720}/month.')
        if delta > expected:
            print(f'::warning::This run spent {delta} units against an expected '
                  f'{expected}. Something is calling a metered endpoint beyond the '
                  f'accounted ones.')


if __name__ == '__main__':
    # The marker must be settled on EVERY exit path — a clean return, an early return
    # that made no call, and an unhandled exception. `finally` is the only construct
    # that covers all three, and the crash path is exactly the one the bill-aware retry
    # exists for: refresh-odds.py dying after fixture_map() has already billed is how a
    # persistent failure re-bought a /v4/fixtures unit every 15 minutes.
    _key_for_settle = read_key()
    try:
        main()
    finally:
        _settle_spend_marker(_key_for_settle)
