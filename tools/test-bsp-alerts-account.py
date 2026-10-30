#!/usr/bin/env python3
"""bsp_alerts.quota_status: an UNREAD oddspapi account (a 429, a timeout) is never reported as
"NO active subscription". 30 Oct 2026: every odds-history run printed that ::error:: on a 429
while the subscription was valid to 10 Nov. Fakes _api_get; no network."""
import contextlib, importlib.util, io, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('bsp_alerts', os.path.join(ROOT, 'bsp_alerts.py'))
ba = importlib.util.module_from_spec(spec); spec.loader.exec_module(ba)
fails = 0
def check(name, cond):
    global fails
    print(('PASS ' if cond else 'FAIL ') + name); fails += 0 if cond else 1

def run(answer):
    ba._api_get = lambda path, params, key: answer
    ba._record_sample = lambda used, now, by=None: []
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        st = ba.quota_status('k')
    return st, out.getvalue() + err.getvalue()

st, log = run((None, 429))
check('a 429 on /v4/account is not "NO active subscription"', 'NO active subscription' not in log)
check('...it says the account could not be read', 'Could not read the oddspapi account (429)' in log and st is None)
st, log = run((None, 'timed out'))
check('a timeout is not "NO active subscription" either', 'NO active subscription' not in log)
st, log = run(({'subscriptions': [{'is_active': False}]}, None))
check('control: an account read with no active subscription still raises the error',
      '::error::oddspapi reports NO active subscription' in log and st is None)
sub = {'is_active': True, 'request_count': 10, 'request_limit': 5000,
       'valid_until': '2099-01-01T00:00:00Z', 'valid_from': '2026-10-10T00:00:00Z'}
ba._api_get = lambda *a: ({'subscriptions': [sub]}, None)
got_sub = ba.active_subscription('k')
ba._api_get = lambda *a: (None, 429)
with contextlib.redirect_stderr(io.StringIO()):
    got_none = ba.active_subscription('k')
check('active_subscription keeps its contract (the block, or None)', got_sub is sub and got_none is None)
print(f'RESULT: {5 - fails} passed, {fails} failed')
sys.exit(1 if fails else 0)
