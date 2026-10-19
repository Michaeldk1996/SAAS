set -euo pipefail
# replaces the two ops files ONLY when ops still holds the reviewed previous versions (by sha256), plain push
git clone -q --depth 1 "https://x-access-token:${WORKFLOW_PAT}@github.com/Michaeldk1996/stennisfy-ops.git" ops
declare -A OLD=([te-odds-batch.mjs]=15f3114eab02d0a343c081a33a7f5c6bf35a99ca71dec99aa233ea79876b6a10 [te-odds-batch.test.mjs]=beb1a27aa59eec9f9fd7701b15e35fcd261520e7bd878b15578ea2b9e1a9f11e)
for f in te-odds-batch.mjs te-odds-batch.test.mjs; do
  cur=$(sha256sum "ops/tools/$f" | cut -d' ' -f1)
  if cmp -s "tools/probe-ops/$f" "ops/tools/$f"; then echo "$f already the new version"; continue; fi
  [ "$cur" = "${OLD[$f]}" ] || { echo "::error::ops/tools/$f is $cur, not the reviewed previous version — not replaced"; exit 1; }
  cp "tools/probe-ops/$f" "ops/tools/$f"
done
(cd ops/tools && node te-odds-batch.test.mjs | tail -2)
cd ops && git config user.name "stennisfy-ops-bot" && git config user.email "stennisfy-ops-bot@users.noreply.github.com"
git add tools/te-odds-batch.mjs tools/te-odds-batch.test.mjs
git diff --cached --quiet && { echo "nothing new"; exit 0; }
git commit -q -m "te-odds-batch: page check reads the whole match header (date + players) and a tolerant odds head; a brother is never a full-name match; network failures retried 3x 60 s apart (error pages still stop); --offline re-check with --explain / --save-fixtures"
git push -q origin HEAD:main && echo "pushed $(git rev-parse --short HEAD)" && sha256sum tools/te-odds-batch.mjs | cut -c1-16
