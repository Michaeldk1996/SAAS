#!/usr/bin/env python3
"""The Kalshi recorder + drop bot (tools/kalshi-drop-bot.sql) on a REAL throwaway Postgres.

Stubs pg_net (net.http_get + net._http_response), an empty Vault, the drops_live join helpers and our live-flip log,
applies the real tools/drops-scope.sql and then tools/kalshi-drop-bot.sql twice (idempotent), and checks:
  the recorder fires one call, ingests Kalshi's answer (the 1 Nov shape: yes_ask_dollars, yes_ask_size_fp, volume_fp,
  updated_time) into markets + ticks, and a repeated answer adds nothing; two markets make one match;
  a >= 5% drop of the decimal price (1 / yes_ask) with >= $100 at the price before AND after alerts, purple, with the
  liquidity, the live contracts traded and the pipeline's whole book; a thinner book, a 4% move, a drop past our
  live-flip sighting, a drop past Kalshi's scheduled time and a second drop inside the cooldown do not; a match whose
  api-tennis fixture is a Challenger is held; tick() runs end to end (no Vault secret -> nothing sent).
  CONTROL: with no minimum the same thin drop alerts.
No Postgres binaries on this machine -> SKIP out loud (never a pass); CI runners carry them."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pinarch_pg import PG
HERE = os.path.dirname(os.path.abspath(__file__))
SCOPE, SQL = os.path.join(HERE, 'drops-scope.sql'), os.path.join(HERE, 'kalshi-drop-bot.sql')
pg = PG()
if not pg.available():
    print(f'SKIP  test-kalshi-drop-bot-sql: {pg.why} — NOT A PASS (the code gate runs it)'); sys.exit(0)
q = pg.q
passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('  PASS ', name)
    else: failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-500:])

STUB = """
create schema ten280_bot; create schema ten287_bot; create schema ten287_rec; create schema drops_live; create schema vault; create schema net;
create table net._http_response (id bigint primary key, status_code int, content text, error_msg text, created timestamptz default now());
create sequence net.seq;
create function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
  returns bigint language sql as $$ select nextval('net.seq') $$;
create table vault.decrypted_secrets (name text, decrypted_secret text);
create table public.kibl_fixtures (fixture_id bigint primary key, scheduled_start timestamptz);
create table ten287_rec.events (event_id bigint primary key, start_at timestamptz);
create table ten280_bot.alerts (id bigserial primary key, mode text not null, fixture_id bigint not null, side_id int not null default 2,
  tier text, player_a text, player_b text, side_player text, eval_at timestamptz not null default now(),
  delivery text not null default 'unsent', created_at timestamptz not null default now());
create table ten287_bot.alerts (id bigserial primary key, mode text not null, book text not null default 'Superbet', event_id bigint not null,
  side text not null default 'home', tier text, player_a text, player_b text, side_player text, eval_at timestamptz not null default now(),
  delivery text not null default 'unsent', created_at timestamptz not null default now());
create table drops_live.flip (event_key text, live_at timestamptz, p1 text, p2 text);
"""
LIVE = """
create function drops_live.sk(p text) returns text language sql immutable as $$ select drops_scope.sk(p) $$;
create function drops_live.gi(p text) returns text[] language sql immutable as $$ select drops_scope.inits(p) $$;
create function drops_live.ini_ok(a text, b text) returns boolean language sql immutable as $$
  select cardinality(drops_live.gi(a)) = 0 or cardinality(drops_live.gi(b)) = 0 or drops_live.gi(a) && drops_live.gi(b) $$;
create function drops_live.flips(p_from timestamptz) returns table(event_key text, live_at timestamptz, p1 text, p2 text, k1 text, k2 text)
  language sql stable as $$ select event_key, live_at, p1, p2, drops_live.sk(p1), drops_live.sk(p2) from drops_live.flip where live_at >= p_from $$;
