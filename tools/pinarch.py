#!/usr/bin/env python3
"""Permanent Pinnacle archive — the one tool that reads and writes it (founder brief 2026-10-14, item 1).

Tables (supabase/migrations/20261014120000_pinnacle_archive.sql): oddspapi_archive_raw, pinnacle_archive_close,
pinnacle_archive_count. Rules: .claude/rules/pinnacle-archive.md.

This file only ever ADDS rows: every write is a PostgREST INSERT with `resolution=ignore-duplicates` (ON CONFLICT DO
NOTHING). There is no update, delete, upsert or truncate path, and tools/test-pinnacle-archive-guard.mjs fails the gate if
one appears anywhere in the repo. A correction is a new row whose `supersedes` names the row it corrects.

Commands
  counts                     row counts, the guard state, and one pinnacle_archive_count row (--record JOB)
  import-captured FILE       captured-closes-pinnacle.json -> pinnacle_archive_close (label 'captured')
  import-bucket              every object in the oddspapi-raw bucket -> oddspapi_archive_raw, byte for byte
  backup                     today's dated copy into the private ops repo (never replaces an earlier day)
  restore DIR                rebuild every row from a checkout of the backups: verify each file's sha256, then write
                             restore SQL (--sql-out) and, with --apply, run it through the Management API
Env: SUPABASE_URL, SUPABASE_SECRET_KEY (service_role: SELECT + INSERT only); backup: WORKFLOW_PAT; restore --apply:
SUPABASE_ACCESS_TOKEN."""
import base64, datetime as dt, glob, gzip, hashlib, json, os, re, subprocess, sys, tempfile, time, urllib.error, urllib.parse, urllib.request

RAW, CLOSE, COUNT = 'oddspapi_archive_raw', 'pinnacle_archive_close', 'pinnacle_archive_count'
TABLES = (RAW, CLOSE, COUNT)
BUCKET = 'oddspapi-raw'
OPS_REPO = 'Michaeldk1996/stennisfy-ops'
BACKUP_DIR = 'pinnacle-archive'
CHUNK_BYTES = 15 * 1024 * 1024          # one backup file stays far below GitHub's 100 MB file limit
CAPTURED_SOURCE = 'captured-closes-pinnacle.json'
PLAIN_PINNACLE_UNTIL = '2026-09-02'     # the file's own source note: oddsMovement.books.Pinnacle (Oddspapi pinnacle) to 2 Sep


def die(msg):
    print(f'::error::{msg}', file=sys.stderr)
    sys.exit(1)


def env(name):
    v = os.environ.get(name) or ''
    if not v:
        die(f'{name} is not set')
    return v


# ── PostgREST ────────────────────────────────────────────────────────────────────────────────────────────────────────
def rest(method, path, body=None, headers=None, timeout=180, raw=False):
    url, key = env('SUPABASE_URL').rstrip('/'), env('SUPABASE_SECRET_KEY')
    h = {'apikey': key, 'Authorization': f'Bearer {key}', 'User-Agent': 'stennisfy-pinarch'}
    h.update(headers or {})
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        h['Content-Type'] = 'application/json'
    req = urllib.request.Request(url + path, data=data, headers=h, method=method)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                b = r.read()
                return r.status, (b if raw else (json.loads(b) if b else None)), dict(r.headers)
        except urllib.error.HTTPError as e:
            msg = e.read()[:500].decode('utf-8', 'replace')
            if e.code >= 500 and attempt < 3:
                time.sleep(2 ** attempt * 3); continue
            raise RuntimeError(f'{method} {path.split("?")[0]} -> HTTP {e.code}: {msg}')
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < 3:
                time.sleep(2 ** attempt * 3); continue
            raise RuntimeError(f'{method} {path.split("?")[0]} -> {e}')


def count(table):
    _, _, h = rest('GET', f'/rest/v1/{table}?select=id&limit=1', headers={'Prefer': 'count=exact'})
    m = re.search(r'/(\d+)$', h.get('Content-Range') or h.get('content-range') or '')
    if not m:
        raise RuntimeError(f'no exact count for {table}')
    return int(m.group(1))


