#!/usr/bin/env python3
"""Stale-NOW monitor — TEN-179, founder ruling 2026-09-11.

    python3 check-now-staleness.py

THE RULING, VERBATIM
    "Stale-NOW window: 120 minutes. 90 fires on a slipped pipeline cycle with nothing
     wrong, 180 sleeps through the exact incident that started this. Measure against the
     PUBLISHED board, not the committed file — the Tiafoe case proves why. Exclude
     fixtures with no Bet365 line; that's the open-monitor's job and conflating them gives
     me one alarm for two conditions. Re-derive the number on TEN-187 once the loop has a
     day of real cadence."

WHY THE PUBLISHED BOARD AND NOT matches.json
    Capture staleness and PUBLISH staleness are different stages, and the visitor sees the
    sum. Proven on 2026-09-11: capture tick 1 wrote Tiafoe/Shelton at 3.4/1.333 while the
    published card still read 3.5/1.3, because the pipeline republishes from the COMMITTED
    file one cycle later. A monitor reading the working tree would have called that
    healthy while the visible card was flat. So this script fetches the artefact Pages is
    actually serving, cache-busted — a plain fetch can be answered from the CDN with a
    stale copy, which would make the monitor lie in the same direction as the bug.

WHY observedAt AND NOT at
    `bet365Now.at` is when bet365 last MOVED the price. A market that has sat unchanged
    for 20 hours carries a 20-hour-old `at` while being perfectly current — measuring that
    would report a quiet market as a dead pipeline, four times an hour. `observedAt` is
    when WE last looked, which is the only thing staleness is actually about. Both NOW
    paths carry it: the metered hourly read stamps src='live', and bsp-pipeline.js stamps
    the series-derived path src='series' from oddsMovement.capturedAt (oddsMovement itself
    is stripped by sharding before the board ships, so the stamp has to travel on
    bet365Now or it does not reach the published artefact at all).

WHAT IS DELIBERATELY EXCLUDED
    A fixture with NO bet365 line at all is not stale — it is unopened, which is the
    open-monitor's condition (refresh-odds-history.py, T-24h). Per the ruling these stay
    two alarms for two conditions. Completed matches are excluded too: they render
    open -> CLOSE and carry no NOW by construction.

EXIT CODE
    Always 0. The alarm is the ::error:: annotation and the record in the state file, not
    a red run. This runs on every 15-minute loop tick, and a workflow that goes red four
    times an hour is how a real signal gets ignored — the same lesson already written into
    refresh-odds-history.py's first_appearance() after 37 unread red runs (Sep 2-10).
    A caller that wants the alarm as a status can read maxAgeMin off the state file.
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE_MATCHES_URL = 'https://michaeldk1996.github.io/SAAS/matches.json'
STATE_FILE = os.path.join(HERE, 'odds-now-staleness.json')

# The founder's number. Env override exists so TEN-187 can re-derive it against a day of
# real loop cadence without editing code, per the ruling's last sentence.
THRESHOLD_MIN = float(os.environ.get('STALE_NOW_MIN', '120'))

MAX_SAMPLES = 400          # ~4 days at 96 ticks/day; this file must never become a payload problem


def _parse(ts):
    if not isinstance(ts, str) or not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace('Z', '+00:00'))
    except ValueError:
        return None


def fetch_published():
    """The board Pages is serving right now. Cache-busted twice over: a unique query
    string so the CDN cannot map us onto a cached object, and no-cache request headers."""
    url = f'{LIVE_MATCHES_URL}?cb={int(time.time())}'
    req = urllib.request.Request(url, headers={
        'Cache-Control': 'no-cache, no-store, max-age=0',
        'Pragma': 'no-cache',
        'User-Agent': 'bsp-stale-now-monitor/1',
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode('utf-8'))


def main():
    now = datetime.now(timezone.utc)
    now_iso = now.strftime('%Y-%m-%dT%H:%M:%SZ')

    try:
        matches = fetch_published()
    except Exception as e:
        # A transport failure is not a staleness measurement and must not be recorded as
        # one — a silent zero here would look exactly like a healthy board.
        print(f'::warning::Stale-NOW monitor could not read the published board ({e}). '
              f'No measurement taken this tick.')
        return 0

    if not isinstance(matches, list):
        print('::warning::Published matches.json is not a list — no measurement taken.')
        return 0

    measured, stale, no_clock, skipped_no_line = [], [], [], 0

    for m in matches:
        if m.get('finalScore'):
            continue                      # completed cards render open -> close, no NOW
        now_leg = m.get('bet365Now')
        if not now_leg:
            skipped_no_line += 1          # unopened market == the open-monitor's alarm
            continue
        observed = _parse(now_leg.get('observedAt'))
        label = f'{m.get("p1")} v {m.get("p2")} ({m.get("tour")}, {m.get("date")})'
        if not observed:
            # A NOW with no capture clock cannot be aged. Report it as its own condition
            # rather than guessing from `at` or quietly dropping it.
            no_clock.append(label)
            continue
        age_min = (now - observed).total_seconds() / 60.0
        rec = {'match': label, 'ageMin': round(age_min, 1),
               'observedAt': now_leg.get('observedAt'), 'src': now_leg.get('src')}
        measured.append(rec)
        if age_min > THRESHOLD_MIN:
            stale.append(rec)

    max_age = max((r['ageMin'] for r in measured), default=None)

    store = {'schema': 'odds-now-staleness/1'}
    try:
        prior = json.load(open(STATE_FILE))
        if isinstance(prior.get('samples'), list):
            store['samples'] = prior['samples']
    except Exception:
        pass
    store.setdefault('samples', [])
    store['samples'].append({'at': now_iso, 'thresholdMin': THRESHOLD_MIN,
                             'measured': len(measured), 'stale': len(stale),
                             'maxAgeMin': max_age, 'noClock': len(no_clock),
                             'noBet365Line': skipped_no_line})
    store['samples'] = store['samples'][-MAX_SAMPLES:]
    store['updatedAt'] = now_iso
    store['thresholdMin'] = THRESHOLD_MIN
    store['latest'] = {'maxAgeMin': max_age, 'measured': len(measured),
                       'stale': [r['match'] for r in stale]}
    store['note'] = ('Age of the published bet365 NOW leg, measured as now - observedAt '
                     'against the artefact Pages is serving. Capture staleness and publish '
                     'staleness are both inside this number, which is what the visitor '
                     'sees. Re-derive the threshold on TEN-187.')
    try:
        with open(STATE_FILE, 'w') as fh:
            json.dump(store, fh, indent=2, ensure_ascii=False, sort_keys=True)
    except Exception as e:
        print(f'::warning::Could not persist {os.path.basename(STATE_FILE)} ({e}).')

    for r in stale:
        print(f'::error::Stale NOW: {r["match"]} — published bet365 price last observed '
              f'{r["ageMin"]:.0f} min ago (src {r["src"]}), past the {THRESHOLD_MIN:.0f}-min '
              f'window. The board is showing a price we have not re-checked since then.')
    for label in no_clock:
        print(f'::warning::Published NOW for {label} carries no observedAt — it cannot be '
              f'aged. Expected only for a card pinned before the capture clock shipped.')

    age_txt = f'{max_age:.0f} min' if max_age is not None else 'n/a'
    print(f'Stale-NOW ({THRESHOLD_MIN:.0f}-min window, published board): {len(measured)} '
          f'upcoming fixture(s) with a bet365 line measured, {len(stale)} stale, oldest '
          f'{age_txt}. {skipped_no_line} upcoming fixture(s) excluded for having no bet365 '
          f'line (open-monitor territory).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
