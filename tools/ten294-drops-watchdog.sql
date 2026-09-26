-- TEN-294 — the drops watchdog (rules: .claude/rules/drops.md). A stall must reach a human: the founder's
-- Telegram chat, the same one the drop alerts go to (founder, card 37612d3d Q5).
--
-- Runs in pg_cron, OUTSIDE the Fly app: an app that is down cannot report itself. Every minute:
--   1. ingest the previous check's pg_net response,
--   2. decide the condition from the recent checks,
--   3. alert on a change, repeat every 30 min while bad, send a recovery message when it clears,
--   4. fire the next GET /health.
-- pg_net -> api.telegram.org can LOSE a message to a TLS timeout (measured on TEN-280). So a message counts as
-- delivered only when its response is a 2xx; an unconfirmed one is re-sent on the next tick.
-- Own Vault names (ten294_telegram_*), never another job's: one uninstall must not kill a neighbour.
-- Idempotent; installs NOTHING scheduled (the cron job is a separate, explicit step).
create schema if not exists drops_watch;
revoke all on schema drops_watch from public, anon, authenticated;

create table if not exists drops_watch.config (
    id            boolean primary key default true check (id),
    health_url    text    not null default 'https://stennisfy-drops.fly.dev/health',
    unreachable_n integer not null default 3,         -- consecutive failed checks before "unreachable"
    stale_n       integer not null default 2,         -- consecutive not-ok health bodies before "stale"
    repeat_every  interval not null default interval '30 minutes'
);
insert into drops_watch.config (id) values (true) on conflict (id) do nothing;

create table if not exists drops_watch.checks (
    id           bigint primary key,                  -- the pg_net request id
    fired_at     timestamptz not null default now(),
    processed_at timestamptz,
    status_code  integer,
    body         jsonb,
    error        text
);
create index if not exists checks_fired_idx on drops_watch.checks (fired_at);

create table if not exists drops_watch.messages (
    id             bigserial primary key,
    kind           text not null,                     -- alert | repeat | recovery | selftest
    condition      text not null,
    text           text not null,
    net_request_id bigint,
    delivery       text not null default 'queued',    -- queued | sent | failed: ...
    created_at     timestamptz not null default now()
);

create table if not exists drops_watch.state (
    id         boolean primary key default true check (id),
    condition  text not null default 'ok',
    since      timestamptz not null default now()
);
insert into drops_watch.state (id) values (true) on conflict (id) do nothing;

create or replace function drops_watch.skey(p_name text) returns text
language sql stable as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1
$$;

create or replace function drops_watch.send(p_kind text, p_condition text, p_text text) returns bigint
language plpgsql as $$
declare tok text := drops_watch.skey('ten294_telegram_bot_token');
        chat text := drops_watch.skey('ten294_telegram_chat_id');
        rid bigint;
begin
  if tok is null or chat is null then
    insert into drops_watch.messages (kind, condition, text, delivery) values (p_kind, p_condition, p_text, 'failed: no vault secret');
    return null;
  end if;
  select net.http_post(url := 'https://api.telegram.org/bot' || tok || '/sendMessage',
                       body := jsonb_build_object('chat_id', chat, 'text', p_text),
                       headers := '{"Content-Type": "application/json"}'::jsonb) into rid;
  insert into drops_watch.messages (kind, condition, text, net_request_id) values (p_kind, p_condition, p_text, rid);
  return rid;
end $$;

-- The condition from the most recent checks. Pure: reads drops_watch.checks only (tests drive it with rows).
create or replace function drops_watch.condition() returns text
language plpgsql stable as $$
declare cfg drops_watch.config; last_ok jsonb; n_fail integer; n_bad integer; worst text;
begin
  select * into cfg from drops_watch.config;
  -- unreachable: the last N processed checks all failed to produce a /health body
  select count(*) filter (where status_code is null or status_code not in (200, 503) or body is null)
    into n_fail
    from (select * from drops_watch.checks where processed_at is not null order by id desc limit cfg.unreachable_n) c;
  if n_fail >= cfg.unreachable_n
     and (select count(*) from drops_watch.checks where processed_at is not null) >= cfg.unreachable_n then
    return 'unreachable';
  end if;
  -- stale: the last M bodies all said ok=false
  select count(*) filter (where body is not null and (body->>'ok')::boolean is false)
    into n_bad
    from (select * from drops_watch.checks where processed_at is not null and body is not null
           order by id desc limit cfg.stale_n) c;
  if n_bad >= cfg.stale_n then
    select body into last_ok from drops_watch.checks where processed_at is not null and body is not null order by id desc limit 1;
    select string_agg(s->>'id' || ' ' || coalesce(s->>'ageS', '?') || 's', ', ')
      into worst from jsonb_array_elements(last_ok->'sources') s where s->>'state' <> 'ok';
    return 'stale: data ' || coalesce(last_ok->>'ageS', '?') || 's old (' || coalesce(last_ok->>'freshness', '?') || ')'
           || coalesce('; sources ' || worst, '');
  end if;
  return 'ok';
