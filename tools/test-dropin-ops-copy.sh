#!/usr/bin/env bash
# tools/odds-archive-ops-copy.sh against a local bare repo standing in for stennisfy-ops (founder 2026-10-16, item 6).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; S="$HERE/odds-archive-ops-copy.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok() { if eval "$2"; then pass=$((pass + 1)); echo "  PASS  $1"; else fail=$((fail + 1)); echo "  FAIL  $1"; fi; }
sha() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1; else sha256sum "$1" | cut -d' ' -f1; fi; }
git init -q --bare -b main "$T/ops.git"
git clone -q "$T/ops.git" "$T/seed" 2>/dev/null; mkdir -p "$T/seed/tennis-data/originals"
printf 'old-bytes' > "$T/seed/tennis-data/originals/2025.xlsx"
( cd "$T/seed" && git add -A && git -c user.name=t -c user.email=t@t commit -qm seed && git push -q origin HEAD:main )
export OPS_OUTBOX="$T/outbox" OPS_REPO_URL="file://$T/ops.git"
head -c 5000 /dev/urandom > "$T/2026.xlsx"
bash "$S" stage "$T/2026.xlsx" "20261016T120000Z-2026.xlsx" >/dev/null
ok "stage: the outbox holds the workbook's own bytes" '[ "$(sha "$T/outbox/20261016T120000Z-2026.xlsx")" = "$(sha "$T/2026.xlsx")" ]'
bash "$S" flush > "$T/f1.log" 2>&1; rc=$?
git clone -q "$T/ops.git" "$T/check1" 2>/dev/null
ok "flush: pushed to ops tennis-data/originals/, byte for byte" '[ $rc -eq 0 ] && [ "$(sha "$T/check1/tennis-data/originals/20261016T120000Z-2026.xlsx")" = "$(sha "$T/2026.xlsx")" ]'
ok "flush: a pushed file leaves the outbox" '[ -z "$(ls -A "$T/outbox")" ]'
ok "flush: an earlier original is untouched" '[ "$(cat "$T/check1/tennis-data/originals/2025.xlsx")" = "old-bytes" ]'
bash "$S" stage "$T/2026.xlsx" "20261017T090000Z-2026.xlsx" >/dev/null; bash "$S" flush > "$T/f2.log" 2>&1; rc=$?
git clone -q "$T/ops.git" "$T/check2" 2>/dev/null
ok "the same bytes dropped again are not added twice (already held), and leave the outbox" '[ $rc -eq 0 ] && grep -q "already in ops" "$T/f2.log" && [ ! -e "$T/check2/tennis-data/originals/20261017T090000Z-2026.xlsx" ] && [ -z "$(ls -A "$T/outbox")" ]'
printf 'other-bytes' > "$T/x.xlsx"; bash "$S" stage "$T/x.xlsx" "2025.xlsx" >/dev/null
bash "$S" flush > "$T/f3.log" 2>&1; rc=$?
git clone -q "$T/ops.git" "$T/check3" 2>/dev/null
ok "control: a NAME ops holds with other bytes is never replaced — the run fails and the file stays in the outbox" '[ $rc -ne 0 ] && [ "$(cat "$T/check3/tennis-data/originals/2025.xlsx")" = "old-bytes" ] && [ -e "$T/outbox/2025.xlsx" ]'
rm -f "$T/outbox/2025.xlsx"
bash "$S" stage "$T/2026.xlsx" "20261018T090000Z-new.xlsx" >/dev/null; printf 'z' >> "$T/outbox/20261018T090000Z-new.xlsx"
OPS_REPO_URL="file://$T/missing.git" bash "$S" flush > "$T/f4.log" 2>&1; rc=$?
ok "control: an unreachable ops repo fails the flush and keeps the outbox for the next run (nothing lost)" '[ $rc -ne 0 ] && [ -e "$T/outbox/20261018T090000Z-new.xlsx" ]'
ok "the drop-in job stages every workbook and flushes the outbox, without changing its own path" \
  'grep -q "cp -p \"\$F\" \"\$OPS_OUTBOX/\$STAMP-\$NAME.tmp\"" "$HERE/odds-archive-dropin.sh" && grep -q "bash tools/odds-archive-ops-copy.sh flush" "$HERE/odds-archive-dropin.sh"'
ok "the copy never force-pushes" '! grep -E "git push[^#]*(--force|[[:space:]]-f([[:space:]]|$))" "$S" >/dev/null'
echo; echo "test-dropin-ops-copy: $pass passed, $fail failed"; [ "$fail" -eq 0 ]
