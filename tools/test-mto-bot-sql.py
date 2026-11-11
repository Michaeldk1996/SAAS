#!/usr/bin/env python3
"""The MTO detector + alert + archive (tools/mto-bot.sql) on a REAL throwaway Postgres, fed REAL captured payloads.

tools/fixtures/mto/lta-capture.json = Live Tennis API answers captured 11 Nov 2026 (a /events page of 50 rows from
8 Nov 12:00Z, /matches/{id} and /matches/{id}/events for four ATP matches with a medical timeout), and
tools/fixtures/mto/apitennis-fixtures.json = our own api-tennis fixtures for those four matches. The expected values
are the four posts of the Physio-Tennis Telegram channel, read by hand (who called it, score, server).

Stubs pg_net (every call is logged so the test can answer it), the Vault, pg_cron-free; applies the real
tools/drops-scope.sql, tools/mto-bot.sql twice (idempotent) and tools/mto-levels.sql, then checks: no key = no call;
the first call asks for stated medical rows only; the real page is ingested once; ATP singles rows are archived with
the right player, score, server, round, level and our match id; every other tour is dropped; one post per MTO (a
re-read, and a second row for the same score, never post twice; a later MTO in the same match does); a row with no
player is posted without the MEDICAL tag; an inferred row and a pause are never an MTO; the post goes to the MTO chat
and never the drops chat; an old MTO is archived but not posted; the result and a retirement are filled after the
match; the failure alert fires once while ATP singles is live and goes to the pipeline chat; the site export.
No Postgres binaries on this machine -> SKIP out loud (never a pass); CI runners carry them."""
import os, sys, json, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pinarch_pg import PG
HERE = os.path.dirname(os.path.abspath(__file__))
SCOPE, SQL, LEVELS = (os.path.join(HERE, f) for f in ('drops-scope.sql', 'mto-bot.sql', 'mto-levels.sql'))
SQL = os.environ.get('MTO_SQL') or SQL

# --mutants: each rule removed from the SQL must turn this test red (a test that cannot fail is not a test)
MUTANTS = [
    ('an inferred row is taken as an MTO', "continue when coalesce(e->>'basis', 'observed') <> 'observed';", ''),
    ('a pause / trainer row is taken as an MTO', "continue when e->>'type' not in ('medical_timeout_start', 'medical_timeout_end');", ''),
    ('the duplicate guard is gone', "del := case when dup is not null then 'duplicate'", "dup := null; del := case when dup is not null then 'duplicate'"),
    ('every tour is archived', "if lower(coalesce(m.tour, '')) <> 'atp' or m.is_doubles is distinct from false then", 'if false then'),
    ('our own Challenger fixture is ignored', "if scope like 'held: not ATP%' then return null; end if;", ''),
    ('the player is guessed when the source gives none', 'side integer := e.player;', 'side integer := coalesce(e.player, 1);'),
    ('posts go to the drops chat', "msg := mto.render(a);\n    rid := mto.send(msg, 'mto_telegram_chat_id');", "msg := mto.render(a);\n    rid := mto.send(msg, 'ten287_telegram_chat_id');"),
    ('an old MTO is posted', 'if coalesce(a.called_at, a.seen_at) < v_at - cfg.post_max_age then', 'if false then'),
    ('the failure alert fires with no ATP match live', 'if p is not null and live and (', 'if p is not null and ('),
    ('a timed-out send is never tried again', "when (r.status_code is null or r.status_code = 429 or r.status_code >= 500) and a.send_tries < 10", "when false"),
    ('the source is named in the post', "'⏱ ' || coalesce(to_char(a.called_at at time zone 'UTC', 'HH24:MI:SS') || ' UTC', '—'));", "'⏱ ' || coalesce(to_char(a.called_at at time zone 'UTC', 'HH24:MI:SS') || ' UTC', '—') || ' · Source: ' || a.source);"),
    ('a stale MTO is still resent', "> now() - (select resend_max_age from mto_rec.config) then 'unsent'", "> now() - interval '100 years' then 'unsent'"),
    ('the weekly report counts a failed post as posted', "count(*) filter (where delivery like 'failed:%'),\n         count(*) filter (where delivery like 'not sent:%')", "0,\n         count(*) filter (where delivery like 'not sent:%')"),
    ('the weekly report goes to the MTO chat', "msg := mto.weekly_text();\n  rid := mto.send(msg, 'pipeline_telegram_chat_id');", "msg := mto.weekly_text();\n  rid := mto.send(msg, 'mto_telegram_chat_id');"),
    ('a lost post is not reported', "if exists (select 1 from mto.archive where delivery like 'failed:%' and sent_at > now() - interval '15 minutes') then", "if false then"),
    ('the server is taken from the wrong side', "case srv when 1 then m.p1_name when 2 then m.p2_name end, dup,", "case srv when 2 then m.p1_name when 1 then m.p2_name end, dup,"),
]
if '--mutants' in sys.argv:
    import subprocess, tempfile
    if not __import__('_pinarch_pg')._bin(): print('SKIP  test-mto-bot-sql --mutants: no Postgres binaries — NOT A PASS'); sys.exit(0)
    src, bad = open(SQL).read(), 0
    for name, old, new in MUTANTS:
        if src.count(old) != 1: print('  FAIL  mutant anchor not unique:', name); bad += 1; continue
        with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as f: f.write(src.replace(old, new))
        r = subprocess.run([sys.executable, os.path.abspath(__file__)], env=dict(os.environ, MTO_SQL=f.name), capture_output=True, text=True)
        os.unlink(f.name)
        fails = [l.strip() for l in r.stdout.splitlines() if l.strip().startswith('FAIL')]
        if r.returncode == 0 or not fails: print('  FAIL  mutant SURVIVED:', name); bad += 1
        else: print(f'  PASS  mutant caught: {name}  ({len(fails)} red, e.g. {fails[0][:90]})')
    print(f'\ntest-mto-bot-sql --mutants: {len(MUTANTS) - bad} caught, {bad} survived'); sys.exit(1 if bad else 0)
