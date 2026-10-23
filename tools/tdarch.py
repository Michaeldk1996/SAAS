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
  approx-import             Pinnacle (approx.) — founder ruling 2026-10-16: api-tennis's stored Pinnacle price for every ATP
                            main-draw match of 13 Jan - 16 Sep 2026 with no Tennis-Data Pinnacle close, into the snapshot
                            table (its own source and label, never a close); env API_TENNIS_KEY
  start10-import [--dry-run]
                            Pinnacle (approx.) — founder ruling 2026-10-17: for every ATP main-draw match of 13 Apr - 16 Sep
                            2026 with no Tennis-Data Pinnacle close, the Oddspapi Pinnacle archive's last active pinnacle+30
                            pair at Oddspapi's trueStart - 10 min (the ruled sanity gate first), into the snapshot table with
                            its cut, price time, start and gap to start; reads the archive, the committed fixture index and
                            api-tennis get_fixtures (UTC); never a metered Oddspapi call. --dry-run counts, inserts nothing
  te-import STORE [--dry-run]
                            Pinnacle (approx.) from Tennis Explorer — founder 2026-10-19: every joined match with a
                            Pinnacle pair in the private store's COMPLETE te-odds/ batch files (stennisfy-te-store), into the
                            snapshot table as source 'Tennis Explorer · Pinnacle' (never a close); the result and names from
                            the current api-tennis fixture; env API_TENNIS_KEY. --dry-run counts, inserts nothing
  te-import-new STORE OUT   the scheduled import (te-import-scheduled.yml): runs te-import only when the store holds a
                            complete batch the archive has no row of; one line per new batch into OUT (else OUT is empty)
  approx-feed OUT.csv       the current snapshots as the Database builder's feed (build-database-yield.js), each row with
                            its source
Env: SUPABASE_URL, SUPABASE_SECRET_KEY (service_role: SELECT + INSERT only)."""
import collections, csv, datetime as dt, glob, gzip, hashlib, io, json, os, re, subprocess, sys
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
_s = importlib.util.spec_from_file_location('pinarch', os.path.join(HERE, 'pinarch.py'))
P = importlib.util.module_from_spec(_s); _s.loader.exec_module(P)

FILE, CLOSE, EXPORT, COUNT = 'historical_odds_file', 'historical_close', 'historical_odds_export', 'historical_archive_count'
SNAP, SNAPCOUNT = 'historical_snapshot', 'historical_snapshot_count'
TABLES = (FILE, CLOSE, EXPORT, COUNT, SNAP, SNAPCOUNT)
# Pinnacle (approx.), founder ruling 2026-10-16: a SNAPSHOT (api-tennis carries no time for its prices), never a close.
APPROX_SOURCE, APPROX_LABEL = 'api-tennis Pinnacle', 'Pinnacle (approx.)'
APPROX_FROM, APPROX_TO = '2026-01-13', '2026-09-16'   # founder 2026-10-16: 12 Apr, widened to 16 Sep (round 3, item 3)
APPROX_HOVER = 'Pinnacle snapshot from api-tennis, no timestamp, not a confirmed close'
# founder brief 2026-10-19 (item 3): the lower levels and the events Tennis-Data does not cover take api-tennis's stored Bet365
# price where api-tennis has no Pinnacle pair — measured on 1,177 lower-level matches with a real close (17 Sep - 19 Oct):
# api-tennis Pinnacle median no-vig gap 0.08pp (789 priced), api-tennis Bet365 1.47pp (802). A SNAPSHOT, never a close.
B365_SOURCE, B365_LABEL = 'api-tennis Bet365', 'Bet365 (approx.)'
B365_HOVER = 'Bet365 snapshot from api-tennis, no timestamp, not a confirmed close'
APPROX_FEED_COLS = ['date', 'tournament', 'winner', 'loser', 'psw', 'psl', 'eventKey', 'snapshotId', 'source', 'cutTs', 'gapToStartS']
# Founder ruling 2026-10-17 (item 2): for 13 Apr - 16 Sep ATP main draw the first Pinnacle (approx.) source is the Oddspapi
# Pinnacle archive cut at Oddspapi's start - 10 min; api-tennis where the archive has no pre-cut pair; then Bet365; a dash.
# Still a SNAPSHOT (same label), never a close: the start alone is not a verified start (odds.md "close label").
START10_SOURCE = 'oddspapi Pinnacle (start − 10)'
START10_FROM, START10_TO = '2026-04-13', '2026-09-16'
START10_MIN = 10
START10_HOVER = 'Pinnacle history, taken 10 minutes before the recorded start, not a confirmed close'
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
    except BaseException as e:                   # noqa: BLE001 — the bytes are stored either way; the description is a dash
        # (BaseException: mirror-odds-archive.py's .xls reader exits when xlrd is missing — never the end of the run)
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
             if (P.same_player(e['td']['winner'], a['p1Name'], a.get('p1Key')) and P.same_player(e['td']['loser'], a['p2Name'], a.get('p2Key')))
             or (P.same_player(e['td']['winner'], a['p2Name'], a.get('p2Key')) and P.same_player(e['td']['loser'], a['p1Name'], a.get('p1Key')))]
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
            w1 = P.same_player(td['winner'], a['p1Name'], a.get('p1Key'))
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
    if P.day_written(d):                                   # complete: a same-day re-run skips it (founder 2026-10-16)
        print(f'### export-csv {day}: day already written, skipped')
        return None
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
    if man is None:                                        # today's export is already written and complete: nothing to add
        return None
    full = man['files'][0]
    P.insert(EXPORT, [{'name': full['name'], 'sha256': full['sha256'], 'rows': full['rows'], 'per_year': man['perYear'],
                       'location': f'{P.OPS_REPO}:{EXPORT_DIR}/{day}/{full["name"]}', 'detail': {'files': man['files']}}], 'name')
    print('### export-csv', json.dumps({k: man[k] for k in ('day', 'rows', 'perYear')}), json.dumps(man['perYearPinnacleSource']))
    return man


# ── backup / restore (the archive's own daily dated copy, in its own folder) ────────────────────────────────────────
def cmd_backup(ops):
    day = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d')
    d = os.path.join(ops, BACKUP_DIR, day)
    if P.day_written(d):
        print(f'### backup {day}: day already written, skipped'); return None
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
    for t, name in ((CLOSE, 'close-full.jsonl.gz'), (EXPORT, 'export-full.jsonl.gz'), (COUNT, 'count-full.jsonl.gz'),
                    (SNAP, 'snapshot-full.jsonl.gz'), (SNAPCOUNT, 'scount-full.jsonl.gz')):
        try:
            rows = P.select_all(t, '*')
        except RuntimeError:
            if t in (SNAP, SNAPCOUNT):                       # not installed yet: no file for it today (never a fake empty one)
                print(f'::warning::backup: {t} unreadable (not installed yet?) — not backed up today'); continue
            raise
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
            t = {'file': FILE, 'close': CLOSE, 'export': EXPORT, 'count': COUNT, 'snapshot': SNAP, 'scount': SNAPCOUNT}[f['name'].split('-')[0]]
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
    for t in (FILE, CLOSE, SNAP):
        if t == SNAP and not rows[t]:
            print(f'### restore-check {t}: no backup holds it yet — not compared'); continue
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
# ── Pinnacle (approx.): api-tennis's stored Pinnacle snapshot, 13 Jan - 16 Sep 2026 ATP main draw ────────────────────
def approx_targets(td_rows):
    """Tennis-Data rows in the window with no Tennis-Data Pinnacle pair (a Tennis-Data close is never replaced), a played
    match (walkovers out)."""
    return [r for r in td_rows if APPROX_FROM <= r['date'] <= APPROX_TO and not (price(r.get('psw')) and price(r.get('psl')))
            and 'walk' not in str(r.get('comment') or '').lower()]


def approx_join(r, by_day):
    """The ONE api-tennis ATP-singles fixture of a Tennis-Data row: dated the row's day -1 .. +2 (Tennis-Data dates some
    rows at the event's start), both surnames, either orientation. Returns (fixture, winnerIsFirst) or (None, reason)."""
    d = dt.date.fromisoformat(r['date']); c = []
    for k in (d - dt.timedelta(days=1), d, d + dt.timedelta(days=1), d + dt.timedelta(days=2)):
        for f in by_day.get(k.isoformat(), []):
            a, b = f.get('event_first_player'), f.get('event_second_player')
            ka, kb = f.get('first_player_key'), f.get('second_player_key')
            if P.same_player(r['winner'], a, ka) and P.same_player(r['loser'], b, kb): c.append((f, True))
            elif P.same_player(r['winner'], b, kb) and P.same_player(r['loser'], a, ka): c.append((f, False))
    if len(c) == 1:
        return c[0]
    return None, ('two fixtures' if c else 'no fixture')


