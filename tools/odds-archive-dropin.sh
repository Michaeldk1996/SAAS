#!/usr/bin/env bash
# TEN-262 — the odds-archive DROP-IN job.
#
# tennis-data.co.uk blocks automated downloads (Cloudflare 403 for GitHub runners,
# TCP refused from this Mac), so the founder downloads the season workbook by hand and
# drops it here:
#
#     ~/Stennisfy/odds-archive-inbox/2026.xlsx
#
# launchd (com.stennisfy.odds-archive-dropin, WatchPaths on that folder) then runs this
# script, which does what an agent landing a change must do:
#
#   1. fresh `git clone --depth 100` of main + `npm ci`
#   2. tools/odds-archive-refresh.py  (validate → merge → never-thinner → log)
#   3. rebuild the committed readers of the archive: database-yield*.json and
#      tournament-market.json (the ROI cards must equal the panel they open)
#   4. full `npm test`, exit code read from the log
#   5. get the commit READY before touching the lane (TEN-273): rebase onto origin/main,
#      then tools/ci-suite.sh <sha> for the suite receipt; claim the lane with
#      --sha <sha> --reviewed (first come, first served: waits on exit 3; exit 7 →
#      re-prepare, still claiming); if a CODE commit lands after the claim, release,
#      re-prepare and claim again; land ONLY through tools/deploy-batch.mjs --sha <claimed>
#      (the one enforced path: the claimed, suite-green sha, over [skip ci] data commits
#      only); then `confirm-live` on its read-back sha in the poll loop: it releases the
#      lane the moment the live build contains the commit
#
# Each run claims as its own session (session:ODDS-ARCHIVE-<stamp>), so a run that dies
# holding the lane is NEVER silently inherited by the next one. A session holder cannot
# be confirmed dead; the 40-min hold cap (extended only while its own pipeline run is in
# progress) frees it. `--reviewed` is this job's standing attestation: its only change is
# the output of the founder-reviewed refresh + builders above, validated and
# never-thinner-guarded, and the full suite is green on it.
#
# Outcome of every run: ~/Stennisfy/odds-archive-inbox/LAST-RUN.txt, a macOS
# notification, and ~/.stennisfy/odds-archive-dropin/dropin.log. The workbook moves to
# processed/ (merged, or nothing new) or rejected/ (with the reason) — never deleted. A
# run that FAILS for an infrastructure reason leaves the workbook in the inbox and is not
# retried on the same file until the file is saved again (no retry storm).
#
# Manual run (same thing launchd does):   bash tools/odds-archive-dropin.sh
# Install / reinstall the launchd agent:  bash tools/odds-archive-dropin.sh --install
set -uo pipefail

INBOX="${ODDS_INBOX:-$HOME/Stennisfy/odds-archive-inbox}"
STATE="$HOME/.stennisfy/odds-archive-dropin"
WORK="$HOME/.stennisfy/odds-archive-work"
REPO_URL="${ODDS_REPO_URL:-https://github.com/Michaeldk1996/SAAS.git}"   # override only to test the job
LABEL="com.stennisfy.odds-archive-dropin"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$INBOX/processed" "$INBOX/rejected" "$STATE" "$WORK"
log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$STATE/dropin.log"; echo "$*"; }
notify() {
  printf '%s\n%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" > "$INBOX/LAST-RUN.txt"
  local msg="${1//\"/}"
  /usr/bin/osascript -e "display notification \"$msg\" with title \"Stennisfy odds archive\"" >/dev/null 2>&1 || true
  log "$1"
}

if [ "${1:-}" = "--install" ]; then
  mkdir -p "$HOME/.stennisfy/bin" "$HOME/Library/LaunchAgents"
  cp "$0" "$HOME/.stennisfy/bin/odds-archive-dropin.sh" && chmod +x "$HOME/.stennisfy/bin/odds-archive-dropin.sh"
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$HOME/.stennisfy/bin/odds-archive-dropin.sh</string></array>
  <key>WatchPaths</key><array><string>$INBOX</string></array>
  <key>StandardOutPath</key><string>$STATE/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$STATE/launchd.err.log</string>
</dict></plist>
PLIST
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST" && echo "installed: drop a season workbook (e.g. 2026.xlsx) into $INBOX"
  exit $?
fi

# One run at a time. mkdir is atomic; a lock older than 6 h is from a dead run.
LOCK="$STATE/lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +360 2>/dev/null)" ]; then rm -rf "$LOCK"; mkdir "$LOCK" || exit 0; else exit 0; fi
fi
LANE_HELD=0; TICKET=""; REPO=""
cleanup() {
  if [ "$LANE_HELD" = 1 ] && [ -n "$REPO" ]; then (cd "$REPO" && node tools/deploy-lane.mjs release --ticket "$TICKET" >> "$STATE/dropin.log" 2>&1); fi
  rm -rf "$LOCK"
}
trap cleanup EXIT

# Old run directories (clone + node_modules, ~330 MB each) go after 7 days.
find "$WORK" -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf {} + 2>/dev/null

