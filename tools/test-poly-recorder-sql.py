#!/usr/bin/env python3
"""Our Polymarket recorder (tools/poly-recorder.sql) on a REAL throwaway Postgres.

Applies the real tools/drops-scope.sql (the api-tennis fixture spine), stubs the odds-api.io recorder's tables
(ten287_rec: config, requests, events, ticks, tier — its own shape), applies poly-recorder.sql twice, then checks:
  a push writes the event (900 000 000 000 + the Polymarket id) and one tick: back price = 1 / ask (3 dp), depth = shares
  × ask (dollars), the label 'Polymarket CLOB' (parallel run), a requests row with status 200 (the engine's liveness test);
  the tier comes from the ONE api-tennis fixture both players join (ATP), none → NULL;
  the same prices again → no new tick; a price change → a tick; depth within 20 % → none, beyond → a tick;
  anon cannot push; compare() sets ours beside odds-api.io's 'Polymarket'; switch() renames ours to 'Polymarket' and
  takes it out of ten287_rec.config.books. CONTROL: a 0 / 1 ask is not a price (NULL, never a default).
No Postgres binaries on this machine -> SKIP out loud (never a pass); CI runners carry them."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pinarch_pg import PG
HERE = os.path.dirname(os.path.abspath(__file__))
SCOPE, SQL = os.path.join(HERE, 'drops-scope.sql'), os.path.join(HERE, 'poly-recorder.sql')
pg = PG()
if not pg.available():
    print(f'SKIP  test-poly-recorder-sql: {pg.why} — NOT A PASS (the code gate runs it)'); sys.exit(0)
q = pg.q
passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('  PASS ', name)
    else: failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-600:])

STUB = """
create schema ten280_bot; create schema ten287_bot; create schema ten287_rec;
create table ten280_bot.alerts (id bigserial primary key, mode text not null, fixture_id bigint not null, side_id int not null default 2,
  tier text, player_a text, player_b text, side_player text, eval_at timestamptz not null default now(),
  delivery text not null default 'unsent', created_at timestamptz not null default now());
create table ten287_bot.alerts (id bigserial primary key, mode text not null, book text not null default 'Superbet', event_id bigint not null,
  side text not null default 'home', tier text, player_a text, player_b text, side_player text, eval_at timestamptz not null default now(),
  delivery text not null default 'unsent', created_at timestamptz not null default now());
create table public.kibl_fixtures (fixture_id bigint primary key, scheduled_start timestamptz);
create table ten287_rec.config (id boolean primary key default true check (id), books text[] not null default array['Polymarket', 'Superbet']);
insert into ten287_rec.config (id) values (true);
create table ten287_rec.requests (id bigint primary key, kind text not null, book text, fired_at timestamptz not null default now(),
  processed_at timestamptz, status_code integer, n_items integer, ratelimit_remaining integer, note text, event_id bigint);
create table ten287_rec.events (event_id bigint primary key, home text, away text, start_at timestamptz, status text, league text, tier text,
  bookmaker_ids jsonb, first_seen timestamptz not null default now(), last_seen timestamptz not null default now());
create table ten287_rec.ticks (id bigserial primary key, book text not null, event_id bigint not null, market text not null default 'ML',
  back_home numeric, back_away numeric, lay_home numeric, lay_away numeric, depth_home numeric, depth_away numeric,
  depth_lay_home numeric, depth_lay_away numeric, book_updated_at timestamptz, seen_at timestamptz not null, event_status text,
  src text not null, state_md5 text not null);
create unique index ticks_state_uq on ten287_rec.ticks (book, event_id, market, book_updated_at, state_md5) nulls not distinct;
create function ten287_rec.tier(p_league text, p_home text) returns text language sql immutable as $$
  select case when coalesce(p_home, '') like '%/%' then null when p_league like 'ATP - %' then 'ATP'
              when p_league like 'Challenger - %' then 'Challenger' when p_league like '%ITF Men%' then 'ITF Men' else null end $$;