def insert(table, rows, conflict):
    """INSERT … ON CONFLICT DO NOTHING. Returns the ids actually added (duplicates add nothing, change nothing)."""
    if not rows:
        return []
    q = urllib.parse.urlencode({'on_conflict': conflict, 'select': 'id'})
    _, out, _ = rest('POST', f'/rest/v1/{table}?{q}', body=rows,
                     headers={'Prefer': 'resolution=ignore-duplicates,return=representation'})
    return [r['id'] for r in (out or [])]


def select_pages(table, select, filt='', page=1000, after=0):
    """Rows in id order, one page at a time (a generator: the raw table never sits in memory whole)."""
    last = after
    while True:
        q = f'/rest/v1/{table}?select={select}&id=gt.{last}&order=id.asc&limit={page}' + (f'&{filt}' if filt else '')
        _, rows, _ = rest('GET', q)
        if rows:
            yield rows
        if not rows or len(rows) < page:
            return
        last = rows[-1]['id']


def select_all(table, select, filt='', page=1000):
    out, last = [], 0
    while True:
        q = f'/rest/v1/{table}?select={select}&id=gt.{last}&order=id.asc&limit={page}' + (f'&{filt}' if filt else '')
        _, rows, _ = rest('GET', q)
        out.extend(rows or [])
        if not rows or len(rows) < page:
            return out
        last = rows[-1]['id']


def guard_state():
    _, g, _ = rest('POST', '/rest/v1/rpc/pinnacle_archive_guard', body={})
    return g


def record_count(job, detail):
    c = {t: count(t) for t in (RAW, CLOSE)}
    insert(COUNT, [{'job': job, 'raw_rows': c[RAW], 'close_rows': c[CLOSE], 'detail': detail}], 'id')
    return c


# ── shared helpers ───────────────────────────────────────────────────────────────────────────────────────────────────
def iso_ms(s):
    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00')) if s else None


def hexbytes(b):
    return '\\x' + b.hex()


def unhex(s):
    return bytes.fromhex(s[2:]) if isinstance(s, str) and s.startswith('\\x') else bytes(s or b'')


def payload_parts(blob):
    """(payload_gz, body, sha256-of-body). A gzip blob is kept exactly as stored; a plain body is gzipped once."""
    if blob[:2] == b'\x1f\x8b':
        body = gzip.decompress(blob)
        return blob, body, hashlib.sha256(body).hexdigest()
    return gzip.compress(blob, 6), blob, hashlib.sha256(blob).hexdigest()


def books_of(body):
    try:
        return sorted(((json.loads(body) or {}).get('bookmakers') or {}).keys())
    except ValueError:
        return []


# ── import: captured-closes-pinnacle.json ────────────────────────────────────────────────────────────────────────────
def captured_close_rows(rows, commit=None):
    """Each captured row -> one close row, verbatim in `detail`. Book: the row's own `book`, else the file's source note
    (rows to 2 Sep are Oddspapi plain `pinnacle`). Start: the row's `trueStart`; its source when the row names one."""
    out = []
    for r in rows:
        if r.get('p1') is None or r.get('p2') is None or r.get('eventKey') is None:
            continue
        book = r.get('book') or ('Pinnacle' if str(r.get('date')) <= PLAIN_PINNACLE_UNTIL else None)
        if not book:
            raise ValueError(f'captured row {r.get("eventKey")} has no book and is dated after {PLAIN_PINNACLE_UNTIL}')
        at, start = iso_ms(r.get('at')), iso_ms(r.get('trueStart'))
        gap = round((start - at).total_seconds(), 3) if (at and start) else None
        out.append({
            'dedupe_key': '|'.join(str(x) for x in (CAPTURED_SOURCE, 'captured', r['eventKey'], '', r.get('at'), r['p1'], r['p2'])),
            'event_key': int(r['eventKey']), 'fixture_id': None, 'match_date': r.get('date'),
            'p1_key': r.get('p1Key'), 'p2_key': r.get('p2Key'), 'p1_name': r.get('p1Name'), 'p2_name': r.get('p2Name'),
            'p1': r['p1'], 'p2': r['p2'], 'book': book, 'label': 'captured', 'source': CAPTURED_SOURCE,
            'close_ts': r.get('at'), 'start_ts': r.get('trueStart'), 'start_source': r.get('startSource'),
            'gap_to_start_s': gap, 'detail': {'row': r, 'fileCommit': commit}})
    return out


