#!/usr/bin/env python3
"""The arbitrage + divergence engine (tools/arb-engine.sql) on a REAL throwaway Postgres.

Applies the real tools/drops-scope.sql (the api-tennis fixture spine) and tools/kalshi-drop-bot.sql (the Kalshi recorder
tables), stubs the Kibl stream (kibl_now_card + heartbeat), the odds-api.io recorder (ten287_rec), pg_net and an empty
Vault, then checks one match where every source has a price:
  fair = Bet105 with the margin removed; Kalshi's effective price carries its taker fee (0.07 q (1-q));
  divergences: Superbet and Kalshi on Halys (>= 5% above fair) and nothing under 5%;
  the best arbitrage = Halys on Kalshi + Fery on Bet105, +9.07% after fees, stakes by 1/e, retirement flag ON (prediction
  market v bookmaker); two legs from the same source never pair; a thin Polymarket book (< $100) is not used; a
  Challenger fixture is not on the spine; a stale Bet105 heartbeat leaves no fair price (so no divergence);
  tick() posts each opportunity once per cooldown (no Vault secret -> recorded, nothing sent); arb_now() is readable by
  anon, the alerts table is not. CONTROL: div_min 50 -> no divergence.
No Postgres binaries on this machine -> SKIP out loud (never a pass); CI runners carry them."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pinarch_pg import PG
HERE = os.path.dirname(os.path.abspath(__file__))
SCOPE, KALSHI, SQL = (os.path.join(HERE, f) for f in ('drops-scope.sql', 'kalshi-drop-bot.sql', 'arb-engine.sql'))
pg = PG()
if not pg.available():
    print(f'SKIP  test-arb-engine-sql: {pg.why} — NOT A PASS (the code gate runs it)'); sys.exit(0)
q = pg.q
passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('  PASS ', name)
    else: failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-600:])

STUB = """
create schema ten280_bot; create schema ten287_bot; create schema ten287_rec; create schema drops_live; create schema vault; create schema net;
create table net._http_response (id bigint primary key, status_code int, content text, error_msg text, created timestamptz default now());
create sequence net.seq;
create function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
  returns bigint language sql as $$ select nextval('net.seq') $$;
create table vault.decrypted_secrets (name text, decrypted_secret text);
create table public.kibl_fixtures (fixture_id bigint primary key, scheduled_start timestamptz);
create table ten280_bot.alerts (id bigserial primary key, mode text not null, fixture_id bigint not null, side_id int not null default 2,
  tier text, player_a text, player_b text, side_player text, eval_at timestamptz not null default now(),
  delivery text not null default 'unsent', created_at timestamptz not null default now());
create table ten287_bot.alerts (id bigserial primary key, mode text not null, book text not null default 'Superbet', event_id bigint not null,
  side text not null default 'home', tier text, player_a text, player_b text, side_player text, eval_at timestamptz not null default now(),
  delivery text not null default 'unsent', created_at timestamptz not null default now());
create table ten287_rec.events (event_id bigint primary key, home text, away text, start_at timestamptz, status text, league text, tier text);
create table ten287_rec.ticks (id bigserial primary key, book text not null, event_id bigint not null, market text not null default 'ML',
  back_home numeric, back_away numeric, depth_home numeric, depth_away numeric, book_updated_at timestamptz, seen_at timestamptz not null,
  event_status text);
create table ten287_rec.requests (id bigint primary key, kind text, book text, fired_at timestamptz default now(), processed_at timestamptz, status_code int);
create table public.kibl_now_card (card_key text primary key, book text, book_name text, a_side text, a_price numeric, a_at timestamptz,
  b_side text, b_price numeric, b_at timestamptz, written_at timestamptz default now());
create table public.kibl_now_price (card_key text, side_key text, kind text, written_at timestamptz default now());
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
    return {'event_key': ek, 'event_date': '__D1__', 'event_time': '12:00', 'first': a, 'second': b,
            'type': typ, 'qual': 'False', 'tournament': 'T', 'round': 'R'}
START = "((current_date + 1)::timestamp + interval '12 hours') at time zone 'UTC'"
def opps():
    rc, out = q("select arb.opps()")
    return json.loads(out) if rc == 0 else {'error': out}

