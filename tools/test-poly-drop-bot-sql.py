#!/usr/bin/env python3
"""The Polymarket drop bot (tools/poly-drop-bot.sql) on a REAL throwaway Postgres.

Builds the shared odds-api.io recorder tables (ten287_rec) as installed, the drops_live cut, an empty Vault, the two
other bots' alerts tables, applies the real tools/drops-scope.sql and then tools/poly-drop-bot.sql twice (idempotent),
feeds api-tennis fixtures and Polymarket volumes through their service_role writers, writes Polymarket ticks the way the
recorder does, and checks:
  an ATP drop of >= 5% in 10 min with >= $100 at the price before AND after alerts, labelled blue, with the liquidity and
  Polymarket's traded total; a thinner book, a missing depth, a 4% move, a Superbet tick, a match past its live start
  and a second drop inside the cooldown do not; a Challenger drop is recorded but held (never posted); two volume rows
  that both fit give "—", never a guess; tick() runs end to end (no Vault secret -> nothing sent).
  CONTROL: with no minimum the same thin drop alerts, so the minimum is what holds it.
No Postgres binaries on this machine -> SKIP out loud (never a pass); CI runners carry them."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pinarch_pg import PG
HERE = os.path.dirname(os.path.abspath(__file__))
SCOPE, SQL = os.path.join(HERE, 'drops-scope.sql'), os.path.join(HERE, 'poly-drop-bot.sql')
pg = PG()
if not pg.available():
    print(f'SKIP  test-poly-drop-bot-sql: {pg.why} — NOT A PASS (the code gate runs it)'); sys.exit(0)
q = pg.q
passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('  PASS ', name)
    else: failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-500:])

STUB = """
create schema ten280_bot; create schema ten287_bot; create schema ten287_rec; create schema drops_live; create schema vault; create schema net;
create table net._http_response (id bigint primary key, status_code int, error_msg text, content text);
create table vault.decrypted_secrets (name text, decrypted_secret text);
create table public.kibl_fixtures (fixture_id bigint primary key, scheduled_start timestamptz);
create table ten280_bot.alerts (id bigserial primary key, mode text not null, fixture_id bigint not null, side_id int not null default 2,
  tier text, player_a text, player_b text, side_player text, eval_at timestamptz not null default now(),
  delivery text not null default 'unsent', created_at timestamptz not null default now());
create table ten287_bot.alerts (id bigserial primary key, mode text not null, book text not null default 'Superbet', event_id bigint not null,
  side text not null default 'home', tier text, player_a text, player_b text, side_player text, eval_at timestamptz not null default now(),
  delivery text not null default 'unsent', created_at timestamptz not null default now());
create table ten287_rec.config (id boolean primary key default true, books text[] not null default array['Betfair Exchange','Superbet'], min_remaining int default 1500);
insert into ten287_rec.config (id) values (true);
create table ten287_rec.events (event_id bigint primary key, home text, away text, start_at timestamptz, status text, league text, tier text,
  bookmaker_ids jsonb, first_seen timestamptz default now(), last_seen timestamptz default now());
create table ten287_rec.openings (event_id bigint, book text, open_home numeric, open_away numeric, open_at timestamptz, status_code int,
  fetched_at timestamptz default now(), primary key (event_id, book));
create table ten287_rec.ticks (id bigserial primary key, book text not null, event_id bigint not null, market text not null default 'ML',
  back_home numeric, back_away numeric, lay_home numeric, lay_away numeric, depth_home numeric, depth_away numeric,
  depth_lay_home numeric, depth_lay_away numeric, book_updated_at timestamptz, seen_at timestamptz not null, event_status text,
  src text not null default 'updated', state_md5 text not null default md5(random()::text));
create table drops_live.cut (event_id bigint, cut_at timestamptz);
create function drops_live.cuts_287(p_from timestamptz) returns table(event_id bigint, cut_at timestamptz)
  language sql stable as $$ select event_id, cut_at from drops_live.cut $$;
