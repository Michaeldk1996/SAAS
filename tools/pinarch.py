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
  derive-held                closes for held Pinnacle +30 payloads with NO live-flip row, cut at Oddspapi's trueStart
                             (founder 2026-10-16; default window 13-30 Apr: --from / --to YYYY-MM-DD, --dry-run)
  restore DIR                rebuild every row from a checkout of the backups: verify each file's sha256, then write
                             restore SQL (--sql-out) and, with --apply, run it through the Management API
Env: SUPABASE_URL, SUPABASE_SECRET_KEY (service_role: SELECT + INSERT only); backup: WORKFLOW_PAT; restore --apply:
SUPABASE_ACCESS_TOKEN."""
import base64, collections, datetime as dt, glob, gzip, hashlib, json, os, re, subprocess, sys, tempfile, time, urllib.error, urllib.parse, urllib.request

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
    # PostgREST takes one key set per request ("All object keys must match", PGRST102): rows are sent grouped by
    # their keys, never padded (a padded null would override a column default)
    groups = {}
    for r in rows:
        groups.setdefault(tuple(sorted(r)), []).append(r)
    ids = []
    for g in groups.values():
        _, out, _ = rest('POST', f'/rest/v1/{table}?{q}', body=g,
                         headers={'Prefer': 'resolution=ignore-duplicates,return=representation'})
        ids += [r['id'] for r in (out or [])]
    return ids


def _with_id(select):
    """Paging is by id: a select that names no id gets it added, so a table past one page never fails on rows[-1]['id']
    (te-import's closes read named only event_key and stopped on the 1,001st row — 2026-10-20)."""
    return select if select == '*' or 'id' in [c.strip() for c in select.split(',')] else 'id,' + select


def select_pages(table, select, filt='', page=1000, after=0):
    """Rows in id order, one page at a time (a generator: the raw table never sits in memory whole)."""
    select = _with_id(select)
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
    select = _with_id(select)
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


def day_written(d):
    """Founder ruling 2026-10-16 (round 3, item 5): a same-day re-run skips a day folder that is ALREADY COMPLETE — its
    manifest.json reads and every file it lists is present with its sha256. True = complete (skip, with the log line
    "day already written, skipped"); False = no such folder (write it). A folder that exists but is NOT complete (no or
    unreadable manifest, a file missing or a sha256 that differs) raises: a real failure is never hidden as a skip."""
    if not os.path.exists(d):
        return False
    try:
        man = json.load(open(os.path.join(d, 'manifest.json')))
        files = man['files']
    except Exception as e:                                     # noqa: BLE001 — named in the error, never swallowed
        raise RuntimeError(f'{d} exists but its manifest is missing or unreadable ({e}): not a complete day — refusing to skip or replace it')
    for f in files:
        fp = os.path.join(d, f['name'])
        if not os.path.exists(fp) or hashlib.sha256(open(fp, 'rb').read()).hexdigest() != f['sha256']:
            raise RuntimeError(f'{d}/{f["name"]} is missing or does not match its manifest sha256: not a complete day — refusing to skip or replace it')
    return True


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
    if day in days and day_written(os.path.join(work, BACKUP_DIR, day)):
        print(f'### backup {day}: day already written, skipped'); return {'day': day, 'skipped': True}
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


# ── closes from the raw history (item 2) ────────────────────────────────────────────────────────────────────────────
ARCHIVE_LABEL = 'from Pinnacle history'
ARCHIVE_SOURCE = 'oddspapi /v4/historical-odds pinnacle+30'
CUT_SOURCE = 'live-flip (last poll not live)'
PULL_TRIES, PULL_GAP_MIN = 4, 30


def mw_series(body):
    """The Pinnacle +30 match-winner entries per outcome (121 = participant 1, 122 = participant 2), oldest first,
    exactly as Oddspapi returns them (price, active, createdAt …)."""
    if isinstance(body, (bytes, bytearray)):
        body = json.loads(body)
    mk = ((((body or {}).get('bookmakers') or {}).get('pinnacle+30') or {}).get('markets') or {}).get('121') or {}
    out = {}
    for oc in ('121', '122'):
        pts = (((mk.get('outcomes') or {}).get(oc) or {}).get('players') or {}).get('0') or []
        out[oc] = sorted([p for p in pts if p.get('createdAt')], key=lambda p: p['createdAt'])
    return out


def close_at(series, cut):
    """Per side, the last ACTIVE entry with a real price (>= 1.01) at or before `cut`; both sides required, else
    (None, reason). Returns ({'121': (price, ts), '122': (price, ts)}, None)."""
    if cut is None:
        return None, 'no start'
    out = {}
    for oc in ('121', '122'):
        pre = [p for p in series.get(oc) or [] if iso_ms(p['createdAt']) <= cut and p.get('active') and _price(p) is not None]
        if not pre:
            return None, f'no active entry before the start on outcome {oc}'
        out[oc] = (_price(pre[-1]), pre[-1]['createdAt'])
    return out, None


def _price(p):
    try:
        v = float(p.get('price'))
    except (TypeError, ValueError):
        return None
    return v if v >= 1.01 else None


def archive_close_row(ev, raw_id, fixture_id, series):
    """The close row for one event from one raw payload. `ev`: event_key, date, p1Key/p2Key/p1Name/p2Name (the
    api-tennis first / second player), p1IsParticipant1, cut (our live-flip start), plus the start-check fields."""
    c, why = close_at(series, ev['cut'])
    if c is None:
        return None, why
    a, b = (c['121'], c['122']) if ev['p1IsParticipant1'] else (c['122'], c['121'])
    close_ts = max(iso_ms(a[1]), iso_ms(b[1]))
    ts = ev.get('trueStart')
    no_flip = ev.get('cutSource') == NO_FLIP_SOURCE
    flip = None if no_flip else (ev.get('liveFlipCut') or ev['cut'])
    check = {'firstLive': ev.get('firstLive'), 'lastNotLive': ev.get('lastNotLive'), 'oddspapiTrueStart': ts.isoformat() if ts else None,
             'trueStartReject': ev.get('trueStartReject')}
    if no_flip:
        check['liveFlip'] = None                                # no live_flip_log row: the trueStart alone is the cut
        check['oddspapiTrueEnd'] = ev['trueEnd'].isoformat() if ev.get('trueEnd') else None
        check['oddspapiScheduled'] = ev['scheduled'].isoformat() if ev.get('scheduled') else None
    if ts:
        c2, _ = close_at(series, ts)
        if c2:
            x, y = (c2['121'], c2['122']) if ev['p1IsParticipant1'] else (c2['122'], c2['121'])
            check['closeAtTrueStart'] = [x[0], y[0], max(x[1], y[1])]
    if ts and flip:
        lo, hi = sorted((ts, flip))
        check['entriesBetweenTrueStartAndCut'] = sum(1 for oc in ('121', '122') for p in series.get(oc) or [] if lo < iso_ms(p['createdAt']) <= hi)
        check['trueStartMinusCutS'] = round((ts - flip).total_seconds())
    row = {'event_key': int(ev['event_key']), 'fixture_id': fixture_id, 'match_date': ev.get('date'),
           'p1_key': ev.get('p1Key'), 'p2_key': ev.get('p2Key'), 'p1_name': ev.get('p1Name'), 'p2_name': ev.get('p2Name'),
           'p1': a[0], 'p2': b[0], 'book': 'Pinnacle +30s', 'label': ARCHIVE_LABEL, 'source': ARCHIVE_SOURCE,
           'close_ts': close_ts.isoformat(), 'start_ts': ev['cut'].isoformat(), 'start_source': ev.get('cutSource') or CUT_SOURCE,
           'gap_to_start_s': round((ev['cut'] - close_ts).total_seconds(), 3), 'raw_id': raw_id,
           'detail': {'p1Ts': a[1], 'p2Ts': b[1], 'startCheck': check, 'apiTennis': ev.get('api') or {}}}
    row['dedupe_key'] = '|'.join(str(x) for x in (ARCHIVE_SOURCE, ARCHIVE_LABEL, row['event_key'], fixture_id, row['close_ts'], row['p1'], row['p2']))
    return row, None


def _close_rank(r):
    """Which close an event shows: an archive close at a true start (2) > a captured close (1) > a fill-rule row (0,
    founder ruling 2026-10-25: a fill row is re-cuttable — any true close for the event, from any later source, wins)."""
    if fill_cut(r):
        return 0
    return 2 if r.get('label') == ARCHIVE_LABEL else 1


def current_closes(rows):
    """One close per event: the newest archive row ('from Pinnacle history') that no later row supersedes; else the
    newest such captured row; a fill-rule row (fill_cut) only when the event has no other close. Every other row stays in
    the archive (the log of what was replaced)."""
    superseded = {r['supersedes'] for r in rows if r.get('supersedes')}
    best = {}
    for r in sorted(rows, key=lambda r: r['id']):
        if r['id'] in superseded:
            continue
        k = r['event_key']
        cur = best.get(k)
        if cur is None or _close_rank(r) >= _close_rank(cur):
            best[k] = r
    return best


def plan_archive_closes(new_rows, held):
    """New archive closes to add: a row already held (dedupe_key) adds nothing; any other row supersedes the event's
    current close (captured or an earlier archive close), which stays."""
    keys = {h['dedupe_key'] for h in held}
    cur = current_closes(held)
    add, seen = [], set()
    for r in reversed(new_rows):                               # one new row per event per batch: the last one given
        if r['event_key'] in seen:
            continue
        seen.add(r['event_key'])
        if r['dedupe_key'] in keys:
            continue
        c = cur.get(r['event_key'])
        if c is not None:
            if c['label'] == ARCHIVE_LABEL and (float(c['p1']), float(c['p2']), iso_ms(c['close_ts'])) == (float(r['p1']), float(r['p2']), iso_ms(r['close_ts'])):
                continue                                        # the same close from another pull: nothing to correct
            r = dict(r, supersedes=c['id'])
        add.append(r)
    return list(reversed(add))


# Founder ruling 2026-10-17 (item 1): the captured closes before our live-flip log (12 Jul - 16 Sep) were read from
# Oddspapi's history after the fact and cut at Oddspapi's start alone — the method held back for April. None is a close.
CAPTURED_HELD_TO = '2026-09-16'
VERIFIED_START_FROM = '2026-09-17'      # our live-flip log (live_flip_log) begins 17 Sep: no verified start exists before it
HELD_BACK_RULES = {
    'start-alone': 'cut at Oddspapi trueStart alone, no live-flip held (the TEN-437 derive-held rows of 13-30 Apr; founder '
                   'ruling 2026-10-16, round 3 item 2: the start-alone cut was rejected on 1,211 matches, 48% exact)',
    'captured-before-live-flip': 'a captured close dated on or before 16 Sep 2026: the plain-Pinnacle series (12 Jul - 2 Sep) '
                   'was read from Oddspapi /v4/historical-odds every 3 h (298 of 408 closing prices first appeared after the '
                   'start) and the 7-13 Sep back-fill was pulled on 28 Sep; both cut at Oddspapi trueStart alone, no verified '
                   'start (founder ruling 2026-10-17, item 1)',
    'unverified-start': 'a close whose start is not a verified one: neither our live-flip nor the earlier-of rule from 17 Sep '
                   '(a captured close cut at Oddspapi trueStart with no live-flip proof, or no start source on record); "close" '
                   'is reserved for a verified start (founder ruling 2026-10-17, item 3)',
}
CAPTURED_VERIFIED_SOURCES = ('api-tennis-live',)   # build-captured-pinnacle.js startSource = our live-flip (the card state's)


# Founder ruling 2026-10-25 (round 2 item 1.4): the 13 Apr - 16 Sep ATP main-draw fill. Measured against our live-flip,
# Oddspapi's gated trueStart becomes a close cut for the rows that fill writes — at trueStart itself ('trueStart') or at
# trueStart - X min ('trueStart-buffer', X = ceil(p98 lateness)). Those rows, and ONLY those (their own start_source AND a
# valid closeCut in detail), export as closes: this supersedes the start-alone hold-back for them alone. Every other
# start-alone row (derive-held, NO_FLIP_SOURCE) stays held back exactly as before. Writer: tools/archive-fill-probe.py.
FILL_START_SOURCE = 'oddspapi trueStart (fill rule 2026-10-25)'
FILL_CUTS = ('trueStart', 'trueStart-buffer')


def fill_cut(r):
    """The row's closeCut when it is a fill-rule close (label, start_source and detail.closeCut all agree; a buffered cut
    must name a whole-minute buffer > 0), else None."""
    if r.get('label') != ARCHIVE_LABEL or r.get('start_source') != FILL_START_SOURCE:
        return None
    d = r.get('detail') or {}
    if isinstance(d, str):
        try:
            d = json.loads(d)
        except ValueError:
            return None
    c = d.get('closeCut')
    if c == 'trueStart':
        return c
    if c == 'trueStart-buffer' and isinstance(d.get('bufferMin'), int) and not isinstance(d.get('bufferMin'), bool) and d['bufferMin'] > 0:
        return c
    return None


def verified_start(r):
    """Founder ruling 2026-10-17 item 3: a price may be labelled a close only when cut at a VERIFIED start — our live-flip,
    or the earlier-of rule (live-flip vs the gated trueStart) from 17 Sep. Archive closes name it in start_source; a
    captured close is verified only from 17 Sep and only when its start is the live-flip. Founder ruling 2026-10-25: a
    fill-rule close (fill_cut) counts as verified — the trueStart was measured against our live-flip."""
    if fill_cut(r):
        return True
    if r.get('label') == ARCHIVE_LABEL:
        return r.get('start_source') in (CUT_SOURCE, TRUE_START_SOURCE, FALSE_START_SOURCE)
    if r.get('label') == 'captured':
        return str(r.get('match_date') or '') >= VERIFIED_START_FROM and r.get('start_source') in CAPTURED_VERIFIED_SOURCES
    return False


def held_back_reason(r):
    """Why a close is held back (in the archive, never exported or shown as a close), or None. Rules: HELD_BACK_RULES."""
    if r.get('start_source') == NO_FLIP_SOURCE:
        return 'start-alone'
    if r.get('label') == 'captured' and str(r.get('match_date') or '') <= CAPTURED_HELD_TO:
        return 'captured-before-live-flip'
    if not verified_start(r):
        return 'unverified-start'
    return None


def held_back(r):
    """A held-back close stays in the archive (append-only, its own source / start_source) and is never exported: no
    reader sees it. The event's current close is chosen among its other rows, else it has none (odds.md "held back")."""
    return held_back_reason(r) is not None


def export_rows(rows):
    """The current close per event in captured-closes-pinnacle.json's row shape (build-match-closes reads it), plus its
    label, source, times and gap. Rows without both player keys stay in the archive but cannot be keyed here. A held-back
    close (held_back) is not a close: the event's current close is chosen among the other rows, else it has none."""
    out = []
    for k, r in sorted(current_closes([x for x in rows if not held_back(x)]).items()):
        if not (r.get('p1_key') and r.get('p2_key') and r.get('match_date')):
            continue
        out.append({'eventKey': k, 'date': str(r['match_date']), 'p1Key': r['p1_key'], 'p2Key': r['p2_key'],
                    'p1Name': r.get('p1_name'), 'p2Name': r.get('p2_name'), 'p1': float(r['p1']), 'p2': float(r['p2']),
                    'label': r['label'], 'source': r['source'], 'book': r['book'], 'closeTs': r.get('close_ts'),
                    'startTs': r.get('start_ts'), 'startSource': r.get('start_source'), 'gapToStartS': r.get('gap_to_start_s'), 'archiveId': r['id'],
                    'apiTennis': ((r.get('detail') or {}).get('apiTennis')) or None})
        fc = fill_cut(r)
        if fc:                                                  # founder ruling 2026-10-25: the cut travels with the row
            out[-1]['closeCut'] = fc
            if fc == 'trueStart-buffer':
                out[-1]['bufferMin'] = (r.get('detail') or {})['bufferMin']
    return out


# founder ruling 2026-10-18 (phase 2): event_qualification too — every archive close records api-tennis's own qualifying
# flag beside its event key and round, so Challenger and ATP qualifying closes can join the master by key
API_FIELDS = ('event_winner', 'event_status', 'tournament_round', 'tournament_name', 'event_type_type', 'event_date', 'event_final_result',
              'event_first_player', 'event_second_player', 'tournament_key', 'event_qualification')


def refresh_keys(out, fetch):
    """Founder brief 2026-10-15 item 5: every export row's player keys come from the CURRENT api-tennis fixture (its
    event key), every run — a key api-tennis corrected after the match left the board (L. Xiao 31666 -> 38140, 22 Sep)
    reaches every reader. `fetch(event_key)` -> the fixture dict, or None when unreadable. A row keeps its stored keys
    when the fixture cannot be read or cannot be oriented (counted, never guessed). Rows are changed in place."""
    rep = {'checked': 0, 'unchanged': 0, 'changed': 0, 'unreadable': 0, 'unoriented': 0, 'resultRefreshed': 0, 'examples': []}
    for r in out:
        rep['checked'] += 1
        f = fetch(r['eventKey'])
        # item 3: an archive close's api-tennis result is the CURRENT fixture's, not the one stored when the close was derived
        # (often mid-match: "Set 1"), so the Database feed can add the match once it has a result. Archive rows only: their
        # p1 is the api-tennis first player, so the fixture's own first / second words apply unchanged.
        if f and r.get('label') == ARCHIVE_LABEL:
            cur = {x: f.get(x) for x in API_FIELDS if f.get(x) is not None}
            if cur and any((r.get('apiTennis') or {}).get(x) != v for x, v in cur.items()):
                r['apiTennis'] = dict(r.get('apiTennis') or {}, **cur); rep['resultRefreshed'] += 1
        k1, k2 = (f or {}).get('first_player_key'), (f or {}).get('second_player_key')
        if not (str(k1 or '').isdigit() and str(k2 or '').isdigit()):
            rep['unreadable'] += 1; continue
        k1, k2 = int(k1), int(k2)
        a, b = r['p1Key'], r['p2Key']
        if {a, b} == {k1, k2}:
            rep['unchanged'] += 1; continue
        n1, n2 = f.get('event_first_player'), f.get('event_second_player')
        if a == k1 or b == k2:   first = True        # one key still agrees: it fixes the orientation
        elif a == k2 or b == k1: first = False
        elif same_surname(r.get('p1Name'), n1) and same_surname(r.get('p2Name'), n2) and not (same_surname(r.get('p1Name'), n2) and same_surname(r.get('p2Name'), n1)):
            first = True
        elif same_surname(r.get('p1Name'), n2) and same_surname(r.get('p2Name'), n1) and not (same_surname(r.get('p1Name'), n1) and same_surname(r.get('p2Name'), n2)):
            first = False
        else:
            rep['unoriented'] += 1; continue
        new1, new2 = (k1, k2) if first else (k2, k1)
        if len(rep['examples']) < 20:
            rep['examples'].append(f"{r['eventKey']} {r.get('p1Name')} v {r.get('p2Name')}: {a}/{b} -> {new1}/{new2}")
        r['keysFrom'] = {'stored': [a, b], 'apiTennis': [new1, new2]}
        r['p1Key'], r['p2Key'] = new1, new2
        rep['changed'] += 1
    return rep


def apitennis_fixture_fetcher(key, workers=16):
    """event_key -> the current api-tennis fixture (get_fixtures&match_key=), all asked at once on a small pool."""
    import concurrent.futures as cf
    def one(ek):
        u = 'https://api.api-tennis.com/tennis/?' + urllib.parse.urlencode({'method': 'get_fixtures', 'APIkey': key, 'match_key': ek, 'timezone': 'UTC'})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'stennisfy-pinarch'}), timeout=60) as r:
                    res = json.loads(r.read()).get('result') or []
                return next((f for f in res if isinstance(f, dict) and str(f.get('event_key')) == str(ek)), None)
            except Exception:                                  # noqa: BLE001 — retried, then unreadable (keys kept)
                time.sleep(2 * (attempt + 1))
        return None
    def prefetch(eks):
        with cf.ThreadPoolExecutor(workers) as ex:
            return dict(zip(eks, ex.map(one, eks)))
    return prefetch


