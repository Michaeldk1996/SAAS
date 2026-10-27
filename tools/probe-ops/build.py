# Builds the TE target lists approved by the founder (2026-10-27): (1) nf = the 446 word-round qualifying matches (h2h-core
# rule) + the never-targeted lower-level matches, 2021-01-01..2026-09-16, unpriced or priced only below TE, both players
# keyed (the import checks the api-tennis fixture names the same two keys); the not-found group is OUT (same name join).
# (2) pre-sample = report only: 10 consecutive days in 2012 / 2016 / 2019 — our records' lower-level matches (career-record,
# TE match ids) + ATP main-draw matches with a Tennis-Data Pinnacle close (accuracy) — levels outside TE_LEVELS, so the
# import refuses every row (nothing stored). Writes te-targets/nf.json, te-targets/pre-sample.json + batches.json entries.
import json, os, sys, csv, urllib.request, collections, datetime as dt
SITE = 'https://michaeldk1996.github.io/SAAS'
OPS = sys.argv[1]
get = lambda p: json.loads(urllib.request.urlopen(SITE + '/' + p, timeout=120).read())
H = {'Authorization': 'Bearer ' + os.environ['STORE_TOKEN'], 'Accept': 'application/vnd.github.raw'}
R = 'https://api.github.com/repos/Michaeldk1996/stennisfy-te-store/contents/te-odds'
inb = set()
for b in json.loads(urllib.request.urlopen(urllib.request.Request(R, headers=dict(H, Accept='application/vnd.github+json')), timeout=60).read()):
    for r in json.loads(urllib.request.urlopen(urllib.request.Request(R + '/' + b['name'], headers=H), timeout=120).read())['rows']: inb.add(str(r.get('ek')))
mis = set(json.load(open('mis446.json'))); dump = json.load(open('cov.json')).get('dump') or []
LV = {'ATP qualifying': 'atp-q', 'Challenger main draw': 'ch', 'Challenger qualifying': 'ch-q'}
above = lambda s: s.startswith('P:') or s.startswith('A:')
best, why = {}, collections.Counter()
for k, d, lv, ek, ok, src, rd, tn, opp, nm in dump:
    if not ek or src == 'wo' or not ('2021-01-01' <= str(d)[:10] <= '2026-09-16'): continue
    lvl = 'atp-q' if str(ek) in mis else LV.get(lv)
    if lvl: best.setdefault(str(ek), (lvl, src, str(k), ok, str(d)[:10], tn, rd, nm, opp))
rows = []
for ek, (lvl, src, k, ok, d, tn, rd, nm, opp) in best.items():
    if above(src): why['priced at or above TE'] += 1; continue
    if ek in inb: why['already a TE target (not found / joined / ambiguous)'] += 1; continue
    if ok is None: why['no opponent key (the import needs both)'] += 1; continue
    g = '446' if ek in mis else 'never targeted'; why['target: ' + g] += 1
    rows.append({'ek': ek, 'level': lvl, 'date': d, 'tournament': tn, 'round': rd, 'a': nm, 'b': opp, 'ka': k, 'kb': str(ok), 'group': g})
rows.sort(key=lambda r: (r['date'], r['ek']))
print('NF', dict(why)); c = collections.Counter((r['group'], r['level'], r['date'][:4]) for r in rows)
for g in ('446', 'never targeted'): print('NF', g, sum(v for k2, v in c.items() if k2[0] == g), sorted([(k2[1], k2[2], v) for k2, v in c.items() if k2[0] == g]))
# split at the 2,700-target cap, by date
nf_batches, cur = [], []
for r in rows:
    cur.append(r)
    if len(cur) >= 2700: nf_batches.append(cur); cur = []
if cur: nf_batches.append(cur)
# ---- pre-sample ----
names = {str(p.get('key')): p.get('name') for p in (get('player-index.json').get('players') or []) if isinstance(p, dict)}
ix = get('career-record-index.json').get('players', {})
low = {}
our = lambda te: (lambda t: f"{t.pop()} {' '.join(t)}" if len(t) > 1 and t[-1].endswith('.') else ' '.join(t))(str(te or '').split())
for k in ix:
    try: d = get(f'career-record/{k}.json')
    except Exception: continue
    for r in ((d.get('record') or {}).get('add') or []):
        y = str(r.get('year')); c0 = str(r.get('teCat') or '')
        if y not in ('2012', '2016', '2019') or not r.get('teMatchId') or not r.get('date'): continue
        q = 'qual' in c0 or str(r.get('round') or '').lower().startswith('q-')
        lv = 'pre-ch-q' if c0.startswith('Challenger') and q else 'pre-ch' if c0.startswith('Challenger') else 'pre-atp-q' if c0.startswith('ATP') and q else None
        if not lv: continue
        low.setdefault('te:' + str(r['teMatchId']), {'ek': 'te:' + str(r['teMatchId']), 'level': lv, 'date': r['date'][:10], 'tournament': r.get('tournament'),
                       'round': r.get('round'), 'a': names.get(k) or k, 'b': r.get('opponent'), 'ka': k, 'kb': None})
