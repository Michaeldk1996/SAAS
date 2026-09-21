#!/usr/bin/env python3
"""TEN-225 founder directive 2026-09-21 item 1 — DENSER SWEEPS NEAR THE START.

  "Sweep every 1-2 minutes from T-30 to the live flip, for every Kibl fixture.
   Kibl is free and unmetered; watch for 429/Retry-After and back off."

THE DIRECTIVE'S OWN PREMISE IS WHY THIS IS TWO CHANGES AND NOT ONE. The stated
loss is that "32.6% of bet105 closes (44 of 135) are 0.000 suspension markers,
so those fixtures lose their Close entirely". Sweeping denser near the off does
NOT fix that on its own — it makes it WORSE, and the reason is in close_of():

    pre = [o for o in obs_list if o.get('price_decimal') is not None ...]
    return pre[-1]

`0.000` is not None, so the suspension marker is eligible to BE the Close, and
it wins because it is last. Sweeping more often near the off raises the odds
that the last row before the start is the suspension rather than a price. So
item 1 needs both halves:

  (a) CAPTURE  — sweep every ~90s from T-30 through the start, so a real price
                 exists close to the off.
  (b) SELECT   — skip the unbettable marker when choosing Open/Now/Close, so the
                 real price is the one that gets chosen.

(b) is the half that recovers closes we ALREADY HOLD: for a fixture whose close
is 0.000 there is almost always an earlier real price in the same series, and
today it is discarded in favour of a marker the publisher then suppresses —
which is how a fixture with a perfectly good last price renders a dash.

Replayable: RESULT tested before the anchor, so a second run on a checkout that
already carries the change is a verified no-op rather than an ::error::.

Usage: python3 ten225-apply-dense-sweep.py <repo-root>
"""
import os
import sys

EDITS = []
ARCH = 'archive-kibl.py'
CARD = 'ten225-kibl-card-state.py'
CLIENT = 'kibl_client.py'


def edit(path, name, old, new):
    EDITS.append((path, name, old, new))


# ══════════════════════════════════════════════════════════════════════════
# (c) THE CLIENT — honour Retry-After, which the founder named explicitly
# ══════════════════════════════════════════════════════════════════════════
# The header was already being CAPTURED into meta['rate_headers'] and never
# read. A fixed 5/10/15s ladder is a guess; Retry-After is the server telling us
# the answer. Reading it matters more now than it did: a dense loop makes ~3x
# the calls in the one window where the feed is busiest, and this feed is a
# favour rather than a contract.
edit(CLIENT, 'client: 429 honours Retry-After when the server sends one',
     """            if status == 429 or (500 <= status < 600):
                last_err = KiblError(status, raw.decode("utf-8", "replace"), url)
                if attempt < retries - 1:
                    time.sleep(5 * (attempt + 1))
                    continue""",
     """            if status == 429 or (500 <= status < 600):
                last_err = KiblError(status, raw.decode("utf-8", "replace"), url)
                if attempt < retries - 1:
                    # FOUNDER 2026-09-21: "watch for 429/Retry-After and back
                    # off". The header was already being captured into
                    # meta["rate_headers"] above and never read — a fixed
                    # 5/10/15s ladder is our guess, Retry-After is the server's
                    # answer, and ignoring it is how a polite client becomes an
                    # impolite one. Clamped at 120s so a malformed or hostile
                    # value cannot park a job for the rest of its window; the
                    # floor is our own ladder, so this can only ever wait
                    # LONGER than before, never shorter.
                    time.sleep(retry_after_seconds(hdrs, 5 * (attempt + 1)))
                    continue""")

