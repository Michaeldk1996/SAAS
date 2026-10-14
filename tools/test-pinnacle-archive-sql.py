#!/usr/bin/env python3
"""The Pinnacle archive migration on a REAL throwaway Postgres (founder brief 2026-10-14, item 1 guard).

Applies supabase/migrations/20261014120000_pinnacle_archive.sql twice (idempotent) to a fresh cluster with Supabase's
three API roles, then proves: service_role (the pipeline's key) can only SELECT and INSERT — UPDATE, DELETE, TRUNCATE and
an upsert are refused; the table owner is refused by the triggers; anon reads nothing; an ON CONFLICT DO NOTHING re-import
adds nothing; pinnacle_archive_guard() reports ok, and reports NOT ok once a trigger is dropped or a privilege granted
(the negative controls). No Postgres binaries on this machine → SKIP out loud (never a pass); CI runners carry them."""
import glob, os, shutil, subprocess, sys, tempfile, json, pwd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pinarch_pg import PG, MIG
pg = PG()
if not pg.available():
    print(f'SKIP  test-pinnacle-archive-sql: {pg.why} — NOT A PASS (the code gate runs it)'); sys.exit(0)
q, PSQL, tmp, port = pg.q, pg.psql, pg.tmp, pg.port
passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('  PASS ', name)
    else: failed += 1; print('  FAIL ', name, '\n       ', detail[-300:])
try:
    pg.roles()
    for i in (1, 2):
        p = subprocess.run([PSQL, '-h', tmp, '-p', port, '-U', 'postgres', '-d', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1', '-f', MIG], capture_output=True, text=True)
        check(f'migration applies (pass {i}: idempotent)', p.returncode == 0, p.stderr)
    RAW = "insert into public.oddspapi_archive_raw (fixture_id, source, payload_gz, payload_sha256, body_bytes) values ('f1','t','\\x1f8b','h1',2)"
    CLOSE = "insert into public.pinnacle_archive_close (dedupe_key,p1,p2,book,label,source) values ('k1',1.5,2.5,'Pinnacle +30s','captured','t')"
    check('service_role can insert a raw row', q(RAW, 'service_role')[0] == 0)
    check('service_role can insert a close row', q(CLOSE, 'service_role')[0] == 0)
    rc, out = q(CLOSE + ' on conflict do nothing returning id', 'service_role')
    check('a re-import (ON CONFLICT DO NOTHING) adds nothing', rc == 0 and out == '', out)
    check('service_role can insert a count row', q("insert into public.pinnacle_archive_count (job, raw_rows, close_rows) values ('t', 1, 1)", 'service_role')[0] == 0)
    for t in ('oddspapi_archive_raw', 'pinnacle_archive_close', 'pinnacle_archive_count'):
        col = 'at' if t == 'pinnacle_archive_count' else 'inserted_at'   # every table holds a row, so each row trigger fires
        for verb, sql in (('UPDATE', f'update public.{t} set {col} = {col}'), ('DELETE', f'delete from public.{t}'), ('TRUNCATE', f'truncate public.{t} cascade')):
            rc, out = q(sql, 'service_role'); check(f'service_role {verb} {t} refused', rc != 0 and 'permission denied' in out, out)
            rc, out = q(sql); check(f'owner {verb} {t} refused by the trigger', rc != 0 and 'append-only' in out, out)
    rc, out = q(CLOSE.replace("1.5", "1.6") + " on conflict (dedupe_key) do update set p1 = excluded.p1", 'service_role')
    check('service_role upsert (ON CONFLICT DO UPDATE) refused', rc != 0, out)
    rc, out = q('select count(*) from public.pinnacle_archive_close', 'anon'); check('anon reads nothing', rc != 0, out)
    rc, out = q('select count(*) from public.pinnacle_archive_close', 'authenticated'); check('authenticated reads nothing', rc != 0, out)
    rc, out = q("select public.pinnacle_archive_guard()", 'anon')
    g = json.loads(out) if rc == 0 else {}
    check('guard callable with the publishable (anon) role and reports ok', g.get('ok') is True and g['pinnacle_archive_close']['rows'] == 1, out)
    # negative controls: the guard must notice a weakened archive
    q('drop trigger pinnacle_archive_close_no_change on public.pinnacle_archive_close')
    rc, out = q("select public.pinnacle_archive_guard()->>'ok'"); check('control: a dropped trigger → guard NOT ok', out == 'false', out)
    q('create trigger pinnacle_archive_close_no_change before update or delete on public.pinnacle_archive_close for each row execute function public.pinnacle_archive_forbid()')
    q('grant update on public.oddspapi_archive_raw to service_role')
    rc, out = q("select public.pinnacle_archive_guard()->>'ok'"); check('control: UPDATE granted to service_role → guard NOT ok', out == 'false', out)
    q('revoke update on public.oddspapi_archive_raw from service_role')
    rc, out = q("select public.pinnacle_archive_guard()->>'ok'"); check('restored → guard ok again', out == 'true', out)
finally:
    pg.close()
print(f'\ntest-pinnacle-archive-sql: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
