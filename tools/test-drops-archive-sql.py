#!/usr/bin/env python3
"""The Dropping Odds archive collector (tools/drops-archive.sql) on a REAL throwaway Postgres.

Applies the real tools/drops-scope.sql (the api-tennis fixture spine), stubs drops_api.lines() (its output shape) and
public.live_flip_log_current, applies drops-archive.sql twice (idempotent), then checks:
  a finished match with a winner and a verified start -> one record, its series cut before the start (nothing at or after);
  the other side of the match -> its own record; insert-only (collect() again writes nothing, a changed series is ignored);
  no verified start -> the record keeps its series whole and start_at NULL; a walkover / a match not decided -> no record;
  two api-tennis fixtures for one pair -> no record (never a guess); read(days) returns them, newest first, for drops_reader
  only (anon refused); a record older than 90 days goes on the next collect().
No Postgres binaries on this machine -> SKIP out loud (never a pass); CI runners carry them."""
import os, sys, json, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pinarch_pg import PG
HERE = os.path.dirname(os.path.abspath(__file__))
SCOPE, SQL = os.path.join(HERE, 'drops-scope.sql'), os.path.join(HERE, 'drops-archive.sql')
pg = PG()
if not pg.available():
    print(f'SKIP  test-drops-archive-sql: {pg.why} — NOT A PASS (the code gate runs it)'); sys.exit(0)
q = pg.q
passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('  PASS ', name)
    else: failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-600:])

now = datetime.datetime.now(datetime.timezone.utc)
iso = lambda h: (now - datetime.timedelta(hours=h)).strftime('%Y-%m-%dT%H:%M:%SZ')
DAY = (now - datetime.timedelta(hours=10)).strftime('%Y-%m-%d')
def line(a, b, side, extra_after_start=True):
    s = [[iso(9), 2.1], [iso(7), 1.8]] + ([[iso(2), 1.6]] if extra_after_start else [])
    return {'key': 'k', 'playerA': a, 'playerB': b, 'side': side,
            'books': {'Bet105': {'source': 'Kibl', 'side': s, 'other': [[iso(9), 1.7], [iso(7), 2.0]]}}}
LINES = [line('Alan Alpha', 'Bruno Beta', 'Alan Alpha'), line('Alan Alpha', 'Bruno Beta', 'Bruno Beta'),
         line('Carl Gamma', 'Dan Delta', 'Carl Gamma'), line('Eve Eps', 'Fred Phi', 'Eve Eps'), line('Gus Gee', 'Hal Hay', 'Gus Gee'),
         line('Ian Iota', 'Jon Jay', 'Ian Iota')]
POLY_STUB = """
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
STUB = """
create schema drops_api; create role drops_reader nologin;
create table public.lines_stub (j jsonb);
create function drops_api.lines(p_hours integer default 24) returns jsonb language sql stable as $$ select j from public.lines_stub $$;
create table public.live_flip_log_current (event_key text primary key, last_not_live_seen_at timestamptz);
"""
try:
    pg.roles()
    rc, out = q(POLY_STUB + STUB); check('stubs', rc == 0, out)
    rc, err = pg.file(SCOPE); check('drops-scope.sql applies', rc == 0, err)
    for i in (1, 2):
        rc, err = pg.file(SQL); check(f'drops-archive.sql applies (pass {i}: idempotent)', rc == 0, err)
    fx = lambda k, a, b, status, winner: {'event_key': k, 'event_date': DAY, 'event_time': '12:00', 'first': a, 'second': b,
                                         'type': 'Challenger Men Singles', 'qual': 'False', 'tournament': 'Testville', 'round': 'R16',
                                         'status': status, 'winner': winner}
    rows = [fx(1, 'A. Alpha', 'B. Beta', 'Finished', 'First Player'), fx(2, 'C. Gamma', 'D. Delta', 'Finished', 'Second Player'),
            fx(3, 'E. Eps', 'F. Phi', 'Walk Over', 'First Player'), fx(4, 'G. Gee', 'H. Hay', 'Set 2', None),
            fx(5, 'I. Iota', 'J. Jay', 'Finished', 'First Player'), fx(6, 'I. Iota', 'J. Jay', 'Finished', 'First Player')]
    rc, out = q("select public.drops_scope_ingest($j$" + json.dumps(rows) + "$j$::jsonb, 'test')", 'service_role'); check('fixtures in', rc == 0, out)
    q("insert into public.live_flip_log_current values ('1', '" + iso(4) + "')")
    q("insert into public.lines_stub values ($j$" + json.dumps(LINES) + "$j$::jsonb)")
    rc, out = q("select drops_archive.collect()")
    check('collect(): both sides of the decided match + the one without a verified start; no walkover, no undecided, no ambiguous pair', out == '3', out)
    rc, out = q("select key, side_first, winner_first, start_at is not null, jsonb_array_length(books->'Bet105'->'side') from drops_archive.records order by key")
    check('records: cut before the verified start (2 of 3 points), whole without one (3 of 3)',
          out.split('\n') == ['1|alpha|t|t|t|2', '1|beta|f|t|t|2', '2|gamma|t|f|f|3'], out)
    q("update public.lines_stub set j = jsonb_set(j, '{0,books,Bet105,side,0,1}', '9.99')")
    rc, out = q("select drops_archive.collect()"); check('insert-only: collect() again writes nothing', out == '0', out)
    rc, out = q("select books->'Bet105'->'side'->0->>1 from drops_archive.records where key = '1|alpha'")
    check('a stored record never changes', out == '2.1', out)
    rc, out = q("select jsonb_array_length(drops_archive.read(90)), drops_archive.read(90)->0->>'key' is not null")
    check('read(90) returns the records', out == '3|t', out)
    rc, out = q("select jsonb_array_length(drops_archive.read(90))", 'drops_reader'); check('drops_reader may read', rc == 0, out)
    rc, out = q("select drops_archive.read(90)", 'anon'); check('anon may not', rc != 0, out)
    q("update drops_archive.records set scheduled_at = now() - interval '91 days' where key = '2|gamma'")
    q("delete from public.lines_stub")
    q("insert into public.lines_stub values ('[]'::jsonb)")
    rc, out = q("select drops_archive.collect(), (select count(*) from drops_archive.records)")
    check('a record older than 90 days goes', out == '0|2', out)
finally:
    pg.close()
print(f'test-drops-archive-sql: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
