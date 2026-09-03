#!/usr/bin/env python3
"""TEN-107 regression tests for the founder ruling (2026-09-03):

  1. RAIN INTERRUPTIONS stay on the live feed (never dropped, never a timeout).
  2. RETIREMENTS clear within one 10-min refresh even when the card's UTC date
     is one calendar day off the fixture's account-tz event_date (the Moutet lag).
  3. GUARD A: a terminal status beats a lagging event_live=1 flag.

Drives the real refresh-scores.main() end to end with the network stubbed, then
asserts on the resulting matches.json — recomputing the outcome independently of
the code under test rather than reading its internals.
"""
import importlib.util, json, os, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('refresh_scores', os.path.join(HERE, 'refresh-scores.py'))
rs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rs)

# --- three cards on the board, all with odds already so no odds fetch fires ---
CARDS = [
    {  # (1) retirement whose card date is ONE DAY AHEAD of the fixture event_date
        'id': 'skew-retire', 'date': '2026-09-02', 'time': '23:30',
        'startTs': '2026-09-02T23:30:00Z',
        'p1Key': '111', 'p2Key': '222', 'p1': 'A. One', 'p2': 'B. Two',
        'odds': {'p1': 1.5, 'p2': 2.5}, 'live': True, 'finalScore': None,
    },
    {  # (2) rain-suspended match — must STAY, not disappear
        'id': 'rain', 'date': '2026-09-02', 'time': '14:00',
        'startTs': '2026-09-02T14:00:00Z',
        'p1Key': '333', 'p2Key': '444', 'p1': 'C. Three', 'p2': 'D. Four',
        'odds': {'p1': 1.8, 'p2': 2.0}, 'live': True, 'finalScore': None,
    },
    {  # (3) retired match still lagging event_live=1 (Guard A)
        'id': 'guarda', 'date': '2026-09-02', 'time': '12:00',
        'startTs': '2026-09-02T12:00:00Z',
        'p1Key': '555', 'p2Key': '666', 'p1': 'E. Five', 'p2': 'F. Six',
        'odds': {'p1': 1.2, 'p2': 4.0}, 'live': True, 'finalScore': None,
    },
]

FIXTURES = [
    {  # matches card 1 but dated the DAY BEFORE (acct-tz vs UTC skew)
        'event_date': '2026-09-01', 'event_time': '23:30',
        'first_player_key': '111', 'second_player_key': '222',
        'event_status': 'Retired', 'event_live': '0', 'event_winner': 'First Player',
        'scores': [{'score_set': '1', 'score_first': '6', 'score_second': '3'},
                   {'score_set': '2', 'score_first': '2', 'score_second': '1'}],
    },
    {  # matches card 2, same date — suspended
        'event_date': '2026-09-02', 'event_time': '14:00',
        'first_player_key': '333', 'second_player_key': '444',
        'event_status': 'Suspended', 'event_live': '0',
        'scores': [{'score_set': '1', 'score_first': '6', 'score_second': '4'}],
    },
    {  # matches card 3, same date — retired but event_live still '1'
        'event_date': '2026-09-02', 'event_time': '12:00',
        'first_player_key': '555', 'second_player_key': '666',
        'event_status': 'Retired', 'event_live': '1', 'event_winner': 'First Player',
        'scores': [{'score_set': '1', 'score_first': '6', 'score_second': '0'},
                   {'score_set': '2', 'score_first': '3', 'score_second': '2'}],
    },
]


def run():
    tmp = tempfile.mkdtemp()
    matches_path = os.path.join(tmp, 'matches.json')
    with open(matches_path, 'w') as fh:
        json.dump(CARDS, fh)
    # stub network + filesystem
    rs.MATCHES = matches_path
    rs.AUDIT = os.path.join(tmp, 'audit.jsonl')
    rs.read_key = lambda: 'TESTKEY'
    def fake_get_json(url):
        if 'method=get_fixtures' in url:
            # assert the fetch window was widened to cover the skewed fixture
            assert 'date_start=2026-09-01' in url, f'window not padded: {url}'
            return {'result': FIXTURES}
        return {'result': {}}  # any odds call -> empty
    rs.get_json = fake_get_json
    rs.main()
    return json.load(open(matches_path))


def main():
    out = {m['id']: m for m in run()}
    fails = []

    # (1) retirement joined across the ±1-day skew and cleared
    r = out['skew-retire']
    if not r.get('retired'):     fails.append('(1) skew retirement not stamped retired')
    if r.get('live') is not False: fails.append('(1) skew retirement still live')
    if not r.get('finalScore'):  fails.append('(1) skew retirement has no final score')

    # (2) rain interruption STAYS and is marked interrupted, not dropped/decided
    if 'rain' not in out:        fails.append('(2) rain match DISAPPEARED from the feed')
    n = out.get('rain', {})
    if n.get('interrupted') is not True: fails.append('(2) rain match not marked interrupted')
    if n.get('live') is not False:       fails.append('(2) rain match still flagged live')
    if n.get('finalScore') is not None:  fails.append('(2) rain match wrongly given a final score')

    # (3) Guard A: terminal beats lagging event_live=1
    g = out['guarda']
    if g.get('live') is not False: fails.append('(3) Guard A failed — retired match still live')
    if not g.get('retired'):       fails.append('(3) Guard A failed — retired not stamped')

    # all three cards survive (nothing silently dropped)
    if len(out) != 3:            fails.append(f'card count changed: {len(out)} (expected 3)')

    if fails:
        print('FAIL:')
        for f in fails:
            print('  -', f)
        sys.exit(1)
    print('PASS: retirement clears across ±1-day skew; rain interruption stays; Guard A holds.')


if __name__ == '__main__':
    main()
