#!/usr/bin/env bash
# Post a board comment AS THE AGENT, from a markdown file.
#
# ⚠️ WITHOUT THE AGENT HEADERS THE COMMENT POSTS AS THE FOUNDER. Silently — the
# API accepts it and attributes it to whoever the request authenticates as. A
# report that appears under Michael's name is worse than no report: he reads his
# own words back as if someone else had verified them.
#
# Both headers are required, and the body must name the same actor:
#   Authorization: Bearer $PAPERCLIP_API_KEY
#   X-Paperclip-Agent-Id: $PAPERCLIP_AGENT_ID
#   {"authorType":"agent","authorAgentId":"$PAPERCLIP_AGENT_ID"}
# A mismatch answers "Comment authorType must match authenticated actor", which
# is the only hint you get.
#
# The API key is passed by variable and never printed. `--data @-` keeps the
# body off the process list too.
#
# Usage: tools/post-board-comment.sh <issue-id> <markdown-file>
set -euo pipefail

ISSUE="${1:?issue id required}"
FILE="${2:?markdown file required}"
[ -r "$FILE" ] || { echo "::error::cannot read $FILE"; exit 1; }

: "${PAPERCLIP_API_KEY:?PAPERCLIP_API_KEY is not set}"
: "${PAPERCLIP_AGENT_ID:?PAPERCLIP_AGENT_ID is not set}"
: "${PAPERCLIP_API_URL:?PAPERCLIP_API_URL is not set}"

# PAPERCLIP_API_URL may or may not already end in /api.
B="${PAPERCLIP_API_URL%/}"; B="${B%/api}"

body=$(python3 -c '
import json, sys
md = open(sys.argv[1], encoding="utf-8").read()
print(json.dumps({"body": md, "authorType": "agent",
                  "authorAgentId": sys.argv[2]}))
' "$FILE" "$PAPERCLIP_AGENT_ID")

resp=$(printf '%s' "$body" | curl -sS -w $'\n%{http_code}' -X POST \
  -H "Authorization: Bearer ${PAPERCLIP_API_KEY}" \
  -H "X-Paperclip-Agent-Id: ${PAPERCLIP_AGENT_ID}" \
  -H "Content-Type: application/json" \
  --data @- "$B/api/issues/$ISSUE/comments")

code=$(printf '%s' "$resp" | tail -n1)
out=$(printf '%s' "$resp" | sed '$d')
if [ "$code" != "200" ] && [ "$code" != "201" ]; then
  echo "::error::comment POST failed ($code): $out"
  exit 1
fi
# Print the id so a misattribution can be deleted by the same actor that wrote
# it — an agent-authored comment needs the agent headers to delete.
printf '%s' "$out" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    print("posted comment", d.get("id") or d.get("commentId") or "(id not in response)",
          "as agent", "(author:", d.get("authorType"), ")")
except Exception:
    print("posted (response not JSON)")
'
