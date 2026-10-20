set -euo pipefail
# replaces the two ops files ONLY when ops still holds the reviewed previous versions (by sha256), plain push
git clone -q --depth 1 "https://x-access-token:${WORKFLOW_PAT}@github.com/Michaeldk1996/stennisfy-ops.git" ops
declare -A OLD=([te-odds-batch.mjs]=e8673968e57c70c06adadc8918d9a8bbf1c944f26c1a196aa5ca1be3622cafde [te-odds-batch.test.mjs]=9f389f6d4373a9cc8006c3dadbf4e3c644ae229f8f793200e89005227c03695c)
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
git commit -q -m "te-odds-batch: a value-less flag takes its default (--save-fixtures last on the line crashed); CLI test"
git push -q origin HEAD:main && echo "pushed $(git rev-parse --short HEAD)" && sha256sum tools/te-odds-batch.mjs | cut -c1-16