edit(CLIENT, 'client: the Retry-After parser',
     """class KiblError(RuntimeError):""",
     """def retry_after_seconds(headers, floor, cap=120.0):
    \"\"\"Seconds to wait after a 429 -> max(floor, Retry-After), capped.

    RFC 9110 allows Retry-After to be either delta-seconds or an HTTP-date. Only
    the delta-seconds form is honoured here: the date form needs the server's
    clock, and a client that trusts a remote clock to schedule its own backoff
    has two ways to be wrong instead of one. An unparseable or absent header
    falls back to `floor`, which is the behaviour this replaced — so a feed that
    never sends the header is unaffected.

    NEVER RETURNS LESS THAN `floor`. A server asking us to come back sooner than
    our own pacing is not a reason to speed up.
    \"\"\"
    raw = (headers or {}).get('retry-after')
    if raw is None:
        return floor
    try:
        return min(cap, max(floor, float(str(raw).strip())))
    except (TypeError, ValueError):
        return floor


class KiblError(RuntimeError):""")


# ══════════════════════════════════════════════════════════════════════════
# (a) CAPTURE — the dense tier and the in-run loop
# ══════════════════════════════════════════════════════════════════════════
edit(ARCH, 'archive: import time for the dense loop',
     """import os
import sys
import urllib.error""",
     """import os
import sys
import time
import urllib.error""")

edit(ARCH, 'archive: the dense-tier constants',
     """CADENCE_GRACE_MIN = 0.5
""",
     """CADENCE_GRACE_MIN = 0.5

# ── TEN-225 FOUNDER DIRECTIVE 2026-09-21 item 1 ────────────────────────────
#   "Sweep every 1-2 minutes from T-30 to the live flip, for every Kibl
#    fixture. Kibl is free and unmetered."
#
# 90 seconds, inside the ruled 1-2 minutes. Not 60: one pass is ~7 calls at the
# client's 1.25s pacing (~9s of wire time) across 3 leagues, and a 60s cadence
# on a busy board leaves little margin before a pass overruns its own interval.
DENSE_MIN = 1.5
DENSE_WINDOW_MIN = 30.0        # "from T-30"
# "...to the live flip". We do not hold a Kibl-side flip signal: kibl_fixtures
# carries no state column, and live_flip_log is keyed on api-tennis event ids,
# so stopping AT the flip would mean a cross-source join on every pass. Instead
# the band runs 30 minutes PAST the scheduled start, which covers the flip in
# both directions — MEASURED, the flip runs EARLY against the schedule (median
# -11.0 min, min -860.0, n=17) as well as late. Sweeping a market that has
# already flipped is harmless: it writes suspension rows, and (b) below makes
# those unselectable. Sweeping one that has NOT flipped yet is the whole point.
DENSE_POST_START_MIN = 30.0
# How long ONE dispatch may spend in the dense loop before handing back.
# The pinger is `*/5 * * * *` and the workflow's concurrency group is
# cancel-in-progress:false, so a job that outruns 5 minutes does not get
# cancelled — it makes the NEXT firing queue behind it, and a third firing then
# cancels the queued one. 180s of looping plus the main sweep lands inside one
# interval with margin, giving passes at t=0/90/180 and letting the next
# dispatch continue the 90-second rhythm rather than collide with it.
DENSE_BUDGET_S = 180.0
""")

edit(ARCH, 'archive: should_sweep learns the dense tier',
     """    near = (minutes_to_next_start is not None
            and 0.0 <= minutes_to_next_start <= NEAR_START_WINDOW_MIN)
    floor = NEAR_START_MIN if near else BASELINE_MIN
    if minutes_since_last + CADENCE_GRACE_MIN >= floor:
        return True, ('near-start' if near else 'baseline')
    return False, (f'too soon: {minutes_since_last:.2f} min since the last '
                   f'sweep, floor is {floor:.0f} '
                   f'({"near-start" if near else "baseline"}, '
                   f'{CADENCE_GRACE_MIN:.1f} min grace)')""",
     """    floor, tier = sweep_floor(minutes_to_next_start)
    grace = cadence_grace(floor)
    if minutes_since_last + grace >= floor:
        return True, tier
    return False, (f'too soon: {minutes_since_last:.2f} min since the last '
                   f'sweep, floor is {floor:g} '
                   f'({tier}, {grace:g} min grace)')""")

