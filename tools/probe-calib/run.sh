set -euo pipefail
# waits (read-only token) for te-odds/calib-01.json to land COMPLETE in the private store, then prints the calibration
# report WITHOUT prices (this repo is public) and the te-import DRY RUN (counts only, nothing inserted)
for i in $(seq 1 64); do
  rm -rf .te-store; git clone -q --depth 1 "https://x-access-token:${TE_STORE_READ_TOKEN}@github.com/michaeldk1996/stennisfy-te-store.git" .te-store
  if [ -f .te-store/te-odds/calib-01.json ] && node -e 'process.exit(require("./.te-store/te-odds/calib-01.json").complete?0:1)'; then break; fi
  echo "$(date -u +%H:%MZ) poll $i: calib-01.json not in the store yet ($(ls .te-store/te-odds 2>/dev/null | tr '\n' ' '))"
  [ "$i" = 64 ] && { echo "gave up waiting"; exit 1; }
  sleep 300
done
echo "== store log"; git -C .te-store log --format='%h %cI %s' -5
node -e 'const d=require("./.te-store/te-odds/calib-01.json");console.log("batch",d.batch,"complete",d.complete,"targets",d.targets,"rows",d.rows.length,"summary",JSON.stringify(d.summary),"calibration",JSON.stringify(d.calibration))'
echo "== report"; node tools/te-calibration-report.mjs .te-store/te-odds/calib-01.json --no-prices
echo "== dry-run"; python3 tools/tdarch.py te-import .te-store --dry-run
