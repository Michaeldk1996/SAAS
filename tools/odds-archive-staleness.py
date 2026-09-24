#!/usr/bin/env python3
"""TEN-263 (founder ruling 2026-09-23, option a): weekly staleness alarm for odds-archive/.

tennis-data.co.uk blocks automated downloads (TEN-262 rule: no mirrors, no workarounds), so
the archive is refreshed by hand: the founder drops the season workbook into the inbox and
the launchd drop-in job merges it (tools/odds-archive-refresh.py). This only says when that
has not happened for a while.

    python3 tools/odds-archive-staleness.py [--today YYYY-MM-DD] [--max-days 7]

Reads the newest date across odds-archive/{yyyy}.csv. Exit 1, with one ::error:: line naming
the days stale, the last row date and the inbox path, when the newest row is MORE than
--max-days old. Exit 0 otherwise. An archive with no readable date is exit 1 too: a missing
answer is never "fresh".
"""
import argparse, csv, datetime, glob, os, sys

INBOX = '~/Stennisfy/odds-archive-inbox/'


def newest_date(archive_dir):
    best = None
    for path in glob.glob(os.path.join(archive_dir, '[0-9][0-9][0-9][0-9].csv')):
        with open(path, newline='', encoding='utf-8', errors='replace') as f:
            for row in csv.DictReader(f):
                try:
                    d = datetime.date.fromisoformat((row.get('date') or '').strip())
                except ValueError:
                    continue
                if best is None or d > best:
                    best = d
    return best


def verdict(newest, today, max_days):
    """(exit_code, message)."""
    if newest is None:
        return 1, f'odds-archive has no readable row date. Drop the season workbook into {INBOX}.'
    stale = (today - newest).days
    if stale > max_days:
        return 1, (f'odds-archive is {stale} days stale: last row {newest.isoformat()} '
                   f'(alarm after {max_days}). Drop the current season workbook into {INBOX}.')
    return 0, f'odds-archive fresh: last row {newest.isoformat()}, {stale} days old (alarm after {max_days}).'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--archive', default=os.path.join(os.path.dirname(__file__), '..', 'odds-archive'))
    ap.add_argument('--today', default=None)
    ap.add_argument('--max-days', type=int, default=7)
    a = ap.parse_args()
    today = datetime.date.fromisoformat(a.today) if a.today else datetime.datetime.now(datetime.timezone.utc).date()
    code, msg = verdict(newest_date(a.archive), today, a.max_days)
    print(('::error::' if code else '') + msg)
    return code


if __name__ == '__main__':
    sys.exit(main())