CAP = json.load(open(os.path.join(HERE, 'fixtures', 'mto', 'lta-capture.json')))
FX = json.load(open(os.path.join(HERE, 'fixtures', 'mto', 'apitennis-fixtures.json')))
pg = PG()
if not pg.available():
    print(f'SKIP  test-mto-bot-sql: {pg.why} — NOT A PASS (the code gate runs it)'); sys.exit(0)
q = pg.q
passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('  PASS ', name)
    else: failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-700:])
def lit(o): return "$j$" + json.dumps(o) + "$j$"

STUB = """
create schema ten280_bot; create schema ten287_bot; create schema ten287_rec; create schema vault; create schema net;
create table net._http_response (id bigint primary key, status_code int, content text, error_msg text, created timestamptz default now());
create sequence net.seq;
create table net.calls (id bigint primary key, method text, url text, headers jsonb, body jsonb);
create function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
  returns bigint language plpgsql as $$ declare i bigint := nextval('net.seq'); begin
    insert into net.calls values (i, 'GET', url, headers, null); return i; end $$;
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
  returns bigint language plpgsql as $$ declare i bigint := nextval('net.seq'); begin
    insert into net.calls values (i, 'POST', url, headers, body); return i; end $$;
create table vault.decrypted_secrets (name text, decrypted_secret text);
create table public.kibl_fixtures (fixture_id bigint primary key, scheduled_start timestamptz);
create table ten287_rec.events (event_id bigint primary key, start_at timestamptz);
create table ten280_bot.alerts (id bigserial primary key, mode text not null, fixture_id bigint not null, side_id int not null default 2,
  tier text, player_a text, player_b text, side_player text, eval_at timestamptz not null default now(),
  delivery text not null default 'unsent', created_at timestamptz not null default now());
create table ten287_bot.alerts (id bigserial primary key, mode text not null, book text not null default 'Superbet', event_id bigint not null,
  side text not null default 'home', tier text, player_a text, player_b text, side_player text, eval_at timestamptz not null default now(),
  delivery text not null default 'unsent', created_at timestamptz not null default now());
create table public.live_snapshot (id smallint primary key default 1, board jsonb not null default '{}', updated_at timestamptz not null default now());
insert into public.live_snapshot (id) values (1);
alter database postgres set timezone = 'UTC';
"""
MATCHES = {int(k): v['body'] for k, v in CAP['matches'].items()}
SLATE = CAP['slate']['body']
REAL_MED = [r for r in SLATE['data'] if r['type'] in ('medical_timeout_start', 'medical_timeout_end')]

def answer(events_body=None, extra_matches=None):
    """Answer every open call the way the API would: the captured page for /events, the captured match or a 404."""
    rc, out = q("select coalesce(json_agg(json_build_object('id', c.id, 'url', c.url)), '[]') from net.calls c "
                "where c.method = 'GET' and not exists (select 1 from net._http_response r where r.id = c.id)")
    for c in json.loads(out):
        if '/events' in c['url']:
            body = events_body if events_body is not None else CAP['slateEmpty']['body']
            q(f"insert into net._http_response (id, status_code, content) values ({c['id']}, 200, {lit(body)})")
        else:
            mid = int(re.search(r'/matches/(\d+)', c['url']).group(1))
            m = (extra_matches or {}).get(mid) or MATCHES.get(mid)
            if m: q(f"insert into net._http_response (id, status_code, content) values ({c['id']}, 200, {lit(m)})")
            else: q(f"insert into net._http_response (id, status_code, content) values ({c['id']}, 404, '{{\"error\":\"not_found\"}}')")
def tick(): return q("select mto_rec.tick()")
def drain(events_body=None, extra_matches=None, rounds=8):
    answer(events_body, extra_matches)
    for _ in range(rounds):
        tick(); answer(None, extra_matches)
    tick()
def one(sql):
    rc, out = q(sql); return out
