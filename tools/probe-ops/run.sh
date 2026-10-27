set -uo pipefail
SITE=https://michaeldk1996.github.io/SAAS
python3 tools/probe-te/mislabel.py | tail -1
CHROME_BIN=google-chrome timeout 2400 node tools/probe-te/pc-dump.mjs --base "$SITE" --coverage-out cov.json > dump.log 2>&1; echo "dump exit $?"
echo "== the surfaces that differ from the Database (live site)"; grep -E '^FAIL ' dump.log | head -60; grep -E 'surface\(s\) show' dump.log
git clone -q "https://x-access-token:${OPS_TOKEN}@github.com/Michaeldk1996/stennisfy-ops.git" ops || exit 1
python3 tools/probe-ops/build.py ops || exit 1
cd ops && git add te-targets/nf.json te-targets/pre-sample.json te-targets/batches.json && git -c user.name=Claude -c user.email=noreply@anthropic.com commit -qm "te-targets: nf (446 word-round qualifying + never targeted) and pre-sample (report only), founder 2026-10-27" && git push -q origin HEAD && git log -1 --format='OPS %H %s'
