#!/bin/bash
# =============================================================================
# News ticker — ATP reader refresh (founder 2026-11-12: agreement with ATP; .claude/rules/news-ticker.md)
#
# WHY ON THE MAC: atptour.com answers 403 (a Cloudflare challenge) to curl, GitHub runners and headless Chrome; a normal
#   Chrome window clears it. tools/news-ticker/atp-reader.mjs drives a small visible Chrome here for about a minute.
#
# WHAT IT DOES (idempotent): reads ATP's news section and the articles about our players it has not read before, keeps
#   the quoted words that are word for word on the page (never article text), and commits ONLY
#   news-quotes/inbox-atp.json + news-quotes/atp-fetched.json as the news data bot ([skip ci]; news-quotes/ is a data
#   dir in tools/deploy-lane.mjs, so the pre-push hook lets the push through without a suite). The quote collector
#   (GitHub Actions, every 30 minutes) turns the inbox into ticker items.
#
# Invoked by ~/.stennisfy-atp-news/bootstrap.sh (tools/install-atp-news-agent.sh) from a dedicated clone, never the
# founder's working tree. Logs: ~/.stennisfy-atp-news/refresh.log, last-run.json.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."
LOG_DIR="$HOME/.stennisfy-atp-news"; mkdir -p "$LOG_DIR"
exec >> "$LOG_DIR/refresh.log" 2>&1
START_ISO=$(date -u +%FT%TZ); STATUS="error"; SUMMARY=""
finish() { printf '{"startedAt":"%s","status":"%s","summary":"%s"}\n' "$START_ISO" "$STATUS" "${SUMMARY//\"/\'}" > "$LOG_DIR/last-run.json"; echo "END $(date -u +%FT%TZ) status=$STATUS"; }
trap finish EXIT
echo "=== atp reader $START_ISO"
OUT=$(node tools/news-ticker/atp-reader.mjs 2>&1) || { SUMMARY="reader failed: $(printf '%s' "$OUT" | tail -1)"; echo "$OUT"; exit 1; }
echo "$OUT"; SUMMARY="$(printf '%s\n' "$OUT" | grep -m1 '^atp reader: ' | sed 's/^atp reader: //')"
if [ -z "$(git status --porcelain -- news-quotes/inbox-atp.json news-quotes/atp-fetched.json)" ]; then STATUS="no-change"; exit 0; fi
git add -- news-quotes/inbox-atp.json news-quotes/atp-fetched.json
git -c user.name='bsp-bot' -c user.email='bsp-bot@users.noreply.github.com' commit -q -m "chore(news): ATP reader inbox [skip ci]"
for attempt in 1 2 3; do
  if git push --quiet origin HEAD:main; then STATUS="pushed"; exit 0; fi
  echo "push rejected (attempt $attempt) — rebasing onto origin/main"; git fetch --quiet origin main; git rebase --quiet origin/main || { git rebase --abort; exit 1; }
done
SUMMARY="$SUMMARY; push failed 3 times"; exit 1
