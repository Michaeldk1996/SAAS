#!/bin/bash
# =============================================================================
# Daily career-splits refresh  (TEN-8, Plan A)
#
# WHY THIS RUNS IN THE OPERATOR ENVIRONMENT AND NOT GITHUB ACTIONS:
#   career-splits.json is sourced from Tennis Abstract (Jeff Sackmann's data).
#   TA returns 200 to this machine's residential IP but 403 to every datacenter
#   IP, so the pipeline CI job cannot fetch it. The only automated source that
#   works from CI is TML-Database, which is tour-only and shrinks every player's
#   career record (Borges 156 vs 515, Alcaraz 345 vs 464) -> it fails the
#   founder's zero-regression gate. Plan A (this script) keeps the proven TA
#   builder and schedules it here instead. See AUTOMATION-splits.md.
#
# WHAT IT DOES (idempotent, safe to run any time):
#   1. Rebuild career-splits.json from TA (builder self-refreshes its cache via
#      SPLITS_CACHE_TTL_HOURS, default 20h, so a daily run pulls fresh matches).
#   2. Regression guard: refuse to publish if player coverage drops >5% (a TA
#      outage that starves the fetch must never overwrite a good file).
#   3. Commit + push career-splits.json to main, then dispatch the pipeline so
#      GitHub Pages redeploys with the new file (pipeline has no push trigger).
#
# It is invoked by ~/.bsp-splits-cron/bootstrap.sh from a dedicated clone, so it
# never touches the founder's working tree.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."                       # repo root of the clone
LOG_DIR="$HOME/.bsp-splits-cron"; mkdir -p "$LOG_DIR"
exec >> "$LOG_DIR/refresh.log" 2>&1
echo "===== $(date -u +%FT%TZ) career-splits refresh start ====="

[ -d node_modules ] || npm ci --silent

# --- capture current coverage for the regression guard -----------------------
PREV_COUNT=$(node -e "try{console.log(Object.keys(require('./career-splits.json').players||{}).length)}catch(e){console.log(0)}")

# --- rebuild -----------------------------------------------------------------
# rank<=250, up to 400 players (comfortably covers the ~233 currently shipped;
# passing explicit caps is load-bearing -- no-arg runs silently drop to 160).
node tools/build-career-splits.js 250 400

NEW_COUNT=$(node -e "console.log(Object.keys(require('./career-splits.json').players||{}).length)")
echo "coverage: prev=$PREV_COUNT new=$NEW_COUNT"

# --- regression guard --------------------------------------------------------
node -e "if($NEW_COUNT < $PREV_COUNT*0.95){console.error('REGRESSION: coverage '+$PREV_COUNT+' -> '+$NEW_COUNT+'; refusing to publish');process.exit(1)}"

if git diff --quiet -- career-splits.json; then
  echo "no change in career-splits.json; nothing to publish"
  echo "===== done (no-op) ====="; exit 0
fi

# --- publish (race-safe: rebase our single-file change onto latest main) -----
cp career-splits.json /tmp/bsp-new-splits.json
pushed=0
for attempt in 1 2 3; do
  git fetch --quiet origin main
  git reset --quiet --hard origin/main
  cp /tmp/bsp-new-splits.json career-splits.json
  if git diff --quiet -- career-splits.json; then echo "matched remote after fetch; no-op"; exit 0; fi
  git add career-splits.json
  git -c user.name='BSP Splits Bot' -c user.email='bot@bspconsult.local' \
      commit -q -m "chore(splits): daily career-splits refresh from Tennis Abstract [skip ci]"
  if git push --quiet origin main; then echo "pushed (attempt $attempt)"; pushed=1; break; fi
  echo "push race on attempt $attempt; retrying"
done
[ "$pushed" = 1 ] || { echo "ERROR: could not push after 3 attempts"; exit 1; }

# --- redeploy Pages (pipeline.yml has no push trigger) -----------------------
TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')
if [ -n "${TOKEN:-}" ]; then
  curl -s -o /dev/null -w "pipeline dispatch -> HTTP %{http_code}\n" \
    -X POST -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/Michaeldk1996/SAAS/actions/workflows/pipeline.yml/dispatches" \
    -d '{"ref":"main"}' || echo "dispatch failed (non-fatal; next */15 cron will redeploy)"
else
  echo "no token; next */15 pipeline cron will redeploy"
fi
echo "===== done (published) ====="