def plan_captured(rows, existing):
    """Rows to add. `existing` = the archive's captured rows. A changed row for an event already held is a correction:
    it is added with `supersedes` = the latest held row for that event; the held row stays."""
    held = {e['dedupe_key'] for e in existing}
    latest = {}
    for e in sorted(existing, key=lambda e: e['id']):
        latest[e['event_key']] = e['id']
    add = []
    for r in rows:
        if r['dedupe_key'] in held:
            continue
        if r['event_key'] in latest:
            r = dict(r, supersedes=latest[r['event_key']])
        add.append(r)
    return add


def cmd_import_captured(path):
    d = json.load(open(path))
    commit = os.environ.get('CAPTURED_COMMIT') or None
    rows = captured_close_rows(d.get('rows') or [], commit)
    existing = select_all(CLOSE, 'id,event_key,dedupe_key', f'source=eq.{urllib.parse.quote(CAPTURED_SOURCE)}')
    before = count(CLOSE)
    add = plan_captured(rows, existing)
    ids = []
    for i in range(0, len(add), 200):
        ids += insert(CLOSE, add[i:i + 200], 'dedupe_key')
    after = count(CLOSE)
    rep = {'fileRows': len(d.get('rows') or []), 'closeRows': len(rows), 'alreadyHeld': len(rows) - len(add),
           'added': len(ids), 'corrections': sum(1 for r in add if r.get('supersedes')), 'tableBefore': before, 'tableAfter': after}
    print('### import-captured', json.dumps(rep))
    if after < before:
        die('close table shrank during an append-only import')
    return rep


# ── import: the oddspapi-raw bucket ──────────────────────────────────────────────────────────────────────────────────
def bucket_list(prefix):
    out, offset = [], 0
    while True:
        _, page, _ = rest('POST', f'/storage/v1/object/list/{BUCKET}',
                          body={'prefix': prefix, 'limit': 1000, 'offset': offset, 'sortBy': {'column': 'name', 'order': 'asc'}})
        out.extend(page or [])
        if not page or len(page) < 1000:
            return out
        offset += 1000


def bucket_get(path):
    _, b, h = rest('GET', f'/storage/v1/object/{BUCKET}/{path}', raw=True, timeout=300)
    return b


def cmd_import_bucket(limit=None):
    folders = [m['name'] for m in bucket_list('') if m.get('name') and not m['name'].startswith('_')]
    objects = []
    for f in folders:
        for o in bucket_list(f + '/'):
            n = o.get('name') or ''
            if n.endswith('.json.gz') and o.get('id'):
                objects.append((f, n, o))
    held = {}
    for r in select_all(RAW, 'id,fixture_id,object_path,payload_sha256,meta', 'object_path=not.is.null'):
        held.setdefault(r['object_path'], []).append(r)
    before = count(RAW)
    todo = []
    for f, n, o in objects:
        path = f'{f}/{n}'
        rows = held.get(path) or []
        upd = o.get('updated_at')
        if any((r.get('meta') or {}).get('objectUpdatedAt') == upd for r in rows):
            continue
        todo.append((f, n, o, path, rows))
    print(f'### bucket: {len(objects)} objects in {len(folders)} folders; {len(objects) - len(todo)} already archived; {len(todo)} to copy', flush=True)
    added = same = 0
    batch = []
    def flush():
        nonlocal added
        if batch:
            added += len(insert(RAW, list(batch), 'fixture_id,payload_sha256')); batch.clear()
    for i, (f, n, o, path, rows) in enumerate(todo[:limit] if limit else todo):
        blob = bucket_get(path)
        gz, body, sha = payload_parts(blob)
        if any(r['payload_sha256'] == sha for r in rows):
            same += 1; continue
        meta = {'month': f, 'objectId': o.get('id'), 'objectCreatedAt': o.get('created_at'), 'objectUpdatedAt': o.get('updated_at'),
                'objectSize': (o.get('metadata') or {}).get('size'), 'storedGzip': blob[:2] == b'\x1f\x8b'}
        row = {'fixture_id': n[:-len('.json.gz')], 'source': 'oddspapi-raw bucket', 'object_path': path,
               'pulled_at': o.get('created_at'), 'books': books_of(body), 'payload_gz': hexbytes(gz),
               'payload_sha256': sha, 'body_bytes': len(body), 'meta': meta}
        if rows:
            row['supersedes'] = max(r['id'] for r in rows)      # the object changed since it was archived: a new row
        batch.append(row)
        if len(batch) >= 8:
            flush()
        if (i + 1) % 250 == 0:
            print(f'  {i + 1} of {len(todo)} read, {added} added', flush=True)
    flush()
    after = count(RAW)
    rep = {'bucketObjects': len(objects), 'alreadyArchived': len(objects) - len(todo), 'copied': added, 'unchanged': same,
           'tableBefore': before, 'tableAfter': after}
    print('### import-bucket', json.dumps(rep))
    if after < before:
        die('raw table shrank during an append-only import')
    return rep


