#!/usr/bin/env python3
"""Content hash of an entry-lists shard, ignoring the run stamp (founder brief 2026-10-20, B10).

generatedAt changes on every run, so a raw diff made the daily job commit "3 tournaments, 142 players" every day
since 2026-10-08 while the draw content never changed. The publish step compares THIS hash instead.

    python3 tools/entry-lists/content-hash.py <file>        -> prints sha256 of the content minus generatedAt
    python3 tools/entry-lists/content-hash.py <a> <b>       -> exit 0 if same content, 1 if different
"""
import hashlib, json, sys

VOLATILE = ("generatedAt", "fetchedAt")   # run stamps, not content (fetchedAt: the advance shard)

def content_hash(path):
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    for k in VOLATILE:
        d.pop(k, None)
    return hashlib.sha256(json.dumps(d, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()

if __name__ == "__main__":
    if len(sys.argv) == 2:
        print(content_hash(sys.argv[1]))
    elif len(sys.argv) == 3:
        sys.exit(0 if content_hash(sys.argv[1]) == content_hash(sys.argv[2]) else 1)
    else:
        sys.exit("usage: content-hash.py <file> [<other>]")