def cmd_export(path):
    rows = select_all(CLOSE, 'id,event_key,match_date,p1_key,p2_key,p1_name,p2_name,p1,p2,label,source,book,close_ts,start_ts,start_source,gap_to_start_s,supersedes,detail')
    out = export_rows(rows)
    akey = os.environ.get('API_TENNIS_KEY') or ''
    if akey:
        got = apitennis_fixture_fetcher(akey)(sorted({r['eventKey'] for r in out}))
        krep = refresh_keys(out, got.get)
        print('### export keys (current api-tennis fixture)', json.dumps(krep))
        if krep['unreadable'] > len(out) // 2:
            print(f"::warning::api-tennis fixture read failed for {krep['unreadable']} of {len(out)} closes: their stored keys stand", flush=True)
    else:
        print('::warning::no API_TENNIS_KEY: export keys are the stored ones (not refreshed this run)', flush=True)
    by = {}
    for r in out:
        by[r['label']] = by.get(r['label'], 0) + 1
    hb = [r for r in rows if held_back(r)]
    held = {'rule': 'held-back closes stay in the archive and are never exported (odds.md "held back")', 'rows': len(hb),
            'events': len({r['event_key'] for r in hb}),
            'eventsWithAnotherClose': len({r['event_key'] for r in hb} & {r['eventKey'] for r in out}),
            'byRule': {k: {'why': HELD_BACK_RULES[k], 'rows': sum(1 for r in hb if held_back_reason(r) == k),
                           'events': len({r['event_key'] for r in hb if held_back_reason(r) == k})} for k in HELD_BACK_RULES}}
    print('### export held back', json.dumps(held))
    doc = {'generatedAt': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
           'source': 'Supabase pinnacle_archive_close (the permanent Pinnacle archive); current close per event',
           'rule': 'an archive close ("from Pinnacle history") beats a captured one; a superseded row is never current',
           'tableRows': len(rows), 'byLabel': by, 'heldBack': held, 'rows': out}
    tmp = path + '.tmp'
    with open(tmp, 'w') as fh:
        json.dump(doc, fh)
    os.replace(tmp, path)                                     # atomic: temp file + rename
    print('### export', json.dumps({'tableRows': len(rows), 'events': len(out), 'byLabel': by, 'file': path}))
    return doc


# ── which match a payload belongs to ─────────────────────────────────────────────────────────────────────────────────
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEVELS = ('Atp Singles', 'Challenger Men Singles')


def _load(name, file):
    import importlib.util
    sys.path.insert(0, ROOT_DIR)
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT_DIR, file))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


FLIP_PAGE = 1000


def flips(since, until=None):
    """ATP + Challenger singles our live poller saw go live: api-tennis event key, names, our live-flip times."""
    q = (f"/rest/v1/live_flip_log_current?select=event_key,first_live_seen_at,last_not_live_seen_at,gap_seconds,event_date,first_player,"
         f"second_player,tournament_name,event_type_type&first_live_seen_at=gte.{urllib.parse.quote(since.isoformat())}"
         f"&event_type_type=in.({','.join(urllib.parse.quote(x) for x in LEVELS)})&order=first_live_seen_at.asc,event_key.asc")
    if until:
        q += f"&first_live_seen_at=lt.{urllib.parse.quote(until.isoformat())}"
    # PostgREST answers at most 1,000 rows per request (max-rows), whatever `limit` asks for: page until a short page
    # (the first 30-day derive read exactly 1,000 flips and silently stopped on 2026-10-14)
    out, off = [], 0
    while True:
        _, rows, _ = rest('GET', f'{q}&limit={FLIP_PAGE}&offset={off}')
        rows = rows or []
        out += rows
        if len(rows) < FLIP_PAGE:
            return out
        off += len(rows)


def apitennis_day(day, key):
    """api-tennis fixtures for one UTC day (timezone=UTC), by event key: the player keys and names."""
    u = ('https://api.api-tennis.com/tennis/?' + urllib.parse.urlencode({'method': 'get_fixtures', 'APIkey': key,
         'date_start': day, 'date_stop': day, 'timezone': 'UTC'}))
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'stennisfy-pinarch'}), timeout=120) as r:
                d = json.loads(r.read())
            return {str(f.get('event_key')): f for f in (d.get('result') or []) if isinstance(f, dict)}
        except Exception:                                      # noqa: BLE001 — retried, then the day is skipped and counted
            time.sleep(5 * (attempt + 1))
    return None


TRUE_START_SOURCE = 'oddspapi trueStart (earlier than our live-flip)'
NO_FLIP_SOURCE = 'oddspapi trueStart (no live-flip held)'
# False 0-0 starts (founder brief 2026-10-27): our live-flip for the event was a 0-0 flag before any point was played and
# is superseded (live_flip_log_superseded); the close is re-cut at Oddspapi's gated trueStart. Verified: the trueStart is
# the start our own evidence points to (no point played at the flag), written only by cmd_false_starts_recut.
FALSE_START_SOURCE = 'oddspapi trueStart (our live-flip superseded: false 0-0 start)'
NO_TRUE_START = 'no Oddspapi trueStart'


def effective_cut(live_flip, true_start, true_end, sched):
    """The close cut (founder ruling 2026-10-14, the start-time check): the EARLIER of our live-flip start and
    Oddspapi's trueStart, the trueStart first passing the ruled sanity gate of ten225-load-line-summary.py
    resolve_start (end before start, a match over 6 h, or no end and a start over 6 h before the schedule -> rejected).
    Only the gate is used: its own cross-check can pick a start up to 5 min LATER than the flip, which this rule never
    does. With NO live-flip (founder ruling 2026-10-16): the gated trueStart alone, source NO_FLIP_SOURCE; missing or
    rejected -> (None, None, reason): no close. Returns (cut, source, reject reason)."""
    if live_flip is None:
        # founder ruling 2026-10-16 (TEN-437 item 6): a held payload whose match has NO live-flip row (the back-fill, before
        # live_flip_log began on 17 Sep) is cut at Oddspapi's trueStart alone, after the same gate; missing or rejected ->
        # no cut, so no close (never the scheduled time)
        if true_start is None:
            return None, None, NO_TRUE_START
    if true_start is None:
        return live_flip, CUT_SOURCE, None
    L = _load('lls', 'ten225-load-line-summary.py')
    e = lambda d: d.timestamp() if d else None
    ts, _src, reason, *_ = L.resolve_start(e(true_start), e(true_end), e(sched), None, None, None)
    if live_flip is None:
        return (None, None, reason) if ts is None else (true_start, NO_FLIP_SOURCE, None)
    if ts is None:
        return live_flip, CUT_SOURCE, reason
    if true_start < live_flip:
        return true_start, TRUE_START_SOURCE, None
    return live_flip, CUT_SOURCE, None


