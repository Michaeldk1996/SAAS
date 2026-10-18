# probe r39 (read only): can api-tennis price ATP qualifying / Challenger / ITF before 2026? And how close is its Pinnacle
# to a real close? Two days a month (the 10th and 24th) per year 2018-2025, get_fixtures + get_odds by date.
import sys, os, json, collections, csv, glob, statistics
import importlib.util
s = importlib.util.spec_from_file_location('td', os.path.join(os.path.dirname(__file__), '..', 'tdarch.py')); T = importlib.util.module_from_spec(s); s.loader.exec_module(T)
P = T.P
def lvl(f):
    l = P.lower_level(f)
    if l: return l
    return 'atp' if f.get('event_type_type') == 'Atp Singles' else None
# Tennis-Data Pinnacle closes, for the accuracy check
td = {}
for fn in glob.glob(os.path.join(os.path.dirname(__file__), '..', '..', 'odds-archive', '20*.csv')):
    for r in csv.DictReader(open(fn)):
        if T.price(r.get('psw')) and T.price(r.get('psl')):
            td.setdefault(r['date'], []).append(r)
out = {}
diffs = collections.defaultdict(list)
for y in range(2018, 2026):
    c = collections.Counter()
    for m in range(1, 13):
        for dd in (10, 24):
            d = f'{y}-{m:02d}-{dd:02d}'
            try:
                fx = T._at({'method': 'get_fixtures', 'date_start': d, 'date_stop': d, 'timezone': 'UTC'}).get('result') or []
                od = T._at({'method': 'get_odds', 'date_start': d, 'date_stop': d}).get('result') or {}
            except Exception as e:
                c['error'] += 1; continue
            if not isinstance(od, dict): od = {}
            for f in fx:
                L = lvl(f)
                if not L or f.get('event_status') not in ('Finished', 'Retired') or f.get('event_winner') not in ('First Player', 'Second Player'): continue
                c[(L, 'n')] += 1
                ha = (od.get(str(f['event_key'])) or {}).get('Home/Away') or {}
                h, a = ha.get('Home') or {}, ha.get('Away') or {}
                pn = T.price(h.get('Pncl')) and T.price(a.get('Pncl'))
                if pn: c[(L, 'pncl')] += 1
                if T.price(h.get('bet365')) and T.price(a.get('bet365')): c[(L, 'b365')] += 1
                if (pn or (T.price(h.get('bet365')) and T.price(a.get('bet365')))): c[(L, 'either')] += 1
                if L == 'atp' and pn:
                    for k in (d, ):
                        for r in td.get(k, []) + td.get(str(__import__('datetime').date.fromisoformat(d) - __import__('datetime').timedelta(days=1)), []):
                            fw = f['event_winner'] == 'First Player'
                            w, l = (f['event_first_player'], f['event_second_player']) if fw else (f['event_second_player'], f['event_first_player'])
                            if P.same_player(r['winner'], w, None) and P.same_player(r['loser'], l, None):
                                pw = float(h['Pncl']) if fw else float(a['Pncl'])
                                diffs[y].append(abs(1 / pw - 1 / float(r['psw'])) * 100)
    out[y] = {f'{k[0]}|{k[1]}' if isinstance(k, tuple) else k: v for k, v in sorted(c.items(), key=str)}
    dl = diffs[y]
    print(y, json.dumps(out[y]), '| api-tennis Pncl vs Tennis-Data Pinnacle close, winner implied %: n', len(dl),
          'median', round(statistics.median(dl), 2) if dl else None, 'p90', round(sorted(dl)[int(len(dl) * .9)], 2) if dl else None, flush=True)
