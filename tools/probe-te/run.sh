set -uo pipefail
# read-only: wait for a publish whose DATA run started after the calib-01 import (15:08:22Z), then count TE prices on the live site
SITE=https://michaeldk1996.github.io/SAAS
for i in $(seq 1 55); do
  curl -sS -m 30 "$SITE/build-info.json?cb=$RANDOM" -o bi.json || true
  d=$(python3 -c 'import json;b=json.load(open("bi.json"));d=b.get("data") or {};print(d.get("builtAt") or d.get("startedAt") or "")' 2>/dev/null)
  echo "$(date -u +%H:%M:%S) data built $d"
  [[ "$d" > "2026-10-20T15:15" ]] && break
  sleep 60
done
cat bi.json; echo
for f in database-yield-x.json database-yield-master.json database-yield-master-meta.json; do curl -sS -m 120 "$SITE/$f?cb=$RANDOM" -o "$f" -w "$f %{http_code} %{size_download}\n"; done
python3 - <<'PY'
import json, collections
def walk(o, c):
    if isinstance(o, list):
        if len(o) >= 9 and not isinstance(o[0], (list, dict)): c[o[8]] += 1
        else:
            for x in o: walk(x, c)
    elif isinstance(o, dict):
        for v in o.values(): walk(v, c)
for f in ('database-yield-x.json', 'database-yield-master.json'):
    try:
        j = json.load(open(f)); c = collections.Counter(); walk(j, c)
        print(f, 'top-level keys', list(j.keys())[:12] if isinstance(j, dict) else type(j).__name__, '· rows by book code', dict(sorted(c.items(), key=lambda x: str(x[0]))), '· book 8 (Tennis Explorer)', c.get(8, 0))
    except Exception as e: print(f, 'unreadable', e)
try:
    m = json.load(open('database-yield-master-meta.json')); print('master meta', json.dumps({k: m.get(k) for k in list(m)[:15]})[:1500])
except Exception as e: print('meta unreadable', e)
PY
H=(-H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY" -H "Prefer: count=exact" -H "Range: 0-0")
echo "TE rows in historical_snapshot:"; curl -sS -I "${H[@]}" "$SUPABASE_URL/rest/v1/historical_snapshot?select=id&source=eq.Tennis%20Explorer%20%C2%B7%20Pinnacle" | grep -i content-range
echo "all rows:"; curl -sS -I "${H[@]}" "$SUPABASE_URL/rest/v1/historical_snapshot?select=id" | grep -i content-range