def _od_parts(od_name):
    """Oddspapi 'Surname Words, Given Words' -> (surname tokens, given initials); None without a comma (not a person
    name we can split safely)."""
    n = str(od_name or '')
    if ',' not in n or '/' in n:
        return None
    sur, giv = n.split(',', 1)
    return surname_tokens(sur), {t[0] for t in re.split(r'[\s\-]+', _fold(giv)) if t and t[0].isalpha()}


def _api_parts(api_name):
    """api-tennis 'V. C. Loureiro J.' -> (['loureiro'], {'v', 'c', 'j'}); 'Wu Tung-Lin' -> (['wu', 'tung', 'lin'], set())."""
    toks = str(api_name or '').split()
    return surname_tokens(api_name), {re.sub(r'[^a-z]', '', _fold(t))[:1] for t in toks if t.endswith('.') and re.sub(r'[^a-z]', '', _fold(t))}


def same_player_compound(api_name, od_name):
    """One player across a compound surname: api-tennis keeps the first part ("I. Parisca" = "Parisca Romera, Ignacio",
    "C. Bittoun" = "Bittoun Kouzmine, Constantin"), so OUR shorter surname must START theirs; theirs, when shorter, may be
    the start or the end of ours. Initials, where both sides have them, must share one. Never a tail of theirs ("A. Martin"
    is not "Lopez San Martin")."""
    od = _od_parts(od_name)
    x, ia = _api_parts(api_name)
    if not od or not x or not od[0]:
        return False
    y, ib = od
    if ia and ib and not (ia & ib):
        return False
    if len(x) <= len(y):
        return y[:len(x)] == x and len(''.join(x)) >= 3
    return (x[:len(y)] == y or x[-len(y):] == y) and len(''.join(y)) >= 2


def orient_compound(a1, a2, od1, od2):
    if same_player_compound(a1, od1) and same_player_compound(a2, od2):
        return 'same'
    if same_player_compound(a1, od2) and same_player_compound(a2, od1):
        return 'swap'
    return None


def _fixtures_by_day(discovered):
    by_day = {}
    for f in discovered or []:
        st = iso_ms(f.get('trueStartTime') or f.get('startTime'))
        if st is None or '/' in str(f.get('participant1Name')):
            continue
        by_day.setdefault(st.date(), []).append((f, st))
    return by_day


def _fixture_candidates(R, a1, a2, ref, by_day):
    """Oddspapi fixtures naming BOTH api-tennis players within 36 h of `ref`: the strict join, else (only when it finds
    nothing) the compound-surname join. [(fixture, 'same' | 'swap')]; the caller requires exactly one."""
    days = (ref.date() - dt.timedelta(days=1), ref.date(), ref.date() + dt.timedelta(days=1))
    for join in (lambda f: R.orient({'p1': a1, 'p2': a2}, f.get('participant1Name'), f.get('participant2Name')),
                 lambda f: orient_compound(a1, a2, f.get('participant1Name'), f.get('participant2Name'))):
        cands = [(f, o) for d in days for f, st in by_day.get(d, []) if abs((st - ref).total_seconds()) <= 36 * 3600 for o in [join(f)] if o]
        if cands:
            return cands
    return []


def events_for(fl_rows, fixture_map, discovered, at_key):
    """Each flip -> {event_key, fixture_id, p1IsParticipant1, cut, keys, names, trueStart}. The fixture comes from the
    odds loop's board map (odds-fixture-map.json, eventKey -> fixtureId + orient) or, else, from the Oddspapi
    fixtures list joined on BOTH surnames within 36 h (exactly one candidate, never a guess). Players and keys are
    api-tennis's (first / second player). Returns (events, misses-by-reason)."""
    R = _load('roh', 'refresh-odds-history.py')
    by_day = _fixtures_by_day(discovered)
    by_id = {f.get('fixtureId'): f for f in discovered or []}
    out, miss = [], {}
    def m(why):
        miss[why] = miss.get(why, 0) + 1
    for fl in fl_rows:
        ek = str(fl['event_key'])
        a1, a2 = fl.get('first_player'), fl.get('second_player')
        cut, flip = iso_ms(fl.get('last_not_live_seen_at')), iso_ms(fl.get('first_live_seen_at'))
        if not cut:
            m('no live-flip lower bound'); continue
        fx, p1first, ts = None, None, None
        bm = (fixture_map or {}).get(ek)
        if bm and bm.get('fixtureId') and bm.get('orient') in ('same', 'swap'):
            card_p1_is_first = R.norm(bm.get('p1')) == R.norm(a1)
            if not card_p1_is_first and R.norm(bm.get('p1')) != R.norm(a2):
                m('board map names differ from the flip'); continue
            fx = bm['fixtureId']
            p1first = (bm['orient'] == 'same') == card_p1_is_first
            ts = iso_ms((by_id.get(fx) or {}).get('trueStartTime'))
        # compound surnames (item 1): Oddspapi's "Parisca Romera, Ignacio" is api-tennis's "I. Parisca" — tried only when
        # the strict join found nothing, and still both players, ±36 h and exactly one candidate
        cands = [] if fx else _fixture_candidates(R, a1, a2, flip, by_day)
        if not fx:
            if len(cands) != 1:
                m('no Oddspapi fixture' if not cands else 'two or more Oddspapi fixtures'); continue
            fx, p1first = cands[0][0]['fixtureId'], cands[0][1] == 'same'
            ts = iso_ms(cands[0][0].get('trueStartTime'))
        fxr = by_id.get(fx) or (cands[0][0] if cands else {})
        eff, src, reject = effective_cut(cut, ts, iso_ms(fxr.get('trueEndTime')), iso_ms(fxr.get('startTime')))
        at = (at_key or {}).get(ek) or {}
        k1, k2 = at.get('first_player_key'), at.get('second_player_key')
        out.append({'event_key': ek, 'fixture_id': fx, 'p1IsParticipant1': p1first, 'cut': eff, 'cutSource': src,
                    'liveFlipCut': cut, 'trueStartReject': reject, 'firstLive': fl.get('first_live_seen_at'),
                    'lastNotLive': fl.get('last_not_live_seen_at'), 'trueStart': ts, 'date': fl.get('event_date') or (flip or cut).date().isoformat(),
                    'p1Name': a1, 'p2Name': a2, 'p1Key': int(k1) if str(k1 or '').isdigit() else None,
                    'p2Key': int(k2) if str(k2 or '').isdigit() else None, 'level': fl.get('event_type_type'), 'tour': fl.get('tournament_name'),
                    'api': {x: at.get(x) for x in ('event_winner', 'event_status', 'tournament_round', 'tournament_name', 'event_type_type',
                                                   'event_date', 'event_final_result', 'event_first_player', 'event_second_player') if at.get(x) is not None}})
    return out, miss


# ── closes for held payloads whose match has NO live-flip row (founder ruling 2026-10-16, TEN-437 item 6) ────────────
# "derive closes from the oddspapi Pinnacle prices we already hold for 13–30 Apr, using oddspapi's own start time as the
# cut". The ruling covers 13–30 Apr; the same code reaches every back-fill payload to 16 Sep, but only on a window asked
# for explicitly (HELD_FROM / HELD_TO are the ruled window).
HELD_FROM, HELD_TO = dt.datetime(2026, 4, 13, tzinfo=dt.timezone.utc), dt.datetime(2026, 5, 1, tzinfo=dt.timezone.utc)
FIXTURE_INDEX = '.ten225-fixture-index.json.gz'      # Oddspapi /v4/fixtures as read on 17 Sep (21 Mar – 16 Sep), already paid
NO_START_STATUSES = ('walk', 'cancel')


def held_fixture_meta(index_fixtures=None, raw_meta_rows=()):
    """fixtureId -> Oddspapi fixture fields, from what we already hold (never a metered call): the committed fixture index
    (`.ten225-fixture-index.json.gz`, trueStart + trueEnd) first, else a back-fill raw row's own meta (participants,
    startTime, trueStartTime; no trueEnd)."""
    out = {}
    for r in raw_meta_rows or ():
        m = r.get('meta') or {}
        p = m.get('participants') or [None, None]
        if m.get('trigger') == 'backfill' and p[0]:
            out[r['fixture_id']] = {'fixtureId': r['fixture_id'], 'participant1Name': p[0], 'participant2Name': p[1], 'startTime': m.get('startTime'),
                                    'trueStartTime': m.get('trueStartTime'), 'trueEndTime': None, 'categoryName': m.get('category'), 'from': 'back-fill raw meta'}
    for fid, f in (index_fixtures or {}).items():
        out[fid] = {'fixtureId': fid, 'participant1Name': f.get('p1'), 'participant2Name': f.get('p2'), 'startTime': f.get('startSched'),
                    'trueStartTime': f.get('trueStart'), 'trueEndTime': f.get('trueEnd'), 'categoryName': f.get('cat'), 'tournamentName': f.get('tourn'),
                    'from': 'fixture index'}
    return out


def _at_start(f):
    d, t = f.get('event_date'), f.get('event_time')
    if not d:
        return None
    try:
        return dt.datetime.fromisoformat(f'{d}T{t or "12:00"}:00+00:00')
    except ValueError:
        return None


def events_held(at_fixtures, fixtures, flip_keys, fixture_map=None, frm=HELD_FROM, to=HELD_TO):
    """api-tennis ATP / Challenger singles fixtures (get_fixtures, timezone=UTC) dated in [frm, to) whose match has NO
    live_flip_log row -> events for archive_close_row, cut at Oddspapi's trueStart alone (effective_cut with no
    live-flip: the same gate; missing or rejected -> no close, counted). The Oddspapi fixture: the board map, else the
    held fixtures (`held_fixture_meta`) joined on BOTH surnames within 36 h of api-tennis's start, exactly one candidate;
    a fixture claimed by two api-tennis events is no one's. Returns (events, misses-by-reason, [(event_key, reason)])."""
    R = _load('roh', 'refresh-odds-history.py')
    disc = [f for f in fixtures.values() if f.get('categoryName') in DISCOVERY_CATEGORIES]
    by_day, by_id = _fixtures_by_day(disc), {f['fixtureId']: f for f in disc}
    out, miss, why = [], collections.Counter(), []
    def m(ek, w):
        miss[w] += 1; why.append((ek, w))
    for f in at_fixtures:
        if f.get('event_type_type') not in LEVELS:
            continue
        ek, ref = str(f.get('event_key')), _at_start(f)
        if ref is None or not (frm <= ref < to):
            continue
        if ek in flip_keys:
            m(ek, 'live-flip row held (the live-flip derive owns it)'); continue
        if any(s in str(f.get('event_status') or '').lower() for s in NO_START_STATUSES):
            m(ek, 'api-tennis: never started (walkover / cancelled)'); continue
        a1, a2 = f.get('event_first_player'), f.get('event_second_player')
        fx, p1first = None, None
        bm = (fixture_map or {}).get(ek)
        if bm and bm.get('fixtureId') and bm.get('orient') in ('same', 'swap') and R.norm(bm.get('p1')) in (R.norm(a1), R.norm(a2)):
            fx, p1first = bm['fixtureId'], (bm['orient'] == 'same') == (R.norm(bm.get('p1')) == R.norm(a1))
        else:
            cands = _fixture_candidates(R, a1, a2, ref, by_day)
            if len(cands) != 1:
                m(ek, 'no Oddspapi fixture held' if not cands else 'two or more Oddspapi fixtures'); continue
            fx, p1first = cands[0][0]['fixtureId'], cands[0][1] == 'same'
        fxr = by_id.get(fx) or fixtures.get(fx) or {}
        ts, te, sc = iso_ms(fxr.get('trueStartTime')), iso_ms(fxr.get('trueEndTime')), iso_ms(fxr.get('startTime'))
        cut, src, reject = effective_cut(None, ts, te, sc)
        k1, k2 = f.get('first_player_key'), f.get('second_player_key')
        out.append({'event_key': ek, 'fixture_id': fx, 'p1IsParticipant1': p1first, 'cut': cut, 'cutSource': src, 'liveFlipCut': None,
                    'trueStartReject': reject, 'firstLive': None, 'lastNotLive': None, 'trueStart': ts, 'trueEnd': te, 'scheduled': sc,
                    'date': f.get('event_date'), 'p1Name': a1, 'p2Name': a2,
                    'p1Key': int(k1) if str(k1 or '').isdigit() else None, 'p2Key': int(k2) if str(k2 or '').isdigit() else None,
                    'level': f.get('event_type_type'), 'tour': f.get('tournament_name'), 'fixtureFrom': fxr.get('from'),
                    'api': {x: f.get(x) for x in API_FIELDS if f.get(x) is not None}})
    claimed = collections.Counter(e['fixture_id'] for e in out)
    keep = []
    for e in out:
        if claimed[e['fixture_id']] > 1:
            m(e['event_key'], 'one Oddspapi fixture, two api-tennis events'); continue
        if e['cut'] is None:
            m(e['event_key'], f"trueStart: {e['trueStartReject']}"); continue
        keep.append(e)
    return keep, dict(miss), why