"""
def fx(ek, a, b, typ):
    return {'event_key': ek, 'event_date': '__D0__', 'event_time': '12:00', 'first': a, 'second': b,
            'type': typ, 'qual': 'False', 'tournament': 'T', 'round': 'R'}
def ingest_fx(rows):
    rc, d = q("select to_char(now() at time zone 'UTC', 'YYYY-MM-DD')")
    return q("select public.drops_scope_ingest($j$" + json.dumps(rows).replace('__D0__', d) + "$j$::jsonb, 'test')", 'service_role')
def market(ev, code, who, occ="now() + interval '3 hours'"):
    q(f"insert into kalshi_rec.markets (ticker, event_ticker, player, occurrence_at, status) values "
      f"('{ev}-{code}', '{ev}', $${who}$$, {occ}, 'active') on conflict (ticker) do update set occurrence_at = excluded.occurrence_at")
def tick(ev, code, mins_ago, ask, size, vol=100):
    q(f"insert into kalshi_rec.ticks (ticker, event_ticker, yes_ask, yes_ask_size, volume, status, updated_at, seen_at, state_md5) values "
      f"('{ev}-{code}', '{ev}', {ask}, {size}, {vol}, 'active', now() - interval '{mins_ago} minutes', now() - interval '{mins_ago} minutes', md5(random()::text))")
def scan(min_depth='100'):
    return q("select kalshi_bot.load_ticks(now() - interval '14 days', now()); "
             f"select kalshi_bot.scan(now(), now(), 5, 'live', null, interval '10 minutes', interval '30 minutes', {min_depth})")
def alerts(ev):
    rc, out = q(f"select coalesce(string_agg(ticker || ':' || delivery, ',' order by id), '') from kalshi_bot.alerts where event_ticker = '{ev}'")
    return out

try:
    pg.roles()
    rc, out = q(STUB); check('stubs (pg_net, vault, other bots, live-flip log)', rc == 0, out)
    rc, err = pg.file(SCOPE); check('drops-scope.sql applies', rc == 0, err)
    rc, out = q(LIVE); check('drops_live helpers', rc == 0, out)
    for i in (1, 2):
        rc, err = pg.file(SQL); check(f'kalshi-drop-bot.sql applies (pass {i}: idempotent)', rc == 0, err)
    rc, out = q("select count(*) from information_schema.triggers where trigger_name = 'drops_scope_scope' and event_object_schema = 'kalshi_bot'")
    check('the ATP-only scope trigger sits on kalshi_bot.alerts', out == '1', out)

    # recorder: fire, answer, ingest, dedupe
    rc, out = q("select kalshi_rec.tick()"); check('recorder tick fires a call', rc == 0, out)
    rc, rid = q("select id from kalshi_rec.requests where processed_at is null")
    body = {'markets': [
        {'ticker': 'KXATPMATCH-26NOV01VALSON-VAL', 'event_ticker': 'KXATPMATCH-26NOV01VALSON', 'yes_sub_title': 'Adolfo Daniel Vallejo',
         'occurrence_datetime': '2026-11-01T12:00:00Z', 'status': 'active', 'yes_ask_dollars': '0.4100', 'yes_ask_size_fp': '816.00',
         'yes_bid_dollars': '0.4000', 'yes_bid_size_fp': '1825.11', 'volume_fp': '5590.03', 'open_interest_fp': '5588.48', 'updated_time': '2026-11-01T07:05:27.651207Z'},
        {'ticker': 'KXATPMATCH-26NOV01VALSON-SON', 'event_ticker': 'KXATPMATCH-26NOV01VALSON', 'yes_sub_title': 'Lorenzo Sonego',
         'occurrence_datetime': '2026-11-01T12:00:00Z', 'status': 'active', 'yes_ask_dollars': '0.6000', 'yes_ask_size_fp': '1825.11',
         'yes_bid_dollars': '0.5900', 'yes_bid_size_fp': '816.00', 'volume_fp': '4100', 'open_interest_fp': '4000', 'updated_time': '2026-11-01T07:05:27.651207Z'}]}
    q(f"insert into net._http_response (id, status_code, content) values ({rid}, 200, $b${json.dumps(body)}$b$)")
    rc, out = q("select kalshi_rec.tick()"); check('the answer is ingested: two ticks', out == '2', out)
    rc, out = q(f"select status_code || '/' || n_items from kalshi_rec.requests where id = {rid}")
    check('the request is closed with its count', out == '200/2', out)
    rc, out = q("select kalshi_rec.ingest($b$" + json.dumps(body) + "$b$::jsonb, now())")
    check('the same answer again adds nothing (one tick per change)', out == '0', out)
    rc, out = q("select player_a || ' v ' || player_b || ' ' || n_markets from kalshi_bot.matches where event_ticker = 'KXATPMATCH-26NOV01VALSON'")
    check('two markets = one match', out == 'Lorenzo Sonego v Adolfo Daniel Vallejo 2', out)

    ingest_fx([fx(9001, 'Q. Halys', 'A. Fery', 'Atp Singles'), fx(9002, 'L. Tien', 'R. Opelka', 'Challenger Men Singles'),
               fx(9003, 'T. Thin', 'B. Book', 'Atp Singles'), fx(9004, 'S. Small', 'M. Move', 'Atp Singles'),
               fx(9005, 'F. Flip', 'L. Live', 'Atp Singles'), fx(9006, 'S. Sched', 'P. Past', 'Atp Singles')])

    # 1: the real drop
    E1 = 'KXATPMATCH-X1'
    market(E1, 'FER', 'Arthur Fery'); market(E1, 'HAL', 'Quentin Halys')
    tick(E1, 'HAL', 20, 0.40, 1000, 300); tick(E1, 'FER', 20, 0.61, 900, 200); tick(E1, 'HAL', 2, 0.43, 1000, 450)
    q("""select public.kalshi_book_ingest('[{"event_ticker":"KXATPMATCH-X1","liquidity":"431220.5","contracts":"650"}]'::jsonb)""")
    rc, out = scan(); check('scan runs', rc == 0, out)
    check('2.5 → 2.326 (−7.0%), $400 → $430 at the price → one alert, posted', alerts(E1) == f'{E1}-HAL:unsent', alerts(E1))
    rc, msg = q(f"select message from kalshi_bot.alerts where event_ticker = '{E1}'")
    check('message: purple header', msg.startswith('🟣 KALSHI DROP'), msg)
    check('message: decimal prices', '🟠 Pre-drop: 2.5 @' in msg and '🔴 Odds now: 2.326 @' in msg, msg)
    check('message: liquidity at price in dollars', '💧 Liquidity at price: $400 → $430' in msg, msg)
    check('message: contracts traded live (450 + 200)', '📊 Traded on match: 650 contracts ($1 each)' in msg, msg)
    check('message: the whole match-winner book', '📚 Match-winner liquidity: $431,221 (as of ' in msg, msg)
    check('message: book line', '🏦 Bookmaker: Kalshi' in msg and '🎯 Line: Match Winner – Quentin Halys' in msg, msg)
    tick(E1, 'HAL', 1, 0.48, 2000, 500)
    scan(); check('a second drop inside 30 min → no second alert', alerts(E1) == f'{E1}-HAL:unsent', alerts(E1))

    # 2: Challenger fixture → held
    E2 = 'KXATPMATCH-X2'; market(E2, 'OPE', 'Reilly Opelka'); market(E2, 'TIE', 'Learner Tien')
    tick(E2, 'TIE', 20, 0.40, 1000); tick(E2, 'TIE', 2, 0.44, 1000)
    scan(); check('a Challenger fixture → held, never posted', alerts(E2) == f'{E2}-TIE:held: not ATP (Challenger Men Singles)', alerts(E2))
    # 3: thin book
    E3 = 'KXATPMATCH-X3'; market(E3, 'BOO', 'Bob Book'); market(E3, 'THI', 'Tom Thin')
    tick(E3, 'THI', 20, 0.40, 1000); tick(E3, 'THI', 2, 0.44, 100)
    scan(); check('$44 at the new price → no alert', alerts(E3) == '', alerts(E3))
    # 4: a 4% move
    E4 = 'KXATPMATCH-X4'; market(E4, 'MOV', 'Max Move'); market(E4, 'SMA', 'Sam Small')
    tick(E4, 'SMA', 20, 0.40, 1000); tick(E4, 'SMA', 2, 0.416, 1000)
    scan(); check('a 3.8% move → no alert', alerts(E4) == '', alerts(E4))
    # 5: past our live-flip sighting
    E5 = 'KXATPMATCH-X5'; market(E5, 'FLI', 'Fred Flip'); market(E5, 'LIV', 'Leo Live')
    tick(E5, 'FLI', 20, 0.40, 1000); tick(E5, 'FLI', 2, 0.45, 1000)
    q("insert into drops_live.flip values ('9005', now() - interval '5 minutes', 'F. Flip', 'L. Live')")
    scan(); check('a price after our live-flip sighting → no alert', alerts(E5) == '', alerts(E5))
    # 6: past Kalshi's scheduled time (no flip)
    E6 = 'KXATPMATCH-X6'; market(E6, 'PAS', 'Pat Past', "now() - interval '6 minutes'"); market(E6, 'SCH', 'Sid Sched', "now() - interval '6 minutes'")
    tick(E6, 'SCH', 20, 0.40, 1000); tick(E6, 'SCH', 2, 0.45, 1000)
    scan(); check('a price after the scheduled start (no flip seen) → no alert: the schedule only stops a feed', alerts(E6) == '', alerts(E6))

    rc, out = q("select kalshi_bot.tick()"); check('tick() runs', rc == 0, out)
    rc, out = q(f"select delivery from kalshi_bot.alerts where event_ticker = '{E1}'")
    check('no Vault secret → "unsent: no vault secret", nothing sent', out == 'unsent: no vault secret', out)
    rc, out = q("select kalshi_bot.report(24)->>'matches'")
    check('report() reads back without pg_cron', rc == 0 and int(out or 0) >= 6, out)
    rc, out = q("select public.kalshi_book_ingest('[]'::jsonb)", 'anon')
    check('anon cannot write books', rc != 0, out)

    rc, out = scan(min_depth='null')
    check('CONTROL: with no minimum the thin drop alerts', alerts(E3) == f'{E3}-THI:unsent', alerts(E3))
finally:
    pg.close()
print(f'test-kalshi-drop-bot-sql: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