end $$;

create or replace function drops_watch.tick() returns text
language plpgsql as $$
declare cfg drops_watch.config; st drops_watch.state; cond text; v_kind text; rid bigint; last_sent timestamptz; msg text;
begin
  if not pg_try_advisory_xact_lock(294294) then return 'locked'; end if;
  select * into cfg from drops_watch.config;

  -- 1. ingest check responses (pg_net keeps them ~6 h)
  update drops_watch.checks c
     set processed_at = now(), status_code = r.status_code,
         body = case when r.content is not null and left(ltrim(r.content), 1) = '{' then r.content::jsonb end,
         error = r.error_msg
    from net._http_response r
   where c.processed_at is null and r.id = c.id;
  -- a request pg_net never answered within 2 min is a failed check, not a pending one forever
  update drops_watch.checks set processed_at = now(), error = 'no response'
   where processed_at is null and fired_at < now() - interval '2 minutes';
  -- message delivery: confirmed only on a 2xx
  update drops_watch.messages m
     set delivery = case when r.status_code between 200 and 299 then 'sent'
                         else 'failed: ' || coalesce('HTTP ' || r.status_code, r.error_msg, 'no response') end
    from net._http_response r
   where m.delivery = 'queued' and r.id = m.net_request_id;
  update drops_watch.messages set delivery = 'failed: no response'
   where delivery = 'queued' and created_at < now() - interval '2 minutes';

  -- 2. condition
  cond := drops_watch.condition();
  v_kind := split_part(cond, ':', 1);          -- ok | unreachable | stale — the detail (ages) changes every tick
  select * into st from drops_watch.state;   -- state.condition holds the KIND only

  -- 3. alert / repeat / recovery
  if v_kind is distinct from st.condition then
    if v_kind = 'ok' then
      msg := format(E'✅ DROPS PAGE RECOVERED\n\nWas: %s\nFor: %s min', st.condition, round(extract(epoch from now() - st.since) / 60));
      perform drops_watch.send('recovery', cond, msg);
    else
      msg := format(E'⚠️ DROPS PAGE: %s\n\nSince %s UTC. The page shows its data age to users; this is the stall behind it.',
                    cond, to_char(now() at time zone 'UTC', 'HH24:MI'));
      perform drops_watch.send('alert', cond, msg);
    end if;
    update drops_watch.state set condition = v_kind, since = now();
  elsif v_kind <> 'ok' then
    select max(created_at) into last_sent from drops_watch.messages
     where delivery = 'sent' and kind in ('alert', 'repeat') and created_at >= st.since;
    -- nothing CONFIRMED sent for this episode yet (lost to a TLS timeout) -> send again, once no send is in flight
    if (last_sent is null and not exists (select 1 from drops_watch.messages where delivery = 'queued'))
       or last_sent < now() - cfg.repeat_every then
      msg := format(E'⚠️ DROPS PAGE STILL: %s\n\nSince %s UTC (%s min).', cond,
                    to_char(st.since at time zone 'UTC', 'HH24:MI'), round(extract(epoch from now() - st.since) / 60));
      perform drops_watch.send('repeat', cond, msg);
    end if;
  end if;

  -- 4. next check
  select net.http_get(url := cfg.health_url, timeout_milliseconds := 10000) into rid;
  insert into drops_watch.checks (id) values (rid);
  delete from drops_watch.checks where fired_at < now() - interval '3 days';
  return cond;
end $$;

revoke all on all functions in schema drops_watch from public, anon, authenticated;
revoke all on all tables in schema drops_watch from public, anon, authenticated;
