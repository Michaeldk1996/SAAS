set -uo pipefail
SITE=https://michaeldk1996.github.io/SAAS
python3 tools/probe-te/mislabel.py | tail -2
curl -sS -m 120 "$SITE/database-yield-x.json" -o x.json; curl -sS -m 60 "$SITE/player-index.json" -o pi.json
python3 - <<'PY' > pick.txt
import json, unicodedata
x = json.load(open('x.json')); pi = json.load(open('pi.json')); rows = pi.get('players', pi)
norm = lambda s: unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode().lower()
idx = {}
for v in (rows.values() if isinstance(rows, dict) else rows):
    if isinstance(v, dict) and v.get('hasProfile'): p = norm(v['name']).split(); idx.setdefault((p[-1], p[0][0]), []).append(v)
out = []
for r, nm in zip(x['xRows'], x['xNames']):
    if r[8] != 8 or not str(r[0]).startswith('2024') or r[1] != 'Challenger Qualifying' or 'l' not in ''.join(r[9:]): continue
    w, l = nm; ws = norm(w).replace('.', '').split(); ls = norm(l).replace('.', '').split()
    c = idx.get((ws[0], ws[-1][0])) if len(ws) > 1 else None
    if c and len(c) == 1: d = str(r[0]); out.append((c[0]['key'], f'{d[:4]}-{d[4:6]}', ls[0].capitalize(), w, l, r[4], r[5], r[6], d))
print(len(out)); [print('|'.join(map(str, o))) for o in out[:5]]
PY
cat pick.txt
tail -n +2 pick.txt | head -5 | while IFS='|' read -r KEY MON OPP REST; do
  curl -sfS -m 30 "$SITE/career-history/$KEY.json" -o /dev/null || { echo "no shard $KEY"; continue; }
  CHROME_BIN=google-chrome timeout 900 node tools/price-consistency.mjs --base "$SITE" --only "$KEY" --pick "$KEY|$MON|$OPP" > pc.log 2>&1; echo "exit $? key $KEY"
  grep -E '^SHOW' pc.log | head -2; grep -q '^SHOW' pc.log && break
done
