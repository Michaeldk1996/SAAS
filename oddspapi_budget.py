#!/usr/bin/env python3
"""TEN-225 ruling 6 — the shared oddspapi billable-unit budget.

Michael's ruling (2026-09-17T23:15Z, TEN-225):

  "6. ODDSPAPI BUDGET — control this now. The meter went 350 -> 698 in roughly a
   day against a 5,000/month plan.
     a. Report billable spend per job/run since 2026-09-10, what each was for,
        and the projected month-end total at current pace. State the exact quota
        reset date.
     b. Hard daily cap: 150 billable units across ALL jobs, shared, with a
        persisted counter. At the cap, billable calls stop and the run reports;
        free /v4/historical-odds calls continue.
     c. Any single run planning more than 50 billable units stops and asks first.
     d. Investigations use free endpoints and stored data. Billable calls are for
        the archive and the upcoming lane."

WHICH CALLS BILL — MEASURED, NOT ASSUMED (2026-09-18, this key)
--------------------------------------------------------------
Read the meter, make one call, read the meter again:

    /v4/markets              200  ->  +1 unit
    /v4/odds-by-tournaments  400  ->  +1 unit   <-- a FAILED call still bills
    /v4/fixtures             200  ->  +1 unit
    /v4/bookmakers           200  ->  +1 unit   <-- measured 2026-09-18, TEN-225
    /v4/historical-odds      400  ->   0 units
    /v4/account                   ->   0 units  <-- RE-MEASURED 2026-09-18:
        three consecutive reads gave 1078 -> 1078 -> 1078, delta 0 on both. An
        earlier pass in this issue reported it as billable; that was a bad
        inference from an uncounted second /v4/bookmakers call, not a
        measurement, and it is wrong. The free-list below is correct as it
        stands. Recorded here because a wrong entry on a budget guard's
        free-list is exactly what gets acted on later by someone with no
        reason to re-measure it.

Two things follow. A retry loop around a billable endpoint bills every attempt,
so "units spent" is never "rows returned". And because a 4xx bills, a counter we
increment ourselves on success would under-count exactly when a job is
misbehaving — which is why the counter of record here is oddspapi's own meter.

THE METER IS THE COUNTER; THE LEDGER IS THE DAY BOUNDARY
--------------------------------------------------------
`/v4/account -> request_count` is free, monotonic within a billing period, and
counts every job on the key whether or not that job knows about this module. It
cannot drift from what we are charged. The one thing it cannot tell us is where
the UTC day fell, so `oddspapi_budget_ledger` persists meter readings stamped
with job, run and day, and the daily cap is evaluated as

    spent_today = meter_now - baseline(today)

See ten225-budget-schema.sql for the baseline rule and the period-rollover case.

FAIL-CLOSED, WITH ONE NAMED EXCEPTION
-------------------------------------
No meter read -> nothing billable is allowed. That is absolute: we will not
spend units we cannot count.

Meter readable but the ledger unreachable -> we still know the period total, so
the 80%-of-limit period ceiling is still enforced, but the daily cap cannot be.
A run may then spend at most FALLBACK_FLOOR units, which is sized to let the
1-unit-per-run production jobs (odds-now, odds-history, bet365-archive) keep the
board alive through a Supabase blip while stopping anything bulk. The run says
so loudly in its log. This is the only place the gate opens without a counter,
and it is bounded at FALLBACK_FLOOR, not unbounded.

USAGE
-----
  python3 oddspapi_budget.py preflight --job odds-now --plan 1
  python3 oddspapi_budget.py commit    --job odds-now
  python3 oddspapi_budget.py report    --since 2026-09-10

`preflight` writes `allowed=true|false`, `reason=...`, `spent_today=...` and
`remaining_today=...` to $GITHUB_OUTPUT so a workflow can gate its billable step
on it. Exit codes:

  0   decision made and recorded (allowed, or stopped at the daily cap — the
      cap is an expected outcome, not a job failure)
  1   STOP AND ASK: the run planned more than PER_RUN_ASK units, or the budget
      could not be established at all. Loud on purpose; a human decides.

Stdlib only. Reads ODDSPAPI_KEY (env or .env), SUPABASE_URL and
SUPABASE_SECRET_KEY from the environment. Secrets are never printed.
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = 'https://api.oddspapi.io'
TABLE = 'oddspapi_budget_ledger'

DAILY_CAP = 150         # ruling 6b — shared across ALL jobs
PER_RUN_ASK = 50        # ruling 6c — a single run planning more than this stops
QUOTA_CEILING = 0.80    # standing rule — stop at 80% of request_limit
FALLBACK_FLOOR = 5      # max units allowed with the meter up but the ledger down
METER_RETRIES = 3       # /v4/account is free; a 429 on it must not stop a job
METER_RETRY_SLEEP = 2.0

# Endpoints that bill, measured on this key 2026-09-18. Anything not listed here
# is treated as billable: a new endpoint should be proved free, not assumed free.
FREE_PATHS = ('/v4/historical-odds', '/v4/account')


def log(msg):
    print(msg, flush=True)


def die_ask(msg):
    """Ruling 6c — stop and ask. Loud, non-zero, and never silently retried."""
    print(f'::error::TEN-225 budget gate — STOP AND ASK: {msg}', file=sys.stderr, flush=True)
    sys.exit(1)


# ------------------------------------------------------------------ credentials

def read_odds_key():
    env = os.path.join(HERE, '.env')
    if os.path.exists(env):
        for line in open(env):
            if line.strip().startswith('ODDSPAPI_KEY='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    return os.environ.get('ODDSPAPI_KEY')


def supabase_creds():
    return (os.environ.get('SUPABASE_URL') or '').rstrip('/'), \
           (os.environ.get('SUPABASE_SECRET_KEY') or '')


# ------------------------------------------------------------------- oddspapi

def is_billable(path):
    return not any(path.startswith(p) for p in FREE_PATHS)


def read_meter(key):
    """Free /v4/account read. Returns (used, limit, valid_until) or (None,)*3.

    Retried on 429. /v4/account is free but shares the key's rate limit, and a
    no-meter result is a hard stop for every gated job — so a transient 429
    here would take the archive and the upcoming lane down for a whole tick.
    Retrying a FREE endpoint costs nothing; the no-blind-retry rule that governs
    the billable endpoints does not apply to this one.
    """
    if not key:
        return None, None, None
    url = BASE + '/v4/account?' + urllib.parse.urlencode({'apiKey': key})
    req = urllib.request.Request(url, headers={'User-Agent': 'BSP-Consult-Dashboard/1.0'})
    data = None
    for attempt in range(METER_RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read().decode('utf-8'))
            break
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < METER_RETRIES - 1:
                time.sleep(METER_RETRY_SLEEP * (attempt + 1))
                continue
            log(f'::warning::budget gate could not read the oddspapi meter ({e}).')
            return None, None, None
        except Exception as e:
            log(f'::warning::budget gate could not read the oddspapi meter ({e}).')
            return None, None, None
    subs = [s for s in (data.get('subscriptions') or []) if s.get('is_active')]
    if not subs:
        log('::warning::budget gate: oddspapi reports NO active subscription.')
        return None, None, None
    s = subs[0]
    return s.get('request_count'), s.get('request_limit'), s.get('valid_until')


# ------------------------------------------------------------------- supabase

def sb(method, path, body=None, headers=None, timeout=60):
    url, key = supabase_creds()
    if not url or not key:
        return None, 'no-creds'
    h = {'Authorization': f'Bearer {key}', 'apikey': key,
         'Content-Type': 'application/json'}
    h.update(headers or {})
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(url + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return (json.loads(raw.decode('utf-8')) if raw else []), None
    except urllib.error.HTTPError as e:
        return None, f'{e.code} {e.read()[:200].decode("utf-8", "replace")}'
    except Exception as e:
        return None, str(e)


def ledger_rows(day_from, day_to=None):
    q = f'/rest/v1/{TABLE}?select=day,job,run_id,phase,meter,planned,decision,reason,created_at' \
        f'&day=gte.{day_from}&order=created_at.asc&limit=1000'
    if day_to:
        q += f'&day=lte.{day_to}'
    return sb('GET', q)


def ledger_write(row):
    return sb('POST', f'/rest/v1/{TABLE}?on_conflict=job,run_id,phase', body=[row],
              headers={'Prefer': 'resolution=merge-duplicates,return=minimal'})


def baseline_for(today, meter_now):
    """Meter value at the start of `today`, per the rule in the schema file.

    Returns (baseline, source). `source` is 'prior-day' | 'today-first' |
    'no-history' | 'period-reset', and None baseline means the ledger is down.
    """
    # 14 days back is more than enough to find the previous reading and keeps the
    # page well inside PostgREST's 1,000-row cap.
    since = (datetime.strptime(today, '%Y-%m-%d') - timedelta(days=14)).strftime('%Y-%m-%d')
    rows, err = ledger_rows(since)
    if rows is None:
        log(f'::warning::budget gate could not read the ledger ({err}).')
        return None, 'ledger-down'
    prior = [r for r in rows if r['day'] < today]
    if prior:
        base = prior[-1]['meter']
        src = 'prior-day'
    else:
        todays = [r for r in rows if r['day'] == today]
        if todays:
            base, src = min(r['meter'] for r in todays), 'today-first'
        else:
            base, src = meter_now, 'no-history'
    if meter_now < base:
        # The plan reset (valid_until rolled over) — the meter restarted at 0.
        return 0, 'period-reset'
    return base, src


# ------------------------------------------------------------------- decisions

def gh_output(**kw):
    p = os.environ.get('GITHUB_OUTPUT')
    if not p:
        return
    with open(p, 'a') as fh:
        for k, v in kw.items():
            fh.write(f'{k}={v}\n')


def preflight(args):
    key = read_odds_key()
    meter, limit, valid_until = read_meter(key)
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    run_id = args.run_id or os.environ.get('GITHUB_RUN_ID') or 'local'

    if args.observe:
        # OBSERVE-ONLY. Used by the three live capture jobs — odds-now,
        # odds-history, bet365-archive — which the TEN-225 spec puts on the
        # DO NOT TOUCH list and which each spend 1-3 units per run behind their
        # own budget logic. They still feed the shared ledger, because a cap
        # computed from a partial view of the key is the wrong number; what they
        # do not do is let this gate stop the board's price refresh. Making them
        # blocking is a one-word change and Michael's call, not mine.
        if meter is None:
            log(f'::warning::budget observe — `{args.job}` could not read the meter.')
        else:
            base, src = baseline_for(today, meter)
            spent = 'unknown' if base is None else max(0, meter - base)
            log(f'budget observe — `{args.job}` plan={args.plan}; today {spent}/{DAILY_CAP} '
                f'spent; meter {meter}/{limit}. Not blocking.')
            _record(today, args.job, run_id, 'pre', meter, limit, args.plan,
                    'observe', 'observe-only')
        gh_output(allowed='true', reason='observe-only', spent_today='-',
                  remaining_today='-')
        return 0

    if args.plan > PER_RUN_ASK:
        gh_output(allowed='false', reason='over-single-run-limit', spent_today='-',
                  remaining_today='-')
        die_ask(f'job `{args.job}` planned {args.plan} billable units; the single-run '
                f'limit is {PER_RUN_ASK} (ruling 6c). Nothing was spent. Split the '
                f'work or get a ruling before re-running.')

    if meter is None:
        gh_output(allowed='false', reason='no-meter', spent_today='-', remaining_today='-')
        die_ask(f'job `{args.job}` could not read the oddspapi meter, so its spend '
                f'cannot be counted. No billable call is allowed without a counter.')

    # Standing rule: never spend past 80% of the period limit.
    ceiling = int((limit or 0) * QUOTA_CEILING)
    if limit and meter + args.plan > ceiling:
        decision, reason = 'stop', 'period-ceiling'
        log(f'::warning::budget gate STOP — {args.job} needs {args.plan} units; meter is '
            f'{meter}/{limit} and the {int(QUOTA_CEILING * 100)}% ceiling is {ceiling}.')
        _record(today, args.job, run_id, 'pre', meter, limit, args.plan, decision, reason)
        gh_output(allowed='false', reason=reason, spent_today='-',
                  remaining_today=str(max(0, ceiling - meter)))
        return 0

    base, src = baseline_for(today, meter)

    if base is None:
        # Meter up, ledger down — bounded exception, see the module docstring.
        if args.plan <= FALLBACK_FLOOR:
            log(f'::warning::budget gate: ledger unreachable, daily cap NOT enforced this '
                f'run. Allowing {args.plan} unit(s) under the {FALLBACK_FLOOR}-unit '
                f'fallback floor. Meter {meter}/{limit}.')
            gh_output(allowed='true', reason='ledger-down-under-floor',
                      spent_today='unknown', remaining_today='unknown')
            return 0
        gh_output(allowed='false', reason='ledger-down', spent_today='unknown',
                  remaining_today='unknown')
        die_ask(f'job `{args.job}` planned {args.plan} units but the ledger is '
                f'unreachable, so the {DAILY_CAP}/day cap cannot be enforced. Only '
                f'<= {FALLBACK_FLOOR} units run without a counter.')

    spent = max(0, meter - base)
    remaining = max(0, DAILY_CAP - spent)

    if spent >= DAILY_CAP:
        decision, reason = 'stop', 'daily-cap'
        log(f'::warning::budget gate STOP — {spent}/{DAILY_CAP} billable units already '
            f'spent today ({today}, baseline {base} via {src}). `{args.job}` skips its '
            f'billable work. Free /v4/historical-odds calls are unaffected.')
    elif args.plan > remaining:
        decision, reason = 'stop', 'would-exceed-daily-cap'
        log(f'::warning::budget gate STOP — `{args.job}` planned {args.plan} units but '
            f'only {remaining} of the {DAILY_CAP}/day cap remain ({spent} spent, '
            f'baseline {base} via {src}).')
    else:
        decision, reason = 'allow', 'within-cap'
        log(f'budget gate ALLOW — `{args.job}` plan={args.plan}; today {spent}/{DAILY_CAP} '
            f'spent, {remaining} remain (baseline {base} via {src}); '
            f'meter {meter}/{limit}; period resets {valid_until}.')

    _record(today, args.job, run_id, 'pre', meter, limit, args.plan, decision, reason)
    gh_output(allowed='true' if decision == 'allow' else 'false', reason=reason,
              spent_today=str(spent), remaining_today=str(remaining))
    return 0


def _record(day, job, run_id, phase, meter, limit, planned, decision, reason):
    row = {'day': day, 'job': job, 'run_id': str(run_id), 'phase': phase,
           'meter': meter, 'limit_total': limit, 'planned': planned,
           'decision': decision, 'reason': reason}
    _, err = ledger_write(row)
    if err:
        log(f'::warning::budget gate could not record the {phase} row ({err}).')


def commit(args):
    """Post-run meter read, so a run's ACTUAL spend is on the record."""
    key = read_odds_key()
    meter, limit, _ = read_meter(key)
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    run_id = args.run_id or os.environ.get('GITHUB_RUN_ID') or 'local'
    if meter is None:
        log('::warning::budget gate: no post-run meter read; this run\'s spend is '
            'not on the record.')
        return 0
    rows, err = ledger_rows(today)
    pre = None
    if rows:
        for r in rows:
            if r['job'] == args.job and r['run_id'] == str(run_id) and r['phase'] == 'pre':
                pre = r
    spent = (meter - pre['meter']) if pre else None
    log(f'budget gate commit — `{args.job}` run {run_id}: meter now {meter}/{limit}'
        + (f', this run spent {spent} billable unit(s).' if spent is not None
           else ' (no pre row found; spend not attributable).'))
    _record(today, args.job, run_id, 'post', meter, limit, None, 'commit',
            f'spent={spent}' if spent is not None else 'spent=unknown')
    return 0


