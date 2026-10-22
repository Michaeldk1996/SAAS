set -uo pipefail
# read-only: one 2024 team-event match Tennis Explorer prices, shown through the page's own functions on the LIVE site
SITE=https://michaeldk1996.github.io/SAAS
git fetch -q origin main && git worktree add -q m origin/main && cd m
curl -sS -m 120 "$SITE/database-yield-x.json" -o x.json; curl -sS -m 60 "$SITE/player-index.json" -o pi.json
python3 - <<'PY' > pick.txt
import json, unicodedata
x = json.load(open('x.json')); pi = json.load(open('pi.json')); rows = pi.get('players', pi)
it = rows.values() if isinstance(rows, dict) else rows
norm = lambda s: unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode().lower()
idx = {}
for v in it:
    if not isinstance(v, dict) or not v.get('hasProfile'): continue
    parts = norm(v['name']).split(); idx.setdefault((parts[-1], parts[0][0]), []).append(v)
out = []
for r, nm in zip(x['xRows'], x['xNames']):
    if r[8] != 8 or not str(r[0]).startswith('2024'): continue
    w, l = nm
    ws = norm(w).replace('.', '').split(); ls = norm(l).replace('.', '').split()
    c = idx.get((ws[0], ws[-1][0])) if len(ws) > 1 else None
    if c and len(c) == 1:
        d = str(r[0]); out.append((c[0]['key'], f'{d[:4]}-{d[4:6]}', ls[0].capitalize(), w, l, r[4], r[5], r[6], d)); 
print(len(out)); [print('|'.join(map(str, o))) for o in out[:8]]
PY
cat pick.txt
read -r N < pick.txt
L=$(sed -n 2p pick.txt); KEY=$(echo "$L" | cut -d'|' -f1); MON=$(echo "$L" | cut -d'|' -f2); OPP=$(echo "$L" | cut -d'|' -f3)
echo "picked: $L"
CHROME_BIN=google-chrome timeout 900 node tools/price-consistency.mjs --base "$SITE" --only "$KEY" --pick "$KEY|$MON|$OPP" > pc.log 2>&1; echo "exit $?"
grep -E '^SHOW|### price-consistency' pc.log | head -12
