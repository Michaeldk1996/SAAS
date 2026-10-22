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
