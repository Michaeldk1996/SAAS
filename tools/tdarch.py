#!/usr/bin/env python3
"""Historical odds archive — the one tool that writes it (founder brief 2026-10-16, items 1-4).

Tables (supabase/migrations/20261016090000_historical_odds_archive.sql): historical_odds_file, historical_close,
historical_odds_export, historical_archive_count. Rules: .claude/rules/historical-odds-archive.md.

Like tools/pinarch.py, this file only ever ADDS rows (PostgREST INSERT, resolution=ignore-duplicates); a correction is a
new row whose `supersedes` names the old one. Tennis-Data has stopped serving its files, so every one we hold is kept
byte for byte.

Commands
  inventory                 list every Tennis-Data file this checkout holds (HEAD + every version in git history) — no writes
  fetch-mirror DIR           the public mirror's copies of the original workbooks (GitHub, never tennis-data.co.uk) -> DIR
  import-files [DIR ...]    store each file byte for byte (sha256 unique): the checkout's odds-archive/, its git history,
                            and any workbook in DIR (the private ops repo's tennis-data/originals/)
  import-closes             every Tennis-Data closing price 2010+ from the current odds-archive/ CSVs: Pinnacle and Bet365
                            as separate sources
  export-csv OPS_CHECKOUT CLOSES_JSON
                            the private CSV export (one row per match, 2010+), written as NEW dated files into the ops
                            checkout's closes-export/ with a manifest; refuses to replace a file
  backup OPS_CHECKOUT       today's dated copy of the four tables into the ops checkout's historical-archive/
  restore-check OPS_CHECKOUT
                            rebuild every row from the backups and compare with the live tables (no write); every export
                            file's sha256 must equal its manifest
  daily [CLOSES_JSON]       the whole daily job in one clone of the private ops repo: mirror + originals, files, closes,
                            CSV export, backup; one commit, a plain push (env WORKFLOW_PAT)
  verify-export OPS_CHECKOUT the newest export: per-year counts = the archive's, unreachable from the site, sha256s match
  counts [--record JOB]     row counts + the guard; one historical_archive_count row
Env: SUPABASE_URL, SUPABASE_SECRET_KEY (service_role: SELECT + INSERT only)."""
import collections, csv, datetime as dt, glob, gzip, hashlib, io, json, os, re, subprocess, sys
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
_s = importlib.util.spec_from_file_location('pinarch', os.path.join(HERE, 'pinarch.py'))
P = importlib.util.module_from_spec(_s); _s.loader.exec_module(P)

FILE, CLOSE, EXPORT, COUNT = 'historical_odds_file', 'historical_close', 'historical_odds_export', 'historical_archive_count'
TABLES = (FILE, CLOSE, EXPORT, COUNT)
FROM_YEAR = 2010
EXPORT_DIR = 'closes-export'
BACKUP_DIR = 'historical-archive'
ORIGINALS_DIR = os.path.join('tennis-data', 'originals')
EXPORT_COLS = ['date', 'tournament', 'round', 'surface', 'tour', 'player1', 'player2', 'winner', 'score',
               'pinnacle_p1', 'pinnacle_p2', 'source', 'close_time', 'start_time', 'start_source', 'gap_to_start_s',
               'bet365_p1', 'bet365_p2', 'bet365_source']


def sha(b):
    return hashlib.sha256(b).hexdigest()


def price(v):
    """A real price, else None (a missing price is left empty, never zero)."""
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if 1.01 <= x <= 1000 else None


# ── item 1: the files ───────────────────────────────────────────────────────────────────────────────────────────────
def describe_csv(blob):
    rows = list(csv.DictReader(io.StringIO(blob.decode('utf-8', 'replace'))))
    ds = sorted(r['date'] for r in rows if r.get('date'))
    return {'row_count': len(rows), 'first_date': ds[0] if ds else None, 'last_date': ds[-1] if ds else None,
            'seasons': sorted({int(d[:4]) for d in ds})}


def kind_of(name):
    n = name.lower()
    if n.endswith(('.xlsx', '.xls')):
        return 'workbook'
    if n.endswith('.jsonl'):
        return 'log'
    if n.endswith('corrections.json'):
        return 'corrections'
    return 'normalized csv'


