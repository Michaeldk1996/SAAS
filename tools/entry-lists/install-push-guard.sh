#!/bin/bash
# Activate the TEN-150 ad-hoc-push guard in THIS clone by pointing git at the
# versioned hooks dir. Reversible with:  git config --unset core.hooksPath
#
# Intended for interactive / agent clones and worktrees (where a stray push to
# main would deploy unreviewed work). Do NOT run this in the scheduled cron
# clones — they must push freely; they opt through the guard with BSP_CRON_PUSH=1
# instead, so activating it there is harmless but unnecessary.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git config core.hooksPath .githooks
chmod +x .githooks/pre-push 2>/dev/null || true
echo "push guard ACTIVE in $(pwd)"
echo "  .githooks/pre-push blocks un-flagged pushes to origin/main."
echo "  cron jobs opt through with BSP_CRON_PUSH=1."
echo "  remove with: git config --unset core.hooksPath"
