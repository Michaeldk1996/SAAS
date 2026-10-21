#!/usr/bin/env bash
# tools/land-check.sh — the full suite on a commit, in a CI-shaped clone, recorded for the pre-push hook.
#
# FOUNDER, 2026-10-21 (after 1a935c1b9 reached main with npm test red): "A note isn't a control." The Code gate
# (gate.yml) already stops a red commit from DEPLOYING; this + tools/git-hooks/pre-push stop it being PUSHED to main
# from this Mac. The Code gate stays the enforced backstop (a hook can be bypassed with --no-verify).
#
#   tools/land-check.sh [<rev>]      default HEAD
#
# Clones the repository fresh at <rev> (nothing from your working tree — uncommitted edits are NOT tested), runs
# `npm ci` and `npm test` with API_TENNIS_KEY unset (as CI does), writes the log, and — only on EXIT=0 — records <rev>
# in <git-common-dir>/land-checks.ok, which every worktree of this repository shares. Exit = npm test's exit status.
set -u
REV="${1:-HEAD}"
SHA="$(git rev-parse --verify --quiet "${REV}^{commit}")" || { echo "land-check: '${REV}' is not a commit." >&2; exit 2; }
COMMON="$(cd "$(git rev-parse --git-common-dir)" && pwd)"
TOP="$(git rev-parse --show-toplevel)"
DIR="$(mktemp -d "${TMPDIR:-/tmp}/land-check.XXXXXX")"
LOG="${COMMON}/land-checks/${SHA}.log"
mkdir -p "${COMMON}/land-checks"
echo "land-check: $(git log --oneline -1 "$SHA")"
echo "land-check: fresh clone in ${DIR}; log ${LOG}"
git clone -q --no-checkout "$TOP" "$DIR/repo" && git -C "$DIR/repo" checkout -q --detach "$SHA" || { echo "land-check: clone failed." >&2; rm -rf "$DIR"; exit 2; }
(
  cd "$DIR/repo" || exit 2
  { echo "commit ${SHA}"; date -u +"started %Y-%m-%dT%H:%M:%SZ"; } > "$LOG"
  npm ci --silent >> "$LOG" 2>&1 || { echo "EXIT=npm-ci-failed" >> "$LOG"; exit 3; }
  env -u API_TENNIS_KEY npm test >> "$LOG" 2>&1
  rc=$?
  echo "EXIT=${rc}" >> "$LOG"
  exit "$rc"
)
RC=$?
rm -rf "$DIR"
if [ "$RC" -eq 0 ]; then
  echo "${SHA} $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "${COMMON}/land-checks.ok"
  echo "land-check: EXIT=0 — ${SHA:0:9} recorded; the pre-push hook will accept it (and later commits that change only data files)."
else
  echo "land-check: EXIT=${RC} — NOT recorded. Failures:" >&2
  grep -nE '^✖|^  FAIL |^FAIL' "$LOG" | head -20 >&2
fi
exit "$RC"
