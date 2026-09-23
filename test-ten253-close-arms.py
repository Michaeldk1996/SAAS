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


# ─────────────────────────────────────────────────────────────────────────────
# THE FORENSIC MUST DISCRIMINATE. A gate that reports the same thing under both
# readings is not a gate. Scenario A is a true re-sighting, B a vacuous replay;
# the instrument has to separate them or it cannot clear Fix 1 to ship.
print()
print('=== the step-4 forensic, driven under BOTH readings ===')

SIDE = 7
def mk(fid, price, ins, seen, cur=True):
    return {'fixture_id': fid, 'side_id': SIDE, 'price_decimal': price,
            'inserted_on': ins, 'last_seen_at': seen, 'observed_at': None,
            'is_current': cur}

# A · the price MOVED. Early rows stop being served; only the last one straddles.
obsA = [mk('1', 2.0, '2026-09-20T06:00:00Z', '2026-09-20T08:00:00Z', False),
        mk('1', 2.2, '2026-09-20T08:00:00Z', '2026-09-20T10:00:00Z', False),
        mk('1', 2.5, '2026-09-20T10:00:00Z', '2026-09-20T12:30:00Z', True)]
# B · the vendor REPLAYS everything: every row's last_seen tracks the sweep.
obsB = [mk('1', 2.0, '2026-09-20T06:00:00Z', '2026-09-20T12:30:00Z', False),
        mk('1', 2.2, '2026-09-20T08:00:00Z', '2026-09-20T12:30:00Z', False),
        mk('1', 2.5, '2026-09-20T10:00:00Z', '2026-09-20T12:30:00Z', False)]
kibl = {('1', 'kibl', 'bet105'): [{'start_ts': '2026-09-20T12:00:00Z'}]}

def cap(obs):
    out = []
    f = A.forensic(obs, kibl, {'1': obs}, print_=lambda *a: out.append(' '.join(str(x) for x in a)))
    return f, '\n'.join(out)

fa, ta = cap(obsA)
fb, tb = cap(obsB)

ck('A · only the standing price is re-seen past the off',
   fa['afterOffIsCurrent'] + fa['afterOffNotCurrent'] == 1, str(fa))
ck('A · and that row is the one Kibl still calls current',
   fa['afterOffIsCurrent'] == 1, str(fa))
ck('B · ALL THREE rows are re-seen past the off',
   fb['afterOffIsCurrent'] + fb['afterOffNotCurrent'] == 3, str(fb))
ck('B · none of them is current — the replay signature',
   fb['afterOffNotCurrent'] == 3, str(fb))
ck('the two readings produce DIFFERENT forensic output (the gate discriminates)',
   ta != tb)
ck('CONTROL: both readings still select the SAME closing price (2.5), which is\n'
   '        why the same-row rate alone cannot clear the gate and is_current must',
   A.close_arms(obsA, START)['capped'][0]['price_decimal'] == 2.5
   and A.close_arms(obsB, START)['capped'][0]['price_decimal'] == 2.5)
ck('the honest-cost counter fires: same price, old FAILS the gate, new PASSES',
   fa['sameRowGateFlip'] == 1, str(fa))
ck('never-re-seen rows are counted (A has none; the column is not vacuous)',
   fa['observations'] == 3, str(fa))


# ─────────────────────────────────────────────────────────────────────────────
# THE OPENER TRAP. Kibl keeps the opening price listed for the life of the
# fixture, so the opener straddles EVERY off and caps to lag 0 like any other
# straddler. If it ever won the tie-break we would be printing the opening price
# in the closing slot, at a lag of zero, looking perfect. The only thing
# stopping that is the tie-break on inserted_on — so it gets a control.
print()
print('=== the opener trap ===')

opener  = {'price_decimal':3.0,'inserted_on':'2026-09-18T09:00:00Z',
           'last_seen_at':'2026-09-20T13:00:00Z','observed_at':None,
           'is_opener':True,'is_current':False,'state':'opener','side_id':1}
current = {'price_decimal':2.4,'inserted_on':'2026-09-20T11:00:00Z',
           'last_seen_at':'2026-09-20T13:00:00Z','observed_at':None,
           'is_opener':False,'is_current':True,'state':'current','side_id':1}

pick = A.close_arms([opener, current], START)['capped'][0]
ck('both the opener and the current price straddle the off (both cap to lag 0)',
   A.close_arms([opener], START)['capped'][1] == 0.0
   and A.close_arms([current], START)['capped'][1] == 0.0)
ck('the CURRENT price is selected as the close, not the opener',
   pick['price_decimal'] == 2.4, str(pick.get('state')))
ck('and the selected row is not flagged is_opener', not pick.get('is_opener'))

# MUTATION CONTROL — drop the inserted_on tie-break and the opener wins, which
# is what makes the tie-break load-bearing rather than decorative.
def capped_no_tiebreak(lst, start):
    elig = [o for o in lst if A.real(o['price_decimal']) is not None
            and A.epoch(o['inserted_on']) < start]
    return min(elig, key=lambda o: min(A.seen_at(o), start)) if elig else None
mut = capped_no_tiebreak([opener, current], START)
ck('MUTATION CONTROL: without the inserted_on tie-break the OPENER is selected\n'
   '        — so the tie-break is load-bearing, not decorative',
   mut['price_decimal'] == 3.0, str(mut))

print(('\nALL PASS' if not F else f'\n{len(F)} FAILURE(S): {F}'))
sys.exit(1 if F else 0)
