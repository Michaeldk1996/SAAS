#!/usr/bin/env python3
"""The Telegram drop bots' ATP-only posting scope (tools/drops-scope.sql) on a REAL throwaway Postgres.

Builds the two bots' alerts tables as installed (only the columns the scope reads plus delivery), the Kibl fixture and
odds-api.io event tables, applies tools/drops-scope.sql twice (idempotent), feeds api-tennis fixtures through
public.drops_scope_ingest as service_role, then inserts live alerts the way the bots' scan() does and checks:
  ATP main draw and ATP qualifying stay 'unsent' (the bot's tick posts them); Challenger, ITF, no fixture and two
  fixtures are held, never sent, and stay in the table (the drops page reads them); a backtest row is untouched; a
  row held for want of a fixture is released once its ATP fixture arrives, a Challenger one is not, and nothing older
  than 30 min is released. CONTROL: without the trigger the same Challenger alert is 'unsent' (it would post).
No Postgres binaries on this machine -> SKIP out loud (never a pass); CI runners carry them."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pinarch_pg import PG
SQL = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'drops-scope.sql')
pg = PG()
if not pg.available():
    print(f'SKIP  test-drops-scope-sql: {pg.why} — NOT A PASS (the code gate runs it)'); sys.exit(0)
q = pg.q
passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('  PASS ', name)
    else: failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-400:])

STUB = """
create schema ten280_bot; create schema ten287_bot; create schema ten287_rec;
create table public.kibl_fixtures (fixture_id bigint primary key, scheduled_start timestamptz);
create table ten287_rec.events (event_id bigint primary key, start_at timestamptz);
create table ten280_bot.alerts (id bigserial primary key, mode text not null, fixture_id bigint not null, side_id int not null default 2,
  tier text, player_a text, player_b text, side_player text, eval_at timestamptz not null default now(),
  delivery text not null default 'unsent', created_at timestamptz not null default now());
create table ten287_bot.alerts (id bigserial primary key, mode text not null, book text not null default 'Superbet', event_id bigint not null,
  side text not null default 'home', tier text, player_a text, player_b text, side_player text, eval_at timestamptz not null default now(),
  delivery text not null default 'unsent', created_at timestamptz not null default now());
