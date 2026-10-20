# read-only: step timings of the data pipeline's recent runs, and where the "Run pipeline" step spends its time
import json, os, re, urllib.request, urllib.error, datetime as dt, collections
R = 'https://api.github.com/repos/Michaeldk1996/SAAS'
H = {'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json'}
class NoRedir(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
def getlog(u):
    try: urllib.request.build_opener(NoRedir).open(urllib.request.Request(u, headers=H), timeout=60); raise RuntimeError('no redirect')
    except urllib.error.HTTPError as e:
        loc = e.headers.get('Location')
        if not loc: raise
    with urllib.request.urlopen(loc, timeout=180) as r: return r.read().decode('utf8', 'replace')
def get(u, raw=False):
    with urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=120) as r:
        b = r.read(); return b.decode('utf8', 'replace') if raw else json.loads(b)
T = lambda s: dt.datetime.fromisoformat(s.replace('Z', '+00:00')) if s else None
runs = []
for page in (1, 2, 3):
    runs += get(f'{R}/actions/workflows/pipeline.yml/runs?per_page=100&page={page}&status=completed')['workflow_runs']
print('runs read', len(runs), collections.Counter(r['conclusion'] for r in runs))
jobs_all = []
for r in runs:
    js = get(f"{R}/actions/runs/{r['id']}/jobs")['jobs']
    for j in js:
        if j['name'] != 'build-and-deploy' or not j.get('started_at') or not j.get('completed_at'): continue
        st = {s['name'][:28]: (T(s['completed_at']) - T(s['started_at'])).total_seconds() for s in j['steps'] if s.get('started_at') and s.get('completed_at')}
        jobs_all.append((r, j, st))
print('\nexecuted jobs (newest first): start · job min · conclusion · Run pipeline min · price check min · queue min')
for r, j, st in jobs_all:
    q = (T(j['started_at']) - T(r['created_at'])).total_seconds() / 60
    jm = (T(j['completed_at']) - T(j['started_at'])).total_seconds() / 60
    rp = st.get('Run pipeline (with retry + h', 0) / 60; pc = st.get('One price per match on every', 0) / 60
    print(f"{j['started_at'][5:16]} {jm:5.1f} {r['conclusion'][:9]:9} {rp:5.1f} {pc:4.1f} q{q:4.1f}  run {r['run_number']}")
ok = [x for x in jobs_all if x[0]['conclusion'] == 'success']
print('\nsteps over 30 s, median over successful jobs (n=%d):' % len(ok))
agg = collections.defaultdict(list)
for _, _, st in ok:
    for k, v in st.items(): agg[k].append(v)
for k, v in sorted(agg.items(), key=lambda kv: -sorted(kv[1])[len(kv[1]) // 2]):
    v = sorted(v); m = v[len(v) // 2]
    if m >= 30: print(f'  {k:28} median {m/60:5.1f} min · min {v[0]/60:4.1f} · max {v[-1]/60:4.1f}')
# per run since 19 Oct 20:00Z: the profile-build counts and the cache the run restored
print('\nper run: start · Run pipeline min · cache restored · shard roster built · opponents built/reused')
for r, j, st in [x for x in ok if x[1]['started_at'] >= '2026-10-19T20'][::-1]:
    try: log = getlog(f"{R}/actions/jobs/{j['id']}/logs")
    except Exception as e: print('log', j['id'], e); continue
    key = re.search(r'Cache restored from key: (\S+)', log); hit = re.search(r'Cache hit for: (\S+)', log)
    sr = re.search(r'Shard roster: pool \d+ \[built (\d+)', log); op = re.search(r'opponents \[built (\d+), reused (\d+)', log)
    ttl = re.findall(r'[^\n]*(?:stale|TTL|expired|older than)[^\n]*profile[^\n]*|[^\n]*profile[^\n]*(?:stale|TTL|expired)[^\n]*', log)
    print(f"{j['started_at'][5:16]} {st.get('Run pipeline (with retry + h',0)/60:5.1f}  {(key or hit).group(1) if (key or hit) else '-':34} {sr.group(1) if sr else '-':>3}  {op.group(1)+'/'+op.group(2) if op else '-'}")
    for t in ttl[:3]: print('     ', re.sub(r'^\S+Z ', '', t)[:200])
