set -euo pipefail
git clone -q "https://x-access-token:${TE_STORE_READ_TOKEN}@github.com/michaeldk1996/stennisfy-te-store.git" .te-store
echo "== store log"; git -C .te-store log --format='%h %cI %s' -8
echo "== te-odds/"; ls -la .te-store/te-odds/ 2>/dev/null || echo "no te-odds/ in the store yet"
if [ ! -f .te-store/te-odds/calib-01.json ]; then echo "calib-01.json NOT in the store"; exit 0; fi
node -e 'const d=require("./.te-store/te-odds/calib-01.json");console.log("batch",d.batch,"complete",d.complete,"targets",d.targets,"rows",d.rows.length, "keys", Object.keys(d).join(","))'
echo "== report"; node tools/te-calibration-report.mjs .te-store/te-odds/calib-01.json --no-prices
echo "== dry-run"; python3 tools/tdarch.py te-import .te-store --dry-run