def git_versions(repo=ROOT):
    """Every version of every odds-archive/ file in git history: (path, commit, commit time, bytes), oldest first."""
    log = subprocess.run(['git', 'log', '--reverse', '--format=@%H %cI', '--name-only', '--', 'odds-archive/'], cwd=repo,
                         capture_output=True, text=True, check=True).stdout
    out, cur = [], None
    for line in log.splitlines():
        if line.startswith('@'):
            cur = line[1:].split(' ', 1); continue
        p = line.strip()
        if not p or not cur:
            continue
        r = subprocess.run(['git', 'show', f'{cur[0]}:{p}'], cwd=repo, capture_output=True)
        if r.returncode == 0:                      # a deletion has no blob
            out.append((p, cur[0], cur[1], r.stdout))
    return out


def inventory(repo=ROOT, extra_dirs=()):
    """Every distinct Tennis-Data file (by sha256): HEAD's odds-archive/, every earlier version in git history, and the
    workbooks in `extra_dirs`. One entry per sha256, with every place it was seen."""
    seen = collections.OrderedDict()
    def add(name, source, blob, obtained, meta):
        k = sha(blob)
        e = seen.get(k)
        if e:
            e['meta'].setdefault('alsoSeen', []).append({'name': name, 'source': source, **meta}); return
        d = describe_csv(blob) if kind_of(name) == 'normalized csv' else {'row_count': None, 'first_date': None, 'last_date': None, 'seasons': []}
        seen[k] = {'sha256': k, 'name': name, 'source': source, 'kind': kind_of(name), 'bytes': len(blob), 'obtained_at': obtained,
                   'meta': dict(meta), 'blob': blob, **d}
    for p, c, t, blob in git_versions(repo):
        add(p, 'git history', blob, t, {'commit': c})
    for f in sorted(glob.glob(os.path.join(repo, 'odds-archive', '*'))):
        add(os.path.relpath(f, repo), 'repo odds-archive', open(f, 'rb').read(), None, {'head': True})
    for d in extra_dirs:
        for f in sorted(glob.glob(os.path.join(d, '*'))):
            if os.path.isfile(f) and f.lower().endswith(('.xlsx', '.xls')):
                st = os.stat(f)
                src = 'mirror nickdatak' if os.path.basename(f).startswith('mirror-') else 'drop-in workbook'
                add(os.path.basename(f), src, open(f, 'rb').read(),
                    dt.datetime.fromtimestamp(st.st_mtime, dt.timezone.utc).isoformat(), {'from': os.path.relpath(f, d)})
    for e in seen.values():
        if e['kind'] == 'workbook':
            e.update(describe_workbook(e['blob']))
    return list(seen.values())


def describe_workbook(blob):
    try:
        M = P._load('mirror', 'mirror-odds-archive.py')
        h, rows = M.read_xlsx(blob) if blob[:2] == b'PK' else M.read_xls(blob)
        rows = [r for r in rows if any(c not in (None, '') for c in r)]
        norm, _ = M.normalize(h, rows)
        ds = sorted(r['date'] for r in norm)
        return {'row_count': len(rows), 'first_date': ds[0] if ds else None, 'last_date': ds[-1] if ds else None,
                'seasons': sorted({int(d[:4]) for d in ds})}
    except Exception as e:                       # noqa: BLE001 — the bytes are stored either way; the description is a dash
        return {'row_count': None, 'first_date': None, 'last_date': None, 'seasons': [], 'describeError': str(e)[:200]}


def file_rows(inv):
    return [{'sha256': e['sha256'], 'name': e['name'], 'source': e['source'], 'kind': e['kind'], 'seasons': e['seasons'],
             'row_count': e['row_count'], 'first_date': e['first_date'], 'last_date': e['last_date'], 'bytes': e['bytes'],
             'content_gz': P.hexbytes(gzip.compress(e['blob'], 9)), 'obtained_at': e['obtained_at'],
             'meta': {k: v for k, v in e['meta'].items()} | ({'describeError': e['describeError']} if e.get('describeError') else {})}
            for e in inv]


def cmd_inventory(extra=()):
    inv = inventory(extra_dirs=extra)
    for e in inv:
        print(f"{e['sha256'][:12]}  {e['kind']:15} {e['source']:18} {e['name']:28} {e['bytes']:>8} B  rows {e['row_count']}  "
              f"{e['first_date']}..{e['last_date']}  {e['obtained_at'] or ''}")
    print(f'### inventory {len(inv)} distinct files')
    return inv


MIRROR = 'https://raw.githubusercontent.com/nickdatak/Tennis-Match-Predictions/main/data/{y}.{ext}'


