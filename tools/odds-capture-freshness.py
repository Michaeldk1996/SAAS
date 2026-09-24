#!/usr/bin/env python3
"""TEN-263 (founder ruling 2026-09-24): capture-freshness alarm for the live odds series.

The live collector froze for EVERY book from 2026-09-02 02:5xZ to 2026-09-10 02:14Z and
nothing fired. This reads the captured series the board carries (matches.json
oddsMovement.books.<book>.p1/p2, [iso, price] ticks) and goes red when NO book has a new
tick for more than --max-hours (default 24, a starting default — see below).

    python3 tools/odds-capture-freshness.py [--matches matches.json] [--now ISO] [--max-hours 24]

Exit 1 with one ::error:: line naming the newest tick, its age, every book's last tick and
the board's upcoming-match count when the newest tick is older than --max-hours, or when
the board carries no tick at all. Exit 0 otherwise. Separate from the Tennis-Data
staleness alarm (tools/odds-archive-staleness.py) by design.

Measured before shipping (694 hourly samples of matches.json, 2026-08-01..09-21): a
24 h rule fires on the real outage (09-02..09-10, 38 upcoming matches) AND on quiet
boards with nothing to price (09-12/13: 46 h with 1 upcoming match; 09-14..16: 72 h
with 0; 09-17: no ticks on the board at all). The upcoming count is printed so a reader
can tell quiet from broken; whether to gate on it is the founder's call.
"""
import argparse, datetime, json, os, sys


def parse(ts):
    try:
        t = datetime.datetime.fromisoformat(str(ts).replace('Z', '+00:00'))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=datetime.timezone.utc)   # the feed writes UTC


def last_ticks(matches, now=None):
    """{book: newest tick datetime} across every match's oddsMovement. A tick dated more than
    an hour after `now` is a bad timestamp, not a fresh one, and is ignored — otherwise one
    future-dated tick would keep the alarm green through a real freeze."""
    out = {}
    limit = (now + datetime.timedelta(hours=1)) if now else None
    for m in matches:
        books = ((m.get('oddsMovement') or {}).get('books')) or {}
        if not isinstance(books, dict):
            continue
        for book, series in books.items():
            if not isinstance(series, dict):
                continue
            for side in ('p1', 'p2'):
                for tk in series.get(side) or []:
                    t = parse(tk[0]) if isinstance(tk, (list, tuple)) and tk else None
                    if t and (limit is None or t <= limit) and (book not in out or t > out[book]):
                        out[book] = t
    return out


def upcoming(matches):
    return sum(1 for m in matches if not m.get('finalScore') and not m.get('live'))


def verdict(matches, now, max_hours):
    """(exit_code, message)."""
    books = last_ticks(matches, now)
    up = upcoming(matches)
    if not books:
        return 1, f'odds capture: NO tick on the board from any book ({len(matches)} matches, {up} upcoming).'
    newest = max(books.values())
    age = (now - newest).total_seconds() / 3600
    per = ', '.join(f'{b} {t.strftime("%Y-%m-%d %H:%MZ")}' for b, t in sorted(books.items(), key=lambda kv: kv[1], reverse=True))
    if age > max_hours:
        return 1, (f'odds capture stale: newest tick {newest.strftime("%Y-%m-%d %H:%MZ")} is {age:.1f} h old '
                   f'(alarm after {max_hours} h); last tick per book: {per}; board has {up} upcoming match(es).')
    return 0, f'odds capture fresh: newest tick {newest.strftime("%Y-%m-%d %H:%MZ")}, {age:.1f} h old; {per}; {up} upcoming.'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--matches', default=os.path.join(os.path.dirname(__file__), '..', 'matches.json'))
    ap.add_argument('--now', default=None)
    ap.add_argument('--max-hours', type=float, default=24)
    a = ap.parse_args()
    d = json.load(open(a.matches, encoding='utf-8'))
    matches = d if isinstance(d, list) else d.get('matches', [])
    now = parse(a.now) if a.now else datetime.datetime.now(datetime.timezone.utc)
    code, msg = verdict(matches, now, a.max_hours)
    print(('::error::' if code else '') + msg)
    return code


if __name__ == '__main__':
    sys.exit(main())
