# probe only: classify every unpriced ATP main-draw row against the Tennis-Data CSVs in the repo
import csv, json, sys, unicodedata, re, collections, datetime as dt
cov = json.load(open(sys.argv[1]))
dump = cov['dump']
print('threwEx', cov.get('threwEx'), 'q1 errors', [x['q1'] for x in dump if isinstance(x.get('q1'), str)][:3])
def nrm(s): return unicodedata.normalize('NFD', str(s or '').lower()).encode('ascii', 'ignore').decode().replace('-', ' ').replace("'", ' ')
def our_sur(n):  # "C. Alcaraz" -> ['alcaraz']; "J. M. Del Potro" -> ['del','potro']
    t = re.sub(r'^([a-z]{1,3}\.\s*)+', '', nrm(n)).strip().split()
    return t
def td_sur(n):   # "Del Potro J.M." -> ['del','potro']
    t = nrm(n).strip().split()
    while t and re.fullmatch(r'([a-z]{1,3}\.)+', t[-1]): t.pop()
    return t
TD = collections.defaultdict(list)
for y in range(2004, 2027):
    for r in csv.DictReader(open(f'../../odds-archive/{y}.csv')):
        d = dt.date.fromisoformat(r['date'])
        for side, nm in (('w', r['winner']), ('l', r['loser'])):
            for tok in td_sur(nm): TD[tok].append((d, side, r))
def fl(v):
    try: f = float(v); return f if 1.01 <= f <= 1000 else None
    except: return None
def priced(r):
    for a, b in (('psw', 'psl'), ('b365w', 'b365l')):
        pw, pl = fl(r[a]), fl(r[b])
        if pw and pl: return (a[:-1], pw, pl, 1/pw + 1/pl)
    return None
TEAM = re.compile(r'davis|united cup|atp cup|olympi|hopman|laver', re.I)
def overlap(a, b): return bool(set(a) & set(b)) and (a[-1] in b or b[-1] in a or a[0] in b)
def td_match(x):
    me, op = our_sur(x['name']), our_sur(x['opp'])
    if not me or not op: return []
    d0 = dt.date.fromisoformat(x['date'][:10]); out = []
    for d, side, r in TD.get(me[-1], []) + (TD.get(me[0], []) if me[0] != me[-1] else []):
        dd = (d - d0).days
        if dd < -4 or dd > 17: continue
        mine, theirs = (r['winner'], r['loser']) if x['won'] else (r['loser'], r['winner'])
        if overlap(me, td_sur(mine)) and overlap(op, td_sur(theirs)) and r not in out: out.append(r)
    return out
res = []; C = collections.Counter(); byY = collections.defaultdict(collections.Counter)
for x in dump:
    y = x['date'][:4]
    if x['why'] != 'none': cat = 'other: ' + x['why']
    elif TEAM.search(x['t'] or ''): cat = 'team event'
    else:
        m = td_match(x)
        if not m: cat = 'no Tennis-Data row' + (' (qualifying by its own rows)' if x.get('q1') else '')
        else:
            p = [priced(r) for r in m]
            if not any(p): cat = 'Tennis-Data row, no price'
            elif all(q and q[3] > 1.15 for q in p if q): cat = 'Tennis-Data priced, overround > 1.15 (Database void)'
            elif any(r['comment'] not in ('Completed', 'Retired') for r in m): cat = 'Tennis-Data priced, comment ' + '/'.join(sorted({r['comment'] for r in m}))
            else: cat = 'JOIN MISS'
            x['td'] = [{k: r[k] for k in ('date','tournament','round','winner','loser','comment','psw','psl','b365w','b365l')} for r in m]
    x['cat'] = cat; C[(x['lv'], cat)] += 1; byY[(x['lv'], y)][cat] += 1; res.append(x)
json.dump(res, open('classified.json', 'w'))
print('### totals (player-rows)'); [print(f'{v:6d}  {k[0]:16s} {k[1]}') for k, v in sorted(C.items(), key=lambda a: (a[0][0], -a[1]))]
for lv in ('ATP main draw',):
    print('### by year', lv)
    for y in range(2010, 2027):
        c = byY[(lv, str(y))]; print(y, dict(c))
jm = [x for x in res if x['cat'] == 'JOIN MISS']
print('### join-miss causes'); cc = collections.Counter(re.sub(r"\(.*", '', x['cause'] or '') for x in jm); print(cc.most_common())
for x in jm[:400]: print('JM', json.dumps({k: x.get(k) for k in ('k','name','date','opp','ok','t','r','won','cause','td')}, ensure_ascii=False))
nt = [x for x in res if x['cat'] == 'no Tennis-Data row' and x['lv'] == 'ATP main draw']
print('### no-TD by tournament'); print(collections.Counter(x['t'] for x in nt).most_common(60))
for x in nt[:0]: print('NT', json.dumps({k: x.get(k) for k in ('k','name','date','opp','t','r','won')}, ensure_ascii=False))

import re
def ev(t):
    for k, p in (('Davis Cup', 'davis'), ('United Cup', 'united'), ('ATP Cup', 'atp cup'), ('Olympics', 'olympi'), ('Laver Cup', 'laver'), ('Hopman', 'hopman'), ('Next Gen', 'next gen'), ('Asian Games', 'asian')):
        if p in (t or '').lower(): return k
    return 'other'
E = collections.Counter((ev(x['t']), x['date'][:4]) for x in res if x['lv'] == 'ATP main draw' and x['cat'].startswith(('team', 'no Tennis')) and ev(x['t']) != 'other')
print('### team/NextGen/Asian by event x year (player-rows)'); [print('EV', k, v) for k, v in sorted(E.items())]
for x in res:
    if x['lv'] == 'ATP main draw' and x['cat'] == 'no Tennis-Data row' and ev(x['t']) == 'other': print('NTX', json.dumps({k: x.get(k) for k in ('k','name','date','opp','t','r','won','ek')}, ensure_ascii=False))