def fetch_mirror(years=range(2004, 2027), out_dir=None):
    """The public mirror's copies of the original Tennis-Data workbooks (read-only GETs of a GitHub repo, never
    tennis-data.co.uk), saved into `out_dir` so import-files stores them byte for byte. Returns what was found."""
    import urllib.request
    found = []
    for y in years:
        for ext in ('xlsx', 'xls'):
            try:
                with urllib.request.urlopen(urllib.request.Request(MIRROR.format(y=y, ext=ext), headers={'User-Agent': 'stennisfy-tdarch'}), timeout=60) as r:
                    blob = r.read()
            except Exception:                    # noqa: BLE001 — a 404 (other extension) or a failure: that year's copy is missing
                continue
            if (ext == 'xlsx' and blob[:2] == b'PK') or (ext == 'xls' and blob[:4] == b'\xd0\xcf\x11\xe0'):
                with open(os.path.join(out_dir, f'mirror-{y}.{ext}'), 'wb') as fh:
                    fh.write(blob)
                found.append(f'{y}.{ext}')
                break
    print('### mirror', json.dumps({'found': found}))
    return found


def cmd_import_files(extra=()):
    inv = inventory(extra_dirs=extra)
    held = {r['sha256'] for r in P.select_all(FILE, 'sha256')}
    add = [r for r in file_rows(inv) if r['sha256'] not in held]
    ids = []
    for r in add:                                   # one at a time: a workbook is ~0.5 MB of hex
        ids += P.insert(FILE, [r], 'sha256')
    print('### import-files', json.dumps({'distinct': len(inv), 'alreadyHeld': len(inv) - len(add), 'added': len(ids),
                                          'addedNames': [r['name'] + ' ' + r['sha256'][:12] for r in add]}))
    return inv


# ── item 2: the closes ──────────────────────────────────────────────────────────────────────────────────────────────
def td_close_rows(csv_files):
    """Each Tennis-Data match 2010+ -> up to two rows: its Pinnacle close and its Bet365 close, each only when both
    prices are real (a missing price is no row, never a zero). `csv_files`: [(path, bytes)]."""
    out = []
    for path, blob in csv_files:
        fsha = sha(blob)
        for r in csv.DictReader(io.StringIO(blob.decode('utf-8'))):
            if int(r['date'][:4]) < FROM_YEAR:
                continue
            for src, book, a, b in (('tennis-data Pinnacle', 'Pinnacle', 'psw', 'psl'), ('tennis-data Bet365', 'Bet365', 'b365w', 'b365l')):
                pw, pl = price(r.get(a)), price(r.get(b))
                if pw is None or pl is None:
                    continue
                bo = r.get('bestof')
                out.append({'dedupe_key': '|'.join(str(x) for x in (src, r['date'], r['tournament'], r['round'], r['winner'], r['loser'], pw, pl)),
                            'source': src, 'book': book, 'match_date': r['date'], 'tournament': r['tournament'], 'series': r.get('series') or None,
                            'court': r.get('court') or None, 'surface': r.get('surface') or None, 'round': r.get('round') or None,
                            'best_of': int(bo) if str(bo or '').isdigit() else None, 'winner': r['winner'], 'loser': r['loser'],
                            'comment': r.get('comment') or None, 'price_winner': pw, 'price_loser': pl, 'file_sha256': fsha,
                            'detail': {'file': os.path.basename(path)}})
    return out


def match_key(r):
    return (r['source'], str(r['match_date']), r['tournament'], r.get('round'), r['winner'], r['loser'])


def plan_closes(new_rows, held):
    """Rows to add: a held dedupe_key adds nothing; a changed price for a held match is a correction (supersedes)."""
    keys = {h['dedupe_key'] for h in held}
    latest = {}
    for h in sorted(held, key=lambda h: h['id']):
        latest[match_key(h)] = h['id']
    add = []
    for r in new_rows:
        if r['dedupe_key'] in keys:
            continue
        if match_key(r) in latest:
            r = dict(r, supersedes=latest[match_key(r)])
        add.append(r)
    return add


def current_td_closes(rows):
    sup = {r['supersedes'] for r in rows if r.get('supersedes')}
    return [r for r in rows if r['id'] not in sup]