def fixtures():
    for f in FX:
        q("insert into drops_scope.fixture (event_key, event_date, event_time, start_utc, first_player, second_player, sk1, sk2, "
          "event_type_type, event_qualification, tournament_name, tournament_round, event_status, event_winner) values ("
          f"{f['event_key']}, '{f['event_date']}', '{f['event_time']}', ('{f['event_date']} {f['event_time']}')::timestamp at time zone 'UTC', "
          f"$n${f['event_first_player']}$n$, $n${f['event_second_player']}$n$, drops_scope.sk($n${f['event_first_player']}$n$), "
          f"drops_scope.sk($n${f['event_second_player']}$n$), '{f['event_type_type']}', '{f['event_qualification']}', "
          f"$n${f['tournament_name']}$n$, $n${f['tournament_round']}$n$, '{f['event_status']}', '{f['event_winner']}') "
          "on conflict (event_key) do nothing")
def slate_of(match_id, first_id, **over):
    """A /events page built from the REAL per-match rows of a captured match (the per-match shape has no id / match_id)."""
    rows, i = [], first_id
    for r in sorted(CAP['matchEvents'][str(match_id)]['body']['data'] if isinstance(CAP['matchEvents'][str(match_id)]['body'], dict)
                    else CAP['matchEvents'][str(match_id)]['body'], key=lambda r: r.get('at') or r.get('timestamp') or ''):
        if r.get('type') not in ('medical_timeout_start', 'medical_timeout_end'): continue
        rows.append(dict(r, id=i, match_id=match_id, **over)); i += 1
    return {'data': rows, 'meta': {'count': len(rows), 'has_more': False, 'next_cursor': None, 'watermark': '2026-11-11T12:07:28Z'}}

