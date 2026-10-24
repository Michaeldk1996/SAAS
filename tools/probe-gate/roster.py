import json
m = json.load(open('matches.json')); ms = m if isinstance(m, list) else m.get('matches', [])
half = ms[: len(ms) // 2]
json.dump(half if isinstance(m, list) else dict(m, matches=half), open('matches.json', 'w'))
keys = {str(k) for x in half for k in (x.get('p1Key'), x.get('p2Key')) if k is not None}
p = json.load(open('player-profiles.json')); before = len(p.get('players', {}))
p['players'] = {k: v for k, v in p.get('players', {}).items() if k in keys}
json.dump(p, open('player-profiles.json', 'w'))
import os, shutil
for f in os.listdir('form'):
    if f.split('.')[0] not in keys: os.remove(os.path.join('form', f))
print(f"half board: {len(half)} of {len(ms)} matches, profiles {before} -> {len(p['players'])}, form shards {len(os.listdir('form'))}")
