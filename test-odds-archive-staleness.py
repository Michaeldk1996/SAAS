#!/usr/bin/env python3
"""TEN-263: the odds-archive staleness alarm fires past 7 days, names the numbers, never reads missing as fresh."""
import datetime, importlib.util, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('s', os.path.join(HERE, 'tools', 'odds-archive-staleness.py'))
s = importlib.util.module_from_spec(spec); spec.loader.exec_module(s)
D = datetime.date.fromisoformat
fails = 0
def check(name, cond):
    global fails
    print(('PASS ' if cond else 'FAIL ') + name)
    fails += 0 if cond else 1

check('7 days old is not stale', s.verdict(D('2026-09-13'), D('2026-09-20'), 7)[0] == 0)
code, msg = s.verdict(D('2026-09-13'), D('2026-09-21'), 7)
check('8 days old alarms', code == 1)
check('the alarm names days, last date and inbox', '8 days stale' in msg and '2026-09-13' in msg and 'odds-archive-inbox' in msg)
check('no readable date alarms (missing is never fresh)', s.verdict(None, D('2026-09-21'), 7)[0] == 1)
with tempfile.TemporaryDirectory() as d:
    with open(os.path.join(d, '2025.csv'), 'w') as f: f.write('date,winner\n2025-11-20,A\n')
    with open(os.path.join(d, '2026.csv'), 'w') as f: f.write('date,winner\n2026-09-13,A\nnot-a-date,B\n2026-01-02,C\n')
    with open(os.path.join(d, 'refresh-log.jsonl'), 'w') as f: f.write('{"latestDate":"2099-01-01"}\n')
    check('newest date across season files, bad dates skipped, other files ignored', s.newest_date(d) == D('2026-09-13'))
    r = subprocess.run([sys.executable, os.path.join(HERE, 'tools', 'odds-archive-staleness.py'), '--archive', d, '--today', '2026-09-23'], capture_output=True, text=True)
    check('CLI exits 1 with an ::error:: line when stale', r.returncode == 1 and r.stdout.startswith('::error::odds-archive is 10 days stale'))
    r = subprocess.run([sys.executable, os.path.join(HERE, 'tools', 'odds-archive-staleness.py'), '--archive', d, '--today', '2026-09-15'], capture_output=True, text=True)
    check('CLI exits 0 when fresh', r.returncode == 0)
print(f'RESULT: {7 - fails} passed, {fails} failed')
sys.exit(1 if fails else 0)
