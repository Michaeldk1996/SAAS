#!/usr/bin/env python3
"""The historical odds archive migration on a REAL throwaway Postgres (founder brief 2026-10-16, items 1-2).

Applies supabase/migrations/20261016090000_historical_odds_archive.sql twice (idempotent) on top of the Pinnacle
archive migration, then proves the same protections: service_role may only SELECT and INSERT (UPDATE, DELETE,
TRUNCATE and an upsert refused), the owner is refused by the triggers, anon and authenticated read nothing, a re-import
adds nothing, a close must name a stored file, historical_archive_guard() reports ok and NOT ok once a trigger is
dropped or a privilege granted (negative controls), and the Pinnacle archive's own guard is unchanged.
No Postgres binaries → SKIP out loud (never a pass)."""
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pinarch_pg import PG, MIG
MIG2 = os.path.join(os.path.dirname(MIG), '20261016090000_historical_odds_archive.sql')
pg = PG()
if not pg.available():
    print(f'SKIP  test-historical-archive-sql: {pg.why} — NOT A PASS (the code gate runs it)'); sys.exit(0)
q = pg.q
passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('  PASS ', name)
    else: failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-300:])
T = ('historical_odds_file', 'historical_close', 'historical_odds_export', 'historical_archive_count')
try:
    pg.roles()
    rc, err = pg.file(MIG); check('the Pinnacle archive migration applies first', rc == 0, err)
    for i in (1, 2):
        rc, err = pg.file(MIG2); check(f'migration applies (pass {i}: idempotent)', rc == 0, err)
    F = "insert into public.historical_odds_file (sha256,name,source,kind,bytes,content_gz) values ('s1','2026.csv','repo odds-archive','normalized csv',3,'\\x1f8b')"
    C = ("insert into public.historical_close (dedupe_key,source,book,match_date,tournament,winner,loser,price_winner,price_loser,file_sha256) "
         "values ('k1','tennis-data Pinnacle','Pinnacle','2026-01-05','Brisbane','A.','B.',1.5,2.6,'s1')")
    check('service_role can store a file', q(F, 'service_role')[0] == 0)
    check('service_role can store a close', q(C, 'service_role')[0] == 0)
    rc, out = q(C + ' on conflict do nothing returning id', 'service_role'); check('a re-import adds nothing', rc == 0 and out == '', out)
    rc, out = q(C.replace("'k1'", "'k2'").replace("'s1')", "'nope')"), 'service_role'); check('a close naming no stored file is refused', rc != 0, out)
    rc, out = q(C.replace("'k1'", "'k3'").replace('1.5,2.6', '0,2.6'), 'service_role'); check('a zero price is refused', rc != 0, out)
    check('service_role can store an export row', q("insert into public.historical_odds_export (name,sha256,rows,location) values ('e.csv','h',1,'ops')", 'service_role')[0] == 0)
    check('service_role can store a count row', q("insert into public.historical_archive_count (job,file_rows,close_rows,export_rows) values ('t',1,1,1)", 'service_role')[0] == 0)
    for t in T:
        col = 'at' if t == 'historical_archive_count' else 'inserted_at'
        for verb, sql in (('UPDATE', f'update public.{t} set {col} = {col}'), ('DELETE', f'delete from public.{t}'), ('TRUNCATE', f'truncate public.{t} cascade')):
            rc, out = q(sql, 'service_role'); check(f'service_role {verb} {t} refused', rc != 0 and 'permission denied' in out, out)
            rc, out = q(sql); check(f'owner {verb} {t} refused by the trigger', rc != 0 and 'append-only' in out, out)
    rc, out = q(C.replace('1.5', '1.6') + ' on conflict (dedupe_key) do update set price_winner = excluded.price_winner', 'service_role')
    check('service_role upsert refused', rc != 0, out)
    for role in ('anon', 'authenticated'):
        rc, out = q('select count(*) from public.historical_close', role); check(f'{role} reads nothing', rc != 0, out)
        rc, out = q('select count(*) from public.historical_odds_file', role); check(f'{role} reads no file', rc != 0, out)
    rc, out = q('select public.historical_archive_guard()', 'anon')
    g = json.loads(out) if rc == 0 else {}
    check('guard callable with the publishable (anon) role and reports ok', g.get('ok') is True and g['historical_close']['rows'] == 1, out)
    q('drop trigger historical_close_no_change on public.historical_close')
    rc, out = q("select public.historical_archive_guard()->>'ok'"); check('control: a dropped trigger → guard NOT ok', out == 'false', out)
    q('create trigger historical_close_no_change before update or delete on public.historical_close for each row execute function public.historical_archive_forbid()')
    q('grant delete on public.historical_odds_file to service_role')
    rc, out = q("select public.historical_archive_guard()->>'ok'"); check('control: DELETE granted to service_role → guard NOT ok', out == 'false', out)
    q('revoke delete on public.historical_odds_file from service_role')
    rc, out = q("select public.historical_archive_guard()->>'ok'"); check('restored → guard ok again', out == 'true', out)
    rc, out = q("select public.pinnacle_archive_guard()->>'ok'"); check('the Pinnacle archive guard is unaffected', out == 'true', out)
finally:
    pg.close()
print(f'\ntest-historical-archive-sql: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