edit(ARCH, 'archive: the tier function',
     """def should_sweep(minutes_since_last, minutes_to_next_start):""",
     """def cadence_grace(floor):
    \"\"\"The jitter forgiveness for a given floor, capped at a tenth of it.

    CAUGHT BY A TEST, NOT BY READING. The flat 0.5-minute grace was measured and
    sized against the 5-MINUTE near-start floor, where it is a 10% nudge that
    stops a 5-minute pinger skipping on a 4.9-minute gap. Applied unchanged to
    the new 1.5-minute dense floor it is a 33% discount: should_sweep(1.0, 30.0)
    came back SWEEP, so the founder's 1-2 minute cadence would in fact have run
    at ~1.0 minutes and the floor would have stopped being a floor.

    A tenth of the floor reproduces 0.5 exactly at the 5-minute floor and is
    capped back to 0.5 at 15, so the measured near-start and baseline behaviour
    is unchanged to the digit, while the dense tier gets 0.15 — real jitter
    forgiveness, proportionate to a floor a tenth the size.
    \"\"\"
    return min(CADENCE_GRACE_MIN, floor / 10.0)


def sweep_floor(minutes_to_next_start):
    \"\"\"(floor in minutes, tier name) for a fixture this many minutes away.

    Three tiers, widest floor last. `minutes_to_next_start` is SIGNED: negative
    means the fixture's scheduled start has already passed, which is a real
    state we must keep sweeping through — the market is live-or-about-to-be and
    the last pre-flip price is the one we are here for.

    ORDER MATTERS AND IS NOT INCIDENTAL. The dense band [-30, +30] sits entirely
    inside the near-start band [0, 180], so testing near-start first would
    shadow dense completely and this whole change would be a no-op that still
    passed every test written against should_sweep's return value.
    \"\"\"
    t = minutes_to_next_start
    if t is None:
        return BASELINE_MIN, 'baseline'
    if -DENSE_POST_START_MIN <= t <= DENSE_WINDOW_MIN:
        return DENSE_MIN, 'dense'
    if 0.0 <= t <= NEAR_START_WINDOW_MIN:
        return NEAR_START_MIN, 'near-start'
    return BASELINE_MIN, 'baseline'


def should_sweep(minutes_since_last, minutes_to_next_start):""")