shopt -s nullglob
pick() {   # newest workbook that has not already failed in its current form
  local f fp files=( "$INBOX"/*.xlsx )
  [ ${#files[@]} -eq 0 ] && return 1
  while IFS= read -r f; do
    fp="$(shasum -a 256 "$f" | cut -c1-16)-$(stat -f %m "$f")"
    [ -e "$STATE/failed-$fp" ] && continue
    echo "$f"; return 0
  done < <(ls -t "${files[@]}")
  return 1
}
F="$(pick)" || exit 0
NAME="$(basename "$F")"

# Wait until the file has stopped growing (a browser may still be writing it).
prev=-1; for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  size=$(stat -f %z "$F" 2>/dev/null || echo 0); [ "$size" = "$prev" ] && [ "$size" -gt 0 ] && break; prev=$size; sleep 5
done
FP="$(shasum -a 256 "$F" | cut -c1-16)-$(stat -f %m "$F")"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TICKET="ODDS-ARCHIVE-$STAMP"
RUN="$WORK/$STAMP"; REPO="$RUN/repo"; mkdir -p "$RUN"
next() {   # hand over to the next workbook waiting in the inbox, if any
  rm -rf "$REPO"
  if pick >/dev/null; then trap - EXIT; cleanup; exec /bin/bash "$0"; fi
}
reject() {
  mv "$F" "$INBOX/rejected/$STAMP-$NAME"
  for x in refresh.json refresh.err; do [ -f "$RUN/$x" ] && cp "$RUN/$x" "$INBOX/rejected/$STAMP-$x"; done
  notify "REJECTED $NAME — $1. The published archive is unchanged. Details: rejected/$STAMP-refresh.json"
  next; exit 1
}
failed() {
  touch "$STATE/failed-$FP"
  notify "FAILED on $NAME — $1. The published archive is unchanged; the workbook stays in the inbox and is retried when it is saved again. Details: $RUN"
  exit 1
}
renew() { [ "$LANE_HELD" = 1 ] && { node tools/deploy-lane.mjs renew --ticket "$TICKET" >> "$RUN/lane.log" 2>&1 || log "lane renew failed (see $RUN/lane.log)"; }; return 0; }
suite() {  # $1 = log name
  renew
  npm test > "$RUN/$1" 2>&1; echo "suite_exit=$?" >> "$RUN/$1"
  renew
  grep -q '^suite_exit=0$' "$RUN/$1"
}

log "run $STAMP: $NAME ($FP)"
git clone -q --depth 100 "$REPO_URL" "$REPO" || failed "git clone"
cd "$REPO" || failed "cd"
BASE="$(git rev-parse HEAD)"
npm ci > "$RUN/npmci.log" 2>&1; echo "npmci_exit=$?" >> "$RUN/npmci.log"
grep -q '^npmci_exit=0$' "$RUN/npmci.log" || failed "npm ci"

python3 tools/odds-archive-refresh.py --file "$F" > "$RUN/refresh.json" 2> "$RUN/refresh.err"; rc=$?
[ $rc -eq 3 ] && reject "validation: $(tail -1 "$RUN/refresh.err")"
[ $rc -eq 1 ] && reject "never-thinner guard: $(tail -1 "$RUN/refresh.err")"
[ $rc -ne 0 ] && failed "refresh exited $rc: $(tail -1 "$RUN/refresh.err")"
read -r SEASON ADDED CHANGED LATEST BEFORE AFTER < <(python3 -c "import json;d=json.load(open('$RUN/refresh.json'));print(d['season'],d['added'],d['changed'],d['latestDate'],d['rowsBefore'],d['rowsAfter'])")
python3 -c "import json;print(json.dumps(json.load(open('$RUN/refresh.json'))))" >> "$STATE/refresh-history.jsonl"
if [ "$ADDED" = 0 ] && [ "$CHANGED" = 0 ]; then
  mv "$F" "$INBOX/processed/$STAMP-$NAME"
  notify "No new rows in $NAME — the archive already runs through $LATEST ($AFTER rows). Nothing pushed."
  next; exit 0
fi

node build-database-yield.js > "$RUN/build.log" 2>&1 || failed "build-database-yield.js"
node build-tournament-market.js >> "$RUN/build.log" 2>&1 || failed "build-tournament-market.js"
suite suite.log || failed "full suite red (see suite.log)"

OUT=( "odds-archive/$SEASON.csv" odds-archive/refresh-log.jsonl database-yield.json database-yield-players.json tournament-market.json )
git add -- "${OUT[@]}" || failed "git add"
git -c user.name=bsp-ceo-bot -c user.email=bsp-ceo-bot@users.noreply.github.com commit -q \
  -m "odds-archive: refresh $SEASON from tennis-data drop-in (+$ADDED rows, $CHANGED changed, through $LATEST)" || failed "git commit"

# Ready before the lane (TEN-273): rebased, then a suite receipt (tools/ci-suite.sh, a fresh
# CI-shaped clone) for exactly this sha. The in-place `npm test` above is not a receipt.
ready_receipt() {
  git fetch -q origin main || failed "git fetch origin main"
  git rebase -q origin/main || { git rebase --abort; failed "rebase onto origin/main"; }
  bash tools/ci-suite.sh "$(git rev-parse HEAD)" > "$RUN/ci-suite-$(date -u +%H%M%S).log" 2>&1 || failed "tools/ci-suite.sh red or failed (see $RUN/ci-suite-*.log)"
}
code_landed() {  # a CODE commit on origin/main that $1 lacks (data bots mark [skip ci] in the subject)
  git fetch -q origin main || return 0
  git log --format=%s "$1..origin/main" | grep -qv '\[skip ci\]'
}
ready_receipt

# Lane (TEN-273): claim the receipted sha — first come, first served: exit 3 = not our turn yet
# (up to 3 h); exit 7 = not ready (re-prepare, still claiming). Land ONLY through
# tools/deploy-batch.mjs --sha <claimed>: it pushes nothing but the claimed, suite-green sha,
# rebasing over [skip ci] data commits only, with the clobber check re-run. If a CODE commit
# lands after the claim, the claimed sha is no longer the tested tree: release, re-prepare
# (rebase + a new receipt) and claim again, at the back of the queue.
git config credential.helper osxkeychain   # this throwaway clone only: deploy-batch pushes through it
export GIT_TERMINAL_PROMPT=0
landed=0
for attempt in 1 2 3; do
  CLAIMED="$(git rev-parse HEAD)"
  errs=0; notready=0; LANE_HELD=0
  for _ in $(seq 1 40); do
    node tools/deploy-lane.mjs claim --ticket "$TICKET" --sha "$CLAIMED" --reviewed >> "$RUN/lane.log" 2>&1; lc=$?
    [ $lc -eq 0 ] && { LANE_HELD=1; break; }
    if [ $lc -eq 6 ] && [ $errs -lt 2 ]; then errs=$((errs + 1)); sleep 30; continue; fi
    if [ $lc -eq 7 ] && [ $notready -lt 3 ]; then notready=$((notready + 1)); ready_receipt; CLAIMED="$(git rev-parse HEAD)"; continue; fi
    [ $lc -ne 3 ] && failed "deploy lane refused (exit $lc, see lane.log)"
    sleep 270
  done
  [ "$LANE_HELD" = 1 ] || failed "deploy lane not granted after 3 h"
  log "lane claimed as session:$TICKET for $CLAIMED"
  if code_landed "$CLAIMED"; then
    log "a code commit landed after the claim: release, re-prepare, claim again"
    node tools/deploy-lane.mjs release --ticket "$TICKET" >> "$RUN/lane.log" 2>&1; LANE_HELD=0
    ready_receipt; continue
  fi
  bash tools/clobber-check.sh "$BASE" "${OUT[@]}" > "$RUN/clobber.log" 2>&1 || failed "clobber check: another commit moved an archive file"
  node tools/deploy-batch.mjs --ticket "$TICKET" --sha "$CLAIMED" > "$RUN/batch-$attempt.json" 2>> "$RUN/batch.log"; bc=$?
  if [ $bc -eq 0 ]; then landed=1; break; fi
  node tools/deploy-lane.mjs release --ticket "$TICKET" >> "$RUN/lane.log" 2>&1; LANE_HELD=0
  code_landed "$CLAIMED" || failed "deploy-batch refused (exit $bc, see batch-$attempt.json)"
  ready_receipt
done
[ $landed = 1 ] || failed "could not land after 3 attempts (code kept landing on main)"
SHA="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).readBack || "")' "$RUN/batch-$attempt.json")"
[ -n "$SHA" ] || failed "deploy-batch printed no readBack sha"
log "pushed; read-back sha $SHA"

# Live check: the build must CONTAIN our commit. `confirm-live` runs
# tools/check-live-build.sh and releases the lane the moment it does (TEN-273:
# the lane covers deploying only); exit 3 = not live yet, still holding.
live=2; t=0
while [ $t -lt 45 ]; do
  node tools/deploy-lane.mjs confirm-live --ticket "$TICKET" --sha "$SHA" > "$RUN/live.log" 2>&1; cl=$?
  if [ $cl -eq 0 ]; then live=0; LANE_HELD=0; break; fi
  [ $cl -eq 1 ] && { LANE_HELD=0; bash tools/check-live-build.sh "$SHA" >> "$RUN/live.log" 2>&1; live=$?; [ $live -eq 0 ] && break; }
  sleep 60; t=$((t + 1))
done
[ "$LANE_HELD" = 1 ] && node tools/deploy-lane.mjs release --ticket "$TICKET" >> "$RUN/lane.log" 2>&1 && LANE_HELD=0
mv "$F" "$INBOX/processed/$STAMP-$NAME"
if [ $live -eq 0 ]; then
  notify "Merged $NAME: $BEFORE → $AFTER rows (+$ADDED, $CHANGED changed), through $LATEST. Live in build ${SHA:0:8}."
else
  notify "Merged and pushed $NAME ($BEFORE → $AFTER rows, through $LATEST) as ${SHA:0:8}, but the live build could not be confirmed within 45 min (check-live-build exit $live)."
fi
next
exit 0
