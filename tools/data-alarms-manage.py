#!/usr/bin/env python3
"""Install / inspect / prove / remove the data alarms (tools/data-alarms.sql) through the Supabase Management API.

  data-alarms-manage.py install | status | fire-test | uninstall

Run by .github/workflows/data-alarms.yml (main only). Prints states, ages and message texts — never a secret: the
Telegram token and chat id go to Vault in the request body, which is never printed. Exits 1 when a required step
fails (an install whose self-test ping is not confirmed delivered, a fire-test row that did not fire or recover)."""
import json, os, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
url = os.environ['SUPABASE_URL'].rstrip('/')
REF = (urllib.parse.urlparse(url).hostname or '').split('.')[0]
TOKEN = os.environ['SUPABASE_ACCESS_TOKEN']
JOB = 'data_alarms_5min'
ROWS = ['data_age', 'card_state', 'live_poller', 'kibl_stream', 'cron_jobs']


def sql(q, quiet=False):
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query', method='POST',
                                 data=json.dumps({'query': q}).encode())
    req.add_header('Authorization', 'Bearer ' + TOKEN)
    req.add_header('Content-Type', 'application/json')
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                body = json.loads(r.read().decode() or 'null')
            if isinstance(body, dict) and (body.get('message') or body.get('error')):
                raise RuntimeError(body.get('message') or body.get('error'))
            return body
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:400]
            if e.code >= 500 and attempt < 2:
                time.sleep(10 * (attempt + 1)); continue
            raise RuntimeError(f'HTTP {e.code}: {msg}')


def lit(s):
    return "'" + str(s).replace("'", "''") + "'"


def show(title, rows):
    print(f'== {title}')
    for r in rows or []:
        print('  ' + json.dumps(r, default=str))


def vault(name, env):
    val = os.environ.get(env, '').strip()
    if not val:
        raise SystemExit(f'::error::secret {env} is empty — cannot store {name}')
    sql(f"do $$ declare i uuid := (select id from vault.secrets where name = {lit(name)}); begin "
        f"if i is null then perform vault.create_secret({lit(val)}, {lit(name)}); "
        f"else perform vault.update_secret(i, {lit(val)}); end if; end $$;", quiet=True)
    print(f'vault: {name} stored')


def wait_delivered(where, label, tries=6):
    for _ in range(tries):
        time.sleep(40)
        sql('select data_alarms.tick()')
        rows = sql(f"select id, alarm, kind, delivery, left(text, 160) as text from data_alarms.messages where {where} order by id")
        if rows and all(r['delivery'] == 'sent' for r in rows):
            show(label + ' (confirmed delivered)', rows); return True
    show(label + ' (NOT all confirmed)', rows); return False


def status():
    show('job', sql(f"select jobid, jobname, schedule, active from cron.job where jobname = {lit(JOB)}"))
    show('heartbeat', sql('select last_tick, now() as now from data_alarms.heartbeat'))
    show('rows', sql('select name, bad, test, since, owe, checked_at, last_detail from data_alarms.state order by name'))
    show('last fetches', sql("select source, fired_at, status_code, ok, stamp, n, error from data_alarms.fetches "
                             "where processed_at is not null order by fired_at desc limit 8"))
    show('last messages', sql('select id, alarm, kind, delivery, created_at, left(text, 200) as text from data_alarms.messages order by id desc limit 12'))


