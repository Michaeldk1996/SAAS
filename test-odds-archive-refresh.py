#!/usr/bin/env python3
"""TEN-262 — tools/odds-archive-refresh.py, driven for real on fixture workbooks.

Every check RUNS the script (a subprocess, exactly as the drop-in job calls it) against a
temp archive and reads back the files it wrote. Each check is then re-run against a
MUTANT copy of the script with one guarantee removed; a mutant that survives fails the
suite. The last block checks the PUBLISHED files: the archive, its refresh log and the
Database store agree on the row count and the latest date.

Run: python3 test-odds-archive-refresh.py
"""
import csv
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, 'tools', 'odds-archive-refresh.py')
MIRROR = os.path.join(HERE, 'mirror-odds-archive.py')

HEAD = ['ATP', 'Location', 'Tournament', 'Date', 'Series', 'Court', 'Surface', 'Round', 'Best of', 'Winner', 'Loser',
        'WRank', 'LRank', 'Comment', 'B365W', 'B365L', 'PSW', 'PSL', 'MaxW', 'MaxL', 'AvgW', 'AvgL']


def match(date, winner, loser, b365w='1.5', b365l='2.5', tour='Test Open', rnd='1st Round', psw='', psl=''):
    return ['1', 'X', tour, date, 'ATP250', 'Outdoor', 'Hard', rnd, '3', winner, loser, '10', '20', 'Completed',
            b365w, b365l, psw, psl, '1.6', '2.6', '1.55', '2.45']


def xlsx(path, rows, head=HEAD):
    def cell(c, v):
        ref = ''
        n = c + 1
        while n:
            n, r = divmod(n - 1, 26)
            ref = chr(65 + r) + ref
        return '<c r="%s1" t="inlineStr"><is><t>%s</t></is></c>' % (ref, escape(str(v)))
    body = ''.join('<row>%s</row>' % ''.join(cell(c, v) for c, v in enumerate(r)) for r in [head] + rows)
    xml = ('<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
           '<sheetData>%s</sheetData></worksheet>' % body)
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('xl/worksheets/sheet1.xml', xml)


PUBLISHED = [match('2026-08-01', 'Alpha A.', 'Beta B.'), match('2026-08-02', 'Gamma C.', 'Delta D.')]


