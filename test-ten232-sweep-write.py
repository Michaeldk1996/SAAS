#!/usr/bin/env python3
"""Offline tests for the sweep's write retry in archive-kibl.py (card-job-lock, 2026-10-28).

Run 40650070903 (07:26Z 28 Oct) lost 1,000 rows when 2 of 35 insert chunks hit
57014. Founder ruling: retry the sweep's writes on timeout, at most 3 retries
with backoff, no exclusive locks on the retry path, alert Telegram after the
third. Each check names the mutation that turns it red.
"""
import json
import os
import re
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
K = types.ModuleType('K')
K.__file__ = os.path.join(HERE, 'archive-kibl.py')
src = open(K.__file__).read()
exec(compile(src.replace("if __name__ == \"__main__\":", "if False:"), K.__file__, 'exec'), K.__dict__)

FAILS = []


def check(label, ok, detail=''):
    print(f"  {'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        FAILS.append(label)
        if detail:
            print(f'       {detail}')


TIMEOUT = (500, '{"code":"57014","message":"canceling statement due to statement timeout"}')


class FakeRest:
    """Stores rows by key; fails the first `fail` calls (or every call) with `err`."""

    def __init__(self, fail=0, err=TIMEOUT, always=False, fail_over=None):
        self.fail, self.err, self.always, self.fail_over = fail, err, always, fail_over
        self.calls, self.stored = [], {}

    def __call__(self, method, path, url, key, body=None, headers=None, timeout=None):
        self.calls.append((method, path, len(body), headers, timeout))
        if self.always or self.fail > 0 or (self.fail_over and len(body) > self.fail_over):
            self.fail -= 1
            return None, self.err
        new = [r for r in body if r['k'] not in self.stored]
        for r in body:
            self.stored.setdefault(r['k'], r)
        return new, None


ROWS = [{'k': i} for i in range(500)]
H = {"Prefer": "resolution=ignore-duplicates,return=representation"}

print('1. a timed-out write is retried on halves and lands whole')
K.WRITE_FAILURES.clear()
sleeps = []
api = FakeRest(fail=1)
got, err = K.sb_write('/rest/v1/t', 'u', 'k', ROWS, H, 'insert chunk 0', sleep=sleeps.append, _req=api)
check('no error, all 500 rows returned  [mutant: no retry]', err is None and len(got) == 500, (err, len(got or [])))
check('retry halves the rows: 500 → 250 + 250  [mutant: same chunk re-sent]',
      [c[2] for c in api.calls] == [500, 250, 250], [c[2] for c in api.calls])
check('first wait is 10 s', sleeps == [10], sleeps)
check('every call carries the short client timeout', all(c[4] == K.WRITE_HTTP_TIMEOUT_S for c in api.calls))
check('nothing recorded as failed', K.WRITE_FAILURES == [])

print('2. at most 3 retries, then the failure is recorded and loud')
K.WRITE_FAILURES.clear(); K._RETRY_SLEPT[0] = 0
sleeps = []
api = FakeRest(always=True)
got, err = K.sb_write('/rest/v1/t', 'u', 'k', ROWS[:8], H, 'insert chunk 1', sleep=sleeps.append, _req=api)
check('returns the error', got is None and err == TIMEOUT)
check('waits 10, 30, 60 down each branch — never a 4th retry  [mutant: WRITE_RETRIES=4]',
      max(sleeps) == 60 and sleeps.count(10) == 1 and set(sleeps) == {10, 30, 60}, sleeps)
check('every row is in WRITE_FAILURES once', sum(n for _, n, _ in K.WRITE_FAILURES) == 8,
      K.WRITE_FAILURES)
check('call count bounded: 1 + 2 + 4 + 8 = 15', len(api.calls) == 15, len(api.calls))

print('2b. a database down for good stops retrying at the sweep budget')
K.WRITE_FAILURES.clear(); K._RETRY_SLEPT[0] = 0
sleeps = []
for c in range(6):
    K.sb_write('/rest/v1/t', 'u', 'k', ROWS, H, f'chunk {c}', sleep=sleeps.append, _req=FakeRest(always=True))
check(f'total backoff ≤ {K.WRITE_RETRY_BUDGET_S}s across the sweep  [mutant: no budget]',
      sum(sleeps) <= K.WRITE_RETRY_BUDGET_S, sum(sleeps))
check('every row still counted as failed', sum(n for _, n, _ in K.WRITE_FAILURES) == 3000)
K.alert_write_failures('s', send=lambda *a: None)
check('the alert resets the budget for the next sweep', K._RETRY_SLEPT[0] == 0)
K.WRITE_FAILURES.clear()

print('3. an SQL error is never retried')
K.WRITE_FAILURES.clear()
sleeps = []
api = FakeRest(always=True, err=(400, '{"code":"23502","message":"null value"}'))
got, err = K.sb_write('/rest/v1/t', 'u', 'k', ROWS, H, 'x', sleep=sleeps.append, _req=api)
check('one call, no wait, not recorded as a timeout failure  [mutant: retry everything]',
      len(api.calls) == 1 and sleeps == [] and K.WRITE_FAILURES == [], (len(api.calls), sleeps))
for e, want in ((TIMEOUT, True), ((503, 'x'), True), ((544, 'x'), True), ((None, 'timed out'), True),
                ((400, '55P03 lock'), True), ((400, '40P01'), True), ((409, 'conflict'), False),
                ((400, '23505'), False)):
    check(f'retryable({e[0]}, {e[1][:12]!r}) = {want}', K.write_retryable(e) is want)

print('4. the parts that landed stay landed; a retried part never doubles a row')
K.WRITE_FAILURES.clear()
api = FakeRest(fail_over=250)   # only a ≤250-row statement completes
got, err = K.sb_write('/rest/v1/t', 'u', 'k', ROWS, H, 'x', sleep=lambda s: None, _req=api)
check('all 500 stored exactly once', err is None and len(api.stored) == 500 and len(got) == 500)

print('5. the Telegram alert after the third retry')
K.WRITE_FAILURES.clear()
K.WRITE_FAILURES.extend([('insert chunk 0', 250, TIMEOUT), ('insert chunk 1', 250, TIMEOUT)])
sent = []
os.environ['TELEGRAM_BOT_TOKEN'], os.environ['TELEGRAM_CHAT_ID'] = 't', 'c'
text = K.alert_write_failures('20261028T072937Z', send=lambda t, c, m: sent.append(m))
check('one message, naming the sweep, the 500 rows and 2 parts  [mutant: alert dropped]',
      len(sent) == 1 and '500 rows' in sent[0] and '2 parts' in sent[0] and '20261028T072937Z' in sent[0], sent)
check('failures cleared: a backfill alerts once per day, not cumulatively', K.WRITE_FAILURES == [])
check('nothing to report → no message', K.alert_write_failures('s', send=lambda *a: sent.append(a)) is None
      and len(sent) == 1)
del os.environ['TELEGRAM_BOT_TOKEN']
K.WRITE_FAILURES.append(('x', 1, TIMEOUT))
check('no secrets → the text still returned (printed as ::error::), never silent',
      K.alert_write_failures('s') is not None)

print('6. the wiring')
writes = re.findall(r'(sb_\w+)\(\s*(?:"POST",\s*)?f"/rest/v1/\{TABLE_(OBS|FIXTURES)\}\?on_conflict', src)
check('all four obs/fixture writes go through sb_write  [control: the pre-fix sweep used sb_request]',
      [w for w, _ in writes] == ['sb_write'] * 4, writes)
body = src[src.index('def sb_write'):src.index('def alert_write_failures')]
check('the retry path issues no DDL / LOCK TABLE', not re.search(r'(?i)\b(lock table|alter|create|truncate)\b', body))
check('the sweep sends the alert', 'alert_write_failures(sweep_id)' in src)
check('constants as ruled: 3 retries', K.WRITE_RETRIES == 3 and len(K.WRITE_BACKOFF_S) == 3)
wf = open(os.path.join(HERE, '.github/workflows/ten232-kibl-archive.yml')).read()
sweep_step = wf[wf.index('- name: Sweep'):wf.index('- name: Backfill')]
check('the Sweep step gets the Telegram secrets', 'TELEGRAM_BOT_TOKEN' in sweep_step and 'TELEGRAM_CHAT_ID' in sweep_step)
pkg = json.load(open(os.path.join(HERE, 'package.json')))['scripts']['test']
check('wired into npm test and the workflow offline tests',
      'test-ten232-sweep-write.py' in pkg and 'python3 -B test-ten232-sweep-write.py' in wf)

print()
if FAILS:
    print(f'FAILED {len(FAILS)}: {FAILS}')
    sys.exit(1)
print('all card-job-lock sweep-write tests passed')
