set -uo pipefail
# read-only: the live site's own price coverage — whole site per level × year (the published report), and Bergs alone
SITE=https://michaeldk1996.github.io/SAAS
git worktree add -q m origin/main && cd m
curl -sS -m 60 "$SITE/build-info.json" | python3 -c 'import json,sys;b=json.load(sys.stdin);print("live code",b["commit"][:9],"data built",b["data"]["builtAt"])'
curl -sS -m 120 "$SITE/price-coverage.json" -o pc.json -w "price-coverage.json %{http_code} %{size_download}\n"
curl -sS -m 120 "$SITE/player-index.json" -o pi.json
python3 - <<'PY'
import json
pc=json.load(open('pc.json')); print('price-coverage keys', list(pc)[:20])
for k in ('byLevelYear','byLevel','levels','table'):
    if k in pc: print(k, json.dumps(pc[k])[:6000])
pi=json.load(open('pi.json')); rows=pi.get('players', pi) if isinstance(pi, dict) else pi
it = rows.items() if isinstance(rows, dict) else enumerate(rows)
for k,v in it:
    s=json.dumps(v)
    if 'Bergs' in s: print('Bergs entry', k, s[:300])
PY
KEY=$(python3 -c '
import json;pi=json.load(open("pi.json"));rows=pi.get("players",pi) if isinstance(pi,dict) else pi
it=rows.items() if isinstance(rows,dict) else enumerate(rows)
for k,v in it:
  if "Bergs" in json.dumps(v):
    print(v.get("key") or v.get("k") or k if isinstance(v,dict) else k);break')
echo "Bergs key: $KEY"
CHROME_BIN=google-chrome timeout 1500 node tools/price-consistency.mjs --base "$SITE" --only "$KEY" --coverage-out bergs.json > pcons.log 2>&1; echo "price-consistency exit $?"; tail -15 pcons.log
python3 - <<'PY'
import json
try: c=json.load(open('bergs.json'))
except Exception as e: print('no bergs.json', e); raise SystemExit
print(json.dumps(c)[:8000])
PY
