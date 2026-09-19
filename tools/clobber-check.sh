#!/usr/bin/env bash
# TEN-225 item 7 — the clobber check, for ANY agent landing ANY change.
#
# FOUNDER, 2026-09-19: "The stale-blob audit: accepted, and you are right that
# self-healing is luck. Make the clobber check standard for every land, not just
# yours, and say what it would take for another task's agent to run it too."
#
# THE FAILURE IT PREVENTS. Concurrent runs share ONE checkout at
# /Users/Michael/bsp-consult-project. If you edit a file there, land a
# whole-file blob from it, and someone else has moved that file since your
# checkout was current, your blob SILENTLY REVERTS their commit. It is not a
# conflict — git is doing exactly what it was told. On 2026-09-19 commit
# 1d6c042f reverted the founder's Underway-chip removal AND a TEN-206 fetch that
# nobody noticed for a day, and 46f44a15 had clobbered TEN-225 four hours
# earlier. Over 2026-09-11..19 the signature fires 20 times across TEN-210,
# TEN-228, TEN-207, TEN-206 and TEN-225.
#
# Every one of those self-healed, because these files churn fast enough to be
# overwritten before anyone noticed. That is luck, not a mechanism. This is the
# mechanism.
#
# ── WHAT ANOTHER AGENT NEEDS TO RUN IT ───────────────────────────────────────
# Nothing but bash and git. No install, no secrets, no network beyond the fetch,
# no Python, no node. Two arguments:
#
#   tools/clobber-check.sh <base> <file> [<file> ...]
#
#   <base>  the commit your edits are based on — the checkout you actually read
#           and modified. `git rev-parse HEAD` at the moment you started, or the
#           base of your `git worktree add --detach`.
#   <file>  every file your commit will write.
#
# Exit 0: none of your files moved under you. Land.
# Exit 1: at least one did. DO NOT LAND — rebase onto the new tip and replay.
#
# It runs `git fetch` first, because a check against a stale origin/main is the
# same false all-clear it exists to prevent.
#
# ── HOW TO MAKE THE REBASE CHEAP ─────────────────────────────────────────────
# A hit here is only expensive if your change lives in your fingers. Express it
# as a replayable patch script with exact-match anchors (see
# ten225-apply-0919d.py) and a rebase is one command: make a fresh worktree at
# the new origin/main and re-run the script. The script must test the RESULT
# before the anchor, or a replay double-applies any edit that inserts before an
# anchor it keeps.
set -u

if [ "$#" -lt 2 ]; then
  echo "usage: tools/clobber-check.sh <base-commit> <file> [<file> ...]" >&2
  exit 2
fi

BASE="$1"; shift

if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "::error:: '${BASE}' is not a commit in this repository." >&2
  exit 2
fi

git fetch origin --quiet || {
  echo "::error:: git fetch failed — refusing to check against a stale origin/main." >&2
  exit 2
}

TIP="$(git rev-parse origin/main)"
echo "clobber check: base $(git rev-parse --short "$BASE") -> origin/main $(git rev-parse --short "$TIP")"

if [ "$(git rev-parse "$BASE")" = "$TIP" ]; then
  echo "  origin/main has not moved. Clear to land."
  exit 0
fi

# The files that moved on main since your base, intersected with the files you
# are about to write. `git diff --name-only` between two commits is exact: it
# needs no merge and no working tree, so this is safe to run from a worktree or
# from a shared checkout somebody else is mutating.
MOVED="$(git diff --name-only "$BASE" "$TIP")"

HITS=0
for f in "$@"; do
  if printf '%s\n' "$MOVED" | grep -Fxq -- "$f"; then
    echo "  CONFLICT  $f"
    # Name who moved it, so the report can say whose work you were about to
    # revert rather than just that something happened.
    git log --oneline "$BASE..$TIP" -- "$f" | sed 's/^/              /'
    HITS=$((HITS + 1))
  else
    echo "  clear     $f"
  fi
done

if [ "$HITS" -gt 0 ]; then
  cat >&2 <<EOF

::error:: ${HITS} file(s) moved under you since ${BASE}.
Landing now would silently revert the commits listed above.
Rebase: make a fresh worktree at origin/main, replay your patch, re-run this.
EOF
  exit 1
fi

echo "  no file in this commit moved on main. Clear to land."
exit 0