def approx_rows(targets, by_day, odds_of, fetched_at, join=None, book='Pncl', source=None, label=None, hover=None):
    """Snapshot rows (Home = the fixture's first player) + a report. A side missing or below 1.01 = no row (Bet365 stays
    the fallback); nothing is filled from another book."""
    rows, rep = [], collections.Counter()
    for r in targets:
        f, w = (join or approx_join)(r, by_day)
        if f is None:
            rep['join: ' + w] += 1; continue
        ha = odds_of(f['event_key']) or {}
        h, a = (ha.get('Home') or {}).get(book), (ha.get('Away') or {}).get(book)
        ph, pa = price(h), price(a)
        if ph is None or pa is None:
            rep['no Pinnacle pair on api-tennis' if book == 'Pncl' else f'no {book} pair on api-tennis'] += 1; continue
        pw, pl = (ph, pa) if w else (pa, ph)
        src = source or APPROX_SOURCE
        rows.append({'dedupe_key': '|'.join(str(x) for x in (src, r['date'], r['tournament'], r['winner'], r['loser'], f['event_key'], pw, pl)),
                     'source': src, 'label': label or APPROX_LABEL, 'match_date': r['date'], 'tournament': r['tournament'],
                     'round': r.get('round') or None, 'winner': r['winner'], 'loser': r['loser'], 'event_key': int(f['event_key']),
                     'price_winner': pw, 'price_loser': pl, 'fetched_at': fetched_at,
                     'detail': dict({'home': h, 'away': a, 'firstPlayer': f.get('event_first_player'), 'secondPlayer': f.get('event_second_player'),
                                     'winnerIsFirst': w, 'apiTennisBook': book, 'hover': hover or APPROX_HOVER}, **(r.get('_detail') or {}))})
        rep['stored'] += 1
    return rows, dict(rep)


def snap_key(r):
    # per SOURCE: a start - 10 snapshot never supersedes an api-tennis one for the same match (two sources, both kept)
    return (r.get('source') or APPROX_SOURCE, str(r['match_date']), r['tournament'], r['winner'], r['loser'])


def plan_snapshots(new_rows, held):
    """A held dedupe_key adds nothing; a changed price for a held match is a new row that supersedes the old one."""
    keys = {h['dedupe_key'] for h in held}
    latest = {}
    for h in sorted(held, key=lambda h: h['id']):
        latest[snap_key(h)] = h['id']
    return [dict(r, supersedes=latest[snap_key(r)]) if snap_key(r) in latest else r for r in new_rows if r['dedupe_key'] not in keys]


def current_snapshots(rows):
    sup = {r['supersedes'] for r in rows if r.get('supersedes')}
    return sorted((r for r in rows if r['id'] not in sup), key=lambda r: (str(r['match_date']), r['tournament'], r['winner']))


def approx_feed_rows(current):
    return [{'date': str(r['match_date']), 'tournament': r['tournament'], 'winner': r['winner'], 'loser': r['loser'],
             'psw': r['price_winner'], 'psl': r['price_loser'], 'eventKey': r['event_key'], 'snapshotId': r['id'],
             'source': r.get('source') or APPROX_SOURCE, 'cutTs': r.get('cut_ts') or '', 'gapToStartS': '' if r.get('gap_to_start_s') is None else r['gap_to_start_s']}
            for r in current]


# ── Pinnacle (approx.) from the Oddspapi Pinnacle archive at start - 10 (founder ruling 2026-10-17, item 2) ─────────
def start10_targets(td_rows):
    return [r for r in approx_targets(td_rows) if START10_FROM <= r['date'] <= START10_TO]


def od_fixture_of(f, R, bmap, by_day_od):
    """The ONE Oddspapi fixture of an api-tennis fixture, the derive-held join: the board map, else the fixtures we hold
    (fixture index + back-fill raw meta) naming BOTH players within 36 h. (fixtureId, apiFirstIsParticipant1) or
    (None, reason)."""
    ek, a1, a2, ref = str(f.get('event_key')), f.get('event_first_player'), f.get('event_second_player'), P._at_start(f)
    bm = (bmap or {}).get(ek)
    if bm and bm.get('fixtureId') and bm.get('orient') in ('same', 'swap') and R.norm(bm.get('p1')) in (R.norm(a1), R.norm(a2)):
        return bm['fixtureId'], (bm['orient'] == 'same') == (R.norm(bm.get('p1')) == R.norm(a1))
    if ref is None:
        return None, 'api-tennis: no start date'
    c = P._fixture_candidates(R, a1, a2, ref, by_day_od)
    if len(c) != 1:
        return None, 'no Oddspapi fixture held' if not c else 'two or more Oddspapi fixtures'
    return c[0][0]['fixtureId'], c[0][1] == 'same'


