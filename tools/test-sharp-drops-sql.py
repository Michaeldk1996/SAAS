#!/usr/bin/env python3
"""Sharp drop alerts (tools/sharp-drops.sql) on a REAL throwaway Postgres — rules: .claude/rules/sharp-drops.md

Stubs pg_net (http_get / http_post + _http_response), Vault, the Kibl tables, the live-flip log and the Pinnacle archive,
applies the real tools/drops-scope.sql, then tools/sharp-drops.sql twice (idempotent), and checks:
  scan: a 2.5% Bet105 drop within 5 minutes on a joined ATP fixture records ONE alert with the no-vig "bet at" price,
  the level, the steps, the minutes to the start and no Kalshi price (Kalshi not installed); a 1.9% drop, a drop
  measured over 6 minutes, a drop after the live-flip, a drop more than 180 min before the start, a second drop inside
  the cooldown and a women's fixture record nothing; ATP qualifying and Challenger get their levels.
  deliver: the founder's default (favourite < 1.80, 2–3%) reaches a linked admin; a non-admin is skipped while beta_only;
  a member whose price filter fails gets nothing; one alert per player per match; live off → recorded 'not sent: live off'.
  telegram: '/start CODE' links the member's chat; '/stop' pauses him (nothing delivered); a group chat is ignored.
  grade: a win and a loss are graded on the Oddspapi close (no-vig, oriented by name), a walkover is void, a retirement
  'no units'; a match not over yet is not graded. Append-only: an alert or a grade cannot be updated or deleted.
  member upsert: settings written, chat columns kept. CONTROL: with the price filter removed the skipped member gets it.
No Postgres binaries on this machine -> SKIP out loud (never a pass); CI runners carry them."""
import os, sys, json, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pinarch_pg import PG
HERE = os.path.dirname(os.path.abspath(__file__))
SCOPE, SQL = os.path.join(HERE, 'drops-scope.sql'), os.path.join(HERE, 'sharp-drops.sql')
pg = PG()
if not pg.available():
    print(f'SKIP  test-sharp-drops-sql: {pg.why} — NOT A PASS (the code gate runs it)'); sys.exit(0)
q = pg.q
passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('  PASS ', name)
    else: failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-600:])

STUB = """
create schema ten280_bot; create schema ten287_bot; create schema vault; create schema net;
create table net._http_response (id bigint primary key, status_code int, content text, error_msg text, created timestamptz default now());
create sequence net.seq;
create table net.sent (id bigint, url text, body jsonb);
create function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
  returns bigint language plpgsql as $$ declare i bigint := nextval('net.seq'); begin insert into net.sent values (i, url, null); return i; end $$;
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
  returns bigint language plpgsql as $$ declare i bigint := nextval('net.seq'); begin insert into net.sent values (i, url, body); return i; end $$;
create table vault.decrypted_secrets (name text, decrypted_secret text);
insert into vault.decrypted_secrets values ('ten287_telegram_bot_token', 'TESTTOKEN');
create table public.kibl_fixtures (fixture_id bigint primary key, league_id int, player1_name text, player2_name text, scheduled_start timestamptz);
create table public.kibl_line_observations (fixture_id bigint, side_id int, price_decimal numeric, inserted_on timestamptz, observed_at timestamptz,
  is_opener boolean, row_key text, feed_source_id int default 171, market_type_id int default 1, segment_id int default 1,
  betting_type_id int default 1, is_live boolean default false);
create table public.kibl_now_history (fixture_id bigint, card_key text, side_key text, price numeric, kibl_inserted_on timestamptz,
  written_at timestamptz, row_key text);
create table public.live_flip_log_current (event_key text, first_live_seen_at timestamptz);
create table public.pinnacle_archive_close (id bigserial primary key, event_key bigint, p1 numeric, p2 numeric, p1_name text, p2_name text,
  label text, supersedes bigint);
create table ten280_bot.alerts (id bigserial primary key, mode text not null, fixture_id bigint not null, side_id int not null default 2,
  tier text, player_a text, player_b text, side_player text, eval_at timestamptz not null default now(),
  delivery text not null default 'unsent', created_at timestamptz not null default now());
create table ten287_bot.alerts (id bigserial primary key, mode text not null, book text not null default 'Superbet', event_id bigint not null,
  side text not null default 'home', tier text, player_a text, player_b text, side_player text, eval_at timestamptz not null default now(),
  delivery text not null default 'unsent', created_at timestamptz not null default now());
create schema ten287_rec; create table ten287_rec.events (event_id bigint primary key, start_at timestamptz);
"""
NOW = dt.datetime.now(dt.timezone.utc)
def iso(m): return (NOW + dt.timedelta(minutes=m)).strftime('%Y-%m-%d %H:%M:%S+00')
def fixture(ek, a, b, typ, mins, qual='False', status='', winner=''):
    t = NOW + dt.timedelta(minutes=mins)
    return {'event_key': ek, 'event_date': t.strftime('%Y-%m-%d'), 'event_time': t.strftime('%H:%M'), 'first': a, 'second': b,
            'type': typ, 'qual': qual, 'tournament': 'Testopen', 'round': 'R1', 'status': status, 'winner': winner}