# ── backup ───────────────────────────────────────────────────────────────────────────────────────────────────────────
def serialize_rows(rows):
    """One JSON line per row, every column as PostgREST returns it (bytea as '\\x…' hex)."""
    return b''.join(json.dumps(r, sort_keys=True, separators=(',', ':')).encode() + b'\n' for r in rows)


def write_backup_day(outdir, day, raw_pages, close_rows, count_rows, prev_manifest):
    """Write one dated copy. Raw = the rows added since the previous copy (ids above its toId), streamed page by page
    into files of about CHUNK_BYTES; close and count = full snapshots. Refuses to touch an existing day."""
    d = os.path.join(outdir, BACKUP_DIR, day)
    if os.path.exists(d):
        raise FileExistsError(f'{d} already exists: a dated copy is never replaced')
    os.makedirs(d)
    files = []
    def put(name, data):
        blob = gzip.compress(data, 6)
        with open(os.path.join(d, name), 'wb') as fh:
            fh.write(blob)
        files.append({'name': name, 'sha256': hashlib.sha256(blob).hexdigest(), 'bytes': len(blob)})
    chunk, size, part, n, first, last = [], 0, 0, 0, None, None
    for page in raw_pages:
        for r in page:
            if last is not None and r['id'] <= last:
                raise ValueError('raw rows out of id order')
            line = serialize_rows([r])
            if chunk and size + len(line) > CHUNK_BYTES * 3:      # ~3x: the hex payload gzips back down to its gzip size
                part += 1; put(f'raw-{part:04d}.jsonl.gz', b''.join(chunk)); chunk, size = [], 0
            chunk.append(line); size += len(line); n += 1
            first = r['id'] if first is None else first; last = r['id']
    if chunk:
        part += 1; put(f'raw-{part:04d}.jsonl.gz', b''.join(chunk))
    put('close-full.jsonl.gz', serialize_rows(sorted(close_rows, key=lambda r: r['id'])))
    put('count-full.jsonl.gz', serialize_rows(sorted(count_rows, key=lambda r: r['id'])))
    prev_raw = (prev_manifest or {}).get('raw') or {}
    man = {'day': day, 'writtenAt': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
           'previous': prev_manifest.get('day') if prev_manifest else None,
           'raw': {'fromId': first, 'toId': last if last is not None else prev_raw.get('toId'), 'rows': n,
                   'cumulativeRows': (prev_raw.get('cumulativeRows') or 0) + n},
           'close': {'rows': len(close_rows), 'maxId': max([r['id'] for r in close_rows], default=None)},
           'count': {'rows': len(count_rows)}, 'files': files,
           'restore': 'python3 tools/pinarch.py restore <checkout of this repo> --sql-out restore.sql  (see .claude/rules/pinnacle-archive.md)'}
    with open(os.path.join(d, 'manifest.json'), 'w') as fh:
        json.dump(man, fh, indent=1)
    return man


def git(*args, cwd=None, check=True):
    p = subprocess.run(['git', *args], cwd=cwd, capture_output=True, text=True)
    if check and p.returncode:
        raise RuntimeError(f'git {" ".join(args[:2])} failed: {p.stderr[-400:]}')
    return p.stdout


