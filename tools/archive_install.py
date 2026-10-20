#!/usr/bin/env python3
"""The historical-archive install, once per migration (founder 2026-10-20, item 9; replaces PR #63's tolerance).

  python3 tools/archive_install.py MIG [MIG …]          (env SUPABASE_URL + SUPABASE_ACCESS_TOKEN: the Management API)

1. applies the ledger migration (idempotent) and reads public.archive_migrations;
2. bootstrap, once: an EMPTY ledger on an archive that is already installed (every listed migration's tables present and
   the snapshot source CHECK naming every source the last migration adds) records the listed files as applied without
   running them — they are; running them again is what failed (23514) — and says so per file;
3. every listed file: recorded with the same sha256 -> skipped; recorded with another sha256 -> STOP ("edited after it was
   applied: add a new migration instead"); not recorded -> its SQL and the ledger INSERT run as ONE query (one transaction:
   either both land or neither).
The SQL runner is pluggable (`run(sql, select=False) -> (ok, body | rows)`), so tools/test-archive-ledger.py drives a real throwaway Postgres."""
import hashlib, json, os, re, subprocess, sys, urllib.request

LEDGER = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'supabase', 'migrations',
                      '20261020120000_archive_migration_ledger.sql')
TE_SOURCE = 'Tennis Explorer · Pinnacle'


def sha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


def lit(s):
    return "'" + str(s).replace("'", "''") + "'"


def api_runner():
    ref = re.sub(r'https://([a-z0-9]+)\.supabase\.co.*', r'\1', os.environ['SUPABASE_URL'])
    tok = os.environ['SUPABASE_ACCESS_TOKEN']
    def run(sql, select=False):
        req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{ref}/database/query', data=json.dumps({'query': sql}).encode(),
                                     headers={'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json'}, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                body = r.read().decode()
                return True, (json.loads(body or '[]') if select else body)
        except urllib.error.HTTPError as e:
            return False, e.read().decode()[:2000]
    return run


def rows(run, sql):
    ok, body = run(sql, True)
    if not ok:
        raise SystemExit(f'::error::{str(body)[:600]}')
    return body if isinstance(body, list) else []


def installed(run):
    """The archive is already installed when the snapshot table exists and its source CHECK names Tennis Explorer · Pinnacle
    (the last migration's source) — every listed migration has then run at least once."""
    got = rows(run, "select coalesce((select pg_get_constraintdef(oid) from pg_constraint where conname = 'historical_snapshot_source_check'), '') as def")
    return bool(got) and TE_SOURCE in (got[0].get('def') or '')


def install(migs, run, log=print):
    ok, body = run(open(LEDGER).read())
    if not ok:
        raise SystemExit(f'::error::the ledger migration failed: {body[:600]}')
    held = {r['name']: r['sha256'] for r in rows(run, 'select name, sha256 from public.archive_migrations')}
    files = [(os.path.basename(m), m, sha(m)) for m in migs]
    if not held and installed(run):
        vals = ','.join(f"({lit(n)}, {lit(h)}, 'recorded at bootstrap')" for n, _, h in files)
        ok, body = run(f'insert into public.archive_migrations (name, sha256, how) values {vals}')
        if not ok:
            raise SystemExit(f'::error::bootstrap failed: {body[:600]}')
        for n, _, h in files:
            log(f'{n}: recorded at bootstrap (already installed; not run again) sha256 {h[:12]}')
        return {'bootstrap': len(files), 'applied': 0, 'skipped': 0}
    out = {'bootstrap': 0, 'applied': 0, 'skipped': 0}
    for n, path, h in files:
        if n in held:
            if held[n] != h:
                raise SystemExit(f'::error::{n} was edited after it was applied (ledger {held[n][:12]}, file {h[:12]}): add a new migration instead')
            log(f'{n}: already applied — skipped'); out['skipped'] += 1; continue
        # a newline before the ';' ends a trailing comment line; one query string = one transaction (no file holds BEGIN / COMMIT)
        ok, body = run(open(path).read() + f"\n;\ninsert into public.archive_migrations (name, sha256) values ({lit(n)}, {lit(h)});")
        if not ok:
            raise SystemExit(f'::error::{n} failed (nothing recorded, its transaction rolled back): {body[:600]}')
        log(f'{n}: applied and recorded sha256 {h[:12]}'); out['applied'] += 1
    return out


if __name__ == '__main__':
    r = install(sys.argv[1:], api_runner())
    print('### archive-install', json.dumps(r))
