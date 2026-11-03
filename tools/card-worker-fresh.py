#!/usr/bin/env python3
"""Stage 3 (2026-11-03): is the always-on card worker building the card state? Writes fresh=true|false to GITHUB_OUTPUT.

fresh = a card_state_runs row with ok and stage 'done' that finished within FRESH_MIN (20) minutes. Then the GitHub
archive job does not build the card state itself (one writer for odds_card_state). A read that fails counts as NOT
fresh — the GitHub job builds as before (never a gap in card prices because a check could not run)."""
import json, os, sys, urllib.request
from datetime import datetime, timezone, timedelta

FRESH_MIN = int(os.environ.get('CARD_WORKER_FRESH_MIN', '20'))


def main():
    url = (os.environ.get('SUPABASE_URL') or '').rstrip('/'); key = os.environ.get('SUPABASE_SECRET_KEY') or ''
    since = (datetime.now(timezone.utc) - timedelta(minutes=FRESH_MIN)).strftime('%Y-%m-%dT%H:%M:%SZ')
    fresh, why = False, ''
    try:
        req = urllib.request.Request(f"{url}/rest/v1/card_state_runs?select=finished_at,host&ok=is.true&stage=eq.done"
                                     f"&finished_at=gte.{since}&order=finished_at.desc&limit=1",
                                     headers={'apikey': key, 'Authorization': 'Bearer ' + key})
        with urllib.request.urlopen(req, timeout=30) as r:
            rows = json.loads(r.read())
        fresh = bool(rows)
        why = (f"worker cycle finished {rows[0]['finished_at']} on {rows[0]['host']}" if rows
               else f'no good worker cycle in the last {FRESH_MIN} min — this job builds the card state')
    except Exception as e:                       # noqa: BLE001
        why = f'card_state_runs unreadable ({type(e).__name__}) — this job builds the card state'
    print(f'card worker fresh={str(fresh).lower()}: {why}')
    out = os.environ.get('GITHUB_OUTPUT')
    if out:
        with open(out, 'a') as fh:
            fh.write(f'fresh={str(fresh).lower()}\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
