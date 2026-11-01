-- Data alarms (architecture program stage 1, 2026-11-01). One pg_cron watch, every 5 min, outside GitHub.
--
-- Each alarm row sends ONE Telegram per streak (when it goes bad) and ONE recovery line (when it is good again),
-- to the pipeline-alerts chat. A message counts as delivered only on a 2xx from api.telegram.org; an unconfirmed
-- alert or recovery is sent again on the next tick (pg_net can lose a message to a TLS timeout, measured on TEN-280).
--
-- Rows (thresholds in data_alarms.config, set by the program brief, 1 Nov 2026):
--   data_age      the live build-info.json data.builtAt is more than 60 min old when read
--   card_state    the live odds-card-state.json generatedAt is more than 60 min old when read (15 after stage 3)
--   live_poller   live_snapshot has not been written for 10 min while an ATP singles card is scheduled today
--                 (Europe/Berlin day, an unfinished card on the live matches.json)
--   kibl_stream   the kibl-stream worker heartbeat (kibl_now_price, card_key '__stream__') is silent for 10 min
--   close_cover   once a day: fewer than 90% of yesterday's Completed cards carry a card-book close
--                 (close-coverage.json, built by tools/close-coverage.mjs in the pipeline from the page's own
--                 _mcCardCloseOf); the daily message gives "X of Y" and every dash's reason
--   cron_jobs     a job in data_alarms.expected_jobs is missing from cron.job or inactive (a breaker unscheduled it)
-- A source that cannot be read twice in a row is itself a bad state ("cannot read ..."), never a silent ok.
--
-- Manufactured stale states (rule: every alarm row proven to fire): data_alarms.force holds a fake observation for
-- one row until a time; while it is set the row judges the fake value and its messages start "[TEST] ".
-- Own Vault names (data_alarms_telegram_*); own advisory lock; idempotent; installs NOTHING scheduled.
create schema if not exists data_alarms;
revoke all on schema data_alarms from public, anon, authenticated;

create table if not exists data_alarms.config (
    name        text primary key,
    threshold   interval,           -- age limit (null for the rows judged by a count)
    min_pct     numeric,            -- close_cover only
    enabled     boolean not null default true,
    what        text not null
);
insert into data_alarms.config (name, threshold, min_pct, what) values
  ('data_age',    interval '60 minutes', null, 'published site data (build-info.json data.builtAt)'),
  ('card_state',  interval '60 minutes', null, 'card prices file (odds-card-state.json generatedAt)'),
  ('live_poller', interval '10 minutes', null, 'live poller (live_snapshot.updated_at) while ATP singles are scheduled'),
  ('kibl_stream', interval '10 minutes', null, 'kibl-stream worker heartbeat'),
  ('close_cover', null,                  90,   'yesterday''s Completed cards with a card-book close'),
  ('cron_jobs',   null,                  null, 'scheduled database jobs present and active')
on conflict (name) do nothing;

create table if not exists data_alarms.sources (
    name  text primary key,
    url   text not null
);
insert into data_alarms.sources (name, url) values
  ('build_info', 'https://michaeldk1996.github.io/SAAS/build-info.json'),
  ('card_state', 'https://michaeldk1996.github.io/SAAS/odds-card-state.json'),
  ('matches',    'https://michaeldk1996.github.io/SAAS/matches.json'),
  ('coverage',   'https://michaeldk1996.github.io/SAAS/close-coverage.json')
on conflict (name) do nothing;

create table if not exists data_alarms.expected_jobs (jobname text primary key);
insert into data_alarms.expected_jobs (jobname) values
  ('live-poller-10s'), ('ten141-pipeline-ping'), ('ten280-bet105-drop-bot'), ('ten287-recorder'),
  ('ten287-recorder-sweep'), ('ten287-superbet-drop-bot'), ('ten294_drops_watchdog'), ('ten347_publish_watch'),
  ('drops-scope-recheck'), ('ten270-oddspapi-postmatch-ping'), ('ten270-oddspapi-postmatch-check'),
  ('ten216-collector-watchdog')
on conflict (jobname) do nothing;

-- one row per GET; only the fields the rows need are kept (the response itself is deleted once read)
create table if not exists data_alarms.fetches (
    id           bigint primary key,           -- the pg_net request id
    source       text not null,
    fired_at     timestamptz not null default now(),
    processed_at timestamptz,
    status_code  integer,
    ok           boolean,                      -- read and parsed
    stamp        timestamptz,                  -- build_info: data.builtAt · card_state: generatedAt · coverage: generatedAt
    n            integer,                      -- matches: unfinished cards dated today (Berlin)
    body         jsonb,                        -- coverage only: the small report itself
    error        text
);
create index if not exists data_alarms_fetches_src_idx on data_alarms.fetches (source, fired_at desc);

