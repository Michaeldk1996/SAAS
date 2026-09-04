#!/bin/bash
# =============================================================================
# Daily entry-lists refresh  (TEN-150)
#
# Fetches per-tournament acceptance-list PDFs from protennislive.com, parses
# them into entry_lists.json, validates with the fail-closed QA gate, and
# commits the shard onto main if it changed.
#
# Source mechanics: protennislive PDF endpoints serve 200 from residential IP
# even though their HTML pages are Cloudflare-blocked. Do NOT run from
# GitHub Actions (datacenter IPs may be harder-blocked). Run from the dedicated
# splits cron on the Mac (same model as career-splits / playing-styles jobs).
#
# Requires: python3 + pymupdf (pip3 install pymupdf)
#
# Invoked by the launchd job that sources this file from
# ~/.bsp-splits-cron/bootstrap-entry-lists.sh after cd-ing into the dedicated
# clone.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."                       # repo root of the clone
LOG_DIR="$HOME/.bsp-splits-cron"; mkdir -p "$LOG_DIR"
export LOG_DIR
exec >> "$LOG_DIR/entry-lists-refresh.log" 2>&1

START_EPOCH=$(date +%s)
START_ISO=$(date -u +%FT%TZ)
STATUS="error"; N_TOURNS=""; N_PLAYERS=""; COMMIT=""

finish() {
  local code=$? end_iso elapsed human
  end_iso=$(date -u +%FT%TZ)
  elapsed=$(( $(date +%s) - START_EPOCH )); [ "$elapsed" -lt 0 ] && elapsed=0
  human=$(printf '%dm%02ds' $(( elapsed / 60 )) $(( elapsed % 60 )))
  if [ "$code" -ne 0 ] && [ "$STATUS" != "qa-fail" ]; then STATUS="error"; fi
  echo "ELAPSED: ${elapsed}s (${human})  status=${STATUS}  tournaments=${N_TOURNS}  players=${N_PLAYERS}  end=${end_iso}"
  echo "===== done (${STATUS}) ====="
}
trap finish EXIT

echo "===== $START_ISO entry-lists refresh start ====="

# Check pymupdf is available
python3 -c "import fitz" 2>/dev/null || {
  echo "ERROR: pymupdf not installed — run: pip3 install pymupdf"; exit 1
}

# Build and gate (the script writes a temp file, validates, then atomically
# os.replace()s entry_lists.json only if the gate passes — exits non-zero on fail)
if ! python3 tools/entry-lists/build-entry-lists.py; then
  STATUS="qa-fail"; exit 1
fi

# Collect counts for the log line
read -r N_TOURNS N_PLAYERS < <(python3 -c "
import json,sys
with open('entry_lists.json') as f: d=json.load(f)
ts = d.get('tournaments',[])
ps = sum(len(s.get('players',[])) for t in ts for s in t.get('sections',[]))
print(len(ts), ps)
") || true

if git diff --quiet -- entry_lists.json; then
  echo "no change; nothing to publish"; STATUS="no-op"; exit 0
fi

# race-safe publish: rebase our change onto latest main
cp entry_lists.json /tmp/bsp-entry-lists.json
pushed=0
for attempt in 1 2 3; do
  git fetch --quiet origin main
  git reset --quiet origin/main
  cp /tmp/bsp-entry-lists.json entry_lists.json
  if git diff --quiet -- entry_lists.json; then echo "matched remote; no-op"; STATUS="no-op"; exit 0; fi
  git add entry_lists.json
  ELAPSED_NOW=$(( $(date +%s) - START_EPOCH ))
  HUMAN_NOW=$(printf '%dm%02ds' $(( ELAPSED_NOW / 60 )) $(( ELAPSED_NOW % 60 )))
  git -c user.name='BSP Entry Lists Bot' -c user.email='bot@bspconsult.local' \
      commit -q -m "chore(entry-lists): daily refresh — ${HUMAN_NOW}, ${N_TOURNS} tournaments, ${N_PLAYERS} players [skip ci]"
  if git push --quiet origin HEAD:main; then echo "pushed (attempt $attempt)"; pushed=1; COMMIT=$(git rev-parse --short HEAD); break; fi
  echo "push race on attempt $attempt; retrying"
done
[ "$pushed" = 1 ] || { echo "ERROR: could not push after 3 attempts"; exit 1; }

# redeploy Pages (pipeline.yml has no push trigger)
TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')
if [ -n "${TOKEN:-}" ]; then
  curl -s -o /dev/null -w "pipeline dispatch -> HTTP %{http_code}\n" \
    -X POST -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/Michaeldk1996/SAAS/actions/workflows/pipeline.yml/dispatches" -d '{"ref":"main"}' \
    || echo "dispatch failed (non-fatal; next scheduled pipeline will redeploy)"
else
  echo "no token; next scheduled pipeline cron will redeploy"
fi
STATUS="published"
