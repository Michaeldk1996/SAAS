#!/usr/bin/env python3
"""The per-minute prediction-market table (supabase/migrations/20261106090000_market_live.sql) on a REAL throwaway Postgres.

Stubs our live-flip tables (live_flip_log, live_flip_pending), applies the migration twice (idempotent), and checks:
  a pushed read is written; a newer read replaces it, an older one never does; a match our poller has FLAGGED live
  (pending) is not written and resumes when the flag is dropped; once play is SEEN (log) its row is stamped with the
  poll before the flag and never written again — the frozen value is the last read before our own live sighting;
  a match first seen after its live flip gets no row; the beat moves on every push; anon and authenticated can read
  both tables and cannot push; service_role can push.
  CONTROL: the same push into a copy of the table without the freeze clause overwrites the frozen value.
No Postgres binaries on this machine -> SKIP out loud (never a pass); CI runners carry them."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pinarch_pg import PG
HERE = os.path.dirname(os.path.abspath(__file__))
SQL = os.path.join(HERE, '..', 'supabase', 'migrations', '20261106090000_market_live.sql')
pg = PG()
if not pg.available():
    print(f'SKIP  test-market-live-sql: {pg.why} — NOT A PASS (the code gate runs it)'); sys.exit(0)
q = pg.q
passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('  PASS ', name)
    else: failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-500:])

STUB = """
create table public.live_flip_log (event_key text primary key, first_live_seen_at timestamptz not null, last_not_live_seen_at timestamptz);
create table public.live_flip_pending (event_key text primary key, first_live_seen_at timestamptz not null, last_not_live_seen_at timestamptz);
"""
def push(rows, role='service_role'):
    return q("select public.market_live_push($j$" + json.dumps(rows) + "$j$::jsonb, '{\"t\":1}'::jsonb)", role)
def row(ek, liq, at, venue='kalshi'):
    return {'event_key': ek, 'venue': venue, 'ref': 'KX-' + ek, 'liquidity': liq, 'status': 'open', 'read_at': at,
            'outcomes': [{'name': 'A', 'bid': 0.45, 'ask': 0.46, 'mid': 0.455}, {'name': 'B', 'bid': 0.54, 'ask': 0.55, 'mid': 0.545}]}
def liq(ek, venue='kalshi'):
    return q(f"select coalesce(liquidity::text, 'null') || '|' || coalesce(to_char(started_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS'), '-') from public.market_live_current where event_key = '{ek}' and venue = '{venue}'")[1]

try:
    pg.roles()
    rc, out = q(STUB); check('stubs (live-flip log + pending)', rc == 0, out)
    for i in (1, 2):
        rc, err = pg.file(SQL); check(f'migration applies (pass {i})', rc == 0, err)

    rc, out = push([row('1', 1000, '2026-11-06T10:00:00Z'), row('1', 900, '2026-11-06T10:00:00Z', 'polymarket')])
    check('a read is written (both venues)', rc == 0 and liq('1').startswith('1000|') and liq('1', 'polymarket').startswith('900|'), out)
    push([row('1', 1100, '2026-11-06T10:01:00Z')])
    check('a newer read replaces it', liq('1').startswith('1100|'), liq('1'))
    push([row('1', 50, '2026-11-06T09:59:00Z')])
    check('an older read never does', liq('1').startswith('1100|'), liq('1'))
    rc, out = q("select outcomes->1->>'mid' from public.market_live_current where event_key='1' and venue='kalshi'")
    check('per-player prices kept', out == '0.545', out)

    q("insert into public.live_flip_pending values ('1', '2026-11-06T10:01:30Z', '2026-11-06T10:01:20Z')")
    push([row('1', 1200, '2026-11-06T10:02:00Z')])
    check('flagged live (pending): not written', liq('1').startswith('1100|'), liq('1'))
    q("delete from public.live_flip_pending where event_key = '1'")
    push([row('1', 1250, '2026-11-06T10:03:00Z')])
    check('flag dropped before play: the reads resume', liq('1').startswith('1250|'), liq('1'))

    q("insert into public.live_flip_log values ('1', '2026-11-06T10:03:40Z', '2026-11-06T10:03:30Z')")
    rc, out = push([row('1', 1300, '2026-11-06T10:04:00Z')])
    check('play seen: started_at = the poll before the flag, value frozen', liq('1') == '1250|2026-11-06 10:03:30', liq('1') + ' ' + out)
    check('the push reports the stamp', rc == 0 and '"frozen": 2' in out, out)   # both venues of event 1
    push([row('1', 1400, '2026-11-06T10:09:00Z'), row('1', 999, '2026-11-06T10:09:00Z', 'polymarket')])
    check('frozen rows are never written again', liq('1').startswith('1250|') and liq('1', 'polymarket').startswith('900|'), liq('1'))

    q("insert into public.live_flip_log values ('2', '2026-11-06T09:00:00Z', null)")
    push([row('2', 500, '2026-11-06T10:10:00Z')])
    rc, out = q("select count(*) from public.market_live_current where event_key = '2'")
    check('a match first seen after its live flip gets no row', out == '0', out)

    rc, out = q("select note->>'t' from public.market_live_beat where id = 1")
    check('the beat is written', out == '1', out)

    for role in ('anon', 'authenticated'):
        rc, out = q('select count(*) from public.market_live_current', role); check(f'{role} reads the table', rc == 0 and int(out) >= 1, out)
        rc, out = q('select count(*) from public.market_live_beat', role); check(f'{role} reads the beat', rc == 0 and out == '1', out)
        rc, out = push([row('3', 1, '2026-11-06T10:00:00Z')], role); check(f'{role} cannot push', rc != 0, out)
        rc, out = q("insert into public.market_live_current (event_key, venue, read_at) values ('9','kalshi',now())", role)
        check(f'{role} cannot write the table', rc != 0, out)

    # CONTROL: the shipped function with its freeze clauses removed overwrites the frozen value
    src = open(SQL).read()
    fn = src[src.index('create or replace function public.market_live_push'):src.index('revoke all on function')]
    mut = (fn.replace('public.market_live_push(', 'public.market_live_push_ctl(')
             .replace("where not exists (select 1 from public.live_flip_log l where l.event_key = r.ek)\n     and not exists (select 1 from public.live_flip_pending p where p.event_key = r.ek)", '')
             .replace('where c.started_at is null and excluded.read_at', 'where excluded.read_at'))
    check('CONTROL: the mutant differs from the shipped function', mut.count('from public.live_flip_pending') == 0 and 'started_at is null and' not in mut)
    rc, out = q(mut); check('CONTROL: mutant applies', rc == 0, out)
    q("select public.market_live_push_ctl($j$" + json.dumps([row('1', 1500, '2026-11-06T10:20:00Z')]) + "$j$::jsonb)")
    check('CONTROL: without the freeze clauses the frozen value is overwritten', liq('1').startswith('1500|'), liq('1'))
finally:
    pg.close()
print(f'test-market-live-sql: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