create table if not exists data_alarms.state (
    name         text primary key,
    bad          boolean not null default false,  -- the streak is open (an alert was decided)
    since        timestamptz,
    detail       text,
    owe          text,                            -- 'alert' | 'recovery' not yet confirmed delivered
    owe_text     text,
    checked_at   timestamptz,
    last_detail  text,
    test         boolean not null default false   -- the open streak was manufactured (data_alarms.force)
);
alter table data_alarms.state add column if not exists test boolean not null default false;

create table if not exists data_alarms.force (
    name   text primary key,
    until  timestamptz not null,
    fake   jsonb not null                       -- {"age_min": n} · {"n": n} · {"x": .., "y": .., "day": ..} · {"missing": [..]}
);

create table if not exists data_alarms.messages (
    id             bigserial primary key,
    alarm          text not null,
    kind           text not null,               -- alert | recovery | daily | selftest
    text           text not null,
    net_request_id bigint,
    delivery       text not null default 'queued', -- queued | sent | failed: ...
    created_at     timestamptz not null default now()
);

create table if not exists data_alarms.heartbeat (
    id boolean primary key default true check (id),
    last_tick timestamptz
);
insert into data_alarms.heartbeat (id) values (true) on conflict (id) do nothing;

create or replace function data_alarms.try_jsonb(p text) returns jsonb
language plpgsql immutable as $$
begin
  if p is null or left(ltrim(p), 1) not in ('{', '[') then return null; end if;
  return p::jsonb;
exception when others then
  return null;
end $$;

create or replace function data_alarms.try_ts(p text) returns timestamptz
language plpgsql immutable as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}T' then return null; end if;
  return p::timestamptz;
exception when others then
  return null;
end $$;

create or replace function data_alarms.utc(t timestamptz) returns text
language sql immutable as $$ select to_char(t at time zone 'UTC', 'DD Mon HH24:MI') || 'Z' $$;

create or replace function data_alarms.mins(i interval) returns integer
language sql immutable as $$ select floor(extract(epoch from i) / 60)::int $$;

create or replace function data_alarms.skey(p_name text) returns text
language sql stable as $$ select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1 $$;

create or replace function data_alarms.send(p_alarm text, p_kind text, p_text text) returns bigint
language plpgsql as $$
declare tok text := data_alarms.skey('data_alarms_telegram_bot_token');
        chat text := data_alarms.skey('data_alarms_telegram_chat_id');
        rid bigint;
begin
  if tok is null or chat is null then
    insert into data_alarms.messages (alarm, kind, text, delivery) values (p_alarm, p_kind, p_text, 'failed: no vault secret');
    return null;
  end if;
  select net.http_post(url := 'https://api.telegram.org/bot' || tok || '/sendMessage',
                       body := jsonb_build_object('chat_id', chat, 'text', left(p_text, 4000), 'disable_web_page_preview', true),
                       headers := '{"Content-Type": "application/json"}'::jsonb,
                       timeout_milliseconds := 10000) into rid;
  insert into data_alarms.messages (alarm, kind, text, net_request_id) values (p_alarm, p_kind, p_text, rid);
  return rid;
end $$;

-- the newest processed fetch of a source, and whether the last two both failed
create or replace function data_alarms.last_fetch(p_source text, out f data_alarms.fetches, out unread boolean)
language plpgsql stable as $$
declare n_bad integer;
begin
  select * into f from data_alarms.fetches where source = p_source and processed_at is not null and ok
   order by fired_at desc limit 1;
  select count(*) filter (where not ok) into n_bad
    from (select ok from data_alarms.fetches where source = p_source and processed_at is not null
           order by fired_at desc limit 2) x;
  unread := n_bad >= 2;
end $$;

-- THE RULES. Each returns (bad, detail); null bad = nothing to judge yet. Pure in the forced value.
create or replace function data_alarms.judge(p_name text, p_now timestamptz, out bad boolean, out detail text, out forced boolean)
language plpgsql as $$
declare cfg data_alarms.config; fz data_alarms.force; lf record; age interval; ts timestamptz; n integer; v text;
        x integer; y integer; day text; missing text[];
