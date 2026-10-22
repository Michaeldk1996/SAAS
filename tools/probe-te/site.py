# read-only: is Tennis Explorer's Pinnacle (book 8) on the live site, and one example row per level
import json, urllib.request, collections
SITE = 'https://michaeldk1996.github.io/SAAS'
get = lambda p: urllib.request.urlopen(SITE + '/' + p, timeout=180).read()
b = json.loads(get('build-info.json')); print('live code', b['commit'][:9], 'data built', b['data']['builtAt'])
x = json.loads(get('database-yield-x.json'))
print('x meta keys', list(x['meta'])[:30])
names = x.get('xNames') or []
for key in ('xRows', 'uRows'):
    rows = x.get(key) or []
    c = collections.Counter(r[8] for r in rows if isinstance(r, list) and len(r) > 8)
    print(key, len(rows), 'by book', dict(sorted(c.items())))
    ex = [r for r in rows if isinstance(r, list) and len(r) > 8 and r[8] == 8]
    for r in ex[:3]: print('  book-8 example', json.dumps(r)[:300])
    if ex:
        flags = collections.Counter(json.dumps(r[9:])[:40] for r in ex); print('  book-8 tail fields', flags.most_common(5))
        yrs = collections.Counter(str(r[0])[:4] for r in ex); print('  book-8 by year', dict(sorted(yrs.items())))
print('names sample', json.dumps(names[:3])[:300] if isinstance(names, list) else type(names))
