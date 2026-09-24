#!/usr/bin/env python3
"""TEN-263: the capture-freshness alarm fires past 24 h with no tick from ANY book, names the
books and the newest tick, and never reads 'no ticks at all' as fresh."""
import datetime, importlib.util, json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('f', os.path.join(HERE, 'tools', 'odds-capture-freshness.py'))
f = importlib.util.module_from_spec(spec); spec.loader.exec_module(f)
P = lambda s: datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))
fails = 0
def check(name, cond):
    global fails
    print(('PASS ' if cond else 'FAIL ') + name); fails += 0 if cond else 1

def match(book_ticks, final=False):
    return {'finalScore': '2-0' if final else None, 'oddsMovement': {'books': {b: {'p1': [[t, 1.5]], 'p2': [[t, 2.5]]} for b, t in book_ticks.items()}}}

board = [match({'Pinnacle': '2026-09-02T02:45:05Z', 'bet365': '2026-09-02T02:46:00Z'}), match({'bet365': '2026-09-01T10:00:00Z'}, final=True)]
code, msg = f.verdict(board, P('2026-09-03T03:00:00Z'), 24)
check('the 2 Sep freeze fires 24 h later', code == 1)
check('the alarm names the newest tick, every book and the upcoming count', '2026-09-02 02:46Z' in msg and 'Pinnacle 2026-09-02 02:45Z' in msg and '1 upcoming' in msg)
check('under 24 h is fresh', f.verdict(board, P('2026-09-03T02:00:00Z'), 24)[0] == 0)
check('the newest tick of ANY book counts (one live book keeps it fresh)',
      f.verdict(board + [match({'1xBet': '2026-09-03T01:00:00Z'})], P('2026-09-03T12:00:00Z'), 24)[0] == 0)
check('no tick at all is never fresh', f.verdict([{'finalScore': None}], P('2026-09-03T12:00:00Z'), 24)[0] == 1)
check('a future-dated tick never keeps a frozen capture green',
      f.verdict(board + [match({'bet365': '2027-01-01T00:00:00Z'})], P('2026-09-05T00:00:00Z'), 24)[0] == 1)
check('a timestamp without a zone reads as UTC', f.verdict([match({'bet365': '2026-09-04T23:00:00'})], P('2026-09-05T00:00:00Z'), 24)[0] == 0)
check('a malformed book series is skipped, not a crash',
      f.verdict([{'oddsMovement': {'books': {'x': [1, 2]}}}] + board, P('2026-09-02T05:00:00Z'), 24)[0] == 0)
# Founder ruling 2026-09-24: red only when at least one upcoming match is on the board.
quiet = [match({'bet365': '2026-09-12T10:00:00Z'}, final=True), match({'bet365': '2026-09-12T09:00:00Z'}, final=True)]
qc, qm = f.verdict(quiet, P('2026-09-14T10:00:00Z'), 24)
check('a stale capture on a board with 0 upcoming matches stays green, and says so', qc == 0 and 'no upcoming match' in qm)
check('control: the same stale capture with 1 upcoming match goes red',
      f.verdict(quiet + [{'finalScore': None}], P('2026-09-14T10:00:00Z'), 24)[0] == 1)
check('no tick at all on a board with 0 upcoming matches is quiet, not red',
      f.verdict([{'finalScore': '2-0'}], P('2026-09-17T12:00:00Z'), 24)[0] == 0)
check('the gate is one constant, set to 1', f.MIN_UPCOMING == 1)
with tempfile.TemporaryDirectory() as d:
    p = os.path.join(d, 'matches.json'); json.dump({'matches': board}, open(p, 'w'))
    r = subprocess.run([sys.executable, os.path.join(HERE, 'tools', 'odds-capture-freshness.py'), '--matches', p, '--now', '2026-09-05T00:00:00Z'], capture_output=True, text=True)
    check('CLI exits 1 with one ::error:: line when stale', r.returncode == 1 and r.stdout.startswith('::error::odds capture stale'))
    r = subprocess.run([sys.executable, os.path.join(HERE, 'tools', 'odds-capture-freshness.py'), '--matches', p, '--now', '2026-09-02T05:00:00Z'], capture_output=True, text=True)
    check('CLI exits 0 when fresh', r.returncode == 0)
print(f'RESULT: {14 - fails} passed, {fails} failed')
sys.exit(1 if fails else 0)