"""
def fx(ek, a, b, typ, qual='False', day_off=0, hhmm='12:00'):
    return {'event_key': ek, 'event_date': f"__D{day_off}__", 'event_time': hhmm, 'first': a, 'second': b,
            'type': typ, 'qual': qual, 'tournament': 'T', 'round': 'R'}
def ingest(rows):
    rc, d = q("select to_char(now() at time zone 'UTC', 'YYYY-MM-DD')")
    import datetime as dt
    base = dt.date.fromisoformat(d)
    body = json.dumps(rows)
    for k in range(-1, 5):
        body = body.replace(f'"__D{k}__"', '"' + (base + dt.timedelta(days=k)).isoformat() + '"')
    return q("select public.drops_scope_ingest($j$" + body + "$j$::jsonb, 'test')", 'service_role')
def b105(a, b, fid, start="now() + interval '3 hours'", mode='live', eval_at='now()'):
    q(f"insert into public.kibl_fixtures values ({fid}, {start}) on conflict (fixture_id) do update set scheduled_start = excluded.scheduled_start")
    rc, out = q(f"insert into ten280_bot.alerts (mode, fixture_id, player_a, player_b, eval_at) values ('{mode}', {fid}, $${a}$$, $${b}$$, {eval_at}) returning delivery")
    return out if rc == 0 else 'ERROR ' + out
def sbet(a, b, eid, start="now() + interval '3 hours'"):
    q(f"insert into ten287_rec.events values ({eid}, {start}) on conflict (event_id) do nothing")
    rc, out = q(f"insert into ten287_bot.alerts (mode, event_id, player_a, player_b) values ('live', {eid}, $${a}$$, $${b}$$) returning delivery")
    return out if rc == 0 else 'ERROR ' + out
try:
    pg.roles()
    rc, out = q(STUB); check('stub bot tables', rc == 0, out)
    rc, out = q('create table control_alerts (like ten280_bot.alerts including all)')
    for i in (1, 2):
        rc, err = pg.file(SQL); check(f'drops-scope.sql applies (pass {i}: idempotent)', rc == 0, err)
    rc, out = q("select drops_scope.sk('Damm Jr, Martin'), drops_scope.sk('P. Carreno-Busta'), drops_scope.sk('Pablo Carreno Busta'), drops_scope.sk('J. Lehečka'), array_to_string(drops_scope.inits('Adolfo Daniel Vallejo'), '')")
    check('name keys = the drops page join (sk / initials)', out == 'damm|busta|busta|lehecka|ad', out)
    rc, out = q("select drops_scope.same('Adolfo Daniel Vallejo', 'D. Vallejo'), drops_scope.same('Ze Zhang', 'Zh. Zhang'), drops_scope.same('Alexander Zverev', 'M. Zverev')")
    check('initials: a middle name counts; two different initials do not (one shared initial = one player, as status.mjs)', out == 't|t|f', out)
    rc, out = q("select drops_scope.sk(null) is null")
    check('no name -> no key', out == 't', out)
    rc, out = ingest([
        fx(9001, 'C. Alcaraz', 'J. Sinner', 'Atp Singles', 'False'),
        fx(9002, 'P. Bar Biryukov', 'S. Sakellaridis', 'Atp Singles', 'True'),
        fx(9003, 'L. Tien', 'R. Opelka', 'Challenger Men Singles', 'False'),
        fx(9004, 'A. Itfone', 'B. Itftwo', 'Itf Men Singles', 'False'),
        fx(9005, 'M. Twin', 'N. Pair', 'Atp Singles'), fx(9006, 'M. Twin', 'N. Pair', 'Challenger Men Singles', 'False', 0, '13:00'),
        fx(9007, 'Q. Late', 'R. Arrival', 'Challenger Men Singles', 'True'),
        fx(9008, 'X. Dub / Y. Dub', 'Z. Dub / W. Dub', 'Atp Doubles'),
    ])
    check('service_role can ingest fixtures', rc == 0 and out == '8', out)
    rc, out = ingest([fx(9001, 'C. Alcaraz', 'J. Sinner', 'Atp Singles', 'False'), fx(9001, 'C. Alcaraz', 'J. Sinner', 'Atp Singles', 'False')])
    check('a fixture listed twice in one answer is written once (no upsert error)', rc == 0 and out == '1', out)
    rc, out = q("select count(*) from pg_proc where proname = 'drops_scope_ingest' and prosrc ~ 'update drops_scope\\.feed set[^;]*where'")
    check('the feed UPDATE carries a WHERE (pg_safeupdate refuses a bare UPDATE over REST)', out == '1', out)
    rc, out = q("select public.drops_scope_ingest('[]'::jsonb, 'x')", 'anon')
    check('anon cannot write the fixture list', rc != 0, out)
    rc, out = q("select count(*) from drops_scope.fixture", 'anon')
    check('anon cannot read the fixture list', rc != 0, out)

    check('Bet105: ATP main draw -> unsent (posted)', b105('Carlos Alcaraz', 'Jannik Sinner', 1) == 'unsent')
    check('Bet105: ATP qualifying (event_qualification True) -> unsent (posted)', b105('Pavel Bar Biryukov', 'Stefanos Sakellaridis', 2) == 'unsent')
    d = b105('Learner Tien', 'Reilly Opelka', 3)
    check('Bet105: Challenger -> held, not sent', d == 'held: not ATP (Challenger Men Singles)', d)
    d = b105('Alpha Itfone', 'Beta Itftwo', 4)
    check('Bet105: ITF -> held, not sent', d == 'held: not ATP (Itf Men Singles)', d)
    d = b105('Nobody Known', 'Someone Else', 5)
    check('Bet105: no api-tennis fixture -> held', d == 'held: no api-tennis fixture', d)
    d = b105('Mark Twin', 'Ned Pair', 6)
    check('Bet105: two fixtures match -> held, never a guess', d == 'held: two api-tennis fixtures match', d)
    d = b105('Carlos Alcaraz', 'Jannik Sinner', 7, start="now() + interval '3 days'")
    check('Bet105: the fixture is 3 days off the vendor start -> not that fixture -> held', d == 'held: no api-tennis fixture', d)
    d = sbet('Sinner, Jannik', 'Alcaraz, Carlos', 11)
    check('Superbet: ATP, "Last, First" and reversed order -> unsent', d == 'unsent', d)
    d = sbet('Tien, Learner', 'Opelka, Reilly', 12)
    check('Superbet: Challenger -> held', d == 'held: not ATP (Challenger Men Singles)', d)
    d = b105('Learner Tien', 'Reilly Opelka', 8, mode='backtest')
    check('a backtest row is untouched', d == 'unsent', d)
    rc, out = q("select count(*) from ten280_bot.alerts where mode = 'live'")
    check('every live alert is still recorded (the drops page reads the table)', out == '7', out)
    rc, out = q("select count(*) from drops_scope.verdict_log")
    check('one verdict logged per live alert', out == '9', out)
    rc, out = q("select event_type_type || '/' || event_qualification from drops_scope.verdict_log where bot = 'ten280' and alert_id = 2")
    check('the log keeps the api-tennis field that decided (ATP qualifying)', out == 'Atp Singles/True', out)

    # re-check: a drop whose fixture lands after the alert
    d = b105('Late Comer', 'Atp Player', 20)
    check('re-check setup: no fixture yet -> held', d == 'held: no api-tennis fixture', d)
    d = b105('Chall Late', 'Chall Other', 21)
    d2 = b105('Old Drop', 'Atp Old', 22, eval_at="now() - interval '40 minutes'")
    ingest([fx(9101, 'L. Comer', 'A. Player', 'Atp Singles'), fx(9102, 'C. Late', 'C. Other', 'Challenger Men Singles'),
            fx(9103, 'O. Drop', 'A. Old', 'Atp Singles')])
    rc, out = q("select drops_scope.recheck()")
    check('re-check releases exactly the one in-window ATP alert', out == '1', out)
    rc, out = q("select string_agg(fixture_id || '=' || delivery, ',' order by fixture_id) from ten280_bot.alerts where fixture_id in (20, 21, 22)")
    check('released -> unsent; Challenger -> held not ATP; > 30 min old -> stays held',
          out == '20=unsent,21=held: not ATP (Challenger Men Singles),22=held: no api-tennis fixture', out)

    # stale fixture list wording
    q("update drops_scope.feed set last_ok_at = now() - interval '2 hours'")
    d = b105('Stale Case', 'No Fixture', 30)
    check('a stale fixture list is named in the hold', d == 'held: no api-tennis fixture (fixture list stale)', d)
    d = b105('Carlos Alcaraz', 'Jannik Sinner', 31)
    check('a fixture already held still decides when the list is stale', d == 'unsent', d)

    # a failure inside the check never posts
    q("alter table drops_scope.fixture rename to fixture_gone")
    d = b105('Carlos Alcaraz', 'Jannik Sinner', 32)
    check('the check failing -> held: scope check failed (never posted)', d == 'held: scope check failed', d)
    q("alter table drops_scope.fixture_gone rename to fixture")

    rc, out = q("select drops_scope.report(24)->'verdicts'")
    check('report() reads back', rc == 0 and 'ten280 · post' in out, out)

    # CONTROL: the same Challenger alert without the trigger would be posted
    q("drop trigger drops_scope_scope on ten280_bot.alerts")
    d = b105('Learner Tien', 'Reilly Opelka', 40)
    check('CONTROL: without the trigger a Challenger alert is unsent (would post)', d == 'unsent', d)
finally:
    pg.close()
print(f'test-drops-scope-sql: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