def cmd_backup():
    pat = env('WORKFLOW_PAT')
    day = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d')
    work = tempfile.mkdtemp(prefix='pinarch-backup-')
    remote = f'https://x-access-token:{pat}@github.com/{OPS_REPO}.git'
    git('clone', '--quiet', '--filter=blob:none', '--no-checkout', remote, work)
    has_main = bool(git('ls-remote', '--heads', 'origin', 'main', cwd=work).strip())
    if has_main:
        git('checkout', '--quiet', 'main', cwd=work)        # blobs fetched lazily: only what checkout needs
    else:
        git('checkout', '--quiet', '-b', 'main', cwd=work)
    days = sorted(p.name for p in os.scandir(os.path.join(work, BACKUP_DIR)) if p.is_dir()) if os.path.isdir(os.path.join(work, BACKUP_DIR)) else []
    if day in days:
        print(f'### backup {day}: already written today — nothing replaced'); return {'day': day, 'skipped': True}
    prev = json.load(open(os.path.join(work, BACKUP_DIR, days[-1], 'manifest.json'))) if days else None
    since = ((prev or {}).get('raw') or {}).get('toId') or 0
    close_rows, count_rows = select_all(CLOSE, '*'), select_all(COUNT, '*')
    man = write_backup_day(work, day, select_pages(RAW, '*', page=50, after=since), close_rows, count_rows, prev)
    git('-c', 'user.name=stennisfy-archive-bot', '-c', 'user.email=archive-bot@users.noreply.github.com',
        'add', os.path.join(BACKUP_DIR, day), cwd=work)
    git('-c', 'user.name=stennisfy-archive-bot', '-c', 'user.email=archive-bot@users.noreply.github.com',
        'commit', '--quiet', '-m', f'pinnacle archive backup {day}: +{man["raw"]["rows"]} raw rows, {man["close"]["rows"]} closes', cwd=work)
    git('push', '--quiet', 'origin', 'main', cwd=work)        # a plain push: never --force, so history is never rewritten
    print('### backup', json.dumps({k: man[k] for k in ('day', 'previous', 'raw', 'close', 'count')}), f'{len(man["files"])} files',
          f'{sum(f["bytes"] for f in man["files"]) / 1e6:.1f} MB')
    return man


# ── restore ──────────────────────────────────────────────────────────────────────────────────────────────────────────
COLS = {
    RAW: ['id', 'fixture_id', 'source', 'object_path', 'pulled_at', 'books', 'payload_gz', 'payload_sha256', 'body_bytes', 'meta', 'supersedes', 'inserted_at'],
    CLOSE: ['id', 'dedupe_key', 'event_key', 'fixture_id', 'match_date', 'p1_key', 'p2_key', 'p1_name', 'p2_name', 'p1', 'p2', 'book', 'label', 'source',
            'close_ts', 'start_ts', 'start_source', 'gap_to_start_s', 'raw_id', 'supersedes', 'detail', 'inserted_at'],
    COUNT: ['id', 'at', 'job', 'raw_rows', 'close_rows', 'detail'],
}


def sql_lit(v, col):
    if v is None:
        return 'NULL'
    if col in ('meta', 'detail'):
        return "'" + json.dumps(v, sort_keys=True).replace("'", "''") + "'::jsonb"
    if col == 'books':
        return "ARRAY[" + ','.join("'" + str(x).replace("'", "''") + "'" for x in v) + "]::text[]"
    if col == 'payload_gz':
        return "'" + str(v) + "'::bytea"
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def read_backups(root):
    """Every row in every dated copy, verified: each file's sha256 must equal its manifest's. Raw rows accumulate across
    days; close / count rows come from the newest full snapshot (a row in an older snapshot is kept too, by id)."""
    base = os.path.join(root, BACKUP_DIR)
    days = sorted(p.name for p in os.scandir(base) if p.is_dir())
    rows = {RAW: {}, CLOSE: {}, COUNT: {}}
    for day in days:
        man = json.load(open(os.path.join(base, day, 'manifest.json')))
        for f in man['files']:
            blob = open(os.path.join(base, day, f['name']), 'rb').read()
            if hashlib.sha256(blob).hexdigest() != f['sha256']:
                raise ValueError(f'{day}/{f["name"]}: sha256 does not match its manifest — refusing to restore from it')
            t = RAW if f['name'].startswith('raw-') else CLOSE if f['name'].startswith('close-') else COUNT
            for line in gzip.decompress(blob).splitlines():
                r = json.loads(line)
                rows[t][r['id']] = r
    return days, rows


