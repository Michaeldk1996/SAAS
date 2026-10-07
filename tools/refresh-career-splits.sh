#!/bin/bash
# =============================================================================
# Daily career-splits refresh  (TEN-8, Plan A)
#
# WHY THIS RUNS IN THE OPERATOR ENVIRONMENT AND NOT GITHUB ACTIONS:
#   Career splits are sourced from Tennis Abstract (Jeff Sackmann's data).
#   TA returns 200 to this machine's residential IP but 403 to every datacenter
#   IP, so the pipeline CI job cannot fetch it. The only automated source that
#   works from CI is TML-Database, which is tour-only and shrinks every player's
#   career record (Borges 156 vs 515, Alcaraz 345 vs 464) -> it fails the
#   founder's zero-regression gate. Plan A (this script) keeps the proven TA
#   builder and schedules it here instead. See AUTOMATION-splits.md.
#
# WHAT IT DOES (idempotent, safe to run any time):
#   1. Rebuild career splits from TA (builder self-refreshes its cache via
#      SPLITS_CACHE_TTL_HOURS, default 20h, so a daily run pulls fresh matches).
#      TEN-391: one file per player (career-splits/<key>.json) + the small tour
#      file (career-splits-tour.json), for EVERY profiled player — no rank cap.
#   2. Regression guard: refuse to publish if player coverage drops >5% (a TA
#      outage that starves the fetch must never overwrite good files).
#   3. Commit + push career-splits/ + career-splits-tour.json (+ the TEN-162
#      drawer shards) to main, then dispatch the pipeline so GitHub Pages
#      redeploys with the new files (pipeline has no push trigger).
#
# It is invoked by ~/.bsp-splits-cron/bootstrap.sh from a dedicated clone, so it
# never touches the founder's working tree.
#
# REPORTING (TEN-8: "let me know every day when it updated and how long it
#   took"): every run records when it started, how long it took, whether it
#   pulled fresh data or reused cache, and the outcome, into THREE durable
#   places, so the record survives regardless of any agent session:
#     - $LOG_DIR/last-run.json     machine-readable summary of the latest run
#     - $LOG_DIR/daily-report.md   append-only human log, one line per run
#     - the git commit message      "... — 14m22s, fresh, 233 players ..." so the
#                                    public GitHub history timestamps + times it
#   The commit timestamp answers "when"; the message answers "how long".
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."                       # repo root of the clone
LOG_DIR="$HOME/.bsp-splits-cron"; mkdir -p "$LOG_DIR"
export LOG_DIR
exec >> "$LOG_DIR/refresh.log" 2>&1

# --- run bookkeeping ---------------------------------------------------------
START_EPOCH=$(date +%s)
START_ISO=$(date -u +%FT%TZ)
STATUS="error"            # error | regression | no-op | published
FRESH="unknown"           # fresh | cached | unknown
NEW_COUNT=""              # player coverage after the build
COMMIT=""                 # short sha when published

finish() {
  local code=$? end_epoch end_iso elapsed human
  end_epoch=$(date +%s); end_iso=$(date -u +%FT%TZ)
  elapsed=$(( end_epoch - START_EPOCH )); [ "$elapsed" -lt 0 ] && elapsed=0
  human=$(printf '%dm%02ds' $(( elapsed / 60 )) $(( elapsed % 60 )))
  # any non-zero exit that isn't an explicit regression is an error
  if [ "$code" -ne 0 ] && [ "$STATUS" != "regression" ]; then STATUS="error"; fi
  echo "ELAPSED: ${elapsed}s (${human})  status=${STATUS}  fresh=${FRESH}  end=${end_iso}"
  START_ISO="$START_ISO" END_ISO="$end_iso" ELAPSED="$elapsed" HUMAN="$human" \
  STATUS="$STATUS" FRESH="$FRESH" NEW_COUNT="$NEW_COUNT" COMMIT="$COMMIT" CODE="$code" \
  node -e '
    const fs=require("fs"), e=process.env, dir=e.LOG_DIR;
    const rec={
      date:e.START_ISO.slice(0,10), startedAt:e.START_ISO, finishedAt:e.END_ISO,
      elapsedSec:Number(e.ELAPSED), elapsedHuman:e.HUMAN, status:e.STATUS,
      fresh:e.FRESH, coverage:e.NEW_COUNT===""?null:Number(e.NEW_COUNT),
      commit:e.COMMIT||null, exitCode:Number(e.CODE)
    };
    fs.writeFileSync(dir+"/last-run.json", JSON.stringify(rec,null,2)+"\n");
    const extra=(rec.fresh!=="unknown"?" ("+rec.fresh+" data)":"")+(rec.coverage!=null?" · "+rec.coverage+" players":"");
    fs.appendFileSync(dir+"/daily-report.md",
      "- **"+rec.date+"** — updated "+rec.startedAt+" · took "+rec.elapsedHuman+" · "+rec.status+extra+"\n");
  ' || echo "WARN: could not write last-run.json / daily-report.md"
  echo "===== done (${STATUS}) ====="
}
trap finish EXIT

