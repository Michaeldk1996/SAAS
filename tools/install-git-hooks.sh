#!/usr/bin/env bash
# Installs the repository's git hooks (tools/git-hooks/) for this checkout AND every worktree. Founder ruling
# 2026-10-21: pre-push gate for main (see tools/git-hooks/pre-push).
# The hooks are COPIED into the shared git directory (<git-common-dir>/stennisfy-hooks) and core.hooksPath points
# there (absolute): a relative hooksPath resolves inside each worktree's own checkout, so a worktree on an older commit
# (no tools/git-hooks/ yet) would silently run no hook. Re-run after the hook changes. Idempotent.
set -eu
TOP="$(git rev-parse --show-toplevel)"
COMMON="$(cd "$(git rev-parse --git-common-dir)" && pwd)"
DEST="${COMMON}/stennisfy-hooks"
mkdir -p "$DEST"
cp "${TOP}/tools/git-hooks/"* "$DEST/"
chmod +x "$DEST/"*
git config core.hooksPath "$DEST"
echo "core.hooksPath = $(git config --get core.hooksPath) — shared by every worktree of ${COMMON}"
ls -1 "$DEST" | sed 's/^/  installed: /'