def derive_rows(events, raws):
    """Close rows for `events` from their newest Pinnacle +30 payloads (`raws`: fixture_id -> raw row | NO_PINNACLE).
    Returns (rows, misses-by-reason, [(event_key, reason)])."""
    rows, why, per = [], collections.Counter(), []
    for ev in events:
        r = raws.get(ev['fixture_id'])
        w = None
        if not r:
            w = 'no raw payload yet'
        elif r is NO_PINNACLE:
            w = 'archived payloads carry no Pinnacle +30 (another book only)'
        else:
            row, w = archive_close_row(ev, r['id'], ev['fixture_id'], mw_series(gzip.decompress(unhex(r['payload_gz']))))
            if row is not None:
                if not (row['p1_key'] and row['p2_key']):
                    why['no api-tennis player keys'] += 1
                rows.append(row); continue
        why[w] += 1; per.append((ev['event_key'], w))
    return rows, dict(why), per


def cmd_derive_held(frm, to, dry_run=False):
    """Closes for the held Pinnacle +30 payloads of matches with no live-flip row, dated [frm, to) (default: the ruled
    13–30 Apr). Reads the archive, live_flip_log, the committed fixture index and api-tennis get_fixtures (UTC); never
    the metered /v4/fixtures. --dry-run counts what it would add and inserts nothing."""
    idx = json.load(gzip.open(os.path.join(ROOT_DIR, FIXTURE_INDEX))).get('fixtures') or {}
    meta = select_all(RAW, 'id,fixture_id,books,meta', 'meta->>trigger=eq.backfill')
    fixtures = held_fixture_meta(idx, meta)
    flip_keys = {str(f['event_key']) for f in flips(frm - dt.timedelta(days=2), to + dt.timedelta(days=2))}
    days = [(frm + dt.timedelta(days=i)).date().isoformat() for i in range((to - frm).days)]
    at, failed = _at_keys(days)
    evs, miss, _ = events_held(list(at.values()), fixtures, flip_keys, _board_map(), frm, to)
    rows, notd, _ = derive_rows(evs, raw_latest([e['fixture_id'] for e in evs]))
    held = select_all(CLOSE, 'id,event_key,label,dedupe_key,p1,p2,close_ts,supersedes',
                      'event_key=in.(' + ','.join(sorted({str(r['event_key']) for r in rows})) + ')') if rows else []
    add = plan_archive_closes(rows, held)
    ids = []
    if not dry_run:
        for i in range(0, len(add), 200):
            ids += insert(CLOSE, add[i:i + 200], 'dedupe_key')
    rep = {'window': [frm.date().isoformat(), to.date().isoformat()], 'dryRun': dry_run, 'events': len(evs), 'unmapped': miss, 'derived': len(rows),
           'notDerived': notd, 'wouldAdd' if dry_run else 'added': len(add) if dry_run else len(ids), 'corrections': sum(1 for r in add if r.get('supersedes')),
           'apiTennisDaysFailed': failed, 'oddspapiFixtureCalls': 0}
    print('### derive-held', json.dumps(rep))
    return rep


# Oddspapi files api-tennis's "ATP Davis Cup - World Group …" singles under its own "Davis Cup" category (founder brief
# 2026-10-15 item 1: all 24 failed ATP joins of 17 Sep – 14 Oct were Davis Cup ties, invisible to an ATP/Challenger list)
DISCOVERY_CATEGORIES = ('ATP', 'Challenger', 'Davis Cup')
# The back-fill also pulls ITF Men (founder ruling 2026-10-18 item 3: "pull any missing Oddspapi history for qualifying,
# Challenger and ITF fixtures from 13 Apr"; the endpoint is free). Only the back-fill reads ITF: the live-flip joins
# (derive, pull, start - 10) keep DISCOVERY_CATEGORIES, so no ITF fixture is ever a candidate for an ATP / Challenger match.
BACKFILL_CATEGORIES = DISCOVERY_CATEGORIES + ('ITF Men',)
DISCOVERY_VERSION = 3


def discovery(frm, to, cache_path, odds_key, max_age_h=6, itf=False):
    """Oddspapi tennis fixtures (the only METERED call here: /v4/fixtures, one per 6-day window), cached in
    `cache_path` so each window is asked once; the window holding `now` is re-asked once it is max_age_h old."""
    A = _load('aor', 'archive-oddspapi-raw.py')
    cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {'windows': {}}
    if cache.get('v') != DISCOVERY_VERSION:              # a cache kept under another category list is asked again, once
        cache = {'v': DISCOVERY_VERSION, 'windows': {}}
    now, calls, d = dt.datetime.now(dt.timezone.utc), 0, frm.replace(hour=0, minute=0, second=0, microsecond=0)
    while d < to:
        w_end = min(d + dt.timedelta(days=6), to.replace(hour=0, minute=0, second=0, microsecond=0) + dt.timedelta(days=1))
        k = d.date().isoformat() + '/' + w_end.date().isoformat()
        hit = cache['windows'].get(k)
        fresh = hit and (w_end < now - dt.timedelta(days=1) or (now - iso_ms(hit['at'])).total_seconds() < max_age_h * 3600)
        if not fresh:
            b, e = A.api_get('/v4/fixtures', {'sportId': 12, 'from': d.strftime('%Y-%m-%dT00:00:00Z'), 'to': w_end.strftime('%Y-%m-%dT00:00:00Z')}, odds_key)
            calls += 1
            time.sleep(A.FIXTURES_SLEEP)
            rows = b if isinstance(b, list) else ((b or {}).get('data') or [])
            if b is None:
                print(f'::warning::Oddspapi fixtures {k} failed ({e}): that window is skipped this run', flush=True)
            else:
                keep = [{x: f.get(x) for x in ('fixtureId', 'participant1Name', 'participant2Name', 'startTime', 'trueStartTime', 'categoryName', 'tournamentName', 'statusName')}
                        for f in rows if f.get('categoryName') in BACKFILL_CATEGORIES]
                cache['windows'][k] = {'at': now.isoformat(timespec='seconds'), 'fixtures': keep}
        d = w_end
    tmp = cache_path + '.tmp'
    with open(tmp, 'w') as fh:
        json.dump(cache, fh)
    os.replace(tmp, cache_path)
    seen = {}
    for w in cache['windows'].values():
        for f in w['fixtures']:
            if itf or f.get('categoryName') in DISCOVERY_CATEGORIES:
                seen[f['fixtureId']] = f
    return list(seen.values()), calls


def _board_map():
    p = os.path.join(ROOT_DIR, 'odds-fixture-map.json')
    return (json.load(open(p)).get('byKey') or {}) if os.path.exists(p) else {}


def _at_keys(days):
    key, out, failed = os.environ.get('API_TENNIS_KEY') or '', {}, []
    if not key:
        return out, list(days)
    for d in sorted(days):
        r = apitennis_day(d, key)
        if r is None:
            failed.append(d)
        else:
            out.update(r)
    return out, failed


NO_PINNACLE = {'noPinnacle': True}


def raw_latest(fixture_ids):
    """The newest raw row per fixture that carries Pinnacle +30 (payload included), fetched in small chunks. A fixture
    whose archived payloads are all another book's (the bet365 post-match archive) maps to NO_PINNACLE, never to one
    of those payloads."""
    out, ids = {}, sorted(set(fixture_ids))
    for i in range(0, len(ids), 10):
        chunk = ','.join('"' + x + '"' for x in ids[i:i + 10])
        _, rows, _ = rest('GET', f'/rest/v1/{RAW}?select=id,fixture_id,books,pulled_at&fixture_id=in.({urllib.parse.quote(chunk)})&order=id.asc')
        pick = {}
        for r in rows or []:
            if 'pinnacle+30' in (r.get('books') or []):
                pick[r['fixture_id']] = r['id']
            else:
                out.setdefault(r['fixture_id'], NO_PINNACLE)
        for fid, rid in pick.items():
            _, one, _ = rest('GET', f'/rest/v1/{RAW}?select=id,fixture_id,payload_gz,pulled_at,books&id=eq.{rid}')
            out[fid] = one[0]
    return out


def derive_and_add(events, raws):
    """Close rows for `events` from their newest raw payloads, added through plan_archive_closes (one per event)."""
    held = select_all(CLOSE, 'id,event_key,label,dedupe_key,p1,p2,close_ts,supersedes',
                      'event_key=in.(' + ','.join(sorted({str(e['event_key']) for e in events})) + ')') if events else []
    rows, why, _ = derive_rows(events, raws)
    add = plan_archive_closes(rows, held)
    ids = []
    for i in range(0, len(add), 200):
        ids += insert(CLOSE, add[i:i + 200], 'dedupe_key')
    return {'derived': len(rows), 'added': len(ids), 'corrections': sum(1 for r in add if r.get('supersedes')), 'notDerived': why}, rows


def cmd_derive(days, cache_path):
    """Closes for every ATP / Challenger match our live poller saw start in the last `days` days, from the newest raw
    payload the archive holds for it (bucket or post-start pull)."""
    A = _load('aor', 'archive-oddspapi-raw.py')
    okey = env('ODDSPAPI_KEY')
    now = dt.datetime.now(dt.timezone.utc)
    fl = flips(now - dt.timedelta(days=days))
    used0, _ = A.meter(okey, 'before derive')
    disc, calls = discovery(now - dt.timedelta(days=days + 1), now + dt.timedelta(days=1), cache_path, okey)
    used1, _ = A.meter(okey, 'after derive')
    at, failed = _at_keys({f['event_date'] for f in fl if f.get('event_date')})
    evs, miss = events_for(fl, _board_map(), disc, at)
    rep, rows = derive_and_add(evs, raw_latest([e['fixture_id'] for e in evs]))
    sc = [r['detail']['startCheck'] for r in rows]
    rep.update({'flips': len(fl), 'events': len(evs), 'unmapped': miss, 'oddspapiFixtureCalls': calls, 'meter': [used0, used1],
                'apiTennisDaysFailed': failed, 'startCheck': {
                    'withTrueStart': sum(1 for c in sc if c.get('oddspapiTrueStart')),
                    'trueStartBeforeCut': sum(1 for c in sc if (c.get('trueStartMinusCutS') or 0) < 0),
                    'entriesBetweenTrueStartAndCut': sum(1 for c in sc if c.get('entriesBetweenTrueStartAndCut'))}})
    print('### derive', json.dumps(rep))
    return rep


HIST_BOOK = 'pinnacle+30'      # every history pull names the book (founder 2026-10-14 item 3): never the account default
HIST_COOLDOWN_S = 5.5         # Oddspapi's only limit on the free history endpoint: ~1 call / 5 s (measured)
HIST_429_PAUSE_S = 60
HIST_429_TRIES = 3
_last_hist = [0.0]


def hist_get(fixture_id, key, counts, clock=time.monotonic, sleep=time.sleep, get=None):
    """One free /v4/historical-odds call for Pinnacle +30 in the post-start pull's OWN slot (founder 2026-10-14 item 2:
    never blocked by the odds loop's key gate; the endpoint is free, only the ~5 s cooldown applies). A 429 pauses 60 s
    and retries the same fixture, at most 3 times. Returns (body, err)."""
    A = None if get else _load('aor', 'archive-oddspapi-raw.py')
    get = get or (lambda f: A.api_get('/v4/historical-odds', {'fixtureId': f, 'bookmakers': HIST_BOOK}, key, timeout=60, raw=True))
    for _ in range(HIST_429_TRIES):
        wait = _last_hist[0] + HIST_COOLDOWN_S - clock()
        if wait > 0:
            sleep(wait); counts['waitS'] = counts.get('waitS', 0) + wait
        try:
            body, err = get(fixture_id)
        except Exception as e:                              # noqa: BLE001 — a dropped connection mid-body (IncompleteRead,
            body, err = None, f'network: {type(e).__name__}'  # reset) is one failed fixture, never the end of the run
        _last_hist[0] = clock()
        if err != 429:
            return body, err
        counts['http429'] = counts.get('http429', 0) + 1
        sleep(HIST_429_PAUSE_S); counts['waitS'] = counts.get('waitS', 0) + HIST_429_PAUSE_S
    return None, 429


