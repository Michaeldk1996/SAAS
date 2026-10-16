#!/usr/bin/env bash
# Founder ruling 2026-10-16 (round 3, item 6): every Tennis-Data drop-in is ALSO copied byte for byte to the private ops
# repo, Michaeldk1996/stennisfy-ops → tennis-data/originals/ (the drop-in path itself is unchanged). The historical
# archive's daily job imports that folder into the historical archive and its dated files/ copy.
#
#   odds-archive-ops-copy.sh stage <workbook> <name>   copy the bytes into the local outbox (never fails silently)
#   odds-archive-ops-copy.sh flush                     push every outbox file to ops; a pushed (or already held) file
#                                                      leaves the outbox; anything else stays for the next run
# Rules (each one is a test, tools/test-dropin-ops-copy.sh):
#   - the copy is the workbook's own bytes (sha256 checked after the copy and again in the ops checkout);
#   - a file whose bytes ops already holds (any name) is not added again; a NAME ops holds with other bytes is never
#     replaced (the outbox names carry the drop-in's UTC stamp, so it cannot happen silently: it fails, it stays);
#   - one plain push (never --force), so ops history is never rewritten;
#   - a failed flush exits 1 and leaves the outbox as it was: nothing is lost, the next run retries it.
set -uo pipefail
OUTBOX="${OPS_OUTBOX:-$HOME/.stennisfy/odds-archive-dropin/ops-outbox}"
OPS_URL="${OPS_REPO_URL:-https://github.com/Michaeldk1996/stennisfy-ops.git}"
DEST="tennis-data/originals"
mkdir -p "$OUTBOX"
sha() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1; else sha256sum "$1" | cut -d' ' -f1; fi; }

case "${1:-}" in
  stage)
    src="$2"; name="$3"; out="$OUTBOX/$name"
    [ -e "$out" ] && { echo "ops-copy: $name is already staged" >&2; exit 1; }
    cp -p "$src" "$out.tmp" && mv "$out.tmp" "$out" || { echo "ops-copy: could not stage $name" >&2; exit 1; }
    [ "$(sha "$src")" = "$(sha "$out")" ] || { rm -f "$out"; echo "ops-copy: staged bytes differ from $src" >&2; exit 1; }
    echo "staged $name ($(sha "$out"))"
    ;;
  flush)
    shopt -s nullglob; files=("$OUTBOX"/*); shopt -u nullglob
    [ ${#files[@]} -eq 0 ] && { echo "ops-copy: outbox empty"; exit 0; }
    work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
    git clone -q --depth 1 --filter=blob:none --sparse "$OPS_URL" "$work/ops" || { echo "ops-copy: clone of the ops repo failed" >&2; exit 1; }
    cd "$work/ops" || exit 1
    git sparse-checkout set "$DEST" >/dev/null 2>&1 || git sparse-checkout set --no-cone "$DEST" >/dev/null 2>&1 || true
    mkdir -p "$DEST"
    : > "$work/held"                                         # bash 3.2 (macOS /bin/bash): no associative arrays
    for g in "$DEST"/*; do [ -f "$g" ] && sha "$g" >> "$work/held"; done
    done_files=(); added=0; already=0
    for f in "${files[@]}"; do
      s="$(sha "$f")"; n="$(basename "$f")"
      if grep -qx "$s" "$work/held"; then echo "already in ops: $n ($s)"; done_files+=("$f"); already=$((already + 1)); continue; fi
      if [ -e "$DEST/$n" ]; then echo "ops-copy: $DEST/$n exists with other bytes — never replaced; $n stays in the outbox" >&2; exit 1; fi
      cp -p "$f" "$DEST/$n" && [ "$(sha "$DEST/$n")" = "$s" ] || { echo "ops-copy: copy of $n differs" >&2; exit 1; }
      git add "$DEST/$n"; echo "$s" >> "$work/held"; done_files+=("$f"); added=$((added + 1))
    done
    if [ "$added" -gt 0 ]; then
      git -c user.name=stennisfy-dropin -c user.email=dropin@users.noreply.github.com commit -q -m "tennis-data originals: +$added drop-in workbook(s), byte for byte" || exit 1
      git push -q origin HEAD:main || { echo "ops-copy: push to the ops repo failed — the outbox is kept for the next run" >&2; exit 1; }   # plain push
    fi
    for f in ${done_files[@]+"${done_files[@]}"}; do rm -f "$f"; done
    echo "ops-copy: pushed $added, already held $already"
    ;;
  *) echo "usage: $0 stage <workbook> <name> | flush" >&2; exit 2 ;;
esac