def cmd_import_closes():
    files = [(f, open(f, 'rb').read()) for f in sorted(glob.glob(os.path.join(ROOT, 'odds-archive', '[0-9][0-9][0-9][0-9].csv')))]
    held_files = {r['sha256'] for r in P.select_all(FILE, 'sha256')}
    missing = [os.path.basename(f) for f, b in files if sha(b) not in held_files]
    if missing:
        P.die(f'import-files first: the archive does not hold {missing} (every close row names its file)')
    before = P.select_all(CLOSE, 'id,dedupe_key,source,match_date,tournament,round,winner,loser,supersedes')
    rows = td_close_rows(files)
    add = plan_closes(rows, before)
    ids = []
    for i in range(0, len(add), 500):
        ids += P.insert(CLOSE, add[i:i + 500], 'dedupe_key')
    def per(rs):
        c = collections.Counter((str(r['match_date'])[:4], r['source']) for r in rs)
        return {f'{y} {s}': n for (y, s), n in sorted(c.items())}
    print('### import-closes', json.dumps({'parsed': len(rows), 'added': len(ids), 'corrections': sum(1 for r in add if r.get('supersedes')),
                                           'currentBefore': per(current_td_closes(before)), 'addedPerYear': per(add)}))
    return add


# ── item 3: the private CSV export ──────────────────────────────────────────────────────────────────────────────────
def tour_of_api(a):
    lvl, name = (a or {}).get('event_type_type'), str((a or {}).get('tournament_name') or '')
    q = 'qualif' in name.lower() or 'qualif' in str((a or {}).get('tournament_round') or '').lower()
    if lvl == 'Atp Singles':
        return 'qualifying' if q else 'ATP main draw'
    if lvl == 'Challenger Men Singles':
        return 'Challenger'
    return None


def td_matches(csv_files):
    """Every Tennis-Data match 2010+ (priced or not), so a match with no close on either book is still one row."""
    out = []
    for _, blob in csv_files:
        for r in csv.DictReader(io.StringIO(blob.decode('utf-8'))):
            if int(r['date'][:4]) >= FROM_YEAR:
                out.append(r)
    return out


def export_rows(td_closes, archive_rows, matches=()):
    """One row per match. Tennis-Data matches (ATP main draw) carry their own Pinnacle and Bet365 closes; a Tennis-Data
    match with no Pinnacle pair takes the archive's close when exactly one archive close joins it (same day ±1, both
    surnames — the td-feed join); every other archive close (Challenger, qualifying, ATP main draw after Tennis-Data's
    last day) is its own row. Nothing is filled from another book or another match; a missing value is left empty."""
    cur = current_td_closes(td_closes)
    by_match = collections.OrderedDict()
    for r in sorted(cur, key=lambda r: (str(r['match_date']), r['tournament'], r['winner'])):
        k = (str(r['match_date']), r['tournament'], r.get('round'), r['winner'], r['loser'])
        e = by_match.setdefault(k, {'td': r, 'Pinnacle': None, 'Bet365': None})
        e[r['book']] = r
    for m in matches:                                   # a Tennis-Data match with no close on either book: empty prices
        k = (m['date'], m['tournament'], m.get('round') or None, m['winner'], m['loser'])
        if k not in by_match and (k[0], k[1], m.get('round'), k[3], k[4]) not in by_match:
            by_match[k] = {'td': {'match_date': m['date'], 'tournament': m['tournament'], 'round': m.get('round'), 'surface': m.get('surface'),
                                  'winner': m['winner'], 'loser': m['loser']}, 'Pinnacle': None, 'Bet365': None}
    by_match = collections.OrderedDict(sorted(by_match.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][3])))
    by_day = collections.defaultdict(list)
    for k, e in by_match.items():
        by_day[k[0]].append((k, e))
    used, out = set(), []
    arch = sorted(archive_rows, key=lambda r: (r['date'], r['eventKey']))
    joined = {}
    for a in arch:
        day = dt.date.fromisoformat(a['date'])
        c = [(k, e) for d in (day - dt.timedelta(days=1), day, day + dt.timedelta(days=1)) for k, e in by_day.get(d.isoformat(), [])
             if (P.same_surname(e['td']['winner'], a['p1Name']) and P.same_surname(e['td']['loser'], a['p2Name']))
             or (P.same_surname(e['td']['winner'], a['p2Name']) and P.same_surname(e['td']['loser'], a['p1Name']))]
        if len(c) == 1:
            joined.setdefault(c[0][0], []).append(a)
        elif len(c) > 1:
            used.add(a['eventKey'])                     # ambiguous: never attached to either match, never its own row
    def src_of(a):
        return 'Oddspapi' if a.get('label') == P.ARCHIVE_LABEL else 'captured'
    for k, e in by_match.items():
        td = e['td']
        pin, b365 = e['Pinnacle'], e['Bet365']
        row = {'date': k[0], 'tournament': td['tournament'], 'round': td.get('round') or '', 'surface': td.get('surface') or '',
               'tour': 'ATP main draw', 'player1': td['winner'], 'player2': td['loser'], 'winner': td['winner'], 'score': '',
               'pinnacle_p1': '', 'pinnacle_p2': '', 'source': '', 'close_time': '', 'start_time': '', 'start_source': '', 'gap_to_start_s': '',
               'bet365_p1': '', 'bet365_p2': '', 'bet365_source': ''}
        if pin:
            row.update(pinnacle_p1=pin['price_winner'], pinnacle_p2=pin['price_loser'], source='Tennis-Data')
        js = joined.get(k) or []
        if not pin and len(js) == 1:
            a = js[0]
            w1 = P.same_surname(td['winner'], a['p1Name'])
            row.update(pinnacle_p1=a['p1'] if w1 else a['p2'], pinnacle_p2=a['p2'] if w1 else a['p1'], source=src_of(a),
                       close_time=a.get('closeTs') or '', start_time=a.get('startTs') or '', start_source=a.get('startSource') or '',
                       gap_to_start_s=a.get('gapToStartS') if a.get('gapToStartS') is not None else '')
        for a in js:
            used.add(a['eventKey'])
        if b365:
            row.update(bet365_p1=b365['price_winner'], bet365_p2=b365['price_loser'], bet365_source='Tennis-Data')
        out.append(row)
    for a in arch:
        if a['eventKey'] in used:
            continue
        api = a.get('apiTennis') or {}
        t = tour_of_api(api)
        if t is None or int(a['date'][:4]) < FROM_YEAR:
            continue
        w = api.get('event_winner')
        out.append({'date': a['date'], 'tournament': re.sub(r'^(ATP|Challenger)\s+', '', str(api.get('tournament_name') or '')).strip(),
                    'round': str(api.get('tournament_round') or '').split(' - ')[-1], 'surface': '', 'tour': t,
                    'player1': a.get('p1Name') or '', 'player2': a.get('p2Name') or '',
                    'winner': a.get('p1Name') if w == 'First Player' else a.get('p2Name') if w == 'Second Player' else '',
                    'score': api.get('event_final_result') if w in ('First Player', 'Second Player') else '',
                    'pinnacle_p1': a['p1'], 'pinnacle_p2': a['p2'], 'source': src_of(a), 'close_time': a.get('closeTs') or '',
                    'start_time': a.get('startTs') or '', 'start_source': a.get('startSource') or '',
                    'gap_to_start_s': a.get('gapToStartS') if a.get('gapToStartS') is not None else '',
                    'bet365_p1': '', 'bet365_p2': '', 'bet365_source': ''})
    out.sort(key=lambda r: (r['date'], r['tour'], r['tournament'], str(r['player1'])))
    return out


