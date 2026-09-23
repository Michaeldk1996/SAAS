#!/usr/bin/env python3
"""TEN-262: refresh one season of odds-archive/ from a tennis-data.co.uk workbook the
founder downloaded by hand (their Cloudflare blocks automated downloads; do NOT try to
get around it).

    python3 tools/odds-archive-refresh.py --file ~/Stennisfy/odds-archive-inbox/2026.xlsx

What it does, in order. Any failure exits non-zero and leaves the archive untouched.

  1. VALIDATE the workbook before anything is merged (exit 3):
       - it is an .xlsx (zip magic);
       - every column the archive is built from is present (REQUIRED_HEADERS);
       - every row has a winner, a loser and a date that parses (no row is skipped);
       - every date is in ONE season, and it is the season the file name says;
       - one row per match: no duplicate (date, tournament, round, winner, loser).
  2. MERGE, don't overwrite. A match not in the archive is ADDED. A match already in
     the archive keeps its row unless the source now says something different, which
     is a source correction: it is applied and every changed field is reported.
  3. NEVER THINNER (exit 1). If any match in the published season is ABSENT from the
     source, or the merged season would have fewer rows than the published one, nothing
     is written. A shorter source file is how a truncated download looks.
     A source correction to a KEY field (a name spelling, a date, a round) also shows up
     as "absent + added". After a person has read the reported pairs, re-run by hand with
     --accept-removals N, where N is exactly the number of absent matches: those rows are
     dropped in favour of the source's, and the merged season must still be at least as
     large as the published one. The drop-in job never passes this flag.
  4. Write atomically (temp file + rename), then append one line to
     odds-archive/refresh-log.jsonl: when, which file (sha256), rows before/after,
     added, changed, and the latest date - so the source's update rhythm is visible.

Prices go through mirror-odds-archive.py's own clean_price: anything that is not a
number between 1.01 and 1000 is written as an empty cell, which every reader renders as
a dash. Never a zero, never another book's price.

Exit codes: 0 merged (or nothing new) · 1 never-thinner guard · 3 validation failed.
(2 is left to Python/argparse - a usage or startup error, which is not a verdict on the file.)
"""
import argparse
import csv
import hashlib
import importlib.util
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_spec = importlib.util.spec_from_file_location('mirror', os.path.join(ROOT, 'mirror-odds-archive.py'))
mirror = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mirror)

# The workbook columns normalize() reads. A missing one would silently become an empty
# column in every row, so its absence stops the run.
REQUIRED_HEADERS = ['date', 'tournament', 'series', 'court', 'surface', 'round', 'best of',
                    'winner', 'loser', 'wrank', 'lrank', 'comment',
                    'b365w', 'b365l', 'psw', 'psl', 'maxw', 'maxl', 'avgw', 'avgl']


class Invalid(Exception):
    pass


def key(r):
    return (r['date'], r['tournament'], r['round'], r['winner'], r['loser'])


def load_source(path):
    blob = open(path, 'rb').read()
    if blob[:2] != b'PK':
        raise Invalid('not an .xlsx workbook (no zip magic)')
    header, rows = mirror.read_xlsx(blob)
    have = {mirror.clean_text(h).lower() for h in header if h is not None}
    missing = [h for h in REQUIRED_HEADERS if h not in have]
    if missing:
        raise Invalid('workbook is missing column(s): ' + ', '.join(missing))
    rows = [r for r in rows if any(c not in (None, '') for c in r)]   # trailing blank rows
    if not rows:
        raise Invalid('workbook has no data rows')
    norm, skipped = mirror.normalize(header, rows)
    if skipped:
        raise Invalid('%d row(s) lack a winner, a loser or a parseable date' % skipped)
    for r in norm:
        r['tournament'] = mirror.normalize_tournament(r['tournament'])
    seasons = sorted({r['date'][:4] for r in norm})
    if len(seasons) != 1:
        raise Invalid('rows span more than one season: ' + ', '.join(seasons))
    m = re.search(r'(\d{4})', os.path.basename(path))
    if m and m.group(1) != seasons[0]:
        raise Invalid('file is named %s but every row is in %s' % (m.group(1), seasons[0]))
    seen, dups = set(), []
    for r in norm:
        k = key(r)
        if k in seen:
            dups.append(k)
        seen.add(k)
    if dups:
        raise Invalid('%d duplicate match row(s), e.g. %s' % (len(dups), ' / '.join(dups[0])))
    return int(seasons[0]), norm, hashlib.sha256(blob).hexdigest()


