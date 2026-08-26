#!/bin/bash
# =============================================================================
# Daily playing-styles refresh  (TEN-8)
#
# WHY DAILY: the tour style classifier's historical source (TML) lags the live
#   season, so current-season breakouts (Jodar, Budkov Kjaer, ...) get no style
#   until TML catches up — which can be months. classify-styles.js now pulls each
#   unqualified roster player's CURRENT-SEASON matches from api-tennis, so a daily
#   run is what surfaces new debutants (and their evolving stats) as the season
#   progresses. The founder asked for this to update every day for fresh data.
#
# WHY IN THE OPERATOR ENVIRONMENT (not CI): api-tennis is fine from CI, but this
#   reuses the same dedicated-clone + regression-guard + dispatch harness as the
#   career-splits job so both daily style/data refreshes are managed identically.
#
# WHAT IT DOES (idempotent, safe to run any time):
#   1. Re-run classify-styles.js (TML history + api-tennis current season +
#      re-embedded Challenger pool) -> playing-styles.json + matchup-matrix.json.
#   2. Regression guard: refuse to publish if the roster shrinks (total < 95% of
#      live, tour < 190, or the Challenger pool was dropped). An api-tennis or TML
#      outage must never overwrite a good file with a thin one.
#   3. Race-safe single-file commit of the two data files onto latest main, then
#      dispatch the pipeline so Pages redeploys (pipeline has no push trigger).
#
# Invoked by ~/.bsp-splits-cron/bootstrap-styles.sh from a dedicated clone, so it
# never touches the founder's working tree. API_TENNIS_KEY must be exported by
# the caller (the bootstrap sources it from the project .env).
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."                       # repo root of the clone
LOG_DIR="$HOME/.bsp-splits-cron"; mkdir -p "$LOG_DIR"
export LOG_DIR
exec >> "$LOG_DIR/styles-refresh.log" 2>&1

START_EPOCH=$(date +%s)
START_ISO=$(date -u +%FT%TZ)
STATUS="error"; NEW_TOTAL=""; NEW_TOUR=""; NEW_CHALL=""; COMMIT=""

finish() {
  local code=$? end_iso elapsed human
  end_iso=$(date -u +%FT%TZ)
  elapsed=$(( $(date +%s) - START_EPOCH )); [ "$elapsed" -lt 0 ] && elapsed=0
  human=$(printf '%dm%02ds' $(( elapsed / 60 )) $(( elapsed % 60 )))
  if [ "$code" -ne 0 ] && [ "$STATUS" != "regression" ]; then STATUS="error"; fi
  echo "ELAPSED: ${elapsed}s (${human})  status=${STATUS}  total=${NEW_TOTAL} tour=${NEW_TOUR} chall=${NEW_CHALL}  end=${end_iso}"
  START_ISO="$START_ISO" END_ISO="$end_iso" ELAPSED="$elapsed" HUMAN="$human" STATUS="$STATUS" \
  NEW_TOTAL="$NEW_TOTAL" NEW_TOUR="$NEW_TOUR" NEW_CHALL="$NEW_CHALL" COMMIT="$COMMIT" CODE="$code" \
  node -e '
    const fs=require("fs"), e=process.env, dir=e.LOG_DIR;
    const rec={date:e.START_ISO.slice(0,10),startedAt:e.START_ISO,finishedAt:e.END_ISO,
      elapsedSec:Number(e.ELAPSED),elapsedHuman:e.HUMAN,status:e.STATUS,
      total:e.NEW_TOTAL===""?null:Number(e.NEW_TOTAL),tour:e.NEW_TOUR===""?null:Number(e.NEW_TOUR),
      challengers:e.NEW_CHALL===""?null:Number(e.NEW_CHALL),commit:e.COMMIT||null,exitCode:Number(e.CODE)};
    fs.writeFileSync(dir+"/styles-last-run.json",JSON.stringify(rec,null,2)+"\n");
    fs.appendFileSync(dir+"/styles-daily-report.md",
      "- **"+rec.date+"** — updated "+rec.startedAt+" · took "+rec.elapsedHuman+" · "+rec.status+
      (rec.total!=null?" · "+rec.total+" players ("+rec.tour+" tour / "+rec.challengers+" chall)":"")+"\n");
  ' || echo "WARN: could not write styles-last-run.json"
  echo "===== done (${STATUS}) ====="
}
trap finish EXIT