begin
  select * into cfg from data_alarms.config where name = p_name;
  select * into fz from data_alarms.force where name = p_name and until > p_now;
  forced := fz.name is not null;
  if p_name in ('data_age', 'card_state') then
    if forced then age := make_interval(mins => (fz.fake->>'age_min')::int);
    else
      select * into lf from data_alarms.last_fetch(case p_name when 'data_age' then 'build_info' else 'card_state' end);
      if lf.unread then bad := true; detail := format('%s cannot be read (two checks in a row)', cfg.what); return; end if;
      if (lf.f).id is null then return; end if;
      age := (lf.f).fired_at - (lf.f).stamp;
    end if;
    bad := age > cfg.threshold;
    detail := format('%s: %s min old (alarm above %s)', cfg.what, data_alarms.mins(age), data_alarms.mins(cfg.threshold));
  elsif p_name = 'live_poller' then
    if forced then age := make_interval(mins => (fz.fake->>'age_min')::int); n := coalesce((fz.fake->>'n')::int, 1);
    else
      select max(updated_at) into ts from public.live_snapshot;
      age := p_now - ts;
      select * into lf from data_alarms.last_fetch('matches');
      n := (lf.f).n;
      if n is null and lf.unread then bad := true; detail := 'matches.json cannot be read (two checks in a row): cannot tell whether ATP singles are scheduled'; return; end if;
    end if;
    if age is null then bad := true; detail := 'live_snapshot holds no row'; return; end if;
    if coalesce(n, 0) = 0 then
      bad := false; detail := format('live poller last wrote %s min ago; no unfinished ATP singles card dated today', data_alarms.mins(age));
      return;
    end if;
    bad := age > cfg.threshold;
    detail := format('live poller last wrote %s min ago (alarm above %s; %s unfinished ATP singles card(s) today)',
                     data_alarms.mins(age), data_alarms.mins(cfg.threshold), n);
  elsif p_name = 'kibl_stream' then
    if forced then age := make_interval(mins => (fz.fake->>'age_min')::int);
    else
      select max(written_at) into ts from public.kibl_now_price where card_key = '__stream__';
      age := p_now - ts;
    end if;
    if age is null then bad := true; detail := 'kibl-stream has never written a heartbeat'; return; end if;
    bad := age > cfg.threshold;
    detail := format('kibl-stream heartbeat %s min old (alarm above %s)', data_alarms.mins(age), data_alarms.mins(cfg.threshold));
  elsif p_name = 'cron_jobs' then
    if forced then missing := array(select jsonb_array_elements_text(fz.fake->'missing'));
    else
      missing := array(select e.jobname from data_alarms.expected_jobs e
                        where not exists (select 1 from cron.job j where j.jobname = e.jobname and j.active)
                        order by 1);
    end if;
    bad := coalesce(array_length(missing, 1), 0) > 0;
    detail := case when bad then 'not scheduled or inactive: ' || array_to_string(missing, ', ')
                   else (select count(*) from data_alarms.expected_jobs) || ' expected jobs scheduled and active' end;
  else
    bad := null; detail := 'judged by the daily coverage report';
  end if;
end $$;

-- close coverage: once a day, from the newest readable close-coverage.json for yesterday (Europe/Berlin)
create or replace function data_alarms.coverage(p_now timestamptz) returns text
language plpgsql as $$
declare cfg data_alarms.config; fz data_alarms.force; lf record; b jsonb; st data_alarms.state; yday text; x int; y int;
        pct numeric; is_bad boolean; head text; body text := ''; d jsonb; k int := 0; reasons text; pre text := '';