edit(ARCH, 'archive: cadence_inputs sees started fixtures and takes the TIGHTEST floor',
     """    to_start = None
    hi = now + dt.timedelta(minutes=NEAR_START_WINDOW_MIN)
    rows, err = sb_request(
        "GET",
        f"/rest/v1/{TABLE_FIXTURES}?select=scheduled_start"
        f"&scheduled_start=gte.{iso(now)}&scheduled_start=lte.{iso(hi)}"
        f"&order=scheduled_start.asc&limit=1",
        url, key)
    if err:
        print(f"::warning::cadence: could not read upcoming fixtures ({err})")
    elif isinstance(rows, list) and rows and rows[0].get("scheduled_start"):
        try:
            nxt = dt.datetime.fromisoformat(
                rows[0]["scheduled_start"].replace("Z", "+00:00")).replace(tzinfo=None)
            to_start = (nxt - now).total_seconds() / 60.0
        except ValueError:
            pass
    return since, to_start""",
     """    # TWO CHANGES HERE, BOTH LOAD-BEARING FOR THE DENSE TIER.
    #
    # 1. The lower bound was `now`, so a fixture whose scheduled start had
    #    passed vanished from this read entirely and the gate fell back to the
    #    15-minute baseline for exactly the fixtures that need 90 seconds. The
    #    band now opens DENSE_POST_START_MIN in the past.
    #
    # 2. limit was 1, ordered by scheduled_start ascending — the EARLIEST
    #    fixture in the band, which is not the same thing as the one that sets
    #    the tightest floor. A match that started 10 minutes ago and one
    #    starting in 2 hours are both in the band; only the first demands a
    #    dense sweep, and it is returned first only by accident of being
    #    earlier. Take the minimum FLOOR across the band instead of guessing
    #    from the ordering.
    to_start = None
    lo = now - dt.timedelta(minutes=DENSE_POST_START_MIN)
    hi = now + dt.timedelta(minutes=NEAR_START_WINDOW_MIN)
    rows, err = sb_request(
        "GET",
        f"/rest/v1/{TABLE_FIXTURES}?select=scheduled_start"
        f"&scheduled_start=gte.{iso(lo)}&scheduled_start=lte.{iso(hi)}"
        f"&order=scheduled_start.asc&limit=500",
        url, key)
    if err:
        print(f"::warning::cadence: could not read upcoming fixtures ({err})")
    elif isinstance(rows, list):
        best = None
        for r in rows:
            raw = r.get("scheduled_start")
            if not raw:
                continue
            try:
                nxt = dt.datetime.fromisoformat(
                    raw.replace("Z", "+00:00")).replace(tzinfo=None)
            except ValueError:
                continue
            t = (nxt - now).total_seconds() / 60.0
            f, _tier = sweep_floor(t)
            if best is None or f < best[0]:
                best = (f, t)
        if best is not None:
            to_start = best[1]
    return since, to_start


def dense_fixture_count(url, key, now):
    \"\"\"How many fixtures sit in the dense band right now. None = unreadable.

    None and 0 are deliberately different. 0 stops the dense loop because there
    is nothing near the off; None means the read failed, and the loop treats
    that as "keep going" for the same reason should_sweep() sweeps on missing
    information — a redundant pass costs one call on a free feed, a skipped one
    costs a price that cannot be re-fetched.
    \"\"\"
    lo = now - dt.timedelta(minutes=DENSE_POST_START_MIN)
    hi = now + dt.timedelta(minutes=DENSE_WINDOW_MIN)
    rows, err = sb_request(
        "GET",
        f"/rest/v1/{TABLE_FIXTURES}?select=fixture_id"
        f"&scheduled_start=gte.{iso(lo)}&scheduled_start=lte.{iso(hi)}"
        f"&limit=500",
        url, key)
    if err:
        print(f"::warning::dense: could not count near-start fixtures ({err})")
        return None
    return len(rows) if isinstance(rows, list) else None


def dense_loop(c, url, key, betting_type_id, budget_s=DENSE_BUDGET_S,
               sleeper=time.sleep, clock=time.time):
    \"\"\"Sweep the narrow near-start band every DENSE_MIN until the budget is out.

    Returns (passes, reason-it-stopped) so a run reports what it did rather than
    leaving the founder's 90-second cadence as something asserted in a comment.

    The window pulled is the BAND, not the sweep's 3-day horizon: a dense pass
    exists to re-read the handful of fixtures near their off, and pulling three
    days of fixtures every 90 seconds would be 40x the calls for the same
    answer on a feed we are using as a favour.

    `sleeper`/`clock` are injected so the harness can drive this at full speed.
    A test that has to wait 90 real seconds per pass is a test nobody runs.
    \"\"\"
    started = clock()
    passes = 0
    while True:
        now = now_utc()
        n = dense_fixture_count(url, key, now)
        if n == 0:
            return passes, 'no fixture in the dense band'
        run_window(c, url, key, now,
                   now - dt.timedelta(minutes=DENSE_POST_START_MIN),
                   now + dt.timedelta(minutes=DENSE_WINDOW_MIN),
                   betting_type_id,
                   sweep_id=now.strftime("dense-%Y%m%dT%H%M%SZ"),
                   # A dense pass on a band whose fixtures are all suspended
                   # returns no priced rows. That is the market being closed,
                   # not the sweep failing, and failing the job for it would
                   # trip the circuit breaker and stop the archive — the exact
                   # trade the standing rule forbids.
                   allow_empty=True)
        passes += 1
        # Budget checked AFTER the pass and BEFORE the sleep, so the loop never
        # sleeps 90 seconds only to find it had no time left to use them.
        if clock() - started + DENSE_MIN * 60.0 > budget_s:
            return passes, f'budget spent after {passes} pass(es)'
        sleeper(DENSE_MIN * 60.0)""")

