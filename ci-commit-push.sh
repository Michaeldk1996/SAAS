#!/usr/bin/env bash
# Commit + push one capture's worth of state, immediately.
#
# TEN-179 item 1 (founder ruling 2026-09-11): "Captures already made must be
# committed as they happen, not held to the end. A loop that loses an hour of
# work on an interrupt is worse than the cron." This script is that guarantee —
# the odds loop calls it after EVERY iteration, so the most a kill can ever cost
# is the single iteration in flight.
#
#   ./ci-commit-push.sh "<commit message>" file1 [file2 ...]
#
# Exit codes:
#   0  pushed, or there was genuinely nothing to commit
#   3  REDO — a concurrent writer advanced main and our change could not be
#      replayed onto it without a conflict. The tree has been reset to
#      origin/main and the caller should re-run the capture that produced this
#      state. Callers must only do that for a FREE capture; re-running a metered
#      one on a git race would burn quota on a git problem.
#   1  push failed for a reason a rebase cannot fix
#
# Why the REDO path exists at all: matches.json is written by four workflows
# (this loop, scores.yml every 10 min, odds-history.yml, and manual runs). The
# previous helper did `git pull --rebase || true` and then retried the push,
# which on a real content conflict leaves the rebase HALF-APPLIED — the next
# iteration then runs inside a conflicted tree and every subsequent commit in
# that job fails. Observed as "Could not push after 3 attempts" with no further
# detail. Aborting the rebase and recomputing from the new base is the only
# resolution that neither drops our odds nor drops the other writer's scores;
# `-X ours` / `-X theirs` each silently discard one side.
set -uo pipefail

MSG="${1:?commit message required}"; shift
[ "$#" -gt 0 ] || { echo "ci-commit-push: no files given"; exit 0; }

git config user.name  "bsp-odds-bot"
git config user.email "bsp-odds-bot@users.noreply.github.com"

# Stage FIRST, then diff the INDEX against HEAD. `git diff` alone only sees
# tracked files, so a state file that does not exist in git yet reports "no
# changes" and is silently never committed — which is exactly how the fixture
# cache failed to persist on its first real CI run (2026-09-10).
EXISTING=""
for f in "$@"; do [ -e "$f" ] && EXISTING="$EXISTING $f"; done
[ -n "$EXISTING" ] || { echo "ci-commit-push: none of the named files exist yet."; exit 0; }
# shellcheck disable=SC2086
git add -- $EXISTING

if git diff --cached --quiet; then
  echo "ci-commit-push: nothing changed."
  exit 0
fi

git commit -q -m "$MSG" || { echo "::error::ci-commit-push: commit failed."; exit 1; }

for attempt in 1 2 3; do
  if git push -q origin HEAD:main; then
    echo "ci-commit-push: pushed on attempt $attempt — $MSG"
    exit 0
  fi
  echo "ci-commit-push: push rejected (attempt $attempt); replaying onto origin/main."
  git fetch -q origin main || true
  if ! git rebase -q FETCH_HEAD; then
    # Content conflict with a concurrent writer. Leave NO half-applied rebase
    # behind — a conflicted tree would poison every later iteration of the loop.
    git rebase --abort 2>/dev/null || true
    git reset -q --hard FETCH_HEAD
    echo "::warning::ci-commit-push: concurrent writer conflicts with this capture. " \
         "Tree reset to origin/main; caller should recompute. Nothing was lost — " \
         "the capture is free to repeat."
    exit 3
  fi
done

echo "::error::ci-commit-push: could not push after 3 attempts — $MSG"
exit 1
