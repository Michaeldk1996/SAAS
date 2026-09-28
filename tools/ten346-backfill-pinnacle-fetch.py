#!/usr/bin/env python3
"""TEN-346 — one-time pinnacle+30 pull for the 3-22 Sep captured-Pinnacle backfill.

Reads the plan written by `node tools/ten346-backfill-captured-pinnacle.js plan`, and for every
joined card pulls /v4/historical-odds?fixtureId=..&bookmakers=pinnacle+30 (free, unmetered) into
a local cache, one JSON per fixture: the match-winner (market 121) series of participant1 /
participant2, extracted by refresh-odds-history.py's own extract_series (the exact transform
behind the board's chart.books['Pinnacle +30s']). Orientation to the card and the cut happen
in the Node build step, through build-captured-pinnacle.js.

THE KEY (.claude/rules/odds.md): the loop wins the key. Every call waits for
archive-oddspapi-raw.py's wait_for_key() — the :05-:14 window of the quarter hour
(DAILY_YIELD_MODE=window) AND loop_idle() — and on a 429 pauses 60 s and tries the same
fixture again (up to 3 times), dropping the idle cache. Only /v4/historical-odds and
/v4/account are ever called; the meter is read before and after. A cached fixture is never
pulled again.

GitHub reads for loop_idle() use GITHUB_TOKEN from the environment.

Usage:
  python3 tools/ten346-backfill-pinnacle-fetch.py --targets <plan.json> --cache <dir> [--max-seconds 7200]
"""
import argparse
import importlib.util
import json
import os
import sys
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BOOK = 'pinnacle+30'
HIST = '/v4/historical-odds'


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, file))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
A = _load('archive_oddspapi_raw', 'archive-oddspapi-raw.py')    # the key gate
H = _load('refresh_odds_history', 'refresh-odds-history.py')    # the series transform


def pull(fixture_id, key, budget_end, counts):
    """One gated call. (payload | None, err). err == 'budget' when the time ran out waiting."""
    for _ in range(A.DAILY_429_TRIES):
        if not A.wait_for_key(budget_end, counts):
            return None, 'budget'
        try:
            body, err = A.free_get(HIST, {'fixtureId': fixture_id, 'bookmakers': BOOK}, key)
        except OSError as e:          # py3.9: socket.timeout is not TimeoutError; api_get misses it
            return None, f'{type(e).__name__}'
        if err != 429:
            return body, err
        A.forget_idle()
        counts['http429'] += 1
        print(f'429 on {fixture_id}: pausing {A.DAILY_429_PAUSE_S}s, then the same fixture again.', flush=True)
        A._sleep(A.DAILY_429_PAUSE_S)
        counts['waitS'] += A.DAILY_429_PAUSE_S
    return None, 429


def entry(fixture_id, card, data, err):
    e = {'fixtureId': fixture_id, 'eventKey': card['eventKey'], 'date': card['date'],
         'fetchedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
         'status': 200 if data is not None else err, 'series': None}
    if data is not None:
        blk = (data.get('bookmakers') or {}).get(BOOK)
        if isinstance(blk, dict):
            s1, s2 = H.extract_series(blk)
            e['series'] = {'p1': s1, 'p2': s2}
        for k in ('participant1Name', 'participant2Name', 'participant1Id', 'participant2Id', 'startTime', 'trueStartTime', 'trueEndTime'):
            if k in data:
                e[k] = data[k]
    return e


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--targets', required=True)
    ap.add_argument('--cache', required=True)
    ap.add_argument('--max-seconds', type=int, default=7200)
    a = ap.parse_args()
    key = A.read_odds_key()
    if not key:
        A.die('ODDSPAPI_KEY is not set.')
    os.makedirs(a.cache, exist_ok=True)
    plan = json.load(open(a.targets))
    todo = [c for c in plan['cards'] if c.get('fixtureId') and not c.get('skip')
            and not os.path.exists(os.path.join(a.cache, f"{c['fixtureId']}.json"))]
    print(f'{len(todo)} fixture(s) to pull; key yield mode {A.DAILY_YIELD_MODE}.', flush=True)
    used0, _ = A.meter(key, 'before', get=A.free_get)
    counts = {'waitS': 0, 'http429': 0, 'ok': 0, 'err': 0}
    budget_end = A._clock_s() + a.max_seconds
    for i, c in enumerate(todo):
        data, err = pull(c['fixtureId'], key, budget_end, counts)
        if err == 'budget':
            print('time budget spent waiting for the key; the next run resumes.', flush=True)
            break
        e = entry(c['fixtureId'], c, data, err)
        if e['status'] == 200 or e['status'] == 404:
            with open(os.path.join(a.cache, f"{c['fixtureId']}.json"), 'w') as f:
                json.dump(e, f)
        counts['ok' if e['status'] == 200 else 'err'] += 1
        n = len((e['series'] or {}).get('p1') or []) + len((e['series'] or {}).get('p2') or [])
        print(f"[{i + 1}/{len(todo)}] {c['date']} {c['eventKey']} {c['fixtureId']}: {e['status']} ({n} points)", flush=True)
        time.sleep(A.HIST_SLEEP)
    used1, _ = A.meter(key, 'after', get=A.free_get)
    print(f'done: {json.dumps(counts)}; calls {json.dumps(A.CALLS)}; meter {used0} -> {used1}.', flush=True)


if __name__ == '__main__':
    main()
