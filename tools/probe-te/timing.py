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
# inside "Run pipeline": the log of the last 12 successful jobs, gaps between lines
print('\nRun pipeline step, inside: the biggest silent gaps and the count lines (last 12 successful jobs)')
pat = re.compile(r'(fixtures?|profiles?|players?|retry|retries|429|5\d\d |timeout|ETIMEDOUT|ECONNRESET|rebuil|budget|took|elapsed|\d+ ?ms\b|\d+(\.\d+)?s\b)', re.I)
pick = ok[:8] + [x for x in ok if x[0]['run_number'] in (8337, 8350, 8396, 8413, 8441, 8496)]
for r, j, st in pick:
    try: log = getlog(f"{R}/actions/jobs/{j['id']}/logs")
    except Exception as e: print('log', j['id'], e); continue
    lines = log.splitlines(); on = False; seg = []
    for ln in lines:
        if 'node run-pipeline.js github-actions' in ln and '##[group]Run' in ln: on = True; continue
        if on and '##[group]Run ' in ln: break
        if on: seg.append(ln)
    ts = []
    for ln in seg:
        m = re.match(r'(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+)Z (.*)', ln)
        if m: ts.append((dt.datetime.fromisoformat(m.group(1)), m.group(2)))
    if not ts: print('no lines', j['id']); continue
    gaps = sorted(((ts[i + 1][0] - ts[i][0]).total_seconds(), ts[i][1][:150], ts[i + 1][1][:150]) for i in range(len(ts) - 1))[::-1][:6]
    print(f"\n== run {r['run_number']} job {j['id']} · {len(ts)} lines · {(ts[-1][0]-ts[0][0]).total_seconds()/60:.1f} min")
    for g, a, b in gaps: print(f'  gap {g:6.0f}s after: {a}\n             before: {b}')
    cnt = [t[1][:170] for t in ts if pat.search(t[1])]
    for c in cnt[:60]: print('   |', c)