try:
    pg.roles()
    rc, out = q(STUB); check('stubs (pg_net with a call log, vault, the other bots, the live board)', rc == 0, out)
    rc, err = pg.file(SCOPE); check('drops-scope.sql applies', rc == 0, err)
    for i in (1, 2):
        rc, err = pg.file(SQL); check(f'mto-bot.sql applies (pass {i}: idempotent)', rc == 0, err)
    rc, err = pg.file(LEVELS); check('mto-levels.sql applies', rc == 0, err)
    check('the captured page holds real stated medical rows', len(REAL_MED) >= 4 and all(r['basis'] == 'observed' for r in REAL_MED), len(REAL_MED))
    fixtures()
    check('our four api-tennis fixtures are in', one("select count(*) from drops_scope.fixture") == '4')

    # no key -> no call, and the watch says so
    tick()
    check('no API key in Vault: no call is made', one("select count(*) from net.calls") == '0')
    check('…and the problem names it', 'no API key' in one("select mto.problem()"))
    q("insert into vault.decrypted_secrets values ('livetennisapi_key', ' KEY123 '), ('ten287_telegram_bot_token', 'TOK'), ('ten287_telegram_chat_id', 'DROPSCHAT')")

    # ATP singles is live on our board from here on (a read every tick)
    LIVE = {'matches': [{'event_key': 1, 'event_type_type': 'Atp Singles', 'event_live': '1', 'event_winner': None, 'event_status': 'Set 2'}]}
    q(f"update public.live_snapshot set board = {lit(LIVE)}::jsonb, updated_at = now()")

    # the first call
    tick()
    url = one("select url from net.calls order by id limit 1")
    check('the first call asks /events for the stated medical types only, since the start',
          '/events?type=medical_timeout_start,medical_timeout_end&limit=200&since=' in url and 'after_id' not in url, url)
    check('…with the key in the X-API-Key header, trimmed', one("select headers->>'X-API-Key' from net.calls order by id limit 1") == 'KEY123')
    check('no pause or trainer type is ever asked for', 'pause' not in url and 'stoppage' not in url and 'trainer' not in url, url)
    tick()
    check('one call in flight at most', one("select count(*) from net.calls") == '1')

    # the real page: everything is days old, so first run with the age limit off to see the posts
    q("update mto_rec.config set post_max_age = interval '100 years'")
    drain(SLATE)
    check('the real page is ingested: its medical rows, nothing else',
          one("select n_items from mto_rec.requests where kind = 'events' order by id limit 1") == str(len(REAL_MED)), one("select n_items from mto_rec.requests where kind = 'events' order by id limit 1"))
    check('the cursor is the highest id on the page', one("select cursor_id from mto_rec.state") == str(max(r['id'] for r in SLATE['data'])))
    check('the feed clock is kept', one("select watermark is not null from mto_rec.state") == 't')
    nxt = one("select url from net.calls where url like '%/events%' order by id desc limit 1")
    check('the next call continues after the cursor', 'after_id=' + str(max(r['id'] for r in SLATE['data'])) in nxt and 'since=' not in nxt, nxt)
    n_matches = len(set(r['match_id'] for r in REAL_MED))
    check('each unknown match is looked up once', one("select count(*) || '/' || count(distinct match_id) from mto_rec.requests where kind = 'match'") == f'{n_matches}/{n_matches}',
          one("select count(*) || '/' || count(distinct match_id) from mto_rec.requests where kind = 'match'"))
    check('exactly the two ATP medical timeouts on the page are archived (every other tour dropped)',
          one("select string_agg(source_event_id::text, ',' order by source_event_id) from mto.archive") == '1758566,1759248', one("select string_agg(source_event_id::text, ',' order by source_event_id) from mto.archive"))
    check('nothing of a non-ATP match is kept', one("select count(*) from mto_rec.events e join mto_rec.matches m using (match_id) where m.tour <> 'atp'") == '0')

    # MTO 2 of the screenshot: Montes De La Torre v Sonego, Stockholm qualifying, 5-7 0-0, Sonego serving
    a = json.loads(one("select row_to_json(a) from mto.archive a where source_event_id = 1758566"))
    check('Montes v Sonego: who called it', a['player'] == 'Inaki Montes-De La Torre' and a['opponent'] == 'Lorenzo Sonego' and a['player_side'] == 1, a)
    check('Montes v Sonego: sets 5-7 0-0, game 0-0', a['games'] == [[5, 0], [7, 0]] and a['points'] == ['0', '0'], a)
    check('Montes v Sonego: Sonego serving', a['server'] == 'Lorenzo Sonego', a)
    check('Montes v Sonego: our match id, ATP 250, Stockholm, qualifying, round', a['event_key'] == 12178198 and a['level'] == 'ATP 250'
          and a['tournament'] == 'Stockholm' and a['qualifying'] is True and a['round'] == 'Final', a)
    check('Montes v Sonego: surface, time of the call (UTC), source', a['surface'] == 'hard' and a['indoor'] is True
          and a['called_at'].startswith('2026-11-08T12:20:21') and a['source'] == 'Live Tennis API', a)
    check('Montes v Sonego: the end row closed it (147 s)', a['duration_seconds'] == 147 and (a['ended_at'] or '').startswith('2026-11-08T12:22:48'), a)
    msg = a['message'] or ''
    check('post: line 1 = LIVE · MTO · who; line 2 = host flag, level, tournament, qualifying, round',
          msg.startswith('🚨 <b>LIVE · MTO · Inaki Montes-De La Torre</b>\n🇸🇪 ATP 250 · Stockholm · Qualifying · Final\n\n'), msg)
    check('post: MEDICAL tag on the player who called it, and only him, with his games per set',
          '\n🇪🇸 Inaki Montes-De La Torre  5 0  🩺 <b>MEDICAL</b>\n' in msg and msg.count('🩺 <b>MEDICAL</b>') == 1, msg)
    check('post: the server is marked, with his games', '\n🇮🇹 Lorenzo Sonego  7 0  ● serving\n' in msg and msg.count('● serving') == 1, msg)
    check('post: the time of the call is its last line', msg.endswith('\n\n⏱ 12:20:21 UTC'), msg)
    check('post: no source is named', 'Source' not in msg and 'Live Tennis' not in msg, msg)
    check('round as the site prints it', one("select mto.round_short('1/8-finals') || '|' || mto.round_short('1/16-finals') || '|' || mto.round_short('Final') || '|' || mto.round_short('1/4-finals')") == 'R16|R32|Final|Quarter-finals')
    check('score: a dash when not sent; game points only once a point is played; server and MEDICAL on one player',
          one("select mto.side_score(null, null, 1) || '|' || mto.side_score('[[6],[5]]'::jsonb, '[\"0\",\"0\"]'::jsonb, 2) || '|' || mto.side_score('[[6,1],[5,2]]'::jsonb, '[\"30\",\"40\"]'::jsonb, 1)") == '—|5|6 1 (30)'
          and '  6 6 0  ● serving · 🩺 <b>MEDICAL</b>' in (r4m := one("select mto.render(a) from mto.archive a where source_event_id = 1758566") and one("select mto.render(x) from (select (jsonb_populate_record(a, '{\"server_side\": 1, \"games\": [[6,6,0],[4,7,0]]}'::jsonb)).* from mto.archive a where source_event_id = 1758566) x")), r4m)
    check('no MTO chat in Vault: not sent, and never to the drops chat',
          a['delivery'] == 'unsent: no vault secret' and one("select count(*) from net.calls where method = 'POST'") == '0', a['delivery'])

    # MTO 3: Fearnley v Shevchenko, 2-6 3-2, Shevchenko serving (the feed lists Shevchenko first)
    b = json.loads(one("select row_to_json(a) from mto.archive a where source_event_id = 1759248"))
    check('Fearnley v Shevchenko: Fearnley called it, Shevchenko serving', b['player'] == 'Jacob Fearnley' and b['server'] == 'Alexander Shevchenko', b)
    check('Fearnley v Shevchenko: 6-2 2-3 in the feed order = 2-6 3-2 for Fearnley', b['games'] == [[6, 2], [2, 3]] and b['event_key'] == 12178224, b)
    check('Fearnley v Shevchenko: 182 s', b['duration_seconds'] == 182, b)

    # MTO 1 and 4, from their real per-match rows: Ruud v Alcaraz (Paris SF) and Etcheverry v Dahlin (main draw)
    drain(slate_of(216324, 9000001))
    r1 = json.loads(one("select row_to_json(a) from mto.archive a where source_match_id = 216324"))
    check('Ruud v Alcaraz: Ruud called it at 4-5, Alcaraz serving, ATP 1000 Paris semi-final, main draw',
          r1['player'] == 'Casper Ruud' and r1['games'] == [[5], [4]] and r1['server'] == 'Carlos Alcaraz' and r1['level'] == 'ATP 1000'
          and r1['tournament'] == 'Paris' and r1['round'] == 'Semi-finals' and r1['qualifying'] is False and r1['event_key'] == 12178070, r1)
    drain(slate_of(216399, 9000101))
    r4 = json.loads(one("select row_to_json(a) from mto.archive a where source_match_id = 216399"))
    check('Etcheverry v Dahlin: Etcheverry called it and serves, 6-4 6-7 0-0',
          r4['player'] == 'Tomas Martin Etcheverry' and r4['server'] == 'Tomas Martin Etcheverry' and r4['games'] == [[6, 6, 0], [4, 7, 0]]
          and r4['round'] == '1/16-finals' and r4['event_key'] == 12178148, r4)
    check('four real MTOs, four archive rows', one("select count(*) from mto.archive") == '4')

    # one post per MTO
    q(f"select mto_rec.ingest_events({lit(SLATE)}::jsonb, now())"); drain()
    check('the same page read again adds no archive row and no post', one("select count(*) from mto.archive") == '4')
    real = next(r for r in REAL_MED if r['id'] == 1758566)
    def page(*rows): return {'data': list(rows), 'meta': {'watermark': '2026-11-11T12:07:28Z'}}
    drain(page(dict(real, id=9100001, at='2026-11-08T12:20:55Z')))
    d = json.loads(one("select row_to_json(a) from mto.archive a where source_event_id = 9100001"))
    check('a second row for the same match, player and score inside 15 min is a duplicate: never posted',
          d['delivery'] == 'duplicate' and d['dup_of'] is not None, d)
    drain(page(dict(real, id=9100002, at='2026-11-08T12:50:00Z', score=dict(real['score'], games=[[5, 3], [7, 2]]))))
    d2 = json.loads(one("select row_to_json(a) from mto.archive a where source_event_id = 9100002"))
    check('CONTROL: a later MTO in the same match (another score) is a new post', d2['dup_of'] is None and d2['delivery'] == 'unsent: no vault secret', d2)

    # the player is never guessed
    drain(page(dict(real, id=9100003, at='2026-11-08T12:58:00Z', player=None, player_id=None, score=dict(real['score'], games=[[5, 4], [7, 2]]))))
    np = json.loads(one("select row_to_json(a) from mto.archive a where source_event_id = 9100003"))
    check('no player in the source: stored empty', np['player'] is None and np['opponent'] is None and np['player_side'] is None, np)
    check('…and posted with no MEDICAL tag on either player', '🩺' not in (np['message'] or '') and 'Player not stated.' in np['message']
          and np['message'].startswith('🚨 <b>LIVE · MTO</b>\n'), np['message'])

    # never inferred
    before = one("select count(*) from mto.archive")
    drain(page(dict(real, id=9100004, basis='inferred', score=dict(real['score'], games=[[5, 5], [7, 2]])),
               dict(real, id=9100005, type='pause_start', basis='inferred'),
               dict(real, id=9100006, type='stoppage_start'), dict(real, id=9100007, type='trainer_called')))
    check('an inferred row, a pause, a bare stoppage and a trainer call are never an MTO', one("select count(*) from mto.archive") == before, one("select count(*) from mto.archive"))
    check('…the cursor still moves past them', one("select cursor_id from mto_rec.state") == '9100007', one("select cursor_id from mto_rec.state"))

    # scope: ATP singles only, by the feed AND by our own fixture
    ch = dict(MATCHES[216489], id=777001, tour='challenger')
    dbl = dict(MATCHES[216489], id=777002, is_doubles=True)
    notours = dict(MATCHES[216489], id=777003)
    notours['players'] = {'p1': dict(MATCHES[216489]['players']['p1'], name='Xavier Nobody'), 'p2': dict(MATCHES[216489]['players']['p2'], name='Yann Noone')}
    challfx = dict(MATCHES[216489], id=777004)
    challfx['players'] = {'p1': dict(MATCHES[216489]['players']['p1'], name='Learner Tien'), 'p2': dict(MATCHES[216489]['players']['p2'], name='Reilly Opelka')}
    q("insert into drops_scope.fixture (event_key, event_date, event_time, start_utc, first_player, second_player, sk1, sk2, event_type_type, event_qualification, tournament_name, tournament_round) "
      "values (9002, '2026-11-08', '11:10', '2026-11-08 11:10+00', 'L. Tien', 'R. Opelka', drops_scope.sk('L. Tien'), drops_scope.sk('R. Opelka'), 'Challenger Men Singles', 'False', 'T', 'R')")
    extra = {777001: ch, 777002: dbl, 777003: notours, 777004: challfx}
    drain(page(dict(real, id=9200001, match_id=777001), dict(real, id=9200002, match_id=777002),
               dict(real, id=9200003, match_id=777003), dict(real, id=9200004, match_id=777004)), extra)
    check('a Challenger match and a doubles match are never archived',
          one("select count(*) from mto.archive where source_match_id in (777001, 777002)") == '0')
    check('a match the feed calls ATP but our fixture says is a Challenger is never archived',
          one("select count(*) from mto.archive where source_match_id = 777004") == '0')
    h = one("select delivery from mto.archive where source_match_id = 777003")
    check('an ATP match with no api-tennis fixture is held, not posted', h.startswith('held: no api-tennis fixture'), h)

    # sending: the MTO chat, never the drops chat
    q("insert into vault.decrypted_secrets values ('mto_telegram_chat_id', ' MTOCHAT ')")
    q("update mto.archive set delivery = 'unsent' where source_event_id = 1759248")
    tick()
    p = json.loads(one("select row_to_json(c) from net.calls c where method = 'POST' order by id desc limit 1"))
    check('the post goes to the MTO chat with the drop bot\'s token', p['body']['chat_id'] == 'MTOCHAT' and p['url'].endswith('/botTOK/sendMessage') and p['body']['parse_mode'] == 'HTML', p)
    check('nothing is ever posted to the drops chat', one("select count(*) from net.calls where method = 'POST' and body->>'chat_id' = 'DROPSCHAT'") == '0')
    check('queued, with its delay', one("select delivery || '/' || (delay_s is not null) from mto.archive where source_event_id = 1759248") == 'queued/true')
    q(f"insert into net._http_response (id, status_code, content) values ({p['id']}, 200, '{{}}')"); tick()
    check('Telegram said yes: sent', one("select delivery from mto.archive where source_event_id = 1759248") == 'sent')

    # a send Telegram never answered is tried again (11 Nov 2026: Ruud's 17:53Z MTO was archived and never posted)
    def last_post(): return json.loads(one("select row_to_json(c) from net.calls c where method = 'POST' order by id desc limit 1"))
    def tries(): return one("select delivery || '/' || send_tries from mto.archive where source_match_id = 216324")
    q("update mto_rec.config set resend_max_age = interval '100 years'")
    q("update mto.archive set delivery = 'unsent', send_tries = 0 where source_match_id = 216324"); tick()
    p1 = last_post()
    q(f"insert into net._http_response (id, status_code, error_msg) values ({p1['id']}, null, 'Timeout of 10000 ms reached')"); tick()
    p2 = last_post()
    check('a timed-out send is sent again, the same text', p2['id'] != p1['id'] and p2['body']['text'] == p1['body']['text'] and tries() == 'queued/2', (p1['id'], p2['id'], tries()))
    q(f"insert into net._http_response (id, status_code, content) values ({p2['id']}, 200, '{{}}')"); tick()
    check('…and the retry that Telegram accepts is sent, once', tries() == 'sent/2' and last_post()['id'] == p2['id'], tries())
    q("update mto.archive set delivery = 'unsent', send_tries = 0 where source_match_id = 216324"); tick()
    p3 = last_post()
    q(f"insert into net._http_response (id, status_code, content) values ({p3['id']}, 400, '{{}}')"); tick()
    check('CONTROL: an HTTP 400 is our own fault: failed, not sent again', tries() == 'failed: HTTP 400/1' and last_post()['id'] == p3['id'], tries())
    q("update mto.archive set delivery = 'unsent', send_tries = 0 where source_match_id = 216324")
    for _ in range(14):
        tick(); pp = last_post()
        q(f"insert into net._http_response (id, status_code, error_msg) values ({pp['id']}, null, 'Timeout') on conflict (id) do nothing")
    tick()
    check('ten sends at most, then failed with its reason', tries() == 'failed: Timeout/10', tries())
    check('a send is given 5 s, so the next try is one tick away', one("select prosrc like '%timeout_milliseconds := 5000%' from pg_proc where proname = 'send' and pronamespace = 'mto'::regnamespace") == 't')
    q("create table public.st_keep as select * from mto_rec.state; update mto_rec.state set last_ok_at = now(), watermark = now()")
    lost = one("select coalesce(mto.problem(), 'none')")
    q("update mto_rec.state s set last_ok_at = k.last_ok_at, watermark = k.watermark from public.st_keep k; drop table public.st_keep")
    check('a post lost after every retry is a problem the watch reports',
          'NOT posted to Telegram after 10 tries' in lost and 'Casper Ruud' in lost and 'Carlos Alcaraz' in lost, lost)
    q("update mto_rec.config set resend_max_age = interval '2 minutes'")
    check('the resend window is 2 minutes after the call', one("select resend_max_age = interval '2 minutes' from mto_rec.config") == 't')
    q("update mto.archive set delivery = 'unsent', send_tries = 0, called_at = now() - interval '90 seconds' where source_match_id = 216324"); tick()
    p5 = last_post()
    q(f"insert into net._http_response (id, status_code, error_msg) values ({p5['id']}, null, 'Timeout')"); tick()
    check('a call 90 s old: a timed-out send is sent again', last_post()['id'] != p5['id'] and tries() == 'queued/2', tries())
    q("update mto.archive set called_at = now() - interval '3 minutes' where source_match_id = 216324")
    p6 = last_post()
    q(f"insert into net._http_response (id, status_code, error_msg) values ({p6['id']}, null, 'Timeout')"); tick()
    check('CONTROL: a call more than 2 min old is not sent again', last_post()['id'] == p6['id'] and tries() == 'failed: Timeout/2', tries())
    q("update mto.archive set delivery = 'sent' where source_match_id = 216324")
    q("update mto_rec.config set post_max_age = interval '10 minutes'; update mto.archive set delivery = 'unsent' where source_event_id = 1758566")
    posts = one("select count(*) from net.calls where method = 'POST'"); tick()
    late = one("select delivery from mto.archive where source_event_id = 1758566")
    check('an MTO first seen more than 10 min after the call is archived but not posted',
          late.startswith('not sent: seen ') and one("select count(*) from net.calls where method = 'POST'") == posts, late)

    # after the match: result + retirement
    check('the result is asked for once the match is over', one("select count(*) > 0 from mto_rec.requests where kind = 'result' and match_id = 216489") == 't')
    s = json.loads(one("select row_to_json(a) from mto.archive a where source_event_id = 1758566"))
    check('Montes v Sonego: final result 5-7 3-6, Sonego won, not a retirement', s['final_result'] == '5–7, 3–6' and s['winner'] == 'Lorenzo Sonego'
          and s['retired'] is False and s['outcome'] == 'completed' and s['apitennis_status'] == 'Finished' and s['settled_at'], s)
    q("update mto.archive set settled_at = null, retired = null, result_asked_at = null where source_match_id = 216399")
    drain(None, {216399: dict(MATCHES[216399], outcome='retired')})
    check('a match that ended in a retirement is marked so', one("select bool_and(retired) from mto.archive where source_match_id = 216399") == 't')
    live_m = dict(MATCHES[216536], status='live', outcome=None, winner=None)
    q("update mto.archive set settled_at = null, final_result = null, result_asked_at = null where source_match_id = 216536")
    drain(None, {216536: live_m})
    check('a match still in play gets no result (asked again later)', one("select final_result is null and settled_at is null from mto.archive where source_event_id = 1759248") == 't')

    # the weekly report: how many alerts failed to send, each count over the timeouts detected
    q("create table public.arch_keep as select id, delivery, send_tries, called_at, delay_s from mto.archive")
    q("update mto.archive set called_at = now() - interval '2 days', delivery = 'sent', send_tries = 1, delay_s = 40 where dup_of is null")
    q("update mto.archive set send_tries = 3, delay_s = 60 where source_event_id = 1759248")
    q("update mto.archive set delivery = 'failed: Timeout of 5000 ms reached', send_tries = 10 where source_match_id = 216324")
    q("update mto.archive set called_at = now() - interval '9 days' where source_match_id = 216399")
    nw = int(one("select count(*) from mto.archive where dup_of is null and called_at > now() - interval '7 days'"))
    wk = one("select mto.weekly_text()")
    check('weekly: detected, posted (first try / resend) and FAILED, each over the same denominator',
          f'Medical timeouts detected: <b>{nw}</b>' in wk and f'Posted: <b>{nw - 1} of {nw}</b> (first try {nw - 2}, after a resend 1)' in wk
          and f'FAILED to send: <b>1 of {nw}</b>' in wk, wk)
    check('weekly: the failed one is named with its reason; a timeout 9 days old is outside the week',
          'Casper Ruud' in wk.split('Not posted:')[1] and 'failed: Timeout of 5000 ms reached' in wk and 'Etcheverry' not in wk, wk)
    check('weekly: median delay with its n', f'Median call → post: 40 s (n={nw - 1})' in wk, wk)
    check('weekly: no source named', 'Live Tennis' not in wk and 'Source' not in wk, wk)
    q("update mto.archive set called_at = now() - interval '30 days'")
    wk0 = one("select mto.weekly_text()")
    check('weekly: an empty week says 0 and gives no rate or median', 'Medical timeouts detected: <b>0</b>' in wk0 and 'FAILED to send: <b>0 of 0</b>' in wk0 and 'Median call → post: —' in wk0, wk0)
    q("update mto.archive a set delivery = k.delivery, send_tries = k.send_tries, called_at = k.called_at, delay_s = k.delay_s from public.arch_keep k where k.id = a.id; drop table public.arch_keep")
    q("delete from vault.decrypted_secrets where name = 'pipeline_telegram_chat_id'")
    check('weekly: with no pipeline chat it is unsent, never another chat', one("select mto.weekly_send()") == 'unsent'
          and one("select count(*) from net.calls where method = 'POST' and body->>'chat_id' <> 'MTOCHAT'") == '0')
    q("insert into vault.decrypted_secrets values ('pipeline_telegram_chat_id', 'PIPECHAT')")
    check('weekly: goes to the pipeline chat', one("select mto.weekly_send()") == 'queued'
          and one("select body->>'chat_id' from net.calls where method = 'POST' order by id desc limit 1") == 'PIPECHAT')
    check('weekly: not sent twice in a week', one("select mto.weekly_send()") == 'already sent')
    q("delete from vault.decrypted_secrets where name = 'pipeline_telegram_chat_id'")

    # cadence
    q("update mto_rec.requests set processed_at = now() where processed_at is null")
    q("update public.live_snapshot set board = '{}'::jsonb")
    n0 = one("select count(*) from mto_rec.requests where kind = 'events'"); tick()
    check('no ATP singles live on our board: at most one read a minute', one("select count(*) from mto_rec.requests where kind = 'events'") == n0)
    q(f"update public.live_snapshot set board = {lit(LIVE)}::jsonb, updated_at = now()")
    tick()
    check('ATP singles live on our board: a read every tick', one("select count(*) from mto_rec.requests where kind = 'events'") == str(int(n0) + 1))
    q("update public.live_snapshot set board = $j${\"matches\":[{\"event_type_type\":\"Challenger Men Singles\",\"event_live\":\"1\",\"event_status\":\"Set 1\"}]}$j$::jsonb")
    check('a Challenger match in play is not "ATP live"', one("select mto.atp_live()") == 'f')

    # failure alert
    q("update mto_rec.state set last_ok_at = now(), watermark = now()")
    check('healthy: no problem', one("select coalesce(mto.problem(), 'none')") == 'none')
    q("update mto_rec.state set last_ok_at = now() - interval '7 minutes', last_status = 403")
    check('problem but no ATP match live: silent', one("select coalesce(mto.watch_tick(), 'none')") == 'none')
    q(f"update public.live_snapshot set board = {lit(LIVE)}::jsonb, updated_at = now()")
    check('detector stopped while ATP singles is live: one alert', one("select mto.watch_tick()") == 'alert')
    w = one("select text || ' >> ' || delivery from mto.watch_log where kind = 'alert'")
    check('…it says what is wrong, and with no pipeline chat it is unsent (never the drops chat)',
          'no successful read of the source for 7 min (last answer HTTP 403)' in w and w.endswith('unsent: no vault secret')
          and one("select count(*) from net.calls where method = 'POST' and body->>'chat_id' = 'DROPSCHAT'") == '0', w)
    check('…not repeated the next minute', one("select coalesce(mto.watch_tick(), 'none')") == 'none')
    q("insert into vault.decrypted_secrets values ('pipeline_telegram_chat_id', 'PIPECHAT'); update mto.watch set last_sent = now() - interval '4 hours'")
    check('…repeated after 3 h, to the pipeline chat', one("select mto.watch_tick()") == 'alert'
          and one("select body->>'chat_id' from net.calls where method = 'POST' order by id desc limit 1") == 'PIPECHAT')
    q("update mto_rec.state set last_ok_at = now(), watermark = now() - interval '9 minutes'; update mto.watch set open_since = null, last_sent = null")
    check('the source silent during live play (its clock 9 min old): alert', one("select mto.watch_tick()") == 'alert'
          and 'gone silent' in one("select text from mto.watch_log order by id desc limit 1"))
    q("update mto_rec.state set watermark = now()")
    check('fixed: one RECOVERED message', one("select mto.watch_tick()") == 'recovered' and one("select coalesce(mto.watch_tick(), 'none')") == 'none')

    # the site export + the report
    ex = json.loads(one("select public.mto_export()", ) or '{}')
    check('export: the MTO sits on our match id with who called it and the score',
          ex.get('12178198', [{}])[0].get('player') == 'Inaki Montes-De La Torre' and ex['12178198'][0]['games'] == [[5, 0], [7, 0]]
          and ex['12178198'][0]['server'] == 'Lorenzo Sonego', ex.get('12178198'))
    check('export: duplicates are left out, a second MTO stays', [r['calledAt'][:16] for r in ex['12178198']] == ['2026-11-08T12:20', '2026-11-08T12:50', '2026-11-08T12:58'], ex.get('12178198'))
    check('export: a match with no MTO is absent (no empty entry)', all(len(v) > 0 for v in ex.values()) and '9002' not in ex, list(ex))
    rc, out = q("select public.mto_export()", 'anon'); check('export is not readable by the publishable key', rc != 0, out)
    rc, out = q("select mto.report(24)"); rep = json.loads(out) if rc == 0 else {}
    check('report runs', rc == 0 and rep.get('archive', {}).get('rows', 0) >= 4 and rep.get('key') is True, out)
    rc, out = q("select mto.startup()"); check('startup message goes to the MTO chat, once', rc == 0
          and one("select body->>'chat_id' from net.calls where method = 'POST' order by id desc limit 1") == 'MTOCHAT'
          and one("select coalesce(mto.startup()::text, 'null')") == 'null', out)
finally:
    pg.close()
print(f'\ntest-mto-bot-sql: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
