# read-only: the TE batch plan (stennisfy-ops te-targets/batches.json) and which batch files the private store holds
import json, os, urllib.request, base64, collections
def get(url, tok):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': 'Bearer ' + tok, 'Accept': 'application/vnd.github+json'}), timeout=60) as r: return json.loads(r.read())
def content(repo, path, tok):
    j = get(f'https://api.github.com/repos/{repo}/contents/{path}', tok)
    if j.get('content'): return base64.b64decode(j['content'])
    with urllib.request.urlopen(urllib.request.Request(j['download_url'], headers={'Authorization': 'Bearer ' + tok}), timeout=120) as r: return r.read()
plan = json.loads(content('Michaeldk1996/stennisfy-ops', 'te-targets/batches.json', os.environ['OPS_TOKEN']))
print('plan keys', list(plan.keys())); bs = plan['batches']
print('batches', len(bs)); print('first', json.dumps(bs[0])[:400])
tot = collections.Counter(); tl = collections.Counter()
for b in bs:
    n = b.get('rows') or b.get('n') or b.get('targets')
    print(f"  {b.get('id'):24} {str(b.get('level')):8} {str(b.get('from')):10} → {str(b.get('to')):10} n={n} file={b.get('file')}")
    if isinstance(n, int): tot[b.get('level')] += n; tl[(b.get('level'), str(b.get('from'))[:4])] += n
print('targets per level', dict(tot)); print('per level-year', dict(sorted(tl.items())))
try:
    ls = get('https://api.github.com/repos/Michaeldk1996/stennisfy-te-store/contents/te-odds', os.environ['STORE_TOKEN'])
    print('\nstore te-odds/:', [(x['name'], x['size']) for x in ls])
except Exception as e: print('store list', e)
