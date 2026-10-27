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
    if r[8] != 8 or not str(r[0]).startswith('2024') or r[1] != 'Challenger Qualifying': continue
    w, l = nm; ws = norm(w).replace('.', '').split(); ls = norm(l).replace('.', '').split()
    c = idx.get((ws[0], ws[-1][0])) if len(ws) > 1 else None
    if c and len(c) == 1: d = str(r[0]); out.append((c[0]['key'], f'{d[:4]}-{d[4:6]}', ls[0].capitalize(), w, l, r[4], r[5], r[6], d))
print(len(out)); [print('|'.join(map(str, o))) for o in out[:5]]
PY
cat pick.txt; L=$(sed -n 2p pick.txt); KEY=$(echo "$L" | cut -d'|' -f1); MON=$(echo "$L" | cut -d'|' -f2); OPP=$(echo "$L" | cut -d'|' -f3)
CHROME_BIN=google-chrome timeout 900 node tools/price-consistency.mjs --base "$SITE" --only "$KEY" --pick "$KEY|$MON|$OPP" > pc.log 2>&1; echo "exit $?"; grep -E '^SHOW|### price-consistency' pc.log | head -4
CHROME_BIN=google-chrome timeout 2400 node tools/probe-te/pc-dump.mjs --base "$SITE" --coverage-out cov.json > dump.log 2>&1; echo "dump exit $?"; tail -2 dump.log | cut -c1-300
python3 tools/probe-te/nf.py cov.json mis446.json
