#!/usr/bin/env python3
"""The model value ledger migration on a REAL throwaway Postgres (founder brief 2026-11-01: "a test that fails if any code
path updates or deletes a row").

Applies supabase/migrations/20261101090000_model_value_ledger.sql twice (idempotent) to a fresh cluster with Supabase's
three API roles, then proves: service_role can only SELECT and INSERT — UPDATE, DELETE, TRUNCATE and an upsert-update are
refused on all three tables; the table owner is refused by the triggers; anon reads nothing; ON CONFLICT DO NOTHING adds
nothing; one mark per (match, side, kind); a settlement correction is a NEW row naming what it supersedes;
value_ledger_guard() reports ok, and NOT ok once a trigger is dropped or a privilege granted (the negative controls).
No Postgres binaries on this machine → SKIP out loud (never a pass); CI runners carry them."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pinarch_pg import PG
MIG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'supabase', 'migrations', '20261101090000_model_value_ledger.sql')
pg = PG()
if not pg.available():
    print(f'SKIP  test-value-ledger-sql: {pg.why} — NOT A PASS (the code gate runs it)'); sys.exit(0)
q = pg.q
passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('  PASS ', name)
    else: failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-300:])
try:
    pg.roles()
    for i in (1, 2):
        rc, err = pg.file(MIG)
        check(f'migration applies (pass {i}: idempotent)', rc == 0, err)
    SNAP = ("insert into public.value_ledger_snapshot (run_id, snapshot_ts, event_key, side, model_prob, price_kind, shown_on_page, b105_status, b105_price, edge_b105) "
            "values ('r1', now(), 100, 'p1', 0.6, 'full', true, 'ok', 1.9, 0.14)")
    check('service_role can insert a snapshot', q(SNAP, 'service_role')[0] == 0)
    rc, out = q(SNAP + ' on conflict do nothing returning id', 'service_role')
    check('a re-insert of the same (run, match, side) adds nothing', rc == 0 and out == '', out)
    MARK = "insert into public.value_ledger_mark (event_key, side, kind, snapshot_id) values (100, 'p1', 'first_edge', (select min(id) from public.value_ledger_snapshot))"
    check('service_role can insert a mark', q(MARK, 'service_role')[0] == 0)
    check('a second first_edge mark for the same match-side is refused (one per kind)', q(MARK, 'service_role')[0] != 0)
    SET = ("insert into public.value_ledger_settlement (event_key, side, mark_kind, snapshot_id, b105_price, result, profit) "
           "values (100, 'p1', 'first_edge', (select min(id) from public.value_ledger_snapshot), 1.9, 'won', 0.9)")
    check('service_role can insert a settlement', q(SET, 'service_role')[0] == 0)
    rc, out = q(SET + ' on conflict (event_key, side, mark_kind, supersedes) do nothing returning id', 'service_role')
    check('the same settlement again adds nothing (nulls not distinct)', rc == 0 and out == '', out)
    COR = ("insert into public.value_ledger_settlement (event_key, side, mark_kind, snapshot_id, result, profit, supersedes) "
           "values (100, 'p1', 'first_edge', (select min(id) from public.value_ledger_snapshot), 'void', 0, (select min(id) from public.value_ledger_settlement))")
    check('a correction is a NEW row naming what it supersedes', q(COR, 'service_role')[0] == 0)
    check('a price below 1.01 is refused (never a zero)', q(SNAP.replace("'r1'", "'r2'").replace('1.9, 0.14', '0, 0.14'), 'service_role')[0] != 0)
    for t, setc in (('value_ledger_snapshot', 'b105_price = 2'), ('value_ledger_mark', "kind = 'last_pre_start'"), ('value_ledger_settlement', "result = 'lost'")):
        for role in ('service_role', None):
            who = role or 'the owner'
            check(f'{t}: UPDATE refused for {who}', q(f'update public.{t} set {setc}', role)[0] != 0)
            check(f'{t}: DELETE refused for {who}', q(f'delete from public.{t}', role)[0] != 0)
            check(f'{t}: TRUNCATE refused for {who}', q(f'truncate public.{t} cascade', role)[0] != 0)
        check(f'{t}: anon reads nothing', q(f'select count(*) from public.{t}', 'anon')[0] != 0)
    rc, out = q(SNAP + " on conflict (run_id, event_key, side) do update set b105_price = 5", 'service_role')
    check('an upsert that would update is refused', rc != 0, out)
    rc, out = q("select count(*) from public.value_ledger_snapshot where b105_price = 1.9")
    check('the stored rows are untouched', out.strip() == '1', out)
    rc, out = q("select (public.value_ledger_guard()->>'ok')", 'service_role')
    check('guard: ok', out.strip() == 'true', out)
    q('drop trigger value_ledger_mark_no_change on public.value_ledger_mark')
    rc, out = q("select (public.value_ledger_guard()->>'ok')", 'service_role')
    check('guard NOT ok once a trigger is dropped (negative control)', out.strip() == 'false', out)
    pg.file(MIG)
    q('grant update on public.value_ledger_settlement to service_role')
    rc, out = q("select (public.value_ledger_guard()->>'ok')", 'service_role')
    check('guard NOT ok once UPDATE is granted (negative control)', out.strip() == 'false', out)
finally:
    pg.close()
print(f'\ntest-value-ledger-sql: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