echo "===== $START_ISO career-splits refresh start ====="

[ -d node_modules ] || npm ci --silent

# --- capture current coverage for the regression guard -----------------------
# Coverage = the number of per-player files (TEN-391: career-splits/<key>.json).
COUNT_JS="const fs=require('fs');try{console.log(fs.readdirSync('career-splits').filter(f=>f.endsWith('.json')).length)}catch(e){console.log(0)}"
PREV_COUNT=$(node -e "$COUNT_JS")

# --- rebuild -----------------------------------------------------------------
# TEN-391 (founder 2026-10-07): NO caps. Every profiled player on the live
# roster; a player with no tour-level TA data simply gets no file.
BUILD_LOG=$(mktemp)
node tools/build-career-splits.js 2>&1 | tee "$BUILD_LOG"
# the builder prints "WARNING: every page came from cache" when it served 100%
# from cache (no fresh matches pulled this run); otherwise it fetched.
if grep -q "every page came from cache" "$BUILD_LOG"; then FRESH="cached"; else FRESH="fresh"; fi
rm -f "$BUILD_LOG"

NEW_COUNT=$(node -e "$COUNT_JS")
echo "coverage: prev=$PREV_COUNT new=$NEW_COUNT"

# --- regression guard --------------------------------------------------------
if ! node -e "if($NEW_COUNT < $PREV_COUNT*0.95){console.error('REGRESSION: coverage '+$PREV_COUNT+' -> '+$NEW_COUNT+'; refusing to publish');process.exit(1)}"; then
  STATUS="regression"; exit 1
fi

# The published set. `git status --porcelain` (not `git diff --quiet`): a NEW
# player's file is untracked, and diff never sees untracked files.
SPLITS_PATHS="career-splits career-splits-tour.json splits-matches-index.json splits-matches"
if [ -z "$(git status --porcelain -- $SPLITS_PATHS)" ]; then
  echo "no change in career splits; nothing to publish"
  STATUS="no-op"; exit 0
fi

# --- publish (race-safe: rebase our splits change onto latest main) ----------
# The aggregates (career-splits/ + career-splits-tour.json) travel with their
# TEN-162 drawer shards (splits-matches/ + splits-matches-index.json). They are
# produced by the SAME builder run, so a row count in the drawer reconciles with
# the split's M; they must publish together or the two drift apart. Back all
# four up before the reset so the mixed reset below can't strand them.
rm -rf /tmp/bsp-new-career-splits && cp -r career-splits /tmp/bsp-new-career-splits
cp career-splits-tour.json /tmp/bsp-new-splits-tour.json
rm -rf /tmp/bsp-new-splits-matches && cp -r splits-matches /tmp/bsp-new-splits-matches
cp splits-matches-index.json /tmp/bsp-new-splits-index.json
pushed=0
for attempt in 1 2 3; do
  git fetch --quiet origin main
  # Path-scoped reset: mixed (not --hard) moves the branch pointer to origin/main
  # so our commit fast-forwards, but leaves the working tree intact. A --hard here
  # wiped ANY uncommitted work in the shared tree (e.g. the in-tree account.html
  # restyle the tooling session measures). Mixed reset + a scoped `git add` of only
  # the splits artefacts publishes just those and never clobbers.
  git reset --quiet origin/main
  rm -rf career-splits && cp -r /tmp/bsp-new-career-splits career-splits
  cp /tmp/bsp-new-splits-tour.json career-splits-tour.json
  rm -rf splits-matches && cp -r /tmp/bsp-new-splits-matches splits-matches
  cp /tmp/bsp-new-splits-index.json splits-matches-index.json
  if [ -z "$(git status --porcelain -- $SPLITS_PATHS)" ]; then echo "matched remote after fetch; no-op"; STATUS="no-op"; exit 0; fi
  # A directory pathspec stages additions, edits AND removals inside it, so a
  # player dropped by this build leaves the site with it (as the old single
  # file did). Nothing else is staged: the obsolete career-splits.json is gone.
  git add -- $SPLITS_PATHS
  # embed run timing in the message so the public GitHub history records
  # BOTH when (commit timestamp) and how long (this string) -- durable.
  ELAPSED_NOW=$(( $(date +%s) - START_EPOCH ))
  HUMAN_NOW=$(printf '%dm%02ds' $(( ELAPSED_NOW / 60 )) $(( ELAPSED_NOW % 60 )))
  git -c user.name='BSP Splits Bot' -c user.email='bot@bspconsult.local' \
      commit -q -m "chore(splits): daily career-splits refresh from Tennis Abstract — ${HUMAN_NOW}, ${FRESH}, ${NEW_COUNT} players [skip ci]"
  if git push --quiet origin main; then echo "pushed (attempt $attempt)"; pushed=1; COMMIT=$(git rev-parse --short HEAD); break; fi
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
STATUS="published"
