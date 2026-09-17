#!/usr/bin/env python3
"""TEN-225 report item 5c — close_reliable = true coverage per month, Jan-Sep 2026.

Michael's rule (2026-09-17T07:33Z):

  "close_reliable rule: true only if the fixture was archived within 21 days of
   its start AND close_lag_minutes <= 60. Otherwise close_price = null (dash on
   the site). Open is kept. Applies to June/July backfill and to the Mar-May
   bet365-history copies (decayed). Only 2026-09.json fixtures captured <=3d
   qualify from that archive."

The rule has two conjuncts and they fail for different reasons, so this script
reports them separately rather than collapsing both into one number:

  ARCHIVE AGE  - a property of WHEN WE PULLED, not of the fixture. It cannot be
                 improved retroactively for any past fixture. bet365-history has
                 no per-fixture capture stamp, so the month file's own
                 `generatedAt` is the capture time for every fixture in it -
                 which is exact, because the file was written by one sweep.
  CLOSE LAG    - a property of the data we hold, computed here from the stored
                 series: start minus the last point at or before start.

Coverage is reported over the fixtures we HOLD and, separately, against the
fixture universe for the month, because a month can be 100% reliable on what we
hold and still be near-zero against the calendar. Both are stated; neither
alone answers the question.

No network calls, no API cost. Reads only committed bet365-history/ month files
plus, if present, the 180-day /v4/fixtures sweep captured by
ten225-summary-sizing.py for the denominator.
"""
import json
import os
import statistics
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
HIST = os.path.join(HERE, 'bet365-history')
SWEEP = os.path.join(HERE, 'ten225-summary-sizing.json')
OUT = os.path.join(HERE, 'ten225-close-reliable.json')

ARCHIVE_AGE_LIMIT_D = 21.0
CLOSE_LAG_LIMIT_MIN = 60.0
MONTHS = [f'2026-{m:02d}' for m in range(1, 10)]


def parse_iso(ts):
    try:
        return datetime.fromisoformat(str(ts).replace('Z', '+00:00'))
    except (ValueError, TypeError):
        return None


def close_lag_min(series, start):
    """Minutes from the last pre-start point to the start. None if there is no
    pre-start point at all - that is a missing Close, not a lag of zero."""
    pre = [t for t, _p in series if t is not None and t <= start]
    if not pre:
        return None
    return (start - max(pre)) / 60.0


def main():
    out = {'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
           'rule': {'archiveAgeLimitDays': ARCHIVE_AGE_LIMIT_D,
                    'closeLagLimitMinutes': CLOSE_LAG_LIMIT_MIN},
           'months': {}}

    print('=== bet365-history: close_reliable per month ===')
    print(f'  rule: archived <= {ARCHIVE_AGE_LIMIT_D:.0f}d after start '
          f'AND close_lag <= {CLOSE_LAG_LIMIT_MIN:.0f} min\n')
    hdr = (f'  {"month":<8} {"held":>6} {"cap age d":>20} {"age<=21d":>9} '
           f'{"lag<=60m":>9} {"BOTH":>6} {"% of held":>10}')
    print(hdr)
    print('  ' + '-' * (len(hdr) - 2))

    grand_held = grand_ok = 0
    for month in MONTHS:
        path = os.path.join(HIST, f'{month}.json')
        if not os.path.exists(path):
            out['months'][month] = {'source': 'none', 'held': 0, 'reliable': 0,
                                    'reason': 'no bet365-history month file'}
            print(f'  {month:<8} {0:>6} {"-":>20} {"-":>9} {"-":>9} {0:>6} {"-":>10}'
                  f'   <-- no archive file')
            continue

        doc = json.load(open(path))
        gen = parse_iso(doc.get('generatedAt'))
        fixtures = doc.get('fixtures') or {}
        held = age_ok = lag_ok = both = 0
        ages, lags, no_close = [], [], 0
        for fid, fx in fixtures.items():
            start = fx.get('start')
            if not start:
                continue
            held += 1
            age_d = ((gen.timestamp() - start) / 86400.0) if gen else None
            if age_d is not None:
                ages.append(age_d)
            # Close is per side; a fixture is reliable only if the side series
            # we would serve has a pre-start point. Use the tighter of s1/s2.
            side_lags = [close_lag_min(fx.get(k) or [], start) for k in ('s1', 's2')]
            present = [l for l in side_lags if l is not None]
            if not present:
                no_close += 1
                lag = None
            else:
                lag = max(present)
                lags.append(lag)
            a = age_d is not None and age_d <= ARCHIVE_AGE_LIMIT_D
            l = lag is not None and lag <= CLOSE_LAG_LIMIT_MIN
            age_ok += 1 if a else 0
            lag_ok += 1 if l else 0
            both += 1 if (a and l) else 0

        grand_held += held
        grand_ok += both
        age_desc = (f'{min(ages):.1f}-{max(ages):.1f} (med {statistics.median(ages):.1f})'
                    if ages else '-')
        pct = f'{both/held*100:.1f}%' if held else '-'
        print(f'  {month:<8} {held:>6} {age_desc:>20} {age_ok:>9} {lag_ok:>9} '
              f'{both:>6} {pct:>10}')
        out['months'][month] = {
            'source': 'bet365-history',
            'generatedAt': doc.get('generatedAt'),
            'held': held,
            'archiveAgeOk': age_ok,
            'closeLagOk': lag_ok,
            'reliable': both,
            'noPreStartPoint': no_close,
            'capAgeDaysMedian': statistics.median(ages) if ages else None,
            'capAgeDaysMin': min(ages) if ages else None,
            'capAgeDaysMax': max(ages) if ages else None,
            'closeLagMinMedian': statistics.median(lags) if lags else None,
        }

    print('  ' + '-' * (len(hdr) - 2))
    print(f'  {"TOTAL":<8} {grand_held:>6} {"":>20} {"":>9} {"":>9} {grand_ok:>6} '
          f'{(f"{grand_ok/grand_held*100:.1f}%" if grand_held else "-"):>10}')

    # ---- denominator: the fixture universe, so "% of held" is not mistaken
    #      for "% of the calendar".
    if os.path.exists(SWEEP):
        sw = json.load(open(SWEEP))
        mix = sw.get('levelMix') or {}
        span = sw.get('spanDays') or 0
        if mix and span:
            per_day = sum(mix.values()) / span
            print(f'\n=== against the fixture universe ===')
            print(f'  180-day sweep: {sum(mix.values())} non-synthetic tennis '
                  f'fixtures = {per_day:.0f}/day, all levels')
            print(f'  {"month":<8} {"universe est":>13} {"reliable":>9} {"% of month":>11}')
            for month in MONTHS:
                y, m = int(month[:4]), int(month[5:])
                days = [31, 28, 31, 30, 31, 30, 31, 31, 30][m - 1]
                uni = per_day * days
                rel = out['months'][month].get('reliable', 0)
                print(f'  {month:<8} {uni:>13,.0f} {rel:>9} '
                      f'{rel/uni*100 if uni else 0:>10.2f}%')
                out['months'][month]['universeEstimate'] = uni
            print('\n  The universe figure is the CURRENT all-level fixture rate '
                  'projected onto each month, not a per-month count. It is an\n'
                  '  order-of-magnitude denominator only; tennis volume is '
                  'seasonal and January is not September.')
    else:
        print(f'\n  (no {os.path.basename(SWEEP)} yet - "% of the calendar" '
              f'not computed. "% of held" above is NOT calendar coverage.)')

    json.dump(out, open(OUT, 'w'), indent=1)
    print(f'\nwrote {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
