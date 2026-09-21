#!/usr/bin/env python3
"""TEN-225 item 1 — the tests for the dense sweep and the suspension marker.

TWO KINDS OF EDIT HERE, AND THEY ARE NOT THE SAME KIND.

  REWRITTEN: five assertions pinned the superseded 5-minute/T-180 tier and go
  red because the founder's ruling was CARRIED OUT, not because anything
  regressed. They are rewritten to the ruling in force rather than deleted —
  their job is to pin the ruled value so a silent drift is caught, and that job
  is unchanged. One of them asserted the OPPOSITE of the new ruling in as many
  words ("a fixture that already started does not force the 5-min floor"); the
  directive's "to the live flip" reverses it, so it now asserts the reverse and
  says why.

  ADDED: the dense tier's boundaries and shadowing guard, the Retry-After
  parser, the suspension-marker fall-through WITH a control that reconstructs
  the pre-fix selector, and dense_loop driven on an injected clock.

Usage: python3 ten225-apply-dense-tests.py <repo-root>
"""
import os
import sys

EDITS = []
CARD_T = 'test-ten225-kibl-card-state.py'
REP_T = 'test-ten232-report.py'
CLI_T = 'test-kibl-client.py'


def edit(path, name, old, new):
    EDITS.append((path, name, old, new))


# ══════════════════════════════════════════════════════════════════════════
# REWRITTEN — test-ten232-report.py
# ══════════════════════════════════════════════════════════════════════════
edit(REP_T, 'report-test: the T-30 band is now the DENSE tier, not near-start',
     """check("6 min out with a start in 30 min sweeps", ak.should_sweep(6.0, 30.0)[0] is True)
check("4 min out with a start in 30 min skips", ak.should_sweep(4.0, 30.0)[0] is False)""",
     """check("6 min out with a start in 30 min sweeps", ak.should_sweep(6.0, 30.0)[0] is True)
# REWRITTEN 2026-09-21, founder item 1: "sweep every 1-2 minutes from T-30".
# A fixture 30 minutes out is now in the DENSE band, so 4 minutes since the last
# sweep is well past the 1.5-minute floor and sweeps. This assertion used to
# pin the 5-minute floor at T-30; the floor there is 1.5 now, and the check
# moves with the ruling rather than being deleted.
check("4 min out with a start in 30 min now SWEEPS (dense tier)",
      ak.should_sweep(4.0, 30.0) == (True, 'dense'))
check("...and 1 min out still skips, so the dense floor is a floor",
      ak.should_sweep(1.0, 30.0)[0] is False)
check("dense floor is the ruled 1-2 minutes", 1.0 <= ak.DENSE_MIN <= 2.0)
# The grace was sized for the 5-minute floor. Flat, it is a 33% discount on the
# dense floor and should_sweep(1.0, 30.0) comes back SWEEP -- the floor stops
# being a floor. Capped at a tenth, the near-start and baseline values are
# unchanged to the digit.
check("the grace is unchanged at the floors it was measured on",
      ak.cadence_grace(5.0) == 0.5 and ak.cadence_grace(15.0) == 0.5)
check("...and cannot exceed a tenth of the dense floor",
      ak.cadence_grace(ak.DENSE_MIN) <= ak.DENSE_MIN / 10.0)
check("the dense band opens at T-30", ak.DENSE_WINDOW_MIN == 30)""")

edit(REP_T, 'report-test: the grace control moves to a fixture in the NEAR-START band',
     """check("4.95 min against the 5-min near-start floor sweeps",
      ak.should_sweep(4.95, 30.0)[0] is True)""",
     """# The grace control needs a fixture on the 5-MINUTE floor, and 30 minutes out
# is no longer one — it is dense. 120 minutes out is inside T-180 and outside
# T-30, which is exactly the near-start tier this control is about.
check("4.95 min against the 5-min near-start floor sweeps",
      ak.should_sweep(4.95, 120.0)[0] is True)""")

