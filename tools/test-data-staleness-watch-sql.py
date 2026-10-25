#!/usr/bin/env python3
"""tools/data-staleness-watch.sql (founder ruling 2026-10-25: the staleness alert moves to the pg_cron heartbeat) on a
REAL throwaway Postgres, with stand-ins for what Supabase provides: net.http_get / net.http_post / net._http_response
(pg_net) and vault.decrypted_secrets. Proves:
  - stale_watch.decide is tools/data-staleness-alert.mjs `decide`, case for case, with a fake clock (60 min is not
    stale, 61 is; at most hourly per stale build; a new stale build alerts at once; 'unread' its own episode);
  - stale_watch.tick end to end: fires the GET; ingests a fresh / stale / unreadable response; ONE message for a stale
    build; nothing the next tick (repeat window); a message counts only on a 2xx — a failed one is re-sent; a single
    failed check never alerts, two in a row do; no Vault secret → recorded 'failed: no vault secret', nothing sent.
Installs twice (idempotent). No Postgres binaries on this machine → SKIP out loud (never a pass); CI runners carry them."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pinarch_pg import PG

SQL = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data-staleness-watch.sql')
pg = PG()
if not pg.available():
    print(f'SKIP  test-data-staleness-watch-sql: {pg.why} — NOT A PASS (CI runs it)'); sys.exit(0)
passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('  PASS ', name)
    else: failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-400:])
def q(sql):
    rc, out = pg.q(sql)
    if rc: raise RuntimeError(sql[:200] + ' :: ' + out)
    return out

STUBS = """
create role anon nologin; create role authenticated nologin;
create schema net;
create sequence net.seq;
create table net.requests (id bigint primary key, method text, url text, body jsonb);
create table net._http_response (id bigint primary key, status_code integer, content text, error_msg text, created timestamptz default now());
create function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000)
returns bigint language sql as $$ insert into net.requests values (nextval('net.seq'), 'GET', url, null) returning id $$;
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000)
returns bigint language sql as $$ insert into net.requests values (nextval('net.seq'), 'POST', url, body) returning id $$;
create schema vault;
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
"""
try:
    q(STUBS)
    for i in (1, 2):
        rc, err = pg.file(SQL)
        check(f'installs (pass {i}: idempotent)', rc == 0, err)

    # ── the rule, fake clock: the same cases as tools/test-data-staleness-alert.mjs ──
    T0 = "timestamptz '2026-10-25 00:13:05+00'"
    def dec(now_m, obs_m=None, readable=True, built=T0, prev_ep='null', prev_m=None, why="null", tries=2):
        obs_m = now_m if obs_m is None else obs_m
        prev_at = 'null' if prev_m is None else f"{T0} + interval '{prev_m} min'"
        out = q(f"select alert || '|' || coalesce(episode,'') || '|' || coalesce(msg,'') || '|' || coalesce(why,'') from stale_watch.decide("
                f"{T0} + interval '{now_m} min', {T0} + interval '{obs_m} min', {str(readable).lower()}, {built if readable else 'null'}, "
                f"{T0} + interval '3 min', {why}, {tries}, {prev_ep}, {prev_at})")
        a, ep, msg, w = out.split('|', 3)
        return a == 'true', ep, msg, w
    EP = q(f"select 'stale:' || floor(extract(epoch from {T0}) * 1000)::bigint")
    a, ep, msg, w = dec(60); check('exactly 60 min old is not yet stale', not a, w)
    a, ep, msg, w = dec(61)
    check('61 min → ONE alert naming build time and age, episode = the stale build', a and ep == EP and 'built 2026-10-25 00:13Z, 61 min ago' in msg and 'Last publish: 2026-10-25 00:16Z' in msg, msg)
    a, ep, msg, w = dec(75, obs_m=55); check('the age is measured when the GET was fired (55 min then) → nothing', not a, w)
    a, *_ = dec(76, prev_ep=f"'{EP}'", prev_m=61); check('same stale build, 15 min after the alert → nothing', not a)
    a, *_ = dec(120, prev_ep=f"'{EP}'", prev_m=61); check('same stale build, 59 min after → nothing', not a)
    a, ep, msg, w = dec(121, prev_ep=f"'{EP}'", prev_m=61); check('60 min after → one repeat, "Still:"', a and msg.startswith('Still: '), msg)
    a, ep, msg, w = dec(90, built=f"{T0} + interval '25 min'", prev_ep=f"'{EP}'", prev_m=61)
    check('a NEW stale build → alerts at once', a and not msg.startswith('Still') and ep != EP, ep)
    sent, prev = [], None
    for m in range(0, 241, 10):
        a, ep, msg, w = dec(m, prev_ep=f"'{prev[0]}'" if prev else 'null', prev_m=prev[1] if prev else None)
        if a: sent.append(m); prev = (ep, m)
    check('every 10 min for 4 h: alerts at 70, 130, 190 only', sent == [70, 130, 190], sent)
    a, ep, msg, w = dec(0, readable=False, why="'HTTP 404'", tries=2)
    check('unreadable → its own episode, says so', a and ep == 'unread' and 'could not be read (HTTP 404, 2 checks in a row' in msg, msg)
    a, *_ = dec(30, readable=False, why="'HTTP 404'", prev_ep="'unread'", prev_m=0); check('still unreadable 30 min later → nothing', not a)

    # ── tick end to end ──
    q("insert into vault.decrypted_secrets values ('stale_watch_telegram_bot_token', 'tok'), ('stale_watch_telegram_chat_id', '42')")
    def last_get(): return q("select id from net.requests where method = 'GET' order by id desc limit 1")
    def respond(rid, status, body): q(f"insert into net._http_response (id, status_code, content) values ({rid}, {status}, $b${body}$b$)")
    def posts(): return int(q("select count(*) from net.requests where method = 'POST'"))
    # each data build is a FIXED instant (computed once): the same stale build must read the same on every tick
    def at(min_ago): return q(f"select to_char((now() - interval '{min_ago} min') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")
    def info(built): return json.dumps({'commit': 'x', 'builtAt': '2026-10-25T00:00:00Z', 'data': {'builtAt': built}})
    FRESH, STALE1, STALE2, FRESH2 = at(20), at(80), at(65), at(5)
    r = q('select stale_watch.tick()'); g1 = last_get()
    check('first tick: no read yet, fires the GET (cache-busted)', r == 'no read yet' and g1 and 'build-info.json?cb=' in q(f'select url from net.requests where id = {g1}'), r)
    respond(g1, 200, info(FRESH)); r = q('select stale_watch.tick()')
    check('fresh response → nothing sent', r.startswith('fresh') and posts() == 0, r)
    respond(last_get(), 200, info(STALE1)); r = q('select stale_watch.tick()')
    p1 = q("select id from net.requests where method = 'POST' order by id desc limit 1")
    body = json.loads(q(f'select body from net.requests where id = {p1}')) if p1 else {}
    check('stale response → ONE Telegram POST to the bot, chat 42, saying stale',
          posts() == 1 and body.get('chat_id') == '42' and 'data is stale' in body.get('text', '') and 'bottok/sendMessage' in q(f'select url from net.requests where id = {p1}'), body)
    respond(p1, 500, '{}')                      # Telegram refused
    respond(last_get(), 200, info(STALE1)); r = q('select stale_watch.tick()')
    check('a refused send (HTTP 500) is not a delivery → re-sent next tick', posts() == 2 and q('select delivery from stale_watch.messages order by id limit 1') == 'failed: HTTP 500', r)
    p2 = q("select id from net.requests where method = 'POST' order by id desc limit 1"); respond(p2, 200, '{}')
    respond(last_get(), 200, info(STALE1)); r = q('select stale_watch.tick()')
    check('delivered (2xx) → the next tick sends nothing (hourly)', posts() == 2 and q('select delivery from stale_watch.messages order by id desc limit 1') == 'sent', r)
    # a new stale build (different data.builtAt) → at once
    respond(last_get(), 200, info(STALE2)); r = q('select stale_watch.tick()')
    check('a new stale build → alerts at once', posts() == 3, r)
    respond(q("select id from net.requests where method = 'POST' order by id desc limit 1"), 200, '{}')
    # fresh again, then ONE failed check: judged on the last good read (fresh) → nothing
    respond(last_get(), 200, info(FRESH2)); q('select stale_watch.tick()')
    respond(last_get(), 404, 'nope'); r = q('select stale_watch.tick()')
    check('one failed check (a blip) → nothing; the last good read is judged', posts() == 3 and r.startswith('fresh'), r)
    respond(last_get(), 404, 'nope'); r = q('select stale_watch.tick()')
    lastmsg = q('select text from stale_watch.messages order by id desc limit 1')
    check('a second failed check in a row → the "could not be read" alert', posts() == 4 and 'could not be read (HTTP 404, 2 checks in a row' in lastmsg, lastmsg)
    q("delete from vault.decrypted_secrets"); q("update stale_watch.messages set delivery = 'sent'")
    q("update stale_watch.messages set created_at = now() - interval '2 hours'")
    respond(last_get(), 404, 'nope'); q('select stale_watch.tick()')
    check('no Vault secret → recorded, nothing sent', posts() == 4 and q('select delivery from stale_watch.messages order by id desc limit 1') == 'failed: no vault secret')
    check('the heartbeat records the tick', q("select (now() - last_tick) < interval '1 minute' from stale_watch.heartbeat") == 't')
    rc, out = pg.q('select stale_watch.tick()', 'anon'); check('anon cannot run it', rc != 0, out)
finally:
    pg.close()
print(f'\ntest-data-staleness-watch-sql: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
