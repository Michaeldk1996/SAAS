# probe r38: lower levels in 2026 — fixtures, api-tennis odds, held Oddspapi payloads (read only)
import sys, os, json, collections, datetime as dt
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import importlib.util
s = importlib.util.spec_from_file_location('td', os.path.join(os.path.dirname(__file__), '..', 'tdarch.py')); T = importlib.util.module_from_spec(s); s.loader.exec_module(T)
P = T.P
def lvl(f):
    t = f.get('event_type_type'); q = str(f.get('event_qualification')) == 'True' or 'qualif' in str(f.get('tournament_name') or '').lower() or 'qualif' in str(f.get('tournament_round') or '').lower()
    if t == 'Atp Singles': return 'ATP Q' if q else 'ATP MD'
    if t == 'Challenger Men Singles': return 'CH Q' if q else 'CH MD'
    if t == 'Itf Men Singles': return 'ITF'
    return None
days = ['2026-01-15', '2026-02-18', '2026-03-17', '2026-04-22', '2026-05-20', '2026-06-17', '2026-07-15', '2026-08-19', '2026-09-09', '2026-10-07']
out = {}
for d in days:
    fx = T._at({'method': 'get_fixtures', 'date_start': d, 'date_stop': d, 'timezone': 'UTC'}).get('result') or []
    fin = [f for f in fx if lvl(f) and f.get('event_status') in ('Finished', 'Retired')]
    try:
        od = T._at({'method': 'get_odds', 'date_start': d, 'date_stop': d}).get('result') or {}
    except Exception as e:
        od = {}; print('get_odds by date failed', d, e)
    c = collections.Counter(); 
    for f in fin:
        L = lvl(f); c[(L, 'n')] += 1
        ha = (od.get(str(f['event_key'])) or {}).get('Home/Away') or {}
        h, a = ha.get('Home') or {}, ha.get('Away') or {}
        if T.price(h.get('Pncl')) and T.price(a.get('Pncl')): c[(L, 'pncl')] += 1
        if T.price(h.get('bet365')) and T.price(a.get('bet365')): c[(L, 'b365')] += 1
        if ha: c[(L, 'anyodds')] += 1
    out[d] = {f'{k[0]}|{k[1]}': v for k, v in sorted(c.items())}
    print(d, 'oddsKeys', len(od), json.dumps(out[d]), flush=True)
# a per-match get_odds check on 3 Challenger fixtures of 15 Jan (in case the by-date call lacks old days)
fx = [f for f in (T._at({'method': 'get_fixtures', 'date_start': '2026-01-15', 'date_stop': '2026-01-15', 'timezone': 'UTC'}).get('result') or []) if lvl(f) in ('CH MD', 'ITF')][:4]
for f in fx:
    o = (T._at({'method': 'get_odds', 'match_key': f['event_key']}).get('result') or {}).get(str(f['event_key'])) or {}
    print('per-match', lvl(f), f['event_key'], sorted((o.get('Home/Away') or {}).get('Home', {}).keys()))
# held Oddspapi payloads by category
cat = collections.Counter()
for r in P.select_all(P.RAW, 'id,fixture_id,books,meta'):
    m = r.get('meta') or {}
    cat[(m.get('category') or m.get('trigger') or '?', 'pin' if 'pinnacle+30' in (r.get('books') or []) else 'other')] += 1
print('raw payloads by category/book', json.dumps({f'{a}|{b}': v for (a, b), v in sorted(cat.items())}))
