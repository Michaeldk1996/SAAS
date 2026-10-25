# READ-ONLY (our site's career-record files, no TE request): pre-2021 ATP qualifying / Challenger / Challenger qualifying
# matches in our records (Tennis Explorer-sourced rows), deduped by TE match id; request estimate = one match page each.
import json, sys, re, urllib.request, collections, concurrent.futures as cf
SITE = sys.argv[1]
get = lambda p: json.loads(urllib.request.urlopen(SITE + '/' + p, timeout=120).read())
ix = get('career-record-index.json'); P = ix.get('players') or ix.get('index') or ix
keys = [k for k in P if k != 'meta'] if isinstance(P, dict) else []
print('career-record files listed', len(keys), 'index keys', list(ix)[:6])
def one(k):
    try: return k, get(f'career-record/{k}.json')
    except Exception: return k, None
cats = collections.Counter(); seen = {}; noid = collections.Counter(); failed = 0; sample = None
def lvl(r):
    c = str(r.get('teCat') or ''); q = re.search('qualif', c, re.I) or re.match(r'^q', str(r.get('round') or ''), re.I)
    if c.startswith('Challenger'): return 'Challenger qualifying' if q else 'Challenger main draw'
    if c.startswith('ITF'): return 'ITF'
    if c in ('ATP', 'Grand Slam', 'Masters', '') or c.startswith('ATP') or c.startswith('Grand'): return 'ATP qualifying' if q else 'ATP main draw'
    return 'other:' + c
with cf.ThreadPoolExecutor(8) as ex:
    for k, d in ex.map(one, keys):
        if d is None: failed += 1; continue
        for r in (d.get('add') or []):
            if sample is None: sample = r
            y = str(r.get('year') or str(r.get('date') or '')[:4])
            if not ('2010' <= y <= '2020'): continue
            lv = lvl(r); cats[(lv, str(r.get('teCat')), str(r.get('round'))[:3])] += 1
            mid = r.get('teMatchId')
            if not mid: noid[(lv, y)] += 1; mid = ('noid', k, r.get('date'), r.get('opponent'))
            seen.setdefault(mid, (lv, y, str(r.get('date') or '')[:10]))
print('failed files', failed, '· sample added row', json.dumps(sample)[:300])
print('top (level, teCat, round) 2010-20:', cats.most_common(25))
by = collections.defaultdict(lambda: [0, set()])
for mid, (lv, y, d) in seen.items(): by[(lv, y)][0] += 1; by[(lv, y)][1].add(d)
tot = collections.Counter()
print('level | year | matches (distinct TE match) | days | rows without a TE match id')
for lv in ('ATP qualifying', 'Challenger main draw', 'Challenger qualifying', 'ITF', 'ATP main draw'):
    for y in range(2010, 2021):
        m, ds = by.get((lv, str(y)), [0, set()])
        if lv != 'ATP main draw' and lv != 'ITF': tot[y] += m
        print(f'{lv} | {y} | {m} | {len(ds)} | {noid.get((lv, str(y)), 0)}')
for cut in (2018, 2015, 2010):
    r = sum(v for y, v in tot.items() if y >= cut); print(f'cut-off {cut}: {r} match pages = {r / 340:.0f} h = {r / 340 / 24:.1f} days at 340/h')