def csv_bytes(rows):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=EXPORT_COLS, lineterminator='\n')
    w.writeheader()
    for r in rows:
        w.writerow({k: ('' if r.get(k) is None else r[k]) for k in EXPORT_COLS})
    return buf.getvalue().encode()


def write_export(ops, day, rows):
    """New dated files only: closes-export/<day>/pinnacle-closes-2010-YYYY_<day>.csv + one per year + manifest.json.
    Refuses an existing day (an export is never overwritten)."""
    d = os.path.join(ops, EXPORT_DIR, day)
    if os.path.exists(d):
        raise FileExistsError(f'{d} already exists: an export is never replaced')
    os.makedirs(d)
    last_year = max([int(r['date'][:4]) for r in rows] or [FROM_YEAR])
    files = []
    def put(name, rs):
        b = csv_bytes(rs)
        with open(os.path.join(d, name), 'wb') as fh:
            fh.write(b)
        files.append({'name': name, 'sha256': sha(b), 'bytes': len(b), 'rows': len(rs)})
    put(f'pinnacle-closes-{FROM_YEAR}-{last_year}_{day}.csv', rows)
    per = collections.Counter(r['date'][:4] for r in rows)
    for y in sorted(per):
        put(f'pinnacle-closes-{y}_{day}.csv', [r for r in rows if r['date'][:4] == y])
    pin = collections.Counter((r['date'][:4], r['source'] or '—') for r in rows)
    man = {'day': day, 'writtenAt': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'), 'rows': len(rows),
           'perYear': dict(sorted(per.items())), 'perYearPinnacleSource': {f'{y} {s}': n for (y, s), n in sorted(pin.items())},
           'columns': EXPORT_COLS, 'files': files,
           'rule': 'one row per match; empty = missing, never zero; Pinnacle from Tennis-Data, else our archive (Oddspapi / captured); Bet365 from Tennis-Data'}
    with open(os.path.join(d, 'manifest.json'), 'w') as fh:
        json.dump(man, fh, indent=1)
    return man


