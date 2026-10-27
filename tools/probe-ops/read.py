# READ-ONLY: the fields te-odds-batch.mjs reads from a target, the calibration target shape, batches.json in full
import json, os, re, urllib.request
H = {'Authorization': 'Bearer ' + os.environ['OPS_TOKEN'], 'Accept': 'application/vnd.github.raw'}
get = lambda p: urllib.request.urlopen(urllib.request.Request('https://api.github.com/repos/Michaeldk1996/stennisfy-ops/contents/' + p, headers=H), timeout=60).read()
src = get('tools/te-odds-batch.mjs').decode().splitlines()
for i, l in enumerate(src):
    if re.search(r'\bt\.(\w+)|target\.(\w+)|\.rows\b|b\.file|b\.from|b\.to|window|close|calib|level', l) and i > 70: print(f'{i+1}: {l[:190]}')
print('== batches.json'); print(json.dumps(json.loads(get('te-targets/batches.json')), indent=0)[:3000])
c = json.loads(get('te-targets/calibration.json')); print('== calibration.json keys', [k for k in c if k != 'rows'], {k: c[k] for k in c if k != 'rows'}); print('   first', json.dumps(c['rows'][0])[:600])
for f in ('ch.json', 'ch-q.json'):
    d = json.loads(get('te-targets/' + f)); print('==', f, {k: d[k] for k in d if k != 'rows'}, 'n', len(d['rows']), 'first', json.dumps(d['rows'][0])[:300])
