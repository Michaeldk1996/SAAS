#!/usr/bin/env bash
# tools/prune-agent-space.sh — what agent work leaves on this Mac, and what is safe to remove (founder 2026-10-22).
#
#   tools/prune-agent-space.sh            REPORT ONLY (the default; what the daily LaunchAgent runs): nothing is deleted
#   tools/prune-agent-space.sh --apply    delete what the report marks safe — only once the founder approves deletion
#
# Safe = ALL of: nothing inside changed for AGE (7 days; TMPDIR test folders 48 h), no process has a file open in it, and
# for a git worktree: no uncommitted or untracked changes and no commit missing from origin. A worktree that holds
# work is LISTED, never removed. Never touched: the main checkout, tool caches (~/.npm, ~/.cache, ~/.claude), Paperclip's
# own data (~/.paperclip/instances/*/data). Everything is re-checked at deletion time.
# Output: one TSV row per item (status, path, KB, reason) + a summary; REPORT_DIR gets a dated copy.
# Overrides (tests): PRUNE_REPO, PRUNE_STENNISFY, PRUNE_TMPDIR, PRUNE_AGE_DAYS, PRUNE_TMP_AGE_HOURS, REPORT_DIR.
set -u
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
REPO="${PRUNE_REPO:-/Users/Michael/bsp-consult-project}"
STEN="${PRUNE_STENNISFY:-$HOME/.stennisfy}"
TMPD="${PRUNE_TMPDIR:-${TMPDIR:-/tmp}}"; TMPD="${TMPD%/}"
AGE_D="${PRUNE_AGE_DAYS:-7}"
TMP_H="${PRUNE_TMP_AGE_HOURS:-48}"
REPORT_DIR="${REPORT_DIR:-$STEN/prune-reports}"
# real paths: git reports worktrees by their resolved path (/private/var/…), so every comparison uses resolved paths
real() { [ -d "$1" ] && (cd "$1" && pwd -P) || printf '%s\n' "$1"; }
REPO="$(real "$REPO")"; STEN="$(real "$STEN")"; TMPD="$(real "$TMPD")"
mkdir -p "$REPORT_DIR"
OUT="$REPORT_DIR/$(date -u +%Y-%m-%dT%H%MZ)-$([ $APPLY = 1 ] && echo applied || echo report).tsv"
: > "$OUT"
changed_within() { [ -n "$(find "$1" -newermt "-$2" -print -quit 2>/dev/null)" ]; }
open_files() { [ -n "$(lsof +D "$1" 2>/dev/null | awk 'NR>1{print $2}' | head -1)" ]; }
kb() { du -sk "$1" 2>/dev/null | cut -f1; }
row() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "${3:-0}" "$4" >> "$OUT"; }
gone() { if [ $APPLY = 1 ]; then rm -rf "${1:?}" && row deleted "$1" "$2" "$3"; else row safe "$1" "$2" "$3"; fi; }

# 1. git worktrees of the product repository (never the main checkout)
if git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$REPO" worktree list --porcelain | awk '/^worktree /{print substr($0,10)}' | while IFS= read -r w; do
    [ "$w" = "$REPO" ] && continue
    [ -d "$w" ] || continue
    k=$(kb "$w")
    if changed_within "$w" "${AGE_D} days"; then row keep "$w" "$k" "changed within ${AGE_D} days"; continue; fi
    if open_files "$w"; then row keep "$w" "$k" "open files"; continue; fi
    d=$(git -C "$w" status --porcelain 2>/dev/null | head -3 | tr '\n' ' ')
    if [ -n "$d" ]; then row LIST-uncommitted "$w" "$k" "$d"; continue; fi
    u=$(git -C "$w" rev-list HEAD --not --remotes=origin 2>/dev/null | wc -l | tr -d ' ')
    if [ "$u" != 0 ]; then row LIST-unpushed "$w" "$k" "$u commit(s) not on origin ($(git -C "$w" rev-parse --abbrev-ref HEAD))"; continue; fi
    if [ $APPLY = 1 ]; then
      if changed_within "$w" "${AGE_D} days" || open_files "$w" || [ -n "$(git -C "$w" status --porcelain 2>/dev/null | head -1)" ]; then row keep "$w" "$k" "changed during the run"; continue; fi
      git -C "$REPO" worktree remove "$w" 2>/dev/null && row deleted "$w" "$k" "worktree removed" || row keep "$w" "$k" "git worktree remove refused"
    else row safe "$w" "$k" "clean, pushed, idle > ${AGE_D} days"; fi
  done
  [ $APPLY = 1 ] && git -C "$REPO" worktree prune
fi
WTS="$(git -C "$REPO" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print substr($0,10)}')"

# 2. ~/.stennisfy task folders, suite clones, tmp (never te-cache, suite-receipts, the lane file, reports)
for d in "$STEN"/ci-tmp-* "$STEN"/ten* "$STEN"/tmp*; do
  [ -d "$d" ] || continue
  if printf '%s\n' "$WTS" | grep -q "^${d}/"; then row keep "$d" "$(kb "$d")" "holds a registered worktree (judged above)"; continue; fi
  k=$(kb "$d")
  if changed_within "$d" "${AGE_D} days" || open_files "$d"; then row keep "$d" "$k" "recent or open"; continue; fi
  if [ $APPLY = 1 ] && { changed_within "$d" "${AGE_D} days" || open_files "$d"; }; then row keep "$d" "$k" "changed during the run"; continue; fi
  gone "$d" "$k" "idle > ${AGE_D} days"
done

# 3. TMPDIR: test folders and suite shells (land-check.* / ci-suite.* only when nothing has them open)
for d in "$TMPD"/ten[0-9]* "$TMPD"/pubsplit-site-* "$TMPD"/te-* "$TMPD"/pcstore* "$TMPD"/hms-store* "$TMPD"/ci-suite.* "$TMPD"/land-check.* "$TMPD"/prepush-*; do
  [ -d "$d" ] || continue
  k=$(kb "$d")
  if changed_within "$d" "${TMP_H} hours" || open_files "$d"; then row keep "$d" "$k" "recent or open"; continue; fi
  gone "$d" "$k" "idle > ${TMP_H} h"
done

echo "prune-agent-space: $([ $APPLY = 1 ] && echo APPLIED || echo 'REPORT ONLY — nothing deleted')  ($OUT)"
awk -F'\t' '{n[$1]++; k[$1]+=$3} END{for(s in n) printf "  %-18s %6d item(s) %8.2f GB\n", s, n[s], k[s]/1048576}' "$OUT" | sort