def cmd_export_csv(ops, closes_json):
    day = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d')
    td = P.select_all(CLOSE, 'id,source,book,match_date,tournament,round,surface,winner,loser,price_winner,price_loser,supersedes')
    arch = json.load(open(closes_json)).get('rows') or []
    files = [(f, open(f, 'rb').read()) for f in sorted(glob.glob(os.path.join(ROOT, 'odds-archive', '[0-9][0-9][0-9][0-9].csv')))]
    rows = export_rows(td, arch, td_matches(files))
    man = write_export(ops, day, rows)
    full = man['files'][0]
    P.insert(EXPORT, [{'name': full['name'], 'sha256': full['sha256'], 'rows': full['rows'], 'per_year': man['perYear'],
                       'location': f'{P.OPS_REPO}:{EXPORT_DIR}/{day}/{full["name"]}', 'detail': {'files': man['files']}}], 'name')
    print('### export-csv', json.dumps({k: man[k] for k in ('day', 'rows', 'perYear')}), json.dumps(man['perYearPinnacleSource']))
    return man


# ── backup / restore (the archive's own daily dated copy, in its own folder) ────────────────────────────────────────
def cmd_backup(ops):
    day = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d')
    d = os.path.join(ops, BACKUP_DIR, day)
    if os.path.exists(d):
        print(f'### backup {day}: already written today — nothing replaced'); return None
    days = sorted(p.name for p in os.scandir(os.path.join(ops, BACKUP_DIR)) if p.is_dir()) if os.path.isdir(os.path.join(ops, BACKUP_DIR)) else []
    prev = json.load(open(os.path.join(ops, BACKUP_DIR, days[-1], 'manifest.json'))) if days else {}
    since = (prev.get(FILE) or {}).get('toId') or 0
    os.makedirs(d)
    files, man = [], {'day': day, 'previous': prev.get('day')}
    def put(name, rows):
        blob = gzip.compress(P.serialize_rows(sorted(rows, key=lambda r: r['id'])), 6)
        with open(os.path.join(d, name), 'wb') as fh:
            fh.write(blob)
        files.append({'name': name, 'sha256': sha(blob), 'bytes': len(blob), 'rows': len(rows)})
    new_files = [r for page in P.select_pages(FILE, '*', page=20, after=since) for r in page]
    put('file-new.jsonl.gz', new_files)                                      # incremental: file rows are large
    man[FILE] = {'fromId': new_files[0]['id'] if new_files else None, 'toId': new_files[-1]['id'] if new_files else since,
                 'rows': len(new_files), 'cumulativeRows': ((prev.get(FILE) or {}).get('cumulativeRows') or 0) + len(new_files)}
    for t, name in ((CLOSE, 'close-full.jsonl.gz'), (EXPORT, 'export-full.jsonl.gz'), (COUNT, 'count-full.jsonl.gz')):
        rows = P.select_all(t, '*')
        put(name, rows); man[t] = {'rows': len(rows)}
    man['files'] = files
    with open(os.path.join(d, 'manifest.json'), 'w') as fh:
        json.dump(man, fh, indent=1)
    print('### backup', json.dumps({k: v for k, v in man.items() if k != 'files'}))
    return man


def read_backups(ops):
    base = os.path.join(ops, BACKUP_DIR)
    rows = {t: {} for t in TABLES}
    for day in sorted(p.name for p in os.scandir(base) if p.is_dir()):
        man = json.load(open(os.path.join(base, day, 'manifest.json')))
        for f in man['files']:
            blob = open(os.path.join(base, day, f['name']), 'rb').read()
            if sha(blob) != f['sha256']:
                raise ValueError(f'{day}/{f["name"]}: sha256 does not match its manifest — refusing to restore from it')
            t = {'file': FILE, 'close': CLOSE, 'export': EXPORT, 'count': COUNT}[f['name'].split('-')[0]]
            for line in gzip.decompress(blob).splitlines():
                r = json.loads(line); rows[t][r['id']] = r
    return rows


def verify_exports(ops):
    """Every export file's sha256 equals its manifest (a restore from the backup reproduces it exactly)."""
    bad, n = [], 0
    for man_p in sorted(glob.glob(os.path.join(ops, EXPORT_DIR, '*', 'manifest.json'))):
        man = json.load(open(man_p))
        for f in man['files']:
            n += 1
            b = open(os.path.join(os.path.dirname(man_p), f['name']), 'rb').read()
            if sha(b) != f['sha256']:
                bad.append(f['name'])
    return n, bad


