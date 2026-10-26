# READ-ONLY: Bergs (1064) ATP qualifying 2021 rows, and each one's fate in the TE batch files (store) — no TE request
import json, os, re, urllib.request, collections
SITE = 'https://michaeldk1996.github.io/SAAS'
H = {'Authorization': 'Bearer ' + os.environ['STORE_TOKEN'], 'Accept': 'application/vnd.github.raw'}
R = 'https://api.github.com/repos/Michaeldk1996/stennisfy-te-store/contents/te-odds/'
ch = json.loads(urllib.request.urlopen(SITE + '/career-history/1064.json', timeout=60).read())['matches']
q = lambda x: x.get('level') == 'atp' and (x.get('qualifying') or x.get('_qual') or re.search('qualif', f"{x.get('round') or ''} {x.get('tournament') or ''}", re.I))
rows = [x for x in ch if str(x.get('date', '')).startswith('2021') and q(x)]
W = re.compile(r'^(quarter|semi|final)', re.I)
rows += [x for x in ch if str(x.get('date', '')).startswith('2021') and x.get('level') == 'atp' and not q(x) and W.match(str(x.get('round') or ''))]
print('Bergs 2021 qualifying-candidate rows', len(rows))
docs = {}
for b in json.loads(urllib.request.urlopen(urllib.request.Request(R.rstrip('/'), headers=dict(H, Accept='application/vnd.github+json')), timeout=60).read()):
    docs[b['name']] = json.loads(urllib.request.urlopen(urllib.request.Request(R + b['name'], headers=H), timeout=120).read())
print('batch row keys', sorted(docs['atp-q-01.json']['rows'][0].keys()))
for x in rows:
    ek = str(x.get('eventKey') or '')
    hits = [(n, r) for n, d in docs.items() for r in d['rows'] if str(r.get('ek')) == ek]
    print('ROW', x.get('date'), x.get('tournament'), x.get('round'), 'v', x.get('opponent'), 'won' if x.get('won') else 'lost', 'ek', ek, 'walkover' if x.get('walkover') else '')
    if not hits: print('    not a target in any batch')
    for n, r in hits: print('    ', n, {k: r.get(k) for k in r if k not in ('ek',)})
# 2019 Challenger qualifying anomaly: TE category x round, 2017-2020, over the career-record files
ix = json.loads(urllib.request.urlopen(SITE + '/career-record-index.json', timeout=60).read()).get('players', {})
c = collections.Counter(); ev = collections.Counter()
for k in ix:
    try: d = json.loads(urllib.request.urlopen(f'{SITE}/career-record/{k}.json', timeout=60).read())
    except Exception: continue
    for r in ((d.get('record') or {}).get('add') or []):
        y = str(r.get('year'))
        if y in ('2017', '2018', '2019', '2020') and str(r.get('teCat', '')).startswith('Challenger'):
            c[(y, r.get('teCat'), str(r.get('round'))[:4])] += 1
            if y in ('2018', '2019') and r.get('teCat') == 'Challenger qual': ev[(y, r.get('tournament'))] += 1
for y in ('2017', '2018', '2019', '2020'): print('CH', y, sorted([(k[1], k[2], v) for k, v in c.items() if k[0] == y], key=lambda t: -t[2])[:14])
for y in ('2018', '2019'): print('CHQ events', y, len([1 for k in ev if k[0] == y]), sorted([(k[1], v) for k, v in ev.items() if k[0] == y], key=lambda t: -t[1])[:8])
