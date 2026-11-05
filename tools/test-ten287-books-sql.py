#!/usr/bin/env python3
"""The odds-api.io drop bot for several books (tools/ten287-books.sql, founder 2026-11-05: Napoleon Sports BE beside
Superbet) on a REAL throwaway Postgres, with the real book-generic load_ticks / scan sliced from tools/ten299-live-cut.sql.

Checks: the install sets config.books to [Superbet, Napoleon Sports BE] (twice: idempotent, a set list is never reset);
one tick() alerts a 10% drop on each listed book — Superbet and Napoleon on the same match are two alerts (cooldown per
book), Napoleon alone on another; a book recorded but not listed (Betano) never alerts; each header names its book
("🟢 NAPOLEON SPORTS BE DROP", "🟢 SUPERBET DROP"); a second tick inside the cooldown posts nothing; books = [Superbet]
(the rollback) stops Napoleon. CONTROL: the single-book tick() of before alerts Superbet only.
No Postgres binaries on this machine -> SKIP out loud (never a pass); CI runners carry them."""
import os, sys, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pinarch_pg import PG
HERE = os.path.dirname(os.path.abspath(__file__))
SQL = os.path.join(HERE, 'ten287-books.sql')
pg = PG()
if not pg.available():
    print(f'SKIP  test-ten287-books-sql: {pg.why} — NOT A PASS (the code gate runs it)'); sys.exit(0)
q = pg.q
passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('  PASS ', name)
    else: failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-500:])

cut = open(os.path.join(HERE, 'ten299-live-cut.sql')).read()
def fn(name):
    a = cut.index(f'create or replace function {name}(')
    b = cut.index('\n;\n', a)
    return cut[a:b + 3]

STUB = """
create schema ten287_bot; create schema ten287_rec; create schema drops_live;
create table ten287_rec.events (event_id bigint primary key, home text, away text, start_at timestamptz, status text, league text, tier text);
create table ten287_rec.openings (event_id bigint, book text, open_home numeric, open_away numeric, open_at timestamptz, status_code int);
create table ten287_rec.ticks (id bigserial primary key, book text not null, event_id bigint not null, market text not null default 'ML',
  back_home numeric, back_away numeric, book_updated_at timestamptz, seen_at timestamptz not null, event_status text);
create table ten287_bot.config (id boolean primary key default true, book text not null default 'Superbet', min_dropped_to_price numeric);
insert into ten287_bot.config (id) values (true);
create table ten287_bot.alerts (id bigserial primary key, mode text, run_id text, book text, threshold numeric, event_id bigint, side text,
  tier text, player_a text, player_b text, side_player text, eval_at timestamptz, ref_price numeric, ref_at timestamptz, cur_price numeric,
  cur_at timestamptz, pct_10m numeric, open_price numeric, open_at timestamptz, open_kind text, pct_open numeric, message text,
  net_request_id bigint, sent_at timestamptz, move_delay_s numeric, delivery text not null default 'unsent', created_at timestamptz default now());
create function drops_live.cuts_287(p_from timestamptz) returns table(event_id bigint, cut_at timestamptz)
  language sql stable as $$ select null::bigint, null::timestamptz where false $$;
create function ten287_bot.disp(p text) returns text language sql immutable as $$ select p $$;
create function ten287_bot.px(p numeric) returns text language sql immutable as $$ select to_char(p, 'FM990.00') $$;
create function ten287_bot.hhmm(p timestamptz) returns text language sql immutable as $$ select to_char(p at time zone 'UTC', 'HH24:MI') $$;
create function ten287_bot.spct(p numeric) returns text language sql immutable as $$ select to_char(p, 'FMS990.0') || '%' $$;
create function ten287_bot.moved(p_secs numeric) returns text language sql immutable as $$ select round(p_secs) || ' s ago' $$;
create function ten287_bot.send(p_text text) returns bigint language sql as $$ select null::bigint $$;
create function ten287_bot.settle() returns void language sql as $$ select $$;
"""
# the single-book tick() as installed before 5 Nov (the live definition), for the control
OLD_TICK = """
create or replace function ten287_bot.tick() returns integer language plpgsql as $$
declare e timestamptz := now(); n integer; a ten287_bot.alerts; rid bigint; v_at timestamptz; msg text; fl numeric; bk text;
begin
  if not pg_try_advisory_xact_lock(287287) then return 0; end if;
  perform ten287_bot.settle();
  select min_dropped_to_price, book into fl, bk from ten287_bot.config;
  perform ten287_bot.load_ticks(bk, now() - interval '14 days', now());
  n := ten287_bot.scan(bk, e, e, 5, 'live', null, interval '10 minutes', fl);
  return n;
end $$"""

def event(eid, home, away):
    q(f"insert into ten287_rec.events values ({eid}, '{home}', '{away}', now() + interval '3 hours', 'pending', 'ATP - Paris', 'ATP')")