def cmd_pull(budget_s, cache_path, hours=6):
    """After each ATP / Challenger match starts: pull its /v4/historical-odds (free) in the first key window, store the
    payload in the archive, derive the close at our live-flip start. A match whose close is not derivable yet is
    tried again on the next run, for up to 6 h after its start. With `hours` > 6 it is the backlog pull: every match
    started in that window with no archive close and no Pinnacle +30 payload yet."""
    A = _load('aor', 'archive-oddspapi-raw.py')
    okey = env('ODDSPAPI_KEY')
    t_end = A._clock_s() + budget_s
    now = dt.datetime.now(dt.timezone.utc)
    fl = [f for f in flips(now - dt.timedelta(hours=hours)) if iso_ms(f.get('last_not_live_seen_at'))]
    done = set()
    for i in range(0, len(fl), 100):                       # chunked: a 30-day backlog is ~1,400 event keys
        done |= {r['event_key'] for r in select_all(CLOSE, 'id,event_key', f'label=eq.{urllib.parse.quote(ARCHIVE_LABEL)}&event_key=in.('
                                                    + ','.join(str(f['event_key']) for f in fl[i:i + 100]) + ')')}
    fl = [f for f in fl if int(f['event_key']) not in done]
    disc, calls = discovery(now - dt.timedelta(hours=max(hours, 24) + 24), now + dt.timedelta(days=1), cache_path, okey) if fl else ([], 0)
    at, failed = _at_keys({f['event_date'] for f in fl if f.get('event_date')})
    evs, miss = events_for(fl, _board_map(), disc, at)
    # at most PULL_TRIES pulls per match, PULL_GAP_MIN apart: a payload with no pre-start entry is not pulled every run
    prior, has_pin = {}, set()
    for i in range(0, len(evs), 20):
        chunk = ','.join('"' + e['fixture_id'] + '"' for e in evs[i:i + 20])
        _, rows, _ = rest('GET', f'/rest/v1/{RAW}?select=id,fixture_id,pulled_at,source,books&fixture_id=in.({urllib.parse.quote(chunk)})')
        for r in rows or []:
            if r.get('source') == 'oddspapi /v4/historical-odds':
                prior.setdefault(r['fixture_id'], []).append(iso_ms(r['pulled_at']))
            if HIST_BOOK in (r.get('books') or []):
                has_pin.add(r['fixture_id'])
    def due(ev):
        p = prior.get(ev['fixture_id']) or []
        if hours > 6 and ev['fixture_id'] in has_pin:
            return False                                    # backlog: a Pinnacle +30 payload is held; derive reads it
        return len(p) < PULL_TRIES and (not p or (now - max(p)).total_seconds() >= PULL_GAP_MIN * 60)
    skipped = sum(1 for e in evs if not due(e))
    evs = [e for e in evs if due(e)]
    counts = {'waitS': 0, 'http429': 0}
    pulled, raw_add, errs = {}, 0, {}
    for ev in evs:
        if A._clock_s() > t_end:
            break
        body, err = hist_get(ev['fixture_id'], okey, counts)
        if body is None:
            errs[str(err)] = errs.get(str(err), 0) + 1; continue
        gz, raw_body, sha = payload_parts(body)
        ids = insert(RAW, [{'fixture_id': ev['fixture_id'], 'source': 'oddspapi /v4/historical-odds', 'pulled_at': dt.datetime.now(dt.timezone.utc).isoformat(),
                            'books': books_of(raw_body), 'payload_gz': hexbytes(gz), 'payload_sha256': sha, 'body_bytes': len(raw_body),
                            'meta': {'eventKey': ev['event_key'], 'trigger': 'post-start' if hours <= 6 else 'backlog', 'cut': ev['cut'].isoformat(),
                                     'liveFlipCut': (ev.get('liveFlipCut') or ev['cut']).isoformat(), 'book': HIST_BOOK}}], 'fixture_id,payload_sha256')
        raw_add += len(ids)
        pulled[ev['fixture_id']] = ev
    rep, _ = derive_and_add(list(pulled.values()), raw_latest(list(pulled))) if pulled else ({'derived': 0, 'added': 0}, [])
    rep.update({'started': len(fl), 'mapped': len(evs) + skipped, 'notDueYet': skipped, 'unmapped': miss, 'pulled': len(pulled), 'rawAdded': raw_add, 'pullErrors': errs,
                'keyWaitS': counts['waitS'], 'http429': counts['http429'], 'oddspapiFixtureCalls': calls, 'apiTennisDaysFailed': failed})
    print('### pull', json.dumps(rep))
    return rep


# ── the back-fill (founder 2026-10-15 item 4): every ATP / Challenger singles fixture Oddspapi still holds history
# for, oldest first, into the archive before it expires — on the own slot, BELOW the post-start pull ────────────────
BACKFILL_RETENTION_DAYS = 180   # /v4/historical-odds 404s past ~180 days (measured); the oldest fixtures go first
BACKFILL_GAP_S = 6.5            # one second wider than the pull's cooldown: the post-start pull keeps the faster slot
BACKFILL_YIELD_S = 20           # while a post-start pull runs, the back-fill sits out and asks again after this
BACKFILL_404_TRIES = 2          # a fixture that answered 404 on two runs is not asked again (no history to keep)
POSTMATCH_WORKFLOW = 'oddspapi-postmatch.yml'
_busy = {'at': -1e9, 'busy': False}


def postmatch_busy(clock=time.monotonic, gh=None):
    """True while an oddspapi-postmatch.yml run (the post-start pull's dispatcher) is queued or running: the back-fill
    yields the key to it. Read at most once a minute; an unreadable answer counts as busy (never run over the pull)."""
    if clock() - _busy['at'] < 60:
        return _busy['busy']
    A = None if gh else _load('aor', 'archive-oddspapi-raw.py')
    gh = gh or A.gh_get
    busy = False
    for st in ('in_progress', 'queued'):
        d, err = gh(f'/repos/{os.environ.get("GITHUB_REPOSITORY", "Michaeldk1996/SAAS")}/actions/workflows/{POSTMATCH_WORKFLOW}/runs?status={st}&per_page=5')
        if d is None or (d.get('total_count') or 0) > 0:
            busy = True
    _busy.update(at=clock(), busy=busy)
    return busy


def backfill_queue(fixtures, held_pin, in_bucket, state, now, frm, to):
    """The back-fill's targets, oldest first: ATP / Challenger singles fixtures Oddspapi lists between `frm` and `to`
    that have started, with no Pinnacle +30 payload in the archive, no bucket object waiting for the daily import, and
    fewer than BACKFILL_404_TRIES 404s on earlier runs."""
    q = []
    for f in fixtures:
        st = iso_ms(f.get('trueStartTime') or f.get('startTime'))
        if st is None or not (frm <= st < to) or st > now or '/' in str(f.get('participant1Name')):
            continue
        if f.get('categoryName') not in BACKFILL_CATEGORIES:
            continue
        fid = f['fixtureId']
        if fid in held_pin or fid in in_bucket or (state.get(fid) or {}).get('n404', 0) >= BACKFILL_404_TRIES:
            continue
        q.append((st, fid, f))
    q.sort(key=lambda x: (x[0], x[1]))
    return q


def cmd_backfill(budget_s, cache_path, state_path, frm=None, to=None, clock=None):
    """Pull, oldest first, the Pinnacle +30 history (free endpoint, `bookmakers=pinnacle+30`) of every fixture in the
    queue and store each payload in the archive (insert-only). The own slot (never the odds loop's key gate), one call
    every BACKFILL_GAP_S, and it yields to the post-start pull while that runs. Reports every month's progress."""
    A = _load('aor', 'archive-oddspapi-raw.py')
    okey = env('ODDSPAPI_KEY')
    clock = clock or A._clock_s
    t_end = clock() + budget_s
    now = dt.datetime.now(dt.timezone.utc)
    frm = frm or (now - dt.timedelta(days=BACKFILL_RETENTION_DAYS + 5))
    to = to or dt.datetime(2026, 9, 17, tzinfo=dt.timezone.utc)   # from 17 Sep the live-flip pulls cover every start
    disc, calls = discovery(frm, to, cache_path, okey, itf=True)
    held_pin, any_raw = set(), set()
    for r in select_all(RAW, 'id,fixture_id,books'):
        any_raw.add(r['fixture_id'])
        if HIST_BOOK in (r.get('books') or []):
            held_pin.add(r['fixture_id'])
    in_bucket = set()
    url, sb = A.supabase_creds()
    have, _sizes, ok = A.held_objects(url, sb)
    if ok:
        in_bucket = {f for f in have if f not in any_raw}          # waiting for the daily import; asked again after it
    state = json.load(open(state_path)) if os.path.exists(state_path) else {}
    q = backfill_queue(disc, held_pin, in_bucket, state, now, frm, to)
    total = collections.Counter(iso_ms(f.get('trueStartTime') or f.get('startTime')).strftime('%Y-%m') for f in disc
                                if f.get('categoryName') in BACKFILL_CATEGORIES and '/' not in str(f.get('participant1Name'))
                                and iso_ms(f.get('trueStartTime') or f.get('startTime')) and frm <= iso_ms(f.get('trueStartTime') or f.get('startTime')) < to)
    queued = collections.Counter(st.strftime('%Y-%m') for st, _, _ in q)
    print(f'### back-fill {frm.date()}..{to.date()}: {sum(total.values())} ATP/Challenger/Davis Cup/ITF Men singles listed, {len(q)} to pull, oldest first; '
          f'{len(in_bucket)} bucket objects wait for the daily import; Oddspapi fixture calls (metered) {calls}', flush=True)
    counts = {'waitS': 0, 'http429': 0, 'yieldS': 0}
    done, errs, last = collections.Counter(), collections.Counter(), [0.0]
    t0 = clock()
    for st, fid, f in q:
        while postmatch_busy() and clock() < t_end:
            time.sleep(BACKFILL_YIELD_S); counts['yieldS'] += BACKFILL_YIELD_S
        gap = last[0] + BACKFILL_GAP_S - clock()
        if gap > 0:
            time.sleep(gap)
        if clock() > t_end:
            break
        body, err = hist_get(fid, okey, counts)
        last[0] = clock()
        mo = st.strftime('%Y-%m')
        if body is None:
            errs[(mo, str(err))] += 1
            if err == 404:
                s = state.setdefault(fid, {}); s['n404'] = s.get('n404', 0) + 1; s['last'] = now.isoformat(timespec='seconds')
            continue
        gz, raw_body, sha = payload_parts(body)
        insert(RAW, [{'fixture_id': fid, 'source': 'oddspapi /v4/historical-odds', 'pulled_at': dt.datetime.now(dt.timezone.utc).isoformat(),
                      'books': books_of(raw_body), 'payload_gz': hexbytes(gz), 'payload_sha256': sha, 'body_bytes': len(raw_body),
                      'meta': {'trigger': 'backfill', 'book': HIST_BOOK, 'category': f.get('categoryName'), 'startTime': f.get('startTime'),
                               'trueStartTime': f.get('trueStartTime'), 'participants': [f.get('participant1Name'), f.get('participant2Name')]}}],
               'fixture_id,payload_sha256')
        done[mo] += 1
    tmp = state_path + '.tmp'
    with open(tmp, 'w') as fh:
        json.dump(state, fh)
    os.replace(tmp, state_path)
    secs = max(clock() - t0, 1)
    rate = sum(done.values()) / secs * 3600
    months = {}
    for mo in sorted(total):
        left = queued[mo] - done[mo] - sum(v for (m, _), v in errs.items() if m == mo)
        months[mo] = {'listed': total[mo], 'queuedAtStart': queued[mo], 'pulled': done[mo], 'failed': {e: v for (m, e), v in errs.items() if m == mo}, 'left': left,
                      'expires': (dt.datetime.strptime(mo + '-01', '%Y-%m-%d').replace(tzinfo=dt.timezone.utc) + dt.timedelta(days=BACKFILL_RETENTION_DAYS)).date().isoformat()}
    print('### back-fill', json.dumps({'pulled': sum(done.values()), 'perHour': round(rate, 1), 'months': months, 'keyWaitS': round(counts['waitS']),
                                        'yieldS': counts['yieldS'], 'http429': counts['http429'], 'oddspapiFixtureCalls': calls}), flush=True)
    return months


# ── the Tennis-Data feed (F3c: our Pinnacle closes into database-yield.json) ───────────────────────────────────────────
FEED_COLS = ['kind', 'date', 'tournament', 'series', 'court', 'surface', 'round', 'bestof', 'winner', 'loser', 'comment', 'psw', 'psl',
             'archiveId', 'label', 'eventKey']
ROUND_SIZE = {'final': 2, 'semi-finals': 4, 'quarter-finals': 8, '1/8-finals': 16, '1/16-finals': 32, '1/32-finals': 64, '1/64-finals': 128}


def _fold(x):
    import unicodedata
    return unicodedata.normalize('NFKD', str(x or '')).encode('ascii', 'ignore').decode().lower()


def surname_tokens(name):
    """'J. M. Cerundolo' / 'Cerundolo J.M.' / 'Mpetshi Perricard G.' -> ['cerundolo'] / ['mpetshi', 'perricard']: every
    token that is not an initial (a token ending in '.' or a single letter), accents and hyphens folded."""
    toks = [t for t in re.split(r'[\s\-]+', _fold(name).replace("'", '')) if t]
    return [re.sub(r'[^a-z]', '', t) for t in toks if not (t.endswith('.') or len(re.sub(r'[^a-z]', '', t)) <= 1) and re.sub(r'[^a-z]', '', t)]


def same_surname(a, b):
    """Tennis-Data shortens compound surnames ('Mpetshi G.' = G. Mpetshi Perricard, 'Barrios M.' ...): the shorter list
    must be the start or the end of the longer one."""
    x, y = surname_tokens(a), surname_tokens(b)
    if not x or not y:
        return False
    ia, ib = first_initial(a), first_initial(b)
    if ia and ib and ia != ib:                                  # brothers: 'Zverev A.' is not M. Zverev
        return False
    s, l = (x, y) if len(x) <= len(y) else (y, x)
    return l[:len(s)] == s or l[-len(s):] == s


_NAME_ALIASES = None