edit(ARCH, 'archive: sweep() runs the dense loop',
     """    c = KiblClient()
    c.authenticate()
    return run_window(c, url, key, started,
                      started - dt.timedelta(hours=args.lookback_hours),
                      started + dt.timedelta(days=args.horizon_days),
                      args.betting_type_id,
                      sweep_id=started.strftime("%Y%m%dT%H%M%SZ"))""",
     """    c = KiblClient()
    c.authenticate()
    rc = run_window(c, url, key, started,
                    started - dt.timedelta(hours=args.lookback_hours),
                    started + dt.timedelta(days=args.horizon_days),
                    args.betting_type_id,
                    sweep_id=started.strftime("%Y%m%dT%H%M%SZ"))

    # FOUNDER 2026-09-21 item 1 — the 90-second band, run INSIDE this job.
    #
    # WHY IT IS NOT A CRON CHANGE. The pinger is `*/5 * * * *` and one firing is
    # one whole Actions job: checkout, setup-python, the offline suites, the
    # schema apply, then the sweep. Dispatching every minute to get a
    # one-minute cadence would be ~1,440 jobs a day, most of their wall time
    # spent on setup, queueing against a concurrency group that does not cancel.
    # Looping inside a job that is already warm is the same pattern
    # odds-capture-loop.sh already uses for the metered bet365 leg.
    #
    # Runs only after a sweep that actually happened: the gate above returns
    # early when it skips, so a skipped firing cannot enter the loop.
    if getattr(args, "dense", True):
        passes, why = dense_loop(c, url, key, args.betting_type_id)
        print(f"dense: {passes} extra pass(es) at {DENSE_MIN:g}-minute spacing "
              f"over the T-{DENSE_WINDOW_MIN:g}..+{DENSE_POST_START_MIN:g} band "
              f"({why})")
        _emit_output("dense_passes", str(passes))
    return rc""")

# ══════════════════════════════════════════════════════════════════════════
# (b) SELECT — the suspension marker must not be selectable as a price
# ══════════════════════════════════════════════════════════════════════════
edit(CARD, 'card-state: the real-price test',
     """def open_of(obs_list):""",
     """# ── FOUNDER 2026-09-21 item 1 — THE SUSPENSION MARKER ──────────────────────
# MEASURED on the bet105 archive: 44 of 135 closes (32.6%) are exactly 0.000,
# in PAIRS, every one stamped within seconds-to-minutes of the scheduled start.
# That is Kibl reporting a market taken down at the live flip. It is not a
# price: a decimal of 0.000 returns nothing, and neither does 1.000.
#
# It reached the Close slot because every selector below filtered on
# `price_decimal is not None`, and 0.000 is not None. Being last, it won. The
# publisher then correctly refused to render it — so the fixture dashed, while
# a perfectly good last price sat one row earlier in the same series.
#
# THE FLOOR IS THE FOUNDER'S OWN RENDER FLOOR, 2026-09-19: "move it to < 1.01".
# Deliberately the same number, because a price the renderer is ruled to refuse
# must not be the one the selector picks — otherwise the two rules disagree and
# the disagreement shows up as a dash nobody can explain.
#
# THIS DOES NOT DASH ANYTHING IT DID NOT ALREADY DASH. A suppressed row falls
# through to the previous real price in the same series, exactly as the card's
# book ladder falls through to the next book. A series with no real price at all
# dashes, which it already did.
#
# ⚠️ AND IT IS DELIBERATELY NOT APPLIED TO `newest_of` — THE "NOW" SLOT.
# Falling through there would print the price the book was showing BEFORE it
# took the market down, labelled as the current price. A suspended market has
# no current price, so a dash is the correct and honest answer; the fall-through
# would be showing a stale price as live, which is the one thing the freshness
# work is here to prevent. Close is different in kind: "the last price before
# the off" is a historical fact that the suspension does not erase.
MIN_REAL_PRICE = 1.01

# How many rows each selector skipped, so the recovery is a measurement and not
# a claim. Module-level and cleared per build, like FLIP_LAGS above, so a second
# call in one process cannot inherit the first run's counts. No 'now' key: see
# the paragraph above — that slot is not meant to skip anything.
SUPPRESSED = {'open': 0, 'close': 0}


def real_price(obs):
    \"\"\"The row's price if it is a price a book would take, else None.

    Parses rather than trusting: PostgREST hands numerics back as strings, so
    `o['price_decimal'] > 0` would compare a str to an int and raise on some
    rows and silently pass on others depending on the driver.
    \"\"\"
    raw = obs.get('price_decimal')
    if raw is None:
        return None
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    return v if v >= MIN_REAL_PRICE else None


def open_of(obs_list):""")

