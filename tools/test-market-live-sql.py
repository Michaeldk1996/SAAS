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
create table public.live_flip_log_superseded (event_key text primary key, reason text not null);
create view public.live_flip_log_current as select f.* from public.live_flip_log f
  where not exists (select 1 from public.live_flip_log_superseded s where s.event_key = f.event_key);
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

    # a superseded false start never freezes (the view, not the raw log)
    push([row('4', 700, '2026-11-06T09:00:00Z')])
    q("insert into public.live_flip_log values ('4', '2026-11-06T09:30:10Z', '2026-11-06T09:30:00Z'); insert into public.live_flip_log_superseded values ('4', 'false 0-0 start')")
    push([row('4', 720, '2026-11-06T09:40:00Z')])
    check('a superseded false start: not frozen, the reads go on', liq('4') == '720|-', liq('4'))

    # a read taken after the poll before the flag could be in play: dropped at the freeze, never kept as pre-start
    push([row('5', 800, '2026-11-06T11:00:00Z')])
    push([row('5', 810, '2026-11-06T11:01:00Z')])
    q("insert into public.live_flip_log values ('5', '2026-11-06T11:01:20Z', '2026-11-06T11:00:30Z')")
    push([])
    check('founder 2026-11-12: a read after the lower bound is never kept — the newest read BEFORE it is frozen instead',
          liq('5') == '800|2026-11-06 11:00:30', liq('5'))
    rc, out = q("select outcomes->1->>'mid' || '|' || to_char(read_at at time zone 'UTC', 'HH24:MI:SS') from public.market_live_current where event_key = '5'")
    check('... with its prices and its own read time', out == '0.545|11:00:00', out)
    # no read at all before the lower bound: dropped, never an in-play read labelled pre-start
    push([row('12', 800, '2026-11-06T11:05:00Z')])
    q("insert into public.live_flip_log values ('12', '2026-11-06T11:05:20Z', '2026-11-06T11:04:30Z')")
    push([])
    check('no read before the lower bound: the figure is dropped (start stamped)', liq('12') == 'null|2026-11-06 11:04:30', liq('12'))
    rc, out = q("select coalesce(outcomes::text, 'null') from public.market_live_current where event_key = '12'")
    check('... and its prices too', out == 'null', out)
    # the list keeps at most 30 earlier reads, newest first
    push([row('13', 100 + i, f'2026-11-06T15:{i:02d}:00Z') for i in range(1)])
    for i in range(1, 40): push([row('13', 100 + i, f'2026-11-06T15:{i:02d}:00Z')])
    rc, out = q("select jsonb_array_length(recent) || '|' || (recent->0->>'liquidity') from public.market_live_current where event_key = '13' and venue = 'kalshi'")
    check('the read list keeps the 30 newest earlier reads, newest first', out == '30|138', out)
    # no lower bound (founder 2026-11-12; measured 12 Nov: play seen 13–21 min after the flag on all 3 matches frozen
    # that day): the cut is our first live sighting — the last read taken before it is kept, and the row names the cut
    push([row('6', 900, '2026-11-06T11:00:00Z')])
    q("insert into public.live_flip_log values ('6', '2026-11-06T11:02:00Z', null)")
    push([])
    check('no lower bound: the last read before our first live sighting is kept', liq('6') == '900|2026-11-06 11:02:00', liq('6'))
    rc, out = q("select cut from public.market_live_current where event_key = '6' and venue = 'kalshi'")
    check('... and the row says the cut was the first live sighting', out == 'first live sighting', out)
    rc, out = q("select cut from public.market_live_current where event_key = '5' and venue = 'kalshi'")
    check('a row cut at the poll before the flag says so', out == 'poll before the flag', out)
    # ... but a read taken AFTER the first live sighting is never kept (could be in play)
    q("insert into public.market_live_current (event_key, venue, liquidity, outcomes, read_at) values ('15', 'kalshi', 950, '[]'::jsonb, '2026-11-06T11:03:00Z')")
    q("insert into public.live_flip_log values ('15', '2026-11-06T11:02:00Z', null)")
    push([])
    check('no lower bound, read after the first live sighting: dropped', liq('15') == 'null|2026-11-06 11:02:00', liq('15'))
    # a row frozen before the cut column existed gets its cut named from the log, once
    q("insert into public.market_live_current (event_key, venue, liquidity, read_at, started_at) values ('16', 'kalshi', 5, '2026-11-06T09:00:00Z', '2026-11-06T09:01:00Z')")
    q("insert into public.live_flip_log values ('16', '2026-11-06T09:01:00Z', null)")
    push([])
    rc, out = q("select cut from public.market_live_current where event_key = '16'")
    check('an older frozen row gets its cut named', out == 'first live sighting', out)

    # traded money (founder 2026-11-07): kept with its stamp, kept when a minute sends none, dropped at the freeze when
    # summed after the lower bound, refused when stamped after the read
    def fl(ek): return q(f"select coalesce(flow->>'trades', 'null') from public.market_live_current where event_key = '{ek}' and venue = 'kalshi'")[1]
    F = lambda n, at: {'byName': {'A': 10.5, 'B': 2}, 'trades': n, 'at': at}
    push([dict(row('8', 100, '2026-11-06T13:00:00Z'), flow=F(5, '2026-11-06T13:00:00Z'))])
    check('traded money is written', fl('8') == '5', fl('8'))
    push([row('8', 110, '2026-11-06T13:01:00Z')])
    check('a minute with no sum keeps the stored one', fl('8') == '5', fl('8'))
    push([dict(row('8', 120, '2026-11-06T13:02:00Z'), flow=F(9, '2026-11-06T13:05:00Z'))])
    check('a sum stamped after its read is refused (the stored one stays)', fl('8') == '5', fl('8'))
    push([dict(row('8', 130, '2026-11-06T13:03:00Z'), flow=F(7, '2026-11-06T13:03:00Z'))])
    q("insert into public.live_flip_log values ('8', '2026-11-06T13:03:20Z', '2026-11-06T13:02:30Z')")
    push([])
    check('founder 2026-11-12: the sum frozen is the one stored with the last read before the lower bound', fl('8') == '5', fl('8'))
    push([dict(row('10', 100, '2026-11-06T14:00:00Z'), flow=F(4, '2026-11-06T13:58:00Z'))])
    q("insert into public.live_flip_log values ('10', '2026-11-06T14:01:20Z', '2026-11-06T14:00:30Z')")
    push([])
    check('a sum taken before the lower bound is kept at the freeze', fl('10') == '4', fl('10'))
    rc, out = push([dict(row('11', 1, '2026-11-06T14:00:00Z'), flow={'byName': {}, 'trades': 1, 'at': '2026-13-40T99:00'})])
    check('a malformed stamp is dropped, never an error', rc == 0 and fl('11') == 'null', out)

    # backfill (founder 2026-11-12): fills only an emptied frozen row, only with figures from at or before its start
    def bf(rows, role='service_role'):
        return q("select public.market_live_backfill($j$" + json.dumps(rows) + "$j$::jsonb)", role)
    OC = [{'name': 'A', 'bid': 0.4, 'ask': 0.41, 'mid': 0.405}, {'name': 'B', 'bid': None, 'ask': None, 'mid': 0.595}]
    rc, out = bf([{'event_key': '12', 'venue': 'kalshi', 'outcomes': OC, 'read_at': '2026-11-06T11:04:00Z',
                   'flow': {'byName': {'A': 3, 'B': 4}, 'trades': 2, 'at': '2026-11-06T11:04:30Z'}}])
    check('backfill fills an emptied frozen row', rc == 0 and '"filled": 1' in out, out)
    rc, out = q("select outcomes->0->>'mid' || '|' || (flow->>'trades') || '|' || to_char(read_at at time zone 'UTC', 'HH24:MI') || '|' || (backfill->>'source') from public.market_live_current where event_key = '12' and venue = 'kalshi'")
    check('... with its prices, traded money, read time and the backfill mark', out == '0.405|2|11:04|venue history at or before the start', out)
    rc, out = bf([{'event_key': '15', 'venue': 'kalshi', 'outcomes': OC, 'read_at': '2026-11-06T11:03:00Z',
                   'flow': {'byName': {'A': 1, 'B': 1}, 'trades': 1, 'at': '2026-11-06T11:01:00Z'}}])
    rc, out = q("select coalesce(outcomes::text, 'null') || '|' || coalesce(flow->>'trades', 'null') from public.market_live_current where event_key = '15' and venue = 'kalshi'")
    check('a backfilled price read after the start is refused; a sum before it is kept', out == 'null|1', out)
    rc, out = bf([{'event_key': '5', 'venue': 'kalshi', 'outcomes': OC, 'read_at': '2026-11-06T10:59:00Z', 'flow': None}])
    check('a row the recorder froze with its own read is never touched', '"filled": 0' in out and liq('5').startswith('800|'), out + liq('5'))
    rc, out = bf([{'event_key': '1300', 'venue': 'kalshi', 'outcomes': OC, 'read_at': '2026-11-06T10:59:00Z'}])
    check('backfill never creates a row', '"filled": 0' in out, out)
    for role in ('anon', 'authenticated'):
        rc, out = bf([{'event_key': '12', 'venue': 'polymarket', 'outcomes': OC, 'read_at': '2026-11-06T11:00:00Z'}], role)
        check(f'{role} cannot backfill', rc != 0, out)

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
             .replace("where not exists (select 1 from public.live_flip_log_current l where l.event_key = r.ek)\n     and not exists (select 1 from public.live_flip_pending p where p.event_key = r.ek)", '')
             .replace('where c.started_at is null and excluded.read_at', 'where excluded.read_at'))
    check('CONTROL: the mutant differs from the shipped function', mut.count('from public.live_flip_pending') == 0 and 'started_at is null and' not in mut)
    rc, out = q(mut); check('CONTROL: mutant applies', rc == 0, out)
    q("select public.market_live_push_ctl($j$" + json.dumps([row('1', 1500, '2026-11-06T10:20:00Z')]) + "$j$::jsonb)")
    check('CONTROL: without the freeze clauses the frozen value is overwritten', liq('1').startswith('1500|'), liq('1'))
    # CONTROL: without the drop, a read after the lower bound would be kept as the pre-start value
    keep = (fn.replace('public.market_live_push(', 'public.market_live_push_ctl2(')
              .replace("liquidity  = (p.snap->>'liquidity')::numeric,", 'liquidity = c.liquidity,'))
    check('CONTROL: the keep-mutant differs', 'liquidity = c.liquidity,' in keep)
    q(keep)
    push([row('7', 810, '2026-11-06T12:01:00Z')])
    q("insert into public.live_flip_log values ('7', '2026-11-06T12:01:20Z', '2026-11-06T12:00:30Z')")
    q("select public.market_live_push_ctl2('[]'::jsonb)")
    check('CONTROL: without the drop the in-play read is kept', liq('7').startswith('810|'), liq('7'))
    # CONTROL: without the read list (the shipped freeze before 2026-11-12) the pre-start read is lost
    nolist = (fn.replace('public.market_live_push(', 'public.market_live_push_ctl3(')
                .replace("else (select e from jsonb_array_elements(", "else (select e from jsonb_array_elements('[]'::jsonb || "))
    nolist = nolist.replace("case when jsonb_typeof(c.recent) = 'array' then c.recent else '[]'::jsonb end) e", "'[]'::jsonb) e", 1)
    check('CONTROL: the no-list mutant differs', nolist.count("'[]'::jsonb) e") == 1)
    rc, out = q(nolist); check('CONTROL: no-list mutant applies', rc == 0, out)
    q("select public.market_live_push_ctl3($j$" + json.dumps([row('14', 700, '2026-11-06T16:00:00Z')]) + "$j$::jsonb)")
    q("select public.market_live_push_ctl3($j$" + json.dumps([row('14', 710, '2026-11-06T16:01:00Z')]) + "$j$::jsonb)")
    q("insert into public.live_flip_log values ('14', '2026-11-06T16:01:20Z', '2026-11-06T16:00:30Z')")
    q("select public.market_live_push_ctl3('[]'::jsonb)")
    check('CONTROL: without the read list the pre-start read is lost (null)', liq('14').startswith('null|'), liq('14'))
    # CONTROL: the freeze before 2026-11-12's no-lower-bound fix (a null lower bound drops the read) loses row 6's read
    nolb = (fn.replace('public.market_live_push(', 'public.market_live_push_ctl4(')
              .replace("when coalesce(l.last_not_live_seen_at, l.first_live_seen_at) is null then null", "when l.last_not_live_seen_at is null then null"))
    check('CONTROL: the no-lower-bound mutant differs', 'when l.last_not_live_seen_at is null then null' in nolb)
    rc, out = q(nolb); check('CONTROL: no-lower-bound mutant applies', rc == 0, out)
    q("select public.market_live_push_ctl4($j$" + json.dumps([row('17', 600, '2026-11-06T17:00:00Z')]) + "$j$::jsonb)")
    q("insert into public.live_flip_log values ('17', '2026-11-06T17:02:00Z', null)")
    q("select public.market_live_push_ctl4('[]'::jsonb)")
    check('CONTROL: dropping on no lower bound loses the pre-start read', liq('17').startswith('null|'), liq('17'))
finally:
    pg.close()
print(f'test-market-live-sql: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
