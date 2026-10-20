# read-only probe (writes nothing): item 4 api-tennis Pinnacle per level-year; item 7 identity coverage of the 34 + the queue
import json, sys, os, glob, collections, urllib.parse
sys.path.insert(0, 'tools'); import tdarch as T
P = T.P
print('## item 4: current api-tennis Pinnacle snapshots per level and year (population: historical_snapshot, source api-tennis Pinnacle, not superseded)')
held = P.select_all(T.SNAP, 'id,match_date,event_key,supersedes,detail', '&source=eq.' + urllib.parse.quote(T.APPROX_SOURCE))
cur = T.current_snapshots([dict(h, source=T.APPROX_SOURCE, tournament='', winner='') for h in held])
cnt = collections.Counter(((h.get('detail') or {}).get('level') or 'ATP main draw', str(h['match_date'])[:4]) for h in cur)
print('   all rows', len(held), '· current', len(cur))
for lv in sorted({k[0] for k in cnt}):
    print(f'   {lv:14}', ' · '.join(f"{y} {cnt[(lv, y)]}{' (UNDER 30)' if cnt[(lv, y)] < 30 else ''}" for y in ('2021', '2022', '2023', '2024', '2025')))
print('## item 7: the TEN-449 store (te-history) by api-tennis key')
files = sorted(glob.glob('st/te-history/*.json'))
print('   files', len(files), '· names e.g.', [os.path.basename(f) for f in files[:3]])
one = json.load(open(files[0])) if files else {}
print('   top-level fields of one file:', list(one.keys())[:20])
def rec(k):
    f = f'st/te-history/{k}.json'
    if not os.path.exists(f): return None
    h = json.load(open(f)); return {x: h.get(x) for x in ('key', 'slug', 'teSlug', 'name', 'teName', 'dob', 'teDob', 'how', 'joinedBy', 'country') if x in h}
storekeys = {os.path.basename(f)[:-5] for f in files}
c = json.load(open('st/te-odds/calib-01.json'))
nf = [r for r in c['rows'] if r['status'] == 'not found']
res = 0; players = {}
for r in nf:
    sa, sb = str(r.get('ka')) in storekeys, str(r.get('kb')) in storekeys
    players.setdefault((r['a'], str(r.get('ka'))), sa); players.setdefault((r['b'], str(r.get('kb'))), sb)
    res += sa and sb
print(f'   of the {len(nf)} not-found calib-01 targets, both players in the store: {res}; at least one: {sum(1 for r in nf if str(r.get("ka")) in storekeys or str(r.get("kb")) in storekeys)}')
for (n, k), s in sorted(players.items()):
    print(f'   {n} (key {k}): ' + (json.dumps(rec(k)) if s else 'not in the store'))
print('## item 7: share of the full queue players (non-calib batches) in the store')
qk, qr = set(), 0
for f in glob.glob('ops/te-targets/*.json'):
    if 'batches' in f or 'calib' in os.path.basename(f): continue
    for t in json.load(open(f)).get('rows', []):
        qr += 1; qk.update({str(t.get('ka')), str(t.get('kb'))})
qk.discard('None')
ins = len(qk & storekeys)
both = 0
for f in glob.glob('ops/te-targets/*.json'):
    if 'batches' in f or 'calib' in os.path.basename(f): continue
    for t in json.load(open(f)).get('rows', []):
        both += str(t.get('ka')) in storekeys and str(t.get('kb')) in storekeys
print(f'   queue targets {qr}; distinct players {len(qk)}; in the store {ins} ({100 * ins / max(1, len(qk)):.1f}%), not in it {len(qk) - ins}; targets with BOTH players in the store {both} ({100 * both / max(1, qr):.1f}%)')
print('   target files:', sorted(os.path.basename(f) for f in glob.glob('ops/te-targets/*.json')))
