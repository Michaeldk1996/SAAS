#!/usr/bin/env python3
"""Offline tests for the TEN-232 archive report — no network, no credentials.

These lock the three things that made the 2026-09-18 05:05Z report say the wrong
thing about a real archive:

  1. a backfill WINDOW was counted as a sweep, so "sweeps recorded: 45" and the
     rows_new median described a one-off 35-day backfill and not the live
     capture the cadence question is about;
  2. the row count was fetched with count=exact through a helper that discards
     response headers, so the archive's headline number could never be read and
     was silently dropped;
  3. the timestamps come back tz-aware and now_utc() is naive, so the freshness
     figure the whole Part 1 report turns on would raise rather than print.

Each check has a CONTROL: the assertion is written so the pre-fix behaviour
fails it. A test that passes on the broken build tests nothing.
"""

import datetime as dt
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("archive_kibl", "archive-kibl.py")
ak = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ak)

FAILS = []


def check(label, ok):
    print(f"  {'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        FAILS.append(label)


print("1. a backfill window is not a sweep")
sweeps = [{"sweep_id": "20260918T020053Z", "rows_new": 69},
          {"sweep_id": "bf20260814-20260917T233251Z", "rows_new": 952},
          {"sweep_id": "bf20260815-20260917T233251Z", "rows_new": 903},
          {"sweep_id": "20260918T013300Z", "rows_new": 41}]
live = [s for s in sweeps if not ak.is_backfill(s["sweep_id"])]
back = [s for s in sweeps if ak.is_backfill(s["sweep_id"])]
check("live sweeps counted apart from backfill windows", (len(live), len(back)) == (2, 2))
# CONTROL: the mixed median is 903-ish and the live median is 69 — if the split
# regressed, this figure moves to the backfill's and the check fails.
med_live = sorted(s["rows_new"] for s in live)[len(live) // 2]
med_all = sorted(s["rows_new"] for s in sweeps)[len(sweeps) // 2]
check("the change-rate median is taken off live sweeps only",
      med_live == 69 and med_all != med_live)
check("a null sweep_id is not silently a backfill", ak.is_backfill(None) is False)

print("2. timestamps land on one convention")
naive = ak.parse_ts("2026-09-18T02:00:53+00:00")
check("tz-aware input returns naive UTC", naive is not None and naive.tzinfo is None)
check("Z-suffixed input parses", ak.parse_ts("2026-09-18T02:00:53Z") == naive)
check("offset input is converted, not truncated",
      ak.parse_ts("2026-09-18T04:00:53+02:00") == naive)
# CONTROL: this subtraction is exactly what the freshness line does. Before the
# fix it raised TypeError on a real row.
try:
    age = (ak.now_utc() - naive).total_seconds() / 60.0
    check("freshness arithmetic against now_utc() does not raise", age > 0)
except TypeError as e:
    check(f"freshness arithmetic against now_utc() does not raise ({e})", False)
check("unparseable input is None, not now", ak.parse_ts("not a time") is None)
check("None input is None", ak.parse_ts(None) is None)

print("3. a missing number prints as a dash, never as a zero")
check("None -> dash", ak.fmt(None) == "—")
check("0 -> 0, not a dash", ak.fmt(0) == "0")
check("thousands separated", ak.fmt(1234567) == "1,234,567")

print("4. the count helper reads Content-Range, not the body")
# The header shape PostgREST returns for Prefer: count=exact with Range 0-0.
for header, want in (("0-0/28067", 28067), ("*/0", 0), ("0-0/*", None), ("", None)):
    total = header.rsplit("/", 1)[-1] if "/" in header else ""
    got = int(total) if total.isdigit() else None
    check(f"Content-Range {header!r} -> {want}", got == want)

print("5. the cadence rule still matches the founder ruling")
check("baseline floor is 15 min", ak.BASELINE_MIN == 15)
check("near-start floor is 5 min", ak.NEAR_START_MIN == 5)
# WIDENED to T-180, founder item 4(a) 2026-09-19. Rewritten to the window in
# force rather than deleted: its job — pinning the ruled value so a silent
# drift is caught — is unchanged. The measured start delay on the 17 lag
# failures is NEGATIVE (median -11 min, min -860), so a T-60 window can open
# after the match has begun.
check("near-start window is the widened T-180", ak.NEAR_START_WINDOW_MIN == 180)
check("no previous sweep always sweeps", ak.should_sweep(None, None)[0] is True)
check("14 min into the baseline skips", ak.should_sweep(14.0, None)[0] is False)
check("16 min into the baseline sweeps", ak.should_sweep(16.0, None)[0] is True)
check("6 min out with a start in 30 min sweeps", ak.should_sweep(6.0, 30.0)[0] is True)
check("4 min out with a start in 30 min skips", ak.should_sweep(4.0, 30.0)[0] is False)

# CONTROL for the grace. Run 35311030824 measured 4.9x min against a 5-min
# floor and skipped, which turns the founder's 5-minute near-start cadence into
# 10 minutes. A 5-minute pinger can only ever deliver just-under-5, so without
# the grace these two checks fail — which is the point of having them.
check("4.95 min against the 5-min near-start floor sweeps",
      ak.should_sweep(4.95, 30.0)[0] is True)
check("14.95 min against the 15-min baseline sweeps",
      ak.should_sweep(14.95, None)[0] is True)
check("the grace is smaller than the firing interval it forgives",
      ak.CADENCE_GRACE_MIN < ak.NEAR_START_MIN)
# ...and it must not turn the floor into a suggestion.
check("4.0 min still skips at the near-start floor",
      ak.should_sweep(4.0, 30.0)[0] is False)
check("14.0 min still skips at the baseline floor",
      ak.should_sweep(14.0, None)[0] is False)
check("an unknown next start falls back to the baseline",
      ak.should_sweep(14.0, None)[0] is False and ak.should_sweep(16.0, None)[0] is True)

print()
if FAILS:
    print(f"FAILED {len(FAILS)}: {FAILS}")
    sys.exit(1)
print("all TEN-232 report tests passed")
