set -euo pipefail
# shared stop (founder 2026-10-20): replaces the two ops files ONLY when ops still holds 68491e7's versions (by sha256); runs
# ops' tests in this fresh clone (no ~/.stennisfy store, no cache) and pushes only on exit 0; plain push, never --force
git clone -q "https://x-access-token:${WORKFLOW_PAT}@github.com/Michaeldk1996/stennisfy-ops.git" ops
echo "ops HEAD before: $(git -C ops rev-parse --short HEAD)"
declare -A OLD=([te-odds-batch.mjs]=d81b5874865cdf8c2848072bcd4a12c2ed1338348eb3d209bd9ce047530026f8 [te-odds-batch.test.mjs]=88b5dece3dda82d69d2db6cc8ef59b2929d47899b5c75f434a9fdae1214add3a)
for f in te-odds-batch.mjs te-odds-batch.test.mjs; do
  cur=$(sha256sum "ops/tools/$f" | cut -d' ' -f1)
  if cmp -s "tools/probe-ops/$f" "ops/tools/$f"; then echo "$f already the new version"; continue; fi
  [ "$cur" = "${OLD[$f]}" ] || { echo "::error::ops/tools/$f is $cur, not 68491e7's version — not replaced"; exit 1; }
  cp "tools/probe-ops/$f" "ops/tools/$f"
done
cd ops
fail=0; n=0
for t in tools/*.test.mjs; do n=$((n+1)); echo "== $t"; if node "$t" > /tmp/t.out 2>&1; then tail -1 /tmp/t.out; else echo "FAILED: $t"; tail -20 /tmp/t.out; fail=$((fail+1)); fi; done
echo "ops suite: $n test files, failed $fail"
[ "$fail" = 0 ] || { echo "::error::ops suite red — nothing pushed"; exit 1; }
git config user.name "stennisfy-ops-bot" && git config user.email "stennisfy-ops-bot@users.noreply.github.com"
git add tools/te-odds-batch.mjs tools/te-odds-batch.test.mjs
git diff --cached --quiet && { echo "nothing new"; exit 0; }
git commit -q -m "te-odds-batch: one shared stop — an error page writes CACHE/BLOCKED in te-scrape's format; neither TE tool requests while it exists; a network stop never writes it; --offline ignores it. Pace unchanged."
git push -q origin HEAD:main && echo "pushed $(git rev-parse --short HEAD)" && sha256sum tools/te-odds-batch.mjs tools/te-odds-batch.test.mjs
