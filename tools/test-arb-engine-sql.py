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
Live (founder 2026-11-02): arb_live_push() posts a started ATP Kalshi × Polymarket gap >= live_min with >= min_liq to
  lock in, once per match + direction per live_cooldown; arb_now() lists live gaps only while the worker is fresh.
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
  event_status text, src text);
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
    # the live database as it stood on 4 Nov: the one-argument send of 2 Nov still beside the two-argument one
    q("create schema if not exists arb; create or replace function arb.send(p_text text) returns bigint language sql as $$ select null::bigint $$")
    for i in (1, 2):
        rc, err = pg.file(SQL); check(f'arb-engine.sql applies (pass {i}: idempotent)', rc == 0, err)
    rc, out = q("select count(*) from pg_proc where proname = 'send' and pronamespace = 'arb'::regnamespace")
    check('one arb.send after the upgrade (the one-argument one of 2 Nov dropped)', out == '1', out)
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
    q("insert into ten287_rec.ticks (book, event_id, back_home, back_away, depth_home, depth_away, book_updated_at, seen_at, event_status, src) values ('Polymarket', 2, 3.50, 1.40, 50, 50, now(), now(), 'pending', 'clob')")
    # the Polymarket switch (4 Nov): our recorder's event for Halys / Fery (src clob) AND odds-api.io's older copy of the
    # same match, still 'pending' — only ours is read
    q(f"insert into ten287_rec.events values (3, 'Halys, Quentin', 'Fery, Arthur', {START}, 'pending', 'ATP - Paris', 'ATP')")
    q(f"insert into ten287_rec.events values (900000000001, 'Quentin Halys', 'Arthur Fery', {START}, 'pending', 'ATP - Paris', 'ATP')")
    q("insert into ten287_rec.ticks (book, event_id, back_home, back_away, depth_home, depth_away, book_updated_at, seen_at, event_status, src) values ('Polymarket', 3, 2.10, 1.90, 500, 500, now() - interval '10 minutes', now() - interval '10 minutes', 'pending', 'updated')")
    q("insert into ten287_rec.ticks (book, event_id, back_home, back_away, depth_home, depth_away, book_updated_at, seen_at, event_status, src) values ('Polymarket', 900000000001, 2.00, 2.00, 500, 500, now(), now(), 'pending', 'clob')")
    q("insert into ten287_rec.requests values (1, 'updated', 'Superbet', now(), now(), 200), (2, 'updated', 'Polymarket', now(), now(), 200)")
    # Napoleon Sports BE (founder 2026-11-05: a soft source beside Superbet) at 2.00 / 1.80 — no divergence, no better arb leg;
    # Betano recorded at 3.00 / 3.00 but NOT in config.soft_books: never a source (it would diverge on both players)
    q("insert into ten287_rec.ticks (book, event_id, back_home, back_away, book_updated_at, seen_at, event_status) values ('Napoleon Sports BE', 1, 2.00, 1.80, now(), now(), 'pending'), ('Betano', 1, 3.00, 3.00, now(), now(), 'pending')")
    q("insert into ten287_rec.requests values (3, 'updated', 'Napoleon Sports BE', now(), now(), 200), (4, 'updated', 'Betano', now(), now(), 200)")
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
    check('every source joined the match once: Bet105, Kalshi, Polymarket (ours; odds-api.io\'s stale copy ignored, else both drop as ambiguous), Superbet',
          srcs == ['Bet105', 'Kalshi', 'Napoleon Sports BE', 'Polymarket', 'Superbet'], srcs)
    nap = [x for x in fair.get('Q. Halys', {}).get('sources', []) if x['source'] == 'Napoleon Sports BE']
    check('Napoleon Sports BE is a soft source at its own prices (2.00 / 1.80); Betano, not in config.soft_books, is not read',
          len(nap) == 1 and nap[0].get('group') == 'soft' and nap[0].get('first') == 2.0 and nap[0].get('second') == 1.8, nap)
    q("update arb.config set soft_books = array['Superbet']")
    srcs2 = sorted(s['source'] for s in {f['first']: f for f in opps().get('fair', [])}.get('Q. Halys', {}).get('sources', []))
    check('config.soft_books decides: Superbet alone → Napoleon is not a source', srcs2 == ['Bet105', 'Kalshi', 'Polymarket', 'Superbet'], srcs2)
    q("update arb.config set soft_books = array['Superbet', 'Napoleon Sports BE']")
    pm = [x for x in fair.get('Q. Halys', {}).get('sources', []) if x['source'] == 'Polymarket']
    check('the Polymarket price is our recorder\'s (2.00), never odds-api.io\'s 2.10', bool(pm) and pm[0]['first'] == 2.0, pm)
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
          and '✅ Back A. Fery @ 2 on Bet105 · bookmaker' in msg
          and '💰 Max: stake $416.84 on Q. Halys + $499.29 on A. Fery = $916.13 → pays $999.23 whoever wins → profit $83.09 (+9.07%)' in msg
          and '⚠️ Retirement rules differ' in msg, msg)
    rc, msg = q("select message from arb.alerts where kind = 'divergence' and detail->>'source' = 'Superbet'")
    check('DIVERGENCE message', msg.startswith('📐 DIVERGENCE') and '🎯 Superbet: Q. Halys @ 2.2' in msg and '📏 Fair (Bet105, margin removed): 1.95 → +12.8% above fair' in msg, msg)
    rc, out = q("select delivery from arb.alerts limit 1"); check('no Vault secret → recorded, nothing sent', out == 'unsent: no vault secret', out)
    rc, out = q("select (public.arb_now()->>'at') is not null", 'anon'); check('anon reads arb_now()', rc == 0 and out == 't', out)
    rc, out = q("select (select at from arb.snap) is not null and jsonb_array_length((select opps from arb.snap)->'arbs') = 1")
    check('tick() stores its result; arb_now() serves the stored copy (page read under the anon statement limit)', out == 't', out)
    q("update arb.snap set opps = jsonb_set(opps, '{arbs}', '[]'::jsonb)")
    rc, out = q("select jsonb_array_length(public.arb_now()->'arbs')", 'anon'); check('a fresh stored copy is what the page gets (not recomputed)', out == '0', out)
    q("update arb.snap set at = now() - interval '9 minutes'")
    rc, out = q("select jsonb_array_length(public.arb_now()->'arbs')", 'anon'); check('a stored copy 9 min old is still served (a few skipped ticks never time the page out)', out == '0', out)
    q("update arb.snap set at = now() - interval '11 minutes'")
    rc, out = q("select jsonb_array_length(public.arb_now()->'arbs')", 'anon'); check('a stored copy older than 10 min is recomputed', out == '1', out)
    # one Telegram re-send for a failed delivery (founder 2026-11-03)
    q("insert into vault.decrypted_secrets values ('ten287_telegram_bot_token', 't'), ('ten287_telegram_chat_id', 'c')")
    q("create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as $$ select nextval('net.seq') $$")
    lo = q("select min(id) from arb.alerts")[1]; hi = q("select max(id) from arb.alerts")[1]
    q(f"update arb.alerts set delivery = 'failed: Timeout of 10000 ms reached', created_at = now() where id = {lo}")
    q(f"update arb.alerts set delivery = 'failed: HTTP 400', created_at = now() - interval '20 minutes' where id = {hi}")
    q("select arb.tick()")
    rc, out = q(f"select string_agg(retries || ':' || delivery, ',' order by id) from arb.alerts where id in ({lo}, {hi})")
    check('a fresh failed send is re-sent once (queued, retries 1); a 20-min-old one is left alone', out == '1:queued,0:failed: HTTP 400', out)
    q(f"update arb.alerts set delivery = 'failed: again' where id = {lo}"); q("select arb.tick()")
    rc, out = q(f"select retries || ':' || delivery from arb.alerts where id = {lo}")
    check('never a second re-send', out == '1:failed: again', out)
    q("delete from vault.decrypted_secrets")
    rc, out = q("select count(*) from arb.alerts", 'anon'); check('anon cannot read the alerts', rc != 0, out)
    rc, out = q("select arb.report(24)->>'arbsNow'"); check('report() without pg_cron', rc == 0 and out == '1', out)

    # withdrawals (founder 2026-11-03, Davidovich Fokina v Kouame): a match api-tennis marks over / not to be played
    q("update arb.config set arb_max = 5")
    o = opps(); check('a pre-match arb above arb_max is never offered (the 9.07% goes; the next pair, +4.76%, stays)', [a['profit'] for a in o['arbs']] == [4.76], o['arbs'])
    q("update arb.config set arb_max = 10")
    o = opps(); check('CONTROL: arb_max 10 → the 9.07% arb is back', len(o['arbs']) == 1, o['arbs'])
    w = fx(9001, 'Q. Halys', 'A. Fery', 'Atp Singles'); w['status'] = 'Walk Over'
    rc, out = q("select public.drops_scope_ingest($j$" + json.dumps([w]).replace('__D1__', d1) + "$j$::jsonb, 'test')", 'service_role')
    o = opps(); check('a walkover fixture leaves no price, no divergence and no arb', 'Q. Halys' not in [f['first'] for f in o['fair']]
          and not any(d['first'] == 'Q. Halys' for d in o['divergences']) and o['arbs'] == [], o)
    rc, out = q("select arb.fixture_closed(s, null) from unnest(array['Retired','Finished','Cancelled','Awarded','Set 2','Not Started','']) s")
    check('closed: Retired / Finished / Cancelled / Awarded; open: Set 2, not started, blank', out.split() == ['t', 't', 't', 't', 'f', 'f', 'f'], out)
    w['status'] = None
    q("select public.drops_scope_ingest($j$" + json.dumps([w]).replace('__D1__', d1) + "$j$::jsonb, 'test')", 'service_role')
    o = opps(); check('CONTROL: the same fixture not closed → priced again', 'Q. Halys' in [f['first'] for f in o['fair']], o['fair'])
    q("update public.kibl_now_price set written_at = now() - interval '10 minutes'")
    o = opps(); check('a stale Bet105 heartbeat → no fair price, no divergence', o['fair'] == [] and o['divergences'] == [], o)

    # LIVE (founder 2026-11-02): the in-play Kalshi × Polymarket worker's push
    def gap(**kw):
        g = {'match': 'Alex Molcan vs Titouan Droguet', 'event': 'Rolex Paris Masters', 'kalshiEvent': 'KXATPMATCH-26NOV02MOLDRO',
             'dir': 'polyA+kalshiB', 'polyName': 'Alex Molcan', 'kalName': 'Titouan Droguet', 'polyDec': 2.222, 'polyEff': 2.17,
             'polyLiq': 900, 'kalDec': 2.083, 'kalEff': 2.02, 'kalLiq': 480, 'edge': 2.4, 'contracts': 500, 'stake': 470,
             'polyStake': 230.41, 'kalStake': 239.59, 'payout': 500, 'profitUsd': 30,
             'stakePoly': 48.2, 'stakeKalshi': 51.8, 'inPlay': True, 'started': True,
             'phase': 'changeover', 'score': '6–3 2–1', 'boardStatus': 'Set 2',
             'polyAt': '2026-11-02T12:00:00Z', 'kalAt': '2026-11-02T12:00:01Z'}
        g.update(kw); return g
    def push(gaps):
        return q("select public.arb_live_push($j$" + json.dumps({'gaps': gaps, 'worker': {'pairs': 3}}) + "$j$::jsonb)", 'service_role')
    rc, out = q("select public.arb_live_push('{}'::jsonb)", 'anon'); check('anon cannot push live gaps', rc != 0, out)
    rc, out = push([gap(), gap(dir='polyB+kalshiA', edge=0.6), gap(kalshiEvent='KXATPMATCH-X', dir='d2', stake=40),
                    gap(kalshiEvent='KXATPMATCH-Y', started=False), gap(kalshiEvent='KXATPCHALLENGERMATCH-Z')])
    check('live push posts only the one that qualifies (>= 1%, >= $100 to lock in, started, ATP tour)', rc == 0 and out == '1', out)
    rc, out = push([gap()]); check('the same match + direction inside the live cooldown posts nothing', out == '0', out)
    rc, out = push([gap(kalshiEvent='KXATPMATCH-P1', phase='point'), gap(kalshiEvent='KXATPMATCH-P2', phase=None),
                    gap(kalshiEvent='KXATPMATCH-P3', boardStatus='Retired'), gap(kalshiEvent='KXATPMATCH-P4', boardStatus='Walk Over')])
    check('never during a point, without a board phase, or on a retired / walkover match', out == '0', out)
    rc, out = push([gap(kalshiEvent='KXATPMATCH-P5', phase='set'), gap(kalshiEvent='KXATPMATCH-P6', phase='game')])
    check('a set break and a new game do post', out == '2', out)
    rc, out = q("select message from arb.alerts where kind = 'live'")
    check('LIVE message: dollars per leg, total, payout, profit (founder 2026-11-04), the break',
          out.startswith('⚡ LIVE ARB') and '✅ Stake $230.41 on Alex Molcan @ 2.222 on Polymarket (after fee 2.17)' in out
          and '✅ Stake $239.59 on Titouan Droguet @ 2.083 on Kalshi (after fee 2.02)' in out
          and '💰 Total $470.00 → pays $500.00 whoever wins → profit $30.00 (+2.40%)' in out
          and 'stakes 48.2%' not in out and '🪑 Changeover (players sit) · 6–3 2–1' in out, out)
    a = json.loads(q("select public.arb_now()", 'anon')[1])
    check('arb_now(): live list = the last push\'s qualifying gaps, feed on', a.get('liveOn') is True and sorted(g['kalshiEvent'] for g in a.get('live') or []) == ['KXATPMATCH-P5', 'KXATPMATCH-P6'] and a['config'].get('liveMin') == 1, a.get('live'))
    q("update arb.live_state set at = now() - interval '5 minutes'")
    a = json.loads(q("select public.arb_now()", 'anon')[1])
    check('a stale worker (no push for 90 s) → no live list, feed off', a.get('liveOn') is False and a.get('live') is None, a.get('live'))
    q("update arb.config set live_min = 5"); push([gap(kalshiEvent='KXATPMATCH-W')])
    rc, out = q("select count(*) from arb.alerts where kind = 'live'"); check('CONTROL: live_min 5 → a 2.4% gap posts nothing', out == '3', out)
    # the chat by kind (founder 2026-11-04) + euros
    q("create table if not exists net.posts (id bigserial, chat text, txt text)")
    q("create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as $$ insert into net.posts (chat, txt) values (body->>'chat_id', body->>'text'); select nextval('net.seq') $$")
    q("delete from vault.decrypted_secrets")
    q("insert into vault.decrypted_secrets values ('ten287_telegram_bot_token', 't'), ('ten287_telegram_chat_id', 'DROP')")
    q("select arb.send('a', 'live'), arb.send('b', 'divergence'), arb.send('c', 'arb')")
    rc, out = q("select string_agg(chat, ',' order by id) from net.posts")
    check('no arbitrage chat stored → every kind still reaches the drop chat (never lost)', out == 'DROP,DROP,DROP', out)
    q("delete from net.posts"); q("insert into vault.decrypted_secrets values ('arb_telegram_chat_id', 'ARB')")
    q("select arb.send('a', 'live'), arb.send('b', 'divergence'), arb.send('c', 'arb')")
    rc, out = q("select string_agg(chat, ',' order by id) from net.posts")
    check('every kind → the arbitrage chat (founder 2026-11-05: ⚖️ pre-match arb too)', out == 'ARB,ARB,ARB', out)
    rc, out = q("select arb.money(1234.5), arb.money(12.5)")
    check('no ECB rate yet → amounts stay in dollars', out.split('|') == ['$1,235', '$12.50'], out)
    q("update arb.fx set asked_at = null, req = null"); q("select arb.fx_tick()")
    rc, rid = q("select req from arb.fx"); check('tick asks the ECB rate (pg_net)', rid.isdigit(), rid)
    q(f"""insert into net._http_response (id, status_code, content) values ({rid}, 200, '{{"amount":1.0,"base":"USD","date":"' || to_char(current_date, 'YYYY-MM-DD') || '","rates":{{"EUR":0.9}}}}')""")
    q("select arb.fx_tick()")
    rc, out = q("select usd_eur, req is null from arb.fx"); check('the answer is stored on the next tick', out == '0.9|t', out)
    rc, out = q("select arb.money(1234.5), arb.money(12.5)")
    check('amounts in euros first, dollars beside them', out.split('|') == ['€1,111 ($1,235)', '€11.25 ($12.50)'], out)
    q("update arb.fx set rate_date = current_date - 5")
    rc, out = q("select arb.money(12.5)"); check('a rate older than 4 days is not used', out == '$12.50', out)
    q("update arb.fx set rate_date = current_date")
    rc, out = q("select arb.render_live($j$" + json.dumps(gap()) + "$j$::jsonb)")
    check('the live alert shows euros (dollars beside)', '✅ Stake €207.37 ($230.41) on Alex Molcan' in out and 'pays €450.00 ($500.00) whoever wins → profit €27.00 ($30.00)' in out, out)
    q("update public.kibl_now_price set written_at = now()")
    q("update arb.config set div_min = 50")
    o = opps(); check('CONTROL: div_min 50 → no divergence (the threshold decides)', o['divergences'] == [], o['divergences'])
finally:
    pg.close()
print(f'test-arb-engine-sql: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