def start10_rows(targets, by_day, od_of, fixtures, series_of, fetched_at, minutes=START10_MIN, join=None):
    """Snapshot rows at Oddspapi's trueStart - `minutes` + a report. `od_of(fixture)` -> (fixtureId, firstIsP1) | (None,
    why); `fixtures[fid]` the held Oddspapi fixture (trueStartTime, trueEndTime, startTime); `series_of(fid)` -> (raw_id,
    mw_series) | (None, why). The trueStart passes the ruled gate (effective_cut, no live-flip); a missing or rejected start,
    or no active pair on BOTH sides at or before the cut -> no row (api-tennis, then Bet365, price the match). A fixture two
    Tennis-Data rows claim is no one's."""
    rep, cand = collections.Counter(), []
    for r in targets:
        f, w = (join or approx_join)(r, by_day)
        if f is None:
            rep['join: ' + w] += 1; continue
        fid, first_p1 = od_of(f)
        if fid is None:
            rep['oddspapi: ' + first_p1] += 1; continue
        cand.append((r, f, w, fid, first_p1))
    claimed = collections.Counter(c[3] for c in cand)
    rows = []
    for r, f, w, fid, first_p1 in cand:
        if claimed[fid] > 1:
            rep['oddspapi: one fixture, two Tennis-Data rows'] += 1; continue
        fx = fixtures.get(fid) or {}
        ts, te, sc = P.iso_ms(fx.get('trueStartTime')), P.iso_ms(fx.get('trueEndTime')), P.iso_ms(fx.get('startTime'))
        start, src, reject = P.effective_cut(None, ts, te, sc)
        if start is None:
            rep['start: ' + str(reject)] += 1; continue
        raw_id, S = series_of(fid)
        if raw_id is None:
            rep['payload: ' + S] += 1; continue
        cut = start - dt.timedelta(minutes=minutes)
        c, why = P.close_at(S, cut)
        if c is None:
            rep['no pre-cut pair: ' + why] += 1; continue
        win_oc = '121' if bool(w) == bool(first_p1) else '122'
        lose_oc = '122' if win_oc == '121' else '121'
        pw, pl = c[win_oc][0], c[lose_oc][0]
        pts = max(P.iso_ms(c['121'][1]), P.iso_ms(c['122'][1]))
        iso = lambda x: x.isoformat().replace('+00:00', 'Z')
        rows.append({'dedupe_key': '|'.join(str(x) for x in (START10_SOURCE, r['date'], r['tournament'], r['winner'], r['loser'], f['event_key'], pw, pl, iso(cut))),
                     'source': START10_SOURCE, 'label': APPROX_LABEL, 'match_date': r['date'], 'tournament': r['tournament'],
                     'round': r.get('round') or None, 'winner': r['winner'], 'loser': r['loser'], 'event_key': int(f['event_key']),
                     'price_winner': pw, 'price_loser': pl, 'fetched_at': fetched_at,
                     'cut_ts': iso(cut), 'price_ts': iso(pts), 'start_ts': iso(start), 'start_source': src,
                     'gap_to_start_s': round((start - pts).total_seconds(), 3), 'fixture_id': fid, 'raw_id': raw_id,
                     'detail': {'minutesBeforeStart': minutes, 'book': 'pinnacle+30', 'winnerOutcome': win_oc,
                                'entries': {'121': list(c['121']), '122': list(c['122'])}, 'trueEnd': fx.get('trueEndTime'),
                                'fixtureFrom': fx.get('from'), 'firstPlayer': f.get('event_first_player'), 'secondPlayer': f.get('event_second_player'),
                                'winnerIsFirst': w, 'hover': START10_HOVER, **(r.get('_detail') or {})}})
        rep['stored'] += 1
    return rows, dict(rep)


def _at(params):
    import urllib.parse, urllib.request
    u = 'https://api.api-tennis.com/tennis/?' + urllib.parse.urlencode({**params, 'APIkey': P.env('API_TENNIS_KEY')})
    err = None
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'stennisfy-tdarch'}), timeout=120) as r:
                return json.loads(r.read())
        except Exception as e:
            err = e
    raise RuntimeError(f'api-tennis {params.get("method")} failed 3 times: {err}')


def cmd_approx_import():
    import concurrent.futures as cf
    td = [r for f in sorted(glob.glob(os.path.join(ROOT, 'odds-archive', '2026.csv'))) for r in csv.DictReader(open(f))]
    targets = approx_targets(td)
    d0, d1 = dt.date.fromisoformat(APPROX_FROM) - dt.timedelta(days=1), dt.date.fromisoformat(APPROX_TO) + dt.timedelta(days=2)
    days = [(d0 + dt.timedelta(days=i)).isoformat() for i in range((d1 - d0).days + 1)]
    by_day = collections.defaultdict(list)
    def day(d):
        j = _at({'method': 'get_fixtures', 'date_start': d, 'date_stop': d, 'timezone': 'UTC'})
        if not isinstance(j.get('result'), list) and j.get('success') != 1:
            raise RuntimeError(f'get_fixtures {d}: no result list ({str(j)[:200]})')
        return j.get('result') or []
    with cf.ThreadPoolExecutor(8) as ex:
        for res in ex.map(day, days):
            for f in res:
                if f.get('event_type_type') == 'Atp Singles':
                    by_day[f['event_date']].append(f)
    if not by_day:
        P.die('api-tennis returned no ATP singles fixture for the whole window: nothing written')
    cache = {}
    def odds(ek):
        o = _at({'method': 'get_odds', 'match_key': ek}).get('result') or {}
        return (o.get(str(ek)) or {}).get('Home/Away') or {}
    joined = [(r, approx_join(r, by_day)) for r in targets]
    eks = sorted({f['event_key'] for _, (f, _) in joined if f is not None})
    with cf.ThreadPoolExecutor(12) as ex:
        for ek, ha in zip(eks, ex.map(odds, eks)):
            cache[ek] = ha
    fetched = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    rows, rep = approx_rows(targets, by_day, cache.get, fetched)
    held = P.select_all(SNAP, 'id,dedupe_key,source,match_date,tournament,winner,loser,supersedes')
    add = plan_snapshots(rows, held)
    ids = []
    for i in range(0, len(add), 500):
        ids += P.insert(SNAP, add[i:i + 500], 'dedupe_key')
    month = collections.Counter(r['date'][:7] for r in targets)
    got = collections.Counter(str(r['match_date'])[:7] for r in rows)
    print('### approx-import', json.dumps({'window': [APPROX_FROM, APPROX_TO], 'targets': len(targets), 'report': rep, 'added': len(ids),
                                           'corrections': sum(1 for r in add if r.get('supersedes')),
                                           'perMonth': {m: f'{got[m]}/{month[m]}' for m in sorted(month)}}))
    cmd_snapshot_counts('approx-import')


