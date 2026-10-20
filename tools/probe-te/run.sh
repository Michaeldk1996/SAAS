set -uo pipefail
git clone -q --depth 1 "https://x-access-token:${TE_STORE_READ_TOKEN}@github.com/michaeldk1996/stennisfy-te-store.git" st
python3 tools/probe-te/p.py 2>&1 | tail -60
