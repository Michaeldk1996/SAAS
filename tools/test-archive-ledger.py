#!/usr/bin/env python3
"""The archive migration ledger (founder 2026-10-20, item 9) on a REAL throwaway Postgres: tools/archive_install.py applies
each migration once and records it in the same transaction; a re-install runs nothing old (so an earlier CHECK set no longer
fails on a later source's rows — the case PR #63 tolerated); an edited applied file stops the install; a failed new file
records nothing; an archive installed before the ledger is recorded at bootstrap, not re-run; the ledger is append-only.
Controls: re-running the old files directly fails (23514) — the ledger is what avoids it. No Postgres → SKIP out loud."""
import json, os, shutil, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pinarch_pg import PG, MIG
import archive_install as A
D = os.path.dirname(MIG)
MIGS = [os.path.join(D, f) for f in ('20261016090000_historical_odds_archive.sql', '20261016150000_historical_snapshot.sql',
        '20261017090000_historical_snapshot_start10.sql', '20261019090000_historical_snapshot_bet365.sql', '20261020090000_historical_snapshot_te.sql')]
passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('  PASS ', name)
    else: failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-400:])
def runner(pg, db):
    def run(sql, select=False):
        rc, out = pg.q(f"select coalesce(json_agg(t), '[]'::json) from ({sql}) t" if select else sql, db=db)
        return rc == 0, (json.loads(out or '[]') if select and rc == 0 else out)
    return run
def ledger(pg, db):
    rc, out = pg.q('select name, how from public.archive_migrations order by name', db=db); return out.splitlines() if rc == 0 else out
B365 = ("insert into public.historical_snapshot (dedupe_key,source,label,match_date,tournament,winner,loser,event_key,price_winner,price_loser,fetched_at) "
        "values ('b1','api-tennis Bet365','Bet365 (approx.)','2024-05-01','X','A.','B.',1,1.5,2.6,now())")
pg = PG()
if not pg.available():
    print(f'SKIP  test-archive-ledger: {pg.why} — NOT A PASS (the code gate runs it)'); sys.exit(0)
tmp = tempfile.mkdtemp()
try:
    for db in ('fresh', 'old'):
        pg.q(f'create database {db}'); pg.roles(db=db); pg.file(MIG, db=db)
    # 1. a fresh archive: every file applied once and recorded
    run = runner(pg, 'fresh'); log = []
    r = A.install(MIGS, run, log.append)
    check('fresh: the five migrations applied and recorded', r == {'bootstrap': 0, 'applied': 5, 'skipped': 0} and len(ledger(pg, 'fresh')) == 5, (r, ledger(pg, 'fresh'), log))
    check('fresh: the source CHECK names Tennis Explorer · Pinnacle', A.installed(run))
    pg.q(B365, db='fresh')
    # 2. a re-install after a later source's rows exist: nothing old runs, nothing fails
    r = A.install(MIGS, run, log.append)
    check('re-install with api-tennis Bet365 rows present: every file skipped, no 23514', r == {'bootstrap': 0, 'applied': 0, 'skipped': 5}, r)
    rc, out = pg.file(MIGS[2], db='fresh')
    check('control: running the start - 10 file directly again fails on those rows (23514) — the ledger is what avoids it', rc != 0 and 'violated' in out, out)
    # 3. an applied file edited -> stop
    ed = os.path.join(tmp, os.path.basename(MIGS[2])); shutil.copy(MIGS[2], ed); open(ed, 'a').write('\n-- an edit\n')
    try:
        A.install(MIGS[:2] + [ed] + MIGS[3:], run, log.append); check('an edited applied file stops the install', False)
    except SystemExit as e:
        check('an edited applied file stops the install ("add a new migration instead")', 'add a new migration instead' in str(e), e)
    # 4. a new file: applied once; a failing new file records nothing
    new = os.path.join(tmp, '20261021000000_x.sql'); open(new, 'w').write('create table if not exists public.x_new (id int);\n-- trailing comment')
    r = A.install(MIGS + [new], run, log.append)
    check('a new file is applied and recorded once (a trailing comment line is fine)', r['applied'] == 1 and r['skipped'] == 5 and len(ledger(pg, 'fresh')) == 6, (r, ledger(pg, 'fresh')))
    bad = os.path.join(tmp, '20261022000000_bad.sql'); open(bad, 'w').write('create table public.y_new (id int); select 1/0;')
    try:
        A.install(MIGS + [new, bad], run, log.append); check('a failing new file stops the install', False)
    except SystemExit:
        rc, out = pg.q("select to_regclass('public.y_new') is null", db='fresh')
        check('a failing new file: nothing recorded and its own statements rolled back', len(ledger(pg, 'fresh')) == 6 and out == 't', (ledger(pg, 'fresh'), out))
    # 5. an archive installed before the ledger existed (production today): recorded at bootstrap, never re-run
    for m in MIGS: pg.file(m, db='old')
    pg.q(B365, db='old')
    run2 = runner(pg, 'old'); log2 = []
    r = A.install(MIGS, run2, log2.append)
    check('bootstrap: an installed archive with no ledger -> the five recorded, none re-run', r == {'bootstrap': 5, 'applied': 0, 'skipped': 0}
          and all(l.endswith('|recorded at bootstrap') for l in ledger(pg, 'old')), (r, ledger(pg, 'old'), log2))
    r = A.install(MIGS, run2, log2.append)
    check('after bootstrap: a re-install skips all five', r == {'bootstrap': 0, 'applied': 0, 'skipped': 5}, r)
    pg.q('create database partial'); pg.roles(db='partial'); pg.file(MIG, db='partial')
    for m in MIGS[:3]: pg.file(m, db='partial')
    try:
        r = A.install(MIGS, runner(pg, 'partial'), log2.append)
        check('control: a half-installed archive (no TE source yet) is NOT bootstrapped — the files run, and the start - 10 file applies again cleanly', r['bootstrap'] == 0 and r['applied'] == 5, r)
    except SystemExit as e:
        check('control: a half-installed archive is not bootstrapped', False, e)
    # 6. append-only
    for verb, sql in (('UPDATE', "update public.archive_migrations set how = how"), ('DELETE', 'delete from public.archive_migrations'), ('TRUNCATE', 'truncate public.archive_migrations')):
        rc, out = pg.q(sql, 'service_role', db='fresh'); check(f'service_role {verb} refused', rc != 0 and 'permission denied' in out, out)
        rc, out = pg.q(sql, db='fresh'); check(f'owner {verb} refused by the trigger', rc != 0 and 'append-only' in out, out)
    for role in ('anon', 'authenticated'):
        rc, out = pg.q('select count(*) from public.archive_migrations', role, db='fresh'); check(f'{role} reads nothing', rc != 0, out)
finally:
    pg.close(); shutil.rmtree(tmp, ignore_errors=True)
print(f'\ntest-archive-ledger: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
