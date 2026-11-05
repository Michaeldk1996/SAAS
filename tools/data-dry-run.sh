#!/usr/bin/env bash
# tools/data-dry-run.sh — the data pipeline's fail-closed gates, run with THIS checkout's code against the DEPLOYED store
# (architecture program stage 5, 2026-11-05).
#
# Why: a code change that trips a data gate (the archive gate, the reconcile suite, the H2H reconciliation, the market
# shards, the Series row gate) used to be found by the data pipeline, on every run, and froze the site's data until a fix
# landed (incidents 2, 4, 6, 10, 12, 17 in architecture-review-report.md). gate.yml runs this script on every code push, so
# such a change fails the CODE gate instead, and pipeline.yml builds only with gated code (its "Code = the newest gated
# commit" step): the data keeps flowing on the last good code.
#
# Read-only toward every store: the archive exports are SELECTs (no `import-captured`), nothing is committed, uploaded or
# sent. Every output is written into this throwaway checkout and the store copy beside it.
#
# Usage: bash tools/data-dry-run.sh SITE_DIR
#   SITE_DIR = an unpacked `site-data` artifact (the store the live site was built from).
# Env: SUPABASE_URL, SUPABASE_SECRET_KEY (archive exports, SELECT only), API_TENNIS_KEY (the export's key refresh).
# Exit 0 = every gate green, or a part SKIPPED OUT LOUD (no store, no archive credentials, the archive unreachable — none
#          of them a verdict on the code); 1 = a gate went red on this code.
set -uo pipefail
SITE="${1:-}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
say() { echo "$*"; echo "$*" >> "$SUMMARY"; }
skip() { echo "::warning title=Data dry-run skipped::$*"; say "- SKIPPED: $*"; }
red=()
gate() {   # gate NAME CMD... : run one fail-closed gate; a non-zero exit is a red verdict on this code
  local name="$1"; shift
  echo "::group::$name"
  "$@"; local rc=$?
  echo "::endgroup::"
  if [ "$rc" -eq 0 ]; then say "- green: $name"; else say "- **RED: $name** (exit $rc)"; echo "::error title=Data dry-run::$name went red on this code (exit $rc)"; red+=("$name"); fi
  return 0
}

say "### Data dry-run (stage 5): this code against the deployed store"
if [ -z "$SITE" ] || [ ! -d "$SITE" ] || [ ! -f "$SITE/build-info.json" ]; then
  skip "no deployed store to read (no site-data artifact in the last day) — nothing was checked"
  exit 0
fi
say "- store: $(node -e 'const b=require(require("path").resolve(process.argv[1],"build-info.json"));console.log(`data run ${b.runNumber||"?"}, built ${b.builtAt||"?"}`)' "$SITE" 2>/dev/null || echo '?')"

# The deployed store's inputs, laid into this checkout where the builders read them.
rm -rf career-history && cp -R "$SITE/career-history" career-history || { skip "the store has no career-history/"; exit 0; }
for f in career-history-index.json player-profiles.json matches.json series.json; do
  [ -f "$SITE/$f" ] && cp "$SITE/$f" "$f"
done

# 1 · The archive chain (pipeline.yml "Feed the archive's Pinnacle closes into the Database"), then the archive gate.
archive=1
if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SECRET_KEY:-}" ]; then
  skip "no archive credentials — the archive chain and the archive gate were not run"; archive=0
else
  rm -f pinnacle-closes.json pinnacle-approx.csv pinnacle-approx-lower.csv
  if ! python3 tools/pinarch.py export pinnacle-closes.json; then skip "the Pinnacle archive export failed (unreachable?) — not a verdict on this code"; archive=0
  elif ! python3 tools/tdarch.py approx-feed pinnacle-approx.csv pinnacle-approx-lower.csv; then skip "the snapshot export failed (unreachable?) — not a verdict on this code"; archive=0
  fi
fi
if [ "$archive" = 1 ]; then
  rm -f pinnacle-archive-td.csv pinnacle-lower-closes.csv started-evidence.json
  gate "td-feed (pinarch.py td-feed)" python3 tools/pinarch.py td-feed pinnacle-closes.json pinnacle-archive-td.csv
  gate "lower-level closes (pinarch.py lower-closes)" python3 tools/pinarch.py lower-closes pinnacle-closes.json pinnacle-lower-closes.csv
  gate "started evidence" node tools/started-evidence.js --root . --out started-evidence.json
  gate "Database build (build-database-yield.js)" node build-database-yield.js
  gate "archive gate (counts vs the published master)" node tools/archive-gate.mjs --dir . --baseline-url https://michaeldk1996.github.io/SAAS/database-yield-master-meta.json
  # the reconcile suite below reads the Database files this code just built, as the pipeline's does
  for f in database-yield.json database-yield-players.json database-yield-x.json tour-baselines.json; do [ -f "$f" ] && cp "$f" "$SITE/$f"; done
  gate "market performance shards (build-odds-performance.js)" node build-odds-performance.js
fi

# 2 · The pre-publish gates on the store.
gate "Series row-integrity gate" node tools/test-series-rows.js
gate "reconcile suite on the store" env PP2_BUILT_STORE="$SITE" node tools/test-pp2-reconcile.js
gate "H2H golden-pair reconciliation" node tools/h2h-reconcile.mjs --site "$SITE"

if [ "${#red[@]}" -gt 0 ]; then
  say ""; say "**${#red[@]} data gate(s) red on this code:** ${red[*]}. This commit is not gated, so the data pipeline keeps building with the last gated code and the site keeps updating."
  exit 1
fi
say ""; say "Every data gate that ran is green on this code."
exit 0
