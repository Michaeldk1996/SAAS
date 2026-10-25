# READ-ONLY (our own site files, no TE request): pre-2021 ATP qualifying / Challenger / Challenger qualifying in our player
# records, 2010-2020 — played, priced by source, unpriced — and a TE request estimate (one results page per day + one match
# page per unpriced match) at ~340 requests/h.
import json, sys, re, urllib.request, collections, concurrent.futures as cf
SITE = sys.argv[1]
get = lambda p: json.loads(urllib.request.urlopen(SITE + '/' + p, timeout=120).read())
idx = get('career-history-index.json').get('players', {})
keys = list(idx)
def shard(k):
    try: return k, get(f'career-history/{k}.json').get('matches', [])
    except Exception as e: return k, None
WORD = re.compile(r'^(quarter|semi|final)', re.I); FRAC = re.compile(r'^1/[0-9]+-finals$', re.I)
def lvl(x, rows):
    q = x.get('qualifying') or x.get('_qual') or re.search('qualif', f"{x.get('round') or ''} {x.get('tournament') or ''}", re.I)
    if x.get('level') == 'atp':
        if q: return 'ATP qualifying'
        return 'ATP main draw'
    if re.search(r'^(M|W)\d{2,3}\b|\bITF\b', str(x.get('tournament') or '')): return 'ITF'
    return 'Challenger qualifying' if q else 'Challenger main draw'
seen = {}; failed = 0; levels_seen = collections.Counter()
with cf.ThreadPoolExecutor(8) as ex:
    for k, rows in ex.map(shard, keys):
        if rows is None: failed += 1; continue
        for x in rows:
            d = str(x.get('date') or '')
            if not ('2010' <= d[:4] <= '2020') or x.get('walkover'): continue
            lv = lvl(x, rows); levels_seen[lv] += 1
            if lv not in ('ATP qualifying', 'Challenger main draw', 'Challenger qualifying'): continue
            other = str(x.get('oppKey')) if x.get('oppKey') is not None else 'n:' + str(x.get('opponent') or '').lower()
            mk = (d[:10], tuple(sorted([str(k), other])) if x.get('oppKey') is not None else (str(k), other))
            seen.setdefault(mk, (lv, d[:10], x.get('tournament')))
print(f'shards read {len(keys) - failed} of {len(keys)} (failed {failed}); player-rows 2010-20 by level {dict(levels_seen)}')
cov = {}
try: cov = get('price-coverage.json').get('byLevel', {})
except Exception as e: print('price-coverage.json unreadable', e)
by = collections.defaultdict(lambda: {'m': 0, 'days': set()})
for (d, _), (lv, day, t) in seen.items(): b = by[(lv, d[:4])]; b['m'] += 1; b['days'].add(day)
print('level | year | matches (deduped) | days | priced player-rows (coverage file) by source | unpriced player-rows | est. requests')
tot = collections.Counter()
for lv in ('ATP qualifying', 'Challenger main draw', 'Challenger qualifying'):
    for y in range(2010, 2021):
        b = by.get((lv, str(y)), {'m': 0, 'days': set()}); c = (cov.get(lv) or {}).get(str(y)) or {}
        req = b['m'] + len(b['days'])   # upper bound: every match unpriced
        tot[y] += req
        print(f"{lv} | {y} | {b['m']} | {len(b['days'])} | {c.get('priced', '—')} of {c.get('n', '—')} {c.get('byBook', {})} | {(c.get('n') or 0) - (c.get('priced') or 0) - (c.get('walkover') or 0) if c else '—'} | {req}")
for cut in (2018, 2015, 2010):
    r = sum(v for y, v in tot.items() if y >= cut); print(f'cut-off {cut}: ~{r} requests = {r / 340:.0f} h = {r / 340 / 24:.1f} days at 340/h')