def cmd_restore_check(ops):
    rows = read_backups(ops)
    for t in (FILE, CLOSE):
        top = max(rows[t], default=0)
        live = {r['id'] for page in P.select_pages(t, 'id', page=1000) for r in page if r['id'] <= top}
        missing, extra = live - set(rows[t]), set(rows[t]) - live
        print(f'### restore-check {t}: backups {len(rows[t])} rows (ids to {top}), live {len(live)}; {len(missing)} missing, {len(extra)} extra')
        if missing or extra:
            P.die(f'restore-check {t}: the backups and the live table disagree')
    for r in rows[FILE].values():                    # every stored file decompresses to its own sha256
        if sha(gzip.decompress(P.unhex(r['content_gz']))) != r['sha256']:
            P.die(f'restore-check: file {r["name"]} does not reproduce its sha256')
    n, bad = verify_exports(ops)
    print(f'### restore-check exports: {n} files, {len(bad)} sha256 mismatches')
    if bad:
        P.die(f'export files do not match their manifest: {bad}')


# ── the daily job: one clone of the private ops repo, one commit, a plain push ──────────────────────────────────────
OPS_FILES_DIR = os.path.join('tennis-data', 'files')
OPS_MANIFESTS_DIR = os.path.join('tennis-data', 'manifests')


def write_originals(ops, inv, day):
    """Every Tennis-Data file byte for byte into the ops repo (tennis-data/files/<sha256>__<name>, never replaced) and a
    dated manifest (tennis-data/manifests/<day>.json: name, source, sha256, bytes, rows, dates)."""
    d = os.path.join(ops, OPS_FILES_DIR); os.makedirs(d, exist_ok=True)
    added = 0
    for e in inv:
        fn = os.path.join(d, e['sha256'] + '__' + os.path.basename(e['name']))
        if os.path.exists(fn):
            if sha(open(fn, 'rb').read()) != e['sha256']:
                P.die(f'{fn} exists with different bytes: refusing to touch it')
            continue
        with open(fn, 'wb') as fh:
            fh.write(e['blob'])
        added += 1
    md = os.path.join(ops, OPS_MANIFESTS_DIR); os.makedirs(md, exist_ok=True)
    mp = os.path.join(md, f'{day}.json')
    if not os.path.exists(mp):
        with open(mp, 'w') as fh:
            json.dump({'day': day, 'files': [{k: e[k] for k in ('sha256', 'name', 'source', 'kind', 'bytes', 'row_count', 'first_date', 'last_date', 'obtained_at')}
                                             | {'stored': os.path.join(OPS_FILES_DIR, e['sha256'] + '__' + os.path.basename(e['name']))} for e in inv]}, fh, indent=1)
    return added


def cmd_daily(closes_json):
    import tempfile
    pat = P.env('WORKFLOW_PAT')
    day = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d')
    ops = tempfile.mkdtemp(prefix='tdarch-ops-')
    P.git('clone', '--quiet', '--filter=blob:none', f'https://x-access-token:{pat}@github.com/{P.OPS_REPO}.git', ops)
    mirror = tempfile.mkdtemp(prefix='tdarch-mirror-')
    fetch_mirror(out_dir=mirror)
    extra = [mirror, os.path.join(ops, ORIGINALS_DIR)]
    inv = cmd_import_files(extra)
    n_orig = write_originals(ops, inv, day)
    cmd_import_closes()
    if closes_json and os.path.exists(closes_json):
        cmd_export_csv(ops, closes_json)
    else:
        print('::warning::no pinnacle-closes.json: the CSV export is skipped this run (nothing written)')
    cmd_backup(ops)
    for d in ('tennis-data', EXPORT_DIR, BACKUP_DIR):             # one add per folder: a missing one never blocks the rest
        if os.path.isdir(os.path.join(ops, d)):
            P.git('add', '-A', d, cwd=ops)
    if P.git('status', '--porcelain', cwd=ops).strip():
        P.git('-c', 'user.name=stennisfy-archive-bot', '-c', 'user.email=archive-bot@users.noreply.github.com',
              'commit', '--quiet', '-m', f'historical odds archive {day}: originals +{n_orig}, export, backup', cwd=ops)
        P.git('push', '--quiet', 'origin', 'HEAD:main', cwd=ops)          # a plain push, never forced
    print('### daily', json.dumps({'day': day, 'originalsAdded': n_orig}))