"""
def fx(ek, a, b, typ, qual='False'):
    return {'event_key': ek, 'event_date': '__D0__', 'event_time': '12:00', 'first': a, 'second': b,
            'type': typ, 'qual': qual, 'tournament': 'T', 'round': 'R'}
def ingest(rows):
    rc, d = q("select to_char(now() at time zone 'UTC', 'YYYY-MM-DD')")
    return q("select public.drops_scope_ingest($j$" + json.dumps(rows).replace('__D0__', d) + "$j$::jsonb, 'test')", 'service_role')
def event(eid, home, away, tier='ATP', league='ATP - Paris, France'):
    q(f"insert into ten287_rec.events (event_id, home, away, start_at, status, league, tier) values "
      f"({eid}, $${home}$$, $${away}$$, now() + interval '3 hours', 'pending', $${league}$$, {('$$' + tier + '$$') if tier else 'null'})")
def tick(eid, mins_ago, home, away, dh, da, book='Polymarket'):
    dh_s = 'null' if dh is None else dh
    q(f"insert into ten287_rec.ticks (book, event_id, back_home, back_away, depth_home, depth_away, book_updated_at, seen_at, event_status) "
      f"values ('{book}', {eid}, {home}, {away}, {dh_s}, {da}, now() - interval '{mins_ago} minutes', now() - interval '{mins_ago} minutes', 'pending')")
def scan(min_depth='100', run=None):
    run_s = 'null' if run is None else f"'{run}'"
    rc, out = q(f"select poly_bot.load_ticks('Polymarket', now() - interval '14 days', now()); "
                f"select poly_bot.scan('Polymarket', now(), now(), 5, 'live', {run_s}, interval '10 minutes', interval '30 minutes', {min_depth})")
    return rc, out
def alerts(eid):
    rc, out = q(f"select coalesce(string_agg(side || ':' || delivery, ',' order by id), '') from poly_bot.alerts where event_id = {eid}")
    return out

try:
    pg.roles()
    rc, out = q(STUB); check('stub recorder / bot / vault tables', rc == 0, out)
    rc, err = pg.file(SCOPE); check('drops-scope.sql applies (the real ATP-only scope)', rc == 0, err)
    for i in (1, 2):
        rc, err = pg.file(SQL); check(f'poly-drop-bot.sql applies (pass {i}: idempotent)', rc == 0, err)
    rc, out = q("select count(*) from information_schema.triggers where trigger_name = 'drops_scope_scope' and event_object_schema = 'poly_bot'")
    check('the ATP-only scope trigger sits on poly_bot.alerts', out == '1', out)
    rc, out = q("select books::text from ten287_rec.config")
    check('install changes no recorder setting (the workflow does, explicitly)', out == '{"Betfair Exchange",Superbet}', out)

    rc, out = ingest([fx(9001, 'Q. Halys', 'A. Fery', 'Atp Singles'), fx(9002, 'L. Tien', 'R. Opelka', 'Challenger Men Singles'),
                      fx(9003, 'T. Thin', 'B. Book', 'Atp Singles'), fx(9004, 'S. Small', 'M. Move', 'Atp Singles'),
                      fx(9005, 'S. Superb', 'O. Only', 'Atp Singles'), fx(9006, 'C. Cut', 'A. Started', 'Atp Singles'),
                      fx(9007, 'N. Nodepth', 'D. Missing', 'Atp Singles')])
    check('api-tennis fixtures in', rc == 0, out)
    rc, ts = q("select to_char(now() + interval '3 hours', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")
    rc, out = q("""select public.poly_volume_ingest(replace('[{"slug":"atp-halys-fery-2026-11-02","a":"Quentin Halys","b":"Arthur Fery","start":"S","volume":"1851.2137","volume_ml":"1700","liquidity":"83381"},
                   {"slug":"atp-tien-opelka","a":"Learner Tien","b":"Reilly Opelka","start":"S","volume":"500"},
                   {"slug":"atp-thin-book-a","a":"Tom Thin","b":"Bob Book","start":"S","volume":"10"},
                   {"slug":"atp-thin-book-b","a":"Tom Thin","b":"Bob Book","start":"S","volume":"20"}]', '"S"', '"%s"')::jsonb)""" % ts, 'service_role')
    check('service_role writes Polymarket volumes', rc == 0 and out == '4', out)
    rc, out = q("select public.poly_volume_ingest('[]'::jsonb)", 'anon')
    check('anon cannot write volumes', rc != 0, out)

    # 1: a real ATP drop on a deep book
    event(1, 'Halys, Quentin', 'Fery, Arthur')
    tick(1, 20, 2.00, 1.90, 600, 500); tick(1, 2, 1.85, 2.10, 1240, 300)
    rc, out = scan(); check('scan runs', rc == 0, out)
    check('ATP drop of 7.5% with $600 → $1,240 at the price → one alert, posted (unsent for tick)', alerts(1) == 'home:unsent', alerts(1))
    rc, msg = q("select message from poly_bot.alerts where event_id = 1")
    check('message: blue header', msg.startswith('🔵 POLYMARKET DROP'), msg)
    check('message: liquidity before → after, in dollars', '💧 Liquidity at price: $600 → $1,240' in msg, msg)
    check('message: Polymarket traded total for the match', '📊 Traded on match: $1,851 (as of ' in msg, msg)
    check('message: the match-winner market\'s whole book', '📚 Match-winner liquidity: $83,381' in msg, msg)
    check('message: book and drop', '🏦 Bookmaker: Polymarket' in msg and '📉 Drop (10 min): −7.5%' in msg, msg)
    rc, out = q("select ref_depth || '|' || cur_depth || '|' || round(volume) from poly_bot.alerts where event_id = 1")
    check('the alert row keeps both depths and the volume', out == '600|1240|1851', out)

    # 2: the cooldown
    tick(1, 1, 1.70, 2.30, 2000, 300)
    scan(); check('a second drop on the same match inside 30 min → no second alert', alerts(1) == 'home:unsent', alerts(1))

    # 3: Challenger → held
    event(2, 'Tien, Learner', 'Opelka, Reilly', tier='Challenger', league='Challenger - Taipei')
    tick(2, 20, 2.00, 1.90, 600, 500); tick(2, 2, 1.80, 2.10, 700, 300)
    scan(); check('Challenger drop → recorded but held, never posted', alerts(2) == 'home:held: not ATP (Challenger Men Singles)', alerts(2))

    # 4: thin book after the drop
    event(3, 'Thin, Tom', 'Book, Bob')
    tick(3, 20, 2.00, 1.90, 600, 500); tick(3, 2, 1.80, 2.10, 50, 300)
    scan(); check('only $50 at the new price → no alert', alerts(3) == '', alerts(3))
    # 5: depth missing before
    event(7, 'Nodepth, Nick', 'Missing, Dan')
    tick(7, 20, 2.00, 1.90, None, 500); tick(7, 2, 1.80, 2.10, 900, 300)
    scan(); check('no depth on record before the drop → no alert (missing is not "enough")', alerts(7) == '', alerts(7))
    # 6: under threshold
    event(4, 'Small, Sam', 'Move, Max')
    tick(4, 20, 2.00, 1.90, 600, 500); tick(4, 2, 1.92, 2.00, 900, 300)
    scan(); check('a 4% move → no alert', alerts(4) == '', alerts(4))
    # 7: a Superbet tick is never read here
    event(5, 'Superb, Sid', 'Only, Oli')
    tick(5, 20, 2.00, 1.90, 600, 500, book='Superbet'); tick(5, 2, 1.70, 2.10, 900, 300, book='Superbet')
    scan(); check('a Superbet drop → nothing from the Polymarket bot', alerts(5) == '', alerts(5))
    # 8: past the live start
    event(6, 'Cut, Carl', 'Started, Al')
    tick(6, 20, 2.00, 1.90, 600, 500); tick(6, 2, 1.70, 2.10, 900, 300)
    q("insert into drops_live.cut values (6, now() - interval '5 minutes')")
    scan(); check('a price after the live start → no alert', alerts(6) == '', alerts(6))

    # volume: two Polymarket events fit the pair → "—"
    rc, out = q("select coalesce(volume::text, 'null') from poly_bot.volume_for('Tom Thin', 'Bob Book', now() + interval '3 hours')")
    check('two volume rows fit → no volume (never a guess)', out == 'null', out)
    rc, out = q("select round(volume) from poly_bot.volume_for('Arthur Fery', 'Quentin Halys', now() + interval '3 hours')")
    check('one volume row, players either order → its volume', out == '1851', out)
    rc, out = q("select coalesce(volume::text, 'null') from poly_bot.volume_for('Quentin Halys', 'Arthur Fery', now() + interval '3 days')")
    check('a start 3 days off → not that event', out == 'null', out)
    rc, out = q("select coalesce(volume::text, 'null') from poly_bot.volume_for('Quentin Halys', 'Max Fery', now() + interval '3 hours')")
    check('a different initial → not that player', out == 'null', out)

    # tick() end to end: no Vault secret -> recorded, nothing sent
    rc, out = q("select poly_bot.tick()")
    check('tick() runs', rc == 0, out)
    rc, out = q("select delivery from poly_bot.alerts where event_id = 1")
    check('no Vault secret → "unsent: no vault secret", nothing sent', out == 'unsent: no vault secret', out)
    rc, out = q("select poly_bot.report(24)->>'volumeRows'")
    check('report() reads back without pg_cron', rc == 0 and out == '4', out)

    # CONTROL: no minimum → the same thin drop alerts
    rc, out = scan(min_depth='null', run=None)
    check('CONTROL: with no minimum the $50 drop alerts (the minimum is what held it)', alerts(3) == 'home:unsent', alerts(3))
finally:
    pg.close()
print(f'test-poly-drop-bot-sql: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
