#!/bin/bash
# =============================================================================
# Self-hosted player headshots — refresh (founder 2026-10-24, .claude/rules/player-photos.md)
#
# WHY ON THE MAC: ATP's headshot CDN sits behind a Cloudflare challenge. curl, GitHub runners and headless Chrome get
#   403 `cf-mitigated: challenge`; a normal Chrome window clears it (measured 2026-10-24). So tools/photos/
#   fetch-headshots.mjs drives a visible Chrome here — a small window opens for about 3 minutes while it runs.
#
# WHEN: launchd runs this daily (tools/install-photos-agent.sh); it only fetches when a refresh is DUE —
#   the last refresh is 7+ days old, OR player-atp-aliases.json changed since it (a new alias gets its photo,
#   a removed one loses it), OR FORCE=1.
#
# WHAT IT DOES (idempotent):
#   1. fetch every aliased headshot -> player-photos/{s,l}/<id>.webp + index.json (a failed fetch keeps the last
#      good photo; nothing is deleted except for an alias removed from the map);
#   2. commit ONLY player-photos/ as the photos data bot ([skip ci]; tools/deploy-lane.mjs counts these files as data,
#      so the pre-push hook lets the push through without a suite), push, and dispatch the pipeline so the site
#      republishes with the new files;
#   3. log every run to ~/.bsp-photos-cron (refresh.log, last-run.json, report.md). A coverage drop is a WARNING
#      line here and a ::warning:: annotation on the pipeline run (tools/photos/coverage-check.mjs) — never a block.
#
# Invoked by ~/.bsp-photos-cron/bootstrap.sh from a dedicated clone, never the founder's working tree.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."                    # repo root of the clone
LOG_DIR="$HOME/.bsp-photos-cron"; mkdir -p "$LOG_DIR"
exec >> "$LOG_DIR/refresh.log" 2>&1
START=$(date +%s); START_ISO=$(date -u +%FT%TZ); STATUS="error"; SUMMARY=""; COMMIT=""
finish() {
  local code=$?; local took=$(( $(date +%s) - START ))
  [ "$code" -ne 0 ] && [ "$STATUS" != "not-due" ] && STATUS="error"
  printf '{"startedAt":"%s","tookS":%d,"status":"%s","summary":"%s","commit":"%s"}\n' "$START_ISO" "$took" "$STATUS" "${SUMMARY//\"/\'}" "$COMMIT" > "$LOG_DIR/last-run.json"
  echo "- **$(date -u +%F)** — $START_ISO · ${took}s · $STATUS · $SUMMARY ${COMMIT:+· $COMMIT}" >> "$LOG_DIR/report.md"
  echo "END $(date -u +%FT%TZ) status=$STATUS took=${took}s"
}
trap finish EXIT
echo "=== photos refresh $START_ISO"

DUE=$(node -e '
  const fs = require("fs"), crypto = require("crypto");
  const ah = crypto.createHash("sha1").update(fs.readFileSync("player-atp-aliases.json")).digest("hex");
  let i = null; try { i = JSON.parse(fs.readFileSync("player-photos/index.json", "utf8")); } catch {}
  if (process.env.FORCE === "1") { console.log("forced"); process.exit(0); }
  if (!i) { console.log("no index"); process.exit(0); }
  if (i.aliasHash !== ah) { console.log("alias file changed"); process.exit(0); }
  const age = (Date.now() - Date.parse(i.generatedAt)) / 864e5;
  console.log(age >= 7 ? "weekly (" + age.toFixed(1) + " days)" : "");')
if [ -z "$DUE" ]; then STATUS="not-due"; SUMMARY="last refresh under 7 days old, alias file unchanged"; exit 0; fi
echo "due: $DUE"

OUT=$(node tools/photos/fetch-headshots.mjs 2>&1) || { SUMMARY="fetch failed: $(printf '%s' "$OUT" | tail -1)"; echo "$OUT"; exit 1; }
echo "$OUT"
SUMMARY="$DUE; $(printf '%s\n' "$OUT" | grep -m1 '^photos: ' | sed 's/^photos: //')"
if printf '%s\n' "$OUT" | grep -q '^WARNING'; then SUMMARY="$SUMMARY; $(printf '%s\n' "$OUT" | grep -m1 '^WARNING')"; fi

if [ -z "$(git status --porcelain -- player-photos)" ]; then STATUS="no-change"; exit 0; fi
git add -A -- player-photos
git -c user.name='BSP Photos Bot' -c user.email='bot@bspconsult.local' \
  commit -q -m "chore(photos): headshot refresh — $(printf '%s\n' "$OUT" | grep -m1 -o '[0-9]* of [0-9]* aliases have a stored photo') [skip ci]"
pushed=0
for attempt in 1 2 3; do
  if git push --quiet origin HEAD:main; then pushed=1; break; fi
  echo "push rejected (attempt $attempt) — rebasing onto origin/main"; git fetch --quiet origin main; git rebase --quiet origin/main || { git rebase --abort; exit 1; }
done
[ "$pushed" = 1 ] || { SUMMARY="$SUMMARY; push failed"; exit 1; }
COMMIT=$(git rev-parse --short HEAD); STATUS="published"
TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p') || true
if [ -n "${TOKEN:-}" ]; then
  curl -s -o /dev/null -w "pipeline dispatch -> HTTP %{http_code}\n" -X POST -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/Michaeldk1996/SAAS/actions/workflows/pipeline.yml/dispatches" -d '{"ref":"main"}' || echo "dispatch failed (the next */15 pipeline run publishes)"
else echo "no token; the next */15 pipeline run publishes"; fi