edit(REP_T, 'report-test: ...and so does its counterpart',
     """check("4.0 min still skips at the near-start floor",
      ak.should_sweep(4.0, 30.0)[0] is False)""",
     """check("4.0 min still skips at the near-start floor",
      ak.should_sweep(4.0, 120.0)[0] is False)""")


# ══════════════════════════════════════════════════════════════════════════
# REWRITTEN + ADDED — test-ten225-kibl-card-state.py (the cadence block)
# ══════════════════════════════════════════════════════════════════════════
edit(CARD_T, 'card-test: the T-30 assertions move to the dense tier',
     """check('6 min out with a fixture 30 min from starting: sweep',
      A.should_sweep(6.0, 30.0) == (True, 'near-start'))
check('4 min out with a fixture 30 min from starting: skip',
      A.should_sweep(4.0, 30.0)[0] is False)""",
     """# REWRITTEN 2026-09-21, founder item 1. T-30 is the DENSE band now; both of
# these pinned the 5-minute near-start floor that used to apply there.
check('6 min out with a fixture 30 min from starting: sweep, DENSE tier',
      A.should_sweep(6.0, 30.0) == (True, 'dense'))
check('4 min out with a fixture 30 min from starting: now sweeps',
      A.should_sweep(4.0, 30.0) == (True, 'dense'))
check('1 min out in the dense band still skips — the floor is a floor',
      A.should_sweep(1.0, 30.0)[0] is False)""")

edit(CARD_T, 'card-test: a started fixture now DOES force the tight floor',
     """check('a fixture that already started does not force the 5-min floor',
      A.should_sweep(6.0, -10.0)[0] is False)""",
     """# ⚠️ REVERSED 2026-09-21, and deliberately. This assertion pinned the OLD
# behaviour in as many words: a fixture past its scheduled start dropped out of
# the near-start band and fell back to the 15-minute baseline. The founder's
# item 1 says "from T-30 TO THE LIVE FLIP", and the flip lands on either side of
# the schedule — MEASURED median -11.0 min, min -860.0 (n=17, n<30). A fixture
# that has passed its scheduled time and not yet flipped is the single most
# valuable one to be sweeping, because the price we are chasing is the last one
# before the market goes down.
check('a fixture 10 min past its scheduled start is DENSE, not baseline',
      A.should_sweep(6.0, -10.0) == (True, 'dense'))
# should_sweep only names the tier when it SWEEPS; a skip returns the reason
# string. The tier itself is sweep_floor's answer, so ask the function that
# owns it rather than string-matching a message.
check('...and it stops being dense once it is well past the flip',
      A.sweep_floor(-(A.DENSE_POST_START_MIN + 0.1))[1] == 'baseline')

print('\\nsweep_floor — the three tiers, and the shadowing trap')
check('T-30 exactly is dense', A.sweep_floor(30.0) == (A.DENSE_MIN, 'dense'))
check('a minute wider is near-start', A.sweep_floor(31.0)[1] == 'near-start')
check('the post-start edge is dense',
      A.sweep_floor(-A.DENSE_POST_START_MIN)[1] == 'dense')
check('past that edge is baseline',
      A.sweep_floor(-A.DENSE_POST_START_MIN - 0.1)[1] == 'baseline')
check('an unknown next start is baseline', A.sweep_floor(None)[1] == 'baseline')
# THE TRAP THIS GUARDS. The dense band [-30, +30] sits ENTIRELY INSIDE the
# near-start band [0, 180]. Test near-start first and dense is unreachable —
# the constants would all be present, the tier function would look right, and
# every sweep near the off would quietly run at the 5-minute floor. A test that
# only asserted the constants exist would pass against that.
check('dense is not shadowed by the wider band it sits inside',
      A.sweep_floor(10.0)[1] == 'dense'
      and A.sweep_floor(10.0)[0] < A.NEAR_START_MIN)
check('the tiers are strictly ordered', A.DENSE_MIN < A.NEAR_START_MIN < A.BASELINE_MIN)

print('\\ndense_loop — driven on an injected clock, not a real 90s wait')


class _FakeClock:
    def __init__(self):
        self.t = 0.0
        self.slept = []

    def time(self):
        return self.t

    def sleep(self, s):
        self.slept.append(s)
        self.t += s


_calls = {'windows': 0, 'counts': 0}
_orig_run_window, _orig_count = A.run_window, A.dense_fixture_count


def _fake_run_window(*a, **kw):
    _calls['windows'] += 1
    return 0


def _count_always(_url, _key, _now):
    _calls['counts'] += 1
    return 3


A.run_window = _fake_run_window
A.dense_fixture_count = _count_always
_clk = _FakeClock()
_passes, _why = A.dense_loop(None, 'u', 'k', 1, budget_s=180.0,
                             sleeper=_clk.sleep, clock=_clk.time)
# 3, not 2: passes land at t=0, 90 and 180, and the loop stops when another
# full cadence would overrun the budget. Counted by driving the loop, because
# an off-by-one here is the difference between covering the band and leaving a
# 90-second hole in it.
check('a 180s budget at a 90s cadence runs 3 passes and stops',
      (_passes, _calls['windows']) == (3, 3), f'got {_passes} / {_calls["windows"]}')
check('...and it slept the ruled 1-2 minutes between them',
      _clk.slept == [A.DENSE_MIN * 60.0] * 2, f'slept {_clk.slept}')
check('...and it says why it stopped rather than returning a bare number',
      'budget' in _why)
# The loop must never sleep a cadence it has no budget left to use: that is 90
# seconds of a 5-minute dispatch spent holding the runner open for nothing.
check('the last pass does not sleep before returning',
      len(_clk.slept) == _passes - 1)

_calls['windows'] = 0
A.dense_fixture_count = lambda _u, _k, _n: 0
_p2, _why2 = A.dense_loop(None, 'u', 'k', 1, budget_s=180.0,
                          sleeper=_FakeClock().sleep, clock=_FakeClock().time)
check('an empty dense band sweeps nothing and says so',
      (_p2, _calls['windows']) == (0, 0) and 'no fixture' in _why2)

# FAIL-OPEN CONTROL. An unreadable count is not an empty band. Treating None as
# 0 would silently stand the dense loop down for the whole window every time
# Supabase hiccuped, on a feed whose prices cannot be re-fetched — and it would
# look identical in the log to a quiet calendar.
_calls['windows'] = 0
A.dense_fixture_count = lambda _u, _k, _n: None
_clk3 = _FakeClock()
_p3, _ = A.dense_loop(None, 'u', 'k', 1, budget_s=180.0,
                      sleeper=_clk3.sleep, clock=_clk3.time)
check('an UNREADABLE count keeps sweeping — None is not zero', _p3 == 3)

A.run_window, A.dense_fixture_count = _orig_run_window, _orig_count""")