def restore_sql(rows):
    """INSERT … OVERRIDING SYSTEM VALUE … ON CONFLICT DO NOTHING, ids kept (so every `supersedes` still points at its row),
    then each identity moved past the highest id. Raw first (closes reference it)."""
    out = ['begin;']
    for t in (RAW, CLOSE, COUNT):
        cols = COLS[t]
        for _, r in sorted(rows[t].items()):
            out.append(f'insert into public.{t} ({",".join(cols)}) overriding system value values ('
                       + ','.join(sql_lit(r.get(c), c) for c in cols) + ') on conflict do nothing;')
        out.append(f"select setval(pg_get_serial_sequence('public.{t}','id'), greatest((select coalesce(max(id),0) from public.{t}), 1));")
    out.append('commit;')
    return '\n'.join(out) + '\n'


def cmd_restore(root, sql_out, apply=False, compare=False):
    days, rows = read_backups(root)
    sql = restore_sql(rows)
    with open(sql_out, 'w') as fh:
        fh.write(sql)
    print('### restore', json.dumps({'days': len(days), 'from': days[:1], 'to': days[-1:], 'raw': len(rows[RAW]), 'close': len(rows[CLOSE]),
                                     'count': len(rows[COUNT]), 'sql': sql_out, 'applied': apply}))
    if compare:
        # every live row up to the newest backed-up id must be in the backups, and nothing in the backups is missing live
        for t in (RAW, CLOSE):
            top = max(rows[t], default=0)
            live = {r['id'] for page in select_pages(t, 'id', page=1000) for r in page if r['id'] <= top}
            missing, extra = live - set(rows[t]), set(rows[t]) - live
            print(f'### restore-check {t}: backups {len(rows[t])} rows (ids to {top}), live {len(live)} rows to that id; '
                  f'{len(missing)} live rows not in the backups, {len(extra)} backup rows not live')
            if missing or extra:
                die(f'restore-check {t}: the backups and the live table disagree')
    if apply:
        tok, ref = env('SUPABASE_ACCESS_TOKEN'), re.match(r'https://([a-z0-9]+)\.supabase\.co', env('SUPABASE_URL')).group(1)
        stmts = sql.splitlines()[1:-2]
        for i in range(0, len(stmts), 200):
            body = json.dumps({'query': '\n'.join(stmts[i:i + 200])}).encode()
            req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{ref}/database/query', data=body, method='POST',
                                         headers={'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=300) as r:
                if r.status not in (200, 201):
                    die(f'restore chunk {i}: HTTP {r.status}')
    return rows


def cmd_counts(record=None):
    g = guard_state()
    print('### guard', json.dumps(g))
    if record:
        c = record_count(record, {'guardOk': g.get('ok')})
        print('### recorded', json.dumps(c))
    if not g.get('ok'):
        die('archive guard NOT ok: ' + json.dumps(g))
    return g


if __name__ == '__main__':
    a = sys.argv[1:]
    if not a:
        print(__doc__); sys.exit(2)
    if a[0] == 'counts':
        cmd_counts(a[a.index('--record') + 1] if '--record' in a else None)
    elif a[0] == 'import-captured':
        cmd_import_captured(a[1])
    elif a[0] == 'import-bucket':
        cmd_import_bucket(int(a[a.index('--limit') + 1]) if '--limit' in a else None)
    elif a[0] == 'backup':
        cmd_backup()
    elif a[0] == 'restore':
        cmd_restore(a[1], a[a.index('--sql-out') + 1] if '--sql-out' in a else 'restore.sql', '--apply' in a, '--compare' in a)
    else:
        print(__doc__); sys.exit(2)
