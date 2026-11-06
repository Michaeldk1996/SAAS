#!/usr/bin/env python3
"""tools/data-alarms.sql (architecture program stage 1, 2026-11-01) on a REAL throwaway Postgres, with stand-ins for
what Supabase provides: pg_net (net.http_get / net.http_post / net._http_response), vault.decrypted_secrets, cron.job,
public.live_snapshot and public.kibl_now_price. Proves, for every alarm row, on a manufactured stale state:
  - it fires: ONE "ALARM" message when the row goes bad, none on the next tick while it stays bad (one per streak);
  - it recovers: ONE "RECOVERED" line when it is good again;
  - a message counts only on a 2xx: an alert whose send failed is sent again on the next tick;
  - an unreadable source twice in a row is itself an alarm, once is not;
  - data_alarms.force makes a row fire on a fake observation, its messages marked "[TEST] ";
  - close coverage reports once a day with "X of Y" and each dash's reason, "ALARM" below 90%;
and mutants of the rule (the threshold dropped, the streak rule dropped, the delivery check dropped) go red.
No Postgres binaries on this machine → SKIP out loud (never a pass); CI runners carry them."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pinarch_pg import PG

SQL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data-alarms.sql')
SRC = open(SQL_PATH).read()
pg = PG()
if not pg.available():
    print(f'SKIP  test-data-alarms-sql: {pg.why} — NOT A PASS (CI runs it)'); sys.exit(0)
passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('  PASS ', name)
    else: failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-500:])
def q(sql):
    rc, out = pg.q(sql)
    if rc: raise RuntimeError(sql[:300] + ' :: ' + out)
    return out

STUBS = """
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
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
insert into vault.decrypted_secrets values ('data_alarms_telegram_bot_token', 'TOKEN'), ('data_alarms_telegram_chat_id', '-100');
create schema cron;
create table cron.job (jobid serial primary key, jobname text, schedule text, active boolean default true);
create table public.live_snapshot (id int primary key, updated_at timestamptz);
create table public.kibl_now_price (card_key text, side_key text, kind text, written_at timestamptz);
"""
JOBS = ['live-poller-10s', 'ten141-pipeline-ping', 'ten280-bet105-drop-bot', 'ten287-recorder', 'ten287-recorder-sweep',
        'ten287-superbet-drop-bot', 'ten294_drops_watchdog', 'ten347_publish_watch', 'drops-scope-recheck',
        'ten270-oddspapi-postmatch-ping', 'ten270-oddspapi-postmatch-check', 'ten216-collector-watchdog', 'ten232-kibl-sweep-ping']

def reset(src=SRC):
    q('drop schema if exists data_alarms cascade; truncate net.requests, net._http_response, cron.job, public.live_snapshot, public.kibl_now_price;')
    import tempfile
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as fh: fh.write(src); path = fh.name
    rc, err = pg.file(path); os.unlink(path)
    if rc: raise RuntimeError('install: ' + err)
    vals = ','.join(f"('{j}')" for j in JOBS)
    q(f"insert into cron.job (jobname) values {vals};"
      "insert into public.live_snapshot values (1, now());"
      "insert into public.kibl_now_price values ('__stream__', '__hb__', 'heartbeat', now());")

def iso(mins_ago):
    return q(f"select to_char((now() - interval '{mins_ago} minutes') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")

TODAY = None
def answer(build_min=5, card_min=5, n_today=0, status=200, cover=None, only=None):
    """Answer every GET fired since the last answer, as the live site would."""
    global TODAY
    TODAY = TODAY or q("select to_char((now() at time zone 'Europe/Berlin')::date, 'YYYY-MM-DD')")
    rows = q("select id || '|' || source from data_alarms.fetches where processed_at is null").splitlines()
    for line in rows:
        if not line.strip(): continue
        rid, src = line.split('|')
        if only and src not in only: continue
        if src == 'build_info': body = {'data': {'builtAt': iso(build_min)}}
        elif src == 'card_state': body = {'generatedAt': iso(card_min), 'byKey': {}}
        elif src == 'matches': body = [{'id': f'upcoming-{i}', 'date': TODAY, 'finalScore': None} for i in range(n_today)] + \
                                      [{'id': 'past-1', 'date': TODAY, 'finalScore': {'display': '6-4 6-4'}}]
        else: body = cover if cover is not None else {'day': 'none', 'generatedAt': iso(5)}
        content = json.dumps(body).replace("'", "''")
        q(f"insert into net._http_response (id, status_code, content) values ({rid}, {status}, '{content}')")

def deliver(code=200):
    for rid in q("select net_request_id from data_alarms.messages where delivery = 'queued' and net_request_id is not null").split():
        q(f"insert into net._http_response (id, status_code, content) values ({rid}, {code}, '{{}}')")

def msgs(alarm, kind=None):
    k = f" and kind = '{kind}'" if kind else ''
    out = q(f"select coalesce(string_agg(kind || '|' || delivery || '|' || replace(text, E'\\n', ' '), E'\\n' order by id), '') "
            f"from data_alarms.messages where alarm = '{alarm}'{k}")
    return [l for l in out.splitlines() if l.strip()]

def tick():
    return q('select data_alarms.tick()')

def suite(tag, src=SRC):
    """The behaviour; returns the number of failed checks (mutants must fail at least one)."""
    global failed
    before = failed
    reset(src)
    tick(); answer(); tick(); deliver()            # a fresh site: every row ok, nothing sent
    tick()
    check(f'{tag}fresh site: no alarm row sends anything', all(not msgs(a) for a in ('data_age', 'card_state', 'live_poller', 'kibl_stream', 'cron_jobs')),
          q("select string_agg(alarm || ':' || text, ' / ') from data_alarms.messages"))

    # data_age: 61 min old fires once, stays quiet while bad, recovers once
    answer(build_min=61); tick()
    a = msgs('data_age')
    check(f'{tag}data_age: 61 min old → one ALARM', len(a) == 1 and 'ALARM' in a[0] and 'min old' in a[0], a)
    deliver(); answer(build_min=75); tick(); deliver()
    check(f'{tag}data_age: still stale → no second message (one per streak)', len(msgs('data_age')) == 1, msgs('data_age'))
    answer(build_min=3); tick(); deliver()
    a = msgs('data_age')
    check(f'{tag}data_age: fresh again → one RECOVERED line', len(a) == 2 and 'RECOVERED' in a[1], a)
    answer(build_min=3); tick(); deliver()
    check(f'{tag}data_age: stays fresh → nothing more', len(msgs('data_age')) == 2, msgs('data_age'))

    # card_state (hysteresis, stage 3 limits): 14 is fine; 16 once is not yet an alarm, twice in a row is; a failed send
    # is sent again; once bad it recovers only below 12 min (the worker writes every 12–14 min: no flap on a 14-min doc)
    answer(card_min=14); tick(); deliver()
    check(f'{tag}card_state: 14 min → no alarm', not msgs('card_state'), msgs('card_state'))
    answer(card_min=16); tick(); deliver()
    check(f'{tag}card_state: 16 min on ONE tick → not yet an alarm (2 ticks in a row needed)', not msgs('card_state'), msgs('card_state'))
    answer(card_min=14); tick(); deliver()
    answer(card_min=16); tick(); deliver()
    check(f'{tag}card_state: a good tick in between resets the count', not msgs('card_state'), msgs('card_state'))
    answer(card_min=16); tick(); deliver(code=500)
    answer(card_min=21); tick()
    a = msgs('card_state')
    check(f'{tag}card_state: bad twice in a row → ALARM; a send that failed (HTTP 500) is sent again', len(a) == 2 and 'failed: HTTP 500' in a[0] and 'ALARM' in a[1], a)
    deliver(); answer(card_min=14); tick(); deliver()
    check(f'{tag}card_state: 14 min after an alarm → still bad (recovers only below 12)', len(msgs('card_state')) == 2, msgs('card_state'))
    answer(card_min=10); tick(); deliver()
    check(f'{tag}card_state: 10 min → RECOVERED', len(msgs('card_state')) == 3 and 'RECOVERED' in msgs('card_state')[2], msgs('card_state'))
    # an install that predates stage 3 (60 min, recover 45) is moved to the stage-3 limits by the installer
    check(f'{tag}card_state config: 15 min, 2 ticks, recover below 12',
          q("select threshold || '|' || confirm_ticks || '|' || recover_below from data_alarms.config where name = 'card_state'").strip() == '00:15:00|2|00:12:00',
          q("select threshold || '|' || confirm_ticks || '|' || recover_below from data_alarms.config where name = 'card_state'"))
    q("update data_alarms.config set threshold = interval '60 minutes', recover_below = interval '45 minutes' where name = 'card_state'")
    q(src)                                          # re-install over a pre-stage-3 config (the live upgrade)
    check(f'{tag}card_state config: a pre-stage-3 install (60 / 45) is moved to 15 / 12 on re-install',
          q("select threshold || '|' || recover_below from data_alarms.config where name = 'card_state'").strip() == '00:15:00|00:12:00',
          q("select threshold || '|' || recover_below from data_alarms.config where name = 'card_state'"))

    # stage 3: card prices from the database doc — a fresh card_state_doc keeps the row good though the file is old
    q("create table if not exists public.card_state_doc (id smallint primary key, generated_at timestamptz, doc jsonb)")
    q("insert into public.card_state_doc values (1, now() - interval '3 minutes', '{}') on conflict (id) do update set generated_at = excluded.generated_at")
    answer(card_min=120); tick(); deliver(); answer(card_min=120); tick(); deliver()
    check(f'{tag}card_state: a 3-min-old card_state_doc wins over a 120-min-old file (no alarm)', len(msgs('card_state')) == 3, msgs('card_state'))
    q("update public.card_state_doc set generated_at = now() - interval '70 minutes'")
    answer(card_min=120); tick(); deliver(); answer(card_min=120); tick(); deliver()
    check(f'{tag}card_state: a 70-min-old doc and a 120-min-old file → ALARM', len(msgs('card_state')) == 4 and 'ALARM' in msgs('card_state')[3], msgs('card_state'))
    q("drop table public.card_state_doc"); answer(card_min=2); tick(); deliver(); answer(card_min=2); tick(); deliver()

    # unreadable twice in a row is an alarm; once is not
    answer(status=503, only={'build_info'}); answer(only={'card_state', 'matches', 'coverage'}); tick(); deliver()
    check(f'{tag}one unreadable build-info.json → no alarm', len(msgs('data_age')) == 2, msgs('data_age'))
    answer(status=503, only={'build_info'}); answer(only={'card_state', 'matches', 'coverage'}); tick(); deliver()
    a = msgs('data_age')
    check(f'{tag}two unreadable in a row → ALARM "cannot be read"', len(a) == 3 and 'cannot be read' in a[2], a)
    answer(); tick(); deliver()

    # live_poller: silent but nothing scheduled → ok; silent with a card today → alarm
    q("update public.live_snapshot set updated_at = now() - interval '11 minutes'")
    answer(n_today=0); tick(); deliver()
    check(f'{tag}live_poller: silent 11 min, no ATP singles card today → no alarm', not msgs('live_poller'), msgs('live_poller'))
    answer(n_today=3); tick(); deliver()
    a = msgs('live_poller')
    check(f'{tag}live_poller: silent 11 min with 3 cards today → ALARM', len(a) == 1 and 'ALARM' in a[0] and '3 unfinished' in a[0], a)
    q("update public.live_snapshot set updated_at = now()"); answer(n_today=3); tick(); deliver()
    check(f'{tag}live_poller: writing again → RECOVERED', len(msgs('live_poller')) == 2 and 'RECOVERED' in msgs('live_poller')[1], msgs('live_poller'))

    # kibl_stream heartbeat
    q("update public.kibl_now_price set written_at = now() - interval '11 minutes'"); answer(); tick(); deliver()
    a = msgs('kibl_stream')
    check(f'{tag}kibl_stream: heartbeat 11 min old → ALARM', len(a) == 1 and 'ALARM' in a[0], a)
    q("update public.kibl_now_price set written_at = now()"); answer(); tick(); deliver()

    # cron_jobs: a breaker unschedules a job → alarm naming it, at once
    q("delete from cron.job where jobname = 'live-poller-10s'"); answer(); tick(); deliver()
    a = msgs('cron_jobs')
    check(f'{tag}cron_jobs: a job unscheduled → ALARM naming it', len(a) == 1 and 'live-poller-10s' in a[0], a)
    q("insert into cron.job (jobname) values ('live-poller-10s')"); answer(); tick(); deliver()
    check(f'{tag}cron_jobs: rescheduled → RECOVERED', len(msgs('cron_jobs')) == 2, msgs('cron_jobs'))

    # force: a manufactured stale state on a healthy source fires, marked [TEST], and recovers when cleared
    q("insert into data_alarms.force values ('kibl_stream', now() + interval '1 hour', '{\"age_min\": 30}')")
    answer(); tick(); deliver()
    a = msgs('kibl_stream')
    check(f'{tag}force: kibl_stream fake 30 min → [TEST] ALARM', a and a[-1].split('|')[2].startswith('[TEST] ALARM'), a)
    q("delete from data_alarms.force"); answer(); tick(); deliver()
    check(f'{tag}force cleared → a [TEST] RECOVERED line (the manufactured streak is marked to its end)',
          msgs('kibl_stream') and msgs('kibl_stream')[-1].split('|')[2].startswith('[TEST] RECOVERED'), msgs('kibl_stream'))
    return failed - before

def coverage_checks():
    reset()
    yday = q("select to_char((now() at time zone 'Europe/Berlin')::date - 1, 'YYYY-MM-DD')")
    hour = int(q("select extract(hour from now() at time zone 'Europe/Berlin')::int"))
    cover = {'day': yday, 'generatedAt': iso(5), 'x': 15, 'y': 18, 'recovered': 2, 'approx': None,
             'buckets': {'no verified start': 2, 'book quiet before start': 1},
             'dashes': [{'match': 'A v B', 'bucket': 'book quiet before start', 'reason': 'no card-state close (book went quiet before the start)'}]}
    tick(); answer(cover=cover); tick(); deliver()
    a = msgs('close_cover')
    if hour < 10:
        check('close_cover: before 10:00 Berlin → no daily report yet', not a, a)
        print('  NOTE  the daily-report half runs only after 10:00 Berlin; it is exercised by the force path below')
    else:
        check('close_cover: 15 of 18 (83.3%) → one daily message, ALARM, with the dash and its reason',
              len(a) == 1 and 'ALARM' in a[0] and '15 of 18' in a[0] and 'A v B' in a[0] and 'book went quiet' in a[0], a)
        answer(cover=cover); tick(); deliver()
        check('close_cover: reported once a day, not again', len(msgs('close_cover')) == 1, msgs('close_cover'))
    # the force path: a fake day's report, any hour after 09:00 — exercised by moving the clock is not possible here,
    # (the chosen instant is 10:00 BERLIN on the Berlin date, as the function reads it: 10:00 UTC on the UTC date named the
    # Berlin day before yday between 23:00 and 24:00 UTC, and the gate went red then — 6 Nov 23:21Z)
    # so the judge rule itself is checked through data_alarms.coverage with a chosen instant
    q("delete from data_alarms.messages where alarm = 'close_cover'; delete from data_alarms.state where name = 'close_cover';")
    q(f"insert into data_alarms.force values ('close_cover', now() + interval '2 days', '{json.dumps(dict(cover, day=yday))}')")
    out = q("select data_alarms.coverage((date_trunc('day', now() at time zone 'Europe/Berlin') + interval '10 hours') at time zone 'Europe/Berlin')")
    a = msgs('close_cover')
    check('close_cover (forced, 10:00Z): [TEST] daily line with X of Y below 90% → ALARM', len(a) == 1 and '[TEST]' in a[0] and '15 of 18' in a[0] and 'ALARM' in a[0], [out] + a)
    st = q("select coalesce(bad::text, 'none') from data_alarms.state where name = 'close_cover'")
    check('close_cover: the [TEST] report leaves the real streak untouched', st in ('', 'none', 'false'), st)
    t0 = a[0] if a else ''
    check('close_cover: the daily line carries "approximate: —", "recovered by re-verification: 2" and the dash buckets, not merged',
          'approximate: — (tier not built yet)' in t0 and 'recovered by re-verification: 2' in t0 and 'no verified start 2' in t0 and 'REAL close' in t0, t0)
    q("delete from data_alarms.force")
    real = dict(cover, day=yday, x=17, y=18)
    q("delete from data_alarms.fetches; ")
    tick(); answer(cover=real); tick()
    q2 = q("select data_alarms.coverage((date_trunc('day', now() at time zone 'Europe/Berlin') + interval '10 hours') at time zone 'Europe/Berlin')")
    a2 = msgs('close_cover', 'daily')
    q("delete from data_alarms.messages where alarm = 'close_cover' and kind = 'daily' and text like '%17 of 18%'")
    q(f"insert into data_alarms.messages (alarm, kind, text, delivery) values ('close_cover', 'daily', 'ALARM — Close coverage {yday}: no report (x).', 'sent')")
    q("select data_alarms.coverage((date_trunc('day', now() at time zone 'Europe/Berlin') + interval '10 hours') at time zone 'Europe/Berlin')")
    a3 = msgs('close_cover', 'daily')
    check('close_cover: an earlier "no report" for the day never blocks its real report when it turns up',
          any('17 of 18' in x for x in a3), a3)
    check('close_cover: the real report still goes out after a [TEST] one the same day (17 of 18, no ALARM)',
          any('17 of 18' in x and '[TEST]' not in x and 'ALARM' not in x for x in a2), [q2] + a2)

try:
    q(STUBS)
    for i in (1, 2):
        rc, err = pg.file(SQL_PATH)
        check(f'installs (pass {i}: idempotent)', rc == 0, err)
    suite('')
    coverage_checks()
    # mutants: each must turn the behaviour red
    MUT = [
        ('the threshold dropped (never stale)', 'bad := age > lim;', 'bad := false;'),
        ('the streak rule dropped (alert every tick)', 'if j.bad and not st.bad then', 'if j.bad then'),
        ('the delivery check dropped (a failed send is never re-sent)',
         "update data_alarms.state s set owe = null, owe_text = null\n   where s.owe is not null and exists",
         "update data_alarms.state s set owe = null, owe_text = null\n   where s.owe is not null or exists"),
        ('the schedule condition dropped (alarm when nothing is scheduled)', 'if coalesce(n, 0) = 0 then', 'if false then'),
        ('the confirm count dropped (one bad tick alerts)', 'if st.strikes + 1 < coalesce(', 'if false and st.strikes + 1 < coalesce('),
        ('the recovery limit dropped (flaps around the threshold)', 'then coalesce(cfg.recover_below, cfg.threshold) else cfg.threshold end;', 'then cfg.threshold else cfg.threshold end;'),
    ]
    saved = (passed, failed)
    for name, a, b in MUT:
        assert SRC.count(a) >= 1, 'mutant anchor gone: ' + name
        print(f'--- mutant: {name}')
        try:
            red = suite('[mutant] ', SRC.replace(a, b))
        except Exception as e:          # the behaviour broke so badly the checks could not finish: red
            print('    (mutant run stopped: %s)' % str(e)[:120]); red = 1
        passed, failed = saved
        check(f'MUTANT caught: {name}', red > 0, 'survived')
        saved = (passed, failed)
finally:
    pg.close()

print(f'\ntest-data-alarms-sql: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