echo "===== $START_ISO playing-styles refresh start ====="
[ -n "${API_TENNIS_KEY:-}" ] || { echo "ERROR: API_TENNIS_KEY not set"; exit 1; }
[ -d node_modules ] || npm ci --silent || true

# capture live roster size for the regression guard
PREV_TOTAL=$(node -e "try{console.log((require('./playing-styles.json').players||[]).length)}catch(e){console.log(0)}")

# rebuild (classify-styles.js re-embeds the Challenger pool; it THROWS if the
# committed Challenger input is missing, so a thin tour-only file is never written)
node classify-styles.js

# Re-apply the board-finalized v5.1 archetype labels (TEN-12) over the fresh
# classify-styles output. classify-styles.js emits the OLD free-string taxonomy
# plus a per-player `primary`/`archetype_scores` radar; this step overwrites
# archetype_label with the board labels (surname + first-initial match), sets the
# `variety` chip flag, and CLEARS the retired `primary`/`archetype_scores` so the
# old radar/grid/badge taxonomy stays retired across every daily regeneration.
# Held labels for roster debutants auto-apply the day classify-styles.js first
# admits them (see tools/board-archetypes.json + tools/apply-board-archetypes.js).
node tools/apply-board-archetypes.js

# NOTE: node must emit a TRAILING NEWLINE here — `read` returns exit 1 at EOF if
# it never sees the line delimiter, and `set -e` would then kill the whole run
# right before the publish step (the daily job silently never committed). Use
# console.log (not process.stdout.write), and `|| true` as a belt-and-suspenders.
read -r NEW_TOTAL NEW_TOUR NEW_CHALL < <(node -e "
  const p=(require('./playing-styles.json').players||[]);
  const tour=p.filter(x=>!x.source).length;
  console.log(p.length+' '+tour+' '+(p.length-tour));
") || true
echo "roster: prev_total=$PREV_TOTAL -> total=$NEW_TOTAL (tour=$NEW_TOUR chall=$NEW_CHALL)"

# regression guard
if ! node -e "
  const t=$NEW_TOTAL, tour=$NEW_TOUR, chall=$NEW_CHALL, prev=$PREV_TOTAL;
  if (t < prev*0.95) { console.error('REGRESSION: total '+prev+' -> '+t); process.exit(1); }
  if (tour < 190)    { console.error('REGRESSION: tour '+tour+' < 190'); process.exit(1); }
  if (chall < 700)   { console.error('REGRESSION: challengers dropped to '+chall); process.exit(1); }
"; then STATUS="regression"; exit 1; fi

if git diff --quiet -- playing-styles.json matchup-matrix.json; then
  echo "no change; nothing to publish"; STATUS="no-op"; exit 0
fi

# race-safe publish: rebase our two-file change onto latest main
cp playing-styles.json /tmp/bsp-styles.json
cp matchup-matrix.json /tmp/bsp-matrix.json
pushed=0
for attempt in 1 2 3; do
  git fetch --quiet origin main
  git reset --quiet origin/main          # mixed reset: move pointer, keep working tree
  cp /tmp/bsp-styles.json playing-styles.json
  cp /tmp/bsp-matrix.json matchup-matrix.json
  if git diff --quiet -- playing-styles.json matchup-matrix.json; then echo "matched remote; no-op"; STATUS="no-op"; exit 0; fi
  git add playing-styles.json matchup-matrix.json
  ELAPSED_NOW=$(( $(date +%s) - START_EPOCH ))
  HUMAN_NOW=$(printf '%dm%02ds' $(( ELAPSED_NOW / 60 )) $(( ELAPSED_NOW % 60 )))
  git -c user.name='BSP Styles Bot' -c user.email='bot@bspconsult.local' \
      commit -q -m "chore(styles): daily playing-styles refresh — ${HUMAN_NOW}, ${NEW_TOTAL} players (${NEW_TOUR} tour / ${NEW_CHALL} chall) [skip ci]"
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
