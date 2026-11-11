#!/usr/bin/env python3
"""Match end recorder (news ticker v2, A5): supabase/migrations/20261111090000_live_match_end.sql.

Part 1 (static): the migration's write_live_pbp is the current one plus only the wrapped recorder call; go-live applies
the file after the retention migration. Part 2 (real throwaway Postgres): the end is bracketed by two ticks, a decided
row is final, a match first seen decided has no lower bound, other tours and a stale board are ignored, anon reads
nothing, and a failing recorder never fails the point-log write (control: unwrapped, it does). No Postgres binaries ->
SKIP out loud (never a pass); the code gate runs it."""
import json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
MIG = os.path.join(ROOT, 'supabase', 'migrations', '20261111090000_live_match_end.sql')
PREV = os.path.join(ROOT, 'supabase', 'migrations', '20261024000000_live_pbp_retention.sql')
passed = failed = 0


def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('  PASS ', name)
    else: failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-400:])


def fn_body(sql):
    m = re.search(r'create or replace function public\.write_live_pbp\(.*?\n\$\$;', sql, re.S)
    return m.group(0) if m else ''


mig, prev = open(MIG).read(), open(PREV).read()
WRAP = re.compile(r"\n\s*-- Match end recorder[^\n]*\n\s*begin\n\s*perform public\.record_match_ends\(now\(\)\);\n\s*exception when others then\n[^\n]*\n\s*end;\n")
check('write_live_pbp = the retention body + only the wrapped recorder call', WRAP.search(fn_body(mig)) and WRAP.sub('\n', fn_body(mig)).split() == fn_body(prev).split())
check('the recorder call is inside an exception block', 'exception when others' in fn_body(mig))
gl = open(os.path.join(ROOT, '.github', 'workflows', 'supabase-live-golive.yml')).read()
i, j = gl.find('20261024000000_live_pbp_retention.sql'), gl.find('apply supabase/migrations/20261111090000_live_match_end.sql')
check('go-live applies it after the retention migration', 0 < i < j)
# the 2026-11-11 outage: the deploy step must not stop for a prompt, and go-live must not rotate a secret the scheduler holds
check('go-live deploys the poller with --yes (no terminal prompt)', re.search(r'supabase functions deploy live-poller[^\n]*--yes', gl) is not None)
k, r = gl.find("from vault.decrypted_secrets where name = 'POLLER_SECRET'"), gl.find('POLLER_SECRET=$(openssl rand -hex 24)')
check('go-live keeps the existing poller secret; a new one only when Vault holds none', 0 < k < r and 'POLLER_SECRET="$EXISTING"' in gl)

sys.path.insert(0, HERE)
from _pinarch_pg import PG  # noqa: E402
pg = PG()
if not pg.available():
    print(f'SKIP  Part 2 (real Postgres): {pg.why} — NOT A PASS (the code gate runs it)')
else:
    q = pg.q
    try:
        pg.roles()
        rc, out = q("create table public.live_snapshot (id smallint primary key default 1, board jsonb not null default '{}', updated_at timestamptz not null default now());"
                    "insert into public.live_snapshot (id) values (1);"
                    "create table public.live_pbp (event_key text primary key, pbp jsonb not null default '[]', updated_at timestamptz not null default now(), ended_at timestamptz, final jsonb, final_at timestamptz);")
        check('fixture tables', rc == 0, out)
        for n in (1, 2):
            rc, err = pg.file(MIG); check(f'migration applies (pass {n}: idempotent)', rc == 0, err)

        def board(rows, at):
            b = json.dumps({'matches': rows}).replace("'", "''")
            return q(f"update public.live_snapshot set board = '{b}'::jsonb, updated_at = '{at}' where id = 1;")

        def fix(ek, status, winner='', typ='Atp Singles'):
            return {'event_key': ek, 'event_status': status, 'event_winner': winner, 'event_type_type': typ, 'event_final_result': '1 - 0',
                    'tournament_name': 'T', 'event_first_player': 'A', 'event_second_player': 'B'}

        def row(ek):
            return q(f"select coalesce(last_undecided_seen_at::text,'-') || '|' || coalesce(decided_seen_at::text,'-') || '|' || coalesce(event_status,'-') from public.live_match_end where event_key = '{ek}';")[1]

        T = ['2026-11-11 10:00:00+00', '2026-11-11 10:00:10+00', '2026-11-11 10:00:20+00', '2026-11-11 10:00:30+00']
        board([fix('1', 'Set 2'), fix('2', 'Finished', 'First Player'), fix('3', 'Set 1', '', 'Itf Men Singles'), fix('4', 'Finished', '')], T[0])
        rc, out = q(f"select public.record_match_ends('{T[0]}');"); check('recorder runs', rc == 0, out)
        check('in play: lower bound stamped, not decided', row('1') == f'{T[0]}|-|Set 2', row('1'))
        check('first seen already decided: no lower bound (no duration may be printed)', row('2') == f'-|{T[0]}|Finished', row('2'))
        check('other tours are not recorded', row('3') == '', row('3'))
        check('Finished without a winner is not decided', row('4').split('|')[1] == '-', row('4'))
        board([fix('1', 'Set 2')], T[1]); q(f"select public.record_match_ends('{T[1]}');")
        check('lower bound moves with each undecided tick', row('1') == f'{T[1]}|-|Set 2', row('1'))
        board([fix('1', 'Finished', 'Second Player')], T[2]); q(f"select public.record_match_ends('{T[2]}');")
        check('decided: end bracketed by the two ticks', row('1') == f'{T[1]}|{T[2]}|Finished', row('1'))
        board([fix('1', 'Set 3')], T[3]); q(f"select public.record_match_ends('{T[3]}');")
        check('a decided row is final (never written again)', row('1') == f'{T[1]}|{T[2]}|Finished', row('1'))
        board([fix('9', 'Finished', 'First Player')], '2026-11-11 09:00:00+00'); q(f"select public.record_match_ends('{T[3]}');")
        check('a stale board records nothing', row('9') == '', row('9'))
        q("select public.record_match_ends('2026-11-12 10:01:00+00');")
        check('never decided: removed after 24 h; decided rows kept', row('4') == '' and row('1') != '' and row('2') != '', (row('4'), row('1')))
        rc, out = q('select count(*) from public.live_match_end;', role='anon'); check('anon cannot read', rc != 0, out)
        rc, out = q("select public.record_match_ends(now());", role='anon'); check('anon cannot run the recorder', rc != 0, out)
        # a failing recorder never fails the point-log write
        q("create or replace function public.record_match_ends(_now timestamptz default now()) returns int language plpgsql as $$ begin raise exception 'boom'; end; $$;")
        rc, out = q("""select public.write_live_pbp('{"77": [{"x": 1}]}'::jsonb, '["77"]'::jsonb);""", role='service_role')
        n = q("select count(*) from public.live_pbp where event_key = '77';")[1]
        check('recorder raising: write_live_pbp still writes the log', rc == 0 and n == '1', (rc, out, n))
        # control: the same function WITHOUT the wrap fails the write
        body = fn_body(mig); bare = re.sub(r"begin\n\s*perform public\.record_match_ends\(now\(\)\);\n\s*exception when others then\n[^\n]*\n\s*end;", 'perform public.record_match_ends(now());', body)
        check('control built', bare != body)
        q(bare)
        rc, out = q("""select public.write_live_pbp('{"78": [{"x": 1}]}'::jsonb, '["78"]'::jsonb);""", role='service_role')
        check('control: unwrapped, the write fails', rc != 0, out)
    finally:
        pg.close()

print(f'live match end: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
