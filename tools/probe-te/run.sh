set -uo pipefail
git clone -q --depth 1 "https://x-access-token:${TE_STORE_READ_TOKEN}@github.com/michaeldk1996/stennisfy-te-store.git" st
git clone -q --depth 1 "https://x-access-token:${WORKFLOW_PAT}@github.com/Michaeldk1996/stennisfy-ops.git" ops
echo "ops at $(git -C ops rev-parse --short HEAD), store at $(git -C st rev-parse --short HEAD)"
python3 tools/probe-te/p.py 2>&1 | tail -120
echo "## launchd: ten345 / shadow scripts in the ops repo, and every file there that names tennisexplorer"
find ops -path ops/.git -prune -o \( -iname '*ten345*' -o -path '*shadow*' \) -print | head -20
for f in $(find ops -path ops/.git -prune -o -path '*shadow*' -type f -print | head -20); do echo "== $f calls:"; grep -nE '\b(node|python3?|bash|sh)\b[^#]*\.(mjs|js|py|sh)' "$f" | head -10; done
grep -rIl -i tennisexplorer ops --exclude-dir=.git | head -30
