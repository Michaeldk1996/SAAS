# read-only: the private store's te-odds/ files and its latest commits (the queue pushes each completed batch there)
import json, os, urllib.request
H = {'Authorization': 'Bearer ' + os.environ['STORE_TOKEN'], 'Accept': 'application/vnd.github+json'}
get = lambda u: json.loads(urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=60).read())
R = 'https://api.github.com/repos/Michaeldk1996/stennisfy-te-store'
print('te-odds/:', [(x['name'], x['size']) for x in get(R + '/contents/te-odds')])
for c in get(R + '/commits?per_page=8'): print(c['commit']['committer']['date'], c['sha'][:9], c['commit']['message'].splitlines()[0][:110])
# check-in 2026-10-21T21:02:58Z
# check-in 2026-10-22T00:02:00Z
# check-in 2026-10-22T03:02:09Z
# check-in 2026-10-22T05:27:27Z
# check-in 2026-10-22T06:02:35Z
# check-in 2026-10-22T09:02:54Z
# check-in 2026-10-22T12:03:39Z
# check-in 2026-10-22T16:52:44Z
# check-in 2026-10-22T20:03:54Z
# check-in 2026-10-22T23:10:31Z
# check-in 2026-10-23T02:21:53Z
# check-in 2026-10-23T18:47:35Z
# per batch: rows by status, Pinnacle-bearing, request fields if the batch records any
import collections
HR = dict(H, Accept='application/vnd.github.raw')
for x in get(R + '/contents/te-odds'):
    d = json.loads(urllib.request.urlopen(urllib.request.Request(R + '/contents/te-odds/' + x['name'], headers=HR), timeout=120).read())
    rows = d.get('rows', [])
    st = collections.Counter(r.get('status') for r in rows)
    print('BATCH', x['name'], 'rows', len(rows), dict(st), 'with pin', sum(1 for r in rows if r.get('status') == 'joined' and r.get('pin')),
          'keys', [k for k in d if k != 'rows'], {k: d[k] for k in d if k not in ('rows',) and not isinstance(d[k], (list, dict))},
          'summary', json.dumps(d.get('summary') or d.get('stats') or {})[:400])