begin
  select * into cfg from data_alarms.config where name = 'close_cover';
  yday := to_char((p_now at time zone 'Europe/Berlin')::date - 1, 'YYYY-MM-DD');
  -- once a day, from 09:00 UTC (the morning publish has run); a day already reported is not reported again
  if extract(hour from p_now at time zone 'UTC') < 9 then return 'before 09:00Z'; end if;
  select * into fz from data_alarms.force where name = 'close_cover' and until > p_now;
  -- a [TEST] report never stands in for the real one, and the real one is sent once a day
  if fz.name is null and exists (select 1 from data_alarms.messages where alarm = 'close_cover' and kind = 'daily'
               and text like '%' || yday || '%' and text not like '%[TEST]%' and delivery in ('sent', 'queued')) then return 'reported'; end if;
  if fz.name is not null and exists (select 1 from data_alarms.messages where alarm = 'close_cover' and kind = 'daily'
               and text like '%[TEST]%' and created_at > now() - interval '30 minutes' and delivery in ('sent', 'queued')) then return 'test reported'; end if;
  if fz.name is not null then b := fz.fake; pre := '[TEST] ';
  else
    select * into lf from data_alarms.last_fetch('coverage');
    b := (lf.f).body;
    if b is null or b->>'day' is distinct from yday then
      if extract(hour from p_now at time zone 'UTC') < 12 then return 'waiting for ' || yday; end if;
      b := jsonb_build_object('day', yday, 'unread', true);
    end if;
  end if;
  if b ? 'unread' then
    is_bad := true;
    head := format('%sClose coverage %s: no report (close-coverage.json for that day could not be read by 12:00Z).', pre, yday);
  else
    x := (b->>'x')::int; y := (b->>'y')::int;
    pct := case when y > 0 then round(100.0 * x / y, 1) end;
    is_bad := y > 0 and pct < cfg.min_pct;
    head := format('%sClose coverage %s: %s of %s Completed cards carry a card-book close (%s%%; alarm below %s%%).',
                   pre, yday, x, y, coalesce(pct::text, '—'), cfg.min_pct);
    for d in select * from jsonb_array_elements(coalesce(b->'dashes', '[]'::jsonb)) loop
      k := k + 1;
      exit when k > 40;
      body := body || E'\n· ' || coalesce(d->>'match', '?') || ' — ' || coalesce(d->>'reason', 'no reason given');
    end loop;
    if k > 40 then body := body || format(E'\n… and %s more (close-coverage.json)', jsonb_array_length(b->'dashes') - 40); end if;
  end if;
  select * into st from data_alarms.state where name = 'close_cover';
  if fz.name is not null then        -- a manufactured report: the message only; the real streak is untouched
    perform data_alarms.send('close_cover', 'daily', case when is_bad then 'ALARM — ' else '' end || head || body || E'\n' || data_alarms.utc(p_now) || ' (pg_cron)');
    return 'test reported ' || yday;
  end if;
  if is_bad and not coalesce(st.bad, false) then head := 'ALARM — ' || head;
  elsif not is_bad and coalesce(st.bad, false) then head := 'RECOVERED — ' || head; end if;
  insert into data_alarms.state (name, bad, since, detail, checked_at, last_detail)
       values ('close_cover', is_bad, case when is_bad then p_now end, head, p_now, head)
  on conflict (name) do update set bad = excluded.bad,
         since = case when excluded.bad and not data_alarms.state.bad then p_now when excluded.bad then data_alarms.state.since end,
         detail = excluded.detail, checked_at = p_now, last_detail = excluded.last_detail;
  perform data_alarms.send('close_cover', 'daily', head || body || E'\n' || data_alarms.utc(p_now) || ' (pg_cron)');
  return 'reported ' || yday;
end $$;

-- the streak rule for one row: one alert when it goes bad, one recovery when it is good again; an owed message
-- (not yet confirmed delivered) is sent again until a 2xx is seen
create or replace function data_alarms.step(p_name text, p_now timestamptz) returns text
language plpgsql as $$
declare j record; st data_alarms.state; pre text; txt text;
begin
  select * into j from data_alarms.judge(p_name, p_now);
  insert into data_alarms.state (name) values (p_name) on conflict (name) do nothing;
  select * into st from data_alarms.state where name = p_name for update;
  update data_alarms.state set checked_at = p_now, last_detail = j.detail where name = p_name;
  if j.bad is null then return p_name || ': nothing to judge'; end if;
  pre := case when j.forced then '[TEST] ' else '' end;
  if j.bad and not st.bad then
    txt := pre || 'ALARM — ' || j.detail || E'\n' || data_alarms.utc(p_now) || ' (pg_cron)';
    update data_alarms.state set bad = true, since = p_now, detail = j.detail, owe = 'alert', owe_text = txt, test = j.forced where name = p_name;
  elsif not j.bad and st.bad then
    txt := case when st.test or j.forced then '[TEST] ' else '' end || 'RECOVERED — ' || j.detail || format(' (bad since %s, %s min)', data_alarms.utc(st.since), data_alarms.mins(p_now - st.since))
           || E'\n' || data_alarms.utc(p_now) || ' (pg_cron)';
    update data_alarms.state set bad = false, since = null, detail = j.detail, owe = 'recovery', owe_text = txt, test = false where name = p_name;
  end if;
  select * into st from data_alarms.state where name = p_name;
  if st.owe is not null and not exists (select 1 from data_alarms.messages where alarm = p_name and delivery = 'queued') then
    perform data_alarms.send(p_name, st.owe, st.owe_text);
  end if;
  return p_name || ': ' || case when st.bad then 'BAD ' else 'ok ' end || j.detail;
end $$;