def setup(tool_src):
    """A throwaway repo root: tools/odds-archive-refresh.py (possibly mutated), the real
    mirror-odds-archive.py, and an odds-archive/2026.csv built BY THE REAL TOOL from
    PUBLISHED - so the fixture archive has exactly the published shape."""
    root = tempfile.mkdtemp(prefix='ten262-oar-')
    os.makedirs(os.path.join(root, 'tools'))
    os.makedirs(os.path.join(root, 'odds-archive'))
    shutil.copy(MIRROR, os.path.join(root, 'mirror-odds-archive.py'))
    with open(os.path.join(root, 'tools', 'odds-archive-refresh.py'), 'w') as fh:
        fh.write(tool_src)
    seed = os.path.join(root, 'seed-2026.xlsx')
    xlsx(seed, PUBLISHED)
    shutil.copy(TOOL, os.path.join(root, 'tools', 'real-refresh.py'))
    r = subprocess.run([sys.executable, os.path.join(root, 'tools', 'real-refresh.py'), '--file', seed,
                        '--log', os.path.join(root, 'seed-log.jsonl')], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return root


def run(root, rows, name='2026.xlsx', head=HEAD, extra=()):
    f = os.path.join(root, name)
    xlsx(f, rows, head)
    r = subprocess.run([sys.executable, os.path.join(root, 'tools', 'odds-archive-refresh.py'), '--file', f] + list(extra),
                       capture_output=True, text=True)
    return r


def archive(root):
    with open(os.path.join(root, 'odds-archive', '2026.csv'), newline='') as fh:
        return list(csv.DictReader(fh))


def raw(root):
    return open(os.path.join(root, 'odds-archive', '2026.csv'), 'rb').read()


def logs(root):
    p = os.path.join(root, 'odds-archive', 'refresh-log.jsonl')
    return [json.loads(l) for l in open(p)] if os.path.exists(p) else []


def check_merge_adds(src):
    root = setup(src)
    try:
        r = run(root, PUBLISHED + [match('2026-09-13', 'Eps E.', 'Zeta Z.')])
        if r.returncode != 0:
            return 'exit %d: %s' % (r.returncode, r.stderr.strip()[-200:])
        rows = archive(root)
        if len(rows) != 3:
            return 'archive has %d rows, expected 3 (2 published + 1 new)' % len(rows)
        if max(x['date'] for x in rows) != '2026-09-13':
            return 'latest date not 2026-09-13'
        lg = logs(root)
        if len(lg) != 1 or (lg[0]['rowsBefore'], lg[0]['rowsAfter'], lg[0]['added'], lg[0]['changed'], lg[0]['latestDate']) != (2, 3, 1, 0, '2026-09-13'):
            return 'refresh log line wrong: %s' % lg
        return None
    finally:
        shutil.rmtree(root)


def check_keeps_existing(src):
    """A published row the source repeats unchanged is kept as it was."""
    root = setup(src)
    try:
        before = archive(root)
        run(root, PUBLISHED + [match('2026-09-13', 'Eps E.', 'Zeta Z.')])
        after = {(x['date'], x['winner']): x for x in archive(root)}
        for b in before:
            if after.get((b['date'], b['winner'])) != b:
                return 'published row changed without a source correction: %s' % b['winner']
        return None
    finally:
        shutil.rmtree(root)


def check_correction_reported(src):
    root = setup(src)
    try:
        r = run(root, [match('2026-08-01', 'Alpha A.', 'Beta B.', b365w='1.44'), PUBLISHED[1]])
        if r.returncode != 0:
            return 'exit %d' % r.returncode
        s = json.loads(r.stdout)
        row = [x for x in archive(root) if x['winner'] == 'Alpha A.'][0]
        if row['b365w'] != '1.44':
            return 'source correction not applied (b365w %s)' % row['b365w']
        if s['changed'] != 1 or s['changedExamples'][0]['fields'].get('b365w') != {'was': '1.5', 'now': '1.44'}:
            return 'correction not reported: %s' % s['changedExamples']
        return None
    finally:
        shutil.rmtree(root)


def check_never_thinner(src):
    root = setup(src)
    try:
        before = raw(root)
        r = run(root, [PUBLISHED[0], match('2026-09-13', 'Eps E.', 'Zeta Z.')])   # drops Gamma/Delta
        if r.returncode != 1:
            return 'a source missing a published match exited %d, not 1' % r.returncode
        if raw(root) != before:
            return 'the published archive was rewritten by a refused run'
        if logs(root):
            return 'a refused run was logged as a refresh'
        return None
    finally:
        shutil.rmtree(root)


def check_empty_refused(src):
    # A season with no published file yet: never-thinner has nothing to compare
    # against, so only the empty-workbook check stands between us and a blank season.
    root = setup(src)
    try:
        os.unlink(os.path.join(root, 'odds-archive', '2026.csv'))
        r = run(root, [])
        if r.returncode == 0:
            return 'an EMPTY workbook was accepted for a new season (exit 0)'
        if os.path.exists(os.path.join(root, 'odds-archive', '2026.csv')) or logs(root):
            return 'an EMPTY workbook wrote or logged something'
        return None
    finally:
        shutil.rmtree(root)


def check_validation(src):
    cases = {
        'duplicate match': PUBLISHED + [PUBLISHED[0]],
        'two seasons': PUBLISHED + [match('2025-12-30', 'Eps E.', 'Zeta Z.')],
        'unparseable date': PUBLISHED + [match('not-a-date', 'Eps E.', 'Zeta Z.')],
    }
    for why, rows in cases.items():
        root = setup(src)
        try:
            before = raw(root)
            r = run(root, rows)
            if r.returncode != 3 or raw(root) != before:
                return '%s: exit %d (expected 3, archive untouched)' % (why, r.returncode)
        finally:
            shutil.rmtree(root)
    root = setup(src)
    try:
        r = run(root, PUBLISHED, head=[h for h in HEAD if h != 'B365L'])
        if r.returncode != 3:
            return 'missing B365L column: exit %d' % r.returncode
        r = run(root, PUBLISHED, name='2025.xlsx')
        if r.returncode != 3:
            return 'file named 2025 holding 2026 rows: exit %d' % r.returncode
    finally:
        shutil.rmtree(root)
    return None


def check_dash_not_zero(src):
    """'-' and a sub-1.01 price are not prices: an empty cell (a dash), never 0."""
    root = setup(src)
    try:
        run(root, PUBLISHED + [match('2026-09-13', 'Eps E.', 'Zeta Z.', b365w='-'),
                               match('2026-09-12', 'Eta H.', 'Theta T.', b365w='1')])
        rows = {x['winner']: x for x in archive(root)}
        for w in ('Eps E.', 'Eta H.'):
            if rows[w]['b365w'] != '':
                return '%s b365w written as %r, expected an empty cell' % (w, rows[w]['b365w'])
        if rows['Eps E.']['psw'] != '':
            return 'a missing Pinnacle price was filled with %r' % rows['Eps E.']['psw']
        return None
    finally:
        shutil.rmtree(root)


def check_key_correction(src):
    """A corrected player name is "absent + added": refused by default (exit 1, nothing
    written); accepted only with --accept-removals equal to the absent count."""
    fixed = [match('2026-08-01', 'Alpha A.', 'Beta-Beta B.'), PUBLISHED[1]]
    root = setup(src)
    try:
        before = raw(root)
        r = run(root, fixed)
        if r.returncode != 1 or raw(root) != before:
            return 'a key correction was merged without --accept-removals (exit %d)' % r.returncode
        if 'Alpha A. / Beta B.' not in ' '.join(json.loads(r.stdout).get('absentFromSource', [])):
            return 'the refused run did not name the absent match'
        r = run(root, fixed, extra=['--accept-removals', '2'])
        if r.returncode != 1 or raw(root) != before:
            return 'a WRONG --accept-removals count was accepted (exit %d)' % r.returncode
        r = run(root, fixed, extra=['--accept-removals', '1'])
        if r.returncode != 0:
            return '--accept-removals 1 exited %d' % r.returncode
        losers = sorted(x['loser'] for x in archive(root))
        if losers != ['Beta-Beta B.', 'Delta D.']:
            return 'after the accepted correction the archive holds %s' % losers
        if logs(root)[-1].get('acceptedRemovals') != ['2026-08-01 / Test Open / 1st Round / Alpha A. / Beta B.']:
            return 'the accepted removal was not logged'
        return None
    finally:
        shutil.rmtree(root)


def check_one_season(src):
    root = setup(src)
    try:
        before = raw(root)
        r = run(root, PUBLISHED + [match('2025-12-30', 'Eps E.', 'Zeta Z.')], name='season.xlsx')
        if r.returncode != 3 or raw(root) != before:
            return 'a workbook spanning two seasons (no year in its name) exited %d' % r.returncode
        return None
    finally:
        shutil.rmtree(root)


def check_name_fixups(src):
    """Upstream typos are corrected on the way in, the same as the historical archive."""
    root = setup(src)
    try:
        run(root, PUBLISHED + [match('2026-09-13', 'Eps E.', 'Zeta Z.', tour="U.S.Men's Clay Court Championships")])
        t = [x['tournament'] for x in archive(root) if x['winner'] == 'Eps E.']
        if t != ["U.S. Men's Clay Court Championships"]:
            return 'tournament written as %s' % t
        return None
    finally:
        shutil.rmtree(root)


def check_dry_run(src):
    root = setup(src)
    try:
        before = raw(root)
        r = run(root, PUBLISHED + [match('2026-09-13', 'Eps E.', 'Zeta Z.')], extra=['--dry-run'])
        if r.returncode != 0 or raw(root) != before or logs(root):
            return '--dry-run wrote or logged (exit %d)' % r.returncode
        return None
    finally:
        shutil.rmtree(root)


CHECKS = [check_key_correction, check_one_season, check_name_fixups, check_dry_run, check_merge_adds, check_keeps_existing, check_correction_reported, check_never_thinner,
          check_empty_refused, check_validation, check_dash_not_zero]

SRC = open(TOOL).read()
MUTANTS = {
    'check_key_correction': ("    accepted = bool(absent) and a.accept_removals == len(absent)", "    accepted = bool(absent) and a.accept_removals >= 1"),
    'check_one_season': ("    if len(seasons) != 1:\n", "    if False:\n"),
    'check_name_fixups': ("        r['tournament'] = mirror.normalize_tournament(r['tournament'])\n", "        pass\n"),
    'check_dry_run': ("    if a.dry_run:\n        return 0\n", ""),
    'check_merge_adds': ("merged.extend(src[k] for k in added)", "pass"),
    'check_keeps_existing': ("            merged.append(old)\n    added", "            merged.append(dict(old, b365w=''))\n    added"),
    'check_correction_reported': ("            changed.append((k, diff))\n            merged.append(new)", "            merged.append(old)"),
    'check_never_thinner': ("    if (absent and not accepted) or len(merged) < len(published):", "    if False:"),
    'check_empty_refused': ("    if not rows:\n        raise Invalid('workbook has no data rows')\n", "    if not rows:\n        return 2026, [], ''\n"),
    'check_validation': ("    if dups:\n", "    if False:\n"),
    'check_dash_not_zero': ("    norm, skipped = mirror.normalize(header, rows)\n",
                            "    norm, skipped = mirror.normalize(header, rows)\n    for _r in norm:\n        _r['b365w'] = _r['b365w'] or '0'\n"),
}


def published_checks():
    """The archive as committed: log, CSV and the Database store agree."""
    out = []
    ad = os.path.join(HERE, 'odds-archive')
    logp = os.path.join(ad, 'refresh-log.jsonl')
    if not os.path.exists(logp):
        return ['odds-archive/refresh-log.jsonl is missing']
    last = [json.loads(l) for l in open(logp) if l.strip()][-1]
    with open(os.path.join(ad, '%d.csv' % last['season']), newline='') as fh:
        rows = list(csv.DictReader(fh))
    keys = [(r['date'], r['tournament'], r['round'], r['winner'], r['loser']) for r in rows]
    if len(set(keys)) != len(keys):
        out.append('published %d.csv has duplicate matches' % last['season'])
    if len(rows) != last['rowsAfter']:
        out.append('published %d.csv has %d rows, the last refresh logged %d' % (last['season'], len(rows), last['rowsAfter']))
    latest = max(r['date'] for r in rows)
    if latest != last['latestDate']:
        out.append('published latest date %s, logged %s' % (latest, last['latestDate']))
    # "Archive through" is the store's dateRange[1]; it must be the archive's own latest date.
    allmax = max(max(r['date'] for r in csv.DictReader(open(os.path.join(ad, f), newline='')))
                 for f in os.listdir(ad) if f.endswith('.csv'))
    dy = json.load(open(os.path.join(HERE, 'database-yield.json')))['meta']['dateRange'][1]
    if dy != allmax:
        out.append('database-yield dateRange ends %s but the archive runs to %s — "Archive through" would lie' % (dy, allmax))
    tm = json.load(open(os.path.join(HERE, 'tournament-market.json')))
    if 'database-yield.json' not in tm.get('source', ''):
        out.append('tournament-market.json is not built from database-yield.json')
    return out


def main():
    fails = []
    for c in CHECKS:
        e = c(SRC)
        print(('  ok   ' if e is None else '  FAIL ') + c.__name__ + ('' if e is None else ' — ' + e))
        if e is not None:
            fails.append(c.__name__)
    survived = []
    for name, (a, b) in MUTANTS.items():
        if SRC.count(a) != 1:
            survived.append(name + ' (anchor not found once)')
            continue
        e = dict((c.__name__, c) for c in CHECKS)[name](SRC.replace(a, b))
        if e is None:
            survived.append(name)
    print(('  ok   ' if not survived else '  FAIL ') + 'CONTROL: every mutant is caught' + ('' if not survived else ' — survived: ' + ', '.join(survived)))
    if survived:
        fails.append('control')
    pub = published_checks()
    for p in pub:
        print('  FAIL published: ' + p)
    if not pub:
        print('  ok   published archive, refresh log and Database store agree')
    fails += pub
    print('\nRESULT: %s' % ('%d failed' % len(fails) if fails else 'all passed'))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
