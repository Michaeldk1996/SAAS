#!/usr/bin/env python3
"""Fail-closed gate for the line-summary capture (founder brief 2026-10-28, item 4).

Red when either holds:
  * the run captured fewer than --min-rows rows from a payload (bucket or post-start; the bet365-history rows the
    loader re-sends unchanged on every run never count) — read from the loader's own ten225-load-line-summary.json;
  * the newest Pinnacle +30 games-handicap / total-games row in oddspapi_line_summary started more than --max-age-h
    hours ago (36 by ruling), or no such row can be read at all.

A read that fails is red, never "fresh". Reads SUPABASE_URL / SUPABASE_SECRET_KEY. Stdlib only.
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOOK = 'pinnacle+30'
MARKETS = ('games handicap', 'total games')


def judge(capture_rows, newest_iso, now, min_rows, max_age_h):
    """(ok, lines). `capture_rows` None = the loader wrote no report; `newest_iso` None = no row read."""
    lines, ok = [], True
    if capture_rows is None:
        ok = False
        lines.append('::error::the loader wrote no report (ten225-load-line-summary.json): rows written — unknown')
    elif capture_rows < min_rows:
        ok = False
        lines.append(f'::error::{capture_rows} rows captured this run (need at least {min_rows}): an empty run is a failed run')
    else:
        lines.append(f'rows captured this run: {capture_rows} (minimum {min_rows})')
    if newest_iso is None:
        ok = False
        lines.append(f'::error::no {BOOK} games-handicap / total-games row with a start could be read')
    else:
        t = datetime.fromisoformat(str(newest_iso).replace('Z', '+00:00'))
        age_h = (now - t).total_seconds() / 3600.0
        if age_h > max_age_h:
            ok = False
            lines.append(f'::error::newest {BOOK} line row started {newest_iso} — {age_h:.1f} h ago (limit {max_age_h:g} h): '
                         f'the capture has stopped')
        else:
            lines.append(f'newest {BOOK} line row started {newest_iso} ({age_h:.1f} h ago; limit {max_age_h:g} h)')
    return ok, lines


def newest_start(url, key):
    q = urllib.parse.urlencode({'select': 'start_ts,fixture_id,market', 'book': f'eq.{BOOK}',
                                'market': 'in.(' + ','.join(f'"{m}"' for m in MARKETS) + ')',
                                'start_ts': 'not.is.null', 'order': 'start_ts.desc', 'limit': 1},
                               quote_via=urllib.parse.quote)
    req = urllib.request.Request(f'{url}/rest/v1/oddspapi_line_summary?{q}',
                                 headers={'Authorization': f'Bearer {key}', 'apikey': key})
    with urllib.request.urlopen(req, timeout=120) as r:
        rows = json.loads(r.read().decode('utf-8'))
    if not isinstance(rows, list):
        raise ValueError(f'expected a JSON list, got {type(rows).__name__}')
    return rows[0] if rows else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--min-rows', type=int, default=1)
    ap.add_argument('--max-age-h', type=float, default=36.0)
    ap.add_argument('--report', default=os.path.join(HERE, 'ten225-load-line-summary.json'))
    a = ap.parse_args()
    cap = None
    try:
        cap = json.load(open(a.report)).get('captureRows')
    except (OSError, ValueError):
        cap = None
    url = (os.environ.get('SUPABASE_URL') or '').rstrip('/')
    key = os.environ.get('SUPABASE_SECRET_KEY') or ''
    newest = None
    if url and key:
        try:
            row = newest_start(url, key)
            newest = row and row.get('start_ts')
            if row:
                print(f'newest row: fixture {row.get("fixture_id")} ({row.get("market")})')
        except Exception as e:                  # noqa: BLE001 — a failed read is red, reported
            print(f'::error::reading the newest line row failed: {type(e).__name__}')
    else:
        print('::error::SUPABASE_URL / SUPABASE_SECRET_KEY are not both set')
    ok, lines = judge(cap, newest, datetime.now(timezone.utc), a.min_rows, a.max_age_h)
    print('\n'.join(lines))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