# ══════════════════════════════════════════════════════════════════════════
# ADDED — the suspension marker, with a control
# ══════════════════════════════════════════════════════════════════════════
edit(CARD_T, 'card-test: the suspension marker must not be selectable',
     """print('\\nclose_of — strictly before the RESOLVED start')""",
     """print('\\nreal_price / the 0.000 suspension marker (founder item 1, 2026-09-21)')
check('0.000 is not a price', K.real_price(obs(0.0, T % (9, 0))) is None)
check('1.000 is not a price either — it returns the stake',
      K.real_price(obs(1.0, T % (9, 0))) is None)
check('1.01 IS a price — the founder ruled the floor at "< 1.01", so 1.01 '
      'itself is kept', K.real_price(obs(1.01, T % (9, 0))) == 1.01)
check('2.50 is a price', K.real_price(obs(2.5, T % (9, 0))) == 2.5)
check('a missing price is not a price', K.real_price(obs(None, T % (9, 0))) is None)
# PostgREST hands numerics back as STRINGS. A `> 0` test against a str raises on
# some drivers and silently passes on others; parsing is the only version that
# behaves the same either way.
check('a string price parses rather than raising',
      K.real_price(obs('2.50', T % (9, 0))) == 2.5)
check('an unparseable price is not a price',
      K.real_price(obs('suspended', T % (9, 0))) is None)
check('the selector floor IS the ruled render floor, so the two cannot '
      'disagree about what a price is', K.MIN_REAL_PRICE == 1.01)

# THE MEASURED SHAPE: 44 of 135 bet105 closes are 0.000, in pairs, stamped
# seconds-to-minutes before the off. A real price sits earlier in the series.
_start = K.epoch(T % (15, 0))
_susp = [obs(2.10, T % (13, 0)), obs(2.15, T % (14, 30)), obs(0.0, T % (14, 59))]
_c = K.close_of(_susp, _start)
check('the Close is the last REAL price, not the suspension marker',
      _c is not None and float(_c['price_decimal']) == 2.15,
      f'got {_c and _c.get("price_decimal")}')
check('...and it is the LAST real one, not the first',
      K.epoch(_c['inserted_on']) == K.epoch(T % (14, 30)))
check('...and the skip is counted, so the recovery is measurable',
      K.SUPPRESSED['close'] >= 1)

# CONTROL: the pre-fix selector, reconstructed here, on the same input. Without
# this, "the Close is 2.15" would also pass on a build that never had the
# defect — and this defect shipped, so the control is the evidence.
_pre_fix = [o for o in _susp
            if o.get('price_decimal') is not None
            and K.epoch(o.get('inserted_on')) is not None
            and K.epoch(o['inserted_on']) < _start]
_pre_fix.sort(key=lambda o: K.epoch(o['inserted_on']))
check('CONTROL: the pre-fix selector picks the 0.000 marker on this same input',
      float(_pre_fix[-1]['price_decimal']) == 0.0)

check('a series that is ALL suspension markers still dashes — this fills no '
      'cell it cannot justify',
      K.close_of([obs(0.0, T % (14, 0)), obs(0.0, T % (14, 59))], _start) is None)

# The opener half of the same defect.
_op_susp = K.open_of([obs(0.0, T % (8, 0), opener=True)])
check('an opener that is a suspension marker does not become the Open',
      _op_susp[0] is None)
check('...and it is NOT reported as "no opener row" — a market that opened '
      'suspended is a different fact from one that never opened',
      _op_susp[2] == 'opener_not_a_real_price')
check('a real opener still opens', K.open_of([obs(2.2, T % (8, 0), opener=True)])[0] == 2.2)

print('\\nclose_of — strictly before the RESOLVED start')""")