create or replace function data_alarms.tick() returns text
language plpgsql as $$
declare srcrow data_alarms.sources; rid bigint; acc text := ''; res text; nm text;
        today text := to_char((now() at time zone 'Europe/Berlin')::date, 'YYYY-MM-DD');
begin
  if not pg_try_advisory_xact_lock(20261101) then return 'locked'; end if;
  update data_alarms.heartbeat set last_tick = now();

  -- 1. ingest the previous tick's GETs, keep only what the rows need, then drop our responses
  update data_alarms.fetches f
     set processed_at = now(), status_code = r.status_code,
         ok = (r.status_code = 200 and data_alarms.try_jsonb(r.content) is not null),
         stamp = case f.source
                   when 'build_info' then data_alarms.try_ts(data_alarms.try_jsonb(r.content)->'data'->>'builtAt')
                   when 'card_state' then data_alarms.try_ts(data_alarms.try_jsonb(r.content)->>'generatedAt')
                   when 'coverage'   then data_alarms.try_ts(data_alarms.try_jsonb(r.content)->>'generatedAt') end,
         n = case when f.source = 'matches' and r.status_code = 200 then
               (select count(*) from jsonb_array_elements(case when jsonb_typeof(data_alarms.try_jsonb(r.content)) = 'array'
                                                               then data_alarms.try_jsonb(r.content) else '[]'::jsonb end) m
                 where m->>'date' = today and coalesce(m->>'finalScore', '') in ('', 'null')
                   and m->>'id' like 'upcoming-%') end,
         body = case when f.source = 'coverage' then data_alarms.try_jsonb(r.content) end,
         error = case when r.status_code is null then coalesce(r.error_msg, 'no response')
                      when r.status_code <> 200 then 'HTTP ' || r.status_code
                      when data_alarms.try_jsonb(r.content) is null then 'not valid JSON' end
    from net._http_response r
   where f.processed_at is null and r.id = f.id;
  -- a JSON that lacks the field the row needs is unreadable for that row
  update data_alarms.fetches set ok = false, error = coalesce(error, 'no timestamp field')
   where processed_at > now() - interval '1 minute' and ok and source in ('build_info', 'card_state') and stamp is null;
  update data_alarms.fetches set processed_at = now(), ok = false, error = 'no response'
   where processed_at is null and fired_at < now() - interval '4 minutes';
  -- (a role that may not delete pg_net's responses keeps them; pg_net expires them itself — never a failed tick)
  begin
    delete from net._http_response r using data_alarms.fetches f where r.id = f.id and f.processed_at is not null;
  exception when insufficient_privilege then null;
  end;
  -- message delivery: confirmed only on a 2xx; a confirmed alert / recovery clears what the row owes
  update data_alarms.messages m
     set delivery = case when r.status_code between 200 and 299 then 'sent'
                         else 'failed: ' || coalesce('HTTP ' || r.status_code, r.error_msg, 'no response') end
    from net._http_response r
   where m.delivery = 'queued' and r.id = m.net_request_id;
  update data_alarms.messages set delivery = 'failed: no response'
   where delivery = 'queued' and created_at < now() - interval '4 minutes';
  update data_alarms.state s set owe = null, owe_text = null
   where s.owe is not null and exists (select 1 from data_alarms.messages m
                                        where m.alarm = s.name and m.kind = s.owe and m.text = s.owe_text and m.delivery = 'sent');
  begin
    delete from net._http_response r using data_alarms.messages m where r.id = m.net_request_id and m.delivery <> 'queued';
  exception when insufficient_privilege then null;
  end;

  -- 2. judge every enabled row
  for nm in select name from data_alarms.config where enabled and name <> 'close_cover' order by name loop
    res := data_alarms.step(nm, now());
    acc := acc || res || E'\n';
  end loop;
  if (select enabled from data_alarms.config where name = 'close_cover') then
    acc := acc || 'close_cover: ' || data_alarms.coverage(now()) || E'\n';
  end if;

  -- 3. the next GETs (cache-busted)
  for srcrow in select * from data_alarms.sources loop
    select net.http_get(url := srcrow.url || '?cb=' || floor(extract(epoch from now()) * 1000)::bigint,
                        timeout_milliseconds := 60000) into rid;
    insert into data_alarms.fetches (id, source) values (rid, srcrow.name);
  end loop;
  delete from data_alarms.fetches where fired_at < now() - interval '3 days';
  delete from data_alarms.messages where created_at < now() - interval '60 days';
  delete from data_alarms.force where until < now() - interval '1 day';
  return acc;
end $$;

revoke all on all functions in schema data_alarms from public, anon, authenticated;
revoke all on all tables in schema data_alarms from public, anon, authenticated;
