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


# ─────────────────────────────────────────────────────────────────────────────
# THE GUARDED ARM. The live forensic showed the capped rule taking a SUPERSEDED
# OPENER on 263 of 368 sides — the opening price, still on display, printed in
# the closing slot at a perfect zero lag. These lock the guard that stops it.
print()
print('=== the guarded arm ===')

def o_(price, ins, seen, opener=False, current=False):
    return {'price_decimal':price,'inserted_on':ins,'last_seen_at':seen,
            'observed_at':None,'is_opener':opener,'is_current':current,'side_id':1}

# The real shape: the opener is listed all the way past the off, while the
# current price stopped being served 40 min BEFORE it.
sup_opener = o_(3.0,'2026-09-18T09:00:00Z','2026-09-20T13:00:00Z', opener=True,  current=False)
last_price = o_(2.4,'2026-09-20T10:00:00Z','2026-09-20T11:20:00Z', opener=False, current=True)
arms = A.close_arms([sup_opener, last_price], START)

ck('the BRIEFED rule takes the superseded opener (this is the live 71.5% case)',
   arms['capped'][0]['price_decimal'] == 3.0)
ck('...at a lag of exactly 0, so it looks like a perfect close',
   arms['capped'][1] == 0.0)
ck('the GUARDED rule takes the real last price instead',
   arms['guarded'][0]['price_decimal'] == 2.4)
ck('...and times it honestly at 40 min, not 0',
   arms['guarded'][1] == 40.0, str(arms['guarded'][1]))
ck('the guarded pick still beats the OLD rule on lag here',
   arms['guarded'][1] < arms['old'][1])

# An opener that is ALSO current — opened and never moved — must NOT be excluded.
both = o_(3.0,'2026-09-18T09:00:00Z','2026-09-20T13:00:00Z', opener=True, current=True)
g = A.close_arms([both], START)['guarded']
ck('an opener that is STILL CURRENT survives the guard (it opened and never moved)',
   g[0] is not None and g[0]['price_decimal'] == 3.0)
ck('...and caps to lag 0, which is correct — it WAS the price at the off',
   g[1] == 0.0)

# If the opener is the only row and it is superseded, guarded must DASH rather
# than fall back to it. A wrong close is worse than no close.
g2 = A.close_arms([sup_opener], START)['guarded']
ck('a superseded opener ALONE yields NO guarded close — a dash, not a wrong price',
   g2[0] is None)


# ─────────────────────────────────────────────────────────────────────────────
# RULING 1 (founder 2026-09-23 06:23Z): superseded NON-OPENER rows re-seen after
# replacement are the same trap one row later. The CURRENT arm must not take one;
# the GUARDED arm can.
print()
print('=== ruling 1 — the superseded non-opener ===')
def r1(price, ins, seen, opener=False, current=False, side=2):
    return {'price_decimal': price, 'inserted_on': ins, 'last_seen_at': seen,
            'observed_at': None, 'is_opener': opener, 'is_current': current,
            'side_id': side, 'fixture_id': 9, 'feed_source_id': 171}
# 2.10 was current, moved to 2.40 at 09:00 (its not-current copy is re-served as
# history past the off); 2.40 was current and Kibl stopped listing it at 11:20.
hist = r1(2.10, '2026-09-20T06:00:00Z', '2026-09-20T12:30:00Z')                 # (F,F) straddles
cur  = r1(2.40, '2026-09-20T09:00:00Z', '2026-09-20T11:20:00Z', current=True)   # the real last price
g, gt = A.pick_close([hist, cur], START, 'guarded')
c, ct = A.pick_close([hist, cur], START, 'current')
ck('GUARDED takes the superseded non-opener at a fake lag 0 (the ruling-1 hole)',
   g['price_decimal'] == 2.10 and gt == START, str(g))
ck('CURRENT takes the real last price 2.40', c['price_decimal'] == 2.40, str(c))
ck('...timed honestly at 40 min before the off', round((START - ct) / 60, 1) == 40.0, str(ct))
# The ruling-1 counter must see that row as re-seen AFTER it was replaced.
kib = {(9, 'kibl', 'bet105'): [{'start_ts': '2026-09-20T12:00:00Z', 'start_ts_source': 'oddspapi'}]}
out = A.ruling1(kib, {('9', 'bet105'): [hist, cur,
                      r1(1.70, '2026-09-20T06:00:00Z', '2026-09-20T12:30:00Z', current=True, side=3)]},
                print_=lambda *a: None)
ck('the counter finds the non-opener re-seen after its replacement appeared',
   out['ruling1']['reseenAfterReplaced'] == 1, str(out['ruling1']))
ck('and does NOT count a current row (only is_current=false non-openers qualify)',
   out['ruling1']['nonOpenerNotCurrent'] == 1)
ck('card grain: CURRENT arm puts the fixture in within60 (both sides, lags 40 and 0)',
   out['arms']['current'].get('within60') == 1, str(out['arms']))
ck('card grain: a one-sided fixture is never counted as a card close',
   A.ruling1(kib, {('9', 'bet105'): [cur]}, print_=lambda *a: None)['arms']['current'].get('not_two_sides') == 1)

# ── the AFTER split must classify every pinned fixture into exactly one bucket
print()
print('=== the 185 after-split classifier ===')
_sp = importlib.util.spec_from_file_location('X', 'ten253-after-split.py')
X = importlib.util.module_from_spec(_sp); _sp.loader.exec_module(X)
_pop = [{'fixture_id': i, 'book': 'bet105'} for i in (1, 2, 3, 4, 5)]
_mk = {(str(i), 'bet105'): k for i, k in zip((1, 2, 3, 4, 5), 'abcde')}
def _R(b, s, c, w, sel=True):
    return {'book': b, 'side': s, 'is_selected': sel, 'close_price': c,
            'close_ts': '2026-09-20T11:00:00Z' if c else None, 'close_within_60': w,
            'start_ts': '2026-09-20T12:00:00Z'}
_rows = {'a': [_R('bet105', '1', 2, True), _R('bet105', '2', 2, True)],
         'b': [_R('bet105', '1', None, None, False), _R('bet105', '2', None, None, False),
               _R('bet365', '1', 2, True), _R('bet365', '2', 2, True)],
         'c': [_R('bet105', '1', 2, False), _R('bet105', '2', 2, False)],
         'd': [_R('bet105', '1', None, None), _R('bet105', '2', None, None)],
         'e': [_R('bet105', '1', 2, True), _R('bet365', '2', 2, True)]}
_per, _t = X.classify(_pop, _rows, _mk)
ck('fix1 within-60 / switch within-60 / fix1 older / genuine dash / MIXED are told apart',
   [p['after'] for p in _per] == ['fix1_within60', 'switch_within60', 'fix1_older',
                                  'dash_no_book_had_a_close', 'MIXED_BOOKS'], str(_per))
ck('every pinned fixture lands in exactly one bucket (the split sums to n)', sum(_t.values()) == 5)
ck('an older close carries its age (60 min here)', _per[2].get('older_age_min') == 60.0)
print(('\nALL PASS' if not F else f'\n{len(F)} FAILURE(S): {F}'))
sys.exit(1 if F else 0)