def cmd_start10_import(dry_run=False):
    import concurrent.futures as cf
    td = [r for f in sorted(glob.glob(os.path.join(ROOT, 'odds-archive', '2026.csv'))) for r in csv.DictReader(open(f))]
    targets = start10_targets(td)
    d0, d1 = dt.date.fromisoformat(START10_FROM) - dt.timedelta(days=1), dt.date.fromisoformat(START10_TO) + dt.timedelta(days=2)
    days = [(d0 + dt.timedelta(days=i)).isoformat() for i in range((d1 - d0).days + 1)]
    by_day = collections.defaultdict(list)
    def day(d):
        j = _at({'method': 'get_fixtures', 'date_start': d, 'date_stop': d, 'timezone': 'UTC'})
        if not isinstance(j.get('result'), list) and j.get('success') != 1:
            raise RuntimeError(f'get_fixtures {d}: no result list ({str(j)[:200]})')
        return j.get('result') or []
    with cf.ThreadPoolExecutor(8) as ex:
        for res in ex.map(day, days):
            for f in res:
                if f.get('event_type_type') == 'Atp Singles':
                    by_day[f['event_date']].append(f)
    if not by_day:
        P.die('api-tennis returned no ATP singles fixture for the whole window: nothing written')
    R = P._load('roh', 'refresh-odds-history.py')
    idx = json.load(gzip.open(os.path.join(P.ROOT_DIR, P.FIXTURE_INDEX))).get('fixtures') or {}
    fixtures = P.held_fixture_meta(idx, P.select_all(P.RAW, 'id,fixture_id,books,meta', 'meta->>trigger=eq.backfill'))
    disc = [f for f in fixtures.values() if f.get('categoryName') in P.DISCOVERY_CATEGORIES]
    by_day_od, bmap = P._fixtures_by_day(disc), P._board_map()
    od_cache = {}
    def od_of(f):
        k = str(f.get('event_key'))
        if k not in od_cache:
            od_cache[k] = od_fixture_of(f, R, bmap, by_day_od)
        return od_cache[k]
    fids = sorted({od_of(f)[0] for r in targets for f, _ in [approx_join(r, by_day)] if f is not None and od_of(f)[0]})
    # ~1,500 payloads (~57 KB gz each): fetched 8 chunks at a time and turned into their match-winner series at once, so
    # the run fits the job's hour and never holds every payload in memory (read only; P.raw_latest per 10-id chunk)
    def chunk_series(ch):
        out = {}
        for fid, raw in P.raw_latest(ch).items():
            out[fid] = raw if raw is P.NO_PINNACLE else (raw['id'], P.mw_series(gzip.decompress(P.unhex(raw['payload_gz']))))
        return out
    series = {}
    with cf.ThreadPoolExecutor(8) as ex:
        for part in ex.map(chunk_series, [fids[i:i + 10] for i in range(0, len(fids), 10)]):
            series.update(part)
    def series_of(fid):
        got = series.get(fid)
        if not got:
            return None, 'no pinnacle+30 payload held'
        if got is P.NO_PINNACLE:
            return None, 'held payloads are another book only'
        return got
    fetched = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    rows, rep = start10_rows(targets, by_day, od_of, fixtures, series_of, fetched)
    held = P.select_all(SNAP, 'id,dedupe_key,source,match_date,tournament,winner,loser,supersedes')
    add = plan_snapshots(rows, held)
    ids = []
    if not dry_run:
        for i in range(0, len(add), 500):
            ids += P.insert(SNAP, add[i:i + 500], 'dedupe_key')
    month = collections.Counter((r['date'][:7] if r['date'][:7] != '2026-04' else '2026-04 13-30') for r in targets)
    got = collections.Counter((str(r['match_date'])[:7] if str(r['match_date'])[:7] != '2026-04' else '2026-04 13-30') for r in rows)
    gaps = sorted(r['gap_to_start_s'] for r in rows)
    print('### start10-import', json.dumps({'window': [START10_FROM, START10_TO], 'minutesBeforeStart': START10_MIN, 'dryRun': dry_run,
                                            'targets': len(targets), 'report': rep, 'wouldAdd' if dry_run else 'added': len(add) if dry_run else len(ids),
                                            'corrections': sum(1 for r in add if r.get('supersedes')),
                                            'perMonth': {m: f'{got[m]}/{month[m]}' for m in sorted(month)},
                                            'gapToStartS': {'median': gaps[len(gaps) // 2] if gaps else None, 'over60min': sum(g > 3600 for g in gaps)},
                                            'oddspapiFixtureCalls': 0}))
    if not dry_run:
        cmd_snapshot_counts('start10-import')
    return rows, rep


# ── The lower levels: ATP qualifying, Challenger (main draw + qualifying), ITF (founder ruling 2026-10-18 item 3) ──────
# Same source order as ATP main draw: 13 Apr - 16 Sep the Oddspapi archive at start - 10, then api-tennis's stored Pinnacle
# snapshot (1 Jan - 16 Sep), then the captured Bet365 (approx.), else a dash — every one a SNAPSHOT, never a close. The
# rows go into the same append-only snapshot table, each carrying its level, round and both api-tennis player keys in
# `detail`; the feed (pinnacle-approx-lower.csv) hands them to build-database-yield.js, which puts them in the master's
# lower-level shard — never a Database figure. From 17 Sep the archive's own closes price these levels (td-feed 'lower').
# founder brief 2026-10-19 (items 1 + 3): from 2021 — api-tennis keeps its stored prices back to 2022-23 (measured on the
# unpriced career rows: ATP qualifying 2023 686 of 1,234 priced, 2025 1,182 of 1,241; 2021 none) — and, beside the lower
# levels, the ATP events Tennis-Data does not cover ('atp-x': Davis Cup, United Cup, ATP Cup, Laver Cup, Hopman Cup, the
# Olympics, the Next Gen Finals, the Asian Games), which the master holds behind its team flag.
LOWER_FROM, LOWER_TO = '2021-01-01', '2026-09-16'
NOT_TD_EVENT = re.compile(r'davis cup|united cup|atp cup|laver cup|hopman|olympic|next ?gen|asian games', re.I)
LOWER_FEED_COLS = ['date', 'level', 'tournament', 'round', 'winner', 'loser', 'winnerKey', 'loserKey', 'psw', 'psl', 'eventKey',
                   'snapshotId', 'source', 'cutTs', 'gapToStartS', 'comment']
# Tennis Explorer's Pinnacle price (founder 2026-10-19, steps 0-3): a fourth snapshot source, 'Pinnacle (approx.)', never a
# close. TE_FEED_ON is THE switch for its place in the source order (founder: "ready to switch on after calibration"):
# off, the feed never carries a TE row, so nothing any page shows changes; on, a TE row ranks after start - 10 and before
# api-tennis's Pinnacle (close > start - 10 > TE > api-tennis Pinnacle > captured Bet365 > api-tennis Bet365). The import
# (te-import) stores TE rows either way: the archive is evidence, the switch is the reading.
TE_FEED_ON = True    # founder 2026-10-20: calibration passed (median 0.10pp on 988) — switched on
TE_SOURCE = 'Tennis Explorer · Pinnacle'
TE_HOVER = 'Tennis Explorer, last pre-match price, not a confirmed close'   # one fixed text, no time (the time stays in price_ts)
TE_LEVELS = ('atp-q', 'atp-x', 'ch', 'ch-q')
RESULT_STATUSES = ('Finished', 'Retired')


def lower_level(f):
    """pinarch's levels ('atp-q' | 'ch' | 'ch-q' | 'itf'), plus 'atp-x': an ATP singles main-draw match at an event Tennis-Data
    does not carry (its own regex on api-tennis's tournament name). Read here only: pinarch's lower closes keep its own
    levels, so a team event's archive close still travels the td-feed 'team' path, never twice."""
    lv = P.lower_level(f)
    if lv or f.get('event_type_type') != 'Atp Singles':
        return lv
    return 'atp-x' if NOT_TD_EVENT.search(str(f.get('tournament_name') or '')) else None


def lower_targets(fixtures, frm=LOWER_FROM, to=LOWER_TO):
    """One target per played lower-level match with a result: the api-tennis fixture itself is the join (no name guess)."""
    out, rep = [], collections.Counter()
    for f in fixtures:
        lv = lower_level(f)
        if not lv or not (frm <= str(f.get('event_date') or '') <= to):
            continue
        st = str(f.get('event_status') or '')
        if 'walk' in st.lower():
            rep[lv + ': walkover'] += 1; continue
        if st not in RESULT_STATUSES or f.get('event_winner') not in ('First Player', 'Second Player'):
            rep[lv + ': no result'] += 1; continue
        fw = f['event_winner'] == 'First Player'
        a, b = f.get('event_first_player'), f.get('event_second_player')
        ka, kb = f.get('first_player_key'), f.get('second_player_key')
        out.append({'date': f['event_date'], 'tournament': str(f.get('tournament_name') or '').strip(), 'round': f.get('tournament_round') or None,
                    'winner': a if fw else b, 'loser': b if fw else a, '_f': f, '_w': fw,
                    '_detail': {'level': lv, 'round': f.get('tournament_round'), 'winnerKey': str(ka if fw else kb), 'loserKey': str(kb if fw else ka),
                                'status': st}})
        rep[lv] += 1
    return out, dict(rep)


def _lower_join(r, _by_day):
    return r['_f'], r['_w']


def lower_feed_rows(current):
    """The lower-level snapshots, one source per match: start - 10 first, else api-tennis (by event key)."""
    best = {}
    for r in current:
        d = r.get('detail') or {}
        if not d.get('level'):
            continue
        k = r['event_key']
        if r.get('source') == TE_SOURCE and (not TE_FEED_ON or te_in_play(r)):
            continue
        # founder 2026-10-20: start - 10 > api-tennis Pinnacle > Tennis Explorer Pinnacle > api-tennis Bet365
        rank = 0 if r.get('source') == START10_SOURCE else 1.5 if r.get('source') == TE_SOURCE else 2 if r.get('source') == B365_SOURCE else 1
        if k not in best or rank < best[k][0]:
            best[k] = (rank, r)
    out = []
    for _, r in sorted(best.values(), key=lambda x: (str(x[1]['match_date']), x[1]['event_key'])):
        d = r['detail']
        out.append({'date': str(r['match_date']), 'level': d['level'], 'tournament': r['tournament'], 'round': d.get('round') or '',
                    'winner': P.td_name(r['winner']), 'loser': P.td_name(r['loser']), 'winnerKey': d.get('winnerKey') or '', 'loserKey': d.get('loserKey') or '',
                    'psw': r['price_winner'], 'psl': r['price_loser'], 'eventKey': r['event_key'], 'snapshotId': r['id'],
                    'source': r.get('source') or APPROX_SOURCE, 'cutTs': r.get('cut_ts') or '',
                    'gapToStartS': '' if r.get('gap_to_start_s') is None else r['gap_to_start_s'],
                    'comment': 'Retired' if d.get('status') == 'Retired' else 'Completed'})
    return out


def _lower_fixtures(frm, to):
    import concurrent.futures as cf
    d0, d1 = dt.date.fromisoformat(frm), dt.date.fromisoformat(to)
    days = [(d0 + dt.timedelta(days=i)).isoformat() for i in range((d1 - d0).days + 1)]
    def day(d):
        j = _at({'method': 'get_fixtures', 'date_start': d, 'date_stop': d, 'timezone': 'UTC'})
        if not isinstance(j.get('result'), list) and j.get('success') != 1:
            raise RuntimeError(f'get_fixtures {d}: no result list ({str(j)[:200]})')
        # slim: the point-by-point, set scores and statistics are dropped (the 2021+ window holds ~2,100 days of fixtures)
        return d, [{k: v for k, v in f.items() if not isinstance(v, (list, dict))} for f in (j.get('result') or []) if lower_level(f)]
    def odds(d):
        j = _at({'method': 'get_odds', 'date_start': d, 'date_stop': d})
        return d, j.get('result') if isinstance(j.get('result'), dict) else {}
    fx, od, empty = [], {}, []
    with cf.ThreadPoolExecutor(8) as ex:
        for d, res in ex.map(day, days):
            fx += res
            if not res:
                empty.append(d)
        for d, res in ex.map(odds, days):
            for ek, v in res.items():
                od[str(ek)] = (v or {}).get('Home/Away') or {}
    return fx, od, empty


def cmd_lower_import(dry_run=False, frm=LOWER_FROM, to=LOWER_TO, unpriced_out=None):
    """Write the lower-level snapshots (append-only, the same table and guard as the ATP main-draw ones)."""
    fx, od, empty = _lower_fixtures(frm, to)
    if not fx:
        P.die('api-tennis returned no lower-level fixture for the whole window: nothing written')
    targets, trep = lower_targets(fx, frm, to)
    fetched = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    api_rows, arep = approx_rows(targets, None, lambda ek: od.get(str(ek)) or {}, fetched, join=_lower_join)
    # start - 10: the held Oddspapi payloads, joined as derive-held / start10-import join (board map, else the fixtures
    # we hold naming BOTH players within 36 h); ITF Men fixtures are in the held index and the back-fill pulls their payloads
    s10 = [r for r in targets if START10_FROM <= r['date'] <= START10_TO]
    R = P._load('roh', 'refresh-odds-history.py')
    idx = json.load(gzip.open(os.path.join(P.ROOT_DIR, P.FIXTURE_INDEX))).get('fixtures') or {}
    fixtures = P.held_fixture_meta(idx, P.select_all(P.RAW, 'id,fixture_id,books,meta', 'meta->>trigger=eq.backfill'))
    disc = [f for f in fixtures.values() if f.get('categoryName') in P.BACKFILL_CATEGORIES]
    by_day_od, bmap = P._fixtures_by_day(disc), P._board_map()
    oc = {}
    def od_of(f):
        k = str(f.get('event_key'))
        if k not in oc:
            oc[k] = od_fixture_of(f, R, bmap, by_day_od)
        return oc[k]
    fids = sorted({od_of(r['_f'])[0] for r in s10 if od_of(r['_f'])[0]})
    import concurrent.futures as cf
    def chunk_series(ch):
        out = {}
        for fid, raw in P.raw_latest(ch).items():
            out[fid] = raw if raw is P.NO_PINNACLE else (raw['id'], P.mw_series(gzip.decompress(P.unhex(raw['payload_gz']))))
        return out
    series = {}
    with cf.ThreadPoolExecutor(8) as ex:
        for part in ex.map(chunk_series, [fids[i:i + 10] for i in range(0, len(fids), 10)]):
            series.update(part)
    def series_of(fid):
        got = series.get(fid)
        if not got:
            return None, 'no pinnacle+30 payload held'
        if got is P.NO_PINNACLE:
            return None, 'held payloads are another book only'
        return got
    s10_rows, srep = start10_rows(s10, None, od_of, fixtures, series_of, fetched, join=_lower_join)
    # then api-tennis's Bet365 where neither Pinnacle source holds a pair (founder brief 2026-10-19 item 3)
    have_pin = {r['event_key'] for r in s10_rows + api_rows}
    b_rows, brep = approx_rows([r for r in targets if int(r['_f']['event_key']) not in have_pin], None, lambda ek: od.get(str(ek)) or {}, fetched,
                               join=_lower_join, book='bet365', source=B365_SOURCE, label=B365_LABEL, hover=B365_HOVER)
    rows = s10_rows + api_rows + b_rows
    # founder ruling 2026-10-18 (item 5): every played match we checked and could not price, with its reason — api-tennis
    # priced one player only ("one side only") or neither ("no bookmaker priced it"). Read by build-database-yield.js (the
    # dash's hover); a price from another source (our captured Bet365) wins over it there.
    priced = {r['event_key'] for r in rows}
    unpriced = []
    for r in targets:
        ek = int(r['_f']['event_key'])
        if ek in priced:
            continue
        ha = od.get(str(ek)) or {}
        sides = max(sum(1 for side in ('Home', 'Away') if price((ha.get(side) or {}).get(bk)) is not None) for bk in ('Pncl', 'bet365'))
        d = r['_detail']
        unpriced.append([r['date'], P.td_name(r['winner']), P.td_name(r['loser']), 'one' if sides == 1 else 'nobook', d['winnerKey'], d['loserKey'], ek, d['level']])
    if unpriced_out:
        tmp = unpriced_out + '.tmp'
        with open(tmp, 'w') as fh:
            json.dump({'rule': 'lower-level matches no source priced (founder 2026-10-18 item 5)', 'window': [frm, to], 'rows': unpriced}, fh)
        os.replace(tmp, unpriced_out)
    held = P.select_all(SNAP, 'id,dedupe_key,source,match_date,tournament,winner,loser,supersedes')
    add = plan_snapshots(rows, held)
    ids = []
    if not dry_run:
        for i in range(0, len(add), 500):
            ids += P.insert(SNAP, add[i:i + 500], 'dedupe_key')
    lv_month = collections.Counter((r['_detail']['level'], r['date'][:7]) for r in targets)
    got = collections.defaultdict(set)
    for r in rows:
        got[(r['detail']['level'], str(r['match_date'])[:7])].add(r['event_key'])
    print('### lower-import', json.dumps({'window': [frm, to], 'dryRun': dry_run, 'fixtures': len(fx), 'daysWithNoFixture': empty,
                                          'targets': trep, 'apiTennis': arep, 'start10': srep, 'apiTennisBet365': brep, 'wouldAdd' if dry_run else 'added': len(add) if dry_run else len(ids),
                                          'pricedOfPlayed': {f'{lv} {m}': f'{len(got[(lv, m)])}/{n}' for (lv, m), n in sorted(lv_month.items())},
                                          'unpriced': dict(collections.Counter(u[3] for u in unpriced)),
                                          'oddspapiFixtureCalls': 0}))
    if not dry_run:
        cmd_snapshot_counts('lower-import')
    return rows


# ── Tennis Explorer · Pinnacle (founder 2026-10-19, steps 0-3) ───────────────────────────────────────────────────────
def te_docs(store):
    """The COMPLETE batch files of the private store's te-odds/ (te-odds-batch.mjs, stennisfy-ops). A partial batch is
    skipped and counted (re-run on the Mac first); a file that does not read stops the import."""
    docs, skipped = [], []
    for f in sorted(glob.glob(os.path.join(store, 'te-odds', '*.json'))):
        with open(f) as fh:
            d = json.load(fh)
        if d.get('source') != TE_SOURCE or not isinstance(d.get('rows'), list):
            P.die(f'{f}: not a te-odds batch file (source {d.get("source")!r})')
        (docs if d.get('complete') else skipped).append(d if d.get('complete') else d.get('batch') or os.path.basename(f))
    return docs, skipped


def _ts(v):
    """An ISO instant (Z or offset) -> aware UTC datetime; None when absent or unreadable."""
    if not v:
        return None
    try:
        t = dt.datetime.fromisoformat(str(v).replace('Z', '+00:00'))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def te_start(x, f, flip_start):
    """The start the in-play rule measures against (founder 2026-10-20): our VERIFIED start where we have one — the close's
    start in the batch row (the calibration rows), else our live-flip (live_flip_log, from 17 Sep) — otherwise the SCHEDULED
    start, api-tennis's event_date + event_time read in UTC (the fixture is asked with timezone=UTC). (start, kind)."""
    v = _ts(((x.get('close') or {}).get('startTs')))
    if v:
        return v, 'verified (our close)'
    v = _ts(flip_start(str(x.get('ek'))))
    if v:
        return v, 'verified (live-flip)'
    d, t = str(f.get('event_date') or ''), str(f.get('event_time') or '')
    if re.fullmatch(r'\d{4}-\d\d-\d\d', d) and re.fullmatch(r'\d\d:\d\d', t):
        return dt.datetime.fromisoformat(f'{d}T{t}:00+00:00'), 'scheduled'
    return None, None


def te_rows(docs, fixture_of, flip_start=lambda ek: None):
    """Snapshot rows from the joined TE matches with a Pinnacle pair + a report. `fixture_of(ek)` = the CURRENT api-tennis
    fixture (the result and the names; a match with no result, a walkover or an unreadable fixture -> no row). Prices
    are oriented to the winner from TE's a / b (= api-tennis's first / second player). A side below 1.01 = no row. ITF is
    out of scope: a TE row of any other level is refused, never stored."""
    rows, rep = [], collections.Counter()
    for d in docs:
        for x in d['rows']:
            if x.get('status') != 'joined':
                rep[f"{x.get('status')}"] += 1; continue
            p = x.get('pin')
            if not p:
                rep['joined, no Pinnacle on the page'] += 1; continue
            if x.get('level') not in TE_LEVELS:
                rep['level out of scope'] += 1; continue
            p1, p2 = price(p.get('p1')), price(p.get('p2'))
            if p1 is None or p2 is None:
                rep['a side below 1.01'] += 1; continue
            if not re.fullmatch(r'[0-9a-f]{64}', str(x.get('pageSha256') or '')) or not re.fullmatch(r'[0-9]+', str(x.get('teId') or '')):
                rep['no page sha256 / TE id'] += 1; continue
            f = fixture_of(str(x['ek']))
            if not f:
                rep['api-tennis fixture unreadable'] += 1; continue
            st = str(f.get('event_status') or '')
            if 'walk' in st.lower():
                rep['walkover'] += 1; continue
            if st not in RESULT_STATUSES or f.get('event_winner') not in ('First Player', 'Second Player'):
                rep['no result'] += 1; continue
            fw = f['event_winner'] == 'First Player'
            a, b = f.get('event_first_player'), f.get('event_second_player')
            ka, kb = str(f.get('first_player_key')), str(f.get('second_player_key'))
            # TE's a / b are the target's a / b; the fixture must still name the same two players in that order
            if {ka, kb} != {str(x.get('ka')), str(x.get('kb'))}:
                rep['fixture names other players'] += 1; continue
            same = str(x.get('ka')) == ka
            pa, pb = (p1, p2) if same else (p2, p1)
            pw, pl = (pa, pb) if fw else (pb, pa)
            ts = [t for t in (p.get('p1Ts'), p.get('p2Ts')) if t]
            pts = max(ts) if ts else None
            # the in-play rule (founder 2026-10-20): a price whose last change came after the start is dropped
            start, kind = te_start(x, f, flip_start)
            bt = f"batch {d.get('batch')}: "
            if start is None:
                rep['no start time to check (kept)'] += 1; rep[bt + 'kept, no start time'] += 1
            elif pts and _ts(pts) and _ts(pts) > start:
                rep['dropped: last change after the start'] += 1
                rep[f'dropped: last change after the start ({kind})'] += 1
                rep[f"dropped in batch {d.get('batch')}"] += 1
                continue
            # kept, counted per batch (founder 2026-10-20: kept for these levels; the rule is applied again at read time, so it can
            # be tightened later without touching the append-only table): no TE time, a change in the start's own minute (TE prints
            # minutes), and the over-1pp share of the no-time group where the batch row carries our verified close
            if not pts:
                rep[bt + 'kept, no TE timestamp'] += 1
            elif start is not None and _ts(pts) > start - dt.timedelta(minutes=1):
                rep[bt + "kept, in the start's own minute"] += 1
            c = x.get('close') or {}
            if price(c.get('p1')) and price(c.get('p2')):
                g = abs(1 / p1 / (1 / p1 + 1 / p2) - 1 / c['p1'] / (1 / c['p1'] + 1 / c['p2'])) * 100
                grp = 'no TE timestamp' if not pts else 'with a TE timestamp'
                rep[f'{bt}{grp}, with our close'] += 1
                rep[f'{bt}{grp}, over 1pp vs our close'] += g > 1
            tour = str(f.get('tournament_name') or '').strip()
            rows.append({'dedupe_key': '|'.join(str(v) for v in (TE_SOURCE, f['event_date'], tour, a if fw else b, b if fw else a, x['ek'], pw, pl, x['pageSha256'])),
                         'source': TE_SOURCE, 'label': APPROX_LABEL, 'match_date': f['event_date'], 'tournament': tour,
                         'round': f.get('tournament_round') or None, 'winner': a if fw else b, 'loser': b if fw else a, 'event_key': int(x['ek']),
                         'price_winner': pw, 'price_loser': pl, 'fetched_at': x.get('fetchedAt'), 'price_ts': pts,
                         'detail': {'level': x['level'], 'round': f.get('tournament_round'), 'winnerKey': ka if fw else kb, 'loserKey': kb if fw else ka,
                                    'status': st, 'teMatchId': str(x['teId']), 'pageSha256': x['pageSha256'], 'batch': d.get('batch'),
                                    'teTournament': x.get('tour'), 'books': x.get('books') or [], 'moves': p.get('moves'),
                                    'sideTs': {'first': p.get('p1Ts') if same else p.get('p2Ts'), 'second': p.get('p2Ts') if same else p.get('p1Ts')},
                                    'open': {'first': (p.get('open') or {}).get('p1' if same else 'p2'), 'second': (p.get('open') or {}).get('p2' if same else 'p1'),
                                             'firstTs': (p.get('open') or {}).get('p1Ts' if same else 'p2Ts'), 'secondTs': (p.get('open') or {}).get('p2Ts' if same else 'p1Ts')},
                                    'firstPlayer': a, 'secondPlayer': b, 'winnerIsFirst': fw, 'hover': TE_HOVER,
                                    'startChecked': start.isoformat().replace('+00:00', 'Z') if start else None, 'startKind': kind}})
            rep['stored'] += 1
    return rows, dict(rep)


def te_in_play(r):
    """The in-play rule at READ time (founder 2026-10-20): a stored TE row whose last change (price_ts) is after the start it was
    checked against (detail.startChecked) is never fed. te-import applies the same rule; reading it here as well keeps the
    rule in one place that can be tightened later without touching the append-only table. No time or no start: fed."""
    t, s = _ts(r.get('price_ts')), _ts((r.get('detail') or {}).get('startChecked'))
    return bool(t and s and t > s)


def te_flip_starts(eks):
    """event key -> our live-flip start (live_flip_log.last_not_live_seen_at), for the events dated from 17 Sep."""
    out = {}
    eks = sorted(set(eks))
    for i in range(0, len(eks), 150):
        _, got, _ = P.rest('GET', '/rest/v1/live_flip_log?select=event_key,last_not_live_seen_at&event_key=in.(' + ','.join(eks[i:i + 150]) + ')')
        for g in got or []:
            if g.get('last_not_live_seen_at'):
                out[str(g['event_key'])] = g['last_not_live_seen_at']
    return out


def te_coverage(rows, held, closed):
    """Per level and year: the matches whose feed price becomes Tennis Explorer's (no close, no start - 10 and no
    api-tennis Pinnacle snapshot for the event — those come first): newly priced (no snapshot before) or replacing an
    api-tennis Bet365 snapshot. Our captured Bet365 (bet365-history/, not in this table) is not seen here."""
    by = collections.defaultdict(set)
    for h in held:
        if h.get('source') != TE_SOURCE and h.get('supersedes') is None:
            by[str(h.get('event_key'))].add(h.get('source'))
    wins, newly, over = (collections.defaultdict(collections.Counter) for _ in range(3))
    for r in rows:
        ek, lv, y = str(r['event_key']), r['detail']['level'], str(r['match_date'])[:4]
        src = by.get(ek, set())
        if ek in closed or START10_SOURCE in src or APPROX_SOURCE in src:
            continue
        wins[lv][y] += 1
        (over if B365_SOURCE in src else newly)[lv][y] += 1
    return {'teWins': {k: dict(v) for k, v in wins.items()}, 'newlyPriced': {k: dict(v) for k, v in newly.items()},
            'overB365': {k: dict(v) for k, v in over.items()}}


def te_coverage_lines(gained):
    """One line per level: per year, the matches TE now prices, split into newly priced / replacing an api-tennis Bet365
    snapshot. A level with nothing in one split reads 0 there (atp-x on 22 Oct: no api-tennis Bet365 to replace)."""
    return [f"te-import coverage {lv}: " + ' · '.join(f"{y} {n} priced by TE ({gained['newlyPriced'].get(lv, {}).get(y, 0)} with no snapshot before, "
                                                     f"{gained['overB365'].get(lv, {}).get(y, 0)} replacing an api-tennis Bet365 snapshot)"
                                                     for y, n in sorted(gained['teWins'][lv].items()))
            for lv in sorted(gained['teWins'])]


def te_import_run(store, dry_run=False):
    """The te-import itself (insert-only; a changed price for a held match is a new row that supersedes the old one), with
    everything the report lines need. Env SUPABASE_URL / SUPABASE_SECRET_KEY, API_TENNIS_KEY (the current fixture per event)."""
    docs, skipped = te_docs(store)
    if not docs:
        P.die(f'{store}/te-odds: no complete batch file — nothing to import' + (f' (partial: {", ".join(skipped)})' if skipped else ''))
    akey = os.environ.get('API_TENNIS_KEY') or P.die('API_TENNIS_KEY is not set')
    eks = sorted({str(x['ek']) for d in docs for x in d['rows'] if x.get('status') == 'joined' and x.get('pin')})
    fx = P.apitennis_fixture_fetcher(akey)(eks)
    flip = te_flip_starts([ek for d in docs for x in d['rows'] if x.get('status') == 'joined' and x.get('pin') and str(x.get('date') or '') >= P.VERIFIED_START_FROM
                           for ek in [str(x['ek'])]])
    rows, rep = te_rows(docs, fx.get, flip.get)
    held = P.select_all(SNAP, 'id,dedupe_key,source,match_date,tournament,winner,loser,supersedes,event_key')
    add = plan_snapshots(rows, held)
    closed = {str(r['event_key']) for r in P.select_all(P.CLOSE, 'event_key')}
    gained = te_coverage(rows, held, closed)
    ids = []
    if not dry_run:
        for i in range(0, len(add), 500):
            ids += P.insert(SNAP, add[i:i + 500], 'dedupe_key')
    print('### te-import', json.dumps({'dryRun': dry_run, 'batches': [d.get('batch') for d in docs], 'partialSkipped': skipped, 'report': rep,
                                       'byLevel': collections.Counter(r['detail']['level'] for r in rows),
                                       'wouldAdd' if dry_run else 'added': len(add) if dry_run else len(ids), 'feedOn': TE_FEED_ON,
                                       'coverage': gained}))
    for line in te_coverage_lines(gained):
        print(line)
    if not dry_run:
        cmd_snapshot_counts('te-import')
    return {'docs': docs, 'rows': rows, 'rep': rep, 'add': add, 'held': held, 'closed': closed, 'added': len(ids)}


def cmd_te_import(store, dry_run=False):
    return te_import_run(store, dry_run)['rows']


# founder brief 2026-10-23 item 5: a batch whose no-timestamp share passes this is flagged to the founder
TE_NO_TS_FLAG = 0.25


def te_batch_lines(batches, rows, add, rep, held, closed):
    """One plain line per batch: rows stored (this import), in-play dropped, kept with no TE timestamp (with its share of the
    stored rows), and the coverage gained per level and year (the matches this batch's rows price, te_coverage's rule).
    A share over TE_NO_TS_FLAG is flagged. Pure: the scheduled job and the tests read it the same way."""
    out = []
    for b in batches:
        stored = sum(1 for r in add if (r.get('detail') or {}).get('batch') == b)
        dropped = rep.get(f'dropped in batch {b}', 0)
        no_ts = rep.get(f'batch {b}: kept, no TE timestamp', 0)
        mine = [r for r in rows if r['detail'].get('batch') == b]
        gained = te_coverage(mine, held, closed)
        cov = '; '.join(f"{lv} " + ', '.join(f"{y} +{n}" for y, n in sorted(ys.items())) for lv, ys in sorted(gained['teWins'].items())) or 'none'
        share = no_ts / stored if stored else 0
        line = (f"TE batch {b}: {stored} rows stored, {dropped} dropped as in-play, {no_ts} of {stored} kept with no TE timestamp "
                f"({share:.0%}); coverage gained {cov}")
        if share > TE_NO_TS_FLAG:
            line += f" — FLAG: no-timestamp share {share:.0%} is over {TE_NO_TS_FLAG:.0%}"
        out.append(line)
    return out


def te_imported_batches():
    """The batch ids the snapshot table already holds Tennis Explorer rows for (detail.batch)."""
    import urllib.parse
    got = P.select_all(SNAP, 'detail', 'source=eq.' + urllib.parse.quote(TE_SOURCE))
    return {(g.get('detail') or {}).get('batch') for g in got} - {None}


def cmd_te_import_new(store, out_path):
    """The scheduled import (founder brief 2026-10-23 item 3): a complete batch in the store that the archive holds no row of
    is imported (the same te-import: insert-only, idempotent, so a re-run adds 0) and its line is written to out_path for the
    alert. Nothing new: the file is left empty and nothing is written to the archive (no count row)."""
    docs, skipped = te_docs(store)
    have = te_imported_batches()
    new = [d.get('batch') for d in docs if d.get('batch') not in have]
    print('### te-import-new', json.dumps({'storeBatches': [d.get('batch') for d in docs], 'partial': skipped, 'imported': sorted(have), 'new': new}))
    lines = []
    if new:
        r = te_import_run(store)
        lines = te_batch_lines(new, r['rows'], r['add'], r['rep'], r['held'], r['closed'])
        for l in lines:
            print(l)
    with open(out_path + '.tmp', 'w') as fh:
        fh.write('\n'.join(lines) + ('\n' if lines else ''))
    os.replace(out_path + '.tmp', out_path)
    return lines


def cmd_approx_feed(out_csv, lower_csv=None):
    try:
        try:
            held = P.select_all(SNAP, 'id,source,match_date,tournament,winner,loser,event_key,price_winner,price_loser,supersedes,cut_ts,price_ts,gap_to_start_s,detail')
        except RuntimeError as e:                                    # the start - 10 columns not installed yet: api-tennis rows only
            if '42703' not in str(e) and 'does not exist' not in str(e):
                raise
            print(f'::warning::approx-feed: the start - 10 columns are not installed yet ({str(e)[:160]}) — api-tennis snapshots only')
            held = P.select_all(SNAP, 'id,source,match_date,tournament,winner,loser,event_key,price_winner,price_loser,supersedes')
    except RuntimeError as e:
        if 'PGRST205' in str(e) or 'HTTP 404' in str(e):        # the snapshot table is not installed yet: no feed, said out loud
            print(f'::warning::approx-feed: the snapshot table is not installed yet ({e}) — no feed file; Bet365 stays the fallback')
            return
        raise
    cur = current_snapshots(held)
    lower = lower_feed_rows(cur)
    cur = [r for r in cur if not (r.get('detail') or {}).get('level')]
    if lower_csv:
        tmp = lower_csv + '.tmp'
        with open(tmp, 'w') as fh:
            fh.write(','.join(LOWER_FEED_COLS) + '\n')
            for r in lower:
                fh.write(','.join(str(r[k]).replace(',', ' ') for k in LOWER_FEED_COLS) + '\n')
        os.replace(tmp, lower_csv)
        print('### lower-feed', json.dumps({'rows': len(lower), 'byLevel': collections.Counter(r['level'] for r in lower),
                                            'bySource': collections.Counter(r['source'] for r in lower), 'file': lower_csv}))
    if not cur:
        print('::warning::approx-feed: no snapshot rows yet (approx-import has not run) — no feed file; Bet365 stays the fallback')
        return
    rows = approx_feed_rows(cur)
    for r in rows:
        if any(',' in str(r[k]) for k in APPROX_FEED_COLS):
            P.die(f'a feed field holds a comma: {r}')
    tmp = out_csv + '.tmp'
    with open(tmp, 'w') as fh:
        fh.write(','.join(APPROX_FEED_COLS) + '\n')
        for r in rows:
            fh.write(','.join(str(r[k]) for k in APPROX_FEED_COLS) + '\n')
    os.replace(tmp, out_csv)
    print('### approx-feed', json.dumps({'rows': len(rows), 'bySource': collections.Counter(r['source'] for r in rows), 'file': out_csv}))


def cmd_snapshot_counts(record=None):
    _, g, _ = P.rest('POST', '/rest/v1/rpc/historical_snapshot_guard', {})
    print('### snapshot guard', json.dumps(g))
    if record:
        row = {'job': record, 'snapshot_rows': g[SNAP]['rows'], 'detail': {'guardOk': g.get('ok')}}
        P.insert(SNAPCOUNT, [row], 'id')
    if not g.get('ok'):
        P.die('historical snapshot guard NOT ok: ' + json.dumps(g))
    return g


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
    elif a[0] == 'approx-import':
        cmd_approx_import()
    elif a[0] == 'start10-import':
        cmd_start10_import('--dry-run' in a)
    elif a[0] == 'approx-feed':
        cmd_approx_feed(a[1], a[2] if len(a) > 2 else None)
    elif a[0] == 'lower-import':
        cmd_lower_import('--dry-run' in a, a[a.index('--from') + 1] if '--from' in a else LOWER_FROM, a[a.index('--to') + 1] if '--to' in a else LOWER_TO,
                         a[a.index('--unpriced') + 1] if '--unpriced' in a else None)
    elif a[0] == 'te-import':
        cmd_te_import(a[1], '--dry-run' in a)
    elif a[0] == 'te-import-new':
        cmd_te_import_new(a[1], a[2])
    elif a[0] == 'snapshot-counts':
        cmd_snapshot_counts(a[a.index('--record') + 1] if '--record' in a else None)
    else:
        print(__doc__); sys.exit(2)
