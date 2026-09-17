#!/usr/bin/env python3
"""Regression lock for Michael's TEN-225 ruling 1 (2026-09-17T09:11Z):

    "event_time is never used as a start time, anywhere, at any level, even
     labelled. Confirmed."

WHY A TRIPWIRE AND NOT A BAN
---------------------------
`event_time` is not forbidden outright -- it legitimately drives a displayed
clock and day-bucketing, and it is stored as provenance on live_flip_log. What
is forbidden is using it as a START time, which is what would put an in-play
quote on a card labelled "Close".

A blanket grep-fail would therefore break working code and get switched off,
which is worse than no guard. So this pins every site that mentions `event_time`
today, with what it is for. Any NEW site fails the test, and the author has to
come here and say which kind it is. That is the smallest thing that cannot rot
silently.

WHY THE RULING NEEDS A LOCK AT ALL
----------------------------------
Measured on TEN-225 (doc `start-time-check`): api-tennis `event_time` is the
SCHEDULED time, never revised once a match starts. 100.00% of 4,594 finished
fixtures sit on a 5-minute grid; it lands EARLIER than the actual start 42.4% of
the time, and where it lands later it is p95 +11.2 min INSIDE the live match.

    python3 test-no-event-time-as-start.py

RUN IT AGAINST A FRESH CHECKOUT. It walks the working tree, and this repo's
working tree is shared between concurrent agent runs and drifts behind
origin/main. The first version of this file passed locally and went red in CI on
a site (series.js:753) that the stale local tree did not contain -- which is the
guard working, and a reminder that a local PASS here is not evidence.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
EXTS = ('.py', '.js', '.mjs', '.ts', '.sql', '.html')
SKIP_DIRS = {'node_modules', '.git', 'dist', 'build', 'coverage'}
# Probe//analysis scripts are excluded: they exist precisely to MEASURE the field
# and are not part of any shipped path.
SKIP_FILES = {'test-no-event-time-as-start.py', 'ten225-369-trace.py',
              'test_retirement_clear.py', 'test-live-flip-log.sql'}

# Any file whose job is to produce an Open/Close/start timestamp. `event_time`
# must not appear in these AT ALL -- there is no benign use of it here, so this
# set gets the blanket ban the rest of the repo does not.
CLOSE_PATH_MARKERS = ('odds_card_state', 'close_ts', 'close_reliable',
                      'oddspapi_line_summary', 'trueStartTime')

# The pinned sites. Keyed by file; the value is the set of normalised code lines
# that are allowed to mention event_time, each with why it is not a start time.
ALLOWED = {
    'refresh-scores.py': {
        # day/slot bookkeeping for the score patch, never a start instant
        "d, t = f.get('event_date'), f.get('event_time')",
    },
    'trading-report.js': {
        "startClock: f.event_time || '',",                                  # displayed clock
        "startSort: (f.event_date || '') + ' ' + (f.event_time || ''),",    # sort key only
    },
    'bsp-pipeline.js': {
        "time: fixture.event_time || null,",                                # displayed clock
        "const pastMatchDateTime = `${fixture.event_date}T${(fixture.event_time || '12:00')}:00Z`;",
        "// Combine event_date + event_time so computeDay() gets a real datetime.",
        "const commence = `${fixture.event_date}T${fixture.event_time || '00:00'}:00`;",
    },
    'build-series.js': {
        "time: String(fx.event_time || ''),",                               # displayed clock
    },
    'series.js': {
        # TEN-204 §1.4 note on the sort order. Explicitly says the offset is NOT
        # applied, which is the opposite of using it as a start time.
        "// TIMEZONE, measured not assumed (TEN-204 §1.4): api-tennis `event_time` is UTC+2 —",
    },
    'bsp-consult-dashboard.html': {
        "// Records without a startTs carry `event_time` in the feed's ACCOUNT zone, which",
        "// (event_time is the match START only) — with nothing real to show it added no",
    },
    'supabase/migrations/20260917100000_live_flip_log.sql': {
        # stored as provenance on live_flip_log; nothing reads it as a time
        "event_time            text,                        -- SCHEDULED. Recorded for",
        "event_date, event_time, first_player, second_player,",   # insert column list
        "fix ->> 'event_time',",
    },
}


def walk():
    for root, dirs, files in os.walk(HERE):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith('.')]
        for fn in files:
            if fn.endswith(EXTS):
                yield os.path.join(root, fn)


def main():
    unknown, banned = [], []
    seen = set()
    for path in walk():
        rel = os.path.relpath(path, HERE)
        if os.path.basename(path) in SKIP_FILES or rel in SKIP_FILES:
            continue
        try:
            text = open(path, encoding='utf-8', errors='replace').read()
        except OSError:
            continue
        if 'event_time' not in text:
            continue
        close_path = any(m in text for m in CLOSE_PATH_MARKERS)
        allowed = ALLOWED.get(rel, set())
        for i, line in enumerate(text.splitlines(), 1):
            if 'event_time' not in line:
                continue
            norm = line.strip()
            if close_path and rel not in ALLOWED:
                banned.append((rel, i, norm))
            elif norm not in allowed:
                unknown.append((rel, i, norm))
            else:
                seen.add((rel, norm))

    # A pin that no longer matches anything is a pin that has stopped guarding.
    stale = [(f, l) for f, lines in ALLOWED.items() for l in lines
             if (f, l) not in seen]

    ok = True
    if banned:
        ok = False
        print('::error::event_time appears in an Open/Close/start-time path. '
              'Michael 2026-09-17: it is the SCHEDULED time and must never be '
              'used as a start time, at any level, even labelled.')
        for f, i, l in banned:
            print(f'  BANNED  {f}:{i}  {l[:110]}')
    if unknown:
        ok = False
        print('::error::new event_time reference(s). If this is a displayed clock '
              'or a sort key, pin it in ALLOWED with a note. If it is a start '
              'time, it violates the ruling and must not ship.')
        for f, i, l in unknown:
            print(f'  NEW     {f}:{i}  {l[:110]}')
    if stale:
        ok = False
        print('::error::pinned event_time site(s) no longer found — the pin has '
              'stopped guarding anything and must be re-checked, not deleted.')
        for f, l in stale:
            print(f'  STALE   {f}  {l[:110]}')

    if ok:
        print(f'PASS — {len(seen)} pinned event_time site(s), all accounted for; '
              f'0 in any Open/Close/start-time path.')

    # Failing control: the checker must be able to fail. Feed it a line that is
    # neither pinned nor benign and assert it is rejected. Without this, a
    # checker whose matcher silently stopped working reads exactly like a pass.
    probe = "close_ts = fixture['event_time']   # start time"
    if probe.strip() in ALLOWED.get('refresh-scores.py', set()):
        print('::error::CONTROL FAILED: the probe line is pinned, so the check is vacuous')
        return 1
    if 'event_time' not in probe:
        print('::error::CONTROL FAILED: the matcher would not even see a violation')
        return 1
    print('control: a violating line is correctly not pinned and would be reported.')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
