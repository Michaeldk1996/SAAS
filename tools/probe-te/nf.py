# READ-ONLY: the not-found + never-targeted + 446 list, from the per-match coverage dump and the store's batch files
import json, os, sys, urllib.request, collections
H = {'Authorization': 'Bearer ' + os.environ['STORE_TOKEN'], 'Accept': 'application/vnd.github.raw'}
R = 'https://api.github.com/repos/Michaeldk1996/stennisfy-te-store/contents/te-odds'
names = [b['name'] for b in json.loads(urllib.request.urlopen(urllib.request.Request(R, headers=dict(H, Accept='application/vnd.github+json')), timeout=60).read())]
inb = {}; st = collections.Counter()
for n in names:
    d = json.loads(urllib.request.urlopen(urllib.request.Request(R + '/' + n, headers=H), timeout=120).read())
    if n.startswith('ch-q'): print('BATCH', n, len(d['rows']), dict(collections.Counter(r.get('status') for r in d['rows'])), 'pin', sum(1 for r in d['rows'] if r.get('status') == 'joined' and r.get('pin')), json.dumps(d.get('summary'))[:200])
    for r in d['rows']:
        inb.setdefault(str(r.get('ek')), []).append((n, r.get('status'), bool(r.get('pin'))))
cov = json.load(open(sys.argv[1])); dump = cov.get('dump') or []
mis = set(json.load(open(sys.argv[2])))
print('batches', len(names), '· dump rows', len(dump), '· 446 keys', len(mis))
LV = {'ATP qualifying': 'atp-q', 'Challenger main draw': 'ch', 'Challenger qualifying': 'ch-q'}
above = lambda src: src.startswith('P:') or (src.startswith('A:') and src != 'A:te')   # a close, start-10 or api-tennis Pinnacle
best = {}
for k, d, lv, ek, ok, src, rd, tn, opp, nm in dump:
    if not ek or not ('2021' <= str(d)[:4] <= '2026') or src == 'wo': continue
    lvl = 'atp-q' if str(ek) in mis else LV.get(lv)
    if lvl: best.setdefault(str(ek), (lvl, str(d)[:4], src, k, ok, str(d)[:10], tn, rd, nm, opp))
groups = collections.Counter(); out = []; skipped = collections.Counter()
for ek, (lvl, y, src, k, ok, d, tn, rd, nm, opp) in best.items():
    if above(src) or src == 'A:te': skipped['priced at or above TE'] += 1; continue
    b = inb.get(ek)
    if b and any(s == 'joined' for _, s, _ in b): skipped['TE joined it (no Pinnacle there, or dropped by a rule)'] += 1; continue
    if ek in mis and not b: g = '446 word-round qualifying'
    elif not b: g = 'never targeted'
    elif any(s == 'not found' for _, s, _ in b): g = 'not found'
    else: g = 'other: ' + ','.join(sorted({str(s) for _, s, _ in b}))
    groups[(g, lvl, y)] += 1
    out.append({'ek': ek, 'level': lvl, 'date': d, 'group': g, 'key': k, 'oppKey': ok, 'player': nm, 'opponent': opp, 'tournament': tn, 'round': rd, 'priced': src})
print('SKIPPED', dict(skipped)); print('TARGETS', len(out), '· distinct days', len({o['date'] for o in out}))
for g in sorted({k[0] for k in groups}):
    print('GROUP', g, sum(v for k, v in groups.items() if k[0] == g), sorted([(k[1], k[2], v) for k, v in groups.items() if k[0] == g]))
print('446: in our rows', sum(1 for e in mis if e in best), '· in a batch', sum(1 for e in mis if inb.get(e)), '· targets now', sum(1 for o in out if o['ek'] in mis))
print('targets by current price', dict(collections.Counter(o['priced'] for o in out)))
json.dump(out, open('nf-targets.json', 'w'))
