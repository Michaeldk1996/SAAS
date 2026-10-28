# READ-ONLY: final TE backfill table (2021-26), Bergs, nf-01 statuses, and the pre-2021 sample report. Writes nothing anywhere.
import json, os, sys, urllib.request, urllib.parse, collections, statistics
H = {'Authorization': 'Bearer ' + os.environ['STORE_TOKEN'], 'Accept': 'application/vnd.github.raw'}
R = 'https://api.github.com/repos/Michaeldk1996/stennisfy-te-store/contents/te-odds'
OH = {'Authorization': 'Bearer ' + os.environ['OPS_TOKEN'], 'Accept': 'application/vnd.github.raw'}
OPS = 'https://api.github.com/repos/Michaeldk1996/stennisfy-ops/contents/te-targets/'
get = lambda u, h: json.loads(urllib.request.urlopen(urllib.request.Request(u, headers=h), timeout=180).read())
names = [b['name'] for b in get(R, dict(H, Accept='application/vnd.github+json'))]
docs = {n[:-5]: get(R + '/' + n, H) for n in names if n.endswith('.json')}
print('batches', sorted(docs))
inb = collections.defaultdict(list)
for n, d in docs.items():
    if n.startswith('pre-'): continue
    for r in d['rows']: inb[str(r.get('ek'))].append((n, r.get('status'), bool(r.get('pin'))))
nf = docs.get('nf-01')
if nf:
    c = collections.Counter(r.get('status') for r in nf['rows'])
    print('NF01 targets', len(nf['rows']), dict(c), 'joined with Pinnacle', sum(1 for r in nf['rows'] if r.get('status') == 'joined' and r.get('pin')),
          'by level', dict(collections.Counter((r.get('level'), r.get('status')) for r in nf['rows'])))
# snapshot table (read-only GET): which events hold an api-tennis Bet365 or a TE row
SU, SK = os.environ['SUPABASE_URL'].rstrip('/'), os.environ['SUPABASE_SECRET_KEY']
snap = collections.defaultdict(set); off = 0
while True:
    q = SU + '/rest/v1/historical_snapshot?select=event_key,source&source=in.(' + urllib.parse.quote('"api-tennis Bet365","Tennis Explorer · Pinnacle"') + f')&order=id&offset={off}&limit=1000'
    got = get(q, {'apikey': SK, 'Authorization': 'Bearer ' + SK})
    for g in got: snap[str(g['event_key'])].add(g['source'])
    if len(got) < 1000: break
    off += 1000
print('snapshot events', len(snap), dict(collections.Counter(s for v in snap.values() for s in v)))
cov = json.load(open(sys.argv[1])); dump = cov.get('dump') or []; mis = set(json.load(open(sys.argv[2])))
print('dump rows', len(dump), 'built', cov.get('builtAt') or cov.get('generatedAt'))
LV = {'ATP qualifying': 'atp-q', 'Challenger main draw': 'ch', 'Challenger qualifying': 'ch-q'}
best = {}
for k, d, lv, ek, ok, src, rd, tn, opp, nm in dump:
    if not ek or not ('2021' <= str(d)[:4] <= '2026') or src == 'wo': continue
    lvl = 'atp-q' if str(ek) in mis else LV.get(lv)
    if lvl: best.setdefault(str(ek), (lvl, str(d)[:4], src, ok, str(d)[:10]))
T = collections.defaultdict(collections.Counter)
for ek, (lvl, y, src, ok, d) in best.items():
    t = T[(lvl, y)]; t['played'] += 1
    after = src != 'none'; t['after'] += after
    before = after and (src != 'A:te' or 'api-tennis Bet365' in snap.get(ek, set()))
    t['before'] += before
    if src == 'A:te': t['te'] += 1; t['te-new' if not before else 'te-over-b365'] += 1
    if not after:
        b = inb.get(ek, [])
        st = {s for _, s, _ in b}
        if any(s == 'joined' and p for _, s, p in b): why = 'TE price found but not used (moved after the start, or no start)'
        elif 'joined' in st: why = 'TE shows no Pinnacle price'
        elif 'not found' in st: why = 'TE: not found by the name join'
        elif st: why = 'TE: ' + '/'.join(sorted(map(str, st)))
        elif d > '2026-09-16': why = 'after 16 Sep (no TE target; live sources only)'
        elif not ok: why = 'no opponent key (not targetable)'
        else: why = 'not targeted'
        t['miss: ' + why] += 1
for (lvl, y), t in sorted(T.items()):
    print('ROW', lvl, y, json.dumps(dict(t)))
# Bergs (1064)
for lab, lo, hi in (('2021-24', '2021', '2024'), ('whole', '0000', '9999')):
    r = [x for x in dump if str(x[0]) == '1064' and lo <= str(x[1])[:4] <= hi and x[5] != 'wo']
    by = collections.Counter((x[2], x[5] != 'none') for x in r)
    print('BERGS', lab, 'priced', sum(1 for x in r if x[5] != 'none'), 'of', len(r), 'te', sum(1 for x in r if x[5] == 'A:te'), sorted(by.items()))
    if lab == '2021-24': print('BERGS-MISS', [(x[1][:10], x[2], x[7], x[6], x[8], inb.get(str(x[3]), [])) for x in r if x[5] == 'none'])
# pre-2021 sample (report only)
tg = {str(r['ek']): r for r in get(OPS + 'pre-sample.json', OH)['rows']}
nv = lambda a, b: (1 / a) / (1 / a + 1 / b)
for y in ('2012', '2016', '2019'):
    d = docs.get('pre-' + y)
    if not d: print('PRE', y, 'missing'); continue
    rows = d['rows']
    for lv in ('pre-atp', 'pre-atp-q', 'pre-ch', 'pre-ch-q'):
        rr = [r for r in rows if r.get('level') == lv]
        print('PRE', y, lv, 'targets', len(rr), dict(collections.Counter(r.get('status') for r in rr)), 'with Pinnacle', sum(1 for r in rr if r.get('status') == 'joined' and r.get('pin')))
    gaps = []
    for r in rows:
        if r.get('level') != 'pre-atp' or r.get('status') != 'joined' or not r.get('pin'): continue
        p, c = r['pin'], r.get('close') or tg.get(str(r['ek']), {}).get('close') or {}
        try: g = abs(nv(float(p['p1']), float(p['p2'])) - nv(float(c['p1']), float(c['p2']))) * 100
        except Exception: continue
        gaps.append(g)
    if gaps:
        gaps.sort(); n = len(gaps)
        print('ACC', y, 'n', n, 'median', round(statistics.median(gaps), 3), 'p90', round(gaps[min(n - 1, int(0.9 * n))], 3), 'over1pp', sum(g > 1 for g in gaps), 'exact', sum(g < 0.005 for g in gaps))
    if y == '2019':
        rd = collections.defaultdict(collections.Counter)
        for r in rows:
            if r.get('level') == 'pre-atp': continue
            t = tg.get(str(r['ek']), {})
            k = (r.get('level'), str(t.get('round') or r.get('round')))
            rd[k]['targets'] += 1; rd[k]['pin'] += r.get('status') == 'joined' and bool(r.get('pin')); rd[k][str(r.get('status'))] += 1
        for k in sorted(rd): print('PRE19RD', k, dict(rd[k]))
print('PRE sample row keys', sorted(docs['pre-2019']['rows'][0].keys()) if docs.get('pre-2019') else None)
