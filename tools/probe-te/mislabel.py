# READ-ONLY (our site files): 2021-26 matches filed as ATP main draw with a WORD round (Quarter/Semi-finals/Final) that are
# really qualifying. Rule = h2h-core D1 / the price guard's ownQual: dated BEFORE the first certified main-draw round
# ("1/N-finals") either player played at that event (same tournament, -16..+5 days), or neither player has such a round
# there; round-robin events and team events excluded. Deduped by event key.
import json, re, urllib.request, collections, concurrent.futures as cf
SITE = 'https://michaeldk1996.github.io/SAAS'
get = lambda p: json.loads(urllib.request.urlopen(SITE + '/' + p, timeout=120).read())
keys = list(get('career-history-index.json').get('players', {}))
def shard(k):
    try: return k, get(f'career-history/{k}.json').get('matches', [])
    except Exception: return k, None
H = {}; failed = 0
with cf.ThreadPoolExecutor(8) as ex:
    for k, m in ex.map(shard, keys):
        if m is None: failed += 1
        else: H[str(k)] = m
WORD = re.compile(r'^(quarter|semi|final)', re.I); FRAC = re.compile(r'^1/[0-9]+-finals$', re.I)
TEAM = re.compile(r'davis|united cup|atp cup|laver|hopman|olympi|next ?gen|finals', re.I)
from datetime import date
dn = lambda s: date.fromisoformat(str(s)[:10]).toordinal()
def at(rows, x):
    d0 = dn(x['date']); return [r for r in rows if r.get('tournament') == x.get('tournament') and -16 <= dn(r['date']) - d0 <= 5]
seen = {}; c = collections.Counter(); ex_ = collections.defaultdict(list); flagged = collections.Counter()
for k, rows in H.items():
    for x in rows:
        d = str(x.get('date') or '')
        if not ('2021' <= d[:4] <= '2026') or x.get('level') != 'atp' or x.get('walkover'): continue
        if not WORD.match(str(x.get('round') or '')) or TEAM.search(str(x.get('tournament') or '')): continue
        if x.get('qualifying') or x.get('_qual') or re.search('qualif', str(x.get('tournament') or ''), re.I): continue
        ek = str(x.get('eventKey') or '') or f"{k}|{d}|{x.get('opponent')}"
        if ek in seen: continue
        mine = at(rows, x); opp = H.get(str(x.get('oppKey'))) if x.get('oppKey') is not None else None
        both = mine + (at(opp, x) if opp else [])
        if any(re.match(r'^(rr|round robin|)$', str(r.get('round') or '').strip(), re.I) for r in both): continue
        frac = [r for r in both if FRAC.match(str(r.get('round') or ''))]
        d0 = dn(d)
        if frac and any(dn(r['date']) <= d0 for r in frac):
            seen[ek] = 'main'; continue
        why = 'before first main-draw round' if frac else 'no main-draw round at the event'
        seen[ek] = why; c[(d[:4], why, 'opp shard' if opp else 'one side')] += 1
        if x.get('qualifying') is False: flagged[d[:4]] += 1
        if len(ex_[d[:4]]) < 3: ex_[d[:4]].append(f"{d} {x.get('tournament')} {x.get('round')} v {x.get('opponent')}")
print(f'shards {len(H)} of {len(keys)} (failed {failed}); word-round ATP rows 2021-26 checked {len(seen)}; read as main draw {sum(1 for v in seen.values() if v == "main")}')
for y in ('2021', '2022', '2023', '2024', '2025', '2026'):
    t = sum(v for k2, v in c.items() if k2[0] == y)
    print(y, 'qualifying filed as main draw:', t, {f'{k2[1]} ({k2[2]})': v for k2, v in c.items() if k2[0] == y}, '· carrying event_qualification=false:', flagged[y], '· e.g.', ex_[y])
