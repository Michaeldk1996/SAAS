import sys, importlib.util
sys.argv=['x']
spec=importlib.util.spec_from_file_location('A','ten253-close-lastseen-audit.py')
A=importlib.util.module_from_spec(spec); spec.loader.exec_module(A)
E=A.epoch
START=E('2026-09-20T12:00:00Z')
def row(price, ins, seen=None):
    return {'price_decimal':price,'inserted_on':ins,'last_seen_at':seen,'observed_at':None}
F=[]
def ck(n,c,d=''):
    print(('  ok   ' if c else '  FAIL ')+n+(('  '+d) if (d and not c) else '')); (None if c else F.append(n))

# 1 · THE STRADDLER — listed before the off and still listed after it.
a=A.close_arms([row(1.9,'2026-09-19T17:00:00Z','2026-09-20T12:30:00Z')],START)
ck('OLD throws the straddler away: lag = 19h', round(a['old'][1]/60,1)==19.0, str(a['old'][1]))
ck('STRICT finds NO candidate at all (its last-seen is past the off)', a['strict'][0] is None)
ck('CAPPED scores it lag 0 — it WAS the price at the off', a['capped'][1]==0.0, str(a['capped'][1]))

# 2 · the ordinary recovery — still listed 20 min before the off
a=A.close_arms([row(2.0,'2026-09-19T17:00:00Z','2026-09-20T11:40:00Z')],START)
ck('OLD lag is 19h (first-saved)', round(a['old'][1]/60,1)==19.0)
ck('CAPPED lag is 20 min (last-seen)', a['capped'][1]==20.0, str(a['capped'][1]))
ck('…so it passes the 60-min limit the old rule failed', a['capped'][1]<=60 and a['old'][1]>60)

# 3 · a price that did NOT exist before the off must never be capped into contention
a=A.close_arms([row(2.0,'2026-09-20T12:05:00Z','2026-09-20T12:40:00Z')],START)
ck('a post-off price is NOT a close under CAPPED', a['capped'][0] is None)

# 4 · the 1.01 floor still applies — a suspension marker is not a price
a=A.close_arms([row(0.0,'2026-09-20T11:50:00Z','2026-09-20T11:59:00Z')],START)
ck('a 0.000 suspension marker is not selectable under CAPPED', a['capped'][0] is None)

# 5 · picks the FRESHEST by the capped clock, not the newest insert
rows=[row(2.0,'2026-09-19T10:00:00Z','2026-09-20T11:55:00Z'),   # older insert, seen late
      row(3.0,'2026-09-20T09:00:00Z','2026-09-20T09:05:00Z')]   # newer insert, seen early
a=A.close_arms(rows,START)
ck('CAPPED picks the price still listed latest, not the latest inserted',
   a['capped'][0]['price_decimal']==2.0, str(a['capped'][0]))
ck('CONTROL: OLD picks the other one, so the two rules really differ here',
   a['old'][0]['price_decimal']==3.0)

# 6 · no observations at all
a=A.close_arms([],START)
ck('an empty series yields no candidate on any arm and no crash',
   a['old'][0] is None and a['capped'][0] is None and a['capped'][1] is None)

# 7 · missing last_seen_at falls back to inserted_on, never to "now"
a=A.close_arms([row(2.0,'2026-09-20T11:30:00Z',None)],START)
ck('a row with no last_seen_at falls back to its insert time (30 min)', a['capped'][1]==30.0, str(a['capped'][1]))

print(('\nALL PASS' if not F else f'\n{len(F)} FAILURE(S): {F}'))
sys.exit(1 if F else 0)