try:
    pg.roles()
    rc, out = q(STUB); check('stubs', rc == 0, out)
    for f, n in ((SCOPE, 'drops-scope.sql'), (None, 'drops_live'), (KALSHI, 'kalshi-drop-bot.sql')):
        rc, err = (pg.file(f) if f else q(LIVE)); check(f'{n} applies', rc == 0, err)
    for i in (1, 2):
        rc, err = pg.file(SQL); check(f'arb-engine.sql applies (pass {i}: idempotent)', rc == 0, err)
    rc, d1 = q("select to_char(current_date + 1, 'YYYY-MM-DD')")
    rc, out = q("select public.drops_scope_ingest($j$" + json.dumps([
        fx(9001, 'Q. Halys', 'A. Fery', 'Atp Singles'), fx(9002, 'T. Thin', 'B. Book', 'Atp Singles'),
        fx(9003, 'L. Tien', 'R. Opelka', 'Challenger Men Singles')]).replace('__D1__', d1) + "$j$::jsonb, 'test')", 'service_role')
    check('fixtures in', rc == 0, out)
    # Bet105: Fery 2.00 / Halys 1.90, worker beating
    q(f"insert into public.kibl_now_card values ('{d1}|fery|halys', 'bet105', 'Bet105', 'fery', 2.00, now(), 'halys', 1.90, now())")
    q(f"insert into public.kibl_now_card values ('{d1}|book|thin', 'bet105', 'Bet105', 'book', 2.00, now(), 'thin', 1.90, now())")
    q(f"insert into public.kibl_now_card values ('{d1}|opelka|tien', 'bet105', 'Bet105', 'opelka', 2.00, now(), 'tien', 1.90, now())")
    q("insert into public.kibl_now_price values ('__stream__', '__hb__', 'heartbeat', now())")
    # Superbet Halys 2.20 / Fery 1.80; Polymarket on the thin match with $50 at the price
    q(f"insert into ten287_rec.events values (1, 'Halys, Quentin', 'Fery, Arthur', {START}, 'pending', 'ATP - Paris', 'ATP')")
    q(f"insert into ten287_rec.events values (2, 'Thin, Tom', 'Book, Bob', {START}, 'pending', 'ATP - Paris', 'ATP')")
    q("insert into ten287_rec.ticks (book, event_id, back_home, back_away, book_updated_at, seen_at, event_status) values ('Superbet', 1, 2.20, 1.80, now(), now(), 'pending')")
    q("insert into ten287_rec.ticks (book, event_id, back_home, back_away, depth_home, depth_away, book_updated_at, seen_at, event_status) values ('Polymarket', 2, 3.50, 1.40, 50, 50, now(), now(), 'pending')")
    q("insert into ten287_rec.requests values (1, 'updated', 'Superbet', now(), now(), 200), (2, 'updated', 'Polymarket', now(), now(), 200)")
    # Kalshi: Halys 0.40 (2.5) / Fery 0.45, 1,000 contracts each
    q(f"insert into kalshi_rec.markets (ticker, event_ticker, player, occurrence_at, status) values ('KX-HF-HAL', 'KX-HF', 'Quentin Halys', {START}, 'active'), ('KX-HF-FER', 'KX-HF', 'Arthur Fery', {START}, 'active')")
    q("insert into kalshi_rec.ticks (ticker, event_ticker, yes_ask, yes_ask_size, status, updated_at, seen_at, state_md5) values "
      "('KX-HF-HAL', 'KX-HF', 0.40, 1000, 'active', now(), now(), 'a'), ('KX-HF-FER', 'KX-HF', 0.45, 1000, 'active', now(), now(), 'b')")
    q("insert into kalshi_rec.requests (id, processed_at, status_code) values (1, now(), 200)")

    rc, out = q("select arb.eff('Kalshi', 2.5), arb.eff('Superbet', 2.2), arb.eff('Polymarket', 2.0)")
    check('fees: Kalshi 0.40 + 0.07·0.4·0.6 → 2.399; Polymarket 0.50 + 0.05·0.5·0.5 → 1.951 (the docs formula); a bookmaker price as is',
          out == '2.399|2.2|1.951', out)
    o = opps()
    fair = {f['first']: f for f in o.get('fair', [])}
    check('fair = Bet105 without its margin: Halys 1.95 / Fery 2.053', fair.get('Q. Halys', {}).get('fairFirst') == 1.95 and fair['Q. Halys']['fairSecond'] == 2.053, o.get('fair'))
    srcs = sorted(s['source'] for s in fair.get('Q. Halys', {}).get('sources', []))
    check('every source joined the match once: Bet105, Kalshi, Superbet', srcs == ['Bet105', 'Kalshi', 'Superbet'], srcs)
    check('the Challenger fixture is not on the spine', 'L. Tien' not in fair, list(fair))
    dv = sorted((d['source'], d['player'], d['edge']) for d in o.get('divergences', []))
    check('divergences: Kalshi Halys +23.03%, Superbet Halys +12.82%; nothing under 5% (Kalshi Fery +4.2%)',
          dv == [('Kalshi', 'Q. Halys', 23.03), ('Superbet', 'Q. Halys', 12.82)], dv)
    arbs = o.get('arbs', [])
    a = arbs[0] if arbs else {}
    check('best arb: Halys on Kalshi + Fery on Bet105, +9.07% after fees',
          len(arbs) == 1 and a['legFirst']['source'] == 'Kalshi' and a['legSecond']['source'] == 'Bet105' and a['profit'] == 9.07, arbs)
    check('stakes split by 1/e: 45.5% / 54.5%', a.get('stakeFirst') == 45.5 and a.get('stakeSecond') == 54.5, a)
    check('retirement flag ON (prediction market v bookmaker)', a.get('retirementFlag') is True, a)
    check('the thin Polymarket book ($50 < $100) is not used', not any(d['source'] == 'Polymarket' for d in o['divergences']) and not any('Polymarket' in (x['legFirst']['source'], x['legSecond']['source']) for x in arbs), o)

    rc, out = q("select arb.tick()"); check('tick() posts the 3 opportunities', out == '3', out)
    rc, out = q("select arb.tick()"); check('a second tick inside the cooldown posts nothing', out == '0', out)
    rc, msg = q("select message from arb.alerts where kind = 'arb'")
    check('ARB message: header, both legs, profit, the retirement warning',
          msg.startswith('⚖️ ARB') and '✅ Back Q. Halys @ 2.5 on Kalshi (after fee 2.399) · liquidity $400' in msg
          and '✅ Back A. Fery @ 2 on Bet105 · bookmaker' in msg and '💰 Locked-in: +9.07% after fees · stakes 45.5% / 54.5%' in msg
          and '⚠️ Retirement rules differ' in msg, msg)
    rc, msg = q("select message from arb.alerts where kind = 'divergence' and detail->>'source' = 'Superbet'")
    check('DIVERGENCE message', msg.startswith('📐 DIVERGENCE') and '🎯 Superbet: Q. Halys @ 2.2' in msg and '📏 Fair (Bet105, margin removed): 1.95 → +12.8% above fair' in msg, msg)
    rc, out = q("select delivery from arb.alerts limit 1"); check('no Vault secret → recorded, nothing sent', out == 'unsent: no vault secret', out)
    rc, out = q("select (public.arb_now()->>'at') is not null", 'anon'); check('anon reads arb_now()', rc == 0 and out == 't', out)
    rc, out = q("select count(*) from arb.alerts", 'anon'); check('anon cannot read the alerts', rc != 0, out)
    rc, out = q("select arb.report(24)->>'arbsNow'"); check('report() without pg_cron', rc == 0 and out == '1', out)

    q("update public.kibl_now_price set written_at = now() - interval '10 minutes'")
    o = opps(); check('a stale Bet105 heartbeat → no fair price, no divergence', o['fair'] == [] and o['divergences'] == [], o)
    q("update public.kibl_now_price set written_at = now()")
    q("update arb.config set div_min = 50")
    o = opps(); check('CONTROL: div_min 50 → no divergence (the threshold decides)', o['divergences'] == [], o['divergences'])
finally:
    pg.close()
print(f'test-arb-engine-sql: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