def main():
    act = sys.argv[1]
    if act == 'install':
        vault('data_alarms_telegram_bot_token', 'TELEGRAM_BOT_TOKEN')
        vault('data_alarms_telegram_chat_id', 'TELEGRAM_CHAT_ID')
        sql('create extension if not exists pg_cron; create extension if not exists pg_net;')
        sql('begin; ' + open(os.path.join(ROOT, 'tools', 'data-alarms.sql')).read() + '\ncommit;')
        print('sql: tools/data-alarms.sql applied')
        sql(f"select cron.schedule({lit(JOB)}, '*/5 * * * *', 'select data_alarms.tick()')")
        print(f'cron: {JOB} scheduled every 5 min')
        sql('select data_alarms.tick()')
        sql("select data_alarms.send('selftest', 'selftest', E'Stennisfy data alarms: TEST PING\\n\\nInstalled in Supabase pg_cron, "
            "every 5 min. One message when a row goes bad, one when it recovers: published data > 60 min old, card prices "
            "> 60 min old, live poller silent 10 min while ATP singles are scheduled, kibl-stream heartbeat silent 10 min, "
            "a scheduled database job missing; and a daily close-coverage line (alarm below 90%). No action needed.')")
        ok = wait_delivered("kind = 'selftest' and created_at > now() - interval '10 minutes'", 'self-test ping')
        status()
        if not ok:
            raise SystemExit('::error::self-test ping not confirmed delivered')
    elif act == 'status':
        status()
    elif act == 'fire-test':
        fakes = {'data_age': {'age_min': 120}, 'card_state': {'age_min': 120}, 'live_poller': {'age_min': 30, 'n': 1},
                 'kibl_stream': {'age_min': 30}, 'cron_jobs': {'missing': ['fire-test-job']}}
        start = sql('select now() as t')[0]['t']
        for name, fake in fakes.items():
            sql(f"insert into data_alarms.force values ({lit(name)}, now() + interval '20 minutes', {lit(json.dumps(fake))}::jsonb) "
                f"on conflict (name) do update set until = excluded.until, fake = excluded.fake")
        yday = sql("select to_char((now() at time zone 'Europe/Berlin')::date - 1, 'YYYY-MM-DD') as d")[0]['d']
        cover = {'day': yday, 'x': 1, 'y': 2, 'dashes': [{'match': 'Fire-test v Fire-test', 'reason': 'manufactured for the alarm proof'}]}
        sql(f"insert into data_alarms.force values ('close_cover', now() + interval '20 minutes', {lit(json.dumps(cover))}::jsonb) "
            f"on conflict (name) do update set until = excluded.until, fake = excluded.fake")
        print(sql("select data_alarms.tick() as r")[0]['r'])
        print(sql("select data_alarms.coverage(date_trunc('day', now()) + interval '10 hours') as r")[0]['r'])
        fired = wait_delivered(f"created_at >= {lit(start)} and text like '[TEST]%ALARM%' or (created_at >= {lit(start)} and kind = 'daily' and text like '%[TEST]%')",
                               'manufactured stale states: [TEST] ALARM per row')
        got = {r['alarm'] for r in sql(f"select distinct alarm from data_alarms.messages where created_at >= {lit(start)} and text like '%[TEST]%' and delivery = 'sent'")}
        sql("delete from data_alarms.force")
        sql('select data_alarms.tick()')
        rec = wait_delivered(f"created_at >= {lit(start)} and text like '[TEST] RECOVERED%'", '[TEST] RECOVERED per row')
        back = {r['alarm'] for r in sql(f"select distinct alarm from data_alarms.messages where created_at >= {lit(start)} and text like '[TEST] RECOVERED%' and delivery = 'sent'")}
        missing_fire = sorted(set(ROWS + ['close_cover']) - got)
        missing_rec = sorted(set(ROWS) - back)
        print(f'fired and delivered: {sorted(got)}; recovered and delivered: {sorted(back)}')
        status()
        if missing_fire or missing_rec or not fired or not rec:
            raise SystemExit(f'::error::fire-test incomplete — did not fire: {missing_fire}; did not recover: {missing_rec}')
        print('fire-test: every row fired on a manufactured stale state and recovered (close_cover: a daily line, no streak)')
    elif act == 'uninstall':
        sql(f"select cron.unschedule(jobid) from cron.job where jobname = {lit(JOB)}")
        sql('drop schema if exists data_alarms cascade')
        sql("delete from vault.secrets where name in ('data_alarms_telegram_bot_token', 'data_alarms_telegram_chat_id')")
        print('uninstalled')
    else:
        raise SystemExit('usage: install | status | fire-test | uninstall')


if __name__ == '__main__':
    main()