def report(args):
    key = read_odds_key()
    meter, limit, valid_until = read_meter(key)
    rows, err = ledger_rows(args.since)
    print(f'oddspapi meter: {meter}/{limit}; period resets {valid_until}.')
    print(f'daily cap {DAILY_CAP}; single-run ask threshold {PER_RUN_ASK}.')
    if rows is None:
        print(f'ledger unreadable ({err}).')
        return 0
    if not rows:
        print(f'ledger has no rows since {args.since}.')
        return 0
    by_run = {}
    for r in rows:
        by_run.setdefault((r['day'], r['job'], r['run_id']), {})[r['phase']] = r
    print(f'\n{"day":11s} {"job":26s} {"run":14s} {"pre":>6s} {"post":>6s} {"spent":>6s}  decision')
    tot = {}
    for (day, job, run), ph in sorted(by_run.items()):
        a = ph.get('pre', {}).get('meter')
        b = ph.get('post', {}).get('meter')
        d = (b - a) if (a is not None and b is not None and b >= a) else None
        if d is not None:
            tot[job] = tot.get(job, 0) + d
        print(f'{day:11s} {job:26s} {str(run):14s} {str(a):>6s} {str(b):>6s} '
              f'{str(d):>6s}  {ph.get("pre", {}).get("decision", "-")}')
    print('\nmeasured units by job:')
    for k, v in sorted(tot.items(), key=lambda kv: -kv[1]):
        print(f'  {k:26s} {v}')
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)

    p = sub.add_parser('preflight', help='decide whether this run may spend units')
    p.add_argument('--job', required=True)
    p.add_argument('--plan', type=int, required=True,
                   help='billable units this run intends to spend')
    p.add_argument('--run-id')
    p.add_argument('--observe', action='store_true',
                   help='record the meter in the shared ledger but never block '
                        '(for the DO-NOT-TOUCH live capture jobs)')
    p.set_defaults(fn=preflight)

    p = sub.add_parser('commit', help='record the post-run meter')
    p.add_argument('--job', required=True)
    p.add_argument('--run-id')
    p.set_defaults(fn=commit)

    p = sub.add_parser('report', help='ledger + meter report')
    p.add_argument('--since', default='2026-09-10')
    p.set_defaults(fn=report)

    args = ap.parse_args()
    sys.exit(args.fn(args))


if __name__ == '__main__':
    main()
