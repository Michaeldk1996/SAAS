#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# TEN-255 — "am I measuring my own build?"
#
#   tools/check-live-build.sh            # just print what is live
#   tools/check-live-build.sh <sha>      # and check <sha> reached the live site
#
# Exit codes, and they are three on purpose:
#   0  the live build CONTAINS your commit (equal, or your commit is an ancestor)
#   1  MISMATCH — the live build does not contain your commit
#   2  UNDETERMINED — could not read the live stamp at all
#
# 2 is not 1 and neither is 0. CLAUDE.md's rule is that a build you cannot
# identify is a dash, not a pass and not a regression; collapsing 2 into 1 would
# report a perfectly good deploy as broken every time the network hiccups.
#
# WHY ANCESTRY, NOT EQUALITY
# build-info.json's `commit` is the tip of main at BUILD time, not the commit
# that changed the frontend. Data commits land on main every few minutes and the
# pipeline re-points every tick at the newest tip, so within ~10-15 minutes of
# your deploy the next tick stamps a NEWER sha over a site that still contains
# your bytes. Equality goes false while the deploy is entirely good. The question
# that actually matters is "did my commit make it in", and that is ancestry.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

SITE="${SITE_URL:-https://michaeldk1996.github.io/SAAS}"
EXPECTED="${1:-}"

RAW=$(curl -fsS --max-time 20 "$SITE/build-info.json" 2>/dev/null)
if [ -z "$RAW" ]; then
  echo "UNDETERMINED: could not fetch $SITE/build-info.json"
  echo "  Treat every probe result against this site as unverified. This is a dash, not a pass."
  exit 2
fi

# Parse with node, not grep: a 404 HTML body or a truncated response must land in
# UNDETERMINED rather than being pattern-matched into a confident wrong answer.
LIVE=$(printf '%s' "$RAW" | node -e '
  let s = "";
  process.stdin.on("data", d => s += d);
  process.stdin.on("end", () => {
    let j;
    try { j = JSON.parse(s); } catch { process.exit(3); }
    if (!/^[0-9a-f]{40}$/.test(j.commit || "")) process.exit(3);
    console.log(j.commit);
  });
') || {
  echo "UNDETERMINED: $SITE/build-info.json did not parse as a build stamp carrying a 40-char commit."
  echo "--- body (first 300 bytes) ---"
  printf '%s' "$RAW" | head -c 300; echo
  exit 2
}

echo "live build-info.json:"
printf '%s\n' "$RAW"
echo
echo "live commit:  $LIVE"

if [ -z "$EXPECTED" ]; then
  exit 0
fi

echo "your commit:  $EXPECTED"

# Resolve whatever the caller passed (short sha, branch, HEAD) to a full sha.
FULL=$(git rev-parse --verify --quiet "${EXPECTED}^{commit}" 2>/dev/null)
if [ -z "$FULL" ]; then
  echo "UNDETERMINED: $EXPECTED does not resolve to a commit in this checkout."
  exit 2
fi

if [ "$FULL" = "$LIVE" ]; then
  echo "MATCH: the live build IS your commit."
  exit 0
fi

# Ancestry needs the live object locally; it may be newer than anything fetched.
# Fetch only if it is actually missing — an unconditional fetch here would put a
# network round trip on every call, including the offline test path below.
if ! git cat-file -e "${LIVE}^{commit}" 2>/dev/null; then
  git fetch --quiet --depth=100 origin main 2>/dev/null
fi

if ! git cat-file -e "${LIVE}^{commit}" 2>/dev/null; then
  echo "UNDETERMINED: the live commit $LIVE is not in this checkout, so ancestry cannot be decided."
  echo "  Fetch it and re-run, or treat this as a dash."
  exit 2
fi

if git merge-base --is-ancestor "$FULL" "$LIVE" 2>/dev/null; then
  AHEAD=$(git rev-list --count "$FULL..$LIVE" 2>/dev/null || echo "?")
  echo "CONTAINED: your commit is an ancestor of the live build ($AHEAD commit(s) later)."
  echo "  The live site includes your bytes. Safe to measure."
  exit 0
fi

echo "MISMATCH: the live build does NOT contain your commit."
echo "  You are measuring another build. Do not report a pass, a fail, or a regression against it."
exit 1