def drop(eid, book, before, after):
    q(f"insert into ten287_rec.ticks (book, event_id, back_home, back_away, book_updated_at, seen_at, event_status) values "
      f"('{book}', {eid}, {before}, 1.80, now() - interval '15 minutes', now() - interval '15 minutes', 'pending'), "
      f"('{book}', {eid}, {after}, 1.80, now() - interval '1 minute', now() - interval '1 minute', 'pending')")
def alerts():
    rc, out = q("select coalesce(string_agg(book || ':' || event_id, ',' order by book, event_id), '') from ten287_bot.alerts")
    return out

try:
    pg.roles()
    rc, out = q(STUB); check('stub recorder / bot tables and helpers', rc == 0, out)
    for f in ('ten287_bot.load_ticks', 'ten287_bot.scan'):
        rc, out = q(fn(f)); check(f'the real {f} (tools/ten299-live-cut.sql) applies', rc == 0, out)
    for i in (1, 2):
        rc, err = pg.file(SQL); check(f'ten287-books.sql applies (pass {i}: idempotent)', rc == 0, err)
    rc, out = q("select array_to_string(books, ',') from ten287_bot.config")
    check('config.books = Superbet, Napoleon Sports BE', out == 'Superbet,Napoleon Sports BE', out)
    q("update ten287_bot.config set books = array['Superbet', 'Napoleon Sports BE', 'X']"); pg.file(SQL)
    rc, out = q("select array_to_string(books, ',') from ten287_bot.config")
    check('a re-install never resets a list already set', out == 'Superbet,Napoleon Sports BE,X', out)
    q("update ten287_bot.config set books = array['Superbet', 'Napoleon Sports BE']")

    event(1, 'Halys, Quentin', 'Fery, Arthur'); event(2, 'Tien, Learner', 'Opelka, Reilly'); event(3, 'Ruud, Casper', 'Paul, Tommy')
    drop(1, 'Superbet', 2.40, 2.10); drop(1, 'Napoleon Sports BE', 2.35, 2.05)       # both books, same match
    drop(2, 'Napoleon Sports BE', 3.00, 2.60)                                       # Napoleon alone
    drop(3, 'Betano', 2.00, 1.50)                                                    # recorded, not listed
    rc, out = q("select ten287_bot.tick()"); out = out.strip().splitlines()[0] if out.strip() else out; check('one tick alerts 3: Superbet + Napoleon on match 1, Napoleon on match 2', out == '3', out)
    a = alerts()
    check('per-book alerts, Betano (not listed) never', a == 'Napoleon Sports BE:1,Napoleon Sports BE:2,Superbet:1', a)
    rc, msg = q("select message from ten287_bot.alerts where book = 'Napoleon Sports BE' and event_id = 2")
    check('the Napoleon alert names its book: header and Bookmaker line',
          msg.startswith('🟢 NAPOLEON SPORTS BE DROP') and '🏦 Bookmaker: Napoleon Sports BE' in msg and '📉 Drop (10 min): −13.3%' in msg, msg)
    rc, msg = q("select message from ten287_bot.alerts where book = 'Superbet'")
    check('the Superbet header is unchanged', msg.startswith('🟢 SUPERBET DROP') and '🏦 Bookmaker: Superbet' in msg, msg)
    rc, out = q("select count(*) from ten287_bot.alerts where delivery = 'unsent: no vault secret'")
    check('every new alert went through the send step (no Vault secret here → recorded, nothing sent)', out == '3', out)
    rc, out = q("select ten287_bot.tick()"); out = out.strip().splitlines()[0] if out.strip() else out; check('a second tick inside the 30-min cooldown posts nothing', out == '0', out)

    q("update ten287_bot.config set books = array['Superbet']")
    event(4, 'Zverev, Alexander', 'Fritz, Taylor'); drop(4, 'Napoleon Sports BE', 2.00, 1.70); drop(4, 'Superbet', 2.00, 1.70)
    q("select ten287_bot.tick()")
    rc, out = q("select coalesce(string_agg(book, ','), '') from ten287_bot.alerts where event_id = 4")
    check('rollback books = [Superbet]: Napoleon stops, Superbet still alerts', out == 'Superbet', out)

    # CONTROL: the single-book tick() of before, on a fresh Napoleon-only drop — no Napoleon alert
    q("update ten287_bot.config set books = array['Superbet', 'Napoleon Sports BE']")
    q(OLD_TICK); event(5, 'Sinner, Jannik', 'Draper, Jack'); drop(5, 'Napoleon Sports BE', 2.00, 1.70); q("select ten287_bot.tick()")
    rc, out = q("select count(*) from ten287_bot.alerts where event_id = 5")
    check('CONTROL: the single-book tick() of before never alerts Napoleon', out == '0', out)
finally:
    pg.close()
print(f'test-ten287-books-sql: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