def name_aliases():
    """build-odds-performance.js ARCHIVE_NAME_ALIASES (Tennis-Data name -> the api-tennis key it names), read once."""
    global _NAME_ALIASES
    if _NAME_ALIASES is None:
        try:
            _NAME_ALIASES = parse_name_table(open(os.path.join(ROOT_DIR, 'build-odds-performance.js')).read())
        except (OSError, ValueError):
            _NAME_ALIASES = {}
    return _NAME_ALIASES


def same_player(td, api, api_key=None):
    """A Tennis-Data name against an api-tennis player: the surname rule (same_surname), or - founder ruling 2026-10-17
    item 4 - the archive name table, which names the player's key ("Struff J.L." = J-L. Struff, 2831; "O Connell C." =
    C. O'Connell, 421). The table only adds a join; it never refuses one the surname rule makes."""
    k = name_aliases().get(str(td or '').strip())
    if k is not None and api_key is not None and str(api_key) == k:
        return True
    return same_surname(td, api)


def first_initial(name):
    m = re.search(r'\b([A-Za-z])\.', str(name or ''))
    return _fold(m.group(1)) if m else None


def td_name(api_name):
    """api-tennis 'J. M. Cerundolo' -> Tennis-Data 'Cerundolo J.M.' (surname, then the initials joined)."""
    toks = str(api_name or '').split()
    ini = [t for t in toks if t.endswith('.') and len(t) <= 4]
    sur = [t for t in toks if t not in ini]
    return ' '.join(sur) + (' ' + ''.join(ini) if ini else '')


def parse_alias(js_text):
    """build-tournament-market.js ALIAS: registry key (city) -> its Tennis-Data tournament names."""
    i = js_text.index('const ALIAS = {'); j = js_text.index('\n};', i)
    out = {}
    for k, v in re.findall(r"""^\s*['"]([^'"]+)['"]:\s*\[([^\]]*)\]""", js_text[i:j], re.M):
        out[k] = [a or b for a, b in re.findall(r"""'([^']*)'|"([^"]*)\"""", v)]
    return out


def read_td(archive_dir):
    rows = []
    for f in sorted(glob.glob(os.path.join(archive_dir, '*.csv'))):
        lines = open(f).read().splitlines()
        head = lines[0].split(',')
        for l in lines[1:]:
            c = l.split(',')
            if len(c) >= len(head):
                rows.append(dict(zip(head, c)))
    return rows


def td_edition_meta(td_rows, alias, key):
    """The event's latest Tennis-Data edition (by `alias[key]` names): name, series, court, surface, bestof, and K = its
    highest numbered round ('4th Round' -> 4), so R16 = K, R32 = K-1 …"""
    names = set(alias.get(key) or [])
    ed = [r for r in td_rows if r.get('tournament') in names]
    if not ed:
        return None
    yr = max(r['date'][:4] for r in ed)
    last = [r for r in ed if r['date'][:4] == yr]
    nums = [int(m.group(1)) for r in last for m in [re.match(r'(\d)(st|nd|rd|th) Round', r.get('round') or '')] if m]
    r0 = last[-1]
    return {'tournament': r0['tournament'], 'series': r0.get('series'), 'court': r0.get('court'), 'surface': r0.get('surface'),
            'bestof': r0.get('bestof'), 'K': max(nums) if nums else 0, 'year': yr}


# Founder ruling 2026-10-16 (ruling 4): a NEW ATP event (no Tennis-Data edition) takes its details from our own tables —
# surface + court = tournament-surfaces.json by api-tennis tournament_key, tier = the dashboard's TOURNAMENT_CATALOG,
# best of 5 at a Grand Slam only, else 3. Davis Cup and Laver Cup stay out (team events, never Tennis-Data rows).
CATALOG_SERIES = {'Grand Slam': 'Grand Slam', 'ATP 1000': 'Masters 1000', 'ATP 500': 'ATP500', 'ATP 250': 'ATP250', 'ATP Finals': 'Masters Cup'}
TEAM_EVENT = re.compile(r'davis cup|laver cup|united cup|atp cup|hopman', re.I)


def parse_catalog(html_text):
    """The dashboard's TOURNAMENT_CATALOG: name -> category."""
    i = html_text.index('const TOURNAMENT_CATALOG = ['); j = html_text.index('\n];', i)
    return dict(re.findall(r"""name:\s*'([^']+)',\s*category:\s*'([^']+)'""", html_text[i:j]))


def new_event_meta(key, api, catalog, surfaces, sizes):
    """Details for an event Tennis-Data never carried, or None (counted, never guessed): no team event, a catalogued tier,
    a known surface + court for its tournament_key, and K from the largest draw round seen for it this year (`sizes`)."""
    if TEAM_EVENT.search(key or ''):
        return None
    series = CATALOG_SERIES.get((catalog or {}).get(key))
    tk = str((api or {}).get('tournament_key') or '')
    surf, court = ((surfaces or {}).get('surfaces') or {}).get(tk), ((surfaces or {}).get('courts') or {}).get(tk)
    if not series or not surf or not court:
        return None
    big = max(sizes or [0])
    K = {128: 4, 64: 3, 32: 2, 16: 1}.get(big, 0)
    return {'tournament': key, 'series': series, 'court': court.capitalize(), 'surface': surf.capitalize(),
            'bestof': '5' if series == 'Grand Slam' else '3', 'K': K, 'year': None, 'newEvent': True}


def td_event_key(a):
    """The td-feed's event key for an api-tennis fixture: its tournament name without "ATP " and without a trailing
    " - Qualification" (round 2 item 1.1: api-tennis names the Lyon (France) MAIN draw "Lyon (France) - Qualification").
    ONE key for the edition lookup and the draw-size table, so a new event's K (its R32 / R16 labels) is found."""
    key = re.sub(r'^ATP\s+', '', str(a.get('tournament_name') or '')).strip()
    return re.sub(r'\s*-\s*Qualification$', '', key, flags=re.I).strip()


def api_is_qualifying(a):
    """Qualifying status of an api-tennis fixture (defect brief 2026-10-24 items 1-2). The feed's own flag decides:
    event_qualification 'True' / 'False'. Its round label never overrides it - api-tennis labels the qualifying bracket's
    rounds "Semi-finals" / "Final" (Almaty 2026: 12 qualifying matches filed as main-draw SF and F), and names one main draw
    "Lyon (France) - Qualification". Only a fixture with no flag falls back to the 'qualif' text test."""
    flag = str(a.get('event_qualification'))
    if flag in ('True', 'False'):
        return flag == 'True'
    return 'qualif' in (str(a.get('tournament_name') or '') + ' ' + str(a.get('tournament_round') or '')).lower()


def td_round(api_round, K):
    r = _fold((api_round or '').split(' - ')[-1]).strip()
    if 'qualif' in r:
        return None
    size = ROUND_SIZE.get(r)
    if size == 2: return 'The Final'
    if size == 4: return 'Semifinals'
    if size == 8: return 'Quarterfinals'
    if size and K:
        n = K - {16: 0, 32: 1, 64: 2, 128: 3}[size]
        if n >= 1:
            return f'{n}{"st" if n == 1 else "nd" if n == 2 else "rd" if n == 3 else "th"} Round'
    return None


def td_spellings(export_rows, by_day, table_names=None):
    """Founder ruling 2026-10-16 (ruling 5: "normalise the loser spellings through the existing alias table"): player key ->
    the spelling Tennis-Data uses for him, so a match built after Tennis-Data's last day names a player exactly as his
    earlier Tennis-Data rows do ("Zhang Zh.", "Etcheverry T.M.", "Van Assche L.", "Carreno Busta P."). Learned from every
    archive close that joins exactly ONE Tennis-Data row (same day ±1, both surnames) — the latest such row wins; else the
    ONE name the archive name table (build-odds-performance.js ARCHIVE_NAME_ALIASES) gives that key; else none (the caller
    falls back to td_name). A key two Tennis-Data spellings share on the same latest date is left out (never a guess)."""
    seen = {}
    for e in export_rows:
        day = dt.date.fromisoformat(e['date'])
        cands = [r for k in (day - dt.timedelta(days=1), day, day + dt.timedelta(days=1)) for r in by_day.get(k.isoformat(), [])
                 if (same_player(r['winner'], e['p1Name'], e.get('p1Key')) and same_player(r['loser'], e['p2Name'], e.get('p2Key')))
                 or (same_player(r['winner'], e['p2Name'], e.get('p2Key')) and same_player(r['loser'], e['p1Name'], e.get('p1Key')))]
        if len(cands) != 1:
            continue
        r = cands[0]
        w1 = same_player(r['winner'], e['p1Name'], e.get('p1Key'))
        for key, nm in ((e.get('p1Key'), r['winner'] if w1 else r['loser']), (e.get('p2Key'), r['loser'] if w1 else r['winner'])):
            if key is None:
                continue
            k = str(key)
            cur = seen.get(k)
            if cur is None or r['date'] > cur[0]:
                seen[k] = (r['date'], {nm})
            elif r['date'] == cur[0]:
                cur[1].add(nm)
    out = {k: next(iter(v[1])) for k, v in seen.items() if len(v[1]) == 1}
    inv = {}
    for nm, k in (table_names or {}).items():
        inv.setdefault(str(k), set()).add(nm)
    for k, v in inv.items():
        if k not in out and len(v) == 1:
            out[k] = next(iter(v))
    return out


def parse_name_table(js_text):
    """build-odds-performance.js ARCHIVE_NAME_ALIASES: a Tennis-Data name -> the player key it names (hand-checked)."""
    i = js_text.index('const ARCHIVE_NAME_ALIASES = {'); j = js_text.index('\n};', i)
    return {n: k for n, k in re.findall(r"""^\s*'([^']+)':\s*'(\d+)'""", js_text[i:j], re.M) if ',' not in n}


# api-tennis statuses whose match is a result for the feed. "Awarded" (a default) is one when our archive holds a close for
# it: the archive cuts a close only at a verified live start, so play began (founder ruling 2026-10-17, odds master
# close-out item 1: a match that started counts as played; build-database-yield.js prices it behind the retired flag).
FEED_RESULT_STATUSES = ('Finished', 'Retired', 'Awarded')
FEED_COMMENT = {'Retired': 'Retired', 'Awarded': 'Awarded'}


EARLY_CUT_LABEL = 'early cut'


def feed_label(e):
    """The feed's label for an export row: its own label, except a buffer-cut fill row (founder ruling 2026-10-25) —
    'early cut N' (N = its bufferMin), which build-database-yield.js reads as book 9 and the page marks 'E'."""
    if e.get('closeCut') == 'trueStart-buffer' and isinstance(e.get('bufferMin'), int) and e['bufferMin'] > 0:
        return f"{EARLY_CUT_LABEL} {e['bufferMin']}"
    return e.get('label')


