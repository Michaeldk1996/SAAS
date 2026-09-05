#!/bin/bash
# =============================================================================
# Daily entry-lists ADVANCE refresh  (TEN-150, ticktocktennis source)
#
# Runs the ticktock advance scraper (one HTTP GET), which writes
# entry_lists_advance.json only after its fail-closed QA gate passes, then
# commits the shard onto main if it changed. This is the ADVANCE (upcoming-week
# acceptance list) source; the protennislive mds/qs job (refresh-entry-lists.sh)
# is the separate near-event DRAW source and is untouched here.
#
# Rate limit: exactly one fetch of one URL per run (the scraper caches to the
# committed shard; on fetch/parse/shape failure it carries the last-known shard
# forward flagged `stale` rather than hammering the source or publishing garbage).
#
# Invoked by the launchd entry-lists bootstrap after it cds into the dedicated
# clone and resets to origin/main. Safe to run standalone for a manual refresh.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."                       # repo root of the clone
LOG_DIR="$HOME/.bsp-splits-cron"; mkdir -p "$LOG_DIR"
exec >> "$LOG_DIR/entry-lists-advance-refresh.log" 2>&1

# Escape hatch for the pre-push guard (.githooks/pre-push): this IS the scheduled
# bot job, so it is allowed to push to main.
export BSP_CRON_PUSH=1

START_EPOCH=$(date +%s)
START_ISO=$(date -u +%FT%TZ)
STATUS="error"; N_TOURNS=""; N_PLAYERS=""

finish() {
  local code=$? end_iso elapsed human
  end_iso=$(date -u +%FT%TZ)
  elapsed=$(( $(date +%s) - START_EPOCH )); [ "$elapsed" -lt 0 ] && elapsed=0
  human=$(printf '%dm%02ds' $(( elapsed / 60 )) $(( elapsed % 60 )))
  if [ "$code" -ne 0 ] && [ "$STATUS" != "qa-fail" ]; then STATUS="error"; fi
  echo "ELAPSED: ${elapsed}s (${human})  status=${STATUS}  tournaments=${N_TOURNS}  players=${N_PLAYERS}  end=${end_iso}"
  echo "===== advance done (${STATUS}) ====="
}
trap finish EXIT

echo "===== $START_ISO entry-lists ADVANCE refresh start ====="

# Build + gate. The scraper exits non-zero only on a HARD failure (bad shape AND
# no prior shard to carry forward); a carried-forward stale shard exits 0.
if ! node tools/entry-lists/build-entry-lists-advance.mjs; then
  STATUS="qa-fail"; exit 1
fi

read -r N_TOURNS N_PLAYERS < <(node -e "
const d=require('./entry_lists_advance.json');
const ps=d.tournaments.reduce((n,t)=>n+(t.sections||[]).reduce((m,s)=>m+s.players.length,0),0);
process.stdout.write(d.tournaments.length+' '+ps);
") || true

if git diff --quiet -- entry_lists_advance.json; then
  echo "no change; nothing to publish"; STATUS="no-op"; exit 0
fi

# race-safe publish: rebase our change onto latest main
cp entry_lists_advance.json /tmp/bsp-entry-lists-advance.json
pushed=0
for attempt in 1 2 3; do
  git fetch --quiet origin main
  git reset --quiet origin/main
  cp /tmp/bsp-entry-lists-advance.json entry_lists_advance.json
  if git diff --quiet -- entry_lists_advance.json; then echo "matched remote; no-op"; STATUS="no-op"; exit 0; fi
  git add entry_lists_advance.json
  ELAPSED_NOW=$(( $(date +%s) - START_EPOCH ))
  HUMAN_NOW=$(printf '%dm%02ds' $(( ELAPSED_NOW / 60 )) $(( ELAPSED_NOW % 60 )))
  git -c user.name='BSP Entry Lists Bot' -c user.email='bot@bspconsult.local' \
      commit -q -m "chore(entry-lists): daily advance refresh — ${HUMAN_NOW}, ${N_TOURNS} tournaments, ${N_PLAYERS} players [skip ci]"
  if git push --quiet origin HEAD:main; then echo "pushed (attempt $attempt)"; pushed=1; break; fi
  echo "push race on attempt $attempt; retrying"
done
[ "$pushed" = 1 ] || { echo "ERROR: could not push after 3 attempts"; exit 1; }

# redeploy Pages ([skip ci] data commits do not push-trigger; nudge the workflow)
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