def kibl(fid, league, a, b, mins):
    q(f"insert into public.kibl_fixtures values ({fid}, {league}, $${a}$$, $${b}$$, '{iso(mins)}')")
def tick(fid, side, mins_ago, price, known_lag_s=2):
    at = NOW - dt.timedelta(minutes=mins_ago)
    known = at + dt.timedelta(seconds=known_lag_s)
    q(f"insert into public.kibl_line_observations (fixture_id, side_id, price_decimal, inserted_on, observed_at, row_key) values "
      f"({fid}, {side}, {price}, '{at.isoformat()}', '{known.isoformat()}', md5(random()::text))")
def scan():
    q("update sharp_bot.config set last_scan_at = now() - interval '40 minutes'")
    return q("select sharp_bot.load_ticks(now() - interval '45 minutes', now()); select sharp_bot.scan(now())")
def alerts(fid):
    rc, out = q(f"select coalesce(string_agg(side_id || ':' || level, ',' order by id), '') from sharp_bot.alerts where fixture_id = {fid}")
    return out

try:
    pg.roles()
    rc, out = q(STUB); check('stubs', rc == 0, out)
    rc, err = pg.file(SCOPE); check('drops-scope.sql applies', rc == 0, err)
    for i in (1, 2):
        rc, err = q(open(SQL).read()); check(f'sharp-drops.sql applies (pass {i}: idempotent)', rc == 0 and 'ERROR' not in err, err)

    fx = [fixture(7001, 'Q. Halys', 'A. Fery', 'Atp Singles', 90), fixture(7002, 'T. Small', 'M. Move', 'Atp Singles', 90),
          fixture(7003, 'S. Slow', 'O. Ver', 'Atp Singles', 90), fixture(7004, 'F. Flip', 'L. Live', 'Atp Singles', 90),
          fixture(7005, 'E. Early', 'L. Lister', 'Atp Singles', 400), fixture(7006, 'W. Woman', 'S. Sister', 'Wta Singles', 90),
          fixture(7007, 'Q. Qualy', 'R. Round', 'Atp Singles', 90, qual='True'), fixture(7008, 'C. Chall', 'H. Hall', 'Challenger Men Singles', 90),
          fixture(7009, 'D. Dog', 'F. Fav', 'Atp Singles', 90)]
    rc, out = q("select public.drops_scope_ingest($j$" + json.dumps(fx) + "$j$::jsonb, 'test')", 'service_role')
    check('fixtures ingested', rc == 0, out)
    kibl(1, 19, 'Quentin Halys', 'Arthur Fery', 90); kibl(2, 19, 'Tom Small', 'Max Move', 90); kibl(3, 19, 'Sam Slow', 'Oscar Ver', 90)
    kibl(4, 19, 'Fred Flip', 'Leo Live', 90); kibl(5, 19, 'Ed Early', 'Lou Lister', 400); kibl(6, 19, 'Wanda Woman', 'Sue Sister', 90)
    kibl(7, 19, 'Quinn Qualy', 'Rob Round', 90); kibl(8, 537, 'Carl Chall', 'Hal Hall', 90); kibl(9, 19, 'Dan Dog', 'Finn Fav', 90)

    # 1 Halys 1.70 -> 1.6575 (2.5%) in 3 min, Fery 2.20 steady → alert, ATP
    tick(1, 2, 20, 1.70); tick(1, 3, 20, 2.20); tick(1, 2, 3, 1.66)
    # 2 a 1.9% drop
    tick(2, 2, 20, 1.60); tick(2, 3, 20, 2.40); tick(2, 2, 3, 1.57)
    # 3 a 3% move spread over 6 minutes (no 5-min window holds 2%)
    tick(3, 2, 20, 1.70); tick(3, 3, 20, 2.20); tick(3, 2, 9, 1.69); tick(3, 2, 6, 1.68); tick(3, 2, 2, 1.67)
    # 4 already live
    q("insert into public.live_flip_log_current values ('7004', now() - interval '1 minute')")
    tick(4, 2, 20, 1.70); tick(4, 3, 20, 2.20); tick(4, 2, 2, 1.60)
    # 5 start 400 min away (> 180)
    tick(5, 2, 20, 1.70); tick(5, 3, 20, 2.20); tick(5, 2, 2, 1.60)
    # 6 women's fixture
    tick(6, 2, 20, 1.70); tick(6, 3, 20, 2.20); tick(6, 2, 2, 1.60)
    # 7 ATP qualifying, 8 Challenger
    tick(7, 3, 20, 1.75); tick(7, 2, 20, 2.10); tick(7, 3, 2, 1.70)
    tick(8, 2, 20, 1.75); tick(8, 3, 20, 2.10); tick(8, 2, 2, 1.70)
    # 9 an underdog drop: 2.40 -> 2.34 (2.5%) — outside the default price filter (< 1.80)
    tick(9, 2, 20, 2.40); tick(9, 3, 20, 1.60); tick(9, 2, 2, 2.34)
    rc, out = scan(); check('scan runs', rc == 0, out)
    check('2.4% drop in 3 min on an ATP fixture → one alert, ATP', alerts(1) == '2:ATP', alerts(1))
    rc, out = q("select player || '|' || opponent || '|' || drop_pct || '|' || bet_at || '|' || steps || '|' || coalesce(kalshi_odds::text, 'none') "
                "|| '|' || (mins_to_start between 88 and 94) from sharp_bot.alerts where fixture_id = 1")
    exp_bet = round(1 / ((1 / 1.66) / (1 / 1.66 + 1 / 2.20)), 3)
    check('the alert: api-tennis names, drop on 2 dp, no-vig bet-at, 1 step, no Kalshi, minutes', out == f'Q. Halys|A. Fery|2.35|{exp_bet}|1|none|true', out)
    check('1.9% → nothing', alerts(2) == '', alerts(2))
    check('a move spread over 6+ minutes → nothing', alerts(3) == '', alerts(3))
    check('after the live-flip → nothing', alerts(4) == '', alerts(4))
    check('400 min before the start → nothing', alerts(5) == '', alerts(5))
    check("a women's fixture → nothing", alerts(6) == '', alerts(6))
    check('ATP qualifying level', alerts(7) == '3:ATP Q', alerts(7))
    check('Challenger level', alerts(8) == '2:CH', alerts(8))
    tick(1, 2, 1, 1.62)
    scan(); check('a second drop inside the 5-min cooldown → no second alert', alerts(1) == '2:ATP', alerts(1))

    # members
    rows = [{'uid': 'boss', 'name': 'Michael', 'admin': True, 'linkCode': 'sfy-abc', 'levels': ['ATP', 'ATP Q', 'CH', 'CH Q'],
             'dropMin': 2, 'dropMax': 3, 'priceMin': 1.01, 'priceMax': 1.8, 'windowMin': 180, 'books': ['Bet105', 'Kalshi'], 'tz': 'UTC'},
            {'uid': 'member', 'name': 'M', 'admin': False, 'linkCode': 'SFY-DEF', 'levels': ['ATP'], 'dropMin': 2, 'dropMax': 3,
             'priceMin': 1.01, 'priceMax': 1.8, 'windowMin': 180, 'books': ['Bet105'], 'tz': 'UTC'},
            {'uid': 'dogs', 'name': 'D', 'admin': True, 'linkCode': 'SFY-GHI', 'levels': ['ATP'], 'dropMin': 2, 'dropMax': 3,
             'priceMin': 2.0, 'priceMax': 3.0, 'windowMin': 180, 'books': ['Bet105'], 'tz': 'UTC'}]
    rc, out = q("select public.sharp_members_upsert($j$" + json.dumps(rows) + "$j$::jsonb)", 'service_role')
    check('member upsert (service role)', rc == 0 and '"upserted": 3' in out, out)
    rc, out = q("select public.sharp_members_upsert('[]'::jsonb)", 'anon')
    check('anon cannot call the member upsert', rc != 0, out)
    rc, out = q("select levels::text || '|' || drop_min || '|' || price_max from sharp_bot.members where uid = 'boss'")
    check('settings stored', out == '{ATP,"ATP Q",CH,"CH Q"}|2|1.8', out)

    # telegram linking
    rc, out = q("select sharp_bot.tg_poll()"); check('tg_poll fires getUpdates', rc == 0, out)
    rc, rid = q("select id from sharp_bot.tg_requests where processed_at is null")
    upd = {'ok': True, 'result': [
        {'update_id': 10, 'message': {'chat': {'id': 111, 'type': 'private'}, 'text': '/start SFY-ABC'}},
        {'update_id': 11, 'message': {'chat': {'id': 222, 'type': 'private'}, 'text': '/start sfy-def'}},
        {'update_id': 12, 'message': {'chat': {'id': 333, 'type': 'group'}, 'text': '/start SFY-GHI'}},
        {'update_id': 13, 'message': {'chat': {'id': 444, 'type': 'private'}, 'text': 'SFY-GHI'}}]}
    q(f"insert into net._http_response (id, status_code, content) values ({rid}, 200, $b${json.dumps(upd)}$b$)")
    rc, out = q("select sharp_bot.tg_poll()"); check('three private chats linked, the group ignored', out == '3', out)
    rc, out = q("select string_agg(uid || '=' || coalesce(chat_id::text, '-'), ',' order by uid) from sharp_bot.members")
    check('chat ids', out == 'boss=111,dogs=444,member=222', out)
    rc, out = q("select tg_offset from sharp_bot.config"); check('offset advanced past the last update', out == '14', out)
    rc, out = q("select count(*) from net.sent where url like '%/sendMessage' and body->>'chat_id' = '111'")
    check('a confirmation was sent to the linked chat', out == '1', out)
    rc, out = q("select public.sharp_members_upsert($j$" + json.dumps(rows[:1]) + "$j$::jsonb)", 'service_role')
    rc, out = q("select chat_id from sharp_bot.members where uid = 'boss'"); check('a settings upsert keeps the chat', out == '111', out)

    # deliver, live off
    rc, out = q("select sharp_bot.deliver(now())"); check('deliver runs (live off)', rc == 0, out)
    rc, out = q("select string_agg(d.uid || ':' || a.fixture_id || ':' || d.status, ',' order by d.uid, a.fixture_id) "
                "from sharp_bot.deliveries d join sharp_bot.alerts a on a.id = d.alert_id")
    check('admins get what passes their settings (default: Halys ATP, qualifying, Challenger; underdog member: the 2.34 drop); the non-admin is skipped (beta)',
          out == 'boss:1:not sent: live off,boss:7:not sent: live off,boss:8:not sent: live off,dogs:9:not sent: live off', out)
    rc, out = q("select message from sharp_bot.deliveries where uid = 'boss' order by id limit 1")
    check('message: header, names, bet-at, Bet105 line, no Kalshi line', out.startswith('⚡ SHARP DROP · ATP') and 'Q. Halys to beat A. Fery' in out
          and 'Bet at ' in out and 'Bet105 1.66' in out and 'Kalshi' not in out, out)
    q("update sharp_bot.config set live = true, beta_only = false")
    q("select sharp_bot.deliver(now())")
    rc, out = q("select count(*) from sharp_bot.deliveries where uid = 'boss'"); check('one alert per player per match (no repeat)', out == '3', out)
    rc, out = q("select count(*) from sharp_bot.deliveries where uid = 'member'")
    check('beta off → the member gets his ATP alert', out == '1', out)
    rc, out = q("select status from sharp_bot.deliveries where uid = 'member'")
    check('live on → queued to Telegram', out == 'queued', out)
    # /stop
    rc, _ = q("select sharp_bot.tg_poll()")
    rc, rid = q("select id from sharp_bot.tg_requests where processed_at is null order by id desc limit 1")
    q(f"""insert into net._http_response (id, status_code, content) values ({rid}, 200,
         $b${json.dumps({'ok': True, 'result': [{'update_id': 14, 'message': {'chat': {'id': 222, 'type': 'private'}, 'text': '/stop'}}]})}$b$)""")
    q("select sharp_bot.tg_poll()")
    rc, out = q("select tg_paused from sharp_bot.members where uid = 'member'"); check('/stop pauses', out == 't', out)

    # grading
    q("select public.drops_scope_ingest($j$" + json.dumps([fixture(7001, 'Q. Halys', 'A. Fery', 'Atp Singles', -300, status='Finished', winner='First Player'),
        fixture(7007, 'Q. Qualy', 'R. Round', 'Atp Singles', -300, qual='True', status='Finished', winner='First Player'),
        fixture(7008, 'C. Chall', 'H. Hall', 'Challenger Men Singles', -300, status='Walk Over'),
        fixture(7009, 'D. Dog', 'F. Fav', 'Atp Singles', 90)]) + "$j$::jsonb, 'test')", 'service_role')
    q("insert into public.pinnacle_archive_close (event_key, p1, p2, p1_name, p2_name, label) values "
      "(7001, 2.10, 1.80, 'A. Fery', 'Q. Halys', 'from Pinnacle history'), (7007, 1.60, 2.40, 'Q. Qualy', 'R. Round', 'captured')")
    rc, out = q("select sharp_bot.grade(now() + interval '1 day')"); check('grade runs', rc == 0, out)
    rc, out = q("select a.fixture_id || ':' || g.result || ':' || coalesce(g.close_price::text, '-') from sharp_bot.grades g join sharp_bot.alerts a on a.id = g.alert_id order by a.fixture_id")
    check('Halys W on close 1.80 (oriented by name); Round L on 2.40; Challenger walkover void; Dog not graded (not over)',
          out.split('\n') == ['1:W:1.80', '7:L:2.40', '8:void:-'], out)
    rc, out = q("select g.edge_pct = round((a.bet_at * (1/1.80) / (1/1.80 + 1/2.10) - 1) * 100, 2) and g.pl_bet105 = a.price - 1 "
                "from sharp_bot.grades g join sharp_bot.alerts a on a.id = g.alert_id where a.fixture_id = 1")
    check('edge = bet_at x no-vig close − 1; P&L at the Bet105 price', out == 't', out)
    rc, out = q("update sharp_bot.alerts set price = 9 where fixture_id = 1"); check('alerts are append-only', rc != 0, out)
    rc, out = q("delete from sharp_bot.grades"); check('grades are append-only', rc != 0, out)
    rc, out = q("select public.sharp_feed(30)::text", 'anon'); check('the page feed answers anon', rc == 0 and '"result": "W"' in out, out[:300])
    rc, out = q("select sharp_bot.tick()"); check('tick() runs end to end', rc == 0 and '"alerts"' in out, out)
    # the price before a drop is often hours old (a quiet pre-match market): tick() must still see it
    q("select public.drops_scope_ingest($j$" + json.dumps([fixture(7010, 'O. Old', 'P. Price', 'Atp Singles', 100)]) + "$j$::jsonb, 'test')", 'service_role')
    kibl(10, 19, 'Otto Old', 'Pete Price', 100)
    tick(10, 2, 150, 1.70); tick(10, 3, 150, 2.20); tick(10, 2, 1, 1.66)
    tick(10, 2, 1, 1.66, known_lag_s=20)              # the poller re-sees the same price: not a second step
    q("update sharp_bot.config set last_scan_at = now() - interval '5 minutes'")
    rc, out = q("select sharp_bot.tick()")
    check('tick(): a price unchanged for 2.5 hours, then a 2.4% drop → an alert', alerts(10) == '2:ATP', out + ' | ' + alerts(10))
    rc, out = q("select steps from sharp_bot.alerts where fixture_id = 10"); check('a re-sighting of the same price is not a second step', out == '1', out)
    rc, out = q("select sharp_bot.load_ticks(now() - interval '12 hours', now()) - sharp_bot.load_ticks(now() - interval '1 hour', now())")
    check('CONTROL: a 1-hour load drops exactly the two 2.5-hour-old prices (what the 45-minute window missed)', out.split('\n')[0] == '2', repr(out))
    rc, out = q("select sharp_bot.report(48)"); check('report', rc == 0 and '"graded": 3' in out, out)
finally:
    pg.close()
print(f'test-sharp-drops-sql: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