def td_feed_rows(export_rows, td_rows, alias, pin_stop, table_names=None, catalog=None, surfaces=None):
    """Feed rows + a report. `override`: a Tennis-Data row (same day ±1, both surnames) with no Pinnacle pair gets our
    close (the row is named exactly as Tennis-Data wrote it). `add`: an ATP main-draw match after Tennis-Data's last day,
    from an ARCHIVE close that carries its api-tennis result, its players spelled as Tennis-Data spells them
    (td_spellings). Everything else is counted, never guessed."""
    td_last = max(r['date'] for r in td_rows) if td_rows else ''
    by_day = {}
    for r in td_rows:
        if r['date'] > pin_stop:
            by_day.setdefault(r['date'], []).append(r)
    spell = td_spellings(export_rows, by_day, table_names)
    sizes = {}                                   # (event, year) -> the draw sizes its archive closes show (a new event's K)
    for e in export_rows:
        a = e.get('apiTennis') or {}
        k = (td_event_key(a), e['date'][:4])
        sizes.setdefault(k, []).append(ROUND_SIZE.get(_fold(str(a.get('tournament_round') or '').split(' - ')[-1]).strip(), 0))
    out, rep = [], {'closes': 0, 'beforePinnacleStop': 0, 'override': 0, 'tdHasPinnacle': 0, 'twoTdRows': 0, 'add': 0, 'addRetired': 0,
                    'notInTdWindow': 0, 'capturedOnlyAfterTd': 0, 'notAtpSingles': 0, 'qualifying': 0, 'qualifyingOrRound': 0, 'walkover': 0,
                    'noTdEdition': 0, 'noResult': 0, 'spelledAsTennisData': 0, 'newEvent': 0, 'team': 0, 'teamRetired': 0, 'addAwarded': 0, 'teamAwarded': 0,
                    'teamWalkover': 0, 'teamNoResult': 0}
    for e in export_rows:
        rep['closes'] += 1
        d = e['date']
        if d <= pin_stop:
            rep['beforePinnacleStop'] += 1; continue
        day = dt.date.fromisoformat(d)
        cands = [r for k in (day - dt.timedelta(days=1), day, day + dt.timedelta(days=1)) for r in by_day.get(k.isoformat(), [])
                 if (same_player(r['winner'], e['p1Name'], e.get('p1Key')) and same_player(r['loser'], e['p2Name'], e.get('p2Key')))
                 or (same_player(r['winner'], e['p2Name'], e.get('p2Key')) and same_player(r['loser'], e['p1Name'], e.get('p1Key')))]
        if len(cands) > 1:
            rep['twoTdRows'] += 1; continue
        if cands:
            r = cands[0]
            if _vp(r.get('psw')) and _vp(r.get('psl')):
                rep['tdHasPinnacle'] += 1; continue
            w1 = same_player(r['winner'], e['p1Name'], e.get('p1Key'))
            out.append({'kind': 'override', 'date': r['date'], 'tournament': r['tournament'], 'series': r.get('series'), 'court': r.get('court'),
                        'surface': r.get('surface'), 'round': r.get('round'), 'bestof': r.get('bestof'), 'winner': r['winner'], 'loser': r['loser'],
                        'comment': r.get('comment'), 'psw': e['p1'] if w1 else e['p2'], 'psl': e['p2'] if w1 else e['p1'],
                        'archiveId': e.get('archiveId'), 'label': feed_label(e), 'eventKey': e.get('eventKey')})
            rep['override'] += 1; continue
        # Founder ruling 2026-10-17 (fix 2): a team event (Davis Cup, Laver Cup …) our archive prices goes into the master
        # with the same source order and hover; Tennis-Data never carries one, so it is its own feed kind ('team'), read
        # into the era shard only — never a Database row, statistic or ROI.
        ta = e.get('apiTennis') or {}
        if ta and TEAM_EVENT.search(str(ta.get('tournament_name') or '')):
            st = str(ta.get('event_status') or '')
            if 'walk' in st.lower():
                rep['teamWalkover'] += 1; continue
            if ta.get('event_winner') not in ('First Player', 'Second Player') or st not in FEED_RESULT_STATUSES:
                rep['teamNoResult'] += 1; continue
            first_won = ta['event_winner'] == 'First Player'
            w, l = (e['p1Name'], e['p2Name']) if first_won else (e['p2Name'], e['p1Name'])
            wk, lk = (e.get('p1Key'), e.get('p2Key')) if first_won else (e.get('p2Key'), e.get('p1Key'))
            wn, ln = spell.get(str(wk)) if wk is not None else None, spell.get(str(lk)) if lk is not None else None
            out.append({'kind': 'team', 'date': d, 'tournament': str(ta.get('tournament_name')).replace(',', ' '), 'series': 'Team event',
                        'court': '', 'surface': '', 'round': '', 'bestof': '', 'winner': wn or td_name(w), 'loser': ln or td_name(l),
                        'comment': FEED_COMMENT.get(st, 'Completed'), 'psw': e['p1'] if first_won else e['p2'],
                        'psl': e['p2'] if first_won else e['p1'], 'archiveId': e.get('archiveId'), 'label': feed_label(e), 'eventKey': e.get('eventKey')})
            rep['teamRetired' if st == 'Retired' else 'teamAwarded' if st == 'Awarded' else 'team'] += 1; continue
        if d <= td_last:
            rep['notInTdWindow'] += 1; continue       # inside Tennis-Data's window but not in it: not an ATP main-draw match
        a = e.get('apiTennis') or {}
        if e.get('label') != ARCHIVE_LABEL or not a:
            rep['capturedOnlyAfterTd'] += 1; continue
        if a.get('event_type_type') != 'Atp Singles':
            rep['notAtpSingles'] += 1; continue
        st = str(a.get('event_status') or '')
        if 'walk' in st.lower():
            rep['walkover'] += 1; continue
        if a.get('event_winner') not in ('First Player', 'Second Player') or st not in FEED_RESULT_STATUSES:
            rep['noResult'] += 1; continue
        if api_is_qualifying(a):
            rep['qualifying'] += 1; continue          # the flag decides; a qualifying round label never reads as main draw
        key = td_event_key(a)
        meta = td_edition_meta(td_rows, alias, key)
        if not meta and catalog is not None:
            meta = new_event_meta(key, a, catalog, surfaces, sizes.get((key, d[:4])))
            if meta:
                rep['newEvent'] += 1
        if not meta:
            rep['noTdEdition'] += 1; continue
        rnd = td_round(a.get('tournament_round'), meta['K'])
        if not rnd:
            rep['qualifyingOrRound'] += 1; continue
        first_won = a['event_winner'] == 'First Player'
        w, l = (e['p1Name'], e['p2Name']) if first_won else (e['p2Name'], e['p1Name'])
        wk, lk = (e.get('p1Key'), e.get('p2Key')) if first_won else (e.get('p2Key'), e.get('p1Key'))
        wn, ln = spell.get(str(wk)) if wk is not None else None, spell.get(str(lk)) if lk is not None else None
        rep['spelledAsTennisData'] += (wn is not None) + (ln is not None)
        out.append({'kind': 'add', 'date': d, 'tournament': meta['tournament'], 'series': meta['series'], 'court': meta['court'],
                    'surface': meta['surface'], 'round': rnd, 'bestof': meta['bestof'], 'winner': wn or td_name(w), 'loser': ln or td_name(l),
                    'comment': FEED_COMMENT.get(st, 'Completed'), 'psw': e['p1'] if first_won else e['p2'],
                    'psl': e['p2'] if first_won else e['p1'], 'archiveId': e.get('archiveId'), 'label': feed_label(e), 'eventKey': e.get('eventKey')})
        rep['addRetired' if st == 'Retired' else 'addAwarded' if st == 'Awarded' else 'add'] += 1
    rep['tdLastDay'] = td_last
    return out, rep


def _vp(x):
    try:
        return float(x) > 1.0
    except (TypeError, ValueError):
        return False


def cmd_td_feed(export_path, out_csv):
    exp = json.load(open(export_path))
    td = read_td(os.path.join(ROOT_DIR, 'odds-archive'))
    alias = parse_alias(open(os.path.join(ROOT_DIR, 'build-tournament-market.js')).read())
    pin_stop = max((r['date'] for r in td if _vp(r.get('psw')) and _vp(r.get('psl'))), default='')
    names = parse_name_table(open(os.path.join(ROOT_DIR, 'build-odds-performance.js')).read())
    catalog = parse_catalog(open(os.path.join(ROOT_DIR, 'bsp-consult-dashboard.html')).read())
    try:
        surfaces = json.load(open(os.path.join(ROOT_DIR, 'tournament-surfaces.json')))
    except (OSError, ValueError):
        surfaces = None                          # no surface table: a new event cannot be added (counted as noTdEdition)
    rows, rep = td_feed_rows(exp.get('rows') or [], td, alias, pin_stop, names, catalog, surfaces)
    for r in rows:
        if any(',' in str(r.get(k) or '') for k in FEED_COLS):
            die(f'a feed field holds a comma: {r}')
    tmp = out_csv + '.tmp'
    with open(tmp, 'w') as fh:
        fh.write(','.join(FEED_COLS) + '\n')
        for r in rows:
            fh.write(','.join('' if r.get(k) is None else str(r[k]) for k in FEED_COLS) + '\n')
    os.replace(tmp, out_csv)
    rep['pinnacleStop'] = pin_stop
    print('### td-feed', json.dumps(rep))
    return rows, rep


# ── The lower levels from 17 Sep: our archive's closes (founder ruling 2026-10-18 item 3) ─────────────────────────────
def lower_level(f):
    """'atp-q' | 'ch' | 'ch-q' | 'itf' | None, from api-tennis's own fields (ATP main draw is Tennis-Data's)."""
    t = f.get('event_type_type')
    q = api_is_qualifying(f)
    if t == 'Atp Singles':
        return 'atp-q' if q else None
    if t == 'Challenger Men Singles':
        return 'ch-q' if q else 'ch'
    if t == 'Itf Men Singles':
        return 'itf'
    return None


LOWER_COLS = ['date', 'level', 'tournament', 'round', 'winner', 'loser', 'winnerKey', 'loserKey', 'psw', 'psl', 'eventKey',
              'snapshotId', 'source', 'cutTs', 'gapToStartS', 'comment']


def lower_close_rows(export_rows):
    """Every exported close (verified start, held-back rules already applied by the export) of a lower-level match with
    its api-tennis result: one row, the winner first, the label as the source ('from Pinnacle history' | 'captured')."""
    out, rep = [], collections.Counter()
    for e in export_rows:
        a = e.get('apiTennis') or {}
        lv = lower_level(a) if a else None
        if not lv:
            continue
        st = str(a.get('event_status') or '')
        if 'walk' in st.lower():
            rep[lv + ': walkover'] += 1; continue
        if a.get('event_winner') not in ('First Player', 'Second Player') or st not in FEED_RESULT_STATUSES:
            rep[lv + ': no result'] += 1; continue
        fw = a['event_winner'] == 'First Player'
        w, l = (e['p1Name'], e['p2Name']) if fw else (e['p2Name'], e['p1Name'])
        wk, lk = (e.get('p1Key'), e.get('p2Key')) if fw else (e.get('p2Key'), e.get('p1Key'))
        out.append({'date': e['date'], 'level': lv, 'tournament': str(a.get('tournament_name') or '').replace(',', ' ').strip(),
                    'round': str(a.get('tournament_round') or '').replace(',', ' '), 'winner': td_name(w), 'loser': td_name(l),
                    'winnerKey': '' if wk is None else wk, 'loserKey': '' if lk is None else lk,
                    'psw': e['p1'] if fw else e['p2'], 'psl': e['p2'] if fw else e['p1'], 'eventKey': e.get('eventKey') or '',
                    'snapshotId': e.get('archiveId') or '', 'source': e.get('label') or '', 'cutTs': e.get('closeTs') or '',
                    'gapToStartS': '' if e.get('gapToStartS') is None else e['gapToStartS'],
                    'comment': FEED_COMMENT.get(st, 'Completed')})
        rep[lv] += 1
    return out, dict(rep)


def cmd_lower_closes(export_path, out_csv):
    rows, rep = lower_close_rows((json.load(open(export_path)).get('rows')) or [])
    tmp = out_csv + '.tmp'
    with open(tmp, 'w') as fh:
        fh.write(','.join(LOWER_COLS) + '\n')
        for r in rows:
            fh.write(','.join(str(r[k]).replace(',', ' ') for k in LOWER_COLS) + '\n')
    os.replace(tmp, out_csv)
    print('### lower-closes', json.dumps({'rows': len(rows), 'report': rep, 'file': out_csv}))
    return rows, rep


def cmd_counts(record=None):
    g = guard_state()
    print('### guard', json.dumps(g))
    if record:
        c = record_count(record, {'guardOk': g.get('ok')})
        print('### recorded', json.dumps(c))
    if not g.get('ok'):
        die('archive guard NOT ok: ' + json.dumps(g))
    return g


def cmd_false_starts_report(since='2026-10-24'):
    """READ-ONLY (founder brief 2026-10-26, "False 0-0 starts"). Every live_flip_log row since `since` beside Oddspapi's
    trueStartTime (oddspapi_fixtures, both surnames within 36 h, exactly one candidate), flagging a logged start more than
    300 s before the true one; then every archive close on the flagged events (and the 3 known 26 Oct keys). Writes nothing."""
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    from ten225_names import name_key
    def get_all(path):
        out, off = [], 0
        while True:
            _, got, _ = rest('GET', path + f'&limit=1000&offset={off}')
            out += got or []
            if not got or len(got) < 1000:
                return out
            off += 1000
    flips = get_all(f'/rest/v1/live_flip_log?select=event_key,first_live_seen_at,last_not_live_seen_at,gap_seconds,event_date,'
                    f'first_player,second_player,tournament_name,event_type_type&first_live_seen_at=gte.{since}&order=first_live_seen_at.asc')
    fx = get_all(f'/rest/v1/oddspapi_fixtures?select=fixture_id,player1,player2,scheduled_start,true_start,category_name'
                 f'&scheduled_start=gte.{since}&order=scheduled_start.asc')
    def ts(v):
        try:
            return dt.datetime.fromisoformat(str(v).replace('Z', '+00:00').replace(' ', 'T'))
        except ValueError:
            return None
    def pair(a, b):
        ka, kb = name_key(a or ''), name_key(b or '')
        return frozenset((ka, kb)) if ka and kb and ka != kb else None
    byp = collections.defaultdict(list)
    for f in fx:
        k = pair(f.get('player1'), f.get('player2'))
        if k:
            byp[k].append(f)
    st = collections.Counter(); flagged = []
    print(f'live_flip_log rows since {since}: {len(flips)}; oddspapi fixtures since then: {len(fx)}')
    for r in flips:
        k = pair(r.get('first_player'), r.get('second_player')); fl = ts(r['first_live_seen_at'])
        c = [f for f in byp.get(k, []) if fl and ts(f['scheduled_start']) and abs((ts(f['scheduled_start']) - fl).total_seconds()) <= 36 * 3600]
        if len(c) != 1:
            st['no_or_ambiguous_oddspapi_fixture'] += 1; continue
        tst = ts(c[0].get('true_start'))
        if tst is None:
            st['oddspapi_no_true_start'] += 1; continue
        d = (tst - fl).total_seconds()
        st['early_gt_300s' if d > 300 else 'within_300s_or_later'] += 1
        if d > 300:
            flagged.append((r, c[0], d))
    print('verdicts:', dict(st))
    for r, f, d in flagged:
        print('FLAGGED', json.dumps({'event_key': r['event_key'], 'match': f"{r['first_player']} v {r['second_player']}", 'level': r['event_type_type'],
                                     'tournament': r['tournament_name'], 'logged_start': r['first_live_seen_at'], 'true_start': f['true_start'],
                                     'early_by_min': round(d / 60, 1), 'oddspapi_fixture': f['fixture_id']}))
    keys = sorted({int(r['event_key']) for r, _, _ in flagged} | {12173975, 12174058, 12174272})
    rows = get_all('/rest/v1/pinnacle_archive_close?select=id,event_key,label,source,start_source,start_ts,close_ts,gap_to_start_s,p1,p2,p1_name,p2_name,'
                   f'supersedes,inserted_at&event_key=in.({",".join(map(str, keys))})&order=id.asc')
    print(f'archive closes on {len(keys)} event(s): {len(rows)}')
    for x in rows:
        print('ARCHIVE', json.dumps(x, default=str))
    known = get_all(f'/rest/v1/live_flip_log?select=event_key,first_live_seen_at,last_not_live_seen_at,first_player,second_player&event_key=in.({",".join(map(str, keys))})')
    for x in known:
        print('FLIPROW', json.dumps(x, default=str))



