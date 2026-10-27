# READ-ONLY: the ops repo's TE batch script (usage, join rules) and the shape of its existing target files
import json, os, re, urllib.request
H = {'Authorization': 'Bearer ' + os.environ['OPS_TOKEN'], 'Accept': 'application/vnd.github+json'}
def get(u, raw=False):
    h = dict(H, Accept='application/vnd.github.raw') if raw else H
    return urllib.request.urlopen(urllib.request.Request(u, headers=h), timeout=60).read()
R = 'https://api.github.com/repos/Michaeldk1996/stennisfy-ops'
tree = json.loads(get(R + '/git/trees/HEAD?recursive=1'))['tree']
paths = [t['path'] for t in tree if t['type'] == 'blob' and re.search(r'te-odds|te_odds|te-target|te-links|page-link', t['path'])]
print('PATHS', len(paths)); [print('  ', p) for p in paths[:80]]
for p in paths:
    if p.endswith('te-odds-batch.mjs'):
        src = get(R + '/contents/' + p, True).decode()
        L = src.splitlines(); print('== SCRIPT', p, len(L), 'lines'); print('\n'.join(L[:70]))
        for i, l in enumerate(L):
            if re.search(r'argv|link|LINK|store|te-history|calib', l): print(f'  {i+1}: {l[:170]}')
for p in [p for p in paths if p.endswith('.json') and 'target' in p][:3]:
    d = json.loads(get(R + '/contents/' + p, True))
    rows = d.get('targets') if isinstance(d, dict) else d
    print('== TARGETS', p, 'top keys', list(d)[:12] if isinstance(d, dict) else 'list', 'n', len(rows or []))
    print('   first', json.dumps((rows or [None])[0])[:500])
    if isinstance(d, dict): print('   meta', json.dumps({k: v for k, v in d.items() if k != 'targets'})[:500])
