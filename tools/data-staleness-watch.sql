-- Founder ruling 2026-10-25: the published-data staleness alert moves to the Supabase pg_cron heartbeat, every 10 min.
-- (The GitHub workflow data-staleness-alert.yml's */15 schedule never fired: 0 schedule-triggered runs; both real alerts
-- of 25 Oct came from its workflow_run triggers.)
--
-- The SAME rule as tools/data-staleness-alert.mjs `decide`:
--   - data.builtAt of the live build-info.json more than stale_after (60 min) old → one message when a stale build is
--     first seen, then at most one every repeat_every (60 min) while the SAME build (the episode) stays stale; a new
--     stale build alerts at once;
--   - build-info.json unreadable (no response, non-200, not JSON, no valid data.builtAt) on unread_n (2) checks IN A
--     ROW → the same, as the episode 'unread', saying the file could not be read. One failed check (a blip) never
--     alerts: until the second, the last good data.builtAt keeps being judged (stale data stays stale).
-- How, in pg_cron + pg_net (the pattern of tools/ten294-drops-watchdog.sql, which runs this way in production):
--   pg_net is asynchronous, so each tick (1) ingests the previous tick's GET response, (2) decides, (3) sends, (4) fires
--   the next GET. The age is measured at the moment the GET was FIRED (fired_at − data.builtAt), so the 10-min lag of
--   the asynchronous read can never report a build that was already replaced as stale.
--   pg_net → api.telegram.org can lose a message to a TLS timeout (measured on TEN-280), so a message counts as
--   delivered only on a 2xx response; an unconfirmed one is decided again (and re-sent) on the next tick.
-- Own Vault names (stale_watch_telegram_*), never another job's: one uninstall must not kill a neighbour.
-- Idempotent; installs NOTHING scheduled (the cron job is a separate step in tools/data-staleness-watch-steps.json).
create schema if not exists stale_watch;
revoke all on schema stale_watch from public, anon, authenticated;

create table if not exists stale_watch.config (
    id           boolean primary key default true check (id),
    url          text     not null default 'https://michaeldk1996.github.io/SAAS/build-info.json',
    stale_after  interval not null default interval '60 minutes',
    repeat_every interval not null default interval '60 minutes',
    unread_n     integer  not null default 2
);
insert into stale_watch.config (id) values (true) on conflict (id) do nothing;

create table if not exists stale_watch.checks (
    id           bigint primary key,                 -- the pg_net request id
    fired_at     timestamptz not null default now(),
    processed_at timestamptz,
    status_code  integer,
    built_at     timestamptz,                        -- data.builtAt; null = unreadable
    published_at timestamptz,                        -- builtAt (the publish time), for the message
    error        text
);
create index if not exists stale_checks_fired_idx on stale_watch.checks (fired_at);

create table if not exists stale_watch.messages (
    id             bigserial primary key,
    episode        text not null,                    -- 'stale:<data.builtAt epoch ms>' | 'unread' | 'selftest'
    kind           text not null,                    -- alert | repeat | selftest
    text           text not null,
    net_request_id bigint,
    delivery       text not null default 'queued',   -- queued | sent | failed: ...
    created_at     timestamptz not null default now()
);

-- the GitHub path's dedupe reads this (proposal in the report): when did pg_cron last tick?
create table if not exists stale_watch.heartbeat (
    id        boolean primary key default true check (id),
    last_tick timestamptz
);
insert into stale_watch.heartbeat (id) values (true) on conflict (id) do nothing;

create or replace function stale_watch.try_jsonb(p text) returns jsonb
language plpgsql immutable as $$
begin
  if p is null or left(ltrim(p), 1) <> '{' then return null; end if;
  return p::jsonb;
exception when others then
  return null;
end $$;

create or replace function stale_watch.try_ts(p text) returns timestamptz
language plpgsql immutable as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}T' then return null; end if;
  return p::timestamptz;
exception when others then
  return null;
end $$;