td = []
for y in ('2012', '2016', '2019'):
    for r in csv.DictReader(open(f'odds-archive/{y}.csv')):
        try: pw, pl = float(r['psw']), float(r['psl'])
        except Exception: continue
        if (r.get('comment') or '') != 'Completed' or pw < 1.01 or pl < 1.01: continue
        td.append({'ek': f"td:{r['date']}|{r['winner']}|{r['loser']}", 'level': 'pre-atp', 'date': r['date'], 'tournament': r['tournament'], 'round': r['round'],
                   'a': r['winner'], 'b': r['loser'], 'ka': None, 'kb': None, 'close': {'p1': pw, 'p2': pl, 'label': 'Tennis-Data Pinnacle close'}})
pre_batches = []
for y in ('2012', '2016', '2019'):
    allr = [r for r in list(low.values()) + td if r['date'][:4] == y]
    days = sorted({r['date'] for r in allr}); per = collections.Counter(r['date'] for r in allr)
    bestw = max(days, key=lambda d0: sum(per[(dt.date.fromisoformat(d0) + dt.timedelta(i)).isoformat()] for i in range(10)))
    to = (dt.date.fromisoformat(bestw) + dt.timedelta(9)).isoformat()
    sel = [r for r in allr if bestw <= r['date'] <= to]
    cl = collections.Counter(r['level'] for r in sel)
    print(f'PRE {y}: {bestw} → {to} · targets {len(sel)} {dict(cl)} · list pages 12 · max requests {len(sel) + 12}')
    pre_batches.append((y, bestw, to, sel))
if '--dry' in sys.argv: sys.exit(0)
T = os.path.join(OPS, 'te-targets'); B = json.load(open(os.path.join(T, 'batches.json')))
have = {b['id'] for b in B['batches']}
allnf = [r for b in nf_batches for r in b]
json.dump({'rule': 'TE odds batch targets: nf — the 446 word-round qualifying (h2h-core rule) + never-targeted lower-level matches, unpriced or below TE, both keyed (founder 2026-10-27; the not-found group is out: same name join)',
           'window': ['2021-01-01', '2026-09-16'], 'rows': allnf}, open(os.path.join(T, 'nf.json'), 'w'), indent=0)
for i, b in enumerate(nf_batches, 1):
    bid = f'nf-{i:02d}'
    if bid in have: continue
    est = len(b) + 0   # list days: already in the Mac's page cache from the 2021-26 batches (a cached page is never fetched again)
    B['batches'].append({'id': bid, 'file': 'nf.json', 'from': b[0]['date'], 'to': b[-1]['date'], 'targets': len(b), 'estRequests': est})
allpre = [r for (_, _, _, sel) in pre_batches for r in sel]
json.dump({'rule': 'REPORT ONLY (founder 2026-10-27): pre-2021 sample, 10 days each in 2012 / 2016 / 2019; levels pre-* are outside TE_LEVELS, so te-import stores none of these rows; pre-atp rows carry the Tennis-Data Pinnacle close for the accuracy check',
           'window': [pre_batches[0][1], pre_batches[-1][2]], 'rows': allpre}, open(os.path.join(T, 'pre-sample.json'), 'w'), indent=0)
for y, f0, t0, sel in pre_batches:
    bid = f'pre-{y}'
    if bid in have: continue
    B['batches'].append({'id': bid, 'file': 'pre-sample.json', 'from': f0, 'to': t0, 'targets': len(sel), 'estRequests': len(sel) + 12})
json.dump(B, open(os.path.join(T, 'batches.json'), 'w'), indent=2)
print('WROTE', [b['id'] for b in B['batches'] if b['id'] not in have], 'nf targets', len(allnf), 'pre targets', len(allpre))
