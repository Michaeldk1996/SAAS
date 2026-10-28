set -uo pipefail
SITE=https://michaeldk1996.github.io/SAAS
curl -s $SITE/build-info.json | head -c 400; echo
python3 tools/probe-te/mislabel.py | tail -1
CHROME_BIN=google-chrome timeout 2400 node tools/probe-te/pc-dump.mjs --base "$SITE" --coverage-out cov.json > dump.log 2>&1; echo "dump exit $?"
grep -E 'surface\(s\) show' dump.log; grep -cE '^FAIL ' dump.log
python3 tools/probe-final/final.py cov.json mis446.json