def cmd_verify_export(ops, site='https://michaeldk1996.github.io/SAAS'):
    """Item 4's checks on the newest export: (a) per year, the rows priced on Tennis-Data Pinnacle / Bet365 equal the
    archive's current rows of that source; (b) no export file is reachable from the deployed site (a request per name,
    at the site root and at its ops path, must not answer 200); (c) every file matches its manifest sha256."""
    import urllib.request, urllib.error
    days = sorted(glob.glob(os.path.join(ops, EXPORT_DIR, '*', 'manifest.json')))
    if not days:
        P.die('no export in the ops repo yet')
    man = json.load(open(days[-1])); d = os.path.dirname(days[-1])
    rows = list(csv.DictReader(open(os.path.join(d, man['files'][0]['name']))))
    cur = current_td_closes(P.select_all(CLOSE, 'id,source,match_date,supersedes'))
    arch = collections.Counter((str(r['match_date'])[:4], r['source']) for r in cur)
    exp = collections.Counter()
    for r in rows:
        if r['source'] == 'Tennis-Data':
            exp[(r['date'][:4], 'tennis-data Pinnacle')] += 1
        if r['bet365_source'] == 'Tennis-Data':
            exp[(r['date'][:4], 'tennis-data Bet365')] += 1
    years = sorted({y for y, _ in arch} | {y for y, _ in exp})
    table = {y: {'exportRows': sum(1 for r in rows if r['date'][:4] == y),
                 'pinnacleTD': [exp[(y, 'tennis-data Pinnacle')], arch[(y, 'tennis-data Pinnacle')]],
                 'bet365TD': [exp[(y, 'tennis-data Bet365')], arch[(y, 'tennis-data Bet365')]]} for y in years}
    mism = [y for y, t in table.items() if t['pinnacleTD'][0] != t['pinnacleTD'][1] or t['bet365TD'][0] != t['bet365TD'][1]]
    reach = {}
    for f in man['files']:
        for url in (f'{site}/{f["name"]}', f'{site}/{EXPORT_DIR}/{man["day"]}/{f["name"]}'):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'stennisfy-tdarch'}), timeout=30) as r:
                    reach[url] = r.status
            except urllib.error.HTTPError as e:
                reach[url] = e.code
            except Exception as e:               # noqa: BLE001
                reach[url] = 'error ' + type(e).__name__
    open_urls = [u for u, c in reach.items() if c == 200]
    n, bad = verify_exports(ops)
    print('### verify-export', json.dumps({'day': man['day'], 'rows': len(rows), 'perYear': table, 'yearsMismatched': mism,
                                           'siteAnswers': collections.Counter(str(c) for c in reach.values()), 'reachable': open_urls,
                                           'filesChecked': n, 'shaMismatches': bad}))
    if mism or open_urls or bad:
        P.die('verify-export FAILED')


# ── guard ───────────────────────────────────────────────────────────────────────────────────────────────────────────
def cmd_counts(record=None):
    _, g, _ = P.rest('POST', '/rest/v1/rpc/historical_archive_guard', {})
    print('### guard', json.dumps(g))
    if record:
        row = {'job': record, 'file_rows': g[FILE]['rows'], 'close_rows': g[CLOSE]['rows'], 'export_rows': g[EXPORT]['rows'],
               'detail': {'guardOk': g.get('ok')}}
        P.insert(COUNT, [row], 'id')
        print('### recorded', json.dumps(row))
    if not g.get('ok'):
        P.die('historical archive guard NOT ok: ' + json.dumps(g))
    return g


if __name__ == '__main__':
    a = sys.argv[1:]
    if not a:
        print(__doc__); sys.exit(2)
    if a[0] == 'inventory':
        cmd_inventory(a[1:])
    elif a[0] == 'fetch-mirror':
        os.makedirs(a[1], exist_ok=True); fetch_mirror(out_dir=a[1])
    elif a[0] == 'import-files':
        cmd_import_files(a[1:])
    elif a[0] == 'import-closes':
        cmd_import_closes()
    elif a[0] == 'export-csv':
        cmd_export_csv(a[1], a[2])
    elif a[0] == 'backup':
        cmd_backup(a[1])
    elif a[0] == 'restore-check':
        cmd_restore_check(a[1])
    elif a[0] == 'daily':
        cmd_daily(a[1] if len(a) > 1 else None)
    elif a[0] == 'verify-export':
        cmd_verify_export(a[1])
    elif a[0] == 'counts':
        cmd_counts(a[a.index('--record') + 1] if '--record' in a else None)
    else:
        print(__doc__); sys.exit(2)