create or replace function stale_watch.utc(t timestamptz) returns text
language sql immutable as $$ select to_char(t at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || 'Z' $$;

-- THE RULE. Pure: every input explicit (the test drives it with a fake clock).
--   p_obs_at     when the observed build-info.json was fetched (the age is measured there)
--   p_built_at   its data.builtAt (null when p_readable is false)
--   p_now        now, for the hourly repeat
--   p_prev_*     the last DELIVERED alert's episode and time, or null
create or replace function stale_watch.decide(
    p_now timestamptz, p_obs_at timestamptz, p_readable boolean, p_built_at timestamptz, p_published_at timestamptz,
    p_why text, p_tries integer, p_prev_episode text, p_prev_at timestamptz,
    p_stale_after interval default interval '60 minutes', p_repeat interval default interval '60 minutes',
    out alert boolean, out episode text, out msg text, out why text)
language plpgsql immutable as $$
declare mins integer;
begin
  alert := false;
  if p_readable then
    if not (p_obs_at - p_built_at > p_stale_after) then
      why := format('fresh: data built %s (%s min old when read)', stale_watch.utc(p_built_at),
                    greatest(0, floor(extract(epoch from p_obs_at - p_built_at) / 60))::int);
      return;
    end if;
    mins := floor(extract(epoch from p_now - p_built_at) / 60)::int;
    episode := 'stale:' || floor(extract(epoch from p_built_at) * 1000)::bigint;
    msg := format('Stennisfy site data is stale: the published data was built %s, %s min ago (alert after %s min).',
                  stale_watch.utc(p_built_at), mins, floor(extract(epoch from p_stale_after) / 60)::int)
           || coalesce(' Last publish: ' || stale_watch.utc(p_published_at) || '.', '');
  else
    episode := 'unread';
    msg := format('Stennisfy site data age unknown: build-info.json could not be read (%s, %s checks in a row, 10 min apart). The site may be down or the file broken.',
                  coalesce(p_why, 'no response'), p_tries);
  end if;
  if p_prev_episode = episode and p_now - p_prev_at < p_repeat then
    why := format('already alerted for this at %s (next at most %s min after it)', stale_watch.utc(p_prev_at),
                  floor(extract(epoch from p_repeat) / 60)::int);
    episode := null; msg := null;
    return;
  end if;
  alert := true;
  if p_prev_episode = episode then msg := 'Still: ' || msg; end if;
  msg := msg || E'\n' || stale_watch.utc(p_now) || ' (pg_cron)';
  why := 'alert';
end $$;

create or replace function stale_watch.skey(p_name text) returns text
language sql stable as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1
$$;

create or replace function stale_watch.send(p_episode text, p_kind text, p_text text) returns bigint
language plpgsql as $$
declare tok text := stale_watch.skey('stale_watch_telegram_bot_token');
        chat text := stale_watch.skey('stale_watch_telegram_chat_id');
        rid bigint;
begin
  if tok is null or chat is null then
    insert into stale_watch.messages (episode, kind, text, delivery) values (p_episode, p_kind, p_text, 'failed: no vault secret');
    return null;
  end if;
  select net.http_post(url := 'https://api.telegram.org/bot' || tok || '/sendMessage',
                       body := jsonb_build_object('chat_id', chat, 'text', p_text, 'disable_web_page_preview', true),
                       headers := '{"Content-Type": "application/json"}'::jsonb,
                       timeout_milliseconds := 10000) into rid;
  insert into stale_watch.messages (episode, kind, text, net_request_id) values (p_episode, p_kind, p_text, rid);
  return rid;
end $$;

create or replace function stale_watch.tick() returns text
language plpgsql as $$
declare cfg stale_watch.config; last stale_watch.checks; good stale_watch.checks; n_bad integer; readable boolean;
        prev stale_watch.messages; d record; rid bigint; tries integer; v_why text := 'no read yet';
begin
  if not pg_try_advisory_xact_lock(20261025) then return 'locked'; end if;
  select * into cfg from stale_watch.config;
  update stale_watch.heartbeat set last_tick = now();

  -- 1. ingest GET responses (pg_net keeps them ~6 h)
  update stale_watch.checks c
     set processed_at = now(), status_code = r.status_code,
         built_at     = case when r.status_code = 200 then stale_watch.try_ts(stale_watch.try_jsonb(r.content)->'data'->>'builtAt') end,
         published_at = case when r.status_code = 200 then stale_watch.try_ts(stale_watch.try_jsonb(r.content)->>'builtAt') end,
         error = case when r.status_code is null then coalesce(r.error_msg, 'no response')
                      when r.status_code <> 200 then 'HTTP ' || r.status_code
                      when stale_watch.try_jsonb(r.content) is null then 'not valid JSON'
                      else 'no valid data.builtAt' end
    from net._http_response r
   where c.processed_at is null and r.id = c.id;
  update stale_watch.checks set processed_at = now(), error = 'no response'
   where processed_at is null and fired_at < now() - interval '2 minutes';
  -- message delivery: confirmed only on a 2xx
  update stale_watch.messages m
     set delivery = case when r.status_code between 200 and 299 then 'sent'
                         else 'failed: ' || coalesce('HTTP ' || r.status_code, r.error_msg, 'no response') end
    from net._http_response r
   where m.delivery = 'queued' and r.id = m.net_request_id;
  update stale_watch.messages set delivery = 'failed: no response'
   where delivery = 'queued' and created_at < now() - interval '2 minutes';

  -- 2. what the checks say
  select * into last from stale_watch.checks where processed_at is not null order by fired_at desc, id desc limit 1;
  if last.id is not null then
    select count(*) filter (where built_at is null) into n_bad
      from (select built_at from stale_watch.checks where processed_at is not null order by fired_at desc, id desc limit cfg.unread_n) x;
    if last.built_at is not null then
      readable := true; good := last;
    elsif n_bad >= cfg.unread_n then
      readable := false;
    else
      -- one failed check: judge the last good read (stale data does not get fresher by being unreadable)
      select * into good from stale_watch.checks where built_at is not null and fired_at > now() - interval '3 days'
       order by fired_at desc, id desc limit 1;
      readable := good.id is not null;
    end if;
    -- failed checks in a row (since the last good read)
    select count(*) into tries from stale_watch.checks
     where processed_at is not null and built_at is null
       and fired_at > coalesce((select max(fired_at) from stale_watch.checks where built_at is not null), '-infinity'::timestamptz);
    if readable is not null and (readable or n_bad >= cfg.unread_n) then
      select * into prev from stale_watch.messages where delivery = 'sent' and kind in ('alert', 'repeat')
       order by created_at desc limit 1;
      select * into d from stale_watch.decide(now(), coalesce(good.fired_at, last.fired_at), readable, good.built_at, good.published_at,
                                              last.error, tries, prev.episode, prev.created_at, cfg.stale_after, cfg.repeat_every);
      v_why := d.why;
      -- 3. send, unless a message is still in flight (its 2xx not seen yet)
      if d.alert and not exists (select 1 from stale_watch.messages where delivery = 'queued') then
        perform stale_watch.send(d.episode, case when d.msg like 'Still:%' then 'repeat' else 'alert' end, d.msg);
      elsif d.alert then
        v_why := 'alert due, a message still in flight';
      end if;
    end if;
  end if;

  -- 4. next GET (cache-busted)
  select net.http_get(url := cfg.url || '?cb=' || floor(extract(epoch from now()) * 1000)::bigint, timeout_milliseconds := 20000) into rid;
  insert into stale_watch.checks (id) values (rid);
  delete from stale_watch.checks where fired_at < now() - interval '3 days';
  delete from stale_watch.messages where created_at < now() - interval '30 days';
  return v_why;
end $$;

revoke all on all functions in schema stale_watch from public, anon, authenticated;
revoke all on all tables in schema stale_watch from public, anon, authenticated;
