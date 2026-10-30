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
MIG3 = os.path.join(os.path.dirname(MIG), '20261016150000_historical_snapshot.sql')
MIG4 = os.path.join(os.path.dirname(MIG), '20261017090000_historical_snapshot_start10.sql')
MIG5 = os.path.join(os.path.dirname(MIG), '20261019090000_historical_snapshot_bet365.sql')
MIG6 = os.path.join(os.path.dirname(MIG), '20261020090000_historical_snapshot_te.sql')
MIG7 = os.path.join(os.path.dirname(MIG), '20261030090000_historical_snapshot_te_bet365.sql')
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
    # ── Pinnacle (approx.) snapshots (founder ruling 2026-10-16): their own table, same protections ──
    for i in (1, 2):
        rc, err = pg.file(MIG3); check(f'snapshot migration applies (pass {i}: idempotent)', rc == 0, err)
    S = ("insert into public.historical_snapshot (dedupe_key,source,label,match_date,tournament,winner,loser,event_key,price_winner,price_loser,fetched_at) "
         "values ('s1','api-tennis Pinnacle','Pinnacle (approx.)','2026-02-03','Dallas','A.','B.',1,1.5,2.6,now())")
    check('service_role can store a snapshot', q(S, 'service_role')[0] == 0)
    rc, out = q(S + ' on conflict do nothing returning id', 'service_role'); check('a re-import adds no snapshot', rc == 0 and out == '', out)
    rc, out = q(S.replace("'s1'", "'s2'").replace("'Pinnacle (approx.)'", "'from Pinnacle history'"), 'service_role')
    check('a snapshot can never carry a close label', rc != 0, out)
    rc, out = q(S.replace("'s1'", "'s3'").replace("'api-tennis Pinnacle'", "'tennis-data Pinnacle'"), 'service_role')
    check('a snapshot can never carry a close source', rc != 0, out)
    rc, out = q(S.replace("'s1'", "'s4'").replace('1.5,2.6', '0,2.6'), 'service_role'); check('a zero snapshot price is refused', rc != 0, out)
    check('service_role can store a snapshot count', q("insert into public.historical_snapshot_count (job,snapshot_rows) values ('t',1)", 'service_role')[0] == 0)
    for t in ('historical_snapshot', 'historical_snapshot_count'):
        col = 'at' if t.endswith('_count') else 'inserted_at'
        for verb, sql in (('UPDATE', f'update public.{t} set {col} = {col}'), ('DELETE', f'delete from public.{t}'), ('TRUNCATE', f'truncate public.{t} cascade')):
            rc, out = q(sql, 'service_role'); check(f'service_role {verb} {t} refused', rc != 0 and 'permission denied' in out, out)
            rc, out = q(sql); check(f'owner {verb} {t} refused by the trigger', rc != 0 and 'append-only' in out, out)
        for role in ('anon', 'authenticated'):
            rc, out = q(f'select count(*) from public.{t}', role); check(f'{role} reads nothing from {t}', rc != 0, out)
    rc, out = q('select public.historical_snapshot_guard()', 'anon')
    g = json.loads(out) if rc == 0 else {}
    check('snapshot guard callable with the anon role, ok, counts', g.get('ok') is True and g['historical_snapshot']['rows'] == 1 and g['maxRecorded']['snapshot'] == 1, out)
    q('drop trigger historical_snapshot_no_truncate on public.historical_snapshot')
    rc, out = q("select public.historical_snapshot_guard()->>'ok'"); check('control: a dropped snapshot trigger → guard NOT ok', out == 'false', out)
    q('create trigger historical_snapshot_no_truncate before truncate on public.historical_snapshot for each statement execute function public.historical_archive_forbid()')
    q('grant update on public.historical_snapshot to service_role')
    rc, out = q("select public.historical_snapshot_guard()->>'ok'"); check('control: UPDATE granted on snapshots → guard NOT ok', out == 'false', out)
    q('revoke update on public.historical_snapshot from service_role')
    rc, out = q("select public.historical_snapshot_guard()->>'ok'"); check('restored → snapshot guard ok again', out == 'true', out)
    rc, out = q("select public.historical_archive_guard()->>'ok'"); check('the historical archive guard is unaffected', out == 'true', out)
    # ── Pinnacle (approx.) at Oddspapi's start − 10 (founder ruling 2026-10-17): a second SNAPSHOT source, with its times ──
    for i in (1, 2):
        rc, err = pg.file(MIG4); check(f'start − 10 migration applies (pass {i}: idempotent)', rc == 0, err)
    check('an api-tennis snapshot stored before the migration is still there', q('select count(*) from public.historical_snapshot')[1] == '1')
    T10 = ("insert into public.historical_snapshot (dedupe_key,source,label,match_date,tournament,winner,loser,event_key,price_winner,price_loser,fetched_at,"
           "cut_ts,price_ts,start_ts,start_source,gap_to_start_s,fixture_id,raw_id) values ('t1','oddspapi Pinnacle (start − 10)','Pinnacle (approx.)',"
           "'2026-07-20','Kitzbuhel','A.','B.',2,1.5,2.6,now(),'2026-07-20 09:50Z','2026-07-20 09:41Z','2026-07-20 10:00Z','oddspapi trueStart',1140,'id1',7)")
    check('service_role can store a start − 10 snapshot with its times', q(T10, 'service_role')[0] == 0)
    rc, out = q(T10.replace("'t1'", "'t2'").replace(",'2026-07-20 09:50Z'", ",null"), 'service_role')
    check('a start − 10 snapshot without its cut is refused', rc != 0, out)
    rc, out = q(T10.replace("'t1'", "'t3'").replace("'2026-07-20 09:41Z'", "'2026-07-20 09:55Z'"), 'service_role')
    check('a start − 10 snapshot priced after its cut is refused', rc != 0, out)
    rc, out = q(T10.replace("'t1'", "'t4'").replace("'Pinnacle (approx.)'", "'from Pinnacle history'"), 'service_role')
    check('a start − 10 snapshot can never carry a close label', rc != 0, out)
    rc, out = q(T10.replace("'t1'", "'t5'").replace("'oddspapi Pinnacle (start − 10)'", "'api-tennis Pinnacle'"), 'service_role')
    check('control: an api-tennis snapshot claiming times is refused', rc != 0, out)
    rc, out = q(T10.replace("'t1'", "'t6'").replace("'oddspapi Pinnacle (start − 10)'", "'oddspapi Pinnacle'"), 'service_role')
    check('control: an unknown snapshot source is refused', rc != 0, out)
    rc, out = q(S.replace("'s1'", "'s9'"), 'service_role'); check('an api-tennis snapshot with no times is still accepted', rc == 0, out)
    rc, out = q('update public.historical_snapshot set cut_ts = cut_ts', 'service_role'); check('service_role UPDATE still refused', rc != 0 and 'permission denied' in out, out)
    rc, out = q("select public.historical_snapshot_guard()->>'ok'"); check('snapshot guard ok after the migration', out == 'true', out)
    # ── api-tennis's stored Bet365 as a third SNAPSHOT source (founder brief 2026-10-19 item 3), its own label ──
    for i in (1, 2):
        rc, err = pg.file(MIG5); check(f'Bet365 snapshot migration applies (pass {i}: idempotent)', rc == 0, err)
    n0 = q('select count(*) from public.historical_snapshot')[1]
    B5 = ("insert into public.historical_snapshot (dedupe_key,source,label,match_date,tournament,winner,loser,event_key,price_winner,price_loser,fetched_at) "
          "values ('b1','api-tennis Bet365','Bet365 (approx.)','2025-03-02','Davis Cup','A.','B.',9,1.5,2.6,now())")
    check('service_role can store an api-tennis Bet365 snapshot', q(B5, 'service_role')[0] == 0)
    rc, out = q(B5.replace("'b1'", "'b2'").replace("'Bet365 (approx.)'", "'Pinnacle (approx.)'"), 'service_role')
    check('a Bet365 snapshot can never carry the Pinnacle label', rc != 0, out)
    rc, out = q(B5.replace("'b1'", "'b3'").replace("'Bet365 (approx.)'", "'from Pinnacle history'"), 'service_role')
    check('a Bet365 snapshot can never carry a close label', rc != 0, out)
    rc, out = q(S.replace("'s1'", "'s10'").replace("'Pinnacle (approx.)'", "'Bet365 (approx.)'"), 'service_role')
    check('control: a Pinnacle snapshot can never carry the Bet365 label', rc != 0, out)
    rc, out = q(T10.replace("'t1'", "'t9'").replace("'oddspapi Pinnacle (start − 10)','Pinnacle (approx.)'", "'api-tennis Bet365','Bet365 (approx.)'"), 'service_role')
    check('control: a Bet365 snapshot claiming times is refused', rc != 0, out)
    rc, out = q(T10.replace("'t1'", "'t10'"), 'service_role'); check('a start − 10 snapshot is still accepted', rc == 0, out)
    rc, out = q(S.replace("'s1'", "'s11'"), 'service_role'); check('an api-tennis Pinnacle snapshot is still accepted', rc == 0, out)
    check('no stored snapshot lost by the migration', int(q('select count(*) from public.historical_snapshot')[1]) == int(n0) + 3)
    rc, out = q('delete from public.historical_snapshot', 'service_role'); check('service_role DELETE still refused', rc != 0, out)
    rc, out = q("select public.historical_snapshot_guard()->>'ok'"); check('snapshot guard ok after the Bet365 migration', out == 'true', out)
    # ── Tennis Explorer's Pinnacle price as a fourth SNAPSHOT source (founder 2026-10-19, steps 0-3), never a close ──
    for i in (1, 2):
        rc, err = pg.file(MIG6); check(f'Tennis Explorer snapshot migration applies (pass {i}: idempotent)', rc == 0, err)
    n1 = q('select count(*) from public.historical_snapshot')[1]
    SHA = 'a' * 64
    def te(key, label='Pinnacle (approx.)', price_ts="'2026-09-28 13:55Z'", detail=None, extra=''):
        d = json.dumps(detail if detail is not None else {'teMatchId': '3338923', 'pageSha256': SHA})
        cols, vals = ('start_ts', ",'2026-09-28 14:05Z'") if extra == 'start' else ('', '')
        return ("insert into public.historical_snapshot (dedupe_key,source,label,match_date,tournament,winner,loser,event_key,price_winner,price_loser,fetched_at,price_ts,detail"
                + (',' + cols if cols else '') + f") values ('{key}','Tennis Explorer · Pinnacle','{label}','2026-09-28','Porto challenger','A.','B.',11,1.5,2.6,"
                + f"'2026-10-20 03:00Z',{price_ts},'{d}'{vals})")
    check('service_role can store a Tennis Explorer snapshot', q(te('e1'), 'service_role')[0] == 0)
    rc, out = q(te('e2', price_ts='null'), 'service_role')
    check('a Tennis Explorer snapshot with no change time (the price never moved) is accepted', rc == 0, out)
    rc, out = q(te('e3', label='from Pinnacle history'), 'service_role'); check('a Tennis Explorer snapshot can never carry a close label', rc != 0, out)
    rc, out = q(te('e4', label='Bet365 (approx.)'), 'service_role'); check('a Tennis Explorer snapshot can never carry the Bet365 label', rc != 0, out)
    rc, out = q(te('e5', detail={'teMatchId': '3338923', 'pageSha256': 'x'}), 'service_role'); check('a Tennis Explorer snapshot must name its page sha256', rc != 0, out)
    rc, out = q(te('e6', detail={'pageSha256': SHA}), 'service_role'); check('a Tennis Explorer snapshot must name its TE match', rc != 0, out)
    rc, out = q(te('e7', price_ts="'2026-10-21 00:00Z'"), 'service_role'); check('a Tennis Explorer change time after the page was read is refused', rc != 0, out)
    rc, out = q(te('e8', extra='start'), 'service_role'); check('a Tennis Explorer snapshot claiming a start is refused', rc != 0, out)
    rc, out = q(B5.replace("'b1'", "'b9'").replace("'api-tennis Bet365','Bet365 (approx.)'", "'Tennis Explorer · Pinnacle','Pinnacle (approx.)'"), 'service_role')
    check('control: a Tennis Explorer snapshot naming no page is refused', rc != 0, out)
    rc, out = q(T10.replace("'t1'", "'t11'"), 'service_role'); check('a start − 10 snapshot is still accepted', rc == 0, out)
    rc, out = q(B5.replace("'b1'", "'b10'"), 'service_role'); check('an api-tennis Bet365 snapshot is still accepted', rc == 0, out)
    check('no stored snapshot lost by the TE migration', int(q('select count(*) from public.historical_snapshot')[1]) == int(n1) + 4)
    rc, out = q("update public.historical_snapshot set price_ts = null where source = 'Tennis Explorer · Pinnacle'", 'service_role')
    check('service_role UPDATE of a TE row refused', rc != 0, out)
    rc, out = q("delete from public.historical_snapshot where source = 'Tennis Explorer · Pinnacle'", 'service_role')
    check('service_role DELETE of a TE row refused', rc != 0, out)
    rc, out = q("select public.historical_snapshot_guard()->>'ok'"); check('snapshot guard ok after the TE migration', out == 'true', out)
    # ── Tennis Explorer's Bet365 price as a fifth SNAPSHOT source (founder 2026-10-30), 'Bet365 (approx.)', never a time ──
    n2 = q('select count(*) from public.historical_snapshot')[1]
    for i in (1, 2):
        rc, err = pg.file(MIG7); check(f'Tennis Explorer Bet365 migration applies (pass {i}: idempotent)', rc == 0, err)
    tb = lambda key, label='Bet365 (approx.)', price_ts='null', detail=None, extra='': te(key, label, price_ts, detail, extra).replace(
        "'Tennis Explorer · Pinnacle'", "'Tennis Explorer · Bet365'")
    check('service_role can store a Tennis Explorer Bet365 snapshot', q(tb('tb1'), 'service_role')[0] == 0)
    rc, out = q(tb('tb2', label='Pinnacle (approx.)'), 'service_role'); check('a Tennis Explorer Bet365 snapshot can never carry the Pinnacle label', rc != 0, out)
    rc, out = q(tb('tb3', label='from Pinnacle history'), 'service_role'); check('a Tennis Explorer Bet365 snapshot can never carry a close label', rc != 0, out)
    rc, out = q(tb('tb4', price_ts="'2026-09-28 13:55Z'"), 'service_role'); check('a Tennis Explorer Bet365 snapshot may carry its change time', rc == 0, out)
    rc, out = q(tb('tb9', price_ts="'2026-10-21 00:00Z'"), 'service_role'); check('a Tennis Explorer Bet365 change time after the page was read is refused', rc != 0, out)
    rc, out = q(tb('tb5', detail={'teMatchId': '3338923', 'pageSha256': 'x'}), 'service_role'); check('a Tennis Explorer Bet365 snapshot must name its page sha256', rc != 0, out)
    rc, out = q(tb('tb6', detail={'pageSha256': SHA}), 'service_role'); check('a Tennis Explorer Bet365 snapshot must name its TE match', rc != 0, out)
    rc, out = q(tb('tb7', extra='start'), 'service_role'); check('a Tennis Explorer Bet365 snapshot claiming a start is refused', rc != 0, out)
    rc, out = q(te('tb8'), 'service_role'); check('a Tennis Explorer Pinnacle snapshot is still accepted', rc == 0, out)
    rc, out = q(B5.replace("'b1'", "'b11'"), 'service_role'); check('an api-tennis Bet365 snapshot is still accepted', rc == 0, out)
    rc, out = q(B5.replace("'b1'", "'b12'").replace("'Bet365 (approx.)'", "'Pinnacle (approx.)'"), 'service_role')
    check('control: an api-tennis Bet365 snapshot still cannot carry the Pinnacle label', rc != 0, out)
    check('no stored snapshot lost by the TE Bet365 migration', int(q('select count(*) from public.historical_snapshot')[1]) == int(n2) + 4)
    rc, out = q("delete from public.historical_snapshot where source = 'Tennis Explorer · Bet365'", 'service_role')
    check('service_role DELETE of a TE Bet365 row refused', rc != 0, out)
    rc, out = q("select public.historical_snapshot_guard()->>'ok'"); check('snapshot guard ok after the TE Bet365 migration', out == 'true', out)
finally:
    pg.close()
print(f'\ntest-historical-archive-sql: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