edit(CARD, 'card-state: close_of skips the marker and falls through',
     """    if start_ts is None:
        return None
    pre = [o for o in obs_list
           if o.get('price_decimal') is not None
           and epoch(o.get('inserted_on')) is not None
           and epoch(o['inserted_on']) < start_ts]
    if not pre:
        return None""",
     """    if start_ts is None:
        return None
    dated = [o for o in obs_list
             if epoch(o.get('inserted_on')) is not None
             and epoch(o['inserted_on']) < start_ts]
    # FOUNDER 2026-09-21 item 1: the last REAL price before the start, not the
    # last row. See MIN_REAL_PRICE above — the suspension marker is dated,
    # pre-start and not a price, and taking it cost 44 of 135 bet105 closes.
    pre = [o for o in dated if real_price(o) is not None]
    SUPPRESSED['close'] += len(dated) - len(pre)
    if not pre:
        return None""")

edit(CARD, 'card-state: open_of skips the marker',
     """    openers = [o for o in obs_list
               if o.get('is_opener') and o.get('price_decimal') is not None
               and epoch(o.get('inserted_on')) is not None]
    if not openers:
        return None, None, 'no_opener_row', None""",
     """    flagged = [o for o in obs_list
               if o.get('is_opener')
               and epoch(o.get('inserted_on')) is not None]
    openers = [o for o in flagged if real_price(o) is not None]
    SUPPRESSED['open'] += len(flagged) - len(openers)
    if not openers:
        # Distinguished from having no opener row at all: a book that opened a
        # market suspended is a different fact from one that never opened it,
        # and collapsing them would hide a feed change behind a familiar reason.
        return None, None, ('opener_not_a_real_price' if flagged
                            else 'no_opener_row'), None""")

edit(CARD, 'card-state: the open price parses through real_price too',
     """    tied = {float(o['price_decimal']) for o in openers
            if epoch(o['inserted_on']) == first_ts}""",
     """    tied = {real_price(o) for o in openers
            if epoch(o['inserted_on']) == first_ts}""")


def apply(root):
    changed = 0
    for path, name, old, new in EDITS:
        full = os.path.join(root, path)
        with open(full, encoding='utf-8') as fh:
            src = fh.read()
        if src.count(new) >= 1:
            print(f'  no-op   {name}')
            continue
        n = src.count(old)
        if n != 1:
            print(f'::error::  {name}: anchor matched {n} times, expected 1')
            return 1
        with open(full, 'w', encoding='utf-8') as fh:
            fh.write(src.replace(old, new, 1))
        print(f'  applied {name}')
        changed += 1
    print(f'{changed} edit(s) applied')
    return 0


if __name__ == '__main__':
    raise SystemExit(apply(sys.argv[1] if len(sys.argv) > 1 else '.'))