# ══════════════════════════════════════════════════════════════════════════
# ADDED — Retry-After
# ══════════════════════════════════════════════════════════════════════════
edit(CLI_T, 'client-test: Retry-After is honoured, and can only ever slow us down',
     """check("pacing is conservative by default", kibl_client.MIN_INTERVAL_S >= 1.0)""",
     """check("pacing is conservative by default", kibl_client.MIN_INTERVAL_S >= 1.0)

print("\\nRetry-After (founder item 1, 2026-09-21: 'watch for 429/Retry-After')")
_ra = kibl_client.retry_after_seconds
check("no header -> our own ladder, so a feed that never sends one is unaffected",
      _ra({}, 5.0) == 5.0)
check("a delta-seconds header is honoured", _ra({'retry-after': '30'}, 5.0) == 30.0)
check("a header ASKING US TO COME BACK SOONER does not speed us up",
      _ra({'retry-after': '1'}, 5.0) == 5.0)
check("an HTTP-date form falls back rather than trusting a remote clock",
      _ra({'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT'}, 5.0) == 5.0)
check("garbage falls back", _ra({'retry-after': 'soon'}, 5.0) == 5.0)
check("a hostile value cannot park the job for the window",
      _ra({'retry-after': '99999'}, 5.0) == 120.0)
check("None headers are tolerated", _ra(None, 5.0) == 5.0)
# The header was already being captured into meta['rate_headers'] and never
# read. If that capture ever goes, this parser has nothing to parse.
import inspect as _insp_ra  # noqa: E402
check("the 429 branch actually CALLS the parser — a parser nothing calls is "
      "a comment",
      'retry_after_seconds(hdrs' in _insp_ra.getsource(kibl_client.KiblClient.get))""")


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
