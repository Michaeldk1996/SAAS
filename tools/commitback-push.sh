#!/usr/bin/env bash
# Commit + push one post-deploy ledger from pipeline.yml, surviving concurrent pushes.
#
#   tools/commitback-push.sh "<commit message>" file1 [file2 ...]
#
# The caller sets the git identity and decides whether there is anything to commit.
#
# Exit codes:
#   0  pushed
#   1  could not push after every attempt (a race we lost, not a corrupted tree)
#   2  the tree is corrupted: a file a commit-back step OWNS came back unmerged
#
# WHY THIS EXISTS — TEN-267, run 4440 (35864075513), 2026-09-23.
# The pipeline leaves its whole build output dirty in the tree after the deploy and
# never commits most of it; matches.json is the big one. The commit-back loops rebase
# with --autostash (TEN-170), which stashes that dirty tree and re-applies it on top
# of the new origin/main. matches.json on main is ALSO committed by bsp-odds-bot on
# every odds-now tick (93 commits in the 36 h to 13:21Z; ci-commit-push.sh). So when
# a tick lands between our checkout and our push, the autostash re-apply is a
# three-way merge of OUR uncommitted rebuild against THEIR committed tick, and when
# the hunks overlap it conflicts. Run 4440: attempt 1 re-applied cleanly, attempt 2
# (after tick 3, 2d61a06c) conflicted, and TEN-247's unmerged check failed the step.
#
# The rebase itself never conflicted: the commit being replayed only touches its own
# ledger. The conflict is always in a file this job does NOT commit. Its copy of that
# file already shipped in the Pages artifact, and nothing after the deploy reads it,
# so the deterministic resolution is to TAKE MAIN'S SIDE (the committed version) for
# every unmerged path. That keeps the other writer's commit and loses nothing we were
# going to keep.
#
# The exception is a file a commit-back step owns (COMMITBACK_OWNED). Those have one
# writer, this job, serialised by the bsp-pipeline concurrency group, so they cannot
# conflict with a concurrent push. If one ever does, taking main's side would drop
# this run's ledger rows without a word, so that stays a hard failure (exit 2).
set -uo pipefail

MSG="${1:?commit message required}"; shift
[ "$#" -gt 0 ] || { echo "::error::commitback-push: no files given"; exit 1; }
OWNED="${COMMITBACK_OWNED:-admin-log.json series-outcomes.json player-profiles-cache.json.gz player-tournament-history.json.gz historical-match-stats.floor.json}"

git add -- "$@"
git commit -q -m "$MSG" || { echo "::error::commitback-push: commit failed."; exit 1; }

# Resolve any path the autostash re-apply left unmerged. Returns 2 on an owned path.
resolve_unmerged() {
  local unmerged owned f o
  unmerged="$(git diff --name-only --diff-filter=U)"
  [ -n "$unmerged" ] || return 0
  owned=""
  while IFS= read -r f; do
    for o in $OWNED; do [ "$f" = "$o" ] && owned="$owned $f"; done
  done <<< "$unmerged"
  if [ -n "$owned" ]; then
    echo "::error::commitback-push: a commit-back-owned file came back unmerged:$owned. Refusing to pick a side."
    return 2
  fi
  # Reset the index first: a conflicted stash apply STAGES its clean paths, and the
  # next step's `git commit` would otherwise push this run's whole build output.
  git reset -q
  while IFS= read -r f; do git checkout -q HEAD -- "$f"; done <<< "$unmerged"
  echo "commitback-push: autostash conflicted with a concurrent writer on:" $unmerged
  echo "commitback-push: took main's committed side (this job never commits them; its copy already deployed)."
  return 0
}

for attempt in 1 2 3; do
  if git push -q origin HEAD:main; then echo "Pushed on attempt $attempt."; exit 0; fi
  echo "Push rejected (attempt $attempt) - rebasing."
  git pull -q --rebase --autostash origin main || true
  if [ -d "$(git rev-parse --git-path rebase-merge)" ] || [ -d "$(git rev-parse --git-path rebase-apply)" ]; then
    # The COMMIT itself conflicted - a concurrent writer committed our own ledger.
    git rebase --abort 2>/dev/null || true
    echo "::error::commitback-push: the rebase of '$MSG' itself conflicted; aborted it."
    exit 2
  fi
  # A conflicted autostash still prints "Successfully rebased" and exits 0 (TEN-247),
  # so the unmerged check is the only reliable signal.
  resolve_unmerged || exit $?
done

# Three pushes, three rebases: the last rebase has not been pushed yet.
if git push -q origin HEAD:main; then echo "Pushed on the final replay."; exit 0; fi
echo "::error::commitback-push: could not push after 3 attempts - $MSG"
exit 1