"""
START = "2026-11-05T12:00:00Z"
def row(**kw):
    r = {'pmId': '123456', 'title': 'Rolex Paris Masters: Alex Molcan vs Titouan Droguet', 'a': 'Alex Molcan', 'b': 'Titouan Droguet',
         'start': START, 'live': False, 'ended': False, 'askA': 0.45, 'sizeA': 1000, 'askB': 0.56, 'sizeB': 500}
    r.update(kw); return r
def push(rows, role='service_role'):
    return q("select public.poly_rec_push($j$" + json.dumps({'rows': rows}) + "$j$::jsonb)", role)
EID = 900000000000 + 123456

try:
    pg.roles()
    rc, out = q(STUB); check('stubs', rc == 0, out)
    rc, err = pg.file(SCOPE); check('drops-scope.sql applies', rc == 0, err)
    for i in (1, 2):
        rc, err = pg.file(SQL); check(f'poly-recorder.sql applies (pass {i}: idempotent)', rc == 0, err)
    rc, out = q("select public.drops_scope_ingest($j$" + json.dumps([
        {'event_key': 7001, 'event_date': '2026-11-05', 'event_time': '12:00', 'first': 'A. Molcan', 'second': 'T. Droguet',
         'type': 'Atp Singles', 'qual': 'False', 'tournament': 'ATP Paris', 'round': 'R32'}]) + "$j$::jsonb, 'test')", 'service_role')
    check('fixture in', rc == 0, out)
    rc, out = push([row()]); check('a push writes one tick', rc == 0 and out == '1', out)
    rc, out = q(f"select home, away, status, tier, league from ten287_rec.events where event_id = {EID}")
    check('the event: names, pending, tier ATP from the one api-tennis fixture', out == 'Alex Molcan|Titouan Droguet|pending|ATP|ATP - ATP Paris', out)
    rc, out = q(f"select book, back_home, back_away, depth_home, depth_away, src from ten287_rec.ticks where event_id = {EID}")
    check('the tick: 1 / ask (3 dp), dollars = shares × ask, label Polymarket CLOB (parallel run)',
          out == 'Polymarket CLOB|2.222|1.786|450.00|280.00|clob', out)
    rc, out = q("select count(*), min(status_code), bool_and(processed_at is not null), min(book) from ten287_rec.requests where kind = 'clob'")
    check('one requests row per push, status 200 (the engine reads it as the recorder answering)', out == '1|200|t|Polymarket CLOB', out)
    rc, out = push([row()]); check('the same prices again → no tick', out == '0', out)
    rc, out = push([row(sizeA=1100)]); check('the dollars at the price move under 20 % → no tick', out == '0', out)
    rc, out = push([row(sizeA=1500)]); check('beyond 20 % → a tick', out == '1', out)
    rc, out = push([row(askA=0.40)]); check('a price change → a tick', out == '1', out)
    rc, out = push([row(pmId='777', a='Some One', b='Other Guy', askA=1, askB=0)])
    rc, out = q(f"select back_home is null and back_away is null, (select tier from ten287_rec.events where event_id = 900000000777) is null from ten287_rec.ticks where event_id = 900000000777")
    check('CONTROL: an ask of 0 or 1 is no price (NULL); a match with no single fixture has no tier', out == 't|t', out)
    rc, out = push([row()], 'anon'); check('anon cannot push', rc != 0, out)
    rc, out = push([row(live=True, askA=0.30)])
    rc, out = q(f"select status from ten287_rec.events where event_id = {EID}"); check('Polymarket marks it live → live', out == 'live', out)
    # compare with odds-api.io's own Polymarket rows
    q("insert into ten287_rec.events (event_id, home, away, start_at, status) values (555, 'Alex Molcan', 'Titouan Droguet', '" + START + "', 'pending')")
    q("insert into ten287_rec.ticks (book, event_id, back_home, back_away, book_updated_at, seen_at, event_status, src, state_md5) values ('Polymarket', 555, 2.5, 1.66, now(), now(), 'pending', 'updated', 'x')")
    rc, out = q("select polyrec.compare(6)")
    cmp = json.loads(out) if rc == 0 else {}
    check('compare(): our match beside odds-api.io\'s, by names + start', cmp.get('both') == 1 and cmp.get('theirsMatches') == 1, out)
    rc, out = q("select polyrec.switch()")
    sw = json.loads(out) if rc == 0 else {}
    check('switch(): ours becomes Polymarket; odds-api.io stops recording it', sw.get('ours') == 'Polymarket' and sw.get('oddsApiIoBooks') == ['Superbet'], out)
    rc, out = push([row(live=False, askA=0.20)])
    rc, out = q(f"select book from ten287_rec.ticks where event_id = {EID} order by id desc limit 1")
    check('after the switch our ticks carry Polymarket (the bots and pages read them unchanged)', out == 'Polymarket', out)
finally:
    pg.close()
print(f'test-poly-recorder-sql: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
