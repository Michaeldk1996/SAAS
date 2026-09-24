#!/usr/bin/env bash
# TEN-273 — the suite receipt a deploy-lane claim requires.
#
#   tools/ci-suite.sh <sha>
#
# Runs `npm test` on exactly <sha> in a CI-SHAPED checkout — a fresh
# `git clone --depth 100` from GitHub, gitignored stores absent — and, ONLY if
# the suite exits 0, writes a receipt to $SUITE_RECEIPTS_DIR/<full-sha>.json
# (default ~/.stennisfy/suite-receipts). `node tools/deploy-lane.mjs claim` and
# `ready` refuse (exit 7) without a green receipt for the sha they are given.
#
# FOUNDER, 2026-09-19: "You've broken the deploy three times today and all three
# were the same shape: your checkout had something CI doesn't." Every step below
# is a trap that has already bitten (TEN-270, 2026-09-24):
#   - a FAILED clone ran the WRONG suite green in the scaffold → the clone is
#     verified (kibl-stream/ present, pwd and HEAD are the clone) before npm test;
#   - an EMPTY clone target cloned a repo INTO the worktree → paths are assigned
#     on their own line and guarded non-empty;
#   - a piped exit code masked a red suite → output goes to a log file and the
#     exit code is read on its own line;
#   - a node_modules symlink reached main → it is made in the THROWAWAY clone only.
# The commit may not be on GitHub yet, so it is fetched into the clone from the
# local repository.
#
# Exit: the suite's own exit code; 2 usage / setup failure (no receipt written).
# Test-only overrides: CI_SUITE_CLONE_URL, CI_SUITE_NODE_MODULES.
set -u

# Every exit prints EXIT and the log path, including setup failures.
LOG="(none — the suite did not run)"
fail() { echo "::error:: $1" >&2; echo "EXIT=2"; echo "log: $LOG"; exit 2; }

SHA_ARG="${1:-}"
if [ -z "$SHA_ARG" ]; then
  echo "usage: tools/ci-suite.sh <sha>" >&2
  exit 2
fi

REPO="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$REPO" ] || fail "not inside a git repository"
SHA="$(git -C "$REPO" rev-parse --verify --quiet "${SHA_ARG}^{commit}")"
[ -n "$SHA" ] || fail "'${SHA_ARG}' is not a commit in ${REPO}"
TREE="$(git -C "$REPO" rev-parse "${SHA}^{tree}")"
[ -n "$TREE" ] || fail "no tree for $SHA"

URL="${CI_SUITE_CLONE_URL:-https://github.com/Michaeldk1996/SAAS.git}"
NODE_MODULES="${CI_SUITE_NODE_MODULES:-/Users/Michael/bsp-consult-project/node_modules}"
RECEIPTS="${SUITE_RECEIPTS_DIR:-$HOME/.stennisfy/suite-receipts}"
[ -n "$RECEIPTS" ] || fail "no receipts dir"
mkdir -p "$RECEIPTS/logs" || fail "cannot create $RECEIPTS/logs"

D="$(mktemp -d "${TMPDIR:-/tmp}/ci-suite.XXXXXX")"
[ -n "$D" ] || fail "mktemp gave no path"
[ -d "$D" ] || fail "$D is not a directory"
D="$(cd "$D" && pwd -P)"
[ -n "$D" ] || fail "could not resolve the clone dir"
LOG="$RECEIPTS/logs/${SHA}-$(date -u +%Y%m%dT%H%M%SZ).log"
[ -n "$LOG" ] || fail "no log path"
trap 'rm -rf "$D"' EXIT

STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

git clone -q --depth 100 "$URL" "$D"
CLONE=$?
[ "$CLONE" -eq 0 ] || fail "clone failed (exit $CLONE); no suite run"
[ -d "$D/kibl-stream" ] || fail "$D has no kibl-stream/ — not a clone of the product repo"
[ "$(git -C "$D" rev-parse --show-toplevel)" = "$D" ] || fail "$D is not the clone's top level"

git -C "$D" fetch -q "$REPO" "$SHA" || fail "could not fetch $SHA from $REPO into the clone"
git -C "$D" checkout -q --detach "$SHA" || fail "could not check out $SHA in the clone"
[ "$(git -C "$D" rev-parse HEAD)" = "$SHA" ] || fail "clone HEAD is not $SHA"
[ -d "$D/kibl-stream" ] || fail "$SHA has no kibl-stream/"

ln -s "$NODE_MODULES" "$D/node_modules" || fail "could not link node_modules into the clone"

cd "$D" || fail "cannot cd into $D"
echo "pwd:  $(pwd -P)"
echo "HEAD: $(git rev-parse HEAD)"
echo "running npm test (log: $LOG) ..."
npm test > "$LOG" 2>&1
EXIT=$?
FINISHED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [ "$EXIT" -eq 0 ]; then
  TMP="$RECEIPTS/.${SHA}.$$.tmp"
  printf '{\n  "sha": "%s",\n  "tree": "%s",\n  "exit": %d,\n  "startedAt": "%s",\n  "finishedAt": "%s",\n  "log": "%s"\n}\n' \
    "$SHA" "$TREE" "$EXIT" "$STARTED" "$FINISHED" "$LOG" > "$TMP" && mv "$TMP" "$RECEIPTS/$SHA.json"
  echo "receipt: $RECEIPTS/$SHA.json"
else
  echo "suite RED — no receipt written"
fi
echo "EXIT=$EXIT"
echo "log: $LOG"
exit "$EXIT"