def read_season(archive_dir, season):
    path = os.path.join(archive_dir, '%d.csv' % season)
    if not os.path.exists(path):
        return path, []
    with open(path, newline='') as fh:
        return path, list(csv.DictReader(fh))


def merge(published, source):
    """Returns (merged rows, added keys, changed [(key, {col: (old, new)})], absent keys)."""
    src = {key(r): r for r in source}
    pub = {key(r): r for r in published}
    absent = [k for k in pub if k not in src]
    merged, changed = [], []
    for k, old in pub.items():
        new = src.get(k)
        if new is None:
            merged.append(old)
            continue
        diff = {c: (old.get(c, ''), new[c]) for c in mirror.OUT_COLS if str(old.get(c, '')) != str(new[c])}
        if diff:
            changed.append((k, diff))
            merged.append(new)
        else:
            merged.append(old)
    added = [k for k in src if k not in pub]
    merged.extend(src[k] for k in added)
    merged.sort(key=lambda r: (r['date'], r['tournament'], r['winner']))
    return merged, added, changed, absent


def write_atomic(path, rows):
    d = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(dir=d, prefix='.refresh-', suffix='.csv')
    try:
        with os.fdopen(fd, 'w', newline='') as fh:
            w = csv.DictWriter(fh, fieldnames=mirror.OUT_COLS, lineterminator='\n', extrasaction='ignore')
            w.writeheader()
            w.writerows(rows)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', required=True, help='tennis-data season workbook, e.g. 2026.xlsx')
    ap.add_argument('--archive-dir', default=os.path.join(ROOT, 'odds-archive'))
    ap.add_argument('--log', default=None, help='default: <archive-dir>/refresh-log.jsonl')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--accept-removals', type=int, default=0,
                    help='manual only: accept exactly N published matches absent from the source (key corrections)')
    a = ap.parse_args(argv)
    log_path = a.log or os.path.join(a.archive_dir, 'refresh-log.jsonl')

    try:
        season, source, sha = load_source(a.file)
    except Invalid as e:
        print('INVALID — nothing merged: %s' % e, file=sys.stderr)
        return 3

    path, published = read_season(a.archive_dir, season)
    merged, added, changed, absent = merge(published, source)
    summary = {
        'refreshedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'season': season, 'sourceSha256': sha, 'sourceRows': len(source),
        'rowsBefore': len(published), 'rowsAfter': len(merged),
        'added': len(added), 'changed': len(changed),
        'latestDateBefore': max((r['date'] for r in published), default=None),
        'latestDate': max((r['date'] for r in merged), default=None),
        'changedExamples': [{'match': ' / '.join(k), 'fields': {c: {'was': o, 'now': n} for c, (o, n) in d.items()}}
                            for k, d in changed[:10]],
    }
    accepted = bool(absent) and a.accept_removals == len(absent)
    if accepted:
        gone = set(absent)
        merged = [r for r in merged if key(r) not in gone]
        summary['rowsAfter'] = len(merged)
        summary['acceptedRemovals'] = [' / '.join(k) for k in absent]
    if (absent and not accepted) or len(merged) < len(published):
        summary['absentFromSource'] = [' / '.join(k) for k in absent[:20]]
        summary['addedExamples'] = [' / '.join(k) for k in added[:20]]
        print(json.dumps(summary, indent=1))
        print('NEVER THINNER — nothing written: %d published match(es) are absent from the source; '
              'merged %d vs published %d rows. The published archive is kept.' % (len(absent), len(merged), len(published)),
              file=sys.stderr)
        return 1
    print(json.dumps(summary, indent=1))
    if a.dry_run:
        return 0
    if added or changed or accepted:
        write_atomic(path, merged)
    with open(log_path, 'a') as fh:
        line = {k: summary[k] for k in ('refreshedAt', 'season', 'sourceSha256', 'sourceRows', 'rowsBefore',
                                         'rowsAfter', 'added', 'changed', 'latestDate')}
        if accepted:
            line['acceptedRemovals'] = summary['acceptedRemovals']
        fh.write(json.dumps(line) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
