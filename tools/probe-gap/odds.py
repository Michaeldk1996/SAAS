# probe only: api-tennis get_odds for every unpriced team-event / no-TD ATP main-draw row with an event key (read-only)
import json, os, urllib.parse, urllib.request, collections, concurrent.futures as cf
X = json.load(open('classified.json'))
def at(p):
    u = 'https://api.api-tennis.com/tennis/?' + urllib.parse.urlencode({**p, 'APIkey': os.environ['API_TENNIS_KEY']})
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'probe'}), timeout=60) as r: return json.loads(r.read())
        except Exception as e: err = e
    return {'err': str(err)}
def fl(v):
    try: f = float(v); return f if f >= 1.01 else None
    except: return None
T = [x for x in X if x['lv'] == 'ATP main draw' and x['cat'] in ('team event', 'no Tennis-Data row') and x.get('ek')]
eks = sorted({str(x['ek']) for x in T}); print('event keys', len(eks), 'of rows', len(T), 'rows without key', sum(1 for x in X if x['lv']=='ATP main draw' and x['cat'] in ('team event','no Tennis-Data row') and not x.get('ek')))
def one(ek):
    o = at({'method': 'get_odds', 'match_key': ek}); ha = ((o.get('result') or {}).get(ek) or {}).get('Home/Away') or {}
    H, A = ha.get('Home') or {}, ha.get('Away') or {}
    books = sorted(b for b in set(H) & set(A) if fl(H[b]) and fl(A[b]))
    return ek, books
R = {}
with cf.ThreadPoolExecutor(12) as ex:
    for ek, b in ex.map(one, eks): R[ek] = b
json.dump(R, open('odds.json', 'w'))
def ev(t):
    import re
    for k, p in (('Davis Cup', 'davis'), ('United Cup', 'united'), ('ATP Cup', 'atp cup'), ('Olympics', 'olympi'), ('Laver Cup', 'laver'), ('Hopman', 'hopman'), ('Next Gen', 'next gen'), ('Asian Games', 'asian')):
        if p in (t or '').lower(): return k
    return 'other'
agg = collections.defaultdict(lambda: collections.Counter())
seen = set()
for x in T:
    ek = str(x['ek'])
    if ek in seen: continue
    seen.add(ek); b = R.get(ek, []); k = (ev(x['t']) if x['cat'] == 'team event' or ev(x['t']) != 'other' else ('qualifying?' if x.get('q1') else 'other-noTD'), x['date'][:4])
    agg[k]['matches'] += 1; agg[k]['Pncl'] += 'Pncl' in b; agg[k]['bet365'] += 'bet365' in b; agg[k]['any'] += bool(b)
for k in sorted(agg): print('ODDS', k, dict(agg[k]))