def cmd_false_starts_ticks(keys=(12173697, 12173975, 12174058, 12174272)):
    """READ-ONLY (founder brief 2026-10-26, "False 0-0 starts", tick check). For each event: its archive closes (with
    detail), every stored raw payload for their fixtures, and every Pinnacle +30 match-winner entry (active or not) from
    3 h before the false start to 3 h after it, so the last price before the real first ball can be read off. Also the
    fixture's oddspapi_fixtures row (trueStart may have arrived since). Spends no Oddspapi units. Writes nothing."""
    ks = ','.join(map(str, keys))
    _, rows, _ = rest('GET', f'/rest/v1/{CLOSE}?select=id,event_key,fixture_id,label,start_ts,close_ts,p1,p2,raw_id,detail&event_key=in.({ks})&order=id.asc')
    for r in rows or []:
        print('CLOSE', json.dumps(r, default=str))
    fids = sorted({r['fixture_id'] for r in rows or [] if r.get('fixture_id')})
    if fids:
        q = ','.join(f'"{f}"' for f in fids)
        _, fx, _ = rest('GET', f'/rest/v1/oddspapi_fixtures?select=fixture_id,player1,player2,scheduled_start,true_start&fixture_id=in.({q})')
        for f in fx or []:
            print('FIXTURE', json.dumps(f, default=str))
    for r0 in rows or []:
        if r0['label'] != ARCHIVE_LABEL:
            continue
        start = iso_ms(r0['start_ts'])
        lo, hi = start - dt.timedelta(hours=3), start + dt.timedelta(hours=3)
        _, raws, _ = rest('GET', f'/rest/v1/{RAW}?select=id,fixture_id,source,pulled_at,books,payload_gz&fixture_id=eq.{r0["fixture_id"]}&order=id.asc')
        for raw in raws or []:
            blob = unhex(raw['payload_gz'])
            body = json.loads(gzip.decompress(blob) if blob[:2] == b'\x1f\x8b' else blob)
            ser = mw_series(body)
            n = sum(len(v) for v in ser.values())
            print('RAW', json.dumps({'event_key': r0['event_key'], 'raw_id': raw['id'], 'source': raw['source'], 'pulled_at': raw['pulled_at'],
                                     'books': raw['books'], 'entries': n, 'last': max((p['createdAt'] for v in ser.values() for p in v), default=None)}))
            for oc in ('121', '122'):
                for p in ser.get(oc) or []:
                    t = iso_ms(p['createdAt'])
                    if lo <= t <= hi:
                        print('TICK', json.dumps({'event_key': r0['event_key'], 'raw_id': raw['id'], 'oc': oc, 'ts': p['createdAt'],
                                                  'price': p.get('price'), 'active': p.get('active')}))


# founder approval 2026-10-27: Berrettini and Vacherot only (Echargui keeps 1.735 / 2.14; Wong v Zhou and WTA: no write)
FALSE_START_RECUT = {12173975: 'id1200310375989928', 12174058: 'id1200261375991570'}
FALSE_START_RECUT_MAX = 4


def recut_plan(cur, series, true_start, true_end):
    """One event's re-cut from a fresh Pinnacle +30 series: (row-or-None, report). `cur` is the event's current archive
    close (current_closes); its orientation is proven by reproducing its own close at its own cut from this series —
    if that fails, nothing is cut. The new close is the last active price at or before the gated trueStart (= the last
    price before Pinnacle suspended at the start); None when the price did not move."""
    rep = {'eventKey': cur['event_key'], 'currentId': cur['id'], 'current': [float(cur['p1']), float(cur['p2']), cur['close_ts']]}
    if true_start is None or true_end is None or true_end < true_start or (true_end - true_start).total_seconds() > 6 * 3600:
        rep['stop'] = 'trueStart missing or rejected by the gate'; return None, rep
    old, why = close_at(series, iso_ms(cur['start_ts']))
    if old is None:
        rep['stop'] = f'cannot reproduce the current close at its own cut ({why})'; return None, rep
    want = (float(cur['p1']), float(cur['p2']))
    if (old['121'][0], old['122'][0]) == want:
        p1_is_121 = True
    elif (old['122'][0], old['121'][0]) == want:
        p1_is_121 = False
    else:
        rep['stop'] = f'the fresh series does not reproduce the current close at its own cut ({old["121"][0]}/{old["122"][0]})'; return None, rep
    new, why = close_at(series, true_start)
    if new is None:
        rep['stop'] = f'no close at trueStart ({why})'; return None, rep
    a, b = (new['121'], new['122']) if p1_is_121 else (new['122'], new['121'])
    after = sorted((p for oc in ('121', '122') for p in series.get(oc) or [] if iso_ms(p['createdAt']) > iso_ms(max(a[1], b[1]))),
                   key=lambda p: p['createdAt'])
    rep.update({'trueStart': true_start.isoformat(), 'atTrueStart': [a[0], b[0], max(a[1], b[1])],
                'nextEntry': ({'ts': after[0]['createdAt'], 'active': after[0].get('active'), 'price': after[0].get('price')} if after else None),
                'activeBetweenCloseAndTrueStart': sum(1 for p in after if iso_ms(p['createdAt']) <= true_start and p.get('active'))})
    det = cur.get('detail') or {}
    if isinstance(det, str):
        det = json.loads(det)
    ev = {'event_key': cur['event_key'], 'date': str(cur['match_date']), 'p1Key': cur['p1_key'], 'p2Key': cur['p2_key'],
          'p1Name': cur.get('p1_name'), 'p2Name': cur.get('p2_name'), 'p1IsParticipant1': p1_is_121, 'cut': true_start,
          'cutSource': FALSE_START_SOURCE, 'trueStart': true_start, 'liveFlipCut': true_start, 'api': det.get('apiTennis') or {}}
    row, why = archive_close_row(ev, None, cur['fixture_id'], series)
    if row is None:
        rep['stop'] = why; return None, rep
    row['detail']['startCheck'].update({'oddspapiTrueEnd': true_end.isoformat(), 'supersededLiveFlip': {
        'start': cur['start_ts'], 'reason': 'false 0-0 start: live flag before any point was played (live_flip_log_superseded)'}})
    rep['moved'] = (row['p1'], row['p2']) != want
    return (row if rep['moved'] else None), rep


def cmd_false_starts_recut(write=False):
    """Founder brief 2026-10-27, "False 0-0 starts" item 2: re-pull Pinnacle history (free /v4/historical-odds) for the
    events in FALSE_START_RECUT and re-cut their close at Oddspapi's gated trueStart (committed fixture index). Dry-run by
    default: prints old vs new, writes nothing. --write stores the fresh payloads (append) and adds superseding close rows
    only where the price moved, at most FALSE_START_RECUT_MAX. Any stop on any event -> nothing is written at all."""
    idx = json.load(gzip.open(os.path.join(ROOT_DIR, FIXTURE_INDEX))).get('fixtures') or {}
    okey = env('ODDSPAPI_KEY')
    ks = ','.join(map(str, FALSE_START_RECUT))
    held = select_all(CLOSE, 'id,event_key,fixture_id,match_date,p1_key,p2_key,p1_name,p2_name,p1,p2,label,source,start_ts,start_source,close_ts,'
                      'dedupe_key,supersedes,detail', f'event_key=in.({ks})')
    cur = current_closes([r for r in held if not held_back(r)])
    plans, raws, reps, counts = [], [], [], {'waitS': 0, 'http429': 0}
    for ek, fid in FALSE_START_RECUT.items():
        c = cur.get(ek)
        if c is None or c.get('fixture_id') != fid:
            reps.append({'eventKey': ek, 'stop': f'no current archive close on fixture {fid}'}); continue
        fx = idx.get(fid) or {}
        body, err = hist_get(fid, okey, counts)
        if body is None:
            reps.append({'eventKey': ek, 'stop': f'history pull failed ({err})'}); continue
        gz, raw_body, sha = payload_parts(body)
        row, rep = recut_plan(c, mw_series(raw_body), iso_ms(fx.get('trueStart')), iso_ms(fx.get('trueEnd')))
        reps.append(rep)
        raws.append({'fixture_id': fid, 'source': 'oddspapi /v4/historical-odds', 'pulled_at': dt.datetime.now(dt.timezone.utc).isoformat(),
                     'books': books_of(raw_body), 'payload_gz': hexbytes(gz), 'payload_sha256': sha, 'body_bytes': len(raw_body),
                     'meta': {'eventKey': ek, 'trigger': 'false-start-recut', 'cut': fx.get('trueStart'), 'book': HIST_BOOK}})
        if row:
            plans.append(row)
    stops = [r for r in reps if r.get('stop')]
    add = plan_archive_closes(plans, held) if not stops else []
    out = {'write': write, 'events': len(FALSE_START_RECUT), 'stops': len(stops), 'moved': len(plans), 'toAdd': len(add),
           'corrections': [{'eventKey': r['event_key'], 'supersedes': r.get('supersedes'), 'new': [r['p1'], r['p2'], r['close_ts']]} for r in add],
           'events_detail': reps, 'http429': counts['http429']}
    if len(add) > FALSE_START_RECUT_MAX:
        out['refused'] = f'{len(add)} rows exceeds the approved maximum {FALSE_START_RECUT_MAX}'
    elif write and not stops:
        rid = {}
        for r in raws:
            got = insert(RAW, [r], 'fixture_id,payload_sha256')
            if not got:                                     # the same payload is already held: cite that row
                _, same, _ = rest('GET', f'/rest/v1/{RAW}?select=id&fixture_id=eq.{r["fixture_id"]}&payload_sha256=eq.{r["payload_sha256"]}')
                got = [x['id'] for x in same or []]
            rid[r['fixture_id']] = got[0] if got else None
        for r in add:
            r['raw_id'] = rid.get(r['fixture_id'])
        if any(rid.get(r['fixture_id']) is None for r in add):
            out['refused'] = 'a fresh payload could not be stored or found: no close written'
            print('### false-starts-recut', json.dumps(out, default=str)); return out
        out['rawHeld'] = sum(1 for v in rid.values() if v)
        out['closeIds'] = insert(CLOSE, add, 'dedupe_key') if add else []
    print('### false-starts-recut', json.dumps(out, default=str))
    return out

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
    elif a[0] == 'lower-closes':
        cmd_lower_closes(a[1], a[2])
    elif a[0] == 'derive':
        cmd_derive(int(a[a.index('--days') + 1]) if '--days' in a else 3, os.environ.get('PINARCH_FIXTURES', '.pinarch-fixtures.json'))
    elif a[0] == 'derive-held':
        day = lambda s: dt.datetime.fromisoformat(s).replace(tzinfo=dt.timezone.utc)
        cmd_derive_held(day(a[a.index('--from') + 1]) if '--from' in a else HELD_FROM, day(a[a.index('--to') + 1]) if '--to' in a else HELD_TO,
                        '--dry-run' in a)
    elif a[0] == 'pull':
        cmd_pull(int(a[a.index('--budget') + 1]) if '--budget' in a else 480, os.environ.get('PINARCH_FIXTURES', '.pinarch-fixtures.json'),
                 int(a[a.index('--hours') + 1]) if '--hours' in a else 6)
    elif a[0] == 'backfill':
        cmd_backfill(int(a[a.index('--budget') + 1]) if '--budget' in a else 19000, os.environ.get('PINARCH_BACKFILL_FIXTURES', '.pinarch-backfill-fixtures.json'),
                     os.environ.get('PINARCH_BACKFILL_STATE', '.pinarch-backfill-state.json'))
    elif a[0] == 'export':
        cmd_export(a[1])
    elif a[0] == 'td-feed':
        cmd_td_feed(a[1], a[2])
    elif a[0] == 'false-starts-report':
        cmd_false_starts_report(a[a.index('--since') + 1] if '--since' in a else '2026-10-24')
    elif a[0] == 'false-starts-ticks':
        cmd_false_starts_ticks()
    elif a[0] == 'false-starts-recut':
        cmd_false_starts_recut('--write' in a)
    elif a[0] == 'restore':
        cmd_restore(a[1], a[a.index('--sql-out') + 1] if '--sql-out' in a else 'restore.sql', '--apply' in a, '--compare' in a)
    else:
        print(__doc__); sys.exit(2)
